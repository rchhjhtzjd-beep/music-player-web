const axios = require('axios');

const FEED_URL = 'https://www.storynory.com/feeds/stories/';
const FEED_TIMEOUT_MS = 8000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;

// RSS enclosure.length is a byte count. Only itunes:duration (or the explicitly
// named durationSeconds in our cache) can supply a playback duration.
function parseDurationSeconds(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  let seconds;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    seconds = Number(text);
  } else if (/^\d+:[0-5]\d(?:\.\d+)?$/.test(text)) {
    const [minutes, remainder] = text.split(':').map(Number);
    seconds = minutes * 60 + remainder;
  } else if (/^\d+:[0-5]\d:[0-5]\d(?:\.\d+)?$/.test(text)) {
    const [hours, minutes, remainder] = text.split(':').map(Number);
    seconds = hours * 3600 + minutes * 60 + remainder;
  } else {
    return null;
  }
  return Number.isFinite(seconds) && seconds > 0 && seconds <= Number.MAX_SAFE_INTEGER
    ? seconds : null;
}

function decodeXml(value) {
  return value.replace(/&([^;\s]*);|&/g, (match, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(named, entity)) return named[entity];
    let code;
    if (/^#\d+$/.test(entity || '')) code = Number(entity.slice(1));
    if (/^#x[0-9a-f]+$/i.test(entity || '')) code = parseInt(entity.slice(2), 16);
    if (Number.isInteger(code) && code > 0 && code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
    throw new Error('Invalid XML entity');
  });
}

// A bounded, non-expanding XML reader for RSS. It validates closing tags rather
// than accepting fragments from an HTML error page or a truncated response.
// External entities and declarations are deliberately unsupported.
function parseXml(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > MAX_FEED_BYTES) {
    throw new Error('Invalid or oversized feed');
  }
  const document = { name: '#document', children: [] };
  const stack = [document];
  let offset = 0;
  let count = 0;
  while (offset < xml.length) {
    if (xml[offset] !== '<') {
      const next = xml.indexOf('<', offset);
      const end = next === -1 ? xml.length : next;
      const text = decodeXml(xml.slice(offset, end));
      if (stack.length === 1 && text.trim()) throw new Error('Text outside XML root');
      stack.at(-1).children.push(text);
      offset = end;
      continue;
    }
    if (xml.startsWith('<!--', offset) || xml.startsWith('<?', offset)) {
      const marker = xml.startsWith('<!--', offset) ? '-->' : '?>';
      const end = xml.indexOf(marker, offset + 2);
      if (end < 0) throw new Error('Unclosed XML comment or instruction');
      offset = end + marker.length;
      continue;
    }
    if (xml.startsWith('<![CDATA[', offset)) {
      const end = xml.indexOf(']]>', offset + 9);
      if (end < 0 || stack.length === 1) throw new Error('Invalid CDATA');
      stack.at(-1).children.push(xml.slice(offset + 9, end));
      offset = end + 3;
      continue;
    }
    let end = offset + 1;
    let quote = '';
    for (; end < xml.length; end++) {
      const char = xml[end];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === xml.length) throw new Error('Unclosed XML tag');
    const tag = xml.slice(offset, end + 1);
    offset = end + 1;
    const close = /^<\/([A-Za-z_][\w.:-]*)\s*>$/.exec(tag);
    if (close) {
      if (stack.length === 1 || stack.at(-1).name !== close[1]) throw new Error('Mismatched XML tag');
      stack.pop();
      continue;
    }
    const open = /^<([A-Za-z_][\w.:-]*)([\s\S]*?)(\/?)>$/.exec(tag);
    if (!open) throw new Error('Unsupported XML declaration or invalid tag');
    const attrs = Object.create(null);
    let rest = open[2];
    while (rest.trim()) {
      const attr = /^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(rest);
      if (!attr || Object.hasOwn(attrs, attr[1])) throw new Error('Invalid XML attribute');
      attrs[attr[1]] = decodeXml(attr[2] ?? attr[3]);
      rest = rest.slice(attr[0].length);
    }
    const node = { name: open[1], attrs, children: [] };
    stack.at(-1).children.push(node);
    if (++count > 50000 || stack.length > 64) throw new Error('Feed too complex');
    if (!open[3]) stack.push(node);
  }
  const roots = document.children.filter(child => typeof child !== 'string');
  if (stack.length !== 1 || roots.length !== 1) throw new Error('Incomplete XML document');
  return roots[0];
}

function textContent(node) {
  if (!node) return '';
  return node.children.map(child => typeof child === 'string' ? child : textContent(child)).join('');
}

function child(node, name) {
  return node.children.find(item => typeof item !== 'string' && item.name === name);
}

function plainText(value, maxLength = 150) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
      if (Object.hasOwn(named, entity)) return named[entity];
      try { return decodeXml(match); } catch { return match; }
    })
    .replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function httpUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function byteCount(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (!/^\d+$/.test(String(value).trim())) return null;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

function parseStoryFeed(xml) {
  const root = parseXml(xml);
  const channel = root.name === 'rss' ? child(root, 'channel') : null;
  if (!channel) throw new Error('Not an RSS channel');
  const stories = [];
  for (const item of channel.children.filter(node => node?.name === 'item')) {
    const enclosure = item.children.find(node => {
      if (node?.name !== 'enclosure') return false;
      const url = httpUrl(node.attrs.url);
      const type = (node.attrs.type || '').trim().toLowerCase();
      return url && (type.startsWith('audio/') || (!type && /\.(mp3|m4a|aac|ogg|opus|wav|flac)(?:$|[?#])/i.test(url)));
    });
    const title = plainText(textContent(child(item, 'title')), 500);
    if (!enclosure || !title) continue;
    stories.push({
      title,
      url: httpUrl(enclosure.attrs.url),
      durationSeconds: parseDurationSeconds(textContent(child(item, 'itunes:duration'))),
      enclosureBytes: byteCount(enclosure.attrs.length),
      description: plainText(textContent(child(item, 'description'))),
      sourceUrl: httpUrl(textContent(child(item, 'link'))),
    });
  }
  if (!stories.length) throw new Error('No playable stories in feed');
  return stories;
}

// Optional text is supplied explicitly for this exact recording URL. Keep the
// original cue times; the player validates their order, bounds and expected
// recording length against the media that actually loads.
function optionalSubtitleFields(story) {
  const fields = {};
  if (Array.isArray(story.subtitles) && story.subtitles.length) {
    fields.subtitles = story.subtitles;
  }
  if (typeof story.transcript === 'string' && story.transcript.trim()) {
    fields.transcript = story.transcript;
  }
  if (typeof story.subtitleDurationSeconds === 'number' &&
      parseDurationSeconds(story.subtitleDurationSeconds) !== null) {
    fields.subtitleDurationSeconds = story.subtitleDurationSeconds;
  }
  return fields;
}

function normalizeCachedStories(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(story => story && typeof story.title === 'string' && httpUrl(story.url)).map(story => ({
    title: story.title,
    url: httpUrl(story.url),
    // Legacy `duration` held bytes; never guess a time from it.
    durationSeconds: typeof story.durationSeconds === 'number'
      ? parseDurationSeconds(story.durationSeconds) : null,
    enclosureBytes: byteCount(story.enclosureBytes),
    description: plainText(story.description),
    sourceUrl: httpUrl(story.sourceUrl),
    ...optionalSubtitleFields(story),
  }));
}

async function fetchStoryFeed() {
  const response = await axios.get(FEED_URL, {
    headers: { 'User-Agent': 'MusicPlayer/2.0', Accept: 'application/rss+xml, application/xml, text/xml' },
    responseType: 'text',
    transformResponse: [body => body],
    timeout: FEED_TIMEOUT_MS,
    maxContentLength: MAX_FEED_BYTES,
    maxRedirects: 5,
  });
  return response.data;
}

async function loadKidsStories({ fetchFeed = fetchStoryFeed, readCache = () => require('../kids-stories.json') } = {}) {
  let stories;
  try {
    stories = parseStoryFeed(await fetchFeed());
  } catch { /* Use the bundled catalogue if the feed cannot be read. */ }

  let cached = [];
  try { cached = normalizeCachedStories(await readCache()); }
  catch { /* A valid live feed can still be used without a local catalogue. */ }
  if (!stories) return cached;

  const subtitlesByAudio = new Map(cached.map(story => [story.url, optionalSubtitleFields(story)]));
  // A matching title, slug or estimated duration is not a recording identity.
  // Only merge optional subtitle data from the same normalized audio URL.
  return stories.map(story => ({ ...story, ...subtitlesByAudio.get(story.url) }));
}

module.exports = {
  FEED_URL,
  FEED_TIMEOUT_MS,
  MAX_FEED_BYTES,
  parseDurationSeconds,
  parseStoryFeed,
  normalizeCachedStories,
  loadKidsStories,
  getStories: loadKidsStories,
};

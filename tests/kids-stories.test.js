const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const axios = require('axios');
const {
  FEED_URL, FEED_TIMEOUT_MS, MAX_FEED_BYTES,
  parseDurationSeconds, parseStoryFeed, normalizeCachedStories, loadKidsStories,
} = require('../lib/kids-stories');

const FEED = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel><title>Fixture feed</title>
    <item>
      <title><![CDATA[A & B's little story]]></title>
      <link>https://example.com/a-story?one=1&amp;two=2</link>
      <image url="https://example.com/wrong-image.png" />
      <enclosure url='https://example.com/wrong-video.mp4' length='55555' type='video/mp4' />
      <enclosure type='audio/mpeg' length='9950442' url='https://example.com/story.mp3?one=1&amp;two=2' />
      <description><![CDATA[<p>Hello &amp; goodbye.&nbsp; A short description.</p>]]></description>
      <itunes:duration>11:02</itunes:duration>
    </item>
  </channel>
</rss>`;

const CACHE = [{
  title: 'Cached story', url: 'https://example.com/cached.mp3',
  durationSeconds: 42, enclosureBytes: 9999999,
  sourceUrl: 'https://example.com/cached-story', description: 'A summary.',
}];

test('duration parsing uses explicit seconds, MM:SS and HH:MM:SS', () => {
  for (const [input, expected] of [
    [662, 662], ['662', 662], [' 11:02 ', 662], ['01:02:03', 3723],
    ['00:00:05', 5], ['90:00', 5400], ['1.25', 1.25], ['1:02.50', 62.5],
  ]) assert.equal(parseDurationSeconds(input), expected, String(input));
});

test('missing or invalid durations remain unknown instead of producing NaN or estimates', () => {
  for (const input of [null, undefined, '', ' ', 0, -1, true, {}, [], NaN, Infinity,
    'Infinity', 'abc', '1e3', '11:60', '1:2', '1:60:00', '1:00:60', '01:02:03:04', '9007199254740992']) {
    assert.equal(parseDurationSeconds(input), null, String(input));
  }
});

test('RSS reads audio enclosure, actual duration and source link; decodes XML and CDATA', () => {
  assert.deepEqual(parseStoryFeed(FEED), [{
    title: "A & B's little story",
    url: 'https://example.com/story.mp3?one=1&two=2',
    durationSeconds: 662,
    enclosureBytes: 9950442,
    description: 'Hello & goodbye. A short description.',
    sourceUrl: 'https://example.com/a-story?one=1&two=2',
  }]);
});

test('RSS entity decoding and quoted greater-than signs do not break parsing', () => {
  const xml = `<rss><channel><item>
    <title>Fox &#x1F98A; &amp; &quot;friends&quot;</title>
    <enclosure url="https://example.com/story.mp3" length="123" type="audio/mpeg" note="1 &gt; 0"/>
    <description>One &lt;b&gt;small&lt;/b&gt; tale.</description>
    <itunes:duration>02:04:05</itunes:duration>
  </item></channel></rss>`;
  const [story] = parseStoryFeed(xml);
  assert.equal(story.title, 'Fox 🦊 & "friends"');
  assert.equal(story.durationSeconds, 7445);
  assert.equal(story.description, 'One small tale.');
  assert.equal(story.sourceUrl, null);
});

test('missing or invalid itunes:duration never falls back to enclosure length', () => {
  for (const replacement of ['', '<itunes:duration>not a duration</itunes:duration>']) {
    const [story] = parseStoryFeed(FEED.replace('<itunes:duration>11:02</itunes:duration>', replacement));
    assert.equal(story.durationSeconds, null);
    assert.equal(story.enclosureBytes, 9950442);
    assert.equal(Object.hasOwn(story, 'duration'), false);
  }
});

test('legacy cache byte values cannot become playback durations', () => {
  const [legacy, current] = normalizeCachedStories([
    { title: 'Legacy', url: 'https://example.com/old.mp3', duration: '9950442' },
    ...CACHE,
  ]);
  assert.equal(legacy.durationSeconds, null);
  assert.equal(legacy.enclosureBytes, null);
  assert.equal(Object.hasOwn(legacy, 'duration'), false);
  assert.equal(current.durationSeconds, 42);
  assert.equal(current.enclosureBytes, 9999999);
});

test('malformed, truncated, unsafe, non-audio and oversized feeds are rejected', () => {
  for (const xml of [
    '<html><body>Service unavailable</body></html>',
    '<rss><channel></rss>',
    FEED.slice(0, -8),
    '<rss><channel></channel></rss>',
    FEED.replace("type='audio/mpeg'", "type='video/mp4'"),
    FEED.replace("https://example.com/story.mp3?one=1&amp;two=2", 'javascript:alert(1)'),
    '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + FEED,
    FEED + ' '.repeat(MAX_FEED_BYTES),
  ]) assert.throws(() => parseStoryFeed(xml));
});

test('network errors, empty feed and malformed feed return normalized cache', async () => {
  for (const fetchFeed of [
    async () => { throw new Error('timeout'); },
    async () => '',
    async () => '<rss><channel></rss>',
    async () => '<rss><channel></channel></rss>',
  ]) {
    assert.deepEqual(await loadKidsStories({ fetchFeed, readCache: async () => CACHE }), CACHE);
  }
  assert.deepEqual(await loadKidsStories({
    fetchFeed: async () => { throw new Error('offline'); },
    readCache: async () => { throw new Error('missing cache'); },
  }), []);
});

test('feed success reads supplemental cache once; request has bounded time and response size', async t => {
  let options;
  t.mock.method(axios, 'get', async (url, input) => {
    assert.equal(url, FEED_URL);
    options = input;
    return { data: FEED };
  });
  let cacheReads = 0;
  const result = await loadKidsStories({ readCache: () => { cacheReads++; return CACHE; } });
  assert.equal(result[0].durationSeconds, 662);
  assert.equal(cacheReads, 1);
  assert.equal(options.timeout, FEED_TIMEOUT_MS);
  assert.ok(options.timeout > 0 && options.timeout <= 10000);
  assert.equal(options.maxContentLength, MAX_FEED_BYTES);
  assert.equal(options.responseType, 'text');
});

test('explicit subtitle fields survive cache normalization without invented or scaled timings', () => {
  const supplied = {
    ...CACHE[0],
    subtitles: [
      { start: 1.25, end: 3.75, text: 'One sentence.', translation: '一句话。' },
      { start: 6, end: 10, text: 'Another sentence.' },
    ],
    transcript: 'First paragraph.\n\nSecond paragraph.\n',
    subtitleDurationSeconds: 12.5,
  };
  const [normalized] = normalizeCachedStories([supplied]);
  assert.deepEqual(normalized.subtitles, supplied.subtitles);
  assert.equal(normalized.transcript, supplied.transcript);
  assert.equal(normalized.subtitleDurationSeconds, 12.5);
  assert.equal(normalized.durationSeconds, 42, 'subtitle duration is not playback duration');

  const [ordinary] = normalizeCachedStories([{
    ...CACHE[0], subtitles: [], transcript: '  ', subtitleDurationSeconds: '42',
  }]);
  for (const key of ['subtitles', 'transcript', 'subtitleDurationSeconds']) {
    assert.equal(Object.hasOwn(ordinary, key), false);
    assert.equal(Object.hasOwn(normalizeCachedStories(CACHE)[0], key), false);
  }
});

test('live feed merges supplied subtitles only by exact normalized audio URL', async () => {
  const supplied = {
    title: 'Cached title must not replace the feed title',
    url: 'HTTPS://EXAMPLE.COM/story.mp3?one=1&two=2',
    durationSeconds: 900,
    description: 'Cached description must not replace the live summary.',
    sourceUrl: 'https://example.com/cached-page',
    subtitles: [{ start: 2, end: 5, text: 'An explicitly supplied cue.' }],
    transcript: 'Explicitly supplied text.',
    subtitleDurationSeconds: 787.225933,
  };
  let cacheReads = 0;
  const [result] = await loadKidsStories({
    fetchFeed: async () => FEED,
    readCache: () => { cacheReads++; return [supplied]; },
  });
  assert.deepEqual(result, {
    ...parseStoryFeed(FEED)[0],
    subtitles: supplied.subtitles,
    transcript: supplied.transcript,
    subtitleDurationSeconds: supplied.subtitleDurationSeconds,
  });
  assert.equal(cacheReads, 1);
  assert.equal(result.durationSeconds, 662);
  assert.equal(result.title, "A & B's little story");
});

test('similar titles, different recordings and different URL query values never share subtitles', async () => {
  for (const url of [
    'https://example.com/different-story.mp3?one=1&two=2',
    'https://example.com/story.mp3?one=1&two=3',
    'https://other.example/story.mp3?one=1&two=2',
  ]) {
    const result = await loadKidsStories({
      fetchFeed: async () => FEED,
      readCache: () => [{ ...CACHE[0], title: "A & B's little story", url,
        subtitles: [{ start: 0, end: 4, text: 'Wrong recording.' }],
        transcript: 'Wrong transcript.', subtitleDurationSeconds: 662 }],
    });
    assert.deepEqual(result, parseStoryFeed(FEED));
  }
});

test('offline fallback preserves supplied subtitle metadata; unreadable cache does not lose a valid feed', async () => {
  const supplied = { ...CACHE[0],
    subtitles: [{ start: 1, end: 3, text: 'Supplied cue.', translation: '提供的字幕。' }],
    transcript: 'Supplied transcript.', subtitleDurationSeconds: 42,
  };
  let reads = 0;
  const result = await loadKidsStories({
    fetchFeed: async () => { throw new Error('offline'); },
    readCache: () => { reads++; return [supplied]; },
  });
  assert.deepEqual(result, [supplied]);
  assert.equal(reads, 1);
  assert.deepEqual(await loadKidsStories({
    fetchFeed: async () => FEED,
    readCache: () => { throw new Error('missing cache'); },
  }), parseStoryFeed(FEED));
});

test('migrated bundled cache preserves 60 stories and keeps unverified durations unknown', () => {
  const cache = require('../kids-stories.json');
  assert.equal(cache.length, 60);
  assert.equal(new Set(cache.map(story => story.url)).size, 60);
  assert.equal(cache[0].title, 'The Stolen Bicycle');
  assert.equal(cache[0].durationSeconds, 662);
  assert.equal(cache[0].enclosureBytes, 9950442);
  assert.equal(cache.at(-1).title, 'Halloween Chants');
  assert.equal(cache.at(-1).durationSeconds, null);
  for (const story of cache) {
    assert.equal(Object.hasOwn(story, 'duration'), false);
    assert.ok(story.durationSeconds === null || (Number.isFinite(story.durationSeconds) && story.durationSeconds > 0));
    assert.ok(Number.isSafeInteger(story.enclosureBytes));
  }
});

function mockResponse() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

test('Express, Vercel and Netlify return the same corrected story contract', async t => {
  t.mock.method(axios, 'get', async () => ({ data: FEED }));
  const expected = parseStoryFeed(FEED);
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/kids-stories`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expected);

  const vercel = require('../api-handler');
  const res = mockResponse();
  await vercel({ method: 'GET', url: '/api/kids-stories?ignored=1', headers: { host: 'example.com' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, expected);

  const { handler } = require('../netlify/functions/api');
  for (const event of [
    { path: '/api/kids-stories', queryStringParameters: {} },
    { path: '/.netlify/functions/api/kids-stories', queryStringParameters: {} },
    { path: '/.netlify/functions/api/kids-stories', rawUrl: 'https://example.com/api/kids-stories?ignored=1' },
    { pathParameters: { pathname: '/api/kids-stories/' } },
  ]) {
    const netlify = await handler({ httpMethod: 'GET', ...event });
    assert.equal(netlify.statusCode, 200);
    assert.deepEqual(JSON.parse(netlify.body), expected);
  }
  const unknown = await handler({ httpMethod: 'GET', path: '/api/kids-stories/unrelated' });
  assert.equal(unknown.statusCode, 404);
});

test('all deployment entrypoints preserve the cache fallback when upstream fails', async t => {
  t.mock.method(axios, 'get', async () => { throw new Error('upstream unavailable'); });
  const expected = normalizeCachedStories(require('../kids-stories.json'));
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/kids-stories`);
  assert.deepEqual(await response.json(), expected);
  const res = mockResponse();
  await require('../api-handler')({ method: 'GET', url: '/api/kids-stories', headers: { host: 'example.com' } }, res);
  assert.deepEqual(res.body, expected);
  const result = await require('../netlify/functions/api').handler({ httpMethod: 'GET', path: '/.netlify/functions/api/kids-stories' });
  assert.deepEqual(JSON.parse(result.body), expected);
});

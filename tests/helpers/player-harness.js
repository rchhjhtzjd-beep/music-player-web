const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Deliberately small browser doubles: the production scripts, event handlers and
// generated markup run unchanged; no player or subtitle logic is reimplemented.
class ClassList {
  constructor(value = '') { this.values = new Set(value.split(/\s+/).filter(Boolean)); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const enabled = force === undefined ? !this.contains(value) : !!force;
    if (enabled) this.add(value); else this.remove(value);
    return enabled;
  }
}

const decode = value => value.replace(/&quot;/g, '"').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&');

class Element {
  constructor(tagName = 'div', attributes = {}) {
    this.tagName = tagName;
    this.attributes = attributes;
    this.classList = new ClassList(attributes.class);
    this.dataset = {};
    for (const [name, value] of Object.entries(attributes)) {
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    this.style = {};
    this.children = [];
    this.listeners = new Map();
    this._text = '';
    this._html = '';
    this.scrollCalls = 0;
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(html) {
    this._html = String(html);
    this._text = '';
    this.children = [];
    const stack = [this];
    for (const token of this._html.match(/<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
      if (token.startsWith('<')) {
        const name = /^<([\w-]+)/.exec(token)?.[1];
        if (!name) continue;
        const attrs = {};
        for (const match of token.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[match[1]] = decode(match[2]);
        const child = new Element(name, attrs);
        stack[stack.length - 1].children.push(child);
        if (!/\/>$/.test(token) && !['input', 'br', 'img', 'hr', 'meta', 'link'].includes(name)) stack.push(child);
      } else stack[stack.length - 1]._text += decode(token);
    }
  }
  get innerHTML() { return this._html; }
  matches(selector) {
    if (selector.startsWith('.')) return selector.slice(1).split('.').every(name => this.classList.contains(name));
    if (selector.startsWith('#')) return this.attributes.id === selector.slice(1);
    return this.tagName === selector;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }
  emit(name, details = {}) {
    for (const listener of this.listeners.get(name) || []) listener({ currentTarget: this, preventDefault() {}, stopPropagation() {}, ...details });
  }
  scrollIntoView() { this.scrollCalls++; }
  getBoundingClientRect() { return { left: 100, width: 400 }; }
  appendChild(child) { this.children.push(child); }
}

class AudioDouble extends Element {
  constructor() {
    super('audio');
    this._src = '';
    this.currentSrc = '';
    this.duration = NaN;
    this.currentTime = 0;
    this.paused = true;
    this.playbackRate = 1;
    this.playCalls = 0;
    this.pauseCalls = 0;
  }
  set src(value) { this._src = value; this.currentSrc = value; this.duration = NaN; this.currentTime = 0; }
  get src() { return this._src; }
  removeAttribute(name) { if (name === 'src') { this._src = ''; this.currentSrc = ''; } }
  load() { this.duration = NaN; this.currentTime = 0; }
  play() { this.playCalls++; this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() {
    this.pauseCalls++;
    if (!this.paused) { this.paused = true; this.emit('pause'); }
  }
  metadata(duration) { this.duration = duration; this.emit('loadedmetadata'); }
  at(time, event = 'timeupdate') { this.currentTime = time; this.emit(event); }
  finish() { this.currentTime = this.duration; this.paused = true; this.emit('ended'); }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createHarness() {
  const roots = new Map();
  const document = {
    baseURI: 'https://player.example/',
    getElementById(id) {
      if (!roots.has(id)) roots.set(id, new Element('div', { id }));
      return roots.get(id);
    },
    addEventListener() {},
    querySelectorAll(selector) {
      return [...roots.values()].flatMap(root => [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    createElement(name) { return new Element(name); },
  };
  const requests = [];
  let responder = url => { throw new Error(`Unexpected fetch: ${url}`); };
  const sandbox = {
    document, Audio: AudioDouble, URL, console,
    window: { location: { protocol: 'https:' } },
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout() { return 1; }, clearTimeout() {},
    fetch(url, options) { requests.push({ url, options }); return Promise.resolve().then(() => responder(url, options)); },
  };
  const context = vm.createContext(sandbox);
  const root = path.resolve(__dirname, '../..');
  vm.runInContext(fs.readFileSync(path.join(root, 'js/media-timeline.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8') +
    '\nglobalThis.playerExports = { APP, playKidsStory, loadKidsStories, showBilingualSubs, playKidsSong };', context);
  const { APP, ...functions } = sandbox.playerExports;
  APP.setupAudioListeners();
  APP.bindEvents();
  return {
    APP, ...functions, document, audio: APP.audio, requests,
    element: id => document.getElementById(id),
    respondWith(fn) { responder = fn; },
    activeLines() { return document.getElementById('lyricsBody').querySelectorAll('.lyrics-line.active').map(line => line.dataset.idx); },
  };
}

function json(data) { return { ok: true, json: async () => data }; }
const flush = () => new Promise(resolve => setImmediate(resolve));

module.exports = { createHarness, deferred, json, flush };

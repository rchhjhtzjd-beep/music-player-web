const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, deferred, json, flush } = require('./helpers/player-harness');
const MediaTimeline = require('../js/media-timeline');

function story(name = 'A', overrides = {}) {
  return { title: `Story ${name}`, url: `https://audio.example/${name}.mp3`,
    durationSeconds: 20, description: 'A short story.', ...overrides };
}
function timedStory(name = 'A', overrides = {}) {
  return story(name, { subtitles: [
    { start: 2, end: 5, text: 'First line.', translation: '第一句。' },
    { start: 8, end: 12, text: 'Second line.', translation: '第二句。' },
  ], ...overrides });
}
const song = { source: 'netease', id: 7, name: 'Previous song' };

test('switching a song to a story clears the old lyric time axis and music identity', async () => {
  const h = createHarness();
  h.APP.currentMedia = { kind: 'song', key: h.APP.songKey(song), url: 'https://audio.example/song.mp3' };
  h.audio.src = h.APP.currentMedia.url;
  h.audio.duration = 60;
  h.APP.currentIndex = 0;
  h.APP.playlist = [song];
  h.APP.showLyrics([{ time: 0, text: 'Old lyric' }], song.name, h.APP.songKey(song));
  h.audio.at(4);
  assert.deepEqual(h.activeLines(), ['0']);

  await h.playKidsStory(story());
  h.audio.at(4);
  assert.equal(h.APP.currentMedia.kind, 'story');
  assert.equal(h.APP.currentIndex, -1);
  assert.equal(h.APP.currentLyrics.length, 0);
  assert.deepEqual(h.activeLines(), []);
  assert.doesNotMatch(h.element('lyricsBody').innerHTML, /Old lyric/);
  assert.match(h.element('lyricsBody').innerHTML, /暂无同步字幕/);
  assert.equal(h.element('btnFavPlayer').disabled, true);
});

test('a late song lyric response cannot overwrite a story panel', async () => {
  const h = createHarness();
  const response = deferred();
  h.respondWith(() => response.promise);
  const pending = h.APP.fetchAndShowLyrics(song);
  await flush();
  await h.playKidsStory(story('B'));
  response.resolve(json({ lrc: { lyric: '[00:00.00]Late song lyric' } }));
  await pending;
  assert.equal(h.element('lyricsTitle').textContent, '📖 Story B');
  assert.doesNotMatch(h.element('lyricsBody').innerHTML, /Late song lyric/);
  assert.equal(h.APP.currentLyrics.length, 0);
});

test('a late song playback URL cannot replace a more recently selected story', async () => {
  const h = createHarness();
  const response = deferred();
  h.respondWith(() => response.promise);
  const pending = h.APP.playSong({ ...song }, [{ ...song }]);
  await flush();
  const current = story('B');
  await h.playKidsStory(current);
  response.resolve(json({ data: [{ url: 'https://audio.example/late-song.mp3' }] }));
  await pending;
  assert.equal(h.audio.src, current.url);
  assert.equal(h.APP.currentMedia.key, `story:${current.url}`);
  assert.equal(h.element('songTitle').textContent, current.title);
  assert.equal(h.requests.length, 1, 'cancelled song selection must not start a lyric request');
});

test('fresh story playback can pause and resume without a song playlist', async () => {
  const h = createHarness();
  await h.playKidsStory(story());
  assert.equal(h.APP.currentIndex, -1);
  assert.equal(h.audio.paused, false);
  assert.equal(h.element('btnPlay').textContent, '⏸');
  h.element('btnPlay').emit('click');
  assert.equal(h.audio.paused, true);
  assert.equal(h.element('btnPlay').textContent, '▶');
  h.element('btnPlay').emit('click');
  assert.equal(h.audio.paused, false);
  assert.equal(h.element('btnPlay').textContent, '⏸');
});

test('next, previous and natural ending stay within the story queue', async () => {
  const h = createHarness();
  const queue = [story('A'), story('B'), story('C')];
  h.APP.playlist = [song];
  h.APP.currentIndex = 0;
  await h.playKidsStory(queue[0], queue);
  h.APP.next();
  assert.equal(h.audio.src, queue[1].url);
  h.APP.prev();
  assert.equal(h.audio.src, queue[0].url);
  h.APP.prev();
  assert.equal(h.audio.src, queue[2].url);
  h.audio.metadata(20);
  h.audio.at(7);
  h.APP.prev();
  assert.equal(h.audio.src, queue[2].url, 'previous after three seconds rewinds current story');
  assert.equal(h.audio.currentTime, 0);
  h.audio.finish();
  assert.equal(h.audio.src, queue[0].url);
  assert.equal(h.APP.currentMedia.kind, 'story');
  assert.equal(h.requests.length, 0, 'must not request the previous music queue');
});

test('single-repeat restarts the same story with subtitle position reset', async () => {
  const h = createHarness();
  const queue = [timedStory('A'), timedStory('B')];
  await h.playKidsStory(queue[0], queue);
  h.audio.metadata(20);
  h.APP.playMode = 'single';
  h.audio.at(9);
  assert.deepEqual(h.activeLines(), ['1']);
  h.audio.finish();
  assert.equal(h.audio.src, queue[0].url);
  assert.equal(h.audio.currentTime, 0);
  assert.equal(h.audio.paused, false);
  assert.deepEqual(h.activeLines(), []);
});

test('random story navigation cannot select an item from the previous music playlist', async () => {
  const h = createHarness();
  const queue = [story('A'), story('B'), story('C')];
  h.APP.playlist = [song];
  h.APP.playMode = 'random';
  await h.playKidsStory(queue[0], queue);
  for (const action of ['next', 'prev', 'next']) {
    h.APP[action]();
    assert.ok(queue.some(item => item.url === h.audio.src));
    assert.equal(h.APP.currentMedia.kind, 'story');
  }
  h.audio.metadata(20);
  h.audio.finish();
  assert.ok(queue.some(item => item.url === h.audio.src));
  assert.equal(h.requests.length, 0);
});

test('switching back to a music track restores its own lyrics and playback controls', async () => {
  const h = createHarness();
  await h.playKidsStory(timedStory());
  h.audio.metadata(20);
  h.audio.at(9);
  h.respondWith(url => url.includes('/url?')
    ? json({ data: [{ url: 'https://audio.example/song.mp3' }] })
    : json({ lrc: { lyric: '[00:01.00]Song line one\n[00:05.00]Song line two' } }));
  await h.APP.playSong({ ...song }, [{ ...song }]);
  await flush();
  h.audio.metadata(30);
  h.audio.at(6);
  assert.equal(h.APP.currentMedia.kind, 'song');
  assert.equal(h.APP.currentIndex, 0);
  assert.equal(h.APP.storyIndex, -1);
  assert.equal(h.element('btnFavPlayer').disabled, false);
  assert.equal(h.element('lyricsTitle').textContent, song.name);
  assert.deepEqual(h.activeLines(), ['1']);
  assert.match(h.element('lyricsBody').innerHTML, /Song line two/);
  assert.doesNotMatch(h.element('lyricsBody').innerHTML, /Second line\./);
  h.APP.togglePlay();
  assert.equal(h.audio.paused, true);
});

test('a pending or failed kids album cannot navigate back into the old music queue', async () => {
  for (const failure of ['empty search', 'network failure']) {
    const h = createHarness();
    h.APP.playlist = [{ ...song }];
    h.APP.currentIndex = 0;
    h.APP.storyIndex = 2;
    h.APP.currentMedia = { kind: 'song', key: h.APP.songKey(song), url: 'https://audio.example/previous.mp3' };
    h.audio.src = h.APP.currentMedia.url;
    const search = deferred();
    h.respondWith(() => search.promise);
    const album = { source: 'kids_album', id: 42, name: 'An album with no recording', artists: 'Kids' };
    const pending = h.playKidsSong(album);
    await flush();

    h.APP.prev();
    h.APP.next();
    await flush();
    assert.equal(h.APP.currentMedia.key, h.APP.songKey(album), `${failure}: pending selection remains active`);
    assert.equal(h.APP.currentIndex, -1);
    assert.equal(h.APP.storyIndex, -1);
    assert.equal(h.audio.src, '');
    assert.equal(h.requests.length, 1, 'only the album search should run while awaiting a recording');

    if (failure === 'empty search') search.resolve(json({ result: { songs: [] } }));
    else search.reject(new Error('network unavailable'));
    await pending;
    h.APP.prev();
    h.APP.next();
    await flush();
    assert.equal(h.APP.currentMedia.key, h.APP.songKey(album), `${failure}: failed selection must not revive old music`);
    assert.equal(h.audio.src, '');
    assert.equal(h.requests.length, 1);
  }
});

test('actual metadata updates both the story row and playback bar, and persists on list reload', async () => {
  const h = createHarness();
  h.respondWith(() => json([story('A', { durationSeconds: 662 })]));
  await h.loadKidsStories();
  let label = h.document.querySelector('.story-duration');
  assert.equal(label.textContent, '约 11:02');
  await h.playKidsStory(h.APP.kidsStories[0]);
  assert.equal(h.element('duration').textContent, '约 11:02');
  h.audio.metadata(665.5);
  assert.equal(label.textContent, '11:05');
  assert.equal(h.element('duration').textContent, '11:05');
  assert.equal(h.APP.kidsStories[0].durationSeconds, 665.5);
  h.audio.duration = 670;
  h.audio.emit('durationchange');
  assert.equal(label.textContent, '11:10');
  assert.equal(h.element('duration').textContent, '11:10');
  await h.loadKidsStories();
  label = h.document.querySelector('.story-duration');
  assert.equal(label.textContent, '11:10');
});

test('legacy byte counts and non-finite duration never display as media time or invalid progress', async () => {
  const h = createHarness();
  const legacy = story('A', { durationSeconds: undefined, duration: '9950442' });
  h.respondWith(() => json([legacy]));
  await h.loadKidsStories();
  assert.equal(h.document.querySelector('.story-duration').textContent, '时长待载入');
  await h.playKidsStory(legacy);
  for (const value of [NaN, Infinity, -1, 0]) {
    h.audio.duration = value;
    h.audio.at(4);
    h.audio.emit('durationchange');
    assert.equal(h.element('duration').textContent, '--:--');
    assert.equal(h.element('progressFill').style.width, '0%');
    const previousTime = h.audio.currentTime;
    h.APP.seekTo(3);
    assert.equal(h.audio.currentTime, previousTime);
  }
});

test('a metadata event for the former audio cannot change the selected story duration', async () => {
  const h = createHarness();
  await h.playKidsStory(story('A'));
  const current = story('B', { durationSeconds: 15 });
  await h.playKidsStory(current);
  h.audio.currentSrc = 'https://audio.example/A.mp3';
  h.audio.duration = 9999;
  h.audio.emit('loadedmetadata');
  assert.equal(current.durationSeconds, 15);
  assert.equal(h.element('duration').textContent, '约 0:15');
  assert.equal(h.APP.storyDurations.has(current.url), false);
});

test('timed subtitles respect first cue, silent gaps and both end boundaries', async () => {
  const h = createHarness();
  await h.playKidsStory(timedStory());
  h.audio.metadata(20);
  for (const [time, expected] of [[0, []], [1.999, []], [2, ['0']], [4.999, ['0']],
    [5, []], [7.999, []], [8, ['1']], [11.999, ['1']], [12, []], [19, []], [20, []]]) {
    h.audio.at(time);
    assert.deepEqual(h.activeLines(), expected, `subtitle at ${time}s`);
  }
  assert.match(h.element('lyricsBody').innerHTML, /双语同步字幕/);
  assert.match(h.element('lyricsBody').innerHTML, /第一句/);
});

test('paused seeking and playback rate changes follow media currentTime without a second clock', async () => {
  const h = createHarness();
  await h.playKidsStory(timedStory());
  h.audio.metadata(20);
  h.APP.togglePlay();
  h.APP.seekTo(9);
  assert.equal(h.audio.paused, true);
  assert.deepEqual(h.activeLines(), ['1']);
  assert.equal(h.element('currentTime').textContent, '0:09');
  assert.equal(h.element('progressFill').style.width, '45%');
  h.audio.playbackRate = 2;
  h.audio.at(4, 'seeked');
  assert.deepEqual(h.activeLines(), ['0']);
  h.audio.at(9, 'seeking');
  assert.deepEqual(h.activeLines(), ['1']);
  h.APP.seekTo(-20);
  assert.equal(h.audio.currentTime, 0);
  assert.deepEqual(h.activeLines(), []);
  h.APP.seekTo(300);
  assert.equal(h.audio.currentTime, 20);
  assert.deepEqual(h.activeLines(), []);
  h.element('progressBar').emit('click', { clientX: -10 });
  assert.equal(h.audio.currentTime, 0);
  h.element('progressBar').emit('click', { clientX: 900 });
  assert.equal(h.audio.currentTime, 20);
});

test('invalid or too-long cue tracks are rejected, rather than stretched to the audio', async () => {
  const h = createHarness();
  const item = timedStory('A');
  await h.playKidsStory(item);
  assert.equal(h.APP.currentLyrics.length, 2);
  h.audio.metadata(10);
  assert.equal(h.APP.currentLyrics.length, 0);
  assert.match(h.element('lyricsBody').innerHTML, /字幕时间轴与音频不匹配/);
  assert.deepEqual(h.activeLines(), []);
  assert.equal(item.subtitles[1].end, 12, 'original timestamps must not be rewritten');

  for (const subtitles of [
    [{ start: -1, end: 5, text: 'Invalid start' }],
    [{ start: 2, end: 2, text: 'Zero length' }],
    [{ start: 0, end: Infinity, text: 'Invalid end' }],
    [{ start: '1', end: 4, text: 'String start' }],
    [{ start: 0, end: 5, text: 'One' }, { start: 4, end: 8, text: 'Overlap' }],
  ]) {
    h.showBilingualSubs(story('A', { subtitles }));
    assert.equal(h.APP.currentLyrics.length, 0);
    assert.match(h.element('lyricsBody').innerHTML, /字幕时间轴与音频不匹配/);
  }
});

test('subtitle recording duration rejects a different longer recording even when all cues fit', async () => {
  const h = createHarness();
  const item = timedStory('A', { subtitleDurationSeconds: 20 });
  await h.playKidsStory(item);
  h.audio.metadata(20.5);
  assert.equal(h.APP.currentLyrics.length, 2, 'small container rounding differences remain usable');
  h.audio.duration = 26;
  h.audio.emit('durationchange');
  assert.equal(h.APP.currentLyrics.length, 0, 'longer audio may contain inserted material that invalidates timestamps');
  assert.match(h.element('lyricsBody').innerHTML, /字幕时间轴与音频不匹配/);
  assert.equal(item.subtitles[1].end, 12);
  assert.equal(item.subtitleDurationSeconds, 20);
  assert.equal(MediaTimeline.storyCues(item.subtitles, 20.5, 20).status, 'timed');
  assert.equal(MediaTimeline.storyCues(item.subtitles, 20.501, 20).status, 'invalid');
});

test('previewing another story subtitle track never highlights it using the playing story clock', async () => {
  const h = createHarness();
  await h.playKidsStory(timedStory('A'));
  h.audio.metadata(20);
  h.audio.at(9);
  assert.deepEqual(h.activeLines(), ['1']);
  h.showBilingualSubs(timedStory('B'));
  assert.deepEqual(h.activeLines(), []);
  h.audio.at(3);
  assert.deepEqual(h.activeLines(), []);
  assert.equal(h.audio.src, 'https://audio.example/A.mp3');
  assert.match(h.element('lyricsBody').innerHTML, /播放本故事后同步/);
});

test('untimed transcripts are escaped static text and do not fetch guessed subtitle URLs', async () => {
  const h = createHarness();
  await h.playKidsStory(story('A', { transcript: '<script>bad()</script>\nOnce upon a time.', sourceUrl: 'javascript:alert(1)' }));
  h.audio.metadata(20);
  h.audio.at(8);
  assert.equal(h.element('lyricsBody').querySelectorAll('.lyrics-line').length, 0);
  assert.match(h.element('lyricsBody').innerHTML, /故事原文（无时间轴）/);
  assert.match(h.element('lyricsBody').innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(h.element('lyricsBody').innerHTML, /href="javascript:/);
  assert.equal(h.requests.length, 0);
});

test('metadata updates preserve a subtitle panel the listener has closed', async () => {
  const h = createHarness();
  await h.playKidsStory(timedStory());
  h.element('lyricsClose').emit('click');
  assert.equal(h.element('lyricsPanel').classList.contains('show'), false);
  h.audio.metadata(20);
  assert.equal(h.element('lyricsPanel').classList.contains('show'), false);
  h.audio.duration = 21;
  h.audio.emit('durationchange');
  assert.equal(h.element('lyricsPanel').classList.contains('show'), false);
});

// ===== 音乐播放器主程序 =====

const APP = {
  BASE: window.location.protocol === 'file:' ? 'http://localhost:3000/api' : '/api',
  audio: new Audio(),
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  isPaused: false,
  playMode: 'sequence',
  currentLyrics: [],
  currentMedia: null,
  playbackRequest: 0,
  lyricsRequest: 0,
  lyricsOwner: null,
  activeLyricIndex: -1,
  subtitleStory: null,
  kidsStories: [],
  storyQueue: [],
  storyIndex: -1,
  storyDurations: new Map(),
  favorites: [],
  playlists: { '默认': [] },
  currentPlaylist: '默认',

  // ---- 初始化 ----
  async init() {
    this.loadFromStorage();
    this.audio.volume = 0.8;
    this.bindEvents();
    this.setupAudioListeners();
    this.renderPlaylists();
    await this.loadFavorites();
  },

  // ---- 事件绑定 ----
  bindEvents() {
    // 搜索
    document.getElementById('searchBtn').addEventListener('click', () => this.search());
    document.getElementById('searchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.search();
    });

    // 音源切换
    document.querySelectorAll('.source-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.source-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
    });

    // 导航
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-' + page).classList.add('active');

        // 少儿百科页面初始化
        if (page === 'kids') {
          initKidsPage();
        }
        // 儿童故事页面初始化
        if (page === 'kids-stories') {
          loadKidsStories();
        }
      });
    });

    // 播放控制
    document.getElementById('btnPlay').addEventListener('click', () => this.togglePlay());
    document.getElementById('btnPrev').addEventListener('click', () => this.prev());
    document.getElementById('btnNext').addEventListener('click', () => this.next());
    document.getElementById('btnLoop').addEventListener('click', () => this.cycleMode());
    document.getElementById('btnShuffle').addEventListener('click', () => this.cycleMode());

    // 进度条
    document.getElementById('progressBar').addEventListener('click', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const duration = this.mediaDuration();
      if (duration !== null) this.seekTo(pct * duration);
    });

    // 音量
    document.getElementById('volumeSlider').addEventListener('input', (e) => {
      this.audio.volume = e.target.value / 100;
    });

    // 收藏
    document.getElementById('btnFavPlayer').addEventListener('click', () => this.toggleCurrentFavorite());

    // 歌词
    document.getElementById('lyricsClose').addEventListener('click', () => {
      document.getElementById('lyricsPanel').classList.remove('show');
    });

    // 新建播放列表
    document.getElementById('btnNewPlaylist').addEventListener('click', () => this.newPlaylist());
  },

  setupAudioListeners() {
    ['timeupdate', 'seeking', 'seeked'].forEach(event => {
      this.audio.addEventListener(event, () => this.updatePlaybackPosition());
    });
    ['loadedmetadata', 'durationchange'].forEach(event => {
      this.audio.addEventListener(event, () => {
        const duration = this.mediaDuration();
        if (this.currentMedia?.kind === 'story' && duration !== null) {
          const story = this.currentMedia.story;
          story.durationSeconds = duration;
          this.storyDurations.set(story.url, duration);
          document.querySelectorAll('.story-duration').forEach(label => {
            if (label.dataset.storyUrl === story.url) label.textContent = this.formatTime(duration);
          });
          // Revalidate against the actual audio; never stretch cues to fit a recording.
          if (this.subtitleStory?.url === story.url) showBilingualSubs(story, { preserveVisibility: true });
        }
        this.updatePlaybackPosition();
      });
    });

    this.audio.addEventListener('ended', () => {
      if (!this.audioMatchesMedia()) return;
      this.isPlaying = false;
      this.isPaused = true;
      this.updatePlayBtn();
      this.updatePlaybackPosition();
      if (this.playMode === 'single') {
        this.seekTo(0);
        this.resumePlayback();
      } else {
        this.next();
      }
    });

    this.audio.addEventListener('play', () => {
      if (!this.audioMatchesMedia()) return;
      this.isPlaying = true;
      this.isPaused = false;
      this.updatePlayBtn();
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.isPaused = true;
      this.updatePlayBtn();
    });
  },

  songKey(song) {
    return `song:${song.source}:${song.id || song.hash}`;
  },

  beginMedia(media) {
    const request = ++this.playbackRequest;
    this.audio.pause();
    this.currentMedia = media;
    this.audio.removeAttribute('src');
    this.audio.load();
    this.isPlaying = false;
    this.isPaused = true;
    this.clearLyrics();
    document.getElementById('lyricsTitle').textContent = '字幕 / 歌词';
    document.getElementById('lyricsBody').innerHTML = '';
    document.getElementById('songCover').textContent = media.kind === 'story' ? '📚' : '🎵';
    document.getElementById('btnFavPlayer').disabled = media.kind === 'story';
    this.updatePlayBtn();
    this.updatePlaybackPosition();
    return request;
  },

  clearLyrics() {
    ++this.lyricsRequest;
    this.currentLyrics = [];
    this.lyricsOwner = null;
    this.activeLyricIndex = -1;
    this.subtitleStory = null;
  },

  audioMatchesMedia() {
    if (!this.currentMedia?.url) return false;
    try {
      return new URL(this.audio.currentSrc || this.audio.src, document.baseURI).href ===
        new URL(this.currentMedia.url, document.baseURI).href;
    } catch (e) { return false; }
  },

  mediaDuration() {
    return this.audioMatchesMedia() ? MediaTimeline.duration(this.audio.duration) : null;
  },

  updatePlaybackPosition() {
    const currentTime = this.audioMatchesMedia() && Number.isFinite(this.audio.currentTime)
      ? Math.max(0, this.audio.currentTime) : 0;
    const duration = this.mediaDuration() ?? (this.currentMedia?.kind === 'story'
      ? MediaTimeline.duration(this.currentMedia.story.durationSeconds) : null);
    const pct = duration === null ? 0 : Math.max(0, Math.min(100, currentTime / duration * 100));
    document.getElementById('progressFill').style.width = `${pct}%`;
    document.getElementById('currentTime').textContent = this.formatTime(currentTime);
    document.getElementById('duration').textContent = duration === null ? '--:--'
      : `${this.mediaDuration() === null && this.currentMedia?.kind === 'story' ? '约 ' : ''}${this.formatTime(duration)}`;
    this.syncLyrics(currentTime);
  },

  seekTo(seconds) {
    const duration = this.mediaDuration();
    if (duration === null || !Number.isFinite(seconds)) return;
    this.audio.currentTime = Math.max(0, Math.min(duration, seconds));
    this.updatePlaybackPosition();
  },

  resumePlayback() {
    const request = this.playbackRequest;
    return this.audio.play().catch(() => {
      if (request === this.playbackRequest) this.showToast('播放失败，请重试');
    });
  },

  // ---- 搜索 ----
  async search() {
    const keyword = document.getElementById('searchInput').value.trim();
    if (!keyword) return;

    const container = document.getElementById('searchResults');
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>搜索中...</p></div>';

    // 获取选中的音源
    const activeTab = document.querySelector('.source-tab.active');
    const source = activeTab ? activeTab.dataset.source : 'all';

    let allSongs = [];

    if (source === 'all' || source === 'netease') {
      const songs = await this.fetchNetease(keyword);
      allSongs = allSongs.concat(songs);
    }
    if (source === 'all' || source === 'migu') {
      const songs = await this.fetchMigu(keyword);
      allSongs = allSongs.concat(songs);
    }
    if (source === 'all' || source === 'kugou') {
      const songs = await this.fetchKugou(keyword);
      allSongs = allSongs.concat(songs);
    }

    // 去重
    const map = new Map();
    for (const s of allSongs) {
      const key = s.source + '_' + s.id;
      if (!map.has(key)) map.set(key, s);
    }
    allSongs = Array.from(map.values());

    this.renderSongs(allSongs, keyword);
  },

  async fetchNetease(keyword) {
    try {
      const resp = await fetch(`${this.BASE}/netease/search?keyword=${encodeURIComponent(keyword)}&limit=15`);
      const data = await resp.json();
      const songs = data.result?.songs || [];
      return songs.map(s => ({
        id: s.id,
        name: s.name,
        artists: s.artists?.map(a => a.name).join(', ') || '',
        album: s.album?.name || '',
        duration: s.duration,
        source: 'netease',
        sourceLabel: '网易云',
      }));
    } catch (e) {
      console.error('Netease search error:', e);
      return [];
    }
  },

  async fetchMigu(keyword) {
    try {
      const resp = await fetch(`${this.BASE}/migu/search?keyword=${encodeURIComponent(keyword)}&pageSize=15`);
      const data = await resp.json();
      const musics = data.musics || [];
      return musics.map(m => ({
        id: m.cmid || m.songId,
        name: m.songName || m.title || '',
        artists: m.singer || m.artist || '',
        album: m.albumName || '',
        duration: (m.interval || m.duration || 0) * 1000,
        source: 'migu',
        sourceLabel: '咪咕',
      }));
    } catch (e) {
      console.error('Migu search error:', e);
      return [];
    }
  },

  async fetchKugou(keyword) {
    try {
      const resp = await fetch(`${this.BASE}/kugou/search?keyword=${encodeURIComponent(keyword)}&pageSize=15`);
      const data = await resp.json();
      const songs = data.data?.list || [];
      return songs.map(s => ({
        id: s.hash || '',
        name: s.songname || '',
        artists: s.singername || '',
        album: s.album_name || '',
        duration: (s.duration || 0) * 1000,
        source: 'kugou',
        sourceLabel: '酷狗',
        hash: s.hash,
      }));
    } catch (e) {
      console.error('Kugou search error:', e);
      return [];
    }
  },

  renderSongs(songs, keyword) {
    const container = document.getElementById('searchResults');
    if (!songs.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">😔</div><p>未找到 "${keyword}" 的相关结果</p></div>`;
      return;
    }

    let html = '<div class="song-list">';
    songs.forEach((s, i) => {
      const dur = this.formatTime(s.duration / 1000);
      const isFav = this.favorites.some(f => f.source === s.source && f.id === s.id);
      html += `
        <div class="song-item" data-index="${i}">
          <span class="song-index">${i + 1}</span>
          <div class="song-cover-sm">🎵</div>
          <div class="song-info">
            <div class="song-name">${this.esc(s.name)}<span class="song-source">[${s.sourceLabel}]</span></div>
            <div class="song-artist">${this.esc(s.artists) || '未知歌手'}</div>
          </div>
          <span class="song-duration">${dur}</span>
          <div class="song-actions">
            <button class="btn-play" data-i="${i}" title="播放">▶</button>
            <button class="btn-dl" data-i="${i}" title="下载">💾</button>
            <button class="btn-lyric" data-i="${i}" title="歌词">📝</button>
            <button class="btn-fav" data-i="${i}" data-key="${s.source}_${s.id}" title="收藏" ${isFav ? 'class="faved"' : ''}>${isFav ? '❤' : '♡'}</button>
          </div>
        </div>`;
    });
    html += '</div>';
    container.innerHTML = html;

    // 绑定播放
    container.querySelectorAll('.btn-play').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.playSong(songs[parseInt(btn.dataset.i)], songs);
      });
    });

    // 绑定下载
    container.querySelectorAll('.btn-dl').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.downloadSong(songs[parseInt(btn.dataset.i)]);
      });
    });

    // 绑定歌词
    container.querySelectorAll('.btn-lyric').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.fetchAndShowLyrics(songs[parseInt(btn.dataset.i)]);
      });
    });

    // 绑定收藏
    container.querySelectorAll('.btn-fav').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.i);
        const song = songs[idx];
        const key = btn.dataset.key;
        const favIdx = this.favorites.findIndex(f => f.key === key);
        if (favIdx >= 0) {
          this.favorites.splice(favIdx, 1);
          btn.textContent = '♡';
          btn.classList.remove('faved');
        } else {
          this.favorites.push({ key, ...song });
          btn.textContent = '❤';
          btn.classList.add('faved');
        }
        this.saveToFavorites();
      });
    });

    // 点击整行播放
    container.querySelectorAll('.song-item').forEach((item, i) => {
      item.addEventListener('click', () => this.playSong(songs[i], songs));
    });
  },

  // ---- 播放 ----
  async playSong(song, playlist) {
    if (playlist) this.playlist = playlist;
    const idx = this.playlist.findIndex(s => s.source === song.source && s.id === song.id);
    if (idx === -1) return;
    this.currentIndex = idx;
    this.storyIndex = -1;
    const request = this.beginMedia({ kind: 'song', key: this.songKey(song), song });
    document.getElementById('songTitle').textContent = song.name;
    document.getElementById('songArtist').textContent = song.artists || '-';

    // 获取播放URL
    let url = await this.getPlayUrl(song);
    if (request !== this.playbackRequest) return;
    if (!url) {
      // 降级：尝试其他音源
      if (song.source !== 'migu') {
        song.source = 'migu';
        song.sourceLabel = '咪咕';
        url = await this.getPlayUrl(song);
        if (request !== this.playbackRequest) return;
      }
    }

    if (!url) {
      this.showToast('该歌曲暂无播放权限');
      return;
    }

    this.currentMedia.key = this.songKey(song);
    this.currentMedia.url = url;
    this.audio.src = url;
    this.resumePlayback();

    // 更新UI
    document.getElementById('songTitle').textContent = song.name;
    document.getElementById('songArtist').textContent = song.artists || '-';
    this.highlightPlaying(idx);
    this.updatePlayBtn();

    // 加载歌词
    this.fetchAndShowLyrics(song);
  },

  async getPlayUrl(song) {
    try {
      if (song.source === 'netease') {
        const resp = await fetch(`${this.BASE}/netease/url?id=${song.id}`);
        const data = await resp.json();
        return data.data?.[0]?.url || null;
      }
      if (song.source === 'migu') {
        // 咪咕直接返回播放地址
        const resp = await fetch(`${this.BASE}/migu/url?id=${song.id}`);
        const data = await resp.json();
        return data.urls?.[0] || null;
      }
      if (song.source === 'kugou') {
        const resp = await fetch(`${this.BASE}/kugou/url?hash=${song.hash || song.id}`);
        const data = await resp.json();
        return data.data?.playUrl || null;
      }
    } catch (e) {
      console.error('Get play URL error:', e);
    }
    return null;
  },

  togglePlay() {
    if (!this.currentMedia?.url) return;
    if (this.audio.paused) this.resumePlayback();
    else this.audio.pause();
  },

  prev() {
    if (this.currentMedia?.kind === 'story') {
      if (this.audio.currentTime > 3) { this.seekTo(0); return; }
      if (!this.storyQueue.length) return;
      const idx = this.playMode === 'random'
        ? Math.floor(Math.random() * this.storyQueue.length)
        : (this.storyIndex - 1 + this.storyQueue.length) % this.storyQueue.length;
      playKidsStory(this.storyQueue[idx], this.storyQueue);
      return;
    }
    if (this.playlist.length === 0) return;
    if (this.audio.currentTime > 3) { this.seekTo(0); return; }
    const idx = this.playMode === 'random'
      ? Math.floor(Math.random() * this.playlist.length)
      : (this.currentIndex - 1 + this.playlist.length) % this.playlist.length;
    this.playSong(this.playlist[idx], this.playlist);
  },

  next() {
    if (this.currentMedia?.kind === 'story') {
      if (!this.storyQueue.length) return;
      const idx = this.playMode === 'random'
        ? Math.floor(Math.random() * this.storyQueue.length)
        : (this.storyIndex + 1) % this.storyQueue.length;
      playKidsStory(this.storyQueue[idx], this.storyQueue);
      return;
    }
    if (this.playlist.length === 0) return;
    const idx = this.playMode === 'random'
      ? Math.floor(Math.random() * this.playlist.length)
      : (this.currentIndex + 1) % this.playlist.length;
    this.playSong(this.playlist[idx], this.playlist);
  },

  cycleMode() {
    const modes = ['sequence', 'random', 'single'];
    const idx = modes.indexOf(this.playMode);
    this.playMode = modes[(idx + 1) % modes.length];
    const labels = { sequence: '🔁', random: '🔀', single: '🔂' };
    document.getElementById('btnLoop').textContent = labels[this.playMode] || '🔁';
  },

  updatePlayBtn() {
    document.getElementById('btnPlay').textContent = this.isPlaying && !this.isPaused ? '⏸' : '▶';
  },

  // ---- 歌词 ----
  async fetchAndShowLyrics(song) {
    this.clearLyrics();
    const request = this.lyricsRequest;
    const owner = this.songKey(song);
    document.getElementById('lyricsTitle').textContent = song.name || '歌词';
    document.getElementById('lyricsBody').innerHTML = '<div class="empty-state"><p>正在加载歌词...</p></div>';
    document.getElementById('lyricsPanel').classList.add('show');
    try {
      let resp;
      if (song.source === 'netease') {
        resp = await fetch(`${this.BASE}/netease/lyric?id=${song.id}`);
      } else if (song.source === 'migu') {
        resp = await fetch(`${this.BASE}/migu/lyric?id=${song.id}`);
      } else if (song.source === 'kugou') {
        resp = await fetch(`${this.BASE}/kugou/lyric?hash=${song.hash || song.id}`);
      }

      if (resp) {
        const data = await resp.json();
        if (request !== this.lyricsRequest) return;
        let lrc = '';
        if (song.source === 'netease') lrc = data.lrc?.lyric || '';
        else if (song.source === 'migu') lrc = data.lyric || '';
        else if (song.source === 'kugou') lrc = data.lyric || '';

        this.showLyrics(this.parseLRC(lrc), song.name, owner);
      } else if (request === this.lyricsRequest) {
        this.showLyrics([], song.name, owner);
      }
    } catch (e) {
      if (request === this.lyricsRequest) this.showLyrics([], song.name, owner);
    }
  },

  showLyrics(lines, title, owner = null) {
    this.currentLyrics = lines;
    this.lyricsOwner = owner;
    this.activeLyricIndex = -1;
    const panel = document.getElementById('lyricsPanel');
    const body = document.getElementById('lyricsBody');
    document.getElementById('lyricsTitle').textContent = title || '歌词';

    if (!lines.length) {
      body.innerHTML = '<div class="empty-state"><p>暂无歌词</p></div>';
      panel.classList.add('show');
      return;
    }

    let html = '';
    lines.forEach((l, i) => {
      html += `<div class="lyrics-line" data-idx="${i}">${this.esc(l.text)}</div>`;
    });
    body.innerHTML = html;
    panel.classList.add('show');
    this.syncLyrics(this.audio.currentTime);
  },

  syncLyrics(currentTime) {
    const body = document.getElementById('lyricsBody');
    const lines = body.querySelectorAll('.lyrics-line');
    const activeIdx = this.lyricsOwner && this.lyricsOwner === this.currentMedia?.key && this.audioMatchesMedia()
      ? MediaTimeline.activeCue(this.currentLyrics, currentTime, this.mediaDuration()) : -1;
    lines.forEach((l, i) => l.classList.toggle('active', i === activeIdx));
    if (activeIdx !== this.activeLyricIndex && activeIdx >= 0 &&
        document.getElementById('lyricsPanel').classList.contains('show')) {
      lines[activeIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    this.activeLyricIndex = activeIdx;
  },

  parseLRC(lrc) {
    if (!lrc) return [];
    const lines = lrc.trim().split('\n');
    const result = [];
    const pattern = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/;
    for (const line of lines) {
      const m = pattern.exec(line);
      if (m) {
        const mins = parseInt(m[1]);
        const secs = parseInt(m[2]);
        let ms = parseInt(m[3] || '0');
        if (m[3] && m[3].length === 2) ms *= 10;
        result.push({ time: mins * 60 + secs + ms / 1000, text: line.substring(m[0].length).trim() });
      }
    }
    return result.sort((a, b) => a.time - b.time);
  },

  // ---- 下载 ----
  async downloadSong(song) {
    this.showToast(`正在获取下载地址: ${song.name}`);
    const url = await this.getPlayUrl(song);
    if (!url) {
      this.showToast('下载失败: 无法获取播放地址');
      return;
    }
    try {
      const resp = await fetch(url, { headers: { 'Referer': 'https://music.163.com/' } });
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${song.name}.mp3`;
      a.click();
      URL.revokeObjectURL(a.href);
      this.showToast('下载完成 ✓');
    } catch (e) {
      this.showToast('下载失败');
    }
  },

  // ---- 收藏 ----
  async loadFavorites() {
    try {
      const resp = await fetch(`${this.BASE}/favorites`);
      this.favorites = await resp.json();
    } catch (e) {
      this.favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
    }
  },

  saveToFavorites() {
    localStorage.setItem('favorites', JSON.stringify(this.favorites));
  },

  toggleCurrentFavorite() {
    if (this.currentMedia?.kind === 'story') return;
    if (this.currentIndex < 0 || !this.playlist[this.currentIndex]) return;
    const song = this.playlist[this.currentIndex];
    const key = song.source + '_' + song.id;
    const btn = document.getElementById('btnFavPlayer');
    const idx = this.favorites.findIndex(f => f.key === key);
    if (idx >= 0) {
      this.favorites.splice(idx, 1);
      btn.classList.remove('active');
      btn.textContent = '♡';
    } else {
      this.favorites.push({ key, ...song });
      btn.classList.add('active');
      btn.textContent = '❤';
    }
    this.saveToFavorites();
  },

  // ---- 播放列表 ----
  newPlaylist() {
    const name = prompt('播放列表名称:');
    if (!name) return;
    this.playlists[name] = [];
    this.renderPlaylists();
    this.savePlaylists();
  },

  renderPlaylists() {
    const sel = document.getElementById('playlistSelect');
    sel.innerHTML = '';
    for (const name of Object.keys(this.playlists)) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === this.currentPlaylist) opt.selected = true;
      sel.appendChild(opt);
    }
  },

  savePlaylists() {
    localStorage.setItem('playlists', JSON.stringify(this.playlists));
  },

  loadFromStorage() {
    try {
      this.favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
      this.playlists = JSON.parse(localStorage.getItem('playlists') || '{"默认":[]}');
      this.currentPlaylist = '默认';
    } catch (e) {}
  },

  // ---- 工具 ----
  highlightPlaying(idx) {
    document.querySelectorAll('.song-item').forEach((item, i) => {
      item.classList.toggle('playing', i === idx);
    });
  },

  formatTime(seconds) {
    return MediaTimeline.formatTime(seconds);
  },

  esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  },
};

// 启动
document.addEventListener('DOMContentLoaded', () => APP.init());

// ===== 少儿百科功能 =====
function initKidsPage() {
  // 分类按钮
  document.querySelectorAll('.kids-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.kids-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.cat;
      const keywords = {
        all: '儿歌 故事 科普',
        song: '儿歌 宝宝巴士 小星星 两只老虎',
        story: '睡前故事 童话故事 寓言故事',
        science: '十万个为什么 科学实验 恐龙',
        cartoon: '黑猫警长 葫芦娃 舒克贝塔 大闹天宫',
        bedtime: '睡前故事 晚安故事 摇篮曲',
        english: 'ABC字母歌 英语儿歌 Hello Song',
      };
      searchKids(keywords[cat] || '儿歌');
    });
  });

  // 快捷标签
  document.querySelectorAll('.kid-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const q = tag.dataset.q;
      document.getElementById('kidsSearchInput').value = q;
      searchKids(q);
    });
  });

  // 搜索按钮
  document.getElementById('kidsSearchBtn').addEventListener('click', () => {
    const q = document.getElementById('kidsSearchInput').value.trim();
    if (q) searchKids(q);
  });

  // 回车搜索
  document.getElementById('kidsSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = e.target.value.trim();
      if (q) searchKids(q);
    }
  });
}

async function searchKids(keyword) {
  const container = document.getElementById('kidsResults');
  container.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>搜索中...</p></div>';

  try {
    const resp = await fetch(`${APP.BASE}/kids/search?keyword=${encodeURIComponent(keyword)}`);
    const songs = await resp.json();

    if (!songs.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🤔</div><p>未找到 "${keyword}" 的内容<br>试试其他关键词吧！</p></div>`;
      return;
    }

    let html = '<div class="song-list">';
    songs.forEach((s, i) => {
      const isKids = s._isKids;
      const dur = s.duration > 0 ? APP.formatTime(s.duration / 1000) : '专辑';
      const icon = isKids ? (s.icon || '🎈') : '🎵';
      const grad = isKids ? 'background:linear-gradient(135deg,#FF6B81,#FFB347)' : '';

      html += `
        <div class="song-item" data-index="${i}">
          <span class="song-index">${i + 1}</span>
          <div class="song-cover-sm" style="${grad}">${icon}</div>
          <div class="song-info">
            <div class="song-name">${APP.esc(s.name)}${isKids ? '<span class="song-source">[喜马拉雅]</span>' : ''}</div>
            <div class="song-artist">${APP.esc(s.artists) || '未知'}</div>
          </div>
          <span class="song-duration">${dur}</span>
          <div class="song-actions">
            <button class="btn-play" data-i="${i}" title="播放">▶</button>
            ${s.duration > 0 ? '<button class="btn-lyric" data-i="' + i + '" title="歌词">📝</button>' : ''}
          </div>
        </div>`;
    });
    html += '</div>';
    container.innerHTML = html;

    // 绑定播放
    container.querySelectorAll('.btn-play').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.i);
        playKidsSong(songs[idx]);
      });
    });

    // 绑定歌词
    container.querySelectorAll('.btn-lyric').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.i);
        fetchKidsLyric(songs[idx]);
      });
    });

    // 点击整行播放
    container.querySelectorAll('.song-item').forEach((item, i) => {
      item.addEventListener('click', () => playKidsSong(songs[i]));
    });

  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>搜索失败，请稍后再试</p></div>';
  }
}

async function playKidsSong(song) {
  // 如果是喜马拉雅预置专辑，用网易云搜索同名歌曲来播放
  if (song.source === 'kids_album') {
    const request = APP.beginMedia({ kind: 'song', key: APP.songKey(song), song });
    APP.currentIndex = -1;
    APP.playlist = [];
    APP.storyIndex = -1;
    document.getElementById('songTitle').textContent = song.name || '';
    document.getElementById('songArtist').textContent = song.artists || '未知歌手';
    try {
      const resp = await fetch(`${APP.BASE}/netease/search?keyword=${encodeURIComponent(song.name)}&limit=5`);
      const data = await resp.json();
      if (request !== APP.playbackRequest) return;
      const songs = data.result?.songs || [];
      if (songs.length > 0) {
        const alt = songs[0];
        const track = { ...alt, source: 'netease',
          artists: Array.isArray(alt.artists) ? alt.artists.map(a => a.name).join(', ') : alt.artists };
        return APP.playSong(track, [track]);
      }
    } catch (e) {
      if (request !== APP.playbackRequest) return;
    }
    APP.showToast('该专辑暂无播放资源');
    return;
  }
  return APP.playSong(song, [song]);
}

async function fetchKidsLyric(song) {
  return APP.fetchAndShowLyrics(song);
}

// ===== 免费儿童故事功能 =====
async function loadKidsStories() {
  const container = document.getElementById('kidsStoriesResults');
  container.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>加载中...</p></div>';

  try {
    const resp = await fetch(`${APP.BASE}/kids-stories`);
    if (!resp.ok) throw new Error('Story request failed');
    const data = await resp.json();
    const stories = Array.isArray(data) ? data : [];
    APP.kidsStories = stories;

    if (!stories.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">😔</div><p>加载失败，请稍后再试</p></div>';
      return;
    }

    let html = '<div class="song-list">';
    stories.forEach((s, i) => {
      // The old `duration` field contained bytes. Only explicit seconds are usable.
      const duration = APP.storyDurations.get(s.url) ?? MediaTimeline.duration(s.durationSeconds);
      s.durationSeconds = duration;
      const durationLabel = duration === null ? '时长待载入'
        : `${APP.storyDurations.has(s.url) ? '' : '约 '}${APP.formatTime(duration)}`;
      html += `
        <div class="song-item" data-index="${i}">
          <span class="song-index">${i + 1}</span>
          <div class="song-cover-sm" style="background:linear-gradient(135deg,#4ECDC4,#45B7D1)">📚</div>
          <div class="song-info">
            <div class="song-name">${APP.esc(s.title)}</div>
            <div class="song-artist story-duration" data-story-url="${APP.esc(s.url)}">${durationLabel}</div>
          </div>
          <div class="song-actions">
            <button class="btn-play" data-i="${i}" title="播放">▶</button>
            <button class="btn-dl" data-i="${i}" title="下载">💾</button>
            <button class="btn-sub" data-i="${i}" title="字幕与原文">🌐</button>
          </div>
        </div>`;
    });
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.btn-play').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.i);
        playKidsStory(stories[idx]);
      });
    });

    container.querySelectorAll('.btn-dl').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.i);
        downloadKidsStory(stories[idx]);
      });
    });

    container.querySelectorAll('.btn-sub').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.i);
        showBilingualSubs(stories[idx]);
      });
    });

    container.querySelectorAll('.song-item').forEach((item, i) => {
      item.addEventListener('click', () => playKidsStory(stories[i]));
    });
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><p>加载失败</p></div>';
  }
}

async function playKidsStory(story, queue = APP.kidsStories) {
  if (!story?.url) return;
  const index = queue.findIndex(item => item.url === story.url);
  APP.storyQueue = index >= 0 ? queue : [story];
  APP.storyIndex = index >= 0 ? index : 0;
  APP.currentIndex = -1;
  if (APP.storyDurations.has(story.url)) story.durationSeconds = APP.storyDurations.get(story.url);
  APP.beginMedia({ kind: 'story', key: `story:${story.url}`, story });
  document.getElementById('songTitle').textContent = story.title;
  document.getElementById('songArtist').textContent = '📚 儿童故事';
  APP.showToast(`📚 正在播放: ${story.title}`);

  try {
    APP.currentMedia.url = story.url;
    APP.audio.src = story.url;
    APP.resumePlayback();
    showBilingualSubs(story);
  } catch (e) {
    APP.showToast('播放失败');
  }
}

async function downloadKidsStory(story) {
  APP.showToast(`正在下载: ${story.title}`);
  try {
    const resp = await fetch(story.url, { mode: 'cors' });
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${story.title}.mp3`;
    a.click();
    URL.revokeObjectURL(a.href);
    APP.showToast('下载完成 ✓');
  } catch (e) {
    APP.showToast('下载失败，请重试');
  }
}

// A transcript is not a timed subtitle track. Only supplied, validated cues sync.
function showBilingualSubs(story, { preserveVisibility = false } = {}) {
  const panel = document.getElementById('lyricsPanel');
  const body = document.getElementById('lyricsBody');
  const wasOpen = panel.classList.contains('show');
  APP.clearLyrics();
  APP.subtitleStory = story;
  document.getElementById('lyricsTitle').textContent = `📖 ${story.title}`;
  panel.classList.toggle('show', !preserveVisibility || wasOpen);
  const owner = `story:${story.url}`;
  const actualDuration = APP.currentMedia?.key === owner ? APP.mediaDuration() : null;
  const result = MediaTimeline.storyCues(story.subtitles, actualDuration, story.subtitleDurationSeconds);
  let sourceUrl = 'https://www.storynory.com/';
  try {
    const url = new URL(story.sourceUrl);
    if (url.protocol === 'https:' || url.protocol === 'http:') sourceUrl = url.href;
  } catch (e) { /* Cached stories may not include a source page. */ }

  if (result.status === 'timed') {
    APP.currentLyrics = result.cues;
    APP.lyricsOwner = owner;
    const label = result.cues.every(cue => cue.translation) ? '双语同步字幕' : '同步字幕';
    body.innerHTML = `<p class="subtitle-status">${label}${APP.currentMedia?.key !== owner ? ' · 播放本故事后同步' : ''}</p>` +
      result.cues.map((cue, i) => `<div class="lyrics-line" data-idx="${i}">${APP.esc(cue.text)}${cue.translation
        ? `<span class="subtitle-translation">${APP.esc(cue.translation)}</span>` : ''}</div>`).join('');
    APP.syncLyrics(APP.audio.currentTime);
  } else {
    const invalid = result.status === 'invalid';
    const transcript = typeof story.transcript === 'string' ? story.transcript.trim() : '';
    body.innerHTML = `<div class="story-notes">
      <p class="subtitle-status">${invalid ? '字幕时间轴与音频不匹配' : '暂无同步字幕'}</p>
      <p>${invalid ? '这份字幕的时间范围无效，已停止同步。' : '故事来源未提供带时间戳的字幕，暂不逐句高亮。'}</p>
      ${transcript ? `<h3>故事原文（无时间轴）</h3><div class="story-transcript">${APP.esc(transcript)}</div>`
        : `<h3>故事简介</h3><p>${APP.esc(story.description || '暂无简介')}</p>`}
      <a href="${APP.esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">查看 Storynory 故事来源</a>
    </div>`;
  }
}

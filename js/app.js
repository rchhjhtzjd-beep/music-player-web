// ===== 音乐播放器主程序 =====

const APP = {
  BASE: 'http://localhost:3000/api',
  audio: new Audio(),
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  isPaused: false,
  playMode: 'sequence',
  currentLyrics: [],
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
      const pct = (e.clientX - rect.left) / rect.width;
      if (this.audio.duration) this.audio.currentTime = pct * this.audio.duration;
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
    this.audio.addEventListener('timeupdate', () => {
      const cur = this.audio.currentTime;
      const dur = this.audio.duration || 0;
      const pct = dur ? (cur / dur) * 100 : 0;
      document.getElementById('progressFill').style.width = pct + '%';
      document.getElementById('currentTime').textContent = this.formatTime(cur);
      document.getElementById('duration').textContent = this.formatTime(dur);
      this.syncLyrics(cur);
    });

    this.audio.addEventListener('ended', () => {
      if (this.playMode === 'single') {
        this.audio.currentTime = 0;
        this.audio.play();
      } else {
        this.next();
      }
    });

    this.audio.addEventListener('play', () => {
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

    // 获取播放URL
    let url = await this.getPlayUrl(song);
    if (!url) {
      // 降级：尝试其他音源
      if (song.source !== 'migu') {
        song.source = 'migu';
        song.sourceLabel = '咪咕';
        url = await this.getPlayUrl(song);
      }
    }

    if (!url) {
      this.showToast('该歌曲暂无播放权限');
      return;
    }

    this.audio.src = url;
    this.audio.play().catch(() => this.showToast('播放失败'));

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
    if (this.currentIndex < 0) return;
    if (this.isPaused) this.audio.play();
    else this.audio.pause();
  },

  prev() {
    if (this.playlist.length === 0) return;
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    const idx = this.playMode === 'random'
      ? Math.floor(Math.random() * this.playlist.length)
      : (this.currentIndex - 1 + this.playlist.length) % this.playlist.length;
    this.playSong(this.playlist[idx], this.playlist);
  },

  next() {
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
        let lrc = '';
        if (song.source === 'netease') lrc = data.lrc?.lyric || '';
        else if (song.source === 'migu') lrc = data.lyric || '';
        else if (song.source === 'kugou') lrc = data.lyric || '';

        if (lrc) {
          this.currentLyrics = this.parseLRC(lrc);
          this.showLyrics(this.currentLyrics, song.name);
        }
      }
    } catch (e) {
      console.error('Lyrics error:', e);
    }
  },

  showLyrics(lines, title) {
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
  },

  syncLyrics(currentTime) {
    if (!this.currentLyrics.length) return;
    const lines = document.querySelectorAll('.lyrics-line');
    let activeIdx = 0;
    for (let i = this.currentLyrics.length - 1; i >= 0; i--) {
      if (currentTime >= this.currentLyrics[i].time) { activeIdx = i; break; }
    }
    lines.forEach((l, i) => l.classList.toggle('active', i === activeIdx));
    const active = document.querySelector('.lyrics-line.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    return result;
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
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  },

  esc(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
      if (cat === 'all') {
        searchKids('少儿百科');
      } else {
        const keywords = { science: '科学', career: '职业', nature: '自然', story: '故事', song: '儿歌' };
        searchKids(keywords[cat] || '少儿');
      }
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
  const title = song.name || '';
  const artistNames = song.artists || '未知歌手';
  document.getElementById('songTitle').textContent = title;
  document.getElementById('songArtist').textContent = artistNames;
  APP.showToast(`🎈 正在播放: ${title}`);

  // 如果是喜马拉雅预置专辑，用网易云搜索同名歌曲来播放
  if (song.source === 'kids_album') {
    try {
      const resp = await fetch(`${APP.BASE}/netease/search?keyword=${encodeURIComponent(song.name)}&limit=5`);
      const data = await resp.json();
      const songs = data.result?.songs || [];
      if (songs.length > 0) {
        const alt = songs[0];
        const resp2 = await fetch(`${APP.BASE}/netease/url?id=${alt.id}`);
        const data2 = await resp2.json();
        const url = data2.data?.[0]?.url;
        if (url) {
          APP.audio.src = url;
          APP.audio.play().catch(() => APP.showToast('播放失败'));
          return;
        }
      }
    } catch (e) {
      console.error('Kids album fallback:', e);
    }
    APP.showToast('该专辑暂无播放资源');
    return;
  }

  // 网易云歌曲
  try {
    const resp = await fetch(`${APP.BASE}/netease/url?id=${song.id}`);
    const data = await resp.json();
    const url = data.data?.[0]?.url;
    if (url) {
      APP.audio.src = url;
      APP.audio.play().catch(() => APP.showToast('播放失败'));
    } else {
      APP.showToast('该歌曲暂无播放权限');
    }
  } catch (e) {
    APP.showToast('播放失败');
  }
}

async function fetchKidsLyric(song) {
  try {
    const resp = await fetch(`${APP.BASE}/netease/lyric?id=${song.id}`);
    const data = await resp.json();
    const lrc = data.lrc?.lyric || '';
    if (lrc) {
      const lines = APP.parseLRC(lrc);
      APP.showLyrics(lines, `📝 ${song.name || ''}`);
    } else {
      APP.showToast('暂无歌词');
    }
  } catch (e) {
    APP.showToast('歌词加载失败');
  }
}

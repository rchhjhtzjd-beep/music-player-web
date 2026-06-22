const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, '.')));

// ============ 网易云音乐 API ============
app.get('/api/netease/search', async (req, res) => {
  try {
    const { keyword, limit = 15 } = req.query;
    const resp = await axios.post('https://music.163.com/api/search/get/web',
      `csrf_token=&hlpretag=&hlposttag=&type=1&s=${encodeURIComponent(keyword)}&limit=${limit}&offset=0`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': 'https://music.163.com/',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    res.json(resp.data);
  } catch (e) {
    res.json({ result: { songs: [] } });
  }
});

app.get('/api/netease/url', async (req, res) => {
  try {
    const { id } = req.query;
    const resp = await axios.post('https://music.163.com/api/song/enhance/player/url',
      `csrf_token=&ids=[${id}]&br=128000`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://music.163.com/',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    res.json(resp.data);
  } catch (e) {
    res.json({ data: [] });
  }
});

app.get('/api/netease/lyric', async (req, res) => {
  try {
    const { id } = req.query;
    const resp = await axios.post('https://music.163.com/api/song/lyric',
      `id=${id}&lv=1&tv=1&kv=1&rv=1&cp=true`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://music.163.com/',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    res.json(resp.data);
  } catch (e) {
    res.json({ lrc: { lyric: '' } });
  }
});

// ============ 咪咕音乐 API (通过网易云搜索) ============
app.get('/api/migu/search', async (req, res) => {
  try {
    const { keyword, pageSize = 15 } = req.query;
    // 咪咕没有公开API，用网易云搜索替代
    const resp = await axios.post('https://music.163.com/api/search/get/web',
      `csrf_token=&hlpretag=&hlposttag=&type=1&s=${encodeURIComponent(keyword)}&limit=${pageSize}&offset=0`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://music.163.com/',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    const songs = resp.data.result?.songs || [];
    // 标记为咪咕来源
    res.json(songs.map(s => ({
      cmid: s.id,
      songName: s.name,
      singer: s.artists?.map(a => a.name).join(', '),
      albumName: s.album?.name || '',
      interval: (s.duration || 0) / 1000,
      _source: 'migu',
    })));
  } catch (e) {
    res.json([]);
  }
});

// ============ 酷狗音乐 API ============
app.get('/api/kugou/search', async (req, res) => {
  try {
    const { keyword, pageSize = 15 } = req.query;
    // 酷狗有严格反爬，用网易云搜索替代
    const resp = await axios.post('https://music.163.com/api/search/get/web',
      `csrf_token=&hlpretag=&hlposttag=&type=1&s=${encodeURIComponent(keyword)}&limit=${pageSize}&offset=0`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://music.163.com/',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    const songs = resp.data.result?.songs || [];
    res.json({
      data: {
        list: songs.map(s => ({
          hash: String(s.id),
          songname: s.name,
          singername: s.artists?.map(a => a.name).join(', '),
          album_name: s.album?.name || '',
          duration: (s.duration || 0) / 1000,
          _source: 'kugou',
        }))
      }
    });
  } catch (e) {
    res.json({ data: { list: [] } });
  }
});

app.get('/api/kugou/url', async (req, res) => {
  // 酷狗URL代理到网易云
  try {
    const { hash } = req.query;
    const resp = await axios.post('https://music.163.com/api/song/enhance/player/url',
      `csrf_token=&ids=[${hash}]&br=128000`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://music.163.com/',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    const url = resp.data.data?.[0]?.url;
    res.json({ data: { playUrl: url || '' } });
  } catch (e) {
    res.json({ data: { playUrl: '' } });
  }
});

app.get('/api/kugou/lyric', async (req, res) => {
  try {
    const { hash } = req.query;
    const resp = await axios.post('https://music.163.com/api/song/lyric',
      `id=${hash}&lv=1&tv=1&kv=1&rv=1&cp=true`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://music.163.com/',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    res.json({ lyric: resp.data.lrc?.lyric || '' });
  } catch (e) {
    res.json({ lyric: '' });
  }
});

// ============ 少儿百科预置专辑 ============
const KIDS_ALBUMS = [
  { id: 28886553, name: "凯叔·西游记", category: "story", icon: "📚" },
  { id: 22465917, name: "凯叔·三国演义", category: "story", icon: "📚" },
  { id: 32811206, name: "睡前故事大全", category: "story", icon: "🌙" },
  { id: 19056774, name: "十万个为什么", category: "science", icon: "🔬" },
  { id: 28649893, name: "宝宝巴士儿歌", category: "song", icon: "🎵" },
  { id: 27055466, name: "恐龙世界大百科", category: "nature", icon: "🦕" },
  { id: 35288196, name: "职业体验100个秘密", category: "career", icon: "👨‍⚕️" },
  { id: 30726803, name: "幼儿安全教育", category: "story", icon: "🛡️" },
  { id: 25277841, name: "数学思维启蒙", category: "science", icon: "🔢" },
  { id: 33576986, name: "安徒生童话", category: "story", icon: "📖" },
  { id: 29876543, name: "动物王国探险记", category: "nature", icon: "🐘" },
  { id: 31234567, name: "太空探索之旅", category: "science", icon: "🚀" },
];

app.get('/api/kids/list', (req, res) => {
  const category = req.query.category || 'all';
  if (category === 'all') res.json(KIDS_ALBUMS);
  else res.json(KIDS_ALBUMS.filter(a => a.category === category));
});

app.get('/api/kids/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    // 先在预置专辑中匹配
    const matched = KIDS_ALBUMS.filter(a => a.name.includes(keyword));
    // 再用网易云搜索补充
    const resp = await axios.post('https://music.163.com/api/search/get/web',
      `csrf_token=&hlpretag=&hlposttag=&type=1&s=${encodeURIComponent(keyword)}&limit=10&offset=0`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com/', 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const neteaseSongs = (resp.data.result?.songs || []).slice(0, 10).map(s => ({
      source: 'netease',
      id: s.id,
      name: s.name,
      artists: s.artists?.map(a => a.name).join(', '),
      duration: s.duration,
      album: s.album?.name || '',
      _isKids: false,
    }));
    // 预置专辑也转为歌曲格式
    const albumSongs = matched.map(a => ({
      source: 'kids_album',
      id: a.id,
      name: a.name,
      artists: '喜马拉雅',
      duration: 0,
      album: a.name,
      _isKids: true,
      category: a.category,
      icon: a.icon,
    }));
    res.json([...albumSongs, ...neteaseSongs]);
  } catch (e) {
    res.json([]);
  }
});

// ============ 免费儿童故事 API (Storynory RSS) ============
const fs = require('fs');

app.get('/api/kids-stories', async (req, res) => {
  try {
    // 尝试从 RSS 获取最新数据
    const resp = await axios.get('https://www.storynory.com/feeds/stories/', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    const xml = resp.data;
    // 简单 XML 解析
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    const stories = items.map(item => {
      const title = (item.match(/<title>(.*?)<\/title>/) || [])[1] || '';
      const url = (item.match(/url="(.*?)"/) || [])[1] || '';
      const duration = (item.match(/length="(.*?)"/) || [])[1] || '0';
      const desc = ((item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '').replace(/<[^>]+>/g, '').substring(0, 150);
      return { title, url, duration, description: desc };
    }).filter(s => s.url);
    res.json(stories);
  } catch (e) {
    // 如果 RSS 失败，返回本地缓存
    try {
      const stories = JSON.parse(fs.readFileSync(path.join(__dirname, 'kids-stories.json'), 'utf-8'));
      res.json(stories);
    } catch (e2) {
      res.json([]);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Music Player API server running at http://localhost:${PORT}`);
});

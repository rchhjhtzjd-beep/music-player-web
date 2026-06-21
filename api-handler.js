const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const params = Object.fromEntries(searchParams);

  // 少儿百科搜索
  if (pathname === '/api/kids/search') {
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

    const keyword = params.keyword || '';
    const matched = KIDS_ALBUMS.filter(a => a.name.includes(keyword));

    let neteaseSongs = [];
    try {
      const resp = await axios.post('https://music.163.com/api/search/get/web',
        `csrf_token=&hlpretag=&hlposttag=&type=1&s=${encodeURIComponent(keyword)}&limit=10&offset=0`,
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com/', 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      neteaseSongs = (resp.data.result?.songs || []).slice(0, 10).map(s => ({
        source: 'netease', id: s.id, name: s.name,
        artists: s.artists?.map(a => a.name).join(', '),
        duration: s.duration, album: s.album?.name || '', _isKids: false,
      }));
    } catch (e) {}

    const albumSongs = matched.map(a => ({
      source: 'kids_album', id: a.id, name: a.name,
      artists: '喜马拉雅', duration: 0, album: a.name,
      _isKids: true, category: a.category, icon: a.icon,
    }));

    return res.json([...albumSongs, ...neteaseSongs]);
  }

  // 网易云搜索
  if (pathname === '/api/netease/search') {
    try {
      const resp = await axios.post('https://music.163.com/api/search/get/web',
        `csrf_token=&hlpretag=&hlposttag=&type=1&s=${encodeURIComponent(params.keyword)}&limit=${params.limit || 15}&offset=0`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'Referer': 'https://music.163.com/', 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      return res.json(resp.data);
    } catch (e) {
      return res.json({ result: { songs: [] } });
    }
  }

  // 网易云播放URL
  if (pathname === '/api/netease/url') {
    try {
      const resp = await axios.post('https://music.163.com/api/song/enhance/player/url',
        `csrf_token=&ids=[${params.id}]&br=128000`,
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com/', 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      return res.json(resp.data);
    } catch (e) {
      return res.json({ data: [] });
    }
  }

  // 网易云歌词
  if (pathname === '/api/netease/lyric') {
    try {
      const resp = await axios.post('https://music.163.com/api/song/lyric',
        `id=${params.id}&lv=1&tv=1&kv=1&rv=1&cp=true`,
        { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com/', 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      return res.json(resp.data);
    } catch (e) {
      return res.json({ lrc: { lyric: '' } });
    }
  }

  res.status(404).json({ error: 'Not found' });
};

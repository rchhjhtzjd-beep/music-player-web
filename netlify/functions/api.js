const axios = require('axios');

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

async function neteasePost(path, body, extraHeaders = {}) {
  try {
    const resp = await axios.post('https://music.163.com' + path, body, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://music.163.com/',
        'Content-Type': 'application/x-www-form-urlencoded',
        ...extraHeaders,
      },
      timeout: 10000,
    });
    return resp.data;
  } catch (e) {
    return null;
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { pathname, queryStringParameters } = event.pathParameters || {};
  const params = queryStringParameters || {};
  const path = pathname || event.path;

  // 少儿百科搜索
  if (path.includes('/api/kids/search')) {
    const keyword = params.keyword || '';
    const matched = KIDS_ALBUMS.filter(a => a.name.includes(keyword));

    let neteaseSongs = [];
    const searchData = await neteasePost(
      '/api/search/get/web',
      `csrf_token=&hlpretag=&hlposttag=&type=1&s=${encodeURIComponent(keyword)}&limit=10&offset=0`
    );
    if (searchData) {
      neteaseSongs = (searchData.result?.songs || []).slice(0, 10).map(s => ({
        source: 'netease', id: s.id, name: s.name,
        artists: s.artists?.map(a => a.name).join(', '),
        duration: s.duration, album: s.album?.name || '', _isKids: false,
      }));
    }

    const albumSongs = matched.map(a => ({
      source: 'kids_album', id: a.id, name: a.name,
      artists: '喜马拉雅', duration: 0, album: a.name,
      _isKids: true, category: a.category, icon: a.icon,
    }));

    return { statusCode: 200, headers, body: JSON.stringify([...albumSongs, ...neteaseSongs]) };
  }

  // 网易云搜索
  if (path.includes('/api/netease/search')) {
    const data = await neteasePost(
      '/api/search/get/web',
      `csrf_token=&hlpretag=&hlposttag=&type=1&s=${encodeURIComponent(params.keyword || '')}&limit=${params.limit || 15}&offset=0`
    );
    return {
      statusCode: data ? 200 : 200,
      headers,
      body: JSON.stringify(data || { result: { songs: [] } }),
    };
  }

  // 网易云播放URL
  if (path.includes('/api/netease/url')) {
    const data = await neteasePost(
      '/api/song/enhance/player/url',
      `csrf_token=&ids=[${params.id || ''}]&br=128000`
    );
    return {
      statusCode: data ? 200 : 200,
      headers,
      body: JSON.stringify(data || { data: [] }),
    };
  }

  // 网易云歌词
  if (path.includes('/api/netease/lyric')) {
    const data = await neteasePost(
      '/api/song/lyric',
      `id=${params.id || ''}&lv=1&tv=1&kv=1&rv=1&cp=true`
    );
    return {
      statusCode: data ? 200 : 200,
      headers,
      body: JSON.stringify(data || { lrc: { lyric: '' } }),
    };
  }

  return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
};

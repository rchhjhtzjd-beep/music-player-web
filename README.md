# 🎵 音乐播放器

多音源聚合音乐播放器，支持网易云/QQ音乐/咪咕/酷狗搜索与播放。

## 儿童故事字幕与时长修复

儿童故事现在使用明确的 `durationSeconds`（秒），`enclosureBytes` 单独保存文件大小。
列表载入时把 RSS 提供的时长标为“约”；音频取得 metadata 后，列表和播放栏统一显示实际音频时长。
旧缓存中没有可核实时间的条目显示“时长待载入”，不会再将文件字节数换算成分钟。

字幕只跟随当前故事的 `audio.currentTime`。切换媒体会清空旧歌词并作废旧请求；暂停、跳转、下一条和自然结束都使用当前故事队列。
当前 Storynory RSS 没有提供带时间戳的字幕，因此默认明确显示“暂无同步字幕”，简介不再冒充双语字幕。
已有人工核对的字幕可以附在 `kids-stories.json` 的对应音频 URL 下：

```json
{
  "subtitleDurationSeconds": 12,
  "subtitles": [
    { "start": 1, "end": 3, "text": "Test line", "translation": "测试句子" }
  ]
}
```

上面的内容仅展示字段格式，需加入完整故事记录。字幕开始和结束时间均为秒；`subtitleDurationSeconds` 是这份字幕对应的完整录音时长，应随经过核对的字幕一起提供。录音长度变化、字幕越界或时间区间错误时停止同步，不自动拉伸字幕。仅有原文时可提供 `transcript`，它作为无时间轴文本展示。

运行 `npm test` 可执行 35 项自动回归测试。详细根因、实际浏览器验证和限制见 [验证记录](docs/kids-story-sync-verification.md)。

## 本地使用

```bash
cd music-player-web
npm install
npm start
```

浏览器打开 http://localhost:3000

## 分享给别人

### 方案一：部署到 Render.com（推荐，免费）

1. 将项目代码上传到 GitHub
2. 登录 https://render.com
3. 点击 "New +" → "Web Service"
4. 选择你的仓库，填写：
   - **Name**: music-player
   - **Root Directory**: MusicPlayerApp2
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: Free
5. 点击 Create，等待部署完成
6. 你会得到一个类似 `https://music-player-xxxx.onrender.com` 的链接
7. 前端默认使用同源 `/api`，不需要在 `js/app.js` 中填写部署域名
8. 把这个链接发给朋友即可使用

### 方案二：部署到 Railway.app（免费）

1. 将代码上传到 GitHub
2. 登录 https://railway.app
3. 点击 "New Project" → "Deploy from GitHub repo"
4. 选择你的仓库
5. Railway 会自动识别 Node.js 项目并部署
6. 部署完成后获取 URL；前端会请求该站点的同源 `/api`
7. 分享链接给朋友

### 方案三：部署到 Vercel（需要改造）

Vercel 不支持长期运行的 Node.js 服务，需要将后端拆成 Serverless Functions。

## 文件结构

```
MusicPlayerApp2/
├── index.html          # 前端页面
├── server.js           # 后端代理服务器（解决CORS）
├── package.json        # 项目配置
├── css/style.css       # 样式
├── js/app.js           # 前端逻辑
└── README.md           # 本文件
```

## 功能

- 搜索：网易云 / QQ音乐 / 咪咕 / 酷狗 多音源聚合
- 播放：在线播放，自动降级音源
- 下载：一键下载 MP3
- 歌词：实时同步高亮
- 收藏：本地持久化存储
- 播放列表：创建/管理多个列表

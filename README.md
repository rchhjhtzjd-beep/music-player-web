# 🎵 音乐播放器

多音源聚合音乐播放器，支持网易云/QQ音乐/咪咕/酷狗搜索与播放。

## 本地使用

```bash
cd MusicPlayerApp2
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
7. 打开 `MusicPlayerApp2/js/app.js`，把 `BASE` 改成你的部署域名
8. 把这个链接发给朋友即可使用

### 方案二：部署到 Railway.app（免费）

1. 将代码上传到 GitHub
2. 登录 https://railway.app
3. 点击 "New Project" → "Deploy from GitHub repo"
4. 选择你的仓库
5. Railway 会自动识别 Node.js 项目并部署
6. 部署完成后获取 URL，修改 `js/app.js` 中的 `BASE` 地址
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

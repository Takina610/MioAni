# MioAni

**Follow your season.** 浏览季度新番、同步 Bangumi / AniList 追番记录，并在本地库中管理观看进度；可选多源在线播放。

| | |
| --- | --- |
| 前端 | Vue 3 · TypeScript · Vite · Pinia · Vue Router · GSAP |
| 播放 | Artplayer · HLS.js · 弹幕 / 缩略图插件 |
| 后端 | Express（播放解析 API）· Playwright |
| 数据 | Bangumi API · AniList GraphQL |
| 部署 | 前端 Cloudflare Workers · API Render（Docker） |

---

## 功能

- **首页 Hero** — 当季精选新番轮播：前景 Featured / 背景 Upcoming，GSAP 交接动画与漫画风 Intro
- **发现 Discover** — 按季度、标签等浏览目录，打开作品详情 Overlay
- **时间表 Schedule** — 放送日程一览
- **本地追番库 Library** — 收藏、观看状态与进度；数据存 `localStorage`
- **导入** — 从 Bangumi / AniList 导入追番列表并合并身份（`linkedIds`）
- **作品 / 人物详情** — 路由级 Overlay，关闭后保留列表滚动位置
- **在线播放（可选）** — 多源解析 → HLS / 直链；弹幕、进度记忆、线路切换  
  （需自建 API；默认可通过 `VITE_PLAYBACK` 关闭）

---

## 页面路由

| 路径 | 说明 |
| --- | --- |
| `/` | 首页 |
| `/discover` | 发现 |
| `/schedule` | 时间表 |
| `/library` | 追番库 |
| `/anime/:id` | 作品详情 Overlay |
| `/character/:id` · `/person/:id` | 角色 / 人物 Overlay |

---

## 快速开始

### 环境要求

- Node.js 20+（建议 LTS）
- npm

### 安装与开发

```bash
npm install
cp .env.example .env.development   # 按需修改
npm run dev                        # 同时启动 web (Vite) + api (Express)
```

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 并行启动前端 + 播放 API |
| `npm run dev:web` | 仅 Vite |
| `npm run dev:api` | 仅 Express API（默认端口 `8787`） |
| `npm run build` | 类型检查 + 生产构建 → `dist/` |
| `npm run preview` | 预览构建产物 |
| `npm test` | Vitest |

开发时前端通过 Vite 代理访问 `/api`；生产构建需配置 `VITE_API_BASE` 指向完整 API 地址（含 `/api`）。

### 环境变量（摘要）

详见 [`.env.example`](.env.example)。

**前端（`VITE_*`）**

| 变量 | 说明 |
| --- | --- |
| `VITE_API_BASE` | 播放 API 基址；开发可留空走代理 |
| `VITE_PLAYBACK` | `1` 开启播放 / `0` 关闭 |
| `VITE_BANGUMI_API_BASE` | Bangumi API（默认 `https://api.bgm.tv`） |
| `VITE_ANILIST_API_BASE` | AniList GraphQL |

**后端（进程环境变量）**

| 变量 | 说明 |
| --- | --- |
| `PORT` | API 端口（本地默认 `8787`） |
| `CORS_ORIGIN` | 逗号分隔的前端源；空则开发友好反射 |
| `PLAYBACK_*` | 超时、缓存、代理域名等（见 `.env.example`） |

---

## 架构一览

```
┌─────────────────────────────┐     Bangumi / AniList
│  Vue SPA (Cloudflare)       │◄────────────────────
│  Home · Discover · Schedule │
│  Library · Detail Overlay   │
│  AnimePlaybackTheater       │
└──────────────┬──────────────┘
               │  /api/playback/*
┌──────────────▼──────────────┐
│  Express API (Render Docker)│
│  multi-source resolve       │
│  Playwright + HLS proxy     │
└─────────────────────────────┘
```

- **前端**：静态站点，目录与追番数据主要在浏览器侧聚合；库数据本地持久化。
- **API**：仅负责播放源解析与流代理，**不**托管番剧版权内容；部署与前端分离。

主要健康检查：`GET /api/health`。

---

## 部署

### 前端 → Cloudflare Workers（静态资源）

1. `npm run build` 产出 `dist/`
2. 构建环境设置 `VITE_API_BASE=https://你的-api域名/api`、`VITE_PLAYBACK=1`（如需播放）
3. 使用仓库根目录 [`wrangler.toml`](wrangler.toml) 部署 Workers Assets（SPA：`not_found_handling = single-page-application`）

> 播放 API **不能** 用该 wrangler 配置部署（依赖 Playwright / Node）。

### 播放 API → Render（Docker）

- 蓝图：[`render.yaml`](render.yaml)
- 镜像：[`Dockerfile`](Dockerfile)（Playwright 官方镜像 + `tsx server/index.ts`）
- 健康检查：`/api/health`
- 建议设置 `CORS_ORIGIN` 为前端域名

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| UI | Vue 3 `<script setup>`、Phosphor Icons |
| 状态 | Pinia |
| 动效 | GSAP |
| 播放器 | Artplayer + danmuku / thumbnail 插件 + hls.js |
| 服务端 | Express 5、Playwright（部分片源） |
| 测试 | Vitest |
| 工具链 | Vite 8、TypeScript、vue-tsc、concurrently、tsx |

---

## 仓库与远程

| 远程 | 地址 |
| --- | --- |
| Gitee | https://gitee.com/takina610/mio-ani |
| GitHub | https://github.com/Takina610/MioAni |

本地分支 `master` 对应 GitHub 默认分支 `main`：

```bash
git push gitee master
git push github master:main
```

---

## 说明与免责

- 本项目为个人学习 / 展示向的追番与 UI 实践，**不提供**任何官方正版流媒体授权。
- 播放解析依赖第三方公开页面结构，源站变更可能导致失败；请遵守当地法律法规与源站条款。
- Bangumi / AniList 为第三方公共 API，请合理控制请求频率。

---

## License

私人仓库 / 学习项目。若你 fork 使用，请自行补充开源协议与合规说明。

# 斗地主 WebGame

一个完整的斗地主网页游戏，支持人机对战、局域网联机、自定义模式。

**技术栈**: Vite + ES6 模块 + Express + WebSocket + Docker

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器（同时启动前端 Vite + 后端 WebSocket）
npm run dev

# 浏览器打开 http://localhost:5173
```

## Docker 部署

```bash
# 构建镜像
docker build -t doudizhu .

# 运行容器
docker run -p 3001:3001 doudizhu

# 或使用 docker-compose
docker-compose up -d
```

生产环境建议使用 Nginx 反向代理（已提供 `nginx.conf`）。

## 三种游戏模式

### 🤖 人机对战
- 1名玩家 vs 2个AI
- AI支持 3 档难度（简单 / 普通 / 困难）
- **提示功能**：按 `H` 键让AI帮你选牌
- **托管功能**：点击"托管"按钮，AI自动替你出牌/叫分

### 🌐 局域网联机
- 3人实时对战，基于 WebSocket
- 房主创建房间 → 分享房间号 → 好友加入 → 开始游戏
- 支持聊天、断线重连、玩家列表
- 后端支持房间管理、自动清理、心跳检测

### ⚙️ 自定义模式
- 调整AI难度、启用观战模式、显示全部手牌（测试）
- 支持自定义规则参数

## 操作方式

| 快捷键 | 功能 |
|--------|------|
| `Space` | 出牌 |
| `P` | 不出 |
| `H` | 提示 |
| `R` | 重选 |
| `1~9` | 快速选择第N张牌 |
| `1/2/3` | 叫分（叫分阶段） |
| `0/ESC` | 不叫 |

## 核心规则

- **12种牌型**：单张、对子、三张、三带一、三带二、顺子、连对、飞机、飞机带翅膀、四带二、炸弹、王炸
- **春天/反春天**：地主一手出完（农民未出牌）或农民反杀（地主只出过一手），倍数翻倍
- **炸弹翻倍**：每出一个炸弹或火箭，结算倍数 ×2

## 项目结构

```
.
├── package.json              # npm 配置
├── vite.config.js            # Vite 构建配置
├── Dockerfile                # Docker 镜像
├── docker-compose.yml        # Docker Compose 配置
├── nginx.conf                # Nginx 反向代理配置
├── index.html                # Vite 入口
├── server/                   # 后端
│   ├── index.js              # Express + WebSocket 服务器
│   └── room-manager.js       # 游戏房间管理器
├── src/                      # 前端源码（ES6 模块）
│   ├── main.js               # 入口/菜单导航/统计面板
│   ├── config.js             # 全局配置
│   ├── utils/storage.js      # localStorage 持久化
│   ├── core/
│   │   ├── card.js           # 54张牌定义
│   │   ├── rules.js          # 牌型规则引擎（识别/比较/搜索/提示）
│   │   └── game-state.js     # 游戏状态管理器（春天/炸弹倍数）
│   ├── players/
│   │   ├── player.js         # 玩家基类（托管标志）
│   │   └── ai-player.js      # AI玩家（复杂策略 + 提示功能）
│   ├── modes/
│   │   ├── base-mode.js      # 模式基类（游戏流程 + 托管逻辑）
│   │   ├── ai-mode.js        # 人机对战
│   │   ├── lan-mode.js       # 局域网联机（WebSocket客户端）
│   │   └── custom-mode.js    # 自定义模式
│   ├── ui/
│   │   ├── renderer.js       # UI渲染 + 交互 + 记牌器 + 历史 + 聊天
│   │   ├── audio.js          # Web Audio API 音效系统
│   │   └── animations.js     # 粒子/爆炸/火箭/飘字特效
│   └── styles/
│       └── main.css          # 完整样式 + 动画特效 + 响应式
└── test/
    └── core.test.mjs         # 核心逻辑单元测试
```

## 后端 API

| 接口 | 说明 |
|------|------|
| `GET /api/health` | 健康检查 |
| `GET /api/rooms` | 可用房间列表 |
| `WS /ws` | WebSocket 游戏通信 |

### WebSocket 消息类型

- `create_room` / `join_room` / `start_game`
- `player_action` - 玩家操作（叫分/出牌/不出）
- `game_start` / `game_state_sync`
- `chat` - 玩家聊天

## 特色功能

- **智能提示**：AI实时分析手牌，给出最佳出牌建议
- **托管系统**：一键托管，AI自动代打
- **记牌器**：实时追踪54张牌的出牌状态
- **出牌历史**：记录最近30轮出牌详情
- **游戏内聊天**：联机模式下实时聊天
- **数据持久化**：localStorage 保存战绩、设置、对局记录
- **统计面板**：总局数、胜场、负场、连胜 streak
- **音效系统**：发牌/叫分/出牌/炸弹/火箭/胜负 全音效（Web Audio合成）
- **视觉特效**：炸弹冲击波、火箭飞行、分数飘字、地主皇冠
- **键盘快捷键**：完整的键盘操作支持
- **移动端适配**：触摸操作、响应式布局、禁止缩放
- **加载动画**：扑克牌翻转加载画面
- **开发热更新**：Vite HMR 支持

## 版本公告

### v1.1.0 (当前版本) — UI/UX/BGM/SFX 全面升级

**新增功能**
- 🎵 **BGM 循环系统**：菜单/游戏/胜利/失败四种场景 BGM，自动切换循环
- 🔊 **20+ 种合成音效**：发牌、叫分、抢地主、出牌（按牌型）、炸弹（白噪声+锯齿波）、火箭（频率扫频）、春天、选牌/取消选牌、提示、托管切换、按钮点击、聊天、错误提示、比赛结束等
- ✨ **24 种视觉动画**：炸弹冲击波、火箭飞行、分数飘字、地主皇冠、屏幕震动、全屏闪光、卡牌弧线飞行、弹入弹出、脉冲光环、彩纸屑、星星爆发、光晕扩散、轨迹效果、数字滚动、3D翻转、弹跳文字、滑入、旋转淡出、轨道旋转、涟漪、春天花瓣飘落、胜利庆祝等
- 🎮 **快捷键音效**：Space出牌、P不出、H提示、R重选、数字键选牌全部增加音效反馈
- 🛡️ **Toast 防抖**：相同消息 1.5 秒内不重复显示，最多同时存在 3 个
- 📱 **移动端触摸优化**：防止触摸与 click 重复触发，所有按钮支持 touchstart 涟漪

**Bug 修复**
- 修复 CustomMode 预设牌时 deck/bottom 未定义导致崩溃
- 修复叫分按钮重复绑定托管按钮的问题
- 修复 Renderer 键盘事件监听器内存泄漏（多次创建不清理）
- 修复游戏循环返回菜单后继续运行的问题（添加 isRunning 检查）
- 修复 BGM loop 在 stopBGM 后旧定时器仍然触发的问题
- 修复 screenShake 多次连续调用导致 transform 累积偏移
- 修复 onRoundEnd/onPhaseChange setTimeout BGM 在返回菜单后泄漏
- 修复 showReplayList 未隐藏 game-screen 导致界面重叠
- 修复 Storage localStorage setItem 缺少 try-catch（满时崩溃）
- 修复键盘快捷键在输入框中误触发的问题
- 修复动画元素切换屏幕后残留的问题（统一标记清理）
- 修复观战模式下 onRoundEnd isHumanWin 计算错误
- 修复 dealFromCenter 创建双重元素的问题

---

## 历史公告

### v1.0.0 — 初始版本
- 人机对战、局域网联机、自定义模式三大玩法
- 12 种牌型规则引擎、AI 策略、提示系统
- 叫分/抢地主、春天/反春天、炸弹倍数
- 记牌器、出牌历史、游戏内聊天
- localStorage 数据持久化、统计面板
- 响应式布局、移动端触摸支持

## 许可证

MIT

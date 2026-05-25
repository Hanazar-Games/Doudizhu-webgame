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
- 支持“本机托管”：房主电脑运行 `npm run lan:host`，其他玩家打开终端显示的局域网地址
- 房主创建房间 → 分享房主地址和房间号 → 好友加入 → 开始游戏
- 支持聊天、断线重连、玩家列表
- 房主电脑承担房间管理、自动清理、心跳检测，不需要外部服务器

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

### v1.2.4 (当前版本) — 规则引擎 & 音频/渲染深度修复

**🔴 严重 Bug 修复（软锁/崩溃/数据丢失类）**
- **规则设置不生效**：`resetSettings()` 未真正清除 localStorage，旧设置残留；`allowPassOnFirst`、`noShuffle`、`baseScore`、`jokerRule='disabled'`、`bombRule='strict'` 等设置未在 `GameState.playCards()` 中强制执行 — `resetSettings()` 现在 `removeItem` 后返回纯默认对象；所有规则在 `playCards()` / `pass()` 中通过 `_isPatternAllowed()` 统一拦截
- **`mustPlay` 软锁**：`mustPlay` 开启时玩家可能无合法牌可出但被强制要求出牌，陷入无限等待 — `pass()` 现在通过 `hasValidPlays()`（已按规则过滤）判断，有合法牌时才能阻断 pass
- **首出者规则跨局失效**：`firstPlayer='winner'`/`'landlord'` 每局都回到默认 — `BaseMode` 现在追踪 `_lastWinnerIndex` / `_lastLandlordIndex` 并在新局应用
- **自定义模式规则不完整**：`CustomMode.startGame()` 未应用 `jokerRule`、`bombRule`、`baseScore`、`noShuffle` 等标准设置 — 现已完整应用
- **`_isPatternAllowed()` 与 `playCards()` 不一致**：自定义模式 `Rules.validate` 通过了但 `playCards()` 拒绝，导致手牌打出后显示「不符合规则」软锁 — `_isPatternAllowed()` 现已完全镜像 `playCards()` 的检查逻辑
- **规则设置被过早锁定**：`_lockGameRuleSettings()` 在进入 lobby 时就锁定，导致玩家无法在开局前修改规则 — 现在只在 `startGame()` 之后才锁定
- **音效开关无效**：`playBomb()`/`playRocket()`/`playStraight()` 未检查 `sfxEnabled` 和独立开关；`playLose()` 检查了错误的开关；`_playTick()` 音量未使用 `sfxVolume` — 全部修复
- **BGM 泄漏**：切换 BGM 开关时旧 BGM 继续播放 — `_playBGMSequence()` 现在每次先 `stopBGM()`
- **AudioContext `closed` 崩溃**：用户手动暂停/恢复页面后 AudioContext 进入 `closed` 状态，后续所有音频调用抛出 `InvalidStateError` — `_ensureContext()` 现在检测 `'closed'` 并重建
- **首回合 Pass 按钮状态错误**：`allowPassOnFirst=true` 时首回合 Pass 按钮仍被禁用 — `showPlayControls()` 已修复条件判断
- **Modal 返回按钮全局冲突**：`showRoundResult()` 使用 `btn-back-menu`，与全局菜单按钮 ID 冲突，点击结算面板的返回会同时触发菜单返回 — 改为 `btn-modal-back-menu`
- **Modal overlay 监听器泄漏**：`_closeModal` 未移除旧的 overlay click 监听器，快速开关 modal 时残留多个监听器 — 现在统一移除后再添加
- **统计一键清空误伤设置**：`btn-clear-stats` 调用 `Storage.clearAll()` 同时清除了所有游戏设置 — 改为仅调用 `clearStats()` + `location.reload()`
- **人机托管越权**：`_autoPlayForHuman()` 1200ms 延迟后未检查当前回合是否仍属于自己，可能越权替他人出牌 — 现在验证 `currentTurn === playerIndex`
- **倒计时与托管竞态**：`triggerAutoIfNeeded()` 触发托管时未停止倒计时，导致托管出牌后倒计时继续到0再次触发 — 现在先 `_stopCountdown()`
- **LAN 房间关闭无广播**：`leaveRoom()` 未广播 `player_list_update`，其他玩家看到离线玩家仍在房间列表中 — 现在离开后广播更新列表
- **LAN 游戏非法启动**：非 host 可以发送 `game_start`，服务器未验证 — 服务器现在验证 host 身份 + ≥3 玩家 + 未已开始
- **LAN socket 重连泄漏**：旧 WebSocket 未清理就创建新连接，导致消息重复接收 — `_connectWebSocket()` 现在先关闭旧 socket 再新建
- **LAN 重连定时器未清理**：`destroy()` 未清除 `reconnectTimer`；`_scheduleReconnect()` 在 `isRunning=false` 后仍执行 — 已加防护
- **LAN 状态文本查询错误**：`_refreshLANHostInfo()` 查询 `#lan-host-status`（class 名），实际应为 `#lan-status`（ID）— 已修复
- **ReplayManager 未停止旧实例**：切换回放时旧实例仍在运行 — `showReplayList()` 现在先停止旧实例
- **DOM 死引用**：`btn-back`、`loading-screen` 等元素已不存在但仍被查询 — 已移除相关引用
- **LAN 进入游戏后未锁定规则**：`_enterLANGameFromNetwork` 未调用 `_lockGameRuleSettings` — 现在在游戏开始后锁定

**🟢 工程与基础设施**
- **版本号单源管理**：`package.json` 为唯一数据源，`vite.config.js` 注入 `__APP_VERSION__`，`main.js` 启动时写入 DOM；消除手动同步风险
- **package-lock.json 缺失**：CI/Docker 中 `npm install` 可能安装不兼容版本 — 已生成并锁定
- **Vite/esbuild 安全漏洞**：`vite` 5.x 依赖的 `esbuild` 存在 CVE — 升级至 `vite@6.4.2`
- **服务器端口冲突**：`EADDRINUSE` 时原进程静默退出，Vite 前端成为僵尸 — 现在捕获错误并 `process.exit(1)`
- **`concurrently` 容错**：一个进程崩溃时另一个继续运行 — 添加 `--kill-others-on-fail`
- **测试覆盖扩展**：新增 10 个核心规则测试（`allowPassOnFirst`、`jokerRule disabled`、`hasValidPlays` 过滤、`baseScore` 影响结算等），全部 43/43 通过

### v1.2.3 — 记牌器修复 & UI/UX深度打磨

**🔴 严重 Bug 修复**
- **记牌器开局全0**：`_resetCardTracker` 错误地减去了所有玩家手牌+底牌（共54张），导致记牌器每局开局就全空 — 改为只初始化满牌54张，出牌后正常递减
- **癞子模式跨局失效**：`resetRound()` 仍重置 `laiziEnabled = false`，每局结束后癞子规则被清除 — 已从 `resetRound` 中移除
- **`const esc` 重复声明**：`showRoundResult()` 中同一作用域内声明两次 `const esc`，严格模式下抛出 SyntaxError 导致结算面板完全崩溃 — 合并为单次声明
- **Replay 按钮无响应**：JS 绑定 `btn-replay-mode`，HTML 实际 ID 为 `btn-replay` — 统一为 `btn-replay`
- **LAN 模式 UI ID 不匹配**：`btn-create-room`/`btn-join-room`/`lan-status` 等 8 个 ID 在 HTML 中不存在或名称不一致，导致局域网联机界面功能失效 — 补全缺失 DOM 并统一 ID 引用

**🟡 UI/UX 动画 & 过渡增强**
- **Modal 关闭无过渡**：结算弹窗点击按钮后直接消失 — 新增 `_closeModal()` 方法，content 缩小淡出 + overlay 背景淡出 250ms
- **侧边面板关闭生硬**：记牌器/历史/聊天面板直接 `display:none` — 添加 `panel-exit` 滑出过渡（opacity + translateX）
- **成就面板关闭生硬**：同上，添加 `panel-exit` 淡出过渡
- **暗色模式裁剪 fixed 元素**：`filter` 在 `#game-screen` 上创建 containing block，导致 toast/modal/controls 等 fixed 元素被裁剪 — 将 filter 移至 `#ddz-table` + `.game-header` + `#menu-screen`
- **控制区 safe-area 被覆盖**：`padding-bottom` 的 `!important` 虽能确保 safe-area，但会强制覆盖 density 设置 — 保留 `!important` 但统一为 `calc(24px + env(safe-area-inset-bottom))`
- **历史记录 hover 死代码**：`.history-item:hover` 从未生效，实际使用 `.history-entry` — 重命名并合并样式
- **菜单布局空区域**：grid-template-areas 包含不存在的 `"settings"` 区域 — 移除，避免 stats 面板溢出

**🟢 代码质量 & 防御性增强**
- **Modal timeout 泄漏**：`_closeModal` 的 `setTimeout` 未存储 ID，快速重开modal时旧timeout会隐藏新modal — 存储并清除 timeout ID
- **Modal listener 泄漏**：overlay click 监听器仅在点击背景时移除，按钮关闭时残留 — 在 `_closeModal` 中统一移除
- **Side panel null 崩溃**：`_toggleSidePanel` 中 `other?.classList.contains('hidden')` 在 `other` 为 null 时抛出 TypeError — 改为 `other && !other.classList.contains('hidden')`
- **Achievement timeout 泄漏**：关闭成就面板的 setTimeout 未清除，快速切换时面板闪现后消失 — 存储 `_achCloseTimer` 并在打开/关闭时清除
- **手牌淡出仍可点击**：`_updateHumanHand` 移除卡片时未设置 `pointer-events:none`，150ms 内仍可误触 — 添加
- **手牌 fallback 条件过窄**：仅当 `removedCount === 0` 时才 fallback 到 `renderHands()`，部分匹配时留下幽灵卡片 — 改为 `removedCount !== playedCards.length`
- **自定义模式重复牌崩溃**：`fixedHands` 含重复牌时 `remaining` 牌数不足，slice 后产生 `undefined` — 添加重复检测和截断保护
- **`_updateCardTracker` 防御性**：`card.isJoker()` 在输入为普通对象时可能抛出 TypeError — 添加类型检查 fallback

---

### v1.2.2 — 全局UI深度修复 & 性能优化

**🔴 严重问题修复**
- **25处 HTML 非法嵌套**：`<label>` 内包含 `<div class="slider-label-row">`，违反 HTML 规范（label 的 content model 为 Phrasing content），在某些浏览器中可能导致 DOM 解析异常 — 全部改为 `<span>`
- **9处内联 style**：`margin-top:8px`、`position:fixed` 等直接写在 HTML 中，可维护性差 — 提取为 CSS 类（`.settings-grid--spaced`、`.btn-back--fixed`、`.debug-counter`、`.btn-danger` 等）
- **安全区完全缺失**：iPhone 刘海屏/ Home Indicator 遮挡底部控制按钮和设置面板 — 添加 `env(safe-area-inset-*)` 到 body、controls-area、settings-modal
- **竖屏无适配**：手机竖屏时牌桌布局完全崩溃，manifest 强制 `landscape` 但 iOS Safari 不支持 — 添加竖屏警告遮罩（`orientation: portrait` 时显示"请横屏游玩"）
- **虚拟键盘遮挡输入框**：移动端聊天和设置搜索框聚焦后被键盘遮挡 — 添加 `scrollIntoView` 自动滚动到可视区域
- **小屏手机手牌溢出**：320px-375px 手机下手牌总宽度超出视口 — 新增 `@media (max-width: 380px)` 断点，卡牌缩至 40×56px、margin-left 缩至 -28px、按钮最小尺寸缩减
- **动画性能严重下降**：`animations.js` 中 `cardFly()`、`confetti()`、`springCelebrate()` 花瓣、`orbitEffect()` 每帧直接修改 `left/top`，强制触发 layout 计算 — 全部改为 `transform: translate3d()`
- **渲染性能差**：`renderHands()` 中自己手牌和明牌模式逐张 `appendChild` 到 DOM，频繁触发重排 — 改为 `DocumentFragment` 批量插入

**🟡 UI一致性修复**
- **文本截断大面积缺失**：超长玩家名、游戏标题、模式标签等无 overflow 保护 — 添加 `.truncate` 工具类，为 `.player-name` 设置 `max-width: 120px` + `ellipsis`
- **空状态缺失**：聊天面板和历史记录面板为空时完全空白 — 添加空状态提示（"暂无出牌记录"、"暂无消息"）
- **按钮 disabled 状态不统一**：部分按钮禁用后仅靠 `opacity: 0.4` 内联样式，无统一 CSS — 添加全局 `:disabled` 样式（opacity 0.4 + grayscale + not-allowed 光标）
- **触摸目标不足**：移动端控制按钮 `min-height: 38px` 低于 Apple HIG 推荐的 44px — 在 `@media (max-width: 900px)` 下统一提升至 44px
- **100vh 在 Safari 不准确**：动态工具栏导致高度坍缩 — 全局 `.screen` 改为 `100dvh`
- **手势冲突**：iOS 橡皮筋效果、双指缩放干扰游戏体验 — 添加 `overscroll-behavior: none`
- **模态框背景不可关闭**：回合结果模态框只能点按钮关闭，不符合用户直觉 — 添加背景点击关闭
- **暂停遮罩无过渡**：直接显示/隐藏，体验生硬 — 添加 opacity 淡入过渡
- **面板切换无状态反馈**：侧边栏按钮无 `aria-expanded` — 添加并同步展开状态
- **聊天面板打开不聚焦**：点击聊天按钮后输入框未自动获得焦点 — 添加 `setTimeout(() => chatInput?.focus(), 100)`

**🟢 CSS/可访问性增强**
- **平板断点优化**：iPad 竖屏（768px）被错误归入移动端，卡牌缩得过小 — 新增 `@media (min-width: 769px) and (max-width: 1024px)` 专属优化
- **字体缩放保护**：缺少 `text-size-adjust: 100%`，系统字体放大时布局错乱 — 全局添加
- **PWA meta 更新**：`apple-mobile-web-app-capable` 已废弃 — 追加 `mobile-web-app-capable`
- **历史面板操作按钮布局**：内联 flex 样式 — 提取为 `.history-actions` 类

---

### v1.2.1 — 全面稳定性修复 & 可访问性提升

**🔴 严重 Bug 修复**
- **癞子模式完全失效**：`game-state.js` 的 `resetRound()` 错误地将 `laiziEnabled` 设为 `false`，而 `startRound()` 首先调用 `resetRound()`，导致癞子规则每局都被清除 — 已从 `resetRound` 中移除 `laiziEnabled` 重置
- **一键出牌(oneClickPlay) 失效**：`_toggleCardSelection` 中检查 `selection.valid`，但 `_getPlayableSelection` 返回的对象根本没有 `valid` 属性，条件永远为假 — 改为检查 `selection.pattern?.isValid?.()`
- **底牌跨局不渲染**：`renderHands()` 使用 `container.dataset.rendered = 'true'` 作为渲染标志，但该标志在新一局开始时从不重置，导致第二局起底牌消失 — 在渲染前主动 `delete container.dataset.rendered`
- **赛制计分重复累加**：`onRoundEnd` 中使用 `matchScores[i] += data.scores[i]`，但 `GameState.scores` 本身就是跨局累加值，导致赛制总分被错误翻倍 — 改为直接赋值 `matchScores[i] = data.scores[i]`
- **成就进度 NaN 污染**：`checkAchievements` 中 `Math.max(progress.bombsPlayed, roundData.bombsPlayed)` 在 `bombsPlayed` 为 `undefined` 时返回 `NaN`，永久损坏成就系统 — 添加防御式赋值 `roundData.bombsPlayed || 0`
- **有牌必出(mustPlay) 规则未生效**：`pass()` 方法中仅有注释占位，没有任何实际逻辑 — 已实现：使用 `Rules.findAllBeats` 检查手牌是否能压过上家，能压则拒绝 pass

**🟡 体验与交互修复**
- **Escape 键全局冲突**：设置面板/帮助面板打开时按 ESC 会触发游戏暂停而非关闭面板 — 优先检查并关闭模态框
- **viewport 禁止缩放**：`maximum-scale=1.0, user-scalable=no` 违反 WCAG 且剥夺用户缩放权利 — 改为 `viewport-fit=cover`
- **DOMContentLoaded 在 defer 模块中可能错过**：模块脚本默认 defer，`DOMContentLoaded` 可能已触发 — 增加 `readyState` 检查
- **设置面板关闭后焦点未返回**：键盘用户关闭面板后需按多次 Tab 才能回到设置按钮 — 关闭后自动 `focus()` 到 `#btn-settings`
- **人类胜负音效判断错误**：使用跨局累加 `data.scores[this.humanIndex]` 判断本局胜负，导致累计分为负时赢局也播放输分音效 — 改用 `isHumanWin`
- **观战模式抢地主提示文字错误**：显示 "1分" / "2分" 而非 "叫地主" / "抢地主" — 根据 `callMode` 和 `grabPhase` 生成正确文本
- **AI delay 后未检查回合**：AI 思考延迟期间人类可能已超时自动行动，AI 醒来后用旧回合索引尝试出牌 — delay 后增加 `currentTurn !== idx` 检查
- **倒计时 timeout 未检查人类回合**：人类倒计时超时时未先校验是否仍为人类回合 — 增加前置检查
- **gameSpeed 无边界校验**：可接受负数或极大值 — 增加 `Math.max(0.3, Math.min(5.0, ...))` 限制
- **Touch/Mouse ghost click**：`_bindRipple` 同时绑定 `mousedown` 和 `touchstart`，移动端触发两次涟漪 — 统一使用 `pointerdown`
- **游戏模式初始化无 try-catch**：AI/局域网/自定义模式初始化失败时 UI 卡死 — 统一包裹 try-catch，失败时返回菜单并提示

**♿ 可访问性 & CSS 修复**
- **placeholder 对比度不足**：搜索框和房间号输入框 placeholder 透明度仅 0.35-0.4 — 提升至 0.6-0.65
- **focus 状态缺失**：range slider、搜索框、select/text input 设置 `outline: none` 后无替代 focus 样式 — 添加 `:focus-visible` 金色轮廓
- **backdrop-filter 无回退**：`.game-header`、`#settings-overlay`、`#call-controls` 等背景太透明，不支持 backdrop-filter 的浏览器可读性极差 — 统一加深回退背景色
- **touch-action: none 阻断所有触摸**：手牌区域完全禁止默认触摸行为，小屏无法滚动 — 改为 `touch-action: pan-y`
- **设置面板 landmark 缺失**：无 `role="dialog"` / `aria-modal="true"` — 已补充
- **按钮 aria-label 缺失**：关闭设置、暂停、音效、全屏、关闭教程等按钮仅有符号 — 已补充 `aria-label`
- **Meta 标签完善**：新增 `description`、`apple-touch-icon`、`apple-mobile-web-app-capable` / `status-bar-style`

**🔧 代码质量**
- `_doHint` 添加 try-catch：AI 异常时不再卡死，改为显示温和提示
- `_turnTimer` 死代码移除：声明但从未使用
- `localStorage` 写满处理：`records` / `full_games` 在 `QuotaExceededError` 时主动裁切旧记录后重试
- `destroy()` 增加 `_destroyed` 检查和 `_comboData` 清理，减少快速切换模式时的残留副作用

---

### v1.2.0 — UI修复：按钮样式 & 手牌堆叠 & 出牌截断

**🎨 UI 修复**
- **菜单按钮变白条**：`.btn-secondary` 在 CSS 中完全不存在，按钮继承浏览器默认白色背景 + body 白色文字 = 看不见 — 已添加完整 `.btn-secondary` 样式（半透明背景 + 白色文字 + hover 效果）
- **手牌严重堆叠看不见**：JS 硬编码 `marginLeft: '-44px'`，但 flex 容器压缩卡片后，每张牌只露出几像素，17张牌几乎完全重叠 — margin-left 改由 CSS 控制（桌面端 `-44px` / 移动端 `-32px`），配合 `flex-shrink: 0` 防止过度压缩
- **出牌被截断**：`#player-top .played-area` 和 `#player-left .played-area` 的 `min-height: 44px` 优先级（ID 选择器）高于 `.played-area.has-cards` 的 `min-height: 110px`，导致顶部/左侧玩家出牌区仅 44px 高，牌被截断 — 已移除 ID 选择器中的 `min-height` 覆盖

**🔧 代码修复**
- **移除 BGM 降低复杂逻辑**：用户反馈不需要设置面板打开时降低 BGM 的功能 — 已简化 `openSettings`/`closeSettings`，移除 `_savedBGMVolume` 和试听系数逻辑
- **gameSpeed 生效**：`base-mode.js` 中 `speedFactor` 始终为默认值 — 已读取 `settings.gameSpeed`
- **heartbeatInterval 单位**：默认值 `5000`（毫秒）与 UI `1-15`（秒）矛盾 — 已改为 `5`
- **voiceVolume 死设置**：有滑块但无音频后端 — 已补全 `AudioManager.voiceVolume`

---

### v1.1.9 — 设置系统稳定性修复 & 功能补全

**🔴 严重 Bug 修复**
- **heartbeatInterval 单位不一致**：默认值 `5000`（毫秒）→ `5`（秒）
- **voiceVolume 死设置**：补全音频后端 + 绑定
- **gameSpeed 设置不生效**：`base-mode.js` 读取应用

**🟡 交互体验修复**
- openSettings/closeSettings 重复调用 guard
- BGM 降低试听在滑块拖动时保持（v1.2.0 已移除此功能）
- sliderSfxTimer 全局共享 → 每个 control 独立
- setting-changed 高频 reflow → requestAnimationFrame 节流
- 关闭面板不强制折叠 details

**🟡 兼容性 & 可访问性**
- `:has()` fallback（JS 动态 has-value class）
- tooltip 溢出（max-width + white-space normal）
- 高对比度 toggle knob border

---

### v1.1.8 — 设置面板全面 UI/UX/SFX/BGM 升级 & 深度 Bug 修复

**🎛️ 设置面板全面重构**
- 🔄 **现代 Toggle Switch**：80 个设置项全部替换为带动画滑动开关，开启绿色/关闭灰色，带弹性按压效果
- 🎚️ **自定义 Range Slider**：28 个滑块全面美化，金色渐变滑块、hover 放大发光、实时数值反馈
- 🔍 **实时搜索过滤**：顶部新增搜索框，支持防抖 150ms 实时过滤，匹配项自动高亮并展开父级分类
- 🏷️ **分类图标增强**：14 个设置分类全部添加 emoji 图标 + 竖条装饰 + 字母间距，视觉层次更清晰
- ✨ **修改视觉反馈**：设置变更时播放金色涟漪脉冲动画，即时感知操作生效
- 📱 **移动端抽屉适配**：小屏下设置面板变为底部抽屉式滑入，单列布局、触控友好
- 🎨 **Hover 状态系统**：所有设置行/滑块/折叠面板都有 hover 背景色和边框过渡

**🎵 SFX/BGM 深度集成**
- 🎶 **面板打开音效**：明亮三音展开（660→880→1100Hz），增强打开仪式感
- 🔇 **面板关闭音效**：收拢两音（880→660Hz），与打开形成呼应
- ⚡ **开关切换音效**：开启时上升双音，关闭时下降双音，听觉反馈明确
- 🎚️ **滑块拖动音效**：清晰滴答（1000Hz/50ms），停止拖动 120ms 后触发防抖播放
- 🔄 **重置音效**：警示三角波音（440→330Hz），提示操作重要性
- 🎼 **BGM 动态调节**：打开设置面板时 BGM 平滑降至 25%，关闭时恢复，过渡自然

**🐛 深度 Bug 修复（15 项）**
- 🔴 **#settings-overlay.hidden 语义破坏**：CSS 中 `display: flex !important` 覆盖全局 `.hidden`，导致遮罩层无法真正隐藏 — 已移除错误覆盖
- 🔴 **timerEnabled 类型不一致**：HTML select 值为字符串 `"false"`，base-mode.js 使用 `=== false` 判断，倒计时关闭后仍继续运行 — 改为 `== false`
- 🔴 **暂停按钮全部未绑定**：renderer.js 只在动态创建 overlay 时绑定事件，HTML 静态 overlay 中三个按钮全部无响应 — 重构为统一事件绑定
- 🔴 **locked 状态下 toggle switch 仍可点击**：游戏进行中锁定的规则设置，toggle switch 的 label 点击仍能切换值 — 添加 `pointer-events: none`
- 🟡 **BGM 音量调节后被覆盖**：用户在面板内拖动 BGM 滑块调节音量，关闭面板后恢复为旧值 — 关闭时优先使用 `settings.bgmVolume` 最新值
- 🟡 **BGM 静音时打开面板强制出声**：BGM 设为 0 时，`Math.max(0.05, ...)` 强制提升到可闻音量 — 移除最低音量限制
- 🟡 **打开设置面板按钮音效重复**：menuBtns 通用 handler 已播放按钮音效，`openSettings()` 内又播放一次 — 移除重复调用
- 🟡 **setBGMVolume 瞬切突兀**：直接赋值 `gain.value` 导致音量跳变 — 改用 `setTargetAtTime` 0.15s 平滑过渡
- 🟡 **playSettingSlider 几乎无声**：音量仅 0.03、时长 30ms，极易被掩盖 — 增大到 0.06/50ms
- 🟡 **.settings-panel 高度限制**：旧 `max-height` 限制模态框内面板无法填满 — 添加 `max-height: none !important`
- 🟡 **搜索图标 focus 死代码**：`input:focus + .settings-search-icon` 相邻兄弟选择器永远不会命中 — 移除无效规则
- 🟡 **.settings-toggles 布局松散**：grid 强制等宽拉伸，短文本项产生多余空白 — 改为 `repeat(auto-fill, minmax(140px, max-content))`
- 🟢 **_showPauseOverlay 重复绑定**：每次暂停都 `addEventListener`，多次暂停后一个按钮触发多次 — 使用 `_pauseListenersBound` 标志只绑定一次
- 🟢 **_removePauseOverlay 内存泄漏**：改为 `classList.add('hidden')` 而不移除 DOM，动态 overlay 累积 — 恢复 `overlay.remove()` 并同步重置绑定标志

---

---

## 历史公告

### v1.1.6 — 全局 UX 增强大更新

**用户体验增强**
- ⏱️ **出牌倒计时器**：每回合 30 秒倒计时，最后 10 秒变红闪烁，超时自动托管
- ⏸️ **ESC 暂停游戏**：游戏中按 ESC 暂停/恢复，显示半透明遮罩
- ❓ **帮助面板**：按 `?` 键展开快捷键指南 + 牌型规则 + 拖拽提示
- 🎚️ **独立音量控制**：BGM 和 SFX 分别调节，实时预览，设置持久化
- 👆 **拖拽选牌**：按住鼠标/手指在手牌上滑动即可多选卡牌
- 🏆 **成就系统**：8 个成就（初出茅庐、连胜达人、春天使者、炸弹专家、地主之王、农民联盟、火箭发射、全歼对手），解锁时弹出金色通知
- 📊 **统计面板增强**：8 项数据（总局数、胜场、负场、胜率、连胜/最高、总得分、最高单局、最多炸弹）
- 🏅 **等级/经验系统**：完成对局获得经验，升级时弹出庆祝通知，支持多级连升
- 🏷️ **玩家自定义名称**：设置面板可修改昵称，同步到所有游戏模式
- 🎯 **新手引导**：首次进入游戏时弹出引导面板，介绍模式选择、选牌出牌、快捷键、成就系统
- 🖐️ **卡牌悬停放大**：桌面端鼠标悬停在手牌上时卡牌微微上浮放大
- ⚡ **游戏速度设置**：慢速(0.7x)/正常/快速(1.5x)/极速(2.0x)，调节 AI 思考延迟
- 🤖 **AI 思考指示器**：AI/托管玩家思考时显示 "..." 动画
- 📈 **得分滚动动画**：结算弹窗中得分数字从 0 滚动到实际值
- 📋 **牌局分享**：结算弹窗一键生成对局结果文本并复制到剪贴板
- 📊 **本局统计**：结算弹窗显示各玩家出牌次数和炸弹数量
- 🔊 **音效补全**：春天结算播放春天音效，每局结束播放得分变化音效
- 🎨 **6 个主题**：经典绿、红木、夜空蓝、海洋、秋日、紫晶
- 📱 **PWA 支持**：manifest.json、应用图标、主题色、iOS Safari 适配
- 👁️ **观战模式增强**：显示所有玩家手牌、AI 思考时预览其计划出牌
- 📜 **出牌历史增强**：炸弹/王炸/不出分别用红/金/灰色标注，显示相对时间戳
- 💡 **快捷键提示可点击**：游戏内底部提示文字点击展开帮助面板
- 👤 **玩家悬浮提示**：鼠标悬停在玩家头像上显示手牌数和托管状态

**Bug 修复**
- 🔊 **音效开关全局可用**：修复音效开关只在 LAN 模式下有效的问题，移至全局绑定

---

### v1.1.5 — 部署路径修复

**Bug 修复**
- 🌐 **GitHub Pages 资源路径**：修复 vite 配置缺少 `base` 导致 CSS/JS 在子路径部署（`https://user.github.io/repo/`）下加载失败的问题，所有 screen 同时堆叠显示
  - `vite.config.js` 新增 `base: './'`，构建后资源使用相对路径
  - 部署后需重新执行 `npm run build` 并推送 `dist/` 到 gh-pages

---

### v1.1.4 — 全局逻辑与竞态修复

**Bug 修复**
- 🛡️ **GameState 事件异常保护**：`emit()` 中添加 try-catch，防止单个事件监听器异常导致后续监听器被跳过
- 🧹 **GameState 事件注销**：新增 `off(event, callback)` 方法，完善事件系统生命周期
- 🃏 **癞子标记清理**：`startRound()` 中清除所有传入 Card 的 `isLaizi` 标记，防止自定义模式预设牌对象重用时残留旧标记
- 🔒 **游戏循环并发锁**：`_processCalling`、`_processPlay`、`_autoPlayForHuman` 新增互斥锁（`_isProcessingCalling` / `_isProcessingPlay` / `_isAutoPlaying`）+ `try-finally` 确保异常时锁释放，防止托管切换等场景下产生并发竞态
- 🔄 **renderHands 状态同步**：`renderHands()` 开头自动调用 `clearSelection()`，避免 DOM 重建后与 `selectedCards` 状态不一致

---

### v1.1.3 — 连接安全与生命周期修复

**Bug 修复**
- 🔌 **LAN 模式 WebSocket 泄漏**：修复反复进入/退出局域网联机时旧 WebSocket 连接未被关闭的问题，新增 `LANMode.destroy()` 方法清理 ws 和重连定时器
- 🔄 **LAN 模式无限重连**：修复断线后无限制重连的问题，现在最多重试 `CONFIG.ws.maxReconnectAttempts`（5次），超限后提示用户重新进入
- 🛡️ **Renderer 销毁保护**：新增 `_destroyed` 标志，防止 `showRoundResult` 中延迟触发的庆祝动画（`winCelebrate`/`springCelebrate`/`flashScreen`）在返回菜单后仍被执行
- 📦 **测试脚本**：`package.json` 新增 `"test": "node test/core.test.mjs"` 脚本，支持 `npm test` 一键运行核心逻辑测试

---

### v1.1.2 — 深度全面修复

**Bug 修复**
- 🎹 **键盘快捷键可靠性**：叫分快捷键（1/2/3/0/ESC）现在会检查 `humanCall` 返回值后再隐藏面板，防止在非法状态下错误关闭控制面板
- 💡 **提示功能精准化**：修复提示（H键）未正确判断新轮次的问题，现在会结合 `passCount >= 2` 和上一轮出牌者身份给出正确建议
- 🎊 **庆祝动画分离**：修复 `springCelebrate` 与 `winCelebrate` 共享同一防抖标志导致“春天+胜利”时春天动画被吞掉的 bug
- 🤖 **托管即时响应**：修复出牌/叫分阶段中途点击“托管”后 AI 不立即接管的 bug，新增 `triggerAutoIfNeeded` 机制
- 🎵 **飞机带翅膀音效**：修复飞机带单/带对（`TRIPLE_STRAIGHT_WITH_SINGLES/PAIRS`）未被识别为飞机音效和 AI 短语的问题
- 🧹 **Renderer 生命周期**：修复 `showMenu()` 和 `startAIMode()` 未调用 `destroy()` 导致键盘事件监听器泄漏的隐患
- 📊 **观战模式统计隔离**：修复观战模式（`humanIndex = -1`）仍被计入总局数和负场的 bug
- 📈 **统计面板实时更新**：修复已有统计面板时 `_renderStats()` 不刷新数值的问题
- 🃏 **重选清除提示**：修复按 R 重选时 `.hint` 高亮 class 未被清除的问题
- 🧼 **癞子状态清理**：修复 `resetRound()` 未重置 `laiziEnabled` 标志的隐患
- 🫧 **气泡元素标记**：为 `call-bubble`、`pass-bubble`、`chat-bubble` 统一添加 `data-anim-fx` 标记，确保返回菜单后正确清理
- 🔄 **返回菜单平滑过渡**：结算面板“返回菜单”按钮从 `window.location.reload()` 改为调用 `showMenu()`，避免整页刷新
- 🎯 **观战模式结果判定**：修复 `showRoundResult` 中观战模式（`humanIndex=-1`）`isHumanWin` 恒为 `true` 导致错误播放胜利动画/音效的 bug
- 🗺️ **观战模式座位映射**：修复 `_getPlayerArea` 在 `humanIndex=-1` 时玩家区域映射错乱的问题
- 🫨 **屏幕震动恢复**：`destroy()` 中强制重置 `document.body.style.transform`，防止 `screenShake` 在切换屏幕后残留偏移
- 🍞 **Toast 残留清理**：为 `toast-message` 元素添加 `data-anim-fx` 标记，确保返回菜单后被统一清理
- ⏱️ **托管安全守卫**：`_autoPlayForHuman` 在延迟前后增加 `isRunning` 和 `phase === PLAYING` 检查，防止对已结束的游戏尝试出牌
- 🔗 **向后兼容**：`AIPlayer.getHint` 在未传入 `isNewRound` 时自动从 `lastPattern` 推断，避免破坏现有测试和调用方
- 🧹 **后端清理完善**：`RoomManager.destroy()` 补充 `playerToRoom.clear()`，防止服务器优雅关闭时映射泄漏

---

### v1.1.1 — 人机交互与回放修复

**Bug 修复（13项）**
- 修复人类玩家出牌后手牌未实时更新（`renderHands` 在 `animatePlay` 中补调）
- 修复地主获得底牌后手牌未实时更新（`renderHands` 在 `showLandlord` 中补调）
- 修复 AI 牌背显示为空白（补充 `.card-inner` 子元素）
- 修复叫分按钮点击后无条件隐藏面板（增加 `success` 检查）
- 修复抢地主模式按钮 `dataset.call` 状态残留导致按钮消失
- 修复结算弹窗缩放动画只能播放一次（移除并重新添加 `modal-scale-in`）
- 修复返回菜单后侧边面板仍然显示（`destroy()` 中主动隐藏）
- 修复抢地主模式键盘快捷键与按钮状态不匹配（动态提示 + Toast）
- 修复 LAN 观战模式 `humanIndex=-1` 时 `isHumanWin` 统计错误
- 修复 `_sequence` 音符在 AudioContext 未解锁时全部同时播放（改为 `async` + `_ensureContext`）
- 修复回放切换旧局时旧 `playTimer` 仍在运行（`startReplay` 中先 `stop()`）
- 修复回放全程无音效（新增 `_playStepSound` 映射牌型到 SFX）
- 修复回放 slider 拖动时音效 spam（新增 `goToStepSilent` 静默跳转）

### v1.1.0 — UI/UX/BGM/SFX 全面升级

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

### v1.0.0 — 初始版本
- 人机对战、局域网联机、自定义模式三大玩法
- 12 种牌型规则引擎、AI 策略、提示系统
- 叫分/抢地主、春天/反春天、炸弹倍数
- 记牌器、出牌历史、游戏内聊天
- localStorage 数据持久化、统计面板
- 响应式布局、移动端触摸支持

## 许可证

MIT

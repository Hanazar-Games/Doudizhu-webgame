/**
 * Renderer - UI渲染与交互管理
 * 负责：手牌渲染、出牌动画、控制面板、状态显示、记牌器、历史记录
 */

import { Card } from '../core/card.js';
import { Rules, HAND_TYPE } from '../core/rules.js';
import { GameState, PHASE } from '../core/game-state.js';
import { AIPlayer } from '../players/ai-player.js';
import { AudioManager } from './audio.js';
import { Animations } from './animations.js';

class Renderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this._destroyed = false;
        this._isPaused = false;
        this.gameState = null;
        this.mode = null;
        this.audio = new AudioManager();
        this.anim = new Animations(document.body);

        // UI状态
        this.selectedCards = new Set();
        this.hintCards = [];
        this._selectionHistory = []; // 选牌历史，用于撤销

        this._initLayout();
        this._keyboardHandler = null;
        this._bindKeyboard();
        this._trackerData = null;
    }

    destroy() {
        this._destroyed = true;
        this._isPaused = false;
        this._removePauseOverlay();
        this._removeHelpPanel();
        if (this._keyboardHandler) {
            document.removeEventListener('keydown', this._keyboardHandler);
            this._keyboardHandler = null;
        }
        this.audio?.stopBGM();
        this.audio = null;
        this.mode = null;
        this.gameState = null;
        this.anim = null;
        // 清理选牌状态
        this.selectedCards.clear();
        this.hintCards = [];
        this._selectionHistory = [];
        this._trackerData = null;
        // 清理动画残留元素
        document.querySelectorAll('[data-anim-fx="true"]').forEach(el => {
            try { el.remove(); } catch (e) {}
        });
        // 隐藏侧边面板，防止它们出现在其他屏幕上
        this.container?.querySelector('#card-tracker')?.classList.add('hidden');
        this.container?.querySelector('#play-history')?.classList.add('hidden');
        this.container?.querySelector('#chat-panel')?.classList.add('hidden');
        // 强制恢复 body transform，防止 screenShake 残留偏移
        document.body.style.transform = '';
        // 清理拖拽选择监听器
        const handContainer = this.container?.querySelector('#player-right .hand-front');
        if (handContainer?._dragCleanup) {
            handContainer._dragCleanup();
            handContainer._dragCleanup = null;
        }
        this.container = null;
    }

    setGameState(gameState) {
        this.gameState = gameState;
    }

    setMode(mode) {
        this.mode = mode;
    }

    _initLayout() {
        if (!this.container) return;
        this.container.innerHTML = `
            <div id="ddz-table">
                <div class="table-aura" aria-hidden="true"></div>
                <div id="player-top" class="player-area" data-index="1">
                    <div class="player-info">
                        <div class="player-avatar">🤖</div>
                        <div class="player-name">AI-东</div>
                        <div class="player-badge"></div>
                        <div class="player-tooltip"></div>
                    </div>
                    <div class="hand-back"></div>
                    <div class="played-area"></div>
                </div>
                <div id="player-left" class="player-area" data-index="2">
                    <div class="player-info">
                        <div class="player-avatar">🤖</div>
                        <div class="player-name">AI-西</div>
                        <div class="player-badge"></div>
                        <div class="player-tooltip"></div>
                    </div>
                    <div class="hand-back"></div>
                    <div class="played-area"></div>
                </div>
                <div id="player-right" class="player-area" data-index="0">
                    <div class="player-info">
                        <div class="player-avatar">👤</div>
                        <div class="player-name">玩家</div>
                        <div class="player-badge"></div>
                        <div class="player-tooltip"></div>
                    </div>
                    <div id="hand-hint-text" class="hand-hint"></div>
                    <div class="hand-front"></div>
                    <div class="played-area"></div>
                </div>
                <div id="table-center">
                    <div id="bottom-cards" class="hidden">
                        <div class="label">底牌</div>
                        <div class="cards"></div>
                    </div>
                    <div id="last-play-info">
                        <div id="last-play-type"></div>
                    </div>
                    <div id="turn-indicator" aria-live="polite"></div>
                </div>
            </div>
            <div id="side-panels">
                <button id="btn-toggle-card-tracker" class="btn-panel-toggle" title="打开记牌器">🃏 记牌器</button>
                <button id="btn-toggle-history" class="btn-panel-toggle" title="查看出牌历史">📜 历史</button>
                <button id="btn-toggle-chat" class="btn-panel-toggle" title="发送快捷短语">💬 聊天</button>
                <div id="card-tracker" class="side-panel hidden">
                    <h4>记牌器</h4>
                    <div class="tracker-grid" id="tracker-content"></div>
                </div>
                <div id="play-history" class="side-panel hidden">
                    <h4>出牌历史</h4>
                    <div class="history-list" id="history-content"></div>
                    <div style="display:flex;gap:6px;margin-top:8px">
                        <button id="btn-export-history" class="btn-small" style="flex:1">📋 导出</button>
                        <button id="btn-clear-history" class="btn-small" style="flex:1">🗑️ 清空</button>
                    </div>
                </div>
                <div id="chat-panel" class="side-panel hidden">
                    <h4>聊天</h4>
                    <div class="quick-phrases" id="quick-phrases"></div>
                    <div class="chat-list" id="chat-content"></div>
                    <div class="chat-input-area">
                        <input type="text" id="chat-input" placeholder="输入消息..." maxlength="100">
                        <button id="btn-chat-send">发送</button>
                    </div>
                </div>
            </div>
            <div id="controls-area">
                <div id="call-controls" class="hidden">
                    <button data-call="0">不叫</button>
                    <button data-call="1">1分</button>
                    <button data-call="2">2分</button>
                    <button data-call="3">3分</button>
                    <button id="btn-auto-call" class="btn-auto">托管</button>
                </div>
                <div id="play-controls" class="hidden">
                    <button id="btn-play">出牌 <kbd>Space</kbd></button>
                    <button id="btn-pass">不出 <kbd>P</kbd></button>
                    <button id="btn-hint">提示 <kbd>H</kbd></button>
                    <button id="btn-reset">重选 <kbd>R</kbd></button>
                    <button id="btn-auto-play" class="btn-auto">托管</button>
                </div>
                <div id="game-info">
                    <span id="phase-text">准备中</span>
                    <span id="score-text"></span>
                    <span id="shortcut-hint">快捷键: H提示 P不出 Space出牌</span>
                </div>
            </div>
            <div id="modal-overlay" class="hidden">
                <div id="modal-content"></div>
            </div>
        `;

        this._bindControls();
        this._bindPanelToggles();
    }

    _bindRipple(btn) {
        if (!btn) return;
        const addRipple = (e) => {
            const x = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
            const y = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
            this.anim.ripple(x, y, 'rgba(240,192,64,0.3)');
        };
        btn.addEventListener('mousedown', addRipple);
        btn.addEventListener('touchstart', addRipple, { passive: true });
    }

    _bindControls() {

        // 叫分按钮
        const callBtns = this.container.querySelectorAll('#call-controls button[data-call]');
        for (const btn of callBtns) {
            btn.addEventListener('click', (e) => {
                this.audio.playButtonClick();
                if (this.gameState?.phase !== PHASE.CALLING || this.gameState?.currentTurn !== this.mode?.humanIndex) {
                    this.hideCallControls();
                    this.showToast('当前不在叫地主阶段', 'info');
                    return;
                }
                const action = parseInt(e.target.dataset.call);
                if (this.mode) {
                    const success = this.mode.humanCall(action);
                    if (success) this.hideCallControls();
                } else {
                    this.hideCallControls();
                }
            });
            this._bindRipple(btn);
        }

        // 出牌按钮
        const btnPlay = this.container.querySelector('#btn-play');
        const btnPass = this.container.querySelector('#btn-pass');
        const btnReset = this.container.querySelector('#btn-reset');
        const btnHint = this.container.querySelector('#btn-hint');

        btnPlay?.addEventListener('click', () => { this.audio.playButtonClick(); this._doPlay(); });
        btnPass?.addEventListener('click', () => { this.audio.playButtonClick(); this._doPass(); });
        btnReset?.addEventListener('click', () => { this.audio.playButtonClick(); this.clearSelection(); });
        btnHint?.addEventListener('click', () => { this.audio.playButtonClick(); this._doHint(); });
        [btnPlay, btnPass, btnReset, btnHint].forEach(b => this._bindRipple(b));

        // 托管按钮
        const btnAutoCall = this.container.querySelector('#btn-auto-call');
        const btnAutoPlay = this.container.querySelector('#btn-auto-play');
        btnAutoCall?.addEventListener('click', () => { this.audio.playButtonClick(); this._toggleAuto(); });
        btnAutoPlay?.addEventListener('click', () => { this.audio.playButtonClick(); this._toggleAuto(); });
        [btnAutoCall, btnAutoPlay].forEach(b => this._bindRipple(b));
    }

    _bindPanelToggles() {
        this._initQuickPhrases();

        const btnTracker = this.container.querySelector('#btn-toggle-card-tracker');
        const btnHistory = this.container.querySelector('#btn-toggle-history');
        const btnChat = this.container.querySelector('#btn-toggle-chat');
        const tracker = this.container.querySelector('#card-tracker');
        const history = this.container.querySelector('#play-history');
        const chat = this.container.querySelector('#chat-panel');

        btnTracker?.addEventListener('click', () => {
            this.audio.playButtonClick();
            tracker.classList.toggle('hidden');
            history.classList.add('hidden');
            chat?.classList.add('hidden');
        });
        this._bindRipple(btnTracker);
        btnHistory?.addEventListener('click', () => {
            this.audio.playButtonClick();
            history.classList.toggle('hidden');
            tracker.classList.add('hidden');
            chat?.classList.add('hidden');
        });
        this._bindRipple(btnHistory);
        btnChat?.addEventListener('click', () => {
            this.audio.playButtonClick();
            chat.classList.toggle('hidden');
            tracker.classList.add('hidden');
            history.classList.add('hidden');
        });
        this._bindRipple(btnChat);

        // 聊天输入
        const chatInput = this.container.querySelector('#chat-input');
        const btnSend = this.container.querySelector('#btn-chat-send');

        const sendChat = () => {
            const text = chatInput?.value?.trim();
            if (!text) return;
            this.audio.playButtonClick();
            this._sendChatMessage(text);
            chatInput.value = '';
        };

        btnSend?.addEventListener('click', sendChat);
        chatInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendChat();
        });

        // 导出出牌历史
        const btnExportHistory = this.container.querySelector('#btn-export-history');
        btnExportHistory?.addEventListener('click', () => {
            this.audio.playButtonClick();
            this._exportHistory();
        });

        // 清空出牌历史
        const btnClearHistory = this.container.querySelector('#btn-clear-history');
        btnClearHistory?.addEventListener('click', () => {
            this.audio.playButtonClick();
            const content = this.container.querySelector('#history-content');
            if (content) content.innerHTML = '';
        });

        // 快捷键提示点击展开帮助
        const shortcutHint = this.container.querySelector('#shortcut-hint');
        shortcutHint?.addEventListener('click', () => {
            this.audio.playButtonClick();
            this._toggleHelpPanel();
        });
    }

    _initQuickPhrases() {
        const container = this.container.querySelector('#quick-phrases');
        if (!container) return;

        const phrases = [
            { text: '快点吧，我等到花儿都谢了', icon: '⏰' },
            { text: '你的牌打得也太好了', icon: '👏' },
            { text: '不要走，决战到天亮', icon: '🌙' },
            { text: '和你合作真是太愉快了', icon: '🤝' },
            { text: '王炸！', icon: '💥' },
            { text: '炸弹！', icon: '💣' },
            { text: '这牌没法打了', icon: '😭' },
            { text: '十七张牌你能秒我？', icon: '🃏' },
        ];

        phrases.forEach((p, i) => {
            const btn = document.createElement('button');
            btn.textContent = p.icon;
            btn.title = p.text;
            btn.style.opacity = '0';
            btn.style.transform = 'scale(0.5)';
            btn.style.transition = `all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) ${i * 50}ms`;
            btn.addEventListener('click', () => {
                this.audio.playButtonClick();
                this._sendChatMessage(p.text);
            });
            container.appendChild(btn);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    btn.style.opacity = '1';
                    btn.style.transform = 'scale(1)';
                });
            });
        });
    }

    _sendChatMessage(text) {
        this.audio.playChat();
        // 如果是LAN模式，通过WebSocket发送
        if (this.mode?.modeName === 'lan' && this.mode._send) {
            this.mode._send({
                type: 'chat',
                text,
                playerName: this.gameState?.players[this.mode?.humanIndex]?.name || '玩家',
                broadcast: true,
            });
        }
        // 本地显示
        this._addChatMessage({
            sender: this.gameState?.players[this.mode?.humanIndex]?.name || '我',
            text,
            isSelf: true,
        });
    }

    _addChatMessage(msg) {
        const content = this.container.querySelector('#chat-content');
        if (!content) return;

        const entry = document.createElement('div');
        entry.className = 'chat-message';
        const senderSpan = document.createElement('span');
        senderSpan.className = 'chat-sender';
        senderSpan.textContent = msg.sender + ':';
        entry.appendChild(senderSpan);
        entry.appendChild(document.createTextNode(msg.text));
        content.appendChild(entry);
        content.scrollTop = content.scrollHeight;

        // 限制消息数
        while (content.children.length > 50) {
            content.removeChild(content.firstChild);
        }
    }

    receiveChat(data) {
        if (data.playerIndex === this.mode?.humanIndex) return;
        this._addChatMessage({
            sender: data.playerName || `玩家${data.playerIndex + 1}`,
            text: data.text,
            isSelf: false,
        });
    }

    _bindKeyboard() {
        this._keyboardHandler = (e) => {
            // 只在游戏界面响应
            if (document.getElementById('game-screen')?.classList.contains('hidden')) return;

            // 忽略输入框中的按键（聊天、输入等）
            const target = e.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                return;
            }

            // ? 键切换快捷键帮助面板
            if (e.key === '?' || e.key === '／' || e.key === '/') {
                e.preventDefault();
                this._toggleHelpPanel();
                return;
            }

            // Escape 暂停/恢复
            if (e.key === 'Escape') {
                e.preventDefault();
                if (this._isPaused) {
                    this._resumeGame();
                } else {
                    this._pauseGame();
                }
                return;
            }

            // 暂停状态下屏蔽游戏操作
            if (this._isPaused) return;

            const phase = this.gameState?.phase;
            const isMyTurn = this.gameState?.currentTurn === this.mode?.humanIndex;

            if (phase === PHASE.CALLING && isMyTurn && this.mode) {
                const isGrab = this.gameState?.callMode === 'grab';
                const isGrabPhase = this.gameState?.grabPhase === 'grab';
                if (e.key === '1') {
                    e.preventDefault();
                    this.audio.playButtonClick();
                    if (isGrab && isGrabPhase) {
                        this.showToast('抢地主请按 2', 'info');
                    } else {
                        const success = this.mode.humanCall(1);
                        if (success) this.hideCallControls();
                    }
                }
                if (e.key === '2') {
                    e.preventDefault();
                    this.audio.playButtonClick();
                    if (isGrab && !isGrabPhase) {
                        this.showToast('叫地主请按 1', 'info');
                    } else {
                        const success = this.mode.humanCall(2);
                        if (success) this.hideCallControls();
                    }
                }
                if (e.key === '3') {
                    e.preventDefault();
                    this.audio.playButtonClick();
                    if (isGrab) {
                        this.showToast('抢地主模式不支持 3 分', 'info');
                    } else {
                        const success = this.mode.humanCall(3);
                        if (success) this.hideCallControls();
                    }
                }
                if (e.key === '0') {
                    e.preventDefault();
                    this.audio.playButtonClick();
                    const success = this.mode.humanCall(0);
                    if (success) this.hideCallControls();
                }
                return;
            }

            if (phase === PHASE.PLAYING && isMyTurn && this.mode) {
                if (e.code === 'Space') { e.preventDefault(); this.audio.playButtonClick(); this._doPlay(); }
                if (e.key === 'p' || e.key === 'P') { e.preventDefault(); this.audio.playButtonClick(); this._doPass(); }
                if (e.key === 'h' || e.key === 'H') { e.preventDefault(); this.audio.playButtonClick(); this._doHint(); }
                if (e.key === 'r' || e.key === 'R') { e.preventDefault(); this.audio.playButtonClick(); this.clearSelection(); }

                // 数字键快速选牌 (1-9对应第1-9张)
                if (e.key >= '1' && e.key <= '9') {
                    const idx = parseInt(e.key) - 1;
                    this._toggleCardByIndex(idx);
                }
            }

            // 全局快捷键（不限制游戏阶段）
            if (e.key === 'm' || e.key === 'M') {
                e.preventDefault();
                const enabled = this.audio.toggle();
                this.showToast(enabled ? '🔊 音效已开启' : '🔇 音效已关闭');
                const btn = document.getElementById('btn-sound-toggle');
                if (btn) btn.textContent = enabled ? '🔊' : '🔇';
            }
            if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                this._zoomTable(0.1);
            }
            if (e.key === '-' || e.key === '_') {
                e.preventDefault();
                this._zoomTable(-0.1);
            }
        };
        document.addEventListener('keydown', this._keyboardHandler);
    }

    _pauseGame() {
        if (this._isPaused) return;
        this._isPaused = true;
        this.mode?.pauseGame?.();
        this.audio?.stopBGM();
        this._showPauseOverlay();
    }

    _resumeGame() {
        if (!this._isPaused) return;
        this._isPaused = false;
        this.mode?.resumeGame?.();
        this._removePauseOverlay();
        this.audio?.playGameBGM();
    }

    _zoomTable(delta) {
        const table = this.container?.querySelector('#ddz-table');
        if (!table) return;
        const current = parseFloat(table.dataset.zoom || '1');
        const next = Math.max(0.7, Math.min(1.3, current + delta));
        table.dataset.zoom = String(next);
        table.style.transform = `scale(${next})`;
        table.style.transformOrigin = 'center center';
    }

    _showPauseOverlay() {
        let overlay = document.getElementById('pause-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'pause-overlay';
            overlay.innerHTML = `
                <div class="pause-content">
                    <h2>⏸ 游戏暂停</h2>
                    <p>按 <kbd>ESC</kbd> 或点击按钮继续</p>
                    <button id="btn-resume" class="btn-primary">继续游戏</button>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.querySelector('#btn-resume')?.addEventListener('click', () => this._resumeGame());
        }
        overlay.style.display = 'flex';
    }

    _removePauseOverlay() {
        const overlay = document.getElementById('pause-overlay');
        if (overlay) overlay.remove();
    }

    _removeHelpPanel() {
        const panel = document.getElementById('help-panel');
        if (panel) panel.remove();
    }

    _toggleHelpPanel() {
        let panel = document.getElementById('help-panel');
        if (panel) {
            panel.remove();
            return;
        }
        panel = document.createElement('div');
        panel.id = 'help-panel';
        panel.innerHTML = `
            <div class="help-content">
                <h3>⌨️ 快捷键指南</h3>
                <div class="help-grid">
                    <div class="help-item"><kbd>Space</kbd><span>出牌</span></div>
                    <div class="help-item"><kbd>P</kbd><span>不出</span></div>
                    <div class="help-item"><kbd>H</kbd><span>提示</span></div>
                    <div class="help-item"><kbd>R</kbd><span>重选</span></div>
                    <div class="help-item"><kbd>1~9</kbd><span>快速选牌</span></div>
                    <div class="help-item"><kbd>1</kbd><span>叫1分/叫地主</span></div>
                    <div class="help-item"><kbd>2</kbd><span>叫2分/抢地主</span></div>
                    <div class="help-item"><kbd>3</kbd><span>叫3分</span></div>
                    <div class="help-item"><kbd>0</kbd><span>不叫/不抢</span></div>
                    <div class="help-item"><kbd>ESC</kbd><span>暂停/恢复</span></div>
                    <div class="help-item"><kbd>?</kbd><span>本帮助面板</span></div>
                    <div class="help-item"><kbd>M</kbd><span>静音切换</span></div>
                    <div class="help-item"><kbd>+/-</kbd><span>牌桌缩放</span></div>
                </div>
                <h3 style="margin-top:16px">🃏 牌型规则</h3>
                <div class="help-grid rules-grid">
                    <div class="help-item"><span class="rule-name">单牌</span><span>任意一张</span></div>
                    <div class="help-item"><span class="rule-name">对子</span><span>两张相同点数</span></div>
                    <div class="help-item"><span class="rule-name">三张</span><span>三张相同点数</span></div>
                    <div class="help-item"><span class="rule-name">三带一</span><span>三张 + 一张</span></div>
                    <div class="help-item"><span class="rule-name">三带二</span><span>三张 + 一对</span></div>
                    <div class="help-item"><span class="rule-name">顺子</span><span>5张+连续单牌</span></div>
                    <div class="help-item"><span class="rule-name">连对</span><span>3对+连续对子</span></div>
                    <div class="help-item"><span class="rule-name">飞机</span><span>两组+连续三张</span></div>
                    <div class="help-item"><span class="rule-name">飞机带翼</span><span>飞机 + 同数量单/对</span></div>
                    <div class="help-item"><span class="rule-name">炸弹</span><span>四张相同点数</span></div>
                    <div class="help-item"><span class="rule-name">王炸</span><span>大王+小王</span></div>
                    <div class="help-item"><span class="rule-name">四带二</span><span>四张 + 两张/两对</span></div>
                </div>
                <p class="help-tip">💡 提示：可按住鼠标左键在手牌上滑动进行多选</p>
                <button id="btn-help-close" class="btn-small">关闭</button>
            </div>
        `;
        document.body.appendChild(panel);
        panel.addEventListener('click', (e) => {
            if (e.target === panel || e.target.id === 'btn-help-close') panel.remove();
        });
    }

    _doPlay() {
        if (!this._isHumanPlayTurn()) {
            this.showToast(this.gameState?.phase === PHASE.CALLING ? '请先完成叫地主' : '还没轮到你出牌', 'info');
            return;
        }

        const selection = this._getPlayableSelection(this._getSelectedCards());
        const cards = selection.cards;
        if (cards.length === 0) {
            this.showToast('请先选择牌', 'error');
            return;
        }

        if (selection.optimized) {
            this._syncSelectedCards(cards, { pop: true });
            const dropped = selection.dropped > 0 ? `，去掉 ${selection.dropped} 张重复/多余牌` : '';
            this.showToast(`已整理为${Rules.getTypeName(selection.pattern.type)}${dropped}`, 'success');
        }

        const result = this.mode?.humanPlay(cards);
        if (result && !result.success) {
            this.showToast(result.error || '出牌失败', 'error');
            this._shakeSelection();
        } else {
            this.clearSelection();
            this.hidePlayControls();
            this._clearHint();
        }
    }

    _doPass() {
        if (!this._isHumanPlayTurn()) {
            this.showToast(this.gameState?.phase === PHASE.CALLING ? '叫地主阶段不能不出' : '还没轮到你', 'info');
            return;
        }
        const success = this.mode?.humanPass();
        if (!success) {
            this.showToast('当前不能不出', 'error');
        } else {
            this.clearSelection();
            this.hidePlayControls();
            this._clearHint();
        }
    }

    _doHint() {
        if (!this._isHumanPlayTurn()) {
            this.showToast(this.gameState?.phase === PHASE.CALLING ? '请先叫地主' : '还没轮到你', 'info');
            return;
        }
        const player = this.gameState?.players[this.mode?.humanIndex];
        if (!player || player.isAI) return;

        this.audio.playHint();

        const lastPattern = this.gameState?.lastPlay?.pattern;
        const isNewRound = !lastPattern || lastPattern.type === 'INVALID' ||
                           (this.gameState?.passCount >= 2) ||
                           (this.gameState?.lastPlay?.playerIndex === this.mode?.humanIndex);
        const ai = new AIPlayer('hint', 'hard');
        ai.hand = player.hand;
        const hint = ai.getHint(player.hand, lastPattern, isNewRound);

        if (hint.length === 0) {
            this.showToast('建议：不出');
            return;
        }

        // 清除旧提示
        this._clearHint();
        this.hintCards = hint;

        // 高亮提示的牌
        const handContainer = this.container.querySelector('#player-right .hand-front');
        const cardEls = handContainer?.querySelectorAll('.card');
        if (!cardEls) return;

        // 先清空选择
        this.clearSelection();

        // 按顺序选中提示的牌
        const sortedHand = Card.sortByValue(player.hand);
        for (const targetCard of hint) {
            const idx = sortedHand.findIndex(c => c === targetCard);
            if (idx >= 0 && cardEls[idx]) {
                cardEls[idx].classList.add('hint');
                this.selectedCards.add(targetCard);
                cardEls[idx].classList.add('selected');
            }
        }

        // 显示牌型
        this._updateHandHint(hint);
    }

    _clearHint() {
        this.hintCards = [];
        const handContainer = this.container.querySelector('#player-right .hand-front');
        handContainer?.querySelectorAll('.card.hint').forEach(el => el.classList.remove('hint'));
    }

    _toggleAuto() {
        const player = this.gameState?.players[this.mode?.humanIndex];
        if (!player) return;

        player.isAuto = !player.isAuto;
        this.audio.playAutoToggle(player.isAuto);
        this.showToast(player.isAuto ? '已开启托管' : '已取消托管');
        this._updateAutoButton(player.isAuto);

        // 如果当前是玩家回合且开启托管，触发自动出牌
        if (player.isAuto && this.gameState?.currentTurn === this.mode?.humanIndex) {
            this.hideCallControls();
            this.hidePlayControls();
            // 通知模式触发自动处理
            this.mode?.triggerAutoIfNeeded?.();
        }
    }

    _updateAutoButton(isAuto) {
        const btns = this.container.querySelectorAll('.btn-auto');
        for (const btn of btns) {
            btn.textContent = isAuto ? '取消托管' : '托管';
            btn.classList.toggle('active', isAuto);
        }
    }

    _updateHandHint(cards) {
        const hintEl = this.container.querySelector('#hand-hint-text');
        if (!hintEl) return;
        if (cards.length === 0) {
            hintEl.textContent = '';
            hintEl.className = 'hand-hint';
            this._renderSmartSelection(null);
            return;
        }
        if (this.gameState?.phase !== PHASE.PLAYING) {
            hintEl.textContent = '先完成叫地主';
            hintEl.className = 'hand-hint info';
            this._renderSmartSelection(null);
            return;
        }
        const pattern = Rules.analyze(cards);
        if (pattern.isValid()) {
            hintEl.textContent = `${Rules.getTypeName(pattern.type)} (主牌: ${pattern.mainValue})`;
            hintEl.className = 'hand-hint valid';
            this._renderSmartSelection(null);
        } else {
            const playable = this._getPlayableSelection(cards);
            if (playable.optimized && playable.pattern?.isValid?.()) {
                const dropped = playable.dropped > 0 ? ` · 去掉${playable.dropped}张` : '';
                hintEl.textContent = `可出${Rules.getTypeName(playable.pattern.type)}${dropped}`;
                hintEl.className = 'hand-hint valid smart';
                this._renderSmartSelection(playable);
            } else {
                hintEl.textContent = '非法牌型';
                hintEl.className = 'hand-hint invalid';
                this._renderSmartSelection(null);
            }
        }
    }

    _isHumanPlayTurn() {
        return this.gameState?.phase === PHASE.PLAYING &&
            this.mode?.humanIndex >= 0 &&
            this.gameState?.currentTurn === this.mode.humanIndex;
    }

    _getPlayContext() {
        const playerIndex = this.mode?.humanIndex;
        const lastPattern = this.gameState?.lastPlay?.pattern;
        const isNewRound = !lastPattern || lastPattern.type === HAND_TYPE.INVALID ||
            (this.gameState?.passCount >= 2) ||
            (this.gameState?.lastPlay?.playerIndex === playerIndex);
        return { playerIndex, lastPattern, isNewRound };
    }

    _getPlayableSelection(cards) {
        const sorted = Card.sortByValue(cards || []);
        const empty = { cards: [], pattern: Rules.analyze([]), optimized: false, dropped: 0 };
        if (sorted.length === 0) return empty;

        const { lastPattern, isNewRound } = this._getPlayContext();
        const directPattern = Rules.analyze(sorted);
        if (directPattern.isValid() && (isNewRound || Rules.canBeat(lastPattern, directPattern))) {
            return { cards: sorted, pattern: directPattern, optimized: false, dropped: 0 };
        }

        const candidates = [
            ...this._extractSequentialSubsets(sorted, HAND_TYPE.STRAIGHT, 1, 5),
            ...this._extractSequentialSubsets(sorted, HAND_TYPE.DOUBLE_STRAIGHT, 2, 3),
            ...this._extractSequentialSubsets(sorted, HAND_TYPE.TRIPLE_STRAIGHT, 3, 2),
            ...this._extractPrunedValidSubsets(sorted),
        ].filter(candidate => {
            if (!candidate.pattern?.isValid?.()) return false;
            return isNewRound || Rules.canBeat(lastPattern, candidate.pattern);
        });

        if (candidates.length === 0) {
            return { cards: sorted, pattern: directPattern, optimized: false, dropped: 0 };
        }

        const targetType = !isNewRound ? lastPattern?.type : null;
        candidates.sort((a, b) => {
            const aTypeScore = targetType && a.pattern.type === targetType ? 10000 : 0;
            const bTypeScore = targetType && b.pattern.type === targetType ? 10000 : 0;
            if (aTypeScore !== bTypeScore) return bTypeScore - aTypeScore;
            if (a.cards.length !== b.cards.length) return b.cards.length - a.cards.length;
            return a.pattern.mainValue - b.pattern.mainValue;
        });

        const best = candidates[0];
        return {
            cards: best.cards,
            pattern: best.pattern,
            optimized: true,
            dropped: Math.max(0, sorted.length - best.cards.length),
        };
    }

    _extractSequentialSubsets(cards, type, groupSize, minRun) {
        const grouped = new Map();
        for (const card of cards) {
            if (card.value >= 15) continue; // 顺子/连对/飞机不含2和王
            if (!grouped.has(card.value)) grouped.set(card.value, []);
            grouped.get(card.value).push(card);
        }

        const values = [...grouped.keys()].filter(value => grouped.get(value).length >= groupSize).sort((a, b) => a - b);
        const runs = [];
        let current = [];
        for (const value of values) {
            if (current.length === 0 || value === current[current.length - 1] + 1) {
                current.push(value);
            } else {
                if (current.length >= minRun) runs.push(current);
                current = [value];
            }
        }
        if (current.length >= minRun) runs.push(current);

        const { lastPattern, isNewRound } = this._getPlayContext();
        const requiredRunLength = !isNewRound && lastPattern?.type === type
            ? Math.floor(lastPattern.length / groupSize)
            : null;
        const candidates = [];

        for (const run of runs) {
            const lengths = requiredRunLength
                ? [requiredRunLength]
                : Array.from({ length: run.length - minRun + 1 }, (_, i) => run.length - i);
            for (const len of lengths) {
                if (len < minRun || len > run.length) continue;
                for (let start = 0; start <= run.length - len; start++) {
                    const slice = run.slice(start, start + len);
                    const subset = slice.flatMap(value => grouped.get(value).slice(0, groupSize));
                    const pattern = Rules.analyze(subset);
                    if (pattern.type === type) {
                        candidates.push({ cards: Card.sortByValue(subset), pattern });
                    }
                }
            }
        }

        return candidates;
    }

    _extractPrunedValidSubsets(cards) {
        // 小规模误选时兜底：从选择中剔除多余牌，找出隐藏的最大合法牌型。
        if (!cards || cards.length < 2 || cards.length > 11) return [];

        const candidates = [];
        const seen = new Set();
        const totalMasks = 1 << cards.length;
        for (let mask = 1; mask < totalMasks; mask++) {
            if (mask === totalMasks - 1) continue;
            const subset = [];
            for (let i = 0; i < cards.length; i++) {
                if (mask & (1 << i)) subset.push(cards[i]);
            }

            const pattern = Rules.analyze(subset);
            if (!pattern.isValid()) continue;

            const key = subset.map(card => `${card.value}:${card.suit?.name || card.rankKey}`).join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            candidates.push({ cards: Card.sortByValue(subset), pattern });
        }

        return candidates;
    }

    _syncSelectedCards(cards, options = {}) {
        const targets = new Set(cards);
        this.selectedCards.clear();
        const handContainer = this.container.querySelector('#player-right .hand-front');
        const cardEls = handContainer?.querySelectorAll('.card');
        const player = this.gameState?.players[this.mode?.humanIndex];
        if (!player || !cardEls) return;

        const sorted = Card.sortByValue(player.hand);
        cardEls.forEach((el, idx) => {
            const card = sorted[idx];
            const shouldSelect = targets.has(card);
            this._setCardSelection(el, card, shouldSelect, options.pop && shouldSelect);
        });
        this._updateHandHint(this._getSelectedCards());
    }

    _renderSmartSelection(selection) {
        const handContainer = this.container?.querySelector('#player-right .hand-front');
        const cardEls = handContainer?.querySelectorAll('.card');
        const player = this.gameState?.players[this.mode?.humanIndex];
        if (!player || !cardEls) return;

        cardEls.forEach(el => el.classList.remove('smart-play', 'smart-drop'));
        if (!selection?.optimized) return;

        const playCards = new Set(selection.cards);
        const sorted = Card.sortByValue(player.hand);
        cardEls.forEach((el, idx) => {
            const card = sorted[idx];
            if (!this.selectedCards.has(card)) return;
            el.classList.add(playCards.has(card) ? 'smart-play' : 'smart-drop');
        });
    }

    _shakeSelection() {
        const handContainer = this.container.querySelector('#player-right .hand-front');
        handContainer?.classList.add('shake');
        setTimeout(() => handContainer?.classList.remove('shake'), 400);
    }

    _toggleCardByIndex(index) {
        if (this.gameState?.phase !== PHASE.PLAYING) {
            this.showToast('请先完成叫地主', 'info');
            return;
        }
        const player = this.gameState?.players[this.mode?.humanIndex];
        if (!player) return;
        const sorted = Card.sortByValue(player.hand);
        if (index >= sorted.length) return;

        const card = sorted[index];
        const handContainer = this.container.querySelector('#player-right .hand-front');
        const cardEls = handContainer?.querySelectorAll('.card');
        if (!cardEls || !cardEls[index]) return;

        this._toggleCardSelection(cardEls[index], card);
        this._updateHandHint(this._getSelectedCards());
    }

    _bindDragSelection(handContainer) {
        if (!handContainer) return;
        // 移除旧监听器
        if (handContainer._dragCleanup) {
            handContainer._dragCleanup();
            handContainer._dragCleanup = null;
        }

        let isDragging = false;
        let dragged = false;
        let startIndex = -1;
        let lastRangeKey = '';
        let rangeShouldSelect = true;
        let dragBaseSelection = new Set();
        let dragStartX = 0;
        let dragStartY = 0;
        const dragThreshold = () => {
            const raw = getComputedStyle(document.documentElement).getPropertyValue('--ddz-drag-threshold');
            return parseFloat(raw) || 7;
        };

        const getCardAt = (x, y) => {
            const el = document.elementFromPoint(x, y);
            if (!el) return null;
            const card = el.closest('.card');
            if (!card || !handContainer.contains(card)) return null;
            return card;
        };

        const applyRangeSelection = (endIndex) => {
            const player = this.gameState?.players[this.mode?.humanIndex];
            if (!player) return;
            const cardEls = Array.from(handContainer.querySelectorAll('.card'));
            const sorted = Card.sortByValue(player.hand);
            if (startIndex < 0 || endIndex < 0 || startIndex >= sorted.length || endIndex >= sorted.length) return;

            const from = Math.min(startIndex, endIndex);
            const to = Math.max(startIndex, endIndex);
            const rangeKey = `${from}-${to}-${rangeShouldSelect}`;
            if (rangeKey === lastRangeKey) return;
            lastRangeKey = rangeKey;

            const nextSelection = new Set(dragBaseSelection);

            for (let idx = from; idx <= to; idx++) {
                if (rangeShouldSelect) {
                    nextSelection.add(sorted[idx]);
                } else {
                    nextSelection.delete(sorted[idx]);
                }
            }

            cardEls.forEach((el, idx) => {
                const card = sorted[idx];
                const wasSelected = this.selectedCards.has(card);
                const shouldSelect = nextSelection.has(card);
                this._setCardSelection(el, card, shouldSelect, shouldSelect && !wasSelected);
            });
        };

        const onDown = (e) => {
            if (this.gameState?.phase !== PHASE.PLAYING) return;
            if (e.button !== 0 && e.type === 'mousedown') return; // 仅左键
            dragged = false;
            startIndex = -1;
            lastRangeKey = '';
            dragBaseSelection = new Set(this.selectedCards);
            const touch = e.touches ? e.touches[0] : null;
            const x = touch ? touch.clientX : e.clientX;
            const y = touch ? touch.clientY : e.clientY;
            const card = getCardAt(x, y);
            if (card) {
                isDragging = true;
                dragStartX = x;
                dragStartY = y;
                startIndex = Array.from(handContainer.querySelectorAll('.card')).indexOf(card);
                const player = this.gameState?.players[this.mode?.humanIndex];
                const sorted = player ? Card.sortByValue(player.hand) : [];
                rangeShouldSelect = !dragBaseSelection.has(sorted[startIndex]);
            }
        };

        const onMove = (e) => {
            if (!isDragging) return;
            const touch = e.touches ? e.touches[0] : null;
            const x = touch ? touch.clientX : e.clientX;
            const y = touch ? touch.clientY : e.clientY;
            const card = getCardAt(x, y);
            if (card) {
                const idx = Array.from(handContainer.querySelectorAll('.card')).indexOf(card);
                const movedEnough = Math.hypot(x - dragStartX, y - dragStartY) >= dragThreshold();
                if ((idx !== startIndex || e.type === 'touchmove') && movedEnough) {
                    if (!dragged) this._saveSelectionHistory();
                    dragged = true;
                    handContainer.classList.add('range-selecting');
                    e.preventDefault();
                    applyRangeSelection(idx);
                }
                this._updateHandHint(this._getSelectedCards());
            }
        };

        const onUp = () => {
            if (!isDragging) return;
            isDragging = false;
            handContainer.classList.remove('range-selecting');
            if (dragged) {
                this.audio.playCardSelect();
                this._updateHandHint(this._getSelectedCards());
                // 阻止本次拖拽产生的 click 重复触发选牌
                handContainer._dragJustEnded = true;
                setTimeout(() => { handContainer._dragJustEnded = false; }, 120);
            }
            startIndex = -1;
            lastRangeKey = '';
            dragBaseSelection = new Set();
        };

        handContainer.addEventListener('mousedown', onDown);
        handContainer.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        handContainer.addEventListener('touchstart', onDown, { passive: false });
        handContainer.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);

        handContainer._dragCleanup = () => {
            handContainer.removeEventListener('mousedown', onDown);
            handContainer.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            handContainer.removeEventListener('touchstart', onDown);
            handContainer.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
        };
    }

    // 渲染玩家手牌（正面，仅自己）
    renderHands() {
        if (!this.gameState) return;
        // 重新渲染前清除选择状态，避免 DOM 与 selectedCards 不一致
        this.clearSelection();

        for (let i = 0; i < 3; i++) {
            const player = this.gameState.players[i];
            if (!player) continue;

            const area = this._getPlayerArea(i);
            if (!area) continue;
            area.classList.toggle('low-cards', this.gameState?.phase === PHASE.PLAYING && player.hand.length <= 5);
            area.classList.toggle('danger-cards', this.gameState?.phase === PHASE.PLAYING && player.hand.length <= 2);

            const handContainer = area.querySelector('.hand-front, .hand-back');
            if (!handContainer) continue;

            handContainer.innerHTML = '';

            if (player.isAI || i !== this.mode?.humanIndex) {
                // AI或其他玩家：只显示紧凑牌堆和数量，避免牌背铺满牌桌
                const summary = document.createElement('div');
                summary.className = 'opponent-hand-summary';
                summary.setAttribute('aria-label', `${player.name} 手牌 ${player.hand.length} 张`);
                const opponentMode = document.body.dataset.opponentCards || 'stack';

                const backWrap = document.createElement('div');
                backWrap.className = 'opponent-card-stack';
                const visibleBacks = opponentMode === 'count' ? 0 :
                    opponentMode === 'spread' ? Math.min(12, player.hand.length) :
                    Math.min(5, player.hand.length);
                for (let j = 0; j < visibleBacks; j++) {
                    const back = document.createElement('div');
                    back.className = 'mini-card-back';
                    back.style.setProperty('--i', j);
                    back.style.setProperty('--n', visibleBacks);
                    back.style.setProperty('--offset', `${j * 13}px`);
                    back.style.setProperty('--side-offset', `${j * 9}px`);
                    back.style.setProperty('--tilt', `${(j - Math.floor(visibleBacks / 2)) * 2}deg`);
                    back.style.opacity = '0';
                    back.style.transform = 'translateY(12px) rotate(-4deg)';
                    back.style.transition = `all 0.22s ease-out ${j * 25}ms`;
                    backWrap.appendChild(back);
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            back.style.opacity = '1';
                            back.style.transform = '';
                        });
                    });
                }
                if (visibleBacks > 0) summary.appendChild(backWrap);
                const count = document.createElement('div');
                count.className = 'card-count opponent-count-badge';
                count.textContent = `${player.hand.length}张`;
                summary.appendChild(count);
                handContainer.appendChild(summary);
            } else {
                // 自己：显示正面，可点击/触摸选择
                handContainer.classList.toggle('selection-disabled', this.gameState?.phase !== PHASE.PLAYING);
                const sorted = Card.sortByValue(player.hand);
                for (let j = 0; j < sorted.length; j++) {
                    const card = sorted[j];
                    const el = this._createCardElement(card);
                    if (j > 0) el.style.marginLeft = '-44px';

                    // 发牌入场动画
                    el.style.opacity = '0';
                    el.style.transform = 'translateY(30px) rotate(3deg)';
                    const enterStagger = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ddz-card-enter-stagger')) || 30;
                    el.style.transition = `all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) ${j * enterStagger}ms`;

                    // 支持鼠标点击和触摸（防止重复触发）
                    const toggle = (e) => {
                        if (this.gameState?.phase !== PHASE.PLAYING) {
                            this.showToast('请先完成叫地主', 'info');
                            return;
                        }
                        // 拖拽选牌刚结束，忽略本次 click 避免重复触发
                        if (e.type === 'click' && handContainer._dragJustEnded) return;
                        this._toggleCardSelection(el, card);
                        this._updateHandHint(this._getSelectedCards());
                    };
                    el.addEventListener('click', toggle);
                    handContainer.appendChild(el);

                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            el.style.opacity = '1';
                            el.style.transform = '';
                        });
                    });
                }

                // 绑定拖拽选择（滑动选牌）
                this._bindDragSelection(handContainer);
            }

            // 更新玩家信息
            const nameEl = area.querySelector('.player-name');
            const badgeEl = area.querySelector('.player-badge');
            if (nameEl) nameEl.textContent = player.name;
            if (badgeEl) {
                badgeEl.textContent = player.isLandlord ? '地主' : '农民';
                badgeEl.className = 'player-badge ' + (player.isLandlord ? 'landlord' : 'peasant');
            }

            // 更新悬浮提示
            const tooltip = area.querySelector('.player-tooltip');
            if (tooltip) {
                const autoText = player.isAuto ? ' | 托管中' : '';
                tooltip.innerHTML = `手牌: ${player.hand.length}张${autoText}`;
            }
        }

        // 初始化记牌器
        this._initCardTracker();

        // 观战模式：显示所有玩家手牌
        if ((this.mode?.humanIndex ?? 0) < 0) {
            this.showAllHands();
        }
    }

    // 测试模式：显示所有人手牌
    showAllHands() {
        if (!this.gameState) return;
        for (let i = 0; i < 3; i++) {
            const player = this.gameState.players[i];
            if (!player) continue;
            // 跳过人类玩家，保持其正常交互手牌
            if (i === this.mode?.humanIndex) continue;

            const area = this._getPlayerArea(i);
            const handContainer = area?.querySelector('.hand-back, .hand-front');
            if (!handContainer) continue;

            handContainer.innerHTML = '';
            handContainer.className = 'hand-front';
            const sorted = Card.sortByValue(player.hand);
            for (let j = 0; j < sorted.length; j++) {
                const el = this._createCardElement(sorted[j]);
                if (j > 0) el.style.marginLeft = '-30px';
                el.style.transform = 'scale(0.7)';
                handContainer.appendChild(el);
            }
        }
    }

    _createCardElement(card) {
        const el = document.createElement('div');
        el.className = card.getCardClass() + (card.isLaizi ? ' laizi' : '');
        el.dataset.value = card.value;
        el.dataset.suit = card.suit?.name || card.rankKey;

        const inner = document.createElement('div');
        inner.className = 'card-inner';

        if (card.isJoker()) {
            inner.innerHTML = `<span class="joker-text">${card.rank.display}</span>`;
        } else {
            const colorClass = card.getColor() === 'red' ? 'red' : 'black';
            inner.innerHTML = `
                <div class="card-corner top-left ${colorClass}">
                    <div class="rank">${card.rank.display}</div>
                    <div class="suit">${card.suit.symbol}</div>
                </div>
                <div class="card-center ${colorClass}">${card.suit.symbol}</div>
                <div class="card-corner bottom-right ${colorClass}">
                    <div class="rank">${card.rank.display}</div>
                    <div class="suit">${card.suit.symbol}</div>
                </div>
            `;
        }

        el.appendChild(inner);
        return el;
    }

    _toggleCardSelection(el, card) {
        // 保存选牌历史（最多保留 10 条）
        this._saveSelectionHistory();

        const shouldSelect = !this.selectedCards.has(card);
        this._setCardSelection(el, card, shouldSelect, true);

        if (shouldSelect) {
            this.audio.playCardSelect();
        } else {
            this.audio.playCardDeselect();
        }
    }

    _setCardSelection(el, card, shouldSelect, withPop = false) {
        if (!el || !card) return;
        if (shouldSelect) {
            this.selectedCards.add(card);
            el.classList.add('selected');
            if (withPop) {
                el.classList.remove('selection-pop');
                void el.offsetWidth;
                el.classList.add('selection-pop');
                setTimeout(() => el.classList.remove('selection-pop'), 240);
            }
        } else {
            this.selectedCards.delete(card);
            el.classList.remove('selected', 'selection-pop');
        }
    }

    _saveSelectionHistory() {
        // 保存当前选牌状态的副本
        this._selectionHistory.push(new Set(this.selectedCards));
        if (this._selectionHistory.length > 10) {
            this._selectionHistory.shift();
        }
    }

    _undoSelection() {
        if (this._selectionHistory.length === 0) return;
        const prev = this._selectionHistory.pop();
        this.selectedCards = prev;
        // 同步 DOM
        const handContainer = this.container?.querySelector('#player-right .hand-front');
        const cardEls = handContainer?.querySelectorAll('.card');
        const player = this.gameState?.players[this.mode?.humanIndex];
        if (!player || !cardEls) return;
        const sorted = Card.sortByValue(player.hand);
        cardEls.forEach((el, idx) => {
            const card = sorted[idx];
            const isSelected = Array.from(prev).some(c =>
                c.value === card.value && (c.suit?.name || c.rankKey) === (card.suit?.name || card.rankKey)
            );
            el.classList.toggle('selected', isSelected);
        });
        this._updateHandHint(this._getSelectedCards());
    }

    _getSelectedCards() {
        const player = this.gameState?.players[this.mode?.humanIndex];
        if (!player) return [];
        return Card.sortByValue(player.hand).filter(c => {
            for (const sc of this.selectedCards) {
                if (sc.value === c.value && (sc.suit?.name || sc.rankKey) === (c.suit?.name || c.rankKey)) return true;
            }
            return false;
        });
    }

    clearSelection() {
        this.selectedCards.clear();
        const selected = this.container.querySelectorAll('.card.selected');
        for (const el of selected) el.classList.remove('selected');
        this._clearHint();
        this._updateHandHint([]);
    }

    _getPlayerArea(index) {
        const human = this.mode?.humanIndex ?? 0;
        // 观战模式（humanIndex=-1）使用固定映射
        if (human < 0) {
            const ids = ['player-right', 'player-top', 'player-left'];
            return this.container.querySelector(`#${ids[index]}`);
        }
        const rel = (index - human + 3) % 3;
        const ids = ['player-right', 'player-top', 'player-left'];
        return this.container.querySelector(`#${ids[rel]}`);
    }

    showCountdown(playerIndex, seconds) {
        const area = this._getPlayerArea(playerIndex);
        if (!area) return;
        let cd = area.querySelector('.countdown-timer');
        if (!cd) {
            cd = document.createElement('div');
            cd.className = 'countdown-timer';
            area.appendChild(cd);
        }
        cd.textContent = seconds + 's';
        cd.classList.remove('urgent', 'critical');
        if (seconds <= 5) cd.classList.add('critical');
        else if (seconds <= 10) cd.classList.add('urgent');
        cd.style.opacity = '1';
    }

    hideCountdown() {
        const areas = this.container.querySelectorAll('.player-area');
        for (const area of areas) {
            const cd = area.querySelector('.countdown-timer');
            if (cd) cd.style.opacity = '0';
        }
    }

    showThinking(playerIndex, hintText = null) {
        const area = this._getPlayerArea(playerIndex);
        if (!area) return;
        let el = area.querySelector('.thinking-indicator');
        if (!el) {
            el = document.createElement('div');
            el.className = 'thinking-indicator';
            area.appendChild(el);
        }
        if (hintText) {
            el.dataset.hint = hintText;
            el.classList.add('has-hint');
        } else {
            el.dataset.hint = '';
            el.classList.remove('has-hint');
        }
        el.style.opacity = '1';
    }

    hideThinking(playerIndex) {
        const area = this._getPlayerArea(playerIndex);
        if (!area) return;
        const el = area.querySelector('.thinking-indicator');
        if (el) el.style.opacity = '0';
    }

    showAIHint(playerIndex, cards) {
        const area = this._getPlayerArea(playerIndex);
        if (!area) return;
        let hint = area.querySelector('.ai-hint');
        if (!hint) {
            hint = document.createElement('div');
            hint.className = 'ai-hint';
            area.appendChild(hint);
        }
        const sorted = Card.sortByValue(cards);
        hint.innerHTML = sorted.map(c => `<span class="ai-hint-card">${c.displayName}</span>`).join('');
        hint.style.opacity = '1';
    }

    hideAIHint(playerIndex) {
        const area = this._getPlayerArea(playerIndex);
        if (!area) return;
        const hint = area.querySelector('.ai-hint');
        if (hint) hint.style.opacity = '0';
    }

    // ---- 控制面板 ----

    showCallControls(playerIndex) {
        const panel = this.container.querySelector('#call-controls');
        if (!panel) return;
        this.hidePlayControls();
        this.clearSelection();
        panel.classList.remove('hidden');
        this.anim.slideInFrom(panel, 'bottom', 300);
        this.audio.playTurnAlert();

        // 抢地主模式：动态更新按钮文字
        if (this.gameState?.callMode === 'grab') {
            const isGrabPhase = this.gameState?.grabPhase === 'grab';
            const btns = panel.querySelectorAll('button[data-call]');
            for (const btn of btns) {
                // 先重置 dataset.call 到原始索引，避免上一轮状态残留
                const originalIndex = [...btns].indexOf(btn);
                btn.dataset.call = String(originalIndex);
                const val = parseInt(btn.dataset.call);
                if (val === 0) {
                    btn.textContent = isGrabPhase ? '不抢' : '不叫';
                } else if (val === 1) {
                    btn.textContent = isGrabPhase ? '抢地主' : '叫地主';
                    if (isGrabPhase) btn.dataset.call = '2';
                    else btn.dataset.call = '1';
                } else {
                    btn.style.display = 'none';
                }
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.display = val <= 1 ? 'inline-block' : 'none';
            }
            // 按钮依次弹出
            const visibleBtns = [...btns].filter(b => b.style.display !== 'none');
            visibleBtns.forEach((btn, i) => {
                btn.style.transform = 'scale(0)';
                btn.style.opacity = '0';
                btn.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s';
                setTimeout(() => {
                    btn.style.transform = 'scale(1)';
                    btn.style.opacity = '1';
                }, i * 80);
            });
            return;
        }

        // 叫分模式：恢复默认按钮
        const btns = panel.querySelectorAll('button[data-call]');
        const labels = ['不叫', '1分', '2分', '3分'];
        const maxCall = this.gameState?.currentCall || 0;
        for (let i = 0; i < btns.length; i++) {
            const btn = btns[i];
            btn.dataset.call = String(i);
            btn.textContent = labels[i];
            btn.style.display = 'inline-block';
            btn.disabled = i <= maxCall && i > 0;
            btn.style.opacity = btn.disabled ? '0.4' : '1';
        }
        // 按钮依次弹出
        btns.forEach((btn, i) => {
            btn.style.transform = 'scale(0)';
            btn.style.opacity = '0';
            btn.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s';
            setTimeout(() => {
                btn.style.transform = 'scale(1)';
                btn.style.opacity = btn.disabled ? '0.4' : '1';
            }, i * 80);
        });
    }

    hideCallControls() {
        this.container.querySelector('#call-controls')?.classList.add('hidden');
    }

    showPlayControls(playerIndex, lastPattern) {
        const panel = this.container.querySelector('#play-controls');
        if (!panel) return;
        this.hideCallControls();
        panel.classList.remove('hidden');
        this.anim.slideInFrom(panel, 'bottom', 300);
        this.audio.playTurnAlert();

        const isNewRound = !lastPattern || lastPattern.type === 'INVALID' ||
                           (this.gameState?.passCount >= 2) ||
                           (this.gameState?.lastPlay.playerIndex === playerIndex);
        const btnPass = panel.querySelector('#btn-pass');
        if (btnPass) btnPass.disabled = isNewRound;

        // 显示上家牌型
        const lastTypeEl = this.container.querySelector('#last-play-type');
        if (lastTypeEl && lastPattern && !isNewRound) {
            lastTypeEl.textContent = `上家: ${Rules.getTypeName(lastPattern.type)}`;
            lastTypeEl.classList.add('info-pop');
        } else if (lastTypeEl) {
            lastTypeEl.textContent = '首家出牌';
            lastTypeEl.classList.add('info-pop');
        }
        setTimeout(() => lastTypeEl?.classList.remove('info-pop'), 350);

        // 按钮依次弹出
        const btns = panel.querySelectorAll('button');
        btns.forEach((btn, i) => {
            btn.style.transform = 'scale(0)';
            btn.style.opacity = '0';
            btn.style.transition = 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s';
            setTimeout(() => {
                btn.style.transform = 'scale(1)';
                btn.style.opacity = '1';
            }, i * 60);
        });
    }

    hidePlayControls() {
        this.container.querySelector('#play-controls')?.classList.add('hidden');
    }

    // ---- 事件动画 ----

    showCallResult(data) {
        const area = this._getPlayerArea(data.playerIndex);
        const bubble = document.createElement('div');
        bubble.className = 'call-bubble';
        bubble.dataset.animFx = 'true';

        if (data.mode === 'grab') {
            if (data.phase === 'call') {
                bubble.textContent = data.action === 'call' ? '叫地主' : '不叫';
            } else {
                bubble.textContent = data.action === 'grab' ? `抢地主 ×${data.multiplier}` : '不抢';
            }
        } else {
            bubble.textContent = data.action === 0 ? '不叫' : data.action + '分';
        }

        area?.appendChild(bubble);
        setTimeout(() => bubble.remove(), 1500);

        // 音效：叫分/抢地主/不叫
        if (data.mode === 'grab' && data.action === 'grab') {
            this.audio.playGrabLandlord();
        } else {
            this.audio.playCall();
        }

        // 脉冲光环
        const rect = area?.querySelector('.player-avatar')?.getBoundingClientRect();
        if (rect && data.action !== 0 && data.action !== 'pass' && data.action !== 'noGrab') {
            this.anim.pulseRing(rect.left + rect.width/2, rect.top + rect.height/2, '#f0c040', 80);
            this.anim.glowBurst(rect.left + rect.width/2, rect.top + rect.height/2, 'rgba(240,192,64,0.4)');
        }
    }

    showLandlord(data) {
        this.hideCallControls();
        this.hidePlayControls();
        this.clearSelection();

        const area = this._getPlayerArea(data.landlordIndex);
        area?.querySelector('.player-badge')?.classList.add('landlord');

        // 底牌揭晓动画 + 音效
        const bottomEl = this.container.querySelector('#bottom-cards');
        if (bottomEl && data.bottomCards) {
            bottomEl.classList.remove('hidden');
            const container = bottomEl.querySelector('.cards');
            container.innerHTML = '';
            for (let i = 0; i < data.bottomCards.length; i++) {
                const c = data.bottomCards[i];
                const el = this._createCardElement(c);
                el.style.animation = `bottomReveal 0.5s ease-out ${i * 150}ms both`;
                container.appendChild(el);
            }
            // 底牌揭示音效
            data.bottomCards.forEach((_, i) => {
                setTimeout(() => this.audio.playBottomReveal(), i * 150);
            });
        }

        let toastText = data.forced ? '无人叫分，默认地主' : '地主确定！';
        if (data.multiplier && data.multiplier > 1) {
            toastText += ` (${data.multiplier}倍)`;
        }
        this.showToast(toastText);
        this.audio.playLandlordConfirm();

        // 重新渲染所有玩家手牌（地主获得底牌后数量变化，人类玩家需要看到新牌）
        this.renderHands();
        if (data.landlordIndex === this.mode?.humanIndex) {
            this.clearSelection();
        }

        // 皇冠动画 + 光晕
        const rect = area?.querySelector('.player-avatar')?.getBoundingClientRect();
        if (rect) {
            this.anim.landlordCrown(rect.left + rect.width/2, rect.top);
            setTimeout(() => {
                this.anim.glowBurst(rect.left + rect.width/2, rect.top + rect.height/2, 'rgba(212,160,23,0.5)');
                this.anim.sparkleBurst(rect.left + rect.width/2, rect.top, 12);
            }, 200);
        }

        // 地主区域脉冲
        if (area) {
            area.classList.add('turn-pulse');
            setTimeout(() => area.classList.remove('turn-pulse'), 2000);
        }
    }

    animatePlay(data) {
        const area = this._getPlayerArea(data.playerIndex);
        const playedArea = area?.querySelector('.played-area');
        if (!playedArea) return;

        playedArea.innerHTML = '';
        playedArea.classList.remove('has-pass');
        playedArea.classList.add('has-cards');
        playedArea.dataset.cardCount = String(data.cards.length);
        const sorted = Card.sortByValue(data.cards);
        const playScale = '1';
        const configuredOverlap = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--ddz-play-overlap')
        ) || 16;
        const compactOverlap = sorted.length >= 12 ? 34 : sorted.length >= 8 ? 26 : sorted.length >= 5 ? 18 : 10;
        playedArea.style.setProperty('--table-play-overlap', `${Math.max(configuredOverlap, compactOverlap)}px`);
        for (let i = 0; i < sorted.length; i++) {
            const el = this._createCardElement(sorted[i]);
            el.classList.add('table-play-card');
            el.style.setProperty('--play-index', i);
            el.style.setProperty('--play-scale', playScale);
            el.style.transform = 'translateY(10px) scale(0.96)';
            el.style.opacity = '0';
            el.style.animation = `cardPlayFlyIn 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275) ${i * 40}ms forwards`;
            playedArea.appendChild(el);
        }

        const count = area.querySelector('.card-count');
        if (count) count.textContent = data.remaining;

        // 音效 + 特效
        const pattern = data.pattern;
        const playRect = playedArea.getBoundingClientRect();
        const centerX = playRect.left + playRect.width / 2;
        const centerY = playRect.top + playRect.height / 2;

        if (pattern.type === 'BOMB') {
            this.audio.playBomb();
            this.anim.explode(centerX, centerY, true);
            this.anim.screenShake(6, 500);
            this.anim.bounceText(centerX, centerY - 40, '💥 炸弹！', '#ff4444');
        } else if (pattern.type === 'ROCKET') {
            this.audio.playRocket();
            this.anim.rocketFly(playRect.left, playRect.top + playRect.height, playRect.left + 200, playRect.top - 100);
            this.anim.screenShake(4, 400);
            this.anim.flashScreen('rgba(255,255,255,0.15)', 300);
            this.anim.bounceText(centerX, centerY - 40, '🚀 火箭！', '#ff8c00');
        } else if (pattern.type === 'STRAIGHT') {
            this.audio.playStraight();
            this.anim.glowBurst(centerX, centerY, 'rgba(100,200,255,0.4)');
        } else if (pattern.type?.includes('TRIPLE_STRAIGHT')) {
            this.audio.playPlane();
            this.anim.glowBurst(centerX, centerY, 'rgba(255,100,200,0.4)');
            this.anim.sparkleBurst(centerX, centerY, 10);
        } else if (pattern.type === 'PAIR') {
            this.audio.playPair();
        } else if (pattern.type === 'TRIPLE' || pattern.type?.includes('TRIPLE_WITH')) {
            this.audio.playTriple();
            this.anim.pulseRing(centerX, centerY, '#f0c040', 60);
        } else if (pattern.type === 'FOUR_WITH_TWO' || pattern.type === 'FOUR_WITH_TWO_PAIRS') {
            this.audio.playFourWithTwo();
        } else if (pattern.type === 'SINGLE') {
            this.audio.playSingle();
        } else {
            this.audio.playPlay();
        }

        // 更新记牌器
        this._updateCardTracker(data.cards);
        // 更新历史
        this._addHistory(data);

        // 如果出牌者是人类玩家，重新渲染手牌
        if (data.playerIndex === this.mode?.humanIndex) {
            this.renderHands();
            this.clearSelection();
        }
    }

    showPass(playerIndex) {
        const area = this._getPlayerArea(playerIndex);
        const bubble = document.createElement('div');
        bubble.className = 'pass-bubble';
        bubble.dataset.animFx = 'true';
        bubble.textContent = '不出';
        area?.appendChild(bubble);
        setTimeout(() => {
            bubble.style.transition = 'all 0.3s ease-in';
            bubble.style.transform = 'translate(-50%, -50%) scale(0) rotate(180deg)';
            bubble.style.opacity = '0';
            setTimeout(() => bubble.remove(), 300);
        }, 900);

        const playedArea = area?.querySelector('.played-area');
        if (playedArea) {
            playedArea.innerHTML = '';
            playedArea.classList.remove('has-cards');
            playedArea.classList.add('has-pass');
            delete playedArea.dataset.cardCount;
            playedArea.style.removeProperty('--table-play-scale');
            playedArea.style.removeProperty('--table-play-overlap');
        }

        this.audio.playPass();
        this.audio.playPassTurn();
        this._addHistory({playerIndex, cards: [], pattern: {type: 'PASS'}, pass: true});
    }

    // AI/玩家快捷短语气泡
    showChatBubble(playerIndex, text) {
        const area = this._getPlayerArea(playerIndex);
        if (!area) return;

        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble';
        bubble.dataset.animFx = 'true';
        bubble.textContent = text;
        bubble.style.opacity = '0';
        bubble.style.transform = 'translateX(-50%) scale(0.5)';
        bubble.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        area.appendChild(bubble);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                bubble.style.opacity = '1';
                bubble.style.transform = 'translateX(-50%) scale(1)';
            });
        });

        setTimeout(() => {
            bubble.style.transition = 'opacity 0.3s ease';
            bubble.style.opacity = '0';
            setTimeout(() => bubble.remove(), 300);
        }, 2000);
    }

    highlightTurn(playerIndex) {
        if (this.gameState?.phase === PHASE.CALLING) {
            this.hidePlayControls();
            this.clearSelection();
        } else if (this.gameState?.phase === PHASE.PLAYING) {
            this.hideCallControls();
        }

        const areas = this.container.querySelectorAll('.player-area');
        for (const a of areas) {
            a.classList.remove('active-turn', 'turn-pulse');
        }

        const area = this._getPlayerArea(playerIndex);
        area?.classList.add('active-turn');
        // 添加脉冲动画（限人类玩家回合）
        if (playerIndex === this.mode?.humanIndex) {
            area?.classList.add('turn-pulse');
        }

        const phaseText = this.container.querySelector('#phase-text');
        if (phaseText) {
            const player = this.gameState?.players[playerIndex];
            phaseText.textContent = player ? `轮到 ${player.name}` : '';
        }
        const turnEl = this.container.querySelector('#turn-indicator');
        if (turnEl) {
            const player = this.gameState?.players[playerIndex];
            const phaseLabel = this.gameState?.phase === PHASE.CALLING ? '叫地主' : '出牌';
            turnEl.textContent = player ? `${player.name} · ${phaseLabel}` : '';
            turnEl.classList.remove('turn-indicator-pop');
            void turnEl.offsetWidth;
            turnEl.classList.add('turn-indicator-pop');
        }
        // 隐藏旧倒计时
        this.hideCountdown();
    }

    _updateAICardCount(index, count) {
        const area = this._getPlayerArea(index);
        const cnt = area?.querySelector('.card-count');
        if (cnt) cnt.textContent = cnt.classList.contains('opponent-count-badge') ? `${count}张` : count;
    }

    showRoundResult(data, matchStatus = null) {
        const overlay = this.container.querySelector('#modal-overlay');
        const content = this.container.querySelector('#modal-content');
        if (!overlay || !content || !this.gameState) return;

        const winner = this.gameState.players?.[data.winnerIndex];
        const resultText = data.isLandlordWin ? '地主胜利' : '农民胜利';
        const humanIdx = this.mode?.humanIndex ?? -1;
        const isHumanWin = humanIdx >= 0 && (
            data.winnerIndex === humanIdx ||
            (data.winnerIndex !== this.gameState.landlordIndex && humanIdx !== this.gameState.landlordIndex)
        );

        if (isHumanWin) this.audio.playWin();
        else this.audio.playLose();

        // 春天/反春天显示
        let springText = '';
        if (data.springType === 'spring') springText = '<div class="spring-badge">🌸 春天 ×2</div>';
        else if (data.springType === 'anti_spring') springText = '<div class="spring-badge anti">🌸 反春天 ×2</div>';

        // 倍数显示
        const multText = data.multiplier > 1 ? `<div class="multiplier-text">倍数: ${data.multiplier}倍 (底分${data.baseScore})</div>` : '';

        // 比赛状态
        let matchText = '';
        let matchScoreText = '';
        let nextButtonText = '再来一局';
        let isMatchEnd = false;

        if (matchStatus?.isMatchMode) {
            matchText = `<div class="match-round">第 ${matchStatus.currentRound} / ${matchStatus.totalRounds} 局</div>`;

            // 累计比分
            const esc = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[m]);
            const sorted = matchStatus.matchScores.map((s, i) => ({ score: s, index: i, name: this.gameState.players[i]?.name }))
                .sort((a, b) => b.score - a.score);
            matchScoreText = `
                <div class="match-scores">
                    <h4>累计比分</h4>
                    ${sorted.map((p, idx) => `
                        <div class="match-score-item ${idx === 0 ? 'first' : ''}">
                            <span>${idx + 1}. ${esc(p.name || '?')}</span>
                            <span>${p.score > 0 ? '+' : ''}${p.score}</span>
                        </div>
                    `).join('')}
                </div>
            `;

            if (matchStatus.isFinished) {
                isMatchEnd = true;
                matchText = `<div class="match-round match-end">🏆 比赛结束</div>`;
                nextButtonText = '重新开始';
                this.audio.playMatchEnd();
            } else {
                nextButtonText = '下一局';
            }
        }

        const esc = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[m]);
        content.innerHTML = `
            <h2>${resultText}</h2>
            ${matchText}
            ${springText}
            ${multText}
            <p>获胜者: ${esc(winner?.name || '未知')}</p>
            <div class="score-board">
                ${data.scores.map((s, i) => `
                    <div class="score-item ${i === this.gameState.landlordIndex ? 'landlord' : ''}">
                        <span>${esc(this.gameState.players[i]?.name || '?')}</span>
                        <span class="score-value" data-target="${s}" data-sign="${s >= 0 ? '+' : ''}">0</span>
                    </div>
                `).join('')}
            </div>
            <div class="round-stats">
                <h4>📊 本局统计</h4>
                <div class="stat-row">
                    <span>出牌次数:</span>
                    ${this.gameState?.playCounts?.map((c, i) => `
                        <span>${esc(this.gameState.players[i]?.name || '?')}: ${c}次</span>
                    `).join('')}
                </div>
                <div class="stat-row">
                    <span>炸弹:</span>
                    <span>${this.gameState?.history?.filter(h => h.pattern?.type === 'BOMB' || h.pattern?.type === 'ROCKET').length || 0}个</span>
                </div>
            </div>
            ${matchScoreText}
            <button id="btn-next-round">${nextButtonText}</button>
            ${!isMatchEnd ? '<button id="btn-replay">📹 查看回放</button>' : ''}
            <button id="btn-share-round">📋 分享本局</button>
            <button id="btn-back-menu">返回菜单</button>
        `;

        overlay.classList.remove('hidden');
        // 重置动画：先移除类，下一帧再添加，确保动画每次都播放
        content.classList.remove('modal-scale-in');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                content.classList.add('modal-scale-in');
            });
        });

        // 得分数字滚动动画
        const scoreEls = content.querySelectorAll('.score-value');
        for (const el of scoreEls) {
            const target = parseInt(el.dataset.target, 10);
            const sign = el.dataset.sign || '';
            const duration = 800;
            const startTime = performance.now();
            const animate = (now) => {
                if (this._destroyed) return;
                const elapsed = now - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
                const current = Math.round(target * eased);
                el.textContent = sign + current;
                if (progress < 1) requestAnimationFrame(animate);
            };
            requestAnimationFrame(animate);
        }

        // 胜利/失败庆祝动画
        if (isHumanWin) {
            setTimeout(() => {
                if (this._destroyed) return;
                this.anim.winCelebrate(data.isLandlordWin, data.winnerIndex);
            }, 300);
        } else {
            // 人类输了：简单闪光
            setTimeout(() => {
                if (this._destroyed) return;
                this.anim.flashScreen('rgba(100,100,100,0.15)', 400);
            }, 200);
        }

        // 春天/反春天特效
        if (data.springType) {
            setTimeout(() => {
                if (this._destroyed) return;
                this.audio.playSpring();
                this.anim.springCelebrate();
            }, 600);
        }

        content.querySelector('#btn-next-round')?.addEventListener('click', () => {
            this.audio.playButtonClick();
            overlay.classList.add('hidden');
            if (isMatchEnd && matchStatus) {
                // 比赛结束，重置
                this.mode?.setMatchRounds(matchStatus.totalRounds);
            }
            this.mode?.startGame();
        });

        if (!isMatchEnd) {
            content.querySelector('#btn-replay')?.addEventListener('click', () => {
                this.audio.playButtonClick();
                overlay.classList.add('hidden');
                if (window.gameApp?.startReplay) {
                    window.gameApp.startReplay();
                }
            });
        }

        content.querySelector('#btn-share-round')?.addEventListener('click', () => {
            this.audio.playButtonClick();
            this._shareRoundResult(data, matchStatus);
        });

        content.querySelector('#btn-back-menu')?.addEventListener('click', () => {
            this.audio.playButtonClick();
            overlay.classList.add('hidden');
            window.gameApp?.showMenu();
        });
    }

    _shareRoundResult(data, matchStatus) {
        const gs = this.gameState;
        const winner = gs?.players[data.winnerIndex];
        const lines = [
            '🃏 斗地主 WebGame 对局结果',
            '',
            `🏆 获胜者: ${winner?.name || '未知'}`,
            `🎭 角色: ${data.isLandlordWin ? '地主' : '农民'}胜利`,
        ];
        if (data.springType === 'spring') lines.push('🌸 春天 ×2');
        if (data.springType === 'anti_spring') lines.push('🌸 反春天 ×2');
        if (data.multiplier > 1) lines.push(`💥 倍数: ${data.multiplier}倍`);
        lines.push('');
        lines.push('📊 本局得分:');
        data.scores.forEach((s, i) => {
            const p = gs?.players[i];
            const role = i === gs?.landlordIndex ? '地主' : '农民';
            lines.push(`  ${p?.name || '?'} (${role}): ${s > 0 ? '+' : ''}${s}`);
        });
        if (matchStatus?.isMatchMode) {
            lines.push('');
            lines.push(`🏅 比赛进度: 第${matchStatus.currentRound}/${matchStatus.totalRounds}局`);
        }
        const text = lines.join('\n');
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                this.showToast('已复制到剪贴板', 'success');
            }).catch(() => {
                this.showToast('复制失败', 'error');
            });
        } else {
            this.showToast('浏览器不支持复制', 'error');
        }
    }

    showToast(message, type = 'info') {
        if (!this.container || this._destroyed) return;

        // 防抖：相同消息 1.5 秒内不重复显示
        const now = Date.now();
        if (this._lastToastMsg === message && this._lastToastTime && (now - this._lastToastTime) < 1500) {
            return;
        }
        this._lastToastMsg = message;
        this._lastToastTime = now;

        const toast = document.createElement('div');
        toast.className = 'toast-message toast-bounce';
        toast.dataset.animFx = 'true';
        if (type === 'error') toast.style.background = 'rgba(244,67,54,0.85)';
        if (type === 'success') toast.style.background = 'rgba(76,175,80,0.85)';
        toast.textContent = message;
        this.container.appendChild(toast);

        // 限制 toast 数量（最多 3 个）
        const toasts = this.container.querySelectorAll('.toast-message');
        if (toasts.length > 3) {
            toasts[0].remove();
        }

        // 音效
        if (type === 'error') {
            this.audio.playError();
        } else if (type === 'success') {
            this.audio.playChat();
        }

        setTimeout(() => {
            toast.style.transition = 'all 0.3s ease-in';
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(-20px) scale(0.9)';
            setTimeout(() => toast.remove(), 300);
        }, 1800);
    }

    showAchievementUnlock(achievements) {
        if (!this.container || !achievements?.length) return;
        achievements.forEach((ach, i) => {
            setTimeout(() => {
                if (this._destroyed) return;
                const el = document.createElement('div');
                el.className = 'achievement-toast';
                el.dataset.animFx = 'true';
                el.innerHTML = `
                    <div class="ach-icon">${ach.icon}</div>
                    <div class="ach-body">
                        <div class="ach-title">成就解锁</div>
                        <div class="ach-name">${ach.name}</div>
                        <div class="ach-desc">${ach.desc}</div>
                    </div>
                `;
                this.container.appendChild(el);
                this.audio?.playWin?.();
                setTimeout(() => {
                    el.style.transition = 'all 0.5s ease-in';
                    el.style.opacity = '0';
                    el.style.transform = 'translateX(-50%) translateY(-30px) scale(0.9)';
                    setTimeout(() => el.remove(), 500);
                }, 3500);
            }, i * 600);
        });
    }

    _exportHistory() {
        const history = this.gameState?.history;
        if (!history?.length) {
            this.showToast('暂无出牌记录', 'info');
            return;
        }
        const lines = ['🃏 斗地主 WebGame 出牌历史', ''];
        const startTime = history[0].timestamp;
        for (const h of history) {
            const player = this.gameState.players[h.playerIndex];
            const name = player?.name || '?';
            const elapsed = h.timestamp ? Math.round((h.timestamp - startTime) / 1000) : 0;
            if (h.pattern?.type === 'PASS') {
                lines.push(`[+${elapsed}s] ${name}: 不出`);
            } else {
                const typeName = Rules.getTypeName(h.pattern?.type || 'INVALID');
                const cards = h.cards?.map(c => c.displayName).join(' ') || '';
                lines.push(`[+${elapsed}s] ${name}: [${typeName}] ${cards}`);
            }
        }
        const text = lines.join('\n');
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                this.showToast('已复制到剪贴板', 'success');
            }).catch(() => {
                this.showToast('复制失败', 'error');
            });
        } else {
            this.showToast('浏览器不支持复制', 'error');
        }
    }

    // ---- 记牌器（增强版：按点数统计剩余数量）----

    _initCardTracker() {
        const content = this.container.querySelector('#tracker-content');
        if (!content) return;

        // 按点数分组统计
        const rankGroups = [
            { key: '3', label: '3', count: 4 },
            { key: '4', label: '4', count: 4 },
            { key: '5', label: '5', count: 4 },
            { key: '6', label: '6', count: 4 },
            { key: '7', label: '7', count: 4 },
            { key: '8', label: '8', count: 4 },
            { key: '9', label: '9', count: 4 },
            { key: '10', label: '10', count: 4 },
            { key: 'J', label: 'J', count: 4 },
            { key: 'Q', label: 'Q', count: 4 },
            { key: 'K', label: 'K', count: 4 },
            { key: 'A', label: 'A', count: 4 },
            { key: '2', label: '2', count: 4 },
            { key: 'JOKER_SMALL', label: '小王', count: 1 },
            { key: 'JOKER_BIG', label: '大王', count: 1 },
        ];

        let html = '';
        for (const g of rankGroups) {
            html += `<div class="tracker-rank" data-rank="${g.key}">
                <span class="tracker-rank-label">${g.label}</span>
                <span class="tracker-rank-count">${g.count}</span>
            </div>`;
        }

        content.innerHTML = html;
        this._trackerData = {};
        for (const g of rankGroups) {
            this._trackerData[g.key] = g.count;
        }
    }

    _updateCardTracker(playedCards) {
        if (!playedCards) return;
        if (!this._trackerData) {
            this._initCardTracker();
        }
        for (const card of playedCards) {
            const rankKey = card.isJoker() ? card.rankKey : card.rank.name;
            const oldVal = this._trackerData?.[rankKey] ?? 0;
            if (this._trackerData && rankKey in this._trackerData) {
                this._trackerData[rankKey] = Math.max(0, this._trackerData[rankKey] - 1);
            }

            const cell = this.container?.querySelector(`.tracker-rank[data-rank="${rankKey}"]`);
            if (cell) {
                const countEl = cell.querySelector('.tracker-rank-count');
                const remaining = this._trackerData?.[rankKey] ?? 0;
                if (countEl) {
                    // 数字跳动动画
                    countEl.classList.add('count-jump');
                    countEl.textContent = remaining;
                    setTimeout(() => countEl.classList.remove('count-jump'), 300);
                }

                cell.classList.remove('full', 'low', 'empty');
                if (remaining === 0) {
                    cell.classList.add('empty');
                } else if (remaining <= 1) {
                    cell.classList.add('low');
                } else {
                    cell.classList.add('full');
                }
            }
        }
    }

    // ---- 历史记录 ----

    _addHistory(data) {
        const content = this.container.querySelector('#history-content');
        if (!content) return;

        const player = this.gameState?.players[data.playerIndex];
        const name = player?.name || '?';

        let text;
        if (data.pass) {
            text = `${name}: 不出`;
        } else {
            const cardNames = data.cards?.map(c => c.displayName).join(' ') || '';
            const typeName = Rules.getTypeName(data.pattern?.type || 'INVALID');
            text = `${name}: [${typeName}] ${cardNames}`;
        }

        // 计算相对时间
        const history = this.gameState?.history || [];
        const startTime = history.length > 1 ? history[0].timestamp : data.timestamp;
        const elapsed = data.timestamp ? Math.round((data.timestamp - startTime) / 1000) : 0;
        const timeText = elapsed > 0 ? `<span class="history-time">+${elapsed}s</span>` : '';

        const entry = document.createElement('div');
        const pType = data.pattern?.type || 'INVALID';
        const typeClass = pType === 'BOMB' ? 'history-bomb' :
                          pType === 'ROCKET' ? 'history-rocket' :
                          data.pass ? 'history-pass' : '';
        entry.className = `history-entry ${typeClass}`;
        entry.innerHTML = `${timeText}${text}`;
        entry.style.opacity = '0';
        entry.style.transform = 'translateY(-10px)';
        entry.style.transition = 'all 0.3s ease-out';
        content.insertBefore(entry, content.firstChild);

        // 触发滑入动画
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                entry.style.opacity = '1';
                entry.style.transform = 'translateY(0)';
            });
        });

        // 限制历史条数
        while (content.children.length > 30) {
            content.removeChild(content.lastChild);
        }
    }
}




export { Renderer };

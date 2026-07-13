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
import { CommentaryEngine } from './commentary.js';
import { Storage } from '../utils/storage.js';
import { CHALLENGES } from '../utils/challenge-data.js';

class Renderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this._destroyed = false;
        this._isPaused = false;
        this.gameState = null;
        this.mode = null;
        this.audio = new AudioManager();
        this.anim = new Animations(document.body);
        this.commentary = null;

        // UI状态
        this.selectedCards = new Set();
        this.hintCards = [];
        this._selectionHistory = []; // 选牌历史，用于撤销
        this._lowCardReminderShown = new Set();

        this._controlListeners = [];
        this._initLayout();
        this._keyboardHandler = null;
        this._bindKeyboard();
        this._trackerData = null;
        this._activeTimers = new Set();
    }

    _setTimer(fn, delay) {
        const id = setTimeout(() => {
            this._activeTimers?.delete(id);
            fn();
        }, delay);
        this._activeTimers.add(id);
        return id;
    }

    destroy() {
        if (this._destroyed) return;
        this.audio?.stopBGM();
        this._destroyed = true;
        this._isPaused = false;
        this._removePauseOverlay();
        this._removeHelpPanel();
        if (this._keyboardHandler) {
            document.removeEventListener('keydown', this._keyboardHandler);
            this._keyboardHandler = null;
        }
        if (this._globalBackMenuHandler) {
            document.getElementById('btn-back-menu')?.removeEventListener('click', this._globalBackMenuHandler);
            this._globalBackMenuHandler = null;
        }
        if (this._globalPauseHandler) {
            document.getElementById('btn-pause')?.removeEventListener('click', this._globalPauseHandler);
            this._globalPauseHandler = null;
        }
        const pauseOverlay = document.getElementById('pause-overlay');
        if (pauseOverlay) {
            pauseOverlay.querySelector('#btn-resume')?.removeEventListener('click', this._pauseResumeHandler);
            pauseOverlay.querySelector('#btn-pause-settings')?.removeEventListener('click', this._pauseSettingsHandler);
            pauseOverlay.querySelector('#btn-pause-exit')?.removeEventListener('click', this._pauseExitHandler);
            pauseOverlay.remove();
        }
        if (this._controlListeners) {
            for (const { el, type, handler, options } of this._controlListeners) {
                try { el?.removeEventListener(type, handler, options); } catch (e) {}
            }
            this._controlListeners = [];
        }
        const modalOverlay = this.container?.querySelector('#modal-overlay');
        if (modalOverlay && this._modalOverlayClick) {
            modalOverlay.removeEventListener('click', this._modalOverlayClick);
            this._modalOverlayClick = null;
        }
        document.querySelectorAll('#btn-next-round, #btn-replay, #btn-share-round, #btn-round-back-menu').forEach(btn => {
            if (btn._roundClickHandler) {
                btn.removeEventListener('click', btn._roundClickHandler);
                btn._roundClickHandler = null;
            }
        });
        this.audio?.destroy();
        this.audio = null;
        this.mode = null;
        this.gameState = null;
        this.anim?.cancelAll();
        this.anim = null;
        // 清理选牌状态
        this.selectedCards.clear();
        this.hintCards = [];
        this._selectionHistory = [];
        if (this._oneClickTimeout) {
            clearTimeout(this._oneClickTimeout);
            this._oneClickTimeout = null;
        }
        this._trackerData = null;
        // 清理动画残留元素
        document.querySelectorAll('[data-anim-fx="true"]').forEach(el => {
            try { el.remove(); } catch (e) {}
        });
        this._comboData = null;
        // 取消分数滚动 RAF
        if (this._scoreRafs) {
            for (const id of this._scoreRafs) cancelAnimationFrame(id);
            this._scoreRafs = [];
        }
        // 清理倒计时 timer
        this.container?.querySelectorAll('.countdown-timer').forEach(cd => {
            if (cd._hideTimeout) clearTimeout(cd._hideTimeout);
        });
        // 清理面板隐藏 timer
        ['#call-controls', '#play-controls'].forEach(sel => {
            const panel = this.container?.querySelector(sel);
            if (panel?._hideTimeout) clearTimeout(panel._hideTimeout);
        });
        // 清理出牌区域 clear timer
        this.container?.querySelectorAll('.played-area').forEach(area => {
            if (area._clearTimeout) clearTimeout(area._clearTimeout);
        });
        // 清理活跃 timer
        for (const id of this._activeTimers) clearTimeout(id);
        this._activeTimers.clear();
        // 清理评论系统
        this.commentary?.destroy();
        this.commentary = null;
        // 隐藏侧边面板，防止它们出现在其他屏幕上
        this.container?.querySelector('#card-tracker')?.classList.add('hidden');
        this.container?.querySelector('#play-history')?.classList.add('hidden');
        // 强制恢复 body transform，防止 screenShake 残留偏移
        document.body.style.transform = '';
        // 清理拖拽选择监听器
        const handContainer = this.container?.querySelector('#player-right .hand-front');
        if (handContainer?._dragCleanup) {
            handContainer._dragCleanup();
            handContainer._dragCleanup = null;
        }
        if (handContainer?._scrollCleanup) {
            handContainer._scrollCleanup();
            handContainer._scrollCleanup = null;
        }
        if (handContainer?._dragTimer) {
            clearTimeout(handContainer._dragTimer);
            handContainer._dragTimer = null;
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
        // 清理旧的拖拽监听器（document 上的全局事件）
        const oldHand = this.container?.querySelector('#player-right .hand-front');
        if (oldHand?._dragCleanup) {
            oldHand._dragCleanup();
            oldHand._dragCleanup = null;
        }
        if (oldHand?._scrollCleanup) {
            oldHand._scrollCleanup();
            oldHand._scrollCleanup = null;
        }
        // 清理旧的事件监听器，防止 _initLayout 多次调用时累积
        if (this._controlListeners) {
            for (const { el, type, handler, options } of this._controlListeners) {
                try { el?.removeEventListener(type, handler, options); } catch (e) {}
            }
        }
        this._controlListeners = [];
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
                    <div id="center-countdown" class="center-countdown hidden"></div>
                    <div id="turn-indicator" aria-live="polite"></div>
                </div>
            </div>
            <div id="side-panels">
                <button id="btn-toggle-card-tracker" class="btn-panel-toggle" title="打开记牌器">🃏 记牌器</button>
                <button id="btn-toggle-history" class="btn-panel-toggle" title="查看出牌历史">📜 历史</button>
                <div id="card-tracker" class="side-panel hidden">
                    <h4>记牌器</h4>
                    <div class="tracker-grid" id="tracker-content"></div>
                </div>
                <div id="play-history" class="side-panel hidden">
                    <h4>出牌历史</h4>
                    <div class="history-list" id="history-content"></div>
                    <div class="history-actions">
                        <button id="btn-export-history" class="btn-small">📋 导出</button>
                        <button id="btn-clear-history" class="btn-small">🗑️ 清空</button>
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
        this._initEmptyStates();
    }

    _bindRipple(btn) {
        if (!btn) return;
        let downX = 0, downY = 0;
        const onDown = (e) => {
            downX = e.clientX;
            downY = e.clientY;
        };
        const onUp = (e) => {
            const dx = e.clientX - downX;
            const dy = e.clientY - downY;
            // 移动超过 4px 视为拖拽/滚动意图，不触发涟漪
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) return;
            this.anim.ripple(e.clientX, e.clientY, 'rgba(240,192,64,0.3)');
        };
        const pressAnim = () => this.anim.buttonPress(btn);
        this._addControlListener(btn, 'pointerdown', onDown);
        this._addControlListener(btn, 'pointerup', onUp);
        this._addControlListener(btn, 'pointerdown', pressAnim);
    }

    _addControlListener(el, type, handler, options) {
        if (!el) return;
        el.addEventListener(type, handler, options);
        this._controlListeners.push({ el, type, handler, options });
    }

    _bindControls() {

        // 叫分按钮
        const callBtns = this.container.querySelectorAll('#call-controls button[data-call]');
        for (const btn of callBtns) {
            const handler = (e) => {
                this.audio.playButtonClick();
                this.anim.buttonPress(btn);
                if (this.gameState?.phase !== PHASE.CALLING || this.gameState?.currentTurn !== this.mode?.humanIndex) {
                    this.hideCallControls();
                    this.showToast('当前不在叫地主阶段', 'info');
                    return;
                }
                const action = parseInt(e.currentTarget.dataset.call);
                if (this.mode) {
                    const success = this.mode.humanCall(action);
                    if (success) this.hideCallControls();
                } else {
                    this.hideCallControls();
                }
            };
            this._addControlListener(btn, 'click', handler);
            this._bindRipple(btn);
        }

        // 出牌按钮
        const btnPlay = this.container.querySelector('#btn-play');
        const btnPass = this.container.querySelector('#btn-pass');
        const btnReset = this.container.querySelector('#btn-reset');
        const btnHint = this.container.querySelector('#btn-hint');

        const playHandler = () => { this.audio.playButtonClick(); this.anim.buttonPress(btnPlay); this._doPlay(); };
        const passHandler = () => { this.audio.playButtonClick(); this.anim.buttonPress(btnPass); this._doPass(); };
        const resetHandler = () => { this.audio.playButtonClick(); this.anim.buttonPress(btnReset); this.clearSelection(); };
        const hintHandler = () => { this.audio.playButtonClick(); this.anim.buttonPress(btnHint); this._doHint(); };
        this._addControlListener(btnPlay, 'click', playHandler);
        this._addControlListener(btnPass, 'click', passHandler);
        this._addControlListener(btnReset, 'click', resetHandler);
        this._addControlListener(btnHint, 'click', hintHandler);
        [btnPlay, btnPass, btnReset, btnHint].forEach(b => this._bindRipple(b));

        // 托管按钮
        const btnAutoCall = this.container.querySelector('#btn-auto-call');
        const btnAutoPlay = this.container.querySelector('#btn-auto-play');
        const autoCallHandler = () => { this.audio.playButtonClick(); this.anim.buttonPress(btnAutoCall); this._toggleAuto(); };
        const autoPlayHandler = () => { this.audio.playButtonClick(); this.anim.buttonPress(btnAutoPlay); this._toggleAuto(); };
        this._addControlListener(btnAutoCall, 'click', autoCallHandler);
        this._addControlListener(btnAutoPlay, 'click', autoPlayHandler);
        [btnAutoCall, btnAutoPlay].forEach(b => this._bindRipple(b));

        // 双击出牌
        const handContainer = this.container.querySelector('#player-right .hand-front');
        if (handContainer) {
            const dblclickHandler = (e) => {
                const settings = Storage.getSettings();
                if (settings.doubleClickToPlay !== true) return;
                if (this.gameState?.phase !== PHASE.PLAYING) return;
                if (!this._isHumanPlayTurn()) return;
                e.preventDefault();
                this.audio.playButtonClick();
                this._doPlay();
            };
            // 右键取消选牌
            const contextmenuHandler = (e) => {
                const settings = Storage.getSettings();
                if (settings.rightClickCancel !== false) {
                    e.preventDefault();
                    this.clearSelection();
                    this.audio.playCardDeselect();
                }
            };
            this._addControlListener(handContainer, 'dblclick', dblclickHandler);
            this._addControlListener(handContainer, 'contextmenu', contextmenuHandler);
        }

        // 游戏头部按钮（返回菜单、暂停）——不在 this.container 内，用 document 查询
        const btnBackMenu = document.getElementById('btn-back-menu');
        const btnPause = document.getElementById('btn-pause');
        this._globalBackMenuHandler = () => {
            this.audio?.playButtonClick();
            window.gameApp?.showMenu();
        };
        this._globalPauseHandler = () => {
            this.audio?.playButtonClick();
            if (this._isPaused) this._resumeGame();
            else this._pauseGame();
        };
        this._addControlListener(btnBackMenu, 'click', this._globalBackMenuHandler);
        this._addControlListener(btnPause, 'click', this._globalPauseHandler);
        [btnBackMenu, btnPause].forEach(b => this._bindRipple(b));
    }

    _bindPanelToggles() {
        const btnTracker = this.container.querySelector('#btn-toggle-card-tracker');
        const btnHistory = this.container.querySelector('#btn-toggle-history');
        const tracker = this.container.querySelector('#card-tracker');
        const history = this.container.querySelector('#play-history');

        const _toggleSidePanel = (panel, others, btn) => {
            this.audio.playButtonClick();
            if (!panel) return;
            const wasHidden = panel.classList.contains('hidden');
            // 先关闭其他面板（带动画）
            for (const other of others) {
                if (other && !other.classList.contains('hidden')) {
                    other.classList.add('panel-exit');
                    this._setTimer(() => {
                        if (this._destroyed) return;
                        other.classList.add('hidden');
                        other.classList.remove('panel-exit');
                    }, 180);
                }
            }
            if (wasHidden) {
                panel.classList.remove('hidden', 'panel-exit');
                btn?.setAttribute('aria-expanded', 'true');
            } else {
                panel.classList.add('panel-exit');
                this._setTimer(() => {
                    if (this._destroyed) return;
                    panel.classList.add('hidden');
                    panel.classList.remove('panel-exit');
                }, 180);
                btn?.setAttribute('aria-expanded', 'false');
            }
        };

        const trackerHandler = () => _toggleSidePanel(tracker, [history], btnTracker);
        const historyHandler = () => _toggleSidePanel(history, [tracker], btnHistory);
        this._addControlListener(btnTracker, 'click', trackerHandler);
        this._bindRipple(btnTracker);
        this._addControlListener(btnHistory, 'click', historyHandler);
        this._bindRipple(btnHistory);

        // 导出出牌历史
        const btnExportHistory = this.container.querySelector('#btn-export-history');
        const exportHistoryHandler = () => {
            this.audio.playButtonClick();
            this._exportHistory();
        };
        this._addControlListener(btnExportHistory, 'click', exportHistoryHandler);

        // 清空出牌历史
        const btnClearHistory = this.container.querySelector('#btn-clear-history');
        const clearHistoryHandler = () => {
            this.audio.playButtonClick();
            const content = this.container.querySelector('#history-content');
            if (content) content.innerHTML = '';
        };
        this._addControlListener(btnClearHistory, 'click', clearHistoryHandler);

        // 快捷键提示点击展开帮助
        const shortcutHint = this.container.querySelector('#shortcut-hint');
        const shortcutHandler = () => {
            this.audio.playButtonClick();
            this._toggleHelpPanel();
        };
        this._addControlListener(shortcutHint, 'click', shortcutHandler);
    }

    _initEmptyStates() {
        const historyContent = this.container.querySelector('#history-content');
        if (historyContent && !historyContent.children.length) {
            historyContent.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📜</div>暂无出牌记录</div>';
        }
    }

    _sendChatMessage(text) {
        return;
    }

    _addChatMessage(msg) {
        const content = this.container.querySelector('#chat-content');
        if (!content) return;

        // 移除空状态提示
        const emptyEl = content.querySelector('.empty-state');
        if (emptyEl) emptyEl.remove();

        const entry = document.createElement('div');
        entry.className = 'chat-message';
        entry.style.opacity = '0';
        entry.style.transform = 'translateX(-12px)';
        entry.style.transition = 'opacity 0.25s ease-out, transform 0.25s ease-out';
        const senderSpan = document.createElement('span');
        senderSpan.className = 'chat-sender';
        senderSpan.textContent = msg.sender + ':';
        entry.appendChild(senderSpan);
        entry.appendChild(document.createTextNode(msg.text));
        content.appendChild(entry);
        requestAnimationFrame(() => {
            entry.style.opacity = '1';
            entry.style.transform = 'translateX(0)';
        });
        content.scrollTop = content.scrollHeight;

        // 限制消息数
        while (content.children.length > 50) {
            content.removeChild(content.firstChild);
        }
    }

    receiveChat(data) {
        return;
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

            // Escape 暂停/恢复（优先关闭模态框）
            if (e.key === 'Escape') {
                e.preventDefault();
                if (document.querySelector('#settings-overlay:not(.hidden)')) {
                    window.gameApp?.closeSettings?.();
                    return;
                }
                const helpPanel = document.getElementById('help-panel');
                if (helpPanel && !helpPanel.classList.contains('hidden')) {
                    this._toggleHelpPanel();
                    return;
                }
                if (document.querySelector('#modal-overlay:not(.hidden)')) {
                    return; // 模态框打开时忽略 Esc
                }
                if (this._isPaused) {
                    this._resumeGame();
                } else {
                    this._pauseGame();
                }
                return;
            }

            // 暂停状态下屏蔽游戏操作
            if (this._isPaused) return;

            // 全局快捷键（不限制游戏阶段）
            if (e.key === 'm' || e.key === 'M') {
                e.preventDefault();
                const enabled = window.gameApp?.toggleSound?.() ?? this.audio.toggle();
                this.showToast(enabled ? '🔊 音效已开启' : '🔇 音效已关闭');
                // 同步到全局设置
                if (window.gameApp && !window.gameApp.toggleSound) {
                    window.gameApp.settings.soundEnabled = enabled;
                    Storage.saveSettings(window.gameApp.settings);
                }
                const btn = document.getElementById('btn-sound-toggle');
                if (btn && !window.gameApp?._syncSoundToggleButton) btn.textContent = enabled ? '🔊' : '🔇';
                return;
            }
            if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                this._zoomTable(0.1);
                return;
            }
            if (e.key === '-' || e.key === '_') {
                e.preventDefault();
                this._zoomTable(-0.1);
                return;
            }

            const phase = this.gameState?.phase;
            const isMyTurn = this.gameState && this.mode && this.gameState.currentTurn === this.mode.humanIndex;

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

        };
        document.addEventListener('keydown', this._keyboardHandler);
    }

    _pauseGame() {
        if (this._isPaused) return;
        this._isPaused = true;
        this.mode?.pauseGame?.();
        this.audio?.stopBGM();
        this._bgmBeforePause = this.audio?._currentBGM;
        // 清除可能即将触发的游戏 BGM timer
        if (window.gameApp?._gameBgmTimer) {
            clearTimeout(window.gameApp._gameBgmTimer);
            window.gameApp._gameBgmTimer = null;
        }
        this._showPauseOverlay();
    }

    _resumeGame() {
        if (!this._isPaused) return;
        this._isPaused = false;
        this.mode?.resumeGame?.();
        this._removePauseOverlay();
        const bgm = this._bgmBeforePause;
        if (bgm === 'menu') this.audio?.playMenuBGM();
        else if (bgm === 'game') this.audio?.playGameBGM();
        else if (bgm === 'win') this.audio?.playWinBGM();
        else if (bgm === 'lose') this.audio?.playLoseBGM();
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
        if (overlay && overlay._removeTimeout) {
            clearTimeout(overlay._removeTimeout);
            overlay._removeTimeout = null;
        }
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'pause-overlay';
            overlay.dataset.animFx = 'true';
            overlay.innerHTML = `
                <div class="pause-backdrop"></div>
                <div class="pause-card">
                    <div class="pause-card__icon">⏸</div>
                    <h2 class="pause-card__title">游戏暂停</h2>
                    <p class="pause-card__hint">按 <kbd class="pause-kbd">ESC</kbd> 继续游戏</p>
                    <div class="pause-card__actions">
                        <button id="btn-resume" class="screen-btn screen-btn--primary screen-btn--large">
                            <span>▶</span>
                            <span>继续游戏</span>
                        </button>
                        <button id="btn-pause-settings" class="screen-btn screen-btn--secondary screen-btn--large">
                            <span>⚙️</span>
                            <span>设置</span>
                        </button>
                        <button id="btn-pause-exit" class="screen-btn screen-btn--danger screen-btn--large">
                            <span>🚪</span>
                            <span>退出到菜单</span>
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        }
        // 绑定暂停覆盖层事件（每次显示前移除旧监听器，防止重复绑定）
        if (!this._pauseResumeHandler) {
            this._pauseResumeHandler = () => this._resumeGame();
            this._pauseSettingsHandler = () => {
                this.audio?.playButtonClick();
                this._resumeGame();
                window.gameApp?.openSettings();
            };
            this._pauseExitHandler = () => {
                this.audio?.playButtonClick();
                this._resumeGame();
                window.gameApp?.showMenu();
            };
        }
        const btnResume = overlay.querySelector('#btn-resume');
        const btnSettings = overlay.querySelector('#btn-pause-settings');
        const btnExit = overlay.querySelector('#btn-pause-exit');
        btnResume?.removeEventListener('click', this._pauseResumeHandler);
        btnResume?.addEventListener('click', this._pauseResumeHandler);
        btnSettings?.removeEventListener('click', this._pauseSettingsHandler);
        btnSettings?.addEventListener('click', this._pauseSettingsHandler);
        btnExit?.removeEventListener('click', this._pauseExitHandler);
        btnExit?.addEventListener('click', this._pauseExitHandler);
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex';
        overlay.style.opacity = '0';
        requestAnimationFrame(() => {
            overlay.style.transition = 'opacity 0.25s ease';
            overlay.style.opacity = '1';
        });
    }

    _removePauseOverlay() {
        const overlay = document.getElementById('pause-overlay');
        if (!overlay) {
            return;
        }
        if (overlay._removeTimeout) clearTimeout(overlay._removeTimeout);
        overlay.style.transition = 'opacity 0.25s ease-in';
        overlay.style.opacity = '0';
        overlay._removeTimeout = this._setTimer(() => {
            if (this._destroyed) return;
            overlay.remove();
            overlay._removeTimeout = null;
        }, 250);
    }

    _removeHelpPanel() {
        const panel = document.getElementById('help-panel');
        if (panel) {
            if (this._helpPanelClickHandler) {
                panel.removeEventListener('click', this._helpPanelClickHandler);
                this._helpPanelClickHandler = null;
            }
            panel.remove();
        }
    }

    _toggleHelpPanel() {
        let panel = document.getElementById('help-panel');
        if (panel) {
            panel.remove();
            return;
        }
        panel = document.createElement('div');
        panel.id = 'help-panel';
        panel.dataset.animFx = 'true';
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
        this._helpPanelClickHandler = (e) => {
            if (e.target === panel || e.target.id === 'btn-help-close') panel.remove();
        };
        panel.addEventListener('click', this._helpPanelClickHandler);
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

        // 炸弹前确认
        const settings = Storage.getSettings();
        if (settings.confirmOnBomb === true) {
            const pattern = Rules.analyze(cards);
            if (pattern.type === 'BOMB' || pattern.type === 'ROCKET') {
                const ok = confirm(`确定要出${pattern.type === 'ROCKET' ? '王炸' : '炸弹'}吗？`);
                if (!ok) return;
            }
        }

        const result = this.mode?.humanPlay(cards);
        if (!result || result.success === false) {
            this.showToast(result?.error || '出牌失败', 'error');
            this._shakeSelection();
            this._haptic(30);
        } else {
            this._haptic(20);
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
        const settings = Storage.getSettings();
        // 有牌必出规则检查：如果有可出的牌则不能pass
        if (this.gameState?.mustPlay) {
            const humanIdx = this.mode?.humanIndex ?? 0;
            if (this.gameState.hasValidPlays(humanIdx)) {
                this.showToast('规则：有牌必出，不可跳过', 'warning');
                return;
            }
        }
        if (settings.passConfirm === true) {
            const ok = confirm('确定要不出吗？');
            if (!ok) return;
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

        try {
            const lastPattern = this.gameState?.lastPlay?.pattern;
            const isNewRound = !lastPattern || lastPattern.type === 'INVALID' ||
                               (this.gameState?.passCount >= 2) ||
                               (this.gameState?.lastPlay?.playerIndex === this.mode?.humanIndex);
            const ai = new AIPlayer('hint', 'hard');
            ai.hand = player.hand;
            const hint = ai.getHint(player.hand, lastPattern, isNewRound, this.gameState);

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
        const sortedHand = this._sortHand(player.hand);
        for (const targetCard of hint) {
            const idx = sortedHand.findIndex(c => c === targetCard);
            if (idx >= 0 && cardEls[idx]) {
                cardEls[idx].classList.add('hint');
                this.selectedCards.add(targetCard);
                cardEls[idx].classList.add('selected');
                // 提示牌光晕扫过
                this.anim.hintGlowSweep(cardEls[idx]);
            }
        }

            // 显示牌型
            this._updateHandHint(hint);
        } catch (e) {
            console.error('提示计算失败:', e);
            this.showToast('提示计算失败', 'error');
        }
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

        // 托管状态切换脉冲动画
        const area = this._getPlayerArea(this.mode?.humanIndex);
        this.anim.autoTogglePulse(area, player.isAuto);

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
            this._updatePlayButtonState();
            return;
        }
        if (this.gameState?.phase !== PHASE.PLAYING) {
            hintEl.textContent = '先完成叫地主';
            hintEl.className = 'hand-hint info';
            this._renderSmartSelection(null);
            this._updatePlayButtonState();
            return;
        }
        const pattern = Rules.analyze(cards);
        const allowed = this.gameState?._isPatternAllowed?.(pattern, cards) ?? pattern.isValid();
        if (pattern.isValid() && allowed) {
            hintEl.textContent = `${Rules.getTypeName(pattern.type)} (主牌: ${pattern.mainValue})`;
            hintEl.className = 'hand-hint valid';
            this._renderSmartSelection(null);
        } else {
            const playable = this._getPlayableSelection(cards);
            if (playable.optimized && playable.pattern?.isValid?.() && (this.gameState?._isPatternAllowed?.(playable.pattern, playable.cards) ?? true)) {
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
        this._updatePlayButtonState();
    }

    _updatePlayButtonState() {
        const btnPlay = this.container?.querySelector('#btn-play');
        if (!btnPlay) return;
        const cards = this._getSelectedCards();
        const pattern = Rules.analyze(cards);
        const allowed = this.gameState?._isPatternAllowed?.(pattern, cards) ?? pattern.isValid();
        const canPlay = cards.length > 0 && pattern.isValid() && allowed;
        btnPlay.disabled = !canPlay;
        btnPlay.style.opacity = canPlay ? '1' : '0.45';
        btnPlay.style.cursor = canPlay ? 'pointer' : 'not-allowed';
    }

    /**
     * 增量更新人类手牌：从 DOM 中移除已出的牌，避免全量 renderHands() 导致的卡片飞入跳动。
     * CSS flex + margin-left 规则会自动让剩余卡片重新居中，无需手动重算 overlap。
     */
    _updateHumanHand(playedCards) {
        if (this._destroyed) return;
        if (!playedCards || playedCards.length === 0) return;
        const container = this.container?.querySelector('#player-right .hand-front');
        if (!container) return;

        // 构建已出牌的唯一键集合（value + suit / joker-rankKey）
        const playedKeys = new Set();
        for (const c of playedCards) {
            const key = c.isJoker()
                ? `joker-${c.rankKey}`
                : `${c.value}-${c.suit?.name || ''}`;
            playedKeys.add(key);
        }

        // 按顺序移除已出的牌（带动画）
        const cards = Array.from(container.querySelectorAll('.card'));
        let removedCount = 0;
        for (const el of cards) {
            const isJoker = el.classList.contains('joker');
            const v = el.dataset.value;
            const s = el.dataset.suit;
            const key = isJoker ? `joker-${s}` : `${v}-${s}`;
            if (playedKeys.has(key)) {
                el.classList.remove('selected');
                el.style.pointerEvents = 'none';
                el.style.transition = 'opacity 0.15s ease-in, transform 0.15s ease-in';
                el.style.opacity = '0';
                el.style.transform = 'translateY(-20px) scale(0.9)';
                setTimeout(() => el.remove(), 150);
                removedCount++;
            }
        }

        // 兜底：若未全部匹配，说明 DOM 与手牌状态不一致，回退到全量重绘
        if (removedCount !== playedCards.length) {
            this.renderHands();
        }
        // 更新人类玩家区域的危险牌提示
        const humanArea = this._getPlayerArea(this.mode?.humanIndex);
        const player = this.gameState?.players[this.mode?.humanIndex];
        if (humanArea && player) {
            const isLow = this.gameState?.phase === PHASE.PLAYING && player.hand.length <= 5;
            const isDanger = this.gameState?.phase === PHASE.PLAYING && player.hand.length <= 2;
            humanArea.classList.toggle('low-cards', isLow);
            humanArea.classList.toggle('danger-cards', isDanger);
            // 紧张时刻评论（只触发一次）
            if (isLow && !this._tenseCommentTriggered) {
                this._tenseCommentTriggered = true;
                this.commentary?.trigger('tense');
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
        const directAllowed = this.gameState?._isPatternAllowed?.(directPattern, sorted) ?? directPattern.isValid();
        if (directPattern.isValid() && directAllowed && (isNewRound || Rules.canBeat(lastPattern, directPattern))) {
            return { cards: sorted, pattern: directPattern, optimized: false, dropped: 0 };
        }

        const candidates = [
            ...this._extractSequentialSubsets(sorted, HAND_TYPE.STRAIGHT, 1, 5),
            ...this._extractSequentialSubsets(sorted, HAND_TYPE.DOUBLE_STRAIGHT, 2, 3),
            ...this._extractSequentialSubsets(sorted, HAND_TYPE.TRIPLE_STRAIGHT, 3, 2),
            ...this._extractPrunedValidSubsets(sorted),
        ].filter(candidate => {
            if (!candidate.pattern?.isValid?.()) return false;
            if (!(this.gameState?._isPatternAllowed?.(candidate.pattern, candidate.cards) ?? true)) return false;
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

        const sorted = this._sortHand(player.hand);
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
        const sorted = this._sortHand(player.hand);
        cardEls.forEach((el, idx) => {
            const card = sorted[idx];
            if (!this.selectedCards.has(card)) return;
            el.classList.add(playCards.has(card) ? 'smart-play' : 'smart-drop');
        });
    }

    _shakeSelection() {
        const handContainer = this.container.querySelector('#player-right .hand-front');
        handContainer?.classList.add('shake');
        this._setTimer(() => {
            if (this._destroyed) return;
            handContainer?.classList.remove('shake');
        }, 400);
    }

    _toggleCardByIndex(index) {
        if (this.gameState?.phase !== PHASE.PLAYING) {
            this.showToast('请先完成叫地主', 'info');
            return;
        }
        const player = this.gameState?.players[this.mode?.humanIndex];
        if (!player) return;
        const sorted = this._sortHand(player.hand);
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
            const val = parseFloat(raw);
            return Number.isFinite(val) ? val : 7;
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
            const sorted = this._sortHand(player.hand);
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
                const sorted = player ? this._sortHand(player.hand) : [];
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
                    // 只在实际改变选牌后更新提示，避免拖拽过程中频繁解析牌型
                    this._updateHandHint(this._getSelectedCards());
                }
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
                if (handContainer._dragTimer) clearTimeout(handContainer._dragTimer);
                handContainer._dragTimer = setTimeout(() => {
                    handContainer._dragTimer = null;
                    if (handContainer) handContainer._dragJustEnded = false;
                }, 120);
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
        document.addEventListener('touchcancel', onUp);

        handContainer._dragCleanup = () => {
            handContainer.removeEventListener('mousedown', onDown);
            handContainer.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            handContainer.removeEventListener('touchstart', onDown);
            handContainer.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchcancel', onUp);
            document.removeEventListener('touchend', onUp);
        };
    }

    _bindHandScrollEnhancement(handContainer) {
        if (!handContainer) return;
        if (handContainer._scrollCleanup) {
            handContainer._scrollCleanup();
            handContainer._scrollCleanup = null;
        }

        const updateState = () => {
            const maxScroll = Math.max(0, handContainer.scrollWidth - handContainer.clientWidth);
            const progress = maxScroll > 0 ? handContainer.scrollLeft / maxScroll : 0;
            handContainer.style.setProperty('--hand-scroll-progress', progress.toFixed(4));
            handContainer.classList.toggle('can-scroll', maxScroll > 2);
            handContainer.classList.toggle('at-start', handContainer.scrollLeft <= 2);
            handContainer.classList.toggle('at-end', maxScroll <= 2 || handContainer.scrollLeft >= maxScroll - 2);
        };

        const onWheel = (e) => {
            if (e.ctrlKey || e.metaKey) {
                const settings = Storage.getSettings();
                if (settings.wheelZoom !== true) return;
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.05 : -0.05;
                const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ddz-card-scale')) || 1;
                const next = Math.max(0.7, Math.min(1, current + delta));
                document.documentElement.style.setProperty('--ddz-card-scale', String(next));
                updateState();
                return;
            }
            const maxScroll = handContainer.scrollWidth - handContainer.clientWidth;
            if (maxScroll <= 2) return;
            const primaryDelta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
            if (Math.abs(primaryDelta) < 1) return;
            const before = handContainer.scrollLeft;
            handContainer.scrollLeft = Math.max(0, Math.min(maxScroll, before + primaryDelta));
            if (handContainer.scrollLeft !== before) {
                e.preventDefault();
                updateState();
            }
        };

        handContainer.addEventListener('scroll', updateState, { passive: true });
        handContainer.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('resize', updateState);
        requestAnimationFrame(updateState);

        handContainer._scrollCleanup = () => {
            handContainer.removeEventListener('scroll', updateState);
            handContainer.removeEventListener('wheel', onWheel);
            window.removeEventListener('resize', updateState);
        };
    }

    // 渲染玩家手牌（正面，仅自己）
    renderHands() {
        if (this._destroyed) return;
        if (!this.gameState) return;
        // 重新渲染前清除选择状态，避免 DOM 与 selectedCards 不一致
        this.clearSelection();
        if (this.gameState.players?.every(player => player?.hand?.length > 5)) {
            this._lowCardReminderShown?.clear();
        }
        // 清理旧的手牌 click 监听器，防止 renderHands 多次调用时 _controlListeners 累积
        if (this._controlListeners) {
            const toRemove = [];
            for (const item of this._controlListeners) {
                if (item.el?.closest?.('.hand-front')) {
                    try { item.el.removeEventListener(item.type, item.handler, item.options); } catch (e) {}
                    toRemove.push(item);
                }
            }
            for (const item of toRemove) {
                const idx = this._controlListeners.indexOf(item);
                if (idx >= 0) this._controlListeners.splice(idx, 1);
            }
        }

        // 底牌始终可见
        const bottomEl = this.container.querySelector('#bottom-cards');
        if (this.gameState?.bottomVisible && this.gameState?.bottomCards?.length > 0) {
            if (bottomEl) {
                bottomEl.classList.remove('hidden');
                const container = bottomEl.querySelector('.cards');
                if (container) {
                    container.innerHTML = '';
                    for (const c of this.gameState.bottomCards) {
                        const el = this._createCardElement(c);
                        el.style.transform = 'scale(0.75)';
                        container.appendChild(el);
                    }
                }
            }
        } else if (bottomEl) {
            bottomEl.classList.add('hidden');
        }

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

            if ((player.isAI || i !== this.mode?.humanIndex) && !this.gameState?.showCards) {
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
            } else if (this.gameState?.showCards && i !== this.mode?.humanIndex) {
                // 明牌模式：对手手牌也显示正面（缩小）
                const sorted = this._sortHand(player.hand);
                const fragment = document.createDocumentFragment();
                for (let j = 0; j < sorted.length; j++) {
                    const card = sorted[j];
                    const el = this._createCardElement(card);
                    el.style.transform = 'scale(0.6)';
                    el.style.marginLeft = j > 0 ? '-50px' : '0';
                    el.style.pointerEvents = 'none';
                    el.style.opacity = '0.85';
                    fragment.appendChild(el);
                }
                handContainer.appendChild(fragment);
            } else {
                // 自己：显示正面，可点击/触摸选择
                handContainer.classList.toggle('selection-disabled', this.gameState?.phase !== PHASE.PLAYING);
                const sorted = this._sortHand(player.hand);
                const fragment = document.createDocumentFragment();
                for (let j = 0; j < sorted.length; j++) {
                    const card = sorted[j];
                    const el = this._createCardElement(card);
                    // margin-left 由 CSS 控制，支持响应式调整
                    el.style.setProperty('--hand-index', j + 1);

                    // 发牌入场动画
                    el.style.opacity = '0';
                    el.style.transform = 'translateY(30px) rotate(3deg)';
                    const enterStagger = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ddz-card-enter-stagger')) || 30;
                    el.style.transition = `all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) ${j * enterStagger}ms`;

                    // 支持鼠标点击和触摸（防止重复触发）
                    const toggle = (e) => {
                        // 双击的第二次 click 不触发选牌切换
                        if (e.detail > 1) return;
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
                    if (!this._controlListeners) this._controlListeners = [];
                    this._controlListeners.push({ el, type: 'click', handler: toggle });
                    fragment.appendChild(el);

                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            el.style.opacity = '1';
                            el.style.transform = '';
                        });
                    });
                }
                handContainer.appendChild(fragment);

                // 绑定拖拽选择（滑动选牌）
                this._bindDragSelection(handContainer);
                this._bindHandScrollEnhancement(handContainer);
            }

            // 更新玩家信息
            const nameEl = area.querySelector('.player-name');
            const badgeEl = area.querySelector('.player-badge');
            const avatarEl = area.querySelector('.player-avatar');
            if (nameEl) nameEl.textContent = player.name;
            if (avatarEl) {
                avatarEl.textContent = (i === this.mode?.humanIndex) ? '👤' : '🤖';
            }
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

        // 初始化记牌器（条件：避免游戏中重置已跟踪数据）
        if (!this._trackerData) this._initCardTracker();

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
            const sorted = this._sortHand(player.hand);
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
        el.dataset.suit = card.isJoker() ? card.rankKey : (card.suit?.name || card.rankKey);

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
            this._haptic(12);
            // 选牌闪光粒子
            this.anim.cardSelectSparkle(el);
        } else {
            this.audio.playCardDeselect();
            this._haptic(8);
            // 取消选中下沉动画
            this.anim.cardDeselect(el);
        }

        // 一键出牌：选牌后若牌型合法，自动打出
        const settings = Storage.getSettings();
        if (settings.oneClickPlay === true && this._isHumanPlayTurn()) {
            const selection = this._getPlayableSelection(this._getSelectedCards());
            if (selection.pattern?.isValid?.() && selection.cards.length > 0) {
                // 短暂延迟让用户看到选中效果
                if (this._oneClickTimeout) clearTimeout(this._oneClickTimeout);
                this._oneClickTimeout = setTimeout(() => {
                    this._oneClickTimeout = null;
                    this._doPlay();
                }, 180);
            } else {
                // 选牌变化后不再满足一键出牌条件，清除旧的 timeout
                if (this._oneClickTimeout) {
                    clearTimeout(this._oneClickTimeout);
                    this._oneClickTimeout = null;
                }
            }
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
                setTimeout(() => {
                    if (this._destroyed) return;
                    el.classList.remove('selection-pop');
                }, 240);
            }
        } else {
            this.selectedCards.delete(card);
            el.classList.remove('selected', 'selection-pop');
        }
    }

    _sortHand(cards) {
        return Storage.getSettings().smartSort !== false ? Card.sortSmart(cards) : Card.sortByValue(cards);
    }

    _haptic(ms = 15) {
        const settings = Storage.getSettings();
        if (settings.hapticEnabled === false) return;
        if (navigator.vibrate) {
            try { navigator.vibrate(ms); } catch (_) {}
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
        const sorted = this._sortHand(player.hand);
        cardEls.forEach((el, idx) => {
            const card = sorted[idx];
            if (!card) return;
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
        return this._sortHand(player.hand).filter(c => {
            for (const sc of this.selectedCards) {
                if (sc.value === c.value && (sc.suit?.name || sc.rankKey) === (c.suit?.name || c.rankKey)) return true;
            }
            return false;
        });
    }

    clearSelection() {
        this.selectedCards.clear();
        if (!this.container) return;
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
        if (this._destroyed) return;
        // 1. 对手区域显示小倒计时（人类玩家只在桌面中央显示大倒计时）
        const humanIdx = this.mode?.humanIndex;
        if (humanIdx !== undefined && playerIndex !== humanIdx) {
            const area = this._getPlayerArea(playerIndex);
            if (area) {
                let cd = area.querySelector('.countdown-timer');
                const isNew = !cd;
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
                if (isNew) this.anim.countdownAppear(cd);
            }
        }

        // 2. 桌面中央大倒计时（始终显示当前回合玩家）
        const centerCd = this.container.querySelector('#center-countdown');
        if (centerCd) {
            centerCd.classList.remove('hidden', 'urgent', 'critical');
            centerCd.textContent = seconds;
            if (seconds <= 5) centerCd.classList.add('critical');
            else if (seconds <= 10) centerCd.classList.add('urgent');
        }
    }

    hideCountdown() {
        if (this._destroyed) return;
        // 1. 清除玩家区域倒计时
        const areas = this.container.querySelectorAll('.player-area');
        for (const area of areas) {
            const cd = area.querySelector('.countdown-timer');
            if (cd) {
                cd.style.opacity = '0';
                if (cd._hideTimeout) clearTimeout(cd._hideTimeout);
                cd._hideTimeout = setTimeout(() => {
                    cd.remove();
                    cd._hideTimeout = null;
                }, 300);
            }
        }
        // 2. 隐藏桌面中央倒计时
        const centerCd = this.container.querySelector('#center-countdown');
        if (centerCd) centerCd.classList.add('hidden');
    }

    showThinking(playerIndex, hintText = null) {
        if (this._destroyed) return;
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
        // 增强思考动画
        this.anim.thinkingEnhance(el);
    }

    hideThinking(playerIndex) {
        if (this._destroyed) return;
        const area = this._getPlayerArea(playerIndex);
        if (!area) return;
        const el = area.querySelector('.thinking-indicator');
        if (el) {
            el.style.opacity = '0';
            this._setTimer(() => el.remove(), 300);
        }
    }

    showAIHint(playerIndex, cards) {
        if (this._destroyed) return;
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
        if (this._destroyed) return;
        const area = this._getPlayerArea(playerIndex);
        if (!area) return;
        const hint = area.querySelector('.ai-hint');
        if (hint) {
            hint.style.opacity = '0';
            this._setTimer(() => hint.remove(), 300);
        }
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
                this._setTimer(() => {
                    if (this._destroyed) return;
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
            this._setTimer(() => {
                if (this._destroyed) return;
                btn.style.transform = 'scale(1)';
                btn.style.opacity = btn.disabled ? '0.4' : '1';
            }, i * 80);
        });
    }

    hideCallControls() {
        const panel = this.container.querySelector('#call-controls');
        if (!panel || panel.classList.contains('hidden')) return;
        if (panel._hideTimeout) clearTimeout(panel._hideTimeout);
        panel.style.transition = 'transform 0.2s ease-in, opacity 0.2s ease-in';
        panel.style.transform = 'translateY(20px)';
        panel.style.opacity = '0';
        panel._hideTimeout = setTimeout(() => {
            panel.classList.add('hidden');
            panel.style.transform = '';
            panel.style.opacity = '';
            panel.style.transition = '';
            panel._hideTimeout = null;
        }, 200);
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
                           (this.gameState?.lastPlay?.playerIndex === playerIndex);
        const btnPass = panel.querySelector('#btn-pass');
        if (btnPass) btnPass.disabled = isNewRound && this.gameState?.allowPassOnFirst !== true;

        // 根据当前选牌状态动态启用/禁用出牌按钮
        this._updatePlayButtonState();

        // 上家牌型提示已移除，改为桌面中央倒计时显示

        // 按钮依次弹出
        const btns = panel.querySelectorAll('button');
        btns.forEach((btn, i) => {
            btn.style.transform = 'scale(0)';
            btn.style.opacity = '0';
            btn.style.transition = 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s';
            this._setTimer(() => {
                if (this._destroyed) return;
                btn.style.transform = 'scale(1)';
                btn.style.opacity = '1';
            }, i * 60);
        });
    }

    hidePlayControls() {
        const panel = this.container.querySelector('#play-controls');
        if (!panel || panel.classList.contains('hidden')) return;
        if (panel._hideTimeout) clearTimeout(panel._hideTimeout);
        panel.style.transition = 'transform 0.2s ease-in, opacity 0.2s ease-in';
        panel.style.transform = 'translateY(20px)';
        panel.style.opacity = '0';
        panel._hideTimeout = setTimeout(() => {
            panel.classList.add('hidden');
            panel.style.transform = '';
            panel.style.opacity = '';
            panel.style.transition = '';
            panel._hideTimeout = null;
        }, 200);
    }

    // ---- 事件动画 ----

    showCallResult(data) {
        if (this._destroyed) return;
        const area = this._getPlayerArea(data.playerIndex);
        const bubble = document.createElement('div');
        bubble.className = 'call-bubble';
        bubble.dataset.animFx = 'true';

        const settings = Storage.getSettings();
        const isOpponent = data.playerIndex !== this.mode?.humanIndex;
        const hideDetail = isOpponent && settings.showOpponentCall === false;

        if (data.mode === 'grab') {
            if (data.phase === 'call') {
                bubble.textContent = data.action === 'call' ? '叫地主' : '不叫';
            } else {
                bubble.textContent = data.action === 'grab' ? `抢地主 ×${data.multiplier}` : '不抢';
            }
        } else {
            if (hideDetail) {
                bubble.textContent = '已叫分';
            } else {
                bubble.textContent = data.action === 0 ? '不叫' : data.action + '分';
            }
        }

        area?.appendChild(bubble);
        this._setTimer(() => bubble.remove(), 1500);

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
        if (this._destroyed) return;
        this.hideCallControls();
        this.hidePlayControls();
        this.clearSelection();
        // 新局重置连击和选牌历史
        this._comboData = null;
        this._selectionHistory = [];
        this._tenseCommentTriggered = false;
        this.commentary?.resetCombo();

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
                // 3D翻转增强
                this.anim.bottomCardReveal(el, i * 150 + 300);
            }
            // 底牌揭示音效
            data.bottomCards.forEach((_, i) => {
                this._setTimer(() => this.audio?.playBottomReveal?.(), i * 150);
            });
        }

        let toastText = data.forced ? '无人叫分，默认地主' : '地主确定！';
        if (data.multiplier && data.multiplier > 1) {
            toastText += ` (${data.multiplier}倍)`;
        }
        this.showToast(toastText);
        this.audio.playLandlordConfirm();
        this.commentary?.trigger('callLandlord');

        // 重新渲染所有玩家手牌（地主获得底牌后数量变化，人类玩家需要看到新牌）
        this.renderHands();
        if (data.landlordIndex === this.mode?.humanIndex) {
            this.clearSelection();
        }

        // 皇冠动画 + 光晕
        const rect = area?.querySelector('.player-avatar')?.getBoundingClientRect();
        if (rect) {
            this.anim.landlordCrown(rect.left + rect.width/2, rect.top);
            this._setTimer(() => {
                this.anim.glowBurst(rect.left + rect.width/2, rect.top + rect.height/2, 'rgba(212,160,23,0.5)');
                this.anim.sparkleBurst(rect.left + rect.width/2, rect.top, 12);
            }, 200);
        }

        // 地主区域脉冲
        if (area) {
            area.classList.add('turn-pulse');
            this._setTimer(() => area.classList.remove('turn-pulse'), 2000);
        }
    }

    animatePlay(data) {
        if (this._destroyed) return;
        const area = this._getPlayerArea(data.playerIndex);
        const playedArea = area?.querySelector('.played-area');
        if (!playedArea) return;

        // 快速出牌检测：若距离上次出牌 < 500ms，进入轻量模式
        const now = performance.now();
        const isFastPlay = this._lastPlayTimestamp && (now - this._lastPlayTimestamp < 500);
        this._lastPlayTimestamp = now;

        // 判断是否是 AI 出牌（非人类且非观战模式下的思考）
        const isAI = data.playerIndex !== this.mode?.humanIndex && this.mode?.humanIndex >= 0;
        // 轻量模式：AI 出牌 或 快速连续出牌
        const isLite = isFastPlay || isAI;

        // 连击计数
        if (!this._comboData) this._comboData = { playerIndex: -1, count: 0 };
        if (this._comboData.playerIndex === data.playerIndex) {
            this._comboData.count++;
        } else {
            this._comboData = { playerIndex: data.playerIndex, count: 1 };
        }

        // 评论系统：连击追踪与触发
        const combo = this.commentary?.trackPlay(data.playerIndex) ?? 0;
        if (combo >= 2 && combo <= 5) {
            this.commentary?.trigger('combo', { combo });
        }

        // 旧牌退场动画（避免暴力清除导致闪断）
        const oldCards = playedArea.querySelectorAll('.table-play-card');
        oldCards.forEach(c => {
            c.style.transition = 'all 0.15s ease-in';
            c.style.opacity = '0';
            c.style.transform = 'scale(0.9)';
        });
        if (oldCards.length > 0) {
            if (playedArea._clearTimeout) clearTimeout(playedArea._clearTimeout);
            playedArea._clearTimeout = setTimeout(() => { playedArea.innerHTML = ''; playedArea._clearTimeout = null; }, 150);
        } else {
            playedArea.innerHTML = '';
        }

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

        // 延迟插入新牌，等待旧牌退场
        const insertDelay = oldCards.length > 0 ? 160 : 0;
        const insertCards = () => {
            for (let i = 0; i < sorted.length; i++) {
                const el = this._createCardElement(sorted[i]);
                el.classList.add('table-play-card');
                el.style.setProperty('--play-index', i);
                el.style.setProperty('--play-scale', playScale);
                el.style.transform = 'translateY(10px) scale(0.96)';
                el.style.opacity = '0';
                const stagger = isLite ? 20 : 40;
                const duration = isLite ? 0.25 : 0.35;
                el.style.animation = `cardPlayFlyIn ${duration}s cubic-bezier(0.175, 0.885, 0.32, 1.275) ${i * stagger}ms forwards`;
                playedArea.appendChild(el);
            }
        };
        if (insertDelay > 0) this._setTimer(insertCards, insertDelay);
        else insertCards();

        const count = area.querySelector('.card-count');
        if (count) count.textContent = data.remaining;
        area?.classList.toggle('low-cards', this.gameState?.phase === PHASE.PLAYING && data.remaining <= 5);
        area?.classList.toggle('danger-cards', this.gameState?.phase === PHASE.PLAYING && data.remaining <= 2);
        if (data.remaining > 0 && data.remaining < 3) {
            this.showLowCardReminder(data.playerIndex, data.remaining);
        }

        // 音效 + 特效（权重分级）
        const pattern = data.pattern;
        const playRect = playedArea.getBoundingClientRect();
        const centerX = playRect.left + playRect.width / 2;
        const centerY = playRect.top + playRect.height / 2;

        // 牌型权重：BOMB=3, ROCKET=3, STRAIGHT/PLANE=2, 其他=1
        const weight = (pattern.type === 'BOMB' || pattern.type === 'ROCKET') ? 3 :
                       (pattern.type === 'STRAIGHT' || pattern.type?.includes('TRIPLE_STRAIGHT')) ? 2 : 1;

        if (pattern.type === 'BOMB') {
            this.audio.playBomb();
            this.anim.explode(centerX, centerY, true);
            this.anim.screenShake(6, 500);
            if (!isLite) this.anim.bounceText(centerX, centerY - 40, '💥 炸弹！', '#ff4444');
            this.commentary?.trigger('bomb');
        } else if (pattern.type === 'ROCKET') {
            this.audio.playRocket();
            this.anim.rocketFly(playRect.left, playRect.top + playRect.height, playRect.left + 200, playRect.top - 100);
            this.anim.screenShake(4, 400);
            if (!isLite) {
                this.anim.flashScreen('rgba(255,255,255,0.15)', 300);
                this.anim.bounceText(centerX, centerY - 40, '🚀 火箭！', '#ff8c00');
            }
            this.commentary?.trigger('rocket');
        } else if (pattern.type === 'STRAIGHT') {
            this.audio.playStraight();
            if (!isLite) this.anim.glowBurst(centerX, centerY, 'rgba(100,200,255,0.4)');
            this.commentary?.trigger('straight');
        } else if (pattern.type?.includes('TRIPLE_STRAIGHT')) {
            this.audio.playPlane();
            if (!isLite) this.anim.glowBurst(centerX, centerY, 'rgba(255,100,200,0.4)');
            // 轻量模式下 sparkleBurst 粒子数减半
            if (!isLite) this.anim.sparkleBurst(centerX, centerY, isAI ? 5 : 10);
            this.commentary?.trigger('plane');
        } else if (pattern.type === 'PAIR') {
            this.audio.playPair();
            this.commentary?.trigger('pair');
        } else if (pattern.type === 'TRIPLE' || pattern.type?.includes('TRIPLE_WITH')) {
            this.audio.playTriple();
            if (!isLite) this.anim.pulseRing(centerX, centerY, '#f0c040', 60);
        } else if (pattern.type === 'FOUR_WITH_TWO' || pattern.type === 'FOUR_WITH_TWO_PAIRS') {
            this.audio.playFourWithTwo();
        } else if (pattern.type === 'SINGLE') {
            this.audio.playSingle();
            this.commentary?.trigger('single');
        } else {
            this.audio.playPlay();
        }

        // 连击特效：炸弹/火箭时跳过，轻量模式跳过
        if (this._comboData.count >= 2 && weight < 3 && !isLite) {
            this.anim.comboEffect(centerX, centerY - 60, this._comboData.count);
        }

        // 更新记牌器
        this._updateCardTracker(data.cards);
        // 更新历史
        this._addHistory(data);

        // 如果出牌者是人类玩家，增量更新手牌（避免全量重绘导致跳动）
        if (data.playerIndex === this.mode?.humanIndex) {
            this._updateHumanHand(data.cards);
            this.clearSelection();
        }
    }

    showPass(playerIndex) {
        if (this._destroyed) return;
        const area = this._getPlayerArea(playerIndex);
        const bubble = document.createElement('div');
        bubble.className = 'pass-bubble';
        bubble.dataset.animFx = 'true';
        bubble.textContent = '不出';
        area?.appendChild(bubble);
        this._setTimer(() => {
            bubble.style.transition = 'opacity 0.2s ease-in';
            bubble.style.opacity = '0';
            this._setTimer(() => bubble.remove(), 200);
        }, 600);

        const playedArea = area?.querySelector('.played-area');
        if (playedArea) {
            // 简化 pass 清空动画：直接清理，不做旋转缩放
            playedArea.innerHTML = '';
            playedArea.classList.remove('has-cards');
            playedArea.classList.add('has-pass');
            delete playedArea.dataset.cardCount;
            playedArea.style.removeProperty('--table-play-overlap');
        }

        this.audio.playPass();
        // 只有人类玩家过牌时触发评论（避免AI频繁过牌干扰）
        if (playerIndex === this.mode?.humanIndex) {
            this.commentary?.trigger('pass');
        }
        this.audio.playPassTurn();
        this._addHistory({playerIndex, cards: [], pattern: {type: 'PASS'}, pass: true});
    }

    // AI/玩家快捷短语已禁用，避免牌局中出现闲聊干扰。
    showChatBubble(playerIndex, text) {
        return;
    }

    showLowCardReminder(playerIndex, count) {
        if (this._destroyed) return;
        if (!Number.isFinite(count) || count <= 0 || count >= 3) return;
        const key = `${playerIndex}:${count}`;
        if (this._lowCardReminderShown?.has(key)) return;
        this._lowCardReminderShown?.add(key);

        const area = this._getPlayerArea(playerIndex);
        if (!area) return;
        const player = this.gameState?.players?.[playerIndex];
        const isHuman = playerIndex === this.mode?.humanIndex;

        const bubble = document.createElement('div');
        bubble.className = 'low-card-reminder';
        bubble.dataset.animFx = 'true';
        bubble.textContent = isHuman ? `我就剩${count}张牌了` : `${player?.name || '对手'}就剩${count}张牌了`;
        bubble.style.opacity = '0';
        bubble.style.transform = 'translateX(-50%) translateY(6px)';
        bubble.style.transition = 'opacity 0.18s ease-out, transform 0.18s ease-out';
        area.appendChild(bubble);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                bubble.style.opacity = '1';
                bubble.style.transform = 'translateX(-50%) translateY(0)';
            });
        });

        this._setTimer(() => {
            bubble.style.transition = 'opacity 0.18s ease';
            bubble.style.opacity = '0';
            this._setTimer(() => bubble.remove(), 180);
        }, 1500);
    }

    highlightTurn(playerIndex) {
        if (this._destroyed) return;
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

        // 回合切换光晕扩散
        this.anim.turnSwitchGlow(area);
        // 头像脉冲发光
        const avatar = area?.querySelector('.player-avatar');
        this.anim.avatarPulse(avatar);

        // 清理当前玩家区域的旧出牌状态（避免"不出"残留）
        const playedArea = area?.querySelector('.played-area');
        if (playedArea && this.gameState?.phase === PHASE.PLAYING) {
            playedArea.classList.remove('has-pass');
            // 如果是新一轮首家，清空 played-area
            const isNewRound = !this.gameState?.lastPlay ||
                this.gameState.lastPlay?.pattern?.type === 'INVALID' ||
                (this.gameState?.passCount >= 2) ||
                (this.gameState?.lastPlay?.playerIndex === playerIndex);
            if (isNewRound) {
                playedArea.innerHTML = '';
                playedArea.classList.remove('has-cards');
                delete playedArea.dataset.cardCount;
                playedArea.style.removeProperty('--table-play-scale');
                playedArea.style.removeProperty('--table-play-overlap');
            }
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

    _closeModal(overlay, content) {
        if (!overlay || overlay.classList.contains('modal-exit')) return;
        if (overlay._modalCloseTimeout) return;
        if (this._modalOverlayClick) {
            overlay.removeEventListener('click', this._modalOverlayClick);
            this._modalOverlayClick = null;
        }
        // 取消可能正在运行的分数滚动动画
        if (this._scoreRafs) {
            for (const id of this._scoreRafs) cancelAnimationFrame(id);
            this._scoreRafs = [];
        }
        content?.classList.add('modal-exit');
        overlay.classList.add('modal-exit');
        overlay._modalCloseTimeout = this._setTimer(() => {
            overlay.classList.add('hidden');
            overlay.classList.remove('modal-exit');
            content?.classList.remove('modal-exit');
            overlay._modalCloseTimeout = null;
        }, 250);
    }

    showRoundResult(data, matchStatus = null) {
        if (this._destroyed) return;
        const overlay = this.container.querySelector('#modal-overlay');
        const content = this.container.querySelector('#modal-content');
        if (!overlay || !content || !this.gameState) return;
        this._lastRoundResult = { data, matchStatus };

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

        // XSS 转义工具函数
        const esc = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[m]);

        if (matchStatus?.isMatchMode) {
            matchText = `<div class="match-round">第 ${matchStatus.currentRound} / ${matchStatus.totalRounds} 局</div>`;

            // 累计比分
            const sorted = (matchStatus.matchScores || []).map((s, i) => ({ score: s, index: i, name: this.gameState.players[i]?.name }))
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

            // 锦标赛增强信息
            if (matchStatus.isTournament && matchStatus.roundResults?.length > 0) {
                const lastRound = matchStatus.roundResults[matchStatus.roundResults.length - 1];
                const humanIdx = this.mode?.humanIndex ?? -1;

                // 本局得分增量
                const roundDeltaHtml = lastRound.scores.map((s, i) => `
                    <span class="tour-delta ${s > 0 ? 'positive' : s < 0 ? 'negative' : ''}">${esc(this.gameState.players[i]?.name || '?')}: ${s > 0 ? '+' : ''}${s}</span>
                `).join('');

                // 排名变化
                const prevScores = matchStatus.roundResults.length > 1
                    ? matchStatus.roundResults[matchStatus.roundResults.length - 2].cumulativeScores
                    : [0, 0, 0];
                const prevSorted = prevScores.map((s, i) => ({ score: s, index: i })).sort((a, b) => b.score - a.score);
                const currSorted = lastRound.cumulativeScores.map((s, i) => ({ score: s, index: i })).sort((a, b) => b.score - a.score);
                const prevRank = new Array(3);
                const currRank = new Array(3);
                prevSorted.forEach((p, i) => { prevRank[p.index] = i + 1; });
                currSorted.forEach((p, i) => { currRank[p.index] = i + 1; });

                const rankChangeHtml = currRank.map((r, i) => {
                    const change = prevRank[i] - r;
                    const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '-';
                    const cls = change > 0 ? 'up' : change < 0 ? 'down' : 'same';
                    return `<span class="tour-rank ${cls}">${esc(this.gameState.players[i]?.name || '?')}: 第${r}名 ${arrow}${change !== 0 ? Math.abs(change) : ''}</span>`;
                }).join('');

                // MVP（累计最高）
                const mvp = currSorted[0];
                const mvpHtml = `<div class="tour-mvp">👑 当前榜首: ${esc(this.gameState.players[mvp.index]?.name || '?')} (${mvp.score > 0 ? '+' : ''}${mvp.score})</div>`;

                matchScoreText += `
                    <div class="tour-round-info">
                        <div class="tour-round-title">📊 本局战况</div>
                        <div class="tour-deltas">${roundDeltaHtml}</div>
                        <div class="tour-ranks">${rankChangeHtml}</div>
                        ${mvpHtml}
                    </div>
                `;
            }

            if (matchStatus.isFinished) {
                isMatchEnd = true;
                matchText = `<div class="match-round match-end">🏆 比赛结束</div>`;
                if (matchStatus.isTournament) {
                    nextButtonText = '查看锦标赛结果';
                } else {
                    nextButtonText = '重新开始';
                }
                this.audio.playMatchEnd();
            } else {
                nextButtonText = '下一局';
            }
        }

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
            <button id="btn-coach-review">🤖 AI 教练复盘</button>
            <button id="btn-share-round">📋 分享本局</button>
            <button id="btn-round-back-menu">返回菜单</button>
        `;

        if (overlay._modalCloseTimeout) {
            clearTimeout(overlay._modalCloseTimeout);
            overlay._modalCloseTimeout = null;
        }
        // 清理上一个 modal 的 overlay click listener，防止快速重入时累积
        if (this._modalOverlayClick) {
            overlay.removeEventListener('click', this._modalOverlayClick);
        }
        overlay.classList.remove('hidden');
        overlay.classList.remove('modal-exit');
        content.classList.remove('modal-exit');
        // 点击背景关闭模态框
        this._modalOverlayClick = (e) => {
            if (e.target === overlay) this._closeModal(overlay, content);
        };
        overlay.addEventListener('click', this._modalOverlayClick);
        // 重置动画：先移除类，下一帧再添加，确保动画每次都播放
        content.classList.remove('modal-scale-in');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                content.classList.add('modal-scale-in');
            });
        });

        // 得分数字滚动动画
        const scoreEls = content.querySelectorAll('.score-value');
        this._scoreRafs = [];
        for (const el of scoreEls) {
            const target = parseInt(el.dataset.target, 10);
            const sign = el.dataset.sign || '';
            const duration = 800;
            const startTime = performance.now();
            let rafId;
            const animate = (now) => {
                if (this._destroyed) return;
                const elapsed = now - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
                const current = Math.round(target * eased);
                el.textContent = sign + current;
                if (progress < 1) {
                    rafId = requestAnimationFrame(animate);
                } else {
                    const idx = this._scoreRafs?.indexOf(rafId);
                    if (idx >= 0) this._scoreRafs.splice(idx, 1);
                }
            };
            rafId = requestAnimationFrame(animate);
            this._scoreRafs.push(rafId);
        }

        // 胜利/失败庆祝动画
        if (isHumanWin) {
            this.commentary?.trigger('win');
            this._setTimer(() => {
                if (this._destroyed) return;
                this.anim.winCelebrate(data.isLandlordWin, data.winnerIndex);
                // 金色雨
                this.anim.goldRain();
            }, 300);
        } else {
            this.commentary?.trigger('lose');
            // 人类输了：简单闪光
            this._setTimer(() => {
                if (this._destroyed) return;
                this.anim.flashScreen('rgba(100,100,100,0.15)', 400);
            }, 200);
        }

        // 春天/反春天特效
        if (data.springType) {
            this.commentary?.trigger(data.springType === 'spring' ? 'spring' : 'antiSpring');
            this._setTimer(() => {
                if (this._destroyed) return;
                this.audio.playSpring();
                this.anim.springCelebrate();
            }, 600);
        }

        const btnNext = content.querySelector('#btn-next-round');
        if (btnNext) {
            btnNext._roundClickHandler = () => {
                this.audio.playButtonClick();
                this._closeModal(overlay, content);
                if (isMatchEnd && matchStatus?.isTournament) {
                    // 锦标赛结束，显示锦标赛结算面板
                    this.showTournamentResult(matchStatus);
                    return;
                }
                if (isMatchEnd && matchStatus) {
                    // 比赛结束，重置
                    this.mode?.setMatchRounds(matchStatus.totalRounds);
                }
                this.mode?.startGame();
            };
            btnNext.addEventListener('click', btnNext._roundClickHandler);
        }

        if (!isMatchEnd) {
            const btnReplay = content.querySelector('#btn-replay');
            if (btnReplay) {
                btnReplay._roundClickHandler = () => {
                    this.audio.playButtonClick();
                    this._closeModal(overlay, content);
                    if (window.gameApp?.startReplay) {
                        window.gameApp.startReplay('latest');
                    }
                };
                btnReplay.addEventListener('click', btnReplay._roundClickHandler);
            }
        }

        const btnShare = content.querySelector('#btn-share-round');
        if (btnShare) {
            btnShare._roundClickHandler = () => {
                this.audio.playButtonClick();
                this._shareRoundResult(data, matchStatus);
            };
            btnShare.addEventListener('click', btnShare._roundClickHandler);
        }

        const btnRoundBackMenu = content.querySelector('#btn-round-back-menu');
        if (btnRoundBackMenu) {
            btnRoundBackMenu._roundClickHandler = () => {
                this.audio.playButtonClick();
                this._closeModal(overlay, content);
                window.gameApp?.showMenu();
            };
            btnRoundBackMenu.addEventListener('click', btnRoundBackMenu._roundClickHandler);
        }

        const btnCoach = content.querySelector('#btn-coach-review');
        if (btnCoach) {
            btnCoach._roundClickHandler = () => {
                this.audio.playButtonClick();
                const result = window.gameApp?._lastCoachResult;
                if (result) {
                    this.showCoachReview(result, overlay, content);
                } else {
                    this.showToast('暂无复盘数据', 'info');
                }
            };
            btnCoach.addEventListener('click', btnCoach._roundClickHandler);
        }
    }

    showCoachReview(result, overlay, content) {
        if (!content || !result) return;
        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[m]);
        const severityClass = (s) => s === 'high' ? 'severity-high' : s === 'medium' ? 'severity-medium' : 'severity-low';
        const severityIcon = (s) => s === 'high' ? '🔴' : s === 'medium' ? '🟡' : '🟢';

        const score = result.summary.score;
        const scoreClass = score >= 80 ? 'score-good' : score >= 50 ? 'score-mid' : 'score-bad';

        content.innerHTML = `
            <h2>🤖 AI 教练复盘</h2>
            <div class="coach-score ${scoreClass}">
                <span class="coach-score-value">${score}</span>
                <span class="coach-score-label">复盘得分</span>
            </div>
            <div class="coach-suggestions">
                ${result.suggestions.map((s, i) => `
                    <div class="coach-suggestion ${severityClass(s.severity)}">
                        <div class="coach-suggestion-header">
                            <span class="coach-suggestion-icon">${severityIcon(s.severity)}</span>
                            <span class="coach-suggestion-title">${esc(s.message)}</span>
                        </div>
                        ${s.detail ? `<div class="coach-suggestion-detail">${esc(s.detail)}</div>` : ''}
                        ${s.roundIndex >= 0 ? `<button class="coach-jump-btn" data-round="${s.roundIndex}">⏩ 跳转到第 ${s.roundIndex + 1} 回合</button>` : ''}
                    </div>
                `).join('')}
            </div>
            <button id="btn-coach-close">← 返回结算</button>
        `;

        // 绑定跳转按钮
        content.querySelectorAll('.coach-jump-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.audio.playButtonClick();
                const roundIdx = parseInt(btn.dataset.round, 10);
                this._closeModal(overlay, content);
                if (window.gameApp?.startReplay) {
                    window.gameApp.startReplay(roundIdx);
                }
            });
        });

        const btnClose = content.querySelector('#btn-coach-close');
        if (btnClose) {
            btnClose.addEventListener('click', () => {
                this.audio.playButtonClick();
                if (this._lastRoundResult) {
                    this.showRoundResult(this._lastRoundResult.data, this._lastRoundResult.matchStatus);
                } else {
                    this._closeModal(overlay, content);
                }
            });
        }
    }

    showTournamentResult(matchStatus) {
        const overlay = this.container.querySelector('#modal-overlay');
        const content = this.container.querySelector('#modal-content');
        if (!overlay || !content) return;

        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[m]);
        const gs = this.gameState;
        const humanIdx = this.mode?.humanIndex ?? -1;
        const roundResults = matchStatus.roundResults || [];

        // 最终排名
        const finalScores = matchStatus.matchScores || [0, 0, 0];
        const finalRankings = finalScores
            .map((score, i) => ({ score, index: i, name: gs?.players[i]?.name || '?', isHuman: i === humanIdx }))
            .sort((a, b) => b.score - a.score);

        const playerRank = finalRankings.findIndex(p => p.isHuman) + 1;
        const playerScore = humanIdx >= 0 ? finalScores[humanIdx] : 0;

        // 冠亚季军
        const crownMedal = ['🥇', '🥈', '🥉'];
        const podiumHtml = finalRankings.slice(0, 3).map((p, i) => `
            <div class="tour-podium-item rank-${i + 1} ${p.isHuman ? 'is-human' : ''}">
                <div class="tour-podium-rank">${crownMedal[i]}</div>
                <div class="tour-podium-name">${esc(p.name)}</div>
                <div class="tour-podium-score">${p.score > 0 ? '+' : ''}${p.score}</div>
            </div>
        `).join('');

        // 每轮回顾
        const roundHistoryHtml = roundResults.map((r, i) => {
            const roundRanks = [...r.cumulativeScores]
                .map((s, idx) => ({ score: s, index: idx }))
                .sort((a, b) => b.score - a.score);
            const rankMap = new Array(3);
            roundRanks.forEach((p, idx) => { rankMap[p.index] = idx + 1; });
            return `
                <div class="tour-history-round">
                    <div class="tour-history-header">第 ${r.round} 局</div>
                    <div class="tour-history-scores">
                        ${r.cumulativeScores.map((s, idx) => `
                            <span class="${idx === humanIdx ? 'human' : ''}">${esc(gs?.players[idx]?.name || '?')}: ${s > 0 ? '+' : ''}${s}</span>
                        `).join('')}
                    </div>
                    <div class="tour-history-meta">
                        <span> winner: ${esc(gs?.players[r.winnerIndex]?.name || '?')}</span>
                        ${r.springType ? `<span>${r.springType === 'spring' ? '🌸春天' : '🌸反春天'}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // 玩家总结
        const humanName = humanIdx >= 0 ? gs?.players[humanIdx]?.name || '玩家' : '玩家';
        const winCount = roundResults.filter(r => r.isHumanWin).length;
        const landlordCount = roundResults.filter(r => r.landlordIndex === humanIdx).length;
        const summaryHtml = `
            <div class="tour-player-summary">
                <div class="tour-summary-title">📊 ${esc(humanName)} 的锦标赛表现</div>
                <div class="tour-summary-grid">
                    <div><span>最终排名</span><strong>第 ${playerRank} 名</strong></div>
                    <div><span>总得分</span><strong>${playerScore > 0 ? '+' : ''}${playerScore}</strong></div>
                    <div><span>获胜局数</span><strong>${winCount} / ${roundResults.length}</strong></div>
                    <div><span>当地主</span><strong>${landlordCount} 次</strong></div>
                </div>
            </div>
        `;

        content.innerHTML = `
            <h2>🏆 锦标赛结算</h2>
            <div class="tour-podium">${podiumHtml}</div>
            ${summaryHtml}
            <div class="tour-history">
                <div class="tour-history-title">📜 每轮回顾</div>
                <div class="tour-history-list">${roundHistoryHtml}</div>
            </div>
            <button id="btn-tour-share">📋 复制战报</button>
            <button id="btn-tour-restart">🔄 再来一局锦标赛</button>
            <button id="btn-tour-menu">返回菜单</button>
        `;

        overlay.classList.remove('hidden', 'modal-exit');
        content.classList.remove('modal-exit');
        content.classList.remove('modal-scale-in');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => content.classList.add('modal-scale-in'));
        });

        // 绑定按钮
        const btnShare = content.querySelector('#btn-tour-share');
        if (btnShare) {
            btnShare.addEventListener('click', () => {
                this.audio.playButtonClick();
                this._shareTournamentResult(matchStatus, finalRankings, playerRank, winCount);
            });
        }

        const btnRestart = content.querySelector('#btn-tour-restart');
        if (btnRestart) {
            btnRestart.addEventListener('click', () => {
                this.audio.playButtonClick();
                this._closeModal(overlay, content);
                const mode = this.mode;
                if (mode?.setMatchRounds && mode?.startGame) {
                    mode.setMatchRounds(mode.totalRounds || matchStatus.totalRounds);
                    mode.startGame();
                }
            });
        }

        const btnMenu = content.querySelector('#btn-tour-menu');
        if (btnMenu) {
            btnMenu.addEventListener('click', () => {
                this.audio.playButtonClick();
                this._closeModal(overlay, content);
                window.gameApp?.showMenu();
            });
        }
    }

    _shareTournamentResult(matchStatus, finalRankings, playerRank, winCount) {
        const total = matchStatus.totalRounds;
        const lines = [
            '🃏 斗地主 WebGame 锦标赛战报',
            `📊 ${total}局锦标赛 · 最终排名`,
            '',
            ...finalRankings.map((p, i) => `${['🥇','🥈','🥉'][i] || `${i+1}.`} ${p.name}: ${p.score > 0 ? '+' : ''}${p.score}`),
            '',
            `我的排名: 第 ${playerRank} 名 · 获胜 ${winCount}/${total} 局`,
        ];
        const text = lines.join('\n');
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(() => this.showToast('战报已复制', 'success')).catch(() => this.showToast('复制失败', 'error'));
        } else {
            this.showToast('浏览器不支持自动复制', 'info');
        }
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

    // 显示每日挑战结果（委托给 GameApp）
    showChallengeResult(result, roundData, stats) {
        if (window.gameApp?.openChallengeResult) {
            window.gameApp.openChallengeResult(result, roundData, stats);
        }
    }

    // ---- 残局训练 UI ----

    showEndgameInfo(level) {
        if (!this.container || this._destroyed) return;
        const infoBar = this.container.querySelector('#endgame-info-bar');
        if (infoBar) infoBar.remove();
        const bar = document.createElement('div');
        bar.id = 'endgame-info-bar';
        bar.className = 'endgame-info-bar';
        bar.innerHTML = `
            <div class="endgame-info-title">🧩 第${level.id}关 · ${level.name}</div>
            <div class="endgame-info-obj">目标: ${level.objective}</div>
            <button class="endgame-info-hint-btn" title="查看提示">💡 提示</button>
        `;
        const controls = this.container.querySelector('#controls-area');
        if (controls) controls.insertBefore(bar, controls.firstChild);
        else this.container.appendChild(bar);

        const hintBtn = bar.querySelector('.endgame-info-hint-btn');
        if (hintBtn) {
            hintBtn.addEventListener('click', () => {
                this.audio.playButtonClick();
                this.showToast(`💡 提示: ${level.hint}`, 'info');
            });
        }
    }

    showEndgameResult(passed, stars, levelIndex, progress) {
        if (this._destroyed) return;
        const overlay = this.container.querySelector('#modal-overlay');
        const content = this.container.querySelector('#modal-content');
        if (!overlay || !content) return;

        const level = window.gameApp?.currentMode?.constructor?.name === 'EndgameMode'
            ? window.gameApp.currentMode.getLevelInfo()
            : null;

        const starHtml = '⭐'.repeat(stars) + '<span class="star-empty">' + '⭐'.repeat(3 - stars) + '</span>';
        const title = passed ? '挑战成功' : '挑战失败';
        const titleColor = passed ? '#4caf50' : '#ff6b6b';
        const hasNext = passed && levelIndex + 1 < progress.total;

        content.innerHTML = `
            <h2 style="color:${titleColor}">${title}</h2>
            <div class="challenge-stars" style="font-size:1.6rem;margin:8px 0">${starHtml}</div>
            ${level ? `<div class="endgame-result-level">第${level.id}关 · ${level.name}</div>` : ''}
            ${passed && level?.humanStepCount ? `<div class="endgame-result-steps">本局 ${level.humanStepCount} 步</div>` : ''}
            <div class="endgame-result-progress">总进度: ${progress.passed}/${progress.total} · ⭐ ${progress.totalStars}/${progress.maxStars}</div>
            <button id="btn-endgame-retry" class="btn-primary">${passed ? '再玩一次' : '重新挑战'}</button>
            ${hasNext ? '<button id="btn-endgame-next" class="btn-primary">下一关</button>' : ''}
            <button id="btn-endgame-back">返回关卡列表</button>
        `;

        if (overlay._modalCloseTimeout) clearTimeout(overlay._modalCloseTimeout);
        if (this._modalOverlayClick) {
            overlay.removeEventListener('click', this._modalOverlayClick);
        }
        overlay.classList.remove('hidden', 'modal-exit');
        content.classList.remove('modal-exit');
        this._modalOverlayClick = (e) => {
            if (e.target === overlay) this._closeModal(overlay, content);
        };
        overlay.addEventListener('click', this._modalOverlayClick);
        content.classList.remove('modal-scale-in');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                content.classList.add('modal-scale-in');
            });
        });

        if (passed) this.audio.playWin();
        else this.audio.playLose();

        const btnRetry = content.querySelector('#btn-endgame-retry');
        if (btnRetry) {
            btnRetry._roundClickHandler = () => {
                this.audio.playButtonClick();
                this._closeModal(overlay, content);
                window.gameApp?.startEndgameMode?.(levelIndex);
            };
            btnRetry.addEventListener('click', btnRetry._roundClickHandler);
        }

        if (hasNext) {
            const btnNext = content.querySelector('#btn-endgame-next');
            if (btnNext) {
                btnNext._roundClickHandler = () => {
                    this.audio.playButtonClick();
                    this._closeModal(overlay, content);
                    window.gameApp?.startEndgameMode?.(levelIndex + 1);
                };
                btnNext.addEventListener('click', btnNext._roundClickHandler);
            }
        }

        const btnBack = content.querySelector('#btn-endgame-back');
        if (btnBack) {
            btnBack._roundClickHandler = () => {
                this.audio.playButtonClick();
                this._closeModal(overlay, content);
                window.gameApp?.showEndgameLevels?.();
            };
            btnBack.addEventListener('click', btnBack._roundClickHandler);
        }
    }

    // ---- 极限挑战 UI ----

    showChallengeInfo(challenge) {
        if (!this.container || this._destroyed) return;
        const infoBar = this.container.querySelector('#challenge-info-bar');
        if (infoBar) infoBar.remove();
        const bar = document.createElement('div');
        bar.id = 'challenge-info-bar';
        bar.className = 'challenge-info-bar';
        bar.innerHTML = `
            <div class="challenge-info-title">${challenge.icon} ${challenge.title}</div>
            <div class="challenge-info-desc">${challenge.desc}</div>
        `;
        const controls = this.container.querySelector('#controls-area');
        if (controls) controls.insertBefore(bar, controls.firstChild);
        else this.container.appendChild(bar);
    }

    showExtremeChallengeResult(passed, stars, challenge, progress) {
        if (!this.container || this._destroyed) return;
        const overlay = this.container.querySelector('#modal-overlay');
        const content = this.container.querySelector('#modal-content');
        if (!overlay || !content) return;

        const starHtml = '⭐'.repeat(stars) + '<span class="star-empty">' + '⭐'.repeat(3 - stars) + '</span>';
        const title = passed ? '挑战成功' : '挑战失败';
        const titleColor = passed ? '#4caf50' : '#ff6b6b';
        const challengeId = challenge?.id || 0;
        const hasNext = passed && challengeId < CHALLENGES.length;

        content.innerHTML = `
            <h2 style="color:${titleColor}">${title}</h2>
            <div class="challenge-stars" style="font-size:1.6rem;margin:8px 0">${starHtml}</div>
            ${challenge ? `<div class="challenge-result-name">${challenge.icon} ${challenge.title}</div>` : ''}
            <div class="challenge-result-progress">总进度: ${progress.passed}/${progress.total} · ⭐ ${progress.totalStars}/${progress.maxStars}</div>
            <button id="btn-challenge-retry" class="btn-primary">${passed ? '再玩一次' : '重新挑战'}</button>
            ${hasNext ? '<button id="btn-challenge-next" class="btn-primary">下一关</button>' : ''}
            <button id="btn-challenge-back">返回关卡列表</button>
        `;

        if (overlay._modalCloseTimeout) clearTimeout(overlay._modalCloseTimeout);
        if (this._modalOverlayClick) {
            overlay.removeEventListener('click', this._modalOverlayClick);
        }
        overlay.classList.remove('hidden', 'modal-exit');
        content.classList.remove('modal-exit');
        this._modalOverlayClick = (e) => {
            if (e.target === overlay) this._closeModal(overlay, content);
        };
        overlay.addEventListener('click', this._modalOverlayClick);
        content.classList.remove('modal-scale-in');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                content.classList.add('modal-scale-in');
            });
        });

        if (passed) this.audio.playWin();
        else this.audio.playLose();

        const btnRetry = content.querySelector('#btn-challenge-retry');
        if (btnRetry) {
            btnRetry._roundClickHandler = () => {
                this.audio.playButtonClick();
                this._closeModal(overlay, content);
                window.gameApp?.startChallengeMode?.(challengeId);
            };
            btnRetry.addEventListener('click', btnRetry._roundClickHandler);
        }

        if (hasNext) {
            const btnNext = content.querySelector('#btn-challenge-next');
            if (btnNext) {
                btnNext._roundClickHandler = () => {
                    this.audio.playButtonClick();
                    this._closeModal(overlay, content);
                    window.gameApp?.startChallengeMode?.(challengeId + 1);
                };
                btnNext.addEventListener('click', btnNext._roundClickHandler);
            }
        }

        const btnBack = content.querySelector('#btn-challenge-back');
        if (btnBack) {
            btnBack._roundClickHandler = () => {
                this.audio.playButtonClick();
                this._closeModal(overlay, content);
                window.gameApp?.showChallengeLevels?.();
            };
            btnBack.addEventListener('click', btnBack._roundClickHandler);
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
        toast.className = 'toast-message toast-bounce toast-notification';
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

        this._setTimer(() => {
            if (this._destroyed) return;
            toast.style.transition = 'all 0.3s ease-in';
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(-20px) scale(0.9)';
            this._setTimer(() => toast.remove(), 300);
        }, 1800);
    }

    showAchievementUnlock(achievements) {
        if (!achievements?.length) return;
        if (!this.container) {
            window.gameApp?._showFallbackToast?.('🏆 解锁了 ' + achievements.length + ' 个成就', 'success');
            return;
        }
        const esc = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[m]);
        achievements.slice(0, 3).forEach((ach, i) => {
            this._setTimer(() => {
                if (this._destroyed) return;
                // 限制同时存在的成就toast数量
                const existing = this.container.querySelectorAll('.achievement-toast:not(.quest-toast)');
                if (existing.length >= 3) existing[0].remove();
                const el = document.createElement('div');
                el.className = 'achievement-toast';
                el.dataset.animFx = 'true';
                el.innerHTML = `
                    <div class="ach-icon">${esc(ach.icon)}</div>
                    <div class="ach-body">
                        <div class="ach-title">成就解锁</div>
                        <div class="ach-name">${esc(ach.name)}</div>
                        <div class="ach-desc">${esc(ach.desc)}</div>
                    </div>
                `;
                this.container.appendChild(el);
                this.audio?.playWin?.();
                this._setTimer(() => {
                    el.style.transition = 'all 0.5s ease-in';
                    el.style.opacity = '0';
                    el.style.transform = 'translateX(-50%) translateY(-30px) scale(0.9)';
                    this._setTimer(() => el.remove(), 500);
                }, 3500);
            }, i * 600);
        });
    }

    showQuestCompleted(quests) {
        if (!quests?.length) return;
        if (!this.container) {
            window.gameApp?._showFallbackToast?.('📜 完成了 ' + quests.length + ' 个任务', 'success');
            return;
        }
        const esc = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[m]);
        quests.slice(0, 3).forEach((q, i) => {
            this._setTimer(() => {
                if (this._destroyed) return;
                // 限制同时存在的任务toast数量
                const existing = this.container.querySelectorAll('.quest-toast');
                if (existing.length >= 3) existing[0].remove();
                const meta = q.desc || '';
                const rewardText = [];
                if (q.reward?.exp) rewardText.push(`+${q.reward.exp} EXP`);
                if (q.reward?.badgeName) rewardText.push(`🏅 ${q.reward.badgeName}`);
                const el = document.createElement('div');
                el.className = 'achievement-toast quest-toast';
                el.dataset.animFx = 'true';
                el.innerHTML = `
                    <div class="ach-icon">📜</div>
                    <div class="ach-body">
                        <div class="ach-title">任务完成</div>
                        <div class="ach-name">${esc(q.name)}</div>
                        <div class="ach-desc">${esc(meta)} ${rewardText.join(' · ')}</div>
                    </div>
                `;
                this.container.appendChild(el);
                this.audio?.playWin?.();
                this._setTimer(() => {
                    el.style.transition = 'all 0.5s ease-in';
                    el.style.opacity = '0';
                    el.style.transform = 'translateX(-50%) translateY(-30px) scale(0.9)';
                    this._setTimer(() => el.remove(), 500);
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

    /**
     * 从记牌器中减去一张牌的计数（内部工具方法）
     */
    _deductFromTracker(card) {
        const isJoker = typeof card?.isJoker === 'function'
            ? card.isJoker()
            : /JOKER/.test(card?.rankKey);
        const rankKey = isJoker
            ? (card?.rankKey || card?.rank?.name)
            : (card?.rank?.name || card?.rankKey);
        if (!rankKey || !this._trackerData || !(rankKey in this._trackerData)) return;

        const oldVal = this._trackerData[rankKey];
        this._trackerData[rankKey] = Math.max(0, oldVal - 1);
        const remaining = this._trackerData[rankKey];

        const cell = this.container?.querySelector(`.tracker-rank[data-rank="${rankKey}"]`);
        if (cell) {
            const countEl = cell.querySelector('.tracker-rank-count');
            if (countEl) {
                countEl.textContent = remaining;
                if (remaining === 0 && oldVal > 0) {
                    countEl.classList.add('count-jump');
                    this._setTimer(() => countEl.classList.remove('count-jump'), 300);
                }
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

    /**
     * 初始化或重置记牌器为满牌 54 张。
     * 记牌器只追踪"已打出的牌"，开局时所有牌都显示为剩余。
     */
    _resetCardTracker() {
        this._initCardTracker();
    }

    _updateCardTracker(playedCards) {
        if (!playedCards) return;
        if (!this._trackerData) {
            this._initCardTracker();
        }
        for (const card of playedCards) {
            this._deductFromTracker(card);
        }
    }

    // ---- 历史记录 ----

    _addHistory(data) {
        const content = this.container.querySelector('#history-content');
        if (!content) return;

        // 移除空状态提示
        const emptyEl = content.querySelector('.empty-state');
        if (emptyEl) emptyEl.remove();

        const player = this.gameState?.players[data.playerIndex];
        const esc = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[m]);
        const name = esc(player?.name || '?');

        let text;
        if (data.pass) {
            text = `${name}: 不出`;
        } else {
            const cardNames = data.cards?.map(c => esc(c.displayName)).join(' ') || '';
            const typeName = esc(Rules.getTypeName(data.pattern?.type || 'INVALID'));
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

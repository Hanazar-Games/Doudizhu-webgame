/**
 * ReplayManager - 牌局回放管理器
 * 负责：加载保存的牌局、播放控制、步骤渲染
 */

import { Card } from '../core/card.js';
import { Rules, HAND_TYPE } from '../core/rules.js';
import { Storage } from './storage.js';

class ReplayManager {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.games = [];
        this.currentGame = null;
        this.currentStep = -1; // -1 = 初始状态
        this.isPlaying = false;
        this.playTimer = null;
        this.playInterval = 1500;
        this._keyHandler = null;
    }

    destroy() {
        this.stop();
        this._removeKeyHandler();
    }

    // 加载保存的牌局列表
    loadGames() {
        this.games = Storage.getFullGames();
        return this.games;
    }

    // 显示牌局列表界面
    showGameList() {
        if (!this.container) return;
        this.stop();
        this._removeKeyHandler();

        const games = this.loadGames();
        const validGames = games.filter(g => g && Array.isArray(g.players) && Array.isArray(g.history));
        let html = `
            <div class="replay-container">
                <h2>📹 牌局回放</h2>
                <p class="replay-subtitle">共保存 ${validGames.length} 局对局记录</p>
        `;

        if (validGames.length === 0) {
            html += `<div class="replay-empty">暂无保存的对局记录<br>完成对局后将自动保存</div>`;
        } else {
            html += `<div class="replay-list">`;
            for (let i = 0; i < validGames.length; i++) {
                const g = validGames[i];
                const date = g.date ? new Date(g.date).toLocaleString('zh-CN') : '未知时间';
                const modeText = g.mode === 'ai' ? '人机对战' : g.mode === 'lan' ? '联机' : g.mode === 'tournament' ? '锦标赛' : '自定义';
                const resultText = g.result?.isLandlordWin ? '地主胜' : '农民胜';
                const spring = g.result?.springType === 'spring' ? ' 🌸春天' :
                              g.result?.springType === 'anti_spring' ? ' 🌸反春' : '';
                const escapeHtml = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[m]);
                html += `
                    <div class="replay-item" data-index="${i}">
                        <div class="replay-info">
                            <span class="replay-date">${escapeHtml(date)}</span>
                            <span class="replay-mode">${escapeHtml(modeText)}</span>
                        </div>
                        <div class="replay-result">
                            <span class="replay-winner">${escapeHtml(resultText)}${escapeHtml(spring)}</span>
                            <span class="replay-mult">${g.result?.multiplier || 1}倍</span>
                        </div>
                        <div class="replay-players">
                            ${g.players.map((p, idx) => p ? `<span class="${idx === g.landlordIndex ? 'landlord-tag' : ''}">${escapeHtml(p.name)}</span>` : '').join(' vs ')}
                        </div>
                        <button class="btn-replay-watch">▶ 回放</button>
                    </div>
                `;
            }
            html += `</div>`;
        }

        html += `<button id="btn-replay-back" class="btn-small">← 返回菜单</button></div>`;
        this.container.innerHTML = html;

        // 绑定回放按钮
        this.container.querySelectorAll('.btn-replay-watch').forEach((btn) => {
            btn.addEventListener('click', () => {
                window.gameApp?.renderer?.audio?.playButtonClick();
                const idx = Number(btn.closest('.replay-item')?.dataset.index);
                if (Number.isFinite(idx) && validGames[idx]) {
                    this.startReplay(validGames[idx]);
                }
            });
        });

        this.container.querySelector('#btn-replay-back')?.addEventListener('click', () => {
            window.gameApp?.renderer?.audio?.playButtonClick();
            this.container.innerHTML = '';
            if (window.gameApp?.showMenu) window.gameApp.showMenu();
        });
    }

    // 开始回放某一局
    startReplay(gameData) {
        this.stop();
        this.currentGame = gameData;
        this.currentStep = -1;
        this.isPlaying = false;
        this._renderReplayBoard();
        this._attachKeyHandler();
    }

    _attachKeyHandler() {
        this._removeKeyHandler();
        this._keyHandler = (e) => {
            if (!this.currentGame) return;
            // 忽略输入框中的按键
            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    this.togglePlay();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.prevStep();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.nextStep();
                    break;
                case 'Escape':
                    this.showGameList();
                    break;
            }
        };
        document.addEventListener('keydown', this._keyHandler);
    }

    _removeKeyHandler() {
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
    }

    _playStepSound(action) {
        const audio = window.gameApp?.renderer?.audio;
        if (!audio) return;
        if (action.pattern?.type === 'PASS') {
            audio.playPass();
        } else if (action.pattern?.type === 'BOMB') {
            audio.playBomb();
        } else if (action.pattern?.type === 'ROCKET') {
            audio.playRocket();
        } else if (action.pattern?.type === 'STRAIGHT') {
            audio.playStraight();
        } else if (action.pattern?.type?.includes('TRIPLE_STRAIGHT')) {
            audio.playPlane();
        } else if (action.pattern?.type === 'PAIR') {
            audio.playPair();
        } else if (action.pattern?.type === 'TRIPLE' || action.pattern?.type?.includes('TRIPLE_WITH')) {
            audio.playTriple();
        } else if (action.pattern?.type === 'FOUR_WITH_TWO' || action.pattern?.type === 'FOUR_WITH_TWO_PAIRS') {
            audio.playFourWithTwo();
        } else if (action.pattern?.type === 'SINGLE') {
            audio.playSingle();
        } else {
            audio.playPlay();
        }
    }

    // 计算关键回合索引
    _computeKeyMoments() {
        const g = this.currentGame;
        if (!g || !Array.isArray(g.history)) return [];
        const moments = [];
        for (let i = 0; i < g.history.length; i++) {
            const h = g.history[i];
            const type = h.pattern?.type;
            if (type === 'BOMB') moments.push({ idx: i, label: '💣 炸弹', icon: '💣' });
            else if (type === 'ROCKET') moments.push({ idx: i, label: '🚀 王炸', icon: '🚀' });
            else if (type === 'PASS' && i > 0) {
                // 连续两个 PASS 后新一轮开始，标记前一手为关键
                const prev = g.history[i - 1];
                if (prev && prev.pattern?.type !== 'PASS') {
                    // 不重复标记
                }
            }
        }
        // 春天/反春天
        if (g.result?.springType === 'spring') moments.push({ idx: g.history.length - 1, label: '🌸 春天', icon: '🌸' });
        else if (g.result?.springType === 'anti_spring') moments.push({ idx: g.history.length - 1, label: '🌸 反春', icon: '🌸' });
        return moments;
    }

    // 生成战报文本
    _generateReport() {
        const g = this.currentGame;
        if (!g) return '';
        const esc = (s) => String(s ?? '');
        const dateStr = g.date ? new Date(g.date).toLocaleString('zh-CN') : '未知时间';
        const modeText = g.mode === 'ai' ? '人机对战' : g.mode === 'lan' ? '联机' : g.mode === 'tournament' ? '锦标赛' : '自定义';
        const resultText = g.result?.isLandlordWin ? '地主胜' : '农民胜';
        const spring = g.result?.springType === 'spring' ? ' 🌸春天' : g.result?.springType === 'anti_spring' ? ' 🌸反春' : '';
        const lines = [
            '🃏 斗地主 WebGame 战报',
            `📅 ${dateStr} · ${modeText}`,
            `🏆 ${resultText}${spring} · ${g.result?.multiplier || 1}倍`,
            '',
            '玩家得分：',
        ];
        if (g.result?.scores) {
            for (let i = 0; i < 3; i++) {
                const p = g.players?.[i];
                const name = p ? p.name : `玩家${i + 1}`;
                const isLandlord = i === g.landlordIndex;
                const score = g.result.scores[i] || 0;
                lines.push(`${isLandlord ? '👑' : ''} ${esc(name)}: ${score > 0 ? '+' : ''}${score}`);
            }
        }
        lines.push('', `总手数: ${g.history?.length || 0}`);
        return lines.join('\n');
    }

    // 渲染回放界面
    _renderReplayBoard() {
        if (!this.container || !this.currentGame) return;
        const g = this.currentGame;
        const keyMoments = this._computeKeyMoments();

        let html = `
            <div class="replay-board">
                <div class="replay-header">
                    <h3>📹 回放中</h3>
                    <div class="replay-step-info">
                        <span id="replay-step-text">准备中</span>
                        <span id="replay-progress">0 / ${g.history.length}</span>
                    </div>
                </div>
                <div class="replay-meta-bar">
                    <button id="replay-copy-report" title="复制战报">📋 复制战报</button>
                    ${keyMoments.length > 0 ? `
                        <div class="replay-key-moments">
                            <span>关键回合:</span>
                            ${keyMoments.slice(0, 6).map(m => `<button class="replay-moment-btn" data-idx="${m.idx}" title="${m.label}">${m.icon}</button>`).join('')}
                        </div>
                    ` : ''}
                </div>
                <div class="replay-table" id="replay-table-area">
                    ${this._renderTableState()}
                </div>
                <div class="replay-controls">
                    <button id="replay-prev" title="上一步 (←)">⏮</button>
                    <button id="replay-play" title="播放/暂停 (Space)">▶</button>
                    <button id="replay-next" title="下一步 (→)">⏭</button>
                    <input type="range" id="replay-slider" min="-1" max="${g.history.length - 1}" value="-1" step="1">
                    <button id="replay-speed" title="速度">1x</button>
                    <button id="replay-close" title="关闭 (Esc)">✕</button>
                </div>
                <div class="replay-shortcut-hint">
                    ← → 翻步 · 空格 播放/暂停 · Esc 退出
                </div>
            </div>
        `;
        this.container.innerHTML = html;

        // 绑定控制按钮
        this.container.querySelector('#replay-prev')?.addEventListener('click', () => {
            window.gameApp?.renderer?.audio?.playButtonClick();
            this.prevStep();
        });
        this.container.querySelector('#replay-play')?.addEventListener('click', () => {
            window.gameApp?.renderer?.audio?.playButtonClick();
            this.togglePlay();
        });
        this.container.querySelector('#replay-next')?.addEventListener('click', () => {
            window.gameApp?.renderer?.audio?.playButtonClick();
            this.nextStep();
        });
        this.container.querySelector('#replay-close')?.addEventListener('click', () => {
            window.gameApp?.renderer?.audio?.playButtonClick();
            this.showGameList();
        });

        const slider = this.container.querySelector('#replay-slider');
        if (slider) {
            slider.addEventListener('input', (e) => {
                this.goToStepSilent(parseInt(e.target.value));
            });
        }

        const speedBtn = this.container.querySelector('#replay-speed');
        if (speedBtn) {
            speedBtn.addEventListener('click', () => {
                window.gameApp?.renderer?.audio?.playButtonClick();
                const speeds = [1, 1.5, 2, 3];
                const currentIdx = speeds.findIndex(s => Math.abs(this.playInterval - 1500 / s) < 100);
                const nextIdx = (currentIdx + 1) % speeds.length;
                const nextSpeed = speeds[nextIdx];
                this.playInterval = 1500 / nextSpeed;
                speedBtn.textContent = nextSpeed + 'x';
            });
        }

        // 复制战报
        const copyBtn = this.container.querySelector('#replay-copy-report');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                window.gameApp?.renderer?.audio?.playButtonClick();
                const text = this._generateReport();
                if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(text)
                        .then(() => window.gameApp?.showToast?.('战报已复制', 'success'))
                        .catch(() => window.gameApp?.showToast?.('复制失败', 'error'));
                } else {
                    window.gameApp?.showToast?.('浏览器不支持自动复制', 'info');
                }
            });
        }

        // 关键回合跳转
        this.container.querySelectorAll('.replay-moment-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                window.gameApp?.renderer?.audio?.playButtonClick();
                const idx = parseInt(btn.dataset.idx, 10);
                this.goToStep(idx);
            });
        });

        this._updateDisplay();
    }

    // 渲染当前步骤的牌桌状态
    _renderTableState() {
        const g = this.currentGame;
        if (!g) return '';
        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[m]);

        const normalizeCard = (card) => {
            const rank = card?.rankKey || card?.rank?.name || card?.rank || '';
            const suitRaw = typeof card?.suit === 'string' ? card.suit : (card?.suit?.name || '');
            const suit = suitRaw.toLowerCase();
            const displayName = card?.displayName || '';
            const isJoker = rank === 'JOKER_SMALL' || rank === 'JOKER_BIG' || displayName.includes('王');
            const rankLabel = isJoker
                ? (rank === 'JOKER_BIG' || displayName.includes('大王') ? '大王' : '小王')
                : (card?.rank?.display || String(displayName).replace(/[♠♥♣♦]/g, '') || rank || '?');
            const suitSymbol = isJoker ? '' : (
                suit === 'heart' || suit === 'hearts' ? '♥' :
                suit === 'diamond' || suit === 'diamonds' ? '♦' :
                suit === 'club' || suit === 'clubs' ? '♣' :
                suit === 'spade' || suit === 'spades' ? '♠' :
                String(displayName).match(/[♠♥♣♦]/)?.[0] || '♠'
            );
            const isRed = isJoker ? rankLabel === '大王' : (suitSymbol === '♥' || suitSymbol === '♦');
            return {
                value: Number(card?.value ?? card?.rank?.value ?? 0),
                rank,
                suit,
                rankLabel,
                suitSymbol,
                isJoker,
                isRed,
                isLaizi: card?.isLaizi === true,
            };
        };

        const sameCard = (a, b) => {
            const ca = normalizeCard(a);
            const cb = normalizeCard(b);
            if (ca.isJoker || cb.isJoker) return ca.rank === cb.rank || ca.rankLabel === cb.rankLabel;
            return ca.value === cb.value && ca.rank === cb.rank && ca.suit === cb.suit;
        };

        // 计算到当前步骤为止的状态
        const hands = Array.isArray(g.initialHands)
            ? g.initialHands.map(h => Array.isArray(h) ? [...h] : [])
            : [[], [], []];
        const bottom = g.initialBottom ? [...g.initialBottom] : [];
        let landlordIdx = g.landlordIndex ?? -1;
        let lastPlay = null;
        let passCount = 0;
        let currentTurn = g.dealerIndex ?? 0;

        for (let i = 0; i <= this.currentStep; i++) {
            const action = g.history[i];
            if (!action) continue;

            if (action.pattern?.type === 'PASS') {
                passCount++;
                currentTurn = (action.playerIndex + 1) % 3;
            } else if (action.cards?.length > 0) {
                for (const playedCard of action.cards) {
                    const hand = hands[action.playerIndex];
                    if (!hand) continue;
                    const idx = hand.findIndex(c => sameCard(c, playedCard));
                    if (idx >= 0) hand.splice(idx, 1);
                }
                lastPlay = action;
                passCount = 0;
                currentTurn = (action.playerIndex + 1) % 3;
            }
        }

        // 当前步骤的 action 决定高亮玩家
        const activePlayerIndex = this.currentStep >= 0
            ? (g.history[this.currentStep]?.playerIndex ?? -1)
            : -1;

        const renderCards = (cards) => {
            if (!cards || cards.length === 0) return '<span class="no-cards">无</span>';
            const sorted = [...cards].sort((a, b) => normalizeCard(a).value - normalizeCard(b).value);
            return sorted.map((c, i) => {
                const card = normalizeCard(c);
                const colorClass = card.isRed ? 'red' : 'black';
                const laiziClass = card.isLaizi ? 'laizi' : '';
                const laiziBadge = card.isLaizi ? '<span class="laizi-badge">癞</span>' : '';
                if (card.isJoker) {
                    return `<span class="replay-card replay-joker ${colorClass} ${laiziClass}" style="--i:${i}">
                        ${laiziBadge}
                        <span class="replay-joker-text">${esc(card.rankLabel)}</span>
                    </span>`;
                }
                return `<span class="replay-card ${colorClass} ${laiziClass}" style="--i:${i}">
                    ${laiziBadge}
                    <span class="replay-card-rank">${esc(card.rankLabel)}</span>
                    <span class="replay-card-suit">${esc(card.suitSymbol)}</span>
                </span>`;
            }).join('');
        };

        // 最近出牌
        let lastPlayHtml = '';
        if (lastPlay) {
            const pName = g.players[lastPlay.playerIndex]?.name || `玩家${lastPlay.playerIndex+1}`;
            const typeName = Rules.getTypeName ? Rules.getTypeName(lastPlay.pattern?.type) : lastPlay.pattern?.type;
            const isBomb = lastPlay.pattern?.type === 'BOMB' || lastPlay.pattern?.type === 'ROCKET';
            const badge = isBomb ? '<span class="replay-bomb-badge">💥</span>' : '';
            lastPlayHtml = `
                <div class="replay-last-play">
                    <span class="replay-last-label">最近出牌</span>
                    <span class="replay-last-player">${esc(pName)}</span>
                    <span class="replay-last-type">[${esc(typeName)}]</span>
                    ${badge}
                    <div class="replay-last-cards">${renderCards(lastPlay.cards)}</div>
                </div>
            `;
        }

        // 春天/反春天标识
        let springBadge = '';
        if (this.currentStep >= (g.history?.length || 0) - 1) {
            if (g.result?.springType === 'spring') {
                springBadge = '<div class="replay-spring-badge">🌸 春天</div>';
            } else if (g.result?.springType === 'anti_spring') {
                springBadge = '<div class="replay-spring-badge anti">🌸 反春天</div>';
            }
        }

        return `
            <div class="replay-players-area">
                ${[0, 1, 2].map(idx => {
                    const p = g.players[idx];
                    const isLandlord = idx === landlordIdx;
                    const name = p ? p.name : `玩家${idx+1}`;
                    const isActive = idx === activePlayerIndex;
                    return `
                        <div class="replay-player ${isLandlord ? 'landlord' : ''} ${isActive ? 'active' : ''}">
                            <div class="replay-player-name">
                                ${esc(name)} ${isLandlord ? '👑' : ''}
                                <span class="replay-card-count">${hands[idx]?.length || 0}张</span>
                            </div>
                            <div class="replay-player-hand">${renderCards(hands[idx])}</div>
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="replay-bottom-area">
                <div class="replay-bottom-cards">
                    <span class="replay-bottom-label">底牌</span>
                    ${renderCards(bottom)}
                </div>
                ${lastPlayHtml}
                ${springBadge}
            </div>
        `;
    }

    // 更新显示
    _updateDisplay() {
        const tableArea = this.container?.querySelector('#replay-table-area');
        if (tableArea) tableArea.innerHTML = this._renderTableState();

        if (this.currentStep >= 0 && this.currentGame?.history[this.currentStep]) {
            this._playStepSound(this.currentGame.history[this.currentStep]);
        }

        const stepText = this.container?.querySelector('#replay-step-text');
        const progress = this.container?.querySelector('#replay-progress');
        const slider = this.container?.querySelector('#replay-slider');
        const playBtn = this.container?.querySelector('#replay-play');

        if (slider) slider.value = this.currentStep;
        if (playBtn) playBtn.textContent = this.isPlaying ? '⏸' : '▶';

        if (this.currentStep < 0) {
            if (stepText) stepText.textContent = '初始手牌';
            if (progress) progress.textContent = `0 / ${this.currentGame?.history?.length || 0}`;
            return;
        }

        const action = this.currentGame?.history[this.currentStep];
        if (!action) return;

        const pName = this.currentGame?.players?.[action.playerIndex]?.name || `玩家${action.playerIndex+1}`;
        let text = '';
        if (action.pattern?.type === 'PASS') {
            text = `${pName}: 不出`;
        } else {
            const typeName = Rules.getTypeName ? Rules.getTypeName(action.pattern?.type) : action.pattern?.type;
            text = `${pName}: ${typeName}`;
        }
        if (stepText) stepText.textContent = text;
        if (progress) progress.textContent = `${this.currentStep + 1} / ${this.currentGame?.history?.length || 0}`;
    }

    // 播放控制
    togglePlay() {
        if (this.isPlaying) {
            this.stop();
        } else {
            this.play();
        }
    }

    play() {
        this.isPlaying = true;
        this._updateDisplay();
        this.playTimer = setInterval(() => {
            if (!this.nextStep()) {
                this.stop();
            }
        }, this.playInterval);
    }

    stop() {
        this.isPlaying = false;
        if (this.playTimer) {
            clearInterval(this.playTimer);
            this.playTimer = null;
        }
        this._updateDisplay();
    }

    nextStep() {
        if (!this.currentGame) return false;
        if (this.currentStep >= this.currentGame.history.length - 1) return false;
        this.currentStep++;
        this._updateDisplay();
        return true;
    }

    prevStep() {
        if (this.currentStep <= -1) return false;
        this.currentStep--;
        this._updateDisplay();
        return true;
    }

    goToStep(step) {
        if (!this.currentGame) return;
        const max = this.currentGame.history.length - 1;
        this.currentStep = Math.max(-1, Math.min(step, max));
        this._updateDisplay();
    }

    goToStepSilent(step) {
        if (!this.currentGame) return;
        const max = this.currentGame.history.length - 1;
        this.currentStep = Math.max(-1, Math.min(step, max));
        const tableArea = this.container?.querySelector('#replay-table-area');
        if (tableArea) tableArea.innerHTML = this._renderTableState();
        const stepText = this.container?.querySelector('#replay-step-text');
        const progress = this.container?.querySelector('#replay-progress');
        const slider = this.container?.querySelector('#replay-slider');
        if (slider) slider.value = this.currentStep;
        if (this.currentStep < 0) {
            if (stepText) stepText.textContent = '初始手牌';
            if (progress) progress.textContent = `0 / ${this.currentGame?.history?.length || 0}`;
            return;
        }
        const action = this.currentGame?.history[this.currentStep];
        if (!action) return;
        const pName = this.currentGame?.players?.[action.playerIndex]?.name || `玩家${action.playerIndex+1}`;
        let text = '';
        if (action.pattern?.type === 'PASS') {
            text = `${pName}: 不出`;
        } else {
            const typeName = Rules.getTypeName ? Rules.getTypeName(action.pattern?.type) : action.pattern?.type;
            text = `${pName}: ${typeName}`;
        }
        if (stepText) stepText.textContent = text;
        if (progress) progress.textContent = `${this.currentStep + 1} / ${this.currentGame?.history?.length || 0}`;
    }
}

export { ReplayManager };

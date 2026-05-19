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

        const games = this.loadGames();
        let html = `
            <div class="replay-container">
                <h2>📹 牌局回放</h2>
                <p class="replay-subtitle">共保存 ${games.length} 局对局记录</p>
        `;

        if (games.length === 0) {
            html += `<div class="replay-empty">暂无保存的对局记录<br>完成对局后将自动保存</div>`;
        } else {
            html += `<div class="replay-list">`;
            for (let i = 0; i < games.length; i++) {
                const g = games[i];
                if (!g || !Array.isArray(g.players) || !Array.isArray(g.history)) continue;
                const date = g.date ? new Date(g.date).toLocaleString('zh-CN') : '未知时间';
                const modeText = g.mode === 'ai' ? '人机对战' : g.mode === 'lan' ? '联机' : '自定义';
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
        this.container.querySelectorAll('.btn-replay-watch').forEach((btn, idx) => {
            btn.addEventListener('click', () => {
                window.gameApp?.renderer?.audio?.playButtonClick();
                this.startReplay(games[idx]);
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
        this.stop(); // 确保停止任何正在播放的旧 timer
        this.currentGame = gameData;
        this.currentStep = -1;
        this.isPlaying = false;
        this._renderReplayBoard();
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
        } else if (action.pattern?.type === 'TRIPLE_STRAIGHT' || action.pattern?.type?.includes('PLANE')) {
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

    // 渲染回放界面
    _renderReplayBoard() {
        if (!this.container || !this.currentGame) return;
        const g = this.currentGame;

        let html = `
            <div class="replay-board">
                <div class="replay-header">
                    <h3>📹 回放中</h3>
                    <div class="replay-step-info">
                        <span id="replay-step-text">准备中</span>
                        <span id="replay-progress">0 / ${g.history.length}</span>
                    </div>
                </div>
                <div class="replay-table" id="replay-table-area">
                    ${this._renderTableState()}
                </div>
                <div class="replay-controls">
                    <button id="replay-prev" title="上一步">⏮</button>
                    <button id="replay-play" title="播放/暂停">▶</button>
                    <button id="replay-next" title="下一步">⏭</button>
                    <input type="range" id="replay-slider" min="-1" max="${g.history.length - 1}" value="-1" step="1">
                    <button id="replay-speed" title="速度">1x</button>
                    <button id="replay-close">✕</button>
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

        this._updateDisplay();
    }

    // 渲染当前步骤的牌桌状态
    _renderTableState() {
        const g = this.currentGame;
        if (!g) return '';

        // 计算到当前步骤为止的状态
        const hands = g.initialHands.map(h => h ? [...h] : []);
        const bottom = g.initialBottom ? [...g.initialBottom] : [];
        let landlordIdx = -1;
        let lastPlay = null;
        let passCount = 0;

        for (let i = 0; i <= this.currentStep; i++) {
            const action = g.history[i];
            if (!action) continue;

            if (action.pattern?.type === 'PASS') {
                passCount++;
            } else if (action.cards?.length > 0) {
                // 出牌：从手牌中移除
                for (const playedCard of action.cards) {
                    const hand = hands[action.playerIndex];
                    const idx = hand.findIndex(c => c.value === playedCard.value && 
                        (c.suit === playedCard.suit || c.rank === playedCard.rank));
                    if (idx >= 0) hand.splice(idx, 1);
                }
                lastPlay = action;
                passCount = 0;
            }

            // 检测叫分结束（简化：第一个有实际出牌的 player's landlord）
            // 实际上 landlordIndex 是直接从 gameData 中获取的
        }

        landlordIdx = g.landlordIndex;

        // 渲染3个玩家区域
        const playerPositions = ['bottom', 'left', 'right'];
        const renderCards = (cards, isBottom) => {
            if (!cards || cards.length === 0) return '<span class="no-cards">无</span>';
            // 按value排序
            const sorted = [...cards].sort((a, b) => a.value - b.value);
            return sorted.map((c, i) => {
                const isRed = c.suit === 'HEART' || c.suit === 'DIAMOND' || c.rank === 'JOKER_BIG';
                const isJoker = c.rank?.includes('JOKER');
                const display = isJoker ? c.displayName : `${c.suit === 'HEART' ? '♥' : c.suit === 'DIAMOND' ? '♦' : c.suit === 'CLUB' ? '♣' : '♠'}${c.displayName || c.rank}`;
                return `<span class="replay-card ${isRed ? 'red' : 'black'}" style="margin-left:${i>0?'-12px':'0'}">${display}</span>`;
            }).join('');
        };

        // 最近出牌
        let lastPlayHtml = '';
        if (lastPlay) {
            const pName = g.players[lastPlay.playerIndex]?.name || `玩家${lastPlay.playerIndex+1}`;
            const typeName = Rules.getTypeName ? Rules.getTypeName(lastPlay.pattern?.type) : lastPlay.pattern?.type;
            const escapeHtml = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[m]);
            lastPlayHtml = `
                <div class="replay-last-play">
                    <span class="replay-last-label">最近出牌</span>
                    <span class="replay-last-player">${escapeHtml(pName)}</span>
                    <span class="replay-last-type">[${escapeHtml(typeName)}]</span>
                    <div class="replay-last-cards">${renderCards(lastPlay.cards)}</div>
                </div>
            `;
        }

        const esc = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[m]);
        return `
            <div class="replay-players-area">
                ${[0, 1, 2].map(idx => {
                    const p = g.players[idx];
                    const isLandlord = idx === landlordIdx;
                    const name = p ? p.name : `玩家${idx+1}`;
                    return `
                        <div class="replay-player ${isLandlord ? 'landlord' : ''} ${idx === (lastPlay?.playerIndex ?? -1) ? 'active' : ''}">
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
            </div>
        `;
    }

    // 更新显示
    _updateDisplay() {
        const tableArea = this.container?.querySelector('#replay-table-area');
        if (tableArea) tableArea.innerHTML = this._renderTableState();

        // 播放当前步骤音效
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

    // 跳转到指定步骤（不播放音效，用于 slider 拖动）
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

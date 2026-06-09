/**
 * ChallengeMode - 极限挑战模式
 * 继承 AIMode，通过修改 GameState 规则实现各种特殊限制
 */

import { Card } from '../core/card.js';
import { Rules } from '../core/rules.js';
import { Player } from '../players/player.js';
import { AIPlayer } from '../players/ai-player.js';
import { AIMode } from './ai-mode.js';
import { PHASE } from '../core/game-state.js';
import {
    CHALLENGES,
    ExtremeChallengeRecordManager,
    calculateChallengeStars,
} from '../utils/challenge-data.js';
import { Storage } from '../utils/storage.js';

class ChallengeMode extends AIMode {
    constructor(challengeId = 1) {
        // 根据挑战配置确定AI难度
        const challenge = CHALLENGES.find(c => c.id === challengeId);
        const aiDifficulty = challenge?.config?.aiDifficulty || 'normal';
        super(aiDifficulty);
        this.modeName = 'challenge';
        this.challengeId = challengeId;
        this.challenge = challenge;
        this.humanStepCount = 0;
        this._bombBeatRocket = false;
        this._lastWasRocket = false;
    }

    async init() {
        this.humanIndex = 0;
        this.gameState.setPlayer(0, new Player('玩家', false));

        // 孤军奋战/斗帝之路：强制玩家为地主
        const cfg = this.challenge?.config || {};
        if (cfg.forceLandlord) {
            // 人类固定为0号，通过调整dealerIndex和叫分机制确保人类成为地主
            this.gameState.dealerIndex = 0;
        }

        const aiDifficulty = cfg.aiDifficulty || 'normal';
        this.gameState.setPlayer(1, new AIPlayer('AI-东', aiDifficulty));
        this.gameState.setPlayer(2, new AIPlayer('AI-西', aiDifficulty));

        this.humanStepCount = 0;
        this._bombBeatRocket = false;
        this._lastWasRocket = false;
        console.log('[ChallengeMode] 初始化完成，挑战:', this.challenge?.title);
    }

    async startGame() {
        // 清理上一局定时器
        for (const t of this._pendingTimers) {
            clearTimeout(t.id);
            try { t.resolve?.(new Error('New game started')); } catch (e) {}
        }
        this._pendingTimers = [];
        this.isRunning = true;

        // 应用标准游戏规则
        this._applyGameRules();

        // 应用挑战特殊规则
        this._applyChallengeRules();

        const cfg = this.challenge?.config || {};

        // 盲牌斗地主：禁用记牌器
        if (cfg.disableTracker) {
            const btnTracker = this.renderer?.container?.querySelector('#btn-toggle-card-tracker');
            const tracker = this.renderer?.container?.querySelector('#card-tracker');
            if (btnTracker) btnTracker.classList.add('hidden');
            if (tracker) tracker.classList.add('hidden');
        }

        const deck = this.gameState.noShuffle ? this._createOrderedDeck() : this._createShuffledDeck();
        const bottom = deck.slice(51, 54);
        this.gameState.startRound(deck.slice(0, 51), bottom);

        // 强制人类为地主（如果挑战配置要求）
        if (cfg.forceLandlord) {
            this.gameState.landlordIndex = this.humanIndex;
            const landlord = this.gameState.players[this.humanIndex];
            if (landlord) {
                landlord.isLandlord = true;
                // 给地主底牌
                for (const c of bottom) {
                    landlord.hand.push(c);
                }
                landlord.hand.sort((a, b) => b.value - a.value);
            }
            // 保存初始手牌（供回放/教练使用）
            for (let i = 0; i < 3; i++) {
                const p = this.gameState.players[i];
                if (p) {
                    this.gameState.initialHands[i] = p.hand.map(c => ({
                        value: c.value,
                        suit: c.suit?.name || null,
                        rank: c.rankKey,
                        displayName: c.displayName,
                    }));
                }
            }
            this.gameState.bottomCards = bottom.map(c => ({
                value: c.value,
                suit: c.suit?.name || null,
                rank: c.rankKey,
                displayName: c.displayName,
            }));
            this.gameState.currentTurn = this.humanIndex;
            this.gameState.phase = PHASE.PLAYING;
            this.gameState.passCount = 0;
            this.gameState.playCounts = [0, 0, 0];
            this.gameState.history = [];

            // 音效 + 渲染
            this.renderer?.audio?.playDeal();
            this._setTimer(() => this.renderer?.audio?.playNewRound(), 300);
            this.renderer?.renderHands?.();
            this.renderer?.highlightTurn?.(this.gameState.currentTurn);
            this.renderer?.showChallengeInfo?.(this.challenge);
            this._processPlay();
            return;
        }

        // 音效 + 新轮提示
        this.renderer?.audio?.playDeal();
        this._setTimer(() => this.renderer?.audio?.playNewRound(), 300);

        // 进入叫分流程
        this._processCalling();
    }

    // 应用挑战规则修改
    _applyChallengeRules() {
        if (!this.challenge) return;

        const mods = this.challenge.ruleMods || {};
        const cfg = this.challenge.config || {};

        // 规则覆盖
        if (mods.bombRule !== undefined) this.gameState.bombRule = mods.bombRule;
        if (mods.jokerRule !== undefined) this.gameState.jokerRule = mods.jokerRule;
        if (mods.strictRules !== undefined) this.gameState.strictRules = mods.strictRules;
        if (mods.allowTripleWithSingle !== undefined) this.gameState.allowTripleWithSingle = mods.allowTripleWithSingle;
        if (mods.allowTripleWithPair !== undefined) this.gameState.allowTripleWithPair = mods.allowTripleWithPair;
        if (mods.allowAirplaneWithWings !== undefined) this.gameState.allowAirplaneWithWings = mods.allowAirplaneWithWings;
        if (mods.mustPlay !== undefined) this.gameState.mustPlay = mods.mustPlay;
        if (mods.allowPassOnFirst !== undefined) this.gameState.allowPassOnFirst = mods.allowPassOnFirst;
        if (mods.bombAsRocket !== undefined) this.gameState.bombAsRocket = mods.bombAsRocket;
        if (mods.baseScore !== undefined) this.gameState.baseScore = mods.baseScore;

        // 时间限制
        if (cfg.turnTimeLimit !== undefined) {
            this._turnCountdown = Math.max(5, Math.min(60, cfg.turnTimeLimit));
        }

        // 得分倍率
        if (cfg.scoreMultiplier !== undefined) {
            this.gameState.scoreMultiplier = Math.max(1, Math.min(10, cfg.scoreMultiplier));
        }
    }

    _createShuffledDeck() {
        return Card.shuffle(Card.createDeck());
    }

    _createOrderedDeck() {
        return Card.createDeck();
    }

    // 覆盖叫分流程：如果强制地主，跳过叫分
    async _processCalling() {
        const cfg = this.challenge?.config || {};
        if (cfg.forceLandlord) {
            return; // 已在 startGame 中处理
        }
        await super._processCalling();
    }

    // 覆盖人类出牌：检查挑战限制
    humanPlay(cards) {
        if (!this.isRunning) return false;
        const idx = this.gameState.currentTurn;
        if (idx !== this.humanIndex) return false;

        const pattern = Rules.analyze(cards);
        if (!pattern || !pattern.isValid()) return false;

        // 禁炸令 / 保守派：检查炸弹（GameState 已处理，此处仅做额外提示）
        const mods = this.challenge?.ruleMods || {};
        if (mods.bombRule === 'disabled' && (pattern.type === 'BOMB' || pattern.type === 'ROCKET')) {
            this.renderer?.showToast?.('本挑战禁用炸弹！', 'warning');
            return false;
        }
        if (mods.jokerRule === 'disabled' && pattern.type === 'ROCKET') {
            this.renderer?.showToast?.('本挑战禁用王炸！', 'warning');
            return false;
        }

        // 严格执法：检查复杂牌型
        if (mods.strictRules === true) {
            const forbiddenTypes = ['TRIPLE_WITH_SINGLE', 'TRIPLE_WITH_PAIR', 'AIRPLANE_WITH_WINGS', 'FOUR_WITH_TWO'];
            if (forbiddenTypes.includes(pattern.type)) {
                this.renderer?.showToast?.('本挑战禁用复杂牌型！', 'warning');
                return false;
            }
        }

        // 检测炸弹压王炸
        if (pattern.type === 'BOMB' && this._lastWasRocket) {
            this._bombBeatRocket = true;
        }

        const result = super.humanPlay(cards);
        if (result) {
            if (pattern.type === 'ROCKET') this._lastWasRocket = true;
            else this._lastWasRocket = false;
        }
        return result;
    }

    onPlayerPlay(data) {
        super.onPlayerPlay(data);
        if (data.playerIndex === this.humanIndex && data.cards && data.cards.length > 0) {
            this.humanStepCount++;
        }
        // 跟踪火箭/炸弹状态，用于检测炸弹压王炸
        if (data.pattern?.type === 'ROCKET') {
            this._lastWasRocket = true;
        } else if (data.pattern?.type === 'BOMB') {
            if (this._lastWasRocket) {
                this._bombBeatRocket = true;
            }
            // 炸弹之后重置火箭追踪（王炸 → 炸弹 只计一次）
            this._lastWasRocket = false;
        } else {
            this._lastWasRocket = false;
        }
    }

    onRoundEnd(data) {
        // 父类处理 BGM、渲染等
        super.onRoundEnd(data);

        if (!this.challenge) return;

        const result = calculateChallengeStars(
            this.challenge,
            data,
            this.gameState,
            this.humanIndex
        );

        // 处理 mustSpring 强制春天挑战
        const cfg = this.challenge?.config || {};
        if (cfg.mustSpring && result.passed && data.springType !== 'spring') {
            result.passed = false;
            result.stars = 0;
        }

        if (result.passed) {
            ExtremeChallengeRecordManager.saveRecord(this.challengeId, result.stars);
        }

        // 显示挑战结果面板
        if (this.renderer) {
            this._resultTimer = this._setTimer(() => {
                this._resultTimer = null;
                if (!this.isRunning) return;
                const overlay = this.renderer.container?.querySelector('#modal-overlay');
                const content = this.renderer.container?.querySelector('#modal-content');
                if (overlay && !overlay.classList.contains('hidden')) {
                    this.renderer._closeModal(overlay, content);
                }
                this.renderer?.showChallengeResult?.(
                    result.passed,
                    result.stars,
                    this.challenge,
                    ExtremeChallengeRecordManager.getProgress()
                );
            }, 1800);
        }
    }

    getChallengeInfo() {
        const record = ExtremeChallengeRecordManager.getRecord(this.challengeId);
        return {
            ...this.challenge,
            bestStars: record?.stars || 0,
            hasPassed: !!record?.passed,
        };
    }

    destroy() {
        super.destroy();
        this._resultTimer = null;
        this._lastWasRocket = false;
        this._bombBeatRocket = false;
    }
}

export { ChallengeMode };

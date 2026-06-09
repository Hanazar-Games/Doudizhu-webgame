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

        const deck = this.gameState.noShuffle ? this._createOrderedDeck() : this._createShuffledDeck();
        const bottom = deck.slice(51, 54);
        this.gameState.startRound(deck.slice(0, 51), bottom);

        // 强制人类为地主（如果挑战配置要求）
        const cfg = this.challenge?.config || {};
        if (cfg.forceLandlord) {
            this.gameState.landlordIndex = this.humanIndex;
            const landlord = this.gameState.players[this.humanIndex];
            if (landlord) landlord.isLandlord = true;
            // 给地主底牌
            for (const c of bottom) {
                landlord.hand.push(c);
            }
            landlord.hand.sort((a, b) => b.value - a.value);
            this.gameState.currentTurn = this.humanIndex;
            this.gameState.phase = PHASE.PLAYING;
            this.gameState.passCount = 0;
            this.gameState.playCounts = [0, 0, 0];

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

        // 禁炸令 / 保守派：检查炸弹
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
        // 跟踪火箭状态
        if (data.pattern?.type === 'ROCKET') {
            this._lastWasRocket = true;
        } else if (data.pattern?.type === 'BOMB') {
            // 保留上一家是火箭的状态用于下一家判断
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

        // 注入炸弹压王炸标记（简化检测）
        if (this._bombBeatRocket) {
            // 通过修改 history 中的最后出牌标记来传递信息
        }

        if (result.passed) {
            ExtremeChallengeRecordManager.saveRecord(this.challengeId, result.stars);
        }

        // 显示挑战结果面板
        if (this.renderer) {
            this._setTimer(() => {
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
}

export { ChallengeMode };

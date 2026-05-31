/**
 * DailyMode - 每日挑战模式
 * 基于固定 seed 的牌局，玩家挑战今日专属牌局
 */

import { Player } from '../players/player.js';
import { AIPlayer } from '../players/ai-player.js';
import { BaseMode } from './base-mode.js';
import {
    DailyChallengeGenerator,
    ChallengeRecordManager,
    ChallengeResult,
    calculateStars,
    getTodayString,
} from '../utils/daily-challenge.js';

class DailyMode extends BaseMode {
    constructor(dateStr = null) {
        super('daily');
        this.dateStr = dateStr || getTodayString();
        this.challenge = DailyChallengeGenerator.generate(this.dateStr);
        this.humanBombCount = 0;
    }

    async init() {
        this.humanIndex = 0;
        this.gameState.setPlayer(0, new Player('玩家', false));
        this.gameState.setPlayer(1, new AIPlayer('AI-东', this.challenge.difficulty));
        this.gameState.setPlayer(2, new AIPlayer('AI-西', this.challenge.difficulty));

        // 重置人类炸弹计数
        this.humanBombCount = 0;

        console.log('[DailyMode] 初始化完成，日期:', this.dateStr, '难度:', this.challenge.difficulty);
    }

    // 覆盖 startGame 以使用固定牌局
    async startGame() {
        // 清理上一局遗留的定时器，防止旧挑战结果面板覆盖新游戏
        for (const t of this._pendingTimers) {
            clearTimeout(t.id);
        }
        this._pendingTimers = [];
        this.isRunning = true;
        this._applyGameRules();
        this.humanBombCount = 0;

        // 使用挑战预设牌局
        const deck = this.challenge.deck;
        const bottom = this.challenge.bottomCards;

        // 设置发牌起始位
        this.gameState.dealerIndex = this.challenge.dealerIndex;

        this.gameState.startRound(deck, bottom);

        // 播放音效
        this.renderer?.audio?.playDeal();
        this._setTimer(() => this.renderer?.audio?.playNewRound(), 300);

        // 进入叫分流程
        this._processCalling();
    }

    // 覆盖 onPlayerPlay 以追踪人类炸弹
    onPlayerPlay(data) {
        super.onPlayerPlay(data);
        if (data.playerIndex === this.humanIndex) {
            if (data.pattern?.type === 'BOMB' || data.pattern?.type === 'ROCKET') {
                this.humanBombCount++;
            }
        }
    }

    // 覆盖 onRoundEnd 以保存挑战结果
    onRoundEnd(data) {
        // 先调用父类处理（BGM、渲染等）
        super.onRoundEnd(data);

        // 计算星级
        const stars = calculateStars(data, this.humanIndex, this.humanBombCount);

        // 保存结果
        const humanScore = data.scores[this.humanIndex] || 0;
        const result = new ChallengeResult(
            this.dateStr,
            stars,
            humanScore,
            stars > 0,
            data.springType,
            this.humanBombCount,
        );
        ChallengeRecordManager.saveRecord(result);

        // 显示挑战结果面板（先关闭普通结算弹窗，避免重叠）
        if (this.renderer) {
            this._setTimer(() => {
                if (!this.isRunning) return;
                const overlay = this.renderer.container?.querySelector('#modal-overlay');
                const content = this.renderer.container?.querySelector('#modal-content');
                if (overlay && !overlay.classList.contains('hidden')) {
                    this.renderer._closeModal(overlay, content);
                }
                this.renderer?.showChallengeResult?.(result, data, ChallengeRecordManager.getStats());
            }, 1800);
        }
    }

    // 获取今日挑战信息
    getChallengeInfo() {
        const todayBest = ChallengeRecordManager.getTodayBest();
        return {
            date: this.dateStr,
            difficulty: this.challenge.difficulty,
            difficultyLabel: this._getDifficultyLabel(this.challenge.difficulty),
            bestStars: todayBest?.stars || 0,
            hasPlayed: !!todayBest,
        };
    }

    _getDifficultyLabel(diff) {
        return { easy: '简单', normal: '普通', hard: '困难' }[diff] || diff;
    }
}

export { DailyMode };

/**
 * EndgameMode - 残局训练模式
 * 固定牌局，让玩家练习特定残局场景
 */

import { Card } from '../core/card.js';
import { Rules } from '../core/rules.js';
import { GameState, PHASE } from '../core/game-state.js';
import { Player } from '../players/player.js';
import { AIPlayer } from '../players/ai-player.js';
import { BaseMode } from './base-mode.js';
import {
    ENDGAME_LEVELS,
    EndgameRecordManager,
    calculateEndgameStars,
} from '../utils/endgame-data.js';
import { Storage } from '../utils/storage.js';

class EndgameMode extends BaseMode {
    constructor(levelIndex = 0) {
        super('endgame');
        this.currentLevelIndex = levelIndex;
        this.humanStepCount = 0;
    }

    async init() {
        this.humanIndex = 0;
        this.gameState.setPlayer(0, new Player('玩家', false));
        this.gameState.setPlayer(1, new AIPlayer('AI-东', 'normal'));
        this.gameState.setPlayer(2, new AIPlayer('AI-西', 'normal'));
        this.humanStepCount = 0;
        console.log('[EndgameMode] 初始化完成，关卡:', this.currentLevelIndex + 1);
    }

    async startGame() {
        // 清理上一局定时器
        for (const t of this._pendingTimers) {
            clearTimeout(t.id);
        }
        this._pendingTimers = [];
        this.isRunning = true;
        this._applyGameRules();
        this.humanStepCount = 0;

        const level = ENDGAME_LEVELS[this.currentLevelIndex];
        if (!level) {
            console.error('[EndgameMode] 关卡索引无效:', this.currentLevelIndex);
            return;
        }

        // 用完整牌组通过 startRound，然后覆盖手牌
        const fullDeck = Card.createDeck();
        const bottom = fullDeck.slice(51, 54);
        const deck = fullDeck.slice(0, 51);
        this.gameState.startRound(deck, bottom);

        // 覆盖为残局固定手牌
        for (let i = 0; i < 3; i++) {
            if (this.gameState.players[i] && level.hands[i]) {
                this.gameState.players[i].setHand(level.hands[i]);
            }
            this.gameState.initialHands[i] = level.hands[i].map(c => ({
                value: c.value,
                suit: c.suit?.name,
                rank: c.rankKey,
                displayName: c.displayName,
            }));
        }

        // 设置地主
        this.gameState.landlordIndex = level.landlordIndex;
        const landlord = this.gameState.players[level.landlordIndex];
        if (landlord) landlord.isLandlord = true;

        // 设置当前回合
        this.gameState.currentTurn = level.currentTurn;

        // 设置上一手牌
        if (level.lastPlay && level.lastPlay.cards.length > 0) {
            this.gameState.lastPlay = {
                playerIndex: level.lastPlay.playerIndex,
                cards: level.lastPlay.cards,
                pattern: Rules.analyze(level.lastPlay.cards),
            };
        } else {
            this.gameState.lastPlay = { playerIndex: -1, cards: [], pattern: null };
        }

        // 直接进入出牌阶段
        this.gameState.phase = PHASE.PLAYING;
        this.gameState.passCount = 0;
        this.gameState.playCounts = [0, 0, 0];
        this.gameState.history = [];

        // 手动调度游戏BGM（直接赋值phase绕过了phaseChange事件）
        this.renderer?.audio?.stopBGM();
        this._setTimer(() => {
            if (this.isRunning) this.renderer?.audio?.playGameBGM();
        }, 500);

        // 残局模式强制使用标准规则，确保所有预设牌型合法
        this.gameState.allowTripleWithSingle = true;
        this.gameState.allowTripleWithPair = true;
        this.gameState.allowAirplaneWithWings = true;
        this.gameState.strictRules = false;
        this.gameState.jokerRule = 'standard';
        this.gameState.bombRule = 'standard';
        this.gameState.bombAsRocket = false;
        this.gameState.mustPlay = false;
        this.gameState.allowPassOnFirst = true;

        // 音效 + 渲染
        this.renderer?.audio?.playDeal();
        this._setTimer(() => this.renderer?.audio?.playNewRound(), 300);
        this.renderer?.renderHands?.();
        this.renderer?.highlightTurn?.(this.gameState.currentTurn);

        // 显示关卡信息
        this.renderer?.showEndgameInfo?.(level);

        // 进入出牌流程
        this._processPlay();
    }

    // 跳过叫分流程
    async _processCalling() {
        // 残局模式不需要叫分
        return;
    }

    onPlayerPlay(data) {
        super.onPlayerPlay(data);
        if (data.playerIndex === this.humanIndex && data.cards && data.cards.length > 0) {
            this.humanStepCount++;
        }
    }

    onRoundEnd(data) {
        // 父类处理 BGM、渲染等
        super.onRoundEnd(data);

        const level = ENDGAME_LEVELS[this.currentLevelIndex];
        if (!level) return;

        const result = calculateEndgameStars(
            level,
            data,
            this.gameState,
            this.humanStepCount,
            this.humanIndex
        );

        if (result.passed) {
            EndgameRecordManager.saveRecord(level.id, result.stars, this.humanStepCount);
        }

        // 显示残局结果面板
        if (this.renderer) {
            this._setTimer(() => {
                if (!this.isRunning) return;
                const overlay = this.renderer.container?.querySelector('#modal-overlay');
                const content = this.renderer.container?.querySelector('#modal-content');
                if (overlay && !overlay.classList.contains('hidden')) {
                    this.renderer._closeModal(overlay, content);
                }
                this.renderer?.showEndgameResult?.(
                    result.passed,
                    result.stars,
                    this.currentLevelIndex,
                    EndgameRecordManager.getProgress()
                );
            }, 1800);
        }
    }

    // 获取当前关卡信息
    getLevelInfo() {
        const level = ENDGAME_LEVELS[this.currentLevelIndex];
        const record = EndgameRecordManager.getRecord(level?.id);
        return {
            index: this.currentLevelIndex,
            ...level,
            bestStars: record?.stars || 0,
            bestSteps: record?.bestSteps || null,
            hasPassed: !!record?.passed,
        };
    }
}

export { EndgameMode };

/**
 * CustomMode - 自定义模式
 * 支持：自定义手牌、自定义规则参数、观战/测试模式
 */

import { Card } from '../core/card.js';
import { Player } from '../players/player.js';
import { AIPlayer } from '../players/ai-player.js';
import { BaseMode } from './base-mode.js';

class CustomMode extends BaseMode {
    constructor() {
        super('custom');
        this.customConfig = {
            // 牌堆配置
            fixedHands: [null, null, null], // 预设手牌（Card[][]），null表示随机发
            bottomCards: null, // 预设底牌
            
            // 规则参数
            minStraightLength: 5,     // 最小顺子长度
            allowTripleWithPair: true, // 允许三带二
            allowFourWithTwoPairs: true, // 允许四带两对
            allowPlaneWithPairs: true,   // 允许飞机带对
            bombDoublesScore: true,      // 炸弹是否翻倍
            springBonus: true,           // 春天/反春天奖励
            
            // 游戏模式
            callMode: 'score', // 'score' 叫分 / 'grab' 抢地主
            maxScore: 3,       // 最高叫分
            
            // AI配置
            aiDifficulty: 'normal',
            aiCount: 2,        // AI数量（0-3）
            
            // 特殊规则
            showAllCards: false, // 是否显示所有人手牌（测试用）
            autoPlay: false,     // 是否自动运行（观战）
            laiziMode: false,    // 是否启用癞子模式
        };
    }

    async init() {
        // 根据配置设置玩家
        const aiCount = this.customConfig.aiCount;
        let humanSet = false;
        
        for (let i = 0; i < 3; i++) {
            if (i < aiCount) {
                this.gameState.setPlayer(i, new AIPlayer(`AI-${i+1}`, this.customConfig.aiDifficulty));
            } else {
                this.gameState.setPlayer(i, new Player(i === 0 ? '玩家' : `玩家${i+1}`, false));
                if (!humanSet) {
                    this.humanIndex = i;
                    humanSet = true;
                }
            }
        }
        // 全AI观战模式
        if (!humanSet) {
            this.humanIndex = -1;
        }
        
        console.log('[CustomMode] 初始化完成，配置:', this.customConfig);
    }

    // 设置配置
    setConfig(key, value) {
        if (key in this.customConfig) {
            this.customConfig[key] = value;
            if (key === 'aiDifficulty') {
                for (const player of this.gameState.players) {
                    if (player?.isAI) player.difficulty = value;
                }
            }
        }
    }

    getConfig() {
        return { ...this.customConfig };
    }

    // 预设手牌
    setFixedHand(playerIndex, cards) {
        if (playerIndex >= 0 && playerIndex < 3) {
            this.customConfig.fixedHands[playerIndex] = cards;
        }
    }

    // 覆盖startGame以支持预设牌
    async startGame() {
        super.destroy();
        this.isRunning = true;
        
        // 应用全局游戏规则（与 BaseMode 保持一致）
        this._applyGameRules();
        
        this.gameState.callMode = this.customConfig.callMode;
        this.gameState.laiziEnabled = this.customConfig.laiziMode;
        this.gameState.showCards ||= this.customConfig.showAllCards;
        const hands = this.customConfig.fixedHands.map(hand => [...(hand || [])]);
        const bottom = [...(this.customConfig.bottomCards || [])];
        const fixed = [...hands.flat(), ...bottom];
        const key = card => `${card.rankKey}:${card.suit?.name || ''}`;
        if (hands.some(hand => hand.length > 17) || bottom.length > 3 ||
            fixed.some(card => !(card instanceof Card)) || new Set(fixed.map(key)).size !== fixed.length) {
            this.isRunning = false;
            this.renderer?.showToast('预设牌包含重复牌或超过允许张数', 'error');
            return false;
        }
        const used = new Set(fixed.map(key));
        const deck = this.gameState.noShuffle ? Card.createDeck() : Card.shuffle(Card.createDeck());
        const remaining = deck.filter(card => !used.has(key(card)));
        for (const hand of hands) hand.push(...remaining.splice(0, 17 - hand.length));
        bottom.push(...remaining.splice(0, 3 - bottom.length));
        if (!this.gameState.startRound(hands.flat(), bottom)) {
            this.isRunning = false;
            return false;
        }

        // 自动模式
        if (this.customConfig.autoPlay) {
            // 将所有人类替换为AI实例
            for (let i = 0; i < 3; i++) {
                const p = this.gameState.players[i];
                if (p && !p.isAI) {
                    const ai = new AIPlayer(p.name, this.customConfig.aiDifficulty);
                    ai.index = p.index;
                    ai.hand = p.hand;
                    ai.isLandlord = p.isLandlord;
                    this.gameState.players[i] = ai;
                }
            }
            // 全AI模式下无人类玩家
            this.humanIndex = -1;
        }
        
        // 音效（BGM 由 BaseMode.onPhaseChange 统一调度）
        this.renderer?.audio?.playDeal();
        this._setTimer(() => this.renderer?.audio?.playNewRound(), 300);

        this._processCalling();
    }

    // 覆盖事件以支持showAllCards
    onDealComplete(data) {
        super.onDealComplete(data);
        if (this.customConfig.showAllCards && this.renderer) {
            this.renderer.showAllHands();
        }
    }
}




export { CustomMode };

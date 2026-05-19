/**
 * CustomMode - 自定义模式
 * 支持：自定义手牌、自定义规则参数、观战/测试模式
 */

import { Card } from '../core/card.js';
import { GameState, PHASE } from '../core/game-state.js';
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
        this.isRunning = true;
        
        let deck, bottom;
        
        // 检查是否有预设
        const hasFixed = this.customConfig.fixedHands.some(h => h !== null) || 
                         this.customConfig.bottomCards !== null;
        
        if (hasFixed) {
            // 使用预设牌：构建三个玩家的手牌和底牌
            const playerHands = [null, null, null];
            
            for (let i = 0; i < 3; i++) {
                if (this.customConfig.fixedHands[i]) {
                    playerHands[i] = [...this.customConfig.fixedHands[i]];
                }
            }
            
            if (this.customConfig.bottomCards) {
                bottom = [...this.customConfig.bottomCards];
            }
            
            // 收集所有已固定的牌用于去重
            const allFixed = [];
            for (let i = 0; i < 3; i++) {
                if (playerHands[i]) allFixed.push(...playerHands[i]);
            }
            if (bottom) allFixed.push(...bottom);
            
            // 剩余牌随机补充
            const fullDeck = Card.shuffle(Card.createDeck());
            const used = new Set(allFixed.map(c => c.value + (c.suit?.name || c.rankKey || '')));
            const remaining = fullDeck.filter(c => !used.has(c.value + (c.suit?.name || c.rankKey || '')));
            
            // 从 remaining 补充缺失的手牌
            let remIdx = 0;
            for (let i = 0; i < 3; i++) {
                if (!playerHands[i]) {
                    playerHands[i] = remaining.slice(remIdx, remIdx + 17);
                    remIdx += 17;
                }
            }
            // 补充底牌
            if (!bottom) {
                bottom = remaining.slice(remIdx, remIdx + 3);
                remIdx += 3;
            }
            
            // 合并为 deck（51张）
            deck = [...playerHands[0], ...playerHands[1], ...playerHands[2]];
            
            // 设置叫牌模式和癞子
            this.gameState.callMode = this.customConfig.callMode;
            this.gameState.laiziEnabled = this.customConfig.laiziMode;
            this.gameState.startRound(deck, bottom);
            // 手动触发渲染
            if (this.renderer) this.renderer.renderHands();
        } else {
            // 设置叫牌模式和癞子
            this.gameState.callMode = this.customConfig.callMode;
            this.gameState.laiziEnabled = this.customConfig.laiziMode;
            const fullDeck = Card.shuffle(Card.createDeck());
            bottom = fullDeck.slice(51, 54);
            deck = fullDeck.slice(0, 51);
            this.gameState.startRound(deck, bottom);
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
        
        // 音效 + BGM
        this.renderer?.audio?.playDeal();
        setTimeout(() => this.renderer?.audio?.playNewRound(), 300);
        this.renderer?.audio?.stopBGM();
        setTimeout(() => this.renderer?.audio?.playGameBGM(), 1500);
        
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

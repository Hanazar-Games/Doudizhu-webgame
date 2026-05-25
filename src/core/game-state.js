/**
 * GameState - 斗地主游戏状态管理器
 * 负责：游戏阶段流转、玩家轮转、得分判定、胜负结算
 */

import { Rules } from './rules.js';

const PHASE = {
    IDLE: 'IDLE',               // 空闲/准备中
    DEALING: 'DEALING',         // 发牌中
    CALLING: 'CALLING',         // 叫分/叫地主
    PLAYING: 'PLAYING',         // 出牌中
    SETTLING: 'SETTLING',       // 结算中
    ENDED: 'ENDED',             // 已结束
};

const CALL_ACTION = {
    PASS: 0,    // 不叫
    ONE: 1,     // 1分
    TWO: 2,     // 2分
    THREE: 3,   // 3分
};

const GRAB_ACTION = {
    PASS: 0,      // 不叫/不抢
    CALL: 1,      // 叫地主
    GRAB: 2,      // 抢地主
};

class GameState {
    constructor() {
        this.phase = PHASE.IDLE;
        this.players = [null, null, null]; // 3个玩家位置
        this.landlordIndex = -1; // 地主索引
        this.currentTurn = 0;    // 当前轮到谁
        this.dealerIndex = 0;    // 本轮发牌起手的玩家（每轮会轮换）
        
        this.deck = [];          // 剩余牌堆
        this.bottomCards = [];   // 底牌3张
        
        this.lastPlay = {        // 最近一次的出牌
            playerIndex: -1,
            cards: [],
            pattern: null,
        };
        this.passCount = 0;      // 连续pass次数，达到2则新一轮
        
        this.scores = [0, 0, 0]; // 各玩家累计得分
        this.currentCall = 0;    // 当前最高叫分
        this.currentCallPlayer = -1; // 当前最高叫分玩家
        
        this.roundCount = 0;     // 总局数
        this.history = [];       // 出牌历史记录
        this.playCounts = [0, 0, 0]; // 各玩家本局出牌次数
        this.initialHands = [null, null, null]; // 初始手牌快照（用于回放）
        
        // 抢地主模式专用
        this.callMode = 'score'; // 'score' 叫分 / 'grab' 抢地主
        this.grabMultiplier = 1; // 抢地主倍数
        this.grabPhase = 'call'; // 'call' 叫地主阶段 / 'grab' 抢地主阶段
        this.hasCalled = [false, false, false]; // 谁叫了地主
        this.callRound = 0; // 当前轮次

        // 癞子模式
        // 癞子规则是全局配置，不应在单局重置时清除
        // this.laiziEnabled = false;
        this.laiziValue = -1; // 癞子点数，-1表示无癞子

        // 全局倍数设置
        this.scoreMultiplier = 1;

        // 游戏变体规则
        this.showCards = false;       // 明牌
        this.exchangeThree = false;   // 换三张
        this.noShuffle = false;       // 不洗牌
        this.bottomVisible = false;   // 底牌可见
        this.mustPlay = false;        // 有牌必出
        this.allowPassOnFirst = true; // 首家允许pass
        this.allowTripleWithSingle = true;
        this.allowTripleWithPair = true;
        this.allowAirplaneWithWings = true;
        this.bombAsRocket = false;
        this.strictRules = true;

        // 春天/炸弹规则
        this.allowSpring = true;
        this.allowAntiSpring = true;
        this.bombDoubles = true;
        this.rocketDoubles = true;

        this.eventListeners = {}; // 事件监听
    }

    // 注册事件
    on(event, callback) {
        if (!this.eventListeners[event]) this.eventListeners[event] = [];
        this.eventListeners[event].push(callback);
    }

    // 注销事件
    off(event, callback) {
        if (!this.eventListeners[event]) return;
        const idx = this.eventListeners[event].indexOf(callback);
        if (idx >= 0) this.eventListeners[event].splice(idx, 1);
    }

    emit(event, data) {
        if (this.eventListeners[event]) {
            for (const cb of this.eventListeners[event]) {
                try {
                    cb(data);
                } catch (e) {
                    console.error(`[GameState] 事件 '${event}' 处理异常:`, e);
                }
            }
        }
    }

    // 重置单局状态（不换玩家）
    resetRound() {
        this.phase = PHASE.IDLE;
        this.landlordIndex = -1;
        this.currentTurn = this.dealerIndex;
        this.deck = [];
        this.bottomCards = [];
        this.lastPlay = { playerIndex: -1, cards: [], pattern: null };
        this.passCount = 0;
        this.currentCall = 0;
        this.currentCallPlayer = -1;
        this.history = [];
        this.playCounts = [0, 0, 0];
        this.initialHands = [null, null, null];
        this.initialBottom = null;
        this.grabMultiplier = 1;
        this.grabPhase = 'call';
        this.hasCalled = [false, false, false];
        this.callRound = 0;
        // 癞子规则是全局配置，不应在单局重置时清除
        // this.laiziEnabled = false;
        this.laiziValue = -1;
        
        for (const p of this.players) {
            if (p) p.resetHand();
        }
    }

    // 设置玩家
    setPlayer(index, player) {
        if (index < 0 || index > 2) return false;
        this.players[index] = player;
        player.index = index;
        return true;
    }

    // 开始一局
    startRound(deck, bottomCards) {
        this.resetRound();
        // 清除所有牌的癞子标记（防止自定义模式重用 Card 对象时残留）
        for (const card of deck) {
            if (card) card.isLaizi = false;
        }
        if (bottomCards) {
            for (const card of bottomCards) {
                if (card) card.isLaizi = false;
            }
        }
        this.deck = deck;
        this.bottomCards = bottomCards;
        this.phase = PHASE.DEALING;
        this.emit('phaseChange', { phase: this.phase });
        
        // 发牌给3个玩家（各17张）
        for (let i = 0; i < 3; i++) {
            const hand = deck.slice(i * 17, (i + 1) * 17);
            if (this.players[i]) {
                this.players[i].setHand(hand);
            }
            this.initialHands[i] = hand.map(c => ({ value: c.value, suit: c.suit?.name, rank: c.rankKey, displayName: c.displayName }));
        }
        this.initialBottom = bottomCards.map(c => ({ value: c.value, suit: c.suit?.name, rank: c.rankKey, displayName: c.displayName }));
        
        // 确定癞子（如果启用）
        if (this.laiziEnabled && bottomCards.length > 0) {
            const laiziCard = bottomCards[0];
            // 安全：确保有 value 属性
            if (laiziCard && typeof laiziCard.value === 'number') {
                // 如果翻出大王，无癞子
                if (laiziCard.value !== 17) {
                    this.laiziValue = laiziCard.value;
                // 标记所有该点数的牌为癞子
                for (let i = 0; i < 3; i++) {
                    if (this.players[i]) {
                        for (const card of this.players[i].hand) {
                            if (card.value === this.laiziValue) {
                                card.isLaizi = true;
                            }
                        }
                    }
                }
                for (const card of bottomCards) {
                    if (card.value === this.laiziValue) {
                        card.isLaizi = true;
                    }
                }
                }
            }
        }
        
        this.phase = PHASE.CALLING;
        this.currentTurn = this.dealerIndex;
        this.emit('phaseChange', { phase: this.phase, currentTurn: this.currentTurn });
        this.emit('dealComplete', { bottomCards: this.bottomCards });
        
        return true;
    }

    // 叫分 / 抢地主
    callLandlord(playerIndex, action) {
        if (this.phase !== PHASE.CALLING) return false;
        if (playerIndex !== this.currentTurn) return false;
        
        if (this.callMode === 'grab') {
            return this._callGrabMode(playerIndex, action);
        }
        
        // 叫分模式
        if (action < CALL_ACTION.PASS || action > CALL_ACTION.THREE) return false;
        
        const player = this.players[playerIndex];
        
        if (action === CALL_ACTION.PASS) {
            this.emit('playerCall', { playerIndex, action: 0, name: player?.name, mode: 'score' });
        } else {
            if (action <= this.currentCall) return false; // 必须比当前高
            this.currentCall = action;
            this.currentCallPlayer = playerIndex;
            this.emit('playerCall', { playerIndex, action, name: player?.name, mode: 'score' });
        }
        
        // 轮转
        this.currentTurn = (this.currentTurn + 1) % 3;
        
        // 判断叫分结束
        if (this.currentTurn === this.dealerIndex) {
            this._finishCalling();
        } else if (action === CALL_ACTION.THREE) {
            this._finishCalling();
        }
        
        this.emit('turnChange', { currentTurn: this.currentTurn });
        return true;
    }
    
    // 抢地主模式逻辑
    _callGrabMode(playerIndex, action) {
        const player = this.players[playerIndex];
        
        if (this.grabPhase === 'call') {
            // 叫地主阶段
            if (action !== GRAB_ACTION.PASS && action !== GRAB_ACTION.CALL) return false;
            
            if (action === GRAB_ACTION.CALL) {
                this.hasCalled[playerIndex] = true;
                this.currentCallPlayer = playerIndex;
                this.emit('playerCall', { playerIndex, action: 'call', name: player?.name, mode: 'grab', phase: 'call' });
            } else {
                this.emit('playerCall', { playerIndex, action: 'pass', name: player?.name, mode: 'grab', phase: 'call' });
            }
            
            // 轮转
            this.currentTurn = (this.currentTurn + 1) % 3;
            this.callRound++;
            
            // 叫地主阶段结束：转完一圈
            if (this.callRound >= 3) {
                if (this.currentCallPlayer >= 0) {
                    // 有人叫了地主，进入抢地主阶段
                    this.grabPhase = 'grab';
                    this.callRound = 0;
                    this.currentTurn = (this.currentCallPlayer + 1) % 3;
                    this.emit('phaseChange', { phase: PHASE.CALLING, subPhase: 'grab', currentTurn: this.currentTurn });
                } else {
                    // 没人叫地主，默认 dealer 为地主
                    this._finishCalling(true);
                }
            }
        } else {
            // 抢地主阶段
            if (action !== GRAB_ACTION.PASS && action !== GRAB_ACTION.GRAB) return false;
            
            // 叫地主的人自己不能抢自己（但可以反抢，简化：任何人都可以抢）
            if (action === GRAB_ACTION.GRAB) {
                this.grabMultiplier *= 2;
                this.hasCalled[playerIndex] = true; // 用 hasCalled 标记参与过的人
                this.emit('playerCall', { playerIndex, action: 'grab', name: player?.name, mode: 'grab', phase: 'grab', multiplier: this.grabMultiplier });
            } else {
                this.emit('playerCall', { playerIndex, action: 'pass', name: player?.name, mode: 'grab', phase: 'grab' });
            }
            
            // 轮转
            this.currentTurn = (this.currentTurn + 1) % 3;
            this.callRound++;
            
            // 抢地主阶段结束：转完一圈（回到叫地主者）
            if (this.callRound >= 3 || this.currentTurn === this.currentCallPlayer) {
                this._finishCalling();
            }
        }
        
        this.emit('turnChange', { currentTurn: this.currentTurn });
        return true;
    }

    _finishCalling(forced = false) {
        if (this.currentCallPlayer >= 0) {
            this.landlordIndex = this.currentCallPlayer;
            const landlord = this.players[this.landlordIndex];
            landlord.isLandlord = true;
            landlord.addCards(this.bottomCards);
            
            this.currentTurn = this.landlordIndex;
            this.phase = PHASE.PLAYING;
            this.emit('landlordConfirmed', { 
                landlordIndex: this.landlordIndex, 
                bottomCards: this.bottomCards,
                multiplier: this.callMode === 'grab' ? this.grabMultiplier : null,
            });
        } else {
            // 没人叫分：默认dealer为地主
            this.landlordIndex = this.dealerIndex;
            const landlord = this.players[this.landlordIndex];
            landlord.isLandlord = true;
            landlord.addCards(this.bottomCards);
            this.currentTurn = this.landlordIndex;
            this.phase = PHASE.PLAYING;
            this.emit('landlordConfirmed', { 
                landlordIndex: this.landlordIndex, 
                bottomCards: this.bottomCards,
                forced: true
            });
        }
        this.emit('phaseChange', { phase: this.phase, currentTurn: this.currentTurn });
    }

    // 出牌
    playCards(playerIndex, cards, pattern) {
        if (this.phase !== PHASE.PLAYING) return { success: false, error: '不在出牌阶段' };
        if (playerIndex !== this.currentTurn) return { success: false, error: '不是您的回合' };
        
        const player = this.players[playerIndex];
        
        // 验证玩家手牌中包含这些牌
        if (!player.hasCards(cards)) {
            return { success: false, error: '手牌中没有这些牌' };
        }
        
        // 验证牌型（pattern应已由外部计算好）
        if (!pattern || pattern.type === 'INVALID') {
            return { success: false, error: '非法牌型' };
        }
        
        // 验证能否打过上一手
        
        // 如果这人是上一轮出牌者，或上一个人pass了（passCount==2则清空了lastPlay），则可以任意出
        const isNewRound = (this.lastPlay.playerIndex === playerIndex) || 
                           (this.lastPlay.playerIndex === -1) || 
                           (this.passCount >= 2);
        
        if (!isNewRound) {
            // 需要能打过上一手
            const canBeat = Rules.canBeat(this.lastPlay.pattern, pattern);
            if (!canBeat) {
                return { success: false, error: '打不过上一手牌' };
            }
        }
        
        // 执行出牌
        player.removeCards(cards);
        this.lastPlay = { playerIndex, cards, pattern };
        this.passCount = 0;
        this.playCounts[playerIndex]++;
        this.history.push({ playerIndex, cards, pattern, timestamp: Date.now() });
        
        this.emit('playerPlay', { playerIndex, cards, pattern, remaining: player.hand.length });
        
        // 检查胜利
        if (player.hand.length === 0) {
            this._settleRound(playerIndex);
            return { success: true, win: true };
        }
        
        // 轮转
        this.currentTurn = (this.currentTurn + 1) % 3;
        this.emit('turnChange', { currentTurn: this.currentTurn });
        
        return { success: true };
    }

    // Pass/不出
    pass(playerIndex) {
        if (this.phase !== PHASE.PLAYING) return false;
        if (playerIndex !== this.currentTurn) return false;

        // 如果是首家（新轮次）不能pass
        const isNewRound = (this.lastPlay.playerIndex === -1) ||
                           (this.lastPlay.playerIndex === playerIndex) ||
                           (this.passCount >= 2);
        if (isNewRound) return false;

        // 有牌必出规则：如果有可出的牌则不能pass
        if (this.mustPlay) {
            const player = this.players[playerIndex];
            if (player && player.hand.length > 0) {
                // 使用 Rules 检查是否有可出的牌
                const beats = Rules.findAllBeats(player.hand, this.lastPlay?.pattern);
                if (beats.length > 0) return false;
            }
        }
        
        this.passCount++;
        this.emit('playerPass', { playerIndex });
        
        if (this.passCount >= 2) {
            // 两人pass，新一轮，lastPlay归当前出牌者（即上一家）
            // 这里lastPlay保留，但下一家出牌时可以任意出（由isNewRound判断）
            // 实际上isNewRound中 passCount>=2 已经处理
        }
        
        this.currentTurn = (this.currentTurn + 1) % 3;
        this.emit('turnChange', { currentTurn: this.currentTurn });
        return true;
    }

    _settleRound(winnerIndex) {
        this.phase = PHASE.SETTLING;
        const isLandlordWin = winnerIndex === this.landlordIndex;
        const baseScore = this.currentCall || 1;
        
        let multiplier = 1;
        
        // 统计炸弹和火箭数量（受规则开关控制）
        let bombCount = 0;
        for (const h of this.history) {
            if (h.pattern?.type === 'BOMB' && this.bombDoubles !== false) bombCount++;
            if (h.pattern?.type === 'ROCKET' && this.rocketDoubles !== false) bombCount++;
        }
        multiplier *= Math.pow(2, bombCount);

        // 春天/反春天判断（受规则开关控制）
        let springType = null;
        if (isLandlordWin && this.allowSpring !== false) {
            const peasantsPlayed = [0, 1, 2].filter(i => i !== this.landlordIndex)
                .some(i => this.playCounts[i] > 0);
            if (!peasantsPlayed) {
                springType = 'spring';
                multiplier *= 2;
            }
        } else if (!isLandlordWin && this.allowAntiSpring !== false) {
            if (this.playCounts[this.landlordIndex] <= 1) {
                springType = 'anti_spring';
                multiplier *= 2;
            }
        }
        
        // 抢地主模式：基础分 = grabMultiplier
        const effectiveBase = this.callMode === 'grab' ? this.grabMultiplier : baseScore;
        const score = effectiveBase * multiplier * (this.scoreMultiplier || 1);
        
        if (isLandlordWin) {
            this.scores[this.landlordIndex] += score * 2;
            for (let i = 0; i < 3; i++) {
                if (i !== this.landlordIndex) this.scores[i] -= score;
            }
        } else {
            this.scores[this.landlordIndex] -= score * 2;
            for (let i = 0; i < 3; i++) {
                if (i !== this.landlordIndex) this.scores[i] += score;
            }
        }
        
        this.roundCount++;
        this.dealerIndex = (this.dealerIndex + 1) % 3;
        
        this.emit('roundEnd', {
            winnerIndex,
            isLandlordWin,
            scores: [...this.scores],
            landlordIndex: this.landlordIndex,
            springType,
            multiplier,
            baseScore: effectiveBase,
        });
        
        this.phase = PHASE.ENDED;
        this.emit('phaseChange', { phase: this.phase });
    }

    // 获取当前状态快照（用于网络同步或AI决策）
    getSnapshot() {
        return {
            phase: this.phase,
            currentTurn: this.currentTurn,
            landlordIndex: this.landlordIndex,
            lastPlay: {
                playerIndex: this.lastPlay.playerIndex,
                cards: this.lastPlay.cards.map(c => ({ suit: c.suit?.name, rank: c.rankKey })),
                patternType: this.lastPlay.pattern?.type,
            },
            passCount: this.passCount,
            scores: [...this.scores],
            playerInfo: this.players.map((p, i) => p ? {
                index: i,
                name: p.name,
                isLandlord: p.isLandlord,
                cardCount: p.hand.length,
            } : null),
        };
    }
}

export { GameState, PHASE, CALL_ACTION };

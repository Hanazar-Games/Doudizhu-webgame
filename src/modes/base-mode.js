/**
 * BaseMode - 游戏模式基类
 * 定义所有模式通用的接口和流程
 */

import { Card } from '../core/card.js';
import { Rules } from '../core/rules.js';
import { GameState, PHASE } from '../core/game-state.js';
import { AIPlayer } from '../players/ai-player.js';

class BaseMode {
    constructor(modeName) {
        this.modeName = modeName;
        this.gameState = new GameState();
        this.renderer = null;
        this.isRunning = false;
        this.humanIndex = 0; // 人类玩家默认在0号位
        
        // 多局赛制
        this.matchConfig = {
            isMatchMode: false,
            totalRounds: 1,
            currentRound: 0,
            matchScores: [0, 0, 0], // 累计总分
        };
        
        this._bindGameEvents();
    }
    
    // 设置比赛参数
    setMatchRounds(rounds) {
        this.matchConfig.totalRounds = rounds;
        this.matchConfig.isMatchMode = rounds > 1;
        this.matchConfig.currentRound = 0;
        this.matchConfig.matchScores = [0, 0, 0];
    }
    
    getMatchStatus() {
        return {
            isMatchMode: this.matchConfig.isMatchMode,
            currentRound: this.matchConfig.currentRound,
            totalRounds: this.matchConfig.totalRounds,
            matchScores: [...this.matchConfig.matchScores],
            isFinished: this.matchConfig.isMatchMode && this.matchConfig.currentRound >= this.matchConfig.totalRounds,
        };
    }

    _bindGameEvents() {
        this.gameState.on('phaseChange', (data) => this.onPhaseChange(data));
        this.gameState.on('playerCall', (data) => this.onPlayerCall(data));
        this.gameState.on('landlordConfirmed', (data) => this.onLandlordConfirmed(data));
        this.gameState.on('playerPlay', (data) => this.onPlayerPlay(data));
        this.gameState.on('playerPass', (data) => this.onPlayerPass(data));
        this.gameState.on('turnChange', (data) => this.onTurnChange(data));
        this.gameState.on('roundEnd', (data) => this.onRoundEnd(data));
        this.gameState.on('dealComplete', (data) => this.onDealComplete(data));
    }

    setRenderer(renderer) {
        this.renderer = renderer;
    }

    // 初始化模式（子类覆盖）
    async init() {
        throw new Error('init must be implemented by subclass');
    }

    // 开始一局
    async startGame() {
        this.isRunning = true;
        
        const deck = Card.shuffle(Card.createDeck());
        const bottom = deck.slice(51, 54);
        this.gameState.startRound(deck.slice(0, 51), bottom);
        
        // 播放发牌音效 + 新轮提示
        this.renderer?.audio?.playDeal();
        setTimeout(() => this.renderer?.audio?.playNewRound(), 300);
        
        // 进入叫分流程
        this._processCalling();
    }

    // 叫分流程（循环处理AI叫分）
    async _processCalling() {
        while (this.isRunning && this.gameState.phase === PHASE.CALLING) {
            const idx = this.gameState.currentTurn;
            const player = this.gameState.players[idx];
            
            if (!player) {
                console.error('叫分流程错误：当前玩家不存在');
                break;
            }
            
            if (player.isAI || player.isAuto) {
                await this._delay(800);
                let call;
                if (player.isAI) {
                    call = await player.decideCall(this.gameState);
                } else {
                    // 托管：使用AI逻辑
                    const ai = new AIPlayer('auto', 'normal');
                    ai.hand = player.hand;
                    call = await ai.decideCall(this.gameState);
                }
                let success = this.gameState.callLandlord(idx, call);
                if (!success) {
                    console.warn('叫分失败，强制pass:', player.name);
                    success = this.gameState.callLandlord(idx, 0);
                }
                if (!success) {
                    console.error('叫分强制pass也失败，终止叫分流程');
                    break; // 防止死循环
                }
            } else {
                // 人类玩家：等待UI输入
                this._waitForHumanCall(idx);
                break;
            }
        }
    }

    _waitForHumanCall(playerIndex) {
        // 触发UI显示叫分按钮
        if (this.renderer) {
            this.renderer.showCallControls(playerIndex);
        }
    }

    // 人类玩家叫分回调
    humanCall(action) {
        const idx = this.gameState.currentTurn;
        if (idx !== this.humanIndex) {
            console.warn('humanCall: 不是当前玩家的回合');
            return false;
        }
        const success = this.gameState.callLandlord(idx, action);
        if (success && this.gameState.phase === PHASE.CALLING) {
            // 继续处理后续AI叫分
            this._processCalling();
        }
        return success;
    }

    // 出牌流程
    async _processPlay() {
        while (this.isRunning && this.gameState.phase === PHASE.PLAYING) {
            const idx = this.gameState.currentTurn;
            const player = this.gameState.players[idx];
            
            if (!player) {
                console.error('出牌流程错误：当前玩家不存在');
                break;
            }
            
            if (player.isAI || player.isAuto) {
                await this._delay(player.isAuto ? 1200 : 1000);
                const lastPattern = this.gameState.lastPlay?.pattern;
                let cards;
                if (player.isAI) {
                    cards = await player.decidePlay(this.gameState, lastPattern);
                } else {
                    // 托管：使用AI逻辑
                    const ai = new AIPlayer('auto', 'normal');
                    ai.hand = player.hand;
                    ai.index = player.index;
                    cards = await ai.decidePlay(this.gameState, lastPattern);
                }
                
                if (cards.length === 0) {
                    const passSuccess = this.gameState.pass(idx);
                    if (!passSuccess) {
                        console.error('AI pass失败，终止出牌流程');
                        break;
                    }
                } else {
                    const pattern = Rules.analyze(cards);
                    const result = this.gameState.playCards(idx, cards, pattern);
                    if (!result.success) {
                        console.warn('出牌失败:', result.error, '强制pass');
                        const passSuccess = this.gameState.pass(idx);
                        if (!passSuccess) {
                            console.error('AI 强制pass也失败，终止出牌流程');
                            break;
                        }
                    }
                }
            } else {
                // 人类玩家：等待UI输入
                this._waitForHumanPlay(idx);
                break;
            }
        }
    }

    _waitForHumanPlay(playerIndex) {
        const player = this.gameState.players[playerIndex];
        if (player?.isAuto) {
            this._autoPlayForHuman(playerIndex);
            return;
        }
        if (this.renderer) {
            this.renderer.showPlayControls(playerIndex, this.gameState.lastPlay.pattern);
        }
    }
    
    // 托管切换后触发自动处理（renderer 调用）
    triggerAutoIfNeeded() {
        const idx = this.gameState.currentTurn;
        const player = this.gameState.players[idx];
        if (!player?.isAuto) return;
        if (this.gameState.phase === PHASE.PLAYING) {
            this._autoPlayForHuman(idx);
        } else if (this.gameState.phase === PHASE.CALLING) {
            this._processCalling();
        }
    }
    
    async _autoPlayForHuman(playerIndex) {
        await this._delay(1200);
        const player = this.gameState.players[playerIndex];
        if (!player?.isAuto) return;
        
        const lastPattern = this.gameState.lastPlay.pattern;
        const ai = new AIPlayer('auto', 'normal');
        ai.hand = player.hand;
        ai.index = player.index;
        const cards = await ai.decidePlay(this.gameState, lastPattern);
        
        if (cards.length === 0) {
            const success = this.gameState.pass(playerIndex);
            if (success && this.gameState.phase === PHASE.PLAYING) {
                this._processPlay();
            }
        } else {
            const pattern = Rules.analyze(cards);
            const result = this.gameState.playCards(playerIndex, cards, pattern);
            if (result.success && !result.win && this.gameState.phase === PHASE.PLAYING) {
                this._processPlay();
            }
        }
    }

    // 人类玩家出牌回调
    humanPlay(selectedCards) {
        const idx = this.gameState.currentTurn;
        if (idx !== this.humanIndex) {
            console.warn('humanPlay: 不是当前玩家的回合');
            return { success: false, error: '不是您的回合' };
        }
        const pattern = Rules.analyze(selectedCards);
        const result = this.gameState.playCards(idx, selectedCards, pattern);
        
        if (result.success && !result.win && this.gameState.phase === PHASE.PLAYING) {
            this._processPlay();
        }
        return result;
    }

    // 人类玩家Pass回调
    humanPass() {
        const idx = this.gameState.currentTurn;
        if (idx !== this.humanIndex) {
            console.warn('humanPass: 不是当前玩家的回合');
            return false;
        }
        const success = this.gameState.pass(idx);
        if (success && this.gameState.phase === PHASE.PLAYING) {
            this._processPlay();
        }
        return success;
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ---- 事件回调（子类可覆盖）----
    onPhaseChange(data) {
        console.log('[Phase]', data.phase);
        if (data.phase === PHASE.PLAYING) {
            this._processPlay();
            // 切换到游戏BGM
            this.renderer?.audio?.stopBGM();
            setTimeout(() => {
                if (this.isRunning) this.renderer?.audio?.playGameBGM();
            }, 500);
        }
    }

    onPlayerCall(data) {
        console.log('[Call]', data.name, '叫', data.action);
        if (this.renderer) this.renderer.showCallResult(data);
        // AI 快捷短语
        const player = this.gameState.players[data.playerIndex];
        if (player?.isAI && this.renderer) {
            let context = 'noCall';
            if (data.mode === 'grab') {
                if (data.phase === 'call') context = data.action === 'call' ? 'call' : 'noCall';
                else context = data.action === 'grab' ? 'grab' : 'noGrab';
            } else {
                context = data.action > 0 ? 'call' : 'noCall';
            }
            const phrase = AIPlayer.getPhrase(context);
            this.renderer.showChatBubble(data.playerIndex, phrase);
        }
    }
    
    onDealComplete(data) {
        if (this.renderer) {
            this.renderer.renderHands();
            this.renderer.highlightTurn(this.gameState.currentTurn);
        }
    }

    onLandlordConfirmed(data) {
        console.log('[Landlord]', data.landlordIndex);
        if (this.renderer) this.renderer.showLandlord(data);
    }

    onPlayerPlay(data) {
        console.log('[Play]', data.playerIndex, data.cards.map(c => c.displayName).join(' '));
        if (this.renderer) this.renderer.animatePlay(data);
        // AI 快捷短语
        const player = this.gameState.players[data.playerIndex];
        if (player?.isAI && this.renderer) {
            let context = 'play';
            const type = data.pattern?.type;
            if (type === 'BOMB') context = 'bomb';
            else if (type === 'ROCKET') context = 'rocket';
            else if (type === 'STRAIGHT') context = 'straight';
            else if (type?.includes('TRIPLE_STRAIGHT')) context = 'plane';
            else if (type === 'PAIR') context = 'pair';
            else if (type === 'TRIPLE') context = 'triple';
            const phrase = AIPlayer.getPhrase(context);
            this.renderer.showChatBubble(data.playerIndex, phrase);
        }
    }

    onPlayerPass(data) {
        console.log('[Pass]', data.playerIndex);
        if (this.renderer) this.renderer.showPass(data.playerIndex);
        // AI 快捷短语
        const player = this.gameState.players[data.playerIndex];
        if (player?.isAI && this.renderer) {
            const phrase = AIPlayer.getPhrase('pass');
            this.renderer.showChatBubble(data.playerIndex, phrase);
        }
    }

    onTurnChange(data) {
        if (this.renderer) this.renderer.highlightTurn(data.currentTurn);
    }

    onRoundEnd(data) {
        console.log('[RoundEnd]', data);
        // 累计比赛分数
        if (this.matchConfig.isMatchMode) {
            this.matchConfig.currentRound++;
            for (let i = 0; i < 3; i++) {
                this.matchConfig.matchScores[i] += data.scores[i];
            }
        }
        // BGM切换为胜利/失败（观战模式下humanIndex=-1，按旁观处理）
        let isHumanWin = false;
        if (this.humanIndex >= 0) {
            isHumanWin = data.winnerIndex === this.humanIndex ||
                (data.winnerIndex !== this.gameState.landlordIndex && this.humanIndex !== this.gameState.landlordIndex);
        }
        this.renderer?.audio?.stopBGM();
        setTimeout(() => {
            if (!this.isRunning) return;
            if (isHumanWin) {
                this.renderer?.audio?.playWinBGM();
            } else {
                this.renderer?.audio?.playLoseBGM();
            }
        }, 400);
        
        if (this.renderer) this.renderer.showRoundResult(data, this.getMatchStatus());
    }

}




export { BaseMode };

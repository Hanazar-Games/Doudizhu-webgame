/**
 * BaseMode - 游戏模式基类
 * 定义所有模式通用的接口和流程
 */

import { Card } from '../core/card.js';
import { Rules } from '../core/rules.js';
import { GameState, PHASE } from '../core/game-state.js';
import { AIPlayer } from '../players/ai-player.js';
import { Storage } from '../utils/storage.js';

class BaseMode {
    constructor(modeName) {
        this.modeName = modeName;
        this.gameState = new GameState();
        this.renderer = null;
        this.isRunning = false;
        this.humanIndex = 0; // 人类玩家默认在0号位
        this._isProcessingCalling = false;
        this._isProcessingPlay = false;
        this._isAutoPlaying = false;
        this._turnCountdown = 30;
        this._countdownInterval = null;
        
        // 多局赛制
        this.matchConfig = {
            isMatchMode: false,
            totalRounds: 1,
            currentRound: 0,
            matchScores: [0, 0, 0], // 累计总分
        };
        
        this.speedFactor = 1.0; // 游戏速度倍率 (0.5~2.0)
        
        // 跨局先手状态
        this._lastWinnerIndex = -1;
        this._lastLandlordIndex = -1;
        this._pendingTimers = [];
        
        this._bindGameEvents();
    }

    destroy() {
        this.isRunning = false;
        this._stopCountdown();
        for (const t of this._pendingTimers) {
            clearTimeout(t.id);
            // resolve 所有 pending 的 Promise，避免异步流程永久挂起导致内存泄漏
            try { t.resolve?.(new Error('Mode destroyed')); } catch (e) {}
        }
        this._pendingTimers = [];
    }

    _setTimer(fn, delay) {
        const id = setTimeout(() => {
            this._removePendingTimer(id);
            fn();
        }, delay);
        this._pendingTimers.push({ id, resolve: null });
        return id;
    }

    _removePendingTimer(id) {
        const idx = this._pendingTimers.findIndex(t => t.id === id);
        if (idx >= 0) this._pendingTimers.splice(idx, 1);
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

    // 从设置读取游戏规则并配置 GameState（供 BaseMode / LANMode / CustomMode 共用）
    _applyGameRules() {
        const settings = Storage.getSettings();
        this.speedFactor = Math.max(0.3, Math.min(5.0, parseFloat(settings.gameSpeed) || 1.0));
        this.gameState.callMode = ['score', 'grab'].includes(settings.callMode) ? settings.callMode : 'score';
        this.gameState.laiziEnabled = settings.laiziEnabled === true;
        this.gameState.scoreMultiplier = Math.max(1, Math.min(10, settings.scoreMultiplier ?? 1));
        this.gameState.baseScore = Math.max(1, Math.min(10, settings.baseScore ?? 1));
        // 癞子值由 startRound() 根据底牌第一张确定，此处不预赋值
        this.gameState.laiziValue = -1;
        // 先手规则
        const firstPlayerSetting = settings.firstPlayer || 'random';
        if (firstPlayerSetting === 'winner' && this._lastWinnerIndex >= 0) {
            this.gameState.dealerIndex = this._lastWinnerIndex;
        } else if (firstPlayerSetting === 'landlord' && this._lastLandlordIndex >= 0) {
            this.gameState.dealerIndex = this._lastLandlordIndex;
        } else {
            // random 或状态未就绪时保持默认 dealerIndex（每局轮换）
        }
        // 游戏变体规则
        this.gameState.showCards = settings.showCards === true;
        this.gameState.exchangeThree = settings.exchangeThree === true;
        this.gameState.noShuffle = settings.noShuffle === true;
        this.gameState.bottomVisible = settings.bottomVisible === true;
        this.gameState.mustPlay = settings.mustPlay === true;
        this.gameState.allowPassOnFirst = settings.allowPassOnFirst !== false;
        this.gameState.allowTripleWithSingle = settings.allowTripleWithSingle !== false;
        this.gameState.allowTripleWithPair = settings.allowTripleWithPair !== false;
        this.gameState.allowAirplaneWithWings = settings.allowAirplaneWithWings !== false;
        this.gameState.bombAsRocket = settings.bombAsRocket === true;
        this.gameState.strictRules = settings.strictRules !== false;
        this.gameState.jokerRule = settings.jokerRule || 'standard';
        this.gameState.bombRule = settings.bombRule || 'standard';
        // 春天/炸弹规则
        this.gameState.allowSpring = settings.allowSpring !== false;
        this.gameState.allowAntiSpring = settings.allowAntiSpring !== false;
        this.gameState.bombDoubles = settings.bombDoubles !== false;
        this.gameState.rocketDoubles = settings.rocketDoubles !== false;
    }

    // 开始一局
    async startGame() {
        // 清理上一局遗留的定时器，防止旧定时器干扰新局
        for (const t of this._pendingTimers) {
            clearTimeout(t.id);
            try { t.resolve?.(new Error('New game started')); } catch (e) {}
        }
        this._pendingTimers = [];
        this.isRunning = true;
        this._applyGameRules();

        let deck = Card.createDeck();
        if (!this.gameState.noShuffle) {
            deck = Card.shuffle(deck);
        }
        const bottom = deck.slice(51, 54);
        this.gameState.startRound(deck.slice(0, 51), bottom);
        
        // 播放发牌音效 + 新轮提示
        this.renderer?.audio?.playDeal();
        this._setTimer(() => this.renderer?.audio?.playNewRound(), 300);
        
        // 进入叫分流程
        this._processCalling();
    }

    // 叫分流程（循环处理AI叫分）
    async _processCalling() {
        if (this._isProcessingCalling) return;
        this._isProcessingCalling = true;
        try {
            while (this.isRunning && this.gameState.phase === PHASE.CALLING) {
                const idx = this.gameState.currentTurn;
                const player = this.gameState.players[idx];
                
                if (!player) {
                    console.error('叫分流程错误：当前玩家不存在');
                    break;
                }
                
                if (player.isAI || player.isAuto) {
                    let call;
                    if (player.isAI) {
                        call = await player.decideCall(this.gameState);
                    } else {
                        // 托管：使用AI逻辑
                        const ai = new AIPlayer('auto', 'normal');
                        ai.hand = player.hand;
                        call = await ai.decideCall(this.gameState);
                    }
                    // 观战模式：显示叫分建议
                    let hintText = null;
                    if (this.humanIndex < 0) {
                        if (call === 0) {
                            hintText = (this.gameState.callMode === 'grab' && this.gameState.grabPhase === 'grab') ? '不抢' : '不叫';
                        } else if (this.gameState.callMode === 'grab') {
                            hintText = this.gameState.grabPhase === 'call' ? '叫地主' : '抢地主';
                        } else {
                            hintText = call + '分';
                        }
                    }
                    this.renderer?.showThinking(idx, hintText);
                    const thinkMs = Math.max(200, Math.min(5000, Storage.getSettings().aiThinkTime ?? 800));
                    try {
                        await this._delay(thinkMs);
                    } catch (e) {
                        return;
                    }
                    if (!this.isRunning) return;
                    // 观战模式下增加额外延迟，方便观众观察
                    if (this.humanIndex < 0) {
                        const spectatorDelay = Math.max(0, Math.min(5000, Storage.getSettings().spectatorDelay ?? 0));
                        if (spectatorDelay > 0) {
                            try {
                                await this._delay(spectatorDelay);
                            } catch (e) {
                                return;
                            }
                        }
                    }
                    if (!this.isRunning) return;
                    this.renderer?.hideThinking(idx);
                    // delay 后重新检查回合，防止人类在此期间已行动
                    if (this.gameState.currentTurn !== idx) continue;
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
        } catch (err) {
            console.error('[_processCalling] 异常:', err);
        } finally {
            this._isProcessingCalling = false;
        }
    }

    _waitForHumanCall(playerIndex) {
        // 触发UI显示叫分按钮
        if (this.renderer) {
            this.renderer.showCallControls(playerIndex);
        }
        this._startCountdown(playerIndex, 'call');
    }

    // 人类玩家叫分回调
    humanCall(action) {
        this._stopCountdown();
        const idx = this.gameState.currentTurn;
        if (idx !== this.humanIndex) {
            console.warn('humanCall: 不是当前玩家的回合');
            return false;
        }
        const success = this.gameState.callLandlord(idx, action);
        if (!success) {
            this._startCountdown(idx, 'call');
            return false;
        }
        this.renderer?.hideCallControls();
        if (this.gameState.phase === PHASE.CALLING) {
            // 继续处理后续AI叫分
            this._processCalling();
        }
        return success;
    }

    // 出牌流程
    async _processPlay() {
        if (this._isProcessingPlay) return;
        this._isProcessingPlay = true;
        try {
            while (this.isRunning && this.gameState.phase === PHASE.PLAYING) {
                const idx = this.gameState.currentTurn;
                const player = this.gameState.players[idx];
                
                if (!player) {
                    console.error('出牌流程错误：当前玩家不存在');
                    break;
                }
                
                if (player.isAI || player.isAuto) {
                    this.renderer?.showThinking(idx);
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
                    // 观战模式：显示 AI 建议出牌
                    if (this.humanIndex < 0 && cards.length > 0) {
                        this.renderer?.showAIHint(idx, cards);
                    }
                    const baseThink = Storage.getSettings().aiThinkTime ?? 1000;
                    const thinkMs = Math.max(200, Math.min(5000, player.isAuto ? baseThink + 200 : baseThink));
                    try {
                        await this._delay(thinkMs);
                    } catch (e) {
                        return;
                    }
                    if (!this.isRunning) return;
                    // 观战模式下增加额外延迟，方便观众观察
                    if (this.humanIndex < 0) {
                        const spectatorDelay = Math.max(0, Math.min(5000, Storage.getSettings().spectatorDelay ?? 0));
                        if (spectatorDelay > 0) {
                            try {
                                await this._delay(spectatorDelay);
                            } catch (e) {
                                return;
                            }
                        }
                    }
                    if (!this.isRunning) return;
                    this.renderer?.hideThinking(idx);
                    this.renderer?.hideAIHint?.(idx);
                    
                    // delay 后重新检查回合，防止人类在此期间已行动
                    if (this.gameState.currentTurn !== idx) continue;
                    
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
        } catch (err) {
            console.error('[_processPlay] 异常:', err);
        } finally {
            this._isProcessingPlay = false;
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
        this._startCountdown(playerIndex, 'play');
    }
    
    // 托管切换后触发自动处理（renderer 调用）
    triggerAutoIfNeeded() {
        const idx = this.gameState.currentTurn;
        const player = this.gameState.players[idx];
        if (!player?.isAuto) return;
        this._stopCountdown(); // 停止倒计时避免与托管竞态
        if (this.gameState.phase === PHASE.PLAYING) {
            this._autoPlayForHuman(idx);
        } else if (this.gameState.phase === PHASE.CALLING) {
            this._processCalling();
        }
    }
    
    async _autoPlayForHuman(playerIndex) {
        if (this._isAutoPlaying) return;
        this._isAutoPlaying = true;
        try {
            this.renderer?.showThinking(playerIndex);
            await this._delay(1200);
            // 游戏可能已结束，提前退出
            if (!this.isRunning || this.gameState.phase !== PHASE.PLAYING) return;
            const player = this.gameState.players[playerIndex];
            if (!player?.isAuto) return;
            
            const lastPattern = this.gameState.lastPlay.pattern;
            const ai = new AIPlayer('auto', 'normal');
            ai.hand = player.hand;
            ai.index = player.index;
            const cards = await ai.decidePlay(this.gameState, lastPattern);
            this.renderer?.hideThinking(playerIndex);
            
            // 再次检查游戏状态，防止 delay 期间游戏结束或轮次已切换
            if (!this.isRunning || this.gameState.phase !== PHASE.PLAYING) return;
            if (this.gameState.currentTurn !== playerIndex) return;
            
            if (cards.length === 0) {
                const success = this.gameState.pass(playerIndex);
                if (success && this.gameState.phase === PHASE.PLAYING) {
                    this._processPlay();
                }
            } else {
                const pattern = Rules.analyze(cards);
                const result = this.gameState.playCards(playerIndex, cards, pattern);
                if (!result.success) {
                    console.warn('托管出牌失败:', result.error, '强制pass');
                    const passSuccess = this.gameState.pass(playerIndex);
                    if (passSuccess && this.gameState.phase === PHASE.PLAYING) {
                        this._processPlay();
                    }
                } else if (!result.win && this.gameState.phase === PHASE.PLAYING) {
                    this._processPlay();
                }
            }
        } finally {
            this._isAutoPlaying = false;
            this.renderer?.hideThinking(playerIndex);
        }
    }

    // 人类玩家出牌回调
    humanPlay(selectedCards) {
        this._stopCountdown();
        const idx = this.gameState.currentTurn;
        if (idx !== this.humanIndex) {
            console.warn('humanPlay: 不是当前玩家的回合');
            return { success: false, error: '不是您的回合' };
        }
        const pattern = Rules.analyze(selectedCards);
        const result = this.gameState.playCards(idx, selectedCards, pattern);
        
        if (!result.success) {
            this._startCountdown(idx, 'play');
            return result;
        }
        this.renderer?.hidePlayControls();
        if (!result.win && this.gameState.phase === PHASE.PLAYING) {
            this._processPlay();
        }
        return result;
    }

    // 人类玩家Pass回调
    humanPass() {
        this._stopCountdown();
        const idx = this.gameState.currentTurn;
        if (idx !== this.humanIndex) {
            console.warn('humanPass: 不是当前玩家的回合');
            return false;
        }
        const success = this.gameState.pass(idx);
        if (!success) {
            this._startCountdown(idx, 'play');
            return false;
        }
        this.renderer?.hidePlayControls();
        if (this.gameState.phase === PHASE.PLAYING) {
            this._processPlay();
        }
        return success;
    }

    _startCountdown(playerIndex, type) {
        this._stopCountdown();
        const settings = Storage.getSettings();
        // timerEnabled 在 HTML 中是 select，值为字符串 "true"/"false"
        if (settings.timerEnabled === false || settings.timerEnabled === 'false') {
            return; // 倒计时关闭，不启动
        }
        this._turnCountdown = Math.max(10, Math.min(120, settings.timerSeconds ?? 30));
        // 只在人类玩家回合显示倒计时
        if (playerIndex === this.humanIndex) {
            this.renderer?.showCountdown(playerIndex, this._turnCountdown);
        }
        this._countdownInterval = setInterval(() => {
            this._turnCountdown--;
            if (playerIndex === this.humanIndex) {
                this.renderer?.showCountdown(playerIndex, this._turnCountdown);
            }
            if (this._turnCountdown <= 10 && this._turnCountdown > 0) {
                this.renderer?.audio?.playTick();
            }
            if (this._turnCountdown <= 0) {
                this._stopCountdown();
                this._onCountdownTimeout(type);
            }
        }, 1000);
    }

    _stopCountdown() {
        if (this._countdownInterval) {
            clearInterval(this._countdownInterval);
            this._countdownInterval = null;
        }
        this.renderer?.hideCountdown();
    }

    _onCountdownTimeout(type) {
        if (!this.isRunning) return;
        // 确保超时处理只针对当前人类玩家的回合
        if (type === 'play' && this.gameState.currentTurn !== this.humanIndex) return;
        if (type === 'call') {
            this.humanCall(0);
        } else if (type === 'play') {
            // 超时：尝试提示，如果提示为空则不出
            const player = this.gameState.players[this.humanIndex];
            if (!player) return;
            const ai = new AIPlayer('timeout', 'normal');
            ai.hand = player.hand;
            const lastPattern = this.gameState.lastPlay?.pattern;
            const isNewRound = !lastPattern || lastPattern.type === 'INVALID' ||
                               (this.gameState.passCount >= 2) ||
                               (this.gameState.lastPlay?.playerIndex === this.humanIndex);
            const hint = ai.getHint(player.hand, lastPattern, isNewRound, this.gameState);
            if (hint.length > 0) {
                this.humanPlay(hint);
            } else {
                this.humanPass();
            }
        }
    }

    _delay(ms) {
        let timerId;
        const p = new Promise((resolve, reject) => {
            timerId = setTimeout(() => {
                this._removePendingTimer(timerId);
                resolve();
            }, ms / Math.max(0.3, this.speedFactor));
            this._pendingTimers.push({ id: timerId, resolve, reject });
        });
        return p;
    }

    // ---- 倒计时相关 ----
    pauseGame() {
        if (!this.isRunning || this.gameState.phase === PHASE.ENDED) return false;
        this._stopCountdown();
        this.isRunning = false;
        for (const t of this._pendingTimers) {
            clearTimeout(t.id);
            try { t.resolve?.(); } catch (e) {}
        }
        this._pendingTimers = [];
        return true;
    }

    resumeGame() {
        if (this.isRunning || this.gameState.phase === PHASE.ENDED) return false;
        this.isRunning = true;
        if (this.gameState.phase === PHASE.CALLING) {
            this._processCalling();
        } else if (this.gameState.phase === PHASE.PLAYING) {
            this._processPlay();
        }
        return true;
    }

    // ---- 事件回调（子类可覆盖）----
    onPhaseChange(data) {
        console.log('[Phase]', data.phase);
        if (data.phase === PHASE.PLAYING) {
            this._processPlay();
            // 切换到游戏BGM
            this.renderer?.audio?.stopBGM();
            this._setTimer(() => {
                if (this.isRunning) this.renderer?.audio?.playGameBGM();
            }, 500);
        }
        else if (data.phase === PHASE.ENDED) {
            this._stopCountdown();
            // NOTE: 不清除 _pendingTimers，因为 onRoundEnd 中注册的 BGM 切换
            // 和子类（如 DailyMode）的挑战结果定时器需要在此阶段存活。
            // destroy() 会统一清理所有残留定时器。
            this._isProcessingCalling = false;
            this._isProcessingPlay = false;
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
            // 发牌完成后初始化记牌器（满牌 54 张，等待出牌后递减）
            this.renderer._resetCardTracker();
            this.renderer.renderHands();
            this.renderer.highlightTurn(this.gameState.currentTurn);
        }
    }

    onLandlordConfirmed(data) {
        console.log('[Landlord]', data.landlordIndex);
        this._lastLandlordIndex = data.landlordIndex;
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
        this._lastWinnerIndex = data.winnerIndex;
        // 累计比赛分数
        if (this.matchConfig.isMatchMode) {
            this.matchConfig.currentRound++;
            // data.scores 是 GameState 的跨局累加值，直接赋值即可
            for (let i = 0; i < 3; i++) {
                this.matchConfig.matchScores[i] = data.scores[i];
            }
        }
        // BGM切换为胜利/失败（观战模式下humanIndex=-1，按旁观处理）
        let isHumanWin = false;
        if (this.humanIndex >= 0) {
            isHumanWin = data.winnerIndex === this.humanIndex ||
                (data.winnerIndex !== this.gameState.landlordIndex && this.humanIndex !== this.gameState.landlordIndex);
        }
        // 得分变化音效
        // 使用本局胜负判断音效，而非跨局累加分数
        if (this.humanIndex >= 0) {
            this.renderer?.audio?.playScoreChange(isHumanWin);
        }
        
        this.renderer?.audio?.stopBGM();
        this._setTimer(() => {
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

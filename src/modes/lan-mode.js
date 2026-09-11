/**
 * LANMode - 局域网联机模式
 * 基于 WebSocket 的联机对战
 */

import { Card, SUITS, RANKS } from '../core/card.js';
import { Rules, HandPattern } from '../core/rules.js';
import { PHASE } from '../core/game-state.js';
import { Player } from '../players/player.js';
import { AIPlayer } from '../players/ai-player.js';
import { BaseMode } from './base-mode.js';
import { CONFIG } from '../config.js';

// WebSocket URL 来自全局配置
const WS_URL = CONFIG.ws.url;

class LANMode extends BaseMode {
    constructor() {
        super('lan');
        this.isHost = false;
        this.myPeerId = null;
        this.playerMapping = {};   // peerId -> playerIndex
        this.hostPeerId = null;
        this.networkReady = false;
        this.ws = null;
        this.reconnectTimer = null;
        this._reconnectAttempts = 0;
        this._syncRevision = 0;
        this._lastResult = null;
    }

    _showToast(msg, type = 'info') {
        // 优先通过 renderer 显示，否则静默记录
        if (this.renderer?.showToast) {
            this.renderer.showToast(msg, type);
        } else {
            const status = document.getElementById('lan-message');
            if (status) status.textContent = msg;
        }
    }

    destroy() {
        super.destroy();
        this._settleRoomRequest(new Error('已离开联机大厅'));
        this._roomReady = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            // 移除所有监听器防止回调触发重连或状态更新
            this.ws.onopen = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.onmessage = null;
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close();
            }
            this.ws = null;
        }
        this.networkReady = false;
        this._reconnectAttempts = 0;
        this._syncRevision = 0;
        this._lastResult = null;
    }

    async init() {
        this.humanIndex = -1;
        console.log('[LANMode] 初始化完成');
    }

    // ---- 房间管理 ----

    async createRoom() {
        if (this._roomReady && this.isHost) return this.myPeerId;
        this.isHost = true;
        this.humanIndex = 0;
        this.myPeerId = this._generatePeerId();
        
        this.gameState.setPlayer(0, new Player(this._desiredPlayerName || '房主', false));
        
        await this._connectWebSocket();
        await this._requestRoom({ type: 'create_room', peerId: this.myPeerId, name: this._desiredPlayerName });
        
        console.log('[LANMode] 创建房间，PeerID:', this.myPeerId);
        return this.myPeerId;
    }

    async joinRoom(hostPeerId) {
        this.isHost = false;
        this.hostPeerId = hostPeerId;
        this.myPeerId = this._generatePeerId();
        
        await this._connectWebSocket();
        await this._requestRoom({ type: 'join_room', peerId: this.myPeerId, targetPeerId: hostPeerId, name: this._desiredPlayerName });
        
        console.log('[LANMode] 加入房间:', hostPeerId);
    }

    _generatePeerId() {
        return 'ddz_' + Math.random().toString(36).substr(2, 9);
    }

    _requestRoom(message) {
        this._settleRoomRequest(new Error('房间请求已替换'));
        this._roomReady = false;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => this._settleRoomRequest(new Error('房间请求超时，请重试')), 10000);
            this._roomRequest = { resolve, reject, timer };
            this._send(message);
        });
    }

    _settleRoomRequest(error) {
        const request = this._roomRequest;
        if (!request) return;
        this._roomRequest = null;
        clearTimeout(request.timer);
        if (error) request.reject(error);
        else request.resolve();
    }

    // ---- WebSocket 连接 ----

    async _connectWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
        
        // 清理旧 socket 防止僵尸连接和重复回调
        if (this.ws) {
            this.ws.onopen = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.onmessage = null;
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close();
            }
            this.ws = null;
        }
        
        return new Promise((resolve, reject) => {
            try {
                const ws = new WebSocket(WS_URL);
                this.ws = ws;
                
                let settled = false;
                let opened = false;
                const settle = (fn) => (...args) => { if (!settled) { settled = true; fn(...args); } };
                
                ws.onopen = () => {
                    console.log('[LANMode] WebSocket连接成功');
                    opened = true;
                    this.networkReady = true;
                    resolve();
                };
                
                ws.onmessage = (e) => {
                    try {
                        this._onWsMessage(JSON.parse(e.data));
                    } catch (err) {
                        console.warn('[LANMode] 忽略异常网络消息:', err);
                        this._showToast('收到异常网络消息，已忽略');
                    }
                };
                
                ws.onclose = () => {
                    console.warn('[LANMode] WebSocket断开');
                    this.networkReady = false;
                    this._settleRoomRequest(new Error('连接已断开，请重试'));
                    // 如果连接从未成功打开过，reject Promise 防止永久阻塞
                    if (!opened && !settled) {
                        settled = true;
                        reject(new Error('WebSocket connection failed'));
                    }
                    this._scheduleReconnect();
                };
                
                ws.onerror = settle((err) => {
                    console.error('[LANMode] WebSocket错误:', err);
                    reject(err);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    _scheduleReconnect() {
        if (this.reconnectTimer) return;
        if (!this.myPeerId) return; // 从未加入/创建过房间，不重连
        if (this._reconnectAttempts >= CONFIG.ws.maxReconnectAttempts) {
            console.warn('[LANMode] 重连次数已达上限，停止重连');
            this._showToast('连接已断开，请重新进入局域网联机');
            return;
        }
        this._reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.myPeerId) {
                console.log('[LANMode] 尝试重连... (第' + this._reconnectAttempts + '次)');
                this._connectWebSocket().then(() => {
                    this._reconnectAttempts = 0;
                    if (this.isHost) {
                        this._send({ type: 'create_room', peerId: this.myPeerId, reconnectToken: this.reconnectToken, name: this._desiredPlayerName });
                    } else if (this.hostPeerId) {
                        this._send({ type: 'join_room', peerId: this.myPeerId, targetPeerId: this.hostPeerId, reconnectToken: this.reconnectToken, name: this._desiredPlayerName });
                    }
                }).catch(() => {
                    this._scheduleReconnect();
                });
            }
        }, CONFIG.ws.reconnectInterval || 3000);
    }

    _send(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        } else if (msg?.type !== 'ping') {
            console.warn('[LANMode] WebSocket 未连接，消息未发送:', msg?.type);
        }
    }

    _onWsMessage(msg) {
        switch (msg.type) {
            case 'room_created':
                this.reconnectToken = msg.reconnectToken;
                this._roomReady = true;
                this._settleRoomRequest();
                this._showToast('房间已创建，等待玩家加入');
                if (msg.reconnected && this._gameId) this._sendStateSync();
                break;
            case 'player_joined':
                if (this.isHost) {
                    this._handlePlayerJoin(msg.peerId, msg.seatIndex, msg.name);
                }
                break;
            case 'player_list_update':
                this._updatePlayerList(msg.players);
                break;
            case 'seat_assigned':
                this.reconnectToken = msg.reconnectToken;
                this._roomReady = true;
                this._settleRoomRequest();
                this._showToast('已加入房间，等待房主开始');
                if (!this.isHost) {
                    this.humanIndex = msg.seatIndex;
                    const p = this.gameState.players[this.humanIndex] || new Player(this._desiredPlayerName || '玩家', false);
                    this.gameState.setPlayer(this.humanIndex, p);
                }
                if (msg.reconnected && this.isHost && this.gameState.phase !== 'IDLE') {
                    // 有玩家重连，host 发送完整状态同步
                    const peerId = msg.peerId || this._findPeerIdBySeat(msg.seatIndex);
                    if (peerId) this._sendStateSync(peerId);
                }
                if (msg.reconnected && !this.isHost) {
                    this._showToast('重连成功，正在同步游戏状态...');
                    // 非 host 重连后请求状态同步（server 已代发，但双重保险）
                    if (this.hostPeerId) {
                        this._send({ type: 'request_state_sync', targetPeerId: this.hostPeerId });
                    }
                }
                break;
            case 'game_starting':
                if (this.isHost) this._startHostRound();
                break;
            case 'request_state_sync':
                if (this.isHost) {
                    const targetPeerId = msg.peerId || msg.targetPeerId;
                    if (targetPeerId) this._sendStateSync(targetPeerId);
                }
                break;
            case 'game_state_sync':
                this._applySync(msg.data);
                break;
            case 'player_action':
                this._handleRemoteAction(msg);
                break;
            case 'player_left':
                this._showToast(`玩家 ${msg.peerId} 已离开`);
                break;
            case 'room_closed':
                this.destroy();
                this.renderer?.audio?.stopBGM();
                this._showToast('房间已关闭: ' + (msg.reason || ''));
                window.gameApp?.showMenu();
                break;
            case 'error':
                this._settleRoomRequest(new Error(msg.message));
                console.warn('[LANMode]', msg.message);
                const status = document.getElementById('lan-status');
                if (status) status.textContent = msg.message;
                this._showToast('错误: ' + msg.message);
                break;
        }
    }

    // ---- Host逻辑 ----

    _handlePlayerJoin(peerId, seatIndex, name) {
        if (!this.gameState.players[seatIndex]) {
            this.gameState.setPlayer(seatIndex, new Player(name || `玩家${seatIndex + 1}`, false));
            this.playerMapping[peerId] = seatIndex;
        }
    }

    _updatePlayerList(players) {
        if (Array.isArray(players)) {
            this.playerMapping = {};
            if (!this.isRunning) {
                this.gameState.players.forEach((player, i) => {
                    if (!players.some(p => p.seatIndex === i)) this.gameState.players[i] = null;
                });
            }
            for (const p of players) {
                if (p.peerId != null && p.seatIndex != null) {
                    this.playerMapping[p.peerId] = p.seatIndex;
                    const player = this.gameState.players[p.seatIndex] || new Player(p.name || '玩家');
                    player.name = p.name || player.name;
                    player.connected = p.connected !== false;
                    this.gameState.setPlayer(p.seatIndex, player);
                }
            }
        }
        // 触发UI更新玩家列表
        const listEl = document.getElementById('player-list');
        if (listEl) {
            listEl.innerHTML = '';
            for (const p of players) {
                const div = document.createElement('div');
                div.className = 'player-list-item';
                div.textContent = `${p.name} (座位${p.seatIndex + 1})`;
                listEl.appendChild(div);
            }
        }
    }

    // ---- 游戏同步 ----

    async startGame() {
        if (!this.isHost) return this._showToast('等待房主开始下一局');
        if (this.gameState.players.filter(p => p && p.connected !== false).length !== 3) {
            return this._showToast('需要 3 位玩家在线才能开始');
        }
        this._send({ type: 'game_start' });
    }

    _startHostRound() {
        super.destroy();
        if (!this.renderer) window.gameApp?._enterLANGameFromNetwork?.(this);
        this._isAutoPlaying = false;
        document.getElementById('modal-overlay')?.classList.add('hidden');
        this._gameId = this._generatePeerId();
        this._lastResult = null;
        this.isRunning = true;
        this._applyGameRules();
        const deck = this.gameState.noShuffle ? Card.createDeck() : Card.shuffle(Card.createDeck());
        this.gameState.startRound(deck.slice(0, 51), deck.slice(51));
        this.renderer?.audio?.playDeal();
        this._updateTurn();
        this._sendStateSync();
    }

    _processCalling() { this._updateTurn(); }
    _processPlay() { this._updateTurn(); }

    onTurnChange(data) {
        super.onTurnChange(data);
        this._updateTurn();
    }

    onRoundEnd(data) {
        this._lastResult = data;
        super.onRoundEnd(data);
    }

    _updateTurn() {
        this._stopCountdown();
        this.renderer?.hideCallControls();
        this.renderer?.hidePlayControls();
        if (!this.isRunning || this.gameState.currentTurn !== this.humanIndex) return;
        const phase = this.gameState.phase;
        if (phase !== PHASE.CALLING && phase !== PHASE.PLAYING) return;
        if (this.gameState.players[this.humanIndex]?.isAuto) {
            this.triggerAutoIfNeeded();
        } else if (phase === PHASE.CALLING) {
            this.renderer?.showCallControls(this.humanIndex);
            this._startCountdown(this.humanIndex, 'call');
        } else {
            this.renderer?.showPlayControls(this.humanIndex, this.gameState.lastPlay.pattern);
            this._startCountdown(this.humanIndex, 'play');
        }
    }

    async triggerAutoIfNeeded() {
        if (this._isAutoPlaying || this.gameState.currentTurn !== this.humanIndex) return;
        const player = this.gameState.players[this.humanIndex];
        if (!this.isRunning || !player?.isAuto) return;
        this._stopCountdown();
        this._isAutoPlaying = true;
        const generation = this._generation;
        try {
            await this._delay(800);
            if (!this.isRunning || generation !== this._generation || this.gameState.currentTurn !== this.humanIndex || !player.isAuto) return;
            const ai = new AIPlayer('auto');
            ai.hand = player.hand;
            ai.index = this.humanIndex;
            const phase = this.gameState.phase;
            const stillCurrent = () => this.isRunning && generation === this._generation &&
                this.gameState.phase === phase && this.gameState.currentTurn === this.humanIndex && player.isAuto;
            if (phase === PHASE.CALLING) {
                const call = await ai.decideCall(this.gameState);
                if (stillCurrent()) this.humanCall(call);
            } else if (phase === PHASE.PLAYING) {
                const cards = await ai.decidePlay(this.gameState, this.gameState.lastPlay.pattern);
                if (!stillCurrent()) return;
                if (cards.length) this.humanPlay(cards);
                else this.humanPass();
            }
        } finally { if (generation === this._generation) this._isAutoPlaying = false; }
    }

    humanCall(value) { return this._submitAction({ action: 'call', value }).success; }
    humanPlay(cards) { return this._submitAction({ action: 'play', cards: this._serializeDeck(cards) }); }
    humanPass() { return this._submitAction({ action: 'pass' }).success; }

    _submitAction(action) {
        if (this.gameState.currentTurn !== this.humanIndex) return { success: false, error: '不是您的回合' };
        const message = { type: 'player_action', playerIndex: this.humanIndex, ...action };
        if (this.isHost) return this._handleRemoteAction(message);
        if (!this.networkReady) return { success: false, error: '连接已断开，正在重连' };
        this._send({ ...message, targetPeerId: this.hostPeerId });
        this._stopCountdown();
        this.renderer?.hideCallControls();
        this.renderer?.hidePlayControls();
        return { success: true };
    }

    _handleRemoteAction(msg) {
        if (!this.isHost) return { success: false, error: '等待房主同步' };
        const gs = this.gameState;
        const idx = msg.playerIndex;
        let result = { success: false, error: '无效操作' };
        if (msg.action === 'call') result = { success: gs.callLandlord(idx, msg.value) };
        else if (msg.action === 'pass') result = { success: gs.pass(idx) };
        else if (msg.action === 'play' && Array.isArray(msg.cards)) {
            const decoded = this._deserializeDeck(msg.cards);
            const hand = gs.players[idx]?.hand || [];
            const selected = decoded.map(c => hand.find(h => h.rankKey === c.rankKey && h.suit?.name === c.suit?.name));
            if (decoded.length === msg.cards.length && selected.every(Boolean)) {
                result = gs.playCards(idx, selected, Rules.analyze(selected));
            }
        }
        this._sendStateSync();
        this._updateTurn();
        return result;
    }

    _requestStateSync() {
        if (!this.isHost && this.hostPeerId) {
            this._send({ type: 'request_state_sync', targetPeerId: this.hostPeerId });
        }
    }

    // ---- 序列化工具 ----

    _serializeDeck(cards) {
        return cards.map(c => ({
            s: c.suit?.name || null,
            r: c.rankKey,
            l: c.isLaizi === true
        }));
    }

    _deserializeDeck(data) {
        if (!Array.isArray(data)) return [];
        return data.map(d => {
            if (!d || typeof d !== 'object' || !d.r) return null;
            // 验证 rankKey 有效性
            if (!RANKS[d.r]) return null;
            // 验证 suit：null/undefined 表示大小王，字符串则必须对应有效花色
            let suit = null;
            if (d.s != null) {
                if (typeof d.s !== 'string') return null;
                suit = SUITS[d.s.toUpperCase()];
                if (!suit) return null;
            }
            if ((d.r.startsWith('JOKER')) !== (suit === null)) return null;
            const card = new Card(suit, d.r);
            card.isLaizi = d.l === true;
            return card;
        }).filter(Boolean);
    }

    _applySync(data) {
        if (!data || typeof data !== 'object') return;
        const gs = this.gameState;
        if (data.revision != null && data.gameId === this._receivedGameId && data.revision <= (this._receivedRevision || 0)) return;
        const newRound = data.gameId && data.gameId !== this._receivedGameId;
        this._receivedGameId = data.gameId;
        this._receivedRevision = data.revision;
        if (newRound) {
            document.getElementById('modal-overlay')?.classList.add('hidden');
            super.destroy();
            gs.resetRound();
            this._isAutoPlaying = false;
            this._lastResult = null;
        }
        if (!this.renderer) window.gameApp?._enterLANGameFromNetwork?.(this);
        this.isRunning = true;
        const oldPhase = gs.phase;
        const oldLandlord = gs.landlordIndex;
        const oldHistoryLength = gs.history.length;

        // --- 核心状态 ---
        if (data.phase != null) gs.phase = data.phase;
        if (data.currentTurn != null) gs.currentTurn = data.currentTurn;
        if (data.landlordIndex != null) gs.landlordIndex = data.landlordIndex;
        if (data.passCount != null) gs.passCount = data.passCount;
        if (data.scores != null) gs.scores = [...data.scores];
        if (data.playCounts != null) gs.playCounts = [...data.playCounts];
        if (data.currentCall != null) gs.currentCall = data.currentCall;
        if (data.currentCallPlayer != null) gs.currentCallPlayer = data.currentCallPlayer;
        if (data.dealerIndex != null) gs.dealerIndex = data.dealerIndex;
        if (data.grabMultiplier != null) gs.grabMultiplier = data.grabMultiplier;
        if (data.grabPhase != null) gs.grabPhase = data.grabPhase;
        if (data.hasCalled != null) gs.hasCalled = [...data.hasCalled];
        if (data.callRound != null) gs.callRound = data.callRound;
        if (data.laiziValue != null) gs.laiziValue = data.laiziValue;
        if (data.roundCount != null) gs.roundCount = data.roundCount;

        // --- 游戏规则变体 ---
        if (data.callMode != null) gs.callMode = data.callMode;
        if (data.laiziEnabled != null) gs.laiziEnabled = data.laiziEnabled;
        if (data.scoreMultiplier != null) gs.scoreMultiplier = data.scoreMultiplier;
        if (data.baseScore != null) gs.baseScore = data.baseScore;
        if (data.showCards != null) gs.showCards = data.showCards;
        if (data.exchangeThree != null) gs.exchangeThree = data.exchangeThree;
        if (data.noShuffle != null) gs.noShuffle = data.noShuffle;
        if (data.bottomVisible != null) gs.bottomVisible = data.bottomVisible;
        if (data.mustPlay != null) gs.mustPlay = data.mustPlay;
        if (data.allowPassOnFirst != null) gs.allowPassOnFirst = data.allowPassOnFirst;
        if (data.allowTripleWithSingle != null) gs.allowTripleWithSingle = data.allowTripleWithSingle;
        if (data.allowTripleWithPair != null) gs.allowTripleWithPair = data.allowTripleWithPair;
        if (data.allowAirplaneWithWings != null) gs.allowAirplaneWithWings = data.allowAirplaneWithWings;
        if (data.bombAsRocket != null) gs.bombAsRocket = data.bombAsRocket;
        if (data.strictRules != null) gs.strictRules = data.strictRules;
        if (data.jokerRule != null) gs.jokerRule = data.jokerRule;
        if (data.bombRule != null) gs.bombRule = data.bombRule;
        if (data.allowSpring != null) gs.allowSpring = data.allowSpring;
        if (data.allowAntiSpring != null) gs.allowAntiSpring = data.allowAntiSpring;
        if (data.bombDoubles != null) gs.bombDoubles = data.bombDoubles;
        if (data.rocketDoubles != null) gs.rocketDoubles = data.rocketDoubles;

        // --- 牌局数据 ---
        if (data.bottomCards != null) {
            gs.bottomCards = this._deserializeDeck(data.bottomCards);
        }
        if (data.initialBottom != null) {
            gs.initialBottom = data.initialBottom;
        }
        if (data.initialHands != null) {
            gs.initialHands = data.initialHands;
        }

        if (data.lastPlay != null) {
            const lp = data.lastPlay;
            const cards = this._deserializeDeck(lp.cards);
            gs.lastPlay = {
                playerIndex: lp.playerIndex ?? -1,
                cards,
                pattern: this._deserializePattern(lp.pattern, cards),
            };
        }

        if (Array.isArray(data.history)) {
            gs.history = data.history.map(h => {
                const cards = this._deserializeDeck(h.cards);
                return {
                    playerIndex: h.playerIndex,
                    cards,
                    pattern: this._deserializePattern(h.pattern, cards),
                    timestamp: h.timestamp,
                };
            });
        }

        // --- 玩家信息 ---
        if (data.players != null) {
            for (let i = 0; i < 3; i++) {
                const pd = data.players[i];
                if (!pd) continue;
                let player = gs.players[i];
                if (!player) {
                    player = new Player(pd.name || `玩家${i + 1}`, false);
                    gs.setPlayer(i, player);
                }
                if (pd.name != null) player.name = pd.name;
                if (pd.isAuto != null && i !== this.humanIndex) player.isAuto = pd.isAuto;
                if (pd.isReady != null) player.isReady = pd.isReady;
                if (pd.isLandlord != null) player.isLandlord = pd.isLandlord;
                // 非本人：只同步手牌数量（用占位牌填充）
                if (gs.showCards && Array.isArray(pd.hand) && i !== this.humanIndex) {
                    player.setHand(this._deserializeDeck(pd.hand));
                } else if (pd.handCount != null && i !== this.humanIndex) {
                    const diff = pd.handCount - player.hand.length;
                    if (diff > 0) {
                        for (let j = 0; j < diff; j++) player.hand.push(new Card(SUITS.SPADE, '3'));
                        player.hand = Card.sortByValue(player.hand);
                    } else if (diff < 0) {
                        player.hand = player.hand.slice(0, pd.handCount);
                    }
                }
            }
        }

        // 同步自己的手牌（host 发给重连玩家时包含 ownHand）
        if (data.ownHand != null && this.humanIndex >= 0) {
            const player = gs.players[this.humanIndex];
            if (player) {
                player.setHand(this._deserializeDeck(data.ownHand));
            }
        }

        // 确保地主标记一致
        for (let i = 0; i < 3; i++) {
            if (gs.players[i]) {
                gs.players[i].isLandlord = i === gs.landlordIndex;
            }
        }

        if (this.renderer) {
            if (newRound) {
                this.renderer.resetRoundView();
                this.renderer._resetCardTracker();
                this.renderer.audio?.playDeal();
            }
            this.renderer.renderHands();
            if (gs.landlordIndex >= 0 && gs.landlordIndex !== oldLandlord) {
                this.renderer.showLandlord({ landlordIndex: gs.landlordIndex, bottomCards: gs.bottomCards });
            }
            for (const action of gs.history.slice(oldHistoryLength)) {
                if (action.pattern?.type === 'PASS') this.renderer.showPass(action.playerIndex);
                else this.renderer.animatePlay({ ...action, remaining: gs.players[action.playerIndex]?.hand.length });
            }
            this.renderer.highlightTurn(gs.currentTurn);
        }
        if (gs.phase !== oldPhase) gs.emit('phaseChange', { phase: gs.phase, currentTurn: gs.currentTurn });
        if (data.result && !this._lastResult) gs.emit('roundEnd', data.result);
        this._updateTurn();
    }

    _serializePattern(pattern) {
        if (!pattern) return null;
        return {
            type: pattern.type,
            mainValue: pattern.mainValue,
            length: pattern.length,
            hasLaizi: pattern.hasLaizi || false,
        };
    }

    _deserializePattern(patternData, cards) {
        if (!patternData) return null;
        return new HandPattern(
            patternData.type,
            cards,
            patternData.mainValue,
            patternData.length,
            patternData.hasLaizi || false,
        );
    }

    _sendStateSync(targetPeerId = null) {
        const gs = this.gameState;
        const syncData = {
            gameId: this._gameId,
            revision: ++this._syncRevision,
            result: this._lastResult,
            // 核心状态
            phase: gs.phase,
            currentTurn: gs.currentTurn,
            landlordIndex: gs.landlordIndex,
            passCount: gs.passCount,
            scores: [...gs.scores],
            playCounts: [...gs.playCounts],
            currentCall: gs.currentCall,
            currentCallPlayer: gs.currentCallPlayer,
            dealerIndex: gs.dealerIndex,
            grabMultiplier: gs.grabMultiplier,
            grabPhase: gs.grabPhase,
            hasCalled: [...gs.hasCalled],
            callRound: gs.callRound,
            laiziValue: gs.laiziValue,
            roundCount: gs.roundCount,
            // 游戏规则
            callMode: gs.callMode,
            laiziEnabled: gs.laiziEnabled,
            scoreMultiplier: gs.scoreMultiplier,
            baseScore: gs.baseScore,
            showCards: gs.showCards,
            exchangeThree: gs.exchangeThree,
            noShuffle: gs.noShuffle,
            bottomVisible: gs.bottomVisible,
            mustPlay: gs.mustPlay,
            allowPassOnFirst: gs.allowPassOnFirst,
            allowTripleWithSingle: gs.allowTripleWithSingle,
            allowTripleWithPair: gs.allowTripleWithPair,
            allowAirplaneWithWings: gs.allowAirplaneWithWings,
            bombAsRocket: gs.bombAsRocket,
            strictRules: gs.strictRules,
            jokerRule: gs.jokerRule,
            bombRule: gs.bombRule,
            allowSpring: gs.allowSpring,
            allowAntiSpring: gs.allowAntiSpring,
            bombDoubles: gs.bombDoubles,
            rocketDoubles: gs.rocketDoubles,
            // 牌局数据
            bottomCards: gs.landlordIndex >= 0 || gs.bottomVisible ? this._serializeDeck(gs.bottomCards) : [],
            ...(gs.phase === PHASE.ENDED ? { initialBottom: gs.initialBottom, initialHands: gs.initialHands } : {}),
            lastPlay: gs.lastPlay ? {
                playerIndex: gs.lastPlay.playerIndex,
                cards: this._serializeDeck(gs.lastPlay.cards),
                pattern: this._serializePattern(gs.lastPlay.pattern),
            } : null,
            history: gs.history.map(h => ({
                playerIndex: h.playerIndex,
                cards: this._serializeDeck(h.cards),
                pattern: this._serializePattern(h.pattern),
                timestamp: h.timestamp,
            })),
            // 仅明牌规则公开其他玩家的手牌
            players: gs.players.map((p, i) => p ? {
                name: p.name,
                seatIndex: i,
                handCount: p.hand.length,
                ...(gs.showCards ? { hand: this._serializeDeck(p.hand) } : {}),
                isLandlord: p.isLandlord,
                isAuto: p.isAuto,
                isReady: p.isReady,
            } : null),
        };

        if (targetPeerId) {
            const targetIdx = this._getPlayerIndexByPeerId(targetPeerId);
            if (targetIdx >= 0 && gs.players[targetIdx]) {
                syncData.ownHand = this._serializeDeck(gs.players[targetIdx].hand);
            }
            this._send({ type: 'game_state_sync', data: syncData, targetPeerId });
        } else {
            for (const [peerId, idx] of Object.entries(this.playerMapping)) {
                if (peerId === this.myPeerId || !gs.players[idx]) continue;
                this._send({ type: 'game_state_sync', data: { ...syncData, ownHand: this._serializeDeck(gs.players[idx].hand) }, targetPeerId: peerId });
            }
        }
    }

    _getPlayerIndexByPeerId(peerId) {
        return this.playerMapping[peerId] ?? -1;
    }

    _findPeerIdBySeat(seatIndex) {
        for (const [peerId, idx] of Object.entries(this.playerMapping)) {
            if (idx === seatIndex) return peerId;
        }
        return null;
    }

    showToast(message) {
        // 委托给 renderer 或 console
        if (this.renderer) {
            this.renderer.showToast(message);
        } else {
            console.log('[Toast]', message);
        }
    }
}

export { LANMode };

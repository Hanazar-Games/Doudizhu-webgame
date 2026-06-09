/**
 * LANMode - 局域网联机模式
 * 基于 WebSocket 的联机对战
 */

import { Card, SUITS, RANKS } from '../core/card.js';
import { Rules, HandPattern } from '../core/rules.js';
import { GameState, PHASE } from '../core/game-state.js';
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
    }

    destroy() {
        super.destroy();
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
    }

    async init() {
        this.humanIndex = -1;
        console.log('[LANMode] 初始化完成');
    }

    // ---- 房间管理 ----

    async createRoom() {
        this.isHost = true;
        this.humanIndex = 0;
        this.myPeerId = this._generatePeerId();
        
        this.gameState.setPlayer(0, new Player('房主', false));
        
        await this._connectWebSocket();
        this._send({ type: 'create_room', peerId: this.myPeerId });
        
        console.log('[LANMode] 创建房间，PeerID:', this.myPeerId);
        return this.myPeerId;
    }

    async joinRoom(hostPeerId) {
        this.isHost = false;
        this.hostPeerId = hostPeerId;
        this.myPeerId = this._generatePeerId();
        
        await this._connectWebSocket();
        this._send({ type: 'join_room', peerId: this.myPeerId, targetPeerId: hostPeerId });
        
        console.log('[LANMode] 加入房间:', hostPeerId);
    }

    _generatePeerId() {
        return 'ddz_' + Math.random().toString(36).substr(2, 9);
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
                        this.renderer?.showToast?.('收到异常网络消息，已忽略');
                    }
                };
                
                ws.onclose = () => {
                    console.warn('[LANMode] WebSocket断开');
                    this.networkReady = false;
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
            this.renderer?.showToast?.('连接已断开，请重新进入局域网联机');
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
                        this._send({ type: 'create_room', peerId: this.myPeerId });
                    } else if (this.hostPeerId) {
                        this._send({ type: 'join_room', peerId: this.myPeerId, targetPeerId: this.hostPeerId });
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
                if (!this.isHost) {
                    this.humanIndex = msg.seatIndex;
                    const p = new Player(this._desiredPlayerName || '玩家', false);
                    this.gameState.setPlayer(this.humanIndex, p);
                }
                if (msg.reconnected && this.isHost && this.gameState.phase !== 'IDLE') {
                    // 有玩家重连，host 发送完整状态同步
                    const peerId = msg.peerId || this._findPeerIdBySeat(msg.seatIndex);
                    if (peerId) this._sendStateSync(peerId);
                }
                if (msg.reconnected && !this.isHost) {
                    this.renderer?.showToast?.('重连成功，正在同步游戏状态...');
                    // 非 host 重连后请求状态同步（server 已代发，但双重保险）
                    if (this.hostPeerId) {
                        this._send({ type: 'request_state_sync', targetPeerId: this.hostPeerId });
                    }
                }
                break;
            case 'game_start':
                // 房主已经在本地启动了游戏，忽略网络回传的广播
                if (!this.isHost) {
                    this._syncGameStart(msg.data);
                }
                break;
            case 'game_starting':
                if (!this.isHost) {
                    this.renderer?.showToast?.('游戏即将开始...');
                }
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
                this.renderer?.showToast?.(`玩家 ${msg.peerId} 已离开`);
                break;
            case 'room_closed':
                this.renderer?.showToast?.('房间已关闭: ' + (msg.reason || ''));
                break;
            case 'chat':
                if (this.renderer) {
                    this.renderer.receiveChat(msg);
                }
                break;
            case 'error':
                console.error('[LANMode]', msg.message);
                this.renderer?.showToast?.('错误: ' + msg.message);
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
        // 非 Host 构建 playerMapping
        if (!this.isHost) {
            for (const p of players) {
                if (p.peerId != null && p.seatIndex != null) {
                    this.playerMapping[p.peerId] = p.seatIndex;
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
        if (!this.isHost) {
            this.renderer?.showToast?.('只有房主可以开始游戏');
            return;
        }

        const playerCount = this.gameState.players.filter(p => p !== null).length;
        if (playerCount < 3) {
            alert('需要3人才能开始游戏');
            return;
        }

        // 应用游戏规则（与 BaseMode 保持一致）
        this._applyGameRules();

        let deck = Card.createDeck();
        if (!this.gameState.noShuffle) {
            deck = Card.shuffle(deck);
        }
        const bottom = deck.slice(51, 54);
        
        const gameData = {
            deck: this._serializeDeck(deck.slice(0, 51)),
            bottomCards: this._serializeDeck(bottom),
            dealerIndex: this.gameState.dealerIndex,
        };
        
        this._send({ type: 'game_start', data: gameData, broadcast: true });
        this._syncGameStart(gameData);
    }

    _syncGameStart(data) {
        if (!this.renderer) {
            window.gameApp?._enterLANGameFromNetwork?.(this);
        }
        // 确保所有位置都有 Player 对象（非 host 客户端可能只设置了自己）
        for (let i = 0; i < 3; i++) {
            if (!this.gameState.players[i]) {
                this.gameState.setPlayer(i, new Player(`玩家${i + 1}`, false));
            }
        }
        // 非 host 客户端也需要应用本地规则设置
        this._applyGameRules();
        const deck = this._deserializeDeck(data.deck);
        const bottom = this._deserializeDeck(data.bottomCards);
        this.gameState.dealerIndex = data.dealerIndex;
        const ok = this.gameState.startRound(deck, bottom);
        if (!ok) {
            this.renderer?.showToast?.('牌局数据错误，请重新开局', 'error');
            this.isRunning = false;
            return;
        }
        this.isRunning = true;
        
        // 音效（BGM 由 BaseMode.onPhaseChange 统一调度）
        this.renderer?.audio?.playDeal();
        this._setTimer(() => this.renderer?.audio?.playNewRound(), 300);

        this._processCalling();
    }

    // 覆盖：人类操作后广播
    humanCall(action) {
        const result = super.humanCall(action);
        if (result) {
            this._send({
                type: 'player_action',
                action: 'call',
                playerIndex: this.humanIndex,
                value: action,
                broadcast: true,
            });
            // Host 在 action 后广播完整状态同步，确保所有客户端状态一致
            if (this.isHost) {
                this._sendStateSync();
            }
        }
        return result;
    }

    humanPlay(selectedCards) {
        const result = super.humanPlay(selectedCards);
        if (result.success) {
            this._send({
                type: 'player_action',
                action: 'play',
                playerIndex: this.humanIndex,
                cards: this._serializeDeck(selectedCards),
                broadcast: true,
            });
            // Host 在 action 后广播完整状态同步
            if (this.isHost) {
                this._sendStateSync();
            }
        }
        return result;
    }

    humanPass() {
        const result = super.humanPass();
        if (result) {
            this._send({
                type: 'player_action',
                action: 'pass',
                playerIndex: this.humanIndex,
                broadcast: true,
            });
            // Host 在 action 后广播完整状态同步
            if (this.isHost) {
                this._sendStateSync();
            }
        }
        return result;
    }

    _handleRemoteAction(msg) {
        const idx = msg.playerIndex;
        if (idx === this.humanIndex) return;
        
        if (msg.action === 'call') {
            const success = this.gameState.callLandlord(idx, msg.value);
            if (success && this.gameState.phase === PHASE.CALLING) {
                this._processCalling();
            } else if (!success && !this.isHost) {
                // 状态不同步，请求 host 发送完整状态
                console.warn('[LANMode] callLandlord 远程失败，请求状态同步');
                this._requestStateSync();
            }
        } else if (msg.action === 'play') {
            const cards = this._deserializeDeck(msg.cards);
            const pattern = Rules.analyze(cards);
            const result = this.gameState.playCards(idx, cards, pattern);
            if (result.success && !result.win && this.gameState.phase === PHASE.PLAYING) {
                this._processPlay();
            } else if (!result.success) {
                // playCards 失败（通常为手牌不同步），请求完整状态同步
                console.warn('[LANMode] playCards 远程失败，请求状态同步:', result.error);
                this._requestStateSync();
            }
        } else if (msg.action === 'pass') {
            const success = this.gameState.pass(idx);
            if (success && this.gameState.phase === PHASE.PLAYING) {
                this._processPlay();
            } else if (!success && !this.isHost) {
                console.warn('[LANMode] pass 远程失败，请求状态同步');
                this._requestStateSync();
            }
        }
    }

    _requestStateSync() {
        if (this.isHost) return;
        if (this.hostPeerId) {
            this._send({ type: 'request_state_sync', targetPeerId: this.hostPeerId });
        }
    }

    _fallbackRemotePlay(idx, cards, pattern) {
        const gs = this.gameState;
        const player = gs.players[idx];
        if (!player) return;
        // 确保手牌足够（填充临时牌）
        while (player.hand.length < cards.length) {
            player.hand.push(new Card(null, '3'));
        }
        player.removeCards(cards);
        gs.lastPlay = { playerIndex: idx, cards, pattern };
        gs.passCount = 0;
        gs.playCounts[idx]++;
        gs.history.push({ playerIndex: idx, cards, pattern, timestamp: Date.now() });
        gs.emit('playerPlay', { playerIndex: idx, cards, pattern, remaining: player.hand.length });
        if (player.hand.length === 0) {
            gs._settleRound(idx);
        } else {
            gs.currentTurn = (idx + 1) % 3;
            gs.emit('turnChange', { currentTurn: gs.currentTurn });
            if (gs.phase === PHASE.PLAYING) {
                this._processPlay();
            }
        }
    }

    // ---- 序列化工具 ----

    _serializeDeck(cards) {
        return cards.map(c => ({
            s: c.suit?.name || null,
            r: c.rankKey
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
            return new Card(suit, d.r);
        }).filter(Boolean);
    }

    _applySync(data) {
        if (!data) return;
        const gs = this.gameState;

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

        if (data.history != null) {
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
                if (pd.isAuto != null) player.isAuto = pd.isAuto;
                if (pd.isReady != null) player.isReady = pd.isReady;
                if (pd.isLandlord != null) player.isLandlord = pd.isLandlord;
                // 非本人：只同步手牌数量（用占位牌填充）
                if (pd.handCount != null && i !== this.humanIndex) {
                    const diff = pd.handCount - player.hand.length;
                    if (diff > 0) {
                        for (let j = 0; j < diff; j++) player.hand.push(new Card(null, '3'));
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

        // 触发渲染更新
        if (this.renderer) {
            this.renderer.renderHands();
            this.renderer.highlightTurn(gs.currentTurn);
            if (gs.lastPlay?.cards?.length > 0) {
                this.renderer.animatePlay(gs.lastPlay);
            }
        }
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
            bottomCards: this._serializeDeck(gs.bottomCards),
            initialBottom: gs.initialBottom,
            initialHands: gs.initialHands,
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
            // 玩家信息（不含手牌内容，只含数量和属性）
            players: gs.players.map((p, i) => p ? {
                name: p.name,
                seatIndex: i,
                handCount: p.hand.length,
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
            this._send({ type: 'game_state_sync', data: syncData, broadcast: true });
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

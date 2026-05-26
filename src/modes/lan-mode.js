/**
 * LANMode - 局域网联机模式
 * 基于 WebSocket 的联机对战
 */

import { Card, SUITS } from '../core/card.js';
import { Rules } from '../core/rules.js';
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
                        this.showToast('收到异常网络消息，已忽略');
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
            this.showToast('连接已断开，请重新进入局域网联机');
            return;
        }
        this._reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.myPeerId && this.isRunning) {
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
                break;
            case 'game_start':
                // 房主已经在本地启动了游戏，忽略网络回传的广播
                if (!this.isHost) {
                    this._syncGameStart(msg.data);
                }
                break;
            case 'game_starting':
                if (!this.isHost) {
                    this.showToast('游戏即将开始...');
                }
                break;
            case 'game_state_sync':
                this._applySync(msg.data);
                break;
            case 'player_action':
                this._handleRemoteAction(msg);
                break;
            case 'player_left':
                this.showToast(`玩家 ${msg.peerId} 已离开`);
                break;
            case 'room_closed':
                this.showToast('房间已关闭: ' + (msg.reason || ''));
                break;
            case 'chat':
                if (this.renderer) {
                    this.renderer.receiveChat(msg);
                }
                break;
            case 'error':
                console.error('[LANMode]', msg.message);
                this.showToast('错误: ' + msg.message);
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
            this.showToast('只有房主可以开始游戏');
            return;
        }

        const playerCount = this.gameState.players.filter(p => p !== null).length;
        if (playerCount < 3) {
            alert('需要3人才能开始游戏');
            return;
        }

        const deck = Card.shuffle(Card.createDeck());
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
        const deck = this._deserializeDeck(data.deck);
        const bottom = this._deserializeDeck(data.bottomCards);
        this.gameState.dealerIndex = data.dealerIndex;
        this.gameState.startRound(deck, bottom);
        this.isRunning = true;
        
        // 音效 + BGM
        this.renderer?.audio?.playDeal();
        setTimeout(() => this.renderer?.audio?.playNewRound(), 300);
        this.renderer?.audio?.stopBGM();
        setTimeout(() => this.renderer?.audio?.playGameBGM(), 1500);
        
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
            }
        } else if (msg.action === 'play') {
            const cards = this._deserializeDeck(msg.cards);
            const pattern = Rules.analyze(cards);
            const result = this.gameState.playCards(idx, cards, pattern);
            if (result.success && !result.win && this.gameState.phase === PHASE.PLAYING) {
                this._processPlay();
            }
        } else if (msg.action === 'pass') {
            const success = this.gameState.pass(idx);
            if (success && this.gameState.phase === PHASE.PLAYING) {
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
            if (!d || !d.r) return null;
            return new Card(d.s ? SUITS[d.s.toUpperCase()] : null, d.r);
        }).filter(Boolean);
    }

    _applySync(data) {
        console.warn('[LANMode] 收到状态同步，尚未实现完整处理:', data);
        // TODO: merge remote state into local gameState
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

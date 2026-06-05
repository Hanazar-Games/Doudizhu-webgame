/**
 * RoomManager - 游戏房间管理器
 * 管理房间生命周期、玩家连接、消息广播、自动清理、断线重连
 */

import { WebSocket } from 'ws';

class RoomManager {
    constructor() {
        this.rooms = new Map(); // roomId -> Room
        this.playerToRoom = new Map(); // ws -> roomId
        
        // 自动清理：每5分钟清理一次长时间未开始的房间
        this.cleanupInterval = setInterval(() => this._cleanupStaleRooms(), 5 * 60 * 1000);
    }

    createRoom(hostWs, hostPeerId) {
        // 如果该 hostPeerId 已有房间，视为重连
        const existingRoom = this.rooms.get(hostPeerId);
        if (existingRoom) {
            existingRoom.hostWs = hostWs;
            const hostPlayer = existingRoom.players.get(hostPeerId);
            if (hostPlayer) {
                this.playerToRoom.delete(hostPlayer.ws);
                hostPlayer.ws = hostWs;
                hostPlayer.connected = true;
            }
            this.playerToRoom.set(hostWs, hostPeerId);
            // 取消可能存在的解散定时器
            if (existingRoom._hostLeaveTimer) {
                clearTimeout(existingRoom._hostLeaveTimer);
                existingRoom._hostLeaveTimer = null;
            }
            return existingRoom;
        }

        const roomId = hostPeerId;
        const room = {
            id: roomId,
            hostId: hostPeerId,
            hostWs,
            players: new Map(), // peerId -> { ws, peerId, seatIndex, name, connected }
            createdAt: Date.now(),
            gameStarted: false,
            lastActivity: Date.now(),
            _hostLeaveTimer: null,
        };
        room.players.set(hostPeerId, { ws: hostWs, peerId: hostPeerId, seatIndex: 0, name: '房主', connected: true });
        this.rooms.set(roomId, room);
        this.playerToRoom.set(hostWs, roomId);
        return room;
    }

    joinRoom(ws, roomId, peerId) {
        if (!ws || typeof ws.send !== 'function') return { success: false, error: 'Invalid connection' };
        const room = this.rooms.get(roomId);
        if (!room) return { success: false, error: '房间不存在' };

        const existingPlayer = room.players.get(peerId);

        // === 已开始房间 ===
        if (room.gameStarted) {
            if (existingPlayer) {
                // 原玩家重连
                const oldWs = existingPlayer.ws;
                this.playerToRoom.delete(oldWs);
                existingPlayer.ws = ws;
                existingPlayer.connected = true;
                this.playerToRoom.set(ws, roomId);
                room.lastActivity = Date.now();

                this.sendToPeer(ws, {
                    type: 'seat_assigned',
                    seatIndex: existingPlayer.seatIndex,
                    roomId,
                    playerCount: room.players.size,
                    reconnected: true,
                });

                const playerList = [...room.players.values()].map(p => ({
                    peerId: p.peerId,
                    name: p.name,
                    seatIndex: p.seatIndex,
                    connected: p.connected,
                }));
                this.broadcastToRoom(room, { type: 'player_list_update', players: playerList });

                // 请求 host 发送状态同步
                this.sendToPeer(room.hostWs, {
                    type: 'request_state_sync',
                    targetPeerId: room.hostId,
                    peerId,
                });

                return { success: true, room, seatIndex: existingPlayer.seatIndex, reconnected: true };
            }
            return { success: false, error: '游戏已开始' };
        }

        // === 未开始房间 ===
        if (existingPlayer) {
            // 同一 peerId 再次加入：检查旧连接是否还活着
            if (existingPlayer.connected && existingPlayer.ws && existingPlayer.ws.readyState === WebSocket.OPEN) {
                return { success: false, error: 'Peer ID already in room' };
            }
            // 旧连接已断开，替换 ws（重连）
            const oldWs = existingPlayer.ws;
            this.playerToRoom.delete(oldWs);
            existingPlayer.ws = ws;
            existingPlayer.connected = true;
            this.playerToRoom.set(ws, roomId);
            room.lastActivity = Date.now();

            this.sendToPeer(ws, {
                type: 'seat_assigned',
                seatIndex: existingPlayer.seatIndex,
                roomId,
                playerCount: room.players.size,
                reconnected: true,
            });

            const playerList = [...room.players.values()].map(p => ({
                peerId: p.peerId,
                name: p.name,
                seatIndex: p.seatIndex,
            }));
            this.broadcastToRoom(room, { type: 'player_list_update', players: playerList });

            return { success: true, room, seatIndex: existingPlayer.seatIndex, reconnected: true };
        }

        if (room.players.size >= 3) return { success: false, error: '房间已满' };

        // 防止一个 ws 同时在多个房间
        this.leaveRoom(ws);

        // 分配座位
        const usedSeats = new Set([...room.players.values()].map(p => p.seatIndex));
        let seatIndex = 1;
        while (usedSeats.has(seatIndex)) seatIndex++;

        const player = { ws, peerId, seatIndex, name: `玩家${seatIndex + 1}`, connected: true };
        room.players.set(peerId, player);
        this.playerToRoom.set(ws, roomId);
        room.lastActivity = Date.now();

        // 通知房主
        this.sendToPeer(room.hostWs, {
            type: 'player_joined',
            peerId,
            seatIndex,
            name: player.name,
            playerCount: room.players.size,
        });

        // 通知新玩家
        this.sendToPeer(ws, {
            type: 'seat_assigned',
            seatIndex,
            roomId,
            playerCount: room.players.size,
        });

        // 广播玩家列表
        const playerList = [...room.players.values()].map(p => ({
            peerId: p.peerId,
            name: p.name,
            seatIndex: p.seatIndex,
        }));
        this.broadcastToRoom(room, { type: 'player_list_update', players: playerList }, peerId);
        this.sendToPeer(ws, { type: 'player_list_update', players: playerList });

        return { success: true, room, seatIndex };
    }

    leaveRoom(ws) {
        const roomId = this.playerToRoom.get(ws);
        if (!roomId) return;

        const room = this.rooms.get(roomId);
        if (!room) return;

        // 找到离开的玩家
        let leavingPeerId = null;
        let leavingPlayer = null;
        for (const [pid, p] of room.players) {
            if (p.ws === ws) {
                leavingPeerId = pid;
                leavingPlayer = p;
                break;
            }
        }

        if (leavingPeerId) {
            if (room.gameStarted) {
                // 已开始游戏：标记离线，不删除
                leavingPlayer.connected = false;
                this.broadcastToRoom(room, {
                    type: 'player_left',
                    peerId: leavingPeerId,
                    name: leavingPlayer?.name,
                    playerCount: room.players.size,
                    disconnected: true,
                });

                // host 离线：设置延迟解散定时器（30秒）
                if (leavingPeerId === room.hostId) {
                    room._hostLeaveTimer = setTimeout(() => {
                        if (this.rooms.has(roomId)) {
                            this.broadcastToRoom(room, { type: 'room_closed', reason: '房主已离开' });
                            this._destroyRoom(roomId);
                        }
                    }, 30000);
                }

                // 如果所有玩家都离线，立即销毁
                const allOffline = [...room.players.values()].every(p => !p.connected);
                if (allOffline) {
                    if (room._hostLeaveTimer) {
                        clearTimeout(room._hostLeaveTimer);
                        room._hostLeaveTimer = null;
                    }
                    this._destroyRoom(roomId);
                }
            } else {
                // 未开始游戏：直接删除玩家
                room.players.delete(leavingPeerId);
                if (leavingPeerId === room.hostId) {
                    this.broadcastToRoom(room, { type: 'room_closed', reason: '房主已离开' });
                    this._destroyRoom(roomId);
                } else {
                    this.broadcastToRoom(room, {
                        type: 'player_left',
                        peerId: leavingPeerId,
                        name: leavingPlayer?.name,
                        playerCount: room.players.size,
                    });
                    if (room.players.size > 0) {
                        const playerList = [...room.players.values()].map(p => ({
                            peerId: p.peerId,
                            name: p.name,
                            seatIndex: p.seatIndex,
                        }));
                        this.broadcastToRoom(room, { type: 'player_list_update', players: playerList });
                    }
                    if (room.players.size === 0) {
                        this._destroyRoom(roomId);
                    }
                }
            }
        }

        this.playerToRoom.delete(ws);
    }

    _destroyRoom(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return;
        
        if (room._hostLeaveTimer) {
            clearTimeout(room._hostLeaveTimer);
            room._hostLeaveTimer = null;
        }
        
        // 关闭剩余玩家的 socket（只关闭仍属于该房间的连接）
        for (const [pid, p] of room.players) {
            try {
                // 只关闭确认属于此房间的 ws，避免误关已重连的新连接
                if (p.ws && p.ws.readyState === WebSocket.OPEN && this.playerToRoom.get(p.ws) === roomId) {
                    p.ws.close();
                }
            } catch (e) {}
            this.playerToRoom.delete(p.ws);
        }
        this.rooms.delete(roomId);
        console.log(`[Room ${roomId}] destroyed`);
    }

    _cleanupStaleRooms() {
        const now = Date.now();
        const staleThreshold = 30 * 60 * 1000; // 30分钟
        
        for (const [roomId, room] of this.rooms) {
            if (!room.gameStarted && (now - room.lastActivity > staleThreshold)) {
                this.broadcastToRoom(room, { 
                    type: 'room_closed', 
                    reason: '房间长时间未开始，已自动关闭' 
                });
                this._destroyRoom(roomId);
            }
        }
    }

    getRoomList() {
        return [...this.rooms.values()]
            .filter(r => !r.gameStarted && r.players.size < 3)
            .map(r => ({
                roomId: r.id,
                hostId: r.hostId,
                playerCount: r.players.size,
                createdAt: r.createdAt,
            }));
    }

    broadcastToRoom(room, msg, excludePeerId = null) {
        let data;
        try {
            data = JSON.stringify(msg);
        } catch (e) {
            console.error('[RoomManager] JSON stringify error:', e);
            return;
        }
        for (const [pid, p] of room.players) {
            if (pid === excludePeerId) continue;
            if (!p.connected) continue; // 跳过离线玩家
            if (p.ws && p.ws.readyState === WebSocket.OPEN) {
                try {
                    p.ws.send(data);
                } catch (e) {
                    console.error('[RoomManager] Send error:', e.message);
                }
            }
        }
    }

    sendToPeer(ws, msg) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try {
            ws.send(JSON.stringify(msg));
        } catch (e) {
            console.error('[RoomManager] Send error:', e.message);
        }
    }

    relayMessage(ws, msg) {
        const roomId = this.playerToRoom.get(ws);
        if (!roomId) return;
        const room = this.rooms.get(roomId);
        if (!room) return;

        room.lastActivity = Date.now();

        try {
            if (msg.targetPeerId) {
                const target = room.players.get(msg.targetPeerId);
                if (target && target.connected && target.ws && target.ws.readyState === WebSocket.OPEN) {
                    this.sendToPeer(target.ws, msg);
                }
            } else if (msg.broadcast) {
                const senderPeerId = this._getPeerIdByWs(room, ws);
                this.broadcastToRoom(room, msg, senderPeerId);
            } else {
                // 默认点对点，排除发送者（防止回声）
                const senderPeerId = this._getPeerIdByWs(room, ws);
                this.broadcastToRoom(room, msg, senderPeerId);
            }
        } catch (e) {
            console.error('[RoomManager] Relay error:', e);
        }
    }

    _getPeerIdByWs(room, ws) {
        for (const [pid, p] of room.players) {
            if (p.ws === ws) return pid;
        }
        return null;
    }

    startGame(roomId) {
        const room = this.rooms.get(roomId);
        if (room) {
            room.gameStarted = true;
            room.lastActivity = Date.now();
        }
    }

    destroy() {
        clearInterval(this.cleanupInterval);
        for (const [roomId] of this.rooms) {
            this._destroyRoom(roomId);
        }
        this.playerToRoom.clear();
    }
}

export { RoomManager };

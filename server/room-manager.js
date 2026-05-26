/**
 * RoomManager - 游戏房间管理器
 * 管理房间生命周期、玩家连接、消息广播、自动清理
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
        const roomId = hostPeerId;
        const room = {
            id: roomId,
            hostId: hostPeerId,
            hostWs,
            players: new Map(), // peerId -> { ws, peerId, seatIndex, name }
            createdAt: Date.now(),
            gameStarted: false,
            lastActivity: Date.now(),
        };
        room.players.set(hostPeerId, { ws: hostWs, peerId: hostPeerId, seatIndex: 0, name: '房主' });
        this.rooms.set(roomId, room);
        this.playerToRoom.set(hostWs, roomId);
        return room;
    }

    joinRoom(ws, roomId, peerId) {
        if (!ws || typeof ws.send !== 'function') return { success: false, error: 'Invalid connection' };
        const room = this.rooms.get(roomId);
        if (!room) return { success: false, error: '房间不存在' };
        if (room.gameStarted) return { success: false, error: '游戏已开始' };
        if (room.players.size >= 3) return { success: false, error: '房间已满' };
        if (room.players.has(peerId)) return { success: false, error: 'Peer ID already in room' };
        // 防止一个 ws 同时在多个房间
        this.leaveRoom(ws);

        // 分配座位
        const usedSeats = new Set([...room.players.values()].map(p => p.seatIndex));
        let seatIndex = 1;
        while (usedSeats.has(seatIndex)) seatIndex++;

        const player = { ws, peerId, seatIndex, name: `玩家${seatIndex + 1}` };
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

        // 通知新玩家座位信息
        this.sendToPeer(ws, {
            type: 'seat_assigned',
            seatIndex,
            roomId,
            playerCount: room.players.size,
        });

        // 广播玩家列表更新给所有已有玩家
        const playerList = [...room.players.values()].map(p => ({ peerId: p.peerId, name: p.name, seatIndex: p.seatIndex }));
        this.broadcastToRoom(room, {
            type: 'player_list_update',
            players: playerList,
        }, peerId);

        // 单独给新玩家发送完整玩家列表（包含自己）
        this.sendToPeer(ws, {
            type: 'player_list_update',
            players: playerList,
        });

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
            room.players.delete(leavingPeerId);
            
            // 如果房主离开，解散房间
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
                // 广播更新后的玩家列表
                if (room.players.size > 0) {
                    this.broadcastToRoom(room, {
                        type: 'player_list_update',
                        players: [...room.players.values()].map(p => ({ peerId: p.peerId, name: p.name, seatIndex: p.seatIndex })),
                    });
                }
                if (room.players.size === 0) {
                    this._destroyRoom(roomId);
                }
            }
        }

        this.playerToRoom.delete(ws);
    }

    _destroyRoom(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return;
        
        // 关闭剩余玩家的 socket
        for (const [pid, p] of room.players) {
            try {
                if (p.ws && p.ws.readyState === WebSocket.OPEN) {
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
                if (target) {
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

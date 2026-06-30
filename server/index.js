#!/usr/bin/env node
/**
 * Doudizhu Game Server
 * Express HTTP + WebSocket 服务器
 * 
 * 启动方式:
 *   npm run server      (生产模式)
 *   npm run server:dev  (开发模式)
 *   npm run dev         (同时启动前端vite + 后端)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const express = require('express');
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { networkInterfaces } from 'os';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { RoomManager } from './room-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev');
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 65536 });
const roomManager = new RoomManager();

// ---- 中间件 ----

app.use(express.json());

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// 请求日志
app.use((req, res, next) => {
    const now = new Date().toISOString();
    console.log(`[${now}] ${req.method} ${req.url}`);
    next();
});

// ---- HTTP API ----

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        rooms: roomManager.rooms.size, 
        mode: isDev ? 'dev' : 'prod',
        uptime: process.uptime(),
    });
});

app.get('/api/lan-info', (req, res) => {
    res.json({
        port: Number(PORT),
        host: HOST,
        urls: getLanUrls(),
        wsPath: '/ws',
        mode: isDev ? 'dev' : 'prod',
    });
});

app.get('/api/rooms', (req, res) => {
    res.json({ rooms: roomManager.getRoomList() });
});

// 生产模式：服务静态文件
if (!isDev) {
    const distDir = resolve(__dirname, '../dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/') || req.path.includes('.')) {
            return next();
        }
        res.sendFile(resolve(distDir, 'index.html'));
    });
}

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// 错误处理
app.use((err, req, res, next) => {
    console.error('[HTTP Error]', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ---- WebSocket ----

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[WS] Client connected from ${clientIp}, total clients: ${wss.clients.size}`);

    // 心跳
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch (err) {
            console.warn('[WS] Invalid JSON:', err.message);
            roomManager.sendToPeer(ws, { type: 'error', message: 'Invalid JSON' });
            return;
        }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
            roomManager.sendToPeer(ws, { type: 'error', message: 'Message must be an object' });
            return;
        }
        if (typeof msg.type !== 'string') {
            roomManager.sendToPeer(ws, { type: 'error', message: 'Missing or invalid message type' });
            return;
        }
        try {
            handleMessage(ws, msg);
        } catch (err) {
            console.error('[WS] Message handler error:', err);
            roomManager.sendToPeer(ws, { type: 'error', message: 'Internal error' });
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`[WS] Client disconnected (code=${code}, reason=${reason}), remaining: ${wss.clients.size}`);
        roomManager.leaveRoom(ws);
    });

    ws.on('error', (err) => {
        console.error('[WS] Error:', err.message);
    });
});

// WebSocket 心跳检测
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        try {
            if (ws.isAlive === false) {
                console.log('[WS] Terminating inactive connection');
                roomManager.leaveRoom(ws);
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        } catch (e) {
            console.error('[WS] Heartbeat error:', e.message);
        }
    });
}, 30000);

function handleMessage(ws, msg) {
    const type = msg.type;

    switch (type) {
        case 'create_room': {
            // 先离开当前房间，防止一个 ws 在多个房间
            roomManager.leaveRoom(ws);
            const peerId = msg.peerId || generatePeerId();
            const room = roomManager.createRoom(ws, peerId);
            roomManager.sendToPeer(ws, {
                type: 'room_created',
                roomId: room.id,
                peerId,
                playerCount: room.players.size,
            });
            console.log(`[Room ${room.id}] created by ${peerId}`);
            break;
        }

        case 'join_room': {
            const roomId = msg.targetPeerId || msg.roomId;
            const peerId = msg.peerId || generatePeerId();
            if (!roomId) {
                roomManager.sendToPeer(ws, { type: 'error', message: 'Room ID is required' });
                return;
            }
            const result = roomManager.joinRoom(ws, roomId, peerId);
            if (!result.success) {
                roomManager.sendToPeer(ws, { type: 'error', message: result.error });
            } else {
                console.log(`[Room ${roomId}] ${peerId} joined, seat=${result.seatIndex}, total=${result.room.players.size}`);
            }
            break;
        }

        // ---- 两阶段游戏启动协议 ----
        //
        // Phase 1: start_game — 房主请求开始，server 验证后广播 game_starting（预通知）。
        //   当前客户端未使用此消息，保留供测试或未来扩展（如加载画面同步）。
        //
        // Phase 2: game_start — 房主生成牌局后发送，携带 deck/bottomCards/dealerIndex。
        //   server 验证并 relay 给其他玩家（排除房主），其他玩家收到后进入 _syncGameStart。
        //   房主本地直接调用 _syncGameStart，不依赖网络回传。
        //
        // 两阶段互不依赖；当前生产客户端只发送 Phase 2。

        case 'start_game': {
            const roomId = roomManager.playerToRoom.get(ws);
            if (!roomId) {
                roomManager.sendToPeer(ws, { type: 'error', message: 'Not in a room' });
                return;
            }
            const room = roomManager.rooms.get(roomId);
            if (!room) return;
            if (room.hostId !== roomManager._getPeerIdByWs(room, ws)) {
                roomManager.sendToPeer(ws, { type: 'error', message: 'Only host can start' });
                return;
            }
            if (room.players.size !== 3) {
                roomManager.sendToPeer(ws, { type: 'error', message: 'Need exactly 3 players' });
                return;
            }
            if (room.gameStarted) {
                roomManager.sendToPeer(ws, { type: 'error', message: 'Game already started' });
                return;
            }
            roomManager.startGame(roomId);
            roomManager.broadcastToRoom(room, {
                type: 'game_starting',
                roomId,
                playerCount: room.players.size,
            });
            console.log(`[Room ${roomId}] game started`);
            break;
        }

        case 'game_start': {
            // Phase 2: 房主发送牌局数据，server 验证后 relay 给其他玩家
            const roomId2 = roomManager.playerToRoom.get(ws);
            if (!roomId2) {
                roomManager.sendToPeer(ws, { type: 'error', message: 'Not in a room' });
                break;
            }
            const room2 = roomManager.rooms.get(roomId2);
            if (!room2) {
                roomManager.sendToPeer(ws, { type: 'error', message: 'Room not found' });
                break;
            }
            const senderPeerId = roomManager._getPeerIdByWs(room2, ws);
            if (senderPeerId !== room2.hostId) {
                roomManager.sendToPeer(ws, { type: 'error', message: 'Only host can start game' });
                break;
            }
            if (room2.players.size !== 3) {
                roomManager.sendToPeer(ws, { type: 'error', message: 'Need exactly 3 players' });
                break;
            }
            if (room2.gameStarted) {
                roomManager.sendToPeer(ws, { type: 'error', message: 'Game already started' });
                break;
            }
            roomManager.startGame(roomId2);
            roomManager.relayMessage(ws, msg);
            break;
        }

        case 'player_action':
        case 'game_state_sync':
        case 'request_state_sync':
        case 'chat': {
            roomManager.relayMessage(ws, msg);
            break;
        }

        default: {
            roomManager.sendToPeer(ws, { type: 'error', message: 'Unknown message type: ' + type });
        }
    }
}

function generatePeerId() {
    return 'ddz_' + Math.random().toString(36).substr(2, 9);
}

// ---- 启动 ----

function getLanUrls() {
    const urls = [`http://localhost:${PORT}`];
    const nets = networkInterfaces();
    for (const entries of Object.values(nets)) {
        for (const net of entries || []) {
            if (net.family !== 'IPv4' || net.internal) continue;
            urls.push(`http://${net.address}:${PORT}`);
        }
    }
    return [...new Set(urls)];
}

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Another server instance may be running.`);
        if (isDev) {
            console.error('   Tip: Run `lsof -ti:${PORT} | xargs kill` to free the port, or set PORT env variable.');
        }
        process.exit(1);
    } else {
        console.error('❌ Server error:', err);
        process.exit(1);
    }
});

server.listen(PORT, HOST, () => {
    console.log(`🃏 Doudizhu Server running on port ${PORT}`);
    console.log(`   HTTP API: http://localhost:${PORT}/api/health`);
    console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
    console.log('   LAN URLs:');
    for (const url of getLanUrls()) {
        console.log(`     ${url}`);
    }
    console.log(`   Mode: ${isDev ? 'development' : 'production'}`);
});

// 优雅关闭
function gracefulShutdown(signal) {
    console.log(`${signal} received, shutting down...`);
    clearInterval(heartbeatInterval);
    // 终止所有活跃 WebSocket 连接
    wss.clients.forEach(ws => {
        try { ws.terminate(); } catch (e) {}
    });
    roomManager.destroy();
    wss.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

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

import express from 'express';
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
const wss = new WebSocketServer({ server, path: '/ws' });
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
    app.use(express.static(resolve(__dirname, '../dist')));
    app.get('*', (req, res) => {
        res.sendFile(resolve(__dirname, '../dist/index.html'));
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
            const peerId = msg.peerId || generatePeerId();
            const room = roomManager.createRoom(ws, peerId);
            roomManager.sendToPeer(ws, {
                type: 'room_created',
                roomId: room.id,
                peerId,
                playerCount: 1,
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
            if (room.players.size < 3) {
                roomManager.sendToPeer(ws, { type: 'error', message: 'Need 3 players' });
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

        case 'player_action':
        case 'game_start':
        case 'game_state_sync':
        case 'chat': {
            roomManager.relayMessage(ws, msg);
            break;
        }

        default: {
            roomManager.relayMessage(ws, msg);
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
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    clearInterval(heartbeatInterval);
    wss.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('\nSIGINT received, shutting down...');
    clearInterval(heartbeatInterval);
    wss.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});

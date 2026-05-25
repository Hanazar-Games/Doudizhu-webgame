/**
 * LAN 三人联机流程验证脚本
 * 模拟：房主创建 → 玩家2加入 → 玩家3加入 → 房主开始 → 验证状态 → 退出
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:3001/ws';
const TIMEOUT = 5000;

function connect(peerId) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const messages = [];
        ws.on('open', () => resolve({ ws, messages, peerId }));
        ws.on('message', (data) => messages.push(JSON.parse(data)));
        ws.on('error', reject);
        ws.on('close', () => {});
    });
}

function send(ws, msg) {
    ws.send(JSON.stringify(msg));
}

function waitForMessage(client, type, timeout = TIMEOUT) {
    return new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
        const check = () => {
            const idx = client.messages.findIndex(m => m.type === type);
            if (idx >= 0) {
                clearTimeout(deadline);
                const msg = client.messages[idx];
                client.messages.splice(idx, 1);
                resolve(msg);
            } else {
                setTimeout(check, 50);
            }
        };
        check();
    });
}

async function fetchRooms() {
    const res = await fetch('http://localhost:3001/api/rooms');
    return res.json();
}

async function run() {
    console.log('=== LAN 三人联机流程测试 ===\n');
    let host, p2, p3;

    try {
        // Step 1: Host 创建房间
        console.log('[1/7] Host 连接并创建房间...');
        host = await connect('host_peer_001');
        send(host.ws, { type: 'create_room', peerId: host.peerId });
        const roomCreated = await waitForMessage(host, 'room_created');
        console.log(`    ✓ 房间创建成功: ${roomCreated.roomId}, 玩家数: ${roomCreated.playerCount}`);

        // Step 2: 玩家2加入
        console.log('[2/7] 玩家2加入房间...');
        p2 = await connect('player2_001');
        send(p2.ws, { type: 'join_room', peerId: p2.peerId, targetPeerId: host.peerId });
        const p2Seat = await waitForMessage(p2, 'seat_assigned');
        console.log(`    ✓ 玩家2座位分配: ${p2Seat.seatIndex}, 总玩家: ${p2Seat.playerCount}`);

        // Step 3: 玩家3加入
        console.log('[3/7] 玩家3加入房间...');
        p3 = await connect('player3_001');
        send(p3.ws, { type: 'join_room', peerId: p3.peerId, targetPeerId: host.peerId });
        const p3Seat = await waitForMessage(p3, 'seat_assigned');
        console.log(`    ✓ 玩家3座位分配: ${p3Seat.seatIndex}, 总玩家: ${p3Seat.playerCount}`);

        // Step 4: 验证玩家列表广播（收集所有 player_list_update，取最新的）
        console.log('[4/7] 验证玩家列表广播...');
        await new Promise(r => setTimeout(r, 300)); // 等待所有广播到达
        const getLatestList = (client) => {
            const lists = client.messages.filter(m => m.type === 'player_list_update');
            return lists.length > 0 ? lists[lists.length - 1] : null;
        };
        const hostList = getLatestList(host);
        const p2List = getLatestList(p2);
        const p3List = getLatestList(p3);
        console.log(`    Host 最新列表: ${hostList?.players?.length ?? 0} 人`);
        console.log(`    P2   最新列表: ${p2List?.players?.length ?? 0} 人`);
        console.log(`    P3   最新列表: ${p3List?.players?.length ?? 0} 人`);
        if (!hostList || hostList.players.length !== 3) throw new Error('Host 玩家列表不完整');
        if (!p2List || p2List.players.length !== 3) throw new Error('P2 玩家列表不完整');
        if (!p3List || p3List.players.length !== 3) throw new Error('P3 玩家列表不完整');
        console.log('    ✓ 三方均收到完整 3 人列表');

        // Step 5: Host 开始游戏
        console.log('[5/7] Host 开始游戏...');
        send(host.ws, { type: 'start_game' });
        const gameStarting = await waitForMessage(host, 'game_starting');
        console.log(`    ✓ 游戏开始广播: 房间 ${gameStarting.roomId}, ${gameStarting.playerCount} 人`);

        // Step 6: 验证房间不再出现在列表中
        console.log('[6/7] 验证房间已标记为游戏中（不应出现在 /api/rooms）...');
        await new Promise(r => setTimeout(r, 200));
        const rooms = await fetchRooms();
        const ourRoom = rooms.rooms.find(r => r.roomId === host.peerId);
        if (ourRoom) throw new Error('游戏已开始但房间仍出现在列表中');
        console.log('    ✓ 房间已不在可用列表中');

        // Step 7: 新玩家无法加入已开始的游戏
        console.log('[7/7] 验证新玩家无法加入已开始的房间...');
        const p4 = await connect('player4_001');
        send(p4.ws, { type: 'join_room', peerId: p4.peerId, targetPeerId: host.peerId });
        const joinError = await waitForMessage(p4, 'error');
        if (!joinError.message.includes('已开始')) throw new Error(`预期"游戏已开始"错误，收到: ${joinError.message}`);
        console.log(`    ✓ 新玩家被拒绝: ${joinError.message}`);
        p4.ws.close();

        console.log('\n=== 所有测试通过 ===');
        return true;
    } catch (err) {
        console.error('\n=== 测试失败 ===');
        console.error(err.message);
        return false;
    } finally {
        host?.ws?.close();
        p2?.ws?.close();
        p3?.ws?.close();
    }
}

run().then(ok => process.exit(ok ? 0 : 1));

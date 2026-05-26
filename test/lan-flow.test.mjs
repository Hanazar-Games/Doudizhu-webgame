/**
 * LAN 联机流程回归测试
 * 覆盖：创建房间、加入、玩家列表同步、权限校验、开始游戏、房间状态、退出
 *
 * 运行方式：
 *   独立：TEST_PORT=3001 node test/lan-flow.test.mjs
 *   自动：npm run test:lan（由 run-lan-test.mjs 启动临时 server）
 */

import { WebSocket } from 'ws';

const PORT = process.env.TEST_PORT || 3001;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const HTTP_URL = `http://127.0.0.1:${PORT}`;
const TIMEOUT = 8000;

let passed = 0;
let failed = 0;

function logPass(step, msg) {
    passed++;
    console.log(`  ✓ [${step}] ${msg}`);
}

function logFail(step, msg) {
    failed++;
    console.error(`  ✗ [${step}] ${msg}`);
}

function connect(peerId) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const messages = [];
        const handlers = [];

        ws.on('open', () => resolve({ ws, messages, peerId, handlers }));
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                messages.push(msg);
                handlers.forEach((h) => h(msg));
            } catch {
                messages.push({ type: 'raw', data: data.toString() });
            }
        });
        ws.on('error', reject);
        ws.on('close', () => {});
    });
}

function send(client, msg) {
    if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(msg));
    }
}

function waitForMessage(client, type, timeout = TIMEOUT) {
    return new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
        const check = () => {
            const idx = client.messages.findIndex((m) => m.type === type);
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

function drainMessages(client, type, waitMs = 300) {
    return new Promise((resolve) => {
        setTimeout(() => {
            const found = [];
            for (let i = client.messages.length - 1; i >= 0; i--) {
                if (client.messages[i].type === type) {
                    found.unshift(client.messages[i]);
                    client.messages.splice(i, 1);
                }
            }
            resolve(found);
        }, waitMs);
    });
}

async function fetchRooms() {
    const res = await fetch(`${HTTP_URL}/api/rooms`);
    return res.json();
}

async function fetchHealth() {
    const res = await fetch(`${HTTP_URL}/api/health`);
    return res.json();
}

async function runStep(stepName, fn) {
    try {
        await fn();
    } catch (err) {
        logFail(stepName, err.message);
        throw err;
    }
}

async function run() {
    console.log('=== LAN 联机流程回归测试 ===\n');
    console.log(`Server: ${HTTP_URL}  WS: ${WS_URL}\n`);

    // 先确认 server 健康
    try {
        const health = await fetchHealth();
        console.log(`Health: ${health.status} | rooms=${health.rooms} | mode=${health.mode}\n`);
    } catch {
        console.error('Server 未就绪，请确认 server 已启动或使用 npm run test:lan');
        process.exit(1);
    }

    let host, p2, p3;

    try {
        // ===== Step 1: Host 创建房间 =====
        await runStep('创建房间', async () => {
            host = await connect('host_peer_001');
            send(host, { type: 'create_room', peerId: host.peerId });
            const roomCreated = await waitForMessage(host, 'room_created');
            if (roomCreated.roomId !== host.peerId) throw new Error('roomId 不匹配');
            if (roomCreated.playerCount !== 1) throw new Error('创建后玩家数应为 1');
            logPass('创建房间', `房间创建成功: ${roomCreated.roomId}`);
        });

        // ===== Step 2: 玩家2加入 =====
        await runStep('P2 加入', async () => {
            p2 = await connect('player2_001');
            send(p2, { type: 'join_room', peerId: p2.peerId, targetPeerId: host.peerId });
            const p2Seat = await waitForMessage(p2, 'seat_assigned');
            if (p2Seat.seatIndex !== 1) throw new Error('P2 座位应为 1');
            if (p2Seat.playerCount !== 2) throw new Error('加入后玩家数应为 2');
            logPass('P2 加入', `座位=${p2Seat.seatIndex}, 总人数=${p2Seat.playerCount}`);
        });

        // ===== Step 3: 玩家3加入 =====
        await runStep('P3 加入', async () => {
            p3 = await connect('player3_001');
            send(p3, { type: 'join_room', peerId: p3.peerId, targetPeerId: host.peerId });
            const p3Seat = await waitForMessage(p3, 'seat_assigned');
            if (p3Seat.seatIndex !== 2) throw new Error('P3 座位应为 2');
            if (p3Seat.playerCount !== 3) throw new Error('加入后玩家数应为 3');
            logPass('P3 加入', `座位=${p3Seat.seatIndex}, 总人数=${p3Seat.playerCount}`);
        });

        // ===== Step 4: 三方收到完整 player_list_update =====
        await runStep('玩家列表同步', async () => {
            const hostLists = await drainMessages(host, 'player_list_update', 400);
            const p2Lists = await drainMessages(p2, 'player_list_update', 400);
            const p3Lists = await drainMessages(p3, 'player_list_update', 400);

            const latest = (lists) => (lists.length > 0 ? lists[lists.length - 1] : null);
            const h = latest(hostLists);
            const p2l = latest(p2Lists);
            const p3l = latest(p3Lists);

            if (!h || h.players.length !== 3) throw new Error(`Host 列表不完整: ${h?.players?.length}`);
            if (!p2l || p2l.players.length !== 3) throw new Error(`P2 列表不完整: ${p2l?.players?.length}`);
            if (!p3l || p3l.players.length !== 3) throw new Error(`P3 列表不完整: ${p3l?.players?.length}`);

            // 验证 seatIndex 唯一
            const seats = new Set(h.players.map((p) => p.seatIndex));
            if (seats.size !== 3) throw new Error('座位号不唯一');
            logPass('玩家列表同步', '三方均收到完整 3 人列表，座位唯一');
        });

        // ===== Step 5: 非 host 无法 start =====
        await runStep('非host无法开始', async () => {
            send(p2, { type: 'start_game' });
            const err = await waitForMessage(p2, 'error');
            if (!err.message.includes('Only host')) throw new Error(`预期权限错误，收到: ${err.message}`);
            logPass('非host无法开始', `P2 被拒绝: ${err.message}`);
        });

        // ===== Step 6: 不满 3 人无法 start =====
        await runStep('不满3人无法开始', async () => {
            // 用新 host 创建单人房间
            const soloHost = await connect('solo_host_001');
            send(soloHost, { type: 'create_room', peerId: soloHost.peerId });
            await waitForMessage(soloHost, 'room_created');
            send(soloHost, { type: 'start_game' });
            const err = await waitForMessage(soloHost, 'error');
            if (!err.message.includes('3 players')) throw new Error(`预期人数错误，收到: ${err.message}`);
            logPass('不满3人无法开始', `单人房间被拒绝: ${err.message}`);
            soloHost.ws.close();
        });

        // ===== Step 7: Host 开始游戏（Phase 1: start_game） =====
        await runStep('Host开始游戏', async () => {
            send(host, { type: 'start_game' });
            const gameStarting = await waitForMessage(host, 'game_starting');
            if (gameStarting.playerCount !== 3) throw new Error('开始广播人数应为 3');
            logPass('Host开始游戏', `game_starting 广播: ${gameStarting.playerCount} 人`);
        });

        // ===== Step 8: /api/rooms 不再显示该房间 =====
        await runStep('房间列表隐藏', async () => {
            const rooms = await fetchRooms();
            const ourRoom = rooms.rooms.find((r) => r.roomId === host.peerId);
            if (ourRoom) throw new Error('游戏已开始但房间仍出现在列表中');
            logPass('房间列表隐藏', '已开始房间不在 /api/rooms 中');
        });

        // ===== Step 9: P4 无法加入已开始房间 =====
        await runStep('P4无法加入已开始', async () => {
            const p4 = await connect('player4_001');
            send(p4, { type: 'join_room', peerId: p4.peerId, targetPeerId: host.peerId });
            const err = await waitForMessage(p4, 'error');
            if (!err.message.includes('已开始')) throw new Error(`预期"已开始"错误，收到: ${err.message}`);
            logPass('P4无法加入已开始', `被拒绝: ${err.message}`);
            p4.ws.close();
        });

        // ===== Step 10: 普通玩家退出后其他人收到通知 =====
        await runStep('普通玩家退出', async () => {
            // 用新房间测试（避免和已开始房间混用）
            const h2 = await connect('host2_001');
            const a2 = await connect('away2_001');
            send(h2, { type: 'create_room', peerId: h2.peerId });
            await waitForMessage(h2, 'room_created');
            send(a2, { type: 'join_room', peerId: a2.peerId, targetPeerId: h2.peerId });
            await waitForMessage(a2, 'seat_assigned');
            await drainMessages(h2, 'player_list_update', 200);

            a2.ws.close();
            const left = await waitForMessage(h2, 'player_left');
            if (left.peerId !== a2.peerId) throw new Error('player_left peerId 不匹配');
            const listAfter = await waitForMessage(h2, 'player_list_update');
            if (listAfter.players.length !== 1) throw new Error('退出后列表应为 1 人');
            logPass('普通玩家退出', `收到 player_left + 更新列表(${listAfter.players.length}人)`);
            h2.ws.close();
        });

        // ===== Step 11: Host 退出后 room_closed =====
        await runStep('Host退出解散', async () => {
            const h3 = await connect('host3_001');
            const a3 = await connect('away3_001');
            send(h3, { type: 'create_room', peerId: h3.peerId });
            await waitForMessage(h3, 'room_created');
            send(a3, { type: 'join_room', peerId: a3.peerId, targetPeerId: h3.peerId });
            await waitForMessage(a3, 'seat_assigned');

            h3.ws.close();
            const closed = await waitForMessage(a3, 'room_closed');
            if (!closed.reason.includes('房主')) throw new Error(`预期"房主已离开"，收到: ${closed.reason}`);
            logPass('Host退出解散', `收到 room_closed: ${closed.reason}`);
            a3.ws.close();
        });

        // ===== Step 12: game_start Phase 2 数据同步 =====
        await runStep('game_start数据同步', async () => {
            const h4 = await connect('host4_001');
            const p4a = await connect('p4a_001');
            const p4b = await connect('p4b_001');

            send(h4, { type: 'create_room', peerId: h4.peerId });
            await waitForMessage(h4, 'room_created');
            send(p4a, { type: 'join_room', peerId: p4a.peerId, targetPeerId: h4.peerId });
            await waitForMessage(p4a, 'seat_assigned');
            send(p4b, { type: 'join_room', peerId: p4b.peerId, targetPeerId: h4.peerId });
            await waitForMessage(p4b, 'seat_assigned');

            // Host 发送 game_start（携带数据）
            const gameData = {
                deck: [
                    { s: 'spade', r: '3' }, { s: 'heart', r: '4' },
                ],
                bottomCards: [{ s: null, r: 'JOKER_SMALL' }],
                dealerIndex: 0,
            };
            send(h4, { type: 'game_start', data: gameData, broadcast: true });

            // 其他玩家应收到 game_start（relay）
            const p4aMsg = await waitForMessage(p4a, 'game_start');
            const p4bMsg = await waitForMessage(p4b, 'game_start');
            if (!p4aMsg.data || !p4aMsg.data.deck) throw new Error('P4a 未收到牌局数据');
            if (!p4bMsg.data || !p4bMsg.data.deck) throw new Error('P4b 未收到牌局数据');
            logPass('game_start数据同步', '非 host 均收到带 deck 的 game_start');

            h4.ws.close();
            p4a.ws.close();
            p4b.ws.close();
        });

        console.log('\n====================');
        console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
        console.log('====================');
        return failed === 0;
    } catch (err) {
        console.error('\n====================');
        console.error(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
        console.error('====================');
        return false;
    } finally {
        host?.ws?.close();
        p2?.ws?.close();
        p3?.ws?.close();
    }
}

run().then((ok) => process.exit(ok ? 0 : 1));

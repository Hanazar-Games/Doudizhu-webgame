/**
 * LAN 模式状态同步单元测试
 * 运行: node test/lan-sync.test.mjs
 */

// Mock browser globals before importing LANMode
global.window = { location: { protocol: 'http:', host: 'localhost:3001' } };
global.WebSocket = class MockWebSocket {
    constructor() { this.readyState = 1; }
    send() {}
    close() {}
};
global.document = { getElementById: () => null };

const { LANMode } = await import('../src/modes/lan-mode.js');
const { Card } = await import('../src/core/card.js');
const { Rules } = await import('../src/core/rules.js');
const { Player } = await import('../src/players/player.js');

let passed = 0, failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`✓ ${name}`);
    } catch (e) {
        failed++;
        console.log(`✗ ${name}`);
        console.log(`  ${e.message}`);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEq(actual, expected, msg) {
    if (actual !== expected) throw new Error(msg || `Expected ${expected}, got ${actual}`);
}

/** 创建一个 host LANMode 并初始化牌局 */
function createHostMode() {
    const mode = new LANMode();
    mode.isHost = true;
    mode.humanIndex = 0;
    mode.myPeerId = 'host_test';
    mode.gameState.setPlayer(0, new Player('房主', false));
    mode.gameState.setPlayer(1, new Player('玩家2', false));
    mode.gameState.setPlayer(2, new Player('玩家3', false));
    mode.playerMapping = { host_test: 0, p2: 1, p3: 2 };

    const deck = Card.createDeck();
    const bottom = deck.slice(51, 54);
    mode.gameState.startRound(deck.slice(0, 51), bottom);
    mode.gameState.callMode = 'score';
    mode.gameState.laiziEnabled = false;
    mode.gameState.baseScore = 1;
    mode.gameState.scoreMultiplier = 1;
    mode.gameState.allowSpring = true;
    mode.gameState.allowAntiSpring = true;
    mode.gameState.bombDoubles = true;
    mode.gameState.rocketDoubles = true;
    return mode;
}

/** 创建一个 guest LANMode */
function createGuestMode() {
    const mode = new LANMode();
    mode.isHost = false;
    mode.humanIndex = 1;
    mode.myPeerId = 'p2';
    mode.hostPeerId = 'host_test';
    mode.gameState.setPlayer(0, new Player('房主', false));
    mode.gameState.setPlayer(1, new Player('玩家2', false));
    mode.gameState.setPlayer(2, new Player('玩家3', false));
    return mode;
}

// ===== 测试开始 =====

test('_sendStateSync 包含完整游戏规则变体', () => {
    const mode = createHostMode();
    const originalSend = mode._send.bind(mode);
    let captured = null;
    mode._send = (msg) => { captured = msg; };
    mode._sendStateSync();
    mode._send = originalSend;

    assert(captured != null, 'sync data captured');
    const syncData = captured.data;
    // 游戏规则
    assertEq(syncData.callMode, 'score', 'callMode');
    assertEq(syncData.laiziEnabled, false, 'laiziEnabled');
    assertEq(syncData.baseScore, 1, 'baseScore');
    assertEq(syncData.scoreMultiplier, 1, 'scoreMultiplier');
    assertEq(syncData.allowSpring, true, 'allowSpring');
    assertEq(syncData.allowAntiSpring, true, 'allowAntiSpring');
    assertEq(syncData.bombDoubles, true, 'bombDoubles');
    assertEq(syncData.rocketDoubles, true, 'rocketDoubles');
    // 核心状态
    assertEq(syncData.phase, 'CALLING', 'phase');
    assertEq(syncData.currentTurn, 0, 'currentTurn');
    assertEq(syncData.landlordIndex, -1, 'landlordIndex');
    assertEq(syncData.passCount, 0, 'passCount');
    assertEq(syncData.roundCount, 0, 'roundCount');
    // 玩家信息
    assert(syncData.players != null, 'players array');
    assertEq(syncData.players.length, 3, '3 players');
    assertEq(syncData.players[0].name, '房主', 'player0 name');
    assertEq(syncData.players[0].handCount, 17, 'player0 handCount');
    assertEq(syncData.players[0].isLandlord, false, 'player0 not landlord');
    assertEq(syncData.players[0].seatIndex, 0, 'player0 seatIndex');
    // 不含手牌内容（只含数量）
    assertEq(syncData.ownHand, undefined, 'no ownHand without targetPeerId');
});

test('_sendStateSync targetPeerId 只给目标玩家发送 ownHand', () => {
    const mode = createHostMode();
    // 模拟发送过程（不实际发 WS）
    const originalSend = mode._send.bind(mode);
    let captured = null;
    mode._send = (msg) => { captured = msg; };

    mode._sendStateSync('p2');
    assert(captured != null, 'message sent');
    assertEq(captured.type, 'game_state_sync', 'type');
    assertEq(captured.targetPeerId, 'p2', 'targetPeerId');
    assert(captured.data.ownHand != null, 'ownHand included for target');
    assertEq(captured.data.ownHand.length, 17, 'ownHand has 17 cards');
    // 其他玩家仍只看到 handCount
    assertEq(captured.data.players[1].handCount, 17, 'p2 handCount');
    assertEq(captured.data.players[2].handCount, 17, 'p3 handCount');

    mode._send = originalSend;
});

test('_applySync 完整恢复游戏规则和核心状态', () => {
    const host = createHostMode();
    const guest = createGuestMode();

    // Host 进行一些操作
    host.gameState.callLandlord(0, 1);
    host.gameState.callLandlord(1, 0);
    host.gameState.callLandlord(2, 0);
    // 现在 phase 应为 PLAYING，landlord 已确定
    assertEq(host.gameState.phase, 'PLAYING', 'host phase after calling');

    // 获取 host 的 sync 数据
    const originalSend = host._send.bind(host);
    let captured = null;
    host._send = (msg) => { captured = msg; };
    host._sendStateSync();
    host._send = originalSend;

    assert(captured != null, 'sync data captured');
    const syncData = captured.data;

    // Guest 应用 sync
    guest._applySync(syncData);

    assertEq(guest.gameState.phase, 'PLAYING', 'guest phase synced');
    assertEq(guest.gameState.currentTurn, host.gameState.currentTurn, 'currentTurn');
    assertEq(guest.gameState.landlordIndex, host.gameState.landlordIndex, 'landlordIndex');
    assertEq(guest.gameState.currentCall, host.gameState.currentCall, 'currentCall');
    assertEq(guest.gameState.callMode, 'score', 'callMode synced');
    assertEq(guest.gameState.baseScore, 1, 'baseScore synced');
    assertEq(guest.gameState.allowSpring, true, 'allowSpring synced');
});

test('_applySync 恢复 history 和 lastPlay 的 pattern', () => {
    const host = createHostMode();
    const guest = createGuestMode();

    // 完成叫分
    host.gameState.callLandlord(0, 1);
    host.gameState.callLandlord(1, 0);
    host.gameState.callLandlord(2, 0);

    // Host 出一张牌
    const hand0 = host.gameState.players[0].hand;
    const card = hand0[0];
    const pattern = Rules.analyze([card]);
    host.gameState.playCards(0, [card], pattern);

    assertEq(host.gameState.history.length, 1, 'host has 1 history entry');
    assert(host.gameState.history[0].pattern != null, 'history pattern exists');
    assert(host.gameState.history[0].pattern.isValid(), 'history pattern is valid');

    // 获取并应用 sync
    const originalSend = host._send.bind(host);
    let captured = null;
    host._send = (msg) => { captured = msg; };
    host._sendStateSync();
    host._send = originalSend;

    guest._applySync(captured.data);

    assertEq(guest.gameState.history.length, 1, 'guest history synced');
    const gh = guest.gameState.history[0];
    assert(gh.pattern != null, 'guest history pattern exists');
    assert(gh.pattern.isValid(), 'guest history pattern is valid');
    assertEq(gh.pattern.type, pattern.type, 'pattern type');
    assertEq(gh.cards.length, 1, 'history cards count');

    // lastPlay
    assert(guest.gameState.lastPlay.pattern != null, 'guest lastPlay pattern exists');
    assert(guest.gameState.lastPlay.pattern.isValid(), 'guest lastPlay pattern is valid');
});

test('_applySync 通过 ownHand 恢复重连玩家手牌', () => {
    const host = createHostMode();
    const guest = createGuestMode();
    guest.humanIndex = 1;

    // 完成叫分
    host.gameState.callLandlord(0, 1);
    host.gameState.callLandlord(1, 0);
    host.gameState.callLandlord(2, 0);

    // 获取 host 发给 p2 的 targeted sync
    const originalSend = host._send.bind(host);
    let captured = null;
    host._send = (msg) => { captured = msg; };
    host._sendStateSync('p2');
    host._send = originalSend;

    const syncData = captured.data;
    assert(syncData.ownHand != null, 'ownHand present');

    // Guest 应用 sync
    guest._applySync(syncData);

    // Guest 的手牌应该与 host 中 p2 的手牌一致
    const hostP2Hand = host.gameState.players[1].hand.map(c => c.rankKey).sort();
    const guestP2Hand = guest.gameState.players[1].hand.map(c => c.rankKey).sort();
    assertEq(guestP2Hand.join(','), hostP2Hand.join(','), 'reconnected player hand matches');

    // 其他玩家手牌不应被 ownHand 覆盖（保持 handCount 正确）
    // p0 是地主，有 20 张（17 + 3 底牌）
    assertEq(guest.gameState.players[0].hand.length, 20, 'p0 hand count maintained');
    assertEq(guest.gameState.players[2].hand.length, 17, 'p2 hand count maintained');
});

test('_applySync 不泄露其他玩家真实手牌', () => {
    const host = createHostMode();
    const guest = createGuestMode();
    guest.humanIndex = 1;

    // 完成叫分
    host.gameState.callLandlord(0, 1);
    host.gameState.callLandlord(1, 0);
    host.gameState.callLandlord(2, 0);

    // 获取 broadcast sync（不含 ownHand）
    const originalSend = host._send.bind(host);
    let captured = null;
    host._send = (msg) => { captured = msg; };
    host._sendStateSync();
    host._send = originalSend;

    const syncData = captured.data;
    assertEq(syncData.ownHand, undefined, 'broadcast sync has no ownHand');

    // Guest 应用 sync
    guest._applySync(syncData);

    // Guest 中其他玩家（非 humanIndex）的手牌应该是占位牌
    const p0Hand = guest.gameState.players[0].hand;
    const p2Hand = guest.gameState.players[2].hand;
    assert(p0Hand.every(c => c.rankKey === '3'), 'p0 hand is placeholder');
    assert(p2Hand.every(c => c.rankKey === '3'), 'p2 hand is placeholder');
});

test('叫分后 host 自动广播 game_state_sync', () => {
    const mode = createHostMode();
    const originalSend = mode._send.bind(mode);
    const messages = [];
    mode._send = (msg) => { messages.push(msg); };

    mode.humanCall(1);

    const syncMsgs = messages.filter(m => m.type === 'game_state_sync');
    assertEq(syncMsgs.length, 1, 'host broadcasts sync after call');
    assertEq(syncMsgs[0].broadcast, true, 'sync is broadcast');

    mode._send = originalSend;
});

test('出牌后 host 自动广播 game_state_sync', () => {
    const mode = createHostMode();
    // 完成叫分
    mode.gameState.callLandlord(0, 3);
    mode.gameState.callLandlord(1, 0);
    mode.gameState.callLandlord(2, 0);

    const originalSend = mode._send.bind(mode);
    const messages = [];
    mode._send = (msg) => { messages.push(msg); };

    const card = mode.gameState.players[0].hand[0];
    mode.humanPlay([card]);

    const syncMsgs = messages.filter(m => m.type === 'game_state_sync');
    assertEq(syncMsgs.length, 1, 'host broadcasts sync after play');
    assertEq(syncMsgs[0].broadcast, true, 'sync is broadcast');

    mode._send = originalSend;
});

test('pass 后 host 自动广播 game_state_sync', () => {
    const mode = createHostMode();
    // 完成叫分
    mode.gameState.callLandlord(0, 3);
    mode.gameState.callLandlord(1, 0);
    mode.gameState.callLandlord(2, 0);
    // 先让 p0 出牌，然后轮到 p1
    const card = mode.gameState.players[0].hand[0];
    mode.gameState.playCards(0, [card], Rules.analyze([card]));
    // 设置 humanIndex 为 p1，让 p1 pass
    mode.humanIndex = 1;
    mode.gameState.currentTurn = 1;

    const originalSend = mode._send.bind(mode);
    const messages = [];
    mode._send = (msg) => { messages.push(msg); };

    mode.humanPass();

    const syncMsgs = messages.filter(m => m.type === 'game_state_sync');
    assertEq(syncMsgs.length, 1, 'host broadcasts sync after pass');
    assertEq(syncMsgs[0].broadcast, true, 'sync is broadcast');

    mode._send = originalSend;
});

test('非 host action 失败后请求状态同步', () => {
    const guest = createGuestMode();
    guest.isHost = false;
    guest.hostPeerId = 'host_test';
    guest.humanIndex = 1;

    // 设置一个不一致的状态（p2 没有牌）
    guest.gameState.setPlayer(2, new Player('玩家3', false));
    guest.gameState.players[2].hand = [];
    guest.gameState.phase = 'PLAYING';
    guest.gameState.currentTurn = 2;

    const originalSend = guest._send.bind(guest);
    const messages = [];
    guest._send = (msg) => { messages.push(msg); };

    // 模拟收到 host 的 play action（p2 出牌，但 guest 本地 p2 没有手牌，playCards 会失败）
    guest._handleRemoteAction({
        action: 'play',
        playerIndex: 2,
        cards: [{ s: null, r: '3' }],
    });

    const requestMsgs = messages.filter(m => m.type === 'request_state_sync');
    assertEq(requestMsgs.length, 1, 'guest requests state sync on play failure');
    assertEq(requestMsgs[0].targetPeerId, 'host_test', 'requests from host');

    guest._send = originalSend;
});

test('非 host pass 失败后请求状态同步', () => {
    const guest = createGuestMode();
    guest.isHost = false;
    guest.hostPeerId = 'host_test';
    guest.humanIndex = 1;
    guest.gameState.phase = 'CALLING'; // 不是 PLAYING，pass 会失败
    guest.gameState.currentTurn = 2;

    const originalSend = guest._send.bind(guest);
    const messages = [];
    guest._send = (msg) => { messages.push(msg); };

    guest._handleRemoteAction({
        action: 'pass',
        playerIndex: 2,
    });

    const requestMsgs = messages.filter(m => m.type === 'request_state_sync');
    assertEq(requestMsgs.length, 1, 'guest requests state sync on pass failure');

    guest._send = originalSend;
});

// 总结
console.log(`\nLAN 状态同步测试完成: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);

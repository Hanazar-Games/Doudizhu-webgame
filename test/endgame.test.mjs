/**
 * 残局训练模式单元测试 (ES Module)
 * 运行: node test/endgame.test.mjs
 */

import { Card, SUITS } from '../src/core/card.js';
import { Rules, HAND_TYPE } from '../src/core/rules.js';
import { GameState, PHASE } from '../src/core/game-state.js';
import { Player } from '../src/players/player.js';
import {
    ENDGAME_LEVELS,
    validateEndgameLevels,
    EndgameRecordManager,
    calculateEndgameStars,
} from '../src/utils/endgame-data.js';
import { EndgameMode } from '../src/modes/endgame-mode.js';

// 为 Node.js 环境提供 localStorage mock
global.localStorage = global.localStorage || {
    _store: new Map(),
    getItem(k) { return this._store.has(k) ? this._store.get(k) : null; },
    setItem(k, v) { this._store.set(k, String(v)); },
    removeItem(k) { this._store.delete(k); },
    clear() { this._store.clear(); },
};

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

// ===== 数据合法性测试 =====
test('validateEndgameLevels returns no errors', () => {
    const errors = validateEndgameLevels();
    assert(errors.length === 0, `Validation errors: ${errors.join(', ')}`);
});

test('All levels have exactly 3 hands', () => {
    for (const level of ENDGAME_LEVELS) {
        assert(level.hands.length === 3, `Level ${level.id} should have 3 hands`);
    }
});

test('All hands have no duplicate cards within a level', () => {
    for (const level of ENDGAME_LEVELS) {
        const allCards = [];
        for (let i = 0; i < 3; i++) {
            allCards.push(...level.hands[i]);
        }
        const seen = new Set();
        for (const c of allCards) {
            const key = `${c.value}-${c.suit?.name || c.rankKey}`;
            assert(!seen.has(key), `Level ${level.id} has duplicate card: ${key}`);
            seen.add(key);
        }
    }
});

test('All lastPlay cards form valid patterns', () => {
    for (const level of ENDGAME_LEVELS) {
        if (level.lastPlay && level.lastPlay.cards.length > 0) {
            const pattern = Rules.analyze(level.lastPlay.cards);
            assert(pattern.isValid(), `Level ${level.id} lastPlay is invalid: ${pattern.type}`);
        }
    }
});

test('Level 1 optimal solution is a valid straight', () => {
    const level = ENDGAME_LEVELS[0];
    const hand = level.hands[0];
    // 顺子 3-A（不含大小王）
    const straightCards = hand.filter(c => c.value >= 3 && c.value <= 14).sort((a, b) => a.value - b.value);
    const pattern = Rules.analyze(straightCards);
    assert(pattern.type === HAND_TYPE.STRAIGHT, `Expected STRAIGHT, got ${pattern.type}`);
    assert(pattern.length === 12, `Expected straight length 12, got ${pattern.length}`);
});

test('Level 2 triple-with-single is valid', () => {
    const level = ENDGAME_LEVELS[1];
    const hand = level.hands[0];
    // 555带A
    const fives = hand.filter(c => c.value === 5).slice(0, 3);
    const ace = hand.filter(c => c.value === 14).slice(0, 1);
    const cards = [...fives, ...ace];
    const pattern = Rules.analyze(cards);
    assert(pattern.type === HAND_TYPE.TRIPLE_WITH_SINGLE, `Expected TRIPLE_WITH_SINGLE, got ${pattern.type}`);
});

test('Level 4 lastPlay is a valid pair', () => {
    const level = ENDGAME_LEVELS[3];
    const pattern = Rules.analyze(level.lastPlay.cards);
    assert(pattern.type === HAND_TYPE.PAIR, `Expected PAIR, got ${pattern.type}`);
});

test('Level 5 landlord hand AAA+2 is triple with single', () => {
    const level = ENDGAME_LEVELS[4];
    const landlordHand = level.hands[0];
    const triple = landlordHand.filter(c => c.value === 14).slice(0, 3);
    const single = landlordHand.filter(c => c.value === 15).slice(0, 1);
    const cards = [...triple, ...single];
    const pattern = Rules.analyze(cards);
    assert(pattern.type === HAND_TYPE.TRIPLE_WITH_SINGLE, `Expected TRIPLE_WITH_SINGLE for AAA+2, got ${pattern.type}`);
});

// ===== 通关判定测试 =====
test('calculateEndgameStars - passed with optimal steps gets 3 stars', () => {
    const level = ENDGAME_LEVELS[0];
    const gs = new GameState();
    gs.landlordIndex = 0;
    gs.playCounts = [2, 0, 0];
    const roundData = { winnerIndex: 0, isLandlordWin: true };
    const result = calculateEndgameStars(level, roundData, gs, 2, 0);
    assert(result.stars === 3, `Expected 3 stars, got ${result.stars}`);
    assert(result.passed === true);
});

test('calculateEndgameStars - passed with suboptimal steps gets 2 stars', () => {
    const level = ENDGAME_LEVELS[0];
    const gs = new GameState();
    gs.landlordIndex = 0;
    gs.playCounts = [3, 0, 0];
    const roundData = { winnerIndex: 0, isLandlordWin: true };
    const result = calculateEndgameStars(level, roundData, gs, 3, 0);
    assert(result.stars === 2, `Expected 2 stars, got ${result.stars}`);
});

test('calculateEndgameStars - failure gets 0 stars', () => {
    const level = ENDGAME_LEVELS[0];
    const gs = new GameState();
    gs.landlordIndex = 0;
    const roundData = { winnerIndex: 1, isLandlordWin: false };
    const result = calculateEndgameStars(level, roundData, gs, 5, 0);
    assert(result.stars === 0, `Expected 0 stars, got ${result.stars}`);
    assert(result.passed === false);
});

test('calculateEndgameStars - anti-spring level 3 stars when landlord plays once', () => {
    const level = ENDGAME_LEVELS[4];
    const gs = new GameState();
    gs.landlordIndex = 0;
    gs.playCounts = [1, 3, 0];
    const roundData = { winnerIndex: 1, isLandlordWin: false };
    const result = calculateEndgameStars(level, roundData, gs, 3, 1);
    assert(result.stars === 3, `Expected 3 stars for anti-spring, got ${result.stars}`);
    assert(result.passed === true);
});

test('calculateEndgameStars - anti-spring level 2 stars when landlord plays more than once', () => {
    const level = ENDGAME_LEVELS[4];
    const gs = new GameState();
    gs.landlordIndex = 0;
    gs.playCounts = [2, 3, 0];
    const roundData = { winnerIndex: 1, isLandlordWin: false };
    const result = calculateEndgameStars(level, roundData, gs, 3, 1);
    assert(result.stars === 2, `Expected 2 stars for no anti-spring, got ${result.stars}`);
    assert(result.passed === true);
});

// ===== 存储测试 =====
test('EndgameRecordManager save and get record', () => {
    EndgameRecordManager.clear();
    EndgameRecordManager.saveRecord(1, 3, 2);
    const record = EndgameRecordManager.getRecord(1);
    assert(record !== null);
    assert(record.stars === 3);
    assert(record.bestSteps === 2);
    assert(record.passed === true);
});

test('EndgameRecordManager keeps best stars', () => {
    EndgameRecordManager.clear();
    EndgameRecordManager.saveRecord(1, 2, 4);
    EndgameRecordManager.saveRecord(1, 3, 3);
    const record = EndgameRecordManager.getRecord(1);
    assert(record.stars === 3, `Expected stars=3, got ${record.stars}`);
});

test('EndgameRecordManager keeps best steps for same stars', () => {
    EndgameRecordManager.clear();
    EndgameRecordManager.saveRecord(1, 3, 4);
    EndgameRecordManager.saveRecord(1, 3, 2);
    const record = EndgameRecordManager.getRecord(1);
    assert(record.bestSteps === 2, `Expected bestSteps=2, got ${record.bestSteps}`);
});

test('EndgameRecordManager progress calculation', () => {
    EndgameRecordManager.clear();
    EndgameRecordManager.saveRecord(1, 3, 2);
    EndgameRecordManager.saveRecord(2, 2, 3);
    const progress = EndgameRecordManager.getProgress();
    assert(progress.passed === 2);
    assert(progress.totalStars === 5);
    assert(progress.nextLevel === 3);
});

// ===== EndgameMode 集成测试 =====
test('EndgameMode initializes correctly', async () => {
    const mode = new EndgameMode(0);
    await mode.init();
    assert(mode.gameState.players[0] instanceof Player);
    assert(mode.gameState.players[1].isAI);
    assert(mode.gameState.players[2].isAI);
    assert(mode.humanIndex === 0);
});

test('EndgameMode getLevelInfo returns correct data', async () => {
    EndgameRecordManager.clear();
    const mode = new EndgameMode(0);
    await mode.init();
    const info = mode.getLevelInfo();
    assert(info.id === 1);
    assert(info.name === '基础单牌压制');
    assert(info.bestStars === 0);
});

test('EndgameMode sets fixed hands on start', async () => {
    EndgameRecordManager.clear();
    const mode = new EndgameMode(0);
    await mode.init();
    // 模拟 renderer 避免报错
    mode.renderer = { audio: { playDeal() {}, playNewRound() {} }, renderHands() {}, highlightTurn() {}, showEndgameInfo() {} };
    await mode.startGame();
    const level = ENDGAME_LEVELS[0];
    assert(mode.gameState.phase === PHASE.PLAYING, `Expected PLAYING, got ${mode.gameState.phase}`);
    assert(mode.gameState.landlordIndex === level.landlordIndex);
    assert(mode.gameState.currentTurn === level.currentTurn);
    // 验证手牌被正确设置
    for (let i = 0; i < 3; i++) {
        const expectedCount = level.hands[i].length;
        const actualCount = mode.gameState.players[i].hand.length;
        assert(actualCount === expectedCount, `Player ${i} hand count mismatch: expected ${expectedCount}, got ${actualCount}`);
    }
});

test('EndgameMode level 4 sets lastPlay correctly', async () => {
    EndgameRecordManager.clear();
    const mode = new EndgameMode(3);
    await mode.init();
    mode.renderer = { audio: { playDeal() {}, playNewRound() {} }, renderHands() {}, highlightTurn() {}, showEndgameInfo() {} };
    await mode.startGame();
    const level = ENDGAME_LEVELS[3];
    assert(mode.gameState.lastPlay.playerIndex === level.lastPlay.playerIndex);
    assert(mode.gameState.lastPlay.pattern !== null);
    assert(mode.gameState.lastPlay.pattern.type === HAND_TYPE.PAIR);
});

// ===== 最优解可被 Rules 识别测试 =====
test('Level 1 optimal straight can be played and wins', () => {
    const level = ENDGAME_LEVELS[0];
    const hand = level.hands[0];
    const straightCards = hand.filter(c => c.value >= 3 && c.value <= 14).sort((a, b) => a.value - b.value);
    const pattern = Rules.analyze(straightCards);
    assert(pattern.isValid());
    // 模拟出牌后剩大王
    const remaining = hand.filter(c => !straightCards.includes(c));
    assert(remaining.length === 1);
    assert(remaining[0].value === 17); // 大王
});

test('Level 3 rocket beats any play', () => {
    const rocket = Rules.analyze([new Card(null, 'JOKER_SMALL'), new Card(null, 'JOKER_BIG')]);
    const straight = Rules.analyze(ENDGAME_LEVELS[2].hands[1]); // AI1 的顺子
    assert(rocket.isValid());
    assert(straight.isValid());
    assert(Rules.canBeat(straight, rocket));
});

// ===== Summary =====
console.log(`\n====================`);
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
console.log(`====================`);
process.exit(failed > 0 ? 1 : 0);

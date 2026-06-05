/**
 * 回放系统增强回归测试
 * 覆盖：PASS 记录、数据完整性、旧记录兼容、关键回合、战报生成
 */

import { GameState } from '../src/core/game-state.js';
import { Card } from '../src/core/card.js';
import { Player } from '../src/players/player.js';
import { Rules } from '../src/core/rules.js';
import { ReplayManager } from '../src/utils/replay.js';

// Node.js 环境下 mock document 和 window
global.document = {
    getElementById: () => ({
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        innerHTML: '',
    }),
};
global.window = {
    gameApp: {
        renderer: {
            audio: {
                playButtonClick: () => {},
                playPass: () => {},
                playBomb: () => {},
                playRocket: () => {},
                playStraight: () => {},
                playPlane: () => {},
                playPair: () => {},
                playTriple: () => {},
                playFourWithTwo: () => {},
                playSingle: () => {},
                playPlay: () => {},
            }
        }
    }
};

// ========== 辅助函数 ==========
function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'Assertion failed');
}

function pass(msg) {
    console.log(`  ✓ ${msg}`);
}

function fail(msg, err) {
    console.error(`  ✗ ${msg}`);
    if (err) console.error(err);
    process.exitCode = 1;
}

function createMockGame(overrides = {}) {
    return {
        id: overrides.id || 'game_test',
        date: new Date().toISOString(),
        mode: 'ai',
        players: [
            { name: '玩家A', isAI: false },
            { name: '玩家B', isAI: true },
            { name: '玩家C', isAI: true },
        ],
        landlordIndex: 0,
        currentCall: 3,
        dealerIndex: 0,
        initialHands: overrides.initialHands || [[], [], []],
        initialBottom: overrides.initialBottom || [],
        history: overrides.history || [],
        result: overrides.result || {
            winnerIndex: 0,
            isLandlordWin: true,
            scores: [150, -80, -70],
            springType: null,
            multiplier: 1,
            baseScore: 1,
        },
    };
}

// ========== 测试用例 ==========

const tests = [];

// --- GameState PASS 记录 ---
tests.push({
    name: 'GameState pass 将 PASS 动作写入 history',
    run() {
        const gs = new GameState();
        const deck = Card.createDeck();
        gs.players = [
            { name: 'P0', isAI: false, hand: deck.slice(0, 20) },
            { name: 'P1', isAI: true, hand: deck.slice(20, 37) },
            { name: 'P2', isAI: true, hand: deck.slice(37, 54) },
        ];
        gs.initialHands = gs.players.map(p => [...p.hand]);
        gs.initialBottom = [];
        gs.landlordIndex = 0;
        gs.dealerIndex = 0;
        gs.phase = 'PLAYING';
        gs.currentTurn = 1;
        gs.lastPlay = { playerIndex: 0, cards: [deck[0]], pattern: { type: 'SINGLE' } };
        gs.passCount = 0;
        gs.history = [];
        gs.allowPassOnFirst = false;
        gs.mustPlay = false;

        const ok = gs.pass(1);
        assert(ok === true, 'pass 应成功');
        assert(gs.history.length === 1, 'history 应有 1 条');
        const h = gs.history[0];
        assert(h.playerIndex === 1, 'playerIndex 应为 1');
        assert(Array.isArray(h.cards) && h.cards.length === 0, 'PASS 的 cards 应为空数组');
        assert(h.pattern?.type === 'PASS', 'pattern.type 应为 PASS');
        assert(h.timestamp > 0, '应有 timestamp');
        pass('GameState pass 将 PASS 动作写入 history');
    },
});

// --- 保存数据完整性 ---
tests.push({
    name: 'saveFullGame 保存的数据包含 dealerIndex 和 isLaizi',
    run() {
        const gs = new GameState();
        const deck = Card.createDeck();
        const p0 = new Player('P0', false);
        p0.setHand(deck.slice(0, 20));
        const p1 = new Player('P1', true);
        p1.setHand(deck.slice(20, 37));
        const p2 = new Player('P2', true);
        p2.setHand(deck.slice(37, 54));
        gs.players = [p0, p1, p2];
        gs.initialHands = gs.players.map(p => [...p.hand]);
        gs.initialBottom = [deck[0]];
        gs.landlordIndex = 0;
        gs.dealerIndex = 2;
        gs.phase = 'PLAYING';
        gs.currentTurn = 0;
        gs.lastPlay = { playerIndex: -1, cards: [], pattern: null };
        gs.history = [];
        gs.allowPassOnFirst = false;
        gs.mustPlay = false;

        // 癞子牌
        gs.players[0].hand[0].isLaizi = true;
        gs.players[1].hand[0].isLaizi = true;

        const card = gs.players[0].hand[0];
        const pattern = Rules.analyze([card]);
        const result = gs.playCards(0, [card], pattern);
        assert(result.success === true, 'playCards 应成功');
        assert(gs.history.length === 1, 'history 应有 1 条');

        // 模拟 saveFullGame 时的映射逻辑（与 main.js 一致）
        const fullGame = {
            players: gs.players.map(p => p ? { name: p.name, isAI: p.isAI } : null),
            initialHands: gs.initialHands,
            initialBottom: gs.initialBottom,
            landlordIndex: gs.landlordIndex,
            currentCall: gs.currentCall,
            dealerIndex: gs.dealerIndex,
            history: gs.history.map(h => ({
                playerIndex: h.playerIndex,
                cards: h.cards.map(c => ({ value: c.value, suit: c.suit?.name, rank: c.rankKey, displayName: c.displayName, isLaizi: c.isLaizi })),
                pattern: { type: h.pattern?.type, mainValue: h.pattern?.mainValue, length: h.pattern?.length },
                timestamp: h.timestamp,
            })),
        };

        assert(fullGame.dealerIndex === 2, 'dealerIndex 应保存');
        assert(fullGame.history[0].cards[0].isLaizi === true, 'isLaizi 应保存');
        assert(fullGame.history[0].pattern.length != null, 'pattern.length 应保存');
        pass('saveFullGame 保存的数据包含 dealerIndex 和 isLaizi');
    },
});

// --- 旧记录兼容 ---
tests.push({
    name: 'ReplayManager 能正常处理缺少 dealerIndex / isLaizi 的旧记录',
    run() {
        const oldGame = createMockGame({
            initialHands: [
                [{ value: 3, suit: 'spade', rank: 'THREE', displayName: '♠3' }],
                [{ value: 4, suit: 'heart', rank: 'FOUR', displayName: '♥4' }],
                [{ value: 5, suit: 'club', rank: 'FIVE', displayName: '♣5' }],
            ],
            history: [
                { playerIndex: 0, cards: [{ value: 3, suit: 'spade', rank: 'THREE', displayName: '♠3' }], pattern: { type: 'SINGLE', mainValue: 3 } },
            ],
        });
        // 删除新字段模拟旧记录
        delete oldGame.dealerIndex;
        oldGame.history[0].cards[0].isLaizi = undefined;
        oldGame.history[0].pattern.length = undefined;

        const rm = new ReplayManager('replay-dummy');
        rm.currentGame = oldGame;
        rm.currentStep = 0;
        const html = rm._renderTableState();
        assert(html.includes('玩家A'), '应渲染玩家名称');
        assert(html.includes('♠3') || html.includes('3'), '应渲染出牌');
        pass('ReplayManager 能正常处理缺少 dealerIndex / isLaizi 的旧记录');
    },
});

// --- 关键回合检测 ---
tests.push({
    name: 'ReplayManager._computeKeyMoments 检测炸弹和王炸',
    run() {
        const game = createMockGame({
            history: [
                { playerIndex: 0, cards: [], pattern: { type: 'SINGLE' } },
                { playerIndex: 1, cards: [], pattern: { type: 'BOMB' } },
                { playerIndex: 2, cards: [], pattern: { type: 'PASS' } },
                { playerIndex: 0, cards: [], pattern: { type: 'ROCKET' } },
            ],
            result: { springType: null, multiplier: 1 },
        });
        const rm = new ReplayManager('replay-dummy');
        rm.currentGame = game;
        const moments = rm._computeKeyMoments();
        assert(moments.length === 2, `应有 2 个关键回合，实际 ${moments.length}`);
        assert(moments.some(m => m.label.includes('炸弹')), '应有炸弹标记');
        assert(moments.some(m => m.label.includes('王炸')), '应有王炸标记');
        pass('ReplayManager._computeKeyMoments 检测炸弹和王炸');
    },
});

tests.push({
    name: 'ReplayManager._computeKeyMoments 检测春天',
    run() {
        const game = createMockGame({
            history: [],
            result: { springType: 'spring', multiplier: 2 },
        });
        const rm = new ReplayManager('replay-dummy');
        rm.currentGame = game;
        const moments = rm._computeKeyMoments();
        assert(moments.length === 1, '应有 1 个关键回合（春天）');
        assert(moments[0].label.includes('春天'), '应有春天标记');
        pass('ReplayManager._computeKeyMoments 检测春天');
    },
});

// --- 战报生成 ---
tests.push({
    name: 'ReplayManager._generateReport 生成包含得分和倍数的战报',
    run() {
        const game = createMockGame({
            mode: 'ai',
            result: {
                winnerIndex: 0,
                isLandlordWin: true,
                scores: [300, -150, -150],
                springType: 'spring',
                multiplier: 2,
                baseScore: 1,
            },
        });
        const rm = new ReplayManager('replay-dummy');
        rm.currentGame = game;
        const report = rm._generateReport();
        assert(report.includes('斗地主'), '战报应包含游戏名');
        assert(report.includes('地主胜'), '战报应包含胜负结果');
        assert(report.includes('春天'), '战报应包含春天');
        assert(report.includes('2倍'), '战报应包含倍数');
        assert(report.includes('玩家A'), '战报应包含玩家名');
        assert(report.includes('+300'), '战报应包含正分');
        assert(report.includes('-150'), '战报应包含负分');
        pass('ReplayManager._generateReport 生成包含得分和倍数的战报');
    },
});

// --- 步骤渲染：PASS 正确显示 ---
tests.push({
    name: 'ReplayManager._renderTableState PASS 步骤不减少手牌',
    run() {
        const game = createMockGame({
            initialHands: [
                [{ value: 3, suit: 'spade', rank: 'THREE', displayName: '♠3' }, { value: 4, suit: 'heart', rank: 'FOUR', displayName: '♥4' }],
                [{ value: 5, suit: 'club', rank: 'FIVE', displayName: '♣5' }],
                [{ value: 6, suit: 'diamond', rank: 'SIX', displayName: '♦6' }],
            ],
            history: [
                { playerIndex: 0, cards: [{ value: 3, suit: 'spade', rank: 'THREE', displayName: '♠3' }], pattern: { type: 'SINGLE' } },
                { playerIndex: 1, cards: [], pattern: { type: 'PASS' } },
            ],
        });
        const rm = new ReplayManager('replay-dummy');
        rm.currentGame = game;
        rm.currentStep = 1;
        const html = rm._renderTableState();
        // 使用 rankLabel 或 displayName 检查
        assert(html.includes('4') || html.includes('♥'), 'PASS 后玩家0应有剩余牌');
        assert(html.includes('5') || html.includes('♣'), 'PASS 后玩家1应有原牌');
        pass('ReplayManager._renderTableState PASS 步骤不减少手牌');
    },
});

// --- 步骤渲染：癞子标记 ---
tests.push({
    name: 'ReplayManager._renderTableState 渲染癞子标记',
    run() {
        const game = createMockGame({
            initialHands: [
                [{ value: 3, suit: 'spade', rank: 'THREE', displayName: '♠3', isLaizi: true }],
                [],
                [],
            ],
            history: [],
        });
        const rm = new ReplayManager('replay-dummy');
        rm.currentGame = game;
        rm.currentStep = -1;
        const html = rm._renderTableState();
        assert(html.includes('laizi') || html.includes('癞'), '应渲染癞子标记');
        pass('ReplayManager._renderTableState 渲染癞子标记');
    },
});

// --- 播放控制 ---
tests.push({
    name: 'ReplayManager nextStep / prevStep / goToStep 边界正确',
    run() {
        const game = createMockGame({
            history: [
                { playerIndex: 0, cards: [], pattern: { type: 'SINGLE' } },
                { playerIndex: 1, cards: [], pattern: { type: 'PASS' } },
                { playerIndex: 2, cards: [], pattern: { type: 'SINGLE' } },
            ],
        });
        const rm = new ReplayManager('replay-dummy');
        rm.currentGame = game;
        rm.currentStep = -1;

        assert(rm.prevStep() === false, '初始状态 prevStep 应返回 false');
        assert(rm.nextStep() === true, 'nextStep 应成功');
        assert(rm.currentStep === 0, 'currentStep 应为 0');
        assert(rm.nextStep() === true, 'nextStep 应成功');
        assert(rm.nextStep() === true, 'nextStep 应成功');
        assert(rm.nextStep() === false, '超出范围 nextStep 应返回 false');
        assert(rm.currentStep === 2, 'currentStep 应为 2');

        rm.goToStep(1);
        assert(rm.currentStep === 1, 'goToStep 应正确跳转');
        rm.goToStep(100);
        assert(rm.currentStep === 2, 'goToStep 越界应限制到最大值');
        rm.goToStep(-10);
        assert(rm.currentStep === -1, 'goToStep 越界应限制到最小值');
        pass('ReplayManager nextStep / prevStep / goToStep 边界正确');
    },
});

// --- 主流程 ---
console.log('=== 回放系统增强回归测试 ===\n');
let passed = 0;
let failed = 0;

for (const t of tests) {
    try {
        t.run();
        passed++;
    } catch (err) {
        failed++;
        fail(t.name, err);
    }
}

console.log(`\n====================`);
console.log(`Total: ${tests.length}, Passed: ${passed}, Failed: ${failed}`);
console.log(`====================`);

if (failed > 0) process.exit(1);

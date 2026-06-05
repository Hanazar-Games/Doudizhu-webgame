/**
 * CoachAnalyzer 单元测试
 */

import { CoachAnalyzer } from '../src/utils/coach-analyzer.js';

function makeCard(value, suit = 'spade', rank = null, displayName = null) {
    const rankMap = {
        3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
        11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2',
        16: 'JOKER_SMALL', 17: 'JOKER_BIG',
    };
    const r = rank || rankMap[value] || String(value);
    const dn = displayName || (value >= 16 ? (value === 16 ? '小王' : '大王') : `${suit === 'heart' || suit === 'diamond' ? '♥' : '♠'}${r}`);
    return { value, suit, rank: r, displayName: dn };
}

function createFullGame({ history = [], initialHands = [], landlordIndex = 0, currentCall = 1, mode = 'ai' } = {}) {
    return {
        id: 'test_' + Date.now(),
        date: new Date().toISOString(),
        mode,
        players: [{ name: '人类', isAI: false }, { name: 'AI1', isAI: true }, { name: 'AI2', isAI: true }],
        initialHands,
        initialBottom: [],
        landlordIndex,
        currentCall,
        history,
        result: { winnerIndex: 1, isLandlordWin: true, scores: [-2, 4, -2], springType: null, multiplier: 1, baseScore: 1 },
    };
}

function assert(condition, message) {
    if (!condition) throw new Error(`❌ ${message}`);
}

function run(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
    } catch (e) {
        console.error(`❌ ${name}: ${e.message}`);
        process.exitCode = 1;
    }
}

// ========== 测试用例 ==========

run(' analyze 返回 null 当 humanIndex 无效', () => {
    const g = createFullGame();
    assert(CoachAnalyzer.analyze(g, -1) === null, 'humanIndex=-1 应返回 null');
    assert(CoachAnalyzer.analyze(g, 3) === null, 'humanIndex=3 应返回 null');
    assert(CoachAnalyzer.analyze(null, 0) === null, 'null game 应返回 null');
});

run(' 叫分分析：弱牌叫地主', () => {
    // human 是地主，手牌很弱（很多单牌，无炸弹无大牌）
    const hand = [
        makeCard(3), makeCard(4), makeCard(5), makeCard(6),
        makeCard(7), makeCard(8), makeCard(9), makeCard(10),
    ];
    const g = createFullGame({
        initialHands: [hand, [], []],
        landlordIndex: 0,
        currentCall: 1,
    });
    const r = CoachAnalyzer.analyze(g, 0);
    assert(r != null, '应有结果');
    const call = r.suggestions.find(s => s.type === 'call');
    assert(call != null, '应检测出叫分问题');
    assert(call.severity === 'medium', '弱牌叫地主应为 medium');
});

run(' 叫分分析：强牌未叫地主', () => {
    const hand = [
        makeCard(16), makeCard(17), // 王炸
        makeCard(15), makeCard(15), makeCard(15), makeCard(15), // 2炸弹
        makeCard(14), makeCard(14), makeCard(14), makeCard(14), // A炸弹
    ];
    const g = createFullGame({
        initialHands: [hand, [], []],
        landlordIndex: 1, // human 不是地主
        currentCall: 0,
    });
    const r = CoachAnalyzer.analyze(g, 0);
    const call = r.suggestions.find(s => s.type === 'call');
    assert(call != null, '应检测出错失地主');
    assert(call.severity === 'medium', '强牌未叫地主应为 medium');
});

run(' 残局模式跳过叫分分析', () => {
    const hand = [makeCard(16), makeCard(17)];
    const g = createFullGame({
        mode: 'endgame',
        initialHands: [hand, [], []],
        landlordIndex: 0,
        currentCall: 0,
    });
    const r = CoachAnalyzer.analyze(g, 0);
    const call = r.suggestions.find(s => s.type === 'call');
    assert(call == null, '残局不应有叫分建议');
});

run(' 错过压制：PASS 但可用普通牌压制', () => {
    // human (0) 是农民，地主 (1) 出了单张 5，human 有单张 6 却 PASS
    const hand0 = [makeCard(6), makeCard(7), makeCard(8)];
    const hand1 = [makeCard(5)];
    const hand2 = [];
    const history = [
        { playerIndex: 1, cards: [makeCard(5)], pattern: { type: 'SINGLE', mainValue: 5, length: 1 } },
        { playerIndex: 2, cards: [], pattern: { type: 'PASS' } },
        { playerIndex: 0, cards: [], pattern: { type: 'PASS' } },
    ];
    const g = createFullGame({
        initialHands: [hand0, hand1, hand2],
        landlordIndex: 1,
        history,
    });
    const r = CoachAnalyzer.analyze(g, 0);
    const missed = r.suggestions.find(s => s.type === 'missed_beat');
    assert(missed != null, '应检测出错过压制');
    assert(missed.severity === 'high', '可用普通牌压制应为 high');
    assert(missed.roundIndex === 2, '应指向第 3 回合 (index 2)');
});

run(' 农民不压农民：不应报错', () => {
    // human (0) 和 2 都是农民，2 出了单张 5，human PASS，这不应该是错过压制
    const hand0 = [makeCard(6)];
    const hand1 = [];
    const hand2 = [makeCard(5)];
    const history = [
        { playerIndex: 2, cards: [makeCard(5)], pattern: { type: 'SINGLE', mainValue: 5, length: 1 } },
        { playerIndex: 0, cards: [], pattern: { type: 'PASS' } },
    ];
    const g = createFullGame({
        initialHands: [hand0, hand1, hand2],
        landlordIndex: 1,
        history,
    });
    const r = CoachAnalyzer.analyze(g, 0);
    const missed = r.suggestions.find(s => s.type === 'missed_beat');
    assert(missed == null, '农民不应压制农民');
});

run(' 炸弹时机：有普通牌却用炸弹', () => {
    // human (0) 是地主，上家 (2) 出单张 5，human 有单张 6 却用了炸弹
    const hand0 = [makeCard(6), makeCard(7), makeCard(7), makeCard(7), makeCard(7)]; // 有单张6 + 7炸弹
    const history = [
        { playerIndex: 2, cards: [makeCard(5)], pattern: { type: 'SINGLE', mainValue: 5, length: 1 } },
        { playerIndex: 0, cards: [makeCard(7), makeCard(7), makeCard(7), makeCard(7)], pattern: { type: 'BOMB', mainValue: 7, length: 4 } },
    ];
    const g = createFullGame({
        initialHands: [hand0, [], []],
        landlordIndex: 0,
        history,
    });
    const r = CoachAnalyzer.analyze(g, 0);
    const timing = r.suggestions.find(s => s.type === 'bomb_timing');
    assert(timing != null, '应检测出炸弹浪费');
    assert(timing.severity === 'medium', '有普通牌可压应为 medium');
});

run(' 拆炸弹检测', () => {
    // human 手牌有 4 张 7，却出了单张 7
    const hand0 = [makeCard(7), makeCard(7), makeCard(7), makeCard(7), makeCard(8)];
    const history = [
        { playerIndex: 0, cards: [makeCard(7)], pattern: { type: 'SINGLE', mainValue: 7, length: 1 } },
    ];
    const g = createFullGame({
        initialHands: [hand0, [], []],
        landlordIndex: 0,
        history,
    });
    const r = CoachAnalyzer.analyze(g, 0);
    const split = r.suggestions.find(s => s.type === 'split');
    assert(split != null, '应检测出拆炸弹');
    assert(split.severity === 'medium', '拆7炸弹应为 medium');
});

run(' 效率分析：倒数第二手可一次出完', () => {
    // human 最后两手：先出单张 3，再出对子 4-4；但倒数第二手时手牌是 [3,4,4]，本可一次出完... 不，3+4+4不是合法牌型
    // 改为：倒数第二手时手牌是 [4,4,5,5,6,6]（连对），先出 4,4 再出 5,5,6,6
    const hand0 = [
        makeCard(4), makeCard(4), makeCard(5), makeCard(5), makeCard(6), makeCard(6),
    ];
    const history = [
        { playerIndex: 0, cards: [makeCard(4), makeCard(4)], pattern: { type: 'PAIR', mainValue: 4, length: 2 } },
        { playerIndex: 1, cards: [], pattern: { type: 'PASS' } },
        { playerIndex: 2, cards: [], pattern: { type: 'PASS' } },
        { playerIndex: 0, cards: [makeCard(5), makeCard(5), makeCard(6), makeCard(6)], pattern: { type: 'DOUBLE_STRAIGHT', mainValue: 6, length: 4 } },
    ];
    const g = createFullGame({
        initialHands: [hand0, [], []],
        landlordIndex: 0,
        history,
    });
    const r = CoachAnalyzer.analyze(g, 0);
    const eff = r.suggestions.find(s => s.type === 'efficiency');
    assert(eff != null, '应检测出效率问题');
    assert(eff.severity === 'high', '可分次出完应为 high');
});

run(' 复盘得分计算正确', () => {
    // 构造一个有很多 high severity 建议的牌局
    const hand0 = [makeCard(3)]; // 弱牌却叫地主
    const history = [
        { playerIndex: 2, cards: [makeCard(5)], pattern: { type: 'SINGLE', mainValue: 5, length: 1 } },
        { playerIndex: 0, cards: [], pattern: { type: 'PASS' } }, // 错过压制
    ];
    const g = createFullGame({
        initialHands: [hand0, [makeCard(5)], [makeCard(5)]],
        landlordIndex: 0,
        currentCall: 1,
        history,
    });
    const r = CoachAnalyzer.analyze(g, 0);
    assert(r.summary.totalSuggestions > 0, '应有建议');
    assert(r.summary.score <= 100, '得分不应超过100');
    assert(r.summary.score >= 0, '得分不应低于0');
});

run(' 建议数量限制在 6 条以内', () => {
    // 构造一个很长的 history，产生大量建议
    const hand0 = [makeCard(6), makeCard(7), makeCard(7), makeCard(7), makeCard(7), makeCard(8), makeCard(8), makeCard(8), makeCard(8)];
    const history = [];
    for (let i = 0; i < 10; i++) {
        history.push({ playerIndex: 2, cards: [makeCard(5)], pattern: { type: 'SINGLE', mainValue: 5, length: 1 } });
        history.push({ playerIndex: 1, cards: [], pattern: { type: 'PASS' } });
        history.push({ playerIndex: 0, cards: [], pattern: { type: 'PASS' } });
    }
    const g = createFullGame({
        initialHands: [hand0, [makeCard(5)], [makeCard(5)]],
        landlordIndex: 1, // human 是农民，2 是地主
        history,
    });
    const r = CoachAnalyzer.analyze(g, 0);
    assert(r.suggestions.length <= 6, `建议数 ${r.suggestions.length} 超过6条`);
});

console.log('\n🏁 CoachAnalyzer 测试完成');

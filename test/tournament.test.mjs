/**
 * 锦标赛模式单元测试 (ES Module)
 * 运行: node test/tournament.test.mjs
 */

// 为 Node.js 环境提供 localStorage mock（必须在模块导入前设置）
global.localStorage = global.localStorage || {
    _store: new Map(),
    getItem(k) { return this._store.has(k) ? this._store.get(k) : null; },
    setItem(k, v) { this._store.set(k, String(v)); },
    removeItem(k) { this._store.delete(k); },
    clear() { this._store.clear(); },
};

import { TournamentMode } from '../src/modes/tournament-mode.js';
import { TournamentStorage } from '../src/utils/tournament-storage.js';

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

function createMode(rounds = 3) {
    localStorage.clear();
    return new TournamentMode('easy', rounds);
}

// ===== 测试开始 =====

test('TournamentMode 初始化设置正确的总轮数', async () => {
    const mode = createMode(5);
    await mode.init();
    assertEq(mode.totalRounds, 5, 'totalRounds should be 5');
    assertEq(mode.matchConfig.totalRounds, 5, 'matchConfig.totalRounds should be 5');
    assertEq(mode.matchConfig.isMatchMode, true, 'should be match mode');
});

test('TournamentMode getMatchStatus 包含 isTournament 标志', async () => {
    const mode = createMode(3);
    await mode.init();
    const status = mode.getMatchStatus();
    assert(status.isTournament === true, 'isTournament should be true');
    assertEq(status.tournamentTotalRounds, 3, 'tournamentTotalRounds should be 3');
});

test('多局得分累计正确', async () => {
    const mode = createMode(3);
    await mode.init();
    // 模拟3局结束
    mode.onRoundEnd({ scores: [100, -50, -50], winnerIndex: 0, isLandlordWin: true, springType: null, multiplier: 1 });
    mode.onRoundEnd({ scores: [150, -80, -70], winnerIndex: 0, isLandlordWin: true, springType: null, multiplier: 1 });
    mode.onRoundEnd({ scores: [180, -100, -80], winnerIndex: 1, isLandlordWin: false, springType: null, multiplier: 1 });

    assertEq(mode.roundResults.length, 3, 'should have 3 round results');
    // 第一局本局得分
    assertEq(mode.roundResults[0].scores[0], 100, 'round 1 score for player 0');
    assertEq(mode.roundResults[0].scores[1], -50, 'round 1 score for player 1');
    // 第二局本局得分 = 累计差值
    assertEq(mode.roundResults[1].scores[0], 50, 'round 2 score for player 0 (150-100)');
    assertEq(mode.roundResults[1].scores[1], -30, 'round 2 score for player 1 (-80 - -50)');
    // 第三局
    assertEq(mode.roundResults[2].scores[0], 30, 'round 3 score for player 0 (180-150)');
});

test('排名计算正确', async () => {
    const mode = createMode(3);
    await mode.init();
    mode.onRoundEnd({ scores: [100, -50, -50], winnerIndex: 0, isLandlordWin: true, springType: null, multiplier: 1 });
    mode.onRoundEnd({ scores: [60, 80, -140], winnerIndex: 1, isLandlordWin: false, springType: null, multiplier: 1 });

    // 第一局后排名: 0>1=2
    const changes1 = mode.getRankChanges(0);
    assertEq(changes1[0].after, 1, 'player 0 rank after round 1');
    assertEq(changes1[1].after, 2, 'player 1 rank after round 1');

    // 第二局后: player1 (80) 应该上升到第1名，player0 (60) 降到第2名
    const changes2 = mode.getRankChanges(1);
    assertEq(changes2[1].after, 1, 'player 1 should be rank 1 after round 2');
    assertEq(changes2[0].after, 2, 'player 0 should be rank 2 after round 2');
    assertEq(changes2[1].change, 1, 'player 1 moved up 1 rank');
});

test('MVP 计算正确', async () => {
    const mode = createMode(3);
    await mode.init();
    assertEq(mode.getCurrentMVP(), null, 'no MVP before any round');

    mode.onRoundEnd({ scores: [100, -50, -50], winnerIndex: 0, isLandlordWin: true, springType: null, multiplier: 1 });
    const mvp1 = mode.getCurrentMVP();
    assertEq(mvp1.index, 0, 'MVP should be player 0');
    assertEq(mvp1.score, 100, 'MVP score should be 100');

    mode.onRoundEnd({ scores: [80, 120, -200], winnerIndex: 1, isLandlordWin: false, springType: null, multiplier: 1 });
    const mvp2 = mode.getCurrentMVP();
    assertEq(mvp2.index, 1, 'MVP should be player 1 now');
    assertEq(mvp2.score, 120, 'MVP score should be 120');
});

test('最后一局结束后 matchStatus.isFinished 为真', async () => {
    const mode = createMode(2);
    await mode.init();
    mode.onRoundEnd({ scores: [100, -50, -50], winnerIndex: 0, isLandlordWin: true, springType: null, multiplier: 1 });
    let status = mode.getMatchStatus();
    assertEq(status.isFinished, false, 'should not be finished after round 1 of 2');

    mode.onRoundEnd({ scores: [150, -80, -70], winnerIndex: 0, isLandlordWin: true, springType: null, multiplier: 1 });
    status = mode.getMatchStatus();
    assertEq(status.isFinished, true, 'should be finished after round 2 of 2');
});

test('锦标赛记录保存到 storage', async () => {
    localStorage.clear();
    const mode = createMode(2);
    await mode.init();
    mode.onRoundEnd({ scores: [100, -50, -50], winnerIndex: 0, isLandlordWin: true, springType: null, multiplier: 1 });
    mode.onRoundEnd({ scores: [150, -80, -70], winnerIndex: 0, isLandlordWin: true, springType: null, multiplier: 1 });

    const records = TournamentStorage.getRecords();
    assert(records.length >= 1, 'should have at least 1 saved record');
    const latest = records[0];
    assertEq(latest.totalRounds, 2, 'record should have 2 rounds');
    assertEq(latest.playerRank, 1, 'player should be rank 1');
    assertEq(latest.isChampion, true, 'player should be champion');
    assertEq(latest.roundDetails.length, 2, 'record should have 2 round details');
});

test('TournamentStorage 统计正确', async () => {
    localStorage.clear();
    // 保存3条记录
    TournamentStorage.saveRecord({
        totalRounds: 3, difficulty: 'easy',
        players: [{name:'玩家',isHuman:true},{name:'AI1',isHuman:false},{name:'AI2',isHuman:false}],
        finalScores: [200, -100, -100], humanIndex: 0,
        roundDetails: [],
    });
    TournamentStorage.saveRecord({
        totalRounds: 3, difficulty: 'easy',
        players: [{name:'玩家',isHuman:true},{name:'AI1',isHuman:false},{name:'AI2',isHuman:false}],
        finalScores: [-50, 100, -50], humanIndex: 0,
        roundDetails: [],
    });
    TournamentStorage.saveRecord({
        totalRounds: 3, difficulty: 'easy',
        players: [{name:'玩家',isHuman:true},{name:'AI1',isHuman:false},{name:'AI2',isHuman:false}],
        finalScores: [300, -150, -150], humanIndex: 0,
        roundDetails: [],
    });

    const stats = TournamentStorage.getStats();
    assertEq(stats.totalPlayed, 3, 'totalPlayed should be 3');
    assertEq(stats.championCount, 2, 'championCount should be 2');
    assertEq(stats.highestScore, 300, 'highestScore should be 300');
    assertEq(stats.bestRank, 1, 'bestRank should be 1');
});

test('TournamentStorage 最多保存20条', () => {
    localStorage.clear();
    for (let i = 0; i < 25; i++) {
        TournamentStorage.saveRecord({
            totalRounds: 3, difficulty: 'easy',
            players: [{name:'玩家',isHuman:true},{name:'AI1',isHuman:false},{name:'AI2',isHuman:false}],
            finalScores: [i, -i/2, -i/2], humanIndex: 0,
            roundDetails: [],
        });
    }
    const records = TournamentStorage.getRecords();
    assertEq(records.length, 20, 'should cap at 20 records');
    assertEq(records[0].playerScore, 24, 'most recent should be first');
});

test('中途返回后状态清理', async () => {
    const mode = createMode(5);
    await mode.init();
    mode.onRoundEnd({ scores: [100, -50, -50], winnerIndex: 0, isLandlordWin: true, springType: null, multiplier: 1 });
    assertEq(mode.roundResults.length, 1, 'should have 1 round');

    // 模拟清理（如 showMenu 中的 destroy）
    mode.destroy();
    assertEq(mode.isRunning, false, 'mode should not be running after destroy');
});

test('自定义轮数范围校验', async () => {
    const mode1 = createMode(2);
    await mode1.init();
    assertEq(mode1.totalRounds, 2, 'min rounds should work');

    const mode2 = createMode(50);
    await mode2.init();
    assertEq(mode2.totalRounds, 50, 'max rounds should work');
});

// 总结
console.log(`\n锦标赛测试完成: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);

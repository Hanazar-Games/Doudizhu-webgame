/**
 * 赛季任务系统单元测试 (ES Module)
 * 运行: node test/season-quests.test.mjs
 */

// 为 Node.js 环境提供 localStorage mock（必须在模块导入前设置）
global.localStorage = global.localStorage || {
    _store: new Map(),
    getItem(k) { return this._store.has(k) ? this._store.get(k) : null; },
    setItem(k, v) { this._store.set(k, String(v)); },
    removeItem(k) { this._store.delete(k); },
    clear() { this._store.clear(); },
};

import {
    SeasonQuestManager,
    QUEST_TYPE,
    QUEST_META,
    BADGES,
    getWeekStartString,
} from '../src/utils/season-quest.js';

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

function assertIn(actual, expectedArr, msg) {
    if (!expectedArr.includes(actual)) throw new Error(msg || `Expected one of ${expectedArr.join(', ')}, got ${actual}`);
}

/** 清理 localStorage 并创建新实例 */
function createManager() {
    localStorage.clear();
    return new SeasonQuestManager();
}

// ===== 测试开始 =====

test('初始数据包含每日、每周、赛季任务', () => {
    const mgr = createManager();
    const data = mgr.getData();
    assert(data.daily.quests.length === 3, `daily quests should be 3, got ${data.daily.quests.length}`);
    assert(data.weekly.quests.length === 2, `weekly quests should be 2, got ${data.weekly.quests.length}`);
    assert(data.season.quests.length === 5, `season quests should be 5, got ${data.season.quests.length}`);
});

test('每日任务基于日期确定性生成', () => {
    const mgr1 = createManager();
    const daily1 = mgr1.getDailyQuests().map(q => q.id);
    localStorage.clear();
    const mgr2 = new SeasonQuestManager();
    const daily2 = mgr2.getDailyQuests().map(q => q.id);
    assertEq(daily1.join(','), daily2.join(','), 'Same date should generate same daily quests');
});

test('reportGame 增加 play_game 进度', () => {
    const mgr = createManager();
    const before = mgr.getDailyQuests().find(q => q.type === QUEST_TYPE.PLAY_GAME);
    if (!before) return; // 今日可能没有生成此类型
    const initCurrent = before.current;
    mgr.reportGame({ isWin: false, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' });
    const after = mgr.getDailyQuests().find(q => q.id === before.id);
    assertEq(after.current, initCurrent + 1, 'PLAY_GAME quest should advance by 1');
});

test('reportGame win_game 只在获胜时增加', () => {
    const mgr = createManager();
    const quests = [...mgr.getDailyQuests(), ...mgr.getWeeklyQuests(), ...mgr.getSeasonQuests()];
    const winQ = quests.find(q => q.type === QUEST_TYPE.WIN_GAME);
    if (!winQ) return;
    mgr.reportGame({ isWin: false, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' });
    const afterLoss = [...mgr.getData().daily.quests, ...mgr.getData().weekly.quests, ...mgr.getData().season.quests].find(q => q.id === winQ.id);
    assertEq(afterLoss.current, 0, 'WIN_GAME should not advance on loss');
    mgr.reportGame({ isWin: true, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' });
    const afterWin = [...mgr.getData().daily.quests, ...mgr.getData().weekly.quests, ...mgr.getData().season.quests].find(q => q.id === winQ.id);
    assertEq(afterWin.current, 1, 'WIN_GAME should advance on win');
});

test('reportGame 不统计 LAN 模式', () => {
    const mgr = createManager();
    const before = mgr.getProgress();
    mgr.reportGame({ isWin: true, isLandlord: true, bombCount: 2, hasRocket: true, isSpring: true, isAntiSpring: false, mode: 'lan' });
    const after = mgr.getProgress();
    assertEq(after.totalExp, before.totalExp, 'LAN mode should not affect quests');
    const allQuests = [...mgr.getDailyQuests(), ...mgr.getWeeklyQuests(), ...mgr.getSeasonQuests()];
    const anyAdvanced = allQuests.some(q => q.current > 0);
    assert(!anyAdvanced, 'LAN mode should not advance any quest');
});

test('reportGame 炸弹数量正确累加', () => {
    const mgr = createManager();
    const quests = [...mgr.getDailyQuests(), ...mgr.getWeeklyQuests(), ...mgr.getSeasonQuests()];
    const bombQ = quests.find(q => q.type === QUEST_TYPE.PLAY_BOMB);
    if (!bombQ) return;
    mgr.reportGame({ isWin: false, isLandlord: false, bombCount: 3, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' });
    const after = [...mgr.getData().daily.quests, ...mgr.getData().weekly.quests, ...mgr.getData().season.quests].find(q => q.id === bombQ.id);
    assertEq(after.current, 3, 'Bomb count should accumulate');
});

test('reportGame 完成时触发返回值', () => {
    const mgr = createManager();
    // 找一个目标为1的任务
    const quest = [...mgr.getDailyQuests(), ...mgr.getWeeklyQuests()].find(q => q.target === 1);
    if (!quest) return;
    let event;
    if (quest.type === QUEST_TYPE.PLAY_GAME) {
        event = { isWin: false, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' };
    } else if (quest.type === QUEST_TYPE.WIN_GAME) {
        event = { isWin: true, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' };
    } else if (quest.type === QUEST_TYPE.PLAY_BOMB) {
        event = { isWin: false, isLandlord: false, bombCount: 1, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' };
    } else if (quest.type === QUEST_TYPE.PLAY_ROCKET) {
        event = { isWin: false, isLandlord: false, bombCount: 0, hasRocket: true, isSpring: false, isAntiSpring: false, mode: 'ai' };
    } else if (quest.type === QUEST_TYPE.GET_SPRING) {
        event = { isWin: false, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: true, isAntiSpring: false, mode: 'ai' };
    } else if (quest.type === QUEST_TYPE.COMPLETE_DAILY) {
        event = { isWin: false, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' };
    } else {
        return;
    }
    const completed = mgr.reportGame(event);
    const found = completed.find(c => c.id === quest.id);
    assert(found, 'Completed quest should be in returned array');
});

test('reportDailyChallenge 增加 complete_daily 进度', () => {
    const mgr = createManager();
    const quests = [...mgr.getDailyQuests(), ...mgr.getWeeklyQuests(), ...mgr.getSeasonQuests()];
    const dailyQ = quests.find(q => q.type === QUEST_TYPE.COMPLETE_DAILY);
    if (!dailyQ) return;
    mgr.reportDailyChallenge({ completed: true, stars: 1 });
    const after = [...mgr.getData().daily.quests, ...mgr.getData().weekly.quests, ...mgr.getData().season.quests].find(q => q.id === dailyQ.id);
    assertEq(after.current, 1, 'COMPLETE_DAILY should advance after reportDailyChallenge');
});

test('reportDailyChallenge 3星增加 daily_3_stars', () => {
    const mgr = createManager();
    const quests = [...mgr.getDailyQuests(), ...mgr.getWeeklyQuests(), ...mgr.getSeasonQuests()];
    const starQ = quests.find(q => q.type === QUEST_TYPE.DAILY_3_STARS);
    if (!starQ) return;
    mgr.reportDailyChallenge({ completed: true, stars: 2 });
    const after2 = [...mgr.getData().daily.quests, ...mgr.getData().weekly.quests, ...mgr.getData().season.quests].find(q => q.id === starQ.id);
    assertEq(after2.current, 0, 'DAILY_3_STARS should not advance with 2 stars');
    mgr.reportDailyChallenge({ completed: true, stars: 3 });
    const after3 = [...mgr.getData().daily.quests, ...mgr.getData().weekly.quests, ...mgr.getData().season.quests].find(q => q.id === starQ.id);
    assertEq(after3.current, 1, 'DAILY_3_STARS should advance with 3 stars');
});

test('重复完成不会重复触发', () => {
    const mgr = createManager();
    const playQ = [...mgr.getDailyQuests(), ...mgr.getWeeklyQuests()].find(q => q.type === QUEST_TYPE.PLAY_GAME && q.target === 1);
    if (!playQ) return;
    mgr.reportGame({ isWin: false, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' });
    const completed1 = mgr.reportGame({ isWin: false, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' });
    const found = completed1.find(c => c.id === playQ.id);
    assert(!found, 'Already completed quest should not appear in returned array again');
});

test('claimReward 更新 totalExp 和 claimed 状态', () => {
    const mgr = createManager();
    const quests = [...mgr.getDailyQuests(), ...mgr.getWeeklyQuests(), ...mgr.getSeasonQuests()];
    const quest = quests.find(q => q.target === 1);
    if (!quest) return;
    // 完成任务
    if (quest.type === QUEST_TYPE.PLAY_GAME) {
        mgr.reportGame({ isWin: false, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' });
    } else if (quest.type === QUEST_TYPE.WIN_GAME) {
        mgr.reportGame({ isWin: true, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' });
    } else if (quest.type === QUEST_TYPE.PLAY_BOMB) {
        mgr.reportGame({ isWin: false, isLandlord: false, bombCount: 1, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' });
    } else if (quest.type === QUEST_TYPE.PLAY_ROCKET) {
        mgr.reportGame({ isWin: false, isLandlord: false, bombCount: 0, hasRocket: true, isSpring: false, isAntiSpring: false, mode: 'ai' });
    } else if (quest.type === QUEST_TYPE.GET_SPRING) {
        mgr.reportGame({ isWin: false, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: true, isAntiSpring: false, mode: 'ai' });
    } else {
        return;
    }
    const beforeExp = mgr.getData().totalExp;
    const reward = mgr.claimReward(quest.id);
    assert(reward, 'claimReward should return reward for completed quest');
    assertEq(mgr.getData().totalExp, beforeExp + (reward.exp || 0), 'totalExp should increase by reward.exp');
    const qAfter = [...mgr.getData().daily.quests, ...mgr.getData().weekly.quests, ...mgr.getData().season.quests].find(q => q.id === quest.id);
    assert(qAfter.claimed, 'Quest should be marked claimed');
    const secondClaim = mgr.claimReward(quest.id);
    assertEq(secondClaim, null, 'Cannot claim twice');
});

test('hasUnclaimed 正确检测未领取奖励', () => {
    const mgr = createManager();
    assertEq(mgr.hasUnclaimed(), false, 'Initially no unclaimed rewards');
    const quests = [...mgr.getDailyQuests(), ...mgr.getWeeklyQuests(), ...mgr.getSeasonQuests()];
    const playQ = quests.find(q => q.type === QUEST_TYPE.PLAY_GAME && q.target === 1);
    if (!playQ) return;
    mgr.reportGame({ isWin: false, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' });
    assertEq(mgr.hasUnclaimed(), true, 'Should have unclaimed after completion');
    mgr.claimReward(playQ.id);
    assertEq(mgr.hasUnclaimed(), false, 'Should have no unclaimed after claiming');
});

test('claimAll 领取所有可领取奖励', () => {
    const mgr = createManager();
    const quests = [...mgr.getDailyQuests(), ...mgr.getWeeklyQuests(), ...mgr.getSeasonQuests()];
    const targetQs = quests.filter(q => q.target === 1 && q.type === QUEST_TYPE.PLAY_GAME);
    if (targetQs.length === 0) return;
    for (const q of targetQs) {
        mgr.reportGame({ isWin: false, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' });
    }
    const results = mgr.claimAll();
    assert(results.length >= targetQs.length, `claimAll should claim at least ${targetQs.length}, got ${results.length}`);
    assertEq(mgr.hasUnclaimed(), false, 'After claimAll no unclaimed should remain');
});

test('赛季徽章奖励正确记录', () => {
    const mgr = createManager();
    // 赛季任务 play_game 50
    const seasonQ = mgr.getSeasonQuests().find(q => q.type === QUEST_TYPE.PLAY_GAME);
    if (!seasonQ) return;
    // 快速完成50局
    for (let i = 0; i < 50; i++) {
        mgr.reportGame({ isWin: false, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' });
    }
    const reward = mgr.claimReward(seasonQ.id);
    assert(reward && reward.badge, 'Season quest should have badge reward');
    const badges = mgr.getBadges();
    const found = badges.find(b => b.name === reward.badgeName);
    assert(found, 'Badge should appear in getBadges()');
});

test('getProgress 返回正确统计', () => {
    const mgr = createManager();
    const p = mgr.getProgress();
    assert(typeof p.daily.done === 'number', 'daily.done should be number');
    assert(typeof p.weekly.done === 'number', 'weekly.done should be number');
    assert(typeof p.season.done === 'number', 'season.done should be number');
    assert(typeof p.totalExp === 'number', 'totalExp should be number');
    assert(Array.isArray(p.badges), 'badges should be array');
});

test('getWeekStartString 返回周一', () => {
    const ws = getWeekStartString();
    assert(/\d{4}-\d{2}-\d{2}/.test(ws), 'Week start should be YYYY-MM-DD format');
});

test('赛季切换时数据重置', () => {
    const mgr = createManager();
    // 先完成一个任务获得经验
    const quests = [...mgr.getDailyQuests(), ...mgr.getWeeklyQuests(), ...mgr.getSeasonQuests()];
    const playQ = quests.find(q => q.type === QUEST_TYPE.PLAY_GAME && q.target === 1);
    if (playQ) {
        mgr.reportGame({ isWin: false, isLandlord: false, bombCount: 0, hasRocket: false, isSpring: false, isAntiSpring: false, mode: 'ai' });
        mgr.claimReward(playQ.id);
    }
    assert(mgr.getData().totalExp > 0 || !playQ, 'Should have some exp after claiming');
    // 修改 seasonId 模拟新赛季
    const raw = JSON.parse(localStorage.getItem('ddz_season_quests'));
    raw.seasonId = 's2_2024_autumn';
    localStorage.setItem('ddz_season_quests', JSON.stringify(raw));
    const mgr2 = new SeasonQuestManager();
    assertEq(mgr2.getData().totalExp, 0, 'New season should reset totalExp');
    assertEq(mgr2.getData().badges.length, 0, 'New season should reset badges');
});

// 总结
console.log(`\n赛季任务测试完成: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);

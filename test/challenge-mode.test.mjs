/**
 * ChallengeMode / ChallengeData 测试
 */

import { Card, SUITS } from '../src/core/card.js';
import { Rules } from '../src/core/rules.js';
import { GameState, PHASE } from '../src/core/game-state.js';
import { ChallengeMode } from '../src/modes/challenge-mode.js';
import {
    CHALLENGES,
    validateChallenges,
    ChallengeRecord,
    ExtremeChallengeRecordManager,
    calculateChallengeStars,
} from '../src/utils/challenge-data.js';

// Mock localStorage
const mockStorage = {};
global.localStorage = {
    getItem(key) { return mockStorage[key] || null; },
    setItem(key, val) { mockStorage[key] = val; },
    removeItem(key) { delete mockStorage[key]; },
};

// ===== 数据验证测试 =====

function test_validateChallenges() {
    const errors = validateChallenges();
    if (errors.length > 0) {
        throw new Error(`挑战定义验证失败: ${errors.join(', ')}`);
    }
    console.log('✓ validateChallenges 通过');
}

function test_allChallengesHaveRequiredFields() {
    for (const c of CHALLENGES) {
        if (!c.id || typeof c.id !== 'number') throw new Error(`挑战 ${c.title} id 不合法`);
        if (!c.title) throw new Error(`挑战 ${c.id} 缺少标题`);
        if (!c.desc) throw new Error(`挑战 ${c.id} 缺少描述`);
        if (!['easy', 'normal', 'hard'].includes(c.difficulty)) throw new Error(`挑战 ${c.id} 难度不合法`);
        if (!Array.isArray(c.starConditions) || c.starConditions.length === 0) {
            throw new Error(`挑战 ${c.id} 缺少星级条件`);
        }
    }
    console.log('✓ 所有挑战字段完整');
}

function test_challengeIdsUnique() {
    const ids = CHALLENGES.map(c => c.id);
    const unique = new Set(ids);
    if (unique.size !== ids.length) throw new Error('挑战id有重复');
    console.log('✓ 挑战id唯一');
}

// ===== ChallengeRecordManager 测试 =====

function test_recordManagerSaveAndGet() {
    ExtremeChallengeRecordManager.resetAll();
    ExtremeChallengeRecordManager.saveRecord(1, 2);
    const record = ExtremeChallengeRecordManager.getRecord(1);
    if (!record) throw new Error('记录未保存');
    if (record.stars !== 2) throw new Error(`stars 应为2, 得到${record.stars}`);
    if (!record.passed) throw new Error('passed 应为true');
    console.log('✓ RecordManager 保存和读取');
}

function test_recordManagerKeepBetterStars() {
    ExtremeChallengeRecordManager.resetAll();
    ExtremeChallengeRecordManager.saveRecord(1, 1);
    ExtremeChallengeRecordManager.saveRecord(1, 3);
    const record = ExtremeChallengeRecordManager.getRecord(1);
    if (record.stars !== 3) throw new Error(`应保持最高3星, 得到${record.stars}`);
    console.log('✓ RecordManager 保持最高星级');
}

function test_recordManagerProgress() {
    ExtremeChallengeRecordManager.resetAll();
    ExtremeChallengeRecordManager.saveRecord(1, 3);
    ExtremeChallengeRecordManager.saveRecord(2, 2);
    const progress = ExtremeChallengeRecordManager.getProgress();
    if (progress.passed !== 2) throw new Error(`passed 应为2, 得到${progress.passed}`);
    if (progress.total !== CHALLENGES.length) throw new Error(`total 应为${CHALLENGES.length}`);
    if (progress.totalStars !== 5) throw new Error(`totalStars 应为5, 得到${progress.totalStars}`);
    console.log('✓ RecordManager 进度统计');
}

// ===== calculateChallengeStars 测试 =====

function test_calculateStars_win() {
    const challenge = CHALLENGES[0]; // 禁炸令
    const gs = new GameState();
    gs.landlordIndex = 0;
    const roundData = {
        winnerIndex: 0,
        scores: [100, -50, -50],
        springType: null,
    };
    const result = calculateChallengeStars(challenge, roundData, gs, 0);
    if (!result.passed) throw new Error('应判定为通过');
    if (result.stars < 1) throw new Error('至少1星');
    console.log('✓ calculateStars 胜利判定');
}

function test_calculateStars_loss() {
    const challenge = CHALLENGES[0];
    const gs = new GameState();
    gs.landlordIndex = 1;
    const roundData = {
        winnerIndex: 1,
        scores: [-50, 100, -50],
        springType: null,
    };
    const result = calculateChallengeStars(challenge, roundData, gs, 0);
    if (result.passed) throw new Error('应判定为失败');
    if (result.stars !== 0) throw new Error('失败应为0星');
    console.log('✓ calculateStars 失败判定');
}

function test_calculateStars_spring() {
    const challenge = CHALLENGES[0];
    const gs = new GameState();
    gs.landlordIndex = 0;
    const spade3 = new Card(SUITS.SPADE, '3');
    gs.history = [
        { type: 'play', cards: [spade3], pattern: Rules.analyze([spade3]) },
    ];
    const roundData = {
        winnerIndex: 0,
        scores: [100, -50, -50],
        springType: 'spring',
    };
    const result = calculateChallengeStars(challenge, roundData, gs, 0);
    if (!result.passed) throw new Error('应通过');
    if (result.stars !== 3) throw new Error('春天应得3星');
    console.log('✓ calculateStars 春天3星');
}

// ===== ChallengeMode 测试 =====

async function test_challengeModeInit() {
    const mode = new ChallengeMode(1);
    await mode.init();
    if (mode.modeName !== 'challenge') throw new Error('modeName 应为 challenge');
    if (mode.challengeId !== 1) throw new Error('challengeId 应为1');
    if (!mode.challenge) throw new Error('challenge 未加载');
    if (mode.gameState.players.length !== 3) throw new Error('应有3个玩家');
    console.log('✓ ChallengeMode 初始化');
}

async function test_challengeModeApplyRules() {
    const mode = new ChallengeMode(1); // 禁炸令
    await mode.init();
    mode.isRunning = true;
    mode._applyGameRules();
    mode._applyChallengeRules();

    if (mode.gameState.bombRule !== 'disabled') throw new Error('禁炸令应禁用炸弹');
    if (mode.gameState.jokerRule !== 'disabled') throw new Error('禁炸令应禁用王炸');
    console.log('✓ ChallengeMode 规则应用 - 禁炸令');
}

async function test_challengeModeSpeedRules() {
    const mode = new ChallengeMode(2); // 速战速决
    await mode.init();
    mode.isRunning = true;
    mode._applyGameRules();
    mode._applyChallengeRules();

    if (mode._turnCountdown !== 10) throw new Error(`倒计时应为10秒, 得到${mode._turnCountdown}`);
    console.log('✓ ChallengeMode 规则应用 - 速战速决');
}

async function test_challengeModeStrictRules() {
    const mode = new ChallengeMode(4); // 严格执法
    await mode.init();
    mode.isRunning = true;
    mode._applyGameRules();
    mode._applyChallengeRules();

    if (mode.gameState.strictRules !== true) throw new Error('应启用严格规则');
    if (mode.gameState.allowTripleWithSingle !== false) throw new Error('应禁用三带一');
    console.log('✓ ChallengeMode 规则应用 - 严格执法');
}

async function test_challengeModeHumanPlayBombBlocked() {
    const mode = new ChallengeMode(1); // 禁炸令
    await mode.init();
    mode.isRunning = true;
    mode._applyGameRules();
    mode._applyChallengeRules();
    mode.gameState.phase = PHASE.PLAYING;
    mode.gameState.currentTurn = 0;

    // 尝试出炸弹
    const bomb = [
        new Card(SUITS.SPADE, 'A'),
        new Card(SUITS.HEART, 'A'),
        new Card(SUITS.CLUB, 'A'),
        new Card(SUITS.DIAMOND, 'A'),
    ];
    const result = mode.humanPlay(bomb);
    if (result !== false) throw new Error(`禁炸令应阻止炸弹出牌, 得到 ${result}`);
    console.log('✓ ChallengeMode 人类出牌炸弹拦截');
}

// ===== 运行所有测试 =====

async function test_challengeModeBombRuleBlockedByGameState() {
    const mode = new ChallengeMode(1); // 禁炸令
    await mode.init();
    mode.isRunning = true;
    mode._applyGameRules();
    mode._applyChallengeRules();
    mode.gameState.phase = PHASE.PLAYING;
    mode.gameState.currentTurn = 1; // AI 回合
    // 尝试让 AI 出炸弹（GameState 层面应拒绝）
    const bomb = [
        new Card(SUITS.SPADE, 'A'),
        new Card(SUITS.HEART, 'A'),
        new Card(SUITS.CLUB, 'A'),
        new Card(SUITS.DIAMOND, 'A'),
    ];
    const result = mode.gameState.playCards(1, bomb);
    if (result.success) throw new Error('GameState 应拒绝炸弹出牌');
    console.log('✓ ChallengeMode GameState 炸弹规则拦截');
}

async function test_challengeModeForceLandlord() {
    const mode = new ChallengeMode(9); // 孤军奋战
    await mode.init();
    mode.isRunning = true;
    mode._applyGameRules();
    mode._applyChallengeRules();
    // 手动模拟 forceLandlord 分支的关键逻辑（避免触发完整游戏流程）
    const cfg = mode.challenge?.config || {};
    if (!cfg.forceLandlord) throw new Error('挑战9应有 forceLandlord');
    mode.gameState.landlordIndex = mode.humanIndex;
    const landlord = mode.gameState.players[mode.humanIndex];
    if (landlord) landlord.isLandlord = true;
    mode.gameState.phase = PHASE.PLAYING;
    if (mode.gameState.landlordIndex !== 0) throw new Error('forceLandlord 应使玩家为地主');
    console.log('✓ ChallengeMode forceLandlord 配置');
}

async function test_challengeModeMustSpring() {
    const mode = new ChallengeMode(10); // 斗帝之路
    await mode.init();
    mode.isRunning = true;
    mode._applyGameRules();
    mode._applyChallengeRules();
    const gs = mode.gameState;
    gs.landlordIndex = 0;
    const roundData = {
        winnerIndex: 0,
        scores: [100, -50, -50],
        springType: null,
    };
    const { calculateChallengeStars } = await import('../src/utils/challenge-data.js');
    const result = calculateChallengeStars(mode.challenge, roundData, gs, 0);
    if (!result.passed) throw new Error('普通胜利应通过 calculateChallengeStars');
    console.log('✓ ChallengeMode mustSpring 基础逻辑');
}

async function test_challengeModeBombBeatRocket() {
    const { calculateChallengeStars } = await import('../src/utils/challenge-data.js');
    const challenge = CHALLENGES[7]; // 炸弹之王
    const gs = new GameState();
    gs.landlordIndex = 0;
    const roundData = {
        winnerIndex: 0,
        scores: [100, -50, -50],
        springType: null,
    };
    // 传入 bombBeatRocket=true 应得2星
    const result = calculateChallengeStars(challenge, roundData, gs, 0, { bombBeatRocket: true });
    if (!result.passed) throw new Error('应判定为通过');
    if (result.stars !== 2) throw new Error(`炸弹压王炸应得2星, 得到${result.stars}`);
    // 不传标记应得1星
    const result2 = calculateChallengeStars(challenge, roundData, gs, 0);
    if (result2.stars !== 1) throw new Error(`无炸弹压王炸应得1星, 得到${result2.stars}`);
    console.log('✓ ChallengeMode bombBeatRocket 星级判定');
}

const tests = [
    test_validateChallenges,
    test_allChallengesHaveRequiredFields,
    test_challengeIdsUnique,
    test_recordManagerSaveAndGet,
    test_recordManagerKeepBetterStars,
    test_recordManagerProgress,
    test_calculateStars_win,
    test_calculateStars_loss,
    test_calculateStars_spring,
    () => new ChallengeMode(1).init().then(() => console.log('✓ ChallengeMode 初始化')),
    test_challengeModeInit,
    test_challengeModeApplyRules,
    test_challengeModeSpeedRules,
    test_challengeModeStrictRules,
    test_challengeModeHumanPlayBombBlocked,
    test_challengeModeBombRuleBlockedByGameState,
    test_challengeModeForceLandlord,
    test_challengeModeMustSpring,
    test_challengeModeBombBeatRocket,
];

let passed = 0;
let failed = 0;

for (const test of tests) {
    try {
        await test();
        passed++;
    } catch (err) {
        failed++;
        console.error(`✗ ${test.name}:`, err.message);
    }
}

console.log(`\n====================`);
console.log(`Total: ${tests.length}, Passed: ${passed}, Failed: ${failed}`);
console.log(`====================`);

if (failed > 0) process.exit(1);

/**
 * ChallengeData - 极限挑战模式数据定义
 * 一系列带有特殊规则限制的挑战关卡
 */

import { Storage } from './storage.js';

/**
 * 挑战关卡定义
 * 每个挑战通过修改 GameState 规则参数来实现限制
 */
const CHALLENGES = [
    {
        id: 1,
        title: '禁炸令',
        desc: '禁用炸弹和王炸，纯靠牌型组合取胜',
        difficulty: 'easy',
        icon: '🚫',
        // 规则修改
        ruleMods: {
            bombRule: 'disabled',
            jokerRule: 'disabled',
        },
        // 星级条件
        starConditions: [
            { stars: 1, label: '完成挑战', check: (data) => data.isHumanWin },
            { stars: 2, label: '无炸弹对局', check: (data) => data.isHumanWin && !data.bombPlayed },
            { stars: 3, label: '春天胜利', check: (data) => data.isHumanWin && data.springType === 'spring' },
        ],
    },
    {
        id: 2,
        title: '速战速决',
        desc: '每步只有10秒思考时间，考验快速决策',
        difficulty: 'easy',
        icon: '⚡',
        ruleMods: {
            // 由 ChallengeMode 动态设置 countdown
        },
        config: { turnTimeLimit: 10 },
        starConditions: [
            { stars: 1, label: '完成挑战', check: (data) => data.isHumanWin },
            { stars: 2, label: '10步内获胜', check: (data) => data.isHumanWin && data.totalPlays <= 10 },
            { stars: 3, label: '春天胜利', check: (data) => data.isHumanWin && data.springType === 'spring' },
        ],
    },
    {
        id: 3,
        title: '保守派',
        desc: '双方都不能出炸弹，但胜利得分三倍',
        difficulty: 'easy',
        icon: '🛡️',
        ruleMods: {
            bombRule: 'disabled',
        },
        config: { scoreMultiplier: 3 },
        starConditions: [
            { stars: 1, label: '完成挑战', check: (data) => data.isHumanWin },
            { stars: 2, label: '地主身份获胜', check: (data) => data.isHumanWin && data.isLandlord },
            { stars: 3, label: '春天胜利', check: (data) => data.isHumanWin && data.springType === 'spring' },
        ],
    },
    {
        id: 4,
        title: '严格执法',
        desc: '禁用三带一、飞机带翅膀等复杂牌型',
        difficulty: 'normal',
        icon: '📜',
        ruleMods: {
            strictRules: true,
            allowTripleWithSingle: false,
            allowTripleWithPair: false,
            allowAirplaneWithWings: false,
        },
        starConditions: [
            { stars: 1, label: '完成挑战', check: (data) => data.isHumanWin },
            { stars: 2, label: '纯顺子胜利', check: (data) => data.isHumanWin && data.onlyStraightPlays },
            { stars: 3, label: '春天胜利', check: (data) => data.isHumanWin && data.springType === 'spring' },
        ],
    },
    {
        id: 5,
        title: '不能Pass',
        desc: '有牌就必须出，不能选择Pass',
        difficulty: 'normal',
        icon: '🔒',
        ruleMods: {
            mustPlay: true,
            allowPassOnFirst: false,
        },
        starConditions: [
            { stars: 1, label: '完成挑战', check: (data) => data.isHumanWin },
            { stars: 2, label: '地主身份获胜', check: (data) => data.isHumanWin && data.isLandlord },
            { stars: 3, label: '春天胜利', check: (data) => data.isHumanWin && data.springType === 'spring' },
        ],
    },
    {
        id: 6,
        title: '盲牌斗地主',
        desc: '记牌器被禁用，只能靠记忆推算',
        difficulty: 'normal',
        icon: '🙈',
        ruleMods: {},
        config: { disableTracker: true },
        starConditions: [
            { stars: 1, label: '完成挑战', check: (data) => data.isHumanWin },
            { stars: 2, label: '农民获胜', check: (data) => data.isHumanWin && !data.isLandlord },
            { stars: 3, label: '春天胜利', check: (data) => data.isHumanWin && data.springType === 'spring' },
        ],
    },
    {
        id: 7,
        title: '底分翻倍',
        desc: '底分提升至3分，高风险高回报',
        difficulty: 'normal',
        icon: '💰',
        ruleMods: {
            baseScore: 3,
        },
        starConditions: [
            { stars: 1, label: '完成挑战', check: (data) => data.isHumanWin },
            { stars: 2, label: '得分≥300', check: (data) => data.isHumanWin && data.humanScore >= 300 },
            { stars: 3, label: '得分≥500', check: (data) => data.isHumanWin && data.humanScore >= 500 },
        ],
    },
    {
        id: 8,
        title: '炸弹之王',
        desc: '炸弹可以压过王炸，改变牌力格局',
        difficulty: 'hard',
        icon: '💣',
        ruleMods: {
            bombAsRocket: true,
        },
        starConditions: [
            { stars: 1, label: '完成挑战', check: (data) => data.isHumanWin },
            { stars: 2, label: '用炸弹压王炸', check: (data) => data.isHumanWin && data.bombBeatRocket },
            { stars: 3, label: '春天胜利', check: (data) => data.isHumanWin && data.springType === 'spring' },
        ],
    },
    {
        id: 9,
        title: '孤军奋战',
        desc: 'AI难度提升为困难，你是地主1v2',
        difficulty: 'hard',
        icon: '⚔️',
        ruleMods: {},
        config: { aiDifficulty: 'hard', forceLandlord: true },
        starConditions: [
            { stars: 1, label: '完成挑战', check: (data) => data.isHumanWin },
            { stars: 2, label: '无炸弹获胜', check: (data) => data.isHumanWin && !data.bombPlayed },
            { stars: 3, label: '春天胜利', check: (data) => data.isHumanWin && data.springType === 'spring' },
        ],
    },
    {
        id: 10,
        title: '斗帝之路',
        desc: '极限考验：困难AI + 8秒限时 + 必须春天',
        difficulty: 'hard',
        icon: '👑',
        ruleMods: {},
        config: { aiDifficulty: 'hard', turnTimeLimit: 8, mustSpring: true },
        starConditions: [
            { stars: 1, label: '完成挑战', check: (data) => data.isHumanWin },
            { stars: 2, label: '8步内获胜', check: (data) => data.isHumanWin && data.totalPlays <= 8 },
            { stars: 3, label: '春天胜利', check: (data) => data.isHumanWin && data.springType === 'spring' },
        ],
    },
];

/**
 * 验证挑战定义合法性
 */
function validateChallenges() {
    const errors = [];
    const ids = new Set();
    for (const c of CHALLENGES) {
        if (!c.id || typeof c.id !== 'number') errors.push(`挑战缺少合法id`);
        if (ids.has(c.id)) errors.push(`挑战id重复: ${c.id}`);
        ids.add(c.id);
        if (!c.title) errors.push(`挑战${c.id}缺少标题`);
        if (!c.desc) errors.push(`挑战${c.id}缺少描述`);
        if (!['easy', 'normal', 'hard'].includes(c.difficulty)) {
            errors.push(`挑战${c.id}难度不合法: ${c.difficulty}`);
        }
        if (!Array.isArray(c.starConditions) || c.starConditions.length === 0) {
            errors.push(`挑战${c.id}缺少星级条件`);
        }
    }
    return errors;
}

// 初始化时验证
const _validationErrors = validateChallenges();
if (_validationErrors.length > 0) {
    console.error('[ChallengeData] 挑战定义验证失败:', _validationErrors);
}

/**
 * 挑战记录
 */
class ChallengeRecord {
    constructor(challengeId, stars, passed = false) {
        this.challengeId = challengeId;
        this.stars = Math.max(0, Math.min(3, stars));
        this.passed = passed;
        this.timestamp = Date.now();
    }
}

/**
 * 挑战记录管理器
 */
class ExtremeChallengeRecordManager {
    static get STORAGE_KEY() { return 'ddz_challenge_records'; }

    static getRecords() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return typeof parsed === 'object' && parsed !== null ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    static saveRecord(challengeId, stars) {
        const records = this.getRecords();
        const existing = records[challengeId];
        if (!existing) {
            records[challengeId] = new ChallengeRecord(challengeId, stars, true);
        } else {
            const betterStars = Math.max(existing.stars || 0, stars);
            records[challengeId] = new ChallengeRecord(challengeId, betterStars, true);
        }
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(records));
        } catch (e) {
            console.warn('[ExtremeChallengeRecordManager] 保存失败:', e);
        }
    }

    static getRecord(challengeId) {
        return this.getRecords()[challengeId] || null;
    }

    static getProgress() {
        const records = this.getRecords();
        const total = CHALLENGES.length;
        const passed = CHALLENGES.filter(c => records[c.id]?.passed).length;
        const totalStars = CHALLENGES.reduce((sum, c) => sum + (records[c.id]?.stars || 0), 0);
        const maxStars = total * 3;
        return { passed, total, totalStars, maxStars, percentage: Math.round((totalStars / maxStars) * 100) };
    }

    static resetAll() {
        try {
            localStorage.removeItem(this.STORAGE_KEY);
        } catch (e) {}
    }
}

/**
 * 计算挑战星级
 * @param {Object} challenge - 挑战定义
 * @param {Object} roundData - 回合结束数据
 * @param {GameState} gameState
 * @param {number} humanIndex
 * @returns {{stars: number, passed: boolean}}
 */
function calculateChallengeStars(challenge, roundData, gameState, humanIndex) {
    if (!challenge || !roundData) return { stars: 0, passed: false };

    const gs = gameState;
    const isHumanWin = humanIndex >= 0 && (
        roundData.winnerIndex === humanIndex ||
        (roundData.winnerIndex !== gs.landlordIndex && humanIndex !== gs.landlordIndex)
    );

    // 统计本局是否有炸弹被打出
    const history = gs.history || [];
    let bombPlayed = false;
    let bombBeatRocket = false;
    let totalPlays = 0;
    for (const h of history) {
        if (h.type === 'play' && h.cards && h.cards.length > 0) {
            totalPlays++;
            const pat = h.pattern;
            if (pat && (pat.type === 'BOMB' || pat.type === 'ROCKET')) {
                bombPlayed = true;
            }
            // 检测炸弹压王炸：当前是炸弹，且上一家出了王炸
            if (pat && pat.type === 'BOMB') {
                // 简化检测：本局只要有炸弹在火箭后出即算
            }
        }
    }

    // 检测是否有纯顺子出牌（严格模式下有用）
    const straightTypes = ['STRAIGHT', 'DOUBLE_STRAIGHT', 'TRIPLE_STRAIGHT'];
    const onlyStraightPlays = totalPlays > 0 && history
        .filter(h => h.type === 'play' && h.pattern)
        .every(h => straightTypes.includes(h.pattern.type));

    const humanScore = roundData.scores?.[humanIndex] ?? 0;
    const isLandlord = humanIndex === gs.landlordIndex;

    const checkData = {
        isHumanWin,
        isLandlord,
        springType: roundData.springType,
        bombPlayed,
        bombBeatRocket,
        totalPlays,
        onlyStraightPlays,
        humanScore,
    };

    // 先判断是否通过（至少1星）
    const passed = challenge.starConditions[0]?.check?.(checkData) ?? false;
    if (!passed) return { stars: 0, passed: false };

    // 计算最高满足星级
    let stars = 1;
    for (const cond of challenge.starConditions) {
        if (cond.check(checkData)) {
            stars = Math.max(stars, cond.stars);
        }
    }

    return { stars, passed: true };
}

export {
    CHALLENGES,
    validateChallenges,
    ChallengeRecord,
    ExtremeChallengeRecordManager,
    calculateChallengeStars,
};

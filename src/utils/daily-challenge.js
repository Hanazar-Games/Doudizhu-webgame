/**
 * DailyChallenge - 每日挑战系统
 * 基于日期的确定性牌局生成器 + 星级评分 + 历史记录
 */

import { Card } from '../core/card.js';
import { Storage } from './storage.js';

/**
 * 简单的线性同余确定性随机数生成器
 * 相同 seed 永远产生相同序列
 */
class SeededRandom {
    constructor(seed) {
        this._seed = seed >>> 0;
    }

    next() {
        // LCG: a=9301, c=49297, m=233280 (经典参数)
        this._seed = (this._seed * 9301 + 49297) % 233280;
        return this._seed / 233280;
    }

    shuffle(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
}

/**
 * 获取今日日期字符串 (YYYY-MM-DD)
 */
function getTodayString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * 将日期字符串转为 seed 数字
 */
function dateToSeed(dateStr) {
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
        hash = ((hash << 5) - hash + dateStr.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) || 1;
}

/**
 * 每日挑战牌局数据
 */
class DailyChallenge {
    constructor(dateStr, deck, bottomCards, dealerIndex, difficulty) {
        this.date = dateStr;
        this.deck = deck;
        this.bottomCards = bottomCards;
        this.dealerIndex = dealerIndex;
        this.difficulty = difficulty;
        this.id = `daily_${dateStr}`;
    }
}

/**
 * 每日挑战生成器
 */
const DailyChallengeGenerator = {
    /**
     * 生成指定日期的挑战牌局
     */
    generate(dateStr = getTodayString()) {
        const seed = dateToSeed(dateStr);
        const rng = new SeededRandom(seed);

        // 固定难度随日期轮换: easy / normal / hard 循环
        const difficulties = ['easy', 'normal', 'hard'];
        const difficulty = difficulties[seed % difficulties.length];

        // 创建并洗牌
        const deck = Card.createDeck();
        const shuffled = rng.shuffle(deck);

        // 发牌: 前51张分3人，后3张底牌
        const playerDeck = shuffled.slice(0, 51);
        const bottomCards = shuffled.slice(51, 54);

        // 随机发牌起始位 (0/1/2)
        const dealerIndex = seed % 3;

        return new DailyChallenge(dateStr, playerDeck, bottomCards, dealerIndex, difficulty);
    },

    /**
     * 获取今日挑战
     */
    getToday() {
        return this.generate(getTodayString());
    },

    /**
     * 获取指定日期的挑战
     */
    getByDate(dateStr) {
        return this.generate(dateStr);
    },
};

/**
 * 星级评分计算
 * @param {Object} roundData - onRoundEnd 数据
 * @param {number} humanIndex - 人类玩家索引
 * @param {number} bombCount - 人类玩家本局打出的炸弹数
 * @returns {number} 1-3
 */
function calculateStars(roundData, humanIndex, bombCount = 0) {
    const isHumanWin = roundData.winnerIndex === humanIndex ||
        (roundData.winnerIndex !== roundData.landlordIndex && humanIndex !== roundData.landlordIndex);

    if (!isHumanWin) return 0;

    // 1星: 获胜
    let stars = 1;

    // 2星: 春天/反春天获胜
    if (roundData.springType === 'spring' || roundData.springType === 'anti_spring') {
        stars = 2;
    }

    // 3星: 春天获胜 + 人类玩家未出炸弹（纯靠牌技碾压）
    if (roundData.springType === 'spring' && bombCount === 0) {
        stars = 3;
    }

    return stars;
}

/**
 * 挑战结果对象
 */
class ChallengeResult {
    constructor(dateStr, stars, score, isWin, springType, bombCount, timestamp) {
        this.date = dateStr;
        this.stars = stars;
        this.score = score;
        this.isWin = isWin;
        this.springType = springType;
        this.bombCount = bombCount;
        this.timestamp = timestamp || Date.now();
    }
}

/**
 * 挑战记录管理器
 */
const ChallengeRecordManager = {
    _key: 'ddz_daily_challenge_records',

    getRecords() {
        try {
            const raw = localStorage.getItem(this._key);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            // 只保留最近30天
            const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
            return parsed.filter(r => r.timestamp > cutoff);
        } catch {
            return [];
        }
    },

    saveRecord(result) {
        const records = this.getRecords();
        // 同日期只保留最佳成绩（最高星级，同星级取更高分数）
        const existingIndex = records.findIndex(r => r.date === result.date);
        if (existingIndex >= 0) {
            const existing = records[existingIndex];
            if (result.stars > existing.stars ||
                (result.stars === existing.stars && result.score > existing.score)) {
                records[existingIndex] = result;
            }
        } else {
            records.push(result);
        }
        // 按时间倒序
        records.sort((a, b) => b.timestamp - a.timestamp);
        try {
            localStorage.setItem(this._key, JSON.stringify(records));
        } catch (e) {
            console.warn('保存每日挑战记录失败:', e);
        }
    },

    getBestRecord(dateStr) {
        return this.getRecords().find(r => r.date === dateStr) || null;
    },

    getTodayBest() {
        return this.getBestRecord(getTodayString());
    },

    getStats() {
        const records = this.getRecords();
        const total = records.length;
        const wins = records.filter(r => r.isWin).length;
        const threeStars = records.filter(r => r.stars === 3).length;
        const streak = this._calcStreak(records);
        return { total, wins, threeStars, streak };
    },

    _calcStreak(records) {
        // 计算连续获胜天数（从今天往前数）
        const today = new Date();
        let streak = 0;
        for (let i = 0; i < 30; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const rec = records.find(r => r.date === ds);
            if (rec && rec.isWin) {
                streak++;
            } else if (i === 0) {
                // 今天还没玩不算断
                continue;
            } else {
                break;
            }
        }
        return streak;
    },

    clear() {
        localStorage.removeItem(this._key);
    },
};

export {
    SeededRandom,
    DailyChallenge,
    DailyChallengeGenerator,
    ChallengeResult,
    ChallengeRecordManager,
    calculateStars,
    getTodayString,
    dateToSeed,
};

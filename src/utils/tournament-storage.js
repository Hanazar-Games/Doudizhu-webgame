/**
 * TournamentStorage - 锦标赛记录存储
 * 保存最近 20 次锦标赛记录，支持统计查询
 */

const PREFIX = 'ddz_';
const STORAGE_KEY = PREFIX + 'tournament_records';
const MAX_RECORDS = 20;

/**
 * @typedef {Object} TournamentRoundDetail
 * @property {number} round - 轮次
 * @property {number[]} scores - 本局得分
 * @property {number[]} cumulativeScores - 累计得分
 * @property {number} landlordIndex - 地主索引
 * @property {number} winnerIndex - 获胜者索引
 * @property {boolean} isHumanWin - 人类是否获胜
 * @property {string|null} springType - 春天类型
 * @property {number} multiplier - 倍数
 */

/**
 * @typedef {Object} TournamentRecord
 * @property {string} id - 记录ID
 * @property {string} date - ISO日期字符串
 * @property {number} totalRounds - 总局数
 * @property {string} difficulty - 难度
 * @property {Object[]} finalRankings - 最终排名 [{name, score, rank, isHuman}]
 * @property {number} playerRank - 玩家排名 (1-based)
 * @property {number} playerScore - 玩家总分
 * @property {boolean} isChampion - 是否冠军
 * @property {TournamentRoundDetail[]} roundDetails - 每轮详情
 */

class TournamentStorage {
    static _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {
            console.warn('锦标赛记录加载失败:', e);
        }
        return [];
    }

    static _save(records) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
        } catch (e) {
            console.warn('锦标赛记录保存失败:', e);
        }
    }

    /**
     * 保存一次锦标赛记录
     * @param {Object} data
     * @param {number} data.totalRounds
     * @param {string} data.difficulty
     * @param {Object[]} data.players - [{name, isHuman}]
     * @param {number[]} data.finalScores
     * @param {TournamentRoundDetail[]} data.roundDetails
     * @param {number} data.humanIndex
     */
    static saveRecord(data) {
        const records = this._load();
        const { players, finalScores, humanIndex, totalRounds, difficulty, roundDetails } = data;

        // 计算排名
        const sorted = finalScores
            .map((score, i) => ({ score, index: i, name: players[i]?.name || '?', isHuman: i === humanIndex }))
            .sort((a, b) => b.score - a.score);

        const playerRank = sorted.findIndex(p => p.isHuman) + 1;
        const playerScore = finalScores[humanIndex] ?? 0;
        const isChampion = playerRank === 1;

        const finalRankings = sorted.map((p, i) => ({
            name: p.name,
            score: p.score,
            rank: i + 1,
            isHuman: p.isHuman,
        }));

        const record = {
            id: 'tour_' + Date.now(),
            date: new Date().toISOString(),
            totalRounds,
            difficulty,
            finalRankings,
            playerRank,
            playerScore,
            isChampion,
            roundDetails,
        };

        records.unshift(record);
        if (records.length > MAX_RECORDS) {
            records.length = MAX_RECORDS;
        }
        this._save(records);
        return record;
    }

    static getRecords() {
        return this._load();
    }

    static getStats() {
        const records = this._load();
        if (records.length === 0) {
            return {
                totalPlayed: 0,
                championCount: 0,
                highestScore: 0,
                avgRank: 0,
                bestRank: 0,
            };
        }

        const championCount = records.filter(r => r.isChampion).length;
        const highestScore = Math.max(...records.map(r => r.playerScore));
        const avgRank = records.reduce((s, r) => s + r.playerRank, 0) / records.length;
        const bestRank = Math.min(...records.map(r => r.playerRank));

        return {
            totalPlayed: records.length,
            championCount,
            highestScore,
            avgRank: Math.round(avgRank * 10) / 10,
            bestRank,
        };
    }

    static clearRecords() {
        localStorage.removeItem(STORAGE_KEY);
    }
}

export { TournamentStorage };

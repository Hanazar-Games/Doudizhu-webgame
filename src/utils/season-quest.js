/**
 * SeasonQuestManager - 赛季任务系统
 * 管理每日任务、每周任务、赛季成就任务
 * 数据持久化到 localStorage，支持 UTC+8 日期/周期重置
 */

import { Storage } from './storage.js';
import { getTodayString } from './daily-challenge.js';

const PREFIX = 'ddz_';
const STORAGE_KEY = PREFIX + 'season_quests';
const CURRENT_SEASON = 's1_2024_summer';

// ===== 任务类型定义 =====
const QUEST_TYPE = {
    PLAY_GAME: 'play_game',
    WIN_GAME: 'win_game',
    WIN_AS_LANDLORD: 'win_as_landlord',
    WIN_AS_PEASANT: 'win_as_peasant',
    PLAY_BOMB: 'play_bomb',
    PLAY_ROCKET: 'play_rocket',
    COMPLETE_DAILY: 'complete_daily',
    DAILY_3_STARS: 'daily_3_stars',
    GET_SPRING: 'get_spring',
};

// ===== 任务类型元信息 =====
const QUEST_META = {
    [QUEST_TYPE.PLAY_GAME]:          { name: '初出茅庐', desc: '完成对局', unit: '局', icon: '🎮' },
    [QUEST_TYPE.WIN_GAME]:           { name: '连胜之路', desc: '赢得对局', unit: '局', icon: '🔥' },
    [QUEST_TYPE.WIN_AS_LANDLORD]:    { name: '地主之王', desc: '当地主获胜', unit: '局', icon: '👑' },
    [QUEST_TYPE.WIN_AS_PEASANT]:     { name: '农民联盟', desc: '当农民获胜', unit: '局', icon: '🌾' },
    [QUEST_TYPE.PLAY_BOMB]:          { name: '炸弹专家', desc: '打出炸弹', unit: '个', icon: '💣' },
    [QUEST_TYPE.PLAY_ROCKET]:        { name: '火箭发射', desc: '打出王炸', unit: '次', icon: '🚀' },
    [QUEST_TYPE.COMPLETE_DAILY]:     { name: '每日挑战者', desc: '完成每日挑战', unit: '次', icon: '📅' },
    [QUEST_TYPE.DAILY_3_STARS]:      { name: '完美挑战', desc: '每日挑战获3星', unit: '次', icon: '⭐' },
    [QUEST_TYPE.GET_SPRING]:         { name: '春天使者', desc: '达成春天或反春天', unit: '次', icon: '🌸' },
};

// ===== 每日任务池 =====
const DAILY_QUEST_POOL = [
    { type: QUEST_TYPE.PLAY_GAME, target: 1, weight: 10 },
    { type: QUEST_TYPE.WIN_GAME, target: 1, weight: 8 },
    { type: QUEST_TYPE.PLAY_BOMB, target: 1, weight: 7 },
    { type: QUEST_TYPE.PLAY_ROCKET, target: 1, weight: 5 },
    { type: QUEST_TYPE.COMPLETE_DAILY, target: 1, weight: 6 },
    { type: QUEST_TYPE.GET_SPRING, target: 1, weight: 4 },
    { type: QUEST_TYPE.WIN_AS_LANDLORD, target: 1, weight: 5 },
    { type: QUEST_TYPE.WIN_AS_PEASANT, target: 1, weight: 5 },
];

// ===== 每周任务池 =====
const WEEKLY_QUEST_POOL = [
    { type: QUEST_TYPE.PLAY_GAME, target: 5, weight: 10 },
    { type: QUEST_TYPE.WIN_GAME, target: 3, weight: 8 },
    { type: QUEST_TYPE.WIN_AS_LANDLORD, target: 2, weight: 6 },
    { type: QUEST_TYPE.WIN_AS_PEASANT, target: 2, weight: 6 },
    { type: QUEST_TYPE.PLAY_BOMB, target: 3, weight: 7 },
    { type: QUEST_TYPE.COMPLETE_DAILY, target: 5, weight: 6 },
    { type: QUEST_TYPE.GET_SPRING, target: 2, weight: 5 },
    { type: QUEST_TYPE.DAILY_3_STARS, target: 1, weight: 4 },
];

// ===== 赛季成就（固定，不重置） =====
const SEASON_QUESTS = [
    { id: 'season_play_50',   type: QUEST_TYPE.PLAY_GAME,       target: 50,  reward: { exp: 200, badge: 'season_veteran', badgeName: '老练牌手' } },
    { id: 'season_win_30',    type: QUEST_TYPE.WIN_GAME,        target: 30,  reward: { exp: 300, badge: 'season_champion', badgeName: '赛季冠军' } },
    { id: 'season_landlord_15', type: QUEST_TYPE.WIN_AS_LANDLORD, target: 15, reward: { exp: 250, badge: 'season_landlord', badgeName: '地主霸主' } },
    { id: 'season_bomb_20',  type: QUEST_TYPE.PLAY_BOMB,        target: 20,  reward: { exp: 200, badge: 'season_bomber', badgeName: '爆破大师' } },
    { id: 'season_daily_30', type: QUEST_TYPE.COMPLETE_DAILY,   target: 30,  reward: { exp: 400, badge: 'season_dedication', badgeName: '全勤达人' } },
];

// ===== 奖励徽章定义 =====
const BADGES = {
    season_veteran:    { name: '老练牌手', emoji: '🃏', desc: '赛季累计完成50局对局' },
    season_champion:   { name: '赛季冠军', emoji: '🏆', desc: '赛季累计获胜30局' },
    season_landlord:   { name: '地主霸主', emoji: '👑', desc: '赛季累计当地主获胜15局' },
    season_bomber:     { name: '爆破大师', emoji: '💥', desc: '赛季累计打出20个炸弹' },
    season_dedication: { name: '全勤达人', emoji: '📅', desc: '赛季累计完成30次每日挑战' },
    week_warrior:      { name: '周常勇士', emoji: '⚔️', desc: '完成本周所有周常任务' },
};

// ===== 工具函数 =====

/** 获取本周一日期 (YYYY-MM-DD, UTC+8) */
function getWeekStartString() {
    const now = new Date();
    // 转换为 UTC+8 的日历日期（使用 UTC 方法避免本地时区影响）
    const utc8Time = now.getTime() + (now.getTimezoneOffset() + 480) * 60000;
    const utc8Date = new Date(utc8Time);
    const day = utc8Date.getUTCDay(); // 0=周日, 1=周一
    const diff = day === 0 ? 6 : day - 1;
    const mondayTime = utc8Time - diff * 86400000;
    const monday = new Date(mondayTime);
    const y = monday.getUTCFullYear();
    const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
    const d = String(monday.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** 基于种子确定性随机选择 */
function seededRandom(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };
}

/** 加权随机选择 n 个不重复项 */
function weightedPick(pool, n, rng) {
    const items = pool.map((p, i) => ({ ...p, _idx: i }));
    const picked = [];
    for (let i = 0; i < n && items.length > 0; i++) {
        const totalWeight = items.reduce((s, it) => s + (it.weight || 1), 0);
        let r = rng() * totalWeight;
        for (let j = 0; j < items.length; j++) {
            r -= (items[j].weight || 1);
            if (r <= 0) {
                picked.push(items[j]);
                items.splice(j, 1);
                break;
            }
        }
    }
    return picked;
}

/** 生成任务实例 */
function makeQuestInstance(base, prefix, index) {
    return {
        id: `${prefix}_${base.type}_${index}`,
        type: base.type,
        target: base.target,
        current: 0,
        completed: false,
        claimed: false,
        reward: base.reward || { exp: prefix === 'daily' ? 10 : prefix === 'weekly' ? 30 : 100 },
    };
}

/** 生成每日任务 */
function generateDailyQuests(dateStr) {
    const seed = dateStr.split('-').reduce((s, p) => s * 31 + parseInt(p, 10), 0);
    const rng = seededRandom(seed);
    const picked = weightedPick(DAILY_QUEST_POOL, 3, rng);
    return picked.map((p, i) => makeQuestInstance(p, 'daily', i));
}

/** 生成每周任务 */
function generateWeeklyQuests(weekStr) {
    const seed = weekStr.split('-').reduce((s, p) => s * 31 + parseInt(p, 10), 0);
    const rng = seededRandom(seed);
    const picked = weightedPick(WEEKLY_QUEST_POOL, 2, rng);
    return picked.map((p, i) => makeQuestInstance(p, 'weekly', i));
}

// ===== SeasonQuestManager =====

class SeasonQuestManager {
    constructor() {
        this._data = this._load();
        this._migrate();
        this._checkReset();
    }

    _load() {
        if (typeof localStorage === 'undefined') {
            return null;
        }
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') return parsed;
            }
        } catch (e) {
            console.warn('赛季任务数据加载失败:', e);
        }
        return null;
    }

    _save() {
        if (typeof localStorage === 'undefined') {
            return;
        }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
        } catch (e) {
            console.warn('赛季任务数据保存失败:', e);
        }
    }

    _defaultData() {
        const today = getTodayString();
        const weekStart = getWeekStartString();
        return {
            version: 1,
            seasonId: CURRENT_SEASON,
            daily: {
                date: today,
                quests: generateDailyQuests(today),
            },
            weekly: {
                weekStart,
                quests: generateWeeklyQuests(weekStart),
            },
            season: {
                quests: SEASON_QUESTS.map((q) => ({
                    ...q,
                    current: 0,
                    completed: false,
                    claimed: false,
                })),
            },
            badges: [], // 已获得的徽章列表
            totalExp: 0,
        };
    }

    _migrate() {
        if (!this._data) {
            this._data = this._defaultData();
            this._save();
            return;
        }
        // 赛季切换时重置
        if (this._data.seasonId !== CURRENT_SEASON) {
            this._data = this._defaultData();
            this._save();
            return;
        }
        // 版本迁移
        if (!this._data.version || this._data.version < 1) {
            this._data.version = 1;
            if (!this._data.badges) this._data.badges = [];
            if (!this._data.totalExp) this._data.totalExp = 0;
        }
    }

    _checkReset() {
        const today = getTodayString();
        const weekStart = getWeekStartString();
        let changed = false;

        // 每日重置
        if (this._data.daily?.date !== today) {
            this._data.daily = {
                date: today,
                quests: generateDailyQuests(today),
            };
            changed = true;
        }

        // 每周重置
        if (this._data.weekly?.weekStart !== weekStart) {
            this._data.weekly = {
                weekStart,
                quests: generateWeeklyQuests(weekStart),
            };
            changed = true;
        }

        // 确保 season 存在
        if (!this._data.season?.quests) {
            this._data.season = {
                quests: SEASON_QUESTS.map((q) => ({
                    ...q,
                    current: 0,
                    completed: false,
                    claimed: false,
                })),
            };
            changed = true;
        }

        if (changed) this._save();
    }

    // ===== 公共 API =====

    /** 获取当前任务数据（浅拷贝） */
    getData() {
        this._checkReset();
        return {
            daily: this._data.daily,
            weekly: this._data.weekly,
            season: this._data.season,
            badges: [...this._data.badges],
            totalExp: this._data.totalExp,
        };
    }

    /** 获取每日任务 */
    getDailyQuests() {
        this._checkReset();
        return this._data.daily?.quests || [];
    }

    /** 获取每周任务 */
    getWeeklyQuests() {
        this._checkReset();
        return this._data.weekly?.quests || [];
    }

    /** 获取赛季成就 */
    getSeasonQuests() {
        this._checkReset();
        return this._data.season?.quests || [];
    }

    /** 获取任务进度统计 */
    getProgress() {
        this._checkReset();
        const d = this._data;
        const dailyDone = d.daily.quests.filter(q => q.completed).length;
        const weeklyDone = d.weekly.quests.filter(q => q.completed).length;
        const seasonDone = d.season.quests.filter(q => q.completed).length;
        return {
            daily: { done: dailyDone, total: d.daily.quests.length },
            weekly: { done: weeklyDone, total: d.weekly.quests.length },
            season: { done: seasonDone, total: d.season.quests.length },
            totalExp: d.totalExp,
            badges: [...d.badges],
        };
    }

    /** 是否有未领取奖励的任务 */
    hasUnclaimed() {
        this._checkReset();
        const all = [
            ...this._data.daily.quests,
            ...this._data.weekly.quests,
            ...this._data.season.quests,
        ];
        return all.some(q => q.completed && !q.claimed);
    }

    // ===== 事件上报 =====

    /**
     * 上报一局游戏结果
     * @param {Object} event - 游戏事件
     * @param {boolean} event.isWin - 是否获胜
     * @param {boolean} event.isLandlord - 是否地主
     * @param {number} event.bombCount - 本局打出的炸弹数（含王炸）
     * @param {boolean} event.hasRocket - 是否打出王炸
     * @param {boolean} event.isSpring - 是否春天
     * @param {boolean} event.isAntiSpring - 是否反春天
     * @param {string} event.mode - 游戏模式 'ai' | 'custom' | 'daily' | 'lan'
     * @returns {Array} 本次触发的完成任务列表（用于弹提示）
     */
    reportGame(event) {
        this._checkReset();
        const newlyCompleted = [];
        const { isWin, isLandlord, hasRocket, isSpring, isAntiSpring, mode } = event;
        const bombCount = typeof event.bombCount === 'number' ? event.bombCount : 0;

        // LAN 模式不计入（避免跨设备同步问题）
        if (mode === 'lan') return newlyCompleted;

        const allQuests = [
            ...this._data.daily.quests,
            ...this._data.weekly.quests,
            ...this._data.season.quests,
        ];

        for (const q of allQuests) {
            if (q.completed) continue;
            let advanced = false;

            switch (q.type) {
                case QUEST_TYPE.PLAY_GAME:
                    advanced = true;
                    break;
                case QUEST_TYPE.WIN_GAME:
                    if (isWin) advanced = true;
                    break;
                case QUEST_TYPE.WIN_AS_LANDLORD:
                    if (isWin && isLandlord) advanced = true;
                    break;
                case QUEST_TYPE.WIN_AS_PEASANT:
                    if (isWin && !isLandlord) advanced = true;
                    break;
                case QUEST_TYPE.PLAY_BOMB:
                    if (bombCount > 0) {
                        q.current += bombCount;
                        advanced = true; // 标记已处理
                    }
                    break;
                case QUEST_TYPE.PLAY_ROCKET:
                    if (hasRocket) advanced = true;
                    break;
                case QUEST_TYPE.GET_SPRING:
                    if (isSpring || isAntiSpring) advanced = true;
                    break;
                default:
                    break;
            }

            // 非炸弹类任务，current += 1
            if (advanced && q.type !== QUEST_TYPE.PLAY_BOMB) {
                q.current++;
            }

            // 检查是否完成
            if (q.current >= q.target && !q.completed) {
                q.completed = true;
                newlyCompleted.push({
                    id: q.id,
                    type: q.type,
                    name: QUEST_META[q.type]?.name || q.type,
                    desc: QUEST_META[q.type]?.desc || '',
                    reward: q.reward,
                    isDaily: this._data.daily.quests.includes(q),
                    isWeekly: this._data.weekly.quests.includes(q),
                    isSeason: this._data.season.quests.includes(q),
                });
            }
        }

        if (newlyCompleted.length > 0) {
            this._save();
        }
        return newlyCompleted;
    }

    /**
     * 上报每日挑战结果
     * @param {Object} event - 挑战事件
     * @param {boolean} event.completed - 是否完成
     * @param {number} event.stars - 获得星级
     * @returns {Array} 本次触发的完成任务列表
     */
    reportDailyChallenge(event) {
        this._checkReset();
        const newlyCompleted = [];
        const { completed, stars } = event;

        const allQuests = [
            ...this._data.daily.quests,
            ...this._data.weekly.quests,
            ...this._data.season.quests,
        ];

        for (const q of allQuests) {
            if (q.completed) continue;
            let advanced = false;

            switch (q.type) {
                case QUEST_TYPE.COMPLETE_DAILY:
                    if (completed) advanced = true;
                    break;
                case QUEST_TYPE.DAILY_3_STARS:
                    if (completed && stars >= 3) advanced = true;
                    break;
                default:
                    break;
            }

            if (advanced) {
                q.current++;
                if (q.current >= q.target && !q.completed) {
                    q.completed = true;
                    newlyCompleted.push({
                        id: q.id,
                        type: q.type,
                        name: QUEST_META[q.type]?.name || q.type,
                        desc: QUEST_META[q.type]?.desc || '',
                        reward: q.reward,
                        isDaily: this._data.daily.quests.includes(q),
                        isWeekly: this._data.weekly.quests.includes(q),
                        isSeason: this._data.season.quests.includes(q),
                    });
                }
            }
        }

        if (newlyCompleted.length > 0) {
            this._save();
        }
        return newlyCompleted;
    }

    // ===== 奖励领取 =====

    /**
     * 领取任务奖励
     * @param {string} questId
     * @returns {Object|null} 奖励信息，null 表示不可领取
     */
    claimReward(questId) {
        this._checkReset();
        const allQuests = [
            ...this._data.daily.quests,
            ...this._data.weekly.quests,
            ...this._data.season.quests,
        ];
        const q = allQuests.find(q => q.id === questId);
        if (!q || !q.completed || q.claimed) return null;

        q.claimed = true;
        const reward = { ...q.reward };

        // 累计经验
        if (reward.exp) {
            this._data.totalExp += reward.exp;
        }

        // 发放徽章
        if (reward.badge) {
            if (!this._data.badges.includes(reward.badge)) {
                this._data.badges.push(reward.badge);
            }
        }

        this._save();
        return reward;
    }

    /** 一键领取所有可领取奖励 */
    claimAll() {
        this._checkReset();
        const results = [];
        const allQuests = [
            ...this._data.daily.quests,
            ...this._data.weekly.quests,
            ...this._data.season.quests,
        ];
        for (const q of allQuests) {
            if (q.completed && !q.claimed) {
                const r = this.claimReward(q.id);
                if (r) results.push({ questId: q.id, type: q.type, reward: r });
            }
        }
        return results;
    }

    // ===== 徽章查询 =====

    /** 获取已获得的所有徽章详情 */
    getBadges() {
        this._checkReset();
        return this._data.badges.map(id => BADGES[id]).filter(Boolean);
    }

    /** 获取徽章信息 */
    getBadgeInfo(badgeId) {
        return BADGES[badgeId] || null;
    }

    // ===== 重置/调试 =====

    /** 强制重置所有数据（调试用） */
    reset() {
        this._data = this._defaultData();
        this._save();
    }

    /** 强制刷新每日任务（调试用） */
    forceRefreshDaily() {
        const today = getTodayString();
        this._data.daily = {
            date: today,
            quests: generateDailyQuests(today),
        };
        this._save();
    }
}

// 单例导出
const seasonQuestManager = new SeasonQuestManager();

export {
    SeasonQuestManager,
    seasonQuestManager,
    QUEST_TYPE,
    QUEST_META,
    BADGES,
    getWeekStartString,
};

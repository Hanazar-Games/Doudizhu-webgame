/**
 * Storage - 本地数据持久化
 * 使用 localStorage 保存游戏记录、设置、分数
 */

const PREFIX = 'ddz_';

export const Storage = {
    // 保存总局数和总分
    saveStats(stats) {
        try { localStorage.setItem(PREFIX + 'stats', JSON.stringify(stats)); } catch (e) {}
    },

    getStats() {
        const raw = localStorage.getItem(PREFIX + 'stats');
        const defaults = { gamesPlayed: 0, wins: 0, losses: 0, totalScore: 0, streak: 0 };
        if (!raw) return defaults;
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;
            return { ...defaults, ...parsed };
        } catch {
            return defaults;
        }
    },

    // 保存最近对局记录
    saveGameRecord(record) {
        try {
            const records = this.getGameRecords();
            records.unshift(record);
            if (records.length > 50) records.pop();
            localStorage.setItem(PREFIX + 'records', JSON.stringify(records));
        } catch (e) {}
    },

    getGameRecords() {
        const raw = localStorage.getItem(PREFIX + 'records');
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed;
        } catch {
            return [];
        }
    },

    // 保存用户设置
    saveSettings(settings) {
        try { localStorage.setItem(PREFIX + 'settings', JSON.stringify(settings)); } catch (e) {}
    },

    getSettings() {
        const raw = localStorage.getItem(PREFIX + 'settings');
        const defaults = {
            difficulty: 'normal',
            soundEnabled: true,
            animationEnabled: true,
            showTutorial: true,
            theme: 'green',
            matchRounds: 1,
        };
        if (!raw) return defaults;
        try {
            return { ...defaults, ...JSON.parse(raw) };
        } catch {
            return defaults;
        }
    },

    // 保存完整牌局（用于回放）
    saveFullGame(gameData) {
        try {
            const games = this.getFullGames();
            games.unshift(gameData);
            if (games.length > 20) games.pop(); // 保留最近20局
            localStorage.setItem(PREFIX + 'full_games', JSON.stringify(games));
        } catch (e) {}
    },

    getFullGames() {
        const raw = localStorage.getItem(PREFIX + 'full_games');
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed;
        } catch {
            return [];
        }
    },

    // 清除所有数据
    clearAll() {
        Object.keys(localStorage)
            .filter(k => k.startsWith(PREFIX))
            .forEach(k => localStorage.removeItem(k));
    },
};

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
        const defaults = { gamesPlayed: 0, wins: 0, losses: 0, totalScore: 0, streak: 0, maxStreak: 0, maxScore: 0, maxBombsInGame: 0 };
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
            bgmVolume: 0.5,
            sfxVolume: 0.5,
            playerName: '玩家',
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
    
    // ========== 成就系统 ==========
    ACHIEVEMENTS: [
        { id: 'first_game', name: '初出茅庐', desc: '完成第一局游戏', icon: '🎮' },
        { id: 'streak_3', name: '连胜达人', desc: '连胜3局', icon: '🔥' },
        { id: 'spring', name: '春天使者', desc: '春天获胜', icon: '🌸' },
        { id: 'bomb_master', name: '炸弹专家', desc: '一局打出3个及以上炸弹', icon: '💣' },
        { id: 'landlord_king', name: '地主之王', desc: '作为地主获胜10次', icon: '👑' },
        { id: 'peasant_union', name: '农民联盟', desc: '作为农民获胜10次', icon: '🌾' },
        { id: 'rocket', name: '火箭发射', desc: '打出一次王炸', icon: '🚀' },
        { id: 'clean_sweep', name: '全歼对手', desc: '一局内打完所有手牌', icon: '🃏' },
    ],
    
    getAchievements() {
        const raw = localStorage.getItem(PREFIX + 'achievements');
        const defaults = {};
        this.ACHIEVEMENTS.forEach(a => { defaults[a.id] = false; });
        if (!raw) return defaults;
        try {
            const parsed = JSON.parse(raw);
            return { ...defaults, ...parsed };
        } catch {
            return defaults;
        }
    },
    
    saveAchievements(achievements) {
        try { localStorage.setItem(PREFIX + 'achievements', JSON.stringify(achievements)); } catch (e) {}
    },
    
    getAchievementProgress() {
        const raw = localStorage.getItem(PREFIX + 'achievement_progress');
        const defaults = {
            totalGames: 0,
            landlordWins: 0,
            peasantWins: 0,
            bombsPlayed: 0,
            rocketPlayed: false,
            cleanSweep: false,
        };
        if (!raw) return defaults;
        try {
            return { ...defaults, ...JSON.parse(raw) };
        } catch {
            return defaults;
        }
    },
    
    saveAchievementProgress(progress) {
        try { localStorage.setItem(PREFIX + 'achievement_progress', JSON.stringify(progress)); } catch (e) {}
    },
    
    // 检查并解锁成就，返回新解锁的成就列表
    checkAchievements(roundData) {
        const achievements = this.getAchievements();
        const progress = this.getAchievementProgress();
        const unlocked = [];
        
        progress.totalGames++;
        
        if (roundData.isWin) {
            if (roundData.isLandlord) {
                progress.landlordWins++;
            } else {
                progress.peasantWins++;
            }
        }
        
        if (roundData.bombsPlayed >= 3) {
            progress.bombsPlayed = Math.max(progress.bombsPlayed, roundData.bombsPlayed);
        }
        
        if (roundData.rocketPlayed) {
            progress.rocketPlayed = true;
        }
        
        if (roundData.cleanSweep) {
            progress.cleanSweep = true;
        }
        
        // 检查各成就条件
        if (!achievements.first_game && progress.totalGames >= 1) {
            achievements.first_game = true;
            unlocked.push(this.ACHIEVEMENTS.find(a => a.id === 'first_game'));
        }
        if (!achievements.streak_3 && roundData.streak >= 3) {
            achievements.streak_3 = true;
            unlocked.push(this.ACHIEVEMENTS.find(a => a.id === 'streak_3'));
        }
        if (!achievements.spring && roundData.isSpring && roundData.isWin) {
            achievements.spring = true;
            unlocked.push(this.ACHIEVEMENTS.find(a => a.id === 'spring'));
        }
        if (!achievements.bomb_master && roundData.bombsPlayed >= 3) {
            achievements.bomb_master = true;
            unlocked.push(this.ACHIEVEMENTS.find(a => a.id === 'bomb_master'));
        }
        if (!achievements.landlord_king && progress.landlordWins >= 10) {
            achievements.landlord_king = true;
            unlocked.push(this.ACHIEVEMENTS.find(a => a.id === 'landlord_king'));
        }
        if (!achievements.peasant_union && progress.peasantWins >= 10) {
            achievements.peasant_union = true;
            unlocked.push(this.ACHIEVEMENTS.find(a => a.id === 'peasant_union'));
        }
        if (!achievements.rocket && progress.rocketPlayed) {
            achievements.rocket = true;
            unlocked.push(this.ACHIEVEMENTS.find(a => a.id === 'rocket'));
        }
        if (!achievements.clean_sweep && progress.cleanSweep) {
            achievements.clean_sweep = true;
            unlocked.push(this.ACHIEVEMENTS.find(a => a.id === 'clean_sweep'));
        }
        
        this.saveAchievements(achievements);
        this.saveAchievementProgress(progress);
        return unlocked;
    },
};

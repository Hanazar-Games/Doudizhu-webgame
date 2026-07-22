/**
 * Storage - 本地数据持久化
 * 使用 localStorage 保存游戏记录、设置、分数
 */

const PREFIX = 'ddz_';

export const Storage = {
    // 保存总局数和总分
    saveStats(stats) {
        try {
            localStorage.setItem(PREFIX + 'stats', JSON.stringify(stats));
        } catch (e) {
            console.warn('保存统计数据失败:', e);
        }
    },

    getStats() {
        const raw = localStorage.getItem(PREFIX + 'stats');
        const defaults = { gamesPlayed: 0, wins: 0, losses: 0, totalScore: 0, streak: 0, maxStreak: 0, maxScore: 0, maxBombsInGame: 0, exp: 0, level: 1 };
        if (!raw) return { ...defaults };
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...defaults };
            return { ...defaults, ...parsed };
        } catch {
            return { ...defaults };
        }
    },

    // 保存最近对局记录
    saveGameRecord(record) {
        try {
            const records = this.getGameRecords();
            records.unshift(record);
            let max = Number(this.getSettings().maxHistory) || 50;
            max = Math.max(10, Math.min(200, max));
            while (records.length > max) records.pop();
            localStorage.setItem(PREFIX + 'records', JSON.stringify(records));
        } catch (e) {
            if (this._isQuotaError(e)) {
                // 存储已满：删除一半旧记录后重试
                const records = this.getGameRecords();
                records.splice(Math.floor(records.length * 0.5));
                records.unshift(record);
                try { localStorage.setItem(PREFIX + 'records', JSON.stringify(records)); } catch (e2) {}
            } else {
                console.warn('保存对局记录失败:', e);
            }
        }
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
        try {
            localStorage.setItem(PREFIX + 'settings', JSON.stringify(settings));
        } catch (e) {
            console.warn('保存设置失败:', e);
        }
    },

    // 返回纯默认设置（不读取 localStorage）
    getDefaultSettings() {
        return {
            // ====== 游戏核心 (15项) ======
            difficulty: 'normal',
            callMode: 'score',
            laiziEnabled: false,
            baseScore: 1,
            scoreMultiplier: 1,
            allowSpring: true,
            allowAntiSpring: true,
            bombDoubles: true,
            rocketDoubles: true,
            timerEnabled: true,
            timerSeconds: 30,
            firstPlayer: 'random',
            jokerRule: 'standard',
            bombRule: 'standard',
            strictRules: true,

            // ====== 游戏变体 (10项) ======
            showCards: false,
            exchangeThree: false,
            noShuffle: false,
            bottomVisible: false,
            mustPlay: false,
            allowPassOnFirst: true,
            allowTripleWithSingle: true,
            allowTripleWithPair: true,
            allowAirplaneWithWings: true,
            bombAsRocket: false,

            // ====== AI 行为 (10项) ======
            aiThinkTime: 1000,
            aiCallStrategy: 'balanced',
            aiPlayStyle: 'balanced',
            aiMemoryLevel: 'basic',
            aiCooperation: 'basic',
            aiBluffRate: 10,
            aiRiskTolerance: 50,
            aiUseHint: true,
            aiEmoteRate: 30,
            aiDifficultyScale: 1.0,

            // ====== 音频 (12项) ======
            soundEnabled: true,
            bgmEnabled: true,
            sfxEnabled: true,
            bgmVolume: 0.5,
            sfxVolume: 0.5,
            voiceVolume: 0.7,
            bgmTrack: 'default',
            voicePack: 'default',
            voiceAnnounce: false,
            enableDealSound: true,
            enablePlaySound: true,
            enableCallSound: true,
            enableBombSound: true,
            enableWinSound: true,
            enableTickSound: true,
            enableChatSound: false,

            // ====== 视觉主题 (10项) ======
            theme: 'green',
            uiDensity: 'comfortable',
            animationLevel: 'normal',
            cardStyle: 'modern',
            cardBackStyle: 'classic',
            cardCornerRadius: 8,
            cardBorderWidth: 1,
            fontSize: 'medium',
            darkMode: false,
            highContrast: false,
            colorblindMode: false,
            colorblindType: 'none',

            // ====== 布局 (10项) ======
            tableScale: 1,
            cardScale: 1,
            playedCardScale: 1,
            replayCardScale: 1,
            playedOverlap: 16,
            selectedLift: 8,
            hoverLift: 5,
            panelOpacity: 80,
            handArrangement: 'fan',
            playedCardArrangement: 'straight',

            // ====== 动画与特效 (12项) ======
            gameSpeed: 1.0,
            animSpeed: 1.0,
            particleIntensity: 'normal',
            particleCount: 50,
            screenShakeIntensity: 'normal',
            floatingTextSize: 'normal',
            shadowIntensity: 'normal',
            glowIntensity: 'normal',
            transitionSpeed: 1.0,
            winEffectLevel: 'normal',
            bombEffectLevel: 'normal',
            comboAnnounce: 2,
            cardEnterStagger: 30,

            // ====== 交互操作 (14项) ======
            clickToSelect: true,
            doubleClickToPlay: false,
            spaceConfirm: true,
            autoHint: true,
            smartDiscard: true,
            playConfirm: false,
            passConfirm: false,
            confirmOnBomb: false,
            dragThreshold: 7,
            oneClickPlay: false,
            smartSort: false,
            rightClickCancel: true,
            wheelZoom: true,
            autoArrange: true,
            autoSortAfterPlay: false,
            stickySelection: false,
            showPlayPreview: true,
            gestureEnabled: true,
            swipeToSelect: true,
            longPressHint: false,
            hapticEnabled: true,

            // ====== 辅助功能 (12项) ======
            showTutorial: true,
            showShortcuts: true,
            showTableAura: true,
            opponentCards: 'stack',
            autoOpenTracker: false,
            autoOpenHistory: false,
            hintDetail: 'type',
            sortOrder: 'value',
            showRemainingCount: true,
            showWinProbability: false,
            showBestMove: false,
            handAnalysis: false,
            showOpponentTendency: false,
            showDangerCards: false,
            highlightPlayable: true,
            showPatternName: true,
            showPlayerStats: false,

            // ====== 面板开关 (6项) ======
            enableCardTracker: true,
            enableAutoHint: true,
            enableChat: false,
            enableEmoji: false,
            enableReplay: true,
            enableStats: true,
            enableAchievements: true,

            // ====== 个性化 (4项) ======
            playerName: '玩家',
            matchRounds: 1,
            avatarStyle: 'default',
            showOpponentCall: true,

            // ====== 无障碍 (5项) ======
            reduceMotion: false,
            largeClickTargets: false,
            highVisibility: false,

            // ====== 性能与调试 (5项) ======
            showFPS: false,
            showMemory: false,
            frameLimit: 60,
            lazyRender: false,
            debugMode: false,

            // ====== 网络 (4项) ======
            networkQuality: 'auto',
            reconnectAttempts: 3,
            heartbeatInterval: 5,
            lagCompensation: true,

            // ====== 高级 (4项) ======
            language: 'zh-CN',
            maxHistory: 50,
            spectatorDelay: 0,
            autoSaveInterval: 30,
            experimentalFeatures: false,
        };
    },

    getSettings() {
        const raw = localStorage.getItem(PREFIX + 'settings');
        const defaults = this.getDefaultSettings();

        if (!raw) return { ...defaults };
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...defaults };
            // 合并：保留旧设置 + 填充新默认值
            const merged = { ...defaults, ...parsed };

            // === 旧 key 迁移 ===
            if (parsed.laiziMode !== undefined && parsed.laiziEnabled === undefined) {
                merged.laiziEnabled = !!parsed.laiziMode;
            }
            if (parsed.turnTimeout !== undefined && parsed.timerSeconds === undefined) {
                merged.timerSeconds = parsed.turnTimeout;
            }
            if (parsed.baseScore !== undefined && parsed.scoreMultiplier === undefined) {
                merged.scoreMultiplier = parsed.baseScore;
            }

            // 大手牌布局以 1.0 为屏内安全上限。旧版本曾允许保存到 1.2，
            // 会让 20 张地主手牌在中等宽度屏幕上被左右裁掉。
            const cardScale = Number(merged.cardScale);
            merged.cardScale = Number.isFinite(cardScale)
                ? Math.max(0.7, Math.min(1, cardScale))
                : defaults.cardScale;

            return merged;
        } catch {
            return { ...defaults };
        }
    },

    // 重置设置：清除 localStorage 并返回默认设置
    resetSettings() {
        localStorage.removeItem(PREFIX + 'settings');
        return this.getDefaultSettings();
    },

    // 保存完整牌局（用于回放）
    saveFullGame(gameData) {
        try {
            const games = this.getFullGames();
            games.unshift(gameData);
            if (games.length > 20) games.length = 20; // 保留最近20局
            localStorage.setItem(PREFIX + 'full_games', JSON.stringify(games));
        } catch (e) {
            if (this._isQuotaError(e)) {
                // 存储已满：只保留最近5局
                const games = this.getFullGames();
                games.splice(5);
                games.unshift(gameData);
                try { localStorage.setItem(PREFIX + 'full_games', JSON.stringify(games)); } catch (e2) {}
            } else {
                console.warn('保存完整牌局失败:', e);
            }
        }
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

    // 保存复盘摘要
    saveCoachReview(review) {
        try {
            const reviews = this.getCoachReviews();
            reviews.unshift(review);
            if (reviews.length > 20) reviews.length = 20;
            localStorage.setItem(PREFIX + 'coach_reviews', JSON.stringify(reviews));
        } catch (e) {
            console.warn('保存复盘摘要失败:', e);
        }
    },

    getCoachReviews() {
        const raw = localStorage.getItem(PREFIX + 'coach_reviews');
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed;
        } catch {
            return [];
        }
    },

    // 清除统计数据（仅游戏记录和统计，保留设置、成就、牌风和教练复盘）
    clearStats() {
        localStorage.removeItem(PREFIX + 'stats');
        localStorage.removeItem(PREFIX + 'records');
        localStorage.removeItem(PREFIX + 'full_games');
        localStorage.removeItem(PREFIX + 'achievement_progress');
    },

    // 清除所有对局相关数据（含回放、牌风、教练复盘）
    clearGameData() {
        localStorage.removeItem(PREFIX + 'stats');
        localStorage.removeItem(PREFIX + 'records');
        localStorage.removeItem(PREFIX + 'full_games');
        localStorage.removeItem(PREFIX + 'achievement_progress');
        localStorage.removeItem(PREFIX + 'playStyle');
        localStorage.removeItem(PREFIX + 'coach_reviews');
    },

    // 清除所有数据
    clearAll() {
        Object.keys(localStorage)
            .filter(k => k.startsWith(PREFIX))
            .forEach(k => localStorage.removeItem(k));
    },

    // ===== 牌风分析数据 =====
    getPlayStyleData() {
        const raw = localStorage.getItem(PREFIX + 'playStyle');
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
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
        try {
            localStorage.setItem(PREFIX + 'achievements', JSON.stringify(achievements));
        } catch (e) {
            console.warn('保存成就数据失败:', e);
        }
    },

    // 检测是否是存储空间不足错误
    _isQuotaError(e) {
        return e && (e.name === 'QuotaExceededError' || e.code === 22 || e.number === -2147024882);
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

        const bombs = (roundData.bombsPlayed || 0);
        if (bombs >= 3) {
            progress.bombsPlayed = Math.max(progress.bombsPlayed || 0, bombs);
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

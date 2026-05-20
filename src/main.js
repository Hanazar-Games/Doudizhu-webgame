/**
 * Main - 游戏入口
 * 负责：菜单导航、模式切换、全局初始化、数据持久化
 */

import { AIMode } from './modes/ai-mode.js';
import { LANMode } from './modes/lan-mode.js';
import { CustomMode } from './modes/custom-mode.js';
import { Renderer } from './ui/renderer.js';
import { Storage } from './utils/storage.js';
import { ReplayManager } from './utils/replay.js';

class GameApp {
    constructor() {
        this.currentMode = null;
        this.renderer = null;
        this.settings = Storage.getSettings();
        this.stats = { gamesPlayed: 0, wins: 0, losses: 0, totalScore: 0, streak: 0, ...Storage.getStats() };
        this.init();
    }

    init() {
        // 恢复设置
        this._applySettings();
        
        // 绑定菜单按钮（带点击音效）
        const menuBtns = [
            { id: 'btn-ai-mode', action: () => this.startAIMode() },
            { id: 'btn-lan-mode', action: () => this.startLANMode() },
            { id: 'btn-custom-mode', action: () => this.startCustomMode() },
            { id: 'btn-replay-mode', action: () => this.showReplayList() },
            { id: 'btn-achievements', action: () => this.showAchievements() },
            { id: 'btn-back', action: () => this.showMenu() },
        ];
        // 首次用户交互标记（用于解锁 AudioContext）
        this._hasUserInteracted = false;
        
        for (const { id, action } of menuBtns) {
            document.getElementById(id)?.addEventListener('click', () => {
                // 首次交互：尝试恢复被阻止的 BGM
                if (!this._hasUserInteracted) {
                    this._hasUserInteracted = true;
                    this.renderer?.audio?._ensureContext().then(ok => {
                        if (ok && !this.renderer?.audio?._currentBGM) {
                            this.renderer?.audio?.playMenuBGM();
                        }
                    });
                }
                this.renderer?.audio?.playButtonClick();
                action();
            });
        }
        
        // 音量控制
        const bindVolume = (sliderId, valueId, key, setter) => {
            const slider = document.getElementById(sliderId);
            const val = document.getElementById(valueId);
            if (!slider) return;
            slider.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value);
                this.settings[key] = v;
                if (val) val.textContent = Math.round(v * 100) + '%';
                Storage.saveSettings(this.settings);
                if (this.renderer?.audio) {
                    this.renderer.audio[setter](v);
                }
            });
        };
        bindVolume('cfg-bgm-volume', 'cfg-bgm-volume-value', 'bgmVolume', 'setBGMVolume');
        bindVolume('cfg-sfx-volume', 'cfg-sfx-volume-value', 'sfxVolume', 'setSFXVolume');
        
        // 难度选择
        document.getElementById('difficulty')?.addEventListener('change', (e) => {
            if (this.currentMode instanceof AIMode) {
                this.currentMode.setDifficulty(e.target.value);
            }
            this.settings.difficulty = e.target.value;
            Storage.saveSettings(this.settings);
        });
        
        // 主题切换
        document.getElementById('theme')?.addEventListener('change', (e) => {
            this._applyTheme(e.target.value);
            this.settings.theme = e.target.value;
            Storage.saveSettings(this.settings);
        });
        
        // 局数选择
        document.getElementById('match-rounds')?.addEventListener('change', (e) => {
            this.settings.matchRounds = parseInt(e.target.value);
            Storage.saveSettings(this.settings);
        });
        
        // 成就面板关闭
        document.getElementById('btn-close-achievements')?.addEventListener('click', () => {
            this.renderer?.audio?.playButtonClick();
            document.getElementById('achievement-panel')?.classList.add('hidden');
        });
        
        // 返回按钮（跨屏幕通用）
        document.getElementById('btn-back-lan')?.addEventListener('click', () => {
            this.renderer?.audio?.playButtonClick();
            this.showMenu();
        });
        document.getElementById('btn-back-custom')?.addEventListener('click', () => {
            this.renderer?.audio?.playButtonClick();
            this.showMenu();
        });
        
        // LAN界面事件（只绑定一次）
        this._initLANListeners();
        this._initCustomListeners();
        
        // 渲染统计面板
        this._renderStats();
        
        // 隐藏加载画面 + 菜单入场动画 + BGM
        setTimeout(() => {
            document.getElementById('loading-screen')?.classList.add('hidden');
            this._animateMenuEntrance();
            // 延迟播放菜单BGM（等待用户交互解锁AudioContext）
            setTimeout(() => {
                this.renderer?.audio?.playMenuBGM();
            }, 500);
        }, 600);
    }
    
    _animateMenuEntrance() {
        const menuScreen = document.getElementById('menu-screen');
        if (!menuScreen) return;
        
        // 标题淡入
        const title = menuScreen.querySelector('.game-title');
        const subtitle = menuScreen.querySelector('.game-subtitle');
        if (title) {
            title.style.opacity = '0';
            title.style.transform = 'translateY(-20px)';
            title.style.transition = 'all 0.6s ease-out';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    title.style.opacity = '1';
                    title.style.transform = 'translateY(0)';
                });
            });
        }
        if (subtitle) {
            subtitle.style.opacity = '0';
            subtitle.style.transition = 'opacity 0.6s ease-out 0.2s';
            setTimeout(() => { subtitle.style.opacity = '0.7'; }, 200);
        }
        
        // 按钮依次弹入
        const buttons = menuScreen.querySelectorAll('.menu-buttons .btn-primary');
        buttons.forEach((btn, i) => {
            btn.style.opacity = '0';
            btn.style.transform = 'translateY(30px) scale(0.9)';
            btn.style.transition = `all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) ${300 + i * 100}ms`;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    btn.style.opacity = '1';
                    btn.style.transform = 'translateY(0) scale(1)';
                });
            });
        });
        
        // 设置面板滑入
        const settings = menuScreen.querySelector('.settings-panel');
        if (settings) {
            settings.style.opacity = '0';
            settings.style.transform = 'translateY(20px)';
            settings.style.transition = 'all 0.5s ease-out 0.7s';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    settings.style.opacity = '1';
                    settings.style.transform = 'translateY(0)';
                });
            });
        }
    }
    
    _applySettings() {
        const diffSelect = document.getElementById('difficulty');
        if (diffSelect) diffSelect.value = this.settings.difficulty;
        
        const soundCheckbox = document.getElementById('cfg-sound');
        if (soundCheckbox) soundCheckbox.checked = this.settings.soundEnabled;
        
        const themeSelect = document.getElementById('theme');
        if (themeSelect) themeSelect.value = this.settings.theme || 'green';
        this._applyTheme(this.settings.theme || 'green');
        
        const roundsSelect = document.getElementById('match-rounds');
        if (roundsSelect) roundsSelect.value = String(this.settings.matchRounds || 1);
        
        // 音量滑块
        const bgmSlider = document.getElementById('cfg-bgm-volume');
        const bgmVal = document.getElementById('cfg-bgm-volume-value');
        if (bgmSlider) bgmSlider.value = this.settings.bgmVolume ?? 0.5;
        if (bgmVal) bgmVal.textContent = Math.round((this.settings.bgmVolume ?? 0.5) * 100) + '%';
        
        const sfxSlider = document.getElementById('cfg-sfx-volume');
        const sfxVal = document.getElementById('cfg-sfx-volume-value');
        if (sfxSlider) sfxSlider.value = this.settings.sfxVolume ?? 0.5;
        if (sfxVal) sfxVal.textContent = Math.round((this.settings.sfxVolume ?? 0.5) * 100) + '%';
    }
    
    _applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
    }
    
    _renderStats() {
        const statsEl = document.querySelector('.stats-panel');
        if (statsEl) {
            // 更新已有面板
            const values = statsEl.querySelectorAll('.stat-value');
            if (values.length >= 4) {
                values[0].textContent = this.stats.gamesPlayed;
                values[1].textContent = this.stats.wins;
                values[2].textContent = this.stats.losses;
                values[3].textContent = (this.stats.streak > 0 ? '+' : '') + this.stats.streak;
            }
            return;
        }
        // 如果不存在，在菜单中创建一个
        const menuContainer = document.querySelector('.menu-container');
        if (menuContainer) {
            const panel = document.createElement('div');
            panel.className = 'stats-panel';
            panel.innerHTML = `
                <div class="stats-grid">
                    <div class="stat-item">
                        <span class="stat-value">${this.stats.gamesPlayed}</span>
                        <span class="stat-label">总局数</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value" style="color:#4caf50">${this.stats.wins}</span>
                        <span class="stat-label">胜场</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value" style="color:#f44336">${this.stats.losses}</span>
                        <span class="stat-label">负场</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${this.stats.streak > 0 ? '+' : ''}${this.stats.streak}</span>
                        <span class="stat-label">连胜</span>
                    </div>
                </div>
                <button id="btn-clear-stats" class="btn-small" style="margin-top:8px;font-size:0.7rem">重置记录</button>
            `;
            menuContainer.insertBefore(panel, menuContainer.querySelector('.settings-panel'));
            
            panel.querySelector('#btn-clear-stats')?.addEventListener('click', () => {
                if (confirm('确定要清除所有游戏记录吗？')) {
                    Storage.clearAll();
                    location.reload();
                }
            });
        }
    }
    
    _saveGameResult(data) {
        const gs = this.currentMode?.gameState;
        const humanIdx = this.currentMode?.humanIndex ?? -1;
        // 观战模式（humanIndex=-1）不更新统计
        if (humanIdx < 0) return;
        
        let isHumanWin = data.winnerIndex === humanIdx ||
            (data.winnerIndex !== gs?.landlordIndex && humanIdx !== gs?.landlordIndex);
        
        this.stats.gamesPlayed++;
        if (isHumanWin) {
            this.stats.wins++;
            this.stats.streak = Math.max(1, this.stats.streak + 1);
        } else {
            this.stats.losses++;
            this.stats.streak = Math.min(-1, this.stats.streak - 1);
        }
        this.stats.totalScore += data.scores[humanIdx] || 0;
        Storage.saveStats(this.stats);
        
        // 保存对局记录
        const record = {
            date: new Date().toISOString(),
            mode: this.currentMode?.modeName || 'unknown',
            isWin: isHumanWin,
            isLandlord: this.currentMode?.humanIndex === gs?.landlordIndex,
            score: data.scores[this.currentMode?.humanIndex] || 0,
            difficulty: this.currentMode instanceof AIMode ? this.currentMode.difficulty : null,
        };
        Storage.saveGameRecord(record);
        
        // 成就检查
        const bombsPlayed = gs?.history?.filter(h => h.pattern?.type === 'BOMB' || h.pattern?.type === 'ROCKET').length || 0;
        const rocketPlayed = gs?.history?.some(h => h.pattern?.type === 'ROCKET') || false;
        const cleanSweep = gs?.players?.[humanIdx]?.hand?.length === 0;
        const roundData = {
            isWin: isHumanWin,
            isLandlord: humanIdx === gs?.landlordIndex,
            streak: this.stats.streak,
            isSpring: data.springType === 'spring',
            bombsPlayed,
            rocketPlayed,
            cleanSweep,
        };
        const unlocked = Storage.checkAchievements(roundData);
        if (unlocked.length > 0) {
            this.renderer?.showAchievementUnlock(unlocked);
        }
        
        // 保存完整牌局（用于回放）
        if (gs) {
            const fullGame = {
                id: 'game_' + Date.now(),
                date: new Date().toISOString(),
                mode: this.currentMode?.modeName || 'unknown',
                players: gs.players.map(p => p ? { name: p.name, isAI: p.isAI } : null),
                initialHands: gs.initialHands,
                initialBottom: gs.initialBottom,
                landlordIndex: gs.landlordIndex,
                currentCall: gs.currentCall,
                history: gs.history.map(h => ({
                    playerIndex: h.playerIndex,
                    cards: h.cards.map(c => ({ value: c.value, suit: c.suit?.name, rank: c.rankKey, displayName: c.displayName })),
                    pattern: { type: h.pattern?.type, mainValue: h.pattern?.mainValue },
                    timestamp: h.timestamp,
                })),
                result: {
                    winnerIndex: data.winnerIndex,
                    isLandlordWin: data.isLandlordWin,
                    scores: data.scores,
                    springType: data.springType,
                    multiplier: data.multiplier,
                    baseScore: data.baseScore,
                },
            };
            Storage.saveFullGame(fullGame);
        }
        
        // 刷新统计面板
        this._renderStats();
    }
    
    _bindRoundEndListener() {
        if (!this.currentMode) return;
        this.currentMode.gameState.on('roundEnd', (data) => {
            this._saveGameResult(data);
        });
    }
    
    _initLANListeners() {
        // 音效开关
        document.getElementById('btn-sound-toggle')?.addEventListener('click', () => {
            this.renderer?.audio?.playButtonClick();
            const enabled = this.renderer?.audio?.toggle();
            const btn = document.getElementById('btn-sound-toggle');
            if (btn) btn.textContent = enabled ? '🔊' : '🔇';
            this.settings.soundEnabled = enabled;
            Storage.saveSettings(this.settings);
        });
        
        const btnCreate = document.getElementById('btn-create-room');
        const btnJoin = document.getElementById('btn-join-room');
        const btnStart = document.getElementById('btn-lan-start');
        
        btnCreate?.addEventListener('click', async () => {
            this.renderer?.audio?.playButtonClick();
            if (!this.currentMode || !(this.currentMode instanceof LANMode)) return;
            try {
                const roomId = await this.currentMode.createRoom();
                document.getElementById('room-id-display').textContent = roomId;
                document.getElementById('room-info')?.classList.remove('hidden');
                document.getElementById('lan-status').textContent = '等待玩家加入...';
                btnStart?.classList.remove('hidden');
            } catch (err) {
                console.error('创建房间失败:', err);
                alert('连接服务器失败，请确保后端已启动 (npm run server:dev)');
            }
        });
        
        btnJoin?.addEventListener('click', async () => {
            this.renderer?.audio?.playButtonClick();
            if (!this.currentMode || !(this.currentMode instanceof LANMode)) return;
            const roomId = document.getElementById('room-id-input')?.value?.trim();
            if (!roomId) return alert('请输入房间号');
            try {
                await this.currentMode.joinRoom(roomId);
                document.getElementById('lan-status').textContent = '已加入房间，等待房主开始';
            } catch (err) {
                console.error('加入房间失败:', err);
                alert('连接服务器失败');
            }
        });
        
        btnStart?.addEventListener('click', async () => {
            this.renderer?.audio?.playButtonClick();
            if (!this.currentMode || !(this.currentMode instanceof LANMode)) return;
            this.renderer?.destroy?.();
            this.renderer = new Renderer('game-table');
            this.renderer.setGameState(this.currentMode.gameState);
            this.renderer.setMode(this.currentMode);
            this.currentMode.setRenderer(this.renderer);
            
            document.getElementById('lan-screen')?.classList.add('hidden');
            document.getElementById('game-screen')?.classList.remove('hidden');
            await this.currentMode.startGame();
        });
    }
    
    _initCustomListeners() {
        document.getElementById('btn-custom-start')?.addEventListener('click', async () => {
            this.renderer?.audio?.playButtonClick();
            if (!this.currentMode || !(this.currentMode instanceof CustomMode)) return;
            
            const showAll = document.getElementById('cfg-show-all')?.checked;
            const autoPlay = document.getElementById('cfg-auto-play')?.checked;
            const aiDiff = document.getElementById('cfg-ai-diff')?.value || 'normal';
            const soundOn = document.getElementById('cfg-sound')?.checked ?? true;
            const callMode = document.getElementById('cfg-call-mode')?.value || 'score';
            const laizi = document.getElementById('cfg-laizi')?.checked;
            
            this.currentMode.setConfig('showAllCards', showAll);
            this.currentMode.setConfig('autoPlay', autoPlay);
            this.currentMode.setConfig('aiDifficulty', aiDiff);
            this.currentMode.setConfig('callMode', callMode);
            this.currentMode.setConfig('laiziMode', laizi);
            
            this.renderer?.destroy?.();
            this.renderer = new Renderer('game-table');
            this.renderer.setGameState(this.currentMode.gameState);
            this.renderer.setMode(this.currentMode);
            this.renderer.audio.enabled = soundOn;
            this.renderer.audio.setBGMVolume(this.settings.bgmVolume ?? 0.5);
            this.renderer.audio.setSFXVolume(this.settings.sfxVolume ?? 0.5);
            this.currentMode.setRenderer(this.renderer);
            
            document.getElementById('custom-screen')?.classList.add('hidden');
            document.getElementById('game-screen')?.classList.remove('hidden');
            await this.currentMode.startGame();
        });
    }

    showMenu() {
        const menu = document.getElementById('menu-screen');
        const game = document.getElementById('game-screen');
        const lan = document.getElementById('lan-screen');
        const custom = document.getElementById('custom-screen');
        const replay = document.getElementById('replay-screen');
        
        // 停止当前游戏循环并清理 renderer
        if (this.currentMode) {
            this.currentMode.isRunning = false;
            this.currentMode.destroy?.();
        }
        const audio = this.renderer?.audio;
        this.renderer?.destroy?.();
        this.renderer = null;
        
        // 切换回菜单BGM
        audio?.stopBGM();
        setTimeout(() => audio?.playMenuBGM(), 300);
        
        // 淡出当前屏幕
        [game, lan, custom, replay].forEach(s => {
            if (s && !s.classList.contains('hidden')) {
                s.style.opacity = '1';
                s.style.transition = 'opacity 0.3s ease';
                s.style.opacity = '0';
                setTimeout(() => {
                    s.classList.add('hidden');
                    s.style.opacity = '';
                    s.style.transition = '';
                }, 300);
            }
        });
        
        // 淡入菜单
        if (menu) {
            menu.classList.remove('hidden');
            menu.style.opacity = '0';
            menu.style.transition = 'opacity 0.4s ease';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    menu.style.opacity = '1';
                    setTimeout(() => {
                        menu.style.transition = '';
                        this._animateMenuEntrance();
                    }, 400);
                });
            });
        }
    }

    // ---- 回放 ----
    showReplayList() {
        document.getElementById('menu-screen')?.classList.add('hidden');
        document.getElementById('game-screen')?.classList.add('hidden');
        document.getElementById('lan-screen')?.classList.add('hidden');
        document.getElementById('custom-screen')?.classList.add('hidden');
        document.getElementById('replay-screen')?.classList.remove('hidden');
        
        const container = document.getElementById('replay-container');
        if (!container) return;
        
        const replayManager = new ReplayManager('replay-container');
        replayManager.showGameList();
    }

    startReplay() {
        this.showReplayList();
    }
    
    showAchievements() {
        const panel = document.getElementById('achievement-panel');
        const list = document.getElementById('achievement-list');
        if (!panel || !list) return;
        
        const achievements = Storage.getAchievements();
        const defs = Storage.ACHIEVEMENTS;
        const unlockedCount = defs.filter(a => achievements[a.id]).length;
        
        list.innerHTML = `
            <div class="achievement-summary">已解锁 ${unlockedCount} / ${defs.length}</div>
        `;
        
        for (const ach of defs) {
            const isUnlocked = achievements[ach.id];
            const item = document.createElement('div');
            item.className = `achievement-item ${isUnlocked ? 'unlocked' : 'locked'}`;
            item.innerHTML = `
                <div class="ach-item-icon">${ach.icon}</div>
                <div class="ach-item-body">
                    <div class="ach-item-name">${ach.name}</div>
                    <div class="ach-item-desc">${ach.desc}</div>
                </div>
                <div class="ach-item-status">${isUnlocked ? '✓' : '🔒'}</div>
            `;
            list.appendChild(item);
        }
        
        panel.classList.remove('hidden');
    }

    showGame() {
        const menu = document.getElementById('menu-screen');
        const game = document.getElementById('game-screen');
        const lan = document.getElementById('lan-screen');
        const custom = document.getElementById('custom-screen');
        
        [lan, custom].forEach(s => s?.classList.add('hidden'));
        
        if (menu) {
            menu.style.transition = 'opacity 0.3s ease';
            menu.style.opacity = '0';
            setTimeout(() => {
                menu.classList.add('hidden');
                menu.style.opacity = '';
                menu.style.transition = '';
            }, 300);
        }
        
        if (game) {
            game.classList.remove('hidden');
            game.style.opacity = '0';
            game.style.transform = 'scale(0.98)';
            game.style.transition = 'all 0.4s ease-out';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    game.style.opacity = '1';
                    game.style.transform = 'scale(1)';
                    setTimeout(() => {
                        game.style.transition = '';
                        game.style.transform = '';
                    }, 400);
                });
            });
        }
        
        // 切换为游戏BGM（延迟等发牌动画）
        this.renderer?.audio?.stopBGM();
        setTimeout(() => this.renderer?.audio?.playGameBGM(), 1500);
    }

    // ---- AI模式 ----
    async startAIMode() {
        // 停止旧游戏并清理 renderer
        if (this.currentMode) this.currentMode.isRunning = false;
        this.renderer?.destroy?.();
        this.renderer = null;
        
        const diff = document.getElementById('difficulty')?.value || this.settings.difficulty || 'normal';
        const rounds = parseInt(document.getElementById('match-rounds')?.value || this.settings.matchRounds || 1);
        this.currentMode = new AIMode(diff);
        await this.currentMode.init();
        this.currentMode.setMatchRounds(rounds);
        document.getElementById('mode-display').textContent = `人机对战 (${diff === 'easy' ? '简单' : diff === 'hard' ? '困难' : '普通'})${rounds > 1 ? ' · ' + rounds + '局' : ''}`;
        
        this.renderer = new Renderer('game-table');
        this.renderer.setGameState(this.currentMode.gameState);
        this.renderer.setMode(this.currentMode);
        this.renderer.audio.setBGMVolume(this.settings.bgmVolume ?? 0.5);
        this.renderer.audio.setSFXVolume(this.settings.sfxVolume ?? 0.5);
        this.currentMode.setRenderer(this.renderer);
        
        this._bindRoundEndListener();
        
        this.showGame();
        await this.currentMode.startGame();
    }

    // ---- 通用页面过渡 ----
    _transitionToScreen(targetId) {
        const menu = document.getElementById('menu-screen');
        const target = document.getElementById(targetId);
        
        if (menu) {
            menu.style.transition = 'opacity 0.3s ease';
            menu.style.opacity = '0';
            setTimeout(() => {
                menu.classList.add('hidden');
                menu.style.opacity = '';
                menu.style.transition = '';
            }, 300);
        }
        
        if (target) {
            target.classList.remove('hidden');
            target.style.opacity = '0';
            target.style.transform = 'translateY(20px) scale(0.98)';
            target.style.transition = 'all 0.4s ease-out';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    target.style.opacity = '1';
                    target.style.transform = 'translateY(0) scale(1)';
                    setTimeout(() => {
                        target.style.transition = '';
                        target.style.transform = '';
                    }, 400);
                });
            });
        }
    }

    // ---- 局域网模式 ----
    async startLANMode() {
        if (this.currentMode) {
            this.currentMode.isRunning = false;
            this.currentMode.destroy?.();
        }
        this._transitionToScreen('lan-screen');
        
        // 重置LAN UI状态
        setTimeout(() => {
            document.getElementById('room-info')?.classList.add('hidden');
            document.getElementById('btn-lan-start')?.classList.add('hidden');
            document.getElementById('lan-status').textContent = '请选择创建或加入房间';
        }, 400);
        
        this.currentMode = new LANMode();
        await this.currentMode.init();
        document.getElementById('mode-display').textContent = '局域网联机';
    }

    // ---- 自定义模式 ----
    async startCustomMode() {
        if (this.currentMode) this.currentMode.isRunning = false;
        this._transitionToScreen('custom-screen');
        
        this.currentMode = new CustomMode();
        await this.currentMode.init();
        document.getElementById('mode-display').textContent = '自定义模式';
    }
}

// 页面加载完成后启动
window.addEventListener('DOMContentLoaded', () => {
    window.gameApp = new GameApp();
});

export { GameApp };

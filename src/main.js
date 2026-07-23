/**
 * Main - 游戏入口
 * 负责：菜单导航、模式切换、全局初始化、数据持久化
 */

import { AIMode } from './modes/ai-mode.js';
import { LANMode } from './modes/lan-mode.js';
import { CustomMode } from './modes/custom-mode.js';
import { DailyMode } from './modes/daily-mode.js';
import { EndgameMode } from './modes/endgame-mode.js';
import { TournamentMode } from './modes/tournament-mode.js';
import { ChallengeMode } from './modes/challenge-mode.js';
import { ChallengeRecordManager, getTodayString } from './utils/daily-challenge.js';
import { EndgameRecordManager, ENDGAME_LEVELS } from './utils/endgame-data.js';
import { CHALLENGES, ExtremeChallengeRecordManager } from './utils/challenge-data.js';
import { TournamentStorage } from './utils/tournament-storage.js';
import { Renderer } from './ui/renderer.js';
import { AudioManager } from './ui/audio.js';
import { Storage } from './utils/storage.js';
import { ReplayManager } from './utils/replay.js';
import { ReplayWorkshop } from './utils/replay-workshop.js';
import { Tutorial } from './ui/tutorial.js';
import { PlayStyleAnalyzer } from './ui/play-style.js';
import { CoachAnalyzer } from './utils/coach-analyzer.js';
import { seasonQuestManager, QUEST_META } from './utils/season-quest.js';

class GameApp {
    constructor() {
        this.currentMode = null;
        this.renderer = null;
        this.menuAudio = new AudioManager();
        this.tutorial = new Tutorial(this.menuAudio);
        this._hasUserInteracted = false;
        this.settings = Storage.getSettings();
        this.stats = { gamesPlayed: 0, wins: 0, losses: 0, totalScore: 0, streak: 0, ...Storage.getStats() };
        this.playStyle = new PlayStyleAnalyzer();
        this._screenTimers = new Map();
        this._syncVersionDisplay();
        this.init();
    }

    _syncVersionDisplay() {
        const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
        this._version = version;
        if (version) {
            document.querySelectorAll('.version-info').forEach(el => {
                el.textContent = 'v' + version;
            });
        }
    }

    _showFallbackToast(msg, type = 'info') {
        // 优先委托给 renderer，否则 fallback 到 alert
        this.renderer?.showToast?.(msg, type) ?? alert(msg);
    }

    _fallbackCopy(text) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px;opacity:0;';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            this._showFallbackToast('分享码已复制到剪贴板', 'success');
        } catch (e) {
            this._showFallbackToast('复制失败，请手动复制分享码', 'error');
        }
    }

    init() {
        // 恢复设置
        this._applySettings();

        // 绑定菜单按钮（带点击音效）
        const menuBtns = [
            { id: 'btn-ai-mode', action: () => this.startAIMode() },
            { id: 'btn-tournament-mode', action: () => this.openTournamentSetup() },
            { id: 'btn-daily-challenge', action: () => this.startDailyMode() },
            { id: 'btn-lan-mode', action: () => this.startLANMode() },
            { id: 'btn-custom-mode', action: () => this.startCustomMode() },
            { id: 'btn-replay', action: () => this.showReplayList() },
            { id: 'btn-workshop', action: () => this.showWorkshop() },
            { id: 'btn-achievements', action: () => this.showAchievements() },
            { id: 'btn-play-style', action: () => this.openPlayStyle() },
            { id: 'btn-tutorial', action: () => this.openTutorial() },
            { id: 'btn-settings', action: () => this.openSettings() },
            { id: 'btn-changelog', action: () => this.openChangelog() },
            { id: 'btn-season-quests', action: () => this.openSeasonQuests() },
            { id: 'btn-endgame-mode', action: () => this.showEndgameLevels() },
            { id: 'btn-challenge-mode', action: () => this.showChallengeLevels() },

        ];
        for (const { id, action } of menuBtns) {
            document.getElementById(id)?.addEventListener('click', () => {
                // 首次交互：尝试恢复被阻止的 BGM
                if (!this._hasUserInteracted) {
                    this._hasUserInteracted = true;
                    const audio = this._getActiveAudio();
                    audio?._ensureContext().then(ok => {
                        if (ok && !this.renderer) {
                            audio?.playMenuBGM();
                        }
                    });
                }
                this._playButtonClick();
                action();
            });
        }

        // 注意：菜单按钮事件在 init() 中只绑定一次，GameApp 为单例生命周期与页面一致，
        // 因此没有集中移除监听器的机制。如需重构为多实例或支持热重启，需补充清理逻辑。

        // 音量控制
        let sfxPreviewTimer = null;
        const bindVolume = (sliderId, valueId, key, setter, isSFX = false) => {
            const slider = document.getElementById(sliderId);
            const val = document.getElementById(valueId);
            if (!slider) return;
            slider.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value);
                this.settings[key] = v;
                if (val) val.textContent = Math.round(v * 100) + '%';
                Storage.saveSettings(this.settings);
                this.menuAudio?.[setter]?.(v);
                this.renderer?.audio?.[setter]?.(v);
                // SFX 音量调节时播放预览音效（节流 150ms）
                if (isSFX) {
                    if (sfxPreviewTimer) clearTimeout(sfxPreviewTimer);
                    sfxPreviewTimer = setTimeout(() => {
                        this._getActiveAudio()?.playTick();
                    }, 150);
                }
            });
        };
        bindVolume('cfg-bgm-volume', 'cfg-bgm-volume-value', 'bgmVolume', 'setBGMVolume');
        bindVolume('cfg-sfx-volume', 'cfg-sfx-volume-value', 'sfxVolume', 'setSFXVolume', true);
        this._bindUXSettings();
        this._hideUnimplementedSettings();

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

        // 游戏速度
        const speedSelect = document.getElementById('game-speed');
        if (speedSelect) {
            speedSelect.value = String(this.settings.gameSpeed || 1.0);
            speedSelect.addEventListener('change', (e) => {
                this.settings.gameSpeed = parseFloat(e.target.value);
                Storage.saveSettings(this.settings);
            });
        }

        // 玩家名称
        const nameInput = document.getElementById('player-name');
        if (nameInput) {
            nameInput.value = this.settings.playerName || '玩家';
            nameInput.addEventListener('change', (e) => {
                const name = e.target.value.trim() || '玩家';
                this.settings.playerName = name;
                Storage.saveSettings(this.settings);
            });
        }

        // 成就面板关闭
        document.getElementById('btn-close-achievements')?.addEventListener('click', () => {
            this._playButtonClick();
            const panel = document.getElementById('achievement-panel');
            if (!panel) return;
            if (this._achCloseTimer) clearTimeout(this._achCloseTimer);
            panel.classList.add('panel-exit');
            this._achCloseTimer = setTimeout(() => {
                panel.classList.add('hidden');
                this._achCloseTimer = null;
            }, 200);
        });

        // 设置面板关闭
        document.getElementById('btn-close-settings')?.addEventListener('click', () => {
            this.closeSettings();
        });
        document.getElementById('settings-overlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'settings-overlay') this.closeSettings();
        });

        // 赛季任务面板事件绑定
        document.getElementById('btn-close-season-quests')?.addEventListener('click', () => {
            this.closeSeasonQuests();
        });
        document.getElementById('season-quest-overlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'season-quest-overlay') this.closeSeasonQuests();
        });
        document.getElementById('btn-claim-all-quests')?.addEventListener('click', () => {
            this._playButtonClick();
            const results = seasonQuestManager.claimAll();
            if (results.length > 0) {
                const totalExp = results.reduce((s, r) => s + (r.reward.exp || 0), 0);
                const badges = results.filter(r => r.reward.badge).map(r => r.reward.badgeName);
                const msg = [`✅ 一键领取成功！共 ${results.length} 个任务`];
                if (totalExp) msg.push(`+${totalExp} EXP`);
                if (badges.length) msg.push(`获得徽章：${badges.join('、')}`);
                this.renderer?.showToast?.(msg.join('\n'), 'success');
                this._renderSeasonQuests();
                this._updateSeasonQuestBadge();
            } else {
                this.renderer?.showToast?.('暂无可领取的奖励', 'info');
            }
        });

        // 锦标赛配置面板事件绑定
        document.getElementById('btn-close-tournament-setup')?.addEventListener('click', () => {
            this.closeTournamentSetup();
        });
        document.getElementById('tournament-setup-overlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'tournament-setup-overlay') this.closeTournamentSetup();
        });
        document.querySelectorAll('.tour-round-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this._playButtonClick();
                document.querySelectorAll('.tour-round-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const val = parseInt(btn.dataset.rounds, 10);
                const input = document.getElementById('tour-custom-rounds-input');
                if (input) input.value = val;
            });
        });
        const tourCustomInput = document.getElementById('tour-custom-rounds-input');
        if (tourCustomInput) {
            tourCustomInput.addEventListener('change', () => {
                document.querySelectorAll('.tour-round-btn').forEach(b => b.classList.remove('active'));
            });
            tourCustomInput.addEventListener('input', () => {
                document.querySelectorAll('.tour-round-btn').forEach(b => b.classList.remove('active'));
            });
        }
        document.getElementById('btn-start-tournament')?.addEventListener('click', () => {
            this._playButtonClick();
            this.startTournament();
        });

        // 返回按钮（跨屏幕通用）
        document.getElementById('btn-back-lan')?.addEventListener('click', () => {
            this._playButtonClick();
            this.showMenu();
        });
        document.getElementById('btn-back-custom')?.addEventListener('click', () => {
            this._playButtonClick();
            this.showMenu();
        });
        document.getElementById('btn-back-replay')?.addEventListener('click', () => {
            this._playButtonClick();
            this.showMenu();
        });
        document.getElementById('btn-back-workshop')?.addEventListener('click', () => {
            this._playButtonClick();
            this.showMenu();
        });
        document.getElementById('btn-back-endgame')?.addEventListener('click', () => {
            this._playButtonClick();
            this.showMenu();
        });
        document.getElementById('btn-back-challenge')?.addEventListener('click', () => {
            this._playButtonClick();
            this.showMenu();
        });

        // 游戏内音效开关（所有模式通用）
        document.getElementById('btn-sound-toggle')?.addEventListener('click', () => {
            this.toggleSound();
        });

        // 全屏切换
        document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
            this._playButtonClick();
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen?.().catch(() => {});
            } else {
                document.exitFullscreen?.().catch(() => {});
            }
        });

        // LAN界面事件（只绑定一次）
        this._initLANListeners();
        this._initCustomListeners();

        // 渲染统计面板
        this._renderStats();

        // 新手引导
        this._initTutorial();

        // 公告弹窗事件绑定
        document.getElementById('btn-close-changelog')?.addEventListener('click', () => this.closeChangelog());
        document.getElementById('btn-changelog-ok')?.addEventListener('click', () => this.closeChangelog());
        document.getElementById('changelog-overlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'changelog-overlay') this.closeChangelog();
        });

        // 牌风分析面板事件绑定
        document.getElementById('btn-close-play-style')?.addEventListener('click', () => this.closePlayStyle());
        document.getElementById('play-style-overlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'play-style-overlay') this.closePlayStyle();
        });

        // 全局 ESC 键：关闭菜单界面的弹窗（设置/公告/牌风）
        this._menuEscHandler = (e) => {
            const settingsOverlay = document.getElementById('settings-overlay');
            const changelogOverlay = document.getElementById('changelog-overlay');
            const playStyleOverlay = document.getElementById('play-style-overlay');
            const seasonQuestOverlay = document.getElementById('season-quest-overlay');
            const tournamentSetupOverlay = document.getElementById('tournament-setup-overlay');
            const achievementPanel = document.getElementById('achievement-panel');
            const challengeResultOverlay = document.getElementById('challenge-result-overlay');
            const challengeHistoryOverlay = document.getElementById('challenge-history-overlay');
            const activeOverlay = [settingsOverlay, changelogOverlay, playStyleOverlay, seasonQuestOverlay,
                tournamentSetupOverlay, achievementPanel, challengeResultOverlay, challengeHistoryOverlay]
                .find(overlay => overlay && !overlay.classList.contains('hidden'));
            if (e.key === 'Tab' && activeOverlay) {
                this._trapModalFocus(activeOverlay, e);
                return;
            }
            if (e.key !== 'Escape') return;
            if (challengeHistoryOverlay && !challengeHistoryOverlay.classList.contains('hidden')) {
                challengeHistoryOverlay.classList.add('hidden');
                e.stopPropagation();
            } else if (challengeResultOverlay && !challengeResultOverlay.classList.contains('hidden')) {
                this.closeChallengeResult();
                e.stopPropagation();
            } else if (achievementPanel && !achievementPanel.classList.contains('hidden')) {
                achievementPanel.classList.add('hidden');
                e.stopPropagation();
            } else if (seasonQuestOverlay && !seasonQuestOverlay.classList.contains('hidden')) {
                this.closeSeasonQuests();
                e.stopPropagation();
            } else if (tournamentSetupOverlay && !tournamentSetupOverlay.classList.contains('hidden')) {
                this.closeTournamentSetup();
                e.stopPropagation();
            } else if (playStyleOverlay && !playStyleOverlay.classList.contains('hidden')) {
                this.closePlayStyle();
                e.stopPropagation();
            } else if (changelogOverlay && !changelogOverlay.classList.contains('hidden')) {
                this.closeChangelog();
                e.stopPropagation();
            } else if (settingsOverlay && !settingsOverlay.classList.contains('hidden')) {
                this.closeSettings();
                e.stopPropagation();
            }
        };
        document.addEventListener('keydown', this._menuEscHandler);

        // 隐藏加载画面 + 菜单入场动画 + BGM
        setTimeout(() => {
            // loading-screen 元素不存在，跳过
            this._animateMenuEntrance();
            // 延迟播放菜单BGM（等待用户交互解锁AudioContext）
            setTimeout(() => {
                this._playMenuBGM();
            }, 500);
        }, 600);

        // 首次加载：延迟检查是否需要自动弹出公告
        setTimeout(() => this._checkAutoShowChangelog(), 1200);
        // 更新徽章
        this._updateDailyChallengeBadge();
        this._updateEndgameBadge();
        this._updateChallengeBadge();
        this._updateSeasonQuestBadge();
    }

    _getActiveAudio() {
        return this.renderer?.audio || this.menuAudio;
    }

    _escapeHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'})[m]);
    }

    /**
     * 隐藏未实现的设置项，防止用户看到"保存了但不生效"的假设置
     */
    _hideUnimplementedSettings() {
        const UNIMPLEMENTED = new Set([
            // 音频：语音播报/语音包/BGM曲目 暂无后端支持
            'voiceAnnounce', 'bgmTrack', 'voicePack',
            // 视觉：粒子数量/连击播报阈值 未接入动画系统
            'particleCount', 'comboAnnounce',
            // AI：所有行为细调项未接入 AI 决策
            'aiCallStrategy', 'aiPlayStyle', 'aiMemoryLevel', 'aiCooperation',
            'aiBluffRate', 'aiRiskTolerance', 'aiDifficultyScale', 'aiEmoteRate', 'aiUseHint',
            // 交互：大量未实现的操作辅助
            'spaceConfirm', 'autoHint', 'smartDiscard', 'playConfirm',
            'smartSort', 'autoArrange', 'autoSortAfterPlay', 'stickySelection',
            'showPlayPreview', 'gestureEnabled', 'swipeToSelect', 'longPressHint',
            // 性能/网络/调试：无实际代码消费
            'frameLimit', 'networkQuality', 'reconnectAttempts', 'heartbeatInterval',
            'lagCompensation', 'autoSaveInterval',
            // 辅助：未实现的高级提示
            'showWinProbability', 'showBestMove', 'handAnalysis',
            'showOpponentTendency', 'showDangerCards',
            'autoOpenTracker', 'autoOpenHistory', 'hintDetail', 'sortOrder',
            // 面板开关：enableStats/enableAchievements 未接入面板显隐
            'enableStats', 'enableAchievements',
        ]);
        for (const key of UNIMPLEMENTED) {
            const control = document.querySelector(`[data-setting="${key}"]`);
            if (!control) continue;
            const container = control.closest('.setting-row, .toggle-switch-wrap, .setting-slider, .volume-control, label');
            if (container) {
                container.style.display = 'none';
                container.dataset.unimplemented = 'true';
            }
        }
    }

    _syncAudioSettings(audio) {
        if (!audio) return;
        audio.enabled = this.settings.soundEnabled !== false;
        const newBgmEnabled = this.settings.bgmEnabled !== false;
        if (audio.bgmEnabled && !newBgmEnabled) {
            audio.stopBGM();
        }
        audio.bgmEnabled = newBgmEnabled;
        audio.setSFXEnabled(this.settings.sfxEnabled !== false);
        audio.setBGMVolume(this.settings.bgmVolume ?? 0.5);
        audio.setSFXVolume(this.settings.sfxVolume ?? 0.5);
        audio.setVoiceVolume(this.settings.voiceVolume ?? 0.7);
    }

    _syncSoundToggleButton(enabled = this.settings.soundEnabled !== false) {
        const btn = document.getElementById('btn-sound-toggle');
        if (!btn) return;
        btn.textContent = enabled ? '🔊' : '🔇';
        btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        btn.setAttribute('title', enabled ? '关闭音效' : '开启音效');
        btn.setAttribute('aria-label', enabled ? '关闭音效' : '开启音效');
    }

    toggleSound() {
        const audio = this._getActiveAudio();
        audio?.playButtonClick();
        const enabled = audio?.toggle() ?? !(this.settings.soundEnabled !== false);
        this.settings.soundEnabled = enabled;
        Storage.saveSettings(this.settings);
        if (this.menuAudio && this.menuAudio !== audio) this._syncAudioSettings(this.menuAudio);
        if (this.renderer?.audio && this.renderer.audio !== audio) this._syncAudioSettings(this.renderer.audio);
        this._syncSoundToggleButton(enabled);
        return enabled;
    }

    _configureRendererAudio(renderer) {
        this._syncAudioSettings(renderer?.audio);
        // 初始化评论系统开关
        return renderer;
    }

    _playButtonClick() {
        this._syncAudioSettings(this._getActiveAudio());
        this._getActiveAudio()?.playButtonClick();
    }

    _playMenuBGM(delay = 300) {
        if (this.renderer) return;
        this._syncAudioSettings(this.menuAudio);
        // 如果菜单 BGM 正在播放或即将播放，避免中断重启
        if (this.menuAudio?._currentBGM === 'menu' && (this.menuAudio?._bgmNodes?.length > 0 || this.menuAudio?._bgmTimer)) return;
        this.menuAudio?.stopBGM();
        if (this._menuBgmTimer) clearTimeout(this._menuBgmTimer);
        this._menuBgmTimer = setTimeout(() => {
            this._menuBgmTimer = null;
            if (!this.renderer) this.menuAudio?.playMenuBGM();
        }, delay);
    }

    _stopMenuAudio() {
        this.menuAudio?.stopBGM();
        if (this._menuBgmTimer) { clearTimeout(this._menuBgmTimer); this._menuBgmTimer = null; }
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

        // 按钮依次弹入（主模式卡片 + 小卡片）
        const buttons = menuScreen.querySelectorAll('.mode-card');
        buttons.forEach((btn, i) => {
            btn.style.opacity = '0';
            btn.style.transform = 'translateY(30px) scale(0.9)';
            btn.style.transition = `all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) ${300 + i * 80}ms`;
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

        const themeSelect = document.getElementById('theme');
        if (themeSelect) themeSelect.value = this.settings.theme || 'green';
        this._applyTheme(this.settings.theme || 'green');

        const roundsSelect = document.getElementById('match-rounds');
        if (roundsSelect) roundsSelect.value = String(this.settings.matchRounds || 1);

        const speedSelect = document.getElementById('game-speed');
        if (speedSelect) speedSelect.value = String(this.settings.gameSpeed || 1.0);

        const nameInput = document.getElementById('player-name');
        if (nameInput) nameInput.value = this.settings.playerName || '玩家';

        // 音量滑块
        const bgmSlider = document.getElementById('cfg-bgm-volume');
        const bgmVal = document.getElementById('cfg-bgm-volume-value');
        if (bgmSlider) bgmSlider.value = this.settings.bgmVolume ?? 0.5;
        if (bgmVal) bgmVal.textContent = Math.round((this.settings.bgmVolume ?? 0.5) * 100) + '%';

        const sfxSlider = document.getElementById('cfg-sfx-volume');
        const sfxVal = document.getElementById('cfg-sfx-volume-value');
        if (sfxSlider) sfxSlider.value = this.settings.sfxVolume ?? 0.5;
        if (sfxVal) sfxVal.textContent = Math.round((this.settings.sfxVolume ?? 0.5) * 100) + '%';

        this._syncSoundToggleButton();
        this._syncUXSettingControls();
        this._applyUXSettings();
    }

    _bindUXSettings() {
        if (this._uxSettingsBound) return;
        this._uxSettingsBound = true;
        const controls = document.querySelectorAll('[data-setting]');
        controls.forEach(control => {
            const eventName = control.type === 'range' ? 'input' : 'change';
            control.addEventListener(eventName, () => {
                const key = control.dataset.setting;
                if (!key) return;
                if (control.type === 'checkbox') {
                    this.settings[key] = control.checked;
                } else if (control.type === 'range') {
                    this.settings[key] = parseFloat(control.value);
                } else {
                    this.settings[key] = control.value;
                }
                Storage.saveSettings(this.settings);
                if (key.startsWith('enable') && key.endsWith('Sound')) {
                    this._getActiveAudio()?.reloadSfxSettings?.();
                }
                this._applyUXSettings();
                this._updateUXSettingLabel(key);

                // === 即时同步音频开关 ===
                if (key === 'bgmEnabled') {
                    const audio = this._getActiveAudio();
                    if (audio) {
                        audio.bgmEnabled = control.checked;
                        if (!control.checked) {
                            audio.stopBGM();
                        } else {
                            // 根据当前场景播放正确的 BGM
                            if (!this.renderer) {
                                audio.playMenuBGM?.();
                            } else if (audio._currentBGM === 'game') {
                                audio.playGameBGM?.();
                            } else if (audio._currentBGM !== 'win' && audio._currentBGM !== 'lose') {
                                audio.playGameBGM?.();
                            }
                        }
                    }
                }
                if (key === 'sfxEnabled') {
                    const audio = this._getActiveAudio();
                    audio?.setSFXEnabled(control.checked);
                }
                // === 音效反馈 ===
                const audio = this._getActiveAudio();
                if (control.type === 'checkbox') {
                    audio?.playSettingToggle?.(control.checked);
                } else if (control.type === 'range') {
                    clearTimeout(control._sfxTimer);
                    control._sfxTimer = setTimeout(() => {
                        audio?.playSettingSlider?.();
                    }, 120);
                }

                // === 视觉反馈（rAF 节流避免高频 reflow）===
                const parent = control.closest('.setting-row, .toggle-switch-wrap, .setting-slider, .volume-control');
                if (parent && !control._rafPending) {
                    control._rafPending = true;
                    requestAnimationFrame(() => {
                        control._rafPending = false;
                        parent.classList.remove('setting-changed');
                        void parent.offsetWidth;
                        parent.classList.add('setting-changed');
                        clearTimeout(parent._chgTimer);
                        parent._chgTimer = setTimeout(() => parent.classList.remove('setting-changed'), 500);
                    });
                }
            });
        });

        document.getElementById('btn-reset-ux-settings')?.addEventListener('click', () => {
            this._playButtonClick();
            this._getActiveAudio()?.playSettingReset?.();
            Object.assign(this.settings, {
                // 视觉
                uiDensity: 'comfortable', animationLevel: 'normal', cardStyle: 'modern',
                cardBackStyle: 'classic', cardCornerRadius: 8, cardBorderWidth: 1,
                fontSize: 'medium', darkMode: false, highContrast: false,
                colorblindMode: false, colorblindType: 'none',
                // 布局
                tableScale: 1, cardScale: 1, playedCardScale: 1, replayCardScale: 1,
                playedOverlap: 16, selectedLift: 8, hoverLift: 5, panelOpacity: 80,
                handArrangement: 'fan', playedCardArrangement: 'straight',
                // 动画
                animSpeed: 1.0, particleIntensity: 'normal', particleCount: 50,
                screenShakeIntensity: 'normal', floatingTextSize: 'normal',
                shadowIntensity: 'normal', glowIntensity: 'normal', transitionSpeed: 1.0,
                winEffectLevel: 'normal', bombEffectLevel: 'normal', comboAnnounce: 2,
                cardEnterStagger: 30,
                // 交互
                clickToSelect: true, doubleClickToPlay: false, spaceConfirm: true,
                autoHint: true, smartDiscard: true, playConfirm: false, passConfirm: false,
                confirmOnBomb: false, dragThreshold: 7, oneClickPlay: false,
                smartSort: false, rightClickCancel: true, wheelZoom: true,
                autoArrange: true, autoSortAfterPlay: false, stickySelection: false,
                showPlayPreview: true, gestureEnabled: true, swipeToSelect: true,
                longPressHint: false, hapticEnabled: true,
                // 辅助
                showTutorial: true, showShortcuts: true, showTableAura: true, enableCommentary: false,
                opponentCards: 'stack', autoOpenTracker: false, autoOpenHistory: false,
                hintDetail: 'type', sortOrder: 'value', showRemainingCount: true,
                showWinProbability: false, showBestMove: false, handAnalysis: false,
                showOpponentTendency: false, showDangerCards: false,
                highlightPlayable: true, showPatternName: true, showPlayerStats: false,
                showOpponentCall: true,
                // 面板
                enableCardTracker: true, enableAutoHint: true, enableChat: false,
                enableEmoji: false, enableReplay: true, enableStats: true,
                enableAchievements: true,
                // 无障碍
                reduceMotion: false, largeClickTargets: false, highVisibility: false,
                // 性能
                showFPS: false, showMemory: false, frameLimit: 60, lazyRender: false,
                debugMode: false, experimentalFeatures: false,
                // 网络
                networkQuality: 'auto', reconnectAttempts: 3, heartbeatInterval: 5,
                lagCompensation: true,
                // 高级
                spectatorDelay: 0, autoSaveInterval: 30, maxHistory: 50,
                // 个性化
                avatarStyle: 'default', language: 'zh-CN',
            });
            Storage.saveSettings(this.settings);
            this._syncUXSettingControls();
            this._applyUXSettings();
        });

        // 恢复所有默认（包括游戏规则）
        document.getElementById('btn-reset-all-settings')?.addEventListener('click', () => {
            this._playButtonClick();
            this._getActiveAudio()?.playSettingReset?.();
            if (confirm('确定要恢复所有设置到默认状态吗？这将重置包括游戏规则在内的所有参数，但不会清除牌风分析数据（如需清除请前往牌风分析面板）。')) {
                this.settings = Storage.resetSettings(); // 清除 localStorage 并获取纯默认值
                this._syncAllSettings();
                this._applyUXSettings();
                this._applyTheme(this.settings.theme || 'green');
            }
        });
    }

    _trapModalFocus(overlay, event) {
        const focusable = Array.from(overlay.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])'
        )).filter(el => el.getClientRects().length > 0);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!overlay.contains(document.activeElement)) {
            event.preventDefault();
            first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    // ===== 设置面板打开/关闭 =====
    openSettings(returnFocus = null) {
        const overlay = document.getElementById('settings-overlay');
        if (!overlay || !overlay.classList.contains('hidden')) return;
        this._settingsReturnFocus = returnFocus instanceof HTMLElement
            ? returnFocus
            : document.activeElement instanceof HTMLElement && document.activeElement !== document.body
                ? document.activeElement
                : document.getElementById('btn-settings');
        overlay.classList.remove('hidden');
        overlay.style.opacity = '0';
        overlay.style.transform = 'scale(0.96)';
        requestAnimationFrame(() => {
            overlay.style.transition = 'opacity 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                overlay.style.transform = 'scale(1)';
            });
        });
        this._settingsOpen = true;
        this._getActiveAudio()?.playSettingOpen?.();
        // 聚焦搜索框（保存 timer 引用以便关闭时取消）
        if (this._settingsFocusTimer) clearTimeout(this._settingsFocusTimer);
        this._settingsFocusTimer = setTimeout(() => {
            this._settingsFocusTimer = null;
            document.getElementById('settings-search-input')?.focus();
        }, 100);
        // 初始化搜索
        this._initSettingsSearch();
    }

    closeSettings() {
        const overlay = document.getElementById('settings-overlay');
        if (!overlay || overlay.classList.contains('hidden')) return;
        this._getActiveAudio()?.playSettingClose?.();
        this._settingsOpen = false;
        // 取消待执行的 focus timer
        if (this._settingsFocusTimer) {
            clearTimeout(this._settingsFocusTimer);
            this._settingsFocusTimer = null;
        }
        if (this._settingsCloseTimer) clearTimeout(this._settingsCloseTimer);
        overlay.style.transition = 'opacity 0.2s ease-in, transform 0.2s ease-in';
        overlay.style.opacity = '0';
        overlay.style.transform = 'scale(0.96)';
        this._settingsCloseTimer = setTimeout(() => {
            this._settingsCloseTimer = null;
            overlay.classList.add('hidden');
            overlay.style.opacity = '';
            overlay.style.transform = '';
            overlay.style.transition = '';
            const returnFocus = this._settingsReturnFocus;
            this._settingsReturnFocus = null;
            const pauseOverlay = returnFocus?.closest?.('#pause-overlay');
            if (pauseOverlay && this.renderer?._isPaused) {
                pauseOverlay.classList.remove('hidden');
                pauseOverlay.style.display = 'flex';
                pauseOverlay.style.opacity = '1';
            }
            if (returnFocus?.isConnected) returnFocus.focus();
            else document.getElementById('btn-settings')?.focus();
        }, 200);
        // 清空搜索
        const searchInput = document.getElementById('settings-search-input');
        if (searchInput) {
            searchInput.value = '';
            this._filterSettings('');
        }
    }

    // ===== 公告弹窗 =====
    openChangelog() {
        const overlay = document.getElementById('changelog-overlay');
        if (!overlay || !overlay.classList.contains('hidden')) return;
        this._changelogReturnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
            ? document.activeElement
            : document.getElementById('btn-changelog');
        overlay.classList.remove('hidden');
        overlay.style.opacity = '0';
        overlay.style.transform = 'scale(0.96)';
        requestAnimationFrame(() => {
            overlay.style.transition = 'opacity 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                overlay.style.transform = 'scale(1)';
            });
        });
        document.getElementById('btn-close-changelog')?.focus();
        this._getActiveAudio()?.playSettingOpen?.();
        // 标记已读当前版本
        try {
            localStorage.setItem('ddz_last_changelog_version', this._version);
        } catch (e) {}
    }

    closeChangelog() {
        const overlay = document.getElementById('changelog-overlay');
        if (!overlay || overlay.classList.contains('hidden')) return;
        if (this._changelogCloseTimer) clearTimeout(this._changelogCloseTimer);
        this._getActiveAudio()?.playSettingClose?.();
        overlay.style.transition = 'opacity 0.2s ease-in, transform 0.2s ease-in';
        overlay.style.opacity = '0';
        overlay.style.transform = 'scale(0.96)';
        this._changelogCloseTimer = setTimeout(() => {
            this._changelogCloseTimer = null;
            overlay.classList.add('hidden');
            overlay.style.opacity = '';
            overlay.style.transform = '';
            overlay.style.transition = '';
            const returnFocus = this._changelogReturnFocus;
            this._changelogReturnFocus = null;
            if (returnFocus?.isConnected) returnFocus.focus();
            else document.getElementById('btn-changelog')?.focus();
        }, 200);
    }

    _checkAutoShowChangelog() {
        try {
            const last = localStorage.getItem('ddz_last_changelog_version') || '';
            if (last !== this._version) {
                this.openChangelog();
            }
        } catch (e) {}
    }

    // ===== 牌风分析面板 =====
    openPlayStyle() {
        const overlay = document.getElementById('play-style-overlay');
        if (!overlay || !overlay.classList.contains('hidden')) return;
        this._playStyleReturnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
            ? document.activeElement
            : document.getElementById('btn-play-style');
        overlay.classList.remove('hidden');
        overlay.style.opacity = '0';
        overlay.style.transform = 'scale(0.96)';
        requestAnimationFrame(() => {
            overlay.style.transition = 'opacity 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                overlay.style.transform = 'scale(1)';
            });
        });
        document.getElementById('btn-close-play-style')?.focus();
        this._getActiveAudio()?.playSettingOpen?.();
        // 渲染内容
        const content = document.getElementById('play-style-content');
        if (content) {
            try {
                this.playStyle.renderPanel(content);
            } catch (e) {
                console.error('牌风面板渲染失败:', e);
                content.innerHTML = `<div class="play-style-empty"><div class="play-style-empty-icon">⚠️</div><p>数据加载失败</p><p class="play-style-empty-hint">请刷新页面重试</p></div>`;
            }
        }
    }

    closePlayStyle() {
        const overlay = document.getElementById('play-style-overlay');
        if (!overlay || overlay.classList.contains('hidden')) return;
        if (this._playStyleCloseTimer) clearTimeout(this._playStyleCloseTimer);
        this._getActiveAudio()?.playSettingClose?.();
        overlay.style.transition = 'opacity 0.2s ease-in, transform 0.2s ease-in';
        overlay.style.opacity = '0';
        overlay.style.transform = 'scale(0.96)';
        this._playStyleCloseTimer = setTimeout(() => {
            this._playStyleCloseTimer = null;
            overlay.classList.add('hidden');
            overlay.style.opacity = '';
            overlay.style.transform = '';
            overlay.style.transition = '';
            const returnFocus = this._playStyleReturnFocus;
            this._playStyleReturnFocus = null;
            if (returnFocus?.isConnected) returnFocus.focus();
            else document.getElementById('btn-play-style')?.focus();
        }, 200);
    }

    // ===== 设置搜索过滤 =====
    _initSettingsSearch() {
        if (this._settingsSearchBound) return;
        this._settingsSearchBound = true;

        const searchInput = document.getElementById('settings-search-input');
        const clearBtn = document.getElementById('settings-search-clear');

        const searchWrap = searchInput?.closest('.settings-search');
        let debounceTimer = null;
        searchInput?.addEventListener('input', (e) => {
            const hasValue = e.target.value.length > 0;
            searchWrap?.classList.toggle('has-value', hasValue);
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                this._filterSettings(e.target.value.trim());
            }, 150);
        });

        clearBtn?.addEventListener('click', () => {
            if (searchInput) {
                searchInput.value = '';
                searchInput.focus();
                this._filterSettings('');
            }
        });

        searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchInput.value = '';
                this._filterSettings('');
            }
        });
    }

    _filterSettings(query) {
        const panel = document.querySelector('.settings-panel');
        if (!panel) return;
        const countEl = document.getElementById('settings-search-count');
        const details = Array.from(panel.querySelectorAll('.advanced-settings'));

        if (!query) {
            // 清除搜索时恢复搜索前的展开状态，避免一次搜索永久展开大量分类。
            panel.querySelectorAll('.setting-hidden').forEach(el => el.classList.remove('setting-hidden'));
            panel.querySelectorAll('.setting-search-match').forEach(el => el.classList.remove('setting-search-match'));
            if (this._settingsSearchOpenState) {
                details.forEach(detail => {
                    if (this._settingsSearchOpenState.has(detail)) {
                        detail.open = this._settingsSearchOpenState.get(detail);
                    }
                });
                this._settingsSearchOpenState = null;
            }
            const input = document.getElementById('settings-search-input');
            if (!input?.value) input?.closest('.settings-search')?.classList.remove('has-value');
            if (countEl) countEl.textContent = '';
            return;
        }

        const q = query.toLowerCase();
        if (!this._settingsSearchOpenState) {
            this._settingsSearchOpenState = new Map(details.map(detail => [detail, detail.open]));
        }

        // data-search 为缩写、同义词提供额外索引（例如“音量”可命中 BGM/SFX）。
        const searchable = [];
        panel.querySelectorAll('.setting-row, .toggle-switch-wrap, .setting-slider, .volume-control').forEach(el => {
            if (el.dataset.unimplemented === 'true' || el.closest('[data-unimplemented="true"]')) return;
            const text = `${el.textContent} ${el.dataset.search || ''}`.toLowerCase();
            searchable.push({ el, text });
        });

        panel.querySelectorAll('.setting-hidden').forEach(el => el.classList.remove('setting-hidden'));
        panel.querySelectorAll('.setting-search-match').forEach(el => el.classList.remove('setting-search-match'));
        searchable.forEach(({ el }) => el.classList.add('setting-hidden'));
        const matches = new Set();

        searchable.forEach(({ el, text }) => {
            if (text.includes(q)) {
                el.classList.remove('setting-hidden');
                el.classList.add('setting-search-match');
                matches.add(el);
            }
        });

        // 分类标题可直接搜索；命中标题时展示该分类内全部已实现设置。
        details.forEach(detail => {
            const summaryMatches = (detail.querySelector('summary')?.textContent || '').toLowerCase().includes(q);
            if (summaryMatches) {
                searchable.forEach(({ el }) => {
                    if (detail.contains(el)) {
                        el.classList.remove('setting-hidden');
                        el.classList.add('setting-search-match');
                        matches.add(el);
                    }
                });
            }
            const hasMatch = searchable.some(({ el }) => detail.contains(el) && matches.has(el));
            detail.classList.toggle('setting-hidden', !hasMatch && !summaryMatches);
            if (hasMatch || summaryMatches) detail.open = true;
        });

        // 基础/音频是非 details 分组：只在标题或其直属设置命中时显示。
        panel.querySelectorAll('.settings-section-title').forEach(title => {
            const groupNodes = [];
            let node = title.nextElementSibling;
            while (node && !node.classList.contains('settings-section-title') && !node.classList.contains('advanced-settings')) {
                groupNodes.push(node);
                node = node.nextElementSibling;
            }
            const titleMatches = title.textContent.toLowerCase().includes(q);
            if (titleMatches) {
                searchable.forEach(({ el }) => {
                    if (groupNodes.some(group => group === el || group.contains(el))) {
                        el.classList.remove('setting-hidden');
                        el.classList.add('setting-search-match');
                        matches.add(el);
                    }
                });
            }
            const hasMatch = searchable.some(({ el }) =>
                matches.has(el) && groupNodes.some(group => group === el || group.contains(el))
            );
            title.classList.toggle('setting-hidden', !titleMatches && !hasMatch);
        });

        // 隐藏已经没有可见子项的布局容器，避免搜索结果间出现空白间距。
        panel.querySelectorAll('.settings-grid, .settings-toggles, .settings-slider-list').forEach(group => {
            const hasMatch = searchable.some(({ el }) => matches.has(el) && group.contains(el));
            group.classList.toggle('setting-hidden', !hasMatch);
        });

        if (countEl) {
            countEl.textContent = matches.size > 0 ? `${matches.size} 项匹配` : '无匹配';
        }
    }

    _syncUXSettingControls() {
        document.querySelectorAll('[data-setting]').forEach(control => {
            const key = control.dataset.setting;
            if (!key) return;
            const value = this.settings[key];
            if (control.type === 'checkbox') {
                control.checked = value !== false;
            } else if (value !== undefined) {
                control.value = String(value);
            }
            this._updateUXSettingLabel(key);
        });
        this._syncAudioSettings(this.menuAudio);
        if (this.renderer?.audio) this._syncAudioSettings(this.renderer.audio);
    }

    _syncAllSettings() {
        // 同步所有设置控件（包括非 data-setting 的基础控件）
        const diffSelect = document.getElementById('difficulty');
        if (diffSelect) diffSelect.value = this.settings.difficulty;

        const themeSelect = document.getElementById('theme');
        if (themeSelect) themeSelect.value = this.settings.theme || 'green';

        const roundsSelect = document.getElementById('match-rounds');
        if (roundsSelect) roundsSelect.value = String(this.settings.matchRounds || 1);

        const speedSelect = document.getElementById('game-speed');
        if (speedSelect) speedSelect.value = String(this.settings.gameSpeed || 1.0);

        const nameInput = document.getElementById('player-name');
        if (nameInput) nameInput.value = this.settings.playerName || '玩家';

        const bgmSlider = document.getElementById('cfg-bgm-volume');
        const bgmVal = document.getElementById('cfg-bgm-volume-value');
        if (bgmSlider) bgmSlider.value = this.settings.bgmVolume ?? 0.5;
        if (bgmVal) bgmVal.textContent = Math.round((this.settings.bgmVolume ?? 0.5) * 100) + '%';

        const sfxSlider = document.getElementById('cfg-sfx-volume');
        const sfxVal = document.getElementById('cfg-sfx-volume-value');
        if (sfxSlider) sfxSlider.value = this.settings.sfxVolume ?? 0.5;
        if (sfxVal) sfxVal.textContent = Math.round((this.settings.sfxVolume ?? 0.5) * 100) + '%';

        this._syncSoundToggleButton();
        this._syncUXSettingControls();
        this._syncAudioSettings(this.menuAudio);
        if (this.renderer?.audio) this._syncAudioSettings(this.renderer.audio);
    }

    _updateUXSettingLabel(key) {
        const output = document.querySelector(`[data-setting-output="${key}"]`);
        if (!output) return;
        const value = this.settings[key];
        const percentKeys = new Set([
            'tableScale', 'cardScale', 'playedCardScale', 'replayCardScale',
            'animSpeed', 'transitionSpeed', 'aiDifficultyScale'
        ]);
        if (percentKeys.has(key)) {
            output.textContent = Math.round(Number(value ?? 1) * 100) + '%';
        } else if (key === 'selectedLift' || key === 'hoverLift' || key === 'playedOverlap' || key === 'dragThreshold' || key === 'cardCornerRadius') {
            output.textContent = `${value}px`;
        } else if (key === 'cardBorderWidth') {
            output.textContent = `${value}px`;
        } else if (key === 'panelOpacity') {
            output.textContent = `${value}%`;
        } else if (key === 'cardEnterStagger') {
            output.textContent = `${value}ms`;
        } else if (key === 'turnTimeout' || key === 'timerSeconds') {
            output.textContent = value === 0 || value === '0' ? '无限制' : `${value}秒`;
        } else if (key === 'baseScore' || key === 'scoreMultiplier') {
            output.textContent = `${value}分`;
        } else if (key === 'aiThinkTime') {
            output.textContent = `${value}ms`;
        } else if (key === 'aiBluffRate' || key === 'aiEmoteRate') {
            output.textContent = `${value}%`;
        } else if (key === 'aiRiskTolerance') {
            output.textContent = `${value}%`;
        } else if (key === 'spectatorDelay') {
            output.textContent = `${value}s`;
        } else if (key === 'heartbeatInterval' || key === 'autoSaveInterval') {
            output.textContent = `${value}s`;
        } else if (key === 'voiceVolume' || key === 'bgmVolume' || key === 'sfxVolume') {
            output.textContent = Math.round(Number(value || 0) * 100) + '%';
        } else if (key === 'particleCount') {
            output.textContent = `${value}个`;
        } else if (key === 'comboAnnounce') {
            output.textContent = `${value}连击`;
        } else if (key === 'maxHistory') {
            output.textContent = `${value}局`;
        } else if (key === 'reconnectAttempts') {
            output.textContent = `${value}次`;
        } else {
            output.textContent = String(value ?? '');
        }
    }

    _applyUXSettings() {
        const root = document.documentElement;
        const body = document.body;
        const s = this.settings;
        const panelAlpha = Math.max(0.45, Math.min(0.95, (s.panelOpacity ?? 80) / 100));

        // === Body data attributes (CSS响应式) ===
        body.dataset.density = s.uiDensity || 'comfortable';
        body.dataset.motion = s.animationLevel || 'normal';
        body.dataset.opponentCards = s.opponentCards || 'stack';
        body.dataset.showShortcuts = s.showShortcuts === false ? 'false' : 'true';
        body.dataset.tableAura = s.showTableAura === false ? 'false' : 'true';
        body.dataset.cardStyle = s.cardStyle || 'modern';
        body.dataset.cardBack = s.cardBackStyle || 'classic';
        body.dataset.fontSize = s.fontSize || 'medium';
        body.dataset.particleIntensity = s.particleIntensity || 'normal';
        body.dataset.shakeIntensity = s.screenShakeIntensity || 'normal';
        body.dataset.floatingText = s.floatingTextSize || 'normal';
        body.dataset.shadowIntensity = s.shadowIntensity || 'normal';
        body.dataset.glowIntensity = s.glowIntensity || 'normal';
        body.dataset.winEffectLevel = s.winEffectLevel || 'normal';
        body.dataset.bombEffectLevel = s.bombEffectLevel || 'normal';
        body.dataset.debug = s.debugMode === true ? 'true' : 'false';
        body.dataset.chat = s.enableChat === false ? 'false' : 'true';
        body.dataset.emoji = s.enableEmoji === false ? 'false' : 'true';
        body.dataset.cardTracker = s.enableCardTracker === false ? 'false' : 'true';
        body.dataset.autoHint = s.enableAutoHint === false ? 'false' : 'true';
        body.dataset.darkMode = s.darkMode === true ? 'true' : 'false';
        body.dataset.highContrast = s.highContrast === true ? 'true' : 'false';
        body.dataset.colorblindMode = s.colorblindMode === true ? 'true' : 'false';
        body.dataset.colorblindType = s.colorblindType || 'none';
        body.dataset.handArrangement = s.handArrangement || 'fan';
        body.dataset.playedArrangement = s.playedCardArrangement || 'straight';
        body.dataset.reduceMotion = s.reduceMotion === true ? 'true' : 'false';
        body.dataset.largeTargets = s.largeClickTargets === true ? 'true' : 'false';
        body.dataset.highVisibility = s.highVisibility === true ? 'true' : 'false';
        body.dataset.showRemaining = s.showRemainingCount === false ? 'false' : 'true';
        body.dataset.showPatternName = s.showPatternName === false ? 'false' : 'true';
        body.dataset.highlightPlayable = s.highlightPlayable === false ? 'false' : 'true';
        body.dataset.showPlayerStats = s.showPlayerStats === true ? 'true' : 'false';
        body.dataset.lazyRender = s.lazyRender === true ? 'true' : 'false';
        body.dataset.experimental = s.experimentalFeatures === true ? 'true' : 'false';
        body.dataset.avatarStyle = s.avatarStyle || 'default';

        document.documentElement.lang = s.language || 'zh-CN';

        // 回放按钮显示/隐藏
        const btnReplay = document.getElementById('btn-replay');
        if (btnReplay) btnReplay.style.display = s.enableReplay === false ? 'none' : '';

        // === CSS Variables ===
        root.style.setProperty('--ddz-table-scale', String(s.tableScale ?? 1));
        root.style.setProperty('--ddz-card-scale', String(s.cardScale ?? 1));
        root.style.setProperty('--ddz-selected-lift', `${s.selectedLift ?? 8}px`);
        root.style.setProperty('--ddz-hover-lift', `${s.hoverLift ?? 5}px`);
        root.style.setProperty('--ddz-play-overlap', `${s.playedOverlap ?? 16}px`);
        root.style.setProperty('--ddz-played-card-scale', String(s.playedCardScale ?? 1));
        root.style.setProperty('--ddz-drag-threshold', `${s.dragThreshold ?? 7}`);
        root.style.setProperty('--ddz-replay-card-scale', String(s.replayCardScale ?? 1));
        root.style.setProperty('--ddz-panel-alpha', String(panelAlpha));
        root.style.setProperty('--ddz-card-enter-stagger', `${s.cardEnterStagger ?? 30}ms`);
        root.style.setProperty('--ddz-anim-speed', String(s.animSpeed ?? 1));
        root.style.setProperty('--ddz-transition-speed', String(s.transitionSpeed ?? 1));
        root.style.setProperty('--ddz-card-radius', `${s.cardCornerRadius ?? 8}px`);
        root.style.setProperty('--ddz-card-border', `${s.cardBorderWidth ?? 1}px`);

        // FPS / Memory 显示
        const fpsEl = document.getElementById('fps-counter');
        if (fpsEl) fpsEl.style.display = s.showFPS ? 'block' : 'none';
        const memEl = document.getElementById('memory-counter');
        if (memEl) memEl.style.display = s.showMemory ? 'block' : 'none';
    }

    _applyTheme(theme) {
        document.body.setAttribute('data-theme', theme);
        const themeColors = {
            green: '#1a5f2a',
            redwood: '#5c1a1a',
            night: '#1a1a3d',
            ocean: '#0d3d4d',
            autumn: '#5c3a1a',
            purple: '#3d1a5c',
        };
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[theme] || '#1a5f2a');
    }

    _renderStats() {
        const winRate = this.stats.gamesPlayed > 0
            ? Math.round((this.stats.wins / this.stats.gamesPlayed) * 100) + '%'
            : '0%';
        const wrap = document.querySelector('.stats-panel-wrap');
        if (!wrap) return;
        wrap.innerHTML = '';

        const panel = document.createElement('div');
        panel.className = 'stats-panel';
        const level = this.stats.level || 1;
        const exp = this.stats.exp || 0;
        const expNeeded = level * 100;
        const expPercent = Math.round((exp / expNeeded) * 100);
        const streakVal = this.stats.streak;
        const streakColor = streakVal > 0 ? '#4caf50' : streakVal < 0 ? '#f44336' : '#f0c040';

        panel.innerHTML = `
            <div class="level-bar">
                <div class="level-info">
                    <span class="level-badge">Lv.${level}</span>
                    <span class="exp-text">${exp}/${expNeeded} EXP</span>
                </div>
                <div class="exp-bar"><div class="exp-fill" style="width:${expPercent}%"></div></div>
            </div>
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-value">${this.stats.gamesPlayed}</span>
                    <span class="stat-label">总局数</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value" style="color:${streakColor}">${streakVal > 0 ? '+' : ''}${streakVal}<small style="opacity:0.5;font-size:0.65rem">/${this.stats.maxStreak || 0}</small></span>
                    <span class="stat-label">连胜/最高</span>
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
                    <span class="stat-value" style="color:#f0c040">${winRate}</span>
                    <span class="stat-label">胜率</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value">${this.stats.totalScore}</span>
                    <span class="stat-label">总得分</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value" style="color:#ff9800">${this.stats.maxScore || 0}</span>
                    <span class="stat-label">最高单局</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value" style="color:#9c27b0">${this.stats.maxBombsInGame || 0}</span>
                    <span class="stat-label">最多炸弹</span>
                </div>
            </div>
            <button id="btn-clear-stats" class="btn-clear-stats">重置记录</button>
        `;
        wrap.appendChild(panel);

        panel.querySelector('#btn-clear-stats')?.addEventListener('click', () => {
            if (confirm('确定要清除所有游戏记录吗？')) {
                Storage.clearStats();
                location.reload();
            }
        });
    }

    _initTutorial() {
        // showTutorial 为 false 时直接跳过引导
        if (this.settings.showTutorial === false) return;

        const overlay = document.getElementById('welcome-guide-overlay');
        const btnNewbie = document.getElementById('btn-guide-newbie');
        const btnExpert = document.getElementById('btn-guide-expert');
        const chkSkip = document.getElementById('chk-guide-skip');
        if (!overlay || !btnNewbie || !btnExpert) return;

        const closeGuide = () => {
            overlay.classList.add('hidden');
            this._playMenuBGM();
        };

        btnNewbie.addEventListener('click', () => {
            this._playButtonClick();
            if (chkSkip?.checked) {
                this.settings.showTutorial = false;
                Storage.saveSettings(this.settings);
            }
            closeGuide();
            // 延迟打开完整教程，让过渡更自然
            setTimeout(() => this.openTutorial(), 300);
        });

        btnExpert.addEventListener('click', () => {
            this._playButtonClick();
            if (chkSkip?.checked) {
                this.settings.showTutorial = false;
                Storage.saveSettings(this.settings);
            }
            closeGuide();
        });

        setTimeout(() => {
            overlay.classList.remove('hidden');
        }, 1000);
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
        // 更新最高记录
        const currentStreak = this.stats.streak > 0 ? this.stats.streak : 0;
        if (currentStreak > (this.stats.maxStreak || 0)) {
            this.stats.maxStreak = currentStreak;
        }
        const roundScore = data.scores[humanIdx] || 0;
        if (roundScore > (this.stats.maxScore || 0)) {
            this.stats.maxScore = roundScore;
        }
        const bombs = (gs?.history?.filter(h => h.pattern?.type === 'BOMB' || h.pattern?.type === 'ROCKET') || []).length;
        if (bombs > (this.stats.maxBombsInGame || 0)) {
            this.stats.maxBombsInGame = bombs;
        }
        // 经验值计算
        let expGain = 10; // 基础经验
        if (isHumanWin) expGain += 20;
        if (data.springType === 'spring' && isHumanWin) expGain += 30;
        expGain += bombs * 5;
        this.stats.exp = (this.stats.exp || 0) + expGain;
        let leveledUp = false;
        while (this.stats.exp >= (this.stats.level || 1) * 100) {
            this.stats.exp -= (this.stats.level || 1) * 100;
            this.stats.level = (this.stats.level || 1) + 1;
            leveledUp = true;
        }
        if (leveledUp) {
            this.renderer?.showToast(`🎉 升级了！当前等级: ${this.stats.level}`, 'success');
        }
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
        const bombsPlayed = (gs?.history?.filter(h => h.pattern?.type === 'BOMB' || h.pattern?.type === 'ROCKET') || []).length;
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

        // 赛季任务上报
        const modeName = this.currentMode?.modeName || 'unknown';
        const questCompleted = seasonQuestManager.reportGame({
            isWin: isHumanWin,
            isLandlord: humanIdx === gs?.landlordIndex,
            bombCount: bombsPlayed,
            hasRocket: rocketPlayed,
            isSpring: data.springType === 'spring',
            isAntiSpring: data.springType === 'anti_spring',
            mode: modeName,
        });
        if (questCompleted.length > 0) {
            this.renderer?.showQuestCompleted?.(questCompleted);
            this._updateSeasonQuestBadge();
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
                dealerIndex: gs.dealerIndex,
                history: gs.history.map(h => ({
                    playerIndex: h.playerIndex,
                    cards: h.cards.map(c => ({ value: c.value, suit: c.suit?.name, rank: c.rankKey, displayName: c.displayName, isLaizi: c.isLaizi })),
                    pattern: { type: h.pattern?.type, mainValue: h.pattern?.mainValue, length: h.pattern?.length },
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
            this._lastSavedGameId = fullGame.id;

            // 自动保存精彩对局到牌谱工坊
            const isNotable = isHumanWin || data.springType === 'spring' || data.springType === 'anti_spring' || bombsPlayed >= 2 || (data.multiplier || 1) >= 2;
            if (isNotable) {
                const wsRecord = ReplayWorkshop.saveGame(fullGame);
                if (wsRecord) {
                    this.renderer?.showToast?.('📜 精彩对局已保存到牌谱工坊', 'info', 2000);
                } else {
                    this.renderer?.showToast?.('牌谱保存失败，本地存储可能已满', 'warning', 2000);
                }
            }

            // AI 教练复盘
            try {
                const coachResult = CoachAnalyzer.analyze(fullGame, humanIdx);
                if (coachResult) {
                    this._lastCoachResult = coachResult;
                    Storage.saveCoachReview({
                        date: new Date().toISOString(),
                        gameId: fullGame.id,
                        score: coachResult.summary.score,
                        highCount: coachResult.summary.highCount,
                        mediumCount: coachResult.summary.mediumCount,
                        suggestionTypes: coachResult.suggestions.map(s => s.type),
                    });
                }
            } catch (e) {
                // 复盘失败不应影响主流程
                console.warn('AI教练复盘失败:', e);
            }
        }

        // 牌风分析数据收集
        try {
            const humanHistory = gs?.history?.filter(h => h.playerIndex === humanIdx) || [];
            const bigPlays = humanHistory.filter(h => {
                const t = h.pattern?.type;
                return t === 'BOMB' || t === 'ROCKET' || t === 'STRAIGHT' || t?.includes('TRIPLE_STRAIGHT');
            }).length;
            // 计算最大连击（连续出牌次数）
            let maxCombo = 0, currentCombo = 0, lastPlayer = -1;
            for (const h of gs?.history || []) {
                if (h.playerIndex === lastPlayer) {
                    currentCombo++;
                } else {
                    if (h.playerIndex === humanIdx) currentCombo = 1;
                    else currentCombo = 0;
                }
                lastPlayer = h.playerIndex;
                if (h.playerIndex === humanIdx) maxCombo = Math.max(maxCombo, currentCombo);
            }
            // 估算思考时间（基于AI延迟和人类操作）
            const isLandlord = humanIdx === gs?.landlordIndex;
            const callScore = gs?.currentCall || 0;
            const humanPassCount = humanHistory.filter(h => h.pattern?.type === 'PASS').length;
            const humanPlayCount = humanHistory.filter(h => h.pattern?.type !== 'PASS' && h.cards?.length > 0).length;
            this.playStyle.recordGame({
                isWin: isHumanWin,
                isLandlord,
                isSpring: data.springType === 'spring',
                isAntiSpring: data.springType === 'anti_spring',
                bombs: bombs,
                rocket: rocketPlayed,
                maxCombo,
                thinkTime: humanHistory.length * 3500, // 估算每手3.5秒
                decisions: humanHistory.length + (isLandlord ? 1 : 0),
                callScore: isLandlord ? callScore : 0,
                bigPlays,
                passed: humanPassCount > 0,
                played: humanPlayCount > 0,
            });
        } catch (e) {
            // 牌风数据收集失败不应影响主流程
        }

        // 刷新统计面板
        this._renderStats();
    }

    _bindRoundEndListener() {
        if (!this.currentMode || this._roundEndBound) return;
        this._roundEndBound = true;
        this.currentMode.gameState.on('roundEnd', (data) => {
            this._saveGameResult(data);
        });
    }

    _initLANListeners() {
        const btnCreate = document.getElementById('btn-lan-host');
        const btnJoin = document.getElementById('btn-lan-join');
        const btnStart = document.getElementById('btn-lan-start');
        const btnCopyHostUrl = document.getElementById('btn-copy-lan-url');

        btnCopyHostUrl?.addEventListener('click', async () => {
            this._playButtonClick();
            const input = document.getElementById('lan-host-url');
            const url = input?.value;
            if (!url) return;
            try {
                await navigator.clipboard.writeText(url);
                document.getElementById('lan-status').textContent = '已复制房主地址，发给同一 Wi-Fi 的玩家';
            } catch (err) {
                input?.select();
                document.execCommand?.('copy');
                document.getElementById('lan-status').textContent = '已选中房主地址，可以手动复制';
            }
        });

        btnCreate?.addEventListener('click', async () => {
            this._playButtonClick();
            if (!this.currentMode || !(this.currentMode instanceof LANMode)) return;
            try {
                const roomId = await this.currentMode.createRoom();
                document.getElementById('room-id-display').textContent = roomId;
                document.getElementById('room-info')?.classList.remove('hidden');
                document.getElementById('lan-status').textContent = '等待玩家加入...';
                btnStart?.classList.remove('hidden');
            } catch (err) {
                console.error('创建房间失败:', err);
                alert('连接房主服务失败。房主电脑请运行 npm run lan:host，然后所有玩家打开房主的局域网地址。');
            }
        });

        btnJoin?.addEventListener('click', async () => {
            this._playButtonClick();
            if (!this.currentMode || !(this.currentMode instanceof LANMode)) return;
            const roomId = document.getElementById('lan-room-id')?.value?.trim();
            if (!roomId) return alert('请输入房间号');
            try {
                await this.currentMode.joinRoom(roomId);
                document.getElementById('lan-status').textContent = '已加入房间，等待房主开始';
            } catch (err) {
                console.error('加入房间失败:', err);
                alert('连接房主服务失败。请确认你打开的是房主电脑提供的局域网地址，而不是 GitHub Pages 地址。');
            }
        });

        btnStart?.addEventListener('click', async () => {
            this._playButtonClick();
            if (!this.currentMode || !(this.currentMode instanceof LANMode)) return;
            if (!this.currentMode.isHost) {
                document.getElementById('lan-status').textContent = '只有房主可以开始游戏';
                return;
            }
            const playerCount = this.currentMode.gameState?.players?.filter(Boolean).length || 0;
            if (playerCount < 3) {
                document.getElementById('lan-status').textContent = '需要 3 人到齐后才能开始游戏';
                return;
            }
            this.renderer?.destroy?.();
            this.renderer = new Renderer('game-table');
            this.renderer.setGameState(this.currentMode.gameState);
            this.renderer.setMode(this.currentMode);
            this._configureRendererAudio(this.renderer);
            this.currentMode.setRenderer(this.renderer);
            this._roundEndBound = false;
            this._bindRoundEndListener();
            this._stopMenuAudio();

            document.getElementById('lan-screen')?.classList.add('hidden');
            document.getElementById('game-screen')?.classList.remove('hidden');
            await this.currentMode.startGame();
            this._lockGameRuleSettings(true);
        });
    }

    _enterLANGameFromNetwork(mode) {
        if (!mode || mode !== this.currentMode) return;
        if (this.renderer) {
            this.renderer.destroy();
            this.renderer = null;
        }
        this.renderer = new Renderer('game-table');
        this.renderer.setGameState(mode.gameState);
        this.renderer.setMode(mode);
        this._configureRendererAudio(this.renderer);
        mode.setRenderer(this.renderer);
        this._roundEndBound = false;
        this._bindRoundEndListener();
        this._stopMenuAudio();
        document.getElementById('menu-screen')?.classList.add('hidden');
        document.getElementById('lan-screen')?.classList.add('hidden');
        document.getElementById('custom-screen')?.classList.add('hidden');
        const game = document.getElementById('game-screen');
        game?.classList.remove('hidden');
        if (game) {
            game.style.opacity = '';
            game.style.transform = '';
            game.style.transition = '';
        }
        this._lockGameRuleSettings(true);
    }

    async _refreshLANHostInfo() {
        const status = document.getElementById('lan-status');
        const row = document.getElementById('lan-host-url-row');
        const input = document.getElementById('lan-host-url');
        if (!status || !row || !input) return;

        status.className = 'lan-host-status';
        status.textContent = '正在检测本机托管服务...';
        row.classList.add('hidden');
        input.value = '';

        try {
            const res = await fetch('./api/lan-info', { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const info = await res.json();
            const urls = Array.isArray(info.urls) ? info.urls : [];
            const lanUrl = urls.find(url => !url.includes('localhost')) || urls[0] || window.location.origin;
            input.value = lanUrl;
            row.classList.remove('hidden');
            status.classList.add('online');
            status.textContent = '本机托管服务已就绪。创建房间后，把地址和房间号发给其他玩家。';
        } catch (err) {
            status.classList.add('offline');
            status.textContent = '当前页面没有连接到房主服务。房主电脑运行 npm run lan:host 后，再打开终端里显示的局域网地址。';
        }
    }

    _initCustomListeners() {
        document.getElementById('btn-custom-start')?.addEventListener('click', async () => {
            this._playButtonClick();
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
            this._configureRendererAudio(this.renderer);
            this.renderer.audio.enabled = soundOn;
            this.currentMode.setRenderer(this.renderer);
            this._stopMenuAudio();

            this._roundEndBound = false;
            this._bindRoundEndListener();

            document.getElementById('custom-screen')?.classList.add('hidden');
            document.getElementById('game-screen')?.classList.remove('hidden');
            await this.currentMode.startGame();
            this._lockGameRuleSettings(true);
        });
    }

    showMenu() {
        const menu = document.getElementById('menu-screen');
        const game = document.getElementById('game-screen');
        const lan = document.getElementById('lan-screen');
        const custom = document.getElementById('custom-screen');
        const replay = document.getElementById('replay-screen');

        // 停止回放管理器（destroy会清理键盘事件监听器）
        this._replayManager?.destroy?.();
        this._replayManager = null;

        // 关闭所有可能打开的面板
        this.closeSettings();
        this.closeChangelog();
        this.closePlayStyle();
        this.closeSeasonQuests();
        this.closeTournamentSetup();
        this.closeChallengeResult();
        document.getElementById('challenge-history-overlay')?.classList.add('hidden');
        document.getElementById('achievement-panel')?.classList.add('hidden');

        // 停止当前游戏循环并清理 renderer
        if (this.currentMode) {
            this.currentMode.isRunning = false;
            this.currentMode.destroy?.();
        }
        this.renderer?.audio?.stopBGM();
        // 关闭可能残留的模态框
        const modalOverlay = document.getElementById('modal-overlay');
        const modalContent = document.getElementById('modal-content');
        if (modalOverlay && !modalOverlay.classList.contains('hidden')) {
            modalOverlay.classList.add('hidden', 'modal-exit');
            modalContent?.classList.add('modal-exit');
        }
        this.renderer?.destroy?.();
        this.renderer = null;
        this.currentMode = null;

        if (this._gameBgmTimer) { clearTimeout(this._gameBgmTimer); this._gameBgmTimer = null; }

        // 刷新徽章
        this._updateDailyChallengeBadge();
        this._updateEndgameBadge();
        this._updateChallengeBadge();

        // 切换回菜单BGM
        this._playMenuBGM();

        // 淡出当前屏幕
        const endgame = document.getElementById('endgame-screen');
        const challenge = document.getElementById('challenge-screen');
        const workshop = document.getElementById('workshop-screen');
        [game, lan, custom, replay, endgame, challenge, workshop].forEach(s => {
            if (s && !s.classList.contains('hidden')) {
                const id = s.id;
                const oldTimer = this._screenTimers.get(id);
                if (oldTimer) { clearTimeout(oldTimer); this._screenTimers.delete(id); }
                s.style.opacity = '1';
                s.style.transition = 'opacity 0.3s ease';
                s.style.opacity = '0';
                const timer = setTimeout(() => {
                    this._screenTimers.delete(id);
                    s.classList.add('hidden');
                    s.style.opacity = '';
                    s.style.transition = '';
                }, 300);
                this._screenTimers.set(id, timer);
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
        this._lockGameRuleSettings(false);
    }

    /**
     * 锁定/解锁游戏规则相关设置控件，防止游戏进行中修改破坏公平性。
     * 仅影响影响游戏平衡的规则类设置，视觉/音频设置不受限制。
     */
    _lockGameRuleSettings(locked) {
        const ruleSettings = [
            // 核心规则
            'callMode', 'laiziEnabled', 'baseScore', 'scoreMultiplier',
            'firstPlayer', 'jokerRule', 'bombRule', 'strictRules',
            'timerEnabled', 'timerSeconds',
            // 游戏变体
            'showCards', 'exchangeThree', 'noShuffle', 'bottomVisible',
            'mustPlay', 'allowPassOnFirst', 'allowTripleWithSingle',
            'allowTripleWithPair', 'allowAirplaneWithWings', 'bombAsRocket',
            // 春天/炸弹规则
            'allowSpring', 'allowAntiSpring', 'bombDoubles', 'rocketDoubles',
        ];
        ruleSettings.forEach(key => {
            const el = document.querySelector(`[data-setting="${key}"]`);
            if (el) {
                el.disabled = locked;
                const label = el.closest('label');
                if (label) {
                    label.classList.toggle('setting-locked', locked);
                }
            }
        });
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

        // 停止旧的 ReplayManager 防止定时器/键盘事件泄漏
        if (this._replayManager) {
            this._replayManager.destroy();
        }
        this._replayManager = new ReplayManager('replay-container');
        this._replayManager.showGameList();
    }

    startReplay(arg = null) {
        const container = document.getElementById('replay-container');
        if (!container) return;
        if (this._replayManager) {
            this._replayManager.destroy();
        }
        this._replayManager = new ReplayManager('replay-container');
        const games = this._replayManager.loadGames();
        if (games.length === 0) {
            this._showFallbackToast('暂无回放数据', 'info');
            return;
        }

        let targetGame = null;
        let jumpRoundIndex = null;

        if (arg == null) {
            this.showReplayList();
            return;
        } else if (arg === 'latest') {
            targetGame = games[0];
        } else if (typeof arg === 'number') {
            targetGame = games[0];
            jumpRoundIndex = arg;
        } else if (typeof arg === 'string') {
            targetGame = games.find(g => g.id === arg) || games[0];
        }

        if (!targetGame) {
            this._showFallbackToast('找不到对应回放', 'info');
            this.showReplayList();
            return;
        }

        // 隐藏菜单/游戏界面，显示回放
        document.getElementById('menu-screen')?.classList.add('hidden');
        document.getElementById('game-screen')?.classList.add('hidden');
        document.getElementById('custom-screen')?.classList.add('hidden');
        document.getElementById('endgame-screen')?.classList.add('hidden');
        document.getElementById('replay-screen')?.classList.remove('hidden');
        this._replayManager.startReplay(targetGame);
        if (jumpRoundIndex != null) {
            this._replayManager.goToStep(jumpRoundIndex);
        }
    }

    // ---- 牌谱工坊 ----
    showWorkshop() {
        this._playMenuBGM(0);
        this._transitionToScreen('workshop-screen');
        this._renderWorkshop();
    }

    _renderWorkshop() {
        const grid = document.getElementById('workshop-records-grid');
        const importInput = document.getElementById('workshop-import-input');
        if (!grid) return;

        const records = ReplayWorkshop.getRecords();
        const stats = ReplayWorkshop.getStats();

        // 渲染统计
        const statsEl = document.getElementById('workshop-stats');
        if (statsEl) {
            if (stats.total > 0) {
                const modeLabels = { ai: '人机', lan: '联机', tournament: '锦标赛', challenge: '极限挑战', custom: '自定义', unknown: '其他' };
                const modeParts = Object.entries(stats.byMode)
                    .map(([m, c]) => `${modeLabels[m] || m} ${c}条`)
                    .join(' · ');
                statsEl.textContent = `共 ${stats.total} 条牌谱 · ${modeParts}`;
            } else {
                statsEl.textContent = '';
            }
        }

        grid.innerHTML = '';
        if (records.length === 0) {
            grid.innerHTML = `<div class="workshop-empty">暂无保存的牌谱<br>完成对局后可保存精彩瞬间</div>`;
        } else {
            for (const r of records) {
                const card = document.createElement('div');
                card.className = 'workshop-record-card';
                card.innerHTML = `
                    <div class="workshop-record-name">${this._escapeHtml(r.name)}</div>
                    <div class="workshop-record-note">${this._escapeHtml(r.note || '')}</div>
                    <div class="workshop-record-date">${new Date(r.createdAt).toLocaleString('zh-CN')}</div>
                    <div class="workshop-record-actions">
                        <button class="btn-workshop-play" data-id="${r.id}">▶ 回放</button>
                        <button class="btn-workshop-share" data-code="${r.shareCode || ''}" ${!r.shareCode ? 'disabled title="牌谱数据过大，无法生成分享码"' : ''}>📋 复制分享码</button>
                        <button class="btn-workshop-delete" data-id="${r.id}">🗑️</button>
                    </div>
                `;
                grid.appendChild(card);
            }

            // 绑定按钮事件
            grid.querySelectorAll('.btn-workshop-play').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._playButtonClick();
                    const record = ReplayWorkshop.getRecordById(btn.dataset.id);
                    if (record?.gameData) {
                        this._startWorkshopReplay(record.gameData);
                    }
                });
            });
            grid.querySelectorAll('.btn-workshop-share').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._playButtonClick();
                    const code = btn.dataset.code;
                    if (!code || code === 'null' || code === 'undefined') {
                        this._showFallbackToast('分享码无效', 'error');
                        return;
                    }
                    const doCopy = navigator.clipboard?.writeText;
                    if (doCopy) {
                        doCopy(code).then(() => {
                            this._showFallbackToast('分享码已复制到剪贴板', 'success');
                        }).catch(() => {
                            this._fallbackCopy(code);
                        });
                    } else {
                        this._fallbackCopy(code);
                    }
                });
            });
            grid.querySelectorAll('.btn-workshop-delete').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._playButtonClick();
                    if (confirm('确定删除这条牌谱吗？此操作不可撤销。')) {
                        ReplayWorkshop.deleteRecord(btn.dataset.id);
                        this._renderWorkshop();
                    }
                });
            });
        }

        // 导入按钮
        const btnImport = document.getElementById('btn-workshop-import');
        if (btnImport) {
            btnImport.onclick = () => {
                this._playButtonClick();
                const code = importInput?.value?.trim();
                if (!code) {
                    this._showFallbackToast('请输入分享码', 'info');
                    return;
                }
                if (btnImport.disabled) return;
                btnImport.disabled = true;
                btnImport.textContent = '⏳ 导入中...';
                const result = ReplayWorkshop.importShareCode(code);
                if (result.success) {
                    this._showFallbackToast('牌谱导入成功', 'success');
                    if (importInput) importInput.value = '';
                    this._renderWorkshop();
                } else {
                    this._showFallbackToast(result.error || '导入失败', 'error');
                }
                btnImport.disabled = false;
                btnImport.textContent = '📥 导入';
            };
        }
    }

    _startWorkshopReplay(gameData) {
        const workshop = document.getElementById('workshop-screen');
        if (workshop) workshop.classList.add('hidden');

        document.getElementById('menu-screen')?.classList.add('hidden');
        document.getElementById('game-screen')?.classList.add('hidden');
        document.getElementById('lan-screen')?.classList.add('hidden');
        document.getElementById('custom-screen')?.classList.add('hidden');
        document.getElementById('endgame-screen')?.classList.add('hidden');
        document.getElementById('challenge-screen')?.classList.add('hidden');
        document.getElementById('replay-screen')?.classList.remove('hidden');

        if (this._replayManager) {
            this._replayManager.destroy();
        }
        this._replayManager = new ReplayManager('replay-container');
        this._replayManager.startReplay(gameData);
    }

    showAchievements() {
        const panel = document.getElementById('achievement-panel');
        const list = document.getElementById('achievement-list');
        if (!panel || !list || !panel.classList.contains('hidden')) return;
        if (this._achCloseTimer) clearTimeout(this._achCloseTimer);

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

        panel.classList.remove('hidden', 'panel-exit');
    }

    openTutorial() {
        this._playButtonClick();
        this._stopMenuAudio();
        this.tutorial.open(() => {
            // 教程完成后，如果设置了自动开始游戏，可以在这里触发
            this._playMenuBGM();
        });
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
            if (menu._hideTimer) clearTimeout(menu._hideTimer);
            menu._hideTimer = setTimeout(() => {
                menu._hideTimer = null;
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
                    if (game._animTimer) clearTimeout(game._animTimer);
                    game._animTimer = setTimeout(() => {
                        game._animTimer = null;
                        game.style.transition = '';
                        game.style.transform = '';
                    }, 400);
                });
            });
        }

        // 停止菜单音频；游戏BGM由 onPhaseChange(PLAYING) 统一调度，避免双重触发
        this._stopMenuAudio();
        this.renderer?.audio?.stopBGM();
        if (this._gameBgmTimer) { clearTimeout(this._gameBgmTimer); this._gameBgmTimer = null; }
    }

    // ---- AI模式 ----
    async startAIMode() {
        if (this._modeStarting) return;
        this._modeStarting = true;
        try {
            // 停止旧游戏并清理 renderer
            if (this.currentMode) {
                this.currentMode.isRunning = false;
                this.currentMode.destroy?.();
            }
            this.renderer?.destroy?.();
            this.renderer = null;

            const diff = document.getElementById('difficulty')?.value || this.settings.difficulty || 'normal';
            const rounds = parseInt(document.getElementById('match-rounds')?.value || this.settings.matchRounds || 1);
            this.currentMode = new AIMode(diff);
            await this.currentMode.init();
            this.currentMode.setMatchRounds(rounds);
            this.currentMode.speedFactor = Math.max(0.3, Math.min(5.0, this.settings.gameSpeed || 1.0));
            // 应用自定义玩家名称
            const humanPlayer = this.currentMode.gameState?.players?.[this.currentMode.humanIndex];
            if (humanPlayer) humanPlayer.name = this.settings.playerName || '玩家';
            document.getElementById('mode-display').textContent = `人机对战 (${diff === 'easy' ? '简单' : diff === 'hard' ? '困难' : '普通'})${rounds > 1 ? ' · ' + rounds + '局' : ''}`;

            this.renderer = new Renderer('game-table');
            this.renderer.setGameState(this.currentMode.gameState);
            this.renderer.setMode(this.currentMode);
            this._configureRendererAudio(this.renderer);
            this.currentMode.setRenderer(this.renderer);

            this._roundEndBound = false;
            this._bindRoundEndListener();

            this.showGame();
            this._lockGameRuleSettings(true);
            await this.currentMode.startGame();
        } catch (err) {
            console.error('启动 AI 模式失败:', err);
            this._showFallbackToast('游戏启动失败，请返回菜单重试');
            this.showMenu();
        } finally {
            this._modeStarting = false;
        }
    }

    // ===== 锦标赛模式 =====
    openTournamentSetup() {
        const overlay = document.getElementById('tournament-setup-overlay');
        if (!overlay || !overlay.classList.contains('hidden')) return;
        overlay.classList.remove('hidden');
        overlay.style.opacity = '0';
        requestAnimationFrame(() => {
            overlay.style.transition = 'opacity 0.3s ease';
            overlay.style.opacity = '1';
        });
        // 渲染历史统计
        this._renderTournamentStatsPreview();
        this._getActiveAudio()?.playSettingOpen?.();
    }

    closeTournamentSetup() {
        const overlay = document.getElementById('tournament-setup-overlay');
        if (!overlay || overlay.classList.contains('hidden')) return;
        overlay.style.transition = 'opacity 0.2s ease-in';
        overlay.style.opacity = '0';
        if (this._tourCloseTimer) clearTimeout(this._tourCloseTimer);
        this._tourCloseTimer = setTimeout(() => {
            this._tourCloseTimer = null;
            overlay.classList.add('hidden');
        }, 200);
        this._getActiveAudio()?.playSettingClose?.();
    }

    _renderTournamentStatsPreview() {
        const container = document.getElementById('tour-stats-preview');
        if (!container) return;
        const stats = TournamentStorage.getStats();
        if (stats.totalPlayed === 0) {
            container.innerHTML = '<div class="tour-stats-preview-title">🏆 锦标赛统计</div><div style="opacity:0.6;font-size:0.78rem;">暂无锦标赛记录，开始你的第一场锦标赛吧！</div>';
            return;
        }
        container.innerHTML = `
            <div class="tour-stats-preview-title">🏆 锦标赛统计</div>
            <div class="tour-stats-preview-grid">
                <div><span>参赛次数</span><span>${stats.totalPlayed}</span></div>
                <div><span>冠军次数</span><span>${stats.championCount}</span></div>
                <div><span>最高总分</span><span>${stats.highestScore > 0 ? '+' : ''}${stats.highestScore}</span></div>
                <div><span>平均排名</span><span>第 ${stats.avgRank} 名</span></div>
                <div><span>最佳排名</span><span>第 ${stats.bestRank} 名</span></div>
            </div>
        `;
    }

    async startTournament() {
        this.closeTournamentSetup();
        if (this._modeStarting) return;
        this._modeStarting = true;
        try {
            if (this.currentMode) {
                this.currentMode.isRunning = false;
                this.currentMode.destroy?.();
            }
            this.renderer?.destroy?.();
            this.renderer = null;

            const diff = document.getElementById('tour-difficulty')?.value || this.settings.difficulty || 'normal';
            // 优先取自定义输入，否则取选中的按钮
            const customInput = document.getElementById('tour-custom-rounds-input');
            let rounds = customInput ? parseInt(customInput.value, 10) : 3;
            if (isNaN(rounds) || rounds < 2) rounds = 3;
            if (rounds > 50) rounds = 50;

            this.currentMode = new TournamentMode(diff, rounds);
            await this.currentMode.init();
            this.currentMode.speedFactor = Math.max(0.3, Math.min(5.0, this.settings.gameSpeed || 1.0));
            const humanPlayer = this.currentMode.gameState?.players?.[this.currentMode.humanIndex];
            if (humanPlayer) humanPlayer.name = this.settings.playerName || '玩家';
            document.getElementById('mode-display').textContent = `锦标赛 · ${rounds}局 · ${diff === 'easy' ? '简单' : diff === 'hard' ? '困难' : diff === 'expert' ? '专家' : '普通'}`;

            this.renderer = new Renderer('game-table');
            this.renderer.setGameState(this.currentMode.gameState);
            this.renderer.setMode(this.currentMode);
            this._configureRendererAudio(this.renderer);
            this.currentMode.setRenderer(this.renderer);

            this._roundEndBound = false;
            this._bindRoundEndListener();

            this.showGame();
            this._lockGameRuleSettings(true);
            await this.currentMode.startGame();
        } catch (err) {
            console.error('启动锦标赛失败:', err);
            this._showFallbackToast('锦标赛启动失败，请返回菜单重试');
            this.showMenu();
        } finally {
            this._modeStarting = false;
        }
    }

    // ---- 通用页面过渡 ----
    _transitionToScreen(targetId) {
        const target = document.getElementById(targetId);
        const allScreens = [
            'menu-screen', 'game-screen', 'lan-screen', 'custom-screen',
            'replay-screen', 'endgame-screen', 'challenge-screen', 'workshop-screen'
        ];

        // 关闭可能遮挡的模态框和面板（静默隐藏，不播放音效）
        const overlays = [
            'settings-overlay', 'changelog-overlay', 'play-style-overlay',
            'season-quest-overlay', 'tournament-setup-overlay', 'achievement-panel',
            'challenge-result-overlay', 'challenge-history-overlay'
        ];
        for (const oid of overlays) {
            const oel = document.getElementById(oid);
            if (oel && !oel.classList.contains('hidden')) {
                oel.classList.add('hidden');
                oel.style.opacity = '';
                oel.style.transition = '';
            }
        }

        // 隐藏所有非目标 screen，取消旧 timer 防止竞态
        for (const id of allScreens) {
            if (id === targetId) continue;
            const el = document.getElementById(id);
            if (el && !el.classList.contains('hidden')) {
                const oldTimer = this._screenTimers.get(id);
                if (oldTimer) { clearTimeout(oldTimer); this._screenTimers.delete(id); }
                el.style.transition = 'opacity 0.3s ease';
                el.style.opacity = '0';
                const timer = setTimeout(() => {
                    this._screenTimers.delete(id);
                    el.classList.add('hidden');
                    el.style.opacity = '';
                    el.style.transition = '';
                }, 300);
                this._screenTimers.set(id, timer);
            }
        }

        // 取消目标 screen 的旧隐藏 timer，防止被之前动画重新 hidden
        const targetOldTimer = this._screenTimers.get(targetId);
        if (targetOldTimer) {
            clearTimeout(targetOldTimer);
            this._screenTimers.delete(targetId);
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
        if (this._modeStarting) return;
        this._modeStarting = true;
        try {
            if (this.currentMode) {
                this.currentMode.isRunning = false;
                this.currentMode.destroy?.();
            }
            this.renderer?.destroy?.();
            this.renderer = null;
            this._playMenuBGM(0);
            this._transitionToScreen('lan-screen');

            // 重置LAN UI状态
            setTimeout(() => {
                document.getElementById('room-info')?.classList.add('hidden');
                document.getElementById('btn-lan-start')?.classList.add('hidden');
                document.getElementById('lan-status').textContent = '请选择创建或加入房间';
                this._refreshLANHostInfo();
            }, 400);

            this.currentMode = new LANMode();
            await this.currentMode.init();
            this.currentMode.speedFactor = Math.max(0.3, Math.min(5.0, this.settings.gameSpeed || 1.0));
            document.getElementById('mode-display').textContent = '局域网联机';
            // 应用自定义玩家名称（延迟到 seat_assigned 后再设置）
            const desiredName = this.settings.playerName || '玩家';
            this.currentMode._desiredPlayerName = desiredName;
            this._lockGameRuleSettings(true);
        } catch (err) {
            console.error('启动局域网模式失败:', err);
            this._showFallbackToast('连接失败，请返回菜单重试');
            this.showMenu();
        } finally {
            this._modeStarting = false;
        }
    }

    // ---- 自定义模式 ----
    async startCustomMode() {
        if (this._modeStarting) return;
        this._modeStarting = true;
        try {
            if (this.currentMode) {
                this.currentMode.isRunning = false;
                this.currentMode.destroy?.();
            }
            this.renderer?.destroy?.();
            this.renderer = null;
            this._playMenuBGM(0);
            this._transitionToScreen('custom-screen');

            this.currentMode = new CustomMode();
            await this.currentMode.init();
            this.currentMode.speedFactor = Math.max(0.3, Math.min(5.0, this.settings.gameSpeed || 1.0));
            document.getElementById('mode-display').textContent = '自定义模式';
            // 应用自定义玩家名称
            const humanPlayer = this.currentMode.gameState?.players?.[this.currentMode.humanIndex];
            if (humanPlayer) humanPlayer.name = this.settings.playerName || '玩家';
            this._lockGameRuleSettings(true);
        } catch (err) {
            console.error('启动自定义模式失败:', err);
            this._showFallbackToast('游戏启动失败，请返回菜单重试');
            this.showMenu();
        } finally {
            this._modeStarting = false;
        }
    }

    // ---- 残局训练 ----
    showEndgameLevels() {
        this._playMenuBGM(0);
        this._transitionToScreen('endgame-screen');
        this._renderEndgameLevels();
    }

    _renderEndgameLevels() {
        const grid = document.getElementById('endgame-levels-grid');
        const progressFill = document.getElementById('endgame-progress-fill');
        const progressText = document.getElementById('endgame-progress-text');
        if (!grid) return;

        const records = EndgameRecordManager.getRecords();
        const progress = EndgameRecordManager.getProgress();
        if (progressFill) progressFill.style.width = `${(progress.passed / progress.total) * 100}%`;
        if (progressText) progressText.textContent = `${progress.passed}/${progress.total}`;

        grid.innerHTML = '';
        for (const level of ENDGAME_LEVELS) {
            const record = records[level.id];
            const isLocked = level.id > 1 && !records[level.id - 1]?.passed;
            const stars = record?.stars || 0;
            const card = document.createElement('div');
            card.className = `endgame-level-card ${isLocked ? 'locked' : ''} ${record?.passed ? 'completed' : ''}`;
            card.innerHTML = `
                <div class="endgame-level-id">${level.id}</div>
                <div class="endgame-level-name">${level.name}</div>
                <div class="endgame-level-desc">${level.objective}</div>
                <div class="endgame-level-stars">${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
                ${record?.bestSteps ? `<div class="endgame-level-steps">最佳 ${record.bestSteps} 步</div>` : ''}
                ${isLocked ? '<div class="endgame-level-lock">🔒</div>' : ''}
            `;
            if (!isLocked) {
                card.addEventListener('click', () => {
                    this._playButtonClick();
                    this.startEndgameMode(level.id - 1);
                });
            }
            grid.appendChild(card);
        }
    }

    async startEndgameMode(levelIndex = 0) {
        if (this._modeStarting) return;
        this._modeStarting = true;
        try {
            if (this.currentMode) {
                this.currentMode.isRunning = false;
                this.currentMode.destroy?.();
            }
            this.renderer?.destroy?.();
            this.renderer = null;

            const endgameMode = new EndgameMode(levelIndex);
            await endgameMode.init();
            this.currentMode = endgameMode;
            this.currentMode.speedFactor = Math.max(0.3, Math.min(5.0, this.settings.gameSpeed || 1.0));
            const humanPlayer = this.currentMode.gameState?.players?.[this.currentMode.humanIndex];
            if (humanPlayer) humanPlayer.name = this.settings.playerName || '玩家';
            document.getElementById('mode-display').textContent = `残局训练 · 第${levelIndex + 1}关`;

            this.renderer = new Renderer('game-table');
            this.renderer.setGameState(this.currentMode.gameState);
            this.renderer.setMode(this.currentMode);
            this._configureRendererAudio(this.renderer);
            this.currentMode.setRenderer(this.renderer);

            this._roundEndBound = false;
            this._bindRoundEndListener();

            this.showGame();
            this._lockGameRuleSettings(true);
            await this.currentMode.startGame();
        } catch (err) {
            console.error('启动残局训练失败:', err);
            this._showFallbackToast('残局启动失败，请返回菜单重试');
            this.showMenu();
        } finally {
            this._modeStarting = false;
        }
    }

    _updateEndgameBadge() {
        const desc = document.getElementById('endgame-desc');
        if (!desc) return;
        const progress = EndgameRecordManager.getProgress();
        if (progress.passed === 0) {
            desc.textContent = '挑战5个经典残局';
        } else if (progress.passed === progress.total) {
            desc.textContent = `⭐ ${progress.totalStars}/${progress.maxStars} 全通关`;
        } else {
            desc.textContent = `进度 ${progress.passed}/${progress.total} · ⭐ ${progress.totalStars}`;
        }
    }

    // ---- 极限挑战 ----
    showChallengeLevels() {
        // 从游戏返回时停止 renderer BGM，避免与菜单 BGM 冲突
        this.renderer?.audio?.stopBGM();
        this._playMenuBGM(0);
        this._transitionToScreen('challenge-screen');
        this._renderChallengeLevels();
    }

    _renderChallengeLevels() {
        const grid = document.getElementById('challenge-levels-grid');
        const progressFill = document.getElementById('challenge-progress-fill');
        const progressText = document.getElementById('challenge-progress-text');
        if (!grid) return;

        const records = ExtremeChallengeRecordManager.getRecords();
        const progress = ExtremeChallengeRecordManager.getProgress();
        if (progressFill) progressFill.style.width = `${(progress.passed / progress.total) * 100}%`;
        if (progressText) progressText.textContent = `${progress.passed}/${progress.total}`;

        grid.innerHTML = '';
        for (const level of CHALLENGES) {
            const record = records[level.id];
            const isLocked = level.id > 1 && !records[level.id - 1]?.passed;
            const stars = record?.stars || 0;
            const diffClass = level.difficulty;
            const card = document.createElement('div');
            card.className = `challenge-level-card ${isLocked ? 'locked' : ''} ${record?.passed ? 'completed' : ''} diff-${diffClass}`;
            card.innerHTML = `
                <div class="challenge-level-icon">${level.icon}</div>
                <div class="challenge-level-id">${level.id}</div>
                <div class="challenge-level-name">${level.title}</div>
                <div class="challenge-level-desc">${level.desc}</div>
                <div class="challenge-level-diff">${level.difficulty === 'easy' ? '简单' : level.difficulty === 'normal' ? '普通' : '困难'}</div>
                <div class="challenge-level-stars">${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
                ${isLocked ? '<div class="challenge-level-lock">🔒</div>' : ''}
            `;
            if (!isLocked) {
                card.addEventListener('click', () => {
                    this._playButtonClick();
                    this.startChallengeMode(level.id);
                });
            }
            grid.appendChild(card);
        }
    }

    async startChallengeMode(challengeId = 1) {
        if (this._modeStarting) return;
        this._modeStarting = true;
        try {
            if (this.currentMode) {
                this.currentMode.isRunning = false;
                this.currentMode.destroy?.();
            }
            this.renderer?.destroy?.();
            this.renderer = null;

            this.currentMode = new ChallengeMode(challengeId);
            await this.currentMode.init();
            this.currentMode.speedFactor = Math.max(0.3, Math.min(5.0, this.settings.gameSpeed || 1.0));
            const humanPlayer = this.currentMode.gameState?.players?.[this.currentMode.humanIndex];
            if (humanPlayer) humanPlayer.name = this.settings.playerName || '玩家';
            document.getElementById('mode-display').textContent = `极限挑战 · ${this.currentMode.challenge?.title || '?'}`;

            this.renderer = new Renderer('game-table');
            this.renderer.setGameState(this.currentMode.gameState);
            this.renderer.setMode(this.currentMode);
            this._configureRendererAudio(this.renderer);
            this.currentMode.setRenderer(this.renderer);

            this._roundEndBound = false;
            this._bindRoundEndListener();

            this.showGame();
            this._lockGameRuleSettings(true);
            await this.currentMode.startGame();
        } catch (err) {
            console.error('启动极限挑战失败:', err);
            this._showFallbackToast('挑战启动失败，请返回菜单重试');
            this.showMenu();
        } finally {
            this._modeStarting = false;
        }
    }

    _updateChallengeBadge() {
        const desc = document.getElementById('challenge-desc');
        if (!desc) return;
        const progress = ExtremeChallengeRecordManager.getProgress();
        if (progress.passed === 0) {
            desc.textContent = '挑战10个极限规则关卡';
        } else if (progress.passed === progress.total) {
            desc.textContent = `⭐ ${progress.totalStars}/${progress.maxStars} 全通关`;
        } else {
            desc.textContent = `进度 ${progress.passed}/${progress.total} · ⭐ ${progress.totalStars}`;
        }
    }

    async startDailyMode() {
        if (this._modeStarting) return;
        this._modeStarting = true;
        try {
            if (this.currentMode) {
                this.currentMode.isRunning = false;
                this.currentMode.destroy?.();
            }
            this.renderer?.destroy?.();
            this.renderer = null;
            this.closeChallengeResult();
            document.getElementById('challenge-history-overlay')?.classList.add('hidden');

            const dailyMode = new DailyMode();
            await dailyMode.init();
            this.currentMode = dailyMode;
            this.currentMode.speedFactor = Math.max(0.3, Math.min(5.0, this.settings.gameSpeed || 1.0));
            // 应用自定义玩家名称
            const humanPlayer = this.currentMode.gameState?.players?.[this.currentMode.humanIndex];
            if (humanPlayer) humanPlayer.name = this.settings.playerName || '玩家';
            document.getElementById('mode-display').textContent = `每日挑战 · ${dailyMode.getChallengeInfo().difficultyLabel}`;

            this.renderer = new Renderer('game-table');
            this.renderer.setGameState(this.currentMode.gameState);
            this.renderer.setMode(this.currentMode);
            this._configureRendererAudio(this.renderer);
            this.currentMode.setRenderer(this.renderer);

            this._roundEndBound = false;
            this._bindRoundEndListener();

            this.showGame();
            this._lockGameRuleSettings(true);
            await this.currentMode.startGame();
        } catch (err) {
            console.error('启动每日挑战失败:', err);
            this._showFallbackToast('挑战启动失败，请返回菜单重试');
            this.showMenu();
        } finally {
            this._modeStarting = false;
        }
    }

    // ===== 每日挑战结果面板 =====
    openChallengeResult(result, roundData, stats) {
        const overlay = document.getElementById('challenge-result-overlay');
        if (!overlay || !overlay.classList.contains('hidden')) return;
        // 赛季任务：每日挑战上报
        const questCompleted = seasonQuestManager.reportDailyChallenge({
            completed: result.isWin,
            stars: result.stars,
        });
        if (questCompleted.length > 0) {
            this.renderer?.showQuestCompleted?.(questCompleted);
            this._updateSeasonQuestBadge();
        }

        overlay.classList.remove('hidden');
        overlay.style.opacity = '0';
        requestAnimationFrame(() => {
            overlay.style.transition = 'opacity 0.3s ease';
            overlay.style.opacity = '1';
        });

        const content = document.getElementById('challenge-result-content');
        if (content) {
            const starChar = '⭐';
            const starsHtml = starChar.repeat(result.stars) + '<span class="star-empty">' + starChar.repeat(3 - result.stars) + '</span>';
            const scoreClass = result.score >= 0 ? '' : 'negative';
            const springText = result.springType === 'spring' ? '春天' : result.springType === 'anti_spring' ? '反春天' : '—';
            const winText = result.isWin ? '挑战成功' : '挑战失败';
            const winColor = result.isWin ? '#4caf50' : '#ff6b6b';

            content.innerHTML = `
                <div class="challenge-result-date">${result.date} · ${winText}</div>
                <div class="challenge-stars">${starsHtml}</div>
                <div class="challenge-result-score ${scoreClass}">${result.score > 0 ? '+' : ''}${result.score}</div>
                <div class="challenge-result-label">本局得分</div>
                <div class="challenge-result-detail">
                    <div class="challenge-detail-cell">
                        <div class="detail-value">${springText}</div>
                        <div class="detail-label">春天/反春</div>
                    </div>
                    <div class="challenge-detail-cell">
                        <div class="detail-value">${result.bombCount}</div>
                        <div class="detail-label">炸弹数</div>
                    </div>
                    <div class="challenge-detail-cell">
                        <div class="detail-value">${stats.streak}</div>
                        <div class="detail-label">连胜天数</div>
                    </div>
                </div>
            `;
        }

        // 绑定按钮
        const btnShare = document.getElementById('btn-challenge-share');
        const btnHistory = document.getElementById('btn-challenge-history');
        const btnClose = document.getElementById('btn-challenge-close');

        // 先清理旧的事件处理器，防止重复绑定
        if (btnShare) btnShare.onclick = null;
        if (btnHistory) btnHistory.onclick = null;
        if (btnClose) btnClose.onclick = null;

        if (btnShare) {
            btnShare.onclick = () => {
                this._playButtonClick();
                const starText = result.stars === 0 ? '💫 0星' : '⭐'.repeat(result.stars);
                const springText = result.springType === 'spring' ? '🌸 春天' :
                    result.springType === 'anti_spring' ? '❄️ 反春天' : '';
                const lines = [
                    `📅 斗地主每日挑战 ${result.date}`,
                    `${starText} ${result.isWin ? '挑战成功' : '挑战失败'}`,
                    `得分: ${result.score > 0 ? '+' : ''}${result.score}`,
                ];
                if (springText) lines.push(springText);
                if (result.bombCount > 0) lines.push(`💣 炸弹: ${result.bombCount}个`);
                lines.push(`🔥 连胜: ${stats.streak}天`);
                const shareText = lines.join('\n');
                navigator.clipboard?.writeText?.(shareText).then(() => {
                    this.renderer?.showToast?.('成绩已复制到剪贴板', 'success');
                }).catch(() => {
                    this._showFallbackToast('复制失败，请手动复制成绩', 'error');
                });
            };
        }
        if (btnHistory) {
            btnHistory.onclick = () => {
                this._playButtonClick();
                this.closeChallengeResult();
                // 等待结果面板关闭动画完成后再打开历史面板，避免闪烁
                setTimeout(() => this._showChallengeHistory(), 320);
            };
        }
        if (btnClose) {
            btnClose.onclick = () => {
                this._playButtonClick();
                this.closeChallengeResult();
                this.showMenu();
            };
        }
    }

    closeChallengeResult() {
        const overlay = document.getElementById('challenge-result-overlay');
        if (!overlay) return;
        if (this._challengeResultCloseTimer) {
            clearTimeout(this._challengeResultCloseTimer);
            this._challengeResultCloseTimer = null;
        }
        overlay.style.opacity = '0';
        this._challengeResultCloseTimer = setTimeout(() => {
            this._challengeResultCloseTimer = null;
            overlay.classList.add('hidden');
        }, 300);
        // 关闭后刷新主菜单徽章
        this._updateDailyChallengeBadge();
    }

    _showChallengeHistory() {
        const overlay = document.getElementById('challenge-history-overlay');
        if (!overlay || !overlay.classList.contains('hidden')) return;
        overlay.classList.remove('hidden');
        overlay.style.opacity = '0';
        requestAnimationFrame(() => {
            overlay.style.transition = 'opacity 0.3s ease';
            overlay.style.opacity = '1';
        });

        const content = document.getElementById('challenge-history-content');
        const records = ChallengeRecordManager.getRecords();
        if (content) {
            if (records.length === 0) {
                content.innerHTML = '<div class="challenge-history-empty">暂无挑战记录<br>完成每日挑战后将自动保存</div>';
            } else {
                const rows = records.map(r => {
                    const date = new Date(r.timestamp);
                    const y = date.getFullYear();
                    const m = date.getMonth() + 1;
                    const d = date.getDate();
                    const dateStr = `${y}年${m}月${d}日`;
                    const scoreClass = r.score >= 0 ? '' : 'negative';
                    return `
                        <div class="challenge-history-item">
                            <div class="hist-date">${dateStr}</div>
                            <div class="hist-stars">${'⭐'.repeat(r.stars)}${r.stars < 3 ? '<span class="star-empty">' + '⭐'.repeat(3 - r.stars) + '</span>' : ''}</div>
                            <div class="hist-score ${scoreClass}">${r.score > 0 ? '+' : ''}${r.score}</div>
                        </div>
                    `;
                }).join('');
                content.innerHTML = `<div class="challenge-history-list">${rows}</div>`;
            }
        }

        const btnClose = document.getElementById('btn-close-challenge-history');
        if (btnClose) {
            // 移除旧监听器防止重复（虽然 {once:true} 理论上足够，但快速开关时可能有问题）
            const newBtn = btnClose.cloneNode(true);
            btnClose.parentNode?.replaceChild(newBtn, btnClose);
            newBtn.addEventListener('click', () => {
                this._playButtonClick();
                overlay.style.opacity = '0';
                setTimeout(() => overlay.classList.add('hidden'), 300);
            });
        }
    }

    _updateDailyChallengeBadge() {
        const desc = document.getElementById('daily-challenge-desc');
        if (!desc) return;
        const best = ChallengeRecordManager.getTodayBest();
        desc.classList.remove('daily-badge', 'daily-badge-completed', 'daily-badge-three-star');
        if (!best) {
            desc.textContent = '今日牌局已就绪';
            desc.classList.add('daily-badge');
            return;
        }
        const stars = '⭐'.repeat(best.stars);
        desc.innerHTML = `${stars} 最佳 ${best.score > 0 ? '+' : ''}${best.score}分`;
        desc.classList.add('daily-badge', 'daily-badge-completed');
        if (best.stars === 3) {
            desc.classList.add('daily-badge-three-star');
        }
    }

    // ===== 赛季任务面板 =====
    openSeasonQuests() {
        this._playButtonClick();
        const overlay = document.getElementById('season-quest-overlay');
        if (!overlay || !overlay.classList.contains('hidden')) return;
        overlay.classList.remove('hidden');
        overlay.style.opacity = '0';
        requestAnimationFrame(() => {
            overlay.style.transition = 'opacity 0.3s ease';
            overlay.style.opacity = '1';
        });
        this._renderSeasonQuests('daily');
        this._getActiveAudio()?.playSettingOpen?.();
    }

    closeSeasonQuests() {
        const overlay = document.getElementById('season-quest-overlay');
        if (!overlay || overlay.classList.contains('hidden')) return;
        overlay.style.transition = 'opacity 0.2s ease-in';
        overlay.style.opacity = '0';
        setTimeout(() => overlay.classList.add('hidden'), 200);
        this._getActiveAudio()?.playSettingClose?.();
    }

    _updateSeasonQuestBadge() {
        const badge = document.getElementById('season-quest-badge');
        if (!badge) return;
        const hasUnclaimed = seasonQuestManager.hasUnclaimed();
        badge.classList.toggle('hidden', !hasUnclaimed);
    }

    _renderSeasonQuests(activeTab = 'daily') {
        const content = document.getElementById('season-quest-content');
        if (!content) return;
        const data = seasonQuestManager.getData();
        const progress = seasonQuestManager.getProgress();

        // 标签页
        const tabsHtml = `
            <div class="sq-tabs">
                <div class="sq-tab ${activeTab === 'daily' ? 'active' : ''}" data-tab="daily">每日 (${progress.daily.done}/${progress.daily.total})</div>
                <div class="sq-tab ${activeTab === 'weekly' ? 'active' : ''}" data-tab="weekly">每周 (${progress.weekly.done}/${progress.weekly.total})</div>
                <div class="sq-tab ${activeTab === 'season' ? 'active' : ''}" data-tab="season">赛季 (${progress.season.done}/${progress.season.total})</div>
            </div>
        `;

        // 概览
        const overviewHtml = `
            <div class="sq-overview">
                <div class="sq-exp-circle">
                    <span>${progress.totalExp}</span>
                    <small>EXP</small>
                </div>
                <div class="sq-overview-info">
                    <div class="sq-overview-title">当前赛季 · 夏日激战</div>
                    <div class="sq-overview-desc">完成任务获得经验值与专属徽章</div>
                </div>
            </div>
        `;

        // 徽章展示
        const badges = seasonQuestManager.getBadges();
        const badgesHtml = badges.length > 0 ? `
            <div style="margin-bottom:14px;">
                <div style="font-size:0.8rem;font-weight:600;opacity:0.7;margin-bottom:6px;">已获徽章</div>
                <div class="sq-badges-grid">
                    ${badges.map(b => `<div class="sq-badge-item"><span class="sq-badge-emoji">${b.emoji}</span><span class="sq-badge-name">${b.name}</span></div>`).join('')}
                </div>
            </div>
        ` : '';

        // 任务列表
        let quests = [];
        if (activeTab === 'daily') quests = data.daily.quests;
        else if (activeTab === 'weekly') quests = data.weekly.quests;
        else if (activeTab === 'season') quests = data.season.quests;

        const questsHtml = this._renderQuestList(quests);

        content.innerHTML = tabsHtml + overviewHtml + badgesHtml + questsHtml;

        // 绑定标签切换
        content.querySelectorAll('.sq-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this._playButtonClick();
                this._renderSeasonQuests(tab.dataset.tab);
            });
        });

        // 绑定领取按钮
        content.querySelectorAll('.sq-btn-claim').forEach(btn => {
            btn.addEventListener('click', () => {
                this._playButtonClick();
                const questId = btn.dataset.questId;
                const reward = seasonQuestManager.claimReward(questId);
                if (reward) {
                    const q = quests.find(x => x.id === questId);
                    const msg = [`✅ 领取成功！`];
                    if (reward.exp) msg.push(`+${reward.exp} EXP`);
                    if (reward.badgeName) msg.push(`获得徽章「${reward.badgeName}」`);
                    this.renderer?.showToast?.(msg.join(' '), 'success');
                    this._renderSeasonQuests(activeTab);
                    this._updateSeasonQuestBadge();
                }
            });
        });
    }

    _renderQuestList(quests) {
        if (!quests || quests.length === 0) {
            return '<div style="text-align:center;padding:20px;opacity:0.5;font-size:0.85rem;">暂无任务</div>';
        }
        const items = quests.map(q => {
            const meta = QUEST_META[q.type] || { name: q.type, desc: '', icon: '⭐', unit: '' };
            const pct = Math.min(100, Math.round((q.current / Math.max(q.target, 1)) * 100));
            const isClaimed = q.claimed;
            const isCompleted = q.completed && !isClaimed;
            const rewardText = [];
            if (q.reward?.exp) rewardText.push(`+${q.reward.exp} EXP`);
            if (q.reward?.badgeName) rewardText.push(`🏅 ${q.reward.badgeName}`);

            return `
                <div class="sq-quest-item ${q.completed ? 'completed' : ''} ${isClaimed ? 'claimed' : ''}">
                    <div class="sq-quest-icon">${meta.icon}</div>
                    <div class="sq-quest-info">
                        <div class="sq-quest-name">${meta.name}</div>
                        <div class="sq-quest-desc">${meta.desc} (${q.target}${meta.unit})</div>
                        <div class="sq-quest-progress-wrap">
                            <div class="sq-quest-progress-bar">
                                <div class="sq-quest-progress-fill" style="width:${pct}%"></div>
                            </div>
                            <div class="sq-quest-progress-text">${q.current}/${q.target}</div>
                        </div>
                    </div>
                    <div class="sq-quest-action">
                        ${isCompleted
                            ? `<button class="sq-btn-claim" data-quest-id="${q.id}">领取</button>`
                            : isClaimed
                                ? `<button class="sq-btn-claimed" disabled>已领</button>`
                                : `<div class="sq-quest-reward">${rewardText.join('<br>')}</div>`
                        }
                    </div>
                </div>
            `;
        }).join('');
        return `<div class="sq-quest-list">${items}</div>`;
    }
}

// 页面加载完成后启动（模块脚本已 defer，需检查 readyState）
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => { window.gameApp = new GameApp(); });
} else {
    window.gameApp = new GameApp();
}

export { GameApp };

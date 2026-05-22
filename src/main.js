/**
 * Main - 游戏入口
 * 负责：菜单导航、模式切换、全局初始化、数据持久化
 */

import { AIMode } from './modes/ai-mode.js';
import { LANMode } from './modes/lan-mode.js';
import { CustomMode } from './modes/custom-mode.js';
import { Renderer } from './ui/renderer.js';
import { AudioManager } from './ui/audio.js';
import { Storage } from './utils/storage.js';
import { ReplayManager } from './utils/replay.js';
import { Tutorial } from './ui/tutorial.js';

class GameApp {
    constructor() {
        this.currentMode = null;
        this.renderer = null;
        this.menuAudio = new AudioManager();
        this.tutorial = new Tutorial(this.menuAudio);
        this._hasUserInteracted = false;
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
            { id: 'btn-tutorial', action: () => this.openTutorial() },
            { id: 'btn-settings', action: () => this.openSettings() },
            { id: 'btn-back', action: () => this.showMenu() },
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
            document.getElementById('achievement-panel')?.classList.add('hidden');
        });

        // 设置面板关闭
        document.getElementById('btn-close-settings')?.addEventListener('click', () => {
            this.closeSettings();
        });
        document.getElementById('settings-overlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'settings-overlay') this.closeSettings();
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

        // 游戏内音效开关（所有模式通用）
        document.getElementById('btn-sound-toggle')?.addEventListener('click', () => {
            this.renderer?.audio?.playButtonClick();
            const enabled = this.renderer?.audio?.toggle();
            const btn = document.getElementById('btn-sound-toggle');
            if (btn) btn.textContent = enabled ? '🔊' : '🔇';
            this.settings.soundEnabled = enabled;
            Storage.saveSettings(this.settings);
        });

        // 全屏切换
        document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
            this._playButtonClick();
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        });

        // LAN界面事件（只绑定一次）
        this._initLANListeners();
        this._initCustomListeners();

        // 渲染统计面板
        this._renderStats();

        // 新手引导
        this._initTutorial();

        // 隐藏加载画面 + 菜单入场动画 + BGM
        setTimeout(() => {
            document.getElementById('loading-screen')?.classList.add('hidden');
            this._animateMenuEntrance();
            // 延迟播放菜单BGM（等待用户交互解锁AudioContext）
            setTimeout(() => {
                this._playMenuBGM();
            }, 500);
        }, 600);
    }

    _getActiveAudio() {
        return this.renderer?.audio || this.menuAudio;
    }

    _syncAudioSettings(audio) {
        if (!audio) return;
        audio.enabled = this.settings.soundEnabled !== false;
        audio.bgmEnabled = this.settings.bgmEnabled !== false;
        audio.sfxEnabled = this.settings.sfxEnabled !== false;
        audio.setBGMVolume(this.settings.bgmVolume ?? 0.5);
        audio.setSFXVolume(this.settings.sfxVolume ?? 0.5);
    }

    _configureRendererAudio(renderer) {
        this._syncAudioSettings(renderer?.audio);
        return renderer;
    }

    _playButtonClick() {
        this._syncAudioSettings(this._getActiveAudio());
        this._getActiveAudio()?.playButtonClick();
    }

    _playMenuBGM(delay = 300) {
        if (this.renderer) return;
        this._syncAudioSettings(this.menuAudio);
        this.menuAudio?.stopBGM();
        setTimeout(() => {
            if (!this.renderer) this.menuAudio?.playMenuBGM();
        }, delay);
    }

    _stopMenuAudio() {
        this.menuAudio?.stopBGM();
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

        this._syncUXSettingControls();
        this._applyUXSettings();
    }

    _bindUXSettings() {
        // 滑块音效防抖计时器
        let sliderSfxTimer = null;

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
                this._applyUXSettings();
                this._updateUXSettingLabel(key);

                // === 音效反馈 ===
                const audio = this._getActiveAudio();
                if (control.type === 'checkbox') {
                    audio?.playSettingToggle?.(control.checked);
                } else if (control.type === 'range') {
                    clearTimeout(sliderSfxTimer);
                    sliderSfxTimer = setTimeout(() => {
                        audio?.playSettingSlider?.();
                    }, 120);
                }

                // === 视觉反馈 ===
                const parent = control.closest('.setting-row, .toggle-switch-wrap, .setting-slider, .volume-control');
                if (parent) {
                    parent.classList.remove('setting-changed');
                    void parent.offsetWidth; // force reflow
                    parent.classList.add('setting-changed');
                    setTimeout(() => parent.classList.remove('setting-changed'), 500);
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
                playedOverlap: 16, selectedLift: 12, hoverLift: 7, panelOpacity: 80,
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
                smartSort: true, rightClickCancel: true, wheelZoom: true,
                autoArrange: true, autoSortAfterPlay: false, stickySelection: false,
                showPlayPreview: true, gestureEnabled: true, swipeToSelect: true,
                longPressHint: false, hapticEnabled: true,
                // 辅助
                showTutorial: true, showShortcuts: true, showTableAura: true,
                opponentCards: 'stack', autoOpenTracker: false, autoOpenHistory: false,
                hintDetail: 'type', sortOrder: 'auto', showRemainingCount: true,
                showWinProbability: false, showBestMove: false, handAnalysis: false,
                showOpponentTendency: false, showDangerCards: false,
                highlightPlayable: true, showPatternName: true, showPlayerStats: false,
                showOpponentCall: true,
                // 面板
                enableCardTracker: true, enableAutoHint: true, enableChat: true,
                enableEmoji: true, enableReplay: true, enableStats: true,
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
            if (confirm('确定要恢复所有设置到默认状态吗？这将重置包括游戏规则在内的所有参数。')) {
                this.settings = Storage.getSettings(); // 重新获取默认值
                Storage.saveSettings(this.settings);
                this._syncAllSettings();
                this._applyUXSettings();
                this._applyTheme(this.settings.theme || 'green');
            }
        });
    }

    // ===== 设置面板打开/关闭 =====
    openSettings() {
        const overlay = document.getElementById('settings-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        // 降低 BGM
        const audio = this._getActiveAudio();
        if (audio && this._savedBGMVolume === undefined) {
            this._savedBGMVolume = this.settings.bgmVolume ?? 0.5;
            audio.setBGMVolume(this._savedBGMVolume * 0.25);
        }
        audio?.playSettingOpen?.();
        // 聚焦搜索框
        setTimeout(() => {
            document.getElementById('settings-search-input')?.focus();
        }, 100);
        // 初始化搜索
        this._initSettingsSearch();
    }

    closeSettings() {
        const audio = this._getActiveAudio();
        audio?.playSettingClose?.();
        // 恢复 BGM（优先使用用户在面板内调节后的最新值）
        if (this._savedBGMVolume !== undefined) {
            const restoredVolume = this.settings.bgmVolume ?? this._savedBGMVolume;
            audio?.setBGMVolume?.(restoredVolume);
            this._savedBGMVolume = undefined;
        }
        document.getElementById('settings-overlay')?.classList.add('hidden');
        // 清空搜索
        const searchInput = document.getElementById('settings-search-input');
        if (searchInput) {
            searchInput.value = '';
            this._filterSettings('');
        }
    }

    // ===== 设置搜索过滤 =====
    _initSettingsSearch() {
        if (this._settingsSearchBound) return;
        this._settingsSearchBound = true;

        const searchInput = document.getElementById('settings-search-input');
        const clearBtn = document.getElementById('settings-search-clear');

        let debounceTimer = null;
        searchInput?.addEventListener('input', (e) => {
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

        if (!query) {
            // 显示所有
            panel.querySelectorAll('.setting-hidden').forEach(el => el.classList.remove('setting-hidden'));
            panel.querySelectorAll('.setting-search-match').forEach(el => el.classList.remove('setting-search-match'));
            panel.querySelectorAll('.advanced-settings').forEach(d => { d.open = false; });
            if (countEl) countEl.textContent = '';
            return;
        }

        const q = query.toLowerCase();
        let matchCount = 0;

        // 收集所有可搜索元素
        const searchable = [];
        panel.querySelectorAll('.setting-row, .toggle-switch-wrap, .setting-slider, .volume-control').forEach(el => {
            const text = el.textContent.toLowerCase();
            searchable.push({ el, text });
        });

        // 先全部隐藏
        searchable.forEach(({ el }) => el.classList.add('setting-hidden'));
        panel.querySelectorAll('.setting-search-match').forEach(el => el.classList.remove('setting-search-match'));

        // 显示匹配的
        searchable.forEach(({ el, text }) => {
            if (text.includes(q)) {
                el.classList.remove('setting-hidden');
                el.classList.add('setting-search-match');
                matchCount++;
                // 展开父级 details
                let parent = el.parentElement;
                while (parent && parent !== panel) {
                    if (parent.tagName === 'DETAILS') parent.open = true;
                    parent = parent.parentElement;
                }
            }
        });

        if (countEl) countEl.textContent = matchCount > 0 ? `${matchCount} 项匹配` : '无匹配';
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

        const soundCheckbox = document.getElementById('cfg-sound');
        if (soundCheckbox) soundCheckbox.checked = this.settings.soundEnabled;

        const bgmSlider = document.getElementById('cfg-bgm-volume');
        const bgmVal = document.getElementById('cfg-bgm-volume-value');
        if (bgmSlider) bgmSlider.value = this.settings.bgmVolume ?? 0.5;
        if (bgmVal) bgmVal.textContent = Math.round((this.settings.bgmVolume ?? 0.5) * 100) + '%';

        const sfxSlider = document.getElementById('cfg-sfx-volume');
        const sfxVal = document.getElementById('cfg-sfx-volume-value');
        if (sfxSlider) sfxSlider.value = this.settings.sfxVolume ?? 0.5;
        if (sfxVal) sfxVal.textContent = Math.round((this.settings.sfxVolume ?? 0.5) * 100) + '%';

        this._syncUXSettingControls();
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
            output.textContent = Math.round(Number(value || 1) * 100) + '%';
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
        root.style.setProperty('--ddz-selected-lift', `${s.selectedLift ?? 12}px`);
        root.style.setProperty('--ddz-hover-lift', `${s.hoverLift ?? 7}px`);
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
        const statsEl = document.querySelector('.stats-panel');
        if (statsEl) {
            statsEl.remove();
        }
        // 如果不存在，在菜单中创建一个
        const menuContainer = document.querySelector('.menu-container');
        if (menuContainer) {
            const panel = document.createElement('div');
            panel.className = 'stats-panel';
            const level = this.stats.level || 1;
            const exp = this.stats.exp || 0;
            const expNeeded = level * 100;
            const expPercent = Math.round((exp / expNeeded) * 100);
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
                        <span class="stat-value">${this.stats.streak > 0 ? '+' : ''}${this.stats.streak}<small style="opacity:0.6;font-size:0.7rem">/${this.stats.maxStreak || 0}</small></span>
                        <span class="stat-label">连胜/最高</span>
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
        const bombs = gs?.history?.filter(h => h.pattern?.type === 'BOMB' || h.pattern?.type === 'ROCKET').length || 0;
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
        const btnCreate = document.getElementById('btn-create-room');
        const btnJoin = document.getElementById('btn-join-room');
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
                input.select();
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
            const roomId = document.getElementById('room-id-input')?.value?.trim();
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
            this._bindRoundEndListener();
            this._stopMenuAudio();

            document.getElementById('lan-screen')?.classList.add('hidden');
            document.getElementById('game-screen')?.classList.remove('hidden');
            await this.currentMode.startGame();
        });
    }

    _enterLANGameFromNetwork(mode) {
        if (!mode || mode !== this.currentMode) return;
        if (!this.renderer) {
            this.renderer = new Renderer('game-table');
            this.renderer.setGameState(mode.gameState);
            this.renderer.setMode(mode);
            this._configureRendererAudio(this.renderer);
            mode.setRenderer(this.renderer);
            this._bindRoundEndListener();
        }
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
    }

    async _refreshLANHostInfo() {
        const status = document.getElementById('lan-host-status');
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

            this._bindRoundEndListener();

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
        this.renderer?.destroy?.();
        this.renderer = null;
        this.currentMode = null;

        // 切换回菜单BGM
        this._playMenuBGM();

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
        this._stopMenuAudio();
        this.renderer?.audio?.stopBGM();
        setTimeout(() => this.renderer?.audio?.playGameBGM(), 1500);
    }

    // ---- AI模式 ----
    async startAIMode() {
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
        this.currentMode.speedFactor = this.settings.gameSpeed || 1.0;
        // 应用自定义玩家名称
        const humanPlayer = this.currentMode.gameState?.players?.[this.currentMode.humanIndex];
        if (humanPlayer) humanPlayer.name = this.settings.playerName || '玩家';
        document.getElementById('mode-display').textContent = `人机对战 (${diff === 'easy' ? '简单' : diff === 'hard' ? '困难' : '普通'})${rounds > 1 ? ' · ' + rounds + '局' : ''}`;

        this.renderer = new Renderer('game-table');
        this.renderer.setGameState(this.currentMode.gameState);
        this.renderer.setMode(this.currentMode);
        this._configureRendererAudio(this.renderer);
        this.currentMode.setRenderer(this.renderer);

        this._bindRoundEndListener();

        this.showGame();
        this._lockGameRuleSettings(true);
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
        this.currentMode.speedFactor = this.settings.gameSpeed || 1.0;
        document.getElementById('mode-display').textContent = '局域网联机';
        // 应用自定义玩家名称
        const humanPlayer = this.currentMode.gameState?.players?.[this.currentMode.humanIndex];
        if (humanPlayer) humanPlayer.name = this.settings.playerName || '玩家';
        this._lockGameRuleSettings(true);
    }

    // ---- 自定义模式 ----
    async startCustomMode() {
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
        this.currentMode.speedFactor = this.settings.gameSpeed || 1.0;
        document.getElementById('mode-display').textContent = '自定义模式';
        // 应用自定义玩家名称
        const humanPlayer = this.currentMode.gameState?.players?.[this.currentMode.humanIndex];
        if (humanPlayer) humanPlayer.name = this.settings.playerName || '玩家';
        this._lockGameRuleSettings(true);
    }
}

// 页面加载完成后启动
window.addEventListener('DOMContentLoaded', () => {
    window.gameApp = new GameApp();
});

export { GameApp };

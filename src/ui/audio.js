/**
 * AudioManager - 音效与背景音乐管理器
 * 使用 Web Audio API 合成全部音频，无需外部文件
 * 包含：BGM循环系统 + 20+ 种游戏音效
 */

import { Storage } from '../utils/storage.js';

class AudioManager {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.bgmEnabled = true;
        this.sfxEnabled = true;
        this.bgmVolume = 0.5;
        this.sfxVolume = 0.5;
        this.voiceVolume = 0.7;
        this._bgmGain = null;
        this._bgmNodes = [];
        this._bgmTimer = null;
        this._winSfxTimeout = null;
        this._sfxTimeouts = new Set();
        this._callTimeout = null;
        this._bgmLoopStart = 0;
        this._currentBGM = null;
        this._bgmGeneration = 0;
        this._masterCompressor = null;
        this._lastSfxTime = {}; // 音效防抖
        // 读取细粒度音效开关
        this._loadSfxSettings();
        this._init();
        // 监听页面可见性变化，后台时暂停 BGM 防止叠音
        this._visHandler = () => {
            if (document.hidden) {
                this._wasPlayingBGM = !!this._currentBGM;
                this.stopBGM();
            } else if (this._wasPlayingBGM && this.bgmEnabled) {
                this._wasPlayingBGM = false;
                if (this._currentBGM === 'menu') this.playMenuBGM();
                else if (this._currentBGM === 'game') this.playGameBGM();
            }
        };
        document.addEventListener('visibilitychange', this._visHandler);
    }

    _loadSfxSettings() {
        try {
            const s = Storage.getSettings();
            this._sfxSettings = {
                deal: s.enableDealSound !== false,
                play: s.enablePlaySound !== false,
                call: s.enableCallSound !== false,
                bomb: s.enableBombSound !== false,
                win: s.enableWinSound !== false,
                tick: s.enableTickSound !== false,
                chat: s.enableChatSound !== false,
            };
        } catch (e) {
            this._sfxSettings = { deal: true, play: true, bomb: true, win: true, tick: true, chat: true };
        }
    }

    reloadSfxSettings() {
        this._loadSfxSettings();
    }

    _trackSfxTimeout(id) {
        this._sfxTimeouts.add(id);
    }

    _clearSfxTimeouts() {
        this._sfxTimeouts.forEach(id => clearTimeout(id));
        this._sfxTimeouts.clear();
    }

    _isSfxEnabled(type) {
        return this._sfxSettings?.[type] !== false;
    }

    _init() {
        // 初始化已在 constructor 中完成
    }

    async _ensureContext() {
        if (!this.enabled) return false;
        if (!this.ctx || this.ctx.state === 'closed' || this.ctx.state === 'closing') {
            this.stopBGM();
            this._bgmNodes.forEach(n => {
                try {
                    if (n.gain) n.gain.disconnect();
                    if (n.osc) n.osc.disconnect();
                } catch (e) {}
            });
            this._bgmNodes = [];
            this.ctx = null;
            this._masterCompressor = null;
            this._bgmGain = null;
            try {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                console.warn('Web Audio API not supported');
                return false;
            }
        }
        if (this.ctx.state === 'suspended') {
            try {
                await this.ctx.resume();
            } catch (e) {
                return false;
            }
            // resume() 可能 resolve 但 state 仍是 suspended（如用户未交互）
            if (this.ctx.state !== 'running') return false;
        }
        return true;
    }

    // ==================== 通用底层 ====================

    _getMasterCompressor() {
        if (!this.ctx || this.ctx.state === 'closed' || this.ctx.state === 'closing') return null;
        if (!this._masterCompressor) {
            this._masterCompressor = this.ctx.createDynamicsCompressor();
            this._masterCompressor.threshold.setValueAtTime(-12, this.ctx.currentTime);
            this._masterCompressor.knee.setValueAtTime(6, this.ctx.currentTime);
            this._masterCompressor.ratio.setValueAtTime(8, this.ctx.currentTime);
            this._masterCompressor.attack.setValueAtTime(0.005, this.ctx.currentTime);
            this._masterCompressor.release.setValueAtTime(0.1, this.ctx.currentTime);
            this._masterCompressor.connect(this.ctx.destination);
        }
        return this._masterCompressor;
    }

    async _tone(freq, duration, type = 'sine', volume = 0.10, when = null) {
        if (duration <= 0) return;
        if (!this.sfxEnabled) return;
        if (!(await this._ensureContext())) return;
        if (!this.ctx) return;
        const t = when ?? this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);

        // Attack 包络：5ms 线性上升，消除 click noise
        const finalVol = volume * this.sfxVolume;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(finalVol, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

        osc.connect(gain);
        gain.connect(this._getMasterCompressor());

        try {
            osc.start(t);
            osc.stop(t + duration);
        } catch (e) {
            try { osc.disconnect(); gain.disconnect(); } catch (_) {}
            return;
        }
        osc.onended = () => {
            try { osc.disconnect(); gain.disconnect(); } catch (e) {}
        };
    }

    async _playTick() {
        if (!this.sfxEnabled) return;
        if (!(await this._ensureContext())) return;
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, t);
        gain.gain.setValueAtTime(0.12 * this.sfxVolume, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.connect(gain);
        gain.connect(this._getMasterCompressor() || this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.1);
        osc.onended = () => {
            try { osc.disconnect(); gain.disconnect(); } catch (e) {}
        };
    }

    playTick() {
        if (!this._isSfxEnabled('tick')) return;
        if (!this._shouldPlaySfx('tick', 80)) return;
        this._playTick().catch(() => {});
    }

    async _sequence(notes, interval = 0.08, offset = 0) {
        if (!this.sfxEnabled) return;
        if (!(await this._ensureContext())) return;
        if (!this.ctx) return;
        const baseTime = this.ctx.currentTime + offset;
        for (let i = 0; i < notes.length; i++) {
            const n = notes[i];
            const when = baseTime + i * interval;
            this._tone(n.freq, n.dur || 0.15, n.type || 'sine', n.vol || 0.12, when).catch(() => {});
        }
    }

    // ==================== BGM 系统 ====================

    stopBGM() {
        this._wasPlayingBGM = false;
        if (this._bgmTimer) {
            clearTimeout(this._bgmTimer);
            this._bgmTimer = null;
        }
        if (this._winSfxTimeout) {
            clearTimeout(this._winSfxTimeout);
            this._winSfxTimeout = null;
        }
        if (this._callTimeout) {
            clearTimeout(this._callTimeout);
            this._callTimeout = null;
        }
        // 若 context 已关闭，跳过精细淡出，直接清理引用
        if (this.ctx && (this.ctx.state === 'closed' || this.ctx.state === 'closing')) {
            this._bgmNodes = [];
            this._bgmGeneration++;
            this._bgmGain = null;
            this._masterCompressor = null;
            return;
        }
        const now = this.ctx ? this.ctx.currentTime : 0;
        this._bgmNodes.forEach(n => {
            try {
                if (n.gain) {
                    n.gain.gain.cancelScheduledValues(now);
                    n.gain.gain.setValueAtTime(n.gain.gain.value, now);
                    n.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
                }
                if (n.osc) {
                    n.osc.stop(now + 0.6);
                }
            } catch (e) {}
        });
        this._bgmNodes = [];
        this._bgmGeneration++;
        // 切断与旧 context 的引用，防止重建后连接死节点
        if (this._bgmGain) {
            try { this._bgmGain.disconnect(); } catch (e) {}
            this._bgmGain = null;
        }
        if (this._masterCompressor) {
            try { this._masterCompressor.disconnect(); } catch (e) {}
            this._masterCompressor = null;
        }
        // 保留 _currentBGM 以便 toggleBGM 恢复播放
    }

    async _createBGMGain() {
        if (!(await this._ensureContext())) return null;
        if (!this._bgmGain) {
            this._bgmGain = this.ctx.createGain();
            this._bgmGain.gain.value = 0.08 * this.bgmVolume;
            this._bgmGain.connect(this._getMasterCompressor());
        }
        return this._bgmGain;
    }

    setBGMVolume(v) {
        this.bgmVolume = Math.max(0, Math.min(1, v));
        if (this._bgmGain && this.ctx && this.ctx.state === 'running') {
            try {
                const now = this.ctx.currentTime;
                const target = 0.08 * this.bgmVolume;
                this._bgmGain.gain.setTargetAtTime(target, now, 0.15);
            } catch (e) {
                // InvalidStateError: context 已关闭或节点已断开
            }
        }
    }

    setSFXVolume(v) {
        this.sfxVolume = Math.max(0, Math.min(1, v));
    }

    setVoiceVolume(v) {
        // 目前未接入语音播报，保留 setter 供未来扩展
        this.voiceVolume = Math.max(0, Math.min(1, v));
    }

    async _scheduleBGMNote(freq, start, duration, type = 'sine', vol = 1.0) {
        const master = await this._createBGMGain();
        if (!master) return;
        const t = this.ctx.currentTime + start;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(vol * 0.12, t + 0.05);
        gain.gain.setValueAtTime(vol * 0.12, t + duration - 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
        osc.connect(gain);
        gain.connect(master);
        const nodeRef = { osc, gain };
        try {
            osc.start(t);
            osc.stop(t + duration + 0.1);
        } catch (e) {
            const idx = this._bgmNodes.indexOf(nodeRef);
            if (idx >= 0) this._bgmNodes.splice(idx, 1);
            try { osc.disconnect(); gain.disconnect(); } catch (_) {}
            return;
        }
        this._bgmNodes.push(nodeRef);
        
        // 播放结束后自动从列表中移除，防止内存泄漏
        osc.onended = () => {
            const idx = this._bgmNodes.indexOf(nodeRef);
            if (idx >= 0) this._bgmNodes.splice(idx, 1);
            try { osc.disconnect(); gain.disconnect(); } catch (e) {}
        };
    }

    async _playBGMSequence(notes, tempoBPM = 100, waveform = 'sine', loop = true) {
        this.stopBGM();
        if (!this.bgmEnabled) return;
        const gen = this._bgmGeneration;
        if (!(await this._ensureContext())) return;
        if (!this.ctx) return;
        if (gen !== this._bgmGeneration) return;

        const beat = 60 / tempoBPM;
        let totalDuration = 0;
        for (const n of notes) {
            if (gen !== this._bgmGeneration) return;
            const start = (n.beat || 0) * beat;
            const dur = (n.dur || 0.5) * beat;
            totalDuration = Math.max(totalDuration, start + dur);
            // triangle 波形能量比 sine 高约 3dB，适当降低音量
            const vol = waveform === 'triangle' ? (n.vol || 1) * 0.8 : (n.vol || 1);
            this._scheduleBGMNote(n.freq, start, dur, waveform, vol);
        }

        if (loop && totalDuration > 0) {
            // 使用精确的 AudioContext 时间调度 loop，消除 200ms 间隙
            const loopDelay = Math.max(0, totalDuration - 0.05);
            this._bgmTimer = setTimeout(() => {
                if (!this.enabled || !this.bgmEnabled) return;
                if (this._currentBGM && gen === this._bgmGeneration) {
                    this._playBGMSequence(notes, tempoBPM, waveform, true);
                }
            }, loopDelay * 1000);
        }
    }

    // 菜单BGM：中国风五声音阶，舒缓
    playMenuBGM() {
        this._currentBGM = 'menu';
        const notes = [
            { freq: 523.25, beat: 0, dur: 1.0, vol: 0.9 },   // C5
            { freq: 587.33, beat: 1, dur: 1.0, vol: 0.8 },   // D5
            { freq: 659.25, beat: 2, dur: 1.0, vol: 0.9 },   // E5
            { freq: 587.33, beat: 3, dur: 1.0, vol: 0.7 },   // D5
            { freq: 523.25, beat: 4, dur: 2.0, vol: 0.9 },   // C5
            { freq: 392.00, beat: 4, dur: 2.0, vol: 0.5 },   // G4 (低音)
            { freq: 783.99, beat: 6, dur: 0.5, vol: 0.6 },   // G5
            { freq: 659.25, beat: 6.5, dur: 0.5, vol: 0.6 }, // E5
            { freq: 587.33, beat: 7, dur: 0.5, vol: 0.7 },   // D5
            { freq: 523.25, beat: 7.5, dur: 0.5, vol: 0.8 }, // C5
        ];
        this._playBGMSequence(notes, 80, 'sine', true);
    }

    // 游戏BGM：紧张感低音循环
    playGameBGM() {
        this._currentBGM = 'game';
        const notes = [
            { freq: 196.00, beat: 0, dur: 0.5, vol: 0.6 },   // G3
            { freq: 220.00, beat: 0.5, dur: 0.5, vol: 0.5 }, // A3
            { freq: 261.63, beat: 1, dur: 0.5, vol: 0.6 },   // C4
            { freq: 196.00, beat: 1.5, dur: 0.5, vol: 0.5 }, // G3
            { freq: 174.61, beat: 2, dur: 0.5, vol: 0.6 },   // F3
            { freq: 196.00, beat: 2.5, dur: 0.5, vol: 0.5 }, // G3
            { freq: 220.00, beat: 3, dur: 0.5, vol: 0.6 },   // A3
            { freq: 196.00, beat: 3.5, dur: 0.5, vol: 0.5 }, // G3
        ];
        this._playBGMSequence(notes, 110, 'triangle', true);
    }

    // 胜利BGM：欢快庆祝（不循环）
    playWinBGM() {
        this.stopBGM();
        this._currentBGM = 'win';
        const notes = [
            { freq: 523, beat: 0, dur: 0.3, vol: 0.9 },
            { freq: 659, beat: 0.5, dur: 0.3, vol: 0.85 },
            { freq: 784, beat: 1.0, dur: 0.3, vol: 0.9 },
            { freq: 1047, beat: 1.5, dur: 0.6, vol: 0.95 },
            { freq: 784, beat: 2.25, dur: 0.2, vol: 0.75 },
            { freq: 1047, beat: 2.5, dur: 0.8, vol: 1.0 },
        ];
        this._playBGMSequence(notes, 100, 'sine', false);
    }

    // 失败BGM：低沉（不循环）
    playLoseBGM() {
        this.stopBGM();
        this._currentBGM = 'lose';
        const notes = [
            { freq: 392, beat: 0, dur: 0.5, vol: 0.8 },
            { freq: 349, beat: 0.75, dur: 0.5, vol: 0.7 },
            { freq: 330, beat: 1.5, dur: 0.5, vol: 0.7 },
            { freq: 294, beat: 2.25, dur: 0.8, vol: 0.9 },
            { freq: 262, beat: 3.5, dur: 1.2, vol: 1.0 },
        ];
        this._playBGMSequence(notes, 70, 'triangle', false);
    }

    // ==================== 原有音效（保留并增强）====================

    playDeal() {
        if (!this._isSfxEnabled('deal')) return;
        if (!this._shouldPlaySfx('deal', 300)) return;
        // 发牌：更丰富的快速连音
        this._sequence([
            { freq: 700, dur: 0.04 },
            { freq: 900, dur: 0.04 },
            { freq: 1100, dur: 0.05 },
            { freq: 800, dur: 0.03 },
        ], 0.035);
    }

    playCall() {
        if (!this._isSfxEnabled('call')) return;
        // 叫分：庄重的双音
        this._tone(523, 0.15, 'sine', 0.13);
        if (this._callTimeout) clearTimeout(this._callTimeout);
        this._callTimeout = setTimeout(() => {
            this._callTimeout = null;
            this._tone(659, 0.2, 'sine', 0.13);
        }, 100);
    }

    playPass() {
        if (!this.sfxEnabled) return;
        if (!this._isSfxEnabled('play')) return;
        // 不出：低沉闷音（频率提升到手机扬声器可听范围）
        this._tone(280, 0.15, 'triangle', 0.09);
        this._trackSfxTimeout(setTimeout(() => this._tone(250, 0.12, 'triangle', 0.07), 70));
    }

    playPlay() {
        if (!this.sfxEnabled) return;
        if (!this._isSfxEnabled('play')) return;
        // 出牌：轻快的滑动音
        this._tone(560, 0.07, 'sine', 0.1);
        this._trackSfxTimeout(setTimeout(() => this._tone(720, 0.09, 'sine', 0.1), 40));
    }

    playSingle() {
        if (!this._isSfxEnabled('play')) return;
        this._tone(640, 0.07, 'sine', 0.1);
    }

    playPair() {
        if (!this.sfxEnabled) return;
        if (!this._isSfxEnabled('play')) return;
        this._tone(560, 0.07, 'sine', 0.1);
        this._trackSfxTimeout(setTimeout(() => this._tone(560, 0.07, 'sine', 0.1), 50));
    }

    playTriple() {
        if (!this._isSfxEnabled('play')) return;
        this._sequence([
            { freq: 560, dur: 0.05 },
            { freq: 560, dur: 0.05 },
            { freq: 560, dur: 0.07 },
        ], 0.04);
    }

    async playStraight() {
        if (!this.sfxEnabled) return;
        if (!this._isSfxEnabled('play')) return;
        if (!(await this._ensureContext())) return;
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(480, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(960, this.ctx.currentTime + 0.25);
        gain.gain.setValueAtTime(0.1 * this.sfxVolume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(this._getMasterCompressor() || this.ctx.destination);
        try {
            osc.start();
            osc.stop(this.ctx.currentTime + 0.3);
        } catch (e) {
            try { osc.disconnect(); gain.disconnect(); } catch (_) {}
            return;
        }
        osc.onended = () => {
            try { osc.disconnect(); gain.disconnect(); } catch (e) {}
        };
    }

    playPlane() {
        if (!this._isSfxEnabled('play')) return;
        this._sequence([
            { freq: 540, dur: 0.07 },
            { freq: 700, dur: 0.07 },
            { freq: 880, dur: 0.1 },
        ], 0.06);
    }

    playFourWithTwo() {
        if (!this.sfxEnabled) return;
        if (!this._isSfxEnabled('play')) return;
        // 纯五度和声（G4 + D5）
        this._tone(392, 0.13, 'triangle', 0.10);
        this._trackSfxTimeout(setTimeout(() => this._tone(587, 0.08, 'sine', 0.07), 100));
    }

    async playBomb() {
        if (!this.sfxEnabled) return;
        if (!this._isSfxEnabled('bomb')) return;
        if (!this._shouldPlaySfx('bomb', 600)) return;
        if (!(await this._ensureContext())) return;
        if (!this.ctx) return;
        const duration = 0.7;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 1.5);
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, this.ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + duration);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.20 * this.sfxVolume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this._getMasterCompressor() || this.ctx.destination);
        try { noise.start(); } catch (e) { return; }

        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(15, this.ctx.currentTime + duration);
        const oscGain = this.ctx.createGain();
        oscGain.gain.setValueAtTime(0.15 * this.sfxVolume, this.ctx.currentTime);
        oscGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(oscGain);
        oscGain.connect(this._getMasterCompressor() || this.ctx.destination);
        try {
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) {
            try { osc.disconnect(); oscGain.disconnect(); } catch (_) {}
            return;
        }
        noise.onended = () => {
            try { noise.disconnect(); filter.disconnect(); gain.disconnect(); } catch (e) {}
        };
        osc.onended = () => {
            try { osc.disconnect(); oscGain.disconnect(); } catch (e) {}
        };
    }

    async playRocket() {
        if (!this.sfxEnabled) return;
        if (!this._isSfxEnabled('play')) return;
        if (!this._shouldPlaySfx('rocket', 600)) return;
        if (!(await this._ensureContext())) return;
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(350, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1400, this.ctx.currentTime + 0.35);
        osc.frequency.exponentialRampToValueAtTime(180, this.ctx.currentTime + 0.9);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.15 * this.sfxVolume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.9);
        osc.connect(gain);
        gain.connect(this._getMasterCompressor() || this.ctx.destination);
        try {
            osc.start();
            osc.stop(this.ctx.currentTime + 0.9);
        } catch (e) {
            try { osc.disconnect(); gain.disconnect(); } catch (_) {}
            return;
        }
        osc.onended = () => {
            try { osc.disconnect(); gain.disconnect(); } catch (e) {}
        };
    }

    playWin() {
        if (!this._isSfxEnabled('win')) return;
        if (!this._shouldPlaySfx('win', 800)) return;
        // 胜利：更丰富的上行和弦
        this._sequence([
            { freq: 523, dur: 0.12 },
            { freq: 659, dur: 0.12 },
            { freq: 784, dur: 0.12 },
            { freq: 1047, dur: 0.35 },
        ], 0.12);
        if (this._winSfxTimeout) clearTimeout(this._winSfxTimeout);
        this._winSfxTimeout = setTimeout(() => {
            this._winSfxTimeout = null;
            this._sequence([
                { freq: 784, dur: 0.08 },
                { freq: 1047, dur: 0.5, vol: 0.15 },
            ], 0.1);
        }, 550);
    }

    playLose() {
        if (!this.sfxEnabled) return;
        if (!this._isSfxEnabled('win')) return;
        if (!this._shouldPlaySfx('lose', 800)) return;
        this._sequence([
            { freq: 392, dur: 0.18, type: 'triangle' },
            { freq: 349, dur: 0.18, type: 'triangle' },
            { freq: 311, dur: 0.25, type: 'triangle' },
            { freq: 262, dur: 0.4, type: 'triangle' },
        ], 0.2);
    }

    playSpring() {
        if (!this.sfxEnabled) return;
        if (!this._isSfxEnabled('win')) return;
        if (!this._shouldPlaySfx('spring', 800)) return;
        // 春天：更清脆的铃铛声
        this._sequence([
            { freq: 880, dur: 0.08 },
            { freq: 1100, dur: 0.08 },
            { freq: 1320, dur: 0.1 },
            { freq: 1760, dur: 0.25, vol: 0.12 },
        ], 0.08);
    }

    // ==================== 全新音效 ====================

    _shouldPlaySfx(name, minInterval = 50) {
        const now = Date.now();
        const last = this._lastSfxTime[name] || 0;
        if (now - last < minInterval) return false;
        this._lastSfxTime[name] = now;
        return true;
    }

    playCardSelect() {
        if (!this.sfxEnabled) return;
        if (!this._shouldPlaySfx('cardSelect', 40)) return;
        // 选牌：清脆短高音
        this._tone(880, 0.04, 'sine', 0.08);
    }

    playCardDeselect() {
        if (!this.sfxEnabled) return;
        if (!this._shouldPlaySfx('cardDeselect', 40)) return;
        // 取消选牌：略低的短音
        this._tone(660, 0.04, 'sine', 0.06);
    }

    playHint() {
        if (!this.sfxEnabled) return;
        // 提示：双音提示
        this._tone(784, 0.08, 'sine', 0.09);
        this._trackSfxTimeout(setTimeout(() => this._tone(1047, 0.1, 'sine', 0.09), 80));
    }

    playAutoToggle(on) {
        if (!this.sfxEnabled) return;
        // 托管切换：机械感
        if (on) {
            this._tone(440, 0.1, 'square', 0.06);
            this._trackSfxTimeout(setTimeout(() => this._tone(660, 0.12, 'square', 0.06), 100));
        } else {
            this._tone(660, 0.1, 'square', 0.06);
            this._trackSfxTimeout(setTimeout(() => this._tone(440, 0.12, 'square', 0.06), 100));
        }
    }

    playButtonClick() {
        if (!this.sfxEnabled) return;
        if (!this._shouldPlaySfx('buttonClick', 60)) return;
        // 按钮点击：短促木头感
        this._tone(1200, 0.03, 'sine', 0.07);
        this._trackSfxTimeout(setTimeout(() => this._tone(800, 0.04, 'sine', 0.05), 20));
    }

    playLandlordConfirm() {
        if (!this.sfxEnabled) return;
        // 地主确认：庄重的和弦
        this._tone(392, 0.2, 'triangle', 0.1);
        this._trackSfxTimeout(setTimeout(() => this._tone(494, 0.2, 'triangle', 0.1), 120));
        this._trackSfxTimeout(setTimeout(() => this._tone(587, 0.3, 'triangle', 0.12), 240));
    }

    playBottomReveal() {
        if (!this.sfxEnabled) return;
        // 底牌揭示：翻牌轻响
        this._sequence([
            { freq: 500, dur: 0.04 },
            { freq: 750, dur: 0.05 },
        ], 0.04);
    }

    playNewRound() {
        if (!this.sfxEnabled) return;
        if (!this._shouldPlaySfx('newRound', 300)) return;
        // 新一轮开始：提示音
        this._tone(523, 0.1, 'sine', 0.1);
        this._trackSfxTimeout(setTimeout(() => this._tone(659, 0.1, 'sine', 0.1), 100));
        this._trackSfxTimeout(setTimeout(() => this._tone(784, 0.15, 'sine', 0.12), 200));
    }

    playTurnAlert() {
        if (!this.sfxEnabled) return;
        // 回合提醒：轻柔提示
        this._tone(659, 0.08, 'sine', 0.07);
        this._trackSfxTimeout(setTimeout(() => this._tone(784, 0.1, 'sine', 0.08), 120));
    }

    playChat() {
        if (!this._isSfxEnabled('chat')) return;
        // 聊天消息：短促消息音
        this._tone(900, 0.05, 'sine', 0.06);
    }

    playCardPlace() {
        if (!this.sfxEnabled) return;
        // 出牌放置：轻快的落牌声
        this._tone(600, 0.04, 'sine', 0.07);
        this._trackSfxTimeout(setTimeout(() => this._tone(800, 0.05, 'sine', 0.06), 40));
    }

    playError() {
        if (!this.sfxEnabled) return;
        // 错误/无效操作：不和谐低音
        this._tone(150, 0.15, 'sawtooth', 0.08);
        this._trackSfxTimeout(setTimeout(() => this._tone(120, 0.15, 'sawtooth', 0.08), 80));
    }

    playCountdown() {
        if (!this.sfxEnabled) return;
        // 倒计时：滴答
        this._tone(1000, 0.04, 'sine', 0.06);
    }

    playScoreChange(positive) {
        if (!this.sfxEnabled) return;
        // 分数变化：硬币声
        if (positive) {
            this._tone(1200, 0.06, 'sine', 0.08);
            this._trackSfxTimeout(setTimeout(() => this._tone(1600, 0.08, 'sine', 0.1), 50));
        } else {
            this._tone(600, 0.1, 'triangle', 0.08);
        }
    }

    playMatchEnd() {
        if (!this._shouldPlaySfx('matchEnd', 800)) return;
        // 比赛结束：号角
        this._sequence([
            { freq: 523, dur: 0.2, vol: 0.12 },
            { freq: 659, dur: 0.2, vol: 0.12 },
            { freq: 784, dur: 0.3, vol: 0.14 },
        ], 0.2);
    }

    playGrabLandlord() {
        if (!this.sfxEnabled) return;
        if (!this._shouldPlaySfx('grabLandlord', 300)) return;
        // 抢地主：紧张感
        this._tone(440, 0.1, 'square', 0.07);
        this._trackSfxTimeout(setTimeout(() => this._tone(550, 0.1, 'square', 0.08), 80));
        this._trackSfxTimeout(setTimeout(() => this._tone(660, 0.15, 'square', 0.09), 160));
    }

    playPassTurn() {
        if (!this.sfxEnabled) return;
        if (!this._isSfxEnabled('play')) return;
        // 过牌（轮到下一家）：轻柔滑音
        this._tone(400, 0.08, 'sine', 0.06);
        this._trackSfxTimeout(setTimeout(() => this._tone(350, 0.1, 'sine', 0.05), 60));
    }

    // ==================== 设置面板音效 ====================

    playSettingToggle(on) {
        if (!this.sfxEnabled) return;
        if (on) {
            // 开启：清脆上升音
            this._tone(880, 0.06, 'sine', 0.06);
            this._trackSfxTimeout(setTimeout(() => this._tone(1100, 0.08, 'sine', 0.07), 50));
        } else {
            // 关闭：低沉下降音
            this._tone(660, 0.06, 'sine', 0.05);
            this._trackSfxTimeout(setTimeout(() => this._tone(440, 0.08, 'sine', 0.04), 50));
        }
    }

    playSettingSlider() {
        if (!this.sfxEnabled) return;
        // 滑块：清晰滴答
        this._tone(1000, 0.05, 'sine', 0.06);
    }

    playSettingOpen() {
        if (!this.sfxEnabled) return;
        // 面板打开：明亮展开音
        this._tone(660, 0.08, 'sine', 0.06);
        this._trackSfxTimeout(setTimeout(() => this._tone(880, 0.1, 'sine', 0.07), 60));
        this._trackSfxTimeout(setTimeout(() => this._tone(1100, 0.12, 'sine', 0.06), 130));
    }

    playSettingClose() {
        if (!this.sfxEnabled) return;
        // 面板关闭：收拢音
        this._tone(880, 0.06, 'sine', 0.05);
        this._trackSfxTimeout(setTimeout(() => this._tone(660, 0.08, 'sine', 0.04), 60));
    }

    playSettingReset() {
        if (!this.sfxEnabled) return;
        // 重置：警示音
        this._tone(440, 0.1, 'triangle', 0.07);
        this._trackSfxTimeout(setTimeout(() => this._tone(330, 0.12, 'triangle', 0.06), 100));
    }

    // ==================== 控制接口 ====================

    toggle() {
        this.enabled = !this.enabled;
        if (!this.enabled) {
            this.stopBGM();
        }
        return this.enabled;
    }

    toggleBGM() {
        this.bgmEnabled = !this.bgmEnabled;
        if (!this.bgmEnabled) {
            this._wasPlayingBGM = false;
            this.stopBGM();
        } else if (this._currentBGM === 'menu') {
            this.playMenuBGM();
        } else if (this._currentBGM === 'game') {
            this.playGameBGM();
        }
        // win/lose 是一次性结算音效，toggle 恢复时不应重播，保持静音即可
        return this.bgmEnabled;
    }

    toggleSFX() {
        this.sfxEnabled = !this.sfxEnabled;
        return this.sfxEnabled;
    }

    destroy() {
        this.stopBGM();
        this._clearSfxTimeouts();
        this._bgmNodes.forEach(n => {
            try {
                if (n.gain) n.gain.disconnect();
                if (n.osc) {
                    // 避免对已 stopped 的 oscillator 重复调用 stop()
                    try { n.osc.stop(); } catch (e) {}
                    n.osc.disconnect();
                }
            } catch (e) {}
        });
        this._bgmNodes = [];
        if (this.ctx && this.ctx.state !== 'closed') {
            try {
                this.ctx.close();
            } catch (e) {}
        }
        this.ctx = null;
        this.enabled = false;
        this.sfxEnabled = false;
        this.bgmEnabled = false;
        this._currentBGM = null;
        if (this._visHandler) {
            document.removeEventListener('visibilitychange', this._visHandler);
            this._visHandler = null;
        }
    }
}

export { AudioManager };

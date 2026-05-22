/**
 * AudioManager - 音效与背景音乐管理器
 * 使用 Web Audio API 合成全部音频，无需外部文件
 * 包含：BGM循环系统 + 20+ 种游戏音效
 */

class AudioManager {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.bgmEnabled = true;
        this.sfxEnabled = true;
        this.bgmVolume = 0.5;
        this.sfxVolume = 0.5;
        this._bgmGain = null;
        this._bgmNodes = [];
        this._bgmTimer = null;
        this._bgmLoopStart = 0;
        this._currentBGM = null;
        this._bgmGeneration = 0;
        this._init();
    }

    _init() {
        this.ctx = null;
    }

    async _ensureContext() {
        if (!this.enabled) return false;
        if (!this.ctx) {
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
        }
        return true;
    }

    // ==================== 通用底层 ====================

    async _tone(freq, duration, type = 'sine', volume = 0.15, when = null) {
        if (duration <= 0) return;
        if (!this.sfxEnabled) return;
        if (!(await this._ensureContext())) return;

        const t = when ?? this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);

        gain.gain.setValueAtTime(volume * this.sfxVolume, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(t);
        osc.stop(t + duration);
    }

    async _playTick() {
        if (!this.sfxEnabled) return;
        if (!(await this._ensureContext())) return;
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, t);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.1);
    }

    playTick() {
        this._playTick().catch(() => {});
    }

    async _sequence(notes, interval = 0.08, offset = 0) {
        if (!this.sfxEnabled) return;
        if (!(await this._ensureContext())) return;
        const baseTime = this.ctx.currentTime + offset;
        notes.forEach((n, i) => {
            const when = baseTime + i * interval;
            const delayMs = (offset + i * interval) * 1000;
            setTimeout(() => {
                this._tone(n.freq, n.dur || 0.15, n.type || 'sine', n.vol || 0.12, when).catch(() => {});
            }, Math.max(0, delayMs));
        });
    }

    // ==================== BGM 系统 ====================

    stopBGM() {
        if (this._bgmTimer) {
            clearTimeout(this._bgmTimer);
            this._bgmTimer = null;
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
        // 保留 _currentBGM 以便 toggleBGM 恢复播放
    }

    async _createBGMGain() {
        if (!(await this._ensureContext())) return null;
        if (!this._bgmGain) {
            this._bgmGain = this.ctx.createGain();
            this._bgmGain.gain.value = 0.08 * this.bgmVolume;
            this._bgmGain.connect(this.ctx.destination);
        }
        return this._bgmGain;
    }

    setBGMVolume(v) {
        this.bgmVolume = Math.max(0, Math.min(1, v));
        if (this._bgmGain) {
            this._bgmGain.gain.value = 0.08 * this.bgmVolume;
        }
    }

    setSFXVolume(v) {
        this.sfxVolume = Math.max(0, Math.min(1, v));
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
        osc.start(t);
        const stopTime = t + duration + 0.1;
        osc.stop(stopTime);
        
        const nodeRef = { osc, gain, stopTime };
        this._bgmNodes.push(nodeRef);
        
        // 播放结束后自动从列表中移除，防止内存泄漏
        osc.onended = () => {
            const idx = this._bgmNodes.indexOf(nodeRef);
            if (idx >= 0) this._bgmNodes.splice(idx, 1);
        };
    }

    async _playBGMSequence(notes, tempoBPM = 100, waveform = 'sine', loop = true) {
        if (!this.bgmEnabled) return;
        if (!(await this._ensureContext())) return;
        this.stopBGM();

        const beat = 60 / tempoBPM;
        let totalDuration = 0;
        notes.forEach(n => {
            const start = (n.beat || 0) * beat;
            const dur = (n.dur || 0.5) * beat;
            totalDuration = Math.max(totalDuration, start + dur);
            this._scheduleBGMNote(n.freq, start, dur, waveform, n.vol || 1);
        });

        if (loop && totalDuration > 0) {
            const gen = this._bgmGeneration;
            this._bgmTimer = setTimeout(() => {
                if (this._currentBGM && gen === this._bgmGeneration) {
                    this._playBGMSequence(notes, tempoBPM, waveform, true);
                }
            }, totalDuration * 1000 + 200);
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
            { freq: 523, beat: 0, dur: 0.3, vol: 1.0 },
            { freq: 659, beat: 0.5, dur: 0.3, vol: 0.9 },
            { freq: 784, beat: 1.0, dur: 0.3, vol: 1.0 },
            { freq: 1047, beat: 1.5, dur: 0.6, vol: 1.1 },
            { freq: 784, beat: 2.25, dur: 0.2, vol: 0.8 },
            { freq: 1047, beat: 2.5, dur: 0.8, vol: 1.2 },
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
        // 发牌：更丰富的快速连音
        this._sequence([
            { freq: 700, dur: 0.04 },
            { freq: 900, dur: 0.04 },
            { freq: 1100, dur: 0.05 },
            { freq: 800, dur: 0.03 },
        ], 0.035);
    }

    playCall() {
        // 叫分：庄重的双音
        this._tone(523, 0.15, 'sine', 0.13);
        setTimeout(() => this._tone(659, 0.2, 'sine', 0.13), 100);
    }

    playPass() {
        // 不出：低沉闷音
        this._tone(180, 0.18, 'triangle', 0.1);
        setTimeout(() => this._tone(150, 0.15, 'triangle', 0.08), 80);
    }

    playPlay() {
        // 出牌：轻快的滑动音
        this._tone(560, 0.07, 'sine', 0.1);
        setTimeout(() => this._tone(720, 0.09, 'sine', 0.1), 40);
    }

    playSingle() {
        this._tone(640, 0.07, 'sine', 0.1);
    }

    playPair() {
        this._tone(560, 0.07, 'sine', 0.1);
        setTimeout(() => this._tone(560, 0.07, 'sine', 0.1), 50);
    }

    playTriple() {
        this._sequence([
            { freq: 560, dur: 0.05 },
            { freq: 560, dur: 0.05 },
            { freq: 560, dur: 0.07 },
        ], 0.04);
    }

    async playStraight() {
        if (!(await this._ensureContext())) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(480, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(960, this.ctx.currentTime + 0.25);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.3);
    }

    playPlane() {
        this._sequence([
            { freq: 540, dur: 0.07 },
            { freq: 700, dur: 0.07 },
            { freq: 880, dur: 0.1 },
        ], 0.06);
    }

    playFourWithTwo() {
        this._tone(380, 0.13, 'triangle', 0.11);
        setTimeout(() => this._tone(640, 0.07, 'sine', 0.08), 110);
    }

    async playBomb() {
        if (!(await this._ensureContext())) return;
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
        gain.gain.setValueAtTime(0.45, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        noise.start();

        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(15, this.ctx.currentTime + duration);
        const oscGain = this.ctx.createGain();
        oscGain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        oscGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(oscGain);
        oscGain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    async playRocket() {
        if (!(await this._ensureContext())) return;
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(350, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1400, this.ctx.currentTime + 0.35);
        osc.frequency.exponentialRampToValueAtTime(180, this.ctx.currentTime + 0.9);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.22, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.9);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.9);
    }

    playWin() {
        // 胜利：更丰富的上行和弦
        this._sequence([
            { freq: 523, dur: 0.12 },
            { freq: 659, dur: 0.12 },
            { freq: 784, dur: 0.12 },
            { freq: 1047, dur: 0.35 },
        ], 0.12);
        setTimeout(() => {
            this._sequence([
                { freq: 784, dur: 0.08 },
                { freq: 1047, dur: 0.5, vol: 0.15 },
            ], 0.1);
        }, 550);
    }

    playLose() {
        this._sequence([
            { freq: 392, dur: 0.18, type: 'triangle' },
            { freq: 349, dur: 0.18, type: 'triangle' },
            { freq: 311, dur: 0.25, type: 'triangle' },
            { freq: 262, dur: 0.4, type: 'triangle' },
        ], 0.2);
    }

    playSpring() {
        // 春天：更清脆的铃铛声
        this._sequence([
            { freq: 880, dur: 0.08 },
            { freq: 1100, dur: 0.08 },
            { freq: 1320, dur: 0.1 },
            { freq: 1760, dur: 0.25, vol: 0.12 },
        ], 0.08);
    }

    // ==================== 全新音效 ====================

    playCardSelect() {
        // 选牌：清脆短高音
        this._tone(880, 0.04, 'sine', 0.08);
    }

    playCardDeselect() {
        // 取消选牌：略低的短音
        this._tone(660, 0.04, 'sine', 0.06);
    }

    playHint() {
        // 提示：双音提示
        this._tone(784, 0.08, 'sine', 0.09);
        setTimeout(() => this._tone(1047, 0.1, 'sine', 0.09), 80);
    }

    playAutoToggle(on) {
        // 托管切换：机械感
        if (on) {
            this._tone(440, 0.1, 'square', 0.06);
            setTimeout(() => this._tone(660, 0.12, 'square', 0.06), 100);
        } else {
            this._tone(660, 0.1, 'square', 0.06);
            setTimeout(() => this._tone(440, 0.12, 'square', 0.06), 100);
        }
    }

    playButtonClick() {
        // 按钮点击：短促木头感
        this._tone(1200, 0.03, 'sine', 0.07);
        setTimeout(() => this._tone(800, 0.04, 'sine', 0.05), 20);
    }

    playLandlordConfirm() {
        // 地主确认：庄重的和弦
        this._tone(392, 0.2, 'triangle', 0.1);
        setTimeout(() => this._tone(494, 0.2, 'triangle', 0.1), 120);
        setTimeout(() => this._tone(587, 0.3, 'triangle', 0.12), 240);
    }

    playBottomReveal() {
        // 底牌揭示：翻牌轻响
        this._sequence([
            { freq: 500, dur: 0.04 },
            { freq: 750, dur: 0.05 },
        ], 0.04);
    }

    playNewRound() {
        // 新一轮开始：提示音
        this._tone(523, 0.1, 'sine', 0.1);
        setTimeout(() => this._tone(659, 0.1, 'sine', 0.1), 100);
        setTimeout(() => this._tone(784, 0.15, 'sine', 0.12), 200);
    }

    playTurnAlert() {
        // 回合提醒：轻柔提示
        this._tone(659, 0.08, 'sine', 0.07);
        setTimeout(() => this._tone(784, 0.1, 'sine', 0.08), 120);
    }

    playChat() {
        // 聊天消息：短促消息音
        this._tone(900, 0.05, 'sine', 0.06);
    }

    playError() {
        // 错误/无效操作：不和谐低音
        this._tone(150, 0.15, 'sawtooth', 0.08);
        setTimeout(() => this._tone(120, 0.15, 'sawtooth', 0.08), 80);
    }

    playCountdown() {
        // 倒计时：滴答
        this._tone(1000, 0.04, 'sine', 0.06);
    }

    playScoreChange(positive) {
        // 分数变化：硬币声
        if (positive) {
            this._tone(1200, 0.06, 'sine', 0.08);
            setTimeout(() => this._tone(1600, 0.08, 'sine', 0.1), 50);
        } else {
            this._tone(600, 0.1, 'triangle', 0.08);
        }
    }

    playMatchEnd() {
        // 比赛结束：号角
        this._sequence([
            { freq: 523, dur: 0.2, vol: 0.12 },
            { freq: 659, dur: 0.2, vol: 0.12 },
            { freq: 784, dur: 0.3, vol: 0.14 },
        ], 0.2);
    }

    playGrabLandlord() {
        // 抢地主：紧张感
        this._tone(440, 0.1, 'square', 0.07);
        setTimeout(() => this._tone(550, 0.1, 'square', 0.08), 80);
        setTimeout(() => this._tone(660, 0.15, 'square', 0.09), 160);
    }

    playPassTurn() {
        // 过牌（轮到下一家）：轻柔滑音
        this._tone(400, 0.08, 'sine', 0.06);
        setTimeout(() => this._tone(350, 0.1, 'sine', 0.05), 60);
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
            this.stopBGM();
        } else if (this._currentBGM === 'menu') {
            this.playMenuBGM();
        } else if (this._currentBGM === 'game') {
            this.playGameBGM();
        }
        return this.bgmEnabled;
    }

    toggleSFX() {
        this.sfxEnabled = !this.sfxEnabled;
        return this.sfxEnabled;
    }
}

export { AudioManager };

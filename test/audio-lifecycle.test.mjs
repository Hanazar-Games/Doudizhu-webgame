import assert from 'node:assert/strict';
import { test } from 'node:test';

global.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
global.localStorage = { getItem: () => null };
const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
class AudioContextStub {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sources = 0; }
    createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
    createDynamicsCompressor() { return { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect() {}, disconnect() {} }; }
    createOscillator() { this.sources++; return { frequency: param(), connect() {}, disconnect() {}, start() {}, stop() {} }; }
    close() { this.state = 'closed'; }
}
global.window = { AudioContext: AudioContextStub };
const { AudioManager } = await import('../src/ui/audio.js');

await test('first BGM starts when it creates the audio context', async () => {
    const audio = new AudioManager();
    try {
        await audio._playBGMSequence([{ freq: 440, dur: 1 }], 100, 'sine', false);
        for (let i = 0; i < 4; i++) await Promise.resolve();
        assert.equal(audio.ctx.sources, 1);
    } finally { audio.destroy(); }
});

await test('a pending sound does not resume after a quick mute and unmute', async () => {
    const audio = new AudioManager();
    const ctx = new AudioContextStub();
    audio.ctx = ctx;
    ctx.state = 'suspended';
    let resume;
    ctx.resume = () => new Promise(resolve => { resume = () => { ctx.state = 'running'; resolve(); }; });
    try {
        const sound = audio._tone(440, 1);
        audio.setSFXEnabled(false);
        audio.setSFXEnabled(true);
        resume();
        await sound;
        assert.equal(ctx.sources, 0);
    } finally { audio.destroy(); }
});

await test('destroying audio while resume is pending does not throw', async () => {
    const audio = new AudioManager();
    const ctx = new AudioContextStub();
    audio.ctx = ctx;
    ctx.state = 'suspended';
    let resume;
    ctx.resume = () => new Promise(resolve => { resume = resolve; });
    const sound = audio._tone(440, 1);
    audio.destroy();
    resume();
    await assert.doesNotReject(sound);
});

await test('a queued note sequence is discarded when its round is cleared', async () => {
    const audio = new AudioManager();
    const ctx = new AudioContextStub();
    audio.ctx = ctx;
    ctx.state = 'suspended';
    let resume;
    ctx.resume = () => new Promise(resolve => { resume = () => { ctx.state = 'running'; resolve(); }; });
    try {
        const sound = audio._sequence([{ freq: 440, dur: 1 }]);
        audio._clearPendingSfx();
        resume();
        await sound;
        for (let i = 0; i < 4; i++) await Promise.resolve();
        assert.equal(ctx.sources, 0);
    } finally { audio.destroy(); }
});

await test('manually stopped BGM stays stopped after hiding and showing the page', async () => {
    const audio = new AudioManager();
    let restarts = 0;
    audio._currentBGM = 'game';
    audio.playGameBGM = () => { restarts++; };
    audio.stopBGM();
    document.hidden = true;
    audio._visHandler();
    document.hidden = false;
    audio._visHandler();
    assert.equal(restarts, 0);
    audio.destroy();
});

await test('zero SFX volume cancels queued and active sounds', async () => {
    const audio = new AudioManager();
    audio.ctx = new AudioContextStub();
    try {
        await audio._tone(440, 1);
        audio._setSfxTimeout(() => {}, 10000);
        audio.setSFXVolume(0);
        assert.equal(audio._sfxNodes.size, 0);
        assert.equal(audio._sfxTimeouts.size, 0);
    } finally { audio.destroy(); }
});

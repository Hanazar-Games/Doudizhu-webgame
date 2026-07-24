/**
 * AudioManager state tests (Node.js DOM stubs)
 */

global.localStorage = global.localStorage || {
    _store: new Map(),
    getItem(k) { return this._store.has(k) ? this._store.get(k) : null; },
    setItem(k, v) { this._store.set(k, String(v)); },
    removeItem(k) { this._store.delete(k); },
    clear() { this._store.clear(); },
};

let visibilityHandler = null;
global.document = {
    hidden: false,
    addEventListener(type, handler) {
        if (type === 'visibilitychange') visibilityHandler = handler;
    },
    removeEventListener(type, handler) {
        if (type === 'visibilitychange' && visibilityHandler === handler) visibilityHandler = null;
    },
};

let passed = 0, failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`✓ ${name}`);
    } catch (e) {
        failed++;
        console.log(`✗ ${name}`);
        console.log(`  ${e.message}`);
    }
}

async function testAsync(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`✓ ${name}`);
    } catch (e) {
        failed++;
        console.log(`✗ ${name}`);
        console.log(`  ${e.message}`);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'Assertion failed');
}

const { AudioManager } = await import('../src/ui/audio.js');

test('AudioManager restores menu BGM after page visibility resumes', () => {
    const audio = new AudioManager();
    let menuRestarts = 0;
    audio.playMenuBGM = () => {
        menuRestarts++;
        audio._currentBGM = 'menu';
    };
    audio._currentBGM = 'menu';

    document.hidden = true;
    visibilityHandler();
    assert(audio._wasPlayingBGM === true, 'expected menu BGM to be marked for resume');
    assert(audio._currentBGM === 'menu', 'expected current BGM type to be preserved');

    document.hidden = false;
    visibilityHandler();
    assert(menuRestarts === 1, 'expected menu BGM to restart once');
    assert(audio._wasPlayingBGM === false, 'expected resume flag to clear');
    audio.destroy();
});

test('AudioManager restores game BGM after page visibility resumes', () => {
    const audio = new AudioManager();
    let gameRestarts = 0;
    audio.playGameBGM = () => {
        gameRestarts++;
        audio._currentBGM = 'game';
    };
    audio._currentBGM = 'game';

    document.hidden = true;
    visibilityHandler();
    document.hidden = false;
    visibilityHandler();

    assert(gameRestarts === 1, 'expected game BGM to restart once');
    audio.destroy();
});

test('AudioManager does not replay one-shot result BGM after visibility resumes', () => {
    const audio = new AudioManager();
    let winRestarts = 0;
    audio.playWinBGM = () => {
        winRestarts++;
        audio._currentBGM = 'win';
    };
    audio._currentBGM = 'win';

    document.hidden = true;
    visibilityHandler();
    document.hidden = false;
    visibilityHandler();

    assert(winRestarts === 0, 'expected win BGM not to replay');
    assert(audio._wasPlayingBGM === false, 'expected one-shot BGM not to set resume flag');
    audio.destroy();
});

test('AudioManager sound toggle resumes looping BGM only', () => {
    const audio = new AudioManager();
    let menuRestarts = 0;
    audio.playMenuBGM = () => {
        menuRestarts++;
        audio._currentBGM = 'menu';
    };
    audio._currentBGM = 'menu';

    assert(audio.toggle() === false, 'expected toggle to disable audio');
    assert(audio.toggle() === true, 'expected toggle to enable audio');
    assert(menuRestarts === 1, 'expected menu BGM to resume once');

    let winRestarts = 0;
    audio.playWinBGM = () => {
        winRestarts++;
        audio._currentBGM = 'win';
    };
    audio._currentBGM = 'win';
    assert(audio.toggle() === false, 'expected second disable');
    assert(audio.toggle() === true, 'expected second enable');
    assert(winRestarts === 0, 'expected one-shot win BGM not to resume');
    audio.destroy();
});

await testAsync('AudioManager drops stale notes after an async BGM switch', async () => {
    const audio = new AudioManager();
    let resolveMaster;
    let oscillatorsCreated = 0;
    audio.ctx = {
        state: 'running',
        currentTime: 0,
        createOscillator() {
            oscillatorsCreated++;
            throw new Error('stale note should not create an oscillator');
        },
        close() {},
    };
    audio._createBGMGain = () => new Promise(resolve => { resolveMaster = resolve; });
    audio._bgmGeneration = 7;
    const staleSchedule = audio._scheduleBGMNote(440, 0, 0.2, 'sine', 1, 7);
    audio._bgmGeneration = 8;
    resolveMaster({});
    await staleSchedule;
    assert(oscillatorsCreated === 0, 'stale BGM generation created an oscillator');
    audio.destroy();
});

await testAsync('AudioManager stopping BGM does not cancel delayed SFX notes', async () => {
    const audio = new AudioManager();
    const tones = [];
    audio._tone = (freq) => tones.push(freq);

    audio.playCall();
    audio.stopBGM();
    await new Promise(resolve => setTimeout(resolve, 130));

    assert(tones.join(',') === '523,659', `expected complete call SFX, got ${tones.join(',')}`);
    audio.destroy();
});

test('AudioManager keeps the shared audio route connected during BGM fade-out', () => {
    const audio = new AudioManager();
    let bgmDisconnects = 0;
    let compressorDisconnects = 0;
    const compressor = { disconnect() { compressorDisconnects++; } };
    audio.ctx = { state: 'running', currentTime: 2, close() {} };
    audio._bgmGain = {
        gain: {
            value: 0.04,
            cancelScheduledValues() {},
            setValueAtTime() {},
            exponentialRampToValueAtTime() {},
        },
        disconnect() { bgmDisconnects++; },
    };
    audio._masterCompressor = compressor;

    audio.stopBGM();

    assert(bgmDisconnects === 0, 'BGM gain disconnected before fade-out completed');
    assert(compressorDisconnects === 0, 'shared compressor disconnected while audio may still be playing');
    assert(audio._masterCompressor === compressor, 'shared compressor reference should be retained');
    audio.destroy();
});

await testAsync('AudioManager releases completed SFX timers', async () => {
    const audio = new AudioManager();
    audio._tone = () => {};

    audio.playHint();
    assert(audio._sfxTimeouts.size === 1, 'expected one pending SFX timer');
    await new Promise(resolve => setTimeout(resolve, 110));

    const pending = audio._sfxTimeouts.size;
    audio.destroy();
    assert(pending === 0, `completed SFX timer remained tracked: ${pending}`);
});

test('AudioManager event sounds respect their fine-grained category switches', () => {
    const audio = new AudioManager();
    let tones = 0;
    let sequences = 0;
    audio._tone = () => { tones++; };
    audio._sequence = () => { sequences++; };
    audio._sfxSettings = {
        deal: false,
        play: true,
        call: false,
        bomb: false,
        win: false,
        tick: false,
        chat: true,
    };

    audio.playBottomReveal();
    audio.playLandlordConfirm();
    audio.playMatchEnd();
    audio.playGrabLandlord();
    audio.playCountdown();

    audio.destroy();
    assert(tones === 0 && sequences === 0, `disabled categories still played: tones=${tones}, sequences=${sequences}`);
});

await testAsync('AudioManager rocket sound respects the bomb category switch', async () => {
    const audio = new AudioManager();
    let contextAttempts = 0;
    audio._sfxSettings.bomb = false;
    audio._sfxSettings.play = true;
    audio._ensureContext = async () => {
        contextAttempts++;
        return false;
    };

    await audio.playRocket();

    audio.destroy();
    assert(contextAttempts === 0, `disabled bomb category still initialized audio: ${contextAttempts}`);
});

test('AudioManager does not schedule delayed call or win notes while SFX is disabled', () => {
    const audio = new AudioManager();
    audio.sfxEnabled = false;
    audio._tone = () => {};
    audio._sequence = () => {};

    audio.playCall();
    audio.playWin();

    const pending = { call: audio._callTimeout, win: audio._winSfxTimeout };
    audio.destroy();
    assert(pending.call === null && pending.win === null, `disabled SFX scheduled delayed notes: ${JSON.stringify(pending)}`);
});

await testAsync('AudioManager cancels queued SFX when toggled off', async () => {
    const audio = new AudioManager();
    const tones = [];
    audio._tone = freq => tones.push(freq);

    audio.playHint();
    audio.toggleSFX();
    audio.toggleSFX();
    await new Promise(resolve => setTimeout(resolve, 110));

    audio.destroy();
    assert(tones.join(',') === '784', `queued SFX leaked after a quick toggle: ${tones.join(',')}`);
});

await testAsync('AudioManager cancels queued SFX when master sound is toggled off', async () => {
    const audio = new AudioManager();
    const tones = [];
    audio._tone = freq => tones.push(freq);

    audio.playHint();
    audio.toggle();
    audio.toggle();
    await new Promise(resolve => setTimeout(resolve, 110));

    audio.destroy();
    assert(tones.join(',') === '784', `queued SFX leaked through master mute: ${tones.join(',')}`);
});

await testAsync('AudioManager delayed call note rechecks its category switch', async () => {
    const audio = new AudioManager();
    const tones = [];
    audio._tone = freq => tones.push(freq);

    audio.playCall();
    audio._sfxSettings.call = false;
    await new Promise(resolve => setTimeout(resolve, 130));

    audio.destroy();
    assert(tones.join(',') === '523', `call tail ignored category change: ${tones.join(',')}`);
});

await testAsync('AudioManager stops already scheduled Web Audio SFX when muted', async () => {
    const audio = new AudioManager();
    let stopCalls = 0;
    const param = {
        setValueAtTime() {},
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
    };
    const osc = {
        frequency: param,
        connect() {},
        disconnect() {},
        start() {},
        stop() { stopCalls++; },
        onended: null,
    };
    const gain = { gain: param, connect() {}, disconnect() {} };
    audio.ctx = {
        state: 'running',
        currentTime: 1,
        createOscillator: () => osc,
        createGain: () => gain,
        close() {},
    };
    audio._masterCompressor = { connect() {} };

    await audio._tone(440, 0.5, 'sine', 0.1, 2);
    assert(audio._sfxNodes?.size === 1, 'scheduled SFX source was not tracked');

    audio.setSFXEnabled(false);
    assert(audio._sfxNodes.size === 0, 'muted SFX source remained tracked');
    assert(stopCalls >= 2, `scheduled SFX source was not stopped immediately: ${stopCalls}`);
    audio.destroy();
});

console.log(`\n====================`);
console.log(`AudioManager: Passed ${passed}, Failed ${failed}`);
console.log(`====================`);
process.exit(failed > 0 ? 1 : 0);

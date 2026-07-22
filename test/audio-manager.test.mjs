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

console.log(`\n====================`);
console.log(`AudioManager: Passed ${passed}, Failed ${failed}`);
console.log(`====================`);
process.exit(failed > 0 ? 1 : 0);

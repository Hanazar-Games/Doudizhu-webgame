import assert from 'node:assert/strict';

export async function testInterfaceEdges(page) {
    await page.evaluate(async () => {
        const app = window.gameApp;
        app.showMenu();
        await app.startCustomMode();
        document.getElementById('cfg-sound').checked = false;
        document.getElementById('btn-custom-start').click();
    });
    await page.waitForFunction(() => !!window.gameApp.renderer);
    const muted = await page.evaluate(() => {
        const app = window.gameApp;
        app._playButtonClick();
        return app.renderer.audio.enabled;
    });
    assert.equal(muted, false, 'custom mute must survive settings synchronization');
    const toggle = await page.evaluate(() => {
        const app = window.gameApp;
        const original = app.settings.soundEnabled;
        app.toggleSound();
        app.toggleSound();
        return { global: app.settings.soundEnabled === original, local: app.renderer.audio.enabled };
    });
    assert.deepEqual(toggle, { global: true, local: false });
    await page.evaluate(() => {
        window.gameApp.currentMode.destroy();
        const renderer = window.gameApp.renderer;
        renderer.showCallControls(0);
        renderer.hideCallControls();
        renderer.showCallControls(0);
    });
    await page.waitForTimeout(300);
    assert(await page.locator('#call-controls').isVisible(), 'a stale hide timer must not hide new call controls');
    await page.evaluate(() => {
        const mode = window.gameApp.currentMode;
        mode.destroy();
        mode.gameState.phase = 'PLAYING';
        mode.gameState.currentTurn = mode.humanIndex;
        const renderer = mode.renderer;
        renderer.showPlayControls(mode.humanIndex, null);
        renderer.hidePlayControls();
        renderer.showPlayControls(mode.humanIndex, null);
    });
    await page.waitForTimeout(300);
    assert(await page.locator('#play-controls').isVisible(), 'a stale hide timer must not hide new play controls');
    await page.evaluate(() => {
        const mode = window.gameApp.currentMode;
        mode.isRunning = true;
        mode.triggerAutoIfNeeded = () => {};
        mode.renderer._toggleAuto();
    });
    await page.waitForTimeout(300);
    assert(await page.locator('#btn-cancel-auto').isVisible(), 'auto mode must retain a visible way to take control');
    await page.click('#btn-cancel-auto');
    assert(await page.locator('#play-controls').isVisible(), 'cancelling auto must restore controls immediately');
    await page.evaluate(() => window.gameApp.openSettings());
    await page.waitForTimeout(350);
    await page.locator('#btn-close-settings').focus();
    await page.keyboard.press('1');
    assert.equal(await page.evaluate(() => window.gameApp.renderer.selectedCards.size), 0, 'settings must block card shortcuts');
    await page.keyboard.press('Escape');
    const music = await page.evaluate(() => {
        const app = window.gameApp;
        app.currentMode.customConfig.soundEnabled = true;
        app.menuAudio._currentBGM = 'menu';
        app.renderer.audio._currentBGM = 'game';
        app.settings.soundEnabled = true;
        app.toggleSound();
        app.toggleSound();
        return { menu: app.menuAudio._bgmActive, game: app.renderer.audio._bgmActive };
    });
    assert.deepEqual(music, { menu: false, game: true }, 'unmuting in a game must not restart menu music');
    const pausedMusic = await page.evaluate(() => {
        const app = window.gameApp;
        app.renderer._pauseGame();
        app.toggleSound();
        app.toggleSound();
        const control = document.querySelector('[data-setting="bgmEnabled"]');
        for (const enabled of [false, true]) {
            control.checked = enabled;
            control.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return { menu: app.menuAudio._bgmActive, game: app.renderer.audio._bgmActive };
    });
    assert.deepEqual(pausedMusic, { menu: false, game: false }, 'sound settings must preserve paused music');
    await page.evaluate(() => window.gameApp.showMenu());
    console.log('  ✓ Custom mute, scene music, auto cancellation, modal shortcuts and control-panel transitions remain consistent');
}

export async function testLANLobbyEdges(page) {
    await page.route('**/api/lan-info', async route => {
        await new Promise(resolve => setTimeout(resolve, 700));
        await route.fulfill({ json: { urls: ['http://localhost:3001'] } });
    });
    try {
        await page.evaluate(async () => {
            const app = window.gameApp;
            app.showMenu();
            await app.startLANMode();
            const mode = app.currentMode;
            mode.createRoom = async () => { mode._roomReady = true; return 'fast-room'; };
            document.querySelector('.lan-tab[data-tab="host"]').click();
            document.getElementById('btn-lan-host').click();
        });
        await page.waitForTimeout(850);
        assert(await page.locator('#room-info').isVisible(), 'lobby initialization must not hide a newly created room');
        assert(await page.locator('#btn-lan-start').isVisible());
        assert.match(await page.locator('#lan-status').textContent(), /等待玩家加入/);
        await page.evaluate(() => { window.gameApp.currentMode.joinRoom = async () => { throw new Error('Test connection unavailable'); }; });
        await page.click('.lan-tab[data-tab="join"]');
        await page.fill('#lan-room-id', 'test-room');
        await page.click('#btn-lan-join');
        assert.match(await page.locator('#lan-message').textContent(), /Test connection unavailable/);
        assert(await page.locator('#lan-message').isVisible(), 'join failures must be visible in the join tab');
        console.log('  ✓ Fast room creation and join errors remain visible');
    } finally {
        await page.unroute('**/api/lan-info');
        await page.evaluate(() => window.gameApp.showMenu());
    }
}

export async function testEndgameLayout(page) {
    const viewport = page.viewportSize();
    try {
        await page.evaluate(() => window.gameApp.startEndgameMode(0));
        await page.waitForTimeout(1200);
        for (const [width, height] of [[1280, 800], [844, 390], [667, 375]]) {
            await page.setViewportSize({ width, height });
            await page.waitForTimeout(350);
            const bounds = await page.evaluate(() => {
                const rect = selector => {
                    const r = document.querySelector(selector).getBoundingClientRect();
                    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height };
                };
                return { clock: rect('#center-countdown'), title: rect('.endgame-info-title'), goal: rect('.endgame-info-obj'),
                    hint: rect('.endgame-info-hint-btn'), controls: rect('#play-controls'), info: rect('#game-info'), hand: rect('#player-right .hand-front .card') };
            });
            const overlaps = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
            assert(!overlaps(bounds.clock, bounds.title) && !overlaps(bounds.clock, bounds.goal), `endgame countdown overlaps instructions at ${width}x${height}`);
            assert(bounds.hint.height >= 44, 'endgame hint must have a 44px touch target');
            assert(bounds.controls.bottom <= bounds.hand.top + 2, `endgame controls overlap hand at ${width}x${height}`);
            assert(bounds.info.bottom <= bounds.hand.top + 2, `endgame status overlaps hand at ${width}x${height}`);
            await page.click('.endgame-info-hint-btn');
            assert.match(await page.locator('.toast-message').last().textContent(), /直接出顺子/);
        }
        console.log('  ✓ Endgame instructions, countdown, hint target and hand stay separate at desktop and mobile sizes');
    } finally {
        await page.evaluate(() => window.gameApp.showMenu());
        if (viewport) await page.setViewportSize(viewport);
    }
}

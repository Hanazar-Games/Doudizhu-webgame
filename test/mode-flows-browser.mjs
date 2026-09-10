import assert from 'node:assert/strict';

async function openGame(browser, url, collector) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    collector.attach(page);
    await page.goto(url);
    await page.waitForFunction(() => !!window.gameApp);
    await page.evaluate(() => {
        const app = window.gameApp;
        app.closeChangelog();
        document.getElementById('welcome-guide-overlay')?.remove();
        Object.assign(app.settings, { timerEnabled: false, aiThinkTime: 200, gameSpeed: 5, difficulty: 'normal', firstPlayer: 'random' });
        localStorage.setItem('ddz_settings', JSON.stringify(app.settings));
    });
    return page;
}

export async function testModeFlows(browser, url, collector) {
    const page = await openGame(browser, url, collector);
    try {
        const modes = [
            ['ai', 0], ['daily', 0], ['custom', 0], ['tournament', 0],
            ...Array.from({ length: 5 }, (_, i) => ['endgame', i]),
            ...Array.from({ length: 10 }, (_, i) => ['challenge', i + 1]),
        ];
        for (const [name, level] of modes) {
            const previousStats = await page.evaluate(() => ({ ...window.gameApp.stats }));
            await page.evaluate(async ({ name, level }) => {
                const app = window.gameApp;
                app.showMenu();
                if (name === 'ai') await app.startAIMode();
                if (name === 'daily') await app.startDailyMode();
                if (name === 'tournament') await app.startTournament();
                if (name === 'endgame') { app.showEndgameLevels(); await app.startEndgameMode(level); }
                if (name === 'challenge') { app.showChallengeLevels(); await app.startChallengeMode(level); }
                if (name === 'custom') {
                    await app.startCustomMode();
                    document.getElementById('cfg-ai-diff').value = 'hard';
                    document.getElementById('btn-custom-start').click();
                }
            }, { name, level });
            await page.waitForTimeout(450);
            const initial = await page.evaluate(() => {
                const app = window.gameApp;
                return {
                    screens: [...document.querySelectorAll('.screen:not(.hidden)')].map(el => el.id),
                    phase: app.currentMode?.gameState.phase,
                    hand: app.currentMode?.gameState.players[app.currentMode.humanIndex]?.hand.length,
                };
            });
            assert.deepEqual(initial.screens, ['game-screen'], `${name} ${level}: screen switch`);
            assert(initial.hand > 0, `${name} ${level}: missing human hand`);
            await page.evaluate(() => {
                const mode = window.gameApp.currentMode;
                window.__resultSounds = [];
                for (const method of ['playWin', 'playLose']) {
                    const original = mode.renderer.audio[method].bind(mode.renderer.audio);
                    mode.renderer.audio[method] = (...args) => { window.__resultSounds.push(method); return original(...args); };
                }
                // Exercise real decisions and state transitions with only thinking delays shortened.
                mode._delay = () => new Promise(resolve => setTimeout(resolve, 5));
                mode.gameState.players.forEach(player => { player.isAuto = true; });
                mode.triggerAutoIfNeeded();
                if (mode.gameState.phase === 'CALLING') mode._processCalling();
                else mode._processPlay();
            });
            await page.waitForFunction(() => window.gameApp.currentMode?.gameState.phase === 'ENDED', { timeout: 30000 });
            await page.waitForTimeout(['endgame', 'daily', 'challenge'].includes(name) ? 2200 : 750);
            const result = await page.evaluate(() => {
                const app = window.gameApp;
                const gs = app.currentMode.gameState;
                const full = JSON.parse(localStorage.getItem('ddz_full_games') || '[]')[0];
                return {
                    scores: gs.scores, history: gs.history.length,
                    ended: gs.players.some(player => player.hand.length === 0),
                    saved: full?.mode, handCount: full?.initialHands?.reduce((n, h) => n + h.length, 0),
                    bgm: app.renderer.audio._currentBGM,
                    modalCount: [...document.querySelectorAll('#modal-overlay:not(.hidden), #challenge-result-overlay:not(.hidden)')].length,
                    stats: app.stats,
                    roundScore: full?.result.scores[app.currentMode.humanIndex],
                    resultSounds: window.__resultSounds,
                };
            });
            assert(result.ended && result.history > 0, `${name} ${level}: incomplete game`);
            assert.equal(result.scores.reduce((a, b) => a + b, 0), 0);
            assert.equal(result.saved, name, `${name} ${level}: missing saved game`);
            assert.equal(result.stats.gamesPlayed - previousStats.gamesPlayed, 1);
            assert.equal(result.stats.totalScore - previousStats.totalScore, result.roundScore);
            assert.equal(result.modalCount, 1, `${name} ${level}: missing or duplicate settlement`);
            assert.equal(result.resultSounds.length, 1, `${name} ${level}: duplicated settlement sound`);
            assert.equal(result.bgm, result.resultSounds[0] === 'playWin' ? 'win' : 'lose', `${name} ${level}: BGM disagrees with result sound`);
            if (name === 'endgame') assert(await page.locator('#btn-endgame-retry').isVisible());
            assert.notEqual(result.bgm, 'game', `${name} ${level}: gameplay BGM survived settlement`);
            console.log(`  ✓ ${name} ${level}: real game completed and saved (${result.history} actions)`);
            if (name === 'ai') {
                const code = await page.evaluate(async () => {
                    const { encodeShareCode } = await import('/src/utils/replay-workshop.js');
                    return encodeShareCode(JSON.parse(localStorage.getItem('ddz_full_games'))[0]);
                });
                assert(code, 'a full game must fit in a workshop share code');
                await page.evaluate(() => window.gameApp.showWorkshop());
                await page.fill('#workshop-import-input', code);
                await page.click('#btn-workshop-import');
                await page.locator('.btn-workshop-play').first().click();
                assert.equal(await page.locator('.replay-player.landlord .replay-card-count').textContent(), '20张');
                const winner = await page.evaluate(() => {
                    const replay = window.gameApp._replayManager;
                    replay.goToStep(replay.currentGame.history.length - 1);
                    return replay.currentGame.result.winnerIndex;
                });
                assert.equal(await page.locator('.replay-card-count').nth(winner).textContent(), '0张');
                console.log('  ✓ Full game exported, imported and replayed from 20-card landlord hand to winning move');
            }
        }
        await page.evaluate(() => window.gameApp.showMenu());
        await page.waitForTimeout(500);
        assert.equal(await page.locator('#game-screen').isVisible(), false);
    } finally { await page.close(); }
}

export async function testLANBrowserFlow(browser, url, collector) {
    const pages = [];
    const snapshots = [];
    try {
        for (let i = 0; i < 3; i++) {
            const page = await openGame(browser, url, collector);
            page.on('websocket', socket => socket.on('framereceived', frame => {
                const msg = JSON.parse(String(frame.payload));
                if (msg.type === 'game_state_sync') snapshots.push({ seat: i, ...msg });
            }));
            pages.push(page);
            await page.click('#btn-lan-mode');
            await page.fill('#lan-player-name', `联机测试${i}`);
        }
        await pages[0].click('.lan-tab[data-tab="host"]');
        await pages[0].fill('#lan-player-name', '联机测试0');
        await pages[1].fill('#lan-room-id', 'missing-room');
        await pages[1].click('#btn-lan-join');
        await pages[1].waitForFunction(() => document.getElementById('lan-status').textContent.includes('不存在'));
        assert.equal(await pages[1].evaluate(() => window.gameApp.currentMode._roomReady), false);
        await pages[0].click('#btn-lan-host');
        await pages[0].waitForFunction(() => window.gameApp.currentMode._roomReady);
        await pages[0].waitForFunction(() => document.getElementById('player-list').textContent.includes('联机测试0'));
        const roomId = await pages[0].locator('#room-id-display').textContent();
        for (const page of pages.slice(1)) {
            await page.fill('#lan-room-id', roomId);
            await page.click('#btn-lan-join');
            await page.waitForFunction(() => window.gameApp.currentMode._roomReady);
        }
        await pages[0].waitForFunction(() => window.gameApp.currentMode.gameState.players.filter(Boolean).length === 3);
        await pages[0].click('#btn-lan-start');
        await Promise.all(pages.map(page => page.waitForFunction(() => window.gameApp.currentMode.gameState.phase === 'CALLING')));

        const gameId = await pages[0].evaluate(() => window.gameApp.currentMode._gameId);
        let reconnected = false;
        for (let step = 0; step < 300; step++) {
            const state = await pages[0].evaluate(() => {
                const gs = window.gameApp.currentMode.gameState;
                return { phase: gs.phase, turn: gs.currentTurn, history: gs.history.length };
            });
            if (state.phase === 'ENDED') break;
            const current = pages[state.turn];
            await current.waitForFunction(({ phase, turn }) => {
                const gs = window.gameApp.currentMode.gameState;
                return gs.phase === phase && gs.currentTurn === turn;
            }, state);
            await current.evaluate(async () => {
                const mode = window.gameApp.currentMode;
                if (mode.gameState.phase === 'CALLING') return mode.humanCall(0);
                const { AIPlayer } = await import('/src/players/ai-player.js');
                const ai = new AIPlayer('test');
                ai.hand = mode.gameState.players[mode.humanIndex].hand;
                ai.index = mode.humanIndex;
                const cards = await ai.decidePlay(mode.gameState, mode.gameState.lastPlay.pattern);
                const result = cards.length ? mode.humanPlay(cards) : { success: mode.humanPass() };
                if (!result.success) throw new Error(`LAN action rejected: ${result.error}`);
            });
            await pages[0].waitForFunction(previous => {
                const gs = window.gameApp.currentMode.gameState;
                return gs.phase !== previous.phase || gs.currentTurn !== previous.turn || gs.history.length > previous.history;
            }, state);
            if (step === 6) {
                const revision = await pages[1].evaluate(() => {
                    const mode = window.gameApp.currentMode;
                    const revision = mode._receivedRevision;
                    mode.ws.close();
                    return revision;
                });
                await pages[1].waitForFunction(revision => {
                    const mode = window.gameApp.currentMode;
                    return mode.networkReady && mode._receivedRevision > revision;
                }, revision, { timeout: 10000 });
                reconnected = true;
            }
        }
        await Promise.all(pages.map(page => page.waitForFunction(() => window.gameApp.currentMode.gameState.phase === 'ENDED')));
        const results = await Promise.all(pages.map(page => page.evaluate(() => ({
            scores: window.gameApp.currentMode.gameState.scores,
            history: window.gameApp.currentMode.gameState.history.length,
            saved: JSON.parse(localStorage.getItem('ddz_full_games') || '[]').length,
        }))));
        assert.deepEqual(results[1], results[0]);
        assert.deepEqual(results[2], results[0]);
        assert.equal(results[0].saved, 1);
        const duplicate = snapshots.filter(msg => msg.seat === 1 && msg.data.phase === 'ENDED').at(-1);
        assert(duplicate);
        const unchanged = await pages[1].evaluate(data => {
            const app = window.gameApp;
            const before = app.stats.gamesPlayed;
            app.currentMode._applySync(data);
            app.currentMode._applySync({ ...data, revision: data.revision + 1 });
            return { games: app.stats.gamesPlayed - before, saved: JSON.parse(localStorage.getItem('ddz_full_games')).length };
        }, duplicate.data);
        assert.deepEqual(unchanged, { games: 0, saved: 1 });
        assert(reconnected);
        assert(snapshots.length > 0);
        for (const msg of snapshots.filter(msg => msg.data.phase !== 'ENDED')) {
            assert.equal(msg.data.initialHands, undefined);
            assert.equal(msg.data.initialBottom, undefined);
            assert.equal(msg.data.deck, undefined);
            assert(msg.data.ownHand);
        }
        await pages[0].evaluate(() => window.gameApp.currentMode.startGame());
        await Promise.all(pages.map(page => page.waitForFunction(() => window.gameApp.currentMode.gameState.phase === 'CALLING')));
        assert.notEqual(await pages[0].evaluate(() => window.gameApp.currentMode._gameId), gameId);
        console.log('  ✓ Three browsers completed a private LAN game, reconnected, saved once and started another round');
    } finally {
        await Promise.all(pages.map(page => page.close()));
    }
}

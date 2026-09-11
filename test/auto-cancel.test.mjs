import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BaseMode } from '../src/modes/base-mode.js';
import { AIPlayer } from '../src/players/ai-player.js';
import { PHASE } from '../src/core/game-state.js';

global.window = { location: { protocol: 'http:', host: 'localhost' } };
global.localStorage = { getItem: () => null };
const { LANMode } = await import('../src/modes/lan-mode.js');

for (const [Mode, method, phase, decision] of [
    [BaseMode, '_processCalling', PHASE.CALLING, 'decideCall'],
    [BaseMode, '_processPlay', PHASE.PLAYING, 'decidePlay'],
    [BaseMode, '_autoPlayForHuman', PHASE.PLAYING, 'decidePlay'],
    [LANMode, 'triggerAutoIfNeeded', PHASE.CALLING, 'decideCall'],
    [LANMode, 'triggerAutoIfNeeded', PHASE.PLAYING, 'decidePlay'],
]) {
    await test(`${Mode.name}.${method} discards a decision after auto is cancelled (${phase})`, async () => {
        const mode = new Mode('test');
        const original = AIPlayer.prototype[decision];
        let release;
        let acted = false;
        mode.isRunning = true;
        mode.gameState.phase = phase;
        mode.gameState.currentTurn = mode.humanIndex = 0;
        mode.gameState.players[0] = { isAuto: true, hand: [], index: 0 };
        mode._delay = async () => {};
        mode._startCountdown = () => {};
        const action = () => { acted = true; mode.isRunning = false; return true; };
        mode.gameState.callLandlord = mode.gameState.pass = action;
        mode.humanCall = mode.humanPass = action;
        AIPlayer.prototype[decision] = () => new Promise(resolve => { release = resolve; });
        try {
            const pending = mode[method](0);
            while (!release) await Promise.resolve();
            mode.gameState.players[0].isAuto = false;
            release(decision === 'decideCall' ? 0 : []);
            await pending;
            assert.equal(acted, false);
        } finally {
            AIPlayer.prototype[decision] = original;
            mode.destroy();
        }
    });
}

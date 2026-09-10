import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Card } from '../src/core/card.js';
import { Rules, HandPattern, HAND_TYPE } from '../src/core/rules.js';
import { GameState, PHASE } from '../src/core/game-state.js';
import { Player } from '../src/players/player.js';
import { AIPlayer } from '../src/players/ai-player.js';
import { Renderer } from '../src/ui/renderer.js';
import { ChallengeMode } from '../src/modes/challenge-mode.js';
import { EndgameMode } from '../src/modes/endgame-mode.js';
import { TournamentMode } from '../src/modes/tournament-mode.js';
import { CustomMode } from '../src/modes/custom-mode.js';
import { AIMode } from '../src/modes/ai-mode.js';
import { Storage } from '../src/utils/storage.js';
import { ReplayWorkshop, encodeShareCode } from '../src/utils/replay-workshop.js';
import { getTodayString } from '../src/utils/daily-challenge.js';
import { SeasonQuestManager, QUEST_TYPE, getWeekStartString } from '../src/utils/season-quest.js';

global.localStorage = {
    data: new Map(),
    getItem(key) { return this.data.get(key) ?? null; },
    setItem(key, value) { this.data.set(key, String(value)); },
    removeItem(key) { this.data.delete(key); },
    clear() { this.data.clear(); },
};

function game() {
    const gs = new GameState();
    for (let i = 0; i < 3; i++) gs.setPlayer(i, new Player(`P${i}`));
    const deck = Card.createDeck();
    assert.equal(gs.startRound(deck.slice(0, 51), deck.slice(51)), true);
    return gs;
}

function cards(ranks) {
    const deck = Card.createDeck();
    return ranks.split(' ').map(rank => deck.splice(deck.findIndex(c => c.rankKey === rank), 1)[0]);
}

await test('UTC+8 day and week boundaries are independent of local timezone', () => {
    const NativeDate = Date;
    const oldTZ = process.env.TZ;
    try {
        for (const zone of ['Asia/Singapore', 'UTC', 'America/Los_Angeles']) {
            process.env.TZ = zone;
            global.Date = class extends NativeDate {
                constructor(...args) { super(...(args.length ? args : ['2026-09-06T16:30:00Z'])); }
            };
            assert.equal(getTodayString(), '2026-09-07', zone);
            assert.equal(getWeekStartString(), '2026-09-07', zone);
        }
    } finally {
        global.Date = NativeDate;
        if (oldTZ === undefined) delete process.env.TZ;
        else process.env.TZ = oldTZ;
    }
});

await test('unfinished quest progress survives a new manager', () => {
    localStorage.clear();
    const manager = new SeasonQuestManager();
    manager._data.daily.quests = [{ id: 'progress', type: QUEST_TYPE.PLAY_GAME, current: 0, target: 10, completed: false }];
    manager._data.weekly.quests = [];
    manager._data.season.quests = [];
    manager._save();
    manager.reportGame({ mode: 'ai', isWin: false });
    assert.equal(new SeasonQuestManager()._data.daily.quests[0].current, 1);
});

await test('landlord replay snapshot includes bottom cards and wildcard flags', () => {
    const gs = game();
    gs.callLandlord(0, 3);
    assert.equal(gs.initialHands[0].length, 20);
    for (const bottom of gs.initialBottom) {
        assert(gs.initialHands[0].some(c => c.rank === bottom.rank && c.suit === bottom.suit));
    }
});

await test('settlement reports round delta and multiplies called score by base score', () => {
    const gs = game();
    gs.baseScore = 2;
    gs.allowSpring = false;
    gs.allowAntiSpring = false;
    gs.scores = [10, -5, -5];
    gs.callLandlord(0, 3);
    let result;
    gs.on('roundEnd', data => { result = data; });
    gs.players[0].setHand(cards('3'));
    gs.playCards(0, gs.players[0].hand, Rules.analyze(gs.players[0].hand));
    assert.deepEqual(result.roundScores, [12, -6, -6]);
    assert.deepEqual(result.scores, [22, -11, -11]);
});

await test('state rejects a forged pattern without changing the hand', () => {
    const gs = game();
    gs.callLandlord(0, 3);
    const hand = [...gs.players[0].hand];
    const selected = hand.slice(0, 2);
    const fake = new HandPattern(HAND_TYPE.BOMB, selected, 17, 4);
    assert.equal(gs.playCards(0, selected, fake).success, false);
    assert.deepEqual(gs.players[0].hand, hand);
});

await test('a wildcard bomb cannot masquerade as a hard bomb', () => {
    const gs = game();
    gs.callLandlord(0, 3);
    const hand = cards('3 3 3 7');
    hand[3].isLaizi = true;
    gs.players[0].setHand(hand);
    gs.lastPlay = { playerIndex: 1, pattern: new HandPattern(HAND_TYPE.BOMB, [], 3, 4, true) };
    const forged = Rules.analyze(hand);
    forged.hasLaizi = false;
    assert.equal(gs.playCards(0, hand, forged).success, false);
});

await test('grab bidding multiplies configured base score', () => {
    const gs = game();
    gs.callMode = 'grab';
    gs.baseScore = 2;
    gs.allowSpring = gs.allowAntiSpring = false;
    gs.callLandlord(0, 1);
    gs.callLandlord(1, 0);
    gs.callLandlord(2, 0);
    gs.callLandlord(1, 2);
    gs.callLandlord(2, 0);
    gs.callLandlord(0, 0);
    assert.equal(gs.landlordIndex, 1);
    let result;
    gs.on('roundEnd', data => { result = data; });
    gs.players[1].setHand(cards('3'));
    gs.playCards(1, gs.players[1].hand, Rules.analyze(gs.players[1].hand));
    assert.deepEqual(result.roundScores, [-4, 8, -4]);
});

await test('complex response search includes airplane wings and four with two singles', () => {
    for (const [previous, next] of [
        ['3 3 3 4 4 4 8 9', '5 5 5 6 6 6 10 J'],
        ['3 3 3 3 8 9', '4 4 4 4 10 J'],
    ]) {
        const last = Rules.analyze(cards(previous));
        const hand = cards(next);
        assert(Rules.findAllBeats(hand, last).some(play => play.length === hand.length));
    }
});

await test('last endgame puts the human in the farmer seat', async () => {
    const mode = new EndgameMode(4);
    try {
        await mode.init();
        assert.equal(mode.humanIndex, 1);
        assert.equal(mode.gameState.players[1].isAI, false);
        assert.equal(mode.gameState.players[0].isAI, true);
    } finally { mode.destroy(); }
});

await test('challenge deadline overrides global timer settings', async () => {
    localStorage.clear();
    Storage.saveSettings({ timerSeconds: 30, timerEnabled: false });
    const mode = new ChallengeMode(1);
    try {
        await mode.init();
        mode.challenge = { config: { turnTimeLimit: 8 } };
        mode._applyChallengeRules();
        mode._startCountdown(mode.humanIndex, 'play');
        assert.equal(mode._turnCountdown, 8);
        assert(mode._countdownInterval);
    } finally { mode.destroy(); }
});

await test('disabled jokers are not left in playable hands or bottom cards', () => {
    const gs = game();
    gs.jokerRule = 'disabled';
    const deck = Card.createDeck();
    gs.startRound(deck.slice(0, 51), deck.slice(51));
    gs.callLandlord(0, 3);
    assert(gs.players.every(p => p.hand.every(c => !c.isJoker())));
    assert(gs.bottomCards.every(c => !c.isJoker()));
});

await test('new tournament resets all cumulative data and keeps its mode name', async () => {
    const mode = new TournamentMode('normal', 3);
    try {
        await mode.init();
        mode.gameState.scores = [8, -4, -4];
        mode.prevScores = [8, -4, -4];
        mode.roundResults.push({ scores: [8, -4, -4] });
        mode.setMatchRounds(3);
        assert.equal(mode.modeName, 'tournament');
        assert.deepEqual(mode.gameState.scores, [0, 0, 0]);
        assert.deepEqual(mode.prevScores, [0, 0, 0]);
        assert.equal(mode.roundResults.length, 0);
    } finally { mode.destroy(); }
});

await test('custom difficulty is applied after configuration changes', async () => {
    const mode = new CustomMode();
    try {
        await mode.init();
        mode.setConfig('aiDifficulty', 'hard');
        assert(mode.gameState.players.filter(p => p.isAI).every(p => p.difficulty === 'hard'));
    } finally { mode.destroy(); }
});

await test('custom partial hands are filled without duplicate cards', async () => {
    localStorage.clear();
    const mode = new CustomMode();
    try {
        await mode.init();
        mode._processCalling = async () => {};
        const fixed = cards('A A');
        mode.setFixedHand(2, fixed);
        await mode.startGame();
        const gs = mode.gameState;
        assert.equal(gs.phase, PHASE.CALLING);
        assert(gs.players[2].hasCards(fixed));
        assert(gs.players.every(p => p.hand.length === 17));
        assert.equal(new Set([...gs.players.flatMap(p => p.hand), ...gs.bottomCards].map(c => c.displayName)).size, 54);
    } finally { mode.destroy(); }
});

await test('non-integer bids cannot corrupt the calling phase', () => {
    const gs = game();
    for (const value of [NaN, '3', null, 1.5]) assert.equal(gs.callLandlord(0, value), false);
    assert.equal(gs.currentCall, 0);
});

await test('malformed imported histories are rejected before replay', () => {
    for (const history of [[null], [{ playerIndex: 5, cards: [] }], [{ playerIndex: 0, cards: 'bad' }]]) {
        const result = ReplayWorkshop.importShareCode(encodeShareCode({ history }));
        assert.equal(result.success, false);
    }
});

await test('play button rejects invalid or weaker selections and honors bomb-over-rocket', () => {
    const gs = game();
    gs.callLandlord(0, 3);
    const button = { style: {} };
    const renderer = Object.create(Renderer.prototype);
    renderer.gameState = gs;
    renderer.mode = { humanIndex: 0 };
    renderer.container = { querySelector: () => button };
    gs.lastPlay = { playerIndex: 1, pattern: Rules.analyze(cards('A A')) };
    renderer._getSelectedCards = () => cards('3 4');
    renderer._updatePlayButtonState();
    assert.equal(button.disabled, true);
    gs.lastPlay = { playerIndex: 1, pattern: Rules.analyze(cards('A')) };
    renderer._getSelectedCards = () => cards('3');
    renderer._updatePlayButtonState();
    assert.equal(button.disabled, true);
    gs.bombAsRocket = true;
    gs.lastPlay.pattern = Rules.analyze(cards('JOKER_SMALL JOKER_BIG'));
    renderer._getSelectedCards = () => cards('4 4 4 4');
    renderer._updatePlayButtonState();
    assert.equal(button.disabled, false);
});

await test('AI and must-play detection honor bomb-over-rocket', async () => {
    const gs = game();
    gs.callLandlord(0, 3);
    gs.bombAsRocket = true;
    gs.lastPlay = { playerIndex: 1, pattern: Rules.analyze(cards('JOKER_SMALL JOKER_BIG')) };
    gs.players[0].setHand(cards('4 4 4 4'));
    const ai = new AIPlayer('test');
    ai.hand = gs.players[0].hand;
    ai.index = 0;
    assert.equal(gs.hasValidPlays(0), true);
    assert.equal((await ai.decidePlay(gs, gs.lastPlay.pattern)).length, 4);
});

await test('wildcards complete consecutive pairs and can answer a higher pair', () => {
    const sequence = cards('3 3 4 4 5 7');
    sequence.at(-1).isLaizi = true;
    assert.equal(Rules.analyze(sequence).type, HAND_TYPE.DOUBLE_STRAIGHT);
    const hand = cards('A 7');
    hand[1].isLaizi = true;
    assert(Rules.findAllBeats(hand, Rules.analyze(cards('K K'))).some(play => play.length === 2));
});

await test('wildcards cannot duplicate a joker', () => {
    const hand = cards('JOKER_BIG 7');
    hand[1].isLaizi = true;
    assert.equal(Rules.analyze(hand).isValid(), false);
});

await test('wildcard singles remain available when answering a lower single', () => {
    const hand = cards('7');
    hand[0].isLaizi = true;
    assert.equal(Rules.findAllBeats(hand, Rules.analyze(cards('6'))).length, 1);
});

await test('an AI decision from the previous round cannot bid in a restarted round', async () => {
    const mode = new AIMode();
    let release;
    try {
        await mode.init();
        mode._applyGameRules = () => { mode.gameState.dealerIndex = 1; };
        mode._delay = async () => {};
        let calls = 0;
        mode.gameState.players[1].decideCall = () => ++calls === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(0);
        mode.gameState.players[2].decideCall = async () => 0;
        await mode.startGame();
        await mode.startGame();
        release(3);
        for (let i = 0; i < 12; i++) await Promise.resolve();
        assert.equal(mode.gameState.currentCall, 0);
        assert.equal(mode.gameState.phase, PHASE.CALLING);
    } finally { mode.destroy(); }
});

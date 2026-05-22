/**
 * 核心逻辑单元测试 (ES Module)
 * 运行: node test/core.test.mjs
 */

import { Card, SUITS, RANKS } from '../src/core/card.js';
import { Rules, HandPattern, HAND_TYPE } from '../src/core/rules.js';
import { GameState, PHASE, CALL_ACTION } from '../src/core/game-state.js';
import { Player } from '../src/players/player.js';
import { AIPlayer } from '../src/players/ai-player.js';
import { AIMode } from '../src/modes/ai-mode.js';

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

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'Assertion failed');
}

function makeCards(rankKeys) {
    const suits = ['SPADE', 'HEART', 'CLUB', 'DIAMOND'];
    let suitIdx = 0;
    return rankKeys.map(r => {
        if (r.startsWith('JOKER')) return new Card(null, r);
        const c = new Card(SUITS[suits[suitIdx % 4]], r);
        suitIdx++;
        return c;
    });
}

// ===== Card Tests =====
test('Card.createDeck creates 54 cards', () => {
    assert(Card.createDeck().length === 54);
});

test('Card.shuffle preserves count', () => {
    const deck = Card.createDeck();
    const shuffled = Card.shuffle(deck);
    assert(shuffled.length === 54);
});

test('Card sorting by value', () => {
    const sorted = Card.sortByValue([new Card(SUITS.HEART, 'A'), new Card(SUITS.SPADE, '3'), new Card(SUITS.CLUB, '2')]);
    assert(sorted[0].value === 3);
    assert(sorted[1].value === 14);
    assert(sorted[2].value === 15);
});

// ===== Rules Tests =====
test('Rules.analyze SINGLE', () => {
    const p = Rules.analyze(makeCards(['3']));
    assert(p.type === HAND_TYPE.SINGLE);
});

test('Rules.analyze PAIR', () => {
    assert(Rules.analyze(makeCards(['5', '5'])).type === HAND_TYPE.PAIR);
});

test('Rules.analyze TRIPLE', () => {
    assert(Rules.analyze(makeCards(['7', '7', '7'])).type === HAND_TYPE.TRIPLE);
});

test('Rules.analyze TRIPLE_WITH_SINGLE', () => {
    assert(Rules.analyze(makeCards(['9', '9', '9', '3'])).type === HAND_TYPE.TRIPLE_WITH_SINGLE);
});

test('Rules.analyze STRAIGHT', () => {
    const p = Rules.analyze(makeCards(['3', '4', '5', '6', '7']));
    assert(p.type === HAND_TYPE.STRAIGHT);
    assert(p.mainValue === 7);
});

test('Rules.analyze STRAIGHT with 10', () => {
    const p = Rules.analyze(makeCards(['8', '9', '10', 'J', 'Q', 'K', 'A']));
    assert(p.type === HAND_TYPE.STRAIGHT);
    assert(p.length === 7);
});

test('Rules.analyze STRAIGHT rejects 2', () => {
    assert(Rules.analyze(makeCards(['10', 'J', 'Q', 'K', 'A', '2'])).type === HAND_TYPE.INVALID);
});

test('Rules.analyze DOUBLE_STRAIGHT', () => {
    assert(Rules.analyze(makeCards(['3', '3', '4', '4', '5', '5'])).type === HAND_TYPE.DOUBLE_STRAIGHT);
});

test('Rules.analyze DOUBLE_STRAIGHT rejects 2', () => {
    assert(Rules.analyze(makeCards(['Q', 'Q', 'K', 'K', 'A', 'A', '2', '2'])).type === HAND_TYPE.INVALID);
});

test('Rules.analyze TRIPLE_STRAIGHT', () => {
    assert(Rules.analyze(makeCards(['3', '3', '3', '4', '4', '4'])).type === HAND_TYPE.TRIPLE_STRAIGHT);
});

test('Rules.analyze TRIPLE_STRAIGHT rejects 2', () => {
    assert(Rules.analyze(makeCards(['K', 'K', 'K', 'A', 'A', 'A', '2', '2', '2'])).type === HAND_TYPE.INVALID);
});

test('Rules.analyze BOMB', () => {
    const p = Rules.analyze(makeCards(['K', 'K', 'K', 'K']));
    assert(p.type === HAND_TYPE.BOMB);
    assert(p.mainValue === 13);
});

test('Rules.analyze ROCKET', () => {
    assert(Rules.analyze(makeCards(['JOKER_SMALL', 'JOKER_BIG'])).type === HAND_TYPE.ROCKET);
});

test('Rules.analyze INVALID for non-straight', () => {
    assert(Rules.analyze(makeCards(['3', '4', '5', '7', '8'])).type === HAND_TYPE.INVALID);
});

test('Rules.canBeat - same type', () => {
    const p1 = Rules.analyze(makeCards(['3']));
    const p2 = Rules.analyze(makeCards(['5']));
    assert(Rules.canBeat(p1, p2));
    assert(!Rules.canBeat(p2, p1));
});

test('Rules.canBeat - bomb beats normal', () => {
    const normal = Rules.analyze(makeCards(['A', 'A', 'A', 'K', 'K']));
    const bomb = Rules.analyze(makeCards(['4', '4', '4', '4']));
    assert(Rules.canBeat(normal, bomb));
});

test('Rules.canBeat - rocket beats bomb', () => {
    const bomb = Rules.analyze(makeCards(['4', '4', '4', '4']));
    const rocket = Rules.analyze(makeCards(['JOKER_SMALL', 'JOKER_BIG']));
    assert(Rules.canBeat(bomb, rocket));
});

test('Rules.findAllBeats - single', () => {
    const hand = makeCards(['3', '5', '7', '9', 'J', 'Q']);
    const last = Rules.analyze(makeCards(['6']));
    const beats = Rules.findAllBeats(hand, last);
    assert(beats.length === 4, `Expected 4, got ${beats.length}`);
});

test('Rules.findAllLegalPlays returns valid plays', () => {
    const hand = makeCards(['3', '4', '5', '6', '7', '8', '9']);
    const plays = Rules.findAllLegalPlays(hand);
    assert(plays.length > 0);
    const straight = plays.find(p => p.pattern.type === HAND_TYPE.STRAIGHT);
    assert(straight !== undefined);
});

// ===== GameState Tests =====
test('GameState deal and start', () => {
    const gs = new GameState();
    gs.setPlayer(0, new Player('P0'));
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    const deck = Card.shuffle(Card.createDeck());
    gs.startRound(deck.slice(0, 51), deck.slice(51, 54));
    assert(gs.phase === PHASE.CALLING);
    assert(gs.players[0].hand.length === 17);
});

test('GameState calling flow', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    const deck = Card.shuffle(Card.createDeck());
    gs.startRound(deck.slice(0, 51), deck.slice(51, 54));
    
    gs.callLandlord(0, CALL_ACTION.ONE);
    assert(gs.currentCall === 1);
    gs.callLandlord(1, CALL_ACTION.PASS);
    gs.callLandlord(2, CALL_ACTION.PASS);
    assert(gs.phase === PHASE.PLAYING);
    assert(p0.isLandlord);
    assert(p0.hand.length === 20);
});

test('GameState play cards', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    p0.setHand(makeCards(['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'JOKER_SMALL', 'JOKER_BIG', '3', '4']));
    gs.setPlayer(1, new Player('P1'));
    gs.players[1].setHand(makeCards(['5', '5', '6', '6', '7', '7', '8', '8', '9', '9', '10', '10', 'J', 'J', 'Q', 'Q', 'K']));
    gs.setPlayer(2, new Player('P2'));
    gs.players[2].setHand(makeCards(['3', '3', '4', '4', '5', '5', '6', '6', '7', '7', '8', '8', '9', '9', '10', '10', 'J']));
    gs.bottomCards = makeCards(['K', 'K', 'A']);
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    p0.addCards(gs.bottomCards);
    gs.phase = PHASE.PLAYING;
    gs.currentTurn = 0;
    
    const cards = makeCards(['3']);
    const result = gs.playCards(0, cards, Rules.analyze(cards));
    assert(result.success);
    assert(gs.lastPlay.playerIndex === 0);
    
    gs.pass(1);
    assert(gs.passCount === 1);
    
    const cards2 = makeCards(['5']);
    const result2 = gs.playCards(2, cards2, Rules.analyze(cards2));
    assert(result2.success);
});

// ===== AI Tests =====
test('AIPlayer decides call based on hand strength', async () => {
    const ai = new AIPlayer('AI', 'hard');
    ai.setHand(makeCards(['2', '2', 'A', 'A', 'K', 'K', 'Q', 'Q', 'J', 'J', '10', '10', '9', '9', '8', '8', '7']));
    const gs = new GameState();
    gs.setPlayer(0, ai);
    const call = await ai.decideCall(gs);
    assert(call > 0, `Expected positive call, got ${call}`);
});

test('AIPlayer can find response play', async () => {
    const ai = new AIPlayer('AI');
    ai.setHand(makeCards(['5', '6', '7', '8', '9', 'J', 'Q', 'K', 'A', '2', '3', '3', '4', '4', '5', '5', '6']));
    const gs = new GameState();
    gs.setPlayer(0, ai);
    gs.phase = PHASE.PLAYING;
    
    const lastPattern = Rules.analyze(makeCards(['4']));
    const cards = await ai.decidePlay(gs, lastPattern);
    assert(cards.length > 0, 'AI should play a card');
    const playedPattern = Rules.analyze(cards);
    assert(playedPattern.isValid());
    assert(Rules.canBeat(lastPattern, playedPattern));
});

test('AIPlayer getHint provides suggestions', () => {
    const ai = new AIPlayer('AI');
    const hand = makeCards(['3', '4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', 'A', '2', 'JOKER_SMALL', 'JOKER_BIG', '3', '4', '5']);
    ai.setHand(hand);
    const hint = ai.getHint(hand, null);
    assert(hint.length > 0, 'Hint should suggest some cards');
});

// ===== AIMode Integration Test =====
test('AIMode initializes correctly', async () => {
    const mode = new AIMode('easy');
    await mode.init();
    assert(mode.gameState.players[0] instanceof Player);
    assert(mode.gameState.players[1] instanceof AIPlayer);
    assert(mode.gameState.players[2] instanceof AIPlayer);
    assert(!mode.gameState.players[0].isAI);
});

// ===== Summary =====
console.log(`\n====================`);
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
console.log(`====================`);
process.exit(failed > 0 ? 1 : 0);

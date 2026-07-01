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
import { Storage } from '../src/utils/storage.js';

// 为 Node.js 环境提供 localStorage mock
global.localStorage = global.localStorage || {
    _store: new Map(),
    getItem(k) { return this._store.has(k) ? this._store.get(k) : null; },
    setItem(k, v) { this._store.set(k, String(v)); },
    removeItem(k) { this._store.delete(k); },
    clear() { this._store.clear(); },
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

// ===== Laizi Tests =====
test('GameState startRound marks laizi cards correctly', () => {
    const gs = new GameState();
    gs.setPlayer(0, new Player('P0'));
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    gs.laiziEnabled = true;
    const deck = Card.createDeck();
    // 从 deck 中选取底牌，确保引用一致
    const bottom = [deck.find(c => c.suit === SUITS.HEART && c.rankKey === '3'),
                    deck.find(c => c.suit === SUITS.DIAMOND && c.rankKey === '4'),
                    deck.find(c => c.suit === SUITS.CLUB && c.rankKey === '5')];
    const playerCards = deck.filter(c => !bottom.some(b => b === c)).slice(0, 51);
    gs.startRound(playerCards, bottom);
    assert(gs.laiziValue === 3, `Expected laiziValue=3, got ${gs.laiziValue}`);
    const laiziCount = gs.players[0].hand.filter(c => c.isLaizi).length +
                       gs.players[1].hand.filter(c => c.isLaizi).length +
                       gs.players[2].hand.filter(c => c.isLaizi).length +
                       bottom.filter(c => c.isLaizi).length;
    assert(laiziCount === 4, `Expected 4 laizi cards, got ${laiziCount}`);
});

test('GameState startRound clears laizi when big joker is bottom card', () => {
    const gs = new GameState();
    gs.setPlayer(0, new Player('P0'));
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    gs.laiziEnabled = true;
    const bottom = [new Card(null, 'JOKER_BIG'), new Card(SUITS.HEART, '3'), new Card(SUITS.DIAMOND, '4')];
    const playerCards = Card.createDeck().filter(c => !bottom.some(b => b.value === c.value && b.suit?.name === c.suit?.name && b.rankKey === c.rankKey)).slice(0, 51);
    gs.startRound(playerCards, bottom);
    assert(gs.laiziValue === -1, `Expected laiziValue=-1 for big joker, got ${gs.laiziValue}`);
});

// ===== mustPlay Tests =====
test('GameState pass blocked under mustPlay when beatable cards exist', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    // P0 手牌有 5，上家出了 3
    p0.setHand(makeCards(['5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'JOKER_SMALL', 'JOKER_BIG', '3', '4', '5', '6']));
    gs.phase = PHASE.PLAYING;
    gs.currentTurn = 0;
    gs.mustPlay = true;
    gs.lastPlay = { playerIndex: 2, cards: makeCards(['3']), pattern: Rules.analyze(makeCards(['3'])) };
    gs.passCount = 0;
    const result = gs.pass(0);
    assert(result === false, 'Expected pass to be blocked when mustPlay and beatable cards exist');
});

test('GameState pass allowed under mustPlay when no beatable cards', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    // P0 只有小牌，上家出了 A
    p0.setHand(makeCards(['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', '3', '4', '5', '6', '7', '8']));
    gs.phase = PHASE.PLAYING;
    gs.currentTurn = 0;
    gs.mustPlay = true;
    gs.lastPlay = { playerIndex: 2, cards: makeCards(['A']), pattern: Rules.analyze(makeCards(['A'])) };
    gs.passCount = 0;
    const result = gs.pass(0);
    assert(result === true, 'Expected pass to be allowed when mustPlay but no beatable cards');
});

// ===== Disabled Rule Tests =====
test('GameState playCards blocks triple-with-single when disabled', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    p0.setHand(makeCards(['3', '3', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'JOKER_SMALL', 'JOKER_BIG', '4', '5', '6']));
    gs.bottomCards = [];
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.phase = PHASE.PLAYING;
    gs.currentTurn = 0;
    gs.allowTripleWithSingle = false;
    const cards = makeCards(['3', '3', '3', '4']);
    const result = gs.playCards(0, cards, Rules.analyze(cards));
    assert(result.success === false, 'Expected triple-with-single to be blocked when disabled');
    assert(result.error.includes('禁止三带一'), `Expected "禁止三带一" error, got: ${result.error}`);
});

test('GameState playCards blocks triple-with-pair when disabled', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    p0.setHand(makeCards(['3', '3', '3', '4', '4', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'JOKER_SMALL', 'JOKER_BIG', '5', '6', '7']));
    gs.bottomCards = [];
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.phase = PHASE.PLAYING;
    gs.currentTurn = 0;
    gs.allowTripleWithPair = false;
    const cards = makeCards(['3', '3', '3', '4', '4']);
    const result = gs.playCards(0, cards, Rules.analyze(cards));
    assert(result.success === false, 'Expected triple-with-pair to be blocked when disabled');
    assert(result.error.includes('禁止三带二'), `Expected "禁止三带二" error, got: ${result.error}`);
});

test('GameState playCards blocks airplane-with-wings when disabled', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    // 手牌：33344456 + 其他牌，飞机带翼需要 333444 + 5 + 6（两单翼）
    const hand = makeCards(['3', '3', '3', '4', '4', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'JOKER_SMALL', 'JOKER_BIG', '7', '8']);
    p0.setHand(hand);
    gs.bottomCards = [];
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.phase = PHASE.PLAYING;
    gs.currentTurn = 0;
    gs.allowAirplaneWithWings = false;
    // 精确选取 33344456（两连续三张 + 两张单牌做翼）
    const threes = hand.filter(c => c.value === 3).slice(0, 3);
    const fours = hand.filter(c => c.value === 4).slice(0, 3);
    const wings = hand.filter(c => c.value === 5 || c.value === 6).slice(0, 2);
    const cards = [...threes, ...fours, ...wings];
    assert(cards.length === 8, `Expected 8 cards for airplane, got ${cards.length}`);
    const result = gs.playCards(0, cards, Rules.analyze(cards));
    assert(result.success === false, 'Expected airplane-with-wings to be blocked when disabled');
    assert(result.error.includes('禁止飞机带翼'), `Expected "禁止飞机带翼" error, got: ${result.error}`);
});

test('GameState playCards blocks four-with-two under strict rules', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    p0.setHand(makeCards(['3', '3', '3', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'JOKER_SMALL', 'JOKER_BIG', '6', '7']));
    gs.bottomCards = [];
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.phase = PHASE.PLAYING;
    gs.currentTurn = 0;
    gs.strictRules = true;
    const cards = makeCards(['3', '3', '3', '3', '4', '5']);
    const result = gs.playCards(0, cards, Rules.analyze(cards));
    assert(result.success === false, 'Expected four-with-two to be blocked under strict rules');
    assert(result.error.includes('严格规则'), `Expected "严格规则" error, got: ${result.error}`);
});

// ===== Storage Tests =====
test('Storage resetSettings clears localStorage and returns defaults', () => {
    Storage.saveSettings({ theme: 'blue', difficulty: 'hard', mustPlay: true });
    const settingsBefore = Storage.getSettings();
    assert(settingsBefore.theme === 'blue', 'Expected theme=blue before reset');
    const defaults = Storage.resetSettings();
    assert(defaults.theme === 'green', `Expected default theme=green, got ${defaults.theme}`);
    assert(defaults.difficulty === 'normal', `Expected default difficulty=normal, got ${defaults.difficulty}`);
    assert(defaults.mustPlay === false, `Expected default mustPlay=false, got ${defaults.mustPlay}`);
    const settingsAfter = Storage.getSettings();
    assert(settingsAfter.theme === 'green', 'Expected theme=green after reset');
});

// ===== Rule Flag Tests (Additional) =====
test('GameState allowPassOnFirst allows pass on new round when enabled', () => {
    const gs = new GameState();
    gs.setPlayer(0, new Player('P0'));
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    gs.phase = PHASE.PLAYING;
    gs.currentTurn = 0;
    gs.allowPassOnFirst = true;
    gs.lastPlay = { playerIndex: -1, cards: [], pattern: null };
    assert(gs.pass(0) === true, 'Expected pass to be allowed when allowPassOnFirst=true');
});

test('GameState allowPassOnFirst blocks pass on new round when disabled', () => {
    const gs = new GameState();
    gs.setPlayer(0, new Player('P0'));
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    gs.phase = PHASE.PLAYING;
    gs.currentTurn = 0;
    gs.allowPassOnFirst = false;
    gs.lastPlay = { playerIndex: -1, cards: [], pattern: null };
    assert(gs.pass(0) === false, 'Expected pass to be blocked when allowPassOnFirst=false');
});

test('GameState jokerRule disabled blocks rocket', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    p0.setHand(makeCards(['JOKER_SMALL', 'JOKER_BIG', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '3', '4', '5', '6', '7']));
    gs.bottomCards = [];
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.phase = PHASE.PLAYING;
    gs.currentTurn = 0;
    gs.jokerRule = 'disabled';
    const cards = makeCards(['JOKER_SMALL', 'JOKER_BIG']);
    const result = gs.playCards(0, cards, Rules.analyze(cards));
    assert(result.success === false, 'Expected rocket to be blocked when jokerRule=disabled');
});

test('GameState hasValidPlays filters disabled patterns', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    // P0 有 3334 + 小牌，上家出了 KKKQ（三带一）
    // P0 没有王炸/炸弹/大于K的单张，唯一可出的是 3334（三带一）但被禁用
    p0.setHand(makeCards(['3', '3', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q']));
    gs.phase = PHASE.PLAYING;
    gs.currentTurn = 0;
    gs.allowTripleWithSingle = false;
    gs.lastPlay = { playerIndex: 2, cards: makeCards(['K', 'K', 'K', 'Q']), pattern: Rules.analyze(makeCards(['K', 'K', 'K', 'Q'])) };
    // P0 有三张3可以带一张4，但 allowTripleWithSingle=false，且没有炸弹/火箭/大于K的牌
    assert(gs.hasValidPlays(0) === false, 'Expected hasValidPlays to be false when allowTripleWithSingle=false and no other valid plays');
});

test('GameState baseScore setting affects settlement', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.currentCall = 1;
    gs.baseScore = 5;
    gs.scoreMultiplier = 1;
    gs.scores = [0, 0, 0];
    gs.allowSpring = false;
    gs.allowAntiSpring = false;
    gs.bombDoubles = false;
    gs.rocketDoubles = false;
    gs.history = [];
    gs._settleRound(0);
    // 地主赢：得分 = baseScore * multiplier * 2 = 5 * 1 * 2 = 10
    assert(gs.scores[0] === 10, `Expected landlord score 10 with baseScore=5, got ${gs.scores[0]}`);
});

// ===== Settlement multiplier tests =====
test('GameState scoreMultiplier affects settlement', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.currentCall = 1;
    gs.baseScore = 1;
    gs.scoreMultiplier = 3;
    gs.scores = [0, 0, 0];
    gs.allowSpring = false;
    gs.allowAntiSpring = false;
    gs.bombDoubles = false;
    gs.rocketDoubles = false;
    gs.history = [];
    gs._settleRound(0);
    // 地主赢：得分 = 1 * 1 * 3 * 2 = 6
    assert(gs.scores[0] === 6, `Expected landlord score 6 with scoreMultiplier=3, got ${gs.scores[0]}`);
});

test('GameState bombDoubles=false disables bomb doubling', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.currentCall = 1;
    gs.baseScore = 1;
    gs.scoreMultiplier = 1;
    gs.scores = [0, 0, 0];
    gs.allowSpring = false;
    gs.allowAntiSpring = false;
    gs.bombDoubles = false; // 禁用炸弹翻倍
    gs.rocketDoubles = false;
    gs.history = [
        { pattern: { type: 'BOMB' } },
        { pattern: { type: 'BOMB' } },
    ];
    gs._settleRound(0);
    // 禁用炸弹翻倍，multiplier=1，得分 = 1 * 1 * 2 = 2
    assert(gs.scores[0] === 2, `Expected landlord score 2 with bombDoubles=false, got ${gs.scores[0]}`);
});

test('GameState bombDoubles=true enables bomb doubling', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.currentCall = 1;
    gs.baseScore = 1;
    gs.scoreMultiplier = 1;
    gs.scores = [0, 0, 0];
    gs.allowSpring = false;
    gs.allowAntiSpring = false;
    gs.bombDoubles = true; // 启用炸弹翻倍
    gs.rocketDoubles = false;
    gs.history = [
        { pattern: { type: 'BOMB' } },
        { pattern: { type: 'BOMB' } },
    ];
    gs._settleRound(0);
    // 2个炸弹 -> multiplier = 2^2 = 4，得分 = 1 * 4 * 2 = 8
    assert(gs.scores[0] === 8, `Expected landlord score 8 with 2 bombs, got ${gs.scores[0]}`);
});

test('GameState rocketDoubles=false disables rocket doubling', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.currentCall = 1;
    gs.baseScore = 1;
    gs.scoreMultiplier = 1;
    gs.scores = [0, 0, 0];
    gs.allowSpring = false;
    gs.allowAntiSpring = false;
    gs.bombDoubles = false;
    gs.rocketDoubles = false; // 禁用火箭翻倍
    gs.history = [
        { pattern: { type: 'ROCKET' } },
    ];
    gs._settleRound(0);
    // 禁用火箭翻倍，multiplier=1，得分 = 1 * 1 * 2 = 2
    assert(gs.scores[0] === 2, `Expected landlord score 2 with rocketDoubles=false, got ${gs.scores[0]}`);
});

test('GameState rocketDoubles=true enables rocket doubling', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.currentCall = 1;
    gs.baseScore = 1;
    gs.scoreMultiplier = 1;
    gs.scores = [0, 0, 0];
    gs.allowSpring = false;
    gs.allowAntiSpring = false;
    gs.bombDoubles = false;
    gs.rocketDoubles = true; // 启用火箭翻倍
    gs.history = [
        { pattern: { type: 'ROCKET' } },
    ];
    gs._settleRound(0);
    // 1个火箭 -> multiplier = 2^1 = 2，得分 = 1 * 2 * 2 = 4
    assert(gs.scores[0] === 4, `Expected landlord score 4 with 1 rocket, got ${gs.scores[0]}`);
});

test('GameState allowSpring=false disables spring bonus', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.currentCall = 1;
    gs.baseScore = 1;
    gs.scoreMultiplier = 1;
    gs.scores = [0, 0, 0];
    gs.allowSpring = false; // 禁用春天
    gs.allowAntiSpring = false;
    gs.bombDoubles = false;
    gs.rocketDoubles = false;
    gs.history = [];
    gs.playCounts = [1, 0, 0]; // 农民未出牌
    gs._settleRound(0);
    // 春天应触发但被禁用，multiplier=1，得分 = 1 * 1 * 2 = 2
    assert(gs.scores[0] === 2, `Expected landlord score 2 with allowSpring=false, got ${gs.scores[0]}`);
});

test('GameState allowSpring=true enables spring bonus', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.currentCall = 1;
    gs.baseScore = 1;
    gs.scoreMultiplier = 1;
    gs.scores = [0, 0, 0];
    gs.allowSpring = true; // 启用春天
    gs.allowAntiSpring = false;
    gs.bombDoubles = false;
    gs.rocketDoubles = false;
    gs.history = [];
    gs.playCounts = [1, 0, 0]; // 农民未出牌 -> 春天
    gs._settleRound(0);
    // 春天翻倍，得分 = 1 * 2 * 2 = 4
    assert(gs.scores[0] === 4, `Expected landlord score 4 with spring, got ${gs.scores[0]}`);
});

test('GameState allowAntiSpring=false disables anti-spring bonus', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.currentCall = 1;
    gs.baseScore = 1;
    gs.scoreMultiplier = 1;
    gs.scores = [0, 0, 0];
    gs.allowSpring = false;
    gs.allowAntiSpring = false; // 禁用反春天
    gs.bombDoubles = false;
    gs.rocketDoubles = false;
    gs.history = [];
    gs.playCounts = [1, 1, 1]; // 地主只出1次 -> 反春天条件，但被禁用
    gs._settleRound(1); // 农民赢
    // 反春天应触发但被禁用，multiplier=1，农民赢每人+1，地主-2
    assert(gs.scores[0] === -2, `Expected landlord score -2 with allowAntiSpring=false, got ${gs.scores[0]}`);
    assert(gs.scores[1] === 1, `Expected peasant score 1, got ${gs.scores[1]}`);
});

test('GameState allowAntiSpring=true enables anti-spring bonus', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.currentCall = 1;
    gs.baseScore = 1;
    gs.scoreMultiplier = 1;
    gs.scores = [0, 0, 0];
    gs.allowSpring = false;
    gs.allowAntiSpring = true; // 启用反春天
    gs.bombDoubles = false;
    gs.rocketDoubles = false;
    gs.history = [];
    gs.playCounts = [1, 1, 1]; // 地主只出1次 -> 反春天
    gs._settleRound(1); // 农民赢
    // 反春天翻倍，得分 = 1 * 2 * 1 = 2（农民每人），地主 = -4
    assert(gs.scores[0] === -4, `Expected landlord score -4 with anti-spring, got ${gs.scores[0]}`);
    assert(gs.scores[1] === 2, `Expected peasant score 2, got ${gs.scores[1]}`);
});

// ===== Bomb as Rocket test =====
test('GameState bombAsRocket allows bomb to beat rocket', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    p0.setHand(makeCards(['3', '3', '3', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'JOKER_SMALL', 'JOKER_BIG', '6', '7']));
    gs.bottomCards = [];
    gs.landlordIndex = 0;
    p0.isLandlord = true;
    gs.phase = PHASE.PLAYING;
    gs.currentTurn = 0;
    gs.bombAsRocket = false;
    gs.lastPlay = { playerIndex: 2, cards: makeCards(['JOKER_SMALL', 'JOKER_BIG']), pattern: Rules.analyze(makeCards(['JOKER_SMALL', 'JOKER_BIG'])) };
    gs.passCount = 0;
    // 炸弹不能打火箭（默认）
    const bombCards = makeCards(['3', '3', '3', '3']);
    const result1 = gs.playCards(0, bombCards, Rules.analyze(bombCards));
    assert(result1.success === false, 'Expected bomb to fail against rocket when bombAsRocket=false');

    // 启用 bombAsRocket
    gs.bombAsRocket = true;
    // 需要重置 lastPlay（因为上一步 playCards 可能修改了状态）
    gs.lastPlay = { playerIndex: 2, cards: makeCards(['JOKER_SMALL', 'JOKER_BIG']), pattern: Rules.analyze(makeCards(['JOKER_SMALL', 'JOKER_BIG'])) };
    gs.passCount = 0;
    // P0 已经出了一张3（在上一轮尝试中），手牌不够了，需要重置
    p0.setHand(makeCards(['3', '3', '3', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'JOKER_SMALL', 'JOKER_BIG', '6', '7']));
    const result2 = gs.playCards(0, bombCards, Rules.analyze(bombCards));
    assert(result2.success === true, 'Expected bomb to beat rocket when bombAsRocket=true');
});

// ===== Grab mode test =====
test('GameState callMode=grab basic flow', () => {
    const gs = new GameState();
    gs.setPlayer(0, new Player('P0'));
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    const deck = Card.shuffle(Card.createDeck());
    gs.startRound(deck.slice(0, 51), deck.slice(51, 54));
    gs.callMode = 'grab';

    // P0 叫地主
    const r1 = gs.callLandlord(0, 1); // CALL
    assert(r1 === true, 'Expected call to succeed');
    assert(gs.grabPhase === 'call');

    // P1 pass
    const r2 = gs.callLandlord(1, 0); // PASS
    assert(r2 === true);

    // P2 pass
    const r3 = gs.callLandlord(2, 0); // PASS
    assert(r3 === true);

    // 转完一圈，有人叫了地主，进入抢地主阶段
    assert(gs.grabPhase === 'grab', `Expected grab phase, got ${gs.grabPhase}`);
    assert(gs.currentCallPlayer === 0);
});

// ===== No shuffle test =====
test('GameState noShuffle preserves deck order', () => {
    const gs = new GameState();
    gs.setPlayer(0, new Player('P0'));
    gs.setPlayer(1, new Player('P1'));
    gs.setPlayer(2, new Player('P2'));
    const deck = Card.createDeck();
    gs.noShuffle = true;
    const top51 = deck.slice(0, 51);
    const bottom3 = deck.slice(51, 54);
    gs.startRound(top51, bottom3);
    // 不洗牌时，GameState 保存的 deck 顺序应与输入一致
    // （手牌会被 setHand 排序，所以不直接比手牌，而是比 deck 顺序）
    assert(gs.deck.length === 51, `Expected deck length 51, got ${gs.deck.length}`);
    for (let i = 0; i < 51; i++) {
        assert(gs.deck[i].value === top51[i].value && gs.deck[i].suit?.name === top51[i].suit?.name,
            `Expected unshuffled deck at position ${i}`);
    }
    // 验证三家分到的牌正好是 deck 的三段（不考虑 setHand 排序）
    const p0Values = gs.players[0].hand.map(c => c.value).sort((a, b) => a - b);
    const expectedP0 = top51.slice(0, 17).map(c => c.value).sort((a, b) => a - b);
    assert(JSON.stringify(p0Values) === JSON.stringify(expectedP0), 'P0 hand should contain first 17 cards');
});

// ===== hasValidPlays new-round fix =====
test('GameState hasValidPlays works on new round (findAllLegalPlays fallback)', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    p0.setHand(makeCards(['3', '4', '5', '6', '7']));
    gs.phase = PHASE.PLAYING;
    gs.currentTurn = 0;
    // 新轮次：lastPlay 无效
    gs.lastPlay = { playerIndex: -1, cards: [], pattern: null };
    gs.passCount = 0;
    assert(gs.hasValidPlays(0) === true, 'Expected hasValidPlays=true on new round with valid cards');
});

// ===== AI respects jokerRule=disabled =====
test('AIPlayer decidePlay respects jokerRule=disabled on new round', async () => {
    const ai = new AIPlayer('AI', 'hard');
    ai.setHand(makeCards(['JOKER_SMALL', 'JOKER_BIG', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '3', '4']));
    ai.index = 0;
    const gs = new GameState();
    gs.jokerRule = 'disabled';
    gs.phase = PHASE.PLAYING;
    gs.lastPlay = { playerIndex: -1, cards: [], pattern: null };
    gs.passCount = 0;
    const cards = await ai.decidePlay(gs, null);
    assert(cards.length > 0, 'AI should find a playable card');
    assert(!cards.some(c => c.value === 16 || c.value === 17), 'AI should not play jokers when jokerRule=disabled');
});

test('AIPlayer getHint respects jokerRule=disabled on new round', () => {
    const ai = new AIPlayer('AI');
    const hand = makeCards(['JOKER_SMALL', 'JOKER_BIG', '3', '4', '5', '6', '7']);
    ai.setHand(hand);
    const gs = new GameState();
    gs.jokerRule = 'disabled';
    const hint = ai.getHint(hand, null, true, gs);
    assert(hint.length > 0, 'Hint should suggest some cards');
    assert(!hint.some(c => c.value === 16 || c.value === 17), 'Hint should not suggest jokers when jokerRule=disabled');
});

test('AIPlayer getHint respects jokerRule=disabled when responding', () => {
    const ai = new AIPlayer('AI');
    const hand = makeCards(['JOKER_SMALL', 'JOKER_BIG', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '3', '4']);
    ai.setHand(hand);
    const gs = new GameState();
    gs.jokerRule = 'disabled';
    const lastPattern = Rules.analyze(makeCards(['K']));
    const hint = ai.getHint(hand, lastPattern, false, gs);
    assert(!hint.some(c => c.value === 16 || c.value === 17), 'Hint should not suggest jokers when jokerRule=disabled');
});

// ===== AI respects strictRules (no four-with-two) =====
test('AIPlayer decidePlay respects strictRules on new round', async () => {
    const ai = new AIPlayer('AI', 'hard');
    // 手牌包含四带二的诱惑（3333+4+5）
    ai.setHand(makeCards(['3', '3', '3', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '2']));
    ai.index = 0;
    const gs = new GameState();
    gs.strictRules = true;
    gs.phase = PHASE.PLAYING;
    gs.lastPlay = { playerIndex: -1, cards: [], pattern: null };
    gs.passCount = 0;
    const cards = await ai.decidePlay(gs, null);
    assert(cards.length > 0, 'AI should find a playable card');
    const p = Rules.analyze(cards);
    assert(p.type !== HAND_TYPE.FOUR_WITH_TWO && p.type !== HAND_TYPE.FOUR_WITH_TWO_PAIRS,
        `AI should not play four-with-two under strictRules, got ${p.type}`);
});

test('AIPlayer getHint respects strictRules', () => {
    const ai = new AIPlayer('AI');
    const hand = makeCards(['3', '3', '3', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '2']);
    ai.setHand(hand);
    const gs = new GameState();
    gs.strictRules = true;
    const hint = ai.getHint(hand, null, true, gs);
    const p = Rules.analyze(hint);
    assert(p.type !== HAND_TYPE.FOUR_WITH_TWO && p.type !== HAND_TYPE.FOUR_WITH_TWO_PAIRS,
        `Hint should not suggest four-with-two under strictRules, got ${p.type}`);
});

// ===== AI respects allowTripleWithSingle / allowAirplaneWithWings =====
test('AIPlayer getHint respects allowTripleWithSingle=false', () => {
    const ai = new AIPlayer('AI');
    const hand = makeCards(['3', '3', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '2', '2']);
    ai.setHand(hand);
    const gs = new GameState();
    gs.allowTripleWithSingle = false;
    gs.allowTripleWithPair = true;
    const hint = ai.getHint(hand, null, true, gs);
    const p = Rules.analyze(hint);
    assert(p.type !== HAND_TYPE.TRIPLE_WITH_SINGLE,
        `Hint should not suggest triple-with-single when disabled, got ${p.type}`);
});

test('AIPlayer getHint respects allowAirplaneWithWings=false', () => {
    const ai = new AIPlayer('AI');
    const hand = makeCards(['3', '3', '3', '4', '4', '4', '5', '5', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
    ai.setHand(hand);
    const gs = new GameState();
    gs.allowAirplaneWithWings = false;
    const hint = ai.getHint(hand, null, true, gs);
    const p = Rules.analyze(hint);
    assert(p.type !== HAND_TYPE.TRIPLE_STRAIGHT_WITH_SINGLES && p.type !== HAND_TYPE.TRIPLE_STRAIGHT_WITH_PAIRS,
        `Hint should not suggest airplane-with-wings when disabled, got ${p.type}`);
});

// ===== mustPlay + hasValidPlays edge cases =====
test('GameState mustPlay blocks pass on new round when hasValidPlays=true', () => {
    const gs = new GameState();
    const p0 = new Player('P0');
    gs.setPlayer(0, p0);
    // P0 有顺子可出
    p0.setHand(makeCards(['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', '2', '2', '3', '4']));
    gs.phase = PHASE.PLAYING;
    gs.currentTurn = 0;
    gs.mustPlay = true;
    gs.allowPassOnFirst = true;
    // 新轮次
    gs.lastPlay = { playerIndex: -1, cards: [], pattern: null };
    gs.passCount = 0;
    assert(gs.hasValidPlays(0) === true, 'Expected hasValidPlays=true on new round');
    const result = gs.pass(0);
    assert(result === false, 'Expected pass to be blocked under mustPlay on new round when cards exist');
});

// ===== Settings & Storage =====
test('Storage.getDefaultSettings contains all gameplay rule defaults', () => {
    const defs = Storage.getDefaultSettings();
    assert(typeof defs.difficulty === 'string', 'difficulty');
    assert(typeof defs.callMode === 'string', 'callMode');
    assert(typeof defs.laiziEnabled === 'boolean', 'laiziEnabled');
    assert(typeof defs.baseScore === 'number', 'baseScore');
    assert(typeof defs.scoreMultiplier === 'number', 'scoreMultiplier');
    assert(typeof defs.allowSpring === 'boolean', 'allowSpring');
    assert(typeof defs.allowAntiSpring === 'boolean', 'allowAntiSpring');
    assert(typeof defs.bombDoubles === 'boolean', 'bombDoubles');
    assert(typeof defs.rocketDoubles === 'boolean', 'rocketDoubles');
    assert(typeof defs.timerEnabled === 'boolean', 'timerEnabled');
    assert(typeof defs.timerSeconds === 'number', 'timerSeconds');
    assert(typeof defs.firstPlayer === 'string', 'firstPlayer');
    assert(typeof defs.jokerRule === 'string', 'jokerRule');
    assert(typeof defs.bombRule === 'string', 'bombRule');
    assert(typeof defs.strictRules === 'boolean', 'strictRules');
    assert(typeof defs.showCards === 'boolean', 'showCards');
    assert(typeof defs.exchangeThree === 'boolean', 'exchangeThree');
    assert(typeof defs.noShuffle === 'boolean', 'noShuffle');
    assert(typeof defs.bottomVisible === 'boolean', 'bottomVisible');
    assert(typeof defs.mustPlay === 'boolean', 'mustPlay');
    assert(typeof defs.allowPassOnFirst === 'boolean', 'allowPassOnFirst');
    assert(typeof defs.allowTripleWithSingle === 'boolean', 'allowTripleWithSingle');
    assert(typeof defs.allowTripleWithPair === 'boolean', 'allowTripleWithPair');
    assert(typeof defs.allowAirplaneWithWings === 'boolean', 'allowAirplaneWithWings');
    assert(typeof defs.bombAsRocket === 'boolean', 'bombAsRocket');
});

test('Storage.getSettings merges missing keys with defaults', () => {
    global.localStorage.setItem('ddz_settings', JSON.stringify({ playerName: 'Test' }));
    const s = Storage.getSettings();
    assert(s.playerName === 'Test', 'preserves existing');
    assert(typeof s.difficulty === 'string', 'fills default difficulty');
    assert(typeof s.bgmVolume === 'number', 'fills default bgmVolume');
    assert(s.enableCallSound === true, 'fills default enableCallSound');
    global.localStorage.removeItem('ddz_settings');
});

test('Storage.resetSettings clears only settings key', () => {
    global.localStorage.setItem('ddz_settings', JSON.stringify({ playerName: 'Test' }));
    global.localStorage.setItem('ddz_stats', JSON.stringify({ gamesPlayed: 5 }));
    global.localStorage.setItem('ddz_achievements', JSON.stringify({ first_game: true }));
    global.localStorage.setItem('ddz_playStyle', JSON.stringify({ games: [] }));
    global.localStorage.setItem('ddz_coach_reviews', JSON.stringify([]));
    const defs = Storage.resetSettings();
    assert(defs.playerName === '玩家', 'returns defaults');
    assert(global.localStorage.getItem('ddz_settings') === null, 'settings removed');
    assert(global.localStorage.getItem('ddz_stats') !== null, 'stats preserved');
    assert(global.localStorage.getItem('ddz_achievements') !== null, 'achievements preserved');
    assert(global.localStorage.getItem('ddz_playStyle') !== null, 'playStyle preserved');
    assert(global.localStorage.getItem('ddz_coach_reviews') !== null, 'coach_reviews preserved');
    global.localStorage.clear();
});

test('Storage.clearStats does not remove playStyle or coach_reviews', () => {
    global.localStorage.setItem('ddz_stats', JSON.stringify({ gamesPlayed: 5 }));
    global.localStorage.setItem('ddz_records', JSON.stringify([]));
    global.localStorage.setItem('ddz_full_games', JSON.stringify([]));
    global.localStorage.setItem('ddz_achievement_progress', JSON.stringify({ totalGames: 5 }));
    global.localStorage.setItem('ddz_playStyle', JSON.stringify({ games: [] }));
    global.localStorage.setItem('ddz_coach_reviews', JSON.stringify([]));
    global.localStorage.setItem('ddz_settings', JSON.stringify({ playerName: 'Test' }));
    Storage.clearStats();
    assert(global.localStorage.getItem('ddz_stats') === null, 'stats cleared');
    assert(global.localStorage.getItem('ddz_records') === null, 'records cleared');
    assert(global.localStorage.getItem('ddz_full_games') === null, 'full_games cleared');
    assert(global.localStorage.getItem('ddz_achievement_progress') === null, 'achievement_progress cleared');
    assert(global.localStorage.getItem('ddz_playStyle') !== null, 'playStyle preserved');
    assert(global.localStorage.getItem('ddz_coach_reviews') !== null, 'coach_reviews preserved');
    assert(global.localStorage.getItem('ddz_settings') !== null, 'settings preserved');
    global.localStorage.clear();
});

// ===== Summary =====
console.log(`\n====================`);
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
console.log(`====================`);
process.exit(failed > 0 ? 1 : 0);

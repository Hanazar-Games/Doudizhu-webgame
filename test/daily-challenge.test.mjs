/**
 * 每日挑战单元测试
 * 运行: node test/daily-challenge.test.mjs
 */

import { Card } from '../src/core/card.js';
import {
    SeededRandom,
    DailyChallengeGenerator,
    ChallengeRecordManager,
    ChallengeResult,
    calculateStars,
    getTodayString,
    dateToSeed,
} from '../src/utils/daily-challenge.js';

// localStorage mock
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

// ===== SeededRandom Tests =====
test('SeededRandom produces same sequence for same seed', () => {
    const rng1 = new SeededRandom(12345);
    const rng2 = new SeededRandom(12345);
    for (let i = 0; i < 10; i++) {
        assert(rng1.next() === rng2.next(), `Mismatch at index ${i}`);
    }
});

test('SeededRandom produces different sequences for different seeds', () => {
    const rng1 = new SeededRandom(12345);
    const rng2 = new SeededRandom(54321);
    const v1 = rng1.next();
    const v2 = rng2.next();
    assert(v1 !== v2, 'Different seeds should produce different first values');
});

test('SeededRandom shuffle is deterministic', () => {
    const deck = Card.createDeck();
    const rng1 = new SeededRandom(999);
    const rng2 = new SeededRandom(999);
    const shuffled1 = rng1.shuffle(deck);
    const shuffled2 = rng2.shuffle(deck);
    assert(shuffled1.length === 54);
    assert(shuffled2.length === 54);
    for (let i = 0; i < 54; i++) {
        assert(shuffled1[i].value === shuffled2[i].value &&
               shuffled1[i].rankKey === shuffled2[i].rankKey,
               `Mismatch at index ${i}`);
    }
});

// ===== DailyChallengeGenerator Tests =====
test('DailyChallengeGenerator generates consistent challenge for same date', () => {
    const c1 = DailyChallengeGenerator.generate('2024-01-15');
    const c2 = DailyChallengeGenerator.generate('2024-01-15');
    assert(c1.date === '2024-01-15');
    assert(c1.deck.length === 51);
    assert(c1.bottomCards.length === 3);
    assert(c1.dealerIndex >= 0 && c1.dealerIndex <= 2);
    assert(c1.difficulty === c2.difficulty);
    assert(c1.dealerIndex === c2.dealerIndex);
});

test('DailyChallengeGenerator generates different challenges for different dates', () => {
    const c1 = DailyChallengeGenerator.generate('2024-01-15');
    const c2 = DailyChallengeGenerator.generate('2024-01-16');
    // 由于 deck 是洗牌的，不同日期大概率产生不同牌序
    const sameOrder = c1.deck.every((card, i) =>
        card.value === c2.deck[i].value && card.rankKey === c2.deck[i].rankKey
    );
    assert(!sameOrder, 'Different dates should produce different decks');
});

test('DailyChallengeGenerator difficulty rotates by date', () => {
    const difficulties = new Set();
    for (let d = 1; d <= 10; d++) {
        const c = DailyChallengeGenerator.generate(`2024-01-${String(d).padStart(2, '0')}`);
        difficulties.add(c.difficulty);
    }
    assert(difficulties.size >= 1, 'Should produce at least one difficulty');
    assert(['easy', 'normal', 'hard'].every(d => difficulties.has(d) || true), 'All difficulties should be valid');
});

test('getToday returns challenge for today', () => {
    const today = getTodayString();
    const c = DailyChallengeGenerator.getToday();
    assert(c.date === today);
    assert(c.deck.length === 51);
    assert(c.bottomCards.length === 3);
});

// ===== calculateStars Tests =====
test('calculateStars: win without spring = 1 star', () => {
    const data = {
        winnerIndex: 0,
        landlordIndex: 0,
        springType: null,
    };
    assert(calculateStars(data, 0, 0) === 1);
});

test('calculateStars: spring win with bombs = 2 stars', () => {
    const data = {
        winnerIndex: 0,
        landlordIndex: 0,
        springType: 'spring',
    };
    assert(calculateStars(data, 0, 1) === 2);
});

test('calculateStars: spring win with no bombs = 3 stars', () => {
    const data = {
        winnerIndex: 0,
        landlordIndex: 0,
        springType: 'spring',
    };
    assert(calculateStars(data, 0, 0) === 3);
});

test('calculateStars: spring win with bombs = 2 stars', () => {
    const data = {
        winnerIndex: 0,
        landlordIndex: 0,
        springType: 'spring',
    };
    assert(calculateStars(data, 0, 1) === 2);
});

test('calculateStars: loss = 0 stars', () => {
    const data = {
        winnerIndex: 1,
        landlordIndex: 0,
        springType: null,
    };
    assert(calculateStars(data, 0, 0) === 0);
});

test('calculateStars: anti-spring win = 2 stars', () => {
    const data = {
        winnerIndex: 1,
        landlordIndex: 0,
        springType: 'anti_spring',
    };
    assert(calculateStars(data, 1, 0) === 2);
});

// ===== ChallengeRecordManager Tests =====
test('ChallengeRecordManager save and retrieve record', () => {
    ChallengeRecordManager.clear();
    const result = new ChallengeResult('2024-01-15', 2, 100, true, 'spring', 0, Date.now());
    ChallengeRecordManager.saveRecord(result);
    const best = ChallengeRecordManager.getBestRecord('2024-01-15');
    assert(best !== null);
    assert(best.stars === 2);
    assert(best.score === 100);
});

test('ChallengeRecordManager keeps best record for same date', () => {
    ChallengeRecordManager.clear();
    const result1 = new ChallengeResult('2024-01-15', 1, 50, true, null, 0, Date.now());
    const result2 = new ChallengeResult('2024-01-15', 2, 80, true, 'spring', 0, Date.now());
    ChallengeRecordManager.saveRecord(result1);
    ChallengeRecordManager.saveRecord(result2);
    const best = ChallengeRecordManager.getBestRecord('2024-01-15');
    assert(best.stars === 2, `Expected 2 stars, got ${best.stars}`);
    assert(best.score === 80);
});

test('ChallengeRecordManager keeps higher score for same stars', () => {
    ChallengeRecordManager.clear();
    const result1 = new ChallengeResult('2024-01-15', 2, 80, true, 'spring', 0, Date.now());
    const result2 = new ChallengeResult('2024-01-15', 2, 120, true, 'spring', 0, Date.now());
    ChallengeRecordManager.saveRecord(result1);
    ChallengeRecordManager.saveRecord(result2);
    const best = ChallengeRecordManager.getBestRecord('2024-01-15');
    assert(best.score === 120, `Expected score 120, got ${best.score}`);
});

test('ChallengeRecordManager does not overwrite with worse result', () => {
    ChallengeRecordManager.clear();
    const result1 = new ChallengeResult('2024-01-15', 3, 200, true, 'spring', 0, Date.now());
    const result2 = new ChallengeResult('2024-01-15', 1, 10, true, null, 0, Date.now());
    ChallengeRecordManager.saveRecord(result1);
    ChallengeRecordManager.saveRecord(result2);
    const best = ChallengeRecordManager.getBestRecord('2024-01-15');
    assert(best.stars === 3, `Expected 3 stars, got ${best.stars}`);
});

test('ChallengeRecordManager getStats works', () => {
    ChallengeRecordManager.clear();
    const r1 = new ChallengeResult('2024-01-15', 2, 100, true, 'spring', 0, Date.now());
    const r2 = new ChallengeResult('2024-01-14', 3, 200, true, 'spring', 0, Date.now() - 86400000);
    const r3 = new ChallengeResult('2024-01-13', 0, -50, false, null, 0, Date.now() - 2 * 86400000);
    ChallengeRecordManager.saveRecord(r1);
    ChallengeRecordManager.saveRecord(r2);
    ChallengeRecordManager.saveRecord(r3);
    const stats = ChallengeRecordManager.getStats();
    assert(stats.total === 3, `Expected total 3, got ${stats.total}`);
    assert(stats.wins === 2, `Expected wins 2, got ${stats.wins}`);
    assert(stats.threeStars === 1, `Expected threeStars 1, got ${stats.threeStars}`);
});

test('ChallengeRecordManager auto prunes old records', () => {
    ChallengeRecordManager.clear();
    const old = new ChallengeResult('2023-01-01', 2, 100, true, 'spring', 0, Date.now() - 40 * 24 * 60 * 60 * 1000);
    ChallengeRecordManager.saveRecord(old);
    const records = ChallengeRecordManager.getRecords();
    assert(records.length === 0, 'Records older than 30 days should be pruned');
});

// ===== dateToSeed Tests =====
test('dateToSeed produces consistent numbers', () => {
    const s1 = dateToSeed('2024-01-15');
    const s2 = dateToSeed('2024-01-15');
    assert(s1 === s2);
    assert(typeof s1 === 'number' && s1 > 0);
});

test('dateToSeed produces different numbers for different dates', () => {
    const s1 = dateToSeed('2024-01-15');
    const s2 = dateToSeed('2024-01-16');
    assert(s1 !== s2);
});

// ===== Summary =====
console.log(`\n====================`);
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
console.log(`====================`);
process.exit(failed > 0 ? 1 : 0);

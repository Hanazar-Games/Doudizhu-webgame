/**
 * Rules - 斗地主牌型规则引擎
 * 负责：牌型识别、合法性判断、大小比较
 */

// 牌型枚举

const HAND_TYPE = {
    INVALID: 'INVALID',
    SINGLE: 'SINGLE',                      // 单张
    PAIR: 'PAIR',                          // 对子
    TRIPLE: 'TRIPLE',                      // 三张
    TRIPLE_WITH_SINGLE: 'TRIPLE_WITH_SINGLE',   // 三带一
    TRIPLE_WITH_PAIR: 'TRIPLE_WITH_PAIR',       // 三带二
    STRAIGHT: 'STRAIGHT',                  // 顺子 (5+)
    DOUBLE_STRAIGHT: 'DOUBLE_STRAIGHT',    // 连对 (3+对)
    TRIPLE_STRAIGHT: 'TRIPLE_STRAIGHT',    // 飞机 (2+连续三张)
    TRIPLE_STRAIGHT_WITH_SINGLES: 'TRIPLE_STRAIGHT_WITH_SINGLES', // 飞机带单
    TRIPLE_STRAIGHT_WITH_PAIRS: 'TRIPLE_STRAIGHT_WITH_PAIRS',     // 飞机带对
    FOUR_WITH_TWO: 'FOUR_WITH_TWO',        // 四带二（单）
    FOUR_WITH_TWO_PAIRS: 'FOUR_WITH_TWO_PAIRS', // 四带两对
    BOMB: 'BOMB',                          // 炸弹
    ROCKET: 'ROCKET',                      // 王炸
};

// 牌型元信息：名称、最小长度等
const HAND_TYPE_INFO = {
    [HAND_TYPE.SINGLE]: { name: '单张', minLength: 1 },
    [HAND_TYPE.PAIR]: { name: '对子', minLength: 2 },
    [HAND_TYPE.TRIPLE]: { name: '三张', minLength: 3 },
    [HAND_TYPE.TRIPLE_WITH_SINGLE]: { name: '三带一', minLength: 4 },
    [HAND_TYPE.TRIPLE_WITH_PAIR]: { name: '三带二', minLength: 5 },
    [HAND_TYPE.STRAIGHT]: { name: '顺子', minLength: 5 },
    [HAND_TYPE.DOUBLE_STRAIGHT]: { name: '连对', minLength: 6 },
    [HAND_TYPE.TRIPLE_STRAIGHT]: { name: '飞机', minLength: 6 },
    [HAND_TYPE.TRIPLE_STRAIGHT_WITH_SINGLES]: { name: '飞机带单', minLength: 8 },
    [HAND_TYPE.TRIPLE_STRAIGHT_WITH_PAIRS]: { name: '飞机带对', minLength: 10 },
    [HAND_TYPE.FOUR_WITH_TWO]: { name: '四带二', minLength: 6 },
    [HAND_TYPE.FOUR_WITH_TWO_PAIRS]: { name: '四带两对', minLength: 8 },
    [HAND_TYPE.BOMB]: { name: '炸弹', minLength: 4 },
    [HAND_TYPE.ROCKET]: { name: '王炸', minLength: 2 },
    PASS: { name: '不出', minLength: 0 },
};

class HandPattern {
    constructor(type, cards, mainValue = 0, length = 0, hasLaizi = false) {
        this.type = type;
        this.cards = cards; // 原始牌数组
        this.mainValue = mainValue; // 用于比较的主牌值
        this.length = length || cards.length; // 牌数
        this.hasLaizi = hasLaizi; // 是否包含癞子
    }

    isValid() {
        return this.type !== HAND_TYPE.INVALID;
    }
}

class Rules {
    // 将牌按点数分组，返回 Map<value, Card[]>
    static groupByValue(cards) {
        const map = new Map();
        for (const card of cards) {
            if (!map.has(card.value)) {
                map.set(card.value, []);
            }
            map.get(card.value).push(card);
        }
        // 按点数排序
        return new Map([...map.entries()].sort((a, b) => a[0] - b[0]));
    }

    // 分析牌型（自动检测癞子）
    static analyze(cards) {
        if (!cards || cards.length === 0) {
            return new HandPattern(HAND_TYPE.INVALID, []);
        }
        
        // 分离癞子
        const laiziCards = cards.filter(c => c.isLaizi);
        const normalCards = cards.filter(c => !c.isLaizi);
        
        if (laiziCards.length === 0) {
            return Rules._analyzeNormal(cards);
        }
        
        return Rules._analyzeWithLaizi(normalCards, laiziCards);
    }
    
    // 无癞子牌型分析
    static _analyzeNormal(cards) {
        const n = cards.length;
        const groups = Rules.groupByValue(cards);
        const groupValues = [...groups.keys()];
        const groupSizes = [...groups.values()].map(g => g.length);

        // 1. 王炸 (2张)
        if (n === 2) {
            const vals = cards.map(c => c.value).sort((a, b) => a - b);
            if (vals[0] === 16 && vals[1] === 17) {
                return new HandPattern(HAND_TYPE.ROCKET, cards, 17, 2);
            }
        }

        // 2. 单张
        if (n === 1) {
            return new HandPattern(HAND_TYPE.SINGLE, cards, cards[0].value, 1);
        }

        // 3. 对子
        if (n === 2 && groupSizes.length === 1 && groupSizes[0] === 2) {
            return new HandPattern(HAND_TYPE.PAIR, cards, groupValues[0], 2);
        }

        // 4. 三张
        if (n === 3 && groupSizes.length === 1 && groupSizes[0] === 3) {
            return new HandPattern(HAND_TYPE.TRIPLE, cards, groupValues[0], 3);
        }

        // 5. 三带一
        if (n === 4 && groupSizes.length === 2 && groupSizes.includes(3) && groupSizes.includes(1)) {
            const mainVal = groupValues.find(v => groups.get(v).length === 3);
            return new HandPattern(HAND_TYPE.TRIPLE_WITH_SINGLE, cards, mainVal, 4);
        }

        // 6. 三带二
        if (n === 5 && groupSizes.length === 2 && groupSizes.includes(3) && groupSizes.includes(2)) {
            const mainVal = groupValues.find(v => groups.get(v).length === 3);
            return new HandPattern(HAND_TYPE.TRIPLE_WITH_PAIR, cards, mainVal, 5);
        }

        // 7. 炸弹 (4张同值)
        if (n === 4 && groupSizes.length === 1 && groupSizes[0] === 4) {
            return new HandPattern(HAND_TYPE.BOMB, cards, groupValues[0], 4);
        }

        // 8. 顺子 (5+连续单张, 不能含2和王)
        if (n >= 5 && groupSizes.every(s => s === 1)) {
            if (Rules.isConsecutive(groupValues) && groupValues[groupValues.length - 1] <= 14) {
                return new HandPattern(HAND_TYPE.STRAIGHT, cards, groupValues[groupValues.length - 1], n);
            }
        }

        // 9. 连对 (3+连续对子, 不能含2和王)
        if (n >= 6 && n % 2 === 0 && groupSizes.every(s => s === 2)) {
            if (Rules.isConsecutive(groupValues) && groupValues[groupValues.length - 1] <= 14) {
                return new HandPattern(HAND_TYPE.DOUBLE_STRAIGHT, cards, groupValues[groupValues.length - 1], n);
            }
        }

        // 10. 飞机 (2+连续三张, 不能含2和王)
        if (n >= 6 && n % 3 === 0 && groupSizes.every(s => s === 3)) {
            if (Rules.isConsecutive(groupValues) && groupValues[groupValues.length - 1] <= 14) {
                return new HandPattern(HAND_TYPE.TRIPLE_STRAIGHT, cards, groupValues[groupValues.length - 1], n);
            }
        }

        // 11. 飞机带单
        if (n >= 8 && (n % 4 === 0)) {
            const triples = [];
            const singles = [];
            for (const [val, grp] of groups) {
                if (grp.length === 3) triples.push(val);
                else if (grp.length === 1) singles.push(val);
            }
            const k = n / 4;
            if (triples.length === k && singles.length === k && Rules.isConsecutive(triples) && triples[triples.length - 1] <= 14) {
                return new HandPattern(HAND_TYPE.TRIPLE_STRAIGHT_WITH_SINGLES, cards, triples[triples.length - 1], n);
            }
        }

        // 12. 飞机带对
        if (n >= 10 && (n % 5 === 0)) {
            const triples = [];
            const pairs = [];
            for (const [val, grp] of groups) {
                if (grp.length === 3) triples.push(val);
                else if (grp.length === 2) pairs.push(val);
            }
            const k = n / 5;
            if (triples.length === k && pairs.length === k && Rules.isConsecutive(triples) && triples[triples.length - 1] <= 14) {
                return new HandPattern(HAND_TYPE.TRIPLE_STRAIGHT_WITH_PAIRS, cards, triples[triples.length - 1], n);
            }
        }

        // 13. 四带二（单）
        if (n === 6) {
            const fourVal = groupValues.find(v => groups.get(v).length === 4);
            const singles = groupValues.filter(v => groups.get(v).length === 1);
            if (fourVal && singles.length === 2) {
                return new HandPattern(HAND_TYPE.FOUR_WITH_TWO, cards, fourVal, 6);
            }
        }

        // 14. 四带两对
        if (n === 8) {
            const fourVal = groupValues.find(v => groups.get(v).length === 4);
            const pairs = groupValues.filter(v => groups.get(v).length === 2);
            if (fourVal && pairs.length === 2) {
                return new HandPattern(HAND_TYPE.FOUR_WITH_TWO_PAIRS, cards, fourVal, 8);
            }
        }

        return new HandPattern(HAND_TYPE.INVALID, cards);
    }
    
    static _analyzeWithLaizi(normalCards, laiziCards) {
        const cards = [...normalCards, ...laiziCards];
        const n = cards.length;
        if (n === 1) return new HandPattern(HAND_TYPE.SINGLE, cards, cards[0].value, 1, true);
        if (n === 2 && cards.some(c => c.value === 16) && cards.some(c => c.value === 17)) {
            return new HandPattern(HAND_TYPE.ROCKET, cards, 17, 2);
        }
        const groups = Rules.groupByValue(normalCards);
        const match = (body, wingCount = 0, wingSize = 0) => {
            const target = new Map(body);
            let missing = 0;
            for (const [value, count] of target) {
                const actual = groups.get(value)?.length || 0;
                if (actual > count) return false;
                missing += count - actual;
            }
            const wings = [...groups].filter(([value]) => !target.has(value));
            if (wings.length > wingCount) return false;
            for (const [value, group] of wings) {
                if (group.length > wingSize || (wingSize > 1 && value > 15)) return false;
                missing += wingSize - group.length;
            }
            missing += (wingCount - wings.length) * wingSize;
            return missing === laiziCards.length;
        };
        const singleBody = (type, size, wingCount = 0, wingSize = 0) => {
            for (let value = 3; value <= 15; value++) {
                if (match([[value, size]], wingCount, wingSize)) return new HandPattern(type, cards, value, n, true);
            }
        };
        let pattern;
        if (n === 2) pattern = singleBody(HAND_TYPE.PAIR, 2);
        if (n === 3) pattern = singleBody(HAND_TYPE.TRIPLE, 3);
        if (n === 4) pattern = singleBody(HAND_TYPE.BOMB, 4) || singleBody(HAND_TYPE.TRIPLE_WITH_SINGLE, 3, 1, 1);
        if (n === 5) pattern = singleBody(HAND_TYPE.TRIPLE_WITH_PAIR, 3, 1, 2);
        if (pattern) return pattern;
        const sequences = [
            [HAND_TYPE.STRAIGHT, 1, 0, 5],
            [HAND_TYPE.DOUBLE_STRAIGHT, 2, 0, 3],
            [HAND_TYPE.TRIPLE_STRAIGHT, 3, 0, 2],
            [HAND_TYPE.TRIPLE_STRAIGHT_WITH_SINGLES, 3, 1, 2],
            [HAND_TYPE.TRIPLE_STRAIGHT_WITH_PAIRS, 3, 2, 2],
        ];
        for (const [type, count, wingSize, minimum] of sequences) {
            const length = n / (count + wingSize);
            if (!Number.isInteger(length) || length < minimum || length > 12) continue;
            for (let start = 3; start + length - 1 <= 14; start++) {
                const body = Array.from({ length }, (_, i) => [start + i, count]);
                if (match(body, wingSize ? length : 0, wingSize)) {
                    return new HandPattern(type, cards, start + length - 1, n, true);
                }
            }
        }
        if (n === 6) pattern = singleBody(HAND_TYPE.FOUR_WITH_TWO, 4, 2, 1);
        if (n === 8) pattern = singleBody(HAND_TYPE.FOUR_WITH_TWO_PAIRS, 4, 2, 2);
        return pattern || new HandPattern(HAND_TYPE.INVALID, cards);
    }

    static *_wildcardCandidates(handCards, lengths) {
        const wildcards = handCards.filter(card => card.isLaizi);
        const groups = [...Rules.groupByValue(handCards.filter(card => !card.isLaizi)).values()];
        const remaining = new Array(groups.length + 1).fill(0);
        for (let i = groups.length - 1; i >= 0; i--) remaining[i] = remaining[i + 1] + groups[i].length;
        function* pick(index, count, selected) {
            if (count === 0) { yield selected; return; }
            if (remaining[index] < count || index === groups.length) return;
            const group = groups[index];
            for (let take = Math.min(group.length, count); take >= 0; take--) {
                yield* pick(index + 1, count - take, [...selected, ...group.slice(0, take)]);
            }
        }
        for (const length of new Set(lengths)) {
            if (length > handCards.length || length < 1) continue;
            for (let count = 1; count <= Math.min(wildcards.length, length); count++) {
                for (const natural of pick(0, length - count, [])) yield [...natural, ...wildcards.slice(0, count)];
            }
        }
    }

    // 判断数值数组是否连续
    static isConsecutive(arr) {
        if (arr.length < 2) return true;
        for (let i = 1; i < arr.length; i++) {
            if (arr[i] - arr[i - 1] !== 1) return false;
        }
        return true;
    }

    // 比较两个牌型大小：current 能否打过 last
    // last 为 null 表示当前玩家是首家出牌，只要合法即可
    static canBeat(lastPattern, currentPattern) {
        if (!currentPattern.isValid()) return false;
        if (!lastPattern || lastPattern.type === HAND_TYPE.INVALID) return true;

        // 火箭最大
        if (currentPattern.type === HAND_TYPE.ROCKET) return true;
        if (lastPattern.type === HAND_TYPE.ROCKET) return false;

        // 炸弹可以打任何非炸弹
        if (currentPattern.type === HAND_TYPE.BOMB) {
            if (lastPattern.type !== HAND_TYPE.BOMB) return true;
            // 主值不同，主值大者胜
            if (currentPattern.mainValue !== lastPattern.mainValue) {
                return currentPattern.mainValue > lastPattern.mainValue;
            }
            // 主值相同：硬炸弹 > 软炸弹
            if (currentPattern.hasLaizi !== lastPattern.hasLaizi) {
                return !currentPattern.hasLaizi; // 无癞子(硬) > 有癞子(软)
            }
            return false;
        }
        if (lastPattern.type === HAND_TYPE.BOMB) return false;

        // 普通牌型：类型相同、长度相同、主值更大
        if (currentPattern.type !== lastPattern.type) return false;
        if (currentPattern.length !== lastPattern.length) return false;
        return currentPattern.mainValue > lastPattern.mainValue;
    }

    // 便捷方法：直接判断一组牌能否打过另一组
    static canCardsBeat(lastCards, currentCards) {
        return Rules.canBeat(
            lastCards ? Rules.analyze(lastCards) : null,
            Rules.analyze(currentCards)
        );
    }

    // 获取牌型名称
    static getTypeName(type) {
        return HAND_TYPE_INFO[type]?.name || '未知';
    }

    // 从手牌中找出所有可能的合法出牌方案（用于"提示"功能）
    // 返回 [{cards, pattern, typeName, desc}, ...]
    static findAllLegalPlays(handCards) {
        const results = [];
        const groups = Rules.groupByValue(handCards);
        const groupEntries = [...groups.entries()];
        const values = [...groups.keys()];
        
        const addResult = (cards) => {
            const pat = Rules.analyze(cards);
            if (pat.isValid()) {
                results.push({
                    cards,
                    pattern: pat,
                    typeName: Rules.getTypeName(pat.type),
                    desc: `${Rules.getTypeName(pat.type)} ${pat.mainValue}`,
                });
            }
        };
        
        const wildcards = handCards.filter(card => card.isLaizi);
        if (wildcards.length) {
            for (const cards of Rules._wildcardCandidates(handCards, [2, 3, 4, handCards.length])) addResult(cards);
            const natural = Rules.groupByValue(handCards.filter(card => !card.isLaizi));
            for (const count of [1, 2, 3]) {
                const minimum = count === 1 ? 5 : count === 2 ? 3 : 2;
                for (let length = minimum; length * count <= handCards.length; length++) {
                    for (let start = 3; start + length - 1 <= 14; start++) {
                        const selected = [];
                        for (let value = start; value < start + length; value++) selected.push(...(natural.get(value) || []).slice(0, count));
                        const missing = length * count - selected.length;
                        if (missing > 0 && missing <= wildcards.length) addResult([...selected, ...wildcards.slice(0, missing)]);
                    }
                }
            }
        }

        // 1. 单张
        for (const card of handCards) {
            addResult([card]);
        }
        
        // 2. 对子
        for (const [val, grp] of groupEntries) {
            if (grp.length >= 2) addResult(grp.slice(0, 2));
        }
        
        // 3. 三张
        for (const [val, grp] of groupEntries) {
            if (grp.length >= 3) addResult(grp.slice(0, 3));
        }
        
        // 4. 三带一 / 三带二
        for (const [val, grp] of groupEntries) {
            if (grp.length >= 3) {
                const triple = grp.slice(0, 3);
                for (const [v2, g2] of groupEntries) {
                    if (v2 === val) continue;
                    addResult([...triple, g2[0]]);
                    if (g2.length >= 2) addResult([...triple, g2[0], g2[1]]);
                }
            }
        }
        
        // 5. 炸弹
        for (const [val, grp] of groupEntries) {
            if (grp.length === 4) addResult(grp);
        }
        
        // 6. 王炸
        if (groups.has(16) && groups.has(17)) {
            addResult([groups.get(16)[0], groups.get(17)[0]]);
        }
        
        // 7. 顺子 (5+, 不含2和王)
        const normalValues = values.filter(v => v <= 14).sort((a, b) => a - b);
        for (let start = 0; start < normalValues.length; start++) {
            for (let end = start + 4; end < normalValues.length; end++) {
                const seq = normalValues.slice(start, end + 1);
                if (Rules.isConsecutive(seq)) {
                    addResult(seq.map(v => groups.get(v)[0]));
                } else break;
            }
        }
        
        // 8. 连对 (3+对, 不含2和王)
        const pairValues = groupEntries.filter(([v, g]) => g.length >= 2 && v <= 14).map(([v]) => v).sort((a, b) => a - b);
        for (let start = 0; start < pairValues.length; start++) {
            for (let end = start + 2; end < pairValues.length; end++) {
                const seq = pairValues.slice(start, end + 1);
                if (Rules.isConsecutive(seq)) {
                    const pick = [];
                    for (const v of seq) pick.push(groups.get(v)[0], groups.get(v)[1]);
                    addResult(pick);
                } else break;
            }
        }
        
        // 9. 飞机 (2+连续三张, 不含2和王)
        const tripleValues = groupEntries.filter(([v, g]) => g.length >= 3 && v <= 14).map(([v]) => v).sort((a, b) => a - b);
        for (let start = 0; start < tripleValues.length; start++) {
            for (let end = start + 1; end < tripleValues.length; end++) {
                const seq = tripleValues.slice(start, end + 1);
                if (Rules.isConsecutive(seq)) {
                    const pick = [];
                    for (const v of seq) pick.push(groups.get(v)[0], groups.get(v)[1], groups.get(v)[2]);
                    addResult(pick);
                } else break;
            }
        }
        
        // 10. 飞机带单 / 带对
        for (let start = 0; start < tripleValues.length; start++) {
            for (let end = start + 1; end < tripleValues.length; end++) {
                const seq = tripleValues.slice(start, end + 1);
                if (!Rules.isConsecutive(seq)) continue;
                const k = seq.length;
                const triplePick = [];
                for (const v of seq) triplePick.push(groups.get(v)[0], groups.get(v)[1], groups.get(v)[2]);
                
                // 找翅膀
                const remaining = handCards.filter(c => !seq.includes(c.value));
                const remGroups = Rules.groupByValue(remaining);
                const remEntries = [...remGroups.entries()];
                
                // 带单
                const singles = remEntries.filter(([v, g]) => g.length >= 1).map(([v, g]) => g[0]);
                if (singles.length >= k) {
                    const combos = Rules._combination(singles, k);
                    for (const c of combos) addResult([...triplePick, ...c]);
                }
                
                // 带对
                const pairs = remEntries.filter(([v, g]) => g.length >= 2).map(([v, g]) => [g[0], g[1]]);
                if (pairs.length >= k) {
                    const pairCombos = Rules._combination(pairs, k);
                    for (const pc of pairCombos) addResult([...triplePick, ...pc.flat()]);
                }
            }
        }
        
        // 11. 四带二 / 四带两对
        for (const [val, grp] of groupEntries) {
            if (grp.length === 4) {
                const four = grp;
                // 四带二单
                const singles = groupEntries.filter(([v, g]) => v !== val && g.length >= 1).map(([v, g]) => g[0]);
                const singleCombos = Rules._combination(singles, 2);
                for (const sc of singleCombos) addResult([...four, ...sc]);
                
                // 四带两对
                const pairs = groupEntries.filter(([v, g]) => v !== val && g.length >= 2).map(([v, g]) => [g[0], g[1]]);
                const pairCombos = Rules._combination(pairs, 2);
                for (const pc of pairCombos) addResult([...four, ...pc.flat()]);
            }
        }
        
        // 去重
        const seen = new Set();
        const unique = [];
        for (const r of results) {
            const key = r.cards.map(c => c.value + (c.suit?.name || '')).sort().join(',');
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(r);
            }
        }
        
        // 排序：小牌优先，牌数多的优先（先出长牌型）
        unique.sort((a, b) => {
            if (a.pattern.type === 'ROCKET') return 1;
            if (b.pattern.type === 'ROCKET') return -1;
            if (a.pattern.type === 'BOMB' && b.pattern.type !== 'BOMB') return 1;
            if (b.pattern.type === 'BOMB' && a.pattern.type !== 'BOMB') return -1;
            if (a.cards.length !== b.cards.length) return b.cards.length - a.cards.length;
            return a.pattern.mainValue - b.pattern.mainValue;
        });
        
        return unique;
    }
    
    // 辅助：组合生成
    static _combination(arr, k) {
        if (k === 0) return [[]];
        if (arr.length < k) return [];
        const res = [];
        for (let i = 0; i <= arr.length - k; i++) {
            const sub = Rules._combination(arr.slice(i + 1), k - 1);
            for (const s of sub) res.push([arr[i], ...s]);
        }
        return res;
    }

    // 从手牌中找出所有能打过当前牌型的出牌方案
    // 返回 Card[][]，每个元素是一种出牌方案
    static findAllBeats(handCards, lastPattern, bombAsRocket = false) {
        const results = [];
        if (!lastPattern || !lastPattern.isValid()) {
            // 首家出牌：返回所有合法牌型（通常游戏会限制，这里先返回单张）
            // 实际使用时由调用方控制
            return results;
        }

        if (handCards.some(card => card.isLaizi)) {
            const beats = Rules.findAllBeats(handCards.filter(card => !card.isLaizi), lastPattern, bombAsRocket);
            for (const cards of Rules._wildcardCandidates(handCards, [lastPattern.length, 4, 2])) {
                const pattern = Rules.analyze(cards);
                if (pattern.isValid() && (Rules.canBeat(lastPattern, pattern) ||
                    (bombAsRocket && lastPattern.type === HAND_TYPE.ROCKET && pattern.type === HAND_TYPE.BOMB))) beats.push(cards);
            }
            return beats;
        }

        const n = handCards.length;
        const groups = Rules.groupByValue(handCards);
        const groupEntries = [...groups.entries()]; // [value, Card[]]

        // 辅助：生成组合
        const combos = (arr, k) => {
            if (k === 0) return [[]];
            if (arr.length < k) return [];
            const res = [];
            for (let i = 0; i <= arr.length - k; i++) {
                const sub = combos(arr.slice(i + 1), k - 1);
                for (const s of sub) res.push([arr[i], ...s]);
            }
            return res;
        };

        if ([HAND_TYPE.TRIPLE_STRAIGHT_WITH_SINGLES, HAND_TYPE.TRIPLE_STRAIGHT_WITH_PAIRS,
            HAND_TYPE.FOUR_WITH_TWO, HAND_TYPE.FOUR_WITH_TWO_PAIRS].includes(lastPattern.type)) {
            return Rules.findAllLegalPlays(handCards)
                .filter(play => Rules.canBeat(lastPattern, play.pattern)).map(play => play.cards);
        }

        if (bombAsRocket && lastPattern.type === HAND_TYPE.ROCKET) {
            return Rules.findAllLegalPlays(handCards).filter(play => play.pattern.type === HAND_TYPE.BOMB).map(play => play.cards);
        }

        // 根据lastPattern类型搜索
        const type = lastPattern.type;
        const len = lastPattern.length;
        const mainVal = lastPattern.mainValue;

        // 1. 火箭直接忽略（打不过）
        // 2. 炸弹/火箭直接检查
        if (type !== HAND_TYPE.ROCKET) {
            // 检查是否有更大的炸弹
            for (const [val, grp] of groupEntries) {
                if (grp.length === 4) {
                    if (type === HAND_TYPE.BOMB) {
                        // 炸弹对炸弹：需要更大
                        if (val > mainVal) results.push(grp);
                    } else {
                        // 任何炸弹都能打败非炸弹
                        results.push(grp);
                    }
                }
            }
            // 检查火箭
            if (groups.has(16) && groups.has(17)) {
                results.push([groups.get(16)[0], groups.get(17)[0]]);
            }
        }

        // 同类型比较
        switch (type) {
            case HAND_TYPE.SINGLE: {
                for (const card of handCards) {
                    if (card.value > mainVal) results.push([card]);
                }
                break;
            }
            case HAND_TYPE.PAIR: {
                for (const [val, grp] of groupEntries) {
                    if (grp.length >= 2 && val > mainVal) {
                        results.push(grp.slice(0, 2));
                    }
                }
                break;
            }
            case HAND_TYPE.TRIPLE: {
                for (const [val, grp] of groupEntries) {
                    if (grp.length >= 3 && val > mainVal) {
                        results.push(grp.slice(0, 3));
                    }
                }
                break;
            }
            case HAND_TYPE.TRIPLE_WITH_SINGLE: {
                const triples = groupEntries.filter(([v, g]) => g.length >= 3 && v > mainVal);
                for (const [v, g] of triples) {
                    const triple = g.slice(0, 3);
                    for (const [v2, g2] of groupEntries) {
                        if (v2 !== v) {
                            results.push([...triple, g2[0]]);
                        }
                    }
                }
                break;
            }
            case HAND_TYPE.TRIPLE_WITH_PAIR: {
                const triples = groupEntries.filter(([v, g]) => g.length >= 3 && v > mainVal);
                for (const [v, g] of triples) {
                    const triple = g.slice(0, 3);
                    for (const [v2, g2] of groupEntries) {
                        if (v2 !== v && g2.length >= 2) {
                            results.push([...triple, g2[0], g2[1]]);
                        }
                    }
                }
                break;
            }
            case HAND_TYPE.STRAIGHT: {
                const k = len;
                const values = [...groups.keys()].filter(v => v <= 14).sort((a, b) => a - b);
                for (let i = 0; i <= values.length - k; i++) {
                    const seq = values.slice(i, i + k);
                    if (Rules.isConsecutive(seq) && seq[seq.length - 1] > mainVal) {
                        const pick = seq.map(v => groups.get(v)[0]);
                        results.push(pick);
                    }
                }
                break;
            }
            case HAND_TYPE.DOUBLE_STRAIGHT: {
                const pairCount = len / 2;
                const pairValues = groupEntries.filter(([v, g]) => g.length >= 2 && v <= 14).map(([v]) => v);
                for (let i = 0; i <= pairValues.length - pairCount; i++) {
                    const seq = pairValues.slice(i, i + pairCount);
                    if (Rules.isConsecutive(seq) && seq[seq.length - 1] > mainVal) {
                        const pick = [];
                        for (const v of seq) pick.push(groups.get(v)[0], groups.get(v)[1]);
                        results.push(pick);
                    }
                }
                break;
            }
            case HAND_TYPE.TRIPLE_STRAIGHT: {
                const tripleCount = len / 3;
                const tripleValues = groupEntries.filter(([v, g]) => g.length >= 3 && v <= 14).map(([v]) => v);
                for (let i = 0; i <= tripleValues.length - tripleCount; i++) {
                    const seq = tripleValues.slice(i, i + tripleCount);
                    if (Rules.isConsecutive(seq) && seq[seq.length - 1] > mainVal) {
                        const pick = [];
                        for (const v of seq) pick.push(groups.get(v)[0], groups.get(v)[1], groups.get(v)[2]);
                        results.push(pick);
                    }
                }
                break;
            }
            case HAND_TYPE.BOMB: {
                for (const [val, grp] of groupEntries) {
                    if (grp.length === 4 && val > mainVal) {
                        results.push(grp);
                    }
                }
                break;
            }
            // 其他复杂牌型暂不自动搜索（由AI或玩家自行选择）
        }

        // 去重（基于牌的id，但Card没有id，这里用toString拼接去重）
        const seen = new Set();
        const unique = [];
        for (const r of results) {
            const key = r.map(c => c.value + (c.suit?.name || '')).sort().join(',');
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(r);
            }
        }
        return unique;
    }
}

export { Rules, HandPattern, HAND_TYPE, HAND_TYPE_INFO };

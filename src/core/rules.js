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
    
    // 癞子牌型分析
    static _analyzeWithLaizi(normalCards, laiziCards) {
        const n = normalCards.length + laiziCards.length;
        const laiziCount = laiziCards.length;
        const allCards = [...normalCards, ...laiziCards];
        
        // 对 normalCards 分组
        const groups = Rules.groupByValue(normalCards);
        const groupValues = [...groups.keys()];
        const groupSizes = [...groups.values()].map(g => g.length);
        
        // 单张
        if (n === 1) {
            return new HandPattern(HAND_TYPE.SINGLE, allCards, allCards[0].value, 1, laiziCount > 0);
        }
        
        // 对子: 0真+2癞 / 1真+1癞 / 2真
        if (n === 2) {
            if (normalCards.length === 2 && groupSizes.length === 1) {
                return new HandPattern(HAND_TYPE.PAIR, allCards, groupValues[0], 2, false);
            }
            if (normalCards.length === 1 && laiziCount === 1) {
                return new HandPattern(HAND_TYPE.PAIR, allCards, normalCards[0].value, 2, true);
            }
            if (normalCards.length === 0 && laiziCount === 2) {
                return new HandPattern(HAND_TYPE.PAIR, allCards, 3, 2, true); // 最小对子
            }
        }
        
        // 三张: 0真+3癞 / 1真+2癞 / 2真+1癞 / 3真
        if (n === 3) {
            if (normalCards.length >= 1 && groupSizes.length <= 1) {
                const mainVal = groupValues[0] || normalCards[0].value;
                return new HandPattern(HAND_TYPE.TRIPLE, allCards, mainVal, 3, laiziCount > 0);
            }
            if (normalCards.length === 0 && laiziCount === 3) {
                return new HandPattern(HAND_TYPE.TRIPLE, allCards, 3, 3, true); // 最小三张
            }
        }
        
        // 炸弹: 0真+4癞 / 用癞子补齐到4张
        if (n === 4) {
            if (normalCards.length === 0 && laiziCount === 4) {
                return new HandPattern(HAND_TYPE.BOMB, allCards, 3, 4, true); // 最小炸弹
            }
            // 所有真实牌同值
            if (groupSizes.length === 1 && normalCards.length + laiziCount === 4) {
                return new HandPattern(HAND_TYPE.BOMB, allCards, groupValues[0], 4, laiziCount > 0);
            }
            // 1-3张同值 + 癞子补齐
            if (groupSizes.length === 1 && groupSizes[0] + laiziCount === 4) {
                return new HandPattern(HAND_TYPE.BOMB, allCards, groupValues[0], 4, true);
            }
        }
        
        // 三带一
        if (n === 4) {
            // 找是否有某个值的真实牌数量+癞子 >= 3
            for (const [val, grp] of groups) {
                const needForTriple = 3 - grp.length;
                const remainingLaizi = laiziCount - needForTriple;
                if (needForTriple <= laiziCount && remainingLaizi >= 0) {
                    // 剩下的牌作为单张
                    const remaining = normalCards.filter(c => c.value !== val);
                    if (remaining.length === 1 && remainingLaizi === 0) {
                        return new HandPattern(HAND_TYPE.TRIPLE_WITH_SINGLE, allCards, val, 4, laiziCount > 0);
                    }
                    if (remaining.length === 0 && remainingLaizi === 1) {
                        return new HandPattern(HAND_TYPE.TRIPLE_WITH_SINGLE, allCards, val, 4, true);
                    }
                }
            }
        }
        
        // 三带二
        if (n === 5) {
            for (const [val, grp] of groups) {
                const needForTriple = 3 - grp.length;
                const remainingLaizi = laiziCount - needForTriple;
                if (needForTriple <= laiziCount && remainingLaizi >= 0) {
                    const remaining = normalCards.filter(c => c.value !== val);
                    const remainingGroups = Rules.groupByValue(remaining);
                    // 剩下的要组成对子
                    if (remaining.length === 2 && [...remainingGroups.values()][0]?.length === 2 && remainingLaizi === 0) {
                        return new HandPattern(HAND_TYPE.TRIPLE_WITH_PAIR, allCards, val, 5, laiziCount > 0);
                    }
                    if (remaining.length === 1 && remainingLaizi === 1) {
                        return new HandPattern(HAND_TYPE.TRIPLE_WITH_PAIR, allCards, val, 5, true);
                    }
                    if (remaining.length === 0 && remainingLaizi === 2) {
                        return new HandPattern(HAND_TYPE.TRIPLE_WITH_PAIR, allCards, val, 5, true);
                    }
                }
            }
        }
        
        // 顺子（简化：只支持纯牌或1张癞子替代缺口）
        if (n >= 5 && n <= 12) {
            const result = Rules._tryStraightWithLaizi(normalCards, laiziCards);
            if (result) return result;
        }
        
        // 四带二（简化支持）
        if (n === 6) {
            for (const [val, grp] of groups) {
                const needForFour = 4 - grp.length;
                if (needForFour <= laiziCount) {
                    const remaining = normalCards.filter(c => c.value !== val);
                    const remainingLaizi = laiziCount - needForFour;
                    const remGroups = Rules.groupByValue(remaining);
                    const remSizes = [...remGroups.values()].map(g => g.length);
                    if (remaining.length === 2 && remSizes.every(s => s === 1) && remainingLaizi === 0) {
                        return new HandPattern(HAND_TYPE.FOUR_WITH_TWO, allCards, val, 6, laiziCount > 0);
                    }
                }
            }
        }
        
        return new HandPattern(HAND_TYPE.INVALID, allCards);
    }
    
    // 尝试用癞子组成顺子
    static _tryStraightWithLaizi(normalCards, laiziCards) {
        const n = normalCards.length + laiziCards.length;
        const laiziCount = laiziCards.length;
        const allCards = [...normalCards, ...laiziCards];
        
        // 所有真实牌必须是单张（不能有重复值，除非重复值是癞子可替代的）
        if (normalCards.some(c => c.value >= 15)) return null;
        const values = [...new Set(normalCards.map(c => c.value))].filter(v => v <= 14).sort((a, b) => a - b);
        if (values.length === 0 && laiziCount >= 5) {
            // 全是癞子，最小顺子 3-7
            return new HandPattern(HAND_TYPE.STRAIGHT, allCards, 7, n, true);
        }
        
        // 尝试找到以某个值为起点/终点的顺子
        // 枚举所有可能的顺子长度和起点
        for (let len = 5; len <= n; len++) {
            for (let start = 3; start <= 14 - len + 1; start++) { // 14=A，顺子最大到A
                const target = [];
                for (let v = start; v < start + len; v++) target.push(v);
                
                let needLaizi = 0;
                const usedValues = new Set();
                for (const v of target) {
                    const hasCard = normalCards.some(c => c.value === v && !usedValues.has(v));
                    if (!hasCard) {
                        needLaizi++;
                    } else {
                        usedValues.add(v);
                    }
                }
                
                if (needLaizi === laiziCount && len === n && usedValues.size === values.length) {
                    return new HandPattern(HAND_TYPE.STRAIGHT, allCards, start + len - 1, n, laiziCount > 0);
                }
            }
        }
        
        return null;
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
        
        // 10. 飞机带单 / 带对 (简化：只生成2-3连的飞机)
        for (let start = 0; start < tripleValues.length; start++) {
            for (let end = start + 1; end < Math.min(start + 3, tripleValues.length); end++) {
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
    static findAllBeats(handCards, lastPattern) {
        const results = [];
        if (!lastPattern || !lastPattern.isValid()) {
            // 首家出牌：返回所有合法牌型（通常游戏会限制，这里先返回单张）
            // 实际使用时由调用方控制
            return results;
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

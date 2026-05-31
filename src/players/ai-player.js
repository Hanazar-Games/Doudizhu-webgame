/**
 * AIPlayer - AI玩家
 * 基于规则的AI，具备叫分和出牌策略
 */

import { Card } from '../core/card.js';
import { Rules } from '../core/rules.js';
import { Player } from './player.js';

class AIPlayer extends Player {
    constructor(name, difficulty = 'normal') {
        super(name, true);
        this.difficulty = difficulty; // easy, normal, hard
    }
    
    // AI 快捷短语库
    static getPhrase(context) {
        const PHRASES = {
            call: ['这牌我拿了！', '地主是我的', '看我的', '有信心'],
            noCall: ['牌太烂了', 'pass', '不要', '下一轮'],
            grab: ['抢！', '跟你抢了', '加倍！', '不让'],
            noGrab: ['不抢', '让了', 'pass'],
            bomb: ['炸弹！', 'Boom！', '轰！', '吃我一炸'],
            rocket: ['王炸！', '火箭！', '绝杀！', '终极武器'],
            straight: ['顺子~', '一条龙', '连着走'],
            plane: ['飞机~', '轰轰轰', '三连发'],
            pair: ['对子', '一对'],
            triple: ['三张', '三个'],
            play: ['接招', '小样', '出', '走你'],
            pass: ['要不起', '过', '不要', 'pass', '大你不起'],
            spring: ['春天！', '碾压', '太强了'],
        };
        const list = PHRASES[context] || PHRASES.play;
        return list[Math.floor(Math.random() * list.length)];
    }

    // 叫分决策（支持叫分和抢地主两种模式）
    async decideCall(gameState) {
        const hand = this.hand;
        let strength = 0;

        // 评估手牌强度
        const groups = Rules.groupByValue(hand);
        
        // 有王炸/炸弹加分
        if (groups.has(16) && groups.has(17)) strength += 5;
        for (const [val, grp] of groups) {
            if (grp.length === 4) strength += 3;
            if (val >= 15) strength += 1; // 2牌加分
        }
        
        // 大牌数量
        const bigCards = hand.filter(c => c.value >= 12).length;
        strength += bigCards * 0.3;
        
        // 顺子潜力
        const values = [...groups.keys()].filter(v => v <= 14).sort((a, b) => a - b);
        let straightLen = 1, maxStraight = 1;
        for (let i = 1; i < values.length; i++) {
            if (values[i] - values[i-1] === 1) straightLen++;
            else straightLen = 1;
            maxStraight = Math.max(maxStraight, straightLen);
        }
        if (maxStraight >= 5) strength += 1;
        
        // 牌型丰富度（越少单张越好）
        const singleCount = [...groups.values()].filter(g => g.length === 1).length;
        strength -= singleCount * 0.2;

        // 抢地主模式
        if (gameState.callMode === 'grab') {
            return this._decideGrab(strength, gameState);
        }

        // 叫分模式
        let threshold = 3;
        if (this.difficulty === 'easy') threshold = 5;
        if (this.difficulty === 'hard') threshold = 2;

        if (strength >= threshold + 3) return 3;
        if (strength >= threshold + 1) return 2;
        if (strength >= threshold) return 1;
        return 0;
    }
    
    // 抢地主决策
    _decideGrab(strength, gameState) {
        // 叫地主阶段
        if (gameState.grabPhase === 'call') {
            let threshold = 4;
            if (this.difficulty === 'easy') threshold = 6;
            if (this.difficulty === 'hard') threshold = 3;
            // 如果前面有人叫了，要求更高才会叫
            if (gameState.currentCallPlayer >= 0) threshold += 1;
            return strength >= threshold ? 1 : 0; // 1=叫地主, 0=不叫
        }
        
        // 抢地主阶段
        let threshold = 5;
        if (this.difficulty === 'easy') threshold = 7;
        if (this.difficulty === 'hard') threshold = 4;
        // 倍数越高越谨慎
        if (gameState.grabMultiplier >= 4) threshold += 1;
        if (gameState.grabMultiplier >= 8) threshold += 2;
        return strength >= threshold ? 2 : 0; // 2=抢地主, 0=不抢
    }

    // 出牌决策
    async decidePlay(gameState, lastPattern) {
        const isNewRound = !lastPattern ||
                           !lastPattern.isValid() ||
                           (gameState.lastPlay?.playerIndex === this.index) ||
                           (gameState.passCount >= 2);

        const ruleFilter = gameState?._isPatternAllowed
            ? (cards) => gameState._isPatternAllowed(Rules.analyze(cards), cards)
            : null;

        let cards;
        if (isNewRound) {
            cards = this._chooseLeadPlay(ruleFilter);
        } else {
            cards = this._chooseResponsePlay(lastPattern, ruleFilter);
        }
        // 兜底规则门：如果首出/跟牌逻辑返回了禁用牌型，回退到 getHint
        if (cards.length > 0 && ruleFilter && !ruleFilter(cards)) {
            const fallback = this.getHint(this.hand, lastPattern, isNewRound, gameState);
            cards = fallback || [];
        }
        return cards;
    }

    // 为玩家提供提示（返回一组推荐的牌）
    // gameState 可选；传入时会对候选牌型做 _isPatternAllowed 过滤
    getHint(handCards, lastPattern, isNewRound = false, gameState = null) {
        // 保持向后兼容：外部未传入 isNewRound 时，从 lastPattern 推断
        const actuallyNewRound = isNewRound || !lastPattern || lastPattern.type === 'INVALID';
        const ruleFilter = gameState?._isPatternAllowed ? (cards) => {
            const p = Rules.analyze(cards);
            return gameState._isPatternAllowed(p, cards);
        } : null;

        if (actuallyNewRound) {
            // 首出：给出最佳首出建议
            const allPlays = Rules.findAllLegalPlays(handCards);
            if (allPlays.length === 0) return [];
            
            // 策略：优先出长牌型，小牌优先
            // 过滤掉单独的大牌（保留到后面出）
            let candidates = allPlays.filter(p => {
                if (p.cards.length === 1 && p.cards[0]?.value >= 14) return false;
                return true;
            });
            if (candidates.length === 0) candidates = allPlays;
            
            // 规则过滤
            if (ruleFilter) {
                candidates = candidates.filter(p => ruleFilter(p.cards));
            }
            
            return candidates.length > 0 ? candidates[0].cards : [];
        } else {
            // 跟牌：找最小能压过的
            const beats = Rules.findAllBeats(handCards, lastPattern);
            if (beats.length === 0) return [];
            
            // 优先不用炸弹（预计算模式避免重复 analyze）
            let scored = beats.map(c => ({ cards: c, p: Rules.analyze(c) }));
            let nonBomb = scored.filter(s => s.p.type !== 'BOMB' && s.p.type !== 'ROCKET');
            if (nonBomb.length > 0) {
                nonBomb.sort((a, b) => a.cards.length - b.cards.length || a.p.mainValue - b.p.mainValue);
                if (ruleFilter) nonBomb = nonBomb.filter(s => ruleFilter(s.cards));
                if (nonBomb.length > 0) return nonBomb[0].cards;
            }
            
            scored.sort((a, b) => a.cards.length - b.cards.length || a.p.mainValue - b.p.mainValue);
            if (ruleFilter) scored = scored.filter(s => ruleFilter(s.cards));
            return scored[0]?.cards || [];
        }
    }

    // 首出：选择最优的出牌策略
    // ruleFilter 可选：传入 gameState._isPatternAllowed 包装器，过滤禁用牌型
    _chooseLeadPlay(ruleFilter = null) {
        const hand = this.hand;
        const groups = Rules.groupByValue(hand);
        const entries = [...groups.entries()];

        // 策略1：如果能一次出完，直接出完
        const fullPattern = Rules.analyze(hand);
        if (fullPattern.isValid() && (!ruleFilter || ruleFilter(hand))) return hand;

        // 分析手牌结构
        const structure = this._analyzeHandStructure(hand);

        // 策略2：如果手牌很好（顺子/连对/飞机多），优先出长牌型
        if (structure.longPatterns.length > 0) {
            for (const best of structure.longPatterns) {
                if (ruleFilter && !ruleFilter(best.cards)) continue;
                // 如果是飞机，尝试带翅膀
                if (best.type === 'TRIPLE_STRAIGHT') {
                    const withWings = this._addWingsToPlane(best.cards, hand);
                    if (withWings && (!ruleFilter || ruleFilter(withWings))) return withWings;
                }
                return best.cards;
            }
        }

        // 策略3：如果有三带，优先出三带（消耗更多牌）
        if (structure.triplePlays.length > 0) {
            for (const tp of structure.triplePlays) {
                const withPair = this._findKickerForTriple(tp, hand, 2);
                if (withPair && (!ruleFilter || ruleFilter(withPair))) return withPair;
                const withSingle = this._findKickerForTriple(tp, hand, 1);
                if (withSingle && (!ruleFilter || ruleFilter(withSingle))) return withSingle;
                const triple = tp.slice(0, 3);
                if (!ruleFilter || ruleFilter(triple)) return triple;
            }
        }

        // 策略4：出最小的对子（只选真正的对子，不拆炸弹/三张）
        const pairs = entries.filter(([v, g]) => g.length === 2 && v <= 14);
        for (const [v, grp] of pairs) {
            const cards = grp.slice(0, 2);
            if (!ruleFilter || ruleFilter(cards)) return cards;
        }

        // 策略5：出最小的单张（保留大牌，跳过被禁用的 joker）
        const singles = hand.filter(c => {
            const g = groups.get(c.value);
            return g.length === 1 && c.value <= 14;
        });
        for (const c of singles) {
            if (!ruleFilter || ruleFilter([c])) return [c];
        }

        // 策略6：只剩大牌了，出最小的（jokerRule=disabled 时会自动跳过大小王）
        for (const c of hand) {
            if (!ruleFilter || ruleFilter([c])) return [c];
        }

        return [];
    }

    // 辅助：从连续值数组中提取最大长度连续子序列，避免冗余子模式
    _pushMaxConsecutivePatterns(sortedValues, minLen, groups, target, cardPicker) {
        if (sortedValues.length < minLen) return;
        let start = 0;
        while (start <= sortedValues.length - minLen) {
            let end = start + 1;
            while (end < sortedValues.length && sortedValues[end] - sortedValues[end - 1] === 1) {
                end++;
            }
            const runLen = end - start;
            if (runLen >= minLen) {
                const seq = sortedValues.slice(start, end);
                const cards = seq.flatMap(cardPicker);
                const p = Rules.analyze(cards);
                if (p.isValid()) target.push({type: p.type, cards, value: p.mainValue, len: cards.length});
            }
            start = end;
        }
    }

    // 分析手牌结构，返回各种牌型
    _analyzeHandStructure(hand) {
        const groups = Rules.groupByValue(hand);
        const entries = [...groups.entries()];
        const result = {
            longPatterns: [],
            triplePlays: [],
            pairs: [],
            singles: [],
            bombs: [],
            rocket: null,
        };
        
        // 火箭
        if (groups.has(16) && groups.has(17)) {
            result.rocket = [groups.get(16)[0], groups.get(17)[0]];
        }
        
        // 炸弹
        for (const [v, g] of entries) {
            if (g.length === 4) result.bombs.push(g);
            if (g.length === 3) result.triplePlays.push(g);
            if (g.length === 2) result.pairs.push(g);
            if (g.length === 1) result.singles.push(g[0]);
        }
        
        // 顺子 (5+) — 只保留最大长度，避免冗余子序列
        const normalValues = entries.filter(([v, g]) => v <= 14).map(([v]) => v).sort((a, b) => a - b);
        this._pushMaxConsecutivePatterns(normalValues, 5, groups, result.longPatterns, v => [groups.get(v)[0]]);
        
        // 连对 (3+对)
        const pairValues = entries.filter(([v, g]) => g.length >= 2 && v <= 14).map(([v]) => v).sort((a, b) => a - b);
        this._pushMaxConsecutivePatterns(pairValues, 3, groups, result.longPatterns, v => [groups.get(v)[0], groups.get(v)[1]]);
        
        // 飞机 (2+连续三张)
        const tripleValues = entries.filter(([v, g]) => g.length >= 3 && v <= 14).map(([v]) => v).sort((a, b) => a - b);
        this._pushMaxConsecutivePatterns(tripleValues, 2, groups, result.longPatterns, v => [groups.get(v)[0], groups.get(v)[1], groups.get(v)[2]]);
        
        // 排序长牌型：牌数多的优先，然后值小的优先
        result.longPatterns.sort((a, b) => {
            if (b.len !== a.len) return b.len - a.len;
            return a.value - b.value;
        });
        
        return result;
    }

    // 为三张找带牌
    _findKickerForTriple(tripleGroup, hand, count) {
        const tripleValue = tripleGroup[0].value;
        const kickers = hand.filter(c => c.value !== tripleValue);
        const groups = Rules.groupByValue(kickers);
        
        if (count === 1) {
            // 找最小单张
            const single = kickers.find(c => groups.get(c.value).length === 1);
            if (single) return [...tripleGroup.slice(0, 3), single];
            // 没有对子才拆对子
            const any = kickers[0];
            if (any) return [...tripleGroup.slice(0, 3), any];
        } else if (count === 2) {
            // 找最小对子
            const pairEntry = [...groups.entries()].find(([v, g]) => g.length >= 2);
            if (pairEntry) return [...tripleGroup.slice(0, 3), pairEntry[1][0], pairEntry[1][1]];
        }
        return null;
    }

    // 给飞机加翅膀
    _addWingsToPlane(planeCards, hand) {
        const planeValues = new Set(planeCards.map(c => c.value));
        const wings = hand.filter(c => !planeValues.has(c.value));
        const wingGroups = Rules.groupByValue(wings);
        const k = planeCards.length / 3;
        
        // 优先带对子
        const pairs = [...wingGroups.entries()].filter(([v, g]) => g.length >= 2);
        if (pairs.length >= k) {
            const pick = [];
            for (let i = 0; i < k; i++) pick.push(pairs[i][1][0], pairs[i][1][1]);
            return [...planeCards, ...pick];
        }
        
        // 其次带单张
        const singles = [...wingGroups.entries()].filter(([v, g]) => g.length >= 1);
        if (singles.length >= k) {
            const pick = [];
            for (let i = 0; i < k; i++) pick.push(singles[i][1][0]);
            return [...planeCards, ...pick];
        }
        
        return null;
    }

    // 跟牌：选择最小能压过的牌
    _chooseResponsePlay(lastPattern, ruleFilter = null) {
        let candidates = Rules.findAllBeats(this.hand, lastPattern);

        if (!candidates || candidates.length === 0) {
            return []; // pass
        }

        // 先应用规则过滤
        if (ruleFilter) {
            candidates = candidates.filter(c => ruleFilter(c));
        }
        if (candidates.length === 0) return [];

        // 难度影响：easy会倾向于不出炸弹，hard会更积极
        if (this.difficulty === 'easy') {
            const nonBomb = candidates.filter(c => {
                const p = Rules.analyze(c);
                return p.type !== 'BOMB' && p.type !== 'ROCKET';
            });
            if (nonBomb.length > 0) {
                nonBomb.sort((a, b) => a.length - b.length);
                return nonBomb[0];
            }
        }

        // normal/hard: 按代价最小化排序
        const scored = candidates.map(c => {
            const p = Rules.analyze(c);
            const isBomb = p.type === 'BOMB' || p.type === 'ROCKET';
            return { cards: c, isBomb, len: c.length, mainValue: p.mainValue };
        });
        scored.sort((a, b) => {
            if (a.isBomb && !b.isBomb) return 1;
            if (!a.isBomb && b.isBomb) return -1;
            if (a.len !== b.len) return a.len - b.len;
            return a.mainValue - b.mainValue;
        });

        return scored[0]?.cards || [];
    }
}




export { AIPlayer };

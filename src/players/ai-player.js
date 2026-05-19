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
        const values = [...groups.keys()].filter(v => v <= 15).sort((a, b) => a - b);
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
                           lastPattern.type === 'INVALID' ||
                           (gameState.lastPlay.playerIndex === this.index) ||
                           (gameState.passCount >= 2);

        if (isNewRound) {
            return this._chooseLeadPlay();
        } else {
            return this._chooseResponsePlay(lastPattern);
        }
    }

    // 为玩家提供提示（返回一组推荐的牌）
    getHint(handCards, lastPattern) {
        const isNewRound = !lastPattern || lastPattern.type === 'INVALID';
        
        if (isNewRound) {
            // 首出：给出最佳首出建议
            const allPlays = Rules.findAllLegalPlays(handCards);
            if (allPlays.length === 0) return [];
            
            // 策略：优先出长牌型，小牌优先
            // 过滤掉单独的大牌（保留到后面出）
            const nonBig = allPlays.filter(p => {
                if (p.cards.length === 1 && p.cards[0].value >= 14) return false;
                return true;
            });
            
            if (nonBig.length > 0) return nonBig[0].cards;
            return allPlays[0].cards;
        } else {
            // 跟牌：找最小能压过的
            const beats = Rules.findAllBeats(handCards, lastPattern);
            if (beats.length === 0) return [];
            
            // 优先不用炸弹
            const nonBomb = beats.filter(c => {
                const p = Rules.analyze(c);
                return p.type !== 'BOMB' && p.type !== 'ROCKET';
            });
            if (nonBomb.length > 0) {
                nonBomb.sort((a, b) => a.length - b.length);
                return nonBomb[0];
            }
            
            beats.sort((a, b) => a.length - b.length);
            return beats[0];
        }
    }

    // 首出：选择最优的出牌策略
    _chooseLeadPlay() {
        const hand = this.hand;
        const groups = Rules.groupByValue(hand);
        const entries = [...groups.entries()];

        // 策略1：如果能一次出完，直接出完
        if (hand.length <= 6) {
            const pattern = Rules.analyze(hand);
            if (pattern.isValid()) return hand;
        }

        // 分析手牌结构
        const structure = this._analyzeHandStructure(hand);
        
        // 策略2：如果手牌很好（顺子/连对/飞机多），优先出长牌型
        if (structure.longPatterns.length > 0) {
            // 选最小的长牌型
            const best = structure.longPatterns[0];
            // 如果是飞机，尝试带翅膀
            if (best.type === 'TRIPLE_STRAIGHT') {
                const withWings = this._addWingsToPlane(best.cards, hand);
                if (withWings) return withWings;
            }
            return best.cards;
        }
        
        // 策略3：如果有三带，优先出三带（消耗更多牌）
        if (structure.triplePlays.length > 0) {
            const tp = structure.triplePlays[0];
            // 尝试带对子（优先，因为保留单张大牌）
            const withPair = this._findKickerForTriple(tp, hand, 2);
            if (withPair) return withPair;
            const withSingle = this._findKickerForTriple(tp, hand, 1);
            if (withSingle) return withSingle;
            return tp.slice(0, 3);
        }

        // 策略4：出最小的对子
        const pairs = entries.filter(([v, g]) => g.length >= 2 && v <= 14);
        if (pairs.length > 0) {
            return pairs[0][1].slice(0, 2);
        }

        // 策略5：出最小的单张（保留大牌）
        const singles = hand.filter(c => {
            const g = groups.get(c.value);
            return g.length === 1 && c.value <= 14;
        });
        if (singles.length > 0) {
            return [singles[0]];
        }

        // 策略6：只剩大牌了，出最小的
        return [hand[0]];
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
        
        // 顺子 (5+)
        const normalValues = entries.filter(([v, g]) => v <= 15).map(([v]) => v).sort((a, b) => a - b);
        for (let i = 0; i < normalValues.length; i++) {
            for (let j = i + 4; j < normalValues.length; j++) {
                const seq = normalValues.slice(i, j + 1);
                if (Rules.isConsecutive(seq)) {
                    const cards = seq.map(v => groups.get(v)[0]);
                    const p = Rules.analyze(cards);
                    if (p.isValid()) result.longPatterns.push({type: p.type, cards, value: p.mainValue, len: cards.length});
                } else break;
            }
        }
        
        // 连对 (3+对)
        const pairValues = entries.filter(([v, g]) => g.length >= 2 && v <= 15).map(([v]) => v).sort((a, b) => a - b);
        for (let i = 0; i < pairValues.length; i++) {
            for (let j = i + 2; j < pairValues.length; j++) {
                const seq = pairValues.slice(i, j + 1);
                if (Rules.isConsecutive(seq)) {
                    const cards = [];
                    for (const v of seq) cards.push(groups.get(v)[0], groups.get(v)[1]);
                    const p = Rules.analyze(cards);
                    if (p.isValid()) result.longPatterns.push({type: p.type, cards, value: p.mainValue, len: cards.length});
                } else break;
            }
        }
        
        // 飞机 (2+连续三张)
        const tripleValues = entries.filter(([v, g]) => g.length >= 3 && v <= 15).map(([v]) => v).sort((a, b) => a - b);
        for (let i = 0; i < tripleValues.length; i++) {
            for (let j = i + 1; j < tripleValues.length; j++) {
                const seq = tripleValues.slice(i, j + 1);
                if (Rules.isConsecutive(seq)) {
                    const cards = [];
                    for (const v of seq) cards.push(groups.get(v)[0], groups.get(v)[1], groups.get(v)[2]);
                    const p = Rules.analyze(cards);
                    if (p.isValid()) result.longPatterns.push({type: p.type, cards, value: p.mainValue, len: cards.length});
                } else break;
            }
        }
        
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
    _chooseResponsePlay(lastPattern) {
        const candidates = Rules.findAllBeats(this.hand, lastPattern);
        
        if (!candidates || candidates.length === 0) {
            return []; // pass
        }

        // 难度影响：easy会倾向于不出炸弹，hard会更积极
        if (this.difficulty === 'easy') {
            // 优先不用炸弹
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
        candidates.sort((a, b) => {
            const pa = Rules.analyze(a);
            const pb = Rules.analyze(b);
            // 优先不用炸弹/火箭
            const aIsBomb = pa.type === 'BOMB' || pa.type === 'ROCKET';
            const bIsBomb = pb.type === 'BOMB' || pb.type === 'ROCKET';
            if (aIsBomb && !bIsBomb) return 1;
            if (!aIsBomb && bIsBomb) return -1;
            // 牌数少的优先（保留更多牌）
            return a.length - b.length;
        });

        return candidates[0];
    }
}




export { AIPlayer };

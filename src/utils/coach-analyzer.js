/**
 * CoachAnalyzer - AI 教练复盘系统
 * 分析玩家关键操作，生成带 severity 的建议，支持与回放系统联动
 */

import { Rules, HAND_TYPE } from '../core/rules.js';

function adaptCard(c) {
    if (!c) return null;
    return {
        value: c.value,
        suit: typeof c.suit === 'string' ? { name: c.suit } : (c.suit || null),
        rankKey: c.rank,
        displayName: c.displayName,
        isLaizi: false,
    };
}

function sameCard(a, b) {
    if (!a || !b) return false;
    if (a.value !== b.value) return false;
    if (a.value >= 16) return true;
    const aSuit = typeof a.suit === 'string' ? a.suit : (a.suit?.name || '');
    const bSuit = typeof b.suit === 'string' ? b.suit : (b.suit?.name || '');
    return aSuit === bSuit;
}

function removeFromHand(hand, cards) {
    for (const c of cards) {
        const idx = hand.findIndex(hc => sameCard(hc, c));
        if (idx >= 0) hand.splice(idx, 1);
    }
}

function adaptPattern(p) {
    if (!p) return null;
    return {
        type: p.type,
        mainValue: p.mainValue,
        length: p.length,
        isValid() { return this.type !== 'INVALID'; },
    };
}

function severityWeight(s) {
    return s === 'high' ? 3 : s === 'medium' ? 2 : 1;
}

function getLastNonPassPattern(history, beforeIndex) {
    for (let i = beforeIndex - 1; i >= 0; i--) {
        const h = history[i];
        if (h.pattern?.type !== 'PASS' && h.cards?.length > 0) return h;
    }
    return null;
}

function isOpponent(idxA, idxB, landlordIndex) {
    if (landlordIndex < 0) return idxA !== idxB;
    const isLandlordA = idxA === landlordIndex;
    const isLandlordB = idxB === landlordIndex;
    return isLandlordA !== isLandlordB;
}

function cardValueLabel(v) {
    if (v === 17) return '大王';
    if (v === 16) return '小王';
    if (v === 15) return '2';
    if (v === 14) return 'A';
    if (v === 13) return 'K';
    if (v === 12) return 'Q';
    if (v === 11) return 'J';
    return String(v);
}

export class CoachAnalyzer {
    /**
     * 主分析入口
     * @param {Object} fullGame - 完整牌局数据（由 _saveGameResult 保存的格式）
     * @param {number} humanIndex - 人类玩家索引
     * @returns {Object|null} 复盘结果
     */
    static analyze(fullGame, humanIndex) {
        if (!fullGame || humanIndex == null || humanIndex < 0 || humanIndex > 2) return null;

        const { history = [], initialHands = [], landlordIndex = -1, currentCall = 0, mode } = fullGame;
        const isEndgame = mode === 'endgame';
        const hands = initialHands.map(h => (h || []).map(adaptCard));
        const suggestions = [];

        // 1. 叫分分析（残局模式跳过）
        if (!isEndgame) {
            const callSuggestion = this._analyzeCall(initialHands[humanIndex], currentCall, humanIndex, landlordIndex);
            if (callSuggestion) suggestions.push(callSuggestion);
        }

        // 2. 遍历 history
        for (let i = 0; i < history.length; i++) {
            const action = history[i];
            const prevHands = hands.map(h => h.map(c => ({ ...c })));

            if (action.playerIndex === humanIndex) {
                if (action.pattern?.type === 'PASS') {
                    const missed = this._checkMissedBeat(prevHands[humanIndex], history, i, humanIndex, landlordIndex);
                    if (missed) suggestions.push(missed);
                } else if (action.cards?.length > 0) {
                    if (action.pattern?.type === 'BOMB' || action.pattern?.type === 'ROCKET') {
                        const timing = this._checkBombTiming(prevHands[humanIndex], action, history, i, humanIndex, landlordIndex);
                        if (timing) suggestions.push(timing);
                    }
                    const split = this._checkSplit(prevHands[humanIndex], action);
                    if (split) suggestions.push(split);
                }
            }

            if (action.cards && action.cards.length > 0) {
                removeFromHand(hands[action.playerIndex], action.cards.map(adaptCard));
            }
        }

        // 3. 效率分析
        const eff = this._analyzeEfficiency(history, initialHands, humanIndex);
        if (eff) suggestions.push(eff);

        // 去重
        const seen = new Set();
        const unique = [];
        for (const s of suggestions) {
            const key = `${s.type}-${s.roundIndex ?? 'none'}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(s);
            }
        }

        unique.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
        const limited = unique.slice(0, 6);

        const highCount = limited.filter(s => s.severity === 'high').length;
        const mediumCount = limited.filter(s => s.severity === 'medium').length;

        return {
            summary: {
                score: Math.max(0, 100 - highCount * 20 - mediumCount * 10),
                totalSuggestions: limited.length,
                highCount,
                mediumCount,
            },
            suggestions: limited,
        };
    }

    static _analyzeCall(hand, actualCall, humanIndex, landlordIndex) {
        if (!hand || hand.length === 0) return null;
        const strength = this._evaluateHandStrength(hand);
        const isLandlord = humanIndex === landlordIndex;

        if (isLandlord) {
            if (strength < 2 && actualCall > 0) {
                return {
                    type: 'call',
                    severity: 'medium',
                    message: '手牌强度一般却叫到了地主，防守压力大。建议弱牌时保守叫分。',
                    roundIndex: -1,
                    detail: `手牌强度评估: ${strength.toFixed(1)}，实际叫分: ${actualCall}`,
                };
            }
            if (strength >= 5.5 && actualCall < 2) {
                return {
                    type: 'call',
                    severity: 'low',
                    message: '一手好牌，可以更积极地叫高分以扩大收益。',
                    roundIndex: -1,
                    detail: `手牌强度评估: ${strength.toFixed(1)}，实际叫分: ${actualCall}`,
                };
            }
        } else {
            if (strength >= 5.5 && actualCall === 0) {
                return {
                    type: 'call',
                    severity: 'medium',
                    message: '手牌很强但没有抢到地主，错失成为地主的机会。',
                    roundIndex: -1,
                    detail: `手牌强度评估: ${strength.toFixed(1)}，实际叫分: 0`,
                };
            }
        }
        return null;
    }

    static _evaluateHandStrength(hand) {
        const groups = new Map();
        for (const c of hand) {
            if (!groups.has(c.value)) groups.set(c.value, []);
            groups.get(c.value).push(c);
        }
        let strength = 0;
        if (groups.has(16) && groups.has(17)) strength += 5;
        for (const [val, grp] of groups) {
            if (grp.length === 4) strength += 3;
            if (val >= 15) strength += 1;
        }
        const bigCards = hand.filter(c => c.value >= 12).length;
        strength += bigCards * 0.3;
        const values = [...groups.keys()].filter(v => v <= 14).sort((a, b) => a - b);
        let straightLen = 1, maxStraight = 1;
        for (let i = 1; i < values.length; i++) {
            if (values[i] - values[i - 1] === 1) straightLen++;
            else straightLen = 1;
            maxStraight = Math.max(maxStraight, straightLen);
        }
        if (maxStraight >= 5) strength += 1;
        const singleCount = [...groups.values()].filter(g => g.length === 1).length;
        strength -= singleCount * 0.2;
        return strength;
    }

    static _checkMissedBeat(hand, history, idx, humanIndex, landlordIndex) {
        const lastPlay = getLastNonPassPattern(history, idx);
        if (!lastPlay || lastPlay.playerIndex === humanIndex) return null;

        // 农民不压农民，地主不压地主
        if (!isOpponent(humanIndex, lastPlay.playerIndex, landlordIndex)) return null;

        const lastPattern = adaptPattern(lastPlay.pattern);
        const beats = Rules.findAllBeats(hand, lastPattern);
        if (beats.length === 0) return null;

        const nonBomb = beats.filter(cards => {
            const p = Rules.analyze(cards);
            return p.type !== 'BOMB' && p.type !== 'ROCKET';
        });

        if (nonBomb.length > 0) {
            return {
                type: 'missed_beat',
                severity: 'high',
                message: `第 ${idx + 1} 回合：对手出 ${Rules.getTypeName(lastPattern.type)}，你本可以用普通牌型压制却选择不出。`,
                roundIndex: idx,
                detail: `可用 ${nonBomb[0].length} 张牌压制`,
            };
        }

        return {
            type: 'missed_beat',
            severity: 'low',
            message: `第 ${idx + 1} 回合：对手出 ${Rules.getTypeName(lastPattern.type)}，你有炸弹可压但选择了保留。`,
            roundIndex: idx,
            detail: '保留炸弹也是一种策略，但若让对手连出则得不偿失。',
        };
    }

    static _checkBombTiming(hand, action, history, idx, humanIndex, landlordIndex) {
        const lastPlay = getLastNonPassPattern(history, idx);
        if (!lastPlay || lastPlay.playerIndex === humanIndex) return null;

        // 炸弹/王炸只应在需要跟牌时使用；此处确认是跟牌场景
        const lastPattern = adaptPattern(lastPlay.pattern);
        const allBeats = Rules.findAllBeats(hand, lastPattern);
        const nonBombBeats = allBeats.filter(cards => {
            const p = Rules.analyze(cards);
            return p.type !== 'BOMB' && p.type !== 'ROCKET';
        });

        if (nonBombBeats.length > 0) {
            return {
                type: 'bomb_timing',
                severity: 'medium',
                message: `第 ${idx + 1} 回合：你使用了 ${action.pattern.type === 'ROCKET' ? '王炸' : '炸弹'}，但普通牌型也能压制，浪费了关键火力。`,
                roundIndex: idx,
                detail: `可用普通牌 ${nonBombBeats[0].length} 张压制`,
            };
        }

        const remaining = hand.length - action.cards.length;
        if (remaining > 6 && action.pattern.type === 'BOMB') {
            return {
                type: 'bomb_timing',
                severity: 'low',
                message: `第 ${idx + 1} 回合：手牌尚多（剩 ${remaining} 张）时使用炸弹，后期可能缺乏终结手段。`,
                roundIndex: idx,
                detail: '建议在手牌较少或关键时刻再使用炸弹。',
            };
        }

        return null;
    }

    static _checkSplit(hand, action) {
        if (!action.cards || action.cards.length === 0) return null;

        const groups = new Map();
        for (const c of hand) {
            if (!groups.has(c.value)) groups.set(c.value, []);
            groups.get(c.value).push(c);
        }

        for (const card of action.cards) {
            const grp = groups.get(card.value);
            if (grp && grp.length === 4) {
                // 确认action中该value的牌少于4张（即拆炸弹）
                const usedCount = action.cards.filter(c => c.value === card.value).length;
                if (usedCount < 4) {
                    const severity = card.value >= 14 ? 'high' : 'medium';
                    return {
                        type: 'split',
                        severity,
                        message: `你拆散了 ${cardValueLabel(card.value)} 的炸弹来出 ${Rules.getTypeName(action.pattern.type)}，削弱了手牌控制力。`,
                        roundIndex: -1,
                        detail: '拆炸弹出牌通常不是最优选择，除非为了凑顺子或快速跑牌。',
                    };
                }
            }
        }
        return null;
    }

    static _analyzeEfficiency(history, initialHands, humanIndex) {
        const hands = initialHands.map(h => (h || []).map(adaptCard));
        let lastHumanIdx = -1;
        let secondLastHumanIdx = -1;

        for (let i = 0; i < history.length; i++) {
            if (history[i].playerIndex === humanIndex && history[i].cards?.length > 0) {
                secondLastHumanIdx = lastHumanIdx;
                lastHumanIdx = i;
            }
            if (history[i].cards?.length > 0) {
                removeFromHand(hands[history[i].playerIndex], history[i].cards.map(adaptCard));
            }
        }

        if (secondLastHumanIdx >= 0) {
            const hands2 = initialHands.map(h => (h || []).map(adaptCard));
            for (let i = 0; i < secondLastHumanIdx; i++) {
                if (history[i].cards?.length > 0) {
                    removeFromHand(hands2[history[i].playerIndex], history[i].cards.map(adaptCard));
                }
            }
            const handBefore = hands2[humanIndex];
            const pattern = Rules.analyze(handBefore);
            if (pattern.isValid()) {
                return {
                    type: 'efficiency',
                    severity: 'high',
                    message: '你在倒数第二手时本可以一次出完所有牌，却选择了分次出牌，给了对手反击的机会。',
                    roundIndex: secondLastHumanIdx,
                    detail: `剩余 ${handBefore.length} 张牌构成合法牌型：${Rules.getTypeName(pattern.type)}`,
                };
            }
        }
        return null;
    }
}

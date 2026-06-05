/**
 * EndgameData - 残局训练数据与记录管理
 * 包含5个内置残局关卡 + localStorage 存储
 */

import { Card, SUITS } from '../core/card.js';
import { Rules } from '../core/rules.js';

const S = SUITS.SPADE;
const H = SUITS.HEART;
const D = SUITS.DIAMOND;
const C = SUITS.CLUB;
const JB = null; // Joker suit placeholder

function j(big = true) {
    return new Card(null, big ? 'JOKER_BIG' : 'JOKER_SMALL');
}
function card(suit, rank) {
    return new Card(suit, rank);
}

/**
 * 残局关卡定义
 */
const ENDGAME_LEVELS = [
    {
        id: 1,
        name: '基础单牌压制',
        description: '作为地主，利用顺子一次性清理手牌。',
        objective: '地主在2手内出完所有牌',
        hint: '直接出顺子 3-4-5-6-7-8-9-10-J-Q-K-A，对手无法压过，再出大王获胜。',
        optimalSteps: 2,
        landlordIndex: 0,
        currentTurn: 0,
        lastPlay: null,
        hands: [
            // 地主(人类)
            [card(C,'3'), card(D,'4'), card(H,'5'), card(S,'6'), card(C,'7'), card(D,'8'), card(H,'9'), card(S,'10'), card(C,'J'), card(D,'Q'), card(H,'K'), card(S,'A'), j(true)],
            // AI1
            [card(H,'A'), card(D,'K'), card(C,'Q'), card(S,'J'), card(H,'10')],
            // AI2
            [card(D,'A'), card(C,'K'), card(S,'Q'), card(H,'J'), card(D,'10')],
        ],
    },
    {
        id: 2,
        name: '对子/三带一选择',
        description: '作为地主，合理运用三带一快速清牌。',
        objective: '地主在4手内出完所有牌',
        hint: '555带A → 444 → 333 → 777，依次清完即可获胜。',
        optimalSteps: 4,
        landlordIndex: 0,
        currentTurn: 0,
        lastPlay: null,
        hands: [
            // 地主(人类): 333 444 555 777 A
            [card(S,'3'), card(H,'3'), card(D,'3'), card(S,'4'), card(H,'4'), card(D,'4'), card(S,'5'), card(H,'5'), card(D,'5'), card(S,'7'), card(H,'7'), card(D,'7'), card(S,'A')],
            // AI1: 66 KK QQ J
            [card(S,'6'), card(H,'6'), card(S,'K'), card(H,'K'), card(D,'Q'), card(C,'Q'), card(D,'J')],
            // AI2: 88 JJ 99 10
            [card(S,'8'), card(H,'8'), card(S,'J'), card(H,'J'), card(D,'9'), card(C,'9'), card(S,'10')],
        ],
    },
    {
        id: 3,
        name: '顺子拆牌选择',
        description: '作为地主，判断先出顺子还是先出王炸。',
        objective: '地主在2手内出完所有牌',
        hint: '先出3-A顺子，AI无法压过（同长度同类型需更大主值），再出王炸获胜。若先出王炸，AI将出顺子反压。',
        optimalSteps: 2,
        landlordIndex: 0,
        currentTurn: 0,
        lastPlay: null,
        hands: [
            // 地主(人类): 3-A顺子 + 王炸
            [card(S,'3'), card(H,'4'), card(D,'5'), card(C,'6'), card(S,'7'), card(H,'8'), card(D,'9'), card(C,'10'), card(S,'J'), card(H,'Q'), card(D,'K'), card(C,'A'), j(false), j(true)],
            // AI1: 3-A顺子（但地主先出，同大无法压）
            [card(H,'3'), card(D,'4'), card(C,'5'), card(S,'6'), card(H,'7'), card(D,'8'), card(C,'9'), card(S,'10'), card(H,'J'), card(D,'Q'), card(C,'K'), card(S,'A')],
            // AI2: 22
            [card(S,'2'), card(H,'2')],
        ],
    },
    {
        id: 4,
        name: '炸弹是否保留',
        description: '作为地主，面对对子9，判断是否用炸弹。',
        objective: '地主在4手内出完所有牌',
        hint: 'KKKK炸 → QQ → J → AAAA炸，4步获胜。保留炸弹会被对手牵制。',
        optimalSteps: 4,
        landlordIndex: 0,
        currentTurn: 0,
        lastPlay: {
            playerIndex: 1,
            cards: [card(S,'9'), card(H,'9')],
        },
        hands: [
            // 地主(人类): AAAA KKKK QQ J
            [card(S,'A'), card(H,'A'), card(D,'A'), card(C,'A'), card(S,'K'), card(H,'K'), card(D,'K'), card(C,'K'), card(S,'Q'), card(H,'Q'), card(S,'J')],
            // AI1: 10101010 99 8
            [card(S,'10'), card(H,'10'), card(D,'10'), card(C,'10'), card(D,'9'), card(C,'9'), card(D,'8')],
            // AI2: 7777 66 5
            [card(S,'7'), card(H,'7'), card(D,'7'), card(C,'7'), card(S,'6'), card(H,'6'), card(S,'5')],
        ],
    },
    {
        id: 5,
        name: '春天/反春天残局',
        description: '作为农民，在队友配合下完成反春天。',
        objective: '农民获胜且地主只出过1手牌（反春天）',
        hint: '地主出AAA带2后，用4444炸，然后555带7、666带8清完。',
        optimalSteps: 3,
        landlordIndex: 0,
        currentTurn: 0,
        lastPlay: null,
        hands: [
            // 地主(0): AAA 2 小王
            [card(S,'A'), card(H,'A'), card(D,'A'), card(S,'2'), j(false)],
            // 农民(人类,1): 4444 555 666 7 8
            [card(S,'4'), card(H,'4'), card(D,'4'), card(C,'4'), card(S,'5'), card(H,'5'), card(D,'5'), card(S,'6'), card(H,'6'), card(D,'6'), card(S,'7'), card(S,'8')],
            // AI2(农民,2): KKKK QQQ JJJ 9 10
            [card(S,'K'), card(H,'K'), card(D,'K'), card(C,'K'), card(S,'Q'), card(H,'Q'), card(D,'Q'), card(S,'J'), card(H,'J'), card(D,'J'), card(S,'9'), card(S,'10')],
        ],
    },
];

/**
 * 验证关卡数据合法性
 */
function validateEndgameLevels() {
    const errors = [];
    for (const level of ENDGAME_LEVELS) {
        // 收集所有牌
        const allCards = [];
        for (let i = 0; i < 3; i++) {
            if (!level.hands[i]) {
                errors.push(`关卡${level.id}: 玩家${i}手牌缺失`);
                continue;
            }
            allCards.push(...level.hands[i]);
        }
        // 检查重复（基于 value + suit name / rankKey）
        const seen = new Set();
        for (const c of allCards) {
            const key = `${c.value}-${c.suit?.name || c.rankKey}`;
            if (seen.has(key)) {
                errors.push(`关卡${level.id}: 重复牌 ${key}`);
            }
            seen.add(key);
        }
        // 验证最优解（如果提供了 optimalSolution）
        if (level.optimalSolution) {
            const pattern = Rules.analyze(level.optimalSolution);
            if (!pattern.isValid()) {
                errors.push(`关卡${level.id}: 最优解牌型不合法`);
            }
        }
        // 验证 lastPlay
        if (level.lastPlay && level.lastPlay.cards.length > 0) {
            const pattern = Rules.analyze(level.lastPlay.cards);
            if (!pattern.isValid()) {
                errors.push(`关卡${level.id}: lastPlay 牌型不合法`);
            }
        }
    }
    return errors;
}

/**
 * 残局记录对象
 */
class EndgameRecord {
    constructor(levelId, stars, bestSteps, passed, timestamp) {
        this.levelId = levelId;
        this.stars = stars;
        this.bestSteps = bestSteps;
        this.passed = passed;
        this.timestamp = timestamp || Date.now();
    }
}

/**
 * 残局记录管理器
 */
const EndgameRecordManager = {
    _key: 'ddz_endgame_records',

    getRecords() {
        try {
            const raw = localStorage.getItem(this._key);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return {};
            return parsed;
        } catch {
            return {};
        }
    },

    saveRecord(levelId, stars, steps) {
        const records = this.getRecords();
        const existing = records[levelId];
        if (!existing) {
            records[levelId] = new EndgameRecord(levelId, stars, steps, true);
        } else {
            const betterStars = Math.max(existing.stars, stars);
            const betterSteps = existing.bestSteps ? Math.min(existing.bestSteps, steps) : steps;
            records[levelId] = new EndgameRecord(levelId, betterStars, betterSteps, true);
        }
        try {
            localStorage.setItem(this._key, JSON.stringify(records));
        } catch (e) {
            console.warn('保存残局记录失败:', e);
        }
    },

    getRecord(levelId) {
        return this.getRecords()[levelId] || null;
    },

    getProgress() {
        const records = this.getRecords();
        const total = ENDGAME_LEVELS.length;
        const passed = ENDGAME_LEVELS.filter(l => records[l.id]?.passed).length;
        const totalStars = ENDGAME_LEVELS.reduce((sum, l) => sum + (records[l.id]?.stars || 0), 0);
        const maxStars = total * 3;
        return { total, passed, totalStars, maxStars, nextLevel: passed < total ? ENDGAME_LEVELS[passed].id : null };
    },

    clear() {
        try {
            localStorage.removeItem(this._key);
        } catch (e) {
            console.warn('清除残局记录失败:', e);
        }
    },
};

/**
 * 计算残局星级
 * @param {Object} level - 关卡定义
 * @param {Object} roundData - onRoundEnd 数据
 * @param {GameState} gameState - 游戏状态
 * @param {number} humanStepCount - 人类出牌次数
 * @param {number} humanIndex - 人类玩家索引
 */
function calculateEndgameStars(level, roundData, gameState, humanStepCount, humanIndex) {
    const isHumanWin = roundData.winnerIndex === humanIndex ||
        (roundData.winnerIndex !== gameState.landlordIndex && humanIndex !== gameState.landlordIndex);

    if (!isHumanWin) return { stars: 0, passed: false };

    // 春天/反春天特殊判定
    if (level.objective.includes('反春天')) {
        const landlordPlayed = gameState.playCounts[gameState.landlordIndex];
        if (landlordPlayed === 1) return { stars: 3, passed: true };
        return { stars: 2, passed: true };
    }

    // 普通关卡：按步数评级
    const steps = humanStepCount;
    if (steps <= level.optimalSteps) return { stars: 3, passed: true };
    if (steps <= level.optimalSteps + 1) return { stars: 2, passed: true };
    return { stars: 1, passed: true };
}

export {
    ENDGAME_LEVELS,
    validateEndgameLevels,
    EndgameRecord,
    EndgameRecordManager,
    calculateEndgameStars,
};

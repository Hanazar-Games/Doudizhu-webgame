/**
 * Player - 玩家基类
 */

import { Card } from '../core/card.js';

class Player {
    constructor(name, isAI = false) {
        this.name = name;
        this.isAI = isAI;
        this.index = -1; // 座位号 0/1/2
        this.hand = [];  // 手牌
        this.isLandlord = false;
        this.isReady = false;
        this.isAuto = false; // 托管标志
    }

    setHand(cards) {
        this.hand = Card.sortByValue(cards);
    }

    addCards(cards) {
        this.hand.push(...cards);
        this.hand = Card.sortByValue(this.hand);
    }

    removeCards(cards) {
        if (!cards || !Array.isArray(cards)) return;
        // 基于 value + suit 匹配，不依赖对象引用，也不修改传入数组
        const toRemove = [];
        for (const c of cards) {
            toRemove.push({ value: c.value, suit: c.suit?.name || c.rankKey });
        }
        this.hand = this.hand.filter(hc => {
            const idx = toRemove.findIndex(tr => tr.value === hc.value && tr.suit === (hc.suit?.name || hc.rankKey));
            if (idx >= 0) {
                toRemove.splice(idx, 1);
                return false;
            }
            return true;
        });
    }

    hasCards(cards) {
        if (!cards || !Array.isArray(cards)) return false;
        const handCopy = [...this.hand];
        for (const c of cards) {
            const idx = handCopy.findIndex(hc => hc.value === c.value && (hc.suit?.name || hc.rankKey) === (c.suit?.name || c.rankKey));
            if (idx === -1) return false;
            handCopy.splice(idx, 1);
        }
        return true;
    }

    resetHand() {
        this.hand = [];
        this.isLandlord = false;
        this.isReady = false;
        this.isAuto = false;
    }

    // 子类可覆盖：决定叫分策略
    async decideCall(gameState) {
        return 0; // 默认不叫
    }

    // 子类可覆盖：决定出牌
    async decidePlay(gameState, lastPattern) {
        return []; // 默认pass
    }
}

// 依赖 Card



export { Player };

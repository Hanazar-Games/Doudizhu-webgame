/**
 * Card - 扑克牌定义
 * 斗地主使用54张牌（含大小王）
 */

// 花色

const SUITS = {
    SPADE:   { name: 'spade',   symbol: '♠', color: 'black' },
    HEART:   { name: 'heart',   symbol: '♥', color: 'red' },
    CLUB:    { name: 'club',    symbol: '♣', color: 'black' },
    DIAMOND: { name: 'diamond', symbol: '♦', color: 'red' },
};

// 点数定义（斗地主中大小顺序）
const RANKS = {
    '3':  { name: '3',  display: '3',  value: 3 },
    '4':  { name: '4',  display: '4',  value: 4 },
    '5':  { name: '5',  display: '5',  value: 5 },
    '6':  { name: '6',  display: '6',  value: 6 },
    '7':  { name: '7',  display: '7',  value: 7 },
    '8':  { name: '8',  display: '8',  value: 8 },
    '9':  { name: '9',  display: '9',  value: 9 },
    '10': { name: '10', display: '10', value: 10 },
    'J':  { name: 'J',  display: 'J',  value: 11 },
    'Q':  { name: 'Q',  display: 'Q',  value: 12 },
    'K':  { name: 'K',  display: 'K',  value: 13 },
    'A':  { name: 'A',  display: 'A',  value: 14 },
    '2':  { name: '2',  display: '2',  value: 15 },
    'JOKER_SMALL': { name: 'JOKER_SMALL', display: '小王', value: 16 },
    'JOKER_BIG':   { name: 'JOKER_BIG',   display: '大王', value: 17 },
};

class Card {
    constructor(suit, rankKey) {
        this.suit = suit; // null for jokers
        this.rankKey = rankKey;
        this.rank = RANKS[rankKey];
        this.isLaizi = false; // 是否为癞子牌
    }

    get value() {
        return this.rank.value;
    }

    get displayName() {
        if (this.isJoker()) {
            return this.rank.display;
        }
        return `${this.suit.symbol}${this.rank.display}`;
    }

    isJoker() {
        return this.rankKey === 'JOKER_SMALL' || this.rankKey === 'JOKER_BIG';
    }

    getColor() {
        if (this.isJoker()) {
            return this.rankKey === 'JOKER_SMALL' ? 'black' : 'red';
        }
        return this.suit.color;
    }

    // 用于在HTML中渲染的class名
    getCardClass() {
        if (this.isJoker()) {
            return `card joker ${this.rankKey.toLowerCase()}`;
        }
        return `card ${this.suit.name} rank-${this.rank.name.toLowerCase()}`;
    }

    toString() {
        return this.displayName;
    }

    // 创建一副新牌（54张）
    static createDeck() {
        const deck = [];
        const suitKeys = ['SPADE', 'HEART', 'CLUB', 'DIAMOND'];
        const rankKeys = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

        for (const s of suitKeys) {
            for (const r of rankKeys) {
                deck.push(new Card(SUITS[s], r));
            }
        }

        deck.push(new Card(null, 'JOKER_SMALL'));
        deck.push(new Card(null, 'JOKER_BIG'));

        return deck;
    }

    // Fisher-Yates 洗牌
    static shuffle(deck) {
        const arr = [...deck];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // 按斗地主点数排序（升序）
    static sortByValue(cards) {
        return [...cards].sort((a, b) => a.value - b.value);
    }

    /**
     * 智能排序：按牌值分组，组大小降序（炸弹>三带>对子>单牌），
     * 同组大小按牌值升序。便于快速识别牌型组合。
     */
    static sortSmart(cards) {
        const groups = new Map();
        for (const c of cards) {
            if (!groups.has(c.value)) groups.set(c.value, []);
            groups.get(c.value).push(c);
        }
        const arr = [...groups.values()].sort((a, b) => {
            if (a.length !== b.length) return b.length - a.length;
            return a[0].value - b[0].value;
        });
        return arr.flat();
    }
}

export { Card, SUITS, RANKS };

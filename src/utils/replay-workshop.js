/**
 * ReplayWorkshop - 牌谱工坊
 * 保存、管理、分享精彩对局牌谱
 */

import { Storage } from './storage.js';

const WORKSHOP_KEY = 'ddz_workshop_records';
const MAX_SHARE_CODE_LENGTH = 200000;

/**
 * 生成分享码（Base64 编码的对局数据）
 */
function encodeShareCode(gameData) {
    try {
        const json = JSON.stringify(gameData);
        // 在浏览器环境使用 btoa，Node 环境使用 Buffer
        let code;
        if (typeof btoa === 'function') {
            code = btoa(encodeURIComponent(json));
        } else {
            code = Buffer.from(encodeURIComponent(json)).toString('base64');
        }
        if (code.length > MAX_SHARE_CODE_LENGTH) {
            console.warn('[ReplayWorkshop] 牌谱数据过大，分享码生成失败');
            return null;
        }
        return code;
    } catch (e) {
        console.warn('[ReplayWorkshop] 编码失败:', e);
        return null;
    }
}

/**
 * 解析分享码
 */
function decodeShareCode(code) {
    if (typeof code !== 'string' || code.length > MAX_SHARE_CODE_LENGTH) return null;
    try {
        let decoded;
        if (typeof atob === 'function') {
            decoded = decodeURIComponent(atob(code));
        } else {
            decoded = decodeURIComponent(Buffer.from(code, 'base64').toString('utf-8'));
        }
        return JSON.parse(decoded);
    } catch (e) {
        return null;
    }
}

/**
 * 牌谱记录
 */
class WorkshopRecord {
    constructor(gameData, name = '', note = '') {
        this.id = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.gameData = gameData;
        this.name = name || this._generateDefaultName(gameData);
        this.note = note;
        this.createdAt = Date.now();
        this.shareCode = encodeShareCode(gameData);
    }

    _generateDefaultName(gameData) {
        const date = new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const mode = gameData.mode === 'ai' ? '人机' : gameData.mode === 'lan' ? '联机' : gameData.mode === 'tournament' ? '锦标赛' : gameData.mode === 'challenge' ? '极限挑战' : '对局';
        const result = gameData.result?.isLandlordWin ? '地主胜' : '农民胜';
        return `${date} · ${mode} · ${result}`;
    }
}

/**
 * 牌谱工坊管理器
 */
const ReplayWorkshop = {
    getRecords() {
        try {
            const raw = localStorage.getItem(WORKSHOP_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    },

    _saveRecords(records) {
        try {
            localStorage.setItem(WORKSHOP_KEY, JSON.stringify(records));
            return true;
        } catch (e) {
            console.warn('[ReplayWorkshop] 保存失败:', e);
            return false;
        }
    },

    saveGame(gameData, name = '', note = '') {
        if (!gameData || !Array.isArray(gameData.history)) {
            console.warn('[ReplayWorkshop] 无效的对局数据');
            return null;
        }
        const records = this.getRecords();
        const record = new WorkshopRecord(gameData, name, note);
        records.unshift(record);
        // 最多保留50条
        if (records.length > 50) records.length = 50;
        const ok = this._saveRecords(records);
        if (!ok) return null;
        return record;
    },

    deleteRecord(id) {
        const records = this.getRecords().filter(r => r.id !== id);
        this._saveRecords(records);
    },

    importShareCode(code) {
        const gameData = decodeShareCode(code);
        const validHistory = Array.isArray(gameData?.history) && gameData.history.every(action =>
            action && Number.isInteger(action.playerIndex) && action.playerIndex >= 0 && action.playerIndex < 3 &&
            Array.isArray(action.cards) && action.cards.length <= 20 && action.cards.every(card => card && Number.isInteger(card.value) && card.value >= 3 && card.value <= 17));
        if (!validHistory || !Array.isArray(gameData.players) || gameData.players.length !== 3) {
            return { success: false, error: '无效的分享码' };
        }
        const record = this.saveGame(gameData, '导入的牌谱');
        if (!record) {
            return { success: false, error: '保存失败，本地存储可能已满' };
        }
        return { success: true, record };
    },

    getRecordById(id) {
        return this.getRecords().find(r => r.id === id) || null;
    },

    getStats() {
        const records = this.getRecords();
        return {
            total: records.length,
            byMode: records.reduce((acc, r) => {
                const mode = r.gameData?.mode || 'unknown';
                acc[mode] = (acc[mode] || 0) + 1;
                return acc;
            }, {}),
        };
    },

    clearAll() {
        try {
            localStorage.removeItem(WORKSHOP_KEY);
        } catch (e) {}
    },
};

export { ReplayWorkshop, encodeShareCode, decodeShareCode };

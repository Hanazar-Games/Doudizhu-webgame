/**
 * TournamentMode - 锦标赛模式
 * 基于 AIMode 的多轮锦标赛体验
 */

import { AIMode } from './ai-mode.js';
import { TournamentStorage } from '../utils/tournament-storage.js';

class TournamentMode extends AIMode {
    constructor(difficulty = 'normal', totalRounds = 5) {
        super(difficulty);
        this.totalRounds = totalRounds;
        this.roundResults = []; // 每轮详细结果
        this.prevScores = [0, 0, 0]; // 上一局累计分数
        this.isTournamentMode = true;
    }

    async init() {
        await super.init();
        this.setMatchRounds(this.totalRounds);
        this.prevScores = [0, 0, 0];
        this.roundResults = [];
    }

    getMatchStatus() {
        const base = super.getMatchStatus();
        base.isTournament = true;
        base.roundResults = this.roundResults;
        base.tournamentTotalRounds = this.totalRounds;
        return base;
    }

    onRoundEnd(data) {
        const gs = this.gameState;
        const humanIdx = this.humanIndex;

        // 计算本局得分（相对于上一局的增量）
        const roundScores = data.scores.map((s, i) => s - this.prevScores[i]);
        this.prevScores = [...data.scores];

        const isHumanWin = humanIdx >= 0 && (
            data.winnerIndex === humanIdx ||
            (data.winnerIndex !== gs.landlordIndex && humanIdx !== gs.landlordIndex)
        );

        const roundDetail = {
            round: this.matchConfig.currentRound + 1, // 当前是第几局（从1开始）
            scores: roundScores,
            cumulativeScores: [...data.scores],
            landlordIndex: gs.landlordIndex,
            winnerIndex: data.winnerIndex,
            isHumanWin,
            springType: data.springType,
            multiplier: data.multiplier,
        };
        this.roundResults.push(roundDetail);

        // 调用父类显示结果
        super.onRoundEnd(data);

        // 锦标赛结束后自动保存记录
        const status = this.getMatchStatus();
        if (status.isFinished) {
            this._saveTournamentRecord();
        }
    }

    _saveTournamentRecord() {
        try {
            const gs = this.gameState;
            const players = gs.players.map(p => ({
                name: p?.name || '?',
                isHuman: !p?.isAI && !p?.isAuto,
            }));
            TournamentStorage.saveRecord({
                totalRounds: this.totalRounds,
                difficulty: this.difficulty,
                players,
                finalScores: [...this.matchConfig.matchScores],
                humanIndex: this.humanIndex,
                roundDetails: this.roundResults,
            });
        } catch (e) {
            console.warn('保存锦标赛记录失败:', e);
        }
    }

    /**
     * 计算当前 MVP（累计得分最高者）
     * @returns {{index: number, name: string, score: number}|null}
     */
    getCurrentMVP() {
        if (this.roundResults.length === 0) return null;
        const last = this.roundResults[this.roundResults.length - 1];
        const sorted = last.cumulativeScores
            .map((score, i) => ({ score, index: i, name: this.gameState.players[i]?.name || '?' }))
            .sort((a, b) => b.score - a.score);
        return sorted[0];
    }

    /**
     * 获取指定轮次的排名变化
     * @param {number} roundIndex - 轮次索引（0-based）
     * @returns {{before: number, after: number}[]}
     */
    getRankChanges(roundIndex) {
        if (roundIndex < 0 || roundIndex >= this.roundResults.length) return [];
        const getRanks = (scores) => {
            const sorted = scores
                .map((score, i) => ({ score, index: i }))
                .sort((a, b) => b.score - a.score);
            const ranks = new Array(3);
            sorted.forEach((p, i) => { ranks[p.index] = i + 1; });
            return ranks;
        };

        const current = this.roundResults[roundIndex];
        const prevScores = roundIndex === 0
            ? [0, 0, 0]
            : this.roundResults[roundIndex - 1].cumulativeScores;

        const beforeRanks = getRanks(prevScores);
        const afterRanks = getRanks(current.cumulativeScores);

        return beforeRanks.map((before, i) => ({ before, after: afterRanks[i], change: before - afterRanks[i] }));
    }
}

export { TournamentMode };

/**
 * PlayStyleAnalyzer - 牌风分析系统
 * 根据玩家历史对局数据，生成6维雷达图和个性化标签
 */

import { Storage } from '../utils/storage.js';

// ===== 维度定义 =====
const DIMENSIONS = [
    { key: 'aggression', name: '攻击性', icon: '⚔️', color: '#ff6644', desc: '叫分积极度与炸弹使用频率' },
    { key: 'steadiness', name: '稳健性', icon: '🛡️', color: '#66ccff', desc: '合理叫分与防守策略' },
    { key: 'skill', name: '技巧性', icon: '🧠', color: '#ffd700', desc: '胜率、春天率与牌型运用' },
    { key: 'speed', name: '速度型', icon: '⚡', color: '#88ff88', desc: '出牌速度与决策效率' },
    { key: 'luck', name: '运气质', icon: '🍀', color: '#ff99cc', desc: '好牌获得频率与春天' },
    { key: 'burst', name: '爆发性', icon: '💥', color: '#ff8844', desc: '大combo与多炸弹' },
];

// ===== 标签库 =====
const LABELS = {
    aggression: [
        { min: 85, label: '炸弹狂魔', desc: '不管三七二十一，炸就完了！', emoji: '💣' },
        { min: 70, label: '激进派', desc: '进攻就是最好的防守', emoji: '🔥' },
        { min: 55, label: '攻守均衡', desc: '该出手时就出手', emoji: '⚖️' },
        { min: 40, label: '保守型', desc: '稳扎稳打，步步为营', emoji: '🐢' },
        { min: 0, label: '佛系玩家', desc: '随缘打牌，快乐就好', emoji: '😌' },
    ],
    steadiness: [
        { min: 85, label: '铁壁防守', desc: '密不透风的防守体系', emoji: '🏰' },
        { min: 70, label: '冷静大师', desc: '泰山崩于前而色不变', emoji: '🧊' },
        { min: 55, label: '理性派', desc: '用数据说话', emoji: '📊' },
        { min: 40, label: '情绪化', desc: '偶尔上头，但很快就冷静下来', emoji: '🌊' },
        { min: 0, label: '冲动型', desc: '先打了再说！', emoji: '🤠' },
    ],
    skill: [
        { min: 85, label: '斗地主之神', desc: '你已经超越了99%的玩家', emoji: '👑' },
        { min: 70, label: '高手在民间', desc: '牌技精湛，令人叹服', emoji: '🎯' },
        { min: 55, label: '熟练工', desc: '基本功扎实', emoji: '🔧' },
        { min: 40, label: '初学者', desc: '还在摸索中', emoji: '🌱' },
        { min: 0, label: '快乐源泉', desc: '虽然菜但是快乐', emoji: '😂' },
    ],
    speed: [
        { min: 85, label: '闪电侠', desc: '你的手速已经突破天际', emoji: '⚡' },
        { min: 70, label: '快枪手', desc: '天下武功唯快不破', emoji: '🤠' },
        { min: 55, label: '节奏型', desc: '不快不慢刚刚好', emoji: '🎵' },
        { min: 40, label: '深思熟虑', desc: '每一步都经过精密计算', emoji: '🤔' },
        { min: 0, label: '养生打牌', desc: '慢慢来，不急', emoji: '☕' },
    ],
    luck: [
        { min: 85, label: '天选之子', desc: '运气也是实力的一部分', emoji: '🌟' },
        { min: 70, label: '欧皇附体', desc: '底牌永远有惊喜', emoji: '🎰' },
        { min: 55, label: '小幸运', desc: '偶尔也会被幸运女神眷顾', emoji: '🍀' },
        { min: 40, label: '非酋', desc: '运气不好但技术在', emoji: '🌧️' },
        { min: 0, label: '负重前行', desc: '全靠实力硬扛', emoji: '💪' },
    ],
    burst: [
        { min: 85, label: '核弹级', desc: '一局五个炸弹不是梦', emoji: '☢️' },
        { min: 70, label: '爆破专家', desc: '场面越乱越兴奋', emoji: '🧨' },
        { min: 55, label: '间歇性爆发', desc: '要么不炸，要么炸翻天', emoji: '🌋' },
        { min: 40, label: '平稳输出', desc: '输出稳定但缺少爆发', emoji: '📈' },
        { min: 0, label: '和平主义者', desc: '不喜欢用暴力解决问题', emoji: '🕊️' },
    ],
};

// ===== 主标签组合 =====
const COMBO_LABELS = [
    { primary: 'skill', secondary: 'aggression', label: '技术流杀手', desc: '用实力碾压，不留情面' },
    { primary: 'skill', secondary: 'steadiness', label: '大魔王', desc: '既强又稳，令人绝望' },
    { primary: 'luck', secondary: 'aggression', label: '天命之人', desc: '运气好还爱炸，谁顶得住' },
    { primary: 'speed', secondary: 'aggression', label: '闪电战专家', desc: '快准狠，三招之内见胜负' },
    { primary: 'burst', secondary: 'luck', label: '欧皇爆破手', desc: '又欧又爱炸，场面一度失控' },
    { primary: 'steadiness', secondary: 'skill', label: '扑克脸大师', desc: '面无表情地赢了你' }
];

/**
 * 分析引擎
 */
export class PlayStyleAnalyzer {
    constructor() {
        this.dimensions = DIMENSIONS;
        this._loadData();
    }

    _loadData() {
        try {
            const raw = localStorage.getItem('ddz_playStyle');
            const parsed = raw ? JSON.parse(raw) : null;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                // 数据迁移：合并旧数据与默认结构
                const defaults = this._defaultData();
                this.data = { ...defaults, ...parsed };
                if (!Array.isArray(this.data.games)) this.data.games = [];
                return;
            }
        } catch {
            // fallthrough
        }
        this.data = this._defaultData();
    }

    _defaultData() {
        return {
            games: [],
            totalThinkTime: 0,
            totalDecisions: 0,
            callAttempts: 0,
            callSuccess: 0,
            bombPlayed: 0,
            rocketPlayed: 0,
            passCount: 0,
            playCount: 0,
            springCount: 0,
            antiSpringCount: 0,
            maxCombo: 0,
            bigPlayCount: 0,
            landlordCount: 0,
            landlordWinCount: 0,
            peasantWinCount: 0,
        };
    }

    saveData() {
        try {
            localStorage.setItem('ddz_playStyle', JSON.stringify(this.data));
        } catch (e) {
            console.warn('牌风数据保存失败:', e);
        }
    }

    /**
     * 记录一局游戏数据
     */
    recordGame(gameData) {
        if (!gameData || typeof gameData !== 'object') return;
        const d = this.data;

        d.games.push({
            timestamp: Date.now(),
            isWin: gameData.isWin,
            isLandlord: gameData.isLandlord,
            isSpring: gameData.isSpring,
            isAntiSpring: gameData.isAntiSpring,
            bombs: gameData.bombs || 0,
            rocket: gameData.rocket || false,
            maxCombo: gameData.maxCombo || 0,
            thinkTime: gameData.thinkTime || 0,
            decisions: gameData.decisions ?? 1,
            callScore: gameData.callScore || 0,
            bigPlays: gameData.bigPlays || 0,
        });

        // 只保留最近50局用于分析
        if (d.games.length > 50) d.games = d.games.slice(-50);

        // 同步更新聚合计数器（与 games 数组保持一致）
        this._recalcAggregates();
        this.saveData();
    }

    /**
     * 从 games 数组重新计算所有聚合计数器
     * 确保50局截断后数据不会失真
     */
    _recalcAggregates() {
        const d = this.data;
        const games = d.games;
        d.totalThinkTime = 0;
        d.totalDecisions = 0;
        d.callAttempts = 0;
        d.callSuccess = 0;
        d.bombPlayed = 0;
        d.rocketPlayed = 0;
        d.springCount = 0;
        d.antiSpringCount = 0;
        d.bigPlayCount = 0;
        d.maxCombo = 0;
        d.landlordCount = 0;
        d.landlordWinCount = 0;
        d.peasantWinCount = 0;
        for (const g of games) {
            d.totalThinkTime += g.thinkTime || 0;
            d.totalDecisions += g.decisions ?? 1;
            d.callAttempts += (g.callScore || 0) > 0 ? 1 : 0;
            d.callSuccess += g.isLandlord ? 1 : 0;
            d.bombPlayed += g.bombs || 0;
            d.rocketPlayed += g.rocket ? 1 : 0;
            d.springCount += g.isSpring ? 1 : 0;
            d.antiSpringCount += g.isAntiSpring ? 1 : 0;
            d.bigPlayCount += g.bigPlays || 0;
            d.maxCombo = Math.max(d.maxCombo, g.maxCombo || 0);
            if (g.isLandlord) {
                d.landlordCount++;
                if (g.isWin) d.landlordWinCount++;
            } else if (g.isWin) {
                d.peasantWinCount++;
            }
        }
    }

    /**
     * 计算6维得分 (0-100)
     */
    analyze() {
        const d = this.data;
        const games = d.games;
        const totalGames = games.length;
        const stats = Storage.getStats();

        if (totalGames < 3) {
            return { scores: null, labels: [], comboLabel: null, advice: [], report: null };
        }

        const recentGames = games.slice(-20);

        // --- 攻击性 ---
        const avgBombs = d.bombPlayed / Math.max(totalGames, 1);
        const avgCallScore = games.reduce((s, g) => s + (g.callScore || 0), 0) / Math.max(totalGames, 1);
        const rocketRate = d.rocketPlayed / Math.max(totalGames, 1);
        const aggression = Math.min(100, Math.round(
            (avgBombs * 15) + (avgCallScore * 8) + (rocketRate * 25) + 30
        ));

        // --- 稳健性 ---
        const callWinRate = d.callSuccess / Math.max(d.callAttempts, 1);
        // passRate: 从 games 数组统计 pass 比例（若数据不可用则用默认值）
        const passCount = games.filter(g => g.passed === true).length;
        const playCount = games.filter(g => g.played === true).length;
        const passRate = (passCount + playCount) > 0
            ? (passCount / Math.max(passCount + playCount, 1))
            : 0.3;
        const landlordWinRate = d.landlordCount > 0 ? d.landlordWinCount / d.landlordCount : 0.5;
        const steadiness = Math.min(100, Math.round(
            (callWinRate * 30) + ((1 - Math.abs(passRate - 0.3)) * 25) + (landlordWinRate * 20) + 25
        ));

        // --- 技巧性 ---
        const winRate = stats.gamesPlayed > 0 ? stats.wins / stats.gamesPlayed : 0;
        const springRate = d.springCount / Math.max(totalGames, 1);
        const avgBigPlays = d.bigPlayCount / Math.max(totalGames, 1);
        const skill = Math.min(100, Math.round(
            (winRate * 40) + (springRate * 20) + (avgBigPlays * 10) + (stats.maxStreak > 3 ? 15 : 0) + 20
        ));

        // --- 速度型 ---
        const avgThinkTime = d.totalThinkTime / Math.max(d.totalDecisions, 1);
        let speed = 50;
        if (avgThinkTime < 2000) speed = 95;
        else if (avgThinkTime < 4000) speed = 80;
        else if (avgThinkTime < 6000) speed = 65;
        else if (avgThinkTime < 10000) speed = 50;
        else if (avgThinkTime < 15000) speed = 35;
        else speed = 20;
        const recentThinkTime = recentGames.reduce((s, g) => s + (g.thinkTime || 0), 0)
            / Math.max(recentGames.reduce((s, g) => s + (g.decisions ?? 1), 0), 1);
        if (recentThinkTime < avgThinkTime * 0.8) speed = Math.min(100, speed + 10);
        else if (recentThinkTime > avgThinkTime * 1.3) speed = Math.max(0, speed - 10);
        speed = Math.round(speed);

        // --- 运气质 ---
        const luckScore = Math.min(100, Math.round(
            (springRate * 30) + (rocketRate * 25) + (avgBombs * 15) + 30
        ));
        const luck = Math.min(100, Math.round(
            luckScore * 0.7 + Math.max(0, (winRate * 100 - skill) * 0.3)
        ));

        // --- 爆发性 ---
        const maxComboScore = Math.min(d.maxCombo * 15, 50);
        const avgBigPlayScore = Math.min(d.bigPlayCount / Math.max(totalGames, 1) * 10, 30);
        const burst = Math.min(100, Math.round(maxComboScore + avgBigPlayScore + (avgBombs * 8) + 20));

        const scores = {
            aggression: Math.max(5, Math.min(95, aggression)),
            steadiness: Math.max(5, Math.min(95, steadiness)),
            skill: Math.max(5, Math.min(95, skill)),
            speed: Math.max(5, Math.min(95, speed)),
            luck: Math.max(5, Math.min(95, luck)),
            burst: Math.max(5, Math.min(95, burst)),
        };

        const labels = this._getLabels(scores);
        const comboLabel = this._getComboLabel(scores);
        const advice = this._getAdvice(scores, totalGames);

        return {
            scores,
            labels,
            comboLabel,
            advice,
            totalGames,
            report: {
                avgBombs: avgBombs.toFixed(1),
                winRate: (winRate * 100).toFixed(0),
                springRate: (springRate * 100).toFixed(0),
                avgThinkTime: (avgThinkTime / 1000).toFixed(1),
                maxCombo: d.maxCombo,
                landlordRate: d.landlordCount > 0 ? ((d.landlordWinCount / d.landlordCount) * 100).toFixed(0) : '0',
            },
        };
    }

    _getLabels(scores) {
        const result = [];
        for (const dim of this.dimensions) {
            const score = scores[dim.key];
            const tiers = LABELS[dim.key];
            for (const tier of tiers) {
                if (score >= tier.min) {
                    result.push({
                        dimension: dim.name,
                        score,
                        ...tier,
                        color: dim.color,
                    });
                    break;
                }
            }
        }
        return result;
    }

    _getComboLabel(scores) {
        const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        if (entries.length < 2) {
            return {
                label: '斗地主玩家',
                desc: '正在形成自己的牌风',
                primary: entries[0]?.[0] || 'skill',
                secondary: null,
                primaryScore: entries[0]?.[1] || 0,
                secondaryScore: 0,
            };
        }
        const [primary, secondary] = [entries[0][0], entries[1][0]];

        // 查找预设组合
        for (const combo of COMBO_LABELS) {
            if ((combo.primary === primary && combo.secondary === secondary) ||
                (combo.primary === secondary && combo.secondary === primary)) {
                return { ...combo, primaryScore: scores[primary], secondaryScore: scores[secondary] };
            }
        }

        // 默认：取最高分维度生成
        const dim = this.dimensions.find(d => d.key === primary);
        const tier = LABELS[primary].find(t => scores[primary] >= t.min);
        return {
            label: tier?.label || '斗地主玩家',
            desc: tier?.desc || '正在形成自己的牌风',
            primary: primary,
            secondary: secondary,
            primaryScore: scores[primary],
            secondaryScore: scores[secondary],
        };
    }

    _getAdvice(scores, totalGames) {
        const advice = [];
        const entries = Object.entries(scores).sort((a, b) => a[1] - b[1]);
        const lowest = entries[0];
        const highest = entries[entries.length - 1];

        if (lowest[1] < 30) {
            const dim = this.dimensions.find(d => d.key === lowest[0]);
            advice.push(`你的${dim.name}还有很大提升空间。试着${this._getImprovementTip(lowest[0])}。`);
        }
        if (highest[1] > 75) {
            const dim = this.dimensions.find(d => d.key === highest[0]);
            advice.push(`${dim.name}是你的最强项！继续保持这一优势。`);
        }
        if (scores.aggression > 70 && scores.steadiness < 40) {
            advice.push('攻击性很强但稳健性不足，建议多观察对手出牌习惯再决定叫分。');
        }
        if (scores.skill < 40 && totalGames > 10) {
            advice.push('建议多使用提示功能学习最优出牌顺序，技巧会逐步提升。');
        }
        if (scores.speed < 30) {
            advice.push('适当加快出牌节奏可以给对手施加压力。');
        }

        // 读取 AI 教练复盘摘要，生成长期建议
        const coachAdvice = this._getCoachBasedAdvice();
        if (coachAdvice) advice.push(coachAdvice);

        if (advice.length === 0) {
            advice.push('你的牌风比较均衡，继续享受游戏的乐趣吧！');
        }
        return advice;
    }

    _getCoachBasedAdvice() {
        try {
            const reviews = JSON.parse(localStorage.getItem('ddz_coach_reviews') || '[]');
            if (!Array.isArray(reviews) || reviews.length < 3) return null;
            const recent = reviews.slice(0, 10);
            const avgScore = recent.reduce((s, r) => s + (r.score || 0), 0) / recent.length;
            const highRate = recent.filter(r => (r.highCount || 0) > 0).length / recent.length;
            const missedBeat = recent.filter(r => r.suggestionTypes?.includes('missed_beat')).length;
            const splitCount = recent.filter(r => r.suggestionTypes?.includes('split')).length;

            if (avgScore < 60) {
                return `🎯 AI教练提示：最近${recent.length}局平均复盘得分仅${avgScore.toFixed(0)}分，建议多查看每局复盘中的高优先级建议。`;
            }
            if (missedBeat >= 3) {
                return `🎯 AI教练提示：最近${recent.length}局中${missedBeat}次错过压制机会，建议出牌前检查"提示"功能。`;
            }
            if (splitCount >= 2) {
                return `🎯 AI教练提示：多次拆炸弹出牌，建议优先保留炸弹等关键牌型。`;
            }
            if (highRate > 0.5) {
                return `🎯 AI教练提示：超过半数对局存在严重失误，建议放慢节奏，多观察对手手牌数量。`;
            }
        } catch {
            // ignore
        }
        return null;
    }

    _getImprovementTip(key) {
        const tips = {
            aggression: '在有把握时更积极地抢地主',
            steadiness: '叫分前多评估手牌强度，不要盲目抢地主',
            skill: '多观察高手的出牌策略，学习牌型组合',
            speed: '减少思考时间，培养直觉反应',
            luck: '多打牌，运气会慢慢眷顾你的',
            burst: '学会保留炸弹等关键时刻使用',
        };
        return tips[key] || '多多练习';
    }

    // ===== 渲染 =====

    /**
     * 渲染 SVG 雷达图
     */
    renderRadarChart(scores, container) {
        if (!scores || !container) return;

        const size = 280;
        const center = size / 2;
        const radius = 100;
        const angleStep = (Math.PI * 2) / 6;
        const values = this.dimensions.map(d => scores[d.key] ?? 50);

        // 背景网格（5层）
        let gridSVG = '';
        for (let i = 1; i <= 5; i++) {
            const r = (radius / 5) * i;
            const points = [];
            for (let j = 0; j < 6; j++) {
                const angle = j * angleStep - Math.PI / 2;
                points.push(`${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`);
            }
            gridSVG += `<polygon points="${points.join(' ')}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
        }

        // 轴线
        let axisSVG = '';
        for (let j = 0; j < 6; j++) {
            const angle = j * angleStep - Math.PI / 2;
            axisSVG += `<line x1="${center}" y1="${center}" x2="${center + radius * Math.cos(angle)}" y2="${center + radius * Math.sin(angle)}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`;
        }

        // 数据区域
        const dataPoints = [];
        for (let j = 0; j < 6; j++) {
            const angle = j * angleStep - Math.PI / 2;
            const r = (values[j] / 100) * radius;
            dataPoints.push(`${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`);
        }
        const dataPolygon = `<polygon points="${dataPoints.join(' ')}" fill="rgba(212,160,23,0.2)" stroke="#d4a017" stroke-width="2.5" stroke-linejoin="round"/>`;

        // 数据点
        let dotsSVG = '';
        for (let j = 0; j < 6; j++) {
            const angle = j * angleStep - Math.PI / 2;
            const r = (values[j] / 100) * radius;
            const x = center + r * Math.cos(angle);
            const y = center + r * Math.sin(angle);
            dotsSVG += `<circle cx="${x}" cy="${y}" r="4" fill="#d4a017" stroke="rgba(0,0,0,0.5)" stroke-width="1.5"/>`;
        }

        // 维度标签
        let labelsSVG = '';
        for (let j = 0; j < 6; j++) {
            const angle = j * angleStep - Math.PI / 2;
            const labelR = radius + 22;
            const x = center + labelR * Math.cos(angle);
            const y = center + labelR * Math.sin(angle);
            const dim = this.dimensions[j];
            labelsSVG += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="${dim.color}" font-size="11" font-weight="700">${dim.icon} ${dim.name}</text>`;
            labelsSVG += `<text x="${x}" y="${y + 13}" text-anchor="middle" dominant-baseline="middle" fill="rgba(255,255,255,0.5)" font-size="10">${values[j]}</text>`;
        }

        container.innerHTML = `
            <svg viewBox="0 0 ${size} ${size}" class="radar-chart-svg" style="width:100%;max-width:${size}px;">
                ${gridSVG}
                ${axisSVG}
                ${dataPolygon}
                ${dotsSVG}
                ${labelsSVG}
            </svg>
        `;
    }

    /**
     * 渲染完整面板内容
     */
    renderPanel(container) {
        if (!container) return;
        const result = this.analyze();

        if (!result.scores) {
            container.innerHTML = `
                <div class="play-style-empty">
                    <div class="play-style-empty-icon">📊</div>
                    <p>还没有足够的数据来分析你的牌风</p>
                    <p class="play-style-empty-hint">完成 3 局游戏后即可查看你的专属牌风报告</p>
                </div>
            `;
            return;
        }

        const { scores, labels, comboLabel, advice, report } = result;

        // 生成维度条
        const barsHTML = this.dimensions.map(d => {
            const score = scores[d.key];
            const label = labels.find(l => l.dimension === d.name);
            return `
                <div class="play-style-bar-row">
                    <div class="play-style-bar-label">
                        <span class="play-style-bar-icon">${d.icon}</span>
                        <span class="play-style-bar-name">${d.name}</span>
                        <span class="play-style-bar-tier" style="color:${d.color}">${label?.label || ''}</span>
                    </div>
                    <div class="play-style-bar-track">
                        <div class="play-style-bar-fill" style="width:${score}%;background:${d.color};box-shadow:0 0 8px ${d.color}40"></div>
                    </div>
                    <span class="play-style-bar-value" style="color:${d.color}">${score}</span>
                </div>
            `;
        }).join('');

        // 生成建议
        const adviceHTML = advice.map(a => `<li>💡 ${a}</li>`).join('');

        container.innerHTML = `
            <div class="play-style-content">
                <div class="play-style-hero">
                    <div class="play-style-combo-badge">
                        <div class="play-style-combo-label">${comboLabel?.label || '斗地主玩家'}</div>
                        <div class="play-style-combo-desc">${comboLabel?.desc || '正在形成自己的牌风'}</div>
                    </div>
                    <div class="play-style-radar-wrap" id="play-style-radar"></div>
                </div>
                <div class="play-style-bars">${barsHTML}</div>
                <div class="play-style-report">
                    <h4>📈 数据概览</h4>
                    <div class="play-style-report-grid">
                        <div class="report-cell"><span class="report-value">${report.winRate}%</span><span class="report-label">胜率</span></div>
                        <div class="report-cell"><span class="report-value">${report.avgBombs}</span><span class="report-label">场均炸弹</span></div>
                        <div class="report-cell"><span class="report-value">${report.springRate}%</span><span class="report-label">春天率</span></div>
                        <div class="report-cell"><span class="report-value">${report.avgThinkTime}s</span><span class="report-label">平均思考</span></div>
                        <div class="report-cell"><span class="report-value">${report.maxCombo}</span><span class="report-label">最高连击</span></div>
                        <div class="report-cell"><span class="report-value">${report.landlordRate}%</span><span class="report-label">地主胜率</span></div>
                    </div>
                </div>
                <div class="play-style-advice">
                    <h4>🎯 成长建议</h4>
                    <ul>${adviceHTML}</ul>
                </div>
            </div>
        `;

        // 渲染雷达图
        const radarWrap = container.querySelector('#play-style-radar');
        if (radarWrap) {
            this.renderRadarChart(scores, radarWrap);
        }
    }
}

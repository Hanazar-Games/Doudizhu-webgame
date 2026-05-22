/**
 * Tutorial - 斗地主交互式教程系统
 * 8个章节，涵盖规则、牌型、流程、得分等全部内容
 * 集成 SFX + BGM + 动画
 */

import { Card } from '../core/card.js';
import { Rules } from '../core/rules.js';

const CHAPTERS = [
    {
        id: 'welcome',
        title: '欢迎来到斗地主',
        subtitle: '中国最受欢迎的扑克游戏',
        bgm: 'calm',
        render: () => `
            <div class="tut-welcome">
                <div class="tut-welcome-emoji">🃏</div>
                <h1 class="tut-welcome-title">斗地主</h1>
                <p class="tut-welcome-desc">
                    斗地主起源于中国湖北，是国民级三人扑克游戏。<br>
                    1个地主 vs 2个农民，先出完手牌的一方获胜！
                </p>
                <div class="tut-roles-showcase">
                    <div class="tut-role-card tut-role-landlord">
                        <div class="tut-role-icon">👑</div>
                        <div class="tut-role-name">地主</div>
                        <div class="tut-role-desc">1人 · 20张牌 · 独自对抗农民</div>
                    </div>
                    <div class="tut-vs">VS</div>
                    <div class="tut-role-card tut-role-peasant">
                        <div class="tut-role-icon">🌾</div>
                        <div class="tut-role-name">农民</div>
                        <div class="tut-role-desc">2人 · 各17张牌 · 合作对抗地主</div>
                    </div>
                </div>
                <div class="tut-welcome-tip">
                    <span class="tut-tip-icon">💡</span>
                    本教程约需 5-8 分钟，你可以随时点击右上角 ✕ 关闭
                </div>
            </div>
        `,
    },
    {
        id: 'patterns',
        title: '认识牌型',
        subtitle: '斗地主共有 12 种基本牌型',
        bgm: 'calm',
        render: () => `
            <div class="tut-patterns">
                <div class="tut-pattern-filters">
                    <button class="tut-filter-btn active" data-filter="all">全部</button>
                    <button class="tut-filter-btn" data-filter="basic">基础</button>
                    <button class="tut-filter-btn" data-filter="combo">组合</button>
                    <button class="tut-filter-btn" data-filter="special">特殊</button>
                </div>
                <p class="tut-intro">点击任意牌型查看详细说明、示例和翻转卡牌 👇</p>
                <div class="tut-pattern-grid">
                    ${renderPatternCard('单牌', '任意一张牌', '🂡', 'single', '如：红桃5', 'basic')}
                    ${renderPatternCard('对子', '两张同点数', '🂡🂡', 'pair', '如：梅花8 + 方块8', 'basic')}
                    ${renderPatternCard('三张', '三张同点数', '🂡🂡🂡', 'triple', '如：三个K', 'basic')}
                    ${renderPatternCard('三带一', '三张 + 单牌', '🂡🂡🂡+🂢', 'triple1', '如：三个7 + 一张4', 'combo')}
                    ${renderPatternCard('三带二', '三张 + 对子', '🂡🂡🂡+🂢🂢', 'triple2', '如：三个J + 一对5', 'combo')}
                    ${renderPatternCard('顺子', '5张+连续单牌', '🂡🂢🂣🂤🂥', 'straight', '如：3-4-5-6-7（不含2和王）', 'combo')}
                    ${renderPatternCard('连对', '3对+连续对子', '🂡🂡🂢🂢🂣🂣', 'straightPair', '如：33-44-55（不含2和王）', 'combo')}
                    ${renderPatternCard('飞机', '2组+连续三张', '🂡🂡🂡🂢🂢🂢', 'airplane', '如：333-444', 'combo')}
                    ${renderPatternCard('飞机带翅', '飞机 + 同数单/对', '🂡🂡🂡🂢🂢🂢+✈️', 'airplaneWings', '如：333-444 + 5-6（单）或 + 55-66（对）', 'combo')}
                    ${renderPatternCard('四带二', '四张 + 两张', '🂡🂡🂡🂡+🂢🂣', 'four2', '如：四个9 + 3 + 7 或 + 一对Q', 'combo')}
                    ${renderPatternCard('炸弹', '四张同点数', '💣', 'bomb', '如：四个A —— 可炸任何普通牌型！', 'special')}
                    ${renderPatternCard('火箭', '大王 + 小王', '🚀', 'rocket', '王炸 —— 最大的牌，可破任何炸弹！', 'special')}
                </div>
                <div class="tut-pattern-detail hidden" id="pattern-detail">
                    <div class="tut-detail-content"></div>
                </div>
                <div class="tut-pattern-note">
                    <div class="tut-note-box">
                        <span class="tut-note-icon">⚠️</span>
                        <span><strong>注意：</strong>顺子、连对、飞机中<strong>不能包含 2 和大小王</strong>，最大到 A 为止。</span>
                    </div>
                </div>
            </div>
        `,
    },
    {
        id: 'ranking',
        title: '牌型大小比较',
        subtitle: '火箭最大，单牌最小，同类型比点数',
        bgm: 'calm',
        render: () => `
            <div class="tut-ranking">
                <div class="tut-rank-section">
                    <h4>📊 牌型等级金字塔</h4>
                    <div class="tut-pyramid">
                        <div class="tut-pyramid-level tut-level-1" data-sfx="rocket">
                            <span class="tut-pyramid-icon">🚀</span>
                            <span>火箭（王炸）</span>
                            <span class="tut-pyramid-desc">最大，无可匹敌</span>
                        </div>
                        <div class="tut-pyramid-level tut-level-2" data-sfx="bomb">
                            <span class="tut-pyramid-icon">💣</span>
                            <span>炸弹</span>
                            <span class="tut-pyramid-desc">可炸一切普通牌型</span>
                        </div>
                        <div class="tut-pyramid-level tut-level-3">
                            <span class="tut-pyramid-icon">🃏</span>
                            <span>其他牌型</span>
                            <span class="tut-pyramid-desc">同类型比点数大小</span>
                        </div>
                    </div>
                </div>
                <div class="tut-rank-section">
                    <h4>🔢 点数大小排序</h4>
                    <div class="tut-rank-bar">
                        ${['3','4','5','6','7','8','9','10','J','Q','K','A','2','小王','大王'].map((r, i) => `
                            <div class="tut-rank-item" style="--rank:${i}">
                                <div class="tut-rank-card ${r.includes('王') ? 'joker' : ''}">${r}</div>
                                ${i < 14 ? '<div class="tut-rank-arrow">→</div>' : '<div class="tut-rank-crown">👑</div>'}
                            </div>
                        `).join('')}
                    </div>
                    <p class="tut-rank-note">同类型牌型比较时，只看牌面最大的那张的点数</p>
                </div>
                <div class="tut-rank-section">
                    <h4>🧪 互动小测验</h4>
                    <div class="tut-quiz" id="rank-quiz-1">
                        <div class="tut-quiz-question">1️⃣ 以下哪副牌更大？</div>
                        <div class="tut-quiz-options">
                            <button class="tut-quiz-option" data-answer="a" data-quiz="q1">
                                <div class="tut-mini-cards">🂡🂡🂡🂡</div>
                                <div>四个K（炸弹）</div>
                            </button>
                            <button class="tut-quiz-option" data-answer="b" data-quiz="q1">
                                <div class="tut-mini-cards">🃏🃏</div>
                                <div>大小王（火箭）</div>
                            </button>
                        </div>
                        <div class="tut-quiz-result hidden" id="quiz-result-q1"></div>
                    </div>
                    <div class="tut-quiz" id="rank-quiz-2" style="margin-top:16px">
                        <div class="tut-quiz-question">2️⃣ 顺子 5-6-7-8-9-10 能否压过 顺子 4-5-6-7-8-9-10-J？</div>
                        <div class="tut-quiz-options">
                            <button class="tut-quiz-option" data-answer="a" data-quiz="q2">
                                <div>能</div>
                            </button>
                            <button class="tut-quiz-option" data-answer="b" data-quiz="q2">
                                <div>不能</div>
                            </button>
                        </div>
                        <div class="tut-quiz-result hidden" id="quiz-result-q2"></div>
                    </div>
                    <div class="tut-quiz" id="rank-quiz-3" style="margin-top:16px">
                        <div class="tut-quiz-question">3️⃣ 三带一 333+4 能否压过 三带一 222+5？</div>
                        <div class="tut-quiz-options">
                            <button class="tut-quiz-option" data-answer="a" data-quiz="q3">
                                <div>能</div>
                            </button>
                            <button class="tut-quiz-option" data-answer="b" data-quiz="q3">
                                <div>不能</div>
                            </button>
                        </div>
                        <div class="tut-quiz-result hidden" id="quiz-result-q3"></div>
                    </div>
                </div>
            </div>
        `,
    },
    {
        id: 'dealing',
        title: '角色与发牌',
        subtitle: '地主20张，农民各17张',
        bgm: 'calm',
        render: () => `
            <div class="tut-dealing">
                <div class="tut-deal-stage" id="deal-stage">
                    <div class="tut-deck-area">
                        <div class="tut-deck">
                            <div class="tut-deck-card">🂠</div>
                            <div class="tut-deck-count">54张</div>
                        </div>
                    </div>
                    <div class="tut-deal-players">
                        <div class="tut-deal-player" data-player="0">
                            <div class="tut-deal-avatar">🎭</div>
                            <div class="tut-deal-name">玩家A</div>
                            <div class="tut-deal-hand">
                                <div class="tut-deal-card-stack"></div>
                                <div class="tut-deal-count">0张</div>
                            </div>
                        </div>
                        <div class="tut-deal-player" data-player="1">
                            <div class="tut-deal-avatar">🤖</div>
                            <div class="tut-deal-name">玩家B</div>
                            <div class="tut-deal-hand">
                                <div class="tut-deal-card-stack"></div>
                                <div class="tut-deal-count">0张</div>
                            </div>
                        </div>
                        <div class="tut-deal-player" data-player="2">
                            <div class="tut-deal-avatar">🤖</div>
                            <div class="tut-deal-name">玩家C</div>
                            <div class="tut-deal-hand">
                                <div class="tut-deal-card-stack"></div>
                                <div class="tut-deal-count">0张</div>
                            </div>
                        </div>
                    </div>
                    <div class="tut-bottom-cards-area">
                        <div class="tut-bottom-label">底牌（3张）</div>
                        <div class="tut-bottom-cards">
                            <div class="tut-bottom-card hidden">🂠</div>
                            <div class="tut-bottom-card hidden">🂠</div>
                            <div class="tut-bottom-card hidden">🂠</div>
                        </div>
                    </div>
                </div>
                <button class="tut-action-btn" id="btn-deal-demo">▶ 观看发牌演示</button>
                <div class="tut-deal-info">
                    <div class="tut-info-item">
                        <span class="tut-info-icon">📦</span>
                        <span>每人先发 17 张牌</span>
                    </div>
                    <div class="tut-info-item">
                        <span class="tut-info-icon">🃏</span>
                        <span>剩余 3 张为底牌，地主确定后公开</span>
                    </div>
                    <div class="tut-info-item">
                        <span class="tut-info-icon">👑</span>
                        <span>地主获得底牌，共 20 张</span>
                    </div>
                </div>
            </div>
        `,
    },
    {
        id: 'calling',
        title: '叫分与抢地主',
        subtitle: '两种模式确定地主身份',
        bgm: 'calm',
        render: () => `
            <div class="tut-calling">
                <div class="tut-call-tabs">
                    <button class="tut-tab-btn active" data-tab="score">叫分制</button>
                    <button class="tut-tab-btn" data-tab="grab">抢地主制</button>
                </div>
                <div class="tut-call-content" id="call-content">
                    <div class="tut-call-mode active" data-mode="score">
                        <div class="tut-call-demo">
                            <div class="tut-call-player">
                                <div class="tut-call-avatar">🎭</div>
                                <div class="tut-call-name">你</div>
                                <div class="tut-call-action" data-step="0">不叫</div>
                            </div>
                            <div class="tut-call-arrow">→</div>
                            <div class="tut-call-player">
                                <div class="tut-call-avatar">🤖</div>
                                <div class="tut-call-name">AI-东</div>
                                <div class="tut-call-action" data-step="1">1分</div>
                            </div>
                            <div class="tut-call-arrow">→</div>
                            <div class="tut-call-player">
                                <div class="tut-call-avatar">🤖</div>
                                <div class="tut-call-name">AI-西</div>
                                <div class="tut-call-action" data-step="2">3分</div>
                            </div>
                        </div>
                        <div class="tut-call-result" data-step="3">
                            <span class="tut-call-winner">🏆 AI-西 叫3分成为地主！</span>
                        </div>
                        <div class="tut-call-rules">
                            <h5>📋 叫分制规则</h5>
                            <ul>
                                <li>轮流叫分：1分 / 2分 / 3分 / 不叫</li>
                                <li>后叫者只能叫更高的分</li>
                                <li>叫到 3 分立即锁定地主</li>
                                <li>叫分 = 本局初始倍数</li>
                            </ul>
                        </div>
                    </div>
                    <div class="tut-call-mode" data-mode="grab">
                        <div class="tut-call-demo">
                            <div class="tut-call-player">
                                <div class="tut-call-avatar">🎭</div>
                                <div class="tut-call-name">你</div>
                                <div class="tut-call-action tut-action-call">叫地主</div>
                            </div>
                            <div class="tut-call-arrow">→</div>
                            <div class="tut-call-player">
                                <div class="tut-call-avatar">🤖</div>
                                <div class="tut-call-name">AI-东</div>
                                <div class="tut-call-action tut-action-grab">抢地主 ×2</div>
                            </div>
                            <div class="tut-call-arrow">→</div>
                            <div class="tut-call-player">
                                <div class="tut-call-avatar">🤖</div>
                                <div class="tut-call-name">AI-西</div>
                                <div class="tut-call-action">不要</div>
                            </div>
                        </div>
                        <div class="tut-call-result">
                            <span class="tut-call-winner">🏆 AI-东 抢地主成功！倍数 ×2</span>
                        </div>
                        <div class="tut-call-rules">
                            <h5>📋 抢地主规则</h5>
                            <ul>
                                <li>先有人"叫地主"，成为候选</li>
                                <li>其他人可"抢地主"或"不要"</li>
                                <li>每抢一次，倍数 ×2</li>
                                <li>最后抢地主的人成为真正地主</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <button class="tut-action-btn" id="btn-call-demo">▶ 播放叫分演示</button>
            </div>
        `,
    },
    {
        id: 'playing',
        title: '出牌规则',
        subtitle: '轮流出牌，大者获胜或选择不出',
        bgm: 'game',
        render: () => `
            <div class="tut-playing">
                <div class="tut-play-scenario" id="play-scenario">
                    <div class="tut-play-table">
                        <div class="tut-play-area tut-play-top">
                            <div class="tut-play-avatar">🤖 AI-东</div>
                            <div class="tut-play-cards" data-step="0">
                                <div class="tut-pcard">🂡</div><div class="tut-pcard">🂡</div><div class="tut-pcard">🂡</div><div class="tut-pcard">🂡</div><div class="tut-pcard">🂡</div>
                            </div>
                            <div class="tut-play-type">顺子 3-4-5-6-7</div>
                        </div>
                        <div class="tut-play-center-info">
                            <div class="tut-play-turn" data-step="1">轮到 AI-西</div>
                        </div>
                        <div class="tut-play-area tut-play-left">
                            <div class="tut-play-avatar">🤖 AI-西</div>
                            <div class="tut-play-cards" data-step="2">
                                <div class="tut-pcard">🂢</div><div class="tut-pcard">🂢</div><div class="tut-pcard">🂢</div><div class="tut-pcard">🂢</div><div class="tut-pcard">🂢</div>
                            </div>
                            <div class="tut-play-type">顺子 4-5-6-7-8（更大！）</div>
                        </div>
                        <div class="tut-play-area tut-play-right">
                            <div class="tut-play-avatar">🎭 你</div>
                            <div class="tut-play-cards tut-play-pass" data-step="3">
                                <span class="tut-pass-text">不出</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="tut-play-rules">
                    <div class="tut-rule-card">
                        <div class="tut-rule-num">1</div>
                        <div class="tut-rule-text">
                            <strong>地主先出</strong><br>
                            地主获得出牌权，打出第一手牌
                        </div>
                    </div>
                    <div class="tut-rule-card">
                        <div class="tut-rule-num">2</div>
                        <div class="tut-rule-text">
                            <strong>轮流出牌</strong><br>
                            逆时针轮转，每人必须出同类型更大的牌，或选择"不出"
                        </div>
                    </div>
                    <div class="tut-rule-card">
                        <div class="tut-rule-num">3</div>
                        <div class="tut-rule-text">
                            <strong>新一轮</strong><br>
                            连续两人"不出"后，最后出牌者获得新一轮出牌权，可任意出牌
                        </div>
                    </div>
                    <div class="tut-rule-card">
                        <div class="tut-rule-num">4</div>
                        <div class="tut-rule-text">
                            <strong>炸弹/火箭</strong><br>
                            炸弹可炸任何普通牌型，火箭最大可炸任何炸弹
                        </div>
                    </div>
                </div>
                <button class="tut-action-btn" id="btn-play-demo">▶ 观看出牌演示</button>
            </div>
        `,
    },
    {
        id: 'scoring',
        title: '特殊规则与得分',
        subtitle: '春天、炸弹翻倍、最终结算',
        bgm: 'intense',
        render: () => `
            <div class="tut-scoring">
                <div class="tut-score-sections">
                    <div class="tut-score-card tut-spring">
                        <div class="tut-score-icon">🌸</div>
                        <h4>春天</h4>
                        <p>地主获胜，且农民<strong>一张牌都没出过</strong></p>
                        <div class="tut-score-multiplier">倍数 ×2</div>
                        <div class="tut-score-example">例：地主一路碾压直接出完</div>
                    </div>
                    <div class="tut-score-card tut-anti-spring">
                        <div class="tut-score-icon">🌾</div>
                        <h4>反春天</h4>
                        <p>农民获胜，且地主<strong>只出过一手牌</strong></p>
                        <div class="tut-score-multiplier">倍数 ×2</div>
                        <div class="tut-score-example">例：农民配合默契，地主毫无还手之力</div>
                    </div>
                    <div class="tut-score-card tut-bomb">
                        <div class="tut-score-icon">💣</div>
                        <h4>炸弹 / 火箭</h4>
                        <p>每出一个炸弹或火箭</p>
                        <div class="tut-score-multiplier">倍数 ×2（可叠加）</div>
                        <div class="tut-score-example">例：2个炸弹 = ×2×2 = ×4</div>
                    </div>
                </div>
                <div class="tut-score-formula">
                    <h4>🧮 得分计算公式</h4>
                    <div class="tut-formula-box">
                        <div class="tut-formula-line">
                            <span class="tut-formula-item">底分</span>
                            <span>×</span>
                            <span class="tut-formula-item">叫分/抢地主倍数</span>
                            <span>×</span>
                            <span class="tut-formula-item">炸弹倍数</span>
                            <span>×</span>
                            <span class="tut-formula-item">春天倍数</span>
                            <span>=</span>
                            <span class="tut-formula-result">总得分</span>
                        </div>
                    </div>
                    <div class="tut-score-example-detail">
                        <div class="tut-example-title">📌 示例</div>
                        <div class="tut-example-calc">
                            <div>底分 1 × 叫3分(×3) × 1个炸弹(×2) × 春天(×2)</div>
                            <div class="tut-example-eq">= <strong>12 分</strong></div>
                            <div class="tut-example-dist">
                                地主赢：+24 分（两份）<br>
                                农民A：-12 分 <br>
                                农民B：-12 分
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `,
    },
    {
        id: 'practice',
        title: '实战演练',
        subtitle: '模拟一局完整游戏',
        bgm: 'game',
        render: () => `
            <div class="tut-practice">
                <div class="tut-practice-stage" id="practice-stage">
                    <div class="tut-practice-msg">点击"开始演练"模拟一局完整斗地主</div>
                    <div class="tut-practice-table hidden">
                        <div class="tut-prac-player tut-prac-top">
                            <div class="tut-prac-avatar">🤖</div>
                            <div class="tut-prac-info">
                                <div class="tut-prac-name">AI-东（农民）</div>
                                <div class="tut-prac-cards">🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠</div>
                            </div>
                        </div>
                        <div class="tut-prac-player tut-prac-left">
                            <div class="tut-prac-avatar">🤖</div>
                            <div class="tut-prac-info">
                                <div class="tut-prac-name">AI-西（农民）</div>
                                <div class="tut-prac-cards">🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠</div>
                            </div>
                        </div>
                        <div class="tut-prac-center">
                            <div class="tut-prac-bottom-cards">
                                <div class="tut-prac-label">底牌</div>
                                <div class="tut-prac-bcards">🂠🂠🂠</div>
                            </div>
                            <div class="tut-prac-played" id="prac-played"></div>
                            <div class="tut-prac-comment" id="prac-comment">等待开始...</div>
                        </div>
                        <div class="tut-prac-player tut-prac-right">
                            <div class="tut-prac-avatar">🎭</div>
                            <div class="tut-prac-info">
                                <div class="tut-prac-name">你（地主）</div>
                                <div class="tut-prac-cards">🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠🂠</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="tut-practice-controls">
                    <button class="tut-action-btn tut-btn-primary" id="btn-practice-start">▶ 开始演练</button>
                    <button class="tut-action-btn hidden" id="btn-practice-next">下一步 →</button>
                </div>
                <div class="tut-practice-tips">
                    <div class="tut-practice-tip">
                        <span class="tip-icon">💡</span>
                        <span>实战中，记牌和配合是获胜的关键！</span>
                    </div>
                </div>
                <div class="tut-complete hidden" id="tut-complete">
                    <div class="tut-complete-icon">🎉</div>
                    <h3>恭喜你完成教程！</h3>
                    <p>你已经掌握了斗地主的所有基本规则</p>
                    <button class="tut-action-btn tut-btn-primary" id="btn-tut-finish">开始游戏 →</button>
                </div>
            </div>
        `,
    },
    {
        id: 'memory',
        title: '记牌与读牌技巧',
        subtitle: '掌握关键牌，预判对手手牌',
        bgm: 'calm',
        render: () => `
            <div class="tut-memory">
                <div class="tut-mem-section">
                    <h4>🧠 为什么要记牌？</h4>
                    <p class="tut-mem-desc">斗地主不仅是比谁的牌大，更是<strong>信息战</strong>。记住已出的关键牌，就能推断对手还剩余什么牌型，从而做出最优决策。</p>
                </div>
                <div class="tut-mem-section">
                    <h4>🎯 必须记住的关键牌</h4>
                    <div class="tut-key-cards">
                        <div class="tut-key-card">
                            <div class="tut-kc-icon">🃏🃏</div>
                            <div class="tut-kc-name">大小王</div>
                            <div class="tut-kc-desc">确定是否还有火箭未出，直接影响出牌策略</div>
                        </div>
                        <div class="tut-key-card">
                            <div class="tut-kc-icon">2️⃣</div>
                            <div class="tut-kc-name">四个2</div>
                            <div class="tut-kc-desc">2是单牌最大，记住出了几个2能判断剩余单牌控制权</div>
                        </div>
                        <div class="tut-key-card">
                            <div class="tut-kc-icon">A️⃣</div>
                            <div class="tut-kc-name">四个A</div>
                            <div class="tut-kc-desc">A是单牌第二大，同样关键</div>
                        </div>
                        <div class="tut-key-card">
                            <div class="tut-kc-icon">💣</div>
                            <div class="tut-kc-name">炸弹</div>
                            <div class="tut-kc-desc">记住已出的炸弹数量和点数，避免被炸</div>
                        </div>
                    </div>
                </div>
                <div class="tut-mem-section">
                    <h4>📊 记牌优先级</h4>
                    <div class="tut-priority-list">
                        <div class="tut-priority-item" style="--p:1">
                            <span class="tut-pri-num">1</span>
                            <span>大小王（各1张）</span>
                        </div>
                        <div class="tut-priority-item" style="--p:2">
                            <span class="tut-pri-num">2</span>
                            <span>2（各4张）</span>
                        </div>
                        <div class="tut-priority-item" style="--p:3">
                            <span class="tut-pri-num">3</span>
                            <span>A / K（各4张）</span>
                        </div>
                        <div class="tut-priority-item" style="--p:4">
                            <span class="tut-pri-num">4</span>
                            <span>炸弹（判断剩余威胁）</span>
                        </div>
                        <div class="tut-priority-item" style="--p:5">
                            <span class="tut-pri-num">5</span>
                            <span>7 / 10（顺子断点牌）</span>
                        </div>
                    </div>
                </div>
                <div class="tut-mem-section">
                    <h4>💡 读牌小技巧</h4>
                    <div class="tut-tips-grid">
                        <div class="tut-tip-card">
                            <div class="tut-tip-title">对手一直不出2</div>
                            <div class="tut-tip-body">可能手握多个2，或者有炸弹，不要轻易出大牌单张</div>
                        </div>
                        <div class="tut-tip-card">
                            <div class="tut-tip-title">对手出小顺子</div>
                            <div class="tut-tip-body">可能手中没有大牌单张，只能用顺子消耗小牌</div>
                        </div>
                        <div class="tut-tip-card">
                            <div class="tut-tip-title">农民互相传牌</div>
                            <div class="tut-tip-body">上家农民出小单张给下家农民接，说明他们在配合送牌</div>
                        </div>
                        <div class="tut-tip-card">
                            <div class="tut-tip-title">地主迟迟不出牌</div>
                            <div class="tut-tip-body">可能手牌很散，没有把握的控制牌型，农民可以积极进攻</div>
                        </div>
                    </div>
                </div>
                <div class="tut-mem-note">
                    <span class="tut-note-icon">🎮</span>
                    <span>游戏中可以使用<strong>记牌器</strong>功能辅助记忆，但高手最终要达到心算记牌！</span>
                </div>
            </div>
        `,
    },
    {
        id: 'advanced',
        title: '进阶技巧与常见误区',
        subtitle: '从新手到高手的进阶之路',
        bgm: 'intense',
        render: () => `
            <div class="tut-advanced">
                <div class="tut-adv-section">
                    <h4>🤝 农民配合技巧</h4>
                    <div class="tut-adv-grid">
                        <div class="tut-adv-card">
                            <div class="tut-adv-icon">🚪</div>
                            <div class="tut-adv-name">顶牌（门板）</div>
                            <div class="tut-adv-desc">地主上家的农民要尽量出大牌压制地主，不让地主轻松过小牌</div>
                        </div>
                        <div class="tut-adv-card">
                            <div class="tut-adv-icon">🏃</div>
                            <div class="tut-adv-name">传牌/送牌</div>
                            <div class="tut-adv-desc">出队友能接但地主不能接的牌，帮助队友消耗手牌</div>
                        </div>
                        <div class="tut-adv-card">
                            <div class="tut-adv-icon">🛡️</div>
                            <div class="tut-adv-name">让牌权</div>
                            <div class="tut-adv-desc">如果队友牌型很好，可以适当"不要"，把出牌权让给队友</div>
                        </div>
                        <div class="tut-adv-card">
                            <div class="tut-adv-icon">💥</div>
                            <div class="tut-adv-name">逼炸</div>
                            <div class="tut-adv-desc">用手中的强牌逼迫地主提前出炸弹，消耗其威慑力</div>
                        </div>
                    </div>
                </div>
                <div class="tut-adv-section">
                    <h4>👑 地主控场技巧</h4>
                    <ul class="tut-adv-list">
                        <li><strong>先出小牌：</strong>开局先消耗手中的小牌和散牌，避免后期被卡住</li>
                        <li><strong>保留回手牌：</strong>确保每手牌出完后，还有能收回来的大牌（如2、炸弹）</li>
                        <li><strong>控制节奏：</strong>不要一次性出太多手牌，留一手大牌防农民反扑</li>
                        <li><strong>拆牌要慎重：</strong>为了接一手牌而拆散自己的完美牌型，往往得不偿失</li>
                    </ul>
                </div>
                <div class="tut-adv-section">
                    <h4>❌ 常见误区（避坑指南）</h4>
                    <div class="tut-mistakes">
                        <div class="tut-mistake">
                            <div class="tut-mk-icon">🚫</div>
                            <div class="tut-mk-content">
                                <div class="tut-mk-title">误区一：炸弹一定要留到最后</div>
                                <div class="tut-mk-fix">✅ <strong>纠正：</strong>炸弹是改变局势的资源，不是收藏品。如果早期不用炸弹打断农民的主路，后期可能根本没机会出。</div>
                            </div>
                        </div>
                        <div class="tut-mistake">
                            <div class="tut-mk-icon">🚫</div>
                            <div class="tut-mk-content">
                                <div class="tut-mk-title">误区二：有大牌就要抢着出</div>
                                <div class="tut-mk-fix">✅ <strong>纠正：</strong>大牌要用在关键回合。把2用来压一张无关紧要的牌，可能导致后期被农民的单张逼死。</div>
                            </div>
                        </div>
                        <div class="tut-mistake">
                            <div class="tut-mk-icon">🚫</div>
                            <div class="tut-mk-content">
                                <div class="tut-mk-title">误区三：顺子可以包含2和王</div>
                                <div class="tut-mk-fix">✅ <strong>纠正：</strong>正规规则中，顺子不包含2和大小王，只能从3排到A。</div>
                            </div>
                        </div>
                        <div class="tut-mistake">
                            <div class="tut-mk-icon">🚫</div>
                            <div class="tut-mk-content">
                                <div class="tut-mk-title">误区四：农民之间互相压牌</div>
                                <div class="tut-mk-fix">✅ <strong>纠正：</strong>农民是合作关系！除非必要，不要互相压对方的牌，要让队友有机会出牌。</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="tut-adv-section">
                    <h4>🧪 最终测验</h4>
                    <div class="tut-quiz" id="adv-quiz-1">
                        <div class="tut-quiz-question">1️⃣ 你是农民，队友出了一张小单3，地主不要，你应该？</div>
                        <div class="tut-quiz-options">
                            <button class="tut-quiz-option" data-answer="a" data-quiz="aq1">
                                <div>出大牌单张压过去</div>
                            </button>
                            <button class="tut-quiz-option" data-answer="b" data-quiz="aq1">
                                <div>出小单张让队友接</div>
                            </button>
                            <button class="tut-quiz-option" data-answer="c" data-quiz="aq1">
                                <div>直接出炸弹</div>
                            </button>
                        </div>
                        <div class="tut-quiz-result hidden" id="quiz-result-aq1"></div>
                    </div>
                    <div class="tut-quiz" id="adv-quiz-2" style="margin-top:16px">
                        <div class="tut-quiz-question">2️⃣ 你是地主，手中有炸弹但牌型很散，应该？</div>
                        <div class="tut-quiz-options">
                            <button class="tut-quiz-option" data-answer="a" data-quiz="aq2">
                                <div>先出炸弹震慑农民</div>
                            </button>
                            <button class="tut-quiz-option" data-answer="b" data-quiz="aq2">
                                <div>先出小牌整理手型，保留炸弹</div>
                            </button>
                        </div>
                        <div class="tut-quiz-result hidden" id="quiz-result-aq2"></div>
                    </div>
                    <div class="tut-quiz" id="adv-quiz-3" style="margin-top:16px">
                        <div class="tut-quiz-question">3️⃣ 农民出了顺子3-4-5-6-7，你手中有炸弹，应该？</div>
                        <div class="tut-quiz-options">
                            <button class="tut-quiz-option" data-answer="a" data-quiz="aq3">
                                <div>立即用炸弹炸掉</div>
                            </button>
                            <button class="tut-quiz-option" data-answer="b" data-quiz="aq3">
                                <div>分析局势，如果他能跑完再炸</div>
                            </button>
                        </div>
                        <div class="tut-quiz-result hidden" id="quiz-result-aq3"></div>
                    </div>
                </div>
                <div class="tut-adv-complete">
                    <div class="tut-adv-trophy">🏆</div>
                    <p>掌握以上技巧，你已经超越了80%的玩家！</p>
                    <p style="font-size:0.85rem;color:rgba(255,255,255,0.4)">实战是最好的老师，快去游戏中练习吧！</p>
                </div>
            </div>
        `,
    },
];

function renderPatternCard(name, desc, icon, id, example, category = 'all') {
    return `
        <div class="tut-pattern-card" data-pattern="${id}" data-category="${category}">
            <div class="tut-pattern-icon">${icon}</div>
            <div class="tut-pattern-name">${name}</div>
            <div class="tut-pattern-desc">${desc}</div>
            <div class="tut-pattern-example">${example}</div>
        </div>
    `;
}

const PATTERN_DETAILS = {
    single: { name: '单牌', valid: '任意一张牌', example: '🂣', compare: '按点数：大王>小王>2>A>K>...>3' },
    pair: { name: '对子', valid: '两张点数相同的牌', example: '🂣🂣', compare: '按点数比较' },
    triple: { name: '三张', valid: '三张点数相同的牌', example: '🂣🂣🂣', compare: '按点数比较' },
    triple1: { name: '三带一', valid: '三张 + 一张单牌', example: '🂣🂣🂣+🂡', compare: '只比较三张的部分' },
    triple2: { name: '三带二', valid: '三张 + 一对', example: '🂣🂣🂣+🂡🂡', compare: '只比较三张的部分' },
    straight: { name: '顺子', valid: '5张及以上连续单牌', example: '🂡🂢🂣🂤🂥', compare: '比最大的一张牌，不含2和王' },
    straightPair: { name: '连对', valid: '3对及以上连续对子', example: '🂡🂡🂢🂢🂣🂣', compare: '比最大的一对，不含2和王' },
    airplane: { name: '飞机', valid: '2组及以上连续三张', example: '🂡🂡🂡🂢🂢🂢', compare: '比最大的三张，不含2和王' },
    airplaneWings: { name: '飞机带翅膀', valid: '飞机 + 同数量的单牌或对子', example: '🂡🂡🂡🂢🂢🂢+🂣🂤', compare: '只比较飞机部分' },
    four2: { name: '四带二', valid: '四张 + 两张单牌 或 两对', example: '🂣🂣🂣🂣+🂡🂢', compare: '只比较四张部分' },
    bomb: { name: '炸弹', valid: '四张点数相同的牌', example: '💣💣💣💣', compare: '按点数：四个2最大；可炸任何普通牌型' },
    rocket: { name: '火箭（王炸）', valid: '大王 + 小王', example: '🚀', compare: '最大！可炸任何炸弹' },
};

class Tutorial {
    constructor(audioManager) {
        this.audio = audioManager;
        this.container = null;
        this.currentChapter = 0;
        this.totalChapters = CHAPTERS.length;
        this._isOpen = false;
        this._onComplete = null;
    }

    open(onComplete = null) {
        this._onComplete = onComplete;
        this.container = document.getElementById('tutorial-fullscreen');
        if (!this.container) return;
        this.container.classList.remove('hidden');
        this._isOpen = true;
        this.currentChapter = 0;
        this._renderChapter();
        this._playChapterBGM();
        this._bindEvents();
        document.body.style.overflow = 'hidden';
    }

    close() {
        if (!this.container) return;
        this.container.classList.add('hidden');
        this._isOpen = false;
        this.audio?.stopBGM?.();
        document.body.style.overflow = '';
    }

    _bindEvents() {
        const closeBtn = this.container.querySelector('.tutorial-close');
        closeBtn?.addEventListener('click', () => this.close());

        const prevBtn = this.container.querySelector('.tutorial-prev');
        const nextBtn = this.container.querySelector('.tutorial-next');
        prevBtn?.addEventListener('click', () => this._prevChapter());
        nextBtn?.addEventListener('click', () => this._nextChapter());

        // 导航点击
        this.container.querySelectorAll('.tutorial-chapters li').forEach((li, idx) => {
            li.addEventListener('click', () => {
                this.currentChapter = idx;
                this._renderChapter();
                this._playChapterBGM();
            });
        });

        // 内容区事件委托
        const body = this.container.querySelector('.tutorial-body');
        body?.addEventListener('click', (e) => this._handleContentClick(e));
    }

    _handleContentClick(e) {
        // 牌型过滤器
        const filterBtn = e.target.closest('.tut-filter-btn');
        if (filterBtn) {
            const filter = filterBtn.dataset.filter;
            this.container.querySelectorAll('.tut-filter-btn').forEach(b => b.classList.remove('active'));
            filterBtn.classList.add('active');
            this.container.querySelectorAll('.tut-pattern-card').forEach(card => {
                const cat = card.dataset.category;
                card.style.display = (filter === 'all' || cat === filter) ? '' : 'none';
            });
            this.audio?.playButtonClick?.();
            return;
        }

        // 牌型卡片点击
        const patternCard = e.target.closest('.tut-pattern-card');
        if (patternCard) {
            const id = patternCard.dataset.pattern;
            this._showPatternDetail(id);
            this.audio?.playButtonClick?.();
            return;
        }

        // 金字塔层级点击
        const pyramidLevel = e.target.closest('.tut-pyramid-level');
        if (pyramidLevel) {
            const sfx = pyramidLevel.dataset.sfx;
            if (sfx === 'rocket') this.audio?.playRocket?.();
            else if (sfx === 'bomb') this.audio?.playBomb?.();
            else this.audio?.playButtonClick?.();
            pyramidLevel.classList.add('tut-pyramid-pop');
            setTimeout(() => pyramidLevel.classList.remove('tut-pyramid-pop'), 400);
            return;
        }

        // 测验选项点击
        const quizOption = e.target.closest('.tut-quiz-option');
        if (quizOption) {
            const answer = quizOption.dataset.answer;
            const quizId = quizOption.dataset.quiz;
            const resultEl = quizId ? this.container.querySelector(`#quiz-result-${quizId}`) : this.container.querySelector('.tut-quiz-result');
            let isCorrect = false;
            let correctMsg = '';
            let wrongMsg = '';
            if (quizId === 'q1') {
                isCorrect = answer === 'b'; // 火箭 > 炸弹
                correctMsg = '✅ 正确！火箭（王炸）是最大的牌型，可以压过任何炸弹！';
                wrongMsg = '❌ 再想想！火箭（大小王组合）是最大的牌型，连炸弹都能压过！';
            } else if (quizId === 'q2') {
                isCorrect = answer === 'b'; // 不能，张数不同
                correctMsg = '✅ 正确！顺子必须张数相同才能比较，6张顺子不能压7张顺子！';
                wrongMsg = '❌ 不对！顺子必须<strong>张数相同</strong>才能比较大小，6张 vs 7张无法比较！';
            } else if (quizId === 'q3') {
                isCorrect = answer === 'b'; // 不能，222 > 333
                correctMsg = '✅ 正确！三带一只比较"三张"部分，2 > 3（在斗地主点数中），所以222更大！';
                wrongMsg = '❌ 不对！三带一只比较三张部分，2 的点数大于 3，所以 222+5 更大！';
            } else if (quizId === 'aq1') {
                isCorrect = answer === 'b'; // 出小单张让队友接
                correctMsg = '✅ 正确！农民要互相配合传牌，出小单张让队友接，帮助队友消耗手牌。';
                wrongMsg = '❌ 不对！农民是合作关系，应该出小单张让队友接，而不是压队友的牌。';
            } else if (quizId === 'aq2') {
                isCorrect = answer === 'b'; // 先出小牌整理手型
                correctMsg = '✅ 正确！牌型散的时候先出小牌整理，炸弹是关键时刻的反制手段，不要浪费。';
                wrongMsg = '❌ 不对！牌型散的时候应该先出小牌整理手型，炸弹留到关键时刻用。';
            } else if (quizId === 'aq3') {
                isCorrect = answer === 'b'; // 分析局势再炸
                correctMsg = '✅ 正确！不要急于出炸弹，分析农民是否快出完了，在关键时刻打断他的节奏。';
                wrongMsg = '❌ 不对！炸弹是宝贵的资源，应该在农民即将获胜时打断，而不是随便使用。';
            } else {
                isCorrect = answer === 'b';
                correctMsg = '✅ 正确！';
                wrongMsg = '❌ 再想想！';
            }
            if (resultEl) {
                if (isCorrect) {
                    resultEl.innerHTML = `<span class="tut-quiz-correct">${correctMsg}</span>`;
                    this.audio?.playWin?.();
                } else {
                    resultEl.innerHTML = `<span class="tut-quiz-wrong">${wrongMsg}</span>`;
                    this.audio?.playError?.();
                }
                resultEl.classList.remove('hidden');
            }
            return;
        }

        // 叫分制标签切换
        const tabBtn = e.target.closest('.tut-tab-btn');
        if (tabBtn) {
            const tab = tabBtn.dataset.tab;
            this.container.querySelectorAll('.tut-tab-btn').forEach(b => b.classList.remove('active'));
            tabBtn.classList.add('active');
            this.container.querySelectorAll('.tut-call-mode').forEach(m => m.classList.remove('active'));
            this.container.querySelector(`.tut-call-mode[data-mode="${tab}"]`)?.classList.add('active');
            this.audio?.playButtonClick?.();
            return;
        }

        // 演示按钮
        if (e.target.id === 'btn-deal-demo') {
            this._playDealDemo();
            return;
        }
        if (e.target.id === 'btn-call-demo') {
            this._playCallDemo();
            return;
        }
        if (e.target.id === 'btn-play-demo') {
            this._playPlayDemo();
            return;
        }
        if (e.target.id === 'btn-practice-start') {
            this._startPractice();
            return;
        }
        if (e.target.id === 'btn-tut-finish') {
            this.close();
            this._onComplete?.();
            return;
        }

        this.audio?.playButtonClick?.();
    }

    _showPatternDetail(id) {
        const detail = PATTERN_DETAILS[id];
        if (!detail) return;
        const detailEl = this.container.querySelector('#pattern-detail');
        const contentEl = detailEl?.querySelector('.tut-detail-content');
        if (!contentEl) return;
        contentEl.innerHTML = `
            <div class="tut-detail-name">${detail.name}</div>
            <div class="tut-detail-valid">✓ ${detail.valid}</div>
            <div class="tut-detail-example">示例：${detail.example}</div>
            <div class="tut-detail-compare">📏 比较规则：${detail.compare}</div>
        `;
        detailEl.classList.remove('hidden');
        detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    _prevChapter() {
        if (this.currentChapter > 0) {
            this.currentChapter--;
            this._renderChapter();
            this._playChapterBGM();
            this.audio?.playButtonClick?.();
        }
    }

    _nextChapter() {
        if (this.currentChapter < this.totalChapters - 1) {
            this.currentChapter++;
            this._renderChapter();
            this._playChapterBGM();
            this.audio?.playButtonClick?.();
        }
    }

    _renderChapter() {
        const chapter = CHAPTERS[this.currentChapter];
        const titleEl = this.container.querySelector('.tutorial-title');
        const subtitleEl = this.container.querySelector('.tutorial-subtitle');
        const bodyEl = this.container.querySelector('.tutorial-body');
        const prevBtn = this.container.querySelector('.tutorial-prev');
        const nextBtn = this.container.querySelector('.tutorial-next');
        const dotsEl = this.container.querySelector('.tutorial-dots');
        const progressBar = this.container.querySelector('.tutorial-progress-bar');

        if (titleEl) titleEl.textContent = chapter.title;
        if (subtitleEl) subtitleEl.textContent = chapter.subtitle;
        if (bodyEl) {
            bodyEl.innerHTML = chapter.render();
            bodyEl.scrollTop = 0;
        }

        // 导航高亮
        this.container.querySelectorAll('.tutorial-chapters li').forEach((li, idx) => {
            li.classList.toggle('active', idx === this.currentChapter);
            li.classList.toggle('completed', idx < this.currentChapter);
        });

        // 按钮状态
        if (prevBtn) prevBtn.disabled = this.currentChapter === 0;
        if (nextBtn) {
            nextBtn.textContent = this.currentChapter === this.totalChapters - 1 ? '完成 🎉' : '下一步 →';
        }

        // 圆点指示器
        if (dotsEl) {
            dotsEl.innerHTML = CHAPTERS.map((_, i) => `
                <span class="tut-dot ${i === this.currentChapter ? 'active' : ''} ${i < this.currentChapter ? 'completed' : ''}"></span>
            `).join('');
        }

        // 进度条
        if (progressBar) {
            progressBar.style.width = `${((this.currentChapter + 1) / this.totalChapters) * 100}%`;
        }

        // 章节进入动画
        bodyEl?.classList.add('tut-body-enter');
        setTimeout(() => bodyEl?.classList.remove('tut-body-enter'), 400);
    }

    _playChapterBGM() {
        const chapter = CHAPTERS[this.currentChapter];
        if (!chapter.bgm || !this.audio) return;
        if (chapter.bgm === 'calm') this.audio.playMenuBGM?.();
        else if (chapter.bgm === 'game') this.audio.playGameBGM?.();
        else if (chapter.bgm === 'intense') {
            // intense BGM 可以复用游戏BGM
            this.audio.playGameBGM?.();
        }
    }

    // ========== 演示动画 ==========
    _playDealDemo() {
        const btn = this.container.querySelector('#btn-deal-demo');
        if (btn) btn.disabled = true;
        this.audio?.playDeal?.();

        const players = this.container.querySelectorAll('.tut-deal-player');
        const counts = this.container.querySelectorAll('.tut-deal-count');
        const bottomCards = this.container.querySelectorAll('.tut-bottom-card');

        // 发牌动画：每人一张一张发
        let step = 0;
        const dealInterval = setInterval(() => {
            const playerIdx = step % 3;
            const cardNum = Math.floor(step / 3) + 1;
            if (cardNum > 17) {
                clearInterval(dealInterval);
                // 显示底牌
                setTimeout(() => {
                    bottomCards.forEach(c => c.classList.remove('hidden'));
                    this.audio?.playBottomReveal?.();
                    if (btn) btn.disabled = false;
                }, 500);
                return;
            }
            const stack = players[playerIdx]?.querySelector('.tut-deal-card-stack');
            if (stack) {
                const card = document.createElement('div');
                card.className = 'tut-deal-mini';
                card.textContent = '🂠';
                stack.appendChild(card);
            }
            if (counts[playerIdx]) counts[playerIdx].textContent = `${cardNum}张`;
            step++;
        }, 80);
    }

    _playCallDemo() {
        const btn = this.container.querySelector('#btn-call-demo');
        if (btn) btn.disabled = true;

        const actions = this.container.querySelectorAll('.tut-call-action');
        const result = this.container.querySelector('.tut-call-result');

        actions.forEach(a => a.classList.remove('tut-call-highlight'));
        result?.classList.remove('tut-call-show');

        let step = 0;
        const interval = setInterval(() => {
            const action = this.container.querySelector(`.tut-call-action[data-step="${step}"]`);
            if (action) {
                action.classList.add('tut-call-highlight');
                this.audio?.playCall?.();
            }
            step++;
            if (step >= 4) {
                clearInterval(interval);
                setTimeout(() => {
                    result?.classList.add('tut-call-show');
                    this.audio?.playLandlordConfirm?.();
                    if (btn) btn.disabled = false;
                }, 600);
            }
        }, 800);
    }

    _playPlayDemo() {
        const btn = this.container.querySelector('#btn-play-demo');
        if (btn) btn.disabled = true;

        const cards = this.container.querySelectorAll('.tut-play-cards');
        const turn = this.container.querySelector('.tut-play-turn');
        const types = this.container.querySelectorAll('.tut-play-type');

        cards.forEach(c => c.classList.remove('tut-play-active'));
        types.forEach(t => t.style.opacity = '0');
        if (turn) turn.textContent = '地主先出 → AI-东';

        setTimeout(() => {
            cards[0]?.classList.add('tut-play-active');
            types[0].style.opacity = '1';
            this.audio?.playCardPlace?.();
        }, 500);

        setTimeout(() => {
            if (turn) turn.textContent = 'AI-西 接牌';
            cards[0]?.classList.remove('tut-play-active');
            cards[1]?.classList.add('tut-play-active');
            types[1].style.opacity = '1';
            this.audio?.playCardPlace?.();
        }, 1800);

        setTimeout(() => {
            if (turn) turn.textContent = '轮到 你';
            cards[1]?.classList.remove('tut-play-active');
            cards[2]?.classList.add('tut-play-active');
            this.audio?.playButtonClick?.();
            if (btn) btn.disabled = false;
        }, 3100);
    }

    _startPractice() {
        const startBtn = this.container.querySelector('#btn-practice-start');
        const nextBtn = this.container.querySelector('#btn-practice-next');
        const table = this.container.querySelector('.tut-practice-table');
        const comment = this.container.querySelector('#prac-comment');
        const complete = this.container.querySelector('#tut-complete');

        startBtn?.classList.add('hidden');
        table?.classList.remove('hidden');
        nextBtn?.classList.remove('hidden');

        const steps = [
            { msg: '🎲 发牌完毕！3张底牌已亮出', sfx: 'deal' },
            { msg: '📢 叫分阶段：你叫了3分成为地主！', sfx: 'call' },
            { msg: '👑 你获得3张底牌，共20张', sfx: 'landlord' },
            { msg: '🃏 你出牌：一对8', sfx: 'play' },
            { msg: '🤖 AI-东：一对J（更大）', sfx: 'play' },
            { msg: '🤖 AI-西：不要', sfx: 'pass' },
            { msg: '🃏 你：三个K带一对5（三带二）', sfx: 'play' },
            { msg: '💣 AI-东：炸弹！四个A！', sfx: 'bomb' },
            { msg: '🤖 AI-西：不要', sfx: 'pass' },
            { msg: '🃏 你：炸弹！四个2！', sfx: 'bomb' },
            { msg: '🤖 AI-东：不要', sfx: 'pass' },
            { msg: '🤖 AI-西：火箭！王炸！', sfx: 'rocket' },
            { msg: '🃏 你：不要', sfx: 'pass' },
            { msg: '🤖 AI-西：顺子 3-4-5-6-7-8-9-10-J', sfx: 'play' },
            { msg: '🤖 AI-东：不要', sfx: 'pass' },
            { msg: '🃏 你：不要', sfx: 'pass' },
            { msg: '🤖 AI-西：对子 Q-Q', sfx: 'play' },
            { msg: '🤖 AI-东：对子 A-A（更大）', sfx: 'play' },
            { msg: '🃏 你：不要', sfx: 'pass' },
            { msg: '🤖 AI-东：最后一张！获胜！', sfx: 'win' },
            { msg: '🏆 农民获胜！地主只出过一手牌 → 反春天！倍数×2', sfx: 'win' },
        ];

        let stepIdx = 0;
        const playStep = () => {
            if (stepIdx >= steps.length) {
                nextBtn?.classList.add('hidden');
                complete?.classList.remove('hidden');
                this.audio?.playWinBGM?.();
                return;
            }
            const step = steps[stepIdx];
            if (comment) comment.textContent = step.msg;
            switch (step.sfx) {
                case 'deal': this.audio?.playDeal?.(); break;
                case 'call': this.audio?.playCall?.(); break;
                case 'landlord': this.audio?.playLandlordConfirm?.(); break;
                case 'play': this.audio?.playCardPlace?.(); break;
                case 'pass': this.audio?.playButtonClick?.(); break;
                case 'bomb': this.audio?.playBomb?.(); break;
                case 'rocket': this.audio?.playRocket?.(); break;
                case 'win': this.audio?.playWin?.(); break;
            }
            stepIdx++;
        };

        playStep(); // 第一步
        nextBtn?.addEventListener('click', () => {
            this.audio?.playButtonClick?.();
            playStep();
        });
    }
}

export { Tutorial };

/**
 * CommentaryEngine - 牌局神评论系统
 * 在关键出牌时刻弹出热血/幽默的解说评论，增强游戏氛围
 */

class CommentaryEngine {
    constructor(container) {
        this.container = container || document.body;
        this._enabled = true;
        this._queue = [];
        this._isShowing = false;
        this._lastCommentTime = 0;
        this._cooldown = 800; // 评论最小间隔(ms)
        this._comboCount = 0;
        this._lastPlayPlayer = -1;
        // 6个预定义插槽位置(百分比)，分散在四角+中央，避免重叠
        this._slotPositions = [
            { left: 28, top: 22 },  // 左上远
            { left: 72, top: 22 },  // 右上远
            { left: 22, top: 36 },  // 左中远
            { left: 78, top: 36 },  // 右中远
            { left: 50, top: 18 },  // 顶部中央
            { left: 50, top: 34 },  // 中央
        ];
        this._lastSlotIndex = -1;
        this._activeTimers = new Set();
    }

    setEnabled(enabled) {
        this._enabled = enabled;
    }

    /**
     * 主入口：根据事件类型触发评论
     */
    trigger(event, data = {}) {
        if (!this._enabled) return;
        // 限制队列长度，防止高频事件导致内存泄漏和延迟堆积
        if (this._queue.length >= 10) {
            this._queue.shift();
        }
        const now = performance.now();
        const remaining = this._cooldown - (now - this._lastCommentTime);
        if (remaining > 0) {
            // 冷却中，加入队列稍后显示
            this._queue.push({ event, data });
            this._processQueue();
            return;
        }

        const text = this._generateComment(event, data);
        if (!text) return;

        this._show(text, event);
        this._lastCommentTime = now;
    }

    /**
     * 生成评论文字
     */
    _generateComment(event, data) {
        const pool = this._commentPools[event];
        if (!pool || pool.length === 0) return null;

        // 连击特殊处理
        if (event === 'combo') {
            const combo = data.combo || 2;
            if (combo >= 5) return pool[Math.floor(Math.random() * pool.length)];
            if (combo === 4) return '四连击！压制全场！';
            if (combo === 3) return '三连击！势不可挡！';
            if (combo === 2) return '二连击！';
            return null;
        }

        return pool[Math.floor(Math.random() * pool.length)];
    }

    /**
     * 评论池
     */
    get _commentPools() {
        return {
            bomb: [
                '💥 惊天大爆炸！全场震惊！',
                '🔥 炸弹降临，局势逆转！',
                '💣 BOOM！你扛得住吗？',
                '⚡ 核弹出世，灰飞烟灭！',
                '🎯 炸弹一出，谁与争锋！',
            ],
            rocket: [
                '🚀 火箭升空！王炸！',
                '👑 王炸一出，谁与争锋！',
                '🔥 双王降临，统治全场！',
                '💥 火箭！这就是终极武器！',
            ],
            spring: [
                '🌸 春天！碾压式胜利！',
                '🌺 完美春天，无可阻挡！',
                '🔥 春天！农民零出牌！',
                '👑 统治级春天，霸气侧漏！',
            ],
            antiSpring: [
                '❄️ 反春天！地主被打懵了！',
                '😱 惊天逆转，农民零让出牌！',
                '🔥 反春天！这就是逆袭！',
                '💪 农民联手，地主欲哭无泪！',
            ],
            combo: [
                '🔥 五连绝世！统治全场！',
                '⚡ 五连击！神级压制！',
                '👑 五连击！这就是王者！',
            ],
            straight: [
                '🌊 长顺子如瀑布倾泻！',
                '🔥 顺子一出，行云流水！',
                '⚡ 一条龙，贯通全场！',
            ],
            plane: [
                '✈️ 飞机带翅膀，横扫千军！',
                '🔥 飞机编队，轰炸全场！',
                '💥 三带一对，精准打击！',
            ],
            tense: [
                '⏰ 决胜时刻，一张定胜负！',
                '🔥 最后关头，背水一战！',
                '💣 手握核弹，蓄势待发！',
                '⚡ 生死一线，谁能笑到最后？',
            ],
            callLandlord: [
                '🔥 霸气叫三分，志在地主！',
                '👑 三分！这就是王者的自信！',
                '⚔️ 抢地主！不服来战！',
            ],
            win: [
                '🎉 胜利！牌技碾压！',
                '👑 王者归来，无可匹敌！',
                '🔥 完美收官，精彩绝伦！',
                '🎊 赢了！这就是实力！',
            ],
            lose: [
                '😤 虽败犹荣，再来一局！',
                '💪 胜负乃兵家常事！',
                '🎯 差一点，下次一定！',
            ],
            pass: [
                '😏 要不起，战略性撤退~',
                '🙅 过！留得青山在~',
                '🤔 隐忍不发，等待时机...',
            ],
            single: [
                '😏 慢悠悠一张，试探虚实~',
                '🎯 单张试水，暗藏杀机！',
                '🤫 低调出牌，高调收尾~',
            ],
            pair: [
                '👯 一对姐妹花，形影不离~',
                '💕 成双成对，甜蜜出击~',
            ],
            play: [
                '🎴 出牌如飞，行云流水~',
                '👍 好牌！继续保持~',
                '💫 这一手，有点东西~',
            ],
        };
    }

    /**
     * 显示评论
     */
    _show(text, eventType) {
        const el = document.createElement('div');
        el.className = `commentary-bubble commentary-${eventType}`;
        el.textContent = text;
        el.style.position = 'fixed';
        // 轮询选择插槽位置，避免重叠
        this._lastSlotIndex = (this._lastSlotIndex + 1) % this._slotPositions.length;
        const pos = this._slotPositions[this._lastSlotIndex];
        el.style.left = pos.left + '%';
        el.style.top = pos.top + '%';
        el.style.zIndex = '9997';
        el.style.pointerEvents = 'none';
        el.style.whiteSpace = 'nowrap';
        el.dataset.animFx = 'true';

        const reduceMotion = document.body.dataset.reduceMotion === 'true';

        if (reduceMotion) {
            el.style.transform = 'translate(-50%, -50%) scale(1)';
            el.style.opacity = '1';
        } else {
            el.style.transform = 'translate(-50%, -50%) scale(0.5)';
            el.style.opacity = '0';
        }

        this.container.appendChild(el);

        if (!reduceMotion) {
            // 强制重排触发动画
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (!el.isConnected) return;
                    el.style.transform = 'translate(-50%, -50%) scale(1)';
                    el.style.opacity = '1';
                });
            });
        }

        // 3秒后淡出移除
        const fadeTimer = setTimeout(() => {
            this._activeTimers.delete(fadeTimer);
            if (!el.isConnected) return;
            if (reduceMotion) {
                el.remove();
            } else {
                el.style.transition = 'all 0.4s ease-out';
                el.style.transform = 'translate(-50%, -50%) scale(0.6)';
                el.style.opacity = '0';
                const removeTimer = setTimeout(() => {
                    this._activeTimers.delete(removeTimer);
                    el.remove();
                }, 400);
                this._activeTimers.add(removeTimer);
            }
        }, 2500);
        this._activeTimers.add(fadeTimer);
    }

    /**
     * 处理队列中的评论
     */
    _processQueue() {
        if (this._isShowing || this._queue.length === 0) return;
        this._isShowing = true;

        const check = () => {
            if (!this._enabled) {
                this._queue = [];
                this._isShowing = false;
                return;
            }
            const now = performance.now();
            const remaining = this._cooldown - (now - this._lastCommentTime);
            if (remaining <= 0 && this._queue.length > 0) {
                const { event, data } = this._queue.shift();
                const text = this._generateComment(event, data);
                if (text) {
                    this._show(text, event);
                    this._lastCommentTime = now;
                }
                if (this._queue.length > 0) {
                    const delay = Math.max(50, this._cooldown - (performance.now() - this._lastCommentTime));
                    const t = setTimeout(check, delay);
                    this._activeTimers.add(t);
                } else {
                    this._isShowing = false;
                }
            } else if (this._queue.length > 0) {
                const delay = Math.max(50, remaining);
                const t = setTimeout(check, delay);
                this._activeTimers.add(t);
            } else {
                this._isShowing = false;
            }
        };

        const delay = Math.max(50, this._cooldown - (performance.now() - this._lastCommentTime));
        const t = setTimeout(check, delay);
        this._activeTimers.add(t);
    }

    /**
     * 追踪连击
     */
    trackPlay(playerIndex) {
        if (this._lastPlayPlayer === playerIndex) {
            this._comboCount++;
        } else {
            this._comboCount = 1;
            this._lastPlayPlayer = playerIndex;
        }
        return this._comboCount;
    }

    resetCombo() {
        this._comboCount = 0;
        this._lastPlayPlayer = -1;
    }

    destroy() {
        this._queue = [];
        this._isShowing = false;
        this._lastCommentTime = 0;
        this._comboCount = 0;
        this._lastPlayPlayer = -1;
        this._lastSlotIndex = -1;
        for (const id of this._activeTimers) clearTimeout(id);
        this._activeTimers.clear();
        this.container?.querySelectorAll('.commentary-bubble').forEach(el => el.remove());
    }
}

export { CommentaryEngine };

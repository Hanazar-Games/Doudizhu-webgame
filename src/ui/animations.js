/**
 * Animations - 特效动画管理类
 * 纯 CSS / JS 实现的视觉特效集合，服务于斗地主游戏
 */

const _originalTransformKey = Symbol('originalTransform');

class Animations {
    constructor(container) {
        this.container = container || document.body;
        this._activeRafs = new Set();
        this._activeTimeouts = new Set();
    }

    _trackRaf(id) {
        this._activeRafs.add(id);
        return id;
    }

    _untrackRaf(id) {
        this._activeRafs.delete(id);
    }

    _trackTimeout(id) {
        this._activeTimeouts.add(id);
        return id;
    }

    _untrackTimeout(id) {
        this._activeTimeouts.delete(id);
    }

    cancelAll() {
        for (const id of this._activeRafs) {
            cancelAnimationFrame(id);
        }
        this._activeRafs.clear();
        for (const id of this._activeTimeouts) {
            clearTimeout(id);
        }
        this._activeTimeouts.clear();
        // 恢复可能被 screenShake 修改的 body transform
        if (this._shakeOriginalTransform !== undefined) {
            document.body.style.transform = this._shakeOriginalTransform || '';
        }
        this._shakeCount = 0;
        this._shakeOriginalTransform = null;
        this._isSpringCelebrating = false;
        this._isWinCelebrating = false;
    }

    _createAnimElement(tag = 'div') {
        const el = document.createElement(tag);
        el.dataset.animFx = 'true';
        return el;
    }

    // ==================== 现有方法（保留并微调）====================

    /**
     * 炸弹爆炸粒子特效
     * @param {number} x - 爆炸中心 X 坐标
     * @param {number} y - 爆炸中心 Y 坐标
     * @param {boolean} flash - 是否附带全屏闪光（默认 true）
     */
    explode(x, y, flash = true) {
        const count = 20;
        const colors = ['#ff4444', '#ff8844', '#ffcc00', '#ffffff', '#ff6644'];

        for (let i = 0; i < count; i++) {
            const particle = this._createAnimElement('div');
            particle.className = 'particle';
            particle.style.position = 'absolute';
            particle.style.left = x + 'px';
            particle.style.top = y + 'px';
            particle.style.background = colors[Math.floor(Math.random() * colors.length)];
            particle.style.width = (4 + Math.random() * 8) + 'px';
            particle.style.height = particle.style.width;
            particle.style.borderRadius = '50%';
            particle.style.pointerEvents = 'none';
            particle.style.zIndex = '9999';

            const angle = (Math.PI * 2 * i) / count;
            const distance = 60 + Math.random() * 100;
            const tx = Math.cos(angle) * distance;
            const ty = Math.sin(angle) * distance;

            particle.style.setProperty('--tx', tx + 'px');
            particle.style.setProperty('--ty', ty + 'px');

            this.container.appendChild(particle);
            this._trackTimeout(setTimeout(() => particle.remove(), 800));
        }

        // 冲击波
        const shockwave = this._createAnimElement('div');
        shockwave.className = 'shockwave';
        shockwave.style.position = 'absolute';
        shockwave.style.left = (x - 75) + 'px';
        shockwave.style.top = (y - 75) + 'px';
        shockwave.style.width = '150px';
        shockwave.style.height = '150px';
        shockwave.style.borderRadius = '50%';
        shockwave.style.border = '3px solid rgba(255,100,50,0.8)';
        shockwave.style.pointerEvents = 'none';
        shockwave.style.zIndex = '9998';
        this.container.appendChild(shockwave);
        this._trackTimeout(setTimeout(() => shockwave.remove(), 600));

        if (flash) {
            this.flashScreen('rgba(255, 200, 100, 0.25)', 300);
        }
    }

    /**
     * 火箭飞行特效
     * @param {number} startX - 起始 X
     * @param {number} startY - 起始 Y
     * @param {number} endX - 目标 X
     * @param {number} endY - 目标 Y
     */
    rocketFly(startX, startY, endX, endY) {
        const rocket = this._createAnimElement('div');
        rocket.className = 'rocket-anim';
        rocket.textContent = '🚀';
        rocket.style.position = 'absolute';
        rocket.style.left = startX + 'px';
        rocket.style.top = startY + 'px';
        rocket.style.fontSize = '32px';
        rocket.style.pointerEvents = 'none';
        rocket.style.zIndex = '9999';
        rocket.style.setProperty('--end-x', (endX - startX) + 'px');
        rocket.style.setProperty('--end-y', (endY - startY) + 'px');

        this.container.appendChild(rocket);
        this._trackTimeout(setTimeout(() => rocket.remove(), 1000));

        // 尾焰粒子
        for (let i = 0; i < 10; i++) {
            this._trackTimeout(setTimeout(() => {
                const flame = this._createAnimElement('div');
                flame.className = 'flame-particle';
                flame.style.position = 'absolute';
                const progress = i / 10;
                flame.style.left = (startX + (endX - startX) * progress) + 'px';
                flame.style.top = (startY + (endY - startY) * progress) + 'px';
                flame.style.width = '8px';
                flame.style.height = '8px';
                flame.style.background = 'rgba(255, 150, 50, 0.8)';
                flame.style.borderRadius = '50%';
                flame.style.pointerEvents = 'none';
                flame.style.zIndex = '9998';
                this.container.appendChild(flame);
                this._trackTimeout(setTimeout(() => flame.remove(), 400));
            }, i * 60));
        }
    }

    /**
     * 飘字特效（分数、提示等）
     * @param {number} x
     * @param {number} y
     * @param {string} text
     * @param {string} color
     */
    floatingText(x, y, text, color = '#f0c040') {
        const el = this._createAnimElement('div');
        el.className = 'floating-text';
        el.textContent = text;
        el.style.position = 'absolute';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.color = color;
        el.style.fontSize = '24px';
        el.style.fontWeight = 'bold';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '9999';
        el.style.textShadow = '0 2px 4px rgba(0,0,0,0.5)';
        el.style.setProperty('--float-y', '-50px');

        this.container.appendChild(el);
        this._trackTimeout(setTimeout(() => el.remove(), 1200));
    }

    /**
     * 地主皇冠弹出特效
     * @param {number} x
     * @param {number} y
     */
    landlordCrown(x, y) {
        const crown = this._createAnimElement('div');
        crown.className = 'landlord-crown';
        crown.textContent = '👑';
        crown.style.position = 'absolute';
        crown.style.left = x + 'px';
        crown.style.top = y + 'px';
        crown.style.fontSize = '40px';
        crown.style.pointerEvents = 'none';
        crown.style.zIndex = '9999';

        this.container.appendChild(crown);
        this._trackTimeout(setTimeout(() => crown.remove(), 2000));
    }

    // ==================== 全新特效方法 ====================

    /**
     * 全屏震动
     * @param {number} intensity - 震动幅度（px）
     * @param {number} duration - 持续时间（ms）
     */
    screenShake(intensity = 5, duration = 400) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        duration = Math.max(duration, 1);
        // 使用引用计数安全地修改 body transform
        if (!this._shakeCount) this._shakeCount = 0;
        // 限制并发震动次数，防止过度叠加
        if (this._shakeCount > 5) return;
        // 每次开始震动时都重新获取当前 transform，确保准确
        if (this._shakeCount === 0) {
            this._shakeOriginalTransform = document.body.style.transform || '';
        }
        this._shakeCount++;

        const startTime = performance.now();
        let rafId = null;

        const shake = (now) => {
            const elapsed = now - startTime;
            if (elapsed >= duration) {
                this._shakeCount--;
                if (this._shakeCount <= 0) {
                    document.body.style.transform = this._shakeOriginalTransform;
                    this._shakeCount = 0;
                    this._shakeOriginalTransform = null;
                }
                if (rafId !== null) {
                    this._untrackRaf(rafId);
                    rafId = null;
                }
                return;
            }
            const decay = 1 - elapsed / duration;
            const dx = (Math.random() - 0.5) * 2 * intensity * decay;
            const dy = (Math.random() - 0.5) * 2 * intensity * decay;
            document.body.style.transform = `${this._shakeOriginalTransform} translate(${dx}px, ${dy}px)`.trim();
            // 先移除旧 id 再注册新 id，防止 _activeRafs 无限膨胀
            if (rafId !== null) this._untrackRaf(rafId);
            rafId = requestAnimationFrame(shake);
            this._trackRaf(rafId);
        };

        rafId = requestAnimationFrame(shake);
        this._trackRaf(rafId);
    }

    /**
     * 全屏闪光遮罩
     * @param {string} color - 闪光颜色
     * @param {number} duration - 持续时间（ms）
     */
    flashScreen(color = 'rgba(255,255,255,0.3)', duration = 200) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const overlay = this._createAnimElement('div');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = color;
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '99999';
        overlay.style.transition = `opacity ${duration}ms ease-out`;
        overlay.style.opacity = '1';

        this.container.appendChild(overlay);

        // 强制重绘后淡出
        this._trackRaf(requestAnimationFrame(() => {
            this._trackRaf(requestAnimationFrame(() => {
                overlay.style.opacity = '0';
            }));
        }));

        this._trackTimeout(setTimeout(() => overlay.remove(), duration + 50));
    }

    /**
     * 卡牌弧线飞行动画
     * @param {number} fromX
     * @param {number} fromY
     * @param {number} toX
     * @param {number} toY
     * @param {HTMLElement|string|null} card - 已有元素、HTML字符串或null
     * @param {number} duration
     * @param {Function|null} onComplete
     */
    cardFly(fromX, fromY, toX, toY, card = null, duration = 500, onComplete = null) {
        duration = Math.max(duration, 1);
        let el;
        let isTemp = false;

        if (card instanceof HTMLElement) {
            el = card;
            // 使用 Symbol 保存原始 transform，避免属性名冲突和覆盖
            if (!el[_originalTransformKey]) {
                el[_originalTransformKey] = el.style.transform;
            }
        } else if (typeof card === 'string') {
            isTemp = true;
            el = this._createAnimElement('div');
            el.innerHTML = card;
            el.style.position = 'fixed';
            el.style.left = fromX + 'px';
            el.style.top = fromY + 'px';
            el.style.pointerEvents = 'none';
            el.style.zIndex = '9999';
            this.container.appendChild(el);
        } else {
            isTemp = true;
            el = this._createAnimElement('div');
            el.className = 'deal-fly-card';
            el.style.position = 'fixed';
            el.style.left = fromX + 'px';
            el.style.top = fromY + 'px';
            el.style.pointerEvents = 'none';
            el.style.zIndex = '9999';
            this.container.appendChild(el);
        }

        const startTime = performance.now();
        const midX = (fromX + toX) / 2;
        const midY = Math.min(fromY, toY) - 100; // 弧线顶点

        let rafId = null;
        const animate = (now) => {
            const t = Math.min((now - startTime) / duration, 1);
            // 二次贝塞尔曲线插值
            const x = (1 - t) * (1 - t) * fromX + 2 * (1 - t) * t * midX + t * t * toX;
            const y = (1 - t) * (1 - t) * fromY + 2 * (1 - t) * t * midY + t * t * toY;
            const rot = t < 0.5 ? t * 40 : (1 - t) * 40;

            // 使用 transform 代替 left/top 避免 layout 触发
            const dx = x - fromX;
            const dy = y - fromY;
            el.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${rot}deg)`;

            if (t < 1) {
                if (rafId !== null) this._untrackRaf(rafId);
                rafId = requestAnimationFrame(animate);
                this._trackRaf(rafId);
            } else {
                if (rafId !== null) {
                    this._untrackRaf(rafId);
                    rafId = null;
                }
                if (onComplete) onComplete();
                if (isTemp) {
                    this._trackTimeout(setTimeout(() => el.remove(), 0));
                } else {
                    // 恢复原始 transform
                    el.style.transform = el[_originalTransformKey] || '';
                    delete el[_originalTransformKey];
                }
            }
        };

        rafId = requestAnimationFrame(animate);
        this._trackRaf(rafId);
    }

    /**
     * 从牌桌中心向三方发牌动画
     * @param {number} centerX
     * @param {number} centerY
     * @param {Array<{x:number,y:number}>} targets - 三个目标位置
     * @param {number} count - 每个目标发几张
     */
    dealFromCenter(centerX, centerY, targets, count = 17) {
        targets.forEach((target, idx) => {
            for (let i = 0; i < count; i++) {
                const delay = (idx * count + i) * 40;
                this._trackTimeout(setTimeout(() => {
                    const card = this._createAnimElement('div');
                    card.className = 'deal-fly-card';
                    card.style.position = 'absolute';
                    card.style.left = centerX + 'px';
                    card.style.top = centerY + 'px';
                    card.style.pointerEvents = 'none';
                    card.style.zIndex = '9999';
                    this.container.appendChild(card);

                    this.cardFly(centerX, centerY, target.x, target.y, card, 300, () => {
                        card.remove();
                    });
                }, delay));
            }
        });
    }

    /**
     * 元素弹跳进入（0 → 1.2 → 1）
     * @param {HTMLElement} element
     * @param {number} duration
     */
    popIn(element, duration = 300) {
        if (!element) return;
        element.style.display = '';
        element.style.opacity = '0';
        element.style.transform = 'scale(0)';
        element.style.transition = `transform ${duration}ms cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity ${duration}ms ease-out`;

        this._trackRaf(requestAnimationFrame(() => {
            this._trackRaf(requestAnimationFrame(() => {
                element.style.opacity = '1';
                element.style.transform = 'scale(1.2)';
                this._trackTimeout(setTimeout(() => {
                    element.style.transition = `transform ${duration * 0.4}ms ease-out`;
                    element.style.transform = 'scale(1)';
                }, duration));
            }));
        }));
    }

    /**
     * 元素弹出消失
     * @param {HTMLElement} element
     * @param {number} duration
     */
    popOut(element, duration = 200) {
        if (!element) return;
        element.style.transition = `transform ${duration}ms ease-in, opacity ${duration}ms ease-in`;
        element.style.transform = 'scale(0)';
        element.style.opacity = '0';
        this._trackTimeout(setTimeout(() => {
            element.style.display = 'none';
        }, duration));
    }

    /**
     * 扩散光环脉冲
     * @param {number} x
     * @param {number} y
     * @param {string} color
     * @param {number} size
     */
    pulseRing(x, y, color = '#f0c040', size = 100) {
        const ring = this._createAnimElement('div');
        ring.style.position = 'absolute';
        ring.style.left = x + 'px';
        ring.style.top = y + 'px';
        ring.style.width = '0px';
        ring.style.height = '0px';
        ring.style.border = `3px solid ${color}`;
        ring.style.borderRadius = '50%';
        ring.style.transform = 'translate(-50%, -50%)';
        ring.style.pointerEvents = 'none';
        ring.style.zIndex = '9998';
        ring.style.transition = `all 600ms ease-out`;
        ring.style.opacity = '1';

        this.container.appendChild(ring);

        this._trackRaf(requestAnimationFrame(() => {
            this._trackRaf(requestAnimationFrame(() => {
                ring.style.width = size + 'px';
                ring.style.height = size + 'px';
                ring.style.opacity = '0';
            }));
        }));

        this._trackTimeout(setTimeout(() => ring.remove(), 650));
    }

    /**
     * 彩纸屑爆发
     * @param {number} x
     * @param {number} y
     * @param {number} count
     */
    confetti(x, y, count = 30) {
        const colors = ['#ff4444', '#44ff44', '#4444ff', '#ffcc00', '#ff44ff', '#00ffff'];

        for (let i = 0; i < count; i++) {
            const piece = this._createAnimElement('div');
            piece.style.position = 'absolute';
            piece.style.left = x + 'px';
            piece.style.top = y + 'px';
            piece.style.width = (6 + Math.random() * 6) + 'px';
            piece.style.height = (6 + Math.random() * 6) + 'px';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.pointerEvents = 'none';
            piece.style.zIndex = '9999';

            const angle = Math.random() * Math.PI * 2;
            const speed = 100 + Math.random() * 200;
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed - 150; // 初始向上抛

            const startTime = performance.now();
            const duration = 1000 + Math.random() * 1000;

            let rafId = null;
            const animate = (now) => {
                const t = (now - startTime) / duration;
                if (t >= 1) {
                    if (rafId !== null) {
                        this._untrackRaf(rafId);
                        rafId = null;
                    }
                    piece.remove();
                    return;
                }
                const dx = vx * t;
                const dy = vy * t + 300 * t * t; // 重力
                const rot = t * 720;
                // 使用 translate3d 避免 layout 触发
                piece.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${rot}deg)`;
                piece.style.opacity = String(1 - t);
                if (rafId !== null) this._untrackRaf(rafId);
                rafId = requestAnimationFrame(animate);
                this._trackRaf(rafId);
            };

            this.container.appendChild(piece);
            rafId = requestAnimationFrame(animate);
            this._trackRaf(rafId);
        }
    }

    /**
     * 星星/闪光粒子爆发
     * @param {number} x
     * @param {number} y
     * @param {number} count
     */
    sparkleBurst(x, y, count = 15) {
        for (let i = 0; i < count; i++) {
            const star = this._createAnimElement('div');
            star.textContent = '✦';
            star.style.position = 'absolute';
            star.style.left = x + 'px';
            star.style.top = y + 'px';
            star.style.color = '#fff';
            star.style.fontSize = (12 + Math.random() * 12) + 'px';
            star.style.pointerEvents = 'none';
            star.style.zIndex = '9999';

            const angle = (Math.PI * 2 * i) / count;
            const distance = 40 + Math.random() * 80;
            const tx = Math.cos(angle) * distance;
            const ty = Math.sin(angle) * distance;

            const startTime = performance.now();
            const duration = 500 + Math.random() * 400;

            let rafId = null;
            const animate = (now) => {
                const t = Math.min((now - startTime) / duration, 1);
                star.style.transform = `translate(${tx * t}px, ${ty * t}px) scale(${1 - t})`;
                star.style.opacity = String(1 - t);
                if (t < 1) {
                    if (rafId !== null) this._untrackRaf(rafId);
                    rafId = requestAnimationFrame(animate);
                    this._trackRaf(rafId);
                } else {
                    if (rafId !== null) {
                        this._untrackRaf(rafId);
                        rafId = null;
                    }
                    star.remove();
                }
            };

            this.container.appendChild(star);
            rafId = requestAnimationFrame(animate);
            this._trackRaf(rafId);
        }
    }

    /**
     * 径向光晕扩散
     * @param {number} x
     * @param {number} y
     * @param {string} color
     */
    glowBurst(x, y, color = '#f0c040') {
        const glow = this._createAnimElement('div');
        glow.style.position = 'absolute';
        glow.style.left = x + 'px';
        glow.style.top = y + 'px';
        glow.style.width = '0px';
        glow.style.height = '0px';
        glow.style.transform = 'translate(-50%, -50%)';
        glow.style.borderRadius = '50%';
        glow.style.background = `radial-gradient(circle, ${color} 0%, transparent 70%)`;
        glow.style.pointerEvents = 'none';
        glow.style.zIndex = '9998';
        glow.style.transition = 'all 500ms ease-out';

        this.container.appendChild(glow);

        this._trackRaf(requestAnimationFrame(() => {
            this._trackRaf(requestAnimationFrame(() => {
                glow.style.width = '200px';
                glow.style.height = '200px';
                glow.style.opacity = '0';
            }));
        }));

        this._trackTimeout(setTimeout(() => glow.remove(), 550));
    }

    /**
     * 短暂发光轨迹点
     * @param {number} x
     * @param {number} y
     * @param {string} color
     */
    trailEffect(x, y, color = '#fff') {
        const dot = this._createAnimElement('div');
        dot.style.position = 'absolute';
        dot.style.left = (x - 3) + 'px';
        dot.style.top = (y - 3) + 'px';
        dot.style.width = '6px';
        dot.style.height = '6px';
        dot.style.background = color;
        dot.style.borderRadius = '50%';
        dot.style.boxShadow = `0 0 6px 2px ${color}`;
        dot.style.pointerEvents = 'none';
        dot.style.zIndex = '9997';
        dot.style.transition = 'opacity 300ms ease-out';
        dot.style.opacity = '1';

        this.container.appendChild(dot);

        this._trackRaf(requestAnimationFrame(() => {
            this._trackRaf(requestAnimationFrame(() => {
                dot.style.opacity = '0';
            }));
        }));

        this._trackTimeout(setTimeout(() => dot.remove(), 350));
    }

    /**
     * 数字滚动增长
     * @param {HTMLElement} element
     * @param {number} from
     * @param {number} to
     * @param {number} duration
     */
    countUp(element, from, to, duration = 600) {
        if (!element) return;
        duration = Math.max(duration, 1);
        const startTime = performance.now();
        const diff = to - from;

        let rafId = null;
        const update = (now) => {
            const t = Math.min((now - startTime) / duration, 1);
            // easeOutQuad
            const ease = 1 - (1 - t) * (1 - t);
            const current = Math.round(from + diff * ease);
            element.textContent = String(current);
            if (t < 1) {
                if (rafId !== null) this._untrackRaf(rafId);
                rafId = requestAnimationFrame(update);
                this._trackRaf(rafId);
            } else {
                if (rafId !== null) {
                    this._untrackRaf(rafId);
                    rafId = null;
                }
            }
        };

        rafId = requestAnimationFrame(update);
        this._trackRaf(rafId);
    }

    /**
     * 3D 卡牌翻转
     * @param {HTMLElement} element
     * @param {Function|null} onComplete
     */
    flipCard(element, onComplete = null) {
        if (!element) return;
        element.style.transition = 'transform 400ms ease-in-out';
        element.style.transformStyle = 'preserve-3d';

        this._trackRaf(requestAnimationFrame(() => {
            element.style.transform = 'rotateY(90deg)';
            this._trackTimeout(setTimeout(() => {
                element.style.transform = 'rotateY(0deg)';
                this._trackTimeout(setTimeout(() => {
                    if (onComplete) onComplete();
                }, 400));
            }, 200));
        }));
    }

    /**
     * 弹跳文字（弹入后上浮消失）
     * @param {number} x
     * @param {number} y
     * @param {string} text
     * @param {string} color
     */
    bounceText(x, y, text, color = '#fff') {
        const el = this._createAnimElement('div');
        el.textContent = text;
        el.style.position = 'absolute';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.color = color;
        el.style.fontSize = '28px';
        el.style.fontWeight = 'bold';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '9999';
        el.style.textShadow = '0 2px 6px rgba(0,0,0,0.6)';
        el.style.opacity = '0';
        el.style.transform = 'scale(0.3) translateY(20px)';
        el.style.transition = 'transform 400ms cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 300ms ease-out';

        this.container.appendChild(el);

        this._trackRaf(requestAnimationFrame(() => {
            this._trackRaf(requestAnimationFrame(() => {
                el.style.opacity = '1';
                el.style.transform = 'scale(1.1) translateY(0)';
                this._trackTimeout(setTimeout(() => {
                    el.style.transition = 'transform 800ms ease-out, opacity 800ms ease-in';
                    el.style.transform = 'scale(1) translateY(-60px)';
                    el.style.opacity = '0';
                }, 400));
            }));
        }));

        this._trackTimeout(setTimeout(() => el.remove(), 1300));
    }

    /**
     * 元素从指定方向滑入
     * @param {HTMLElement} element
     * @param {string} direction - 'top' | 'bottom' | 'left' | 'right'
     * @param {number} duration
     */
    slideInFrom(element, direction = 'bottom', duration = 400) {
        const dist = 100;
        let tx = 0, ty = 0;
        switch (direction) {
            case 'top': ty = -dist; break;
            case 'bottom': ty = dist; break;
            case 'left': tx = -dist; break;
            case 'right': tx = dist; break;
        }

        element.style.opacity = '0';
        element.style.transform = `translate(${tx}px, ${ty}px)`;
        element.style.transition = `transform ${duration}ms ease-out, opacity ${duration}ms ease-out`;

        this._trackRaf(requestAnimationFrame(() => {
            this._trackRaf(requestAnimationFrame(() => {
                element.style.opacity = '1';
                element.style.transform = 'translate(0, 0)';
            }));
        }));
    }

    /**
     * 元素旋转淡出
     * @param {HTMLElement} element
     * @param {number} duration
     */
    rotateOut(element, duration = 300) {
        if (!element) return;
        element.style.transition = `transform ${duration}ms ease-in, opacity ${duration}ms ease-in`;
        element.style.transform = 'rotate(180deg) scale(0.5)';
        element.style.opacity = '0';
        this._trackTimeout(setTimeout(() => {
            element.style.display = 'none';
        }, duration));
    }

    /**
     * 表情/图标围绕中心点轨道旋转
     * @param {number} centerX
     * @param {number} centerY
     * @param {string} emoji
     * @param {number} radius
     * @param {number} duration
     */
    orbitEffect(centerX, centerY, emoji = '⭐', radius = 60, duration = 2000) {
        duration = Math.max(duration, 1);
        const el = this._createAnimElement('div');
        el.textContent = emoji;
        el.style.position = 'absolute';
        el.style.fontSize = '24px';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '9999';
        el.style.transform = 'translate(-50%, -50%)';

        this.container.appendChild(el);

        const startTime = performance.now();

        let rafId = null;
        const animate = (now) => {
            const t = (now - startTime) / duration;
            if (t >= 1) {
                if (rafId !== null) {
                    this._untrackRaf(rafId);
                    rafId = null;
                }
                el.remove();
                return;
            }
            const angle = t * Math.PI * 2;
            const dx = Math.cos(angle) * radius;
            const dy = Math.sin(angle) * radius;
            // 使用 translate3d 避免 layout 触发，保留居中偏移
            el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            if (rafId !== null) this._untrackRaf(rafId);
            rafId = requestAnimationFrame(animate);
            this._trackRaf(rafId);
        };

        rafId = requestAnimationFrame(animate);
        this._trackRaf(rafId);
    }

    /**
     * 点击/触碰涟漪效果
     * @param {number} x
     * @param {number} y
     * @param {string} color
     */
    ripple(x, y, color = 'rgba(255,255,255,0.3)') {
        const ripple = this._createAnimElement('div');
        ripple.style.position = 'absolute';
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        ripple.style.width = '0px';
        ripple.style.height = '0px';
        ripple.style.borderRadius = '50%';
        ripple.style.background = color;
        ripple.style.transform = 'translate(-50%, -50%)';
        ripple.style.pointerEvents = 'none';
        ripple.style.zIndex = '9998';
        ripple.style.transition = 'all 600ms ease-out';

        this.container.appendChild(ripple);

        this._trackRaf(requestAnimationFrame(() => {
            this._trackRaf(requestAnimationFrame(() => {
                ripple.style.width = '150px';
                ripple.style.height = '150px';
                ripple.style.opacity = '0';
            }));
        }));

        this._trackTimeout(setTimeout(() => ripple.remove(), 650));
    }

    /**
     * 春天/反春天全屏庆祝（花瓣 + 彩纸）
     */
    springCelebrate() {
        if (this._isSpringCelebrating) return;
        this._isSpringCelebrating = true;
        this._trackTimeout(setTimeout(() => { this._isSpringCelebrating = false; }, 3000));
        const w = window.innerWidth;
        const h = window.innerHeight;

        // 彩纸
        for (let i = 0; i < 60; i++) {
            this._trackTimeout(setTimeout(() => {
                this.confetti(w / 2, h / 2, 1);
            }, i * 30));
        }

        // 花瓣飘落
        const petalColors = ['#ffb7c5', '#ffc0cb', '#ff69b4', '#fff0f5'];
        for (let i = 0; i < 30; i++) {
            const petal = this._createAnimElement('div');
            petal.textContent = '🌸';
            petal.style.position = 'fixed';
            petal.style.left = (Math.random() * w) + 'px';
            petal.style.top = '-30px';
            petal.style.fontSize = (16 + Math.random() * 14) + 'px';
            petal.style.pointerEvents = 'none';
            petal.style.zIndex = '9999';
            petal.style.opacity = '0.8';

            this.container.appendChild(petal);

            const startTime = performance.now();
            const duration = 2000 + Math.random() * 2000;
            const sway = 30 + Math.random() * 50;

            const startX = parseFloat(petal.style.left);
            let fallRafId = null;
            const fall = (now) => {
                const t = (now - startTime) / duration;
                if (t >= 1) {
                    if (fallRafId !== null) {
                        this._untrackRaf(fallRafId);
                        fallRafId = null;
                    }
                    petal.remove();
                    return;
                }
                const dx = Math.sin(t * Math.PI * 4) * sway * 0.02;
                const dy = t * (h + 60);
                const rot = t * 360;
                // 使用 translate3d 避免 layout 触发
                petal.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${rot}deg)`;
                if (fallRafId !== null) this._untrackRaf(fallRafId);
                fallRafId = requestAnimationFrame(fall);
                this._trackRaf(fallRafId);
            };

            this._trackTimeout(setTimeout(() => {
                fallRafId = requestAnimationFrame(fall);
                this._trackRaf(fallRafId);
            }, i * 150));
        }

        this.bounceText(w / 2, h / 3, '🎉 春天！', '#ffeb3b');
    }

    /**
     * 胜利庆祝（根据身份显示不同效果）
     * @param {boolean} isLandlordWin
     * @param {number} winnerIndex - 0=地主, 1=农民1, 2=农民2
     */
    winCelebrate(isLandlordWin, winnerIndex) {
        if (this._isWinCelebrating) return;
        this._isWinCelebrating = true;
        this._trackTimeout(setTimeout(() => { this._isWinCelebrating = false; }, 4000));
        
        const w = window.innerWidth;
        const h = window.innerHeight;
        const colors = isLandlordWin ? ['#ffd700', '#ff8c00', '#ff4500'] : ['#00ff88', '#00ccff', '#aaeeff'];

        // 全屏闪光
        this.flashScreen(isLandlordWin ? 'rgba(255,200,50,0.2)' : 'rgba(50,200,255,0.2)', 400);

        // 屏幕震动
        this.screenShake(4, 300);

        // 彩纸爆发（多点）
        const burstPoints = [
            { x: w * 0.2, y: h * 0.3 },
            { x: w * 0.5, y: h * 0.2 },
            { x: w * 0.8, y: h * 0.3 },
        ];
        burstPoints.forEach((pt, idx) => {
            this._trackTimeout(setTimeout(() => {
                this.confetti(pt.x, pt.y, 25);
            }, idx * 200));
        });

        // 胜利文字
        const text = isLandlordWin ? '👑 地主胜利！' : '👨‍🌾 农民胜利！';
        const color = isLandlordWin ? '#ffd700' : '#00ff88';
        this.bounceText(w / 2, h / 2 - 40, text, color);

        // 光环脉冲
        this._trackTimeout(setTimeout(() => {
            this.pulseRing(w / 2, h / 2, color, 300);
        }, 300));

        // 星星爆发
        this._trackTimeout(setTimeout(() => {
            this.sparkleBurst(w / 2, h / 2, 30);
        }, 500));
    }

    // ==================== v1.1.7 全局动画增强 ====================

    /**
     * 选牌时的闪光粒子轨迹
     * @param {HTMLElement} cardEl
     */
    cardSelectSparkle(cardEl) {
        if (!cardEl) return;
        const rect = cardEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        for (let i = 0; i < 6; i++) {
            const dot = this._createAnimElement('div');
            dot.className = 'select-sparkle';
            dot.style.left = cx + 'px';
            dot.style.top = cy + 'px';
            const angle = (Math.PI * 2 * i) / 6;
            const dist = 20 + Math.random() * 30;
            dot.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
            dot.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
            this.container.appendChild(dot);
            this._trackTimeout(setTimeout(() => dot.remove(), 500));
        }
    }

    /**
     * 提示牌的光晕扫过效果
     * @param {HTMLElement} cardEl
     */
    hintGlowSweep(cardEl) {
        const glow = this._createAnimElement('div');
        glow.className = 'hint-glow-sweep';
        const rect = cardEl.getBoundingClientRect();
        glow.style.left = rect.left + 'px';
        glow.style.top = rect.top + 'px';
        glow.style.width = rect.width + 'px';
        glow.style.height = rect.height + 'px';
        this.container.appendChild(glow);
        this._trackTimeout(setTimeout(() => glow.remove(), 700));
    }

    /**
     * 回合切换时的玩家区域光晕扩散
     * @param {HTMLElement} areaEl
     */
    turnSwitchGlow(areaEl) {
        if (!areaEl) return;
        const rect = areaEl.getBoundingClientRect();
        const glow = this._createAnimElement('div');
        glow.className = 'turn-switch-glow';
        glow.style.left = (rect.left + rect.width / 2) + 'px';
        glow.style.top = (rect.top + rect.height / 2) + 'px';
        this.container.appendChild(glow);
        this._trackTimeout(setTimeout(() => glow.remove(), 800));
    }

    /**
     * 倒计时数字出现时的弹跳放大
     * @param {HTMLElement} timerEl
     */
    countdownAppear(timerEl) {
        if (!timerEl) return;
        timerEl.style.animation = 'none';
        timerEl.offsetHeight; // force reflow
        timerEl.style.animation = 'countdownAppear 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    }

    /**
     * 增强的思考指示器（旋转光环）
     * @param {HTMLElement} indicatorEl
     */
    thinkingEnhance(indicatorEl) {
        if (!indicatorEl) return;
        indicatorEl.classList.add('thinking-enhanced');
    }

    /**
     * 按钮按下时的涟漪+缩放反馈
     * @param {HTMLElement} btnEl
     */
    buttonPress(btnEl) {
        if (!btnEl) return;
        btnEl.classList.add('btn-press-anim');
        this._trackTimeout(setTimeout(() => btnEl.classList.remove('btn-press-anim'), 200));
    }

    /**
     * 连击/连续出牌特效
     * @param {number} x
     * @param {number} y
     * @param {number} comboCount
     */
    comboEffect(x, y, comboCount) {
        const texts = ['', '连击!', '双连击!', '三连击!', '四连击!', '无敌!'];
        const text = texts[Math.min(comboCount, texts.length - 1)];
        if (!text) return;
        const el = this._createAnimElement('div');
        el.className = 'combo-text';
        el.textContent = text;
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        this.container.appendChild(el);
        this._trackTimeout(setTimeout(() => el.remove(), 1500));

        // 光环
        this.pulseRing(x, y, '#ff9800', 80 + comboCount * 20);
        // 星星
        this.sparkleBurst(x, y, 8 + comboCount * 3);
    }

    /**
     * 手牌进入时的依次飞入
     * @param {NodeList} cardEls
     * @param {number} baseDelay
     */
    handCardsEnter(cardEls, baseDelay = 30) {
        if (!cardEls) return;
        cardEls.forEach((el, i) => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(30px) scale(0.8)';
            this._trackTimeout(setTimeout(() => {
                el.style.transition = 'all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                el.style.opacity = '1';
                el.style.transform = 'translateY(0) scale(1)';
                this._trackTimeout(setTimeout(() => {
                    el.style.transition = '';
                }, 300));
            }, i * baseDelay));
        });
    }

    /**
     * 得分数字弹出（带颜色）
     * @param {number} x
     * @param {number} y
     * @param {number} score
     * @param {boolean} isPositive
     */
    scorePopup(x, y, score, isPositive = true) {
        const el = this._createAnimElement('div');
        el.className = 'score-popup';
        el.textContent = (isPositive ? '+' : '') + score;
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.color = isPositive ? '#4caf50' : '#f44336';
        this.container.appendChild(el);
        this._trackTimeout(setTimeout(() => el.remove(), 1200));
    }

    /**
     * 背景浮动粒子（少量装饰）
     */
    bgParticles(count = 12) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        for (let i = 0; i < count; i++) {
            const p = this._createAnimElement('div');
            p.className = 'bg-particle';
            p.style.left = Math.random() * w + 'px';
            p.style.top = Math.random() * h + 'px';
            p.style.animationDelay = Math.random() * 5 + 's';
            p.style.animationDuration = (4 + Math.random() * 4) + 's';
            this.container.appendChild(p);
        }
    }

    /**
     * 清除背景粒子
     */
    clearBgParticles() {
        document.querySelectorAll('.bg-particle').forEach(p => p.remove());
    }

    /**
     * 模态框内容切换时的缩放过渡
     * @param {HTMLElement} contentEl
     */
    modalContentSwitch(contentEl) {
        if (!contentEl) return;
        contentEl.style.animation = 'modalContentSwitch 0.3s ease';
        this._trackTimeout(setTimeout(() => { contentEl.style.animation = ''; }, 300));
    }

    /**
     * 玩家头像脉冲发光（回合切换时）
     * @param {HTMLElement} avatarEl
     */
    avatarPulse(avatarEl) {
        if (!avatarEl) return;
        avatarEl.classList.add('avatar-pulse-anim');
        this._trackTimeout(setTimeout(() => avatarEl.classList.remove('avatar-pulse-anim'), 600));
    }

    /**
     * 卡牌取消选中时的下沉动画
     * @param {HTMLElement} cardEl
     */
    cardDeselect(cardEl) {
        if (!cardEl) return;
        cardEl.classList.add('card-deselect-anim');
        this._trackTimeout(setTimeout(() => cardEl.classList.remove('card-deselect-anim'), 200));
    }

    /**
     * 控制面板切换时的淡入淡出
     * @param {HTMLElement} panelEl
     * @param {boolean} show
     */
    panelFadeToggle(panelEl, show) {
        if (!panelEl) return;
        if (show) {
            panelEl.style.opacity = '0';
            panelEl.style.transform = 'translateY(20px)';
            panelEl.style.transition = 'all 0.3s ease-out';
            this._trackRaf(requestAnimationFrame(() => {
                panelEl.style.opacity = '1';
                panelEl.style.transform = 'translateY(0)';
            }));
        } else {
            panelEl.style.transition = 'all 0.2s ease-in';
            panelEl.style.opacity = '0';
            panelEl.style.transform = 'translateY(10px)';
        }
    }

    /**
     * 快捷短语发送时的飞行动画
     * @param {number} fromX
     * @param {number} fromY
     * @param {number} toX
     * @param {number} toY
     */
    phraseFly(fromX, fromY, toX, toY) {
        const el = this._createAnimElement('div');
        el.className = 'phrase-fly';
        el.textContent = '💬';
        el.style.left = fromX + 'px';
        el.style.top = fromY + 'px';
        el.style.setProperty('--to-x', (toX - fromX) + 'px');
        el.style.setProperty('--to-y', (toY - fromY) + 'px');
        this.container.appendChild(el);
        this._trackTimeout(setTimeout(() => el.remove(), 600));
    }

    /**
     * 记牌器/历史记录按钮徽章弹跳
     * @param {HTMLElement} badgeEl
     */
    badgeBounce(badgeEl) {
        if (!badgeEl) return;
        badgeEl.classList.add('badge-bounce-anim');
        this._trackTimeout(setTimeout(() => badgeEl.classList.remove('badge-bounce-anim'), 400));
    }

    /**
     * 底牌揭示时的3D翻转增强
     * @param {HTMLElement} cardEl
     * @param {number} delay
     */
    bottomCardReveal(cardEl, delay = 0) {
        if (!cardEl) return;
        this._trackTimeout(setTimeout(() => {
            cardEl.style.transition = 'transform 0.5s ease-in-out';
            cardEl.style.transformStyle = 'preserve-3d';
            cardEl.style.transform = 'rotateY(90deg) scale(1.1)';
            this._trackTimeout(setTimeout(() => {
                cardEl.style.transform = 'rotateY(0deg) scale(1)';
                this.sparkleBurst(
                    cardEl.getBoundingClientRect().left + cardEl.offsetWidth / 2,
                    cardEl.getBoundingClientRect().top + cardEl.offsetHeight / 2,
                    5
                );
            }, 250));
        }, delay));
    }

    /**
     * 托管状态切换时的脉冲提示
     * @param {HTMLElement} areaEl
     * @param {boolean} isAuto
     */
    autoTogglePulse(areaEl, isAuto) {
        if (!areaEl) return;
        const pulse = this._createAnimElement('div');
        pulse.className = isAuto ? 'auto-pulse-on' : 'auto-pulse-off';
        const rect = areaEl.getBoundingClientRect();
        pulse.style.left = (rect.left + rect.width / 2) + 'px';
        pulse.style.top = (rect.top + rect.height / 2) + 'px';
        this.container.appendChild(pulse);
        this._trackTimeout(setTimeout(() => pulse.remove(), 700));
    }

    /**
     * 胜利时的金色雨
     * @param {number} duration
     */
    goldRain(duration = 3000) {
        const w = window.innerWidth;
        const count = 40;
        for (let i = 0; i < count; i++) {
            const drop = this._createAnimElement('div');
            drop.className = 'gold-rain-drop';
            drop.textContent = Math.random() > 0.5 ? '✦' : '★';
            drop.style.left = Math.random() * w + 'px';
            drop.style.top = '-20px';
            drop.style.fontSize = (10 + Math.random() * 14) + 'px';
            drop.style.animationDelay = Math.random() * 2 + 's';
            drop.style.animationDuration = (1.5 + Math.random() * 2) + 's';
            this.container.appendChild(drop);
            this._trackTimeout(setTimeout(() => drop.remove(), duration));
        }
    }

    /**
     * 卡牌整理/排序时的洗牌动画
     * @param {NodeList} cardEls
     */
    shuffleCards(cardEls) {
        if (!cardEls) return;
        cardEls.forEach((el, i) => {
            el.style.transition = 'transform 0.3s ease';
            el.style.transform = `translateX(${(Math.random() - 0.5) * 20}px) rotate(${(Math.random() - 0.5) * 10}deg)`;
            this._trackTimeout(setTimeout(() => {
                el.style.transform = 'translateX(0) rotate(0)';
                this._trackTimeout(setTimeout(() => { el.style.transition = ''; }, 300));
            }, 200 + i * 20));
        });
    }

    /**
     * 新记录/最高分时的闪光横幅
     * @param {string} text
     */
    newRecordBanner(text) {
        const el = this._createAnimElement('div');
        el.className = 'new-record-banner';
        el.textContent = '🏆 ' + text;
        this.container.appendChild(el);
        this._trackTimeout(setTimeout(() => el.remove(), 2500));
    }
}

export { Animations };

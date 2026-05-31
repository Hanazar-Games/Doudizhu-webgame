/**
 * 浏览器 UI 回归测试
 * 自动启动 dev server → Playwright 检查 UI → 关闭 server
 * 失败条件：console error / 关键元素缺失 / 交互状态异常
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';
import net from 'net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'test/ui-screenshots');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const delays = { short: 400, medium: 800, long: 1500 };

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

async function startDevServer(port) {
    return new Promise((resolve, reject) => {
        const proc = spawn('npx', ['vite', '--port', String(port), '--host', '127.0.0.1'], {
            cwd: root,
            env: { ...process.env },
            stdio: 'pipe',
        });

        const timeout = setTimeout(() => {
            proc.kill('SIGTERM');
            reject(new Error('Dev server start timeout (20s)'));
        }, 20000);

        const onData = (data) => {
            const text = data.toString();
            if (text.includes(`http://127.0.0.1:${port}`) || text.includes('ready in')) {
                clearTimeout(timeout);
                proc.stdout.off('data', onData);
                proc.stderr.off('data', onData);
                resolve(proc);
            }
        };
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        proc.on('error', reject);
    });
}

async function stopDevServer(proc) {
    proc.kill('SIGTERM');
    await new Promise((resolve) => {
        const t = setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 3000);
        proc.on('exit', () => { clearTimeout(t); resolve(); });
    });
}

async function screenshot(page, name) {
    const path = resolve(outDir, `${name}.png`);
    await page.screenshot({ path, fullPage: false });
    console.log(`  📸 ${name}.png`);
    return path;
}

/** 收集 console / page error，发现即抛异常使测试失败 */
async function checkConsoleErrors(page, label) {
    const errors = [];
    const onPageError = (err) => errors.push({ type: 'pageerror', message: err.message });
    const onConsole = (msg) => {
        if (msg.type() === 'error') errors.push({ type: 'console.error', message: msg.text() });
    };
    page.on('pageerror', onPageError);
    page.on('console', onConsole);
    await page.waitForTimeout(600);
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    if (errors.length > 0) {
        const summary = errors.map((e) => `${e.type}: ${e.message}`).join('\n     ');
        throw new Error(`[${label}] console errors (${errors.length}):\n     ${summary}`);
    }
    console.log(`  ✅ [${label}] 无 console error`);
}

/** 断言元素存在 */
async function assertExists(page, selector, label) {
    const el = await page.$(selector);
    if (!el) throw new Error(`[${label}] 关键元素缺失: ${selector}`);
    console.log(`  ✅ ${selector}`);
}

/** 关闭弹窗 overlay（welcome guide / changelog） */
async function dismissOverlays(page) {
    // welcome guide
    const welcome = await page.$('#welcome-guide-overlay');
    if (welcome) {
        const visible = await welcome.evaluate((el) => !el.classList.contains('hidden'));
        if (visible) {
            await page.click('#btn-guide-expert');
            await page.waitForTimeout(delays.short);
        }
    }
    // changelog
    const changelog = await page.$('#changelog-overlay');
    if (changelog) {
        const visible = await changelog.evaluate((el) => !el.classList.contains('hidden'));
        if (visible) {
            await page.click('#btn-changelog-ok');
            await page.waitForTimeout(delays.short);
        }
    }
}

async function run() {
    const port = await getFreePort();
    console.log(`[UI-Test] 启动 dev server on port ${port}...`);
    const serverProc = await startDevServer(port);
    const baseUrl = `http://localhost:${port}`;
    console.log(`[UI-Test] Server ready: ${baseUrl}\n`);

    const browser = await chromium.launch({ headless: true });
    let passed = true;

    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();

        // ===== 1. 主菜单 =====
        console.log('--- 1. 主菜单 (1280×800) ---');
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        await page.waitForTimeout(delays.medium);
        await dismissOverlays(page);
        await screenshot(page, '01-menu-desktop');
        await checkConsoleErrors(page, '主菜单');

        const menuBtns = ['btn-ai-mode', 'btn-daily-challenge', 'btn-lan-mode', 'btn-custom-mode', 'btn-replay', 'btn-achievements', 'btn-tutorial', 'btn-settings', 'btn-play-style', 'btn-changelog'];
        for (const id of menuBtns) {
            await assertExists(page, `#${id}`, '主菜单按钮检查');
        }

        // ===== 2. 设置面板 =====
        console.log('\n--- 2. 设置面板 ---');
        await page.click('#btn-settings');
        await page.waitForTimeout(delays.medium);
        await screenshot(page, '02-settings-open');

        // 搜索过滤
        await page.fill('#settings-search-input', '音量');
        await page.waitForTimeout(500);
        await screenshot(page, '03-settings-search');
        console.log('  ✅ 搜索过滤测试完成');

        // 滑块 label 更新
        const bgmSlider = await page.$('#cfg-bgm-volume');
        if (bgmSlider) {
            await bgmSlider.evaluate((el) => { el.value = '0.3'; el.dispatchEvent(new Event('input')); });
            await page.waitForTimeout(200);
            const label = await page.$eval('#cfg-bgm-volume-value', (el) => el.textContent);
            if (label !== '30%') throw new Error(`BGM 滑块 label 异常: ${label}`);
            console.log(`  ✅ BGM 滑块 label: ${label}`);
        }

        // 关闭设置
        await page.click('#btn-close-settings');
        await page.waitForTimeout(delays.short);
        const overlayHidden = await page.$eval('#settings-overlay', (el) => el.classList.contains('hidden'));
        if (!overlayHidden) throw new Error('设置面板关闭失败：overlay 未隐藏');
        console.log('  ✅ 设置面板关闭后 hidden');

        // ===== 3. 人机对战 =====
        console.log('\n--- 3. 人机对战 / 游戏页 ---');
        await page.click('#btn-ai-mode');
        await page.waitForTimeout(delays.long);
        await screenshot(page, '04-game-ai-desktop');
        await checkConsoleErrors(page, '进入AI对战');

        const headerBtns = ['btn-back-menu', 'btn-pause', 'btn-sound-toggle', 'btn-fullscreen'];
        for (const id of headerBtns) {
            await assertExists(page, `#${id}`, '游戏页头部按钮');
        }

        // ===== 4. 暂停 overlay =====
        console.log('\n--- 4. 暂停 overlay ---');
        await page.click('#btn-pause');
        await page.waitForTimeout(delays.short);
        await screenshot(page, '05-pause-overlay');
        const pauseVisible = await page.$eval('#pause-overlay', (el) => !el.classList.contains('hidden'));
        if (!pauseVisible) throw new Error('暂停 overlay 未显示');
        console.log('  ✅ 点击暂停按钮 → overlay 显示');

        // 继续按钮
        await page.click('#btn-resume');
        await page.waitForTimeout(delays.short);
        const pauseRemoved1 = await page.$('#pause-overlay') === null;
        if (!pauseRemoved1) throw new Error('点击继续后 pause-overlay 未被移除');
        console.log('  ✅ 点击继续 → overlay 已移除');

        // ESC 暂停/恢复
        await page.keyboard.press('Escape');
        await page.waitForTimeout(delays.short);
        const pauseVisible2 = await page.$('#pause-overlay') !== null;
        if (!pauseVisible2) throw new Error('ESC 后 pause-overlay 未显示');
        console.log('  ✅ ESC → overlay 显示');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(delays.short);
        const pauseRemoved2 = await page.$('#pause-overlay') === null;
        if (!pauseRemoved2) throw new Error('再次 ESC 后 pause-overlay 未被移除');
        console.log('  ✅ 再次 ESC → overlay 已移除');

        // 暂停 → 设置 → 关闭设置 → 再暂停 → 退出
        await page.click('#btn-pause');
        await page.waitForTimeout(delays.short);
        await page.click('#btn-pause-settings');
        await page.waitForTimeout(delays.short);
        const settingsVisible = await page.$eval('#settings-overlay', (el) => !el.classList.contains('hidden'));
        if (!settingsVisible) throw new Error('暂停内设置按钮未打开设置面板');
        console.log('  ✅ 暂停内设置 → 设置面板打开');
        await page.click('#btn-close-settings');
        await page.waitForTimeout(delays.short);

        await page.click('#btn-pause');
        await page.waitForTimeout(delays.short);
        await page.click('#btn-pause-exit');
        await page.waitForTimeout(delays.medium);
        const backToMenu = await page.$eval('#menu-screen', (el) => !el.classList.contains('hidden'));
        if (!backToMenu) throw new Error('退出 AI 对战后未返回菜单');
        console.log('  ✅ 退出后返回菜单');
        await checkConsoleErrors(page, '退出AI对战回菜单');

        // ===== 5. 自定义模式 =====
        console.log('\n--- 5. 自定义模式 ---');
        await page.click('#btn-custom-mode');
        await page.waitForTimeout(delays.medium);
        await screenshot(page, '06-custom-mode');
        await checkConsoleErrors(page, '进入自定义模式');
        await page.click('#btn-back-custom');
        await page.waitForTimeout(delays.short);

        // ===== 6. LAN 模式 =====
        console.log('\n--- 6. LAN 模式 ---');
        await page.click('#btn-lan-mode');
        await page.waitForTimeout(delays.medium);
        await screenshot(page, '07-lan-mode');
        await checkConsoleErrors(page, '进入LAN模式');
        await page.click('#btn-back-lan');
        await page.waitForTimeout(delays.short);

        // ===== 7. 回放 / 成就 / 教程 / 牌风分析 =====
        console.log('\n--- 7. 其他菜单页面 ---');
        await page.click('#btn-replay');
        await page.waitForTimeout(delays.medium);
        await screenshot(page, '08-replay');
        const replayBack = await page.$('#btn-replay-back');
        if (replayBack) await replayBack.click();
        else await page.click('#btn-back-replay');
        await page.waitForTimeout(delays.short);

        await page.click('#btn-achievements');
        await page.waitForTimeout(delays.medium);
        await screenshot(page, '09-achievements');
        await page.click('#btn-close-achievements');
        await page.waitForTimeout(delays.short);

        await page.click('#btn-tutorial');
        await page.waitForTimeout(delays.medium);
        await screenshot(page, '10-tutorial');
        const tutClose = await page.$('.tutorial-close, #btn-tutorial-close');
        if (tutClose) await tutClose.click();
        else await page.keyboard.press('Escape');
        await page.waitForTimeout(delays.short);

        // 牌风分析面板
        await page.click('#btn-play-style');
        await page.waitForTimeout(delays.medium);
        await screenshot(page, '11-play-style');
        const playStyleOverlay = await page.$eval('#play-style-overlay', (el) => !el.classList.contains('hidden'));
        if (!playStyleOverlay) throw new Error('牌风分析面板未显示');
        console.log('  ✅ 牌风分析面板显示');
        await page.click('#btn-close-play-style');
        await page.waitForTimeout(delays.short);
        const playStyleHidden = await page.$eval('#play-style-overlay', (el) => el.classList.contains('hidden'));
        if (!playStyleHidden) throw new Error('牌风分析面板关闭失败');
        console.log('  ✅ 牌风分析面板关闭');

        // 公告面板
        await page.click('#btn-changelog');
        await page.waitForTimeout(delays.medium);
        await screenshot(page, '12-changelog');
        const changelogVisible = await page.$eval('#changelog-overlay', (el) => !el.classList.contains('hidden'));
        if (!changelogVisible) throw new Error('公告面板未显示');
        console.log('  ✅ 公告面板显示');
        await page.click('#btn-changelog-ok');
        await page.waitForTimeout(delays.short);
        const changelogHidden = await page.$eval('#changelog-overlay', (el) => el.classList.contains('hidden'));
        if (!changelogHidden) throw new Error('公告面板关闭失败');
        console.log('  ✅ 公告面板关闭');

        await page.close();

        // ===== 8. 移动端 viewport =====
        console.log('\n--- 8. 移动端 viewport ---');

        // 8a. 竖屏菜单 (375×667)
        const mobilePage = await context.newPage();
        await mobilePage.setViewportSize({ width: 375, height: 667 });
        await mobilePage.goto(baseUrl, { waitUntil: 'networkidle' });
        await mobilePage.waitForTimeout(delays.medium);
        await dismissOverlays(mobilePage);
        await screenshot(mobilePage, '13-menu-mobile-portrait');
        await checkConsoleErrors(mobilePage, '移动端菜单(竖屏)');

        // 8b. 横屏游戏 (812×375)
        await mobilePage.setViewportSize({ width: 812, height: 375 });
        await mobilePage.goto(baseUrl, { waitUntil: 'networkidle' });
        await mobilePage.waitForTimeout(delays.medium);
        await dismissOverlays(mobilePage);
        await mobilePage.click('#btn-ai-mode');
        await mobilePage.waitForTimeout(delays.long);
        await screenshot(mobilePage, '14-game-mobile-landscape');
        await checkConsoleErrors(mobilePage, '移动端AI对战(横屏)');

        // 检查手牌区是否可见
        const cards = await mobilePage.$$('.hand-front .card');
        if (cards.length < 17) throw new Error(`横屏手牌数量异常: ${cards.length} 张 (期望 >=17)`);
        console.log(`  ✅ 横屏手牌可见: ${cards.length} 张`);

        // 检查按钮文字是否溢出
        const playBtnOverflow = await mobilePage.evaluate(() => {
            const btn = document.querySelector('#play-controls button');
            if (!btn) return null;
            return btn.scrollWidth > btn.clientWidth + 1;
        });
        if (playBtnOverflow === true) throw new Error('出牌按钮文字溢出');
        if (playBtnOverflow === null) throw new Error('出牌按钮未找到');
        console.log(`  ✅ 出牌按钮文字未溢出`);

        // 检查 played-area 是否截断
        const playedAreaOverflow = await mobilePage.evaluate(() => {
            const area = document.querySelector('.played-area');
            if (!area) return null;
            return area.scrollWidth > document.documentElement.clientWidth;
        });
        if (playedAreaOverflow === true) throw new Error('出牌区水平溢出');
        if (playedAreaOverflow === null) throw new Error('出牌区未找到');
        console.log(`  ✅ 出牌区水平未溢出`);

        // 检查手牌区高度
        const handHeight = await mobilePage.evaluate(() => {
            const hand = document.querySelector('#player-right .hand-front');
            return hand ? hand.getBoundingClientRect().height : 0;
        });
        if (handHeight < 60) throw new Error(`手牌区高度异常: ${handHeight.toFixed(0)}px (期望 >=60)`);
        console.log(`  ✅ 手牌区高度: ${handHeight.toFixed(0)}px`);

        await mobilePage.close();

    } catch (err) {
        passed = false;
        console.error('\n❌ UI 测试失败:');
        console.error(err.message);
    } finally {
        await browser.close();
        await stopDevServer(serverProc);
    }

    console.log('\n====================');
    console.log(`UI 截图已保存到: ${outDir}`);
    console.log(`结果: ${passed ? '✅ 全部通过' : '❌ 存在失败'}`);
    console.log('====================');
    return passed;
}

run().then((ok) => process.exit(ok ? 0 : 1));

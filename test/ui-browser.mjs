/**
 * 浏览器 UI 回归截图测试
 * 自动启动 dev server → Playwright 检查 UI → 关闭 server
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
        // 只启动 vite（不需要 server:dev，因为测试不依赖 WebSocket）
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
        console.error(`  ⚠️  [${label}] console errors (${errors.length}):`);
        errors.forEach((e) => console.error(`     ${e.type}: ${e.message}`));
    } else {
        console.log(`  ✅ [${label}] 无 console error`);
    }
    return errors;
}

async function run() {
    const port = await getFreePort();
    console.log(`[UI-Test] 启动 dev server on port ${port}...`);
    const serverProc = await startDevServer(port);
    const baseUrl = `http://localhost:${port}`;
    console.log(`[UI-Test] Server ready: ${baseUrl}\n`);

    const browser = await chromium.launch({ headless: true });
    let totalErrors = [];

    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();

        // ===== 1. 主菜单 =====
        console.log('--- 1. 主菜单 ---');
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        await page.waitForTimeout(delays.medium);

        // 关闭 welcome guide（如果有）
        const welcomeGuide = await page.$('#welcome-guide-overlay');
        const isWelcomeVisible = welcomeGuide ? await welcomeGuide.evaluate((el) => !el.classList.contains('hidden')) : false;
        if (isWelcomeVisible) {
            await page.click('#btn-guide-expert');
            await page.waitForTimeout(delays.short);
        }

        await screenshot(page, '01-menu-desktop');
        totalErrors.push(...await checkConsoleErrors(page, '主菜单'));

        const menuBtns = ['btn-ai-mode', 'btn-lan-mode', 'btn-custom-mode', 'btn-replay', 'btn-achievements', 'btn-tutorial', 'btn-settings'];
        for (const id of menuBtns) {
            const el = await page.$(`#${id}`);
            console.log(`  ${el ? '✅' : '❌'} #${id}`);
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
            console.log(`  ${label === '30%' ? '✅' : '❌'} BGM 滑块 label: ${label}`);
        }

        // reset UX settings（可能在折叠面板内，直接检查存在性）
        const resetUxBtn = await page.$('#btn-reset-ux-settings');
        console.log(`  ${resetUxBtn ? '✅' : '⚠️'} Reset UX settings 按钮存在${resetUxBtn ? '' : '（可能在折叠面板内）'}`);

        // 关闭设置
        await page.click('#btn-close-settings');
        await page.waitForTimeout(delays.short);
        const overlayHidden = await page.$eval('#settings-overlay', (el) => el.classList.contains('hidden'));
        console.log(`  ${overlayHidden ? '✅' : '❌'} 设置面板关闭后 hidden`);

        // ===== 3. 人机对战 =====
        console.log('\n--- 3. 人机对战 / 游戏页 ---');
        await page.click('#btn-ai-mode');
        await page.waitForTimeout(delays.long);
        await screenshot(page, '04-game-ai-desktop');
        totalErrors.push(...await checkConsoleErrors(page, '进入AI对战'));

        const headerBtns = ['btn-back-menu', 'btn-pause', 'btn-sound-toggle', 'btn-fullscreen'];
        for (const id of headerBtns) {
            const el = await page.$(`#${id}`);
            console.log(`  ${el ? '✅' : '❌'} #${id}`);
        }

        // ===== 4. 暂停 overlay =====
        console.log('\n--- 4. 暂停 overlay ---');
        await page.click('#btn-pause');
        await page.waitForTimeout(delays.short);
        await screenshot(page, '05-pause-overlay');
        const pauseVisible = await page.$eval('#pause-overlay', (el) => !el.classList.contains('hidden'));
        console.log(`  ${pauseVisible ? '✅' : '❌'} 点击暂停按钮 → overlay 显示`);

        // 继续按钮（overlay 被动态移除，不是 hidden）
        await page.click('#btn-resume');
        await page.waitForTimeout(delays.short);
        const pauseRemoved1 = await page.$('#pause-overlay') === null;
        console.log(`  ${pauseRemoved1 ? '✅' : '❌'} 点击继续 → overlay 已移除`);

        // ESC 暂停/恢复
        await page.keyboard.press('Escape');
        await page.waitForTimeout(delays.short);
        const pauseVisible2 = await page.$('#pause-overlay') !== null;
        console.log(`  ${pauseVisible2 ? '✅' : '❌'} ESC → overlay 显示`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(delays.short);
        const pauseRemoved2 = await page.$('#pause-overlay') === null;
        console.log(`  ${pauseRemoved2 ? '✅' : '❌'} 再次 ESC → overlay 已移除`);

        // 暂停 → 设置 → 关闭设置 → 再暂停 → 退出
        await page.click('#btn-pause');
        await page.waitForTimeout(delays.short);
        await page.click('#btn-pause-settings');
        await page.waitForTimeout(delays.short);
        const settingsVisible = await page.$eval('#settings-overlay', (el) => !el.classList.contains('hidden'));
        console.log(`  ${settingsVisible ? '✅' : '❌'} 暂停内设置 → 设置面板打开（暂停 overlay 已自动移除）`);
        await page.click('#btn-close-settings');
        await page.waitForTimeout(delays.short);

        await page.click('#btn-pause');
        await page.waitForTimeout(delays.short);
        await page.click('#btn-pause-exit');
        await page.waitForTimeout(delays.medium);
        const backToMenu = await page.$eval('#menu-screen', (el) => !el.classList.contains('hidden'));
        console.log(`  ${backToMenu ? '✅' : '❌'} 退出后返回菜单`);
        totalErrors.push(...await checkConsoleErrors(page, '退出AI对战回菜单'));

        // ===== 5. 自定义模式 =====
        console.log('\n--- 5. 自定义模式 ---');
        await page.click('#btn-custom-mode');
        await page.waitForTimeout(delays.medium);
        await screenshot(page, '06-custom-mode');
        totalErrors.push(...await checkConsoleErrors(page, '进入自定义模式'));
        await page.click('#btn-back-custom');
        await page.waitForTimeout(delays.short);

        // ===== 6. LAN 模式 =====
        console.log('\n--- 6. LAN 模式 ---');
        await page.click('#btn-lan-mode');
        await page.waitForTimeout(delays.medium);
        await screenshot(page, '07-lan-mode');
        totalErrors.push(...await checkConsoleErrors(page, '进入LAN模式'));
        await page.click('#btn-back-lan');
        await page.waitForTimeout(delays.short);

        // ===== 7. 回放 / 成就 / 教程 =====
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
        // 教程可能有不同的关闭按钮
        const tutClose = await page.$('.tutorial-close, #btn-tutorial-close');
        if (tutClose) await tutClose.click();
        else await page.keyboard.press('Escape');
        await page.waitForTimeout(delays.short);

        // ===== 8. 移动端 viewport =====
        console.log('\n--- 8. 移动端 viewport ---');

        // 8a. 竖屏菜单
        const mobilePage = await context.newPage();
        await mobilePage.setViewportSize({ width: 375, height: 667 });
        await mobilePage.goto(baseUrl, { waitUntil: 'networkidle' });
        await mobilePage.waitForTimeout(delays.medium);
        const mobWelcome = await mobilePage.$('#welcome-guide-overlay');
        const mobWelcomeVisible = mobWelcome ? await mobWelcome.evaluate((el) => !el.classList.contains('hidden')) : false;
        if (mobWelcomeVisible) {
            await mobilePage.click('#btn-guide-expert');
            await mobilePage.waitForTimeout(delays.short);
        }
        await screenshot(mobilePage, '11-menu-mobile');

        // 8b. 横屏游戏（landscape）
        await mobilePage.setViewportSize({ width: 812, height: 375 });
        await mobilePage.goto(baseUrl, { waitUntil: 'networkidle' });
        await mobilePage.waitForTimeout(delays.medium);
        const mobWelcome2 = await mobilePage.$('#welcome-guide-overlay');
        const mobWelcomeVisible2 = mobWelcome2 ? await mobWelcome2.evaluate((el) => !el.classList.contains('hidden')) : false;
        if (mobWelcomeVisible2) {
            await mobilePage.click('#btn-guide-expert');
            await mobilePage.waitForTimeout(delays.short);
        }
        await mobilePage.click('#btn-ai-mode');
        await mobilePage.waitForTimeout(delays.long);
        await screenshot(mobilePage, '12-game-mobile-landscape');
        totalErrors.push(...await checkConsoleErrors(mobilePage, '移动端AI对战(横屏)'));

        // 检查手牌区是否可见
        const cards = await mobilePage.$$('.hand-front .card');
        console.log(`  ${cards.length >= 17 ? '✅' : '⚠️'} 横屏手牌可见: ${cards.length} 张`);

        // 检查按钮文字是否溢出
        const playBtnOverflow = await mobilePage.evaluate(() => {
            const btn = document.querySelector('#play-controls button');
            if (!btn) return null;
            return btn.scrollWidth > btn.clientWidth + 1;
        });
        console.log(`  ${playBtnOverflow === false ? '✅' : '⚠️'} 出牌按钮文字溢出: ${playBtnOverflow}`);

        // 检查 played-area 是否截断
        const playedAreaOverflow = await mobilePage.evaluate(() => {
            const area = document.querySelector('#played-area');
            if (!area) return null;
            return area.scrollWidth > document.documentElement.clientWidth;
        });
        console.log(`  ${playedAreaOverflow === false ? '✅' : '⚠️'} 出牌区水平溢出: ${playedAreaOverflow}`);

        // 检查手牌区高度
        const handHeight = await mobilePage.evaluate(() => {
            const hand = document.querySelector('#player-right .hand-front');
            return hand ? hand.getBoundingClientRect().height : 0;
        });
        console.log(`  ${handHeight >= 60 ? '✅' : '⚠️'} 手牌区高度: ${handHeight.toFixed(0)}px`);

        await mobilePage.close();
        await page.close();

    } finally {
        await browser.close();
        await stopDevServer(serverProc);
    }

    console.log('\n====================');
    console.log(`UI 截图已保存到: ${outDir}`);
    console.log(`Console error 总数: ${totalErrors.length}`);
    if (totalErrors.length > 0) {
        totalErrors.forEach((e) => console.log(`  - ${e.type}: ${e.message}`));
    }
    console.log('====================');
    return totalErrors.length === 0;
}

run().then((ok) => process.exit(ok ? 0 : 1));

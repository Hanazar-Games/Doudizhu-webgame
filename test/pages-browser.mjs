import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { testModeFlows } from './mode-flows-browser.mjs';
import { testInterfaceEdges, testEndgameLayout } from './interface-edges.mjs';

const root = resolve(import.meta.dirname, '../dist');
const base = process.argv[2] || '/Doudizhu-webgame/';
const smoke = process.argv.includes('--smoke');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
    try {
        const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        if (base !== '/' && path === base.slice(0, -1)) {
            res.writeHead(301, { Location: base });
            return res.end();
        }
        const file = resolve(root, path.startsWith(base) ? path.slice(base.length) || 'index.html' : '../missing');
        if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw new Error('Missing file');
        res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
        res.end(await readFile(file));
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end(await readFile(resolve(root, '404.html')));
    }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = origin + base;
const browser = await chromium.launch({ headless: true });
const errors = [];
const collector = { attach(page) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error' && !message.location().url?.includes('/missing-route')) errors.push(message.text());
    });
    page.on('response', response => {
        if (response.status() >= 400 && !response.url().includes('/missing-route')) errors.push(`${response.status()} ${response.url()}`);
    });
    page.on('requestfailed', request => errors.push(`${request.failure()?.errorText} ${request.url()}`));
    page.on('websocket', socket => errors.push(`Unexpected WebSocket: ${socket.url()}`));
} };
try {
    const page = await browser.newPage();
    collector.attach(page);
    await page.goto(url);
    await page.waitForFunction(() => !!window.gameApp);
    await page.evaluate(() => { window.gameApp.closeChangelog(); document.getElementById('welcome-guide-overlay')?.remove(); });
    await page.click('#btn-lan-mode');
    assert(await page.locator('#btn-lan-join').isDisabled(), 'Pages builds must disable LAN on custom domains too');
    await page.goto(url + 'missing-route/deep?source=refresh#game');
    await page.waitForURL(url + '?source=refresh#game');
    await page.waitForFunction(() => !!window.gameApp);
    await page.reload();
    await page.waitForFunction(() => !!window.gameApp);
    const manifest = await page.evaluate(async () => {
        const link = document.querySelector('link[rel="manifest"]');
        return { url: link.href, data: await (await fetch(link.href)).json() };
    });
    assert.equal(new URL(manifest.data.start_url, manifest.url).href, url);
    for (const icon of manifest.data.icons) {
        const response = await page.request.get(new URL(icon.src, manifest.url).href);
        assert.equal(response.status(), 200);
    }
    if (!smoke) {
        await page.evaluate(() => { window.gameApp.closeChangelog(); document.getElementById('welcome-guide-overlay')?.remove(); });
        await testInterfaceEdges(page);
        await testEndgameLayout(page);
        await testModeFlows(browser, url, collector);
    }
    await page.close();
    assert.deepEqual(errors, []);
    console.log(`✓ Production Pages browser flows, refresh, manifest and network checks passed at ${base}`);
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}

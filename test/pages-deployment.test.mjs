import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const workflow = readFileSync(resolve(root, '.github/workflows/pages.yml'), 'utf8');
const basePath = process.argv[2] || '/Doudizhu-webgame/';
const failures = [];

const check = (condition, message) => {
    if (!condition) failures.push(message);
};

const configureAt = workflow.indexOf('uses: actions/configure-pages@');
const buildAt = workflow.indexOf('- name: Build');
const buildEnd = workflow.indexOf('\n      - name:', buildAt + 1);
const buildStep = workflow.slice(buildAt, buildEnd < 0 ? undefined : buildEnd);

check(configureAt >= 0 && configureAt < buildAt,
    'configure-pages 必须在 Vite 构建前提供 GitHub Pages base_path');
check(buildStep.includes('steps.pages.outputs.base_path'),
    'Vite 构建必须使用 configure-pages 输出的 base_path');
check(buildStep.includes("GITHUB_PAGES: 'true'"), 'Pages 构建必须启用静态部署标记');
check(workflow.includes('npm run test:pages:browser'), '部署前必须验证真实生产包');
check(workflow.includes('uses: actions/upload-pages-artifact@') && workflow.includes('path: dist'),
    'Pages 必须只上传 dist 构建产物');

for (const file of ['index.html', '404.html', 'manifest.json', 'icon-192.png', 'icon-512.png', '.nojekyll']) {
    check(existsSync(resolve(dist, file)), `构建产物缺少 ${file}`);
}

const indexPath = resolve(dist, 'index.html');
if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, 'utf8');
    const urls = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)]
        .map(([, url]) => url)
        .filter(url => !/^(?:https?:|data:|#)/.test(url));

    for (const url of urls) {
        const resolvedUrl = new URL(url, `https://example.test${basePath}`);
        check(resolvedUrl.pathname.startsWith(basePath), `资源路径逃离 Pages 子路径: ${url}`);
        const relativePath = decodeURIComponent(resolvedUrl.pathname.slice(basePath.length));
        check(existsSync(resolve(dist, relativePath)), `资源路径指向不存在的文件: ${url}`);
    }

    check(!urls.some(url => url.includes('/src/')), '生产 HTML 不应引用源码目录');
}

const manifestPath = resolve(dist, 'manifest.json');
const fallbackPath = resolve(dist, '404.html');
if (existsSync(fallbackPath)) {
    const fallback = readFileSync(fallbackPath, 'utf8');
    check(!fallback.includes('%BASE_URL%'), '404 页面不应保留未替换的 base 占位符');
    check(fallback.includes(`var basePath = '${basePath}'`), '404 页面必须返回实际部署路径');
    check(fallback.includes(`href="${basePath}"`), '404 页面手动返回链接必须匹配部署路径');
}
if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const icon of manifest.icons || []) {
        check(existsSync(resolve(dist, icon.src)), `manifest 图标不存在: ${icon.src}`);
    }
}

if (failures.length > 0) {
    console.error(failures.map(message => `✗ ${message}`).join('\n'));
    process.exit(1);
}

console.log(`✓ GitHub Pages 构建产物在 ${basePath} 下无缺失资源`);

import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'));

function pagesFallback() {
    let basePath = '/';
    return {
        name: 'pages-fallback',
        configResolved(config) { basePath = config.base.startsWith('/') ? config.base : '/'; },
        writeBundle(options) {
            const template = readFileSync(resolve(__dirname, 'public/404.html'), 'utf8');
            writeFileSync(resolve(options.dir, '404.html'), template.replaceAll('%BASE_URL%', basePath));
        },
    };
}

export default defineConfig({
  base: './',
  root: '.',
  publicDir: 'public',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __PAGES_BUILD__: JSON.stringify(process.env.GITHUB_PAGES === 'true'),
  },
  plugins: [pagesFallback()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.WS_PROXY_TARGET || 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});

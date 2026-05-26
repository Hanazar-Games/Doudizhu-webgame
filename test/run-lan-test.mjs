/**
 * LAN 测试 runner
 * 自动寻找空闲端口 → 启动临时 server → 运行 lan-flow.test.mjs → 关闭 server
 */

import { spawn } from 'child_process';
import net from 'net';

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

async function main() {
    const port = await getFreePort();
    console.log(`[LAN-Test-Runner] 使用临时端口: ${port}`);

    // 启动 server（dev 模式，不服务静态文件，启动更快）
    const serverProc = spawn('node', ['server/index.js', '--dev'], {
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
        stdio: 'pipe',
    });

    // 等待 server ready（监听 stdout 中的启动标志）
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            serverProc.kill('SIGTERM');
            reject(new Error('Server start timeout (10s)'));
        }, 10000);

        const onData = (data) => {
            const text = data.toString();
            if (text.includes('running on port')) {
                clearTimeout(timeout);
                serverProc.stdout.off('data', onData);
                resolve();
            }
        };
        serverProc.stdout.on('data', onData);
        serverProc.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        serverProc.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                clearTimeout(timeout);
                reject(new Error(`Server exited with code ${code}`));
            }
        });
    });

    console.log(`[LAN-Test-Runner] Server ready, running tests...\n`);

    // 运行测试，传入端口
    const testProc = spawn('node', ['test/lan-flow.test.mjs'], {
        env: { ...process.env, TEST_PORT: String(port) },
        stdio: 'inherit',
    });

    const exitCode = await new Promise((resolve) => {
        testProc.on('exit', resolve);
    });

    // 优雅关闭 server
    serverProc.kill('SIGTERM');
    await new Promise((resolve) => {
        const t = setTimeout(() => {
            serverProc.kill('SIGKILL');
            resolve();
        }, 3000);
        serverProc.on('exit', () => {
            clearTimeout(t);
            resolve();
        });
    });

    process.exit(exitCode ?? 0);
}

main().catch((err) => {
    console.error('[LAN-Test-Runner] Error:', err.message);
    process.exit(1);
});

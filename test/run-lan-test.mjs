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

async function waitForHealth(port, retries = 30, interval = 300) {
    const url = `http://127.0.0.1:${port}/api/health`;
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
            if (res.ok) return await res.json();
        } catch {}
        await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`Health check failed after ${retries * interval}ms`);
}

async function main() {
    const port = await getFreePort();
    console.log(`[LAN-Test-Runner] 使用临时端口: ${port}`);

    // 启动 server（dev 模式，不服务静态文件，启动更快）
    const serverProc = spawn('node', ['server/index.js', '--dev'], {
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
        stdio: 'pipe',
    });

    const serverLogs = [];
    const onData = (data) => serverLogs.push(data.toString());
    serverProc.stdout.on('data', onData);
    serverProc.stderr.on('data', onData);

    let testExitCode = 1;
    let serverReady = false;

    try {
        // 等待 server ready（优先监听 stdout 启动标志，备选 health API 轮询）
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                serverProc.stdout.off('data', onStdout);
                reject(new Error('Server start timeout (10s)'));
            }, 10000);

            const onStdout = (data) => {
                const text = data.toString();
                if (text.includes('running on port')) {
                    clearTimeout(timeout);
                    serverProc.stdout.off('data', onStdout);
                    resolve();
                }
            };
            serverProc.stdout.on('data', onStdout);
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

        // 二次确认 server 真正可访问（health check）
        const health = await waitForHealth(port);
        serverReady = true;
        console.log(`[LAN-Test-Runner] Server ready (health=${health.status}), running tests...\n`);

        // 运行测试，传入端口
        const testProc = spawn('node', ['test/lan-flow.test.mjs'], {
            env: { ...process.env, TEST_PORT: String(port) },
            stdio: 'inherit',
        });

        testExitCode = await new Promise((resolve) => {
            testProc.on('exit', resolve);
        });
    } catch (err) {
        console.error('[LAN-Test-Runner] Error:', err.message);
        testExitCode = 1;
    } finally {
        // 优雅关闭 server
        serverProc.stdout.off('data', onData);
        serverProc.stderr.off('data', onData);
        serverProc.kill('SIGTERM');
        await new Promise((resolve) => {
            const t = setTimeout(() => {
                try { serverProc.kill('SIGKILL'); } catch {}
                resolve();
            }, 5000);
            serverProc.on('exit', () => {
                clearTimeout(t);
                resolve();
            });
        });

        // 失败时输出 server 日志，帮助诊断
        if (testExitCode !== 0 && serverLogs.length > 0) {
            console.error('\n--- Server 日志 ---');
            serverLogs.forEach((l) => console.error(l.trimEnd()));
        }
    }

    process.exit(testExitCode ?? 0);
}

main().catch((err) => {
    console.error('[LAN-Test-Runner] Fatal error:', err.message);
    process.exit(1);
});

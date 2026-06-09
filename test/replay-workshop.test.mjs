/**
 * ReplayWorkshop 测试
 */

import { ReplayWorkshop, encodeShareCode, decodeShareCode } from '../src/utils/replay-workshop.js';

// Mock localStorage
const mockStorage = {};
global.localStorage = {
    getItem(key) { return mockStorage[key] || null; },
    setItem(key, val) { mockStorage[key] = val; },
    removeItem(key) { delete mockStorage[key]; },
};

function resetStorage() {
    ReplayWorkshop.clearAll();
}

function test_encodeDecode() {
    const data = { history: [{ playerIndex: 0, cards: [] }], mode: 'ai', players: [{ name: 'P1' }, { name: 'P2' }, { name: 'P3' }] };
    const code = encodeShareCode(data);
    if (!code || typeof code !== 'string') throw new Error('编码失败');
    const decoded = decodeShareCode(code);
    if (!decoded) throw new Error('解码失败');
    if (decoded.mode !== 'ai') throw new Error('数据不匹配');
    console.log('✓ 分享码编码解码');
}

function test_saveAndGet() {
    resetStorage();
    const data = { history: [{ playerIndex: 0, cards: [] }], mode: 'ai', players: [{ name: 'P1' }, { name: 'P2' }, { name: 'P3' }], result: { isLandlordWin: true } };
    const record = ReplayWorkshop.saveGame(data, '测试牌谱', '备注');
    if (!record) throw new Error('保存失败');
    if (record.name !== '测试牌谱') throw new Error('名称不匹配');
    if (record.note !== '备注') throw new Error('备注不匹配');
    if (!record.id) throw new Error('缺少ID');
    if (!record.shareCode) throw new Error('缺少分享码');

    const records = ReplayWorkshop.getRecords();
    if (records.length !== 1) throw new Error(`应为1条记录, 得到${records.length}`);
    console.log('✓ 保存和读取');
}

function test_deleteRecord() {
    resetStorage();
    const data = { history: [], mode: 'ai', players: [] };
    const record = ReplayWorkshop.saveGame(data);
    ReplayWorkshop.deleteRecord(record.id);
    const records = ReplayWorkshop.getRecords();
    if (records.length !== 0) throw new Error('删除后应为0条');
    console.log('✓ 删除记录');
}

function test_importShareCode() {
    resetStorage();
    const data = { history: [{ playerIndex: 0, cards: [] }], mode: 'challenge', players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] };
    const code = encodeShareCode(data);
    const result = ReplayWorkshop.importShareCode(code);
    if (!result.success) throw new Error('导入失败');
    const records = ReplayWorkshop.getRecords();
    if (records.length !== 1) throw new Error('导入后应为1条');
    console.log('✓ 分享码导入');
}

function test_importInvalidCode() {
    const result = ReplayWorkshop.importShareCode('invalid!!!');
    if (result.success) throw new Error('无效码不应导入成功');
    console.log('✓ 无效分享码拒绝');
}

function test_maxRecords() {
    resetStorage();
    for (let i = 0; i < 55; i++) {
        ReplayWorkshop.saveGame({ history: [{ playerIndex: 0, cards: [] }], mode: 'ai', players: [] });
    }
    const records = ReplayWorkshop.getRecords();
    if (records.length !== 50) throw new Error(`最多50条, 得到${records.length}`);
    console.log('✓ 最大记录数限制');
}

function test_getStats() {
    resetStorage();
    ReplayWorkshop.saveGame({ history: [], mode: 'ai', players: [] });
    ReplayWorkshop.saveGame({ history: [], mode: 'challenge', players: [] });
    const stats = ReplayWorkshop.getStats();
    if (stats.total !== 2) throw new Error('统计总数错误');
    if (stats.byMode.ai !== 1) throw new Error('ai 计数错误');
    if (stats.byMode.challenge !== 1) throw new Error('challenge 计数错误');
    console.log('✓ 统计功能');
}

// 运行测试
const tests = [
    test_encodeDecode,
    test_saveAndGet,
    test_deleteRecord,
    test_importShareCode,
    test_importInvalidCode,
    test_maxRecords,
    test_getStats,
];

let passed = 0;
let failed = 0;

for (const test of tests) {
    try {
        test();
        passed++;
    } catch (err) {
        failed++;
        console.error(`✗ ${test.name}:`, err.message);
    }
}

console.log(`\n====================`);
console.log(`Total: ${tests.length}, Passed: ${passed}, Failed: ${failed}`);
console.log(`====================`);

if (failed > 0) process.exit(1);

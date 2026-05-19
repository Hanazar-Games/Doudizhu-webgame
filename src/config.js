/**
 * Config - 全局配置
 * 支持开发/生产环境自动切换
 */

const IS_DEV = import.meta.env?.DEV ?? false;

export const CONFIG = {
    // 环境
    env: IS_DEV ? 'development' : 'production',
    
    // WebSocket 配置
    ws: {
        // 始终使用当前域名，Vite proxy / 生产 Nginx 会处理转发
        url: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
        reconnectInterval: 3000,
        maxReconnectAttempts: 5,
    },
    
    // HTTP API
    api: {
        baseUrl: IS_DEV ? '' : '', // 相对路径
        healthCheck: '/api/health',
        roomList: '/api/rooms',
    },
    
    // 游戏配置
    game: {
        defaultDifficulty: 'normal',
        aiDelay: {
            call: 800,
            play: 1000,
        },
        maxRounds: 10,
    },
    
    // UI 配置
    ui: {
        toastDuration: 2000,
        animationEnabled: true,
        soundEnabled: true,
        cardTrackerEnabled: true,
        historyEnabled: true,
    },
};

// 便捷导出
export default CONFIG;

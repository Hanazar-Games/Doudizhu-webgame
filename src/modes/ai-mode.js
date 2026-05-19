/**
 * AIMode - 人机对战模式
 * 1个真人玩家 + 2个AI玩家
 */

import { Player } from '../players/player.js';
import { AIPlayer } from '../players/ai-player.js';
import { BaseMode } from './base-mode.js';

class AIMode extends BaseMode {
    constructor(difficulty = 'normal') {
        super('ai');
        this.difficulty = difficulty;
    }

    async init() {
        // 设置3个玩家：0号真人，1/2号AI
        this.humanIndex = 0;
        this.gameState.setPlayer(0, new Player('玩家', false));
        this.gameState.setPlayer(1, new AIPlayer('AI-东', this.difficulty));
        this.gameState.setPlayer(2, new AIPlayer('AI-西', this.difficulty));
        
        console.log('[AIMode] 初始化完成，难度:', this.difficulty);
    }

    // 可以动态调整AI难度
    setDifficulty(level) {
        this.difficulty = level;
        for (const p of this.gameState.players) {
            if (p && p.isAI) {
                p.difficulty = level;
            }
        }
    }
}




export { AIMode };

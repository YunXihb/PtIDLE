// ========================================
// 角色状态栏服务 (Character Status Service) - T039
// ========================================
// 单一入口聚合 API：
//   - 基础属性（character_pieces 表）
//   - 状态效果（statusEffectService 合并）
//   - 派生：totalShield, isTaunted, taunting 列表
//
// 调用方：T047 WS 路由在 round 推进、出牌后推送 CharacterStatus

import { query } from '../config/database';
import {
  getActiveEffects,
  StatusEffect,
} from './statusEffectService';
import {
  getAllBoardPositions,
  keyToPosition,
} from './battleService';
import { redisClient } from '../config/redis';

export type CharacterProfession = 'warrior' | 'ranger' | 'mage';

export interface CharacterStatus {
  // 基础属性（从 character_pieces / characters 表）
  characterId: string;
  name: string;
  profession: CharacterProfession;
  health: number;
  maxHealth: number;
  energy: number;
  maxEnergy: number;
  movement: number;
  position: { x: number; y: number } | null;
  isAlive: boolean;
  // 状态效果
  effects: StatusEffect[];
  // 派生数据
  totalShield: number;
  isTaunted: boolean;
  taunting: string[];  // 该 character 主动嘲讽的敌方 ID 列表
}

/**
 * 获取角色状态（聚合）
 */
export async function getCharacterStatus(
  battleId: string,
  characterId: string,
  currentRound: number
): Promise<CharacterStatus | null> {
  // 1. 优先从 Redis pieces 读
  const piecesKey = `battle:${battleId}:pieces`;
  let pieceRaw: string | null = null;
  try {
    const raw = await redisClient.hGet(piecesKey, characterId);
    pieceRaw = raw ?? null;
  } catch {
    pieceRaw = null;
  }

  let baseInfo: {
    name: string;
    profession: CharacterProfession;
    health: number;
    max_health: number;
    energy: number;
    max_energy: number;
    movement: number;
    is_alive: boolean;
    player_id: string;
  } | null = null;

  if (pieceRaw) {
    try {
      const parsed = JSON.parse(pieceRaw);
      baseInfo = {
        name: parsed.name,
        profession: parsed.profession as CharacterProfession,
        health: parsed.health,
        max_health: parsed.max_health,
        energy: parsed.energy,
        max_energy: parsed.max_energy,
        movement: parsed.movement,
        is_alive: parsed.is_alive,
        player_id: parsed.player_id,
      };
    } catch {
      baseInfo = null;
    }
  }

  if (!baseInfo) {
    // 从 DB 兜底
    const result = await query<{
      name: string;
      profession: string;
      health: number;
      max_health: number;
      energy: number;
      max_energy: number;
      movement: number;
      is_alive: boolean;
      player_id: string;
    }>(
      `SELECT name, profession, health, max_health, energy, max_energy, movement, is_alive, player_id
       FROM characters WHERE id = $1`,
      [characterId]
    );
    if (!result || result.length === 0) {
      return null;
    }
    const row = result[0];
    if (row.profession !== 'warrior' && row.profession !== 'ranger' && row.profession !== 'mage') {
      return null;
    }
    baseInfo = {
      name: row.name,
      profession: row.profession as CharacterProfession,
      health: row.health,
      max_health: row.max_health,
      energy: row.energy,
      max_energy: row.max_energy,
      movement: row.movement,
      is_alive: row.is_alive,
      player_id: row.player_id,
    };
  }

  // 2. 位置
  let position: { x: number; y: number } | null = null;
  const positions = await getAllBoardPositions(battleId);
  for (const [posKey, charId] of positions.entries()) {
    if (charId === characterId) {
      position = keyToPosition(posKey);
      break;
    }
  }

  // 3. 状态效果（自身）
  const effects = await getActiveEffects(battleId, characterId, currentRound);

  // 4. 派生：totalShield
  const totalShield = effects
    .filter(e => e.type === 'shield')
    .reduce((sum, e) => sum + (e.value ?? 0), 0);

  // 5. 派生：isTaunted
  const isTaunted = effects.some(e => e.type === 'taunt');

  // 6. 派生：taunting 列表
  //    该 character 主动嘲讽的敌方 = 全场所有 active taunt effect 中 source_id = characterId 的 target 列表
  const taunting: string[] = [];
  const allPositions = await getAllBoardPositions(battleId);
  for (const charIdOnBoard of new Set(allPositions.values())) {
    if (charIdOnBoard === characterId) continue;
    const otherEffects = await getActiveEffects(battleId, charIdOnBoard, currentRound);
    for (const e of otherEffects) {
      if (e.type === 'taunt' && e.source_id === characterId && !taunting.includes(charIdOnBoard)) {
        taunting.push(charIdOnBoard);
      }
    }
  }

  return {
    characterId,
    name: baseInfo.name,
    profession: baseInfo.profession,
    health: baseInfo.health,
    maxHealth: baseInfo.max_health,
    energy: baseInfo.energy,
    maxEnergy: baseInfo.max_energy,
    movement: baseInfo.movement,
    position,
    isAlive: baseInfo.is_alive,
    effects,
    totalShield,
    isTaunted,
    taunting,
  };
}

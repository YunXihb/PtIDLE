/**
 * Redis key 常量集中定义（T-FIX: 消除跨 service 手写重复的 key 模板）
 *
 * 用法：
 *   redisKey.pieces(battleId)      // battle:{id}:pieces
 *   redisKey.positions(battleId)   // battle:{id}:positions
 *   redisKey.hand(battleId, cid)   // battle:{id}:hand:{cid}
 */
export const redisKey = {
  pieces: (battleId: string) => `battle:${battleId}:pieces`,
  positions: (battleId: string) => `battle:${battleId}:positions`,
  session: (battleId: string) => `battle:${battleId}:session`,
  stars: (battleId: string, side: 'p1' | 'p2') => `battle:${battleId}:stars:${side}`,
  bases: (battleId: string) => `battle:${battleId}:bases`,
  alive: (battleId: string, side: 'p1' | 'p2') => `battle:${battleId}:alive_${side}`,
  effects: (battleId: string, characterId: string) => `battle:${battleId}:effects:${characterId}`,
  hand: (battleId: string, characterId: string) => `battle:${battleId}:hand:${characterId}`,
  retained: (battleId: string, characterId: string) => `battle:${battleId}:retained:${characterId}`,
  discard: (battleId: string, characterId: string) => `battle:${battleId}:discard:${characterId}`,
  warriorStatus: (battleId: string, characterId: string) => `battle:${battleId}:warrior_status:${characterId}`,
  rangerStatus: (battleId: string, characterId: string) => `battle:${battleId}:ranger_status:${characterId}`,
  initLock: (battleId: string) => `battle:${battleId}:init_lock`,
  drawRequest: (battleId: string) => `battle:${battleId}:draw_request`,
  // T1010 系列：布置阶段
  deployment: (battleId: string) => `battle:${battleId}:deployment`,
  deployWriteLock: (battleId: string) => `battle:${battleId}:deploy_write_lock`,
  /** T1012: 对局卡组快照（布置配卡结果；不存在则回落 character_deck） */
  deck: (battleId: string, characterId: string) => `battle:${battleId}:deck:${characterId}`,
} as const;

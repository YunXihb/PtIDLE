// ========================================
// T047 实时状态广播 (Battle State Broadcaster)
// ========================================
// 提供对战进行中的"棋盘状态 / 手牌 / 角色状态"实时推送函数库。
//
// 事件粒度设计:
//   - `battle:state:full`     —— join 后首屏一次性推全量(含自己手牌),走 user-room
//   - `battle:state:board`    —— 整盘变化(round/step/actor/全角色状态),走 battle room
//   - `battle:state:hand`     —— 单角色手牌变化(出牌后),走 user-room
//   - `battle:state:character`—— 单角色状态变化(移动/受伤),走 battle room
//
// 隐私边界:
//   - 手牌仅本人可见 → hand / full 推 user:{userId}
//   - 棋盘 / 状态效果 / 能量 → 双方都看到 → 推 battle:{battleId}
//
// 调用方:T049 移动后 broadcastCharacterStatus / T050 出牌后 broadcastHandState+broadcastCharacterStatus
//         / T051 回合切换 broadcastBoardState / handleBattleJoin 内 broadcastFullState(本任务)
//
// 范围外(Out of Scope):
//   - 跨节点 socket.io adapter(Redis adapter)—— 单体 MVP
//   - 增量差分(只推变化字段)—— 本任务直接推全量
//   - 重连自动拉全量—— 由前端 reconnect 后重发 `battle:join` 触发

import type { Server as IOServer } from 'socket.io';
import { userRoom, battleRoom } from './battleRoom';
import { listCharactersInBattle } from '../services/battleService';
import { getCharacterStatus, CharacterStatus } from '../services/characterStatusService';
import { getActorHand, HandCard } from '../services/handService';
import { getDbSessionState } from '../services/battleSessionService';
import { redisClient } from '../config/redis';

// ========================================
// 事件类型定义
// ========================================

/**
 * `battle:state:board` payload —— 整盘状态,无隐私,推 battle room
 * T052: 增量字段 p1Stars/p2Stars/bases
 */
export interface BoardStateEvent {
  battleId: string;
  currentRound: number;
  currentStep: number;
  currentPhase: string;
  currentActorId: string | null;
  characters: CharacterStatus[];
  // ★ T052 新增
  p1Stars: number;
  p2Stars: number;
  bases: {
    '3,3': 'p1' | 'p2' | 'neutral';
    '6,6': 'p1' | 'p2' | 'neutral';
  };
}

/**
 * `battle:state:hand` payload —— 单角色手牌,推 user-room(self-only)
 */
export interface HandStateEvent {
  battleId: string;
  characterId: string;
  hand: HandCard[];
}

/**
 * `battle:state:character` payload —— 单角色完整状态,推 battle room
 */
export interface CharacterStatusEvent {
  battleId: string;
  character: CharacterStatus;
}

/**
 * `battle:state:full` payload —— join 后首屏全量
 * - `board` 双方共有(room-wide 推),但 full payload 走 user-room 是因为包含 ownHand
 * - `ownHand` 是 characterId → 手牌 的映射;3v3 时每玩家 3 个 key
 */
export interface FullStateEvent {
  battleId: string;
  board: BoardStateEvent;
  ownHand: Record<string, HandCard[]>;
}

// ========================================
// 内部 helper
// ========================================

/**
 * 内部:聚合 battle 整盘状态(纯函数,不发 WS)。
 *
 * 流程:
 *   1. 并行 `getDbSessionState` + `listCharactersInBattle`(独立查询,无依赖)
 *      - battle 不存在(session 为 null)→ throws(让上层决定是否吞掉)
 *   2. `Promise.all` 并行调 `getCharacterStatus` 拿每个 character 完整状态
 *   3. 过滤掉 `null`(角色中途被删)
 *
 * 返回 `{ board, characters }`:board 是给客户端的 BoardStateEvent;
 * `characters` 是带 userId 的原始列表(供 `broadcastFullState` 筛 ownHand 用,
 * 避免再调一次 listCharactersInBattle)。
 *
 * @param battleId battle id
 * @returns `{ board: BoardStateEvent, characters: Array<{characterId, userId, ...}> }`
 * @throws battle 不存在时
 */
export async function buildBoardState(
  battleId: string
): Promise<{
  board: BoardStateEvent;
  characters: Array<{
    characterId: string;
    playerId: string;
    userId: string;
    profession: string;
    name: string;
  }>;
}> {
  const [session, characters, p1StarsRaw, p2StarsRaw, basesRaw] = await Promise.all([
    getDbSessionState(battleId),
    listCharactersInBattle(battleId),
    redisClient.get(`battle:${battleId}:stars:p1`),
    redisClient.get(`battle:${battleId}:stars:p2`),
    redisClient.get(`battle:${battleId}:bases`),
  ]);
  if (!session) {
    throw new Error(`buildBoardState: battle not found: ${battleId}`);
  }

  const statusResults = await Promise.all(
    characters.map((c) => getCharacterStatus(battleId, c.characterId, session.currentRound))
  );

  // 过滤 null(角色可能中途被删)
  const statusList = statusResults.filter((s): s is CharacterStatus => s !== null);

  // 解析 stars + bases
  const p1Stars = p1StarsRaw === null ? 0 : parseInt(p1StarsRaw, 10);
  const p2Stars = p2StarsRaw === null ? 0 : parseInt(p2StarsRaw, 10);
  const bases = basesRaw === null
    ? { '3,3': 'neutral' as const, '6,6': 'neutral' as const }
    : JSON.parse(basesRaw);

  return {
    board: {
      battleId,
      currentRound: session.currentRound,
      currentStep: session.currentStep,
      currentPhase: session.currentPhase,
      currentActorId: session.currentActorId,
      characters: statusList,
      p1Stars,
      p2Stars,
      bases,
    },
    characters,
  };
}

// ========================================
// 公共 broadcaster
// ========================================

/**
 * 推整盘状态给 battle room(双方都看)。
 *
 * 调用场景:T049 整盘变化(罕见,主要留给未来)、T051 回合切换(broadcaster 由 T051 决定是否调)。
 *
 * @param io IOServer
 * @param battleId battle id
 */
export async function broadcastBoardState(io: IOServer, battleId: string): Promise<void> {
  try {
    const { board } = await buildBoardState(battleId);
    io.to(battleRoom(battleId)).emit('battle:state:board', board);
  } catch (err) {
    console.error(`[WS] broadcastBoardState failed: battleId=${battleId}`, err);
  }
}

/**
 * 推单角色手牌给 user-room(self-only,对手看不到)。
 *
 * 调用场景:T050 出牌后立即推(出牌者自己的手牌减少)。
 *
 * @param io IOServer
 * @param battleId battle id
 * @param userId 接收者 userId
 * @param characterId 哪个角色的手牌
 */
export async function broadcastHandState(
  io: IOServer,
  battleId: string,
  userId: string,
  characterId: string
): Promise<void> {
  try {
    const hand = await getActorHand(battleId, characterId);
    io.to(userRoom(userId)).emit('battle:state:hand', {
      battleId,
      characterId,
      hand,
    });
  } catch (err) {
    console.error(
      `[WS] broadcastHandState failed: battleId=${battleId} userId=${userId} characterId=${characterId}`,
      err
    );
  }
}

/**
 * 推单角色完整状态给 battle room(双方都看)。
 *
 * 调用场景:T049 移动后(位置/可能的嘲讽变化)、T050 出牌后(受伤 / 能量消耗 / 状态效果)。
 *
 * 注意:若角色被中途删除(`getCharacterStatus` 返回 null),静默不推。
 *
 * @param io IOServer
 * @param battleId battle id
 * @param characterId 哪个角色
 */
export async function broadcastCharacterStatus(
  io: IOServer,
  battleId: string,
  characterId: string
): Promise<void> {
  try {
    const session = await getDbSessionState(battleId);
    if (!session) {
      return;
    }
    const status = await getCharacterStatus(battleId, characterId, session.currentRound);
    if (!status) {
      return;
    }
    io.to(battleRoom(battleId)).emit('battle:state:character', {
      battleId,
      character: status,
    });
  } catch (err) {
    console.error(
      `[WS] broadcastCharacterStatus failed: battleId=${battleId} characterId=${characterId}`,
      err
    );
  }
}

/**
 * 推全量首屏状态给 user-room(join 后调用,含自己手牌)。
 *
 * 流程:
 *   1. `buildBoardState` 拿整盘
 *   2. 从 board.characters 筛出本 userId 拥有的 characterIds
 *      (通过 listCharactersInBattle 的 userId 字段反查)
 *   3. 对每个 own characterId 并行调 `getActorHand` 拿手牌
 *   4. 拼成 `{ board, ownHand: { charId1: [...], charId2: [...], ... } }`
 *   5. emit `battle:state:full` 到 user:{userId}
 *
 * @param io IOServer
 * @param battleId battle id
 * @param userId 接收者 userId
 */
export async function broadcastFullState(
  io: IOServer,
  battleId: string,
  userId: string
): Promise<void> {
  try {
    // 1. 整盘 + character 列表(同一次 buildBoardState 调用,避免重复 SQL)
    const { board, characters } = await buildBoardState(battleId);

    // 2. 筛 own characterIds
    const ownCharIds = characters.filter((c) => c.userId === userId).map((c) => c.characterId);

    // 3. ownHand
    const ownHandEntries = await Promise.all(
      ownCharIds.map(async (characterId) => {
        const hand = await getActorHand(battleId, characterId);
        return [characterId, hand] as const;
      })
    );

    const ownHand: Record<string, HandCard[]> = {};
    for (const [characterId, hand] of ownHandEntries) {
      ownHand[characterId] = hand;
    }

    // 4. emit
    const payload: FullStateEvent = {
      battleId,
      board,
      ownHand,
    };
    io.to(userRoom(userId)).emit('battle:state:full', payload);
  } catch (err) {
    console.error(
      `[WS] broadcastFullState failed: battleId=${battleId} userId=${userId}`,
      err
    );
  }
}

/**
 * T051: 广播 session 状态变化（currentRound/currentStep/currentActorId/currentPhase）
 * 走 battle room（双方共有）
 *
 * 用途：executeEndStep / executeRoundEnd 末尾推送 session 元数据。
 * 区别于 broadcastBoardState：后者含完整 character 状态，前者只推 4 字段。
 */
export async function broadcastSessionState(
  io: IOServer,
  battleId: string,
  state: {
    currentRound: number;
    currentStep: number;
    currentActorId: string | null;
    currentPhase: string;
  }
): Promise<void> {
  io.to(`battle:${battleId}`).emit('battle:state:session', {
    battleId,
    currentRound: state.currentRound,
    currentStep: state.currentStep,
    currentActorId: state.currentActorId,
    currentPhase: state.currentPhase,
  });
}

/**
 * T052: 广播据点状态变化（server → both）
 *
 * payload 字段：
 *   - battleId
 *   - bases: { '3,3': 'p1' | 'p2' | 'neutral', '6,6': ... }
 *
 * 调用方：battleOutcomeService.applyBaseStars
 */
export async function broadcastBasesState(
  io: IOServer,
  battleId: string,
  bases: { '3,3': 'p1' | 'p2' | 'neutral'; '6,6': 'p1' | 'p2' | 'neutral' }
): Promise<void> {
  io.to(`battle:${battleId}`).emit('battle:state:bases', {
    battleId,
    bases,
  });
}

/**
 * T052: 广播战斗结束事件（server → both）
 *
 * payload 字段：
 *   - battleId
 *   - winnerUserId: string | null  (平局时 null)
 *   - winnerSide: 'p1' | 'p2' | null  (平局时 null)
 *   - victoryType: 'kill_threshold' | 'base_threshold' | 'draw'
 *   - p1Stars: number
 *   - p2Stars: number
 *   - p1UserId: string
 *   - p2UserId: string
 *
 * 调用方：battleOutcomeService.recordVictory
 */
export async function broadcastBattleEnd(
  io: IOServer,
  battleId: string,
  payload: {
    winnerUserId: string | null;
    winnerSide: 'p1' | 'p2' | null;
    victoryType: 'kill_threshold' | 'base_threshold' | 'draw';
    p1Stars: number;
    p2Stars: number;
    p1UserId: string | null;
    p2UserId: string | null;
  }
): Promise<void> {
  io.to(`battle:${battleId}`).emit('battle:end', {
    battleId,
    winnerUserId: payload.winnerUserId,
    winnerSide: payload.winnerSide,
    victoryType: payload.victoryType,
    p1Stars: payload.p1Stars,
    p2Stars: payload.p2Stars,
    p1UserId: payload.p1UserId,
    p2UserId: payload.p2UserId,
  });
}

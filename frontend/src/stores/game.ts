import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from './auth';
import { matchApi } from '@/services/api';
import type {
  BoardStateEvent, FullStateEvent, HandCard, CharacterStatus,
  SessionStateEvent, BattleEndEvent, MatchMatchedEvent, JoinOkEvent,
  BattlePhase,
} from '@/types';

export const useGameStore = defineStore('game', () => {
  const socket = ref<Socket | null>(null);
  const connected = ref(false);

  // 对战状态
  const battleId = ref<string | null>(null);
  const board = ref<BoardStateEvent | null>(null);
  const ownHand = ref<Record<string, HandCard[]>>({});
  const myUserId = ref<string | null>(null);
  const myCharacterIds = ref<string[]>([]);
  const opponentJoined = ref(false);
  const opponentDisconnected = ref(false);
  const battleEnded = ref<BattleEndEvent | null>(null);

  // 撮合状态
  const matching = ref(false);
  const matched = ref<MatchMatchedEvent | null>(null);
  const inQueue = ref(false);

  // 操作错误提示
  const lastError = ref<string | null>(null);

  const currentPhase = computed<BattlePhase | null>(() => board.value?.currentPhase ?? null);
  const currentActorId = computed(() => board.value?.currentActorId ?? null);
  const isMyTurn = computed(
    () =>
      currentActorId.value !== null &&
      myCharacterIds.value.includes(currentActorId.value)
  );

  function connect() {
    const auth = useAuthStore();
    if (socket.value?.connected) return;
    if (!auth.token) return;

    const s = io('/', {
      auth: { token: auth.token },
      transports: ['websocket', 'polling'],
    });
    socket.value = s;

    s.on('connect', () => { connected.value = true; });
    s.on('disconnect', () => { connected.value = false; });
    s.on('connect_error', () => { connected.value = false; });

    s.on('battle:matched', (payload: MatchMatchedEvent) => {
      matched.value = payload;
      matching.value = false;
      inQueue.value = false;
      // T073: 匹配成功后自动加入对战房间，后端回 battle:join:ok + 推送 battle:state:full
      joinBattle(payload.battleId);
    });

    s.on('battle:join:ok', (payload: JoinOkEvent) => {
      battleId.value = payload.battleId;
      opponentJoined.value = payload.opponentInRoom;
    });

    s.on('battle:state:full', (payload: FullStateEvent) => {
      board.value = payload.board;
      ownHand.value = payload.ownHand;
      battleId.value = payload.battleId;
      // 推断自己的角色：ownHand 的 key 即自己的角色 id
      myCharacterIds.value = Object.keys(payload.ownHand);
    });

    s.on('battle:state:board', (payload: BoardStateEvent) => {
      board.value = payload;
    });

    s.on('battle:state:session', (payload: SessionStateEvent) => {
      if (board.value) {
        board.value.currentRound = payload.currentRound;
        board.value.currentStep = payload.currentStep;
        board.value.currentActorId = payload.currentActorId;
        board.value.currentPhase = payload.currentPhase;
      }
    });

    s.on('battle:state:hand', (payload: { battleId: string; characterId: string; hand: HandCard[] }) => {
      ownHand.value = { ...ownHand.value, [payload.characterId]: payload.hand };
    });

    s.on('battle:state:character', (payload: { battleId: string; character: CharacterStatus }) => {
      if (board.value) {
        const idx = board.value.characters.findIndex(
          (c) => c.characterId === payload.character.characterId
        );
        const chars = [...board.value.characters];
        if (idx >= 0) chars[idx] = payload.character;
        else chars.push(payload.character);
        board.value = { ...board.value, characters: chars };
      }
    });

    s.on('battle:state:bases', (payload: { battleId: string; bases: BoardStateEvent['bases'] }) => {
      if (board.value) {
        board.value = { ...board.value, bases: payload.bases };
      }
    });

    s.on('battle:opponent_joined', () => {
      opponentJoined.value = true;
      opponentDisconnected.value = false;
    });

    s.on('battle:opponent_disconnected', () => {
      opponentDisconnected.value = true;
    });

    s.on('battle:end', (payload: BattleEndEvent) => {
      battleEnded.value = payload;
    });

    s.on('battle:move:error', (e: { error: string }) => { lastError.value = e.error; });
    s.on('battle:play_card:error', (e: { error: string; detail?: string }) => {
      lastError.value = e.detail || e.error;
    });
    s.on('battle:skip_play:error', (e: { error: string; detail?: string }) => {
      lastError.value = e.detail || e.error;
    });
    s.on('battle:join:error', (e: { error: string }) => { lastError.value = e.error; });
  }

  function disconnect() {
    socket.value?.disconnect();
    socket.value = null;
    connected.value = false;
    resetBattle();
  }

  // ---------- 操作 ----------
  function joinBattle(battleId: string) {
    socket.value?.emit('battle:join', { battleId });
  }

  function move(characterId: string, toX: number, toY: number) {
    if (!battleId.value) return;
    socket.value?.emit('battle:move', { battleId: battleId.value, characterId, toX, toY });
  }

  function playCard(characterId: string, handCard: HandCard, targetId?: string) {
    if (!battleId.value) return;
    const payload: Record<string, unknown> = {
      battleId: battleId.value,
      characterId,
      handCard: targetId ? { ...handCard, targetId } : handCard,
    };
    socket.value?.emit('battle:play_card', payload);
  }

  function skipPlay() {
    if (!battleId.value) return;
    socket.value?.emit('battle:skip_play', { battleId: battleId.value });
  }

  // ---------- T077 匹配队列 ----------
  // 加入匹配队列; matched=true 时后端 emit battle:matched -> handler(T073) 自动 joinBattle
  async function queueMatch() {
    if (inQueue.value || matched.value || battleId.value) return;
    lastError.value = null;
    matching.value = true;
    inQueue.value = true;
    try {
      const res = await matchApi.join();
      // matched=true: WS battle:matched handler 复位队列态 + auto-join (可能已先于 await 触发)
      // matched=false: 留在队列等待 (inQueue 保持 true)
      // 两种情况都不在此复位 inQueue, 避免 WS 事件未到时 UI 闪烁回「开始匹配」
      void res;
    } catch (e) {
      lastError.value = (e as { error?: string })?.error || '匹配失败，请重试';
      matching.value = false;
      inQueue.value = false;
    }
  }

  async function cancelMatch() {
    try {
      await matchApi.leave();
    } catch {
      // 取消失败不阻塞 UI 复位
    }
    matching.value = false;
    inQueue.value = false;
    matched.value = null;
  }

  function clearError() { lastError.value = null; }

  function resetBattle() {
    battleId.value = null;
    board.value = null;
    ownHand.value = {};
    myCharacterIds.value = [];
    opponentJoined.value = false;
    opponentDisconnected.value = false;
    battleEnded.value = null;
    matched.value = null;
    matching.value = false;
    inQueue.value = false;
  }

  return {
    socket, connected, battleId, board, ownHand, myUserId, myCharacterIds,
    opponentJoined, opponentDisconnected, battleEnded, matching, matched, inQueue,
    lastError, currentPhase, currentActorId, isMyTurn,
    connect, disconnect, joinBattle, move, playCard, skipPlay, clearError, resetBattle,
    queueMatch, cancelMatch,
  };
});

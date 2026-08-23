// 布置阶段服务单测 (T1011)
// mock 策略: database/redis 按 SQL/key 内容路由, 避免调用顺序脆弱;
// redis 用内存 Map 模拟 get/set(NX)/del, 真实复现 load-modify-save 语义
const mockQuery = jest.fn();
const mockQueryOne = jest.fn();
const mockExecute = jest.fn();
const mockGetDeck = jest.fn();

jest.mock('../config/database', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  execute: mockExecute,
  withTransaction: jest.fn(),
}));
jest.mock('../config/redis', () => {
  const store = new Map<string, string>();
  return {
    redisClient: {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string, opts?: { NX?: boolean }) => {
        if (opts?.NX && store.has(k)) {
          return null;
        }
        store.set(k, v);
        return 'OK';
      },
      del: async (k: string) => {
        store.delete(k);
        return 1;
      },
      __store: store,
    },
  };
});
jest.mock('./characterService', () => ({
  getCharacterDeckCards: mockGetDeck,
}));

import { redisClient } from '../config/redis';
import {
  persistDeckSnapshots,
  createDeployment,
  updateDraft,
  confirmDeployment,
  finalizeDeployment,
  buildDefaultSideConfig,
  getDeploymentView,
  isDeploymentExpired,
  DeploymentState,
  DeployDraft,
  DEPLOYMENT_DURATION_MS,
} from './deploymentService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store = (redisClient as any).__store as Map<string, string>;

const BATTLE_ID = 'b1';
const P1_USER = 'u1';
const P2_USER = 'u2';
const PL1 = 'pl1';
const PL2 = 'pl2';

const CONTEXT_ROW = {
  id: BATTLE_ID,
  status: 'pending',
  current_phase: 'deployment',
  player1_id: PL1,
  player2_id: PL2,
  p1_user_id: P1_USER,
  p2_user_id: P2_USER,
};

/** 棋子行: c1=warrior c2=ranger c3=mage (均属 PL1) */
const P1_CHARS = [
  { id: 'c1', profession: 'warrior' },
  { id: 'c2', profession: 'ranger' },
  { id: 'c3', profession: 'mage' },
];

/** PL1 的卡: t1x2(warrior), t2(common), t3(mage) */
const P1_CARDS = [
  { id: 'k1', name: '斩击', profession: 'warrior', template_no: 1 },
  { id: 'k2', name: '斩击', profession: 'warrior', template_no: 1 },
  { id: 'k3', name: '轻甲', profession: 'common', template_no: 2 },
  { id: 'k4', name: '火球', profession: 'mage', template_no: 3 },
];

function validP1Draft(): DeployDraft {
  return {
    selectedCharacters: ['c1', 'c2', 'c3'],
    placements: [
      { characterId: 'c1', x: 2 },
      { characterId: 'c2', x: 1 },
      { characterId: 'c3', x: 0 },
    ],
    decks: { c1: ['k1'], c2: [], c3: ['k4'] },
  };
}

/** 路由 query: 按 SQL 特征返回 */
function routeQuery(sql: string): unknown[] {
  if (sql.includes('ANY($2::uuid[])') && sql.includes('characters')) {
    return P1_CHARS.filter(c => CURRENT_SELECTED.includes(c.id));
  }
  if (sql.includes('player_cards')) {
    const ids = CURRENT_CARDS;
    // 同时携带 validateDraft 字段(id/profession)与 persistDeckSnapshots 字段(card_id/type/cost)
    return P1_CARDS.filter(c => ids.includes(c.id)).map(c => ({
      ...c,
      card_id: c.id,
      type: 'attack',
      cost: 1,
      effect: {},
      card_sequence: 0,
    }));
  }
  if (sql.includes('ORDER BY created_at ASC LIMIT 3')) {
    return CURRENT_DEFAULT_CHARS ?? P1_CHARS;
  }
  return [];
}

// 路由状态(测试用例动态设置)
let CURRENT_SELECTED: string[] = [];
let CURRENT_CARDS: string[] = [];
let CURRENT_DEFAULT_CHARS: typeof P1_CHARS | null = null;

function loadState(): DeploymentState | null {
  const raw = store.get(`battle:${BATTLE_ID}:deployment`);
  return raw ? (JSON.parse(raw) as DeploymentState) : null;
}

function seedState(overrides?: Partial<DeploymentState>): DeploymentState {
  const state: DeploymentState = {
    battleId: BATTLE_ID,
    deadline: new Date(Date.now() + DEPLOYMENT_DURATION_MS).toISOString(),
    p1: { playerId: PL1, confirmed: false, draft: null },
    p2: { playerId: PL2, confirmed: false, draft: null },
    finalized: null,
    ...overrides,
  };
  store.set(`battle:${BATTLE_ID}:deployment`, JSON.stringify(state));
  return state;
}

beforeEach(() => {
  jest.resetAllMocks();
  store.clear();
  CURRENT_SELECTED = [];
  CURRENT_CARDS = [];
  CURRENT_DEFAULT_CHARS = null;

  // queryOne: createDeployment 走 status='pending' 分支, 其余为上下文行
  mockQueryOne.mockImplementation(async (sql: string) => {
    if (sql.includes("status = 'pending'")) {
      return { player1_id: PL1, player2_id: PL2 };
    }
    return CONTEXT_ROW;
  });
  mockQuery.mockImplementation(async (sql: string) => routeQuery(sql));
  mockExecute.mockResolvedValue(1);
  mockGetDeck.mockResolvedValue([{ card_id: 'kd' }]);
});

describe('createDeployment', () => {
  it('创建状态: deadline=+120s, 双方 playerId, phase 落 DB', async () => {
    const r = await createDeployment(BATTLE_ID);
    expect(r.success).toBe(true);
    const state = loadState();
    expect(state).not.toBeNull();
    expect(state!.p1.playerId).toBe(PL1);
    expect(state!.p2.playerId).toBe(PL2);
    expect(state!.p1.confirmed).toBe(false);
    const remaining = Date.parse(state!.deadline) - Date.now();
    expect(remaining).toBeGreaterThan(DEPLOYMENT_DURATION_MS - 2000);
    expect(remaining).toBeLessThanOrEqual(DEPLOYMENT_DURATION_MS);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("current_phase = 'deployment'"),
      [BATTLE_ID]
    );
  });

  it('幂等: 已存在直接返回, 不再写 DB', async () => {
    const seeded = seedState();
    const r = await createDeployment(BATTLE_ID);
    expect(r.success).toBe(true);
    expect(r.state).toEqual(seeded);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('battle 非 pending -> battle_not_pending', async () => {
    mockQueryOne.mockResolvedValue(null);
    const r = await createDeployment(BATTLE_ID);
    expect(r).toEqual({ success: false, error: 'battle_not_pending' });
  });
});

describe('updateDraft', () => {
  it('合法草稿写入成功(空卡组)', async () => {
    seedState();
    const draft: DeployDraft = {
      selectedCharacters: ['c1', 'c2', 'c3'],
      placements: [
        { characterId: 'c1', x: 0 },
        { characterId: 'c2', x: 3 },
        { characterId: 'c3', x: 8 },
      ],
      decks: {},
    };
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    const r = await updateDraft(BATTLE_ID, P1_USER, draft);
    expect(r.success).toBe(true);
    expect(loadState()!.p1.draft).toEqual(draft);
    // 对手侧不受影响
    expect(loadState()!.p2.draft).toBeNull();
  });

  it('合法草稿带卡组(职业匹配 + 同名<=3)', async () => {
    seedState();
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    CURRENT_CARDS = ['k1', 'k2', 'k3', 'k4'];
    const draft = validP1Draft();
    const r = await updateDraft(BATTLE_ID, P1_USER, draft);
    expect(r.success).toBe(true);
    expect(loadState()!.p1.draft).toEqual(draft);
  });

  it('非参与者 -> not_participant', async () => {
    mockQueryOne.mockResolvedValue({ ...CONTEXT_ROW, p1_user_id: 'other', p2_user_id: 'other2' });
    const r = await updateDraft(BATTLE_ID, P1_USER, validP1Draft());
    expect(r).toEqual({ success: false, error: 'not_participant' });
  });

  it('部署状态不存在 -> deployment_not_found', async () => {
    // 注意 store 里无 deployment key, 但校验先行 -> 需让草稿校验通过
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    CURRENT_CARDS = ['k1', 'k2', 'k3', 'k4'];
    const r = await updateDraft(BATTLE_ID, P1_USER, validP1Draft());
    expect(r).toEqual({ success: false, error: 'deployment_not_found' });
  });

  it('已确认方不可再改 -> side_confirmed', async () => {
    seedState({ p1: { playerId: PL1, confirmed: true, draft: validP1Draft() } });
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    CURRENT_CARDS = ['k1', 'k2', 'k3', 'k4'];
    const r = await updateDraft(BATTLE_ID, P1_USER, validP1Draft());
    expect(r).toEqual({ success: false, error: 'side_confirmed' });
  });

  it('超时后拒绝 -> deployment_expired', async () => {
    seedState({ deadline: new Date(Date.now() - 1000).toISOString() });
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    CURRENT_CARDS = ['k1', 'k2', 'k3', 'k4'];
    const r = await updateDraft(BATTLE_ID, P1_USER, validP1Draft());
    expect(r).toEqual({ success: false, error: 'deployment_expired' });
  });

  it('结构非法: 棋子数 != 3 -> invalid_draft', async () => {
    seedState();
    const bad = validP1Draft();
    bad.selectedCharacters = ['c1', 'c2'];
    const r = await updateDraft(BATTLE_ID, P1_USER, bad);
    expect(r.success).toBe(false);
    expect(r.error).toBe('invalid_draft');
    expect(r.details).toContain('selected_characters_must_be_3');
  });

  it('结构非法: 摆位重叠 -> invalid_draft', async () => {
    seedState();
    const bad = validP1Draft();
    bad.placements = [
      { characterId: 'c1', x: 1 },
      { characterId: 'c2', x: 1 },
      { characterId: 'c3', x: 2 },
    ];
    const r = await updateDraft(BATTLE_ID, P1_USER, bad);
    expect(r.details).toContain('placement_overlap');
  });

  it('结构非法: x 越界(9) -> invalid_draft', async () => {
    seedState();
    const bad = validP1Draft();
    bad.placements[0].x = 9;
    const r = await updateDraft(BATTLE_ID, P1_USER, bad);
    expect(r.details![0]).toContain('placement_x_out_of_range');
  });

  it('DB 校验: 棋子非本人/已死 -> invalid_draft', async () => {
    seedState();
    CURRENT_SELECTED = ['c1', 'c2']; // c3 不属于本人
    const r = await updateDraft(BATTLE_ID, P1_USER, validP1Draft());
    expect(r.details!.some(d => d.startsWith('character_not_owned_or_dead'))).toBe(true);
  });

  it('DB 校验: 卡牌非本人 -> invalid_draft', async () => {
    seedState();
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    CURRENT_CARDS = []; // k1/k4 不属于本人
    const r = await updateDraft(BATTLE_ID, P1_USER, validP1Draft());
    expect(r.details).toContain('card_not_owned:k1');
    expect(r.details).toContain('card_not_owned:k4');
  });

  it('DB 校验: 职业不匹配(mage 卡给 warrior) -> invalid_draft', async () => {
    seedState();
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    CURRENT_CARDS = ['k1', 'k2', 'k3', 'k4'];
    const bad = validP1Draft();
    bad.decks = { c1: ['k4'] }; // 火球(mage)给战士
    const r = await updateDraft(BATTLE_ID, P1_USER, bad);
    expect(r.details).toContain('card_profession_mismatch:k4');
  });

  it('DB 校验: 同名卡 > 3 张 -> invalid_draft', async () => {
    seedState();
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    CURRENT_CARDS = ['k1', 'k2', 'k3', 'k4'];
    // k1/k2 同 template_no=1, 加两张虚构同模板卡
    const bad = validP1Draft();
    bad.decks = { c1: ['k1', 'k2', 'k1', 'k2'] }; // 同名 4 张(重复 id 也计)
    const r = await updateDraft(BATTLE_ID, P1_USER, bad);
    expect(r.details!.some(d => d.startsWith('same_card_exceeds_3'))).toBe(true);
  });

  it('结构校验: 卡组总张数 > 12 -> invalid_draft', async () => {
    seedState();
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    const bad = validP1Draft();
    bad.decks = { c1: Array.from({ length: 13 }, (_, i) => `card${i}`) };
    const r = await updateDraft(BATTLE_ID, P1_USER, bad);
    expect(r.details!.some(d => d.startsWith('deck_too_large'))).toBe(true);
  });

  it('跨棋子重复分配: 同卡进两个卡组 -> invalid_draft', async () => {
    seedState();
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    CURRENT_CARDS = ['k3'];
    const bad = validP1Draft();
    bad.decks = { c1: ['k3'], c2: ['k3'] };
    const r = await updateDraft(BATTLE_ID, P1_USER, bad);
    expect(r.details).toContain('card_in_multiple_decks:k3');
  });
});

describe('confirmDeployment', () => {
  it('有草稿 -> 确认成功, bothConfirmed=false(对方未确认)', async () => {
    seedState({ p1: { playerId: PL1, confirmed: false, draft: validP1Draft() } });
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    CURRENT_CARDS = ['k1', 'k2', 'k3', 'k4'];
    const r = await confirmDeployment(BATTLE_ID, P1_USER);
    expect(r.success).toBe(true);
    expect(r.bothConfirmed).toBe(false);
    expect(loadState()!.p1.confirmed).toBe(true);
  });

  it('双方都确认 -> bothConfirmed=true', async () => {
    seedState({
      p1: { playerId: PL1, confirmed: true, draft: validP1Draft() },
      p2: {
        playerId: PL2,
        confirmed: false,
        draft: {
          selectedCharacters: ['c1', 'c2', 'c3'],
          placements: [
            { characterId: 'c1', x: 8 },
            { characterId: 'c2', x: 7 },
            { characterId: 'c3', x: 6 },
          ],
          decks: {},
        },
      },
    });
    // p2 的草稿引用 c1-c3(测试库固定归 PL1, 走 mock 路由即可)
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    const r = await confirmDeployment(BATTLE_ID, P2_USER);
    expect(r.success).toBe(true);
    expect(r.bothConfirmed).toBe(true);
  });

  it('无草稿 -> no_draft', async () => {
    seedState();
    const r = await confirmDeployment(BATTLE_ID, P1_USER);
    expect(r).toEqual({ success: false, error: 'no_draft' });
  });

  it('重复确认 -> side_confirmed', async () => {
    seedState({ p1: { playerId: PL1, confirmed: true, draft: validP1Draft() } });
    const r = await confirmDeployment(BATTLE_ID, P1_USER);
    expect(r).toEqual({ success: false, error: 'side_confirmed' });
  });
});

describe('finalizeDeployment', () => {
  it('双方已确认 -> 应用双方草稿(y 由 side 决定), battle_data 持久化', async () => {
    const p2Draft: DeployDraft = {
      selectedCharacters: ['c1', 'c2', 'c3'],
      placements: [
        { characterId: 'c1', x: 8 },
        { characterId: 'c2', x: 7 },
        { characterId: 'c3', x: 6 },
      ],
      decks: {},
    };
    seedState({
      p1: { playerId: PL1, confirmed: true, draft: validP1Draft() },
      p2: { playerId: PL2, confirmed: true, draft: p2Draft },
    });
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    CURRENT_CARDS = ['k1', 'k2', 'k3', 'k4'];

    const r = await finalizeDeployment(BATTLE_ID);
    expect(r.success).toBe(true);
    // p1: y=0, 用草稿 x 与卡组
    expect(r.finalized!.p1.pieces).toEqual([
      { characterId: 'c1', x: 2, y: 0, deckCardIds: ['k1'] },
      { characterId: 'c2', x: 1, y: 0, deckCardIds: [] },
      { characterId: 'c3', x: 0, y: 0, deckCardIds: ['k4'] },
    ]);
    // p2: y=8
    expect(r.finalized!.p2.pieces.map(p => p.y)).toEqual([8, 8, 8]);
    // 审计持久化
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('battle_data'),
      [BATTLE_ID, expect.stringContaining('"deployment"')]
    );
    // 幂等标记
    expect(loadState()!.finalized).toEqual(r.finalized);
  });

  it('单方未确认 -> 未确认方走默认配置(职业固定位+默认卡组)', async () => {
    seedState({ p1: { playerId: PL1, confirmed: true, draft: validP1Draft() } });
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    CURRENT_CARDS = ['k1', 'k2', 'k3', 'k4'];
    CURRENT_DEFAULT_CHARS = P1_CHARS; // p2 默认取前 3 alive(同一 mock 库)
    mockGetDeck.mockResolvedValue([{ card_id: 'kd' }]);

    const r = await finalizeDeployment(BATTLE_ID);
    expect(r.success).toBe(true);
    // p1 用草稿
    expect(r.finalized!.p1.pieces[0]).toEqual({ characterId: 'c1', x: 2, y: 0, deckCardIds: ['k1'] });
    // p2 默认: warrior(2,8) ranger(7,8) mage(8,8), 卡组=character_deck
    const p2 = r.finalized!.p2.pieces;
    expect(p2).toHaveLength(3);
    const byProfession = Object.fromEntries(
      CURRENT_DEFAULT_CHARS!.map((c, i) => [c.profession, p2[i]])
    );
    expect(byProfession.warrior).toEqual({ characterId: 'c1', x: 6, y: 8, deckCardIds: ['kd'] });
    expect(byProfession.ranger).toEqual({ characterId: 'c2', x: 7, y: 8, deckCardIds: ['kd'] });
    expect(byProfession.mage).toEqual({ characterId: 'c3', x: 8, y: 8, deckCardIds: ['kd'] });
  });

  it('幂等: 第二次调用直接返回已存结果, 不重算', async () => {
    const p2Draft: DeployDraft = {
      selectedCharacters: ['c1', 'c2', 'c3'],
      placements: [
        { characterId: 'c1', x: 8 },
        { characterId: 'c2', x: 7 },
        { characterId: 'c3', x: 6 },
      ],
      decks: {},
    };
    seedState({
      p1: { playerId: PL1, confirmed: true, draft: validP1Draft() },
      p2: { playerId: PL2, confirmed: true, draft: p2Draft },
    });
    CURRENT_SELECTED = ['c1', 'c2', 'c3'];
    CURRENT_CARDS = ['k1', 'k2', 'k3', 'k4'];

    const first = await finalizeDeployment(BATTLE_ID);
    mockExecute.mockClear();
    const second = await finalizeDeployment(BATTLE_ID);
    expect(second.success).toBe(true);
    expect(second.finalized).toEqual(first.finalized);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('buildDefaultSideConfig', () => {
  it('职业固定位 + 固定位被占时顺序兜底(3 个 warrior)', async () => {
    CURRENT_DEFAULT_CHARS = [
      { id: 'w1', profession: 'warrior' },
      { id: 'w2', profession: 'warrior' },
      { id: 'w3', profession: 'warrior' },
    ];
    mockGetDeck.mockResolvedValue([]);
    const side = await buildDefaultSideConfig('p1', PL1);
    expect(side.pieces.map(p => [p.characterId, p.x, p.y])).toEqual([
      ['w1', 2, 0], // warrior 固定位
      ['w2', 0, 0], // 占用 -> 从 x=0 起找空位
      ['w3', 1, 0],
    ]);
  });

  it('p2 固定位方向相反(mage=8,ranger=7,warrior=6)', async () => {
    CURRENT_DEFAULT_CHARS = P1_CHARS;
    mockGetDeck.mockResolvedValue([]);
    const side = await buildDefaultSideConfig('p2', PL2);
    const byId = Object.fromEntries(side.pieces.map(p => [p.characterId, p.x]));
    expect(byId).toEqual({ c1: 6, c2: 7, c3: 8 }); // c1=warrior c2=ranger c3=mage
  });
});

describe('getDeploymentView / isDeploymentExpired', () => {
  it('视图只含自己的草稿, 对手仅暴露 confirmed', async () => {
    seedState({
      p1: { playerId: PL1, confirmed: false, draft: validP1Draft() },
      p2: {
        playerId: PL2,
        confirmed: true,
        draft: {
          selectedCharacters: ['x1', 'x2', 'x3'],
          placements: [
            { characterId: 'x1', x: 8 },
            { characterId: 'x2', x: 7 },
            { characterId: 'x3', x: 6 },
          ],
          decks: { x1: ['secret'] },
        },
      },
    });
    const view = await getDeploymentView(BATTLE_ID, P1_USER);
    expect(view).not.toBeNull();
    expect(view!.mySide).toBe('p1');
    expect(view!.myDraft).toEqual(validP1Draft());
    expect(view!.myConfirmed).toBe(false);
    expect(view!.opponentConfirmed).toBe(true);
    // 对手草稿不出现
    expect(JSON.stringify(view)).not.toContain('secret');
    expect(JSON.stringify(view)).not.toContain('x1');
  });

  it('未到期 false / 到期 true / 已 finalize false', async () => {
    seedState();
    expect(await isDeploymentExpired(BATTLE_ID)).toBe(false);
    seedState({ deadline: new Date(Date.now() - 1).toISOString() });
    expect(await isDeploymentExpired(BATTLE_ID)).toBe(true);
    seedState({
      deadline: new Date(Date.now() - 1).toISOString(),
      finalized: { p1: { pieces: [] }, p2: { pieces: [] } },
    });
    expect(await isDeploymentExpired(BATTLE_ID)).toBe(false);
  });
});


describe('persistDeckSnapshots (T1012)', () => {
  it('按配置顺序写入快照, deck_id 合成 = card_id, 空卡组写 []', async () => {
    seedState(); // 提供 p1/p2 playerId
    // query 路由: player_cards 查询按 CURRENT_CARDS 过滤
    CURRENT_CARDS = ['k1', 'k3', 'k4'];
    const finalized = {
      p1: {
        pieces: [
          { characterId: 'c1', x: 2, y: 0, deckCardIds: ['k3', 'k1'] }, // 乱序, 快照应保持配置顺序
          { characterId: 'c2', x: 1, y: 0, deckCardIds: [] },
        ],
      },
      p2: { pieces: [{ characterId: 'c3', x: 8, y: 8, deckCardIds: ['k4'] }] },
    };

    await persistDeckSnapshots(BATTLE_ID, finalized);

    // c1 快照: [k3, k1] 配置顺序
    const c1 = JSON.parse(store.get(`battle:${BATTLE_ID}:deck:c1`)!);
    expect(c1.map((r: any) => r.card_id)).toEqual(['k3', 'k1']);
    expect(c1[0].deck_id).toBe('k3'); // deck_id 合成
    expect(c1[0]).toMatchObject({ name: '轻甲', template_no: 2 });
    // c2 空卡组显式 []
    expect(store.get(`battle:${BATTLE_ID}:deck:c2`)).toBe('[]');
    // c3 (p2)
    const c3 = JSON.parse(store.get(`battle:${BATTLE_ID}:deck:c3`)!);
    expect(c3.map((r: any) => r.card_id)).toEqual(['k4']);
  });

  it('配置中的卡不在本人库存 -> 该卡被剔除', async () => {
    seedState();
    CURRENT_CARDS = ['k1']; // k9 不在库存
    const finalized = {
      p1: { pieces: [{ characterId: 'c1', x: 0, y: 0, deckCardIds: ['k1', 'k9'] }] },
      p2: { pieces: [] },
    };
    await persistDeckSnapshots(BATTLE_ID, finalized);
    const c1 = JSON.parse(store.get(`battle:${BATTLE_ID}:deck:c1`)!);
    expect(c1.map((r: any) => r.card_id)).toEqual(['k1']);
  });
});

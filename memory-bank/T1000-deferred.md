# T1000 - 搁置事项记录

> 此文档记录所有暂缓执行的任务和待处理问题
> 每新增一项搁置事项，应记录原因、影响范围和后续处理方向

---

## 待处理搁置事项

| 任务ID | 描述 | 关联任务 | 创建时间 |
|--------|------|----------|----------|
| T1000-001 | 卡牌溢出处理方案 | T031, T075 | 2026-03-19 |

---

## 待实施扩展任务（T1000+ 之后）

> 范围已锁定、待实施的功能扩展任务。区别于「搁置事项」：设计决策已确认，等开发排期。

### T1001 - 实现战棋公共池系统

| 字段 | 值 |
|------|-----|
| 创建时间 | 2026-06-10 |
| 关联任务 | T030, T031, T035, T037, T038, T039 |
| 优先级 | 中（手牌深度 / 战术多样性） |
| 预估代码量 | ~200 行生产代码 + ~150 行测试 |

#### 背景

战棋对战中，单个棋子的 `character_deck` 上限 10 张、每场战斗手牌 3 张。若玩家制造卡牌不足或分配不当，可能出现「棋子抽空手牌、整回合无所事事」的负体验。引入「公共池」：内置一套**通用基础攻击卡**（轻击），当棋子牌库 < 抽牌数时自动从公共池补足，保证每回合棋子仍可执行有限的战术操作。

#### 锁定设计

| 决策 | 取值 | 理由 |
|------|------|------|
| 池内容 | 仅「轻击」（template_no=1, common, attack） | 简洁 / 只含通用卡避免跨职业 |
| 消耗性 | 无限复用 | 不增加玩家资源负担 |
| 保留（T038） | 不可保留，retainHandOnStepEnd 强制过滤 | 避免公共池卡无限堆叠在 retained 字段 |
| 抽取优先级 | 牌库 < count 时从公共池补足 | 不强制覆盖原有牌库逻辑 |
| HandCard 标识 | `source: 'deck' \| 'public_pool'` 枚举 | TS 类型安全，TS 联合类型天然约束 |
| 打牌协议 | WS 消息加 `source` 字段 | 与 HandCard 字段对齐 |
| Warrior 机制 1 | 公共池轻击不触发攻击累计护盾 | 公共池卡是「借用」，不计入职业私有计数器 |

#### 数据库改动

新增 migration `006_public_pool.sql`：

```sql
ALTER TABLE card_templates ADD COLUMN is_public_pool BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE card_templates SET is_public_pool = TRUE WHERE name = '轻击';
```

#### Redis Key 变化

无需新增 key。`HandCard` 在手牌 LIST 中自带 `source` 字段。

#### 改动清单

##### 改：T037（抽牌逻辑）
- `HandCard` interface 加 `source: 'deck' | 'public_pool'`
- `drawCards` 行为变更：实际抽 = `min(count, deckSize)`；缺额调 `drawFromPublicPool(need)`
- 新增内部函数 `drawFromPublicPool(battleId, need)`：返回 N 张「轻击」HandCard
- 重写 ~10 个现有 `drawCards` 测试（行为变化）

##### 改：T035（攻击校验）
- `getPlayerCard(cardId, source?: 'deck' | 'public_pool')` 双 SQL 路径
- `validateAttack(battleId, attackerId, cardId, targetId, currentRound, source?)` 加 source 参数
- 第 4 步「卡牌归属」校验加 source 分支：公共池卡 bypass 'does not belong to attacker'
- 第 13 步 warrior attack trigger 加 `card.source !== 'public_pool'` 过滤
- 新增 ~3 个测试

##### 改：T038（手牌保留）
- `retainHandOnStepEnd`：若 `retainDeckId` 命中的是 public_pool 牌 → 强制全弃 + error
- 新增 2 个测试

##### 改：T030（卡牌数据模型）
- `card_templates.is_public_pool` 列
- `CardTemplate` interface 加 `is_public_pool?: boolean`
- 新 migration 006

##### 改：T031（卡牌库查询）
- 新增 `GET /api/cards/public-pool` 端点（可选 JWT，公共池不是私密资源）
- 新增 1 集成测试

##### 改：T039（战士职业）
- 0 行代码改动（逻辑已通过 T035 的 `card.source !== 'public_pool'` 过滤吸收）
- 仅 1 个测试 case 补：公共池轻击不触发 shieldGained

##### 新增：T1001 主实现
- 新 `publicPoolService.ts`（~50 行）：
  - `getPublicPoolCards()`：查 `is_public_pool=TRUE` 的 card_templates
  - `drawFromPublicPool(battleId, need)`：返回 `HandCard[]`（source='public_pool'）
- 新 `routes/cards.ts`：公共池 query endpoint
- 集成测试 `routes/cards.public-pool.integration.test.ts`（~30 行）

#### 不改的任务

- T020/T021 制造：公共池不通过制造获得（系统内置无限供应）
- T032 卡牌分配：公共池卡不在 player_cards
- T026-T029 职业/棋子
- T033/T034 棋盘/移动
- T036 回合流程（drawCards 行为变化已吸收）

#### 文档更新

- `specs.md`：新增「3.5 公共池」章节
- `architecture.md`：新增「公共池」架构（API、新增服务、影响表）
- `progress.md`：追加 T1001 一行
- `history.md`：实施完成后追加条目

#### 关键边界

| 场景 | 行为 |
|------|------|
| 牌库 = 0, 公共池满 | drawCards 返回 3 张公共池轻击（drawn_count=0, source 混合） |
| 牌库 = 1, count=3 | drawCards 返回 1 张 deck + 2 张公共池 |
| 牌库 = 5, count=3 | drawCards 返回 3 张 deck（行为不变） |
| 玩家从公共池抽到轻击并打出 | warrior 不累计护盾（公共池卡 source 过滤） |
| 玩家想保留公共池轻击 | retainHandOnStepEnd 拒绝，强制全弃 + error |
| 公共池轻击进弃牌堆 | 弃牌堆只用作"已使用"历史（不参与下次 draw，因为是无限复用） |

---

## 已完成搁置事项

| 任务ID | 描述 | 完成时间 | 备注 |
|--------|------|----------|------|
| | | | |

---

*文档版本：v1.1*
*创建日期：2026-03-19*
*最后更新：2026-06-10*

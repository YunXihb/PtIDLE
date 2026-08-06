import { query, execute, withTransaction } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { createCache } from '../utils/cache';

export interface CraftingRecipe {
  id: string;
  name: string;
  category: 'card' | 'gear' | 'consumable';
  // input can be an object {"iron_ingot": 1} or an array [{"iron_ingot": 1}, {"plank": 1}]
  input: Record<string, number> | Record<string, number>[];
  // output varies by category: card/gear have {name, quantity} or {name, bonus}, consumable has {name, quantity, effect}
  output: Record<string, any>;
  profession_required: string | null;
}

// 内存缓存（5分钟过期，共享工具）
const recipesCache = createCache<CraftingRecipe[]>(5 * 60 * 1000);

/**
 * 从数据库获取所有制造配方（带缓存）
 */
export async function getAllCraftingRecipes(): Promise<CraftingRecipe[]> {
  return recipesCache.getOrLoad(async () => {
    const result = await query<{
      id: string;
      name: string;
      category: string;
      input: Record<string, number> | Record<string, number>[];
      output: Record<string, number>;
      profession_required: string | null;
    }>('SELECT id, name, category, input, output, profession_required FROM crafting_recipes ORDER BY category');

    return result.map(row => ({
      id: row.id,
      name: row.name,
      category: row.category as 'card' | 'gear' | 'consumable',
      input: row.input,
      output: row.output,
      profession_required: row.profession_required,
    }));
  });
}

/**
 * 根据 category 获取配方列表
 */
export async function getCraftingRecipesByCategory(category: string): Promise<CraftingRecipe[]> {
  const recipes = await getAllCraftingRecipes();
  return recipes.filter(r => r.category === category);
}

/**
 * 根据 ID 获取配方
 */
export async function getCraftingRecipeById(id: string): Promise<CraftingRecipe | null> {
  const recipes = await getAllCraftingRecipes();
  return recipes.find(r => r.id === id) || null;
}

/**
 * 清除配方缓存（用于测试或配置更新时）
 */
export function clearRecipesCache(): void {
  recipesCache.clear();
}

export interface CardCraftingResult {
  success: boolean;
  cardName: string;
  quantity: number;
  materialsUsed: Record<string, number>;
  playerCardId?: string;
  error?: string;
}

/**
 * 执行卡牌制造
 * @param userId 用户 ID
 * @param recipeId 配方 ID
 * @param quantity 制造数量
 */
export async function executeCardCrafting(
  userId: string,
  recipeId: string,
  quantity: number = 1
): Promise<CardCraftingResult> {
  // 1. 获取配方
  const recipe = await getCraftingRecipeById(recipeId);
  if (!recipe) {
    return { success: false, cardName: '', quantity, materialsUsed: {}, error: 'Recipe not found' };
  }

  // 2. 验证配方类型
  if (recipe.category !== 'card') {
    return { success: false, cardName: '', quantity, materialsUsed: {}, error: 'Recipe is not a card recipe' };
  }

  // 3. 获取玩家数据
  const playerResult = await query<{
    id: string;
    materials: Record<string, number>;
  }>('SELECT id, materials FROM players WHERE user_id = $1', [userId]);

  if (playerResult.length === 0) {
    return { success: false, cardName: '', quantity, materialsUsed: {}, error: 'Player not found' };
  }

  const player = playerResult[0];
  const currentMaterials = player.materials || {};

  // 4. 解析输入材料（可能是单一对象或对象数组）
  const inputMaterials = Array.isArray(recipe.input) ? recipe.input : [recipe.input];

  // 5. 检查每种材料是否足够（每种替代材料只需一种）
  const materialUsage: Record<string, number> = {};
  let hasAllMaterials = true;

  for (const materialSet of inputMaterials) {
    hasAllMaterials = true;
    for (const [material, amount] of Object.entries(materialSet)) {
      const totalRequired = amount * quantity;
      const currentAmount = currentMaterials[material] || 0;
      if (currentAmount < totalRequired) {
        hasAllMaterials = false;
        break;
      }
    }
    if (hasAllMaterials) {
      // 找到足够的材料组合
      for (const [material, amount] of Object.entries(materialSet)) {
        materialUsage[material] = amount * quantity;
      }
      break;
    }
  }

  if (!hasAllMaterials) {
    return {
      success: false,
      cardName: recipe.name,
      quantity,
      materialsUsed: {},
      error: 'Insufficient materials',
    };
  }

  // 6. 检查职业要求
  if (recipe.profession_required) {
    const charactersResult = await query<{ profession: string }>(
      'SELECT profession FROM characters WHERE player_id = $1 AND is_alive = true',
      [player.id]
    );

    const hasRequiredProfession = charactersResult.some(
      char => char.profession === recipe.profession_required
    );

    if (!hasRequiredProfession) {
      return {
        success: false,
        cardName: recipe.name,
        quantity,
        materialsUsed: {},
        error: `Requires ${recipe.profession_required} profession`,
      };
    }
  }

  // 7-11. 校验 + 扣料 + 发卡，全部包进单事务
  //   修复顺序 bug：原实现先扣料再校验（模板不存在/超上限时材料已被扣）。
  //   现在先完成所有校验（模板存在、数量上限、sequence），全部通过后才扣料 + INSERT。
  try {
    const txn = await withTransaction<{ playerCardId: string }>(async (client) => {
      // 7. 获取卡牌模板信息（校验前置）
      const outputInfo = recipe.output as { name: string; quantity: number };
      const cardName = outputInfo.name;

      const templateResult = await client.query<{
        id: string;
        type: string;
        cost: number;
        effect: Record<string, any>;
        max_quantity: number;
      }>('SELECT id, type, cost, effect, max_quantity FROM card_templates WHERE name = $1', [cardName]);

      if (templateResult.rows.length === 0) {
        const err = new Error('Card template not found') as Error & { code?: string };
        err.code = 'CARD_TEMPLATE_NOT_FOUND';
        throw err;
      }

      const template = templateResult.rows[0];

      // 8. 检查卡牌数量上限（校验前置）
      const maxQuantity = template.max_quantity ?? 5;

      const existingCardsResult = await client.query<{ total_quantity: number }>(
        `SELECT COALESCE(SUM(quantity), 0) as total_quantity
         FROM player_cards
         WHERE player_id = $1 AND card_template_id = $2`,
        [player.id, template.id]
      );
      const currentQuantity = Number(existingCardsResult.rows[0]?.total_quantity || 0);

      if (currentQuantity + quantity > maxQuantity) {
        const err = new Error(
          `Card quantity would exceed limit (${maxQuantity}). Current: ${currentQuantity}, Requested: ${quantity}.`
        ) as Error & { code?: string };
        err.code = 'CARD_QUANTITY_EXCEEDED';
        throw err;
      }

      // 9. 获取该玩家已拥有的该种卡牌数量（用于生成 card_sequence）
      const sequenceResult = await client.query<{ max_sequence: number }>(
        `SELECT COALESCE(MAX(card_sequence), 0) as max_sequence
         FROM player_cards
         WHERE player_id = $1 AND card_template_id = $2`,
        [player.id, template.id]
      );
      const nextSequence = Number(sequenceResult.rows[0]?.max_sequence || 0) + 1;

      // 10. 全部校验通过 → 扣除材料
      const updatedMaterials = { ...currentMaterials };
      for (const [material, amount] of Object.entries(materialUsage)) {
        updatedMaterials[material] = (updatedMaterials[material] || 0) - amount;
      }

      const materialsRes = await client.query(
        'UPDATE players SET materials = $1, updated_at = NOW() WHERE user_id = $2',
        [JSON.stringify(updatedMaterials), userId]
      );
      if ((materialsRes.rowCount ?? 0) === 0) {
        const err = new Error('Player not found') as Error & { code?: string };
        err.code = 'PLAYER_NOT_FOUND';
        throw err;
      }

      // 11. 创建玩家卡牌
      const playerCardId = uuidv4();
      await client.query(
        `INSERT INTO player_cards (id, player_id, card_template_id, name, type, cost, effect, quantity, card_sequence, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          playerCardId,
          player.id,
          template.id,
          cardName,
          template.type,
          template.cost,
          JSON.stringify(template.effect),
          quantity,
          nextSequence,
        ]
      );

      return { playerCardId };
    });

    return {
      success: true,
      cardName: (recipe.output as { name: string }).name,
      quantity,
      materialsUsed: materialUsage,
      playerCardId: txn.playerCardId,
    };
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'CARD_TEMPLATE_NOT_FOUND') {
      return {
        success: false,
        cardName: recipe.name,
        quantity,
        materialsUsed: materialUsage,
        error: 'Card template not found',
      };
    }
    if (e.code === 'CARD_QUANTITY_EXCEEDED') {
      return {
        success: false,
        cardName: recipe.name,
        quantity,
        materialsUsed: materialUsage,
        error: e.message,
      };
    }
    if (e.code === 'PLAYER_NOT_FOUND') {
      return {
        success: false,
        cardName: recipe.name,
        quantity,
        materialsUsed: {},
        error: 'Player not found',
      };
    }
    return {
      success: false,
      cardName: recipe.name,
      quantity,
      materialsUsed: {},
      error: e.message,
    };
  }
}

// Gear name to skill bonus key mapping
const GEAR_BONUS_MAP: Record<string, string> = {
  '矿镐': 'mining_bonus',
  '伐木斧': 'woodcutting_bonus',
  '采集手套': 'herbalism_bonus',
};

// Gear bonus values (hardcoded as per spec)
const GEAR_BONUS_VALUES: Record<string, number> = {
  '矿镐': 0.5,
  '伐木斧': 0.5,
  '采集手套': 0.3,
};

export interface GearCraftingResult {
  success: boolean;
  gearName: string;
  bonus: number;
  materialsUsed: Record<string, number>;
  error?: string;
}

/**
 * 执行装备制造
 * @param userId 用户 ID
 * @param recipeId 配方 ID
 * @param quantity 制造数量
 */
export async function executeGearCrafting(
  userId: string,
  recipeId: string,
  quantity: number = 1
): Promise<GearCraftingResult> {
  // 1. 获取配方
  const recipe = await getCraftingRecipeById(recipeId);
  if (!recipe) {
    return { success: false, gearName: '', bonus: 0, materialsUsed: {}, error: 'Recipe not found' };
  }

  // 2. 验证配方类型
  if (recipe.category !== 'gear') {
    return { success: false, gearName: '', bonus: 0, materialsUsed: {}, error: 'Recipe is not a gear recipe' };
  }

  // 3. 获取玩家数据
  const playerResult = await query<{
    id: string;
    materials: Record<string, number>;
    production_gear: Record<string, number>;
  }>('SELECT id, materials, production_gear FROM players WHERE user_id = $1', [userId]);

  if (playerResult.length === 0) {
    return { success: false, gearName: '', bonus: 0, materialsUsed: {}, error: 'Player not found' };
  }

  const player = playerResult[0];
  const currentMaterials = player.materials || {};
  const currentGear = player.production_gear || {};

  // 4. 解析输入材料（可能是单一对象或对象数组）
  const inputMaterials = Array.isArray(recipe.input) ? recipe.input : [recipe.input];

  // 5. 检查每种材料是否足够（每种替代材料只需一种）
  const materialUsage: Record<string, number> = {};
  let hasAllMaterials = true;

  for (const materialSet of inputMaterials) {
    hasAllMaterials = true;
    for (const [material, amount] of Object.entries(materialSet)) {
      const totalRequired = amount * quantity;
      const currentAmount = currentMaterials[material] || 0;
      if (currentAmount < totalRequired) {
        hasAllMaterials = false;
        break;
      }
    }
    if (hasAllMaterials) {
      // 找到足够的材料组合
      for (const [material, amount] of Object.entries(materialSet)) {
        materialUsage[material] = amount * quantity;
      }
      break;
    }
  }

  if (!hasAllMaterials) {
    return {
      success: false,
      gearName: recipe.name,
      bonus: 0,
      materialsUsed: {},
      error: 'Insufficient materials',
    };
  }

  // 6. 扣除材料
  const updatedMaterials = { ...currentMaterials };
  for (const [material, amount] of Object.entries(materialUsage)) {
    updatedMaterials[material] = (updatedMaterials[material] || 0) - amount;
  }

  // 7. 获取装备加成信息
  const outputInfo = recipe.output as { name: string; bonus: number };
  const gearName = outputInfo.name;
  const gearBonusKey = GEAR_BONUS_MAP[gearName];

  if (!gearBonusKey) {
    return {
      success: false,
      gearName,
      bonus: 0,
      materialsUsed: materialUsage,
      error: 'Unknown gear type',
    };
  }

  const bonusValue = GEAR_BONUS_VALUES[gearName] || 0;

  // 8. 更新生产装备加成
  const updatedGear = { ...currentGear };
  updatedGear[gearBonusKey] = (updatedGear[gearBonusKey] || 0) + bonusValue;

  // 9. 执行数据库更新（材料和装备加成在同一个事务中）
  await execute(
    'UPDATE players SET materials = $1, production_gear = $2, updated_at = NOW() WHERE user_id = $3',
    [JSON.stringify(updatedMaterials), JSON.stringify(updatedGear), userId]
  );

  return {
    success: true,
    gearName,
    bonus: bonusValue,
    materialsUsed: materialUsage,
  };
}

export interface ConsumableCraftingResult {
  success: boolean;
  consumableName: string;
  quantity: number;
  effect: Record<string, any>;
  materialsUsed: Record<string, number>;
  playerConsumableId?: string;
  error?: string;
}

/**
 * 执行消耗品制造
 * @param userId 用户 ID
 * @param recipeId 配方 ID
 * @param quantity 制造数量
 */
export async function executeConsumableCrafting(
  userId: string,
  recipeId: string,
  quantity: number = 1
): Promise<ConsumableCraftingResult> {
  // 1. 获取配方
  const recipe = await getCraftingRecipeById(recipeId);
  if (!recipe) {
    return { success: false, consumableName: '', quantity, effect: {}, materialsUsed: {}, error: 'Recipe not found' };
  }

  // 2. 验证配方类型
  if (recipe.category !== 'consumable') {
    return { success: false, consumableName: '', quantity, effect: {}, materialsUsed: {}, error: 'Recipe is not a consumable recipe' };
  }

  // 3. 获取玩家数据
  const playerResult = await query<{
    id: string;
    materials: Record<string, number>;
  }>('SELECT id, materials FROM players WHERE user_id = $1', [userId]);

  if (playerResult.length === 0) {
    return { success: false, consumableName: '', quantity, effect: {}, materialsUsed: {}, error: 'Player not found' };
  }

  const player = playerResult[0];
  const currentMaterials = player.materials || {};

  // 4. 解析输入材料（可能是单一对象或对象数组）
  const inputMaterials = Array.isArray(recipe.input) ? recipe.input : [recipe.input];

  // 5. 检查每种材料是否足够（每种替代材料只需一种）
  const materialUsage: Record<string, number> = {};
  let hasAllMaterials = true;

  for (const materialSet of inputMaterials) {
    hasAllMaterials = true;
    for (const [material, amount] of Object.entries(materialSet)) {
      const totalRequired = amount * quantity;
      const currentAmount = currentMaterials[material] || 0;
      if (currentAmount < totalRequired) {
        hasAllMaterials = false;
        break;
      }
    }
    if (hasAllMaterials) {
      // 找到足够的材料组合
      for (const [material, amount] of Object.entries(materialSet)) {
        materialUsage[material] = amount * quantity;
      }
      break;
    }
  }

  if (!hasAllMaterials) {
    return {
      success: false,
      consumableName: recipe.name,
      quantity,
      effect: {},
      materialsUsed: {},
      error: 'Insufficient materials',
    };
  }

  // 6. 扣除材料
  const updatedMaterials = { ...currentMaterials };
  for (const [material, amount] of Object.entries(materialUsage)) {
    updatedMaterials[material] = (updatedMaterials[material] || 0) - amount;
  }

  // 7. 获取消耗品输出信息
  const outputInfo = recipe.output as { name: string; quantity: number; effect: Record<string, any> };
  const consumableName = outputInfo.name;
  const effect = outputInfo.effect || {};
  const outputQuantity = (outputInfo.quantity || 1) * quantity;

  // 8. 检查是否已存在相同的消耗品
  const existingResult = await query<{ id: string; quantity: number }>(
    'SELECT id, quantity FROM player_consumables WHERE player_id = $1 AND name = $2',
    [player.id, consumableName]
  );

  let playerConsumableId: string;

  if (existingResult.length > 0) {
    // 更新现有消耗品数量
    playerConsumableId = existingResult[0].id;
    const newQuantity = existingResult[0].quantity + outputQuantity;
    await execute(
      'UPDATE player_consumables SET quantity = $1, created_at = NOW() WHERE id = $2',
      [newQuantity, playerConsumableId]
    );
  } else {
    // 创建新的消耗品记录
    playerConsumableId = uuidv4();
    await execute(
      `INSERT INTO player_consumables (id, player_id, name, effect, quantity, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        playerConsumableId,
        player.id,
        consumableName,
        JSON.stringify(effect),
        outputQuantity,
      ]
    );
  }

  // 9. 更新玩家材料
  await execute(
    'UPDATE players SET materials = $1, updated_at = NOW() WHERE user_id = $2',
    [JSON.stringify(updatedMaterials), userId]
  );

  return {
    success: true,
    consumableName,
    quantity: outputQuantity,
    effect,
    materialsUsed: materialUsage,
    playerConsumableId,
  };
}

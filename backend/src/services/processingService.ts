import { query } from '../config/database';

export interface ProcessingRecipe {
  id: string;
  name: string;
  type: 'smelting' | 'carpentry' | 'grinding';
  input: Record<string, number>;
  output: Record<string, number>;
  efficiency: number;
}

// 内存缓存（5分钟过期）
let recipesCache: {
  data: ProcessingRecipe[];
  timestamp: number;
} | null = null;

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * 从数据库获取所有加工配方（带缓存）
 */
export async function getAllProcessingRecipes(): Promise<ProcessingRecipe[]> {
  const now = Date.now();

  // 检查缓存
  if (recipesCache && (now - recipesCache.timestamp) < CACHE_TTL) {
    return recipesCache.data;
  }

  // 查询数据库
  const result = await query<{
    id: string;
    name: string;
    type: string;
    input: Record<string, number>;
    output: Record<string, number>;
    efficiency: number;
  }>('SELECT id, name, type, input, output, efficiency FROM processing_recipes ORDER BY type');

  const recipes: ProcessingRecipe[] = result.map(row => ({
    id: row.id,
    name: row.name,
    type: row.type as 'smelting' | 'carpentry' | 'grinding',
    input: row.input,
    output: row.output,
    efficiency: Number(row.efficiency),
  }));

  // 更新缓存
  recipesCache = {
    data: recipes,
    timestamp: now,
  };

  return recipes;
}

/**
 * 根据 type 获取单个配方
 */
export async function getProcessingRecipeByType(type: string): Promise<ProcessingRecipe | null> {
  const recipes = await getAllProcessingRecipes();
  return recipes.find(r => r.type === type) || null;
}

/**
 * 根据 ID 获取配方
 */
export async function getProcessingRecipeById(id: string): Promise<ProcessingRecipe | null> {
  const recipes = await getAllProcessingRecipes();
  return recipes.find(r => r.id === id) || null;
}

/**
 * 清除配方缓存（用于测试或配置更新时）
 */
export function clearRecipesCache(): void {
  recipesCache = null;
}

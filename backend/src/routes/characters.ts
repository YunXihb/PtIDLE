import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  createCharacter,
  getCharactersByUserId,
  updateCharacterName,
  assignCardToCharacter,
  removeCardFromCharacter,
  getCharacterDeckCards,
} from '../services/characterService';
import { validate } from '../middleware/validate';
import { createCharacterSchema, updateCharacterNameSchema, deckSchema } from '../validations/characters';
import { ok, fail } from '../utils/http';

const router = Router();

// 获取玩家所有棋子
router.get('/', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const characters = await getCharactersByUserId(userId);

    ok(res, characters);
  } catch (error) {
    next(error);
  }
});

// 创建棋子
router.post('/', authMiddleware, validate(createCharacterSchema), async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const { name, profession } = req.body;

    const result = await createCharacter(userId, name.trim(), profession);

    if (!result.success) {
      if (result.error === 'Player not found') {
        fail(res, 404, result.error);
        return;
      }
      if (result.error?.includes('Maximum character limit')) {
        fail(res, 400, result.error);
        return;
      }
      fail(res, 400, result.error!);
      return;
    }

    ok(res, result.character, 201);
  } catch (error) {
    next(error);
  }
});

// 更新棋子名称
router.put('/:id/name', authMiddleware, validate(updateCharacterNameSchema), async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.userId;
    const characterId = req.params.id;
    const { name } = req.body;

    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    const result = await updateCharacterName(userId, characterId, name.trim());

    if (!result.success) {
      if (result.error === 'Character not found' || result.error === 'Player not found') {
        fail(res, 404, result.error);
        return;
      }
      fail(res, 400, result.error!);
      return;
    }

    ok(res, result.character);
  } catch (error) {
    next(error);
  }
});

// 获取棋子牌库
router.get('/:id/deck', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.userId;
    const characterId = req.params.id;

    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    // 归属校验（防 IDOR）：确认该棋子属于当前登录用户
    const owned = await getCharactersByUserId(userId);
    if (!owned.some((c) => c.id === characterId)) {
      fail(res, 403, 'Forbidden');
      return;
    }

    const cards = await getCharacterDeckCards(characterId);

    ok(res, cards);
  } catch (error) {
    next(error);
  }
});

// 分配或移除卡牌
router.put('/:id/deck', authMiddleware, validate(deckSchema), async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user?.userId;
    const characterId = req.params.id;
    const { cardId, action } = req.body;

    if (!userId) {
      fail(res, 401, 'Unauthorized');
      return;
    }

    let result;
    if (action === 'assign') {
      result = await assignCardToCharacter(userId, characterId, cardId);
    } else {
      result = await removeCardFromCharacter(userId, characterId, cardId);
    }

    if (!result.success) {
      if (result.error === 'Character not found' || result.error === 'Player not found' || result.error === 'Card not found') {
        fail(res, 404, result.error);
        return;
      }
      if (result.error?.includes('already assigned') || result.error?.includes('full') || result.error?.includes('not found in') || result.error?.includes('profession')) {
        fail(res, 400, result.error);
        return;
      }
      fail(res, 400, result.error!);
      return;
    }

    ok(res, { character_deck_id: result.character_deck_id });
  } catch (error) {
    next(error);
  }
});

export default router;

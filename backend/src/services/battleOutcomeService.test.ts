// T052 battleOutcomeService 单元测试
// 总计 18 cases across 4 describe blocks (Tasks 3-6 逐步填充)

import { BASES, BASE_RADIUS, WIN_THRESHOLD } from './battleOutcomeService';

describe('battleOutcomeService - constants', () => {
  it('BASES 包含 (3,3) 和 (6,6) 两个据点', () => {
    expect(BASES).toHaveLength(2);
    expect(BASES[0]).toEqual({ x: 3, y: 3, key: '3,3' });
    expect(BASES[1]).toEqual({ x: 6, y: 6, key: '6,6' });
  });

  it('BASE_RADIUS = 2', () => {
    expect(BASE_RADIUS).toBe(2);
  });

  it('WIN_THRESHOLD = 6', () => {
    expect(WIN_THRESHOLD).toBe(6);
  });
});

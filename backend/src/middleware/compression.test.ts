// T082: HTTP 响应压缩中间件测试
// 验证 compression() 挂载后，对足够大的 JSON 响应按 Accept-Encoding 协商 gzip 压缩。
// 复刻 index.ts 的挂载方式（app.use(compression())），锁定期望行为防回归。
import request from 'supertest';
import express from 'express';
import compression from 'compression';

describe('HTTP compression middleware (T082)', () => {
  // 构造与 index.ts 一致的最小 app：compression 在 express.json 之后挂载
  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use(compression());
    // compression 默认阈值 1KB，响应体需 > 1KB 才会压缩
    app.get('/api/payload', (_req, res) => {
      res.json({ data: 'x'.repeat(2000) });
    });
    return app;
  };

  it('should gzip JSON response when Accept-Encoding: gzip', async () => {
    const response = await request(buildApp())
      .get('/api/payload')
      .set('Accept-Encoding', 'gzip');

    expect(response.status).toBe(200);
    expect(response.headers['content-encoding']).toBe('gzip');
  });

  it('should not compress when client sends Accept-Encoding: identity', async () => {
    const response = await request(buildApp())
      .get('/api/payload')
      .set('Accept-Encoding', 'identity');

    expect(response.status).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
  });
});

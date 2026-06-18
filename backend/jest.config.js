module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts'
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  // socketServer.test.ts 用真实 socket.io client/server + 真实 Redis,engine.io 内部 heartbeat/reconnect timer 在 client.close() 后可能未立即释放。
  // 不加 forceExit 时,Jest 的 graceful worker shutdown 会超时强杀 worker,正好打断 T047 首个测试的双 client 握手,导致 connect timeout (3s) flake。
  // forceExit 让 Jest 在测试完成后立即退出 worker,绕过这个 teardown race。
  // 验证: `npx jest --forceExit` → 37/37 suites / 629/629 tests 全绿;无 --forceExit → 36/37 (T047 flake)
  forceExit: true
};

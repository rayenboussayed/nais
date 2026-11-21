import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Shared mock handles; `vi.hoisted` makes them available inside hoisted `vi.mock` factories. */
const m = vi.hoisted(() => ({
  appGet: vi.fn(),
  configGet: vi.fn(),
  configureApp: vi.fn(),
  consoleLogger: vi.fn(),
  create: vi.fn(),
  error: vi.fn(),
  fastifyAdapter: vi.fn(),
  getOtelSdk: vi.fn(),
  listen: vi.fn(),
  log: vi.fn(),
  otelStart: vi.fn(),
  resolveTrustProxy: vi.fn(),
  validateEnv: vi.fn(),
}));

vi.mock('@nestjs/core', () => ({ NestFactory: { create: m.create } }));
vi.mock('@nestjs/config', () => ({ ConfigService: class {} }));
vi.mock('@nestjs/common', () => ({
  ConsoleLogger: m.consoleLogger,
  Logger: { error: m.error, log: m.log },
}));
vi.mock('@nestjs/platform-fastify', () => ({ FastifyAdapter: m.fastifyAdapter }));
vi.mock('./app.module.js', () => ({ AppModule: class {} }));
vi.mock('./app.tracing.js', () => ({ getOtelSdk: m.getOtelSdk }));
vi.mock('./bootstrap.js', () => ({ configureApp: m.configureApp }));
vi.mock('./configs/fastify.js', () => ({ resolveTrustProxy: m.resolveTrustProxy }));
vi.mock('./environment.js', () => ({ validateEnv: m.validateEnv }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bootstrap (main.ts)', () => {
  it('starts OTel, creates the app with resolved adapter options and listens on all interfaces', async () => {
    const env = { NODE_ENV: 'production', TRUST_PROXY: 'loopback' };
    m.validateEnv.mockReturnValue(env);
    m.resolveTrustProxy.mockReturnValue('loopback-sentinel');
    m.getOtelSdk.mockReturnValue({ start: m.otelStart });

    const config = { get: m.configGet };
    m.configGet.mockReturnValue(4001);
    const app = {
      get: m.appGet.mockReturnValue(config),
      listen: m.listen.mockResolvedValue(undefined),
    };
    m.create.mockResolvedValue(app);
    m.configureApp.mockResolvedValue(undefined);

    await import('./main.js');
    await vi.waitFor(() => expect(m.listen).toHaveBeenCalledOnce());

    expect(m.validateEnv).toHaveBeenCalledWith(process.env);
    expect(m.otelStart).toHaveBeenCalledOnce();
    expect(m.resolveTrustProxy).toHaveBeenCalledWith('loopback');
    expect(m.fastifyAdapter).toHaveBeenCalledWith({
      bodyLimit: 262_144,
      trustProxy: 'loopback-sentinel',
    });
    expect(m.create).toHaveBeenCalledOnce();
    const call = m.create.mock.calls[0];
    if (!call) throw new Error('NestFactory.create was not called');
    const [, adapter, options] = call;
    expect(adapter).toBeInstanceOf(m.fastifyAdapter);
    expect(options).toEqual({ logger: expect.anything() });
    expect(m.consoleLogger).toHaveBeenCalledWith({ json: true });
    expect(m.configureApp).toHaveBeenCalledWith(app);
    expect(m.appGet).toHaveBeenCalled();
    expect(m.configGet).toHaveBeenCalledWith('PORT', { infer: true });
    expect(m.listen).toHaveBeenCalledWith(4001, '0.0.0.0');
    expect(m.log).toHaveBeenCalledWith('listening on 0.0.0.0:4001/api', 'Bootstrap');
  });

  it('logs the message and exits non-zero when boot rejects with an Error', async () => {
    m.validateEnv.mockReturnValue({ NODE_ENV: 'development', TRUST_PROXY: 'false' });
    m.resolveTrustProxy.mockReturnValue(false);
    m.getOtelSdk.mockReturnValue(undefined);
    m.create.mockRejectedValue(new Error('pg-boss exploded'));

    await import('./main.js');
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));

    expect(m.consoleLogger).toHaveBeenCalledWith({ json: false });
    expect(m.error).toHaveBeenCalledWith('pg-boss exploded', 'Bootstrap');
    expect(m.configureApp).not.toHaveBeenCalled();
    expect(m.listen).not.toHaveBeenCalled();
  });

  it('stringifies a non-Error boot failure before exiting', async () => {
    m.validateEnv.mockReturnValue({ NODE_ENV: 'test', TRUST_PROXY: 'true' });
    m.resolveTrustProxy.mockReturnValue(true);
    m.getOtelSdk.mockReturnValue(undefined);
    m.create.mockRejectedValue('string failure');

    await import('./main.js');
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1));

    expect(m.error).toHaveBeenCalledWith('string failure', 'Bootstrap');
    expect(m.consoleLogger).toHaveBeenCalledWith({ json: false });
  });
});

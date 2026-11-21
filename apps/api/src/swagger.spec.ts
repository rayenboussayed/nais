import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { FastifyAdapter } from '@nestjs/platform-fastify';
import { SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setupSwagger } from './swagger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setupSwagger', () => {
  it('registers the docs UI and JSON route with a working document factory', async () => {
    const moduleRef = await Test.createTestingModule({}).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    const setup = vi.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);

    try {
      setupSwagger(app);

      expect(setup).toHaveBeenCalledOnce();
      const call = setup.mock.calls[0];
      if (!call) throw new Error('setupSwagger did not delegate to SwaggerModule.setup');
      const [path, target, factory, options] = call;

      expect(path).toBe('api/docs');
      expect(target).toBe(app);
      expect(options).toMatchObject({
        jsonDocumentUrl: 'api/docs-json',
        swaggerOptions: { persistAuthorization: false },
      });

      if (typeof factory !== 'function') throw new Error('expected a document factory');
      const document = factory();
      expect(document.info.title).toBe('trainslator');
      expect(document.info.version).toBe('0.1.0');
    } finally {
      await app.close();
    }
  });
});

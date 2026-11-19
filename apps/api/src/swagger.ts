import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Serves Swagger UI and the JSON document under /api/docs (and
 * /api/docs-json). Called by the bootstrap and by integration specs so both
 * paths serve identical routes. Both endpoints sit behind the onRequest
 * auth hook.
 */
export function setupSwagger(app: NestFastifyApplication): void {
  const docConfig = new DocumentBuilder()
    .setTitle('trainslator')
    .setDescription('Standalone AI translation service: cached, model-backed, admin-editable')
    .setVersion('0.1.0')
    .addBasicAuth({ type: 'http', scheme: 'basic', name: 'trainslator' })
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, docConfig);
  SwaggerModule.setup('api/docs', app, documentFactory, {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: false },
  });
}

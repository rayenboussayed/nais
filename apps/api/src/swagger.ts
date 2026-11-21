import type { INestApplication } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { applyDecorators } from '@nestjs/common';
import { ApiResponse, DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

import { apiErrorSchema } from './schemas/errors.js';

/**
 * Documents the shared 4xx and 5xx error envelope on a controller.
 * Class-level Standard Schema metadata survives document generation.
 * @returns a class decorator applying both error responses
 */
export function ApiErrorResponses(): ClassDecorator {
  return applyDecorators(
    ApiResponse({ standardSchema: apiErrorSchema, status: '4XX' }),
    ApiResponse({ standardSchema: apiErrorSchema, status: '5XX' }),
  );
}

/**
 * Builds the OpenAPI metadata shared by the served document and the golden
 * fixture generator. Pure: reads no application or environment state.
 * @returns the DocumentBuilder configuration
 */
export function buildDocConfig(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
    .setTitle('trainslator')
    .setDescription('Standalone AI translation service: cached, model-backed, admin-editable')
    .setVersion('0.1.0')
    .addBasicAuth({ name: 'trainslator', scheme: 'basic', type: 'http' })
    .build();
}

/**
 * Creates the OpenAPI document from controller metadata alone.
 * @param app - a Nest application whose controllers are registered
 * @returns the generated OpenAPI document
 */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(app, buildDocConfig());
}

/**
 * Serves Swagger UI and the JSON document under /api/docs (and
 * /api/docs-json). Called by the bootstrap and by integration specs so both
 * paths serve identical routes. Both endpoints sit behind the onRequest
 * auth hook.
 * @param app - the Nest application to serve Swagger on
 */
export function setupSwagger(app: NestFastifyApplication): void {
  const documentFactory = () => createOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, documentFactory, {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: false },
  });
}

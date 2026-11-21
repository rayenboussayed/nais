import type { ZodType } from 'zod';

import { applyDecorators } from '@nestjs/common';
import { RouteSchema } from '@nestjs/platform-fastify';
import { ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Documents a response with Standard Schema and registers a Fastify serializer from the same contract.
 *
 * Swagger keeps reading the zod object so the generated OpenAPI document stays byte identical.
 * Fastify receives a draft-07 JSON Schema that it compiles once into a response serializer for
 * the given status. Schemas carrying `format: unsafe`, a remote `$ref` or a remote `$id` are
 * refused because the serializer treats its schema as trusted application code.
 * @param schema - the zod contract describing the response body for the status
 * @param status - the HTTP status code the response schema applies to
 * @returns a method decorator applying both the Swagger and the Fastify response metadata
 * @example
 * ```ts
 * class AuthController {
 *   @ApiResponseSchema(loginResponseSchema, HttpStatus.OK)
 *   login(): { username: string } {
 *     return { username: 'alice' };
 *   }
 * }
 * ```
 */
export function ApiResponseSchema(schema: ZodType, status: number): MethodDecorator {
  const jsonSchema = z.toJSONSchema(schema, { io: 'output', target: 'draft-07' });
  assertSafeSchema(jsonSchema);
  return applyDecorators(
    ApiResponse({ standardSchema: schema, status }),
    RouteSchema({ response: { [status]: jsonSchema } }),
  );
}

/**
 * Recursively refuses JSON Schema nodes that could make the serializer execute unsafe behavior.
 * @param node - the JSON Schema value to inspect, traversed through objects and arrays
 * @throws if the value declares the unsafe format, a remote reference or a remote id
 */
function assertSafeSchema(node: unknown): void {
  if (!isRecord(node)) {
    if (Array.isArray(node)) {
      for (const item of node) {
        assertSafeSchema(item);
      }
    }
    return;
  }
  if (node['format'] === 'unsafe') {
    throw new Error('Response schema must not use format unsafe');
  }
  const ref = node['$ref'];
  if (typeof ref === 'string' && !ref.startsWith('#')) {
    throw new Error('Response schema must not use remote refs');
  }
  const id = node['$id'];
  if (typeof id === 'string' && !id.startsWith('#')) {
    throw new Error('Response schema must not use remote $id');
  }
  for (const value of Object.values(node)) {
    assertSafeSchema(value);
  }
}

/**
 * Narrows an unknown JSON Schema value to a record, excluding arrays and null.
 * @param node - the value to test
 * @returns true when the value is a non-null, non-array object
 */
function isRecord(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

# packages/shared (`@trainslator/shared`)

The single source of truth for the wire contracts between the API and the web
app: **zod v4 schemas**, from which everything else is derived — `z.infer` for
DTOs, the Swagger document via `@nestjs/swagger`'s native Standard Schema
support, and the client-side types in the web bundle.

Depends on `zod` only (plus `@trainslator/shared` consumers' choice of
transport). No runtime other than Node.

## Contents

| Module                                              | What it carries                                                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `common.ts`                                         | LIKE/ILIKE escaping, NFC normalization, canonical JSON, cursor schemas and `keysetListSchema` helpers                      |
| `errors.ts`                                         | Error body contract                                                                                                        |
| `languages.ts`, `translations.ts`, `ai-messages.ts` | Row/create/update/list contracts per resource                                                                              |
| `translations.ts`                                   | `translate` request/response, catalogue key shape                                                                          |
| `auth.ts`                                           | Login request/response, session cookie contract                                                                            |
| `ai.ts`                                             | Task registry contracts — `AiTask`, per-task request/result schemas, WS ack, job payloads, `GET /api/ai/tasks` descriptors |
| `list.ts`                                           | `keysetListSchema` / `KeysetList<T>` envelope                                                                              |
| `enums.ts`, `common.ts`                             | Shared enums (namespaces, statuses)                                                                                        |
| `index.ts`                                          | Re-exports                                                                                                                 |

## Usage

```ts
import { translateRequestSchema, type TranslateRequest } from '@trainslator/shared';

const parsed = translateRequestSchema.parse(input); // runtime validation
const dto: TranslateRequest = parsed; // compile-time type
```

## Consuming from ESM and CJS

This package ships **CommonJS on purpose** (dual-consumer: the API is native
ESM, the web bundle is bundler-style ESM). Named imports from ESM work because
Node's cjs-module-lexer detects the `exports.x = …` assignments tsc emits —
verified, not assumed. Do not switch the format without a migration plan for
both consumers, and do not re-export across the two contracts.

## Rules

- Every shared schema must typecheck under `NodeNext` strict, no `any`.
- Optional props keep explicit `| undefined` on the type (the object types
  here are spread with `z.infer` output; exactOptionalPropertyTypes requires
  it). Don't "simplify" them — the lint rule is suppressed inline with a
  reason, never removed.
- New wire shapes are added here first, then consumed by both sides; never
  hand-duplicate a contract in either app.
- After editing, rebuild before typechecking the API
  (`npm run build -w packages/shared`).

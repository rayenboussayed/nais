# AGENTS.md — `@trainslator/shared`

Refines the repo-root `AGENTS.md`. Read that first.

## Hard-won lessons (this workspace)

1. **CJS on purpose.** The API is native ESM; the web app bundles ESM. Node's
   cjs-module-lexer detects `exports.foo = ` assignments from tsc, so named
   ESM imports work against this package's `dist/` (verified live). Do not
   emit ESM here or hand-edit the build outputs.
2. **zod v4 + Standard Schema is the Swagger path.** `@nestjs/swagger` 12
   (with Zod ≥ 4.2) consumes Standard Schema natively; DTOs get their runtime
   validation, their compile-time type and their OpenAPI schema from one
   declaration. Never decorate controllers with hand-written DTO classes.
3. **`z.infer` is the one source of truth** for request/response shapes;
   `$inferSelect` (drizzle) is the one source for row shapes. Keep them
   separate.
4. **Optional props keep explicit `| undefined`** — `cursorPairRefine` spreads
   `z.infer` output into plain objects; `exactOptionalPropertyTypes` demands
   it, and `sonarjs/no-redundant-optional` is suppressed inline with that
   reason. Suppress, never remove.
5. **NFC normalization is load-bearing** — `nfcNormalize` + sha512 keys mean
   canonical-equivalent text hits the same translation cache row. Any new key
   derivation must normalize the same way.
6. **`cursorPairRefine` enforces the pair rule** (both `lastId` and
   `lastCreatedAt`, or neither); the API's pagination services rely on it to
   never silently restart a cursor.
7. **Build order is enforced by the root build script**: shared builds first,
   then workspaces. Editing shared without rebuilding breaks consumers with
   stale-type errors.
8. **The contracts are the API documentation.** Change a schema, and both the
   runtime validation and the published OpenAPI document change with it;
   `docs/ai-v1.md`, the README API table and the `docs-json` golden test are
   all derived from these.

## Commands

`npm run build` (tsc), `npm run typecheck` from this directory or from the
repo root with `-w @trainslator/shared`. Tests live beside the sources and
run from the repo root.

## Invariants — do not break

- `zod` stays the only runtime dependency (repo-wide `overrides` pin it).
- No `any`; exact shapes, never widened unions.
- Every exported symbol typechecks under `NodeNext` and `skipLibCheck: false`
  on consumers' terms — the package builds once and is consumed by both
  worlds, so the lowest common denominator wins.
- LIKE-escaping and cursor helpers in `common.ts` are security-relevant:
  LIKE-injected search terms are the only raw user input that reaches SQL
  fragments; do not add helpers that bypass them.

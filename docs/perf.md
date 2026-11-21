# Performance notes

Captured 2026-11-18 on a throwaway PostgreSQL 17 cluster (initdb, unix sockets) seeded via `npm run db:seed` (184 languages) and 20,000 synthetic dynamic translations for one language.

Reproduce: boot a scratch cluster, run `npm run db:migrate && npm run db:seed`, then the statements below with `EXPLAIN (ANALYZE, BUFFERS)`.

## Hot path: translation cache lookup by (language_id, key)

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT text FROM translations
WHERE language_id = '<uuid>' AND key = 'bench-1000' AND deleted_at IS NULL;
```

```text
Index Scan using translations_language_key_unique on translations  (cost=0.41..8.43 rows=1 width=82) (actual time=0.020..0.021 rows=1 loops=1)
  Index Cond: ((language_id = '...'::uuid) AND ((key)::text = 'bench-15000'::text))
  Buffers: shared hit=4
Planning Time: 0.263 ms
Execution Time: 0.040 ms
```

`translations_language_key_unique` is a partial index (`WHERE deleted_at IS NULL`),
so the lookup must include the soft-delete predicate to use it; the service
does exactly that.

`translations_language_key_unique` serves the lookup; no heap visits needed for the text column at this row width.

## Admin list: newest dynamic translations for one language

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT id, key, text FROM translations
WHERE language_id = '<uuid>' AND namespace = 'dynamic' AND deleted_at IS NULL
ORDER BY created_at DESC LIMIT 25;
```

```text
Limit  (cost=0.29..2.22 rows=25 width=117) (actual time=0.017..0.037 rows=25 loops=1)
  ->  Index Scan Backward using translations_language_namespace_created_idx on translations  (cost=0.29..1549.29 rows=20000 width=117) (actual time=0.016..0.032 rows=25 loops=1)
        Index Cond: ((language_id = '...'::uuid) AND (namespace = 'dynamic'::translation_namespace))
        Filter: (deleted_at IS NULL)
```

The composite `(language_id, namespace, created_at)` index serves the keyset listing without a separate sort.

## AI messages: newest entries

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT id, status, model, response FROM ai_messages
WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 25;
```

On an empty table the planner prefers a seq scan + sort; `ai_messages_created_idx` takes over as the table grows. Re-measure after seeding real audit rows.

## Seeding

184-row upsert in two multi-row statements (<100ms observed); INSERT ... ON CONFLICT with `source` set semantics verified by integration tests (idempotent across runs).

## Microbenchmarks

`npm run test:perf` runs the `vitest bench` suites (`apps/api/bench/common.bench.ts`,
`hot-paths.bench.ts` and `language-cache.bench.ts`): translation-key hashing,
LIKE escaping, keyset cursor building, changed-fields, inflight dedup, the rate
limiter, canonicalization, pipeline caching and the language memoizer. The recorded baseline lives in
`docs/perf-baseline.json`. The baseline is a generated artifact: refresh it
only with that documented command (`npx vitest bench --reporter=json
--outputFile=docs/perf-baseline.json`) and never hand-edit the JSON. It records
all bench files (`common`, `hot-paths` and `language-cache`); a stale baseline
is a drift to fix by regeneration, not by editing numbers or adding hard
performance thresholds.

## Serializer and parser ledger (2026-11-21)

The gate compares real `app.inject()` responses through
`apps/api/bench/serializer.bench.ts`. Each route pair returns byte-identical
bodies, and the equality assertions live in setup, outside the timed loops, so
verification does not distort throughput. Production runs Node 24, so the Node
24 numbers decide the gate; local Node 26 is recorded for context only.

| Experiment                                        | Baseline                  | Candidate                              | Result                                       | Decision     |
| ------------------------------------------------- | ------------------------- | -------------------------------------- | -------------------------------------------- | ------------ |
| Login response, Node 24                           | 0.1051ms (no schema)      | 0.0636ms (zod-derived draft-07 schema) | 1.65x faster                                 | Kept         |
| Bulk 20-row list with undeclared columns, Node 24 | 0.2457ms (no schema)      | 0.1840ms (schema drops extra fields)   | 1.34x faster                                 | Kept         |
| Zod parse, Node 24                                | 0.0017ms (runtime parser) | 0.0010ms (compiled)                    | about 1.7x faster                            | Kept         |
| Login response, Node 26 local                     | 0.0994ms (no schema)      | 0.0790ms (schema)                      | 1.26x faster                                 | Context only |
| Bulk 20-row list, Node 26 local                   | 0.1944ms (no schema)      | 0.1986ms (schema)                      | within measurement noise but slightly slower | Context only |

All existing benchmarks showed no regression, with a worst ratio of 1.00x
against the locally captured baseline.

The response-schema routes win on both Node 24 measurements, clearing the 5
percent margin required to ship them. Response schemas now derive from the
same zod contracts that feed Swagger, for every route that previously declared
a response contract, and the regenerated OpenAPI golden document is byte
identical. Request bodies already
came from those same contracts through `@Body({ schema })` and the Standard
Schema converter, so a second hand-written JSON Schema copy was proposed and
reverted. Fastify 5 already bundles fast-json-stringify 7.3.6, so a direct
dependency was also proposed and reverted; a direct import would be unused,
since the bundled copy is already available.

The correct compile import is `import "zod/compile"`. Zod 4.6.7 has no
`zod/compiler` export. Compilation is lazy on first parse, so the gain is in
validation, not in stringification.

These measurements were taken in an environment without PostgreSQL binaries,
where integration and e2e specs fail or skip and coverage and `npm test` fail
at baseline; those limits are pre-existing and were not fixed.

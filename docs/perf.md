# Performance notes

Captured 2026-11-18 on a throwaway PostgreSQL 17 cluster (initdb, unix sockets) seeded via `npm run db:seed` (184 languages) and 20,000 synthetic dynamic translations for one language.

Reproduce: boot a scratch cluster, run `npm run db:migrate && npm run db:seed`, then the statements below with `EXPLAIN (ANALYZE, BUFFERS)`.

## Hot path: translation cache lookup by (language_id, key)

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT text FROM translations
WHERE language_id = '<uuid>' AND key = 'bench-15000';
```

```
Index Scan using translations_language_key_unique on translations  (cost=0.41..8.43 rows=1 width=82) (actual time=0.020..0.021 rows=1 loops=1)
  Index Cond: ((language_id = '...'::uuid) AND ((key)::text = 'bench-15000'::text))
  Buffers: shared hit=4
Planning Time: 0.263 ms
Execution Time: 0.040 ms
```

`translations_language_key_unique` serves the lookup; no heap visits needed for the text column at this row width.

## Admin list: newest dynamic translations for one language

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT id, key, text FROM translations
WHERE language_id = '<uuid>' AND namespace = 'dynamic' AND deleted_at IS NULL
ORDER BY created_at DESC LIMIT 25;
```

```
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

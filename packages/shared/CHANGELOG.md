# Changelog

All notable changes to `@trainslator/shared` are documented here. No tagged
releases yet. Dates are UTC, from the commit history (2026-11-18 .. 2026-11-19).

## Unreleased

### Added

- Initial zod contract set: language/translation/ai-messages row, create and
  update schemas; `z.infer` DTOs; keyset list envelope (`list.ts`,
  `languages.ts`, `translations.ts`, `ai-messages.ts`, `common.ts`) (`3be6897`).
- `translate` request/response contracts and the WS ack contract (200 / 202 /
  400 / 404 / 429 / 500) plus job payload schema (`d107f3b`).
- AI service contracts (`ai.ts`): `AiTask`, per-task request/result schemas
  for `sentiment`, `summarize`, `question-answering`, `token-classification`,
  `zero-shot-classification`, `feature-extraction`; `GET /api/ai/tasks`
  descriptor schema; envelope and error contracts (`225cff9`).
- Cursor microsecond-precision timestamp schema and `cursorPairRefine`
  (pair-or-neither rule) (`c38ae1d`).

### Changed

- Prettier line wrapping and knip hygiene (`5be2550`, `0e5d157`).
- Strict flat-config ESLint stack adopted; JSDoc coverage completed
  (`3ec2125`).
- `engines` declared (`node >=24.0.0`, `npm >=11.0.0`) (`3ec2125`).

### Notes

- The package stays CommonJS on purpose (dual consumer). See `README.md`.

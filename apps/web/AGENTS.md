# AGENTS.md — `@trainslator/web`

Refines the repo-root `AGENTS.md`. Read that first. This document holds only
what is specific to `apps/web`.

## Hard-won lessons (this workspace)

1. **`routeTree.gen.ts` is generated.** TanStack Router's plugin rewrites it on
   dev/build. Never hand-edit, never search-replace it; change `src/routes/`
   and let the plugin regenerate.
2. **Rolldown-vite + JSX = no v8 coverage.** The `.tsx` coverage exclusion is
   deliberate (upstream vitest#10475). jsdom behavior tests are the assertion
   mechanism; keep them meaningful, do not paper over regressions with
   snapshot bloat.
3. **jsdom tests need `// @vitest-environment jsdom`** at the top of the file
   (see `translate-socket.test.ts`).
4. **The socket client is lazy and shared.** `lib/translate-socket.ts` reuses
   one socket; `io(url, { auth?... })` — the server authenticates the
   handshake from the session cookie, never from credentials on the wire.
5. **`Modal` is a native `<dialog open>`**, with the UA chrome reset in
   `styles/styles.css` (`.modal-backdrop`). Keep it semantic.
6. **Browser globals are linted with browser scope** (config-scoped, not
   globally enabled); `navigator.clipboard` carries an inline lint
   justification — browser global, not Node's experimental one.
7. **Admin pages share `AdminBits.tsx`** (`AdminSearch`, `Pagination`,
   `Modal`). Add new admin surfaces with these, not new ad-hoc markup.
8. **Studio consumes the same contracts as the API** — `GET /api/ai/tasks`
   descriptors are re-parsed with the shared zod schema before rendering, and
   a static fallback list ships so Studio still boots when the endpoint is
   unreachable (by design — keep the fallback).
9. **Error rendering must not trust the wire.** `ApiError` carries a safe,
   constant message; response bodies are parsed with shared zod schemas or
   ignored.
10. **Login is a passwordless-ceremony or nothing at all** — no "remember me"
    state in JS; the cookie is HttpOnly and invisible to this app on purpose.

## Commands

`dev`, `build`, `preview`, `typecheck` from the root with
`-w @trainslator/web` or from this directory. Tests run from the repo root
(`npm test`).

## Invariants — do not break

- No secrets in the bundle; the session cookie is the only credential, and it
  is HttpOnly. Anything readable from JS is already public.
- Telemetry stays build-time opt-in: no OTEL code may run unless
  `VITE_OTEL_ENDPOINT` is set at build, and `main.tsx` keeps the dynamic
  import behind that check (never a static import).
- `.tsx` stays out of the coverage gate; behavior lives in jsdom tests.
- `fetch` calls go through `lib/api.ts` (`ApiError`); never raw `fetch` from
  components.
- No new CSS framework; extend `src/styles/styles.css` with tokens.

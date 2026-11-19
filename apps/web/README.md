# apps/web (`@trainslator/web`)

The trainslator console: React 19 + Vite (Rolldown) with TanStack
Router/Query. Three experiences behind the session cookie:

| Route     | What it is                                                                               |
| --------- | ---------------------------------------------------------------------------------------- |
| `/`       | Playground — type into one side, get a translation back (REST + WebSocket).              |
| `/login`  | Session login (`POST /api/auth/login`); the cookie is HttpOnly, SameSite=Lax.            |
| `/studio` | AI console for every task in `GET /api/ai/tasks` — dedicated pipelines (ONNX) or Ollama. |
| `/admin`  | Admin console — languages catalogue, translations, AI message audit (soft-delete).       |

Repo-wide setup, auth and Docker live in the [root README](../../README.md).

## Commands

From the repo root with `-w @trainslator/web`, or from this directory. There
is no `test` script here by design: all tests, including the jsdom component
tests, run from the root (`npm test`).

```bash
npm run dev        # vite dev server (proxies /api and /socket.io — see vite.config.ts)
npm run build      # tsc --noEmit && vite build
npm run typecheck  # tsc --noEmit
npm run preview    # serve the built app
```

The dev proxy defaults to `http://localhost:3000` (the local API); override
with `VITE_API_PROXY_TARGET`.

## Layout

- `src/routes/` — file routes (`/`, `/login`, `/studio`, `/admin/*`); the
  generated route tree is `src/routeTree.gen.ts` — never hand-edited (the
  TanStack Router plugin regenerates it).
- `src/components/` — shared console building blocks (`AdminBits.tsx`:
  `AdminSearch`, `Pagination`, `Modal`).
- `src/lib/` — API client (`api.ts`, throws `ApiError`), shared socket
  client (`translate-socket.ts`, lazy), session probe, task registry hook,
  browser OpenTelemetry (`telemetry.ts`, only loaded when configured — see
  below).
- `src/styles/styles.css` — the plain-CSS design system with tokens
  (`var(--panel)`, `var(--panel-border)`…); no framework.

## Observability

Browser telemetry is **opt-in at build time**: without the env var,
`src/lib/telemetry.ts` is never imported — `main.tsx` loads it dynamically
behind `if (import.meta.env.VITE_OTEL_ENDPOINT)`, the branch is dead and
no OTEL code is even emitted into the bundle. Build with:

```bash
VITE_OTEL_ENDPOINT=http://localhost:4318 npm run build -w @trainslator/web
```

`VITE_OTEL_ENDPOINT` is the OTLP/HTTP base URL (no `/v1/traces` suffix — it
is appended). When set, the app auto-instruments `fetch` (REST calls), keeps
context across async boundaries (`ZoneContextManager`), propagates W3C
trace-context headers, and flushes spans on tab hide
(`visibilitychange` → `forceFlush`). Resource: `service.name` is
`trainslator-web`; `deployment.environment.name` is `production`/`development`
from `import.meta.env.PROD`. Socket.io traffic is not auto-instrumented.

The collector must allow cross-origin OTLP/HTTP from the web origin (or put
one behind a same-origin reverse proxy). No collector ships in the compose
files; production points at the operator-provided backend.

## Testing

Component behavior is asserted with jsdom + `@testing-library/react`
(`*.test.tsx`). V8 coverage cannot map rolldown-compiled JSX (upstream
vitest#10475), so `.tsx` files are excluded from the coverage gate — see
`AGENTS.md` item 6 in the repo root. Do not try to add coverage plumbing for
JSX; extend the jsdom tests instead.

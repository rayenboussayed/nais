import { defineConfig } from 'drizzle-kit';

// generate does not need a live database, but migrate/push/pull/studio do.
// Fail loudly rather than hit a surprising default host when one is attempted.
const connectingCommand = process.argv.some((arg) =>
  ['check', 'migrate', 'pull', 'push', 'studio'].includes(arg),
);
if (connectingCommand && !process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL must be set for drizzle-kit commands that connect (migrate/push/pull/studio/check)',
  );
}

export default defineConfig({
  // Only used by drizzle-kit commands (generate/migrate/studio); the API
  // itself builds its pool from the parsed env (see drizzle.module.ts).
  dbCredentials: {
    url:
      // eslint-disable-next-line deslint/no-hardcoded-localhost -- local dev default for `drizzle-kit`; overridden by DATABASE_URL
      process.env.DATABASE_URL ?? 'postgresql://trainslator:change-me@localhost:5432/trainslator',
  },
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/db/schema.ts',
});

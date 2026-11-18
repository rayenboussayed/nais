import { defineConfig } from 'drizzle-kit';

// generate does not need a live database, but migrate/push/pull/studio do.
// Fail loudly rather than hit a surprising default host when one is attempted.
const connectingCommand = process.argv.some((arg) =>
  ['migrate', 'push', 'pull', 'studio', 'check'].includes(arg),
);
if (connectingCommand && !process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL must be set for drizzle-kit commands that connect (migrate/push/pull/studio/check)',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  // Only used by drizzle-kit commands (generate/migrate/studio); the API
  // itself builds its pool from the parsed env (see drizzle.module.ts).
  dbCredentials: {
    url:
      process.env.DATABASE_URL ?? 'postgresql://trainslator:change-me@localhost:5432/trainslator',
  },
});

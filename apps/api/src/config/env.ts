import { z } from 'zod';
import { parse as parsePgConnectionString } from 'pg-connection-string';

/**
 * Validates DATABASE_URL against the two shapes accepted by the pg driver: a
 * `postgresql://` URL with a host (or a unix-socket `host` query parameter)
 * or a libpq key=value DSN. WHATWG URL validation would reject the socket
 * form, so the check mirrors the driver instead.
 */
const pgConnectionStringSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    if (/^postgres(ql)?:\/\//i.test(value)) {
      try {
        const parsed = parsePgConnectionString(value);
        return Boolean(parsed.host) && Boolean(parsed.database);
      } catch {
        return false;
      }
    }
    return /host=/i.test(value);
  }, 'Expected a PostgreSQL connection string (postgresql://... or libpq key=value)');

/**
 * Environment schema for the whole service. Parsed once at boot by
 * {@link validateEnv}; every consumer reads the parsed `Env` type, never raw
 * `process.env`. New variables must be added here (with a safe default for
 * development) instead of being read ad hoc.
 */
const envSchema = z
  .object({
    /** `development` enables nothing unsafe by itself; logging stays minimal in all modes. */
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    /** Required everywhere; no silent default — a wrong-host connection is worse than a boot error. */
    DATABASE_URL: pgConnectionStringSchema,
    /** pg-boss gets its own connection string; defaults to DATABASE_URL when unset. */
    PG_BOSS_URL: pgConnectionStringSchema.optional(),
    /** Milliseconds a model call may take before it is abandoned; retried once. */
    OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(100).default(60_000),
    OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
    OLLAMA_TEXT_MODEL: z.string().trim().min(1).default('bonsai-2:2b'),
    BASIC_AUTH_USERNAME: z.string().trim().min(1).default('admin'),
    /** scrypt hash, format `scrypt$N$r$p$saltHex$hashHex`; required in production. */
    BASIC_AUTH_PASSWORD_HASH: z.string().trim().min(1).optional(),
    /** 64+ random hex chars; required in production. Used to sign session cookies. */
    SESSION_SECRET: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'Expected 64 lowercase hex chars (openssl rand -hex 32)')
      .optional(),
    /** Client IP behind a proxy: 'loopback' for same-host reverse proxy, true to trust all, false to ignore forwarded-for. */
    TRUST_PROXY: z.enum(['true', 'false', 'loopback']).default('loopback'),
    /** Extra allowed browser origins for WS/HTTP, comma separated; same-origin when empty. */
    CORS_ORIGINS: z.string().trim().optional(),
    /** Default rate limit per minute per client IP, applied globally. */
    THROTTLE_LIMIT: z.coerce.number().int().min(1).default(100),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (!env.BASIC_AUTH_PASSWORD_HASH) {
      ctx.addIssue({
        code: 'custom',
        path: ['BASIC_AUTH_PASSWORD_HASH'],
        message: 'Required in production (generate with `npm run auth:hash`)',
      });
    } else if (
      !/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/.test(env.BASIC_AUTH_PASSWORD_HASH)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['BASIC_AUTH_PASSWORD_HASH'],
        message: 'Expected a scrypt$N$r$p$saltHex$hashHex hash',
      });
    }
    if (!env.SESSION_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'Required in production; generate with `openssl rand -hex 32`',
      });
    }
  })
  // pg-boss defaults to the main database connection when its own is unset.
  .transform((env) => ({ ...env, PG_BOSS_URL: env.PG_BOSS_URL ?? env.DATABASE_URL }));

export type Env = z.infer<typeof envSchema>;

/**
 * Validates and normalizes raw process env.
 *
 * @param raw - typically `process.env`
 * @returns the parsed environment
 * @throws Error with a semicolon-separated list of issues when invalid; callers fail the boot on it
 */
export function validateEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse({ ...raw });
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}

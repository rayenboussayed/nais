import { eq } from 'drizzle-orm';

import type { Database } from '../db/drizzle.module.js';

import { aiMessages } from '../db/schema.js';
import { errorName } from './error-name.js';

/**
 * Marks an audit row as failed on a best-effort basis.
 *
 * A database failure is handed to `report` and swallowed so it can never
 * replace the pipeline error that triggered the audit update.
 * @param db - the Drizzle database holding `ai_messages`
 * @param messageId - id of the audit row to mark failed
 * @param report - receives the diagnostic message when the update fails
 */
export async function markAuditFailed(
  db: Database,
  messageId: string,
  report: (message: string) => void,
): Promise<void> {
  await db
    .update(aiMessages)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(eq(aiMessages.id, messageId))
    .catch((secondaryError: unknown) => {
      // Best-effort audit; never mask the original failure with a database error.
      report(`audit row ${messageId} could not be marked failed: ${errorName(secondaryError)}`);
    });
}

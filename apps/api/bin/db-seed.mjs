// Thin wrapper: runs the compiled seed main() against DATABASE_URL.
// Kept in plain .mjs so it is not part of the instrumented source tree.
import { main } from '../dist/db/seed.js';

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  // eslint-disable-next-line n/no-process-exit -- CLI bin: hard exit so a failed seed reports failure even if a pool handle lingers
  process.exit(1);
});

#!/usr/bin/env node
// Thin wrapper: runs the compiled seed main() against DATABASE_URL.
// Kept in plain .mjs so it is not part of the instrumented source tree.
import { main } from '../dist/database/seed.js';

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

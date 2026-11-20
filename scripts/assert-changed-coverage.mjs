/**
 * CI guard for the changed-file coverage gate.
 *
 * `npm run test:cov:changed` runs `vitest run --changed`, which selects only
 * files touched by the current diff. Combined with `passWithNoTests: true`, a
 * run that selects no test still exits zero and can leave a zero-total (or no)
 * JSON summary. This guard fails unless the `json-summary` report from that
 * run has at least one non-zero counter, so a green gate always means real
 * coverage was collected.
 *
 * Usage: node scripts/assert-changed-coverage.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

const PREFIX = 'changed-file coverage:';
const REPORT_PATH = 'coverage/coverage-summary.json';

/**
 * Validates that a coverage summary recorded at least one instrumented file.
 * @returns {number} 0 when the totals are non-zero, 1 otherwise
 */
function checkCoverage() {
  if (!existsSync('coverage/coverage-summary.json')) {
    console.error(`${PREFIX} missing report ${REPORT_PATH}`);
    return 1;
  }

  let summary;
  try {
    summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
  } catch (error) {
    console.error(`${PREFIX} unreadable report ${REPORT_PATH}: ${String(error)}`);
    return 1;
  }

  const total = summary?.total;
  const counters = [
    total?.branches?.total,
    total?.functions?.total,
    total?.lines?.total,
    total?.statements?.total,
  ];
  const instrumented = counters.reduce(
    (sum, counter) => sum + (typeof counter === 'number' ? counter : 0),
    0,
  );

  if (instrumented <= 0) {
    console.error(`${PREFIX} ${REPORT_PATH} has zero totals (no files were covered)`);
    return 1;
  }

  console.log(`${PREFIX} ${instrumented} instrumented counters in ${REPORT_PATH}`);
  return 0;
}

process.exitCode = checkCoverage();

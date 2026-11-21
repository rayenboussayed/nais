/**
 * CI guard for the changed-file coverage gate.
 *
 * `npm run test:cov:changed` runs `vitest run --changed`, which selects only
 * files touched by the current diff. This guard fails unless the json-summary
 * report contains real files and every changed file reached 100% on all four
 * counters. It complements, rather than replaces, Vitest's own thresholds.
 *
 * Usage: node scripts/assert-changed-coverage.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

const PREFIX = 'changed-file coverage:';
const REPORT_PATH = 'coverage/coverage-summary.json';

/**
 * Validates that the changed-file coverage summary is complete and at 100%.
 * @returns {number} 0 when the report is complete and fully covered, 1 otherwise
 */
function checkCoverage() {
  if (!existsSync(REPORT_PATH)) {
    console.error(`${PREFIX} missing report ${REPORT_PATH}`);
    return 1;
  }

  let summary;
  try {
    summary = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
  } catch (error) {
    console.error(`${PREFIX} unreadable report ${REPORT_PATH}: ${String(error)}`);
    return 1;
  }

  const entries = Object.entries(summary).filter(([key]) => key !== 'total');
  if (entries.length === 0) {
    console.error(`${PREFIX} ${REPORT_PATH} has no instrumented files`);
    return 1;
  }

  const total = summary.total;
  if (total === undefined) {
    console.error(`${PREFIX} ${REPORT_PATH} is missing total`);
    return 1;
  }

  const checks = [...entries, ['total', total]];
  for (const [label, counters] of checks) {
    const { branches, functions, lines, statements } = counters;
    if (
      !isComplete(label, 'branches', branches) ||
      !isComplete(label, 'functions', functions) ||
      !isComplete(label, 'lines', lines) ||
      !isComplete(label, 'statements', statements)
    ) {
      return 1;
    }
  }

  console.log(`${PREFIX} ${entries.length} files at 100% in ${REPORT_PATH}`);
  return 0;
}

/**
 * Validates one coverage counter.
 * @param {string} label - report label for the error message
 * @param {string} metric - metric name for the error message
 * @param {{pct?: number} | undefined} counter - counter from the summary
 * @returns {boolean} true when the counter is exactly 100%
 */
function isComplete(label, metric, counter) {
  if (typeof counter?.pct !== 'number' || counter.pct !== 100) {
    console.error(`${PREFIX} ${label} ${metric} is ${String(counter?.pct)}%, expected 100%`);
    return false;
  }
  return true;
}

process.exitCode = checkCoverage();

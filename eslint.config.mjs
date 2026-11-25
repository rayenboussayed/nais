import { createConfig, playwright, tests } from '@stackrb/eslint-config';
import stylistic from '@stylistic/eslint-plugin';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';

const TRY_EXTENSIONS = ['.cjs', '.cts', '.d.ts', '.js', '.json', '.mjs', '.mts', '.ts', '.tsx'];

/**
 * Builds an off-map from a flat-config block or an array of blocks.
 * @param {Array<object>} configs - ESLint config blocks whose rules should be disabled
 * @returns {Record<string, string>} rule names mapped to off
 */
function off(...configs) {
  return Object.fromEntries(
    configs
      .flat()
      .flatMap((config) => Object.keys(config.rules ?? {}).map((rule) => [rule, 'off'])),
  );
}

export default [
  ...createConfig({
    extraIgnores: [
      'apps/api/drizzle/**/snapshot.json',
      'apps/web/src/routeTree.gen.ts',
      'generated/**',
      'profiles/**',
      'test/results/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
    extraRules: {
      ...off(playwright()),
      ...off(stylistic.configs.recommended),
      ...off(tests()),
      ...off(unicorn.configs.recommended),
    },
    nodeVersion: '>=24.0.0',
    target: 'node',
  }),
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    name: 'trainslator/node-settings',
    settings: { node: { tryExtensions: TRY_EXTENSIONS } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    name: 'trainslator/web-browser-globals',
  },
];

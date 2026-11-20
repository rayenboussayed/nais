import deslint from '@deslint/eslint-plugin';
import js from '@eslint/js';
import json from '@eslint/json';
import markdown from '@eslint/markdown';
import stylistic from '@stylistic/eslint-plugin';
import typescriptEslintParser from '@typescript-eslint/parser';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier/flat';
import deMorgan from 'eslint-plugin-de-morgan';
import depend from 'eslint-plugin-depend';
import { jsdoc } from 'eslint-plugin-jsdoc';
import node from 'eslint-plugin-n';
import perfectionist from 'eslint-plugin-perfectionist';
import promise from 'eslint-plugin-promise';
import regexp from 'eslint-plugin-regexp';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const JS_FILES = '**/*.{js,mjs,cjs,ts,mts,cts,tsx}';
const TS_FILES = '**/*.{ts,mts,cts,tsx}';

export default defineConfig([
  globalIgnores([
    'node_modules',
    '**/node_modules/**',
    'dist',
    '**/dist/**',
    '**/coverage/**',
    'package-lock.json',
    '**/package-lock.json',
    'test/results/**',
    '**/test-results/**',
    '**/playwright-report/**',
    '.cache-dist-bak',
    '**/.cache-dist-bak/**',
    '.agent-swarm/**',
    // third-party skill content is vendored verbatim by the skills CLI
    '.agents/**',
    'profiles/**',
  ]),
  {
    extends: [
      'js/recommended',
      'n/recommended-module',
      deslint.configs.recommended,
      deMorgan.configs.recommended,
      sonarjs.configs.recommended,
      security.configs.recommended,
      regexp.configs.recommended,
      promise.configs['flat/recommended'],
      perfectionist.configs['recommended-natural'],
    ],
    files: [JS_FILES, TS_FILES],
    languageOptions: {
      globals: { ...globals.node, ...globals.builtin },
      parser: typescriptEslintParser,
    },
    plugins: { '@stylistic': stylistic, depend, js, n: node, unicorn },
    settings: {
      node: {
        tryExtensions: ['.cjs', '.cts', '.js', '.json', '.mjs', '.mts', '.ts', '.tsx'],
        version: '>=24.0.0',
      },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    extends: [jsdoc({ config: 'flat/recommended' })],
    files: [JS_FILES],
  },
  {
    extends: [tseslint.configs.recommended, jsdoc({ config: 'flat/recommended-tsdoc' })],
    files: [TS_FILES],
  },
  {
    files: ['**/*.{spec,test}.{ts,tsx,js}'],
    plugins: { vitest },
  },
  {
    extends: ['json/recommended'],
    files: ['**/*.json'],
    language: 'json/json',
    plugins: { json },
  },
  {
    extends: ['json/recommended'],
    files: ['**/*.jsonc'],
    language: 'json/jsonc',
    plugins: { json },
  },
  {
    extends: ['json/recommended'],
    files: ['**/*.json5'],
    language: 'json/json5',
    plugins: { json },
  },
  {
    extends: ['markdown/recommended'],
    files: ['**/*.md'],
    language: 'markdown/gfm',
    plugins: { markdown },
  },
  prettier,
]);

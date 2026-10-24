import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';

export default defineConfig(
  { ignores: ['node_modules/**', 'dist/**', '.astro/**', '.wrangler/**', 'data/generated/**', 'src/worker-configuration.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx,astro}'],
    rules: {
      'no-undef': 'off', // TypeScript validates names, including Astro/Cloudflare globals.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);

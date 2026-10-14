// Root ESLint flat config shared by every workspace package.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.expo/**', '**/web-build/**', '**/test-results/**', '**/playwright-report/**', '**/*.config.js', '**/next-env.d.ts', '**/expo-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['apps/mobile/**/*.{ts,tsx}', 'apps/admin/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/test/**/*.ts', 'e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);

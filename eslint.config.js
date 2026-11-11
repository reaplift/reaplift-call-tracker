import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'apps/android/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // CommonJS run directly by Node (for example Hostinger's startup file, scripts/hostinger/start.cjs).
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', __dirname: 'readonly', process: 'readonly', console: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);

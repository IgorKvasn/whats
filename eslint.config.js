import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/out/**', 'dist/**', 'release/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // tests/ and the root config files sit outside both build tsconfigs;
        // tsconfig.eslint.json exists so type-aware rules can still see them.
        project: ['./tsconfig.json', './tsconfig.node.json', './tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Passing a bare method reference to a matcher is the normal assertion idiom.
      '@typescript-eslint/unbound-method': 'off',
      // Test doubles routinely pass partial shapes through `any`; asserting on them is the
      // point, and the real types are still covered by the tsc gate.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);

import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Disable all base rules from @eslint/js - we'll use typescript-eslint rules instead
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/*.js'],
  },
  // Enable recommended rules from @eslint/js (turned off by typescript-eslint)
  js.configs.recommended,
  // Use recommended TypeScript rules
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      // TypeScript recommended rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  }
)

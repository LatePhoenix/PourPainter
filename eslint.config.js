import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const simDomainRenderFiles = [
  'src/sim/**/*.{ts,tsx}',
  'src/domain/**/*.{ts,tsx}',
  'src/render/**/*.{ts,tsx}',
];

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'node_modules'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: simDomainRenderFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message: 'src/sim, src/domain and src/render must not import React.',
            },
            {
              name: 'react-dom',
              message: 'src/sim, src/domain and src/render must not import React DOM.',
            },
            {
              name: 'react/jsx-runtime',
              message: 'src/sim, src/domain and src/render must not import React.',
            },
          ],
          patterns: [
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
              message: 'src/sim, src/domain and src/render must not import React.',
            },
            {
              group: ['**/app', '**/app/*', '@/app', '@/app/*', 'src/app', 'src/app/*'],
              message: 'src/sim, src/domain and src/render must not import from src/app.',
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);

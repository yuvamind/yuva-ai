// This file stays CommonJS .js on purpose: ESLint loads its config through Node
// directly, before any build step exists, and package.json declares no
// "type": "module".
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'docs/**', 'template/**', 'coverage/**'],
  },
  {
    // The two remaining CommonJS config files at the root. They were linted
    // before the migration (the old config matched **/*.js) and still are.
    files: ['*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'readonly', __dirname: 'readonly', process: 'readonly' },
    },
    rules: {
      'eqeqeq': 'error',
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-throw-literal': 'error',
      'curly': ['warn', 'multi-line'],
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        // No `project` setting: these rules are all syntactic, and type-aware
        // linting would re-run the whole type graph on every lint for no gain
        // here. `npm run typecheck` is what enforces types.
        projectService: false,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Deliberately NOT extending typescript-eslint's "recommended" set.
      // The migration's job is to keep this project's existing lint policy
      // working against TypeScript syntax, not to impose a new one -- adopting
      // recommended (no-explicit-any, no-non-null-assertion, ...) is a separate,
      // reviewable decision. These are the pre-migration rules, unchanged.
      'no-console': 'off',
      'eqeqeq': 'error',
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-throw-literal': 'error',
      'curly': ['warn', 'multi-line'],

      // The TypeScript-aware replacement for core no-unused-vars. The core rule
      // cannot see type-only references and reports false positives on
      // interfaces, type aliases and parameter properties.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },
];

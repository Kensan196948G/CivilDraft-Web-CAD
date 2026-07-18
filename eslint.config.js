import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// Dependency-direction enforcement (詳細設計仕様書 §2.1):
//   features/pages -> application, features/pages -> domain
//   application     -> domain
//   infrastructure  -> application, infrastructure -> domain
//   stores          -> application, stores -> domain
//   domain depends on nothing above (no React / Konva / Zustand / IndexedDB / HTTP)
const FRAMEWORK_SPECIFIERS = [
  'react', 'react/*', 'react-dom', 'react-dom/*',
  'konva', 'react-konva',
  'zustand', 'zustand/*',
]
const UPPER_LAYER_PATTERNS = [
  '**/stores/*', '**/stores', '../stores/*', '../../stores/*',
  '**/components/*', '**/components', '../components/*', '../../components/*',
  '**/features/*', '**/features', '../features/*', '../../features/*',
  '**/pages/*', '**/pages', '../pages/*', '../../pages/*',
  '**/app/*', '**/app', '../app/*', '../../app/*',
]

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      '.vite',
      '.design-sync',
      '.ds-sync',
      'ds-bundle',
      'sbom',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // domain: the innermost layer. No framework, no outer-layer imports.
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: FRAMEWORK_SPECIFIERS.map((name) => ({
          name,
          message: 'domain層はReact/Konva/Zustandに依存できません (詳細設計仕様書§2.1)',
        })),
        patterns: [
          ...UPPER_LAYER_PATTERNS,
          '**/infrastructure/*', '**/infrastructure', '../infrastructure/*', '../../infrastructure/*',
          '**/application/*', '**/application', '../application/*', '../../application/*',
        ].map((group) => ({
          group: [group],
          message: 'domain層はapplication/infrastructure/上位層に依存できません (詳細設計仕様書§2.1)',
        })),
      }],
    },
  },

  // application: depends on domain only (infrastructure implements its ports, not the reverse).
  {
    files: ['src/application/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: FRAMEWORK_SPECIFIERS.map((name) => ({
          name,
          message: 'application層はReact/Konva/Zustandに依存できません (詳細設計仕様書§2.1)',
        })),
        patterns: [
          ...UPPER_LAYER_PATTERNS,
          '**/infrastructure/*', '**/infrastructure', '../infrastructure/*', '../../infrastructure/*',
        ].map((group) => ({
          group: [group],
          message: 'application層はinfrastructure/上位層に依存できません (詳細設計仕様書§2.1)',
        })),
      }],
    },
  },

  // stores / features / pages: depend on application + domain, not on infrastructure directly.
  {
    files: ['src/stores/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}', 'src/pages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '**/infrastructure/*', '**/infrastructure', '../infrastructure/*', '../../infrastructure/*',
        ].map((group) => ({
          group: [group],
          message: 'infrastructureへの直接依存は禁止。application層のportsを経由してください (詳細設計仕様書§2.1)',
        })),
      }],
    },
  },

  {
    files: ['*.config.{ts,js}', 'vite.config.ts', 'vitest.config.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
)

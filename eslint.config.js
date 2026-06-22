import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // De nye React Compiler-regler er for strikse til vores live-ur/polling
      // (Date.now i render + setState i effekt). Vi beholder rules-of-hooks m.fl.
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // Backend (serverless functions) + build-konfig kører i Node.
    files: ['api/**/*.js', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
])

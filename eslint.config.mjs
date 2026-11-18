// ESLint yapılandırması: index.html içindeki <script> de denetlenir (eslint-plugin-html).
import js from '@eslint/js';
import html from 'eslint-plugin-html';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'tests/.cache/'] },
  js.configs.recommended,
  {
    files: ['**/*.html'],
    plugins: { html },
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, JSZip: 'readonly' } }
  },
  { files: ['sw.js'], languageOptions: { globals: globals.serviceworker } },
  // Kırmızı Kalem: tarayıcı ES modülleri; testler Node ES modülleri
  { files: ['sinav/js/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, pdfjsLib: 'readonly' } } },
  { files: ['sinav/tests/**/*.mjs'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } } },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  // page.evaluate() içindeki kod tarayıcıda çalışır
  { files: ['tests/**/*.cjs'], languageOptions: { globals: { ...globals.browser, DK: 'readonly' } } },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error'
    }
  }
];

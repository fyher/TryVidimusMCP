import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      complexity: ['error', 10],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 4],
      // Exports nommés uniquement
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Utiliser des exports nommés uniquement.',
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' },
  },
  {
    // Les fichiers de config des outils exigent un export par défaut
    files: ['**/*.config.{js,mjs,ts}', '**/eslint.config.mjs'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);

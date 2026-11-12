import base from './tooling/eslint.mjs';

const config = [
  ...base,
  {
    // aucun accès à l'environnement ni à la console dans le code du paquet ; seul `bin/` lit l'environnement.
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env', message: 'Injecter la configuration.' },
      ],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: { 'max-lines-per-function': 'off', 'max-lines': 'off', 'no-console': 'off' },
  },
  { files: ['vitest.config.ts'], rules: { 'no-restricted-syntax': 'off' } },
];

export default config;

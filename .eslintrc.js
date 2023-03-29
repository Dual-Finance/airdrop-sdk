module.exports = {
  env: {
    browser: true,
    es2021: true,
    mocha: true,
  },
  extends: [
    'airbnb-base',
    'plugin:import/typescript',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: [
    '@typescript-eslint',
  ],
  rules: {
    'import/extensions': 0,
    'import/no-extraneous-dependencies': 0,
    'import/no-unresolved': 0,
    'no-console': 0,
    'no-bitwise': 0,
    'no-plusplus': 0,
    'no-promise-executor-return': 0,
    'no-unused-vars': 0,
    'no-underscore-dangle': 0,
    'camelcase': 0,
    'import/prefer-default-export': 0,
    'class-methods-use-this': 0,
    'no-param-reassign': 0,
    'no-restricted-syntax': 0,
    'func-names': 0,
    'max-classes-per-file': 0,
    'no-shadow': 0,
    'no-await-in-loop': 0,
    'no-continue': 0,
    'no-use-before-define': 0,
    'lines-between-class-members': [
      'error',
      'always',
      { 'exceptAfterSingleLine': true },
    ]
  },
};

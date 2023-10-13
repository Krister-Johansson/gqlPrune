module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'plugin:@typescript-eslint/recommended',
    'prettier',
    'plugin:prettier/recommended',
  ],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['unused-imports'],
  rules: {
    'unused-imports/no-unused-imports': 'error',
  },
  ignorePatterns: ['dist'],
};

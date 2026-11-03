import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  // test/fixtures/** is input data, not project source: it is deliberately
  // written the way a real consumer's tree looks (imports that resolve to
  // nothing, codegen-shaped output) and is only ever string-searched.
  // website/ is the landing page, a separate project with its own toolchain;
  // it is not package source and is not linted with the package's rules.
  { ignores: ['dist', 'test/fixtures', 'website'] },
  ...tseslint.configs.recommended,
  {
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      'unused-imports/no-unused-imports': 'error',
    },
  },
  // Must be last: disables formatting rules that conflict with Prettier and
  // runs Prettier as an ESLint rule.
  prettierRecommended,
);

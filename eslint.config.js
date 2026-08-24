import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "dist-tsc/**",
      "coverage/**",
      "data/**",
      "data-raw/**",
      "images/**",
      "provenance/**",
      "tests/fixtures/**",
      "*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      // 让 TS strict 处理未使用
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      // 允许未使用参数以 _ 开头
      "@typescript-eslint/no-unused-params": "off",
      // 脚本会经常用 console
      "no-console": "off",
      // 可空类型处理：由 strict + exactOptionalPropertyTypes 控制
      "@typescript-eslint/no-non-null-assertion": "warn",
      // any 需要明确标注
      "@typescript-eslint/no-explicit-any": "warn",
      // 回调风格 - 允许 ts 推断
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
);

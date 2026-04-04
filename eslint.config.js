import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // TypeScript-specific
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],

      // General
      "no-console": "off",        // you use console.log in migrate.ts, index.ts
      "no-unused-vars": "off",    // turned off in favour of the TS version above
    },
  },
  {
    // Ignore compiled output and test files from linting
    ignores: ["dist/**", "node_modules/**", "tests/**"],
  },
];
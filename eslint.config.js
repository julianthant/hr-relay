import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";
import unusedImports from "eslint-plugin-unused-imports";
import reactHooks from "eslint-plugin-react-hooks";

// The `_`-prefix convention (a var/arg prefixed with `_` is intentionally
// unused — e.g. `const { privateKey: _omit, ...rest } = obj`).
const unusedImportsRules = {
  "@typescript-eslint/no-unused-vars": "off",
  "unused-imports/no-unused-imports": "error",
  "unused-imports/no-unused-vars": [
    "warn",
    { vars: "all", varsIgnorePattern: "^_", args: "all", argsIgnorePattern: "^_" },
  ],
};

// Async handlers keep a uniform signature, including synchronous implementations.
const typeAwareTuning = {
  "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
  "@typescript-eslint/no-base-to-string": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-redundant-type-constituents": "error",
  "@typescript-eslint/only-throw-error": "error",
  "@typescript-eslint/prefer-promise-reject-errors": "error",
  "@typescript-eslint/await-thenable": "error",
  "@typescript-eslint/require-await": "off",
  "@typescript-eslint/restrict-template-expressions": [
    "error",
    { allowNumber: true, allowBoolean: true, allowNullish: true },
  ],
  "preserve-caught-error": "error",
};

export default ts.config(
  { ignores: ["dist", "node_modules", "coverage", ".work"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...ts.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Rebuild Node sources.
  {
    files: ["src/**/*.ts"],
    ignores: ["src/dashboard/**"],
    plugins: { "unused-imports": unusedImports },
    languageOptions: { globals: { ...globals.node } },
    rules: { ...unusedImportsRules, ...typeAwareTuning },
  },

  // Gate tooling is part of the same quality umbrella.
  {
    files: ["scripts/**/*.ts"],
    plugins: { "unused-imports": unusedImports },
    languageOptions: { globals: { ...globals.node } },
    rules: { ...unusedImportsRules, ...typeAwareTuning },
  },

  // Lint the same authored root configs as TypeScript.
  {
    files: ["vitest.config.ts", "vite.dashboard.config.ts", "vite.parity.config.ts"],
    plugins: { "unused-imports": unusedImports },
    languageOptions: { globals: { ...globals.node } },
    rules: { ...unusedImportsRules, ...typeAwareTuning },
  },

  // Browser sources use the strict tier and React hook rules.
  {
    files: ["src/dashboard/**/*.ts", "src/dashboard/**/*.tsx"],
    plugins: { "unused-imports": unusedImports, "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...unusedImportsRules,
      ...typeAwareTuning,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },

  // Tests use the source tier with the `_`-prefix unused convention.
  {
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    plugins: { "unused-imports": unusedImports },
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "unused-imports/no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
      ...typeAwareTuning,
    },
  },

  // Config / plain-JS files aren't part of any tsconfig program.
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    ...ts.configs.disableTypeChecked,
  },
);

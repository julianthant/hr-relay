import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";
import unusedImports from "eslint-plugin-unused-imports";
import reactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";

const TYPED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const FLAGS_WITH_VALUES = new Set([
  "--cache-location", "--cache-strategy", "--max-warnings", "--config", "-c",
  "--format", "-f", "--output-file", "-o", "--parser", "--parser-options",
  "--rule", "--rulesdir", "--plugin", "--ext", "--ignore-pattern",
  "--resolve-plugins-relative-to", "--report-unused-disable-directives-severity",
  "--flag", "--concurrency", "--cache-file",
]);

function collectTypedFiles(directory, files) {
  for (const name of readdirSync(directory)) {
    if (name === "node_modules" || name === "dist" || name === "coverage" || name === ".work") continue;
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) collectTypedFiles(full, files);
    else if (TYPED_EXTENSIONS.has(path.extname(name))) files.push(full);
  }
}

// Project service parses every tsconfig include. A lint process only needs the files it was given.
function eslintTypedRoots() {
  const start = process.argv.findIndex((arg) => arg.endsWith(`${path.sep}eslint.js`));
  if (start < 0) return null;
  const targets = [];
  for (let i = start + 1; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--") {
      targets.push(...process.argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("-")) {
      const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
      if (FLAGS_WITH_VALUES.has(name) && !arg.includes("=")) i += 1;
      continue;
    }
    targets.push(arg);
  }
  const files = [];
  for (const target of targets) {
    const full = path.resolve(target);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) collectTypedFiles(full, files);
    else if (TYPED_EXTENSIONS.has(path.extname(full))) files.push(full);
  }
  return files.length > 0 ? files : null;
}

const typedRoots = eslintTypedRoots();
// A Program object in the config cannot be serialized, and ESLint's cache serializes the config.
const lintProject = typedRoots ? writeLintProject(typedRoots) : null;

function writeLintProject(roots) {
  const cacheDir = path.join(import.meta.dirname, "node_modules/.cache/eslint");
  mkdirSync(cacheDir, { recursive: true });
  const projectPath = path.join(cacheDir, "lint-program.json");
  const base = JSON.parse(readFileSync(path.join(import.meta.dirname, "tsconfig.json"), "utf8"));
  writeFileSync(projectPath, JSON.stringify({
    compilerOptions: { ...base.compilerOptions, baseUrl: import.meta.dirname, rootDir: import.meta.dirname },
    files: roots,
  }));
  return projectPath;
}

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
    files: ["vitest.config.ts", "vite.dashboard.config.ts", "vite.mocks.config.ts"],
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

  ...(lintProject
    ? [{
        files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
        languageOptions: {
          parserOptions: {
            project: lintProject,
            projectService: false,
            tsconfigRootDir: import.meta.dirname,
          },
        },
      }]
    : []),
);

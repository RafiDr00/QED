import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import qed from "./tools/eslint-plugin-qed/index.js";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/.verify/**",
      "design-system/**",
      // Sample code the engine reads as data, not code this repo compiles.
      "examples/**",
      // Deliberately uncompilable: scripts/type-tests.ts is their runner.
      "packages/ui/type-tests/**",
      "packages/tokens/dist/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    files: ["packages/ui/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}"],
    plugins: { qed, "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "qed/no-raw-design-values": "error",
    },
  },
  {
    // The generator, the generated logo module and the gates are allowed to
    // name raw values: that is their job. The logo module comes from the
    // design system's own SVGs and G4 hashes it, so it cannot drift.
    files: [
      "packages/tokens/**/*.ts",
      "packages/ui/src/generated/**/*.ts",
      "scripts/**/*.ts",
      "tools/**/*.js",
    ],
    rules: { "qed/no-raw-design-values": "off" },
  },
  {
    files: ["**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);

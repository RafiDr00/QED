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
    // The generator and the gates are allowed to name raw values: that is
    // their job. Nothing they emit is hand-written downstream.
    files: ["packages/tokens/**/*.ts", "scripts/**/*.ts", "tools/**/*.js"],
    rules: { "qed/no-raw-design-values": "off" },
  },
  {
    files: ["**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);

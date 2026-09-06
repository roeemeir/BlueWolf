import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["components/bluewolf/developer-view-v09.tsx"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["components/bluewolf/v12/operator.tsx"],
    rules: {
      // Polling effects schedule external data-source refreshes. They live outside
      // the replaceable algorithm core and intentionally update React state.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  {
    files: ["components/bluewolf/v12/investigation.tsx"],
    rules: {
      // Date.now/new Date initialize a user-selectable query range in the UI.
      // Time is not consumed by the core except through the explicit dataset.
      "react-hooks/purity": "off",
    },
  },
]);

export default eslintConfig;

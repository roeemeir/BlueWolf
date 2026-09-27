import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: [
      "components/bluewolf/visuals.tsx",
      "components/bluewolf/so-governed-visuals.tsx",
      "components/bluewolf/operator-view.tsx",
      "components/bluewolf/operational-live-map.tsx",
      "components/bluewolf/operational-timeline.tsx",
    ],
    rules: {
      // These components mirror externally-owned navigation state (server/tick,
      // Core event evidence, and the shared operator time cursor) into local UI
      // state. Keep the exception scoped to those synchronization effects.
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;

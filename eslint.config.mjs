import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-floating-promises": "off",
      "no-console": "error",
      eqeqeq: ["error", "always"],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "react/no-danger": "error",
    },
  },
  {
    // Client-reachable code must never import server modules, the DB client or the AWS SDK.
    files: ["src/components/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/server/*", "@/server/**"], message: "Server modules are not importable from client-reachable code." },
            { group: ["@aws-sdk/*"], message: "AWS SDK usage is server-side only." },
            { group: ["@/generated/*", "@/generated/**"], message: "Prisma client is server-side only." },
          ],
        },
      ],
    },
  },
  {
    // Tests may use `any` for response bodies.
    files: ["tests/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "dist/**", "coverage/**", "next-env.d.ts", "src/generated/**", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;

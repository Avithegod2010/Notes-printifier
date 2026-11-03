import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "off",
    // Incremental re-enable (was off): unused code is surfaced as a warning
    // so the build gates on real errors while the backlog shrinks.
    "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",

    // React rules
    // Incremental re-enable (was off): missing-deps bugs are real bugs;
    // warned, not errored, until the existing call sites are audited.
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/purity": "off",
    // React Compiler advisory rules (new in eslint-config-next 16.4): they flag
    // pre-existing, verified patterns (scaffold hooks + app effects). Kept as
    // warnings so CI stays green; refactor before re-enabling as errors.
    "react-hooks/preserve-manual-memoization": "warn",
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/refs": "warn",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    
    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    
    // General JavaScript rules
    "prefer-const": "warn",
    "no-unused-vars": "off", // TS files use @typescript-eslint/no-unused-vars
    "no-console": "off",
    "no-debugger": "warn",
    "no-empty": "off", // idiomatic `catch {}` guards are everywhere by design
    "no-irregular-whitespace": "warn",
    "no-case-declarations": "off",
    // was off — silent fallthrough is a real bug class, never acceptable
    "no-fallthrough": "error",
    "no-mixed-spaces-and-tabs": "warn",
    "no-redeclare": "off", // TS handles
    "no-undef": "off", // TS handles globals; re-enabling breaks TS projects
    "no-unreachable": "warn",
    "no-useless-escape": "warn",
  },
}, {
  ignores: [
    "node_modules/**",
    ".next/**",
    ".next-static/**",
    ".webtest/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // third-party minified bundles + build artifacts — not product source
    "public/**",
    "android/**",
    // local dev tooling & sandbox scaffolding
    "scripts/dev/**",
    "examples/**",
    "upload/**",
    "verify-shots/**",
    "tool-results/**",
    "skills/**",
  ]
}];

export default eslintConfig;

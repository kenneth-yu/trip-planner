import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import copyPlugin from "./tools/lint/copy.mjs";

const noComments = {
  meta: {
    type: "problem",
    docs: { description: "Code carries no comments. Intent lives in docs/ARCHITECTURE.md and test names." },
    messages: {
      comment:
        "No comments in code. Name things so the code says what it does; put why in docs/ARCHITECTURE.md (diagrams, state charts, decisions) or in a test name. Never justify a workaround: fix the cause. See docs/ENGINEERING.md, rule 2.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang") continue;
          context.report({ loc: comment.loc, messageId: "comment" });
        }
      },
    };
  },
};

const principles = { rules: { "no-comments": noComments } };

const outsideLayer = (layers) => layers.flatMap((l) => [`@/${l}/*`, `**/${l}/*`]);

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "drizzle/**", "node_modules/**", ".claude/worktrees/**", ".pipeline/**"]),
  {
    files: ["**/*.{ts,tsx,mts,mjs,js}"],
    plugins: { principles },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
    rules: {
      "principles/no-comments": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression:not([typeAnnotation.typeName.name='const'])",
          message: "No type casts. Parse unknown data with a zod schema at the boundary, or fix the type where it is produced. See docs/ENGINEERING.md, rule 4.",
        },
        { selector: "TSTypeAssertion", message: "No type casts. Parse with a zod schema or fix the type at its source. See docs/ENGINEERING.md, rule 4." },
        {
          selector: "TSNonNullExpression",
          message: "No non-null assertions. Narrow with a real check, change the type so the value cannot be missing, or use present() from src/testing in tests. See docs/ENGINEERING.md, rule 4.",
        },
        {
          selector: "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression",
          message: "Do not swallow errors with .catch(() => ...). Handle the failure where it can be handled and surface it, or let it propagate. See docs/ENGINEERING.md, rule 3.",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-empty-function": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-useless-catch": "error",
      "no-console": ["error", { allow: ["error"] }],
      "no-restricted-imports": ["error", { paths: [{ name: "luxon", message: "Import DateTime from src/domain/time/luxon, which turns on throwOnInvalid." }] }],
    },
  },
  {
    files: ["src/app/**/*.tsx"],
    plugins: { copy: copyPlugin },
    rules: { "copy/copy": ["error", { properNouns: ["Google Calendar", "Google", "Apple", "New York", "Hong Kong", "Tokyo", "Shenzhen", "Kyoto", "Lisbon", "Chicago"] }] },
  },
  {
    files: ["eslint.config.mjs"],
    rules: { "principles/no-comments": "off" },
  },
  {
    files: ["src/domain/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "luxon", message: "Import DateTime from src/domain/time/luxon." }],
          patterns: [
            { group: outsideLayer(["server", "app"]), message: "src/domain is pure and sits at the center. Move the logic into src/domain or pass what it needs in as data. See docs/ARCHITECTURE.md, Layers." },
            { group: ["next", "next/*", "drizzle-orm", "drizzle-orm/*", "pg", "@electric-sql/*", "node:*", "react", "react-dom"], message: "src/domain does no I/O and knows no framework. Do the I/O in a service and pass the result in. See docs/ARCHITECTURE.md, Layers." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/domain/time/luxon.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["src/server/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "luxon", message: "Import DateTime from src/domain/time/luxon." }],
          patterns: [{ group: outsideLayer(["app"]), message: "src/server must not depend on src/app. Move shared code down into src/server or src/domain. See docs/ARCHITECTURE.md, Layers." }],
        },
      ],
    },
  },
]);

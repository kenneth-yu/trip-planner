# Contributing

This applies to people and to coding agents.

1. Read `CLAUDE.md`, then `docs/ENGINEERING.md`.
2. Find the path you are changing in `docs/FEATURES.md` and its tests.
3. Write or change the test first. For a bug, make it fail for the right reason.
4. Make the change at the root cause.
5. Run `npm run check`. When a lint rule fails, its message says what to do instead. Do that; rules cannot be turned off inline.
6. For UI or integration changes, run the app (`npm run db:seed`, `npm run dev`, then continue as Kenneth) and capture screenshots or output.
7. Update `docs/ARCHITECTURE.md` (diagrams, state charts, decisions) and `docs/FEATURES.md` in the same change.
8. Open a pull request using the template.

When review keeps finding the same problem, the fix is a new check in `eslint.config.mjs`, a type, or a test, plus removing the existing examples. See rule 10 in `docs/ENGINEERING.md`.

## What changed and why

## Evidence it works

Tests added or changed, and for UI or integration work, screenshots or output from the running app.

## Checklist (docs/ENGINEERING.md)

- [ ] `npm run check` passes
- [ ] Security (docs/SECURITY.md): no personal data in logs, errors or URLs; every input parsed; viewers, link visitors and removed members proven unable to see or change what they should not; new stored data is deleted with its trip
- [ ] New behavior has tests; a bug fix has a test that failed before the fix
- [ ] The root cause was fixed, not the symptom, and no comment explains a workaround
- [ ] No errors swallowed, no casts, no non-null assertions
- [ ] UI or integration work was run and looked at
- [ ] `docs/ARCHITECTURE.md` and `docs/FEATURES.md` match the new behavior
- [ ] Nothing dead, deprecated or copied-from-a-workaround left behind
- [ ] A correction that came up more than once is now a check, not a comment

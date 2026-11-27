# Performance budgets

Regressions in hot paths, bundle size, MCP response time and page vitals fail the `perf` workflow (`.github/workflows/perf.yml`). Every budget below came from a measurement, never from a guess, and each was shown to fail on a deliberately slowed function. A budget is changed only by the architect, with the new measurement and the reason added here. For an urgent fix while travelling, the architect may let a pull request merge with a failing budget, or raise the budget, without a fresh measurement; the reason and the date are then added here and the budget is re-measured afterwards.

All numbers are measured on the built app (`npx next build`, then `next start`), never `next dev`: in dev a trip page takes 0.5 to 1.6 seconds to render, which says nothing about production.

## How to run

- Hot paths and MCP: build first, then `npx vitest run --config vitest.perf.config.mts`. It starts the built app on a free port with a throwaway PGlite database, seeds the demo trips, creates a read-only assistant token, and stops everything afterwards.
- Bundle: `npx tsx scripts/bundle-budget.ts` after the build.
- Lighthouse: runs on the CI runner only (`npx @lhci/cli`); it is not installed locally.
- Results land in `.next/perf/` as JSON and Markdown; CI uploads them as the `perf` artifact, writes the job summary and keeps one pull request comment up to date.

Budgets live in `perf/budgets.json`. A new hot path, MCP call or route with no entry fails with a message that says to add a measured budget.

## Hot paths

Median of 31 samples, each the mean of 20 calls after 20 warm up calls, per call, on `src/fixtures/december-trip.json` (owner view) and the packed demo trip (`PACKED_TRIP`). `planCalendarImport` imports the fixture's 16 calendar events against the trip's visible items. Measured on a WSL2 development machine, three runs; the budget is about 2 times the slowest run, because shared CI runners are slower and noisier than this machine and a median of 31 samples inside 2 times is stable, while a real regression (an extra pass over the items, a lookup inside a loop) costs more than 2 times.

| Measure | Trip | Measured (three runs) | Budget | Reason |
|---|---|---|---|---|
| projectTrip | december | 0.011, 0.011, 0.016 ms | 0.04 ms | Runs on every read; microsecond scale, so 2 to 3 times for timer noise |
| projectTrip | packed | 0.066 to 0.069 ms | 0.15 ms | Same |
| buildTripGrid | december | 8.6 to 10.5 ms | 22 ms | Home page and day strip |
| buildTripGrid | packed | 5.1 to 5.4 ms | 12 ms | Same |
| buildDays | december | 5.9 to 6.7 ms | 14 ms | Day by day view and MCP `get_trip` |
| buildDays | packed | 2.4 ms | 6 ms | Same |
| runChecks | december | 12.0 to 13.7 ms | 28 ms | Attention strip and deadlines |
| runChecks | packed | 2.6 ms | 6 ms | Same |
| planCalendarImport | december | 39.4 to 46.6 ms | 95 ms | Calendar import and the inbox |
| planCalendarImport | packed | 39.8 to 44.3 ms | 90 ms | Same |

These are slower than they look necessary because every time conversion goes through Luxon. Making them faster is welcome; lowering a budget needs a new measurement here.

## MCP get_trip

Median of 31 calls after 5 warm up calls. In memory goes through the official MCP client over an in memory transport (service and projection, no network). HTTP is a JSON-RPC `tools/call` with a bearer token against the built app's `/api/mcp`, which adds the proxy, token lookup, a fresh MCP server per request and serialisation.

| Measure | Measured | Budget | Reason |
|---|---|---|---|
| get_trip in memory | 28 to 30 ms (one run at 91 ms while the machine was busy) | 100 ms | A busy machine tripled the median once, so the budget sits above that run; an 80 ms slowdown in `projectTrip` made it 116 ms and failed |
| get_trip over HTTP | 36 to 37 ms (one run at 107 ms, same busy period) | 110 ms | Same; the same 80 ms slowdown made it 121 ms and failed |

An assistant waiting on a tool call should not feel it; 100 ms keeps a call well under a second even on a slow runner.

## First load JavaScript per route

The gzipped size of every script the browser loads for a route on first visit: the shared main files from the route's `build-manifest.json` plus the scripts in its `page_client-reference-manifest.js` (layouts and page), each counted once. The `nomodule` polyfill file is excluded because current browsers do not fetch it. Stylesheets are not counted. The parser is tested on a recorded manifest in `scripts/bundle-budget.test.ts`.

Sizes are bytes, and the kB in the CI report is 1024 bytes (137.3 kB is 140,6xx B). Budget is the measured size plus 7 percent, rounded up to the next 1000 bytes: enough that a rebuild with different chunking does not trip it, small enough that one new library does. Adding a client import of `city-timezones` raised the trip routes from 137 kB to 385 kB and failed every one of them.

| Route | Measured (gzip) | Budget |
|---|---|---|
| / | 140,620 B | 151,000 B |
| /_global-error | 135,888 B | 146,000 B |
| /_not-found | 135,888 B | 146,000 B |
| /not-on-your-account | 139,190 B | 149,000 B |
| /sign-in | 137,612 B | 148,000 B |
| /trips/[tripId] | 140,651 B | 151,000 B |
| /trips/[tripId]/add | 165,922 B | 178,000 B |
| /trips/[tripId]/connect | 140,802 B | 151,000 B |
| /trips/[tripId]/deadlines | 139,647 B | 150,000 B |
| /trips/[tripId]/inbox | 140,613 B | 151,000 B |
| /trips/[tripId]/items/[itemId] | 140,352 B | 151,000 B |
| /invite/join | 136,050 B | 146,000 B |
| /invite/lost | 139,352 B | 150,000 B |
| /invite/problem/[kind] | 136,050 B | 146,000 B |
| /trips/[tripId]/share | 142,153 B | 153,000 B |
| /account | 144,486 B (141.1 kB on the runner) | 155,000 B |
| /trips/[tripId]/settings/delete | 144,384 B (141.0 kB on the runner) | 155,000 B |
| /trips/new | 139,957 B | 150,000 B |
| /v/[token] | 143,673 B (140.3 kB on the runner) | 154,000 B |

About 133 kB of every route is the React and Next.js runtime; the add form adds about 25 kB.

## Lighthouse

`lighthouserc.json` (mobile) and `perf/lighthouserc.desktop.json` (desktop preset), five runs each on the December trip page, deadlines and inbox, signed in as the demo traveller: `perf/prepare-db.ts` writes a session row for the demo user into the throwaway database and the cookie is sent as a request header. The server is the built app started by `perf/serve.ts` on 127.0.0.1 in production mode with the production environment checks on (a placeholder https `APP_URL`, throwaway keys, `TRUST_PROXY=0`); the dev sign in route is not used, because production mode forbids it. `perf/summary.ts` fails the job if any run was redirected away from the page it asked for (a dropped cookie would otherwise measure the sign in page).

Measured on the first CI run (Lighthouse 12.6.1, three runs per page). Per page medians, then the budget:

| Assertion | Mobile CI medians | Mobile budget | Desktop CI medians | Desktop budget |
|---|---|---|---|---|
| Performance score (median run) | 97 to 99 (one outlier run scored 84) | at least 0.9 | 100 | at least 0.95 |
| Largest contentful paint | 1832 to 2343 ms | at most 3000 ms (28 percent over the slowest median, above the slowest single run at 2377 ms) | 577 to 649 ms | at most 1000 ms (54 percent over the slowest run) |
| Cumulative layout shift | 0 | at most 0.1 | 0 | at most 0.1 |
| Total blocking time | 68 to 120 ms (one outlier run at 615 ms) | at most 300 ms | 0 to 39 ms | at most 100 ms |

Layout shift is 0 everywhere, so 0.1 is the Core Web Vitals "good" threshold, not a margin over a measurement; any real shift is visible against 0. Runs were raised from 3 to 5 and every assertion uses the median, so one noisy run on a shared runner does not fail the job. After the next CI run, re-check these medians and tighten if the margins stay large.

Installability is not a Lighthouse assertion: Lighthouse 12.6.1, the version `@lhci/cli` 0.15.1 runs, has no `installable-manifest` audit, so an assertion on it can never pass. Instead `perf/manifest.perf.test.ts` fetches `/manifest.webmanifest` from the built app, requires a name, short name, start URL, a standalone, fullscreen or minimal-ui display and at least one icon, and requires every icon it names to be served with the right content type. Icon sizes (192 and 512 PNG) belong to WP-15, which should extend that test.

## Proving a budget can fail

Each budget was shown to fail on a deliberately slowed function, locally, not committed:

- An 80 ms busy wait at the top of `projectTrip` failed both `projectTrip` budgets (80.1 and 80.3 ms against 0.04 and 0.15), `get_trip` in memory (116 ms against 100) and over HTTP after a rebuild (121 ms against 110).
- A 5 ms busy wait in `runChecks` failed `runChecks` on the packed trip (7.6 ms against 6); it stayed inside the december budget of 28 ms, as it should.
- A client side import of `city-timezones` failed first load JavaScript on every trip route.
- `buildTripGrid`, `buildDays` and `planCalendarImport` use the same harness and the same check, so a slowdown over 2 times their measurement fails them identically.

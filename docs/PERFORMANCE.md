# Performance budgets

Regressions in hot paths, bundle size, MCP response time and page vitals fail the `perf` workflow (`.github/workflows/perf.yml`). Every budget below came from a measurement, never from a guess, and each was shown to fail on a deliberately slowed function. A budget is changed only by the architect, with the new measurement and the reason added here. For an urgent fix while travelling, the architect may let a pull request merge with a failing budget, or raise the budget, without a fresh measurement; the reason and the date are then added here and the budget is re-measured afterwards.

All numbers are measured on the built app (`npx next build`, then `next start`), never `next dev`: in dev a trip page takes 0.5 to 1.6 seconds to render, which says nothing about production.

## How to run

- Hot paths and MCP: build first, then `npx vitest run --config vitest.perf.config.mts`. It starts the built app on a free port with a throwaway PGlite database, seeds the demo trips, creates a read-only assistant token, and stops everything afterwards.
- Bundle: `npx tsx scripts/bundle-budget.ts` after the build.
- Lighthouse: runs on the CI runner only (`npx @lhci/cli`), on GitHub-hosted ubuntu-latest with the runner's installed Chrome; it is not installed locally. The Lighthouse budgets were set from the medians of hosted runs, so they apply to that runner class; a run on other hardware (for example the self-hosted runner used for a few hours on Nov 27) is not comparable.
- Results land in `.next/perf/` as JSON and Markdown; CI uploads them as the `perf` artifact, writes the job summary and keeps one pull request comment up to date.

Budgets live in `perf/budgets.json`. A new hot path, MCP call or route with no entry fails with a message that says to add a measured budget.

## Hot paths

Median of 21 samples (always the same count), per call, on `src/fixtures/december-trip.json` (owner view) and the packed demo trip (`PACKED_TRIP`). `planCalendarImport` imports the fixture's 16 calendar events against the trip's visible items. Each sample is the mean of as many calls as fit in about 25 ms (one call for the slow paths, up to 50 for the fast ones), chosen from 8 warm up calls, so the work per test stays near half a second however fast or slow the runner is. A test also has a wall clock cap of 12 s: it stops sampling at the cap, and fails as too slow if it has fewer than 9 samples by then, which only a regression of tens of times can cause. The 60 s test timeout is unchanged. Before this, a test made 640 calls whatever they cost, so `planCalendarImport` (about 55 ms a call) took 25 s on one runner and 52 s on another, and timed out at 60 s on #47.

Re-baselined on Nov 27 on the CI runner that enforces them: GitHub-hosted ubuntu-latest (4 vCPU), perf run on #51. Each budget is 2 times that median, rounded up, with a floor of 1 ms: below a millisecond the median moves by more than its own size with scheduler jitter on a shared VM (projectTrip failed at 0.0402 ms against 0.04 ms), while any real regression in a hot path (an extra pass over the items, a lookup inside a loop) costs well over a millisecond on these trips. The first budgets, from a WSL2 development machine, were 2 to 3 times tighter and failed on the slower runner.

| Measure | Trip | Hosted median | Budget | Reason |
|---|---|---|---|---|
| projectTrip | december | 0.040 ms | 1 ms | Runs on every read; floor of 1 ms against timer noise |
| projectTrip | packed | 0.109 ms | 1 ms | Same |
| buildTripGrid | december | 16.2 ms | 33 ms | Home page and day strip |
| buildTripGrid | packed | 10.1 ms | 21 ms | Same |
| buildDays | december | 10.9 ms | 22 ms | Trip view and MCP `get_trip` |
| buildDays | packed | 4.7 ms | 10 ms | Same |
| runChecks | december | 22.6 ms | 46 ms | Attention strip and deadlines |
| runChecks | packed | 4.4 ms | 9 ms | Same |
| planCalendarImport | december | 72.3 ms | 145 ms | Calendar import and the inbox |
| planCalendarImport | packed | 71.6 ms | 144 ms | Same |

### Runner noise

Medians of one run on eleven hosted runs of the perf workflow (Nov 27, main and branches), per call. `max/min` is how far the same code moved between runs, with no change to it.

| Measure | Trip | Fastest | Median | Slowest | max/min | Budget |
|---|---|---|---|---|---|---|
| projectTrip | december | 0.016 ms | 0.029 ms | 0.036 ms | 2.3 | 1 ms |
| projectTrip | packed | 0.061 ms | 0.082 ms | 0.130 ms | 2.1 | 1 ms |
| buildTripGrid | december | 8.8 ms | 12.7 ms | 18.9 ms | 2.2 | 33 ms |
| buildTripGrid | packed | 5.1 ms | 7.5 ms | 11.1 ms | 2.2 | 21 ms |
| buildDays | december | 6.1 ms | 8.6 ms | 11.5 ms | 1.9 | 22 ms |
| buildDays | packed | 2.3 ms | 3.4 ms | 5.1 ms | 2.2 | 10 ms |
| runChecks | december | 12.6 ms | 18.1 ms | 25.1 ms | 2.0 | 46 ms |
| runChecks | packed | 2.4 ms | 3.4 ms | 4.8 ms | 2.0 | 9 ms |
| planCalendarImport | december | 38.9 ms | 56.9 ms | 102.5 ms | 2.6 | 145 ms |
| planCalendarImport | packed | 39.3 ms | 54.7 ms | 94.6 ms | 2.4 | 144 ms |

The same code runs 2 to 2.6 times slower on the slowest hosted runner than on the fastest. Every budget is 2.5 to 3 times the median and about 1.4 times the slowest healthy run, so the budgets do not fire on a bad runner. The price is plain: an absolute budget cannot both tolerate that spread and catch a 2 times regression. A regression to 2 times the median (114 ms for `planCalendarImport`) stays inside its 145 ms budget; one to 3 times (170 ms) fails. A budget tight enough to catch 2 times (about 105 ms) would fail healthy runs on the slowest runners. The budgets are unchanged here, because they change only with a new measurement by the architect.

Each measurement now also records `referenceMs`, the median time of a fixed CPU workload (sorting 60 000 numbers) measured in the same run. Once a few more runs have collected it, the budgets can be expressed against it, which removes the runner speed and would let them sit near 2 times the median. That needs the data first, so it is recorded and not yet used.

These are slower than they look necessary because every time conversion goes through Luxon. Making them faster is welcome; lowering a budget needs a new measurement here.

## MCP get_trip

Median of 21 calls after 8 warm up calls, under the same 12 s wall clock cap. In memory goes through the official MCP client over an in memory transport (service and projection, no network). HTTP is a JSON-RPC `tools/call` with a bearer token against the built app's `/api/mcp`, which adds the proxy, token lookup, a fresh MCP server per request and serialisation. Re-baselined on the hosted runner (perf run on #51): 2 times the median, rounded up to 10 ms.

| Measure | Hosted median | Budget | Reason |
|---|---|---|---|
| get_trip in memory | 55.4 ms | 120 ms | An assistant waiting on a tool call should not feel it |
| get_trip over HTTP | 67.4 ms | 140 ms | Same, plus the request path |

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
| /trips/[tripId]/items/[itemId]/edit | 170,372 B (166.4 kB on the runner) | 183,000 B |
| /invite/join | 136,050 B | 146,000 B |
| /invite/lost | 139,352 B | 150,000 B |
| /invite/problem/[kind] | 136,050 B | 146,000 B |
| /trips/[tripId]/share | 142,153 B | 153,000 B |
| /account | 144,486 B (141.1 kB on the runner) | 155,000 B |
| /trips/[tripId]/settings/delete | 144,384 B (141.0 kB on the runner) | 155,000 B |
| /trips/[tripId]/settings | 145,785 B | 156,000 B |
| /trips/new | 139,957 B | 150,000 B |

About 133 kB of every route is the React and Next.js runtime; the add form adds about 25 kB, and the edit page loads the same form, so it measures the same as /add (170,372 B for both in the same build).

## Lighthouse

`lighthouserc.json` (mobile) and `perf/lighthouserc.desktop.json` (desktop preset), five runs each on the December trip page, deadlines and inbox, signed in as the demo traveller: `perf/prepare-db.ts` writes a session row for the demo user into the throwaway database and the cookie is sent as a request header. The server is the built app started by `perf/serve.ts` on 127.0.0.1 in production mode with the production environment checks on (a placeholder https `APP_URL`, throwaway keys, `TRUST_PROXY=0`); the dev sign in route is not used, because production mode forbids it. `perf/summary.ts` fails the job if any run was redirected away from the page it asked for (a dropped cookie would otherwise measure the sign in page).

Measured on the first CI run with Lighthouse 12.6.1 (`@lhci/cli` 0.15.1, three runs per page). The job now runs `@lhci/cli` 0.16.1, which bundles Lighthouse 13.6.0, to match the Chrome 157 on the runner (the older Lighthouse intermittently failed with `NO_NAVSTART`); if the medians move under the new version, the budgets are re-baselined with the 2 times the median rule. Per page medians on 12.6.1, then the budget:

| Assertion | Mobile CI medians | Mobile budget | Desktop CI medians | Desktop budget |
|---|---|---|---|---|
| Performance score (median run) | 97 to 99 (one outlier run scored 84) | at least 0.9 | 100 | at least 0.95 |
| Largest contentful paint | 1832 to 2343 ms | at most 3000 ms (28 percent over the slowest median, above the slowest single run at 2377 ms) | 577 to 649 ms | at most 1000 ms (54 percent over the slowest run) |
| Cumulative layout shift | 0 | at most 0.1 | 0 | at most 0.1 |
| Total blocking time | 68 to 120 ms (one outlier run at 615 ms) | at most 300 ms | 0 to 39 ms | at most 100 ms |

Layout shift is 0 everywhere, so 0.1 is the Core Web Vitals "good" threshold, not a margin over a measurement; any real shift is visible against 0. Runs were raised from 3 to 5 and every assertion uses the median, so one noisy run on a shared runner does not fail the job. After the next CI run, re-check these medians and tighten if the margins stay large.

Installability is not a Lighthouse assertion: Lighthouse 12.6.1 (the version measured above) has no `installable-manifest` audit, so an assertion on it can never pass. Instead `perf/manifest.perf.test.ts` fetches `/manifest.webmanifest` from the built app, requires a name, short name, start URL, a standalone, fullscreen or minimal-ui display and at least one icon, and requires every icon it names to be served with the right content type. Icon sizes (192 and 512 PNG) belong to WP-15, which should extend that test.

## Proving a budget can fail

Each budget was shown to fail on a deliberately slowed function, locally, not committed:

- An 80 ms busy wait at the top of `projectTrip` failed both `projectTrip` budgets (80.1 and 80.3 ms against 0.04 and 0.15), `get_trip` in memory (116 ms against 100) and over HTTP after a rebuild (121 ms against 110).
- A 5 ms busy wait in `runChecks` failed `runChecks` on the packed trip (7.6 ms against 6); it stayed inside the december budget of 28 ms, as it should.
- A client side import of `city-timezones` failed first load JavaScript on every trip route.
- `buildTripGrid`, `buildDays` and `planCalendarImport` use the same harness and the same check, so a slowdown over 2 times their measurement fails them identically.

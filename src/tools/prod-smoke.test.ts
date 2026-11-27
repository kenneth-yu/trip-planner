import { execFile } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { ask, CHECKS, describe as describeVerdict, judge, PRODUCTION_ORIGIN, runSmoke, validateBase } from "../../tools/ci/prod-smoke-lib.mjs";

const run = promisify(execFile);
const tool = path.join(process.cwd(), "tools", "ci", "prod-smoke.mjs");
const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "prod-smoke.yml"), "utf8");
const [slashSignIn, slashOffline, slashView] = CHECKS.map((c) => c.path);

describe("the pinned production address", () => {
  it("is the literal in the workflow, and the workflow requests nothing else", () => {
    const pinned = workflow.match(/SMOKE_URL: (\S+)/)?.[1];
    expect(pinned).toBe(PRODUCTION_ORIGIN);
    expect(validateBase(pinned).ok).toBe(true);
    expect(workflow).not.toMatch(/inputs\.url|allow-any-host|SMOKE_URL: \$\{\{/);
    expect(workflow).not.toMatch(/SMOKE_URL:.*deployment_status/);
  });

  it.each([PRODUCTION_ORIGIN, `${PRODUCTION_ORIGIN}/`, `${PRODUCTION_ORIGIN}/sign-in?x=1`, PRODUCTION_ORIGIN.toUpperCase(), `${PRODUCTION_ORIGIN}:443`])("accepts %s", (url) => {
    expect(validateBase(url)).toEqual({ ok: true, base: PRODUCTION_ORIGIN });
  });

  it.each([
    ["https://vercel.app", "pinned"],
    ["https://trip-planner-lilac-six.vercel.app.", "pinned"],
    ["https://trip-planner-lilac-seven.vercel.app", "pinned"],
    ["https://a-trip-planner-lilac-six.vercel.app", "pinned"],
    ["https://trip-planner-lilac-six.vercel.app.evil.com", "pinned"],
    ["https://trip-planner-lilac-six.vercel.app@evil.com", "credentials"],
    ["https://user:pw@trip-planner-lilac-six.vercel.app", "credentials"],
    ["https://trip-planner-lilac-six.vercel.app:8443", "credentials or a port"],
    ["http://trip-planner-lilac-six.vercel.app", "not https"],
    ["file:///etc/passwd", "not https"],
    ["javascript:alert(1)", "not https"],
    ["https://169.254.169.254", "pinned"],
    ["https://localhost", "pinned"],
    ["not a url", "not a URL"],
    ["", "not a URL"],
    [undefined, "not a URL"],
  ])("refuses %s", (url, reason) => {
    const verdict = validateBase(url);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain(reason);
  });
});

describe("judging the three requests", () => {
  const good = [
    { path: slashSignIn, status: 200 },
    { path: slashOffline, status: 200 },
    { path: slashView, status: 404 },
  ];

  it("expects 200, 200 and 404", () => {
    expect(CHECKS.map((c) => c.expected)).toEqual([200, 200, 404]);
    expect(judge(good)).toMatchObject({ ok: true, serverError: false });
  });

  it.each([500, 503, 599])("fails on %i and says it is a server error", (status) => {
    const verdict = judge([{ path: slashSignIn, status }, ...good.slice(1)]);
    expect(verdict).toMatchObject({ ok: false, serverError: true });
    expect(describeVerdict(verdict)).toContain(`| ${slashSignIn} | 200 | ${status} | server error |`);
  });

  it.each([0, 301, 302, 401, 403, 429, 499])("fails on %i without calling it a server error", (status) => {
    const verdict = judge([good[0], good[1], { path: slashView, status }]);
    expect(verdict.ok).toBe(false);
    expect(verdict.serverError).toBe(false);
    expect(describeVerdict(verdict)).toContain(`| ${slashView} | 404 | ${status} | unexpected |`);
  });

  it.each([
    ["a bogus view link that answers 200", [good[0], good[1], { path: slashView, status: 200 }]],
    ["an offline page that is missing", [good[0], { path: slashOffline, status: 404 }, good[2]]],
    ["a missing result", [good[0], good[1]]],
  ])("fails on %s", (_name, results) => {
    expect(judge(results).ok).toBe(false);
  });

  it("uses the first result for a path that appears twice and ignores unknown paths", () => {
    expect(judge([{ path: slashSignIn, status: 500 }, { path: slashSignIn, status: 200 }, good[1], good[2]]).ok).toBe(false);
    expect(judge([...good, { path: "/surprise", status: 500 }])).toMatchObject({ ok: true, serverError: false });
  });

  it("describes a request with no answer and says why", () => {
    const verdict = judge([good[0], { path: slashOffline, status: null, cause: "timeout" }, { path: slashView, status: null, cause: "ECONNREFUSED" }]);
    const table = describeVerdict(verdict);
    expect(table).toContain(`| ${slashOffline} | 200 | no answer (timeout) | unexpected |`);
    expect(table).toContain(`| ${slashView} | 404 | no answer (ECONNREFUSED) | unexpected |`);
  });
});

describe("asking a server, with the base given as an argument", () => {
  let server: Server | undefined;
  let hits: string[] = [];
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
    hits = [];
  });

  async function serve(handler: (url: string) => { status: number; location?: string; hang?: boolean }): Promise<string> {
    server = createServer((request, response) => {
      hits.push(request.url ?? "");
      const answer = handler(request.url ?? "");
      if (answer.hang) return;
      response.statusCode = answer.status;
      if (answer.location) response.setHeader("location", answer.location);
      response.end("x");
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  }

  const healthy = (url: string) => ({ status: url === slashView ? 404 : 200 });
  const fast = { attempts: 3, waitMs: 5, timeoutMs: 300 };

  it("passes when the pages answer as expected", async () => {
    const base = await serve(healthy);
    expect(judge(await runSmoke(base, fast)).ok).toBe(true);
  });

  it("does not follow a redirect: it reports the redirect status", async () => {
    const base = await serve((url) => (url === slashSignIn ? { status: 302, location: "/elsewhere" } : healthy(url)));
    const verdict = judge(await runSmoke(base, fast));
    expect(verdict.rows[0]).toMatchObject({ status: 302, ok: false });
    expect(hits).not.toContain("/elsewhere");
  });

  it("reports a timeout as no answer with the cause timeout", async () => {
    const base = await serve((url) => (url === slashOffline ? { status: 200, hang: true } : healthy(url)));
    const result = await ask(base, slashOffline, { timeoutMs: 150 });
    expect(result).toEqual({ path: slashOffline, status: null, cause: "timeout" });
  });

  it("reports a refused connection with its cause", async () => {
    const base = await serve(healthy);
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    const result = await ask(base, slashSignIn, { timeoutMs: 1000 });
    expect(result.status).toBeNull();
    expect(result.cause).toBe("ECONNREFUSED");
  });

  it("tries a failing check up to three times and reports the final status", async () => {
    let calls = 0;
    const base = await serve((url) => {
      if (url !== slashSignIn) return healthy(url);
      calls += 1;
      return { status: calls < 3 ? 503 : 200 };
    });
    const verdict = judge(await runSmoke(base, fast));
    expect(calls).toBe(3);
    expect(verdict.ok).toBe(true);
  });

  it("gives up after three attempts and reports the last status", async () => {
    let calls = 0;
    const base = await serve((url) => {
      if (url !== slashSignIn) return healthy(url);
      calls += 1;
      return { status: 502 };
    });
    const verdict = judge(await runSmoke(base, fast));
    expect(calls).toBe(3);
    expect(verdict.rows[0]).toMatchObject({ status: 502, server: true });
  });

  it("does not retry a wrong status that is not a server error", async () => {
    let calls = 0;
    const base = await serve((url) => {
      if (url !== slashView) return healthy(url);
      calls += 1;
      return { status: 200 };
    });
    await runSmoke(base, fast);
    expect(calls).toBe(1);
  });
});

describe("the command line step", () => {
  async function smoke(env: Record<string, string>) {
    const report = path.join(os.tmpdir(), `smoke-report-${process.pid}-${Math.random().toString(36).slice(2)}.md`);
    try {
      const { stdout } = await run(process.execPath, [tool], { env: { ...process.env, SMOKE_REPORT: report, ...env } });
      return { status: 0, stdout, report: readFileSync(report, "utf8") };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && "stdout" in error) {
        let written = "";
        try {
          written = readFileSync(report, "utf8");
        } catch (readError) {
          if (!(readError instanceof Error && "code" in readError && readError.code === "ENOENT")) throw readError;
        }
        return { status: Number(error.code), stdout: String(error.stdout), report: written };
      }
      throw error;
    } finally {
      rmSync(report, { force: true });
    }
  }

  it.each([["an address that is not the pinned one", "https://example.com"], ["no address at all", ""], ["a plain http address", "http://trip-planner-lilac-six.vercel.app"]])("refuses %s, exits 2 and still writes the report", async (_name, url) => {
    const result = await smoke({ SMOKE_URL: url });
    expect(result.status).toBe(2);
    expect(result.report).toContain("did not run: the address was refused");
  });
});

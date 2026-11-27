import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { CHECKS, describe as describeVerdict, judge, validateBase } from "../../tools/ci/prod-smoke-lib.mjs";

const run = promisify(execFile);
const tool = path.join(process.cwd(), "tools", "ci", "prod-smoke.mjs");

describe("the address the smoke test may visit", () => {
  it.each(["https://trip-planner.vercel.app", "https://trip-planner-git-main-myself.vercel.app/", "https://a.b.vercel.app/sign-in?x=1"])("accepts %s", (url) => {
    expect(validateBase(url).ok).toBe(true);
  });

  it.each([
    ["http://trip-planner.vercel.app", "not https"],
    ["https://evil.example.com", "not a vercel.app address"],
    ["https://vercel.app.evil.com", "not a vercel.app address"],
    ["https://evilvercel.app", "not a vercel.app address"],
    ["https://user:pw@trip-planner.vercel.app", "credentials"],
    ["https://trip-planner.vercel.app:8443", "credentials or a port"],
    ["https://169.254.169.254", "not a vercel.app address"],
    ["https://localhost", "not a vercel.app address"],
    ["not a url", "not a URL"],
    ["", "not a URL"],
    [undefined, "not a URL"],
  ])("refuses %s", (url, reason) => {
    const verdict = validateBase(url);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain(reason);
  });

  it("keeps only the origin", () => {
    expect(validateBase("https://trip-planner.vercel.app/some/path?q=1")).toEqual({ ok: true, base: "https://trip-planner.vercel.app" });
  });
});

describe("judging the three requests", () => {
  const good = [{ path: "/sign-in", status: 200 }, { path: "/offline", status: 200 }, { path: "/v/not-a-real-view-link-token", status: 404 }];

  it("expects 200, 200 and 404", () => {
    expect(CHECKS.map((c) => c.expected)).toEqual([200, 200, 404]);
    expect(judge(good)).toMatchObject({ ok: true, serverError: false });
  });

  it("fails on any 5xx and says it is a server error", () => {
    const verdict = judge([{ path: "/sign-in", status: 500 }, ...good.slice(1)]);
    expect(verdict).toMatchObject({ ok: false, serverError: true });
    expect(describeVerdict(verdict)).toContain("| /sign-in | 200 | 500 | server error |");
  });

  it.each([
    ["a bogus view link that answers 200", [good[0], good[1], { path: good[2].path, status: 200 }]],
    ["a sign in page that redirects", [{ path: "/sign-in", status: 302 }, good[1], good[2]]],
    ["an offline page that is missing", [good[0], { path: "/offline", status: 404 }, good[2]]],
    ["a request with no answer", [good[0], { path: "/offline", status: null }, good[2]]],
    ["a missing result", [good[0], good[1]]],
  ])("fails on %s, without calling it a server error", (_name, results) => {
    const verdict = judge(results);
    expect(verdict.ok).toBe(false);
    expect(verdict.serverError).toBe(false);
  });
});

describe("the command line step against a local server", () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function serve(answers: Record<string, number>): Promise<string> {
    server = createServer((request, response) => {
      response.statusCode = answers[request.url ?? ""] ?? 404;
      response.end("x");
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  }

  async function smoke(url: string, args: string[] = ["--allow-any-host"]) {
    try {
      const { stdout } = await run(process.execPath, [tool, ...args], { env: { NODE_ENV: "development", PATH: process.env.PATH ?? "", SMOKE_URL: url } });
      return { status: 0, stdout };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && "stdout" in error && "stderr" in error) return { status: Number(error.code), stdout: String(error.stdout), stderr: String(error.stderr) };
      throw error;
    }
  }

  it("passes when the pages answer as expected", async () => {
    const url = await serve({ "/sign-in": 200, "/offline": 200 });
    const result = await smoke(url);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("| /v/not-a-real-view-link-token | 404 | 404 | ok |");
  });

  it("fails on a 5xx and prints the table", async () => {
    const url = await serve({ "/sign-in": 200, "/offline": 503 });
    const result = await smoke(url);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("| /offline | 200 | 503 | server error |");
  });

  it("fails when nothing answers", async () => {
    const result = await smoke("http://127.0.0.1:9");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("no answer");
  });

  it("refuses an address that is not a vercel.app address unless told to allow any host, before making a request", async () => {
    const url = await serve({ "/sign-in": 200, "/offline": 200 });
    const result = await smoke(url, []);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("was refused");
  });
});

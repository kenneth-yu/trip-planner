import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ruleForRequest } from "./rate-limit";

const APP_DIR = path.join(import.meta.dirname, "..", "..", "app");
const LIMIT_CALLS = new Set(["consumeRateLimit", "spendSignInAttempt"]);
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const ROUTE_ALLOWLIST: Record<string, string> = {
  "/api/auth/[...nextauth]": "Auth.js serves session and csrf reads here; its sign in, callback and email paths are limited by the proxy (asserted below).",
  "/api/dev/outbox": "Answers 404 unless DEV_SIGN_IN is on; never reachable in production.",
  "/api/dev/sign-in": "Answers 404 unless DEV_SIGN_IN is on; never reachable in production.",
  "/api/google/connect": "Signed in redirect to Google carrying a sealed, 10 minute state; reveals nothing and tries no secret.",
  "/api/google/callback": "Needs a sealed state minted for the signed in user and a Google code; nothing here can be guessed by repeated calls.",
};

const ACTION_ALLOWLIST: Record<string, string> = {
  "src/app/sign-out/actions.ts#signOutAction": "Spends nothing by design (docs/SECURITY.md rule 8): it only clears the caller's own session.",
  "src/app/trips/new/actions.ts#createTripAction": "Signed in, creates only the caller's own empty trip; SECURITY.md lists no per person limit for it.",
  "src/app/trips/[tripId]/actions.ts#decideEntry": "Signed in and permission checked in the service; SECURITY.md lists no per person limit for it.",
  "src/app/trips/[tripId]/actions.ts#addAllClean": "Signed in and permission checked in the service; SECURITY.md lists no per person limit for it.",
  "src/app/trips/[tripId]/actions.ts#connectAssistant": "Signed in and owner checked in the service; SECURITY.md lists no per person limit for it.",
  "src/app/trips/[tripId]/actions.ts#revokeAssistant": "Signed in and owner checked in the service; SECURITY.md lists no per person limit for it.",
  "src/app/trips/[tripId]/actions.ts#mirrorAction": "Signed in and checked in the service; SECURITY.md lists no per person limit for it.",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function callsLimiter(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && LIMIT_CALLS.has(n.expression.text)) found = true;
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function hasUseServer(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return first !== undefined && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
}

function routePaths(files: string[]): { route: string; methods: string[]; file: string }[] {
  return files
    .filter((f) => /[\\/]api[\\/].*route\.ts$/.test(f))
    .map((file) => {
      const source = parse(file);
      const route = "/" + path.relative(APP_DIR, path.dirname(file)).split(path.sep).join("/");
      const names: string[] = [];
      for (const s of source.statements) {
        if (ts.isFunctionDeclaration(s) && isExported(s) && s.name) names.push(s.name.text);
        if (ts.isExportDeclaration(s) && s.exportClause && ts.isNamedExports(s.exportClause)) for (const e of s.exportClause.elements) names.push(e.name.text);
        if (ts.isVariableStatement(s) && isExported(s)) {
          for (const d of s.declarationList.declarations) {
            if (ts.isIdentifier(d.name)) names.push(d.name.text);
            if (ts.isObjectBindingPattern(d.name)) for (const e of d.name.elements) if (ts.isIdentifier(e.name)) names.push(e.name.text);
          }
        }
      }
      return { route, methods: names.filter((n) => HTTP_METHODS.includes(n)), file };
    })
    .filter((r) => r.methods.length > 0);
}

function serverActions(files: string[]): { id: string; limited: boolean }[] {
  const root = path.join(APP_DIR, "..", "..");
  return files
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .flatMap((file) => {
      const source = parse(file);
      if (!hasUseServer(source)) return [];
      const rel = path.relative(root, file).split(path.sep).join("/");
      const out: { id: string; limited: boolean }[] = [];
      for (const s of source.statements) {
        if (ts.isFunctionDeclaration(s) && isExported(s) && s.name) out.push({ id: `${rel}#${s.name.text}`, limited: callsLimiter(s) });
        if (ts.isVariableStatement(s) && isExported(s)) {
          for (const d of s.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.initializer) out.push({ id: `${rel}#${d.name.text}`, limited: callsLimiter(d.initializer) });
          }
        }
      }
      return out;
    });
}

const files = walk(APP_DIR);

function sample(route: string): string {
  return route.replace(/\[\[\.\.\.[^\]]+\]\]/g, "x").replace(/\[\.\.\.[^\]]+\]/g, "x").replace(/\[[^\]]+\]/g, "x");
}

describe("rate limit coverage", () => {
  const routes = routePaths(files);
  const actions = serverActions(files);

  it("finds the route handlers and server actions it is meant to guard", () => {
    expect(routes.map((r) => r.route)).toContain("/api/mcp/[[...token]]");
    expect(actions.map((a) => a.id)).toContain("src/app/trips/[tripId]/add/actions.ts#addItem");
  });

  it.each(routes.map((r) => [r.route, r] as const))("route handler %s has a rate limit rule or a reasoned allowlist entry", (route, info) => {
    const covered = info.methods.every((m) => ruleForRequest(m, sample(route)) !== null);
    const reason = ROUTE_ALLOWLIST[route];
    expect(
      covered || reason !== undefined,
      `${route} has no rate limit rule. Add a rule in REQUEST_RULES in src/server/security/rate-limit.ts and src/proxy.ts will apply it, or, if abuse here cannot matter, add the route to ROUTE_ALLOWLIST in this test with the reason.`,
    ).toBe(true);
    expect(covered && reason !== undefined, `${route} is covered by a rule now. Remove its stale ROUTE_ALLOWLIST entry.`).toBe(false);
  });

  it.each(actions.map((a) => [a.id, a] as const))("server action %s spends a rate limit or has a reasoned allowlist entry", (id, info) => {
    const reason = ACTION_ALLOWLIST[id];
    expect(
      info.limited || reason !== undefined,
      `${id} never calls consumeRateLimit or spendSignInAttempt. Spend a rule from RATE_RULES per person (see addItem) or, if abuse here cannot matter, add the action to ACTION_ALLOWLIST in this test with the reason.`,
    ).toBe(true);
    expect(info.limited && reason !== undefined, `${id} limits itself now. Remove its stale ACTION_ALLOWLIST entry.`).toBe(false);
  });

  it("keeps no allowlist entry for a route or action that no longer exists", () => {
    const routeNames = new Set(routes.map((r) => r.route));
    const actionIds = new Set(actions.map((a) => a.id));
    expect(Object.keys(ROUTE_ALLOWLIST).filter((r) => !routeNames.has(r))).toEqual([]);
    expect(Object.keys(ACTION_ALLOWLIST).filter((a) => !actionIds.has(a))).toEqual([]);
  });

  it("still limits the Auth.js sign in, callback and email paths that the nextauth allowlist relies on", () => {
    for (const p of ["/api/auth/signin/google", "/api/auth/callback/google", "/api/auth/email"]) expect(ruleForRequest("POST", p)?.name, p).toBe("signIn");
  });

  it("detects an unguarded handler and an unguarded action in source it is given", () => {
    const fakeActions = ts.createSourceFile("a.ts", `"use server"; export async function x() { return 1; } export async function y() { await consumeRateLimit(); }`, ts.ScriptTarget.Latest, true);
    expect(hasUseServer(fakeActions)).toBe(true);
    const bodies = fakeActions.statements.filter(ts.isFunctionDeclaration).map((f) => callsLimiter(f));
    expect(bodies).toEqual([false, true]);
  });
});

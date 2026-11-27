export const CHECKS = [
  { path: "/sign-in", expected: 200 },
  { path: "/offline", expected: 200 },
  { path: "/v/not-a-real-view-link-token", expected: 404 },
];

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.vercel\.app$/;

export function validateBase(url, { anyHost = false } = {}) {
  const parsed = URL.parse(url ?? "");
  if (!parsed) return { ok: false, reason: "the address is not a URL" };
  if (anyHost) return { ok: true, base: parsed.origin };
  if (parsed.protocol !== "https:") return { ok: false, reason: "the address is not https" };
  if (parsed.username || parsed.password || parsed.port) return { ok: false, reason: "the address carries credentials or a port" };
  if (!HOST.test(parsed.hostname)) return { ok: false, reason: "the host is not a vercel.app address" };
  return { ok: true, base: parsed.origin };
}

export function judge(results) {
  const rows = CHECKS.map((check) => {
    const result = results.find((r) => r.path === check.path);
    const status = result ? result.status : null;
    const server = status !== null && status >= 500;
    const ok = status === check.expected;
    return { path: check.path, expected: check.expected, status, ok, server };
  });
  return { ok: rows.every((row) => row.ok), serverError: rows.some((row) => row.server), rows };
}

export function describe(verdict) {
  const lines = verdict.rows.map((row) => `| ${row.path} | ${row.expected} | ${row.status === null ? "no answer" : row.status} | ${row.ok ? "ok" : row.server ? "server error" : "unexpected"} |`);
  return ["| Path | Expected | Got | Result |", "|---|---|---|---|", ...lines].join("\n");
}

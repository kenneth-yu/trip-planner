export const PRODUCTION_ORIGIN = "https://trip-planner-lilac-six.vercel.app";

export const CHECKS = [
  { path: "/sign-in", expected: 200 },
  { path: "/offline", expected: 200 },
  { path: "/v/not-a-real-view-link-token", expected: 404 },
];

export function validateBase(url, pinned = PRODUCTION_ORIGIN) {
  const parsed = URL.parse(url ?? "");
  const wanted = URL.parse(pinned);
  if (!parsed || !wanted) return { ok: false, reason: "the address is not a URL" };
  if (parsed.protocol !== "https:") return { ok: false, reason: "the address is not https" };
  if (parsed.username || parsed.password || parsed.port) return { ok: false, reason: "the address carries credentials or a port" };
  if (parsed.origin !== wanted.origin) return { ok: false, reason: "the address is not the pinned production address" };
  return { ok: true, base: parsed.origin };
}

function codeIn(value, depth) {
  if (!value || typeof value !== "object" || depth > 3) return null;
  if ("code" in value && typeof value.code === "string" && /^[A-Z0-9_]{3,40}$/.test(value.code)) return value.code;
  if ("cause" in value) {
    const found = codeIn(value.cause, depth + 1);
    if (found) return found;
  }
  if ("errors" in value && Array.isArray(value.errors)) {
    for (const inner of value.errors) {
      const found = codeIn(inner, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function causeOf(error) {
  if (error && typeof error === "object" && "name" in error && error.name === "TimeoutError") return "timeout";
  return codeIn(error, 0) ?? "network error";
}

export async function ask(base, path, { timeoutMs = 20000, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(`${base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "trip-planner-prod-smoke" } });
    await response.arrayBuffer();
    return { path, status: response.status, cause: null };
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "TypeError" || error.name === "AbortError")) return { path, status: null, cause: causeOf(error) };
    throw error;
  }
}

const retryable = (result) => result.status === null || result.status >= 500;

export async function runSmoke(base, { attempts = 3, waitMs = 10000, timeoutMs = 20000, fetchImpl = fetch } = {}) {
  const results = [];
  for (const check of CHECKS) {
    let result = await ask(base, check.path, { timeoutMs, fetchImpl });
    for (let attempt = 1; attempt < attempts && retryable(result); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      result = await ask(base, check.path, { timeoutMs, fetchImpl });
    }
    results.push(result);
  }
  return results;
}

export function judge(results) {
  const rows = CHECKS.map((check) => {
    const result = results.find((r) => r.path === check.path);
    const status = result ? result.status : null;
    return { path: check.path, expected: check.expected, status, cause: result ? (result.cause ?? null) : null, ok: status === check.expected, server: status !== null && status >= 500 };
  });
  return { ok: rows.every((row) => row.ok), serverError: rows.some((row) => row.server), rows };
}

export function describe(verdict) {
  const lines = verdict.rows.map((row) => {
    const got = row.status === null ? `no answer${row.cause ? ` (${row.cause})` : ""}` : String(row.status);
    return `| ${row.path} | ${row.expected} | ${got} | ${row.ok ? "ok" : row.server ? "server error" : "unexpected"} |`;
  });
  return ["| Path | Expected | Got | Result |", "|---|---|---|---|", ...lines].join("\n");
}

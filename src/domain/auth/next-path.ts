const PLACEHOLDER_ORIGIN = "https://placeholder.invalid";
const MAX_LENGTH = 2048;

function decodesToUnsafe(value: string): boolean {
  let current = value;
  for (let i = 0; i < 3; i++) {
    if (/[\\\u0000-\u001f\u007f]/.test(current)) return true;
    if (current.startsWith("//")) return true;
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return true;
    }
    if (next === current) return false;
    current = next;
  }
  return true;
}

export function safeNextPath(next: string | null | undefined): string {
  if (!next || next.length > MAX_LENGTH) return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (decodesToUnsafe(next)) return "/";
  const parsed = new URL(next, PLACEHOLDER_ORIGIN);
  if (parsed.origin !== PLACEHOLDER_ORIGIN) return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function signInPath(next: string | null | undefined): string {
  const safe = safeNextPath(next);
  return safe === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(safe)}`;
}

export function isInvitePath(path: string): boolean {
  return path.startsWith("/invite/");
}

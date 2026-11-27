export const OFFLINE_COPY = {
  heading: "Your trip can't load right now.",
  reconnect: "You may be offline, or the connection is too slow. Try again in a moment.",
  screenshots: "If you saved screenshots of your bookings, they are in your photos.",
  retry: "Try again",
};

const STYLES = `
:root { color-scheme: light dark; --ground: #ffffff; --text: #16181b; --muted: #5e646c; }
@media (prefers-color-scheme: dark) { :root { --ground: #0f1113; --text: #eceef0; --muted: #9aa1a9; } }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--ground); color: var(--text); }
body { font-family: system-ui, sans-serif; font-size: 1.0625rem; line-height: 1.5; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
main { max-width: 40rem; margin: 0 auto; padding: 48px 16px; }
h1 { font-size: 1.25rem; margin: 0 0 12px; }
p { margin: 0 0 12px; }
.secondary { color: var(--muted); }
button { font: inherit; font-weight: 700; color: var(--ground); background: var(--text); border: 0; border-radius: 6px; min-height: 44px; min-width: 44px; padding: 10px 20px; margin-top: 12px; cursor: pointer; }
`;

const RELOAD_SCRIPT = `document.getElementById("try-again").addEventListener("click", function () { location.reload(); });`;

export function offlineHtml(nonce: string | null): string {
  const nonceAttribute = nonce === null ? "" : ` nonce="${nonce}"`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1113" media="(prefers-color-scheme: dark)">
<title>Offline</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<h1>${OFFLINE_COPY.heading}</h1>
<p>${OFFLINE_COPY.reconnect}</p>
<p class="secondary">${OFFLINE_COPY.screenshots}</p>
<button type="button" id="try-again">${OFFLINE_COPY.retry}</button>
</main>
<script${nonceAttribute}>${RELOAD_SCRIPT}</script>
</body>
</html>
`;
}

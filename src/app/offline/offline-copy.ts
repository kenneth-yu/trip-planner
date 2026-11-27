export const OFFLINE_COPY = {
  heading: "You are offline.",
  reconnect: "Your trip will show again when you have a connection.",
  screenshots: "If you saved screenshots of your bookings, they are in your photos.",
  retry: "Try again",
};

export const OFFLINE_STYLES = `
.offline { max-width: 40rem; margin: 0 auto; padding: 48px var(--gutter, 16px); }
.offline h1 { font-size: 1.25rem; margin: 0 0 12px; }
.offline p { margin: 0 0 12px; }
.offline .secondary { color: var(--muted, #5e646c); }
.offline button { min-height: 44px; min-width: 44px; padding: 10px 20px; margin-top: 12px; }
`;

export const RELOAD_SCRIPT = `document.getElementById("try-again").addEventListener("click", function () { location.reload(); });`;

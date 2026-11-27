import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8");
const darkStart = css.indexOf("prefers-color-scheme: dark");
const modes = { light: css.slice(0, darkStart), dark: css.slice(darkStart) };

function colour(block: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  if (!m) throw new Error(`--${name} is not defined as a hex colour`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("the neutral panel", () => {
  for (const [mode, block] of Object.entries(modes)) {
    for (const foreground of ["text", "muted", "warning"]) {
      it(`${foreground} on the soft ground is at least 4.5 to 1 in ${mode} mode`, () => {
        const fallback = mode === "dark" ? colour(modes.light, "soft") : "";
        const soft = /--soft:\s*#/.test(block) ? colour(block, "soft") : fallback;
        const fg = /--(?:text|muted|warning):/.test(block) && new RegExp(`--${foreground}:`).test(block) ? colour(block, foreground) : colour(modes.light, foreground);
        expect(ratio(fg, soft)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

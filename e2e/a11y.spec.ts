import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { contrastRatio, FORM_BORDER_MIN_CONTRAST, over, parseColor, type Rgba } from "./a11y-contrast";
import { PAGES, pageRoutesInApp } from "./a11y-pages";

const MIN_TARGET_PX = 44;
const SCHEMES = ["light", "dark"] as const;

test.setTimeout(120_000);

interface FieldReading {
  description: string;
  borderColor: string;
  borderWidth: number;
  layers: string[];
}

interface TargetReading {
  description: string;
  width: number;
  height: number;
}

async function open(page: Page, path: string, status = 200): Promise<void> {
  const response = await page.goto(path, { waitUntil: "load" });
  expect(response?.status(), `${path} answered ${response?.status()}`).toBe(status);
  await expect(page.locator("main")).toBeVisible();
}

async function readFields(page: Page): Promise<FieldReading[]> {
  return page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll("input, select, textarea")).filter((el) => {
      if (el instanceof HTMLInputElement && ["hidden", "checkbox", "radio", "submit", "button", "reset", "image", "file", "range", "color"].includes(el.type)) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 1 && rect.height > 1 && style.visibility === "visible";
    });
    return controls.map((el) => {
      const style = getComputedStyle(el);
      const layers: string[] = [];
      for (let node: Element | null = el; node; node = node.parentElement) layers.push(getComputedStyle(node).backgroundColor);
      const name = el.getAttribute("name") ?? el.getAttribute("id") ?? el.tagName.toLowerCase();
      return {
        description: `${el.tagName.toLowerCase()}[${name}]`,
        borderColor: style.borderBottomStyle === "none" ? "rgba(0, 0, 0, 0)" : style.borderBottomColor,
        borderWidth: style.borderBottomStyle === "none" ? 0 : parseFloat(style.borderBottomWidth),
        layers,
      };
    });
  });
}

async function readTargets(page: Page): Promise<TargetReading[]> {
  return page.evaluate(() => {
    const selector = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem]";
    const out: { description: string; width: number; height: number }[] = [];
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const style = getComputedStyle(el);
      if (style.visibility !== "visible" || style.display === "none") continue;
      if (el.tagName === "A" && style.display === "inline") continue;
      const box = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? (el.closest("label") ?? el) : el;
      const rect = box.getBoundingClientRect();
      if (rect.width <= 1 && rect.height <= 1) continue;
      const label = (el.getAttribute("aria-label") ?? el.textContent ?? el.getAttribute("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      out.push({ description: `${el.tagName.toLowerCase()} "${label}"`, width: rect.width, height: rect.height });
    }
    return out;
  });
}

function backdrop(layers: string[]): Rgba {
  let colour: Rgba = { r: 255, g: 255, b: 255, a: 1 };
  for (const layer of [...layers].reverse()) colour = over(parseColor(layer), colour);
  return colour;
}

function borderContrast(field: FieldReading): number {
  const ground = backdrop(field.layers);
  const border = over(parseColor(field.borderColor), ground);
  return contrastRatio(border, ground);
}

test.describe("accessibility gate", () => {
  test("every page route in src/app is on the accessibility list", () => {
    const covered = new Set(PAGES.map((p) => p.route));
    const missing = pageRoutesInApp().filter((route) => !covered.has(route));
    expect(missing, `These pages are not checked for accessibility. Add each to PAGES in e2e/a11y-pages.ts with a demo trip that shows real content: ${missing.join(", ")}`).toEqual([]);
  });

  for (const scheme of SCHEMES) {
    for (const entry of PAGES) {
      test(`${entry.label} (${scheme}) has no serious axe violation, ${FORM_BORDER_MIN_CONTRAST} to 1 field borders and ${MIN_TARGET_PX}px tap targets`, async ({ browser }) => {
        const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 844 } });
        try {
          const page = await context.newPage();
          if (entry.signedIn) await page.goto("/api/dev/sign-in?as=kenny&next=/");
          await open(page, entry.path, entry.status);

          const results = await new AxeBuilder({ page }).analyze();
          const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
          const summary = serious.map((v) => `${v.id} (${v.impact}): ${v.help}. ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("; ")}`);
          expect.soft(summary, `Fix each cause in the component, not by silencing the rule. ${entry.path}`).toEqual([]);

          const weak = (await readFields(page))
            .map((f) => ({ f, ratio: f.borderWidth < 1 ? 1 : borderContrast(f) }))
            .filter((x) => x.ratio < FORM_BORDER_MIN_CONTRAST)
            .map((x) => `${x.f.description} border is ${x.ratio.toFixed(2)} to 1`);
          expect.soft(weak, `Use a border colour with at least ${FORM_BORDER_MIN_CONTRAST} to 1 against the field's surroundings, as one CSS variable shared by every field. ${entry.path}`).toEqual([]);

          if (scheme === "light") {
            const small = (await readTargets(page)).filter((t) => t.width < MIN_TARGET_PX - 0.5 || t.height < MIN_TARGET_PX - 0.5);
            const sizes = small.map((t) => `${t.description} is ${Math.round(t.width)} by ${Math.round(t.height)}`);
            expect.soft(sizes, `Give each control a min-height and min-width of ${MIN_TARGET_PX}px (padding counts), or make it inline text in a sentence. ${entry.path}`).toEqual([]);
          }
        } finally {
          await context.close();
        }
      });
    }
  }
});

test.describe("contrast helper", () => {
  test("passes a border at 3 to 1 and rejects one at about 1.25 to 1", () => {
    const white: Rgba = { r: 255, g: 255, b: 255, a: 1 };
    expect(contrastRatio(parseColor("rgb(118, 118, 118)"), white)).toBeGreaterThanOrEqual(FORM_BORDER_MIN_CONTRAST);
    expect(contrastRatio(parseColor("rgb(224, 224, 224)"), white)).toBeLessThan(FORM_BORDER_MIN_CONTRAST);
  });

  test("blends translucent and color(srgb) colours over the page before measuring", () => {
    const white: Rgba = { r: 255, g: 255, b: 255, a: 1 };
    const faint = over(parseColor("color(srgb 0 0 0 / 0.1)"), white);
    expect(contrastRatio(faint, white)).toBeLessThan(FORM_BORDER_MIN_CONTRAST);
    const strong = over(parseColor("rgba(0, 0, 0, 0.6)"), white);
    expect(contrastRatio(strong, white)).toBeGreaterThanOrEqual(FORM_BORDER_MIN_CONTRAST);
  });
});

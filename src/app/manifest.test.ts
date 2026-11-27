import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

const publicDir = path.join(import.meta.dirname, "..", "..", "public");

function pngSize(file: string) {
  const bytes = readFileSync(path.join(publicDir, file));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("manifest", () => {
  const m = manifest();
  const icons = m.icons ?? [];

  it("identifies the app and installs it standalone", () => {
    expect(m).toMatchObject({ id: "/", scope: "/", start_url: "/", display: "standalone", name: "Trip planner", short_name: "Trips" });
    expect(m.short_name?.length).toBeLessThanOrEqual(12);
  });

  it("lists icons at 192 any, 512 any, 512 maskable and the svg", () => {
    expect(icons.map((i) => [i.src, i.sizes, i.purpose])).toEqual([
      ["/icon-192.png", "192x192", "any"],
      ["/icon-512.png", "512x512", "any"],
      ["/icon-maskable-512.png", "512x512", "maskable"],
      ["/icon.svg", "any", "any"],
    ]);
  });

  it("points every png icon at a file in public with the declared size", () => {
    for (const icon of icons.filter((i) => i.type === "image/png")) {
      const [w, h] = (icon.sizes ?? "").split("x").map(Number);
      expect(pngSize(icon.src.slice(1))).toEqual({ width: w, height: h });
    }
  });

  it("has an apple touch icon at 180 by 180", () => {
    expect(pngSize("apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });

  it("offers no shortcuts, screenshots, categories or description", () => {
    for (const key of ["shortcuts", "screenshots", "categories", "description"]) expect(m).not.toHaveProperty(key);
  });
});

describe("generated icons", () => {
  async function lightPixels(file: string) {
    const { data, info } = await sharp(path.join(publicDir, file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const lit: { x: number; y: number }[] = [];
    for (let i = 0; i < info.width * info.height; i++) {
      if (data[i * 3] > 128) lit.push({ x: i % info.width, y: Math.floor(i / info.width) });
    }
    return { lit, size: info.width };
  }

  it("keeps the maskable strokes inside the 80 percent safe-zone circle", async () => {
    const { lit, size } = await lightPixels("icon-maskable-512.png");
    expect(lit.length).toBeGreaterThan(0);
    const centre = size / 2;
    const radius = (size * 0.8) / 2;
    for (const { x, y } of lit) expect(Math.hypot(x + 0.5 - centre, y + 0.5 - centre)).toBeLessThanOrEqual(radius);
  });

  it("makes the maskable and apple icons fully opaque", async () => {
    for (const file of ["icon-maskable-512.png", "apple-touch-icon.png"]) {
      const meta = await sharp(path.join(publicDir, file)).metadata();
      expect(meta.hasAlpha).toBe(false);
    }
  });
});

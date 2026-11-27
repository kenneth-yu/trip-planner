import { describe, expect, inject, it } from "vitest";
import { z } from "zod";

const Manifest = z.object({
  name: z.string().min(1),
  short_name: z.string().min(1),
  start_url: z.string().min(1),
  display: z.enum(["standalone", "fullscreen", "minimal-ui"]),
  icons: z.array(z.object({ src: z.string().min(1), sizes: z.string().min(1), type: z.string().min(1) })).min(1),
});

describe("installability of the built app", () => {
  it("serves a manifest with the fields an installable app needs, and every icon it names", async () => {
    const base = inject("perfBaseUrl");
    const res = await fetch(`${base}/manifest.webmanifest`);
    expect(res.status).toBe(200);
    const manifest = Manifest.parse(await res.json());
    for (const icon of manifest.icons) {
      const served = await fetch(new URL(icon.src, base));
      expect(served.status, `icon ${icon.src}`).toBe(200);
      expect(served.headers.get("content-type")).toContain(icon.type.split("/")[1]);
    }
  });
});

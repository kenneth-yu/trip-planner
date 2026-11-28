export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const SRGB = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/;
const RGB = /^rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+%?))?\)$/;

function alphaOf(raw: string | undefined): number {
  if (raw === undefined) return 1;
  return raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
}

export function parseColor(css: string): Rgba {
  const srgb = SRGB.exec(css);
  if (srgb) return { r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255, a: alphaOf(srgb[4]) };
  const rgb = RGB.exec(css);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alphaOf(rgb[4]) };
  throw new Error(`Cannot read the colour "${css}". Teach parseColor in e2e/a11y-contrast.ts this format.`);
}

export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(c: Rgba): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const FORM_BORDER_MIN_CONTRAST = 3;

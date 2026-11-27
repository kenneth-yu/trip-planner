import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const publicDir = path.join(import.meta.dirname, "..", "public");
const GROUND = "#16181b";
const STROKES = `<path d="M128 300h256M128 212h160" stroke="#fff" stroke-width="36" stroke-linecap="round"/>`;

const roundedSvg = readFileSync(path.join(publicDir, "icon.svg"));
const fullBleedSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${GROUND}"/>${STROKES}</svg>`,
);

const targets = [
  { file: "icon-192.png", size: 192, source: roundedSvg },
  { file: "icon-512.png", size: 512, source: roundedSvg },
  { file: "icon-maskable-512.png", size: 512, source: fullBleedSvg },
  { file: "apple-touch-icon.png", size: 180, source: fullBleedSvg },
];

for (const { file, size, source } of targets) {
  const image = sharp(source, { density: ((72 * size) / 512) * 4 }).resize(size, size);
  await (source === fullBleedSvg ? image.removeAlpha() : image)
    .png()
    .toFile(path.join(publicDir, file));
}

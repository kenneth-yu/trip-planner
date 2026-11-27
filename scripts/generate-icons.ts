import { readFileSync, writeFileSync } from "node:fs";
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

const FAVICON_SIZE = 48;
const faviconPng = await sharp(roundedSvg, { density: 72 * 2 }).resize(FAVICON_SIZE, FAVICON_SIZE).png().toBuffer();
const iconDirectory = Buffer.alloc(22);
iconDirectory.writeUInt16LE(1, 2);
iconDirectory.writeUInt16LE(1, 4);
iconDirectory.writeUInt8(FAVICON_SIZE, 6);
iconDirectory.writeUInt8(FAVICON_SIZE, 7);
iconDirectory.writeUInt16LE(1, 10);
iconDirectory.writeUInt16LE(32, 12);
iconDirectory.writeUInt32LE(faviconPng.length, 14);
iconDirectory.writeUInt32LE(iconDirectory.length, 18);
writeFileSync(path.join(import.meta.dirname, "..", "src", "app", "favicon.ico"), Buffer.concat([iconDirectory, faviconPng]));

import fc from "fast-check";

const CI_SEED = 20261127;

function seedFromEnvironment(): number {
  const fromEnv = process.env.FUZZ_SEED;
  if (fromEnv !== undefined && /^-?\d+$/.test(fromEnv)) return Number(fromEnv);
  if (process.env.CI) return CI_SEED;
  return Math.floor(Math.random() * 2 ** 31);
}

export const FUZZ_SEED = seedFromEnvironment();

export function fuzzParams(numRuns = 300): fc.Parameters<unknown> {
  return { seed: FUZZ_SEED, numRuns };
}

export const garbageText = fc.oneof(
  fc.string({ unit: "binary", maxLength: 80 }),
  fc.string({ unit: "grapheme", maxLength: 80 }),
  fc.constantFrom("", " ", "\u0000", "‮", "\ud83d", "NH159", "CX 509", "(JFK)", "JFK → HND", "→", "<script>", "${x}", "__proto__", "constructor", "ＮＨ１５９", "İstanbul (IST)", "a".repeat(20000)),
);

export const hugeText = fc.integer({ min: 5000, max: 60000 }).chain((n) =>
  fc.constantFrom("NH159 ", "free cancellation until ", "JFK HND ", "Check in 3pm ", "é ").map((chunk) => chunk.repeat(Math.ceil(n / chunk.length))),
);

export const garbageZone = fc.oneof(
  garbageText,
  fc.constantFrom("Mars/Olympus", "UTC+9", "Asia/Tokyo ", "asia/tokyo", "GMT+25", "EST5EDT", "Etc/GMT-14", "Asia/Tokyo", "America/New_York", "Europe/London"),
);

export const garbageInstant = fc.oneof(
  garbageText,
  fc.constantFrom(
    "2026-02-30T10:00:00",
    "2026-13-01T10:00:00Z",
    "2026-12-05T25:00:00",
    "0000-01-01T00:00:00Z",
    "+275760-09-13T00:00:00Z",
    "-000001-01-01T00:00:00Z",
    "2026-12-05",
    "2026-12-05T10:00",
    "2026-12-05T10:00:00+99:99",
    "2026-03-08T02:30:00",
    "2026-11-01T01:30:00",
  ),
  fc.date({ min: new Date("1990-01-01T00:00:00Z"), max: new Date("2040-01-01T00:00:00Z"), noInvalidDate: true }).map((d) => d.toISOString()),
  fc.date({ min: new Date("2026-11-01T00:00:00Z"), max: new Date("2027-01-01T00:00:00Z"), noInvalidDate: true }).map((d) => d.toISOString().replace(/\.\d+Z$/, "+09:00")),
);

export const garbageDate = fc.oneof(
  garbageText,
  fc.constantFrom("2026-02-30", "2026-13-01", "0000-00-00", "2026-12-05T10:00", "20261205"),
  fc.date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2040-01-01T00:00:00Z"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10)),
);

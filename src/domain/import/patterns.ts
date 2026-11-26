import { DateTime } from "../time/luxon";
import type { DeadlineKind, ItemPrivate, Money, Zone } from "../types";
import { airportByCode, airportByName, airportsInCity, cityZone, zoneForPlaceName } from "../time/places";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(noon|midnight)\b/i;

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readClock(text: string): string | null {
  const m = TIME_RE.exec(text);
  if (!m) return null;
  if (m[4]) return m[4].toLowerCase() === "noon" ? "12:00" : "00:00";
  let h = Number(m[1]);
  const min = Number(m[2] ?? "0");
  if (h < 1 || h > 12 || min > 59) return null;
  const pm = m[3].toLowerCase() === "pm";
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function readMonthDay(text: string): { month: number; day: number } | null {
  const re = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})\\b|\\b(\\d{1,2})\\s+${MONTH_RE}`, "gi");
  const found = [...text.matchAll(re)];
  if (found.length !== 1) return null;
  const m = found[0];
  const monthName = (m[1] ?? m[4]).toLowerCase().slice(0, 3);
  const day = Number(m[2] ?? m[3]);
  const month = MONTHS.indexOf(monthName) + 1;
  if (month < 1 || day < 1 || day > 31) return null;
  return { month, day };
}

export function inferDate(md: { month: number; day: number }, notAfter: DateTime): string | null {
  for (const year of [notAfter.year, notAfter.year - 1]) {
    if (md.day > DateTime.fromObject({ year, month: md.month }).daysInMonth) continue;
    const d = DateTime.fromObject({ year, month: md.month, day: md.day }, { zone: notAfter.zone });
    if (d.startOf("day") <= notAfter.startOf("day")) return d.toISODate();
  }
  return null;
}

export function readNamedZone(text: string): Zone | null {
  const m = /\(?\b([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?)\s+time\b\)?/.exec(text);
  return m ? zoneForPlaceName(m[1]) : null;
}

export interface ParsedDeadline {
  kind: DeadlineKind;
  local: string;
  zone: Zone;
  consequence: string;
  sentence: string;
}

const DEADLINE_PATTERNS: { re: RegExp; kind: DeadlineKind; whenNoTime: "start" | "end"; after?: boolean }[] = [
  { re: /free cancell?ation (?:until|before|through)\s+(.+)/i, kind: "free_cancellation", whenNoTime: "start" },
  { re: /non[- ]?refundable after\s+(?!that)(.+)/i, kind: "free_cancellation", whenNoTime: "end", after: true },
  { re: /cancel or change by\s+(.+)/i, kind: "change", whenNoTime: "start" },
  { re: /partial refund if cancell?ed before\s+(.+)/i, kind: "partial_refund", whenNoTime: "start" },
];

const DEFAULT_CONSEQUENCE: Record<DeadlineKind, string> = {
  free_cancellation: "Non refundable after this",
  partial_refund: "Only a partial refund before this, none after",
  change: "Changes cost extra after this",
  other: "Check the booking terms",
};

export function extractDeadlines(
  text: string,
  itemZone: Zone | null,
  notAfter: DateTime,
): { deadlines: ParsedDeadline[]; unparsed: string[] } {
  const deadlines: ParsedDeadline[] = [];
  const unparsed: string[] = [];
  const list = sentences(text);
  list.forEach((sentence, i) => {
    for (const p of DEADLINE_PATTERNS) {
      const m = p.re.exec(sentence);
      if (!m) continue;
      const zone = readNamedZone(sentence) ?? itemZone;
      const md = readMonthDay(m[1]);
      const date = md && zone ? inferDate(md, notAfter.setZone(zone)) : null;
      if (!date || !zone) {
        unparsed.push(sentence);
        break;
      }
      const clock = readClock(m[1]);
      let local = `${date}T${clock ?? "00:00"}`;
      if (!clock && p.whenNoTime === "end") local = DateTime.fromISO(date).plus({ days: 1 }).toFormat("yyyy-MM-dd'T'00:00");
      const next = list[i + 1] ?? "";
      const after = /^after that[,:]?\s*(.+?)\.?$/i.exec(next);
      const consequence = after ? after[1].charAt(0).toUpperCase() + after[1].slice(1) : DEFAULT_CONSEQUENCE[p.kind];
      deadlines.push({ kind: p.kind, local, zone, consequence, sentence });
      break;
    }
  });
  return { deadlines, unparsed };
}

export function extractStayTimes(text: string): { checkIn: string | null; checkOut: string | null } {
  let checkIn: string | null = null;
  let checkOut: string | null = null;
  for (const s of sentences(text)) {
    if (/check[- ]?in\b/i.test(s) && !checkIn) checkIn = readClock(s);
    if (/check[- ]?out\b/i.test(s) && !checkOut) checkOut = readClock(s);
  }
  return { checkIn, checkOut };
}

export function extractLateArrivalCutoff(text: string): string | null {
  const m = /arriv\w*\s+after\s+([0-9:]+\s*[ap]m|noon|midnight)/i.exec(text);
  return m ? readClock(m[1]) : null;
}

export function extractFlightNumber(text: string): string | null {
  const m = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b(?![A-Za-z:])/.exec(text);
  return m ? `${m[1]}${m[2]}` : null;
}

export function findAirports(text: string): string[] {
  const hits: { pos: number; code: string }[] = [];
  for (const m of text.matchAll(/\b[A-Z]{3}\b/g)) {
    if (airportByCode(m[0])) hits.push({ pos: m.index, code: m[0] });
  }
  for (const m of text.matchAll(/\b[A-Z][a-z]{3,}\b/g)) {
    const a = airportByName(m[0]);
    if (a) hits.push({ pos: m.index, code: a.iata });
  }
  for (const m of text.matchAll(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\b/g)) {
    const zone = cityZone(m[0]);
    if (!zone) continue;
    const near = hits.some((h) => h.pos >= m.index && h.pos <= m.index + m[0].length + 12);
    if (near) continue;
    const code = singleAirportCity(m[0]);
    if (code) hits.push({ pos: m.index, code });
  }
  const ordered = hits.sort((a, b) => a.pos - b.pos).map((h) => h.code);
  return ordered.filter((c, i) => ordered[i - 1] !== c);
}

function singleAirportCity(city: string): string | null {
  const list = airportsInCity(city);
  return list.length === 1 ? list[0].iata : null;
}

export function extractRoute(summary: string, location: string, description: string): { from: string | null; to: string | null } {
  let from: string | null = null;
  let to: string | null = null;
  const arrow = /(.*?)\s*(?:→|->|—>|–>)\s*(.+)/.exec(summary) ?? /(.*?)\s+\bto\b\s+(.+)/.exec(summary);
  if (arrow) {
    from = findAirports(arrow[1]).at(-1) ?? null;
    to = findAirports(arrow[2])[0] ?? null;
  }
  const departs = /depart\w*\s+(?:from\s+)?([^.,]+?)(?:\s+at\b|[.,]|$)/i.exec(description);
  const arrives = /arriv\w*\s+(?:at\s+|in\s+)?([^.,]+?)(?:\s+at\b|\s+\d|[.,]|$)/i.exec(description);
  from ??= (departs && findAirports(departs[1])[0]) || findAirports(location)[0] || null;
  to ??= (arrives && findAirports(arrives[1])[0]) || null;
  return { from, to: to === from ? null : to };
}

const CODE_RE = /(?:reservation|confirmation(?: code| number)?|booking reference|booking ref|record locator|PNR)\s*(?:code|number|no\.?)?[:\s#]+([A-Z0-9_]{5,})/i;

export function extractPrivate(text: string): Omit<ItemPrivate, "travelerId"> {
  const out: Omit<ItemPrivate, "travelerId"> = {};
  const code = CODE_RE.exec(text);
  if (code) {
    if (/booking ref/i.test(code[0])) out.bookingReference = code[1];
    else out.confirmationCode = code[1];
  }
  const seat = /\bseat\s+(\d{1,2}[A-K])\b/i.exec(text);
  if (seat) out.seat = seat[1].toUpperCase();
  const price = extractPrice(text);
  if (price) out.price = price;
  return out;
}

export function extractPrice(text: string): Money | null {
  const m = /\b(USD|JPY|HKD|CNY|RMB|EUR|GBP)\s?([\d,]+(?:\.\d{1,2})?)\b/.exec(text);
  if (m) return { currency: m[1] === "RMB" ? "CNY" : m[1], amount: m[2].replace(/,/g, "") };
  const usd = /\$([\d,]+(?:\.\d{2})?)\b/.exec(text);
  return usd ? { currency: "USD", amount: usd[1].replace(/,/g, "") } : null;
}

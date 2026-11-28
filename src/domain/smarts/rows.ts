import type { TipKind } from "./kinds";

export type RowName = "flight" | "check_in" | "check_out" | "event";

export interface RowSource {
  source: "check" | "tip";
  anchor: string;
  itemId: string;
  row: RowName;
  line: string;
  why: string;
  fix?: { label: string; done: string };
  tipKind?: TipKind;
}

export interface RowLine {
  main: RowSource;
  also: string[];
}

export function rowKey(itemId: string, row: RowName): string {
  return `${itemId}:${row}`;
}

export function arrangeRows(sources: RowSource[]): Map<string, RowLine> {
  const ordered = [...sources.filter((s) => s.source === "check"), ...sources.filter((s) => s.source === "tip")];
  const rows = new Map<string, RowLine>();
  for (const source of ordered) {
    const key = rowKey(source.itemId, source.row);
    const existing = rows.get(key);
    if (existing) existing.also.push(source.line);
    else rows.set(key, { main: source, also: [] });
  }
  return rows;
}

interface FindingLike {
  anchor: string;
  kind: string;
  sentence: string;
  itemIds: string[];
  why?: string;
  fix?: { label: string; done: string };
}

export function checkSources(findings: FindingLike[]): RowSource[] {
  const out: RowSource[] = [];
  for (const f of findings) {
    const base = { source: "check" as const, anchor: f.anchor, line: f.sentence, why: f.why ?? "", ...(f.fix ? { fix: { label: f.fix.label, done: f.fix.done } } : {}) };
    if (f.kind === "wrong_time" && f.itemIds[0]) out.push({ ...base, itemId: f.itemIds[0], row: "event" });
    if (f.kind === "risky_connection") {
      const second = f.itemIds[f.itemIds.length - 1];
      if (second) out.push({ ...base, itemId: second, row: "flight" });
    }
  }
  return out;
}

interface TipLike {
  anchor: string;
  kind: TipKind;
  itemId: string;
  row: "flight" | "check_in" | "check_out";
  line: string;
  why: string;
}

export function tipSources(tips: TipLike[]): RowSource[] {
  return tips.map((t) => ({ source: "tip" as const, anchor: t.anchor, itemId: t.itemId, row: t.row, line: t.line, why: t.why, tipKind: t.kind }));
}

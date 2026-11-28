import type { VisibleItem } from "../visibility/project";
import type { ZonedTime } from "../types";

export type SmartCheckKind = "wrong_time" | "risky_connection";

export interface SmartFix {
  label: string;
  done: string;
  start: ZonedTime;
  end: ZonedTime;
}

export interface SmartCheck {
  key: string;
  kind: SmartCheckKind;
  itemId: string;
  itemIds: string[];
  line: string;
  why: string;
  fix?: SmartFix;
}

export function smartKey(kind: SmartCheckKind, items: Pick<VisibleItem, "id" | "updatedAt">[], extra = ""): string {
  return ["smart", kind, ...items.map((i) => `${i.id}@${i.updatedAt}`).sort(), extra].join("|");
}

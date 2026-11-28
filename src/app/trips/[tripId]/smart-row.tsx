import { SmartLine } from "./smart-line";
import { CheckButtons, TipButtons } from "./smart-buttons";
import type { RowLine } from "@/domain/smarts/rows";

export interface SmartRows {
  rows: Map<string, RowLine>;
  showIntro: boolean;
}

export function SmartRow({ tripId, row }: { tripId: string; row: RowLine | undefined }) {
  if (!row) return null;
  const main = row.main;
  const isCheck = main.source === "check";
  return (
    <SmartLine kind={isCheck ? "check" : "tip"} line={main.line} why={main.why} also={row.also}>
      {isCheck && <CheckButtons tripId={tripId} anchor={main.anchor} fix={main.fix} />}
      {!isCheck && main.tipKind && <TipButtons tripId={tripId} kind={main.tipKind} />}
    </SmartLine>
  );
}

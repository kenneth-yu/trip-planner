import Link from "next/link";
import styles from "./smart-line.module.css";
import { SmartLine } from "./smart-line";
import { CheckButtons, TipButtons } from "./smart-buttons";
import type { RowLine } from "@/domain/smarts/rows";

export interface SmartRows {
  rows: Map<string, RowLine>;
  showIntro: boolean;
}

export function TipsIntro() {
  return (
    <div className={styles.intro}>
      <p>Travel tips are small suggestions about your flights and stays. They are not warnings.</p>
      <p>
        <Link href="/account#travel-smarts">Turn off tips</Link>
      </p>
    </div>
  );
}

export function SmartRow({ tripId, row, canEdit }: { tripId: string; row: RowLine | undefined; canEdit: boolean }) {
  if (!row) return null;
  const main = row.main;
  const isCheck = main.source === "check";
  return (
    <SmartLine kind={isCheck ? "check" : "tip"} line={main.line} why={main.why} also={row.also}>
      {canEdit && isCheck && <CheckButtons tripId={tripId} anchor={main.anchor} fix={main.fix} />}
      {canEdit && !isCheck && main.tipKind && <TipButtons tripId={tripId} kind={main.tipKind} />}
    </SmartLine>
  );
}

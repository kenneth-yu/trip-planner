import Link from "next/link";
import styles from "./smart-line.module.css";
import { FlashStatus } from "@/app/ui/item-form/flash-status";
import { TIP_HIDDEN_FLASH } from "@/app/ui/item-form/flash";
import { TIP_KINDS } from "@/domain/smarts/kinds";
import { SmartLine } from "./smart-line";
import { CheckButtons, TipButtons } from "./smart-buttons";
import type { RowLine } from "@/domain/smarts/rows";

export interface SmartRows {
  rows: Map<string, RowLine>;
  showIntro: boolean;
}

export function TipsIntro() {
  return (
    <p className={styles.intro}>
      Tips like this are optional. <Link href="/account#travel-smarts">Turn off tips</Link>
    </p>
  );
}

export function SmartFlashes({ tripId }: { tripId: string }) {
  return (
    <>
      <FlashStatus kind="fixed" tripId={tripId} />
      <FlashStatus kind="fine" tripId={tripId} />
      {TIP_KINDS.map((kind) => (
        <FlashStatus key={kind} kind={TIP_HIDDEN_FLASH[kind]} tripId={tripId} />
      ))}
    </>
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

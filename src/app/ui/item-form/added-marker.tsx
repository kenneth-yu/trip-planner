"use client";

import { useSearchParams } from "next/navigation";
import styles from "./item-form.module.css";

export function AddedMarker({ itemId }: { itemId: string }) {
  const added = useSearchParams().get("added");
  if (added !== itemId) return null;
  return <span className={styles.added}>Added</span>;
}

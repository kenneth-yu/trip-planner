"use client";

import { useEffect, useState } from "react";
import styles from "../ui/page.module.css";
import { clearOneTimeNotice } from "./notice-actions";

export function OneTimeNotice({ text }: { text: string | null }) {
  const [shown] = useState(text);
  useEffect(() => {
    if (text) void clearOneTimeNotice();
  }, [text]);
  if (!shown) return null;
  return (
    <p role="status" className={styles.page} style={{ paddingBottom: 0 }}>
      {shown}
    </p>
  );
}

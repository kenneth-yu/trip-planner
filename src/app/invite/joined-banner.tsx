"use client";

import { useEffect, useState } from "react";
import styles from "../ui/page.module.css";
import { dismissJoinedNotice } from "./notice-actions";

export function JoinedBanner({ message }: { message: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const dismiss = () => {
      setVisible(false);
      void dismissJoinedNotice();
    };
    document.addEventListener("pointerdown", dismiss, { once: true });
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  if (!visible) return null;
  return (
    <p role="status" className={styles.callout}>
      {message}
    </p>
  );
}

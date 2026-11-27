"use client";

import { useState } from "react";
import pageStyles from "../ui/page.module.css";
import styles from "./account.module.css";

const FAILURE = "Your file could not be made. Try again.";

function fileNameFrom(header: string | null): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? "trip-planner-export.json";
}

export function ExportButton() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function download() {
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch("/account/export", { method: "POST" });
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFrom(res.headers.get("content-disposition"));
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" className={styles.primary} disabled={pending} onClick={download}>
        {pending ? "Preparing your file" : "Download your data"}
      </button>
      {failed && (
        <p role="alert" className={`${pageStyles.warning} ${styles.error}`}>
          {FAILURE}
        </p>
      )}
    </div>
  );
}

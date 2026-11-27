"use client";

import { useEffect, useRef } from "react";
import styles from "./phone.module.css";
import type { StripDay } from "@/domain/timeline/trip-grid";

const CITY = [styles.city1, styles.city2, styles.city3, styles.city4, styles.city5];

export function DayStrip({ days, selectedKey }: { days: StripDay[]; selectedKey: string | null }) {
  const chosen = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    chosen.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selectedKey]);
  return (
    <nav className={styles.strip} aria-label="Days of the trip">
      {days.map((d) => {
        const isChosen = d.key === selectedKey;
        return (
          <a
            key={d.key}
            ref={isChosen ? chosen : undefined}
            href={`?day=${d.key}`}
            className={`${styles.chip} ${isChosen ? styles.chosen : ""} ${d.cityIndex !== null ? CITY[d.cityIndex % CITY.length] : ""}`}
            aria-current={isChosen ? "date" : undefined}
            aria-label={`${[d.weekday, d.month, d.day].filter((part) => part !== null).join(" ")}${d.city ? `, sleeping in ${d.city}` : ""}${d.needsAttention ? ", needs a look" : ""}`}
          >
            {d.month ?? d.weekday}{" "}
            <b>{d.day}</b>
            <span className={styles.bar} />
            <span className={styles.dots}>
              {d.busy && <span className={styles.dot} />}
              {d.needsAttention && <span className={styles.warn} />}
            </span>
          </a>
        );
      })}
    </nav>
  );
}

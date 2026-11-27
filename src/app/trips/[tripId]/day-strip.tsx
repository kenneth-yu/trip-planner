"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import styles from "./phone.module.css";
import { DAY_PANEL_ID } from "./day-panel";
import type { StripDay } from "@/domain/timeline/trip-grid";

const CITY = [styles.city1, styles.city2, styles.city3, styles.city4, styles.city5];

export function DayStrip({ days, selectedKey }: { days: StripDay[]; selectedKey: string | null }) {
  const chosen = useRef<HTMLAnchorElement>(null);
  const strip = useRef<HTMLElement>(null);
  const tapped = useRef(false);
  useEffect(() => {
    chosen.current?.scrollIntoView({ block: "nearest", inline: "center" });
    const panel = document.getElementById(DAY_PANEL_ID);
    if (!tapped.current || !panel || !strip.current) return;
    tapped.current = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: panel.getBoundingClientRect().top + window.scrollY - strip.current.offsetHeight, behavior: reduced ? "auto" : "smooth" });
  }, [selectedKey]);
  return (
    <nav ref={strip} className={styles.strip} aria-label="Days of the trip">
      {days.map((d) => {
        const isChosen = d.key === selectedKey;
        return (
          <Link
            key={d.key}
            ref={isChosen ? chosen : undefined}
            href={`?day=${d.key}`}
            scroll={false}
            onClick={() => {
              tapped.current = !isChosen;
            }}
            className={`${styles.chip} ${isChosen ? styles.chosen : ""} ${d.cityIndex !== null ? CITY[d.cityIndex % CITY.length] : ""}`}
            aria-current={isChosen ? "date" : undefined}
            aria-label={`${d.weekday} ${d.month ?? ""} ${d.day}${d.city ? `, sleeping in ${d.city}` : ""}${d.needsAttention ? ", needs a look" : ""}`}
          >
            {d.month ?? d.weekday}
            <b>{d.day}</b>
            <span className={styles.bar} />
            <span className={styles.dots}>
              {d.busy && <span className={styles.dot} />}
              {d.needsAttention && <span className={styles.warn} />}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

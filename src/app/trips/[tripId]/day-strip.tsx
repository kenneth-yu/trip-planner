"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import styles from "./phone.module.css";
import { DAY_PANEL_ID } from "./day-panel";
import type { StripDay } from "@/domain/timeline/trip-grid";

const PLACES_KEPT = 50;
const places = new Map<string, number>();

function remember(url: string, scrollY: number): void {
  places.delete(url);
  places.set(url, scrollY);
  const oldest = places.keys().next();
  if (places.size > PLACES_KEPT && !oldest.done) places.delete(oldest.value);
}

let traversalPending = false;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    traversalPending = true;
  });
  document.addEventListener(
    "click",
    () => {
      traversalPending = false;
    },
    true,
  );
}

function consumeTraversal(): boolean {
  const arrived = traversalPending;
  traversalPending = false;
  return arrived;
}

const here = () => `${window.location.pathname}${window.location.search}`;

const CITY = [styles.city1, styles.city2, styles.city3, styles.city4, styles.city5];

export function DayStrip({ days, selectedKey }: { days: StripDay[]; selectedKey: string | null }) {
  const chosen = useRef<HTMLAnchorElement>(null);
  const strip = useRef<HTMLElement>(null);
  const tapped = useRef(false);
  const pinnedHeight = () => {
    const el = strip.current;
    return el && getComputedStyle(el).position === "sticky" ? el.offsetHeight : 0;
  };
  const lastUrl = useRef<string | null>(null);
  const arrivedByTraversal = useRef(false);
  useEffect(() => {
    arrivedByTraversal.current = consumeTraversal();
    const native = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    lastUrl.current = here();
    const leaving = () => {
      if (lastUrl.current) remember(lastUrl.current, window.scrollY);
    };
    const scrolled = () => remember(here(), window.scrollY);
    window.addEventListener("popstate", leaving);
    window.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      window.removeEventListener("popstate", leaving);
      window.removeEventListener("scroll", scrolled);
      window.history.scrollRestoration = native;
    };
  }, []);
  useEffect(() => {
    const url = here();
    const arrived = arrivedByTraversal.current;
    arrivedByTraversal.current = false;
    const restore = !tapped.current && (lastUrl.current !== url || arrived) ? places.get(url) : undefined;
    lastUrl.current = url;
    const el = strip.current;
    el?.removeAttribute("data-scroll-restored");
    if (restore !== undefined) {
      window.scrollTo({ top: restore, behavior: "auto" });
      if (Math.abs(window.scrollY - restore) <= 1) el?.setAttribute("data-scroll-restored", `${url}|${Math.round(window.scrollY)}`);
    }
    if (el && chosen.current) el.scrollLeft = chosen.current.offsetLeft - (el.clientWidth - chosen.current.offsetWidth) / 2;
    const panel = document.getElementById(DAY_PANEL_ID);
    if (tapped.current && panel) {
      tapped.current = false;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: panel.getBoundingClientRect().top + window.scrollY - pinnedHeight(), behavior: reduced ? "auto" : "smooth" });
    }
  }, [selectedKey]);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => {
      const height = `${pinnedHeight()}px`;
      root.style.setProperty("--strip-height", height);
      root.style.scrollPaddingTop = height;
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty("--strip-height");
      root.style.removeProperty("scroll-padding-top");
    };
  }, []);
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
            onClick={(e) => {
              remember(here(), window.scrollY);
              tapped.current = !isChosen && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
            }}
            className={`${styles.chip} ${isChosen ? styles.chosen : ""} ${d.cityIndex !== null ? CITY[d.cityIndex % CITY.length] : ""}`}
            aria-current={isChosen ? "date" : undefined}
            aria-label={`${d.month ?? d.weekday} ${d.day}${d.month ? `, ${d.weekday}` : ""}${d.city ? `, sleeping in ${d.city}` : ""}${d.needsAttention ? ", needs a look" : ""}`}
          >
            {d.month ?? d.weekday}{" "}
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

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "../../ui/page.module.css";

export function TripNav({ tripId, canEdit }: { tripId: string; canEdit: boolean }) {
  const path = usePathname();
  const base = `/trips/${tripId}`;
  const links = [
    { href: base, label: "Day by day" },
    { href: `${base}/timeline`, label: "Timeline", className: styles.timelineLink },
    { href: `${base}/deadlines`, label: "Deadlines" },
    ...(canEdit ? [{ href: `${base}/inbox`, label: "Review inbox" }] : []),
    { href: `${base}/connect`, label: "Connect" },
  ];
  return (
    <nav className={styles.nav}>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={"className" in l ? l.className : undefined} aria-current={path === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

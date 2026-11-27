import styles from "./trip-grid.module.css";
import type { TripGrid } from "@/domain/timeline/trip-grid";

const CITY = [styles.city1, styles.city2, styles.city3, styles.city4, styles.city5];
const PER_CELL = 3;

export function TripGridView({ grid, dayHref, selectedKey }: { grid: TripGrid; dayHref: (dayKey: string) => string; selectedKey: string | null }) {
  const col = (i: number) => i + 2;
  const hasUnsure = grid.unsure.length > 0;
  const hasTravel = grid.travel.some((cell) => cell.length > 0);
  const hasPlans = grid.plans.some((cell) => cell.length > 0);
  const order = ["sleep", ...(hasTravel ? ["travel"] : []), ...(hasPlans ? ["plans"] : []), ...(hasUnsure ? ["unsure"] : [])];
  const rowOf = (name: string) => order.indexOf(name) + 2;
  const rows = { head: 1, sleep: rowOf("sleep"), travel: rowOf("travel"), plans: rowOf("plans"), unsure: rowOf("unsure") };
  return (
    <div className={styles.scroll}>
      <div
        className={styles.grid}
        style={{
          gridTemplateColumns: `6.5rem repeat(${grid.days.length}, minmax(7.25rem, 12rem))`,
          gridTemplateRows: `repeat(${order.length + 1}, auto)`,
          minWidth: `calc(6.5rem + ${grid.days.length} * 7.25rem)`,
        }}
      >
        <span className={`${styles.band} ${styles.bandSleep}`} style={{ gridRow: rows.sleep }} />
        {hasTravel && <span className={`${styles.band} ${styles.bandTravel}`} style={{ gridRow: rows.travel }} />}
        {hasPlans && <span className={`${styles.band} ${styles.bandPlans}`} style={{ gridRow: rows.plans }} />}
        {hasUnsure && <span className={`${styles.band} ${styles.bandUnsure}`} style={{ gridRow: rows.unsure }} />}
        {grid.days.map((d, i) => (
          <span key={`col-${d.key}`} className={`${styles.column} ${d.key === selectedKey ? styles.selected : ""} ${d.today ? styles.today : ""}`} style={{ gridColumn: col(i) }} />
        ))}

        <span className={styles.corner} style={{ gridRow: rows.head }} />
        {grid.days.map((d, i) => (
          <a key={`head-${d.key}`} href={dayHref(d.key)} className={`${styles.head} ${d.key === selectedKey ? styles.headSelected : ""}`} aria-current={d.key === selectedKey ? "date" : undefined} style={{ gridColumn: col(i), gridRow: rows.head }}>
            {d.month && <span className={styles.month}>{d.month} </span>}
            {d.weekday}
            <b>{d.day}</b>
          </a>
        ))}

        <span className={`${styles.rowLabel} ${styles.bandSleep}`} style={{ gridRow: rows.sleep }}>Sleeping in</span>
        {grid.sleep.map((s) => (
          <div key={s.key} className={styles.sleep} style={{ gridColumn: `${col(s.from)} / ${col(s.to)}`, gridRow: rows.sleep }}>
            <a className={`${styles.block} ${CITY[s.cityIndex % CITY.length]}`} href={dayHref(grid.days[s.from].key)} title={s.stays.join(", ")}>
              <b>{s.city}</b>
              <span>
                {s.nights} night{s.nights === 1 ? "" : "s"}, {s.stays.join(" and ")}
              </span>
            </a>
          </div>
        ))}

        {hasTravel && <span className={`${styles.rowLabel} ${styles.bandTravel}`} style={{ gridRow: rows.travel }}>Travel</span>}
        {hasTravel && grid.travel.map((entries, i) => (
          <div key={`travel-${grid.days[i].key}`} className={styles.cell} style={{ gridColumn: col(i), gridRow: rows.travel }}>
            {entries.map((t) => (
              <a key={t.key} href={dayHref(grid.days[i].key)} className={`${styles.entry} ${t.kind === "missing" ? styles.missing : ""}`}>
                {t.title}
                {t.time && <small>{t.time}</small>}
              </a>
            ))}
          </div>
        ))}

        {hasPlans && <span className={`${styles.rowLabel} ${styles.bandPlans}`} style={{ gridRow: rows.plans }}>Plans</span>}
        {hasPlans && grid.plans.map((entries, i) => (
          <div key={`plans-${grid.days[i].key}`} className={styles.cell} style={{ gridColumn: col(i), gridRow: rows.plans }}>
            {entries.slice(0, PER_CELL).map((p) => (
              <a key={p.key} href={dayHref(grid.days[i].key)} className={styles.entry}>
                {p.title}
                <small>{p.time}</small>
              </a>
            ))}
            {entries.length > PER_CELL && (
              <a href={dayHref(grid.days[i].key)} className={styles.more}>
                +{entries.length - PER_CELL} more
              </a>
            )}
          </div>
        ))}

        {hasUnsure && <span className={`${styles.rowLabel} ${styles.bandUnsure}`} style={{ gridRow: rows.unsure }}>Not sure yet</span>}
        {grid.unsure.map((u) => (
          <div key={u.key} className={styles.unsure} style={{ gridColumn: `${col(u.from)} / ${col(u.to)}`, gridRow: rows.unsure }}>
            <a className={styles.unsureBlock} href={dayHref(grid.days[u.from].key)}>
              Is this a second booking? {u.title}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";
import styles from "../ui/page.module.css";
import signInStyles from "./sign-in.module.css";

export function TripList({ trips, signOut }: { trips: { id: string; name: string; role: "owner" | "editor" | "viewer" }[]; signOut: () => Promise<void> }) {
  return (
    <main className={styles.page}>
      {trips.length === 0 ? (
        <>
          <h1 className={styles.title}>No trips yet</h1>
          <Link href="/trips/new" className={signInStyles.primary}>
            New trip
          </Link>
        </>
      ) : (
        <>
          <h1 className={styles.title}>Your trips</h1>
          <ul className={styles.list}>
            {trips.map((t) => (
              <li key={t.id} className={signInStyles.tripRow}>
                <Link href={`/trips/${t.id}`}>{t.name}</Link>
                {t.role !== "viewer" && (
                  <Link href={`/trips/${t.id}/settings`} className={signInStyles.settings}>
                    Settings
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <p className={styles.section}>
            <Link href="/trips/new">New trip</Link>
          </p>
        </>
      )}
      <form action={signOut} className={styles.section}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}

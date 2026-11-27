import Link from "next/link";
import styles from "../ui/page.module.css";

export function TripList({ trips, signOut }: { trips: { id: string; name: string }[]; signOut: () => Promise<void> }) {
  return (
    <main className={styles.page}>
      {trips.length === 0 ? (
        <>
          <h1 className={styles.title}>No trips yet</h1>
          <p>
            <Link href="/trips/new">New trip</Link>
          </p>
        </>
      ) : (
        <>
          <h1 className={styles.title}>Your trips</h1>
          <ul className={styles.list}>
            {trips.map((t) => (
              <li key={t.id}>
                <Link href={`/trips/${t.id}`}>{t.name}</Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <form action={signOut} className={styles.section}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}

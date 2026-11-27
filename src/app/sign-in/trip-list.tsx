import Link from "next/link";
import styles from "../ui/page.module.css";
import signInStyles from "./sign-in.module.css";
import accountStyles from "../account/account.module.css";

export function TripList({ trips, signOut }: { trips: { id: string; name: string }[]; signOut: () => Promise<void> }) {
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
              <li key={t.id}>
                <Link href={`/trips/${t.id}`}>{t.name}</Link>
              </li>
            ))}
          </ul>
          <p className={styles.section}>
            <Link href="/trips/new">New trip</Link>
          </p>
        </>
      )}
      <p className={styles.section}>
        <Link href="/account" className={accountStyles.link}>
          Your account
        </Link>
      </p>
      <form action={signOut}>
        <button type="submit" className={accountStyles.signOut}>
          Sign out
        </button>
      </form>
    </main>
  );
}

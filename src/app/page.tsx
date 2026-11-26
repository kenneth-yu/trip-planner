import Link from "next/link";
import styles from "./ui/page.module.css";
import { currentUser, devSignInEnabled } from "@/server/auth/session";
import { requestContext } from "@/server/app-context";
import { listTrips } from "@/server/services/trip-service";
import { USERS } from "@/fixtures/december-trip";

export default async function Home() {
  const user = await currentUser();
  if (!user) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Trip planner</h1>
        <p className={styles.muted}>Sign in to see your trips.</p>
        {devSignInEnabled() && (
          <ul className={styles.list}>
            {Object.entries(USERS).map(([key, u]) => (
              <li key={key}>
                <a href={`/api/dev/sign-in?as=${key}`}>Continue as {u.name}</a>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }
  const trips = await listTrips(await requestContext(), user.id);
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Your trips</h1>
      <ul className={styles.list}>
        {trips.map((t) => (
          <li key={t.id}>
            <Link href={`/trips/${t.id}`}>{t.name}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

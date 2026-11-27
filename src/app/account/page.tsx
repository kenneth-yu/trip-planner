import type { Metadata } from "next";
import Link from "next/link";
import pageStyles from "../ui/page.module.css";
import styles from "./account.module.css";
import { requestContext } from "@/server/app-context";
import { requireUser } from "@/server/web";
import { hasSharedSpecificItems, tripsBlockingDeletion } from "@/server/services/deletion-service";
import { DeleteAccountSection } from "./delete-account-section";
import { ExportButton } from "./export-button";

export const metadata: Metadata = { title: "Your account", robots: { index: false, follow: false } };

export default async function AccountPage() {
  const user = await requireUser("/account");
  const ctx = await requestContext();
  const blocking = await tripsBlockingDeletion(ctx.db, user.id);
  const shared = blocking.length === 0 && (await hasSharedSpecificItems(ctx, user.id));
  return (
    <main className={pageStyles.page}>
      <p>
        <Link href="/" className={styles.back}>
          Your trips
        </Link>
      </p>
      <h1 className={pageStyles.title}>Your account</h1>
      <p>Signed in as {user.name}</p>
      <p className={pageStyles.muted}>{user.email}</p>
      <section className={styles.section}>
        <h2 className={pageStyles.sectionTitle}>Your data</h2>
        <p>Download a copy of everything the app holds about you: your trips as you see them, including the codes and seats you can see.</p>
        <p className={pageStyles.muted}>The file has your confirmation codes in it. Keep it somewhere private.</p>
        <ExportButton />
      </section>
      <DeleteAccountSection blocking={blocking} hasSharedSpecificItems={shared} />
    </main>
  );
}

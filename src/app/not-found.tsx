import type { Metadata } from "next";
import Link from "next/link";
import pageStyles from "./ui/page.module.css";
import styles from "./sign-in/sign-in.module.css";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <main className={pageStyles.page}>
      <h1 className={pageStyles.title}>This page isn&apos;t here.</h1>
      <p>Check the link, or start from your trips.</p>
      <div className={styles.stack}>
        <Link href="/" className={styles.primary}>
          Go to your trips
        </Link>
      </div>
    </main>
  );
}

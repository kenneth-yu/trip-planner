import Link from "next/link";
import pageStyles from "../ui/page.module.css";
import styles from "../sign-in/sign-in.module.css";

export function NotOnYourAccount({ signOut }: { signOut: () => Promise<void> }) {
  return (
    <main className={pageStyles.page}>
      <h1 className={pageStyles.title}>This trip is not on your account.</h1>
      <p>Sign in with the email your travel partner uses, or ask them to invite you.</p>
      <div className={styles.stack}>
        <form action={signOut}>
          <button type="submit" className={styles.primary}>
            Sign out
          </button>
        </form>
        <Link href="/" className={styles.secondary}>
          Your trips
        </Link>
      </div>
    </main>
  );
}

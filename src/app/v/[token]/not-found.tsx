import type { Metadata } from "next";
import pageStyles from "../../ui/page.module.css";

export const metadata: Metadata = { title: "Link not working", robots: { index: false, follow: false } };

export default function LinkNoLongerWorks() {
  return (
    <main className={pageStyles.page}>
      <h1 className={pageStyles.title}>This link no longer works.</h1>
      <p>Ask whoever sent it for a new one.</p>
    </main>
  );
}

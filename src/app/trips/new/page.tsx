import { redirect } from "next/navigation";
import styles from "../../ui/page.module.css";
import { currentUser } from "@/server/auth/session";
import { NewTripForm } from "./new-trip-form";

export default async function NewTripPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in?next=/trips/new");
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>New trip</h1>
      <NewTripForm />
    </main>
  );
}

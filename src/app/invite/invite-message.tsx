import pageStyles from "../ui/page.module.css";

export const PROBLEM_COPY = {
  expired: "That link has expired. Ask the trip owner for a new one.",
  unusable: "That link no longer works. Ask the trip owner for a new one.",
} as const;

export const LOST_COPY = "We lost track of your invite. Open the invite link again.";

export function InviteMessage({ text }: { text: string }) {
  return (
    <main className={pageStyles.page}>
      <p role="alert">{text}</p>
    </main>
  );
}

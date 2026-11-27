import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";
import { RegisterServiceWorker } from "./offline/register-service-worker";

const sans = IBM_Plex_Sans({ variable: "--font-sans", subsets: ["latin"], weight: ["400", "700"] });

export const metadata: Metadata = {
  title: "Trip planner",
  description: "Flights, stays and plans in one place, in local time.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Trips", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1113" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html lang="en" className={sans.variable}>
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}

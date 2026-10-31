import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wildroads",
  description: "A community-run road-roughness map built from phone sensors, with AI reports governed through Otari.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="nav">
          <span className="brand">Wildroads</span>
          <Link href="/">Map</Link>
          <Link href="/record">Record</Link>
          <Link href="/report">Report</Link>
          <Link href="/ledger">Ledger</Link>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}

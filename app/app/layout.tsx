import type { Metadata, Viewport } from "next";
import Nav from "./nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wildroads",
  description: "A community-run road-roughness map built from phone sensors, with AI reports governed through Otari.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef2f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0e151c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..700&display=swap"
        />
      </head>
      <body>
        <Nav />
        <main className="page">{children}</main>
      </body>
    </html>
  );
}

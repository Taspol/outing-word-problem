import type { Metadata } from "next";
import { Bricolage_Grotesque, DM_Mono, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["500", "600", "800"],
});

// Bricolage has no Thai letters, so Thai text falls through to this one. Plex Thai goes up to bold (700).
const plexThai = IBM_Plex_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: "500",
});

export const metadata: Metadata = {
  title: "Outing Word Flip",
  description: "Flip a random Thai word puzzle against a timer, and manage the puzzle list.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body className={`${bricolage.variable} ${plexThai.variable} ${dmMono.variable} antialiased`}>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Bricolage_Grotesque, DM_Mono, Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["500", "600", "800"],
});

// Bricolage has no Thai letters, so Thai text falls through to this one.
const notoThai = Noto_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai"],
  weight: ["500", "600", "800"],
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
      <body className={`${bricolage.variable} ${notoThai.variable} ${dmMono.variable} antialiased`}>{children}</body>
    </html>
  );
}

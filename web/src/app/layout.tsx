import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://ofcskn.github.io/awesome-repo-graph";
const SITE_TITLE = "awesome-repo-graph — Curated Open-Source Repository Graph";
const SITE_DESCRIPTION =
  "An interactive, explorable graph of curated open-source repositories — grouped by sector, sized by star count, and linked by shared tags. Browse AI agent tooling, developer frameworks, and infrastructure projects.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  keywords: [
    "awesome list",
    "open source",
    "GitHub repositories",
    "AI agent tooling",
    "developer tools",
    "repository graph",
    "curated software catalog",
  ],
  authors: [{ name: "ofcskn", url: "https://github.com/ofcskn" }],
  alternates: { canonical: SITE_URL },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: "awesome-repo-graph",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

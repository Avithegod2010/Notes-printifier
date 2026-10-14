import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { PWARegister } from "@/components/pwa-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Notes Printifier — Make Your Notes Print-Ready",
  description:
    "Turn lecture notes into printable notes by reducing ink and pages. Invert dark slides, stack multiple slides per sheet, add separators & page numbers — free, private, works on any device, right in your browser.",
  keywords: [
    "print saver",
    "lecture notes",
    "PDF optimizer",
    "invert colors",
    "save ink",
    "save paper",
    "student tools",
  ],
  authors: [{ name: "Notes Printifier" }],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/logo.svg",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Printifier",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0a10",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <PWARegister />
      </body>
    </html>
  );
}

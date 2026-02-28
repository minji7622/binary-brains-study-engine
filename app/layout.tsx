import "katex/dist/katex.min.css";
import "./globals.css";
import type { Metadata } from "next";
import { Nunito, Geist_Mono } from "next/font/google";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NeuroPlan",
  description: "AI-powered study diagnostics and personalized planning.",
  icons: {
    icon: "/favicon.png",
  },
  openGraph: {
    images: ["/branding/neuroplan-main.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${nunito.variable} ${geistMono.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

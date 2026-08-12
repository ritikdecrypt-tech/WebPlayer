import type { Metadata } from "next";
import { Crimson_Pro, Fraunces } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const crimson = Crimson_Pro({
  variable: "--font-crimson",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: {
    default: "Kinora",
    template: "%s · Kinora",
  },
  description: "Watch stories made with Kinora — no app required.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${crimson.variable} h-full`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}

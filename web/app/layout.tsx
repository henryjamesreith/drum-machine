import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Drum Machine Console",
  description: "Local LLM control surface for the robot drummer.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}

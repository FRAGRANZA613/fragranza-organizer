import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fragranza Organizer",
  description: "Shared workspace for tasks, meetings and to-dos.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

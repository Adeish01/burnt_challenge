import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Voice Inbox Assistant",
  description: "Voice-first email assistant using LiveKit and Nylas"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Jarvis", description: "Personlig AI-assistent", manifest: "/manifest.json" };
export const viewport: Viewport = { themeColor: "#0b0d12", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}

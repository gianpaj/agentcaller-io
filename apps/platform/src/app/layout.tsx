import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentCaller — agents on the phone",
  description: "Give your AI agents the power to call any business."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en">
    <body className="scanline">{children}</body>
  </html>;
}

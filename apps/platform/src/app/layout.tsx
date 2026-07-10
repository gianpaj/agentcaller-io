import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "AgentCaller — agents on the phone", description: "A paid API for AI agents that call businesses." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body className="scanline">{children}</body></html>; }

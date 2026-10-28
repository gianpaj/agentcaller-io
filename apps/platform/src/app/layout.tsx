import type { Metadata } from "next";
import "./globals.css";

const title = "AgentCaller — Give your agent a phone line.";
const description = "An API for the businesses you still have to call.";

export const metadata: Metadata = {
  metadataBase: new URL("https://agentcaller.io"),
  title,
  description,
  openGraph: {
    type: "website",
    url: "/",
    siteName: "AgentCaller",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [
      {
        url: "/opengraph-image.png",
        alt: "AgentCaller — Give your agent a phone line. An AI agent connects to a business through a phone call.",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="scanline">{children}</body>
    </html>
  );
}

import { RootProvider } from "fumadocs-ui/provider/next";
import "./globals.css";

export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en" suppressHydrationWarning><body><RootProvider theme={{ defaultTheme: "dark" }}>{children}</RootProvider></body></html>; }

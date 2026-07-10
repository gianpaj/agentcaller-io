import { RootProvider } from "fumadocs-ui/provider/next";
import "./globals.css";

export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body><RootProvider>{children}</RootProvider></body></html>; }

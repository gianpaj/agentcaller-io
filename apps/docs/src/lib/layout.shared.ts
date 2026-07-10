import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return { nav: { title: "AGENTCALLER.IO", url: "https://agentcaller.io" }, links: [{ text: "Control room", url: "https://agentcaller.io/app", type: "button" }] };
}

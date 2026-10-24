"use client";

import { CreditCard, History, Phone, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const destinations = [
  { href: "/app", label: "Recents", Icon: History },
  { href: "/app/calls/new", label: "New call", Icon: Phone },
  { href: "/app/billing", label: "Billing", Icon: CreditCard },
  { href: "/app/settings", label: "Settings", Icon: Settings },
] as const;

export function CallNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Call navigation"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-(--line) bg-(--panel) pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid w-full max-w-2xl grid-cols-4 gap-2 px-3 py-2 sm:px-6">
        {destinations.map(({ href, label, Icon }) => {
          const active =
            href === "/app"
              ? pathname === "/app" ||
                (pathname.startsWith("/app/calls/") &&
                  pathname !== "/app/calls/new")
              : pathname === href;

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-medium ${active ? "bg-(--void) text-(--signal)" : "text-(--muted) hover:bg-(--void) hover:text-(--ink)"}`}
            >
              <Icon size={21} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

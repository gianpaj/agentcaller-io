"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function LiveProgress({ active }: { active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const tick = () => {
      setOffline(!navigator.onLine);
      if (
        navigator.onLine &&
        document.visibilityState === "visible" &&
        !pending
      )
        startTransition(() => router.refresh());
    };
    if (!active) return;
    const timer = window.setInterval(tick, 4000);
    window.addEventListener("online", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, pending, router]);
  return (
    <div className="my-6 flex items-center justify-between gap-3">
      <span
        role="status"
        className="min-w-0 text-sm leading-relaxed text-(--muted)"
      >
        {offline
          ? "Offline — progress may be out of date"
          : active
            ? "Progress refreshes every 4 seconds"
            : "Call history"}
      </span>
      <button
        className="inline-flex min-h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-(--muted) px-3 py-2 text-sm font-medium hover:bg-(--panel) disabled:cursor-wait disabled:opacity-60"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        <RefreshCw size={16} aria-hidden="true" />
        {pending ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}

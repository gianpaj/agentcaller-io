"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
    <div className="phone-refresh">
      <span role="status">
        {offline
          ? "Offline — progress may be out of date"
          : active
            ? "Progress refreshes every 4 seconds"
            : "Call history"}
      </span>
      <button
        className="phone-secondary"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}

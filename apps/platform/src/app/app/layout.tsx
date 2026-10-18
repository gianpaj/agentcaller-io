import type { Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PhoneCall, LogOut } from "lucide-react";
import { loadClientProfile } from "@/lib/portal";
import { signOut } from "../login/actions";
import { CallNavigation } from "./call-navigation";

export const viewport: Viewport = { viewportFit: "cover" };

export default async function CallLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await loadClientProfile();
  if (!user) redirect("/login");
  if (!profile)
    return (
      <main className="relative z-1 grid min-h-svh place-items-center bg-(--void) px-5 py-10 font-sans text-(--ink)">
        <section
          className="grid w-full max-w-md gap-6 rounded-xl border border-(--line) bg-(--panel) p-6 sm:p-8"
          aria-labelledby="access-title"
        >
          <h1
            id="access-title"
            className="text-3xl font-semibold tracking-tight"
          >
            Access pending
          </h1>
          <p className="text-base leading-relaxed text-(--muted)">
            An enabled client profile must be linked to your account before you
            can use AgentCaller.
          </p>
          <form action={signOut}>
            <button className="min-h-12 w-full cursor-pointer rounded-md border border-(--muted) px-4 py-3 font-semibold hover:border-(--ink) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--signal)">
              Sign out
            </button>
          </form>
        </section>
      </main>
    );
  return (
    <div className="relative z-1 flex min-h-svh flex-col bg-(--void) font-sans text-(--ink) antialiased [color-scheme:dark] selection:bg-(--signal) selection:text-(--void) [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-4 [&_:focus-visible]:outline-(--signal)">
      <a
        href="#call-content"
        className="absolute top-4 left-4 z-30 translate-y-[-200%] rounded-md bg-(--signal) px-4 py-3 text-(--void) focus:translate-y-0"
      >
        Skip to content
      </a>
      <header className="border-b border-(--line)">
        <div className="mx-auto flex min-h-18 w-full max-w-2xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link
            href="/app"
            className="inline-flex min-h-12 items-center gap-2.5 text-lg font-semibold tracking-tight"
          >
            <PhoneCall
              size={22}
              className="text-(--signal)"
              aria-hidden="true"
            />{" "}
            AgentCaller
          </Link>
          <form action={signOut}>
            <button
              className="inline-flex size-12 cursor-pointer items-center justify-center rounded-md text-(--muted) hover:bg-(--panel) hover:text-(--ink)"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={20} aria-hidden="true" />
            </button>
          </form>
        </div>
      </header>
      <main
        id="call-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-2xl flex-1 px-5 pt-8 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-8 sm:pt-10"
      >
        {children}
      </main>
      <CallNavigation />
    </div>
  );
}

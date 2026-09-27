"use client";

import Link from "next/link";

export default function PortalError({ reset }: { reset: () => void }) {
  return (
    <section
      className="grid gap-6 rounded-xl border border-(--line) bg-(--panel) p-6 sm:p-8"
      aria-labelledby="error-title"
    >
      <h1
        id="error-title"
        className="text-2xl leading-tight font-semibold tracking-tight"
      >
        Could not load call information
      </h1>
      <p className="text-base leading-relaxed text-(--muted)">
        Check your connection and try again. Refreshing does not start another
        call.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          className="min-h-12 cursor-pointer rounded-md bg-(--signal) px-4 py-3 font-semibold text-(--void) hover:bg-(--ink)"
          onClick={reset}
        >
          Try again
        </button>
        <Link
          href="/login"
          className="inline-flex min-h-12 items-center underline underline-offset-4 hover:text-(--signal)"
        >
          Sign in
        </Link>
      </div>
    </section>
  );
}

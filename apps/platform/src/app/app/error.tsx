"use client";
import Link from "next/link";
export default function PortalError({ reset }: { reset: () => void }) {
  return (
    <section className="phone-panel">
      <h1>Could not load call information</h1>
      <p>
        Check your connection and try again. Refreshing does not start another
        call.
      </p>
      <button className="phone-primary" onClick={reset}>
        Try again
      </button>{" "}
      <Link href="/login">Sign in</Link>
    </section>
  );
}

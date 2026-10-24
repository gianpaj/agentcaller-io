import Link from "next/link";
export default function BillingReturn() {
  return (
    <main className="mx-auto grid max-w-xl gap-5 px-5 py-12">
      <h1 className="text-3xl font-semibold">Checking your card</h1>
      <p>
        Stripe must confirm your saved card before billing is ready. Returning
        here does not authorize spending.
      </p>
      <Link href="/billing/connect" className="min-h-12 underline">
        Check setup status
      </Link>
    </main>
  );
}

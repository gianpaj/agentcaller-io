import Link from "next/link";
import { ArrowUpRight, ChevronRight, CreditCard, Plug } from "lucide-react";
import { requireClientProfile } from "@/lib/portal";
import { updateControls } from "../actions";

const field =
  "min-h-12 w-full rounded-md border border-(--line) bg-(--void) px-3 py-2 text-base outline-none focus:border-(--signal)";

export default async function SettingsPage() {
  const profile = await requireClientProfile();
  return (
    <>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-base leading-relaxed text-(--muted)">
          {profile.name}
        </p>
      </header>
      <nav
        aria-label="Account"
        className="mt-8 divide-y divide-(--line) rounded-xl border border-(--line) bg-(--panel)"
      >
        {[
          {
            href: "/app/billing",
            label: "Billing",
            detail: "Card, spending limits, usage, and invoices",
            Icon: CreditCard,
          },
          {
            href: "/app/connections",
            label: "Connected integrations",
            detail: "Agents with tool access to your account",
            Icon: Plug,
          },
        ].map(({ href, label, detail, Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-16 items-center gap-4 px-5 py-4 hover:bg-(--void)"
          >
            <Icon size={20} className="text-(--signal)" aria-hidden="true" />
            <span className="grid flex-1 gap-0.5">
              <span className="font-semibold">{label}</span>
              <span className="text-sm text-(--muted)">{detail}</span>
            </span>
            <ChevronRight
              size={18}
              className="text-(--muted)"
              aria-hidden="true"
            />
          </Link>
        ))}
      </nav>
      <form
        action={updateControls}
        className="mt-8 grid gap-5 rounded-xl border border-(--line) bg-(--panel) p-5 sm:p-6"
        aria-labelledby="controls-title"
      >
        <div className="space-y-1">
          <h2 id="controls-title" className="text-xl font-semibold">
            Webhook and throttle
          </h2>
          <p className="text-sm leading-relaxed text-(--muted)">
            Call events are signed with your secret and sent to this endpoint.
          </p>
        </div>
        <label className="grid gap-2">
          Webhook endpoint
          <input
            className={field}
            name="webhookUrl"
            type="url"
            defaultValue={profile.webhookUrl ?? ""}
            placeholder="https://agent.example/events"
          />
        </label>
        <label className="grid gap-2">
          Signing secret
          <input
            className={`${field} font-mono text-sm text-(--muted)`}
            readOnly
            value={profile.webhookSecret ?? ""}
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="grid gap-2">
            Calls per minute
            <input
              className={field}
              name="callsPerMinute"
              type="number"
              min="1"
              max="60"
              defaultValue={profile.callsPerMinute}
            />
          </label>
          <label className="grid gap-2">
            Active calls
            <input
              className={field}
              name="maxConcurrentCalls"
              type="number"
              min="1"
              max="20"
              defaultValue={profile.maxConcurrentCalls}
            />
          </label>
        </div>
        <button className="min-h-12 rounded-md bg-(--signal) px-4 py-3 font-semibold text-(--void) hover:bg-(--ink)">
          Save
        </button>
      </form>
      <Link
        href="https://docs.agentcaller.io"
        className="mt-6 inline-flex min-h-12 items-center gap-1 underline underline-offset-4 hover:text-(--signal)"
      >
        API documentation
        <ArrowUpRight size={16} aria-hidden="true" />
      </Link>
    </>
  );
}

import type { CreateCallInput } from "@agentcaller/contracts";
import { ArrowDown, ArrowUpRight, Code2, PhoneCall } from "lucide-react";
import Link from "next/link";

const docsUrl = "https://docs.agentcaller.io";

const exampleRequest = {
  destination: "+12125550123",
  destinationCountry: "US",
  language: "en",
  maxDurationSeconds: 180,
  maxAmountUsd: 1.2,
  task: {
    type: "information",
    questions: ["What time does the kitchen close?"],
  },
} satisfies CreateCallInput;

const capabilities = [
  {
    title: "A specific task",
    description:
      "Request a reservation, an appointment, an availability check, or an answer to a question.",
  },
  {
    title: "Limits in the request",
    description:
      "Specify a maximum call duration and spend ceiling alongside the task. Keep the scope explicit.",
  },
  {
    title: "A language for the conversation",
    description:
      "English and Spanish are the intended MVP languages, with language selected per call.",
  },
] as const;

export default function HomePage() {
  return (
    <div className="relative z-1 min-h-screen bg-(--void) px-[clamp(1.25rem,4vw,4rem)] font-sans text-(--ink) antialiased selection:bg-(--signal) selection:text-(--void) [&_a:focus-visible]:rounded-xs [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-5 [&_a:focus-visible]:outline-(--signal)">
      <a
        className="absolute top-4 left-4 z-2 translate-y-[-200%] bg-(--signal) px-4 py-3 text-(--void) focus:translate-y-0"
        href="#main-content"
      >
        Skip to content
      </a>

      <header className="mx-auto flex min-h-24 w-full max-w-304 items-center justify-between gap-4 border-b border-(--line) max-[480px]:min-h-20 max-[480px]:gap-2">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-[0.7rem] text-[1.2rem] font-[650] tracking-[-0.03em] max-[480px]:gap-2 max-[480px]:text-base"
          aria-label="AgentCaller home"
        >
          <PhoneCall size={22} className="text-(--signal)" aria-hidden="true" />
          <span>
            AgentCaller
            <span className="font-normal text-(--muted) max-[480px]:hidden">
              .io
            </span>
          </span>
        </Link>
        <nav
          className="flex items-center gap-[clamp(1rem,3vw,2.5rem)] text-[0.9375rem] max-[480px]:gap-3.5 max-[480px]:text-sm"
          aria-label="Main navigation"
        >
          <Link
            href={docsUrl}
            className="flex min-h-11 items-center hover:text-(--signal)"
          >
            Docs
          </Link>
          <Link
            href="/app"
            className="flex min-h-11 items-center gap-[0.4rem] hover:text-(--signal)"
          >
            Control room
            <ArrowUpRight
              size={16}
              className="max-[480px]:hidden"
              aria-hidden="true"
            />
          </Link>
        </nav>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-304 focus-visible:rounded-xs focus-visible:outline-2 focus-visible:outline-offset-5 focus-visible:outline-(--signal)"
        tabIndex={-1}
      >
        <section
          className="grid grid-cols-[1.1fr_1fr] items-center gap-[clamp(2.5rem,6vw,6rem)] py-[clamp(3.5rem,7vw,6.5rem)] max-[900px]:grid-cols-1 max-[900px]:gap-10 max-[480px]:py-12"
          aria-labelledby="hero-title"
        >
          <div>
            <h1
              id="hero-title"
              className="max-w-[9ch] text-[clamp(3.5rem,5.6vw,5rem)] leading-[1.04] font-[650] tracking-[-0.04em] text-balance max-[900px]:max-w-[12ch] max-[900px]:text-[clamp(3.25rem,8vw,4.75rem)]"
            >
              Give your agent a phone line.
            </h1>
            <p className="mt-7 max-w-[35ch] text-xl leading-[1.6] max-[480px]:text-lg">
              Not every business has an API. AgentCaller is an API for AI agents
              that need to call one.
            </p>
            <p className="mt-4 max-w-[46ch] text-base leading-[1.7] text-(--muted)">
              A table to book. A time to check. A question only someone on the
              other end can answer. Define the task, the language, and the
              limits in one request.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 max-[480px]:flex-col">
              <Link
                href={docsUrl}
                className="inline-flex min-h-12 items-center justify-center gap-3 rounded-md border border-transparent bg-(--signal) px-4.5 py-3 text-[0.9375rem] font-semibold text-(--void) hover:bg-(--ink)"
              >
                Read the API docs
                <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
              <Link
                href="/app"
                className="inline-flex min-h-12 items-center justify-center gap-3 rounded-md border border-(--muted) px-4.5 py-3 text-[0.9375rem] font-semibold hover:border-(--ink) hover:bg-(--panel)"
              >
                Open control room
              </Link>
            </div>
            <p className="mt-6 max-w-[47ch] text-sm leading-[1.65] text-(--muted)">
              <span className="mr-2 font-semibold text-(--ink)">Prototype</span>
              In development. Not ready for unattended production calls or
              billing.
            </p>
          </div>

          <figure className="min-w-0 overflow-hidden rounded-[14px] border border-(--line) bg-(--panel) max-[900px]:w-full max-[900px]:max-w-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--line) px-6 py-5 text-sm max-[480px]:p-4">
              <span className="inline-flex items-center gap-[0.6rem] font-semibold">
                <Code2 size={18} aria-hidden="true" />
                Your agent
              </span>
              <span className="text-(--muted)">Example request</span>
            </div>
            <div className="flex flex-wrap gap-3 px-6 pt-5 font-mono text-[0.8125rem] leading-[1.8] max-[480px]:px-4">
              <span className="font-semibold text-(--signal)">POST</span>
              <code>/api/v1/calls</code>
            </div>
            <pre className="px-6 pt-4 font-mono text-[0.8125rem] leading-[1.8] wrap-anywhere whitespace-pre-wrap max-[480px]:px-4">
              <code>{JSON.stringify(exampleRequest, null, 2)}</code>
            </pre>
            <div
              className="flex flex-col items-center gap-1 py-4 text-(--signal)"
              aria-hidden="true"
            >
              <span className="h-3 w-px bg-(--signal)" />
              <ArrowDown size={18} />
              <span className="h-3 w-px bg-(--signal)" />
            </div>
            <div className="flex items-center gap-4 px-6 max-[480px]:gap-3 max-[480px]:px-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-full border border-(--signal) text-(--signal)">
                <PhoneCall size={24} aria-hidden="true" />
              </span>
              <div>
                <p className="text-base font-semibold">A business phone</p>
                <p className="mt-1 text-sm leading-normal text-(--muted)">
                  The other end of your request.
                </p>
              </div>
            </div>
            <figcaption className="px-6 py-5 text-[0.8125rem] leading-[1.6] text-(--muted) max-[480px]:p-4">
              Illustrative request with a fictional number. No live call is
              placed.
            </figcaption>
          </figure>
        </section>

        <section
          className="grid grid-cols-[1fr_1.25fr] gap-[clamp(2.5rem,6vw,6rem)] border-t border-(--line) pt-14 pb-16 max-[900px]:grid-cols-1 max-[900px]:gap-8 max-[480px]:py-10"
          aria-labelledby="details-title"
        >
          <div>
            <h2
              id="details-title"
              className="max-w-[14ch] text-[clamp(1.875rem,3vw,2.5rem)] leading-[1.15] font-semibold tracking-[-0.03em] text-balance"
            >
              One call. A clear brief.
            </h2>
            <p className="mt-4 max-w-[32ch] text-base leading-[1.7] text-(--muted)">
              Built around bounded business tasks, not open-ended conversations.
            </p>
            <Link
              className="mt-4 inline-flex min-h-11 items-center gap-2 text-[0.9375rem] text-(--signal) underline underline-offset-[0.3em] hover:text-(--ink)"
              href={docsUrl}
            >
              Explore the API contract
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <dl>
            {capabilities.map(({ title, description }) => (
              <div
                key={title}
                className="grid grid-cols-[1fr_1.4fr] gap-6 border-b border-(--line) py-5 text-[0.9375rem] leading-[1.6] first:pt-0 last:border-b-0 last:pb-0 max-[480px]:grid-cols-1 max-[480px]:gap-2"
              >
                <dt className="font-semibold">{title}</dt>
                <dd className="text-(--muted)">{description}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-304 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-(--line) py-5 text-sm leading-[1.6] text-(--muted)">
        <span>AgentCaller.io</span>
        <p className="max-[480px]:basis-full">
          An API for the businesses you still have to call.
        </p>
        <Link
          href={docsUrl}
          className="inline-flex min-h-11 items-center text-(--ink) hover:text-(--signal)"
        >
          Documentation
        </Link>
      </footer>
    </div>
  );
}

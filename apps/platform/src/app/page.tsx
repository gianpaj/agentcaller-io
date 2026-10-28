import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { CallDemo } from "./call-demo";

const docsUrl = "https://docs.agentcaller.io";

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
          <Image
            src="/icon.svg"
            width={36}
            height={36}
            alt=""
            className="shrink-0"
            unoptimized
          />
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

          <CallDemo />
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

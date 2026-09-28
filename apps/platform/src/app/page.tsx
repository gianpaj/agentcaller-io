import Link from "next/link";
import { Globe2, PhoneCall, ShieldCheck, TerminalSquare } from "lucide-react";
import { CallDemo } from "./call-demo";
import styles from "./landing.module.css";

const features = [
  {
    Icon: PhoneCall,
    title: "A phone number is enough",
    copy: "For the table you can’t book online, the stock you need checked, and the question only a person can answer.",
  },
  {
    Icon: Globe2,
    title: "English or Spanish",
    copy: "Designed for conversations in either language. Your agent brings the task; AgentCaller handles the call.",
  },
  {
    Icon: ShieldCheck,
    title: "You set the limits",
    copy: "Give each call a specific task, a time limit, and a budget. Keep the scope clear before the phone rings.",
  },
];

export default function HomePage() {
  return (
    <main className={styles.landing}>
      <nav className={styles.nav} aria-label="Main navigation">
        <Link href="/" className={styles.logo} aria-label="AgentCaller home">
          <TerminalSquare size={22} aria-hidden="true" />
          <span>agentcaller.io</span>
        </Link>
        <div className={styles.navLinks}>
          <a href="https://docs.agentcaller.io">Docs</a>
          <Link href="/app" className={styles.navCta}>
            Open app
          </Link>
        </div>
      </nav>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.intro}>
          <p className={styles.availability}>
            <span aria-hidden="true" />
            In development
          </p>
          <h1 id="hero-title">
            Your AI agent,
            <br />
            on the phone.
          </h1>
          <p className={styles.description}>
            Book a table. Check availability. Get an answer. Give your agent a
            way in when a business only has a phone number.
          </p>
          <div className={styles.actions}>
            <a href="https://docs.agentcaller.io" className={styles.primaryCta}>
              Explore the API
            </a>
            <Link href="/app" className={styles.secondaryCta}>
              Open app
            </Link>
          </div>
          <p className={styles.heroNote}>
            A task in. A conversation. An answer back.
          </p>
        </div>
        <CallDemo />
      </section>

      <section className={styles.features} aria-label="What AgentCaller is for">
        {features.map(({ Icon, title, copy }) => (
          <article key={title}>
            <Icon size={21} aria-hidden="true" />
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

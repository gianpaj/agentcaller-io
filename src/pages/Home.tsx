import { motion, type Variants } from "framer-motion";
import { useGetWaitlistCount } from "@/api-client";
import { TerminalTranscript } from "@/components/TerminalTranscript";
import { WaitlistForm } from "@/components/WaitlistForm";
import {
  Terminal,
  Phone,
  Globe2,
  Coins,
  Code2,
  ChevronRight,
  Cpu,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const fadeIn: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

const stagger: Variants = {
  visible: { transition: { staggerChildren: 0.1 } },
};

export default function Home() {
  const { data: waitlistCountData } = useGetWaitlistCount();
  const count = waitlistCountData?.count || 0;

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden selection:bg-primary selection:text-background">
      {/* Abstract Noise Overlay */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03] z-50 mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      ></div>

      {/* Nav */}
      <nav className="fixed top-0 w-full z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-primary font-bold text-lg tracking-tighter uppercase">
            <Terminal className="w-5 h-5" />
            <span>AgentCaller.io</span>
          </div>
          <div className="hidden md:flex items-center space-x-8 text-sm uppercase tracking-widest text-muted-foreground">
            <a
              href="#features"
              className="hover:text-primary transition-colors"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="hover:text-primary transition-colors"
            >
              Protocol
            </a>
            <a
              href="#developers"
              className="hover:text-primary transition-colors"
            >
              API
            </a>
            <a href="#faq" className="hover:text-primary transition-colors">
              FAQ
            </a>
          </div>
          {/*<div>
            <a href="#waitlist" className="hidden md:inline-flex items-center justify-center px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary border border-primary/50 hover:bg-primary hover:text-background transition-all neon-glow">
              Initialize
            </a>
          </div>*/}
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 px-6">
        {/* Background Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#00ff4108_1px,transparent_1px),linear-gradient(to_bottom,#00ff4108_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none"></div>

        <div className="container mx-auto max-w-6xl relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial="hidden"
              animate="visible"
              variants={stagger}
              className="space-y-8"
            >
              <motion.div
                variants={fadeIn}
                className="inline-flex items-center space-x-2 px-3 py-1 border border-primary/30 bg-primary/5 text-primary text-xs font-bold uppercase tracking-widest"
              >
                <span className="w-2 h-2 bg-primary rounded-full animate-pulse"></span>
                <span>System Online v1.0.0</span>
              </motion.div>

              <motion.h1
                variants={fadeIn}
                className="text-5xl md:text-7xl font-bold tracking-tighter leading-none"
              >
                YOUR AI AGENT, <br />
                <span className="text-transparent bg-clip-text bg-linear-to-r from-primary to-primary/50">
                  ON THE PHONE.
                </span>
              </motion.h1>

              <motion.p
                variants={fadeIn}
                className="text-lg md:text-xl text-muted-foreground max-w-lg leading-relaxed"
              >
                AgentCaller lets your agent call any business — book a table,
                check availability, get things done — even when the only way in
                is a phone number.
              </motion.p>

              <motion.div
                variants={fadeIn}
                className="space-y-4 pt-4"
                id="waitlist"
              >
                <WaitlistForm />
                <p className="text-xs text-muted-foreground uppercase tracking-widest flex items-center">
                  <Cpu className="w-3 h-3 mr-2" />
                  Join {count > 0 ? count : "100+"} developers on the waitlist
                </p>
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="w-full relative"
            >
              <div className="absolute -inset-4 bg-primary/10 blur-2xl rounded-full opacity-50 animate-pulse"></div>
              <TerminalTranscript />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        className="py-24 px-6 border-t border-border/50 bg-background/50"
      >
        <div className="container mx-auto max-w-6xl">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeIn}
            className="mb-16"
          >
            <h2 className="text-3xl font-bold uppercase tracking-tighter">
              Core Capabilities
            </h2>
            <div className="h-1 w-20 bg-primary mt-4"></div>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={stagger}
            className="grid md:grid-cols-2 gap-6"
          >
            {[
              {
                icon: Phone,
                title: "Calls Real Businesses",
                desc: "Interact with real humans in real-time. No robotic menus, just natural conversation driven by your agent's objective.",
              },
              {
                icon: Globe2,
                title: "English & Spanish",
                desc: "Native-level fluency in multiple languages. Automatically detect and switch languages based on the recipient.",
              },
              {
                icon: Coins,
                title: "Agent-Native Payments",
                desc: "Pay per completed call using x402 protocol (USDC on Base). Fully autonomous billing without credit cards.",
              },
              {
                icon: Code2,
                title: "Simple API",
                desc: "One REST endpoint to initiate a call. Receive structured JSON extraction of the outcome via webhook.",
              },
            ].map((feature, i) => (
              <motion.div
                key={i}
                variants={fadeIn}
                className="group relative border border-border bg-card p-8 hover:border-primary/50 transition-colors duration-300"
              >
                <div className="absolute inset-0 bg-linear-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <feature.icon className="w-10 h-10 text-primary mb-6" />
                <h3 className="text-xl font-bold uppercase tracking-tight mb-3">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  {feature.desc}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section
        id="how-it-works"
        className="py-24 px-6 border-t border-border/50"
      >
        <div className="container mx-auto max-w-6xl">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeIn}
            className="mb-16 text-center"
          >
            <h2 className="text-3xl font-bold uppercase tracking-tighter">
              Execution Protocol
            </h2>
            <div className="h-1 w-20 bg-primary mx-auto mt-4"></div>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-12 left-10 right-10 h-px bg-border z-0"></div>

            {[
              {
                step: "01",
                title: "Dispatch Task",
                desc: "Send target phone number, agent persona, and specific objective via API.",
              },
              {
                step: "02",
                title: "Execution",
                desc: "AgentCaller synthesizes the voice, places the call, and negotiates the task with the human.",
              },
              {
                step: "03",
                title: "Extraction",
                desc: "Call terminates. You receive structured JSON data (e.g., reservation time) and pay the USDC fee.",
              },
            ].map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.2 }}
                className="relative z-10 flex flex-col items-center text-center"
              >
                <div className="w-24 h-24 rounded-none border border-primary bg-background flex items-center justify-center text-2xl font-bold text-primary mb-6 shadow-[0_0_15px_rgba(0,255,65,0.2)]">
                  {step.step}
                </div>
                <h3 className="text-xl font-bold uppercase tracking-tight mb-3">
                  {step.title}
                </h3>
                <p className="text-muted-foreground">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* For Developers */}
      <section
        id="developers"
        className="py-24 px-6 border-t border-border/50 bg-primary/5"
      >
        <div className="container mx-auto max-w-6xl grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeIn}
          >
            <h2 className="text-3xl font-bold uppercase tracking-tighter mb-6">
              Built for Machines
            </h2>
            <p className="text-xl text-muted-foreground mb-8 leading-relaxed">
              No UI needed. AgentCaller is an infrastructure layer designed
              specifically for autonomous agents to interact with the legacy
              voice network. Send a payload, get a result.
            </p>
            <a
              href="#"
              className="inline-flex items-center text-primary font-bold uppercase tracking-widest hover:underline decoration-primary underline-offset-4 group"
            >
              Read the docs{" "}
              <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="border border-border bg-[#050505] p-6 text-sm overflow-x-auto relative"
          >
            <div className="absolute top-0 right-0 px-3 py-1 bg-border text-muted-foreground text-xs uppercase tracking-widest">
              POST /api/v1/call
            </div>
            <pre className="text-gray-300 font-mono mt-4">
              <span className="text-pink-400">await</span> fetch(
              <span className="text-green-400">
                'https://api.agentcaller.io/v1/call'
              </span>
              , {"{"}
              method: <span className="text-green-400">'POST'</span>, headers:{" "}
              {"{"}
              <span className="text-blue-400">'Authorization'</span>:{" "}
              <span className="text-green-400">'Bearer ac_live_...'</span>,
              <span className="text-primary font-bold">'X-402-Payment'</span>:{" "}
              <span className="text-green-400">'usdc:base:0.12'</span>
              {"}"}, body: JSON.stringify({"{"}
              phone: <span className="text-green-400">'+14155550199'</span>,
              objective:{" "}
              <span className="text-green-400">
                'Book a table for 2 on Friday at 7pm.'
              </span>
              , extract: {"{"}
              time: <span className="text-green-400">'string'</span>, confirmed:{" "}
              <span className="text-green-400">'boolean'</span>
              {"}"}
              {"}"}){"}"});
            </pre>
          </motion.div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 px-6 border-t border-border/50">
        <div className="container mx-auto max-w-3xl">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeIn}
            className="mb-16 text-center"
          >
            <h2 className="text-3xl font-bold uppercase tracking-tighter">
              System Queries
            </h2>
            <div className="h-1 w-20 bg-primary mx-auto mt-4"></div>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={fadeIn}
          >
            <Accordion type="single" collapsible className="w-full">
              {[
                {
                  q: "What exactly is AgentCaller?",
                  a: "It's an API that allows AI agents to make real-world phone calls to businesses, negotiate objectives, and return structured data. It bridges the gap between digital agents and legacy voice-only infrastructure.",
                },
                {
                  q: "Which businesses can it call?",
                  a: "Any valid phone number. It excels at restaurants, salons, customer service queues, and small businesses that lack digital booking systems.",
                },
                {
                  q: "How does the x402 payment work?",
                  a: "We utilize the x402 protocol on the Base network (USDC). You include a payment header with your API request. If the call successfully achieves the objective, the funds are captured. If not, the transaction is reversed.",
                },
                {
                  q: "What languages are supported?",
                  a: "Currently, we support English and Spanish natively, with automatic detection if the human answers in Spanish.",
                },
                {
                  q: "Is there a webhook for the results?",
                  a: "Yes. Phone calls are asynchronous. You dispatch the call, we return an execution ID, and we hit your configured webhook with the extracted JSON payload once the call completes.",
                },
                {
                  q: "When is the launch?",
                  a: "We are onboarding developers from the waitlist in batches starting Q3 2026.",
                },
              ].map((faq, i) => (
                <AccordionItem
                  key={i}
                  value={`item-${i}`}
                  className="border-border"
                >
                  <AccordionTrigger className="text-left font-bold uppercase tracking-tight hover:text-primary transition-colors text-lg">
                    {faq.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground text-base leading-relaxed">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </motion.div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-32 px-6 border-t border-border/50 bg-primary/5 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,255,65,0.1)_0%,transparent_70%)]"></div>
        <div className="container mx-auto max-w-4xl text-center relative z-10">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="flex flex-col items-center"
          >
            <motion.h2
              variants={fadeIn}
              className="text-4xl md:text-6xl font-bold uppercase tracking-tighter mb-6"
            >
              Give your agent <br /> a voice.
            </motion.h2>
            <motion.div
              variants={fadeIn}
              className="w-full max-w-md mx-auto mb-4"
            >
              <WaitlistForm />
            </motion.div>
            <motion.p
              variants={fadeIn}
              className="text-sm text-muted-foreground uppercase tracking-widest"
            >
              Limited beta access. Protocol initiation pending.
            </motion.p>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-border/50 bg-background text-sm">
        <div className="container mx-auto flex flex-col md:flex-row items-center justify-between">
          <div className="text-muted-foreground uppercase tracking-widest mb-4 md:mb-0">
            &copy; 2026 AgentCaller.io
          </div>
          <div className="flex space-x-6 uppercase tracking-widest text-muted-foreground">
            <a href="#" className="hover:text-primary transition-colors">
              Terms
            </a>
            <a href="#" className="hover:text-primary transition-colors">
              Privacy
            </a>
            <a href="#" className="hover:text-primary transition-colors">
              Twitter
            </a>
            <a href="#" className="hover:text-primary transition-colors">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

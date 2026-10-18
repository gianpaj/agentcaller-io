"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Pause, PhoneCall, Play, RotateCcw } from "lucide-react";
import styles from "./landing.module.css";

const conversation = [
  { speaker: "System", text: "Dialing La Trattoria…", delay: 1000 },
  { speaker: "Host", text: "La Trattoria, this is Marco.", delay: 1400 },
  {
    speaker: "Agent",
    text: "Hi, I’m an AI assistant calling for Alex. Do you have a table for two on Friday at 8?",
    delay: 1600,
  },
  { speaker: "Host", text: "We do. Shall I put it under Alex?", delay: 2600 },
  { speaker: "Agent", text: "Yes, please. Thank you!", delay: 1800 },
  {
    speaker: "Host",
    text: "You’re all set. Friday at 8, table for two.",
    delay: 1600,
  },
];
const lastFrame = conversation.length + 1;
const steps = ["Send a task", "Make the call", "Get the result"];

export function CallDemo() {
  const demoRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  // Render the complete example without JavaScript, then animate after hydration.
  const [frame, setFrame] = useState(lastFrame);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.2 },
    );
    if (demoRef.current) observer.observe(demoRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => {
      setReducedMotion(preference.matches);
      setFrame(preference.matches ? lastFrame : 0);
      setPaused(false);
    };
    syncPreference();
    preference.addEventListener("change", syncPreference);
    return () => preference.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    if (!inView || paused || reducedMotion || frame === lastFrame) return;
    const timer = window.setTimeout(
      () => setFrame((current) => current + 1),
      conversation[frame]?.delay ?? 1800,
    );
    return () => window.clearTimeout(timer);
  }, [frame, inView, paused, reducedMotion]);

  const complete = frame === lastFrame;
  const activeStep = complete ? 2 : frame === 0 ? 0 : 1;

  function replay() {
    setFrame(0);
    setPaused(false);
  }

  return (
    <figure
      ref={demoRef}
      className={styles.demo}
      aria-label="Illustrative reservation call"
    >
      <div className={styles.terminal}>
        <div className={styles.terminalHeader}>
          <div className={styles.sessionTitle}>
            <PhoneCall size={15} aria-hidden="true" />
            <span>reservation.example</span>
          </div>
          <span className={styles.exampleBadge}>Demo</span>
        </div>
        <ol className={styles.steps} aria-label="Call stages">
          {steps.map((step, index) => (
            <li
              key={step}
              className={index <= activeStep ? styles.activeStep : undefined}
              aria-current={index === activeStep ? "step" : undefined}
            >
              <span className={styles.stepNumber} aria-hidden="true">
                {index < activeStep ? <Check size={12} /> : index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
        <div className={styles.terminalBody}>
          <div className={styles.task}>
            <span className={styles.prompt} aria-hidden="true">
              ›
            </span>
            <div>
              <p className={styles.taskLabel}>Your agent’s task</p>
              <p>
                Book a table for two at La Trattoria. Friday, 8pm. Under Alex.
              </p>
            </div>
          </div>
          <ol className={styles.transcript} aria-label="Example conversation">
            {conversation.map((line, index) => (
              <li
                key={index}
                className={`${styles.line} ${index < frame ? styles.lineVisible : ""}`}
                aria-hidden={index >= frame}
              >
                <span className={styles.lineNumber} aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span
                  className={
                    line.speaker === "Agent" ? styles.agent : styles.speaker
                  }
                >
                  {line.speaker}
                </span>
                <span
                  className={
                    line.speaker === "System" ? styles.system : undefined
                  }
                >
                  {line.text}
                </span>
              </li>
            ))}
          </ol>
          <div className={styles.result}>
            <div
              className={complete ? styles.resultVisible : styles.resultHidden}
              aria-hidden={!complete}
            >
              <p className={styles.resultTitle}>
                <Check size={15} aria-hidden="true" /> Reservation confirmed
              </p>
              <p className={styles.resultDetails}>
                Alex <span aria-hidden="true">/</span> 2 guests
                <span aria-hidden="true">/</span> Friday, 8pm
              </p>
              <code>
                {'{ "booked": true, "party_size": 2, "time": "20:00" }'}
              </code>
            </div>
            {!complete && (
              <p className={styles.pending}>
                <span className={styles.cursor} aria-hidden="true" />
                {paused
                  ? "Demo paused"
                  : frame === 0
                    ? "Task ready to send"
                    : "Call in progress"}
              </p>
            )}
          </div>
        </div>
        <div className={styles.terminalFooter}>
          <span>Task → call → result</span>
          {!reducedMotion && (
            <div className={styles.playback}>
              {!complete && (
                <button
                  type="button"
                  onClick={() => setPaused((current) => !current)}
                  aria-label={paused ? "Play demo" : "Pause demo"}
                >
                  {paused ? <Play size={13} /> : <Pause size={13} />}
                  {paused ? "Play" : "Pause"}
                </button>
              )}
              <button type="button" onClick={replay} aria-label="Replay demo">
                <RotateCcw size={13} /> Replay
              </button>
            </div>
          )}
        </div>
      </div>
      <figcaption className={styles.demoCaption}>
        An illustrative call, shortened for this demo.
      </figcaption>
    </figure>
  );
}

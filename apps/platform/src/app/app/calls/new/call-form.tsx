"use client";
import { useActionState } from "react";
import type { CreateCallInput } from "@agentcaller/contracts";
import { startCall } from "./actions";
export function CallForm({
  initial,
  idempotencyKey,
  redialOf,
  enabled,
}: {
  initial?: CreateCallInput;
  idempotencyKey: string;
  redialOf?: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(startCall, { error: "" });
  const task = initial?.task.type === "connect_me" ? initial.task : undefined;
  const limits = [
    ["ringingSeconds", "Business ringing", 40, 10, 60],
    ["waitingSeconds", "IVR / hold waiting", 120, 10, 300],
    ["handoffSeconds", "Total handoff", 90, 20, 120],
    ["callbackRingingSeconds", "Callback ringing", 40, 10, 60],
    ["acceptanceSeconds", "Press-1 acceptance", 15, 5, 30],
    ["conversationSeconds", "Human conversation", 600, 30, 1200],
  ] as const;
  return (
    <form action={action} className="phone-form">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="redialOf" value={redialOf ?? ""} />
      <fieldset disabled={pending || !enabled}>
        <section className="phone-panel">
          <h2>Who are we calling?</h2>
          <label>
            Business name (optional)
            <input
              name="clientReference"
              maxLength={120}
              defaultValue={initial?.clientReference}
              placeholder="Post office"
            />
          </label>
          <label>
            Business phone
            <input
              name="destination"
              type="tel"
              inputMode="tel"
              required
              defaultValue={initial?.destination}
              placeholder="+34… or +39…"
            />
            <small>
              Spanish or Italian geographic business number, in international
              format.
            </small>
          </label>
          <div className="phone-fields">
            <label>
              Country
              <select
                name="destinationCountry"
                defaultValue={initial?.destinationCountry ?? "ES"}
              >
                <option value="ES">Spain</option>
                <option value="IT">Italy</option>
              </select>
            </label>
            <label>
              Business language
              <select name="language" defaultValue={initial?.language ?? "es"}>
                <option value="es">Spanish</option>
                <option value="it">Italian</option>
              </select>
            </label>
          </div>
          <label>
            Purpose
            <textarea
              name="purpose"
              required
              maxLength={300}
              defaultValue={task?.purpose}
              placeholder="Connect me to ask about collecting a parcel."
            />
          </label>
          <label>
            Your Spanish mobile
            <input
              name="callbackNumber"
              type="tel"
              inputMode="tel"
              required
              defaultValue={task?.callbackNumber}
              placeholder="+346…"
            />
          </label>
          <label>
            Your callback language
            <select
              name="callbackLanguage"
              defaultValue={task?.callbackLanguage ?? "es"}
            >
              <option value="es">Spanish</option>
              <option value="it">Italian</option>
              <option value="en">English</option>
            </select>
          </label>
          <p className="phone-muted">
            The assistant discloses that it is automated. When a person is
            reached, your mobile rings. Press 1 to join. Calls are not recorded.
          </p>
        </section>
        <section className="phone-panel">
          <h2>When may we call?</h2>
          <p className="phone-muted">
            Enter the business's permitted hours. A queued call waits for this
            window.
          </p>
          <label>
            Timezone
            <input
              name="timezone"
              required
              placeholder="Europe/Madrid or Europe/Rome"
              defaultValue={task?.callingWindow.timezone}
            />
          </label>
          <div
            className="phone-weekdays"
            role="group"
            aria-label="Permitted weekdays"
          >
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => (
              <label key={day}>
                <input
                  type="checkbox"
                  name="weekdays"
                  value={i + 1}
                  defaultChecked={task?.callingWindow.weekdays.includes(i + 1)}
                />
                {day}
              </label>
            ))}
          </div>
          <div className="phone-fields">
            <label>
              From
              <input
                type="time"
                name="start"
                required
                defaultValue={task?.callingWindow.start}
              />
            </label>
            <label>
              Until
              <input
                type="time"
                name="end"
                required
                defaultValue={task?.callingWindow.end}
              />
            </label>
          </div>
          <label>
            Overall deadline (UTC or explicit offset)
            <input
              name="expiresAt"
              required
              placeholder="2026-10-01T17:00:00+02:00"
            />
            <small>
              Within the next seven days. Redial requires a fresh deadline.
            </small>
          </label>
        </section>
        <section className="phone-panel">
          <h2>Call limits</h2>
          <div className="phone-fields">
            <label>
              Total spend cap (USD)
              <input
                name="maxAmountUsd"
                type="number"
                min="0.01"
                max="500"
                step="0.01"
                required
                defaultValue={initial?.maxAmountUsd ?? 5}
              />
            </label>
            <label>
              Maximum attempts
              <input
                name="maxAttempts"
                type="number"
                min="1"
                max="6"
                required
                defaultValue={task?.maxAttempts ?? 1}
              />
            </label>
          </div>
          <label>
            Retry delay (seconds)
            <input
              name="retryDelaySeconds"
              type="number"
              min="300"
              max="86400"
              required
              defaultValue={task?.retryDelaySeconds ?? 300}
            />
          </label>
          <p className="phone-muted">
            Only busy or no-answer can retry automatically. Each new job has its
            own cap. Operator funding pays provider charges without x402.
          </p>
          <details>
            <summary>Duration and IVR limits</summary>
            <div className="phone-fields">
              {limits.map(([name, label, value, min, max]) => (
                <label key={name}>
                  {label} (seconds)
                  <input
                    type="number"
                    name={name}
                    min={min}
                    max={max}
                    required
                    defaultValue={task?.[name] ?? value}
                  />
                </label>
              ))}
            </div>
            <label>
              Maximum IVR digits
              <input
                name="maxIvrDigits"
                type="number"
                min="0"
                max="5"
                required
                defaultValue={task?.maxIvrDigits ?? 0}
              />
            </label>
          </details>
        </section>
        <label className="phone-check">
          <input type="checkbox" required />I authorize this call with the
          destinations, hours, and spending limit above.
        </label>
        <button
          className="phone-primary phone-submit"
          disabled={pending || !enabled}
        >
          {pending
            ? "Submitting…"
            : redialOf
              ? "Confirm and redial"
              : "Start call"}
        </button>
      </fieldset>
      {!enabled && (
        <p role="status">
          Calling is disabled. Configure operator funding and explicitly
          authorize a live test before enabling it.
        </p>
      )}
      {state.error && (
        <p role="alert" className="phone-error">
          {state.error}
        </p>
      )}
    </form>
  );
}

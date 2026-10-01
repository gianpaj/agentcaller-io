"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { CALL_NOW_TTL_MS, type CreateCallInput } from "@agentcaller/contracts";
import { ZodError } from "zod";
import { unstable_rethrow } from "next/navigation";
import { portalCallInput } from "@/lib/portal-call-input";
import { portalCallError, type CallFormState } from "@/lib/portal-call-errors";
import { getCallNowDeadline, startCall } from "./actions";

const panelClass =
  "grid w-full min-w-0 gap-5 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 sm:p-6";
const inputClass =
  "min-h-12 w-full min-w-0 rounded-md border border-[var(--muted)] bg-[var(--void)] px-3 py-3 text-base font-normal text-[var(--ink)] [color-scheme:dark] placeholder:text-[var(--muted)] aria-invalid:border-[var(--ember)] disabled:cursor-not-allowed";
const helpClass = "text-sm font-normal leading-6 text-[var(--muted)]";
const headingClass = "text-lg font-semibold leading-7 text-[var(--ink)]";
const shortcutClass =
  "min-h-11 rounded-md border border-[var(--muted)] px-3 py-2 text-sm font-medium text-[var(--ink)] enabled:hover:border-[var(--signal)] disabled:cursor-not-allowed";
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const timezones = [
  ["Europe/Madrid", "Spain mainland / Balearic Islands"],
  ["Atlantic/Canary", "Canary Islands"],
  ["Europe/Rome", "Italy"],
] as const;
const emptyState: CallFormState = { error: "", fieldErrors: {} };
const limits = [
  ["ringingSeconds", "Business ringing", 40, 10, 60],
  ["waitingSeconds", "IVR / hold waiting", 120, 10, 300],
  ["handoffSeconds", "Total handoff", 90, 20, 120],
  ["callbackRingingSeconds", "Callback ringing", 40, 10, 60],
  ["acceptanceSeconds", "Press-1 acceptance", 15, 5, 30],
  ["conversationSeconds", "Human conversation", 600, 30, 1200],
] as const;

function Field({
  name,
  label,
  help,
  error,
  children,
}: {
  name: string;
  label: string;
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 content-start gap-2 text-sm font-medium text-(--ink)">
      <label htmlFor={name}>{label}</label>
      {children}
      {help && (
        <p id={`${name}-help`} className={helpClass}>
          {help}
        </p>
      )}
      {error && (
        <p
          id={`${name}-error`}
          className="text-sm font-normal leading-6 text-(--ember)"
        >
          {error}
        </p>
      )}
    </div>
  );
}

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
  const [state, action, pending] = useActionState(
    async (previous: CallFormState, form: FormData): Promise<CallFormState> => {
      try {
        if (form.get("scheduleMode") === "now") {
          // Use server time once, then retain the deadline even if submission
          // fails in transit. The browser clock is only used for preflight.
          immediateExpiresAt.current ??= await getCallNowDeadline();
          form.set("immediateExpiresAt", immediateExpiresAt.current);
        }
        return await startCall(previous, form);
      } catch (error) {
        unstable_rethrow(error);
        return {
          error:
            "Could not confirm submission. Check Recents, then retry this same form to avoid a duplicate call.",
          fieldErrors: {},
        };
      }
    },
    emptyState,
  );
  const [localError, setLocalError] = useState<CallFormState | null>(null);
  const feedback = localError ?? state;
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const task = initial?.task.type === "connect_me" ? initial.task : undefined;
  const initialWindow =
    task?.callingWindow !== "now" ? task?.callingWindow : undefined;
  const [scheduleMode, setScheduleMode] = useState(
    initialWindow ? "scheduled" : "now",
  );
  const callNow = scheduleMode === "now";
  const immediateExpiresAt = useRef<string | null>(null);
  const [schedule, setSchedule] = useState({
    timezone: initialWindow?.timezone ?? "",
    weekdays: initialWindow?.weekdays ?? [],
    start: initialWindow?.start ?? "",
    end: initialWindow?.end ?? "",
    expiresAt: "",
  });

  useEffect(() => {
    if (!feedback.error || pending) return;
    const invalid = formRef.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"]:not(:disabled)',
    );
    const details = invalid?.closest("details");
    if (details) details.open = true;
    (invalid ?? summaryRef.current)?.focus();
  }, [feedback, pending]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !enabled) return;
    const form = new FormData(event.currentTarget);
    if (callNow) {
      form.set(
        "immediateExpiresAt",
        new Date(Date.now() + CALL_NOW_TTL_MS).toISOString(),
      );
    }
    try {
      portalCallInput(form);
    } catch (error) {
      setLocalError(
        error instanceof ZodError
          ? portalCallError(error)
          : {
              error:
                "Could not validate the call. Your entries are still here. Try again.",
              fieldErrors: {},
            },
      );
      return;
    }
    setLocalError(null);
    // Dispatch manually: a form action resets uncontrolled inputs even when
    // the server returns a validation error. Keep the draft until redirect.
    startTransition(() => action(form));
  }

  function control(name: string, help?: string) {
    const error = feedback.fieldErrors[name];
    return {
      id: name,
      name,
      className: inputClass,
      "aria-invalid": error ? (true as const) : undefined,
      "aria-describedby":
        [help && `${name}-help`, error && `${name}-error`]
          .filter(Boolean)
          .join(" ") || undefined,
    };
  }

  function input(
    name: string,
    label: string,
    props: InputHTMLAttributes<HTMLInputElement>,
    help?: string,
  ) {
    return (
      <Field
        name={name}
        label={label}
        help={help}
        error={feedback.fieldErrors[name]}
      >
        <input {...control(name, help)} {...props} />
      </Field>
    );
  }

  function select(
    name: string,
    label: string,
    value: string,
    options: readonly (readonly [string, string])[],
  ) {
    return (
      <Field name={name} label={label} error={feedback.fieldErrors[name]}>
        <select {...control(name)} defaultValue={value}>
          {options.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  const timezoneLabel =
    timezones.find(([value]) => value === schedule.timezone)?.[1] ??
    schedule.timezone;
  const scheduleComplete =
    schedule.weekdays.length > 0 &&
    schedule.timezone &&
    schedule.start &&
    schedule.end &&
    schedule.start < schedule.end;

  return (
    <form ref={formRef} onSubmit={submit} className="grid w-full min-w-0 gap-6">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="redialOf" value={redialOf ?? ""} />
      {!enabled && (
        <p
          id="calling-disabled"
          role="status"
          className="rounded-xl border border-[var(--ember)] bg-[var(--panel)] p-5 text-sm leading-6 text-[var(--ink)]"
        >
          Calling is disabled. Configure operator funding and explicitly
          authorize a live test before enabling it.
        </p>
      )}
      {feedback.error && !pending && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="min-w-0 rounded-xl border border-[var(--ember)] bg-[var(--panel)] p-5 text-sm leading-6 break-words text-[var(--ink)]"
        >
          <p className="font-semibold">Your entries have been kept.</p>
          <p className="mt-1">
            {Object.keys(feedback.fieldErrors).length
              ? "Check the highlighted fields, then try again."
              : feedback.error}
          </p>
          {Object.entries(feedback.fieldErrors)
            .filter(
              ([name]) => name === "idempotencyKey" || name === "redialOf",
            )
            .map(([name, message]) => (
              <p key={name}>{message}</p>
            ))}
        </div>
      )}
      <fieldset
        disabled={pending || !enabled}
        aria-describedby={!enabled ? "calling-disabled" : undefined}
        className="grid w-full min-w-0 gap-6 sm:gap-8"
      >
        <section className={panelClass} aria-labelledby="business-heading">
          <h2 id="business-heading" className={headingClass}>
            Business
          </h2>
          {input("clientReference", "Business name (optional)", {
            maxLength: 120,
            defaultValue: initial?.clientReference,
            placeholder: "Post office",
          })}
          {input(
            "destination",
            "Business phone",
            {
              type: "tel",
              inputMode: "tel",
              required: true,
              defaultValue: initial?.destination,
              placeholder: "+34… or +39…",
            },
            "Use a Spanish or Italian landline or mobile number with its country code (+34 or +39), matching the country below. Premium, service, and emergency numbers are not supported.",
          )}
          {select(
            "destinationCountry",
            "Country",
            initial?.destinationCountry ?? "ES",
            [
              ["ES", "Spain"],
              ["IT", "Italy"],
            ],
          )}
          {select("language", "Business language", initial?.language ?? "es", [
            ["es", "Spanish"],
            ["it", "Italian"],
          ])}
          <Field
            name="purpose"
            label="Purpose"
            error={feedback.fieldErrors.purpose}
          >
            <textarea
              {...control("purpose")}
              className={`${inputClass} resize-y`}
              rows={4}
              required
              maxLength={300}
              defaultValue={task?.purpose}
              placeholder="Connect me to ask about collecting a parcel."
            />
          </Field>
        </section>
        <section className={panelClass} aria-labelledby="callback-heading">
          <h2 id="callback-heading" className={headingClass}>
            Your callback
          </h2>
          {input("callbackNumber", "Your Spanish mobile", {
            type: "tel",
            inputMode: "tel",
            required: true,
            defaultValue: task?.callbackNumber,
            placeholder: "+346…",
          })}
          {select(
            "callbackLanguage",
            "Your callback language",
            task?.callbackLanguage ?? "es",
            [
              ["es", "Spanish"],
              ["it", "Italian"],
              ["en", "English"],
            ],
          )}
          <p className={helpClass}>
            The assistant discloses that it is automated. When a person is
            reached, your mobile rings. Press 1 to join. Calls are not recorded.
          </p>
        </section>
        <section className={panelClass} aria-labelledby="hours-heading">
          <div className="grid gap-2">
            <h2 id="hours-heading" className={headingClass}>
              When can we call?
            </h2>
          </div>
          <div
            role="radiogroup"
            aria-labelledby="hours-heading"
            className="grid gap-3 sm:grid-cols-2"
          >
            {[
              ["now", "Call now"],
              ["scheduled", "Choose calling hours"],
            ].map(([value, label]) => (
              <label
                key={value}
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-(--muted) px-3 py-3 text-base text-(--ink) has-checked:border-(--signal) has-checked:bg-(--void) has-disabled:cursor-not-allowed"
              >
                <input
                  id={
                    value === "now" ? "scheduleMode" : "scheduleMode-scheduled"
                  }
                  type="radio"
                  name="scheduleMode"
                  value={value}
                  checked={scheduleMode === value}
                  className="size-5 shrink-0 accent-(--signal)"
                  aria-invalid={
                    feedback.fieldErrors.scheduleMode ? true : undefined
                  }
                  aria-describedby={
                    feedback.fieldErrors.scheduleMode
                      ? "scheduleMode-error"
                      : undefined
                  }
                  onChange={() => {
                    setScheduleMode(value!);
                    setLocalError(emptyState);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
          {feedback.fieldErrors.scheduleMode && (
            <p
              id="scheduleMode-error"
              className="text-sm leading-6 text-(--ember)"
            >
              {feedback.fieldErrors.scheduleMode}
            </p>
          )}
          {callNow && (
            <p className={helpClass}>
              One attempt, as soon as a worker is available. No automatic
              retries. The request expires 30 minutes after submission,
              including time waiting and on the call.
            </p>
          )}
          <fieldset
            disabled={callNow}
            hidden={callNow}
            className={callNow ? "hidden" : "grid min-w-0 gap-5"}
          >
            <legend className="sr-only">Calling hours</legend>
            <p className={helpClass}>
              Choose hours when the business accepts calls. We wait until this
              window to dial.
            </p>
            <Field
              name="timezone"
              label="Business timezone"
              help="All times below use this timezone, including the deadline."
              error={feedback.fieldErrors.timezone}
            >
              <select
                {...control("timezone", "help")}
                required
                value={schedule.timezone}
                onChange={(event) =>
                  setSchedule({ ...schedule, timezone: event.target.value })
                }
              >
                <option value="" disabled>
                  Choose the business location
                </option>
                {timezones.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
                {schedule.timezone &&
                  !timezones.some(([value]) => value === schedule.timezone) && (
                    <option value={schedule.timezone}>
                      {schedule.timezone}
                    </option>
                  )}
              </select>
            </Field>
            <fieldset className="grid min-w-0 gap-3">
              <legend className="mb-3 text-sm font-medium text-[var(--ink)]">
                Calling days
              </legend>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={shortcutClass}
                  onClick={() =>
                    setSchedule({ ...schedule, weekdays: [1, 2, 3, 4, 5] })
                  }
                >
                  Mon–Fri
                </button>
                <button
                  type="button"
                  className={shortcutClass}
                  onClick={() =>
                    setSchedule({
                      ...schedule,
                      weekdays: [1, 2, 3, 4, 5, 6, 7],
                    })
                  }
                >
                  Every day
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {days.map((day, index) => (
                  <label
                    key={day}
                    className="relative flex min-h-12 cursor-pointer items-center justify-center rounded-md border border-[var(--muted)] bg-[var(--void)] px-1 py-3 text-sm font-medium text-[var(--ink)] has-checked:border-[var(--signal)] has-checked:bg-[var(--signal)] has-checked:text-[var(--void)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[var(--signal)] has-disabled:cursor-not-allowed"
                  >
                    <input
                      id={`weekday-${index + 1}`}
                      className="peer sr-only"
                      type="checkbox"
                      name="weekdays"
                      value={index + 1}
                      checked={schedule.weekdays.includes(index + 1)}
                      aria-invalid={
                        feedback.fieldErrors.weekdays ? true : undefined
                      }
                      aria-describedby={
                        feedback.fieldErrors.weekdays
                          ? "weekdays-help weekdays-error"
                          : "weekdays-help"
                      }
                      onChange={(event) =>
                        setSchedule({
                          ...schedule,
                          weekdays: event.target.checked
                            ? [...schedule.weekdays, index + 1].sort(
                                (a, b) => a - b,
                              )
                            : schedule.weekdays.filter(
                                (day) => day !== index + 1,
                              ),
                        })
                      }
                    />
                    <span className="peer-checked:font-bold peer-checked:underline peer-checked:underline-offset-4">
                      {day}
                    </span>
                  </label>
                ))}
              </div>
              <p id="weekdays-help" className={helpClass}>
                Select at least one day. Tap a selected day to remove it.
              </p>
              {feedback.fieldErrors.weekdays && (
                <p
                  id="weekdays-error"
                  className="text-sm leading-6 text-[var(--ember)]"
                >
                  {feedback.fieldErrors.weekdays}
                </p>
              )}
            </fieldset>
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              {input("start", "From", {
                type: "time",
                required: true,
                value: schedule.start,
                onChange: (event) =>
                  setSchedule({ ...schedule, start: event.target.value }),
              })}
              {input(
                "end",
                "Until",
                {
                  type: "time",
                  required: true,
                  value: schedule.end,
                  onChange: (event) =>
                    setSchedule({ ...schedule, end: event.target.value }),
                },
                "Later than the start, on the same day.",
              )}
            </div>
            <div className="grid gap-5 border-t border-[var(--line)] pt-5">
              {input(
                "expiresAt",
                "Stop trying after",
                {
                  type: "datetime-local",
                  required: true,
                  value: schedule.expiresAt,
                  onChange: (event) =>
                    setSchedule({ ...schedule, expiresAt: event.target.value }),
                },
                `Choose a date and time within the next seven days${timezoneLabel ? `, in ${timezoneLabel}` : ""}. No new attempts start after this deadline. Redial needs a fresh deadline.`,
              )}
              <p role="status" className="text-sm leading-6 text-[var(--ink)]">
                {scheduleComplete
                  ? `Calling window: ${schedule.weekdays.map((day) => days[day - 1]).join(", ")}, ${schedule.start}–${schedule.end} (${timezoneLabel}).`
                  : "Choose a timezone, days, and hours to set your calling window."}
              </p>
            </div>
          </fieldset>
        </section>
        <section className={panelClass} aria-labelledby="limits-heading">
          <h2 id="limits-heading" className={headingClass}>
            Call limits
          </h2>
          {input("maxAmountUsd", "Total spend cap (USD)", {
            type: "number",
            min: "0.01",
            max: "500",
            step: "0.01",
            required: true,
            defaultValue: initial?.maxAmountUsd ?? 5,
          })}
          <fieldset
            disabled={callNow}
            hidden={callNow}
            className={callNow ? "hidden" : "grid min-w-0 gap-5"}
          >
            <legend className="sr-only">Retry limits</legend>
            {input("maxAttempts", "Maximum attempts", {
              type: "number",
              min: "1",
              max: "6",
              required: true,
              defaultValue: task?.maxAttempts ?? 1,
            })}
            {input("retryDelaySeconds", "Retry delay (seconds)", {
              type: "number",
              min: "300",
              max: "86400",
              required: true,
              defaultValue: task?.retryDelaySeconds ?? 300,
            })}
            <p className={helpClass}>
              Only busy or no-answer can retry automatically.
            </p>
          </fieldset>
          <p className={helpClass}>
            Each new job has its own cap. Operator funding pays provider charges
            without x402.
          </p>
          <details className="min-w-0 border-t border-[var(--line)] pt-5">
            <summary className="min-h-12 cursor-pointer py-3 text-base font-medium text-[var(--ink)] hover:text-[var(--signal)]">
              Duration and IVR limits
            </summary>
            <div className="grid min-w-0 gap-5 pt-5">
              {limits.map(([name, label, value, min, max]) => (
                <div key={name}>
                  {input(name, `${label} (seconds)`, {
                    type: "number",
                    min,
                    max,
                    required: true,
                    defaultValue: task?.[name] ?? value,
                  })}
                </div>
              ))}
              {input("maxIvrDigits", "Maximum IVR digits", {
                type: "number",
                min: "0",
                max: "5",
                required: true,
                defaultValue: task?.maxIvrDigits ?? 0,
              })}
            </div>
          </details>
        </section>
        <label className="flex min-h-11 min-w-0 items-start gap-3 text-base leading-6 text-[var(--ink)]">
          <input
            className="mt-0.5 size-5 shrink-0 accent-[var(--signal)] disabled:cursor-not-allowed"
            type="checkbox"
            name="authorized"
            required
          />
          <span>
            {callNow
              ? "I authorize one call now to these destinations, within the spending and duration limits above."
              : "I authorize this call with the destinations, hours, and spending limit above."}
          </span>
        </label>
        <button
          className="min-h-12 w-full min-w-0 cursor-pointer rounded-md border border-transparent bg-[var(--signal)] px-5 py-3 text-base font-semibold text-[var(--void)] enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:border-[var(--muted)] disabled:bg-[var(--panel)] disabled:text-[var(--muted)]"
          disabled={pending || !enabled}
        >
          {pending
            ? "Submitting…"
            : redialOf
              ? "Confirm and redial"
              : callNow
                ? "Call now"
                : "Start call"}
        </button>
      </fieldset>
    </form>
  );
}

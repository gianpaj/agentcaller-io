import type { ZodError } from "zod";

export type CallFormState = {
  error: string;
  fieldErrors: Record<string, string>;
};

const fields: Record<string, readonly [string, string]> = {
  destination: [
    "destination",
    "Enter a Spanish or Italian geographic business number in international format, matching the selected country.",
  ],
  destinationCountry: ["destinationCountry", "Choose Spain or Italy."],
  language: [
    "language",
    "Choose Spanish or Italian for the business language.",
  ],
  clientReference: [
    "clientReference",
    "Keep the business name to 120 characters or fewer.",
  ],
  maxAmountUsd: [
    "maxAmountUsd",
    "Enter a spend cap greater than $0 and no more than $500.",
  ],
  maxDurationSeconds: [
    "conversationSeconds",
    "Waiting, handoff, and conversation must total between 60 and 1,800 seconds.",
  ],
  idempotencyKey: [
    "idempotencyKey",
    "The submission identifier is invalid. Check Recents before opening a new form.",
  ],
  redialOf: [
    "redialOf",
    "The original call could not be identified. Open it from Recents to redial.",
  ],
  "task.callbackNumber": [
    "callbackNumber",
    "Enter a Spanish mobile number in international format, starting with +34.",
  ],
  "task.callbackLanguage": [
    "callbackLanguage",
    "Choose Spanish, Italian, or English for the callback language.",
  ],
  "task.purpose": ["purpose", "Enter a purpose between 1 and 300 characters."],
  "task.expiresAt": ["expiresAt", "Enter a valid deadline date and time."],
  "task.callingWindow.timezone": [
    "timezone",
    "Enter a valid timezone, such as Europe/Madrid, Europe/Rome, or Atlantic/Canary.",
  ],
  "task.callingWindow.weekdays": [
    "weekdays",
    "Select at least one permitted weekday, from Monday through Sunday.",
  ],
  "task.callingWindow.start": [
    "start",
    "Enter a start time in 24-hour format (HH:mm).",
  ],
  "task.callingWindow.end": [
    "end",
    "Enter an end time in 24-hour format (HH:mm).",
  ],
  "task.maxAttempts": [
    "maxAttempts",
    "Enter a whole number of attempts between 1 and 6.",
  ],
  "task.retryDelaySeconds": [
    "retryDelaySeconds",
    "Enter a whole-number retry delay between 300 and 86,400 seconds.",
  ],
  "task.ringingSeconds": [
    "ringingSeconds",
    "Enter a whole-number business ringing limit between 10 and 60 seconds.",
  ],
  "task.waitingSeconds": [
    "waitingSeconds",
    "Enter a whole-number IVR / hold waiting limit between 10 and 300 seconds.",
  ],
  "task.handoffSeconds": [
    "handoffSeconds",
    "Enter a whole-number handoff limit between 20 and 120 seconds.",
  ],
  "task.callbackRingingSeconds": [
    "callbackRingingSeconds",
    "Enter a whole-number callback ringing limit between 10 and 60 seconds.",
  ],
  "task.acceptanceSeconds": [
    "acceptanceSeconds",
    "Enter a whole-number press-1 acceptance limit between 5 and 30 seconds.",
  ],
  "task.conversationSeconds": [
    "conversationSeconds",
    "Enter a whole-number conversation limit between 30 and 1,200 seconds.",
  ],
  "task.maxIvrDigits": [
    "maxIvrDigits",
    "Enter a whole number of IVR digits between 0 and 5.",
  ],
};

const deadlineMessages = new Set([
  "Enter a valid deadline date and time.",
  "Choose a deadline in the future.",
  "Choose a deadline within the next seven days.",
  "This local time does not exist because the clocks change. Choose another deadline.",
  "This local time occurs twice because the clocks change. Choose an unambiguous deadline.",
]);

export function portalCallError(error: ZodError): CallFormState {
  const fieldErrors: Record<string, string> = {};
  let unknown = false;
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    let field = Object.hasOwn(fields, path) ? fields[path] : undefined;
    if (/^task\.callingWindow\.weekdays\.\d+$/.test(path))
      field = fields["task.callingWindow.weekdays"];
    if (issue.code === "custom") {
      if (
        path === "task.callingWindow" &&
        issue.message === "Window must end on the same day after its start"
      )
        field = [
          "end",
          "Choose an end time after the start time on the same day.",
        ];
      if (
        path === "task" &&
        issue.message === "Handoff must cover callback ringing and acceptance"
      )
        field = [
          "handoffSeconds",
          "Total handoff must cover callback ringing plus press-1 acceptance.",
        ];
      if (path === "task.expiresAt" && deadlineMessages.has(issue.message))
        field = ["expiresAt", issue.message];
    }
    if (field) {
      const [name, message] = field;
      fieldErrors[name] = fieldErrors[name]
        ? fieldErrors[name].includes(message)
          ? fieldErrors[name]
          : `${fieldErrors[name]} ${message}`
        : message;
    } else {
      unknown = true;
    }
  }
  const messages = Object.values(fieldErrors);
  if (unknown || !messages.length)
    messages.push(
      "Could not validate the call. Review the form and try again.",
    );
  return { error: messages.join(" "), fieldErrors };
}

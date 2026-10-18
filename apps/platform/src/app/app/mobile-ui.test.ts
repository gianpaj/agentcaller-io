import { createElement } from "react";
import { createCallSchema, type CreateCallInput } from "@agentcaller/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/app",
  startCall: vi.fn(),
  getCallNowDeadline: vi.fn(),
  rethrow: vi.fn(),
  capturedAction: null as
    | null
    | ((previous: any, form: FormData) => Promise<any>),
  refresh: vi.fn(),
  listCallHistory: vi.fn(),
  parseCursor: vi.fn(),
  formState: null as null | {
    error: string;
    fieldErrors: Record<string, string>;
  },
  confirmForm: undefined as FormData | undefined,
  setConfirmForm: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (initial === undefined) {
        return [mocks.confirmForm, mocks.setConfirmForm];
      }
      return actual.useState(initial);
    },
    useActionState: (action: any, initial: unknown) => {
      mocks.capturedAction = action;
      return [mocks.formState ?? initial, mocks.startCall, false];
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: mocks.refresh }),
  unstable_rethrow: mocks.rethrow,
}));
vi.mock("./calls/new/actions", () => ({
  startCall: mocks.startCall,
  getCallNowDeadline: mocks.getCallNowDeadline,
}));
vi.mock("@/lib/portal", () => ({
  requireClientProfile: async () => ({ id: "ui-test-client" }),
}));
vi.mock("@/lib/call-history", () => ({
  historyCursor: { safeParse: mocks.parseCursor },
  listCallHistory: mocks.listCallHistory,
}));

import { CallNavigation } from "./call-navigation";
import { CallForm } from "./calls/new/call-form";
import NewCallPage from "./calls/new/page";
import HistoryPage from "./page";

function openingTag(markup: string, name: string) {
  const tag = markup.match(
    new RegExp(`<(?:input|select|textarea)\\b[^>]*\\bname="${name}"[^>]*>`),
  );
  expect(tag, `Missing form control: ${name}`).not.toBeNull();
  return tag![0];
}

beforeEach(() => {
  mocks.pathname = "/app";
  mocks.formState = null;
  mocks.confirmForm = undefined;
  vi.clearAllMocks();
  mocks.listCallHistory.mockResolvedValue([]);
  mocks.parseCursor.mockReturnValue({ success: false });
});

describe("mobile call navigation", () => {
  it.each([
    ["/app", "/app"],
    ["/app/calls/new", "/app/calls/new"],
    ["/app/calls/example", "/app"],
    ["/app/settings", "/app/settings"],
  ])("marks the correct destination at %s", (pathname, expectedHref) => {
    mocks.pathname = pathname;
    const markup = renderToStaticMarkup(createElement(CallNavigation));
    const active = (markup.match(/<a\b[^>]*>/g) ?? []).filter((tag) =>
      tag.includes('aria-current="page"'),
    );

    expect(active).toHaveLength(1);
    expect(active[0]).toContain(`href="${expectedHref}"`);
    expect(markup).toContain('aria-label="Call navigation"');
  });
});

describe("recent calls presentation", () => {
  async function renderHistory() {
    return renderToStaticMarkup(
      await HistoryPage({ searchParams: Promise.resolve({}) }),
    );
  }

  function call(id = "example-call") {
    return {
      id,
      clientReference: "Example business",
      destination: "+12025550123",
      state: "failed",
      createdAt: new Date("2026-09-01T12:00:00Z"),
      endedAt: new Date("2026-09-01T12:01:00Z"),
      task: { type: "connect_me" },
      outcome: { reason: "busy" },
    };
  }

  it("shows one primary call link in the empty state", async () => {
    const markup = await renderHistory();
    expect(markup).toContain("No calls yet");
    expect(markup.match(/href="\/app\/calls\/new"/g)).toHaveLength(1);
    expect(mocks.listCallHistory).toHaveBeenCalledWith(
      "ui-test-client",
      undefined,
    );
  });

  it("shows outcome, date, and review-before-redial for eligible calls", async () => {
    mocks.listCallHistory.mockResolvedValue([call()]);
    const markup = await renderHistory();
    expect(markup).toContain("Example business");
    expect(markup).toContain("failed · busy");
    expect(markup).toContain('dateTime="2026-09-01T12:00:00.000Z"');
    expect(markup).toContain('href="/app/calls/new?redial=example-call"');
    expect(markup).not.toContain("No calls yet");
  });

  it("does not offer quick redial for active or refused calls", async () => {
    mocks.listCallHistory.mockResolvedValue([
      { ...call("active"), endedAt: null, state: "in_progress" },
      { ...call("refused"), outcome: { reason: "refused" } },
    ]);
    const markup = await renderHistory();
    expect(markup).not.toContain("?redial=");
    expect(markup).toContain('href="/app/calls/active"');
    expect(markup).toContain('href="/app/calls/refused"');
    expect(markup).toContain("Progress refreshes every 4 seconds");
  });

  it("keeps the 30-row page and its cursor links", async () => {
    mocks.listCallHistory.mockResolvedValue(
      Array.from({ length: 31 }, (_, index) => call(`example-${index}`)),
    );
    mocks.parseCursor.mockReturnValue({
      success: true,
      data: { id: "cursor" },
    });
    const markup = await renderHistory();
    expect(markup.match(/<li\b/g)).toHaveLength(30);
    expect(markup).toContain("Latest calls");
    expect(markup).toContain("Older calls");
    expect(markup).toContain("before=example-29");
    expect(markup).not.toContain("example-30");
    expect(mocks.listCallHistory).toHaveBeenCalledWith("ui-test-client", {
      id: "cursor",
    });
  });
});

describe("new-call presentation safeguards", () => {
  function renderForm(
    enabled: boolean,
    redialOf?: string,
    initial?: CreateCallInput,
  ) {
    return renderToStaticMarkup(
      createElement(CallForm, {
        enabled,
        idempotencyKey: "ui-test-key",
        redialOf,
        initial,
      }),
    );
  }

  it("keeps disabled calling gated and explains it before the fields", () => {
    const markup = renderForm(false);
    expect(markup).toMatch(/<fieldset[^>]*disabled=""/);
    expect(markup).toMatch(/<button[^>]*disabled=""/);
    expect(markup).toContain('aria-describedby="calling-disabled"');
    expect(markup.indexOf('id="calling-disabled"')).toBeLessThan(
      markup.indexOf("<fieldset"),
    );
    expect(mocks.startCall).not.toHaveBeenCalled();
  });

  it("keeps the full request contract and explicit authorization", () => {
    const markup = renderForm(true);
    expect(markup.match(/<fieldset[^>]*>/)?.[0]).not.toContain("disabled");
    expect(markup).not.toMatch(/<button[^>]*disabled=""/);
    expect(markup).not.toContain('id="calling-disabled"');

    for (const name of [
      "idempotencyKey",
      "redialOf",
      "clientReference",
      "destination",
      "destinationCountry",
      "language",
      "purpose",
      "callbackNumber",
      "callbackLanguage",
      "timezone",
      "weekdays",
      "start",
      "end",
      "expiresAt",
      "maxAmountUsd",
      "maxAttempts",
      "retryDelaySeconds",
      "ringingSeconds",
      "waitingSeconds",
      "handoffSeconds",
      "callbackRingingSeconds",
      "acceptanceSeconds",
      "conversationSeconds",
      "maxIvrDigits",
    ]) {
      openingTag(markup, name);
    }

    expect(openingTag(markup, "idempotencyKey")).toContain(
      'value="ui-test-key"',
    );
    expect(openingTag(markup, "redialOf")).toContain('value=""');
    const authorization = (markup.match(/<input\b[^>]*>/g) ?? []).find(
      (tag) => tag.includes('type="checkbox"') && tag.includes('required=""'),
    );
    expect(authorization).toBeDefined();
    expect(authorization).not.toContain('checked=""');
    expect(markup).toContain("Spanish or Italian landline or mobile number");
    expect(markup).not.toContain(
      "Mobile and service numbers are not supported",
    );
    expect(markup).toContain("I authorize one call now");
    expect(markup).toContain("Call now");
    expect(mocks.startCall).not.toHaveBeenCalled();
  });

  it("preserves funding, retry, and advanced duration defaults and bounds", () => {
    const markup = renderForm(true);
    for (const [name, value, min, max] of [
      ["maxAmountUsd", 5, 0.01, 500],
      ["maxAttempts", 1, 1, 6],
      ["retryDelaySeconds", 300, 300, 86400],
      ["ringingSeconds", 40, 10, 60],
      ["waitingSeconds", 120, 10, 300],
      ["handoffSeconds", 90, 20, 120],
      ["callbackRingingSeconds", 40, 10, 60],
      ["acceptanceSeconds", 15, 5, 30],
      ["conversationSeconds", 600, 30, 1200],
      ["maxIvrDigits", 0, 0, 5],
    ] as const) {
      const tag = openingTag(markup, name);
      expect(tag).toContain(`value="${value}"`);
      expect(tag).toContain(`min="${min}"`);
      expect(tag).toContain(`max="${max}"`);
      expect(tag).toContain('required=""');
    }
    expect(markup.match(/name="weekdays"/g)).toHaveLength(7);
    expect(markup).not.toMatch(/<details[^>]*open/);
  });

  it("defaults to Call now and disables hidden scheduling and retry fields", () => {
    const markup = renderForm(true);
    expect(openingTag(markup, "scheduleMode")).toContain('value="now"');
    expect(openingTag(markup, "scheduleMode")).toContain('checked=""');
    expect(
      markup.match(/<fieldset[^>]*disabled=""[^>]*hidden=""/g),
    ).toHaveLength(2);
    expect(markup).toContain("One attempt, as soon as a worker is available.");
    expect(markup).toContain("No automatic retries.");
    expect(markup).toContain("30 minutes after submission");
  });

  it.each(["now", "scheduled"])(
    "preserves %s redial mode but requires a fresh deadline",
    (mode) => {
      const initial = createCallSchema.parse({
        destination: "+34911234567",
        destinationCountry: "ES",
        language: "es",
        maxDurationSeconds: 810,
        maxAmountUsd: 5,
        task: {
          type: "connect_me",
          callbackNumber: "+34612345678",
          callbackLanguage: "en",
          purpose: "Ask about opening hours",
          maxAttempts: mode === "now" ? 1 : 2,
          expiresAt: "2026-07-01T12:00:00.000Z",
          callingWindow:
            mode === "now"
              ? "now"
              : {
                  timezone: "Europe/Rome",
                  weekdays: [2, 4],
                  start: "10:00",
                  end: "16:00",
                },
        },
      });
      const markup = renderForm(true, "previous-call", initial);
      const modeInputs =
        markup.match(/<input[^>]*name="scheduleMode"[^>]*>/g) ?? [];
      expect(modeInputs.find((tag) => tag.includes('checked=""'))).toContain(
        `value="${mode}"`,
      );
      expect(openingTag(markup, "expiresAt")).toContain('value=""');
      expect(markup).not.toContain("2026-07-01T12:00");
      if (mode === "scheduled") {
        expect(markup).not.toMatch(/<fieldset[^>]*disabled/);
        expect(openingTag(markup, "start")).toContain('value="10:00"');
        expect(openingTag(markup, "maxAttempts")).toContain('value="2"');
        expect(markup).toContain("I authorize this call");
      }
    },
  );

  it("keeps schedule controls available for choosing calling hours", () => {
    const markup = renderForm(true);
    expect(markup).toContain("When can we call?");
    expect(markup).toContain("Spain mainland / Balearic Islands");
    expect(markup).toContain("Canary Islands");
    expect(markup).toContain("Mon–Fri");
    expect(markup).toContain("Every day");
    expect(markup).toContain(
      "All times below use this timezone, including the deadline.",
    );
    expect(openingTag(markup, "expiresAt")).toContain('type="datetime-local"');
    expect(openingTag(markup, "expiresAt")).toContain('value=""');
    expect(markup).not.toMatch(/<input[^>]*name="weekdays"[^>]*checked=""/);
    expect(openingTag(markup, "start")).toContain('value=""');
    expect(openingTag(markup, "end")).toContain('value=""');
    // Keep a form action alongside onSubmit so pre-hydration submits cannot fall back to GET.
    expect(markup.match(/<form[^>]*>/)?.[0]).toMatch(/\baction=/);
  });

  it("associates readable errors with fields and announces preserved entries", () => {
    mocks.formState = {
      error: "Review the form.",
      fieldErrors: {
        destination: "Use a supported landline or mobile number.",
        weekdays: "Choose at least one calling day.",
        handoffSeconds: "Allow enough time for the callback.",
      },
    };
    const markup = renderForm(true);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Your entries have been kept.");
    expect(openingTag(markup, "destination")).toContain('aria-invalid="true"');
    expect(openingTag(markup, "destination")).toContain(
      'aria-describedby="destination-help destination-error"',
    );
    expect(markup).toContain('id="weekdays-error"');
    expect(openingTag(markup, "weekdays")).toContain(
      'aria-describedby="weekdays-help weekdays-error"',
    );
    expect(openingTag(markup, "handoffSeconds")).toContain(
      'aria-invalid="true"',
    );
    expect(markup).toMatch(/<details[^>]*open=""/);
    expect(markup).toContain("Allow enough time for the callback.");
    expect(markup).not.toContain("task.callingWindow");
  });

  it("shows server failures without disabling a retry", () => {
    mocks.formState = {
      error: "Could not confirm submission. Check Recents.",
      fieldErrors: {},
    };
    const markup = renderForm(true);
    expect(markup).toContain(mocks.formState.error);
    expect(markup).toContain("Your entries have been kept.");
    expect(markup.match(/<fieldset[^>]*>/)?.[0]).not.toContain("disabled");
    expect(openingTag(markup, "idempotencyKey")).toContain(
      'value="ui-test-key"',
    );
  });

  it("keeps redial confirmation separate from a new call", () => {
    const markup = renderForm(true, "previous-call");
    expect(openingTag(markup, "redialOf")).toContain('value="previous-call"');
    expect(markup).toContain("Confirm and redial");
    expect(mocks.startCall).not.toHaveBeenCalled();
  });
  it("retains the server deadline across transport errors and resets it after a returned rejection", async () => {
    renderForm(true);
    mocks.getCallNowDeadline
      .mockResolvedValueOnce("2026-07-01T12:30:00.000Z")
      .mockResolvedValueOnce("2026-07-01T12:50:00.000Z");
    mocks.startCall
      .mockRejectedValueOnce(new Error("Transport lost"))
      .mockResolvedValueOnce({
        error: "Active-call limit reached",
        fieldErrors: {},
      })
      .mockResolvedValueOnce({ error: "", fieldErrors: {} });

    const first = new FormData();
    first.set("scheduleMode", "now");
    const transportState = await mocks.capturedAction!(
      { error: "", fieldErrors: {} },
      first,
    );
    expect(transportState.error).toMatch(/Could not confirm submission/);
    expect(first.get("immediateExpiresAt")).toBe("2026-07-01T12:30:00.000Z");
    expect(mocks.rethrow).toHaveBeenCalledTimes(1);

    const retry = new FormData();
    retry.set("scheduleMode", "now");
    const rejected = await mocks.capturedAction!(transportState, retry);
    expect(rejected.error).toBe("Active-call limit reached");
    expect(retry.get("immediateExpiresAt")).toBe("2026-07-01T12:30:00.000Z");

    const fresh = new FormData();
    fresh.set("scheduleMode", "now");
    await mocks.capturedAction!(rejected, fresh);
    expect(fresh.get("immediateExpiresAt")).toBe("2026-07-01T12:50:00.000Z");
    expect(mocks.getCallNowDeadline).toHaveBeenCalledTimes(2);
  });

  it("keys CallForm on the generated idempotency key", async () => {
    const element = await NewCallPage({ searchParams: Promise.resolve({}) });
    const formElement = (element.props.children as any[]).find(
      (child) => child?.type === CallForm,
    );
    expect(formElement?.key).toBe(formElement?.props.idempotencyKey);
  });
  it("prompts for confirmation when destination equals callbackNumber", () => {
    const data = new FormData();
    data.set("destination", "+34612345678");
    data.set("callbackNumber", "+34612345678");
    mocks.confirmForm = data;
    const markup = renderForm(true);
    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain("Call your own callback number?");
    expect(markup).toContain("+34612345678");
    expect(markup).toContain("Change number");
    expect(markup).toContain("Call anyway");
    expect(mocks.startCall).not.toHaveBeenCalled();
  });
});

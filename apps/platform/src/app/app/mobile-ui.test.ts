import { createElement } from "react";
import { createCallSchema, type CreateCallInput } from "@agentcaller/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/app",
  startCall: vi.fn(),
  refresh: vi.fn(),
  listCallHistory: vi.fn(),
  loadCallHistory: vi.fn(),
  parseCursor: vi.fn(),
  formState: null as null | {
    error: string;
    fieldErrors: Record<string, string>;
  },
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useActionState: (_action: unknown, initial: unknown) => [
    mocks.formState ?? initial,
    mocks.startCall,
    false,
  ],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: mocks.refresh }),
  unstable_rethrow: vi.fn(),
}));
vi.mock("./calls/new/actions", () => ({
  startCall: mocks.startCall,
  getCallNowDeadline: vi.fn(),
}));
vi.mock("@/lib/portal", () => ({
  requireClientProfile: async () => ({ id: "ui-test-client" }),
}));
vi.mock("@/lib/call-history", () => ({
  historyCursor: { safeParse: mocks.parseCursor },
  listCallHistory: mocks.listCallHistory,
  loadCallHistory: mocks.loadCallHistory,
}));

import { CallNavigation } from "./call-navigation";
import CallDetail from "./calls/[id]/page";
import { CallForm } from "./calls/new/call-form";
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

describe("call-detail presentation", () => {
  function detail() {
    return {
      call: {
        id: "detail-call",
        clientReference: "Example business",
        destination: "+34911234567",
        state: "failed",
        createdAt: new Date("2026-09-01T12:00:00Z"),
        endedAt: new Date("2026-09-01T12:05:00Z"),
        language: "es",
        fundingSource: "operator",
        maxAmountMicros: 5_250_000,
        task: {
          type: "connect_me",
          purpose: "Ask about opening hours",
          maxAttempts: 2,
        },
        outcome: { reason: "busy" },
      },
      job: {
        attemptCount: 0,
        reservedMicros: 1_750_000,
        nextAttemptAt: new Date("2026-09-01T12:10:00Z"),
      },
      attempts: [],
      legs: [],
      events: [],
    };
  }

  async function renderDetail(id = "detail-call") {
    return renderToStaticMarkup(
      await CallDetail({ params: Promise.resolve({ id }) }),
    );
  }

  function text(markup: string) {
    return markup
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function namedSection(markup: string, name: string) {
    const sections = [
      ...markup.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi),
    ];
    const matches = sections.filter(([, attributes, content]) => {
      const labelledBy = attributes.match(/\baria-labelledby="([^"]+)"/)?.[1];
      if (!labelledBy) return false;
      return [
        ...content.matchAll(/<h[1-6]\b([^>]*)>([\s\S]*?)<\/h[1-6]>/gi),
      ].some(([, headingAttributes, heading]) => {
        const id = headingAttributes.match(/\bid="([^"]+)"/)?.[1];
        return (
          id &&
          labelledBy.split(/\s+/).includes(id) &&
          new RegExp(`^${name}(?:$|\\s|·)`, "i").test(text(heading))
        );
      });
    });
    expect(matches, `Expected one section labelled ${name}`).toHaveLength(1);
    return matches[0]![2];
  }

  function definition(markup: string, label: string) {
    const lists = [...markup.matchAll(/<dl\b[^>]*>([\s\S]*?)<\/dl>/gi)];
    const pairs = lists.flatMap(([, content]) => [
      ...content.matchAll(
        /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi,
      ),
    ]);
    const matches = pairs.filter(
      ([, term]) => text(term).toLowerCase() === label.toLowerCase(),
    );
    expect(matches, `Expected one definition for ${label}`).toHaveLength(1);
    return matches[0]![2];
  }

  beforeEach(() => {
    mocks.loadCallHistory.mockResolvedValue(detail());
  });

  it("loads the requested call for the authenticated tenant and keeps its identity", async () => {
    const markup = await renderDetail("requested-call");
    expect(mocks.loadCallHistory).toHaveBeenCalledExactlyOnceWith(
      "ui-test-client",
      "requested-call",
    );
    expect(text(markup.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)![1])).toBe(
      "Example business",
    );
    expect(markup).toContain("+34911234567");
    expect(markup).toContain("Ask about opening hours");
    expect(text(markup)).toMatch(/\bfailed\b/i);
  });

  it("labels the call details, attempts, and status log sections", async () => {
    const markup = await renderDetail();
    for (const name of ["Call details", "Attempts", "Status log"]) {
      namedSection(markup, name);
    }
  });

  it("uses summary definitions for UTC start, raw language, funding, and monetary values", async () => {
    const summary = await renderDetail();
    const started = definition(summary, "Started");
    expect(started).toMatch(
      /<time\b[^>]*\bdatetime="2026-09-01T12:00:00\.000Z"[^>]*>/i,
    );
    expect(text(started)).toBe("1 Sept 2026, 12:00 UTC");
    expect(text(definition(summary, "Language"))).toBe("es");
    expect(text(definition(summary, "Funding"))).toBe("operator funded");
    expect(text(definition(summary, "Spend cap"))).toBe("$5.25");
    expect(text(definition(summary, "Reserved quote"))).toBe("$1.75");
  });

  it("falls back to the destination and omits absent purpose and job reservations", async () => {
    const fixture = detail();
    mocks.loadCallHistory.mockResolvedValue({
      ...fixture,
      call: {
        ...fixture.call,
        clientReference: null,
        task: { type: "connect_me", maxAttempts: 2 },
      },
      job: undefined,
    });
    const markup = await renderDetail();
    expect(text(markup.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)![1])).toBe(
      "+34911234567",
    );
    expect(markup).not.toContain("Ask about opening hours");
    expect(markup).not.toMatch(/Reserved quote/i);
    expect(markup).not.toContain("undefined");
  });

  it("explains when no attempts have started", async () => {
    const markup = await renderDetail();
    expect(markup).toContain("No attempt has started.");
    expect(markup).not.toContain("Attempt 1");
  });

  it("explains when the status log is empty", async () => {
    expect(await renderDetail()).toContain("No status events yet.");
  });

  it.each([
    [null, "unknown", "$0.0000"],
    [0, "$0.0000", "unknown"],
  ])(
    "keeps completed attempt and leg details with measured cost %s",
    async (measuredMicros, expectedCost, absentCost) => {
      const fixture = detail();
      mocks.loadCallHistory.mockResolvedValue({
        ...fixture,
        call: {
          ...fixture.call,
          state: "completed",
          outcome: { reason: "connected" },
        },
        job: { ...fixture.job, attemptCount: 1 },
        attempts: [
          {
            id: "attempt-1",
            ordinal: 1,
            state: "completed",
            reason: "connected",
            createdAt: new Date("2026-09-01T12:01:00Z"),
            endedAt: new Date("2026-09-01T12:04:00Z"),
          },
        ],
        legs: [
          {
            attemptId: "attempt-1",
            kind: "business",
            state: "ended",
            connectedAt: new Date("2026-09-01T12:01:10Z"),
            endedAt: new Date("2026-09-01T12:04:00Z"),
            measuredMicros: 123_400,
          },
          {
            attemptId: "attempt-1",
            kind: "callback",
            state: "ended",
            connectedAt: null,
            endedAt: new Date("2026-09-01T12:02:00Z"),
            measuredMicros,
          },
          {
            attemptId: "another-attempt",
            kind: "callback",
            state: "dialing",
            connectedAt: null,
            endedAt: null,
            measuredMicros: 9_990_000,
          },
        ],
      });
      const markup = await renderDetail();
      const attempt = [
        ...markup.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi),
      ].find(([, content]) => text(content).includes("Attempt 1"))?.[1];
      expect(attempt).toBeDefined();
      const content = text(attempt!);
      expect(content).toMatch(/Attempt 1[\s\S]*connected/i);
      expect(content).toContain("1 Sept 2026, 12:01 UTC");
      expect(content).toContain("1 Sept 2026, 12:04 UTC");
      const [business, callback] = content.split(/callback/i);
      expect(business).toMatch(/business[\s\S]*ended/i);
      expect(business).toContain("Answered 1 Sept 2026, 12:01 UTC");
      expect(business).toContain("Ended 1 Sept 2026, 12:04 UTC");
      expect(business).toMatch(/Measured cost:?\s*\$0\.1234/);
      expect(callback).toMatch(/\bended\b/i);
      expect(callback).toContain("No confirmed connection");
      expect(callback).toContain("Ended 1 Sept 2026, 12:02 UTC");
      expect(callback).toContain("Measured cost");
      expect(callback).toContain(expectedCost);
      expect(callback).not.toContain(absentCost);
      expect(text(markup)).toMatch(/\bcompleted\b/i);
      expect(markup).not.toContain("$9.9900");
      expect(markup).not.toContain("No attempt has started.");
    },
  );

  it("separates event names, context, and semantic UTC timestamps", async () => {
    mocks.loadCallHistory.mockResolvedValue({
      ...detail(),
      events: [
        {
          id: "event-1",
          type: "connect.attempt_ended",
          payload: { ordinal: 1, leg: "business", reason: "no_answer" },
          occurredAt: new Date("2026-09-01T12:03:00Z"),
        },
      ],
    });
    const markup = await renderDetail();
    const event = [...markup.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].find(
      ([, content]) => text(content).includes("connect · attempt ended"),
    )?.[1];
    expect(event).toBeDefined();
    expect(event).toMatch(/>\s*connect · attempt ended\s*</i);
    const time = event!.match(
      /<time\b[^>]*\bdatetime="2026-09-01T12:03:00\.000Z"[^>]*>([\s\S]*?)<\/time>/i,
    );
    expect(time).not.toBeNull();
    expect(text(time![1])).toBe("1 Sept 2026, 12:03 UTC");
    const context = text(event!.replace(/<time\b[^>]*>[\s\S]*?<\/time>/gi, ""));
    expect(context).toContain("Attempt 1 · business · no answer");
    expect(markup).not.toContain("No status events yet.");
  });

  it("offers cancellation and progress refresh for an active connect-me call", async () => {
    const fixture = detail();
    mocks.loadCallHistory.mockResolvedValue({
      ...fixture,
      call: {
        ...fixture.call,
        state: "in_progress",
        endedAt: null,
        outcome: null,
      },
    });
    const markup = await renderDetail();
    expect(text(markup)).toContain("in progress");
    const cancel = [
      ...markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi),
    ].find(([, content]) => text(content) === "Cancel call");
    expect(cancel).toBeDefined();
    expect(cancel![0]).not.toMatch(/\bdisabled=/);
    expect(openingTag(markup, "callId")).toContain('value="detail-call"');
    expect(markup).toContain("Progress refreshes every 4 seconds");
    expect(markup).not.toContain("?redial=");
  });

  it("offers review-before-redial for an eligible failed busy call", async () => {
    const markup = await renderDetail();
    expect(text(markup)).toMatch(/\bfailed\b/i);
    expect(text(markup)).toMatch(/\bbusy\b/i);
    const redial = [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].find(
      ([, , content]) => text(content) === "Review and redial",
    );
    expect(redial).toBeDefined();
    expect(redial![1]).toContain('href="/app/calls/new?redial=detail-call"');
    expect(markup).not.toContain("Cancel call");
    expect(markup).not.toContain("Progress refreshes every 4 seconds");
  });

  it.each([
    ["failed", "refused", "The business requested that calling stop."],
    [
      "cancelled",
      "cancelled",
      "Verify provider cleanup and configuration before starting another call. Quick redial is unavailable for this outcome.",
    ],
  ])(
    "blocks redial and cancellation for %s / %s",
    async (state, reason, blocked) => {
      const fixture = detail();
      mocks.loadCallHistory.mockResolvedValue({
        ...fixture,
        call: { ...fixture.call, state, outcome: { reason } },
      });
      const markup = await renderDetail();
      expect(markup).toContain(blocked);
      expect(text(markup)).toMatch(new RegExp(`\\b${state}\\b`, "i"));
      expect(markup).not.toContain("Cancel call");
      expect(markup).not.toContain("Review and redial");
      expect(markup).not.toContain("?redial=");
      expect(markup).not.toContain("Progress refreshes every 4 seconds");
    },
  );
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
    // Submission is dispatched from onSubmit so React cannot auto-reset drafts.
    expect(markup.match(/<form[^>]*>/)?.[0]).not.toMatch(/\baction=/);
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
});

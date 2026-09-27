import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/app",
  startCall: vi.fn(),
  refresh: vi.fn(),
  listCallHistory: vi.fn(),
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
vi.mock("./calls/new/actions", () => ({ startCall: mocks.startCall }));
vi.mock("@/lib/portal", () => ({
  requireClientProfile: async () => ({ id: "ui-test-client" }),
}));
vi.mock("@/lib/call-history", () => ({
  historyCursor: { safeParse: mocks.parseCursor },
  listCallHistory: mocks.listCallHistory,
}));

import { CallNavigation } from "./call-navigation";
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

describe("new-call presentation safeguards", () => {
  function renderForm(enabled: boolean, redialOf?: string) {
    return renderToStaticMarkup(
      createElement(CallForm, {
        enabled,
        idempotencyKey: "ui-test-key",
        redialOf,
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
    expect(markup).not.toMatch(/<fieldset[^>]*disabled/);
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
    expect(markup).toContain("I authorize this call");
    expect(markup).toContain("Start call");
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

  it("uses explicit schedule choices and a local date-time picker", () => {
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
        destination: "Use a supported business landline.",
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
    expect(markup).not.toMatch(/<fieldset[^>]*disabled/);
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

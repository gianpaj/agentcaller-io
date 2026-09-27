import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/app",
  refresh: vi.fn(),
  listCallHistory: vi.fn(),
  parseCursor: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/lib/portal", () => ({
  requireClientProfile: async () => ({ id: "ui-test-client" }),
}));
vi.mock("@/lib/call-history", () => ({
  historyCursor: { safeParse: mocks.parseCursor },
  listCallHistory: mocks.listCallHistory,
}));

import { CallNavigation } from "./call-navigation";
import HistoryPage from "./page";

beforeEach(() => {
  mocks.pathname = "/app";
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

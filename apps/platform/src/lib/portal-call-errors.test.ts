import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { portalCallError, type CallFormState } from "./portal-call-errors";

function issue(path: (string | number)[], message = "Internal schema detail") {
  return { code: "custom" as const, path, message };
}

describe("portalCallError", () => {
  it("maps cross-field issues to the controls that can fix them", () => {
    const state: CallFormState = portalCallError(
      new ZodError([
        issue(
          ["task", "callingWindow"],
          "Window must end on the same day after its start",
        ),
        issue(["task"], "Handoff must cover callback ringing and acceptance"),
        issue(["maxDurationSeconds"]),
      ]),
    );
    expect(state.fieldErrors).toEqual({
      end: "Choose an end time after the start time on the same day.",
      handoffSeconds:
        "Total handoff must cover callback ringing plus press-1 acceptance.",
      conversationSeconds:
        "Waiting, handoff, and conversation must total between 60 and 1,800 seconds.",
    });
  });

  it("maps hidden identifiers without printing schema paths", () => {
    const state = portalCallError(
      new ZodError([issue(["idempotencyKey"]), issue(["redialOf"])]),
    );
    expect(state.fieldErrors.idempotencyKey).toMatch(/submission identifier/);
    expect(state.fieldErrors.redialOf).toMatch(/original call/);
    expect(state.error).not.toMatch(/idempotencyKey|redialOf|Internal schema/);
  });

  it("keeps distinct messages for a field and deduplicates repeated issues", () => {
    const state = portalCallError(
      new ZodError([
        issue(["task", "handoffSeconds"]),
        issue(["task", "handoffSeconds"]),
        issue(["task"], "Handoff must cover callback ringing and acceptance"),
        issue(["task", "callingWindow", "weekdays", 0]),
        issue(["task", "callingWindow", "weekdays", 1]),
      ]),
    );
    expect(state.fieldErrors.handoffSeconds).toContain(
      "between 20 and 120 seconds",
    );
    expect(state.fieldErrors.handoffSeconds).toContain(
      "callback ringing plus press-1 acceptance",
    );
    expect(state.error.match(/between 20 and 120 seconds/g)).toHaveLength(1);
    expect(
      state.error.match(/Select at least one permitted weekday/g),
    ).toHaveLength(1);
  });

  it("uses a generic summary for unknown issues without losing known field errors", () => {
    const state = portalCallError(
      new ZodError([
        issue(["task", "secretInternalField"], "private implementation detail"),
        issue([], "raw root failure"),
        issue(["__proto__"]),
        issue(["constructor"]),
        issue(["task"], "unknown task refinement"),
        issue(["task", "purpose"]),
      ]),
    );
    expect(Object.keys(state.fieldErrors)).toEqual(["purpose"]);
    expect(state.error).toContain(state.fieldErrors.purpose);
    expect(state.error).toContain(
      "Could not validate the call. Review the form and try again.",
    );
    expect(state.error).not.toMatch(
      /private|secretInternalField|raw root|unknown task|__proto__|constructor/,
    );
  });

  it("returns a useful generic summary even for an empty issue list", () => {
    expect(portalCallError(new ZodError([]))).toEqual({
      error: "Could not validate the call. Review the form and try again.",
      fieldErrors: {},
    });
  });
});

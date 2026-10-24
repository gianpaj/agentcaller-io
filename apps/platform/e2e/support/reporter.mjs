/** Selected mocked journeys must execute; a skipped scenario is not acceptance. */
export default class RequireExecutedScenarios {
  #suite;

  onBegin(_config, suite) {
    this.#suite = suite;
  }

  async onEnd(result) {
    const skipped = (this.#suite?.allTests() ?? []).filter(
      (scenario) =>
        scenario.expectedStatus === "skipped" ||
        scenario.results.some((attempt) => attempt.status === "skipped"),
    ).length;
    if (!skipped) return;
    console.error(
      "Mocked Stripe E2E rejected " + skipped + " skipped scenario(s)",
    );
    if (result.status === "passed") return { status: "failed" };
  }
}

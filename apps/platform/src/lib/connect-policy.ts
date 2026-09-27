import { legLimit, type ConnectMeTask } from "@agentcaller/contracts";
export type Rate = {
  connectionFeeMicros: number;
  startedMinuteFeeMicros: number;
};
export function quotedCost(rate: Rate, seconds: number) {
  return (
    rate.connectionFeeMicros +
    Math.max(1, Math.ceil(seconds / 60)) * rate.startedMinuteFeeMicros
  );
}
export function attemptReserve(
  task: ConnectMeTask,
  business: Rate,
  callback: Rate,
) {
  return (
    quotedCost(business, legLimit(task, "business")) +
    quotedCost(callback, legLimit(task, "callback"))
  );
}
// Paid connect jobs require a supported scheme. Operator-funded jobs use separate durable authorization.
export const CONNECT_PAYMENT_BLOCKER =
  "connect_me is disabled: implement and verify expiry-aware x402 variable capture before accepting paid jobs";

export function connectPaymentBlocker(taskType: string): string | null {
  return taskType === "connect_me" ? CONNECT_PAYMENT_BLOCKER : null;
}

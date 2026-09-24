import Link from "next/link";
import { ResetRequestForm } from "./reset-request-form";

export default function ForgotPasswordPage() {
  return (
    <main className="phone-app phone-login">
      <section className="phone-panel">
        <p className="phone-eyebrow">AgentCaller</p>
        <h1>Reset your password</h1>
        <p className="phone-muted">
          Enter your operator email and we’ll send a one-time reset link.
        </p>
        <ResetRequestForm />
        <p className="phone-muted">
          <Link href="/login">Return to sign in</Link>
        </p>
      </section>
    </main>
  );
}

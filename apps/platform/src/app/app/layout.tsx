import Link from "next/link";
import { redirect } from "next/navigation";
import { Phone, History, Settings, LogOut } from "lucide-react";
import { loadClientProfile } from "@/lib/portal";
import { signOut } from "../login/actions";
export default async function CallLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await loadClientProfile();
  if (!user) redirect("/login");
  if (!profile)
    return (
      <main className="phone-login">
        <section className="phone-panel">
          <h1>Access pending</h1>
          <p>
            An enabled client profile must be linked to your account before you
            can use AgentCaller.
          </p>
          <form action={signOut}>
            <button className="phone-secondary">Sign out</button>
          </form>
        </section>
      </main>
    );
  return (
    <div className="phone-app">
      <header className="phone-header">
        <Link href="/app">
          <Phone size={22} /> AgentCaller
        </Link>
        <form action={signOut}>
          <button className="phone-icon" aria-label="Sign out">
            <LogOut size={20} />
          </button>
        </form>
      </header>
      <main className="phone-main">{children}</main>
      <nav className="phone-nav" aria-label="Call navigation">
        <Link href="/app">
          <History size={22} />
          Recents
        </Link>
        <Link href="/app/calls/new">
          <Phone size={22} />
          New call
        </Link>
        <Link href="/app/settings">
          <Settings size={22} />
          Settings
        </Link>
      </nav>
    </div>
  );
}

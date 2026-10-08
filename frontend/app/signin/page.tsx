"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Logo } from "@/components/Logo";
import { USERS } from "@/lib/user";

export default function SignIn() {
  const router = useRouter();

  const choose = (id: string) => {
    localStorage.setItem("leakledger-user", id);
    router.push("/overview");
  };

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div
        style={{
          maxWidth: 1040,
          margin: "0 auto",
          padding: "20px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Link href="/" aria-label="LeakLedger home">
          <Logo />
        </Link>
        <Link href="/" className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} /> Back to site
        </Link>
      </div>

      <div style={{ maxWidth: 520, margin: "0 auto", padding: "48px 24px 64px" }}>
        <div className="landing-kicker">Demo identity selector</div>
        <h1 style={{ fontSize: 27, fontWeight: 650, letterSpacing: "-0.025em", margin: "12px 0 10px" }}>
          Choose a demo workspace identity
        </h1>
        <p className="muted" style={{ lineHeight: 1.6, margin: 0 }}>
          Demo environment — identities are simulated and no authentication is performed. The selected persona is
          recorded as the actor on operational actions.
        </p>

        <div className="mt-24">
          {USERS.map((u) => (
            <button key={u.id} className="persona-row" onClick={() => choose(u.id)}>
              <span className="persona-avatar" aria-hidden="true">{u.initials}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="flex-between" style={{ gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>{u.name}</strong>
                  <span className="muted tiny">{u.role}</span>
                </span>
                <span className="muted small" style={{ display: "block", marginTop: 2 }}>{u.description}</span>
              </span>
              <ArrowRight size={15} className="muted-2" aria-hidden="true" />
            </button>
          ))}
        </div>

        <div className="banner banner-info mt-24" style={{ marginBottom: 0 }}>
          <span className="small">
            One click enters the application. No password, token or Cognito flow is involved.
          </span>
        </div>
      </div>
    </main>
  );
}

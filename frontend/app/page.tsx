import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Logo } from "@/components/Logo";

const STEPS = [
  {
    title: "Reconcile",
    desc: "Inflow minus measured downstream use, known unmetered use and storage change.",
  },
  {
    title: "Validate",
    desc: "Coverage, completeness, freshness, alignment and counter continuity are checked first.",
  },
  {
    title: "Localise",
    desc: "Descend only through branches where the evidence still supports a narrower claim.",
  },
  {
    title: "Repair",
    desc: "Maintenance records what was fixed; the incident moves to verification, not resolution.",
  },
  {
    title: "Verify",
    desc: "Distinct healthy intervals must complete the streak before the incident resolves.",
  },
];

const FLOW = ["API Gateway", "Lambda", "S3 Raw Archive", "EventBridge", "SQS", "Reconciliation", "DynamoDB"];

function LedgerRow({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex-between" style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
      <span className="muted small">{label}</span>
      <strong className="tabular" style={{ color: danger ? "var(--danger)" : "var(--text)" }}>{value}</strong>
    </div>
  );
}

export default function Landing() {
  return (
    <main>
      <header className="landing-header">
        <div className="landing-header-inner">
          <Link href="/" aria-label="LeakLedger home">
            <Logo />
          </Link>
          <nav className="landing-nav" aria-label="Landing navigation">
            <a href="#mechanism" className="nav-hide">Mechanism</a>
            <a href="#example" className="nav-hide">Example</a>
            <a href="#failclosed" className="nav-hide">Fail-closed</a>
            <a href="#architecture" className="nav-hide">Architecture</a>
            <Link href="/signin" className="btn btn-sm">Sign in</Link>
            <Link href="/signin" className="btn btn-primary btn-sm">Open demo</Link>
          </nav>
        </div>
      </header>

      <section className="landing-hero">
        <div>
          <div className="landing-kicker">Water reconciliation control plane</div>
          <h1 className="landing-h1">Account for every litre.</h1>
          <p className="landing-lede">
            LeakLedger reconciles existing water meters, isolates unexplained loss to the deepest trustworthy
            boundary, and refuses to close incidents until new readings prove the repair worked.
          </p>
          <div className="landing-actions">
            <Link className="btn btn-primary" href="/signin">
              Open demo <ArrowRight size={15} />
            </Link>
            <a className="btn" href="#mechanism">See how it works</a>
          </div>
          <div className="landing-proof">
            <span><Check size={13} /> No AI</span>
            <span><Check size={13} /> No cameras</span>
            <span><Check size={13} /> No special hardware for the demo</span>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 0 }}>
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Campus water ledger</h2>
              <p className="panel-sub mono">10:00–10:15 · Campus Main</p>
            </div>
            <span className="badge badge-danger"><span className="badge-dot" aria-hidden="true" />Anomalous</span>
          </div>
          <div className="panel-body">
            <LedgerRow label="Entered at Campus Main" value="20.62 m³" />
            <LedgerRow label="Accounted downstream" value="18.18 m³" />
            <LedgerRow label="Known unmetered" value="0.40 m³" />
            <LedgerRow label="Unexplained" value="2.04 m³" danger />
            <div
              style={{
                marginTop: 14,
                padding: "12px 14px",
                border: "1px solid var(--danger-border)",
                background: "var(--danger-bg)",
                borderRadius: 6,
              }}
            >
              <div className="metric-label">Deepest trustworthy anomaly</div>
              <div className="strong" style={{ marginTop: 3, fontSize: 15 }}>Hostel B Main</div>
              <div className="muted tiny" style={{ marginTop: 4 }}>
                Localisation stops before the common branch because part of downstream consumption is explicitly
                unmetered.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section" id="mechanism">
        <div className="landing-section-inner">
          <div className="landing-kicker">How it works</div>
          <h2 className="landing-h2">Every reading becomes evidence, not just a chart point.</h2>
          <div className="landing-steps">
            {STEPS.map((s, i) => (
              <div className="landing-step" key={s.title}>
                <span className="landing-step-num">0{i + 1}</span>
                <span className="landing-step-title">{s.title}</span>
                <p className="landing-step-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section" id="example">
        <div className="landing-section-inner">
          <div className="landing-kicker">Example reconciliation</div>
          <h2 className="landing-h2">Water monitoring tells you what changed. LeakLedger reconciles what cannot be explained.</h2>
          <div className="landing-two">
            <div className="landing-compare">
              <div className="landing-compare-label">Traditional monitoring</div>
              <div className="landing-compare-quote">&ldquo;Usage increased 18%.&rdquo;</div>
              <p>Useful context, but it does not prove where the missing water is or whether a repair succeeded.</p>
            </div>
            <div className="landing-compare positive">
              <div className="landing-compare-label">LeakLedger</div>
              <div className="landing-compare-quote">&ldquo;0.35 m³ remains unexplained inside Hostel B.&rdquo;</div>
              <p>The conclusion carries its own arithmetic, coverage, completeness and localisation boundary.</p>
            </div>
          </div>
          <div className="panel mt-24">
            <div className="panel-header">
              <h2 className="panel-title">Hostel B Main · interval arithmetic</h2>
              <span className="badge badge-danger"><span className="badge-dot" aria-hidden="true" />Anomalous</span>
            </div>
            <div className="panel-body">
              <div className="equation">
                <div className="equation-term">
                  <span className="equation-label">Entered</span>
                  <span className="equation-value">3.85 m³</span>
                </div>
                <div className="equation-op" aria-hidden="true">−</div>
                <div className="equation-term">
                  <span className="equation-label">Measured downstream</span>
                  <span className="equation-value">3.40 m³</span>
                </div>
                <div className="equation-op" aria-hidden="true">−</div>
                <div className="equation-term">
                  <span className="equation-label">Known unmetered</span>
                  <span className="equation-value">0.10 m³</span>
                </div>
                <div className="equation-op" aria-hidden="true">−</div>
                <div className="equation-term">
                  <span className="equation-label">Storage Δ</span>
                  <span className="equation-value">0.00 m³</span>
                </div>
                <div className="equation-op" aria-hidden="true">=</div>
                <div className="equation-term result is-anomalous">
                  <span className="equation-label">Unexplained</span>
                  <span className="equation-value">0.35 m³</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section" id="failclosed">
        <div className="landing-section-inner">
          <div className="landing-kicker">Fail closed by design</div>
          <h2 className="landing-h2">Missing evidence stops the accusation.</h2>
          <p className="landing-sub">
            If a downstream meter disappears, clock alignment fails, a counter resets, or coverage is too low,
            LeakLedger pauses leak classification instead of turning incomplete observability into a confident alert.
          </p>
          <div className="landing-two">
            <div className="landing-compare">
              <div className="landing-compare-label">Evidence required</div>
              <div className="kv mt-12">
                <div className="kv-row"><span className="kv-key">Downstream coverage</span><span className="kv-value">94%</span></div>
                <div className="kv-row"><span className="kv-key">Reading completeness</span><span className="kv-value">100%</span></div>
                <div className="kv-row"><span className="kv-key">Clock alignment</span><span className="kv-value">Valid</span></div>
              </div>
            </div>
            <div className="landing-compare">
              <div className="landing-compare-label">Evidence lost</div>
              <div className="kv mt-12">
                <div className="kv-row"><span className="kv-key">Hostel B Floor 2</span><span className="kv-value text-warning">No reading · 37 min</span></div>
                <div className="kv-row"><span className="kv-key">Downstream completeness</span><span className="kv-value text-warning">67%</span></div>
                <div className="kv-row"><span className="kv-key">Evidence</span><span className="kv-value text-warning">Insufficient</span></div>
              </div>
              <p className="mt-12">Leak classification is suspended until trustworthy evidence returns.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-inner">
          <div className="landing-kicker">Repair verification</div>
          <h2 className="landing-h2">A repair report never closes an incident by itself.</h2>
          <div className="landing-two">
            <div className="landing-compare">
              <div className="landing-compare-label">Before repair</div>
              <div className="landing-compare-quote tabular">0.36 m³ unexplained</div>
              <p>Persistent anomalous intervals keep the incident open.</p>
            </div>
            <div className="landing-compare positive">
              <div className="landing-compare-label">Verification in progress</div>
              <div className="landing-compare-quote tabular">Healthy intervals 2 / 3</div>
              <div className="progress-segments mt-12" aria-hidden="true">
                <span className="progress-segment done" />
                <span className="progress-segment done" />
                <span className="progress-segment active" />
              </div>
              <p className="mt-12">Resolution requires distinct valid intervals, not a status change.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section" id="architecture">
        <div className="landing-section-inner">
          <div className="landing-kicker">AWS-native event flow</div>
          <h2 className="landing-h2">Readings flow through real infrastructure.</h2>
          <div className="landing-flow">
            {FLOW.map((node, i) => (
              <span key={node} style={{ display: "contents" }}>
                <span className="landing-flow-node">{node}</span>
                {i < FLOW.length - 1 && <span className="landing-flow-arrow" aria-hidden="true"><ArrowRight size={13} /></span>}
              </span>
            ))}
          </div>
          <p className="landing-sub mt-24">
            Structured CloudWatch logs and metrics make duplicates, reconciliation decisions, incidents and repair
            verification inspectable end to end. X-Ray traces follow each ingestion path.
          </p>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-cta">
          <div>
            <h2 className="landing-h2" style={{ marginTop: 0 }}>Run the deterministic demo.</h2>
            <p className="landing-sub">
              Hidden loss, missing meter, counter reset, successful repair and failed repair scenarios are included.
            </p>
          </div>
          <Link className="btn btn-primary" href="/signin">
            Open demo <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <Logo />
          <span>Deterministic demo · fictional campus data · no AI</span>
        </div>
      </footer>
    </main>
  );
}

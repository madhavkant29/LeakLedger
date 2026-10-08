"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import Link from "next/link";
import { Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Status } from "@/components/Status";
import { Banner, EmptyState, Panel, Tabs } from "@/components/ui";
import { api, fmt, fmtInterval, fmtPct, fmtTime } from "@/lib/api";
import type { AuditEvent, DemoState } from "@/lib/types";

const SCENARIOS = [
  ["normal", "Normal — balanced campus"],
  ["hidden-leak", "Hidden Hostel B loss"],
  ["missing-reading", "Missing meter — fail closed"],
  ["counter-reset", "Counter reset"],
  ["repair", "Successful repair verification"],
  ["failed-repair", "Failed repair verification"],
] as const;

const LIFECYCLE_EVENTS = new Set([
  "IncidentOpened",
  "IncidentStateChanged",
  "EvidenceInsufficient",
  "EvidenceRestored",
  "RepairReported",
  "VerificationInterval",
  "VerificationFailedInterval",
  "RepairVerified",
  "RepairFailed",
]);

type Speed = "1" | "5" | "20" | "100";

export default function Replay() {
  const [scenario, setScenario] = useState("hidden-leak");
  const [state, setState] = useState<DemoState | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<Speed>("5");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<DemoState | null>(null);
  const autoBusy = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refresh = useCallback(async () => {
    try {
      const [demoState, auditRows] = await Promise.all([
        api<DemoState>("/demo/state"),
        api<AuditEvent[]>("/sites/northbridge/audit?limit=60"),
      ]);
      setState(demoState);
      setAudit(auditRows);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const reset = async () => {
    setRunning(false);
    setBusy(true);
    try {
      await api("/demo/reset", { method: "POST", body: JSON.stringify({ scenario }) });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const step = useCallback(async () => {
    try {
      await api("/demo/step", { method: "POST" });
      await refresh();
    } catch (e) {
      setRunning(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [refresh]);

  // Auto-run publishes one interval at a time and waits for the pipeline to
  // reconcile it, so playback speed is limited by real processing, not by
  // how fast the browser can queue work.
  const autoStep = useCallback(async () => {
    if (autoBusy.current) return;
    autoBusy.current = true;
    try {
      const before = stateRef.current?.root_balance?.interval_end ?? null;
      await api("/demo/step", { method: "POST" });
      await refresh();
      const deadline = Date.now() + 9000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        const next = await api<DemoState>("/demo/state").catch(() => null);
        if (!next) continue;
        const after = next.root_balance?.interval_end ?? null;
        if (after && after !== before) {
          setState(next);
          break;
        }
      }
    } catch (e) {
      setRunning(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      autoBusy.current = false;
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 2200);
    return () => {
      clearInterval(poll);
      if (timer.current) clearInterval(timer.current);
    };
  }, [refresh]);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (running) {
      timer.current = setInterval(autoStep, Math.max(200, 1200 / Number(speed)));
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [running, speed, autoStep]);

  const b = state?.latest_balance ?? null;
  const root = state?.root_balance ?? null;
  const incident = state?.incidents?.[0] ?? null;
  const lifecycle = audit.filter((a) => LIFECYCLE_EVENTS.has(a.event_type)).slice(0, 14);
  const readingsIngested = audit.filter((a) => a.event_type === "MeterReadingReceived").length;

  return (
    <AppShell>
      <PageHeader
        title="Replay Lab"
        description="Deterministic scenarios feed cumulative meter readings through the same ingestion and reconciliation path used by manual or CSV data."
        meta={
          state ? (
            <>
              <span>Scenario <strong className="mono">{state.scenario}</strong></span>
              <span>Step <strong className="mono">{state.step}</strong></span>
              <span>Status <strong>{running ? "Running" : "Paused"}</strong></span>
            </>
          ) : undefined
        }
      />

      {error && <Banner tone="error">{error}</Banner>}

      <div className="split-main">
        <div>
          <Panel title="Playback" subtitle="Controls apply to the deterministic simulator">
            <div className="field-grid">
              <label className="field">
                <span className="field-label">Scenario</span>
                <select
                  className="select"
                  value={scenario}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setScenario(e.target.value)}
                >
                  {SCENARIOS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span className="field-label">Speed</span>
                <Tabs<Speed>
                  ariaLabel="Playback speed"
                  value={speed}
                  onChange={setSpeed}
                  items={[
                    { key: "1", label: "1×" },
                    { key: "5", label: "5×" },
                    { key: "20", label: "20×" },
                    { key: "100", label: "100×" },
                  ]}
                />
              </div>
            </div>

            <div className="flex flex-wrap mt-16" style={{ gap: 8 }}>
              <button className="btn" disabled={busy} onClick={reset}>
                <RotateCcw size={14} /> Reset scenario
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => setRunning((v) => !v)}>
                {running ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Run</>}
              </button>
              <button className="btn" disabled={busy} onClick={step}>
                <StepForward size={14} /> Step
              </button>
            </div>

            <hr className="divider" />

            <div className="expand-grid">
              <div>
                <div className="metric-label">Simulated time</div>
                <div className="strong mono" style={{ marginTop: 3 }}>
                  {b ? fmtInterval(b.interval_start, b.interval_end) : "—"}
                </div>
              </div>
              <div>
                <div className="metric-label">Readings in window</div>
                <div className="strong tabular" style={{ marginTop: 3 }}>{readingsIngested}</div>
              </div>
              <div>
                <div className="metric-label">Replay step</div>
                <div className="strong tabular" style={{ marginTop: 3 }}>{state?.step ?? 0}</div>
              </div>
            </div>
          </Panel>

          <Panel
            title="Live reconciliation"
            subtitle="Root interval across the site"
            actions={root && <Status value={root.state} />}
          >
            {b ? (
              <>
                <div className="equation">
                  <div className="equation-term">
                    <span className="equation-label">Entered</span>
                    <span className="equation-value">{fmt(b.inflow_m3)} m³</span>
                  </div>
                  <div className="equation-op" aria-hidden="true">−</div>
                  <div className="equation-term">
                    <span className="equation-label">Downstream</span>
                    <span className="equation-value">{fmt(b.measured_children_m3)} m³</span>
                  </div>
                  <div className="equation-op" aria-hidden="true">−</div>
                  <div className="equation-term">
                    <span className="equation-label">Known unmetered</span>
                    <span className="equation-value">{fmt(b.known_unmetered_m3)} m³</span>
                  </div>
                  <div className="equation-op" aria-hidden="true">=</div>
                  <div className={`equation-term result ${b.residual_m3 > 0.05 ? "is-anomalous" : "is-clear"}`}>
                    <span className="equation-label">Unexplained</span>
                    <span className="equation-value">{fmt(b.residual_m3)} m³</span>
                  </div>
                </div>
                <div className="expand-grid mt-16">
                  <div>
                    <div className="metric-label">Evidence</div>
                    <div className="strong" style={{ marginTop: 3 }}>{b.evidence_quality}</div>
                  </div>
                  <div>
                    <div className="metric-label">Coverage</div>
                    <div className="strong tabular" style={{ marginTop: 3 }}>{fmtPct(b.coverage)}</div>
                  </div>
                  <div>
                    <div className="metric-label">Completeness</div>
                    <div className="strong tabular" style={{ marginTop: 3 }}>{fmtPct(b.completeness)}</div>
                  </div>
                </div>
                <p className="muted small mt-12 mb-0">{b.explanation}</p>
              </>
            ) : (
              <EmptyState
                title="No reconciled interval yet"
                description="Reset a scenario, then run or step the replay to produce readings and balances."
              />
            )}
          </Panel>

          <Panel title="Operating note">
            <p className="muted small mb-0" style={{ lineHeight: 1.65 }}>
              For the repair scenarios: run until an incident opens, record the repair from the Incidents page
              (optionally as Neha Sharma), then continue the replay. The simulator only stops the hidden loss after
              the repair action exists, so verification stays causal rather than time-scripted.
            </p>
          </Panel>
        </div>

        <div>
          <Panel
            title="Scenario state"
            actions={incident ? <Status value={incident.status} /> : undefined}
          >
            <div className="kv">
              <div className="kv-row">
                <span className="kv-key">Scenario</span>
                <span className="kv-value mono">{state?.scenario ?? scenario}</span>
              </div>
              <div className="kv-row">
                <span className="kv-key">Step</span>
                <span className="kv-value tabular">{state?.step ?? 0}</span>
              </div>
              <div className="kv-row">
                <span className="kv-key">Running</span>
                <span className="kv-value">{state?.running ? "Yes" : "No"}</span>
              </div>
              <div className="kv-row">
                <span className="kv-key">Open incidents</span>
                <span className="kv-value tabular">{state?.incidents?.length ?? 0}</span>
              </div>
            </div>

            {incident ? (
              <>
                <hr className="divider" />
                <div className="mono small muted">{incident.id}</div>
                <div className="strong" style={{ marginTop: 2 }}>{incident.deepest_trustworthy_node_id}</div>
                <p className="muted small mt-8 mb-0">{incident.boundary_explanation}</p>
                {incident.status === "VERIFYING" && (
                  <p className="small mt-12 mb-0" style={{ color: "var(--warning)" }}>
                    Verification {incident.verification_valid_intervals}/{incident.verification_required_intervals}
                  </p>
                )}
                <Link href="/incidents" className="btn btn-sm mt-12">Open incident</Link>
              </>
            ) : (
              <p className="muted small mt-16 mb-0">
                No active incident. A loss must pass the evidence gates and persist across the configured number of
                intervals before an incident opens.
              </p>
            )}
          </Panel>

          <Panel title="Lifecycle events" subtitle="Incidents, evidence and repair verification">
            {lifecycle.length === 0 ? (
              <EmptyState title="No lifecycle events yet" description="Run a scenario that produces an incident to populate this stream." />
            ) : (
              <div className="activity">
                {lifecycle.map((e, i) => (
                  <div className="activity-row" key={`${e.timestamp}-${i}`}>
                    <span className="activity-time">{fmtTime(e.timestamp)}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="activity-event">{e.event_type}</div>
                      <div className="activity-detail" title={e.detail}>{e.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}

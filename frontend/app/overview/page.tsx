"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Status } from "@/components/Status";
import { EmptyState, ErrorState, Panel, SkeletonRows } from "@/components/ui";
import { api, fmt, fmtInterval, fmtPct, fmtTime, timeAgo } from "@/lib/api";
import type { AuditEvent, Balance, Incident, TopologyResponse, TopoTreeNode } from "@/lib/types";

type OverviewData = {
  site: string;
  scenario: string;
  step: number;
  current_balance: Balance | null;
  active_incident: Incident | null;
  meter_coverage: number | null;
  data_completeness: number | null;
  recent_audit: AuditEvent[];
};

function Inline({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="metric-label">{label}</div>
      <div className="strong tabular" style={{ marginTop: 3 }}>{value}</div>
    </div>
  );
}

function flatten(tree: TopoTreeNode[], depth = 0, out: { id: string; label: string; depth: number }[] = []) {
  for (const node of tree) {
    out.push({ id: node.id, label: node.label, depth });
    if (node.children?.length) flatten(node.children, depth + 1, out);
  }
  return out;
}

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [topo, setTopo] = useState<TopologyResponse | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [overview, topology] = await Promise.all([
        api<OverviewData>("/sites/northbridge/overview"),
        api<TopologyResponse>("/sites/northbridge/topology"),
      ]);
      setData(overview);
      setTopo(topology);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [load]);

  const b = data?.current_balance ?? null;
  const incident = data?.active_incident ?? null;
  const nodeById = new Map((topo?.nodes ?? []).map((n) => [n.id, n]));
  const rows = topo ? flatten(topo.tree) : [];
  const anomalous = (b?.residual_m3 ?? 0) > 0.05;

  return (
    <AppShell>
      <PageHeader
        title="Overview"
        description="Live water accountability for Northbridge University Campus: what entered, what is accounted for downstream, and what remains unexplained."
        actions={
          <>
            <Link className="btn" href="/incidents">Incidents</Link>
            <Link className="btn btn-primary" href="/replay">Open Replay Lab</Link>
          </>
        }
        meta={
          data ? (
            <>
              <span>Scenario <strong className="mono">{data.scenario}</strong></span>
              <span>Step <strong className="mono">{data.step}</strong></span>
              <span>Site <strong>{data.site}</strong></span>
            </>
          ) : undefined
        }
      />

      {err && !data && <ErrorState title="Unable to load site overview" message={err} onRetry={load} />}

      {loading && !data && (
        <Panel title="Water balance">
          <SkeletonRows rows={4} cols={4} />
        </Panel>
      )}

      {data && (
        <>
          <Panel
            title="Water balance"
            subtitle={
              b
                ? `Latest interval ${fmtInterval(b.interval_start, b.interval_end)} · ${nodeById.get(b.node_id)?.label ?? b.node_id}`
                : "No reconciled interval yet"
            }
            actions={
              <>
                {b && <Status value={b.state} />}
                {b && <Status value={b.evidence_quality} />}
              </>
            }
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
                    <span className="equation-label">Measured downstream</span>
                    <span className="equation-value">{fmt(b.measured_children_m3)} m³</span>
                  </div>
                  <div className="equation-op" aria-hidden="true">−</div>
                  <div className="equation-term">
                    <span className="equation-label">Known unmetered</span>
                    <span className="equation-value">{fmt(b.known_unmetered_m3)} m³</span>
                  </div>
                  <div className="equation-op" aria-hidden="true">−</div>
                  <div className="equation-term">
                    <span className="equation-label">Storage Δ</span>
                    <span className="equation-value">{fmt(b.storage_change_m3)} m³</span>
                  </div>
                  <div className="equation-op" aria-hidden="true">=</div>
                  <div className={`equation-term result ${anomalous ? "is-anomalous" : "is-clear"}`}>
                    <span className="equation-label">Unexplained</span>
                    <span className="equation-value" style={{ color: anomalous ? "var(--danger)" : "var(--text)" }}>
                      {fmt(b.residual_m3)} m³
                    </span>
                  </div>
                </div>
                <hr className="divider" />
                <div className="expand-grid">
                  <Inline label="Residual ratio" value={fmtPct(b.residual_ratio, 1)} />
                  <Inline label="Coverage" value={fmtPct(b.coverage)} />
                  <Inline label="Completeness" value={fmtPct(b.completeness)} />
                  <Inline label="Clock alignment" value={b.alignment_valid ? "Valid" : "Invalid"} />
                  <Inline label="Reading freshness" value={`${Math.round(b.freshness_seconds)} s`} />
                </div>
                <p className="muted small mt-16 mb-0">{b.explanation}</p>
              </>
            ) : (
              <EmptyState
                title="No reconciled interval yet"
                description="Reset a replay scenario and advance at least one interval to produce the first ledger entry."
                action={<Link className="btn btn-sm" href="/replay">Open Replay Lab</Link>}
              />
            )}
          </Panel>

          <div className="section-header">
            <div>
              <h2 className="section-title">Active incident</h2>
              <p className="section-sub">Highest-priority unresolved case on this site</p>
            </div>
          </div>
          <Panel>
            {incident ? (
              <>
                <div className="flex-between">
                  <div style={{ minWidth: 0 }}>
                    <div className="mono small muted">{incident.id}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
                      {nodeById.get(incident.node_id)?.label ?? incident.node_id}
                    </div>
                  </div>
                  <div className="flex-center">
                    <Status value={incident.status} />
                    <Link href="/incidents" className="btn btn-sm">View incident</Link>
                  </div>
                </div>
                <div className="expand-grid mt-16">
                  <Inline label="Unexplained" value={`${fmt(incident.residual_m3)} m³`} />
                  <Inline label="Residual ratio" value={fmtPct(incident.residual_ratio, 1)} />
                  <Inline label="Persistence" value={`${incident.persistence_count} intervals`} />
                  <Inline label="Evidence" value={incident.evidence_quality} />
                  <Inline label="Opened" value={timeAgo(incident.opened_at)} />
                </div>
                <p className="muted small mt-12 mb-0">{incident.boundary_explanation}</p>
              </>
            ) : (
              <EmptyState
                title="No active incidents"
                description="All reconciled intervals currently fall within the configured thresholds. Evidence gates are satisfied."
              />
            )}
          </Panel>

          <div className="split-main mt-16">
            <Panel
              title="Current topology state"
              subtitle="Latest balance per metering point"
              actions={<Link className="btn btn-sm" href="/topology">Open topology</Link>}
              flush
            >
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Node</th>
                      <th>State</th>
                      <th className="num">Inflow</th>
                      <th className="num">Unexplained</th>
                      <th className="num">Coverage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ id, label, depth }) => {
                      const node = nodeById.get(id);
                      const balance = node?.balance ?? null;
                      return (
                        <tr key={id}>
                          <td>
                            <span style={{ paddingLeft: depth * 16, display: "inline-block" }}>
                              <span className="strong">{label}</span>
                              <div className="cell-sub mono">{id}</div>
                            </span>
                          </td>
                          <td><Status value={node?.state ?? node?.kind} /></td>
                          <td className="num">{balance ? fmt(balance.inflow_m3) : "—"}</td>
                          <td className={`num ${balance && balance.residual_m3 > 0.05 ? "danger" : ""}`}>
                            {balance ? fmt(balance.residual_m3) : "—"}
                          </td>
                          <td className="num">{balance ? fmtPct(balance.coverage) : "—"}</td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={5}>
                          <EmptyState title="No topology configured" />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel
              title="Recent reconciliation activity"
              subtitle="Latest domain events"
              actions={<Link className="btn btn-sm" href="/audit">Full audit trail</Link>}
            >
              <div className="activity">
                {(data.recent_audit ?? []).slice(0, 9).map((a, i) => (
                  <div className="activity-row" key={`${a.timestamp}-${i}`}>
                    <span className="activity-time">{fmtTime(a.timestamp)}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="activity-event">{a.event_type}</div>
                      <div className="activity-detail" title={a.detail}>{a.detail}</div>
                    </div>
                  </div>
                ))}
                {(data.recent_audit ?? []).length === 0 && (
                  <EmptyState title="No reconciliation activity yet" description="Run the replay to generate ledger entries and events." />
                )}
              </div>
            </Panel>
          </div>
        </>
      )}
    </AppShell>
  );
}

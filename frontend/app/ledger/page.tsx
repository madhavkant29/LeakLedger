"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Status } from "@/components/Status";
import { EmptyState, ErrorState, Panel, SkeletonRows, StatCell, StatStrip, Tabs } from "@/components/ui";
import { api, fmt, fmtInterval, fmtPct } from "@/lib/api";
import type { Balance } from "@/lib/types";

type Filter = "ALL" | "BALANCED" | "ANOMALOUS" | "EVIDENCE";

const EVIDENCE_STATES = ["INSUFFICIENT_DATA", "DATA_QUALITY_FAILURE", "STALE"];

export default function Ledger() {
  const [rows, setRows] = useState<Balance[]>([]);
  const [node, setNode] = useState("ALL");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api<Balance[]>("/sites/northbridge/ledger?limit=120");
      setRows(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [load]);

  const nodeOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.node_id))).sort(),
    [rows]
  );

  const byNode = useMemo(
    () => (node === "ALL" ? rows : rows.filter((r) => r.node_id === node)),
    [rows, node]
  );

  const filtered = useMemo(() => {
    if (filter === "BALANCED") return byNode.filter((r) => r.state === "BALANCED");
    if (filter === "ANOMALOUS") return byNode.filter((r) => r.state === "ANOMALOUS");
    if (filter === "EVIDENCE") return byNode.filter((r) => EVIDENCE_STATES.includes(r.state));
    return byNode;
  }, [byNode, filter]);

  const anomalousCount = byNode.filter((r) => r.state === "ANOMALOUS").length;
  const evidenceCount = byNode.filter((r) => EVIDENCE_STATES.includes(r.state)).length;
  const latest = filtered[0];

  return (
    <AppShell>
      <PageHeader
        title="Water Ledger"
        description="Every interval is reconciled like an accounting entry: measured inflow minus measured downstream use, known unmetered use and storage change equals the unexplained residual."
        actions={<Link className="btn" href="/topology">View topology</Link>}
      />

      {error && <ErrorState title="Unable to load the water ledger" message={error} onRetry={load} />}

      {!error && (
        <>
          <StatStrip>
            <StatCell label="Intervals shown" value={filtered.length} />
            <StatCell label="Anomalous" value={anomalousCount} sub={anomalousCount > 0 ? "Above configured threshold" : "None in current view"} />
            <StatCell label="Evidence issues" value={evidenceCount} sub="Classification suspended" />
            <StatCell
              label="Latest interval"
              value={latest ? fmtInterval(latest.interval_start, latest.interval_end) : "—"}
              sub={latest ? latest.node_id : undefined}
            />
          </StatStrip>

          <div className="flex-between mt-16 mb-16 flex-wrap">
            <Tabs<Filter>
              ariaLabel="Filter ledger rows"
              value={filter}
              onChange={setFilter}
              items={[
                { key: "ALL", label: "All", count: byNode.length },
                { key: "BALANCED", label: "Balanced", count: byNode.filter((r) => r.state === "BALANCED").length },
                { key: "ANOMALOUS", label: "Anomalous", count: anomalousCount },
                { key: "EVIDENCE", label: "Evidence issues", count: evidenceCount },
              ]}
            />
            <label className="flex-center small">
              <span className="muted nowrap">Node</span>
              <select className="select" value={node} onChange={(e) => setNode(e.target.value)} style={{ width: 210 }}>
                <option value="ALL">All nodes</option>
                {nodeOptions.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </label>
          </div>

          <Panel flush>
            {loading && rows.length === 0 ? (
              <SkeletonRows rows={10} cols={7} />
            ) : filtered.length === 0 ? (
              <EmptyState
                title="No ledger entries in this view"
                description="Run a replay scenario or import readings to generate reconciled intervals."
                action={<Link className="btn btn-sm" href="/replay">Open Replay Lab</Link>}
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }} aria-label="Expand" />
                      <th>Interval</th>
                      <th>Node</th>
                      <th className="num">Inflow</th>
                      <th className="num">Downstream</th>
                      <th className="num">Known unmetered</th>
                      <th className="num">Storage Δ</th>
                      <th className="num">Unexplained</th>
                      <th className="num">Coverage</th>
                      <th>Evidence</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const key = `${r.node_id}-${r.interval_end}`;
                      const isOpen = expanded === key;
                      const anomalous = r.residual_m3 > 0.05;
                      return (
                        <LedgerRow
                          key={key}
                          row={r}
                          open={isOpen}
                          anomalous={anomalous}
                          onToggle={() => setExpanded(isOpen ? null : key)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </AppShell>
  );
}

function LedgerRow({
  row,
  open,
  anomalous,
  onToggle,
}: {
  row: Balance;
  open: boolean;
  anomalous: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="clickable"
        onClick={onToggle}
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <td aria-hidden="true" style={{ color: "var(--muted-2)" }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td className="mono nowrap">{fmtInterval(row.interval_start, row.interval_end)}</td>
        <td>
          <span className="strong">{row.node_id}</span>
          <div className="cell-sub truncate" style={{ maxWidth: 280 }} title={row.explanation}>
            {row.explanation}
          </div>
        </td>
        <td className="num">{fmt(row.inflow_m3)}</td>
        <td className="num">{fmt(row.measured_children_m3)}</td>
        <td className="num">{fmt(row.known_unmetered_m3)}</td>
        <td className="num">{fmt(row.storage_change_m3)}</td>
        <td className={`num ${anomalous ? "danger" : "clear"}`}>{fmt(row.residual_m3)}</td>
        <td className="num">{fmtPct(row.coverage)}</td>
        <td><Status value={row.evidence_quality} /></td>
        <td><Status value={row.state} /></td>
      </tr>
      {open && (
        <tr className="row-expand">
          <td colSpan={11}>
            <div className="expand-body">
              <div className="equation" style={{ marginBottom: 14 }}>
                <div className="equation-term">
                  <span className="equation-label">Entered</span>
                  <span className="equation-value">{fmt(row.inflow_m3)} m³</span>
                </div>
                <div className="equation-op" aria-hidden="true">−</div>
                <div className="equation-term">
                  <span className="equation-label">Measured downstream</span>
                  <span className="equation-value">{fmt(row.measured_children_m3)} m³</span>
                </div>
                <div className="equation-op" aria-hidden="true">−</div>
                <div className="equation-term">
                  <span className="equation-label">Known unmetered</span>
                  <span className="equation-value">{fmt(row.known_unmetered_m3)} m³</span>
                </div>
                <div className="equation-op" aria-hidden="true">−</div>
                <div className="equation-term">
                  <span className="equation-label">Storage Δ</span>
                  <span className="equation-value">{fmt(row.storage_change_m3)} m³</span>
                </div>
                <div className="equation-op" aria-hidden="true">=</div>
                <div className={`equation-term result ${anomalous ? "is-anomalous" : "is-clear"}`}>
                  <span className="equation-label">Unexplained</span>
                  <span className="equation-value">{fmt(row.residual_m3)} m³</span>
                </div>
              </div>
              <div className="expand-grid">
                <div>
                  <div className="metric-label">Residual ratio</div>
                  <div className="strong tabular" style={{ marginTop: 3 }}>{fmtPct(row.residual_ratio, 1)}</div>
                </div>
                <div>
                  <div className="metric-label">Completeness</div>
                  <div className="strong tabular" style={{ marginTop: 3 }}>{fmtPct(row.completeness)}</div>
                </div>
                <div>
                  <div className="metric-label">Freshness</div>
                  <div className="strong tabular" style={{ marginTop: 3 }}>{Math.round(row.freshness_seconds)} s</div>
                </div>
                <div>
                  <div className="metric-label">Clock alignment</div>
                  <div className="strong" style={{ marginTop: 3 }}>{row.alignment_valid ? "Valid" : "Invalid"}</div>
                </div>
              </div>
              <p className="muted small mt-12 mb-0">{row.explanation}</p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

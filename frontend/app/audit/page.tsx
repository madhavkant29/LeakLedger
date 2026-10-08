"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState, Panel, SkeletonRows, StatCell, StatStrip } from "@/components/ui";
import { api, fmtDateTime } from "@/lib/api";
import type { AuditEvent } from "@/lib/types";

function resourceOf(row: AuditEvent): string {
  const payload = row.payload ?? {};
  const incident = payload["incident_id"];
  if (typeof incident === "string") return incident;
  const node = payload["node_id"];
  if (typeof node === "string") return node;
  const meter = payload["meter_id"];
  if (typeof meter === "string") return meter;
  if (row.correlation_id) return row.correlation_id;
  return "—";
}

export default function Audit() {
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [eventType, setEventType] = useState("ALL");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api<AuditEvent[]>("/sites/northbridge/audit?limit=250");
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

  const types = useMemo(() => Array.from(new Set(rows.map((r) => r.event_type))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (eventType !== "ALL" && r.event_type !== eventType) return false;
      if (!q) return true;
      return [r.event_type, r.actor, r.detail, r.correlation_id ?? "", resourceOf(r)]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, eventType]);

  const incidentLinked = filtered.filter((r) => resourceOf(r).startsWith("LL-")).length;
  const actors = new Set(filtered.map((r) => r.actor || "system")).size;

  return (
    <AppShell>
      <PageHeader
        title="Audit Trail"
        description="A chronological explanation of the evidence path: readings, reconciliation outcomes, incidents, repairs and verification events."
      />

      {error && <ErrorState title="Unable to load the audit trail" message={error} onRetry={load} />}

      {!error && (
        <>
          <StatStrip>
            <StatCell label="Events shown" value={filtered.length} sub={`${rows.length} loaded`} />
            <StatCell label="Incident-linked" value={incidentLinked} sub="Reference an incident ID" />
            <StatCell label="Actors" value={actors} sub="System and demo personas" />
            <StatCell label="Latest event" value={filtered[0] ? fmtDateTime(filtered[0].timestamp) : "—"} />
          </StatStrip>

          <div className="flex-between flex-wrap mt-16 mb-16" style={{ gap: 12 }}>
            <label className="field" style={{ minWidth: 280 }}>
              <input
                className="input"
                placeholder="Search events, actors, resources…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search audit events"
              />
            </label>
            <label className="flex-center small">
              <span className="muted nowrap">Event type</span>
              <select className="select" value={eventType} onChange={(e) => setEventType(e.target.value)} style={{ width: 220 }}>
                <option value="ALL">All event types</option>
                {types.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>

          <Panel flush>
            {loading && rows.length === 0 ? (
              <SkeletonRows rows={10} cols={5} />
            ) : filtered.length === 0 ? (
              <EmptyState
                title="No audit events match this view"
                description="Run a replay or ingest readings to populate the evidence trail."
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }} aria-label="Expand" />
                      <th>Timestamp</th>
                      <th>Event</th>
                      <th>Resource</th>
                      <th>Actor</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => {
                      const key = `${r.timestamp}-${r.event_type}-${i}`;
                      const open = expanded === key;
                      return (
                        <AuditRow
                          key={key}
                          row={r}
                          open={open}
                          onToggle={() => setExpanded(open ? null : key)}
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

function AuditRow({ row, open, onToggle }: { row: AuditEvent; open: boolean; onToggle: () => void }) {
  const payload = row.payload ?? {};
  const entries = Object.entries(payload);
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
        <td className="mono nowrap">{fmtDateTime(row.timestamp)}</td>
        <td><span className="strong">{row.event_type}</span></td>
        <td className="mono">{resourceOf(row)}</td>
        <td>{row.actor || "system"}</td>
        <td className="muted">
          <span className="truncate" style={{ display: "inline-block", maxWidth: 420 }} title={row.detail}>
            {row.detail}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="row-expand">
          <td colSpan={6}>
            <div className="expand-body">
              <div className="expand-grid">
                <div>
                  <div className="metric-label">Resource</div>
                  <div className="mono small" style={{ marginTop: 3 }}>{resourceOf(row)}</div>
                </div>
                <div>
                  <div className="metric-label">Correlation</div>
                  <div className="mono small" style={{ marginTop: 3 }}>{row.correlation_id || "—"}</div>
                </div>
                <div>
                  <div className="metric-label">Actor</div>
                  <div className="small" style={{ marginTop: 3 }}>{row.actor || "system"}</div>
                </div>
              </div>
              {entries.length > 0 && (
                <div className="expand-grid mt-12">
                  {entries.map(([k, v]) => (
                    <div key={k}>
                      <div className="metric-label">{k.replaceAll("_", " ")}</div>
                      <div className="small mono" style={{ marginTop: 3 }}>
                        {typeof v === "object" ? JSON.stringify(v) : String(v)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <details className="error-detail mt-12">
                <summary>Raw payload</summary>
                <pre className="payload">
                  {JSON.stringify(
                    {
                      timestamp: row.timestamp,
                      event_type: row.event_type,
                      actor: row.actor,
                      detail: row.detail,
                      correlation_id: row.correlation_id,
                      payload: row.payload ?? {},
                    },
                    null,
                    2
                  )}
                </pre>
              </details>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

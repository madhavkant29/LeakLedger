"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Status } from "@/components/Status";
import { Banner, EmptyState, ErrorState, Panel, SkeletonRows, Tabs } from "@/components/ui";
import { api, fmt, fmtDateTime, fmtInt, fmtPct, timeAgo } from "@/lib/api";
import { projectedIfSustained } from "@/lib/impact";
import { getUser } from "@/lib/user";
import type { Balance, Incident, TopologyNode, TopologyResponse } from "@/lib/types";

type Filter = "ALL" | "ACTIVE" | "INVESTIGATING" | "VERIFYING" | "RESOLVED" | "EVIDENCE";

const ACTIVE_EXCLUDED = ["RESOLVED", "REPAIR_FAILED"];
const INVESTIGATING = ["OPEN", "ACKNOWLEDGED", "INVESTIGATING"];
const VERIFYING = ["VERIFYING", "REPAIR_REPORTED"];
const RESOLVED = ["RESOLVED", "REPAIR_FAILED"];

const REPAIR_DISABLED = ["VERIFYING", "REPAIR_REPORTED", "RESOLVED", "REPAIR_FAILED"];

function Inline({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="metric-label">{label}</div>
      <div className="strong tabular" style={{ marginTop: 3 }}>{value}</div>
    </div>
  );
}

export default function Incidents() {
  const [rows, setRows] = useState<Incident[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ACTIVE");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showRepair, setShowRepair] = useState(false);
  const [repair, setRepair] = useState({
    repair_type: "Pipe / valve repair",
    location: "Hostel B common distribution",
    notes: "Repair completed and line returned to service.",
    cause: "",
    cost: "",
  });

  const load = useCallback(async () => {
    try {
      const [incidents, topology] = await Promise.all([
        api<Incident[]>("/sites/northbridge/incidents"),
        api<TopologyResponse>("/sites/northbridge/topology"),
      ]);
      setRows(incidents);
      setLabels(Object.fromEntries(topology.nodes.map((n) => [n.id, n.label])));
      setNodes(topology.nodes);
      setSelectedId((prev) => (prev && incidents.some((x) => x.id === prev) ? prev : incidents[0]?.id ?? null));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2200);
    return () => clearInterval(timer);
  }, [load]);

  const counts = useMemo(
    () => ({
      ALL: rows.length,
      ACTIVE: rows.filter((r) => !ACTIVE_EXCLUDED.includes(r.status)).length,
      INVESTIGATING: rows.filter((r) => INVESTIGATING.includes(r.status)).length,
      VERIFYING: rows.filter((r) => VERIFYING.includes(r.status)).length,
      RESOLVED: rows.filter((r) => RESOLVED.includes(r.status)).length,
      EVIDENCE: rows.filter((r) => r.status === "EVIDENCE_INSUFFICIENT").length,
    }),
    [rows]
  );

  const filtered = useMemo(() => {
    if (filter === "ACTIVE") return rows.filter((r) => !ACTIVE_EXCLUDED.includes(r.status));
    if (filter === "INVESTIGATING") return rows.filter((r) => INVESTIGATING.includes(r.status));
    if (filter === "VERIFYING") return rows.filter((r) => VERIFYING.includes(r.status));
    if (filter === "RESOLVED") return rows.filter((r) => RESOLVED.includes(r.status));
    if (filter === "EVIDENCE") return rows.filter((r) => r.status === "EVIDENCE_INSUFFICIENT");
    return rows;
  }, [rows, filter]);

  useEffect(() => {
    if (filtered.length === 0) setSelectedId(null);
    else if (!selectedId || !filtered.some((x) => x.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const selected = rows.find((x) => x.id === selectedId) ?? null;

  const act = async (action: string) => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await api(`/incidents/${selected.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ actor: getUser().name }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitRepair = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const u = getUser();
      await api(`/incidents/${selected.id}/repair`, {
        method: "POST",
        body: JSON.stringify({
          actor: u.name,
          repair_type: repair.repair_type,
          location: repair.location,
          notes: repair.notes,
          cause: repair.cause || null,
          cost: repair.cost ? Number(repair.cost) : null,
        }),
      });
      setShowRepair(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const label = (id?: string | null) => (id ? labels[id] ?? id : "—");

  return (
    <AppShell>
      <PageHeader
        title="Incidents"
        description="Evidence-backed operational cases. A repair report starts verification; it never closes the incident by itself."
      />

      {error && <Banner tone="error">{error}</Banner>}

      <div className="flex-between flex-wrap mb-16">
        <Tabs<Filter>
          ariaLabel="Filter incidents"
          value={filter}
          onChange={setFilter}
          items={[
            { key: "ALL", label: "All", count: counts.ALL },
            { key: "ACTIVE", label: "Active", count: counts.ACTIVE },
            { key: "INVESTIGATING", label: "Investigating", count: counts.INVESTIGATING },
            { key: "VERIFYING", label: "Verifying", count: counts.VERIFYING },
            { key: "RESOLVED", label: "Resolved", count: counts.RESOLVED },
            { key: "EVIDENCE", label: "Evidence issues", count: counts.EVIDENCE },
          ]}
        />
      </div>

      <div className="incident-layout">
        <Panel flush>
          {loading && rows.length === 0 ? (
            <SkeletonRows rows={5} cols={3} />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No incidents in this view"
              description="Incidents open only after unexplained loss passes the evidence gates and persists across the configured number of intervals."
            />
          ) : (
            <div className="incident-list">
              {filtered.map((r) => (
                <button
                  key={r.id}
                  className={`incident-list-item ${selected?.id === r.id ? "selected" : ""}`}
                  onClick={() => setSelectedId(r.id)}
                >
                  <span className="incident-list-top">
                    <span className="incident-list-id">{r.id}</span>
                    <Status value={r.status} />
                  </span>
                  <span className="incident-list-loc strong">{label(r.deepest_trustworthy_node_id)}</span>
                  <span className="incident-list-meta">
                    {fmt(r.residual_m3)} m³ unexplained · {r.persistence_count} intervals · opened {timeAgo(r.opened_at)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <div>
          {selected ? (
            <IncidentDetail
              incident={selected}
              label={label}
              nodes={nodes}
              busy={busy}
              showRepair={showRepair}
              repair={repair}
              setRepair={setRepair}
              setShowRepair={setShowRepair}
              act={act}
              submitRepair={submitRepair}
            />
          ) : (
            <Panel>
              <EmptyState
                title="Select an incident"
                description="Choose an incident from the list to inspect its evidence, localisation boundary and lifecycle."
              />
            </Panel>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function IncidentDetail({
  incident,
  label,
  nodes,
  busy,
  showRepair,
  repair,
  setRepair,
  setShowRepair,
  act,
  submitRepair,
}: {
  incident: Incident;
  label: (id?: string | null) => string;
  nodes: TopologyNode[];
  busy: boolean;
  showRepair: boolean;
  repair: { repair_type: string; location: string; notes: string; cause: string; cost: string };
  setRepair: (v: { repair_type: string; location: string; notes: string; cause: string; cost: string }) => void;
  setShowRepair: (v: boolean | ((prev: boolean) => boolean)) => void;
  act: (action: string) => void;
  submitRepair: () => void;
}) {
  const b: Balance | null = incident.current_balance ?? null;
  const lastEvent = incident.events[incident.events.length - 1];
  const canAcknowledge = ["OPEN", "EVIDENCE_INSUFFICIENT"].includes(incident.status);
  const canInvestigate = ["OPEN", "ACKNOWLEDGED", "EVIDENCE_INSUFFICIENT"].includes(incident.status);
  const canRepair = !REPAIR_DISABLED.includes(incident.status);
  const repairDisabledReason = canRepair ? undefined : "Available before verification starts";
  const actor = typeof window !== "undefined" ? getUser().name : "Demo user";

  const showPausePanel = incident.status === "EVIDENCE_INSUFFICIENT";
  const balanceSuspended = b
    ? ["INSUFFICIENT_DATA", "DATA_QUALITY_FAILURE", "STALE"].includes(b.state)
    : false;
  const pauseReason =
    [...incident.events].reverse().find((e) => e.event_type === "EvidenceInsufficient")?.detail ??
    b?.explanation ??
    "Required downstream meter evidence is no longer available.";
  const projection =
    b && b.state === "ANOMALOUS" ? projectedIfSustained(b.residual_m3, b.interval_start, b.interval_end) : null;

  const children = nodes.filter((n) => n.parent_id === incident.node_id);
  const unmeteredChildren = children.filter((c) => c.kind === "UNMETERED");
  const meteredChildren = children.filter((c) => c.kind === "METER");
  const operatorFocus = unmeteredChildren.length
    ? `Common distribution between ${label(incident.node_id)} and ${
        meteredChildren.map((c) => c.label).join(", ") || "its downstream branches"
      } — ${unmeteredChildren.map((c) => c.label).join(", ")} cannot be measured.`
    : `Downstream branches and common distribution below ${label(incident.node_id)}.`;

  const verifyResolved = incident.status === "RESOLVED";
  const verifyFailed = incident.status === "REPAIR_FAILED";
  const verifyHeadline = verifyResolved
    ? "Repair verified"
    : verifyFailed
      ? "Repair failed"
      : "Repair reported — verification required";
  const verifyTone = verifyResolved ? "ok" : verifyFailed ? "failed" : "warn";
  const lastPostRepair =
    incident.post_repair_residuals.length > 0
      ? incident.post_repair_residuals[incident.post_repair_residuals.length - 1]
      : null;

  const primaryAction =
    incident.status === "OPEN"
      ? "acknowledge"
      : incident.status === "ACKNOWLEDGED"
        ? "investigate"
        : canRepair
          ? "repair"
          : null;

  return (
    <>
      <Panel>
        <div className="flex-between" style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div className="mono small muted">{incident.id}</div>
            <h2 style={{ fontSize: 18, fontWeight: 650, margin: "4px 0 2px", letterSpacing: "-0.01em" }}>
              {label(incident.node_id)}
            </h2>
            <div className="small muted">
              Opened {timeAgo(incident.opened_at)}
              {lastEvent && <> · Updated {timeAgo(lastEvent.timestamp)}</>}
            </div>
          </div>
          <Status value={incident.status} />
        </div>

        <hr className="divider" />

        <div className="section-header" style={{ margin: "0 0 10px" }}>
          <h3 className="section-title">Why this incident exists</h3>
        </div>
        {showPausePanel ? (
          <div className="failclosed-panel" role="status">
            <div className="failclosed-title">
              <AlertTriangle size={15} aria-hidden="true" />
              Evidence insufficient — leak localisation paused
            </div>
            <p>
              <strong>Reason:</strong> {pauseReason}
            </p>
            <p>
              LeakLedger will not make a stronger location claim until downstream observability is restored. The
              incident stays open and the boundary below is the last trustworthy position, not a new finding.
            </p>
            <div className="expand-grid mt-16">
              <Inline label="Basis of the original claim" value={`${fmt(incident.residual_m3)} m³ unexplained`} />
              <Inline label="Persistence at opening" value={`${incident.persistence_count} intervals`} />
              <Inline label="Evidence at opening" value={incident.evidence_quality} />
            </div>
          </div>
        ) : b ? (
          <>
            <div className="equation stacked">
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
              <div className={`equation-term result ${b.residual_m3 > 0.05 ? "is-anomalous" : "is-clear"}`}>
                <span className="equation-label">Unexplained</span>
                <span className="equation-value" style={{ color: b.residual_m3 > 0.05 ? "var(--danger)" : "var(--text)" }}>
                  {fmt(b.residual_m3)} m³
                </span>
              </div>
            </div>
            <div className="expand-grid mt-16">
              <Inline label="Residual ratio" value={fmtPct(b.residual_ratio, 1)} />
              <Inline label="Persistence" value={`${incident.persistence_count} intervals`} />
              <Inline label="Evidence" value={incident.evidence_quality} />
            </div>
            {projection && (
              <div className="projected">
                <span className="metric-label">Projected if sustained</span>
                <span className="strong tabular">
                  ≈ {fmt(projection.perDay, 1)} m³/day ({fmtInt(projection.litresPerDay)} L/day)
                </span>
                <span className="muted tiny">
                  at {fmt(projection.perHour, 2)} m³/h from this interval — a projection, not a guarantee
                </span>
              </div>
            )}
            {balanceSuspended && (
              <p className="text-warning small mt-12 mb-0">
                Current interval evidence is incomplete; this arithmetic is informational only.
              </p>
            )}
          </>
        ) : (
          <p className="muted small mb-0">
            {fmt(incident.residual_m3)} m³ unexplained · {fmtPct(incident.residual_ratio, 1)} residual ratio · {incident.persistence_count} persistence intervals
          </p>
        )}

        <hr className="divider" />

        <div className="section-header" style={{ margin: "0 0 10px" }}>
          <h3 className="section-title">Evidence</h3>
        </div>
        {b ? (
          <>
            <div className="expand-grid">
              <Inline label="Coverage" value={fmtPct(b.coverage)} />
              <Inline label="Reading completeness" value={fmtPct(b.completeness)} />
              <Inline label="Time alignment" value={b.alignment_valid ? "Valid" : "Invalid"} />
              <Inline label="Storage" value={Math.abs(b.storage_change_m3) > 0 ? `${fmt(b.storage_change_m3)} m³` : "Accounted"} />
              <Inline label="Freshness" value={`${Math.round(b.freshness_seconds)} s`} />
            </div>
            {showPausePanel && (
              <p className="muted small mt-12 mb-0">
                Missing or stale readings are the reason classification is suspended for this interval.
              </p>
            )}
          </>
        ) : (
          <p className="muted small mb-0">No current valid balance is available for this incident boundary.</p>
        )}

        <hr className="divider" />

        <div className="section-header" style={{ margin: "0 0 10px" }}>
          <h3 className="section-title">Localisation</h3>
        </div>
        <div className="kv stacked">
          <div className="kv-row">
            <span className="kv-key">Deepest trustworthy boundary</span>
            <span className="kv-value">{label(incident.deepest_trustworthy_node_id)}</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">Cannot descend further because</span>
            <span className="kv-value" style={{ fontWeight: 450 }}>
              {incident.boundary_explanation}
            </span>
          </div>
          {!["RESOLVED", "REPAIR_FAILED"].includes(incident.status) && (
            <div className="kv-row">
              <span className="kv-key">Operator focus</span>
              <span className="kv-value" style={{ fontWeight: 450 }}>{operatorFocus}</span>
            </div>
          )}
        </div>

        {incident.repair && (
          <>
            <hr className="divider" />
            <div className="section-header" style={{ margin: "0 0 10px" }}>
              <h3 className="section-title">Repair verification</h3>
              <Status value={incident.status} />
            </div>
            <div className={`verify-headline ${verifyTone}`}>{verifyHeadline}</div>
            <div className="verify-steps mt-12">
              {Array.from({ length: incident.verification_required_intervals }, (_, i) => {
                const done = i < incident.verification_valid_intervals;
                return (
                  <div key={i} className={`verify-step ${done ? "done" : "pending"}`}>
                    <span className="metric-label">Valid interval {i + 1}</span>
                    <span className="strong">{done ? "confirmed" : "awaiting meter evidence"}</span>
                  </div>
                );
              })}
            </div>
            <div className="expand-grid mt-16">
              <Inline
                label="Before repair"
                value={incident.pre_repair_residual_rate !== null && incident.pre_repair_residual_rate !== undefined
                  ? `${fmt(incident.pre_repair_residual_rate)} m³/interval`
                  : "—"}
              />
              <Inline
                label="Latest interval"
                value={lastPostRepair !== null ? `${fmt(lastPostRepair)} m³` : "—"}
              />
              <Inline label="Reported by" value={incident.repair.actor} />
              <Inline label="Repair type" value={incident.repair.repair_type} />
            </div>
            <p className="verify-note">
              A repair report is not accepted as proof. LeakLedger requires{" "}
              {incident.verification_required_intervals} distinct valid intervals with complete, aligned meter
              evidence before resolving this incident — {incident.repair.location}.
            </p>
          </>
        )}

        <hr className="divider" />

        <div className="flex flex-wrap" style={{ gap: 8 }}>
          <button
            className={`btn ${primaryAction === "acknowledge" ? "btn-primary" : ""}`}
            disabled={busy || !canAcknowledge}
            title={canAcknowledge ? undefined : `Cannot acknowledge from ${incident.status}`}
            onClick={() => act("acknowledge")}
          >
            Acknowledge
          </button>
          <button
            className={`btn ${primaryAction === "investigate" ? "btn-primary" : ""}`}
            disabled={busy || !canInvestigate}
            title={canInvestigate ? undefined : `Cannot investigate from ${incident.status}`}
            onClick={() => act("investigate")}
          >
            Start investigation
          </button>
          <button
            className={`btn ${primaryAction === "repair" ? "btn-primary" : ""}`}
            disabled={busy || !canRepair}
            title={repairDisabledReason}
            onClick={() => setShowRepair((v) => !v)}
          >
            Record repair
          </button>
        </div>

        {showRepair && (
          <div className="repair-form">
            <div className="flex-between">
              <div>
                <strong style={{ fontSize: 13.5 }}>Repair report</strong>
                <div className="muted tiny mt-8" style={{ marginTop: 3 }}>
                  Submitting moves the incident to VERIFYING. It does not resolve it.
                </div>
              </div>
              <span className="small muted">Recording as {actor}</span>
            </div>
            <div className="field-grid mt-16">
              <label className="field">
                <span className="field-label">Repair type</span>
                <input className="input" value={repair.repair_type} onChange={(e: ChangeEvent<HTMLInputElement>) => setRepair({ ...repair, repair_type: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">Location</span>
                <input className="input" value={repair.location} onChange={(e: ChangeEvent<HTMLInputElement>) => setRepair({ ...repair, location: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">Physical cause (optional)</span>
                <input className="input" value={repair.cause} onChange={(e: ChangeEvent<HTMLInputElement>) => setRepair({ ...repair, cause: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">Cost (optional)</span>
                <input className="input" type="number" value={repair.cost} onChange={(e: ChangeEvent<HTMLInputElement>) => setRepair({ ...repair, cost: e.target.value })} />
              </label>
            </div>
            <label className="field mt-12">
              <span className="field-label">Notes</span>
              <textarea className="input" rows={3} value={repair.notes} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setRepair({ ...repair, notes: e.target.value })} />
            </label>
            <div className="flex" style={{ gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn" onClick={() => setShowRepair(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={busy || !repair.repair_type.trim() || !repair.location.trim() || !repair.notes.trim()}
                onClick={submitRepair}
              >
                {busy ? "Recording…" : "Submit repair"}
              </button>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Timeline" subtitle="Incident lifecycle events" flush>
        {incident.events.length === 0 ? (
          <EmptyState title="No lifecycle events recorded" />
        ) : (
          <div className="panel-body">
            <div className="timeline stacked">
              {incident.events.slice().reverse().map((e, i) => (
                <div className="timeline-row" key={`${e.timestamp}-${i}`}>
                  <span className="timeline-time">{fmtDateTime(e.timestamp)}</span>
                  <span className="timeline-type">{e.event_type}</span>
                  <span className="timeline-detail">
                    {e.detail} <span className="timeline-actor">· {e.actor}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}

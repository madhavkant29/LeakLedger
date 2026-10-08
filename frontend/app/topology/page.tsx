"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Status, toneFor } from "@/components/Status";
import { EmptyState, ErrorState, Panel, SkeletonRows, StatCell, StatStrip } from "@/components/ui";
import { api, fmt, fmtPct } from "@/lib/api";
import type { Incident, TopologyNode, TopologyResponse, TopoTreeNode } from "@/lib/types";

const EVIDENCE_STATES = ["INSUFFICIENT_DATA", "DATA_QUALITY_FAILURE", "STALE"];

export default function Topology() {
  const [data, setData] = useState<TopologyResponse | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>("MAIN-CAMPUS");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [topology, incidentRows] = await Promise.all([
        api<TopologyResponse>("/sites/northbridge/topology"),
        api<Incident[]>("/sites/northbridge/incidents"),
      ]);
      setData(topology);
      setIncidents(incidentRows);
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

  const nodeById = useMemo(
    () => new Map((data?.nodes ?? []).map((n) => [n.id, n])),
    [data]
  );

  const parentOf = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const n of data?.nodes ?? []) map[n.id] = n.parent_id;
    return map;
  }, [data]);

  const activeIncident = incidents.find((i) => !["RESOLVED", "REPAIR_FAILED"].includes(i.status)) ?? null;

  const highlight = useMemo(() => {
    const set = new Set<string>();
    const addPath = (id: string | null | undefined) => {
      let cur = id ?? null;
      let guard = 0;
      while (cur && guard < 20) {
        set.add(cur);
        cur = parentOf[cur] ?? null;
        guard += 1;
      }
    };
    if (activeIncident) addPath(activeIncident.deepest_trustworthy_node_id);
    else for (const n of data?.nodes ?? []) if (n.state === "ANOMALOUS") addPath(n.id);
    return set;
  }, [activeIncident, data, parentOf]);

  const dimOthers = highlight.size > 0;
  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;
  const nodes = data?.nodes ?? [];
  const reporting = nodes.filter((n) => n.kind === "METER" && n.balance).length;
  const meters = nodes.filter((n) => n.kind === "METER").length;
  const anomalous = nodes.filter((n) => n.state === "ANOMALOUS").length;
  const evidenceIssues = nodes.filter((n) => EVIDENCE_STATES.includes(n.state)).length;

  return (
    <AppShell>
      <PageHeader
        title="Topology"
        description="LeakLedger descends only through trustworthy anomalous branches. It stops where coverage, timing or data quality no longer supports a narrower claim."
        actions={<Link className="btn" href="/settings">Topology accounting</Link>}
      />

      {error && !data && <ErrorState title="Unable to load topology" message={error} onRetry={load} />}

      {data && (
        <>
          <StatStrip>
            <StatCell label="Metering points" value={meters} sub={`${nodes.length} nodes including unmetered branches`} />
            <StatCell label="Reporting" value={`${reporting} / ${meters}`} sub="Have a reconciled interval" />
            <StatCell label="Anomalous" value={anomalous} sub={activeIncident ? `Incident ${activeIncident.id}` : "No open incident"} />
            <StatCell label="Evidence issues" value={evidenceIssues} sub="Classification suspended" />
          </StatStrip>

          <div className="split-main mt-16">
            <Panel
              title="Directed water accounting graph"
              subtitle={activeIncident ? `Localisation path highlighted for ${activeIncident.id}` : "No active localisation"}
              flush
            >
              <div className="panel-body tight">
                <div className="topo-legend">
                  <span><i className="topo-marker success" aria-hidden="true" /> Balanced</span>
                  <span><i className="topo-marker danger" aria-hidden="true" /> Anomalous</span>
                  <span><i className="topo-marker warning" aria-hidden="true" /> Evidence issue</span>
                  <span><i className="topo-marker info" aria-hidden="true" /> Unmetered / buffered</span>
                </div>
              </div>
              <div className="panel-body" style={{ paddingTop: 0 }}>
                {loading && nodes.length === 0 ? (
                  <SkeletonRows rows={8} cols={5} />
                ) : !data.tree?.length ? (
                  <EmptyState title="No topology configured" description="Seed the site to load the Northbridge campus graph." />
                ) : (
                  <>
                    <div className="topo-head" aria-hidden="true">
                      <span />
                      <span>Node</span>
                      <span className="topo-cell topo-col-hide">Inflow</span>
                      <span className="topo-cell topo-col-hide">Unexplained</span>
                      <span className="topo-cell topo-col-hide">Coverage</span>
                      <span className="topo-cell">State</span>
                    </div>
                    <div className="topo">
                      {data.tree.map((n) => (
                        <TreeNode
                          key={n.id}
                          node={n}
                          nodeById={nodeById}
                          highlight={highlight}
                          dimOthers={dimOthers}
                          selectedId={selectedId}
                          onSelect={setSelectedId}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Panel>

            <div>
              {selected ? (
                <NodeDetail node={selected} parent={selected.parent_id ? nodeById.get(selected.parent_id) ?? null : null} children={nodes.filter((n) => n.parent_id === selected.id)} />
              ) : (
                <Panel>
                  <EmptyState title="Select a node" description="Inspect the balance, evidence and accounting configuration for a metering point." />
                </Panel>
              )}
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

function TreeNode({
  node,
  nodeById,
  highlight,
  dimOthers,
  selectedId,
  onSelect,
}: {
  node: TopoTreeNode;
  nodeById: Map<string, TopologyNode>;
  highlight: Set<string>;
  dimOthers: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const detail = nodeById.get(node.id);
  const balance = detail?.balance ?? null;
  const tone = toneFor(detail?.state ?? detail?.kind);
  const anomalous = detail?.state === "ANOMALOUS";
  const inPath = highlight.has(node.id);
  const classes = [
    "topo-node",
    selectedId === node.id ? "selected" : "",
    anomalous ? "anomalous" : "",
    dimOthers && !inPath ? "dimmed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <button className={classes} onClick={() => onSelect(node.id)} aria-current={selectedId === node.id}>
        <span className={`topo-marker ${tone}`} aria-hidden="true" />
        <span className="topo-name">
          <strong>{node.label}</strong>
          <span className="topo-id">{node.id}</span>
        </span>
        <span className="topo-cell topo-col-hide">{balance ? `${fmt(balance.inflow_m3)} m³` : "—"}</span>
        <span className={`topo-cell topo-col-hide ${balance && balance.residual_m3 > 0.05 ? "text-danger" : ""}`}>
          {balance ? `${fmt(balance.residual_m3)} m³` : "—"}
        </span>
        <span className="topo-cell topo-col-hide">{balance ? fmtPct(balance.coverage) : "—"}</span>
        <span style={{ textAlign: "right" }}><Status value={detail?.state ?? detail?.kind} /></span>
      </button>
      {node.children?.length ? (
        <div className="topo-children">
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              nodeById={nodeById}
              highlight={highlight}
              dimOthers={dimOthers}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function NodeDetail({
  node,
  parent,
  children,
}: {
  node: TopologyNode;
  parent: TopologyNode | null;
  children: TopologyNode[];
}) {
  const b = node.balance;
  return (
    <>
      <Panel
        title={node.label}
        subtitle={<span className="mono">{node.id}</span>}
        actions={<Status value={node.state} />}
      >
        <div className="kv">
          <div className="kv-row">
            <span className="kv-key">Type</span>
            <span className="kv-value">{node.kind}{node.buffered ? " · buffered" : ""}</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">Parent</span>
            <span className="kv-value">{parent ? parent.label : "—"}</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">Expected interval</span>
            <span className="kv-value">{node.expected_interval_minutes} min</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">Known unmetered</span>
            <span className="kv-value">{fmt(node.known_unmetered_m3_per_interval)} m³/interval</span>
          </div>
          <div className="kv-row">
            <span className="kv-key">Active</span>
            <span className="kv-value">{node.active ? "Yes" : "No"}</span>
          </div>
        </div>

        {b ? (
          <>
            <hr className="divider" />
            <div className="equation" style={{ gridTemplateColumns: "1fr" }}>
              <div className={`equation-term result ${b.residual_m3 > 0.05 ? "is-anomalous" : "is-clear"}`}>
                <span className="equation-label">Unexplained residual</span>
                <span className="equation-value" style={{ color: b.residual_m3 > 0.05 ? "var(--danger)" : "var(--text)" }}>
                  {fmt(b.residual_m3)} m³
                </span>
              </div>
            </div>
            <div className="expand-grid mt-16">
              <div>
                <div className="metric-label">Inflow</div>
                <div className="strong tabular" style={{ marginTop: 3 }}>{fmt(b.inflow_m3)} m³</div>
              </div>
              <div>
                <div className="metric-label">Measured children</div>
                <div className="strong tabular" style={{ marginTop: 3 }}>{fmt(b.measured_children_m3)} m³</div>
              </div>
              <div>
                <div className="metric-label">Coverage</div>
                <div className="strong tabular" style={{ marginTop: 3 }}>{fmtPct(b.coverage)}</div>
              </div>
              <div>
                <div className="metric-label">Completeness</div>
                <div className="strong tabular" style={{ marginTop: 3 }}>{fmtPct(b.completeness)}</div>
              </div>
              <div>
                <div className="metric-label">Evidence</div>
                <div className="strong" style={{ marginTop: 3 }}>{b.evidence_quality}</div>
              </div>
            </div>
            <p className="muted small mt-12 mb-0">{b.explanation}</p>
          </>
        ) : (
          <p className="muted small mt-16 mb-0">
            No reconciled balance is available for this node yet. {node.kind === "UNMETERED" ? "This branch is explicitly unmetered and is never treated as unexplained loss." : "Advance the replay to produce an interval."}
          </p>
        )}
      </Panel>

      {children.length > 0 && (
        <Panel title="Downstream nodes" subtitle={`${children.length} direct children`}>
          <div className="kv">
            {children.map((c) => (
              <div className="kv-row" key={c.id}>
                <span className="kv-key">{c.label}</span>
                <span className="kv-value">
                  <Status value={c.state} />
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

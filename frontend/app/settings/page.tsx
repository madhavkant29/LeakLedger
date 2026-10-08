"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Banner, ErrorState, Panel, SkeletonRows } from "@/components/ui";
import { api } from "@/lib/api";
import type { SiteSettings, TopologyResponse, TopologyNode } from "@/lib/types";

export default function SettingsPage() {
  const [form, setForm] = useState<SiteSettings | null>(null);
  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [settings, topology] = await Promise.all([
        api<SiteSettings>("/sites/northbridge/settings"),
        api<TopologyResponse>("/sites/northbridge/topology"),
      ]);
      setForm(settings);
      setNodes(topology.nodes);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = (key: keyof SiteSettings, value: string) => {
    if (!form) return;
    const numeric = !["quiet_hours_start", "quiet_hours_end", "site_timezone"].includes(key);
    setForm({ ...form, [key]: numeric ? Number(value) : value } as SiteSettings);
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await api<SiteSettings>("/sites/northbridge/settings", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      setForm(saved);
      setMessage("Reconciliation settings saved. New intervals use these deterministic rules.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const patchNode = (id: string, changes: Partial<TopologyNode>) =>
    setNodes((rows) => rows.map((n) => (n.id === id ? { ...n, ...changes } : n)));

  const saveNode = async (node: TopologyNode) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await api<TopologyNode>(`/sites/northbridge/topology/${node.id}`, {
        method: "PUT",
        body: JSON.stringify({
          expected_interval_minutes: node.expected_interval_minutes,
          known_unmetered_m3_per_interval: node.known_unmetered_m3_per_interval,
          buffered: node.buffered,
          storage_capacity_m3: node.storage_capacity_m3,
          storage_change_m3_per_interval: node.storage_change_m3_per_interval,
          active: node.active,
        }),
      });
      patchNode(node.id, saved);
      setMessage(`${node.label} accounting configuration saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const configurable = nodes.filter(
    (n) => n.kind === "UNMETERED" || n.buffered || n.storage_capacity_m3 !== null
  );

  return (
    <AppShell>
      <PageHeader
        title="Settings"
        description="Explicit operational policy: thresholds, evidence gates, known-unmetered allowances and storage behavior. Nothing here is learned by a model."
        actions={
          <button className="btn btn-primary" disabled={!form || saving} onClick={save}>
            {saving ? "Saving…" : "Save rules"}
          </button>
        }
      />

      {error && <ErrorState title="Settings error" message={error} onRetry={load} />}
      {message && <Banner tone="success">{message}</Banner>}

      {loading && !form ? (
        <Panel title="Reconciliation rules">
          <SkeletonRows rows={5} cols={3} />
        </Panel>
      ) : form ? (
        <>
          <Panel title="Reconciliation" subtitle="When unexplained loss is classified and when it becomes an incident">
            <div className="field-grid">
              <NumberField
                label="Minimum unexplained residual (m³)"
                value={form.minimum_residual_m3}
                step="0.01"
                hint="Smallest residual treated as meaningful loss"
                onChange={(v) => update("minimum_residual_m3", v)}
              />
              <NumberField
                label="Minimum residual ratio"
                value={form.minimum_residual_ratio}
                step="0.01"
                hint="Residual as a share of inflow"
                onChange={(v) => update("minimum_residual_ratio", v)}
              />
              <NumberField
                label="Intervals before incident"
                value={form.persistence_intervals}
                step="1"
                hint="Consecutive anomalous intervals required"
                onChange={(v) => update("persistence_intervals", v)}
              />
            </div>
          </Panel>

          <Panel title="Evidence gates" subtitle="Prerequisites that suspend leak classification when not satisfied">
            <div className="field-grid">
              <NumberField
                label="Minimum downstream coverage"
                value={form.minimum_coverage}
                step="0.01"
                hint="Share of parent flow explicitly metered"
                onChange={(v) => update("minimum_coverage", v)}
              />
              <NumberField
                label="Freshness limit (seconds)"
                value={form.freshness_limit_seconds}
                step="30"
                hint="Maximum lag against the newest site reading"
                onChange={(v) => update("freshness_limit_seconds", v)}
              />
              <NumberField
                label="Timestamp tolerance (seconds)"
                value={form.alignment_tolerance_seconds}
                step="10"
                hint="Maximum parent/child clock skew"
                onChange={(v) => update("alignment_tolerance_seconds", v)}
              />
            </div>
          </Panel>

          <Panel title="Repair verification" subtitle="How a reported repair is proven before an incident resolves">
            <div className="field-grid">
              <NumberField
                label="Healthy intervals required"
                value={form.verification_required_intervals}
                step="1"
                hint="Distinct valid intervals after repair"
                onChange={(v) => update("verification_required_intervals", v)}
              />
              <TextField
                label="Quiet hours start"
                type="time"
                value={form.quiet_hours_start}
                onChange={(v) => update("quiet_hours_start", v)}
              />
              <TextField
                label="Quiet hours end"
                type="time"
                value={form.quiet_hours_end}
                onChange={(v) => update("quiet_hours_end", v)}
              />
            </div>
          </Panel>

          <Panel title="Site and policy" subtitle="Runtime posture for this deployment">
            <div className="field-grid">
              <TextField
                label="Timezone"
                value={form.site_timezone}
                onChange={(v) => update("site_timezone", v)}
              />
            </div>
            <div className="kv mt-16">
              <div className="kv-row">
                <span className="kv-key">Authentication</span>
                <span className="kv-value">Disabled — demo identities only</span>
              </div>
              <div className="kv-row">
                <span className="kv-key">AI / ML</span>
                <span className="kv-value">None — deterministic arithmetic only</span>
              </div>
              <div className="kv-row">
                <span className="kv-key">Physical hardware</span>
                <span className="kv-value">Not required for this demo</span>
              </div>
            </div>
          </Panel>

          <Panel
            title="Topology accounting"
            subtitle="Known-unmetered and buffered boundaries are first-class evidence inputs"
          >
            {configurable.length === 0 ? (
              <p className="muted small mb-0">No special topology nodes configured.</p>
            ) : (
              configurable.map((n) => (
                <div className="config-block" key={n.id}>
                  <div className="flex-between mb-16">
                    <div>
                      <strong style={{ fontSize: 13.5 }}>{n.label}</strong>
                      <div className="muted tiny mono" style={{ marginTop: 2 }}>{n.id} · {n.kind}</div>
                    </div>
                    <button className="btn btn-sm" disabled={saving} onClick={() => saveNode(n)}>
                      Save node
                    </button>
                  </div>
                  <div className="field-grid">
                    <NumberField
                      label="Expected interval (min)"
                      value={n.expected_interval_minutes}
                      step="1"
                      onChange={(v) => patchNode(n.id, { expected_interval_minutes: Number(v) })}
                    />
                    <NumberField
                      label="Known unmetered (m³/interval)"
                      value={n.known_unmetered_m3_per_interval}
                      step="0.01"
                      onChange={(v) => patchNode(n.id, { known_unmetered_m3_per_interval: Number(v) })}
                    />
                    <NumberField
                      label="Storage capacity (m³)"
                      value={n.storage_capacity_m3 ?? 0}
                      step="0.1"
                      onChange={(v) => patchNode(n.id, { storage_capacity_m3: Number(v) || null })}
                    />
                    <NumberField
                      label="Storage Δ (m³/interval)"
                      value={n.storage_change_m3_per_interval ?? 0}
                      step="0.01"
                      onChange={(v) => patchNode(n.id, { storage_change_m3_per_interval: Number(v) || null })}
                    />
                    <label className="checkbox" style={{ alignSelf: "end", paddingBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={n.buffered}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => patchNode(n.id, { buffered: e.target.checked })}
                      />
                      Buffered / storage boundary
                    </label>
                    <label className="checkbox" style={{ alignSelf: "end", paddingBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={n.active}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => patchNode(n.id, { active: e.target.checked })}
                      />
                      Active
                    </label>
                  </div>
                </div>
              ))
            )}
            <p className="muted small mt-16 mb-0">
              LeakLedger subtracts configured legitimate unmetered use and reduces certainty around storage rather
              than misclassifying either as leakage.
            </p>
          </Panel>

          <Panel title="Why these are not confidence scores">
            <p className="muted small mb-0" style={{ lineHeight: 1.65 }}>
              Coverage, completeness, freshness, alignment and storage assumptions are exposed separately. A
              conclusion either satisfies the configured evidence gates or it does not.
            </p>
          </Panel>
        </>
      ) : null}
    </AppShell>
  );
}

function NumberField({
  label,
  value,
  step,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  step: string;
  hint?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="input"
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function TextField({
  label,
  value,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="input"
        type={type}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
    </label>
  );
}

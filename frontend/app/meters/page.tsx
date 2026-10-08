"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Status } from "@/components/Status";
import { Banner, EmptyState, ErrorState, Panel, SkeletonRows, StatCell, StatStrip } from "@/components/ui";
import { API, api, fmt, fmtDateTime } from "@/lib/api";
import type { MeterRow } from "@/lib/types";

type ImportResult = { accepted: number; duplicates: number; rejected: { row: number; reason: string }[]; total_rows: number };

export default function Meters() {
  const [rows, setRows] = useState<MeterRow[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<MeterRow[]>("/sites/northbridge/meters");
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
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    setResult(null);
    try {
      const data = new FormData();
      data.append("file", file);
      const r = await api<ImportResult>("/sites/northbridge/import", { method: "POST", body: data });
      setResult(r);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const labelById = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r.label])), [rows]);
  const healthy = rows.filter((r) => r.health === "HEALTHY").length;
  const stale = rows.filter((r) => r.health === "STALE" || r.health === "NO_DATA").length;
  const unmetered = rows.filter((r) => r.kind === "UNMETERED").length;

  return (
    <AppShell>
      <PageHeader
        title="Meter Data"
        description="Current inventory and cumulative readings. CSV imports pass through the same validation and reconciliation contract as manual readings."
        actions={
          <>
            <a className="btn" href={`${API}/sites/northbridge/import/sample`}>
              <Download size={14} /> Sample CSV
            </a>
            <button className="btn btn-primary" onClick={() => input.current?.click()} disabled={uploading}>
              <Upload size={14} /> {uploading ? "Importing…" : "Import CSV"}
            </button>
            <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={upload} />
          </>
        }
      />

      {error && <ErrorState title="Meter data unavailable" message={error} onRetry={load} />}

      {result && (
        <Banner tone={result.rejected.length > 0 ? "info" : "success"}>
          <strong>Import complete.</strong> {result.accepted} accepted · {result.duplicates} duplicates ·{" "}
          {result.rejected.length} rejected of {result.total_rows} rows.
          {result.rejected.length > 0 && (
            <div className="small mt-8">
              {result.rejected.slice(0, 6).map((x) => (
                <div key={`${x.row}-${x.reason}`} className="text-warning">Row {x.row}: {x.reason}</div>
              ))}
            </div>
          )}
        </Banner>
      )}

      <StatStrip>
        <StatCell label="Meters" value={rows.filter((r) => r.kind === "METER").length} sub={`${rows.length} nodes total`} />
        <StatCell label="Healthy" value={healthy} sub="Current within freshness limit" />
        <StatCell label="Stale / no data" value={stale} sub="Feed needs attention" />
        <StatCell label="Unmetered branches" value={unmetered} sub="Accounted as configured use" />
      </StatStrip>

      <Panel flush className="mt-16">
        {loading && rows.length === 0 ? (
          <SkeletonRows rows={9} cols={7} />
        ) : rows.length === 0 ? (
          <EmptyState title="No meter inventory" description="Seed the site or import readings to populate the inventory." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Meter</th>
                  <th>Parent</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th className="num">Latest cumulative</th>
                  <th>Latest reading</th>
                  <th className="num">Interval</th>
                  <th className="num">Readings</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="strong">{r.label}</span>
                      <div className="cell-sub mono">{r.id}</div>
                    </td>
                    <td className="muted">{r.parent_id ? labelById[r.parent_id] ?? r.parent_id : "—"}</td>
                    <td className="muted">{r.kind}{r.buffered ? " · buffered" : ""}</td>
                    <td><Status value={r.health} /></td>
                    <td className="num mono">
                      {r.latest_reading ? `${fmt(r.latest_reading.cumulative_m3, 3)} m³` : "—"}
                    </td>
                    <td className="muted small">{r.latest_reading ? fmtDateTime(r.latest_reading.timestamp) : "—"}</td>
                    <td className="num">{r.expected_interval_minutes} min</td>
                    <td className="num">{r.reading_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="CSV contract" subtitle="Required columns" className="mt-16">
        <code className="mono small" style={{ color: "var(--accent)" }}>timestamp,meter_id,cumulative_m3</code>
        <p className="muted small mt-8 mb-0">
          Optional columns: <code className="mono">event_id</code>, <code className="mono">unit</code>. Units are
          normalized to m³. Invalid timestamps, unknown meters and malformed values are rejected with per-row reasons.
          Duplicate event IDs never double-count water.
        </p>
      </Panel>
    </AppShell>
  );
}

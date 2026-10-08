"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState, Panel, SkeletonRows } from "@/components/ui";
import { api, fmtDateTime } from "@/lib/api";

type Validation = {
  passed: boolean;
  results: { name: string; passed: boolean; detail: string }[];
  note: string;
};

const EXPECTED: Record<string, string> = {
  "Normal site": "0 incidents",
  "Hidden Hostel B loss": "Localise to HOSTEL-B-MAIN",
  "Missing meter fails closed": "Fail closed, no stronger claim",
  "Counter reset": "No negative leak conclusion",
  "Duplicate event": "No double counting",
  "Repair verification": "Resolve after 3 healthy intervals",
  "Failed repair": "REPAIR_FAILED",
};

export default function ValidationPage() {
  const [data, setData] = useState<Validation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [duration, setDuration] = useState<number | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const started = performance.now();
    try {
      const result = await api<Validation>("/demo/validation");
      setData(result);
      setDuration(Math.round(performance.now() - started));
      setRanAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const passed = data?.results.filter((r) => r.passed).length ?? 0;
  const total = data?.results.length ?? 0;

  return (
    <AppShell>
      <PageHeader
        title="Controlled Validation"
        description="Deterministic failure modes are validated explicitly. These are controlled simulations, not claims of field detection accuracy."
        actions={
          <button className="btn" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> {loading ? "Running…" : "Re-run validation"}
          </button>
        }
        meta={
          data ? (
            <>
              <span>Result <strong className={data.passed ? "text-success" : "text-danger"}>{data.passed ? "All scenarios passed" : "Scenario failure"}</strong></span>
              <span>{passed} / {total} passed</span>
              {ranAt && <span>Run {fmtDateTime(ranAt)}</span>}
              {duration !== null && <span>Completed in {duration} ms</span>}
            </>
          ) : undefined
        }
      />

      {error && <ErrorState title="Validation run failed" message={error} onRetry={load} />}

      {loading && !data && (
        <Panel title="Controlled scenarios">
          <SkeletonRows rows={7} cols={4} />
        </Panel>
      )}

      {data && (
        <>
          <Panel flush>
            {data.results.length === 0 ? (
              <EmptyState title="No validation results" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      <th>Expected</th>
                      <th>Result</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.results.map((r) => (
                      <tr key={r.name}>
                        <td><span className="strong">{r.name}</span></td>
                        <td className="muted">{EXPECTED[r.name] ?? "—"}</td>
                        <td>
                          <span className={`badge badge-${r.passed ? "success" : "danger"}`}>
                            <span className="badge-dot" aria-hidden="true" />
                            {r.passed ? "PASS" : "FAIL"}
                          </span>
                        </td>
                        <td className="muted">{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Scope and interpretation" className="mt-16">
            <p className="muted small mb-0" style={{ lineHeight: 1.65 }}>{data.note}</p>
          </Panel>
        </>
      )}
    </AppShell>
  );
}

type Tone = "success" | "danger" | "warning" | "info" | "neutral";

const TONES: Record<string, Tone> = {
  BALANCED: "success",
  RESOLVED: "success",
  HIGH: "success",
  HEALTHY: "success",
  PASS: "success",
  VERIFIED: "success",
  ANOMALOUS: "danger",
  OPEN: "danger",
  REPAIR_FAILED: "danger",
  FAIL: "danger",
  CRITICAL: "danger",
  ACKNOWLEDGED: "info",
  BUFFERED: "info",
  INVESTIGATING: "warning",
  VERIFYING: "warning",
  REPAIR_REPORTED: "warning",
  DATA_QUALITY_FAILURE: "warning",
  STALE: "warning",
  NO_DATA: "warning",
  EVIDENCE_INSUFFICIENT: "warning",
  MEDIUM: "warning",
  INSUFFICIENT: "neutral",
  INSUFFICIENT_DATA: "neutral",
  UNMETERED: "neutral",
  UNKNOWN: "neutral",
};

export function toneFor(value?: string | null): Tone {
  if (!value) return "neutral";
  return TONES[value.toUpperCase()] ?? "neutral";
}

export function Status({ value, plain = false }: { value?: string | null; plain?: boolean }) {
  const v = value || "UNKNOWN";
  const label = v.replaceAll("_", " ");
  const tone = toneFor(v);
  if (plain) {
    return <span className={`badge badge-plain badge-${tone}`}>{label}</span>;
  }
  return (
    <span className={`badge badge-${tone}`} title={label}>
      <span className="badge-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

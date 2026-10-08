import { AlertCircle, CheckCircle2, Info, RefreshCw } from "lucide-react";

export function Panel({
  title,
  subtitle,
  actions,
  children,
  flush = false,
  className = "",
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || actions) && (
        <div className="panel-header">
          <div>
            {title && <h2 className="panel-title">{title}</h2>}
            {subtitle && <p className="panel-sub">{subtitle}</p>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      <div className={`panel-body ${flush ? "flush" : ""}`.trim()}>{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {description && <p className="empty-desc">{description}</p>}
      {action && <div className="mt-16">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Unable to load data",
  message,
  detail,
  onRetry,
}: {
  title?: string;
  message: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <p className="error-title">{title}</p>
      <p className="error-desc">{message}</p>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          <RefreshCw size={13} /> Retry
        </button>
      )}
      {detail && (
        <details className="error-detail">
          <summary>Technical detail</summary>
          <pre>{detail}</pre>
        </details>
      )}
    </div>
  );
}

export function Banner({ tone = "info", children }: { tone?: "error" | "success" | "info"; children: React.ReactNode }) {
  const Icon = tone === "error" ? AlertCircle : tone === "success" ? CheckCircle2 : Info;
  return (
    <div className={`banner banner-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={15} style={{ flex: "none", marginTop: 1 }} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="flex-center muted small">
      <span className="spinner" aria-hidden="true" />
      {label}
    </span>
  );
}

export function Progress({ value, max = 1, warn = false }: { value: number; max?: number; warn?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={`progress-bar ${warn ? "warn" : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function SegmentedProgress({ total, done, active = false }: { total: number; done: number; active?: boolean }) {
  return (
    <div className="progress-segments" aria-label={`${done} of ${total} intervals complete`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`progress-segment ${i < done ? "done" : active && i === done ? "active" : ""}`}
        />
      ))}
    </div>
  );
}

export function KV({ rows }: { rows: { label: string; value: React.ReactNode; mono?: boolean }[] }) {
  return (
    <div className="kv">
      {rows.map((r) => (
        <div className="kv-row" key={r.label}>
          <span className="kv-key">{r.label}</span>
          <span className={`kv-value ${r.mono ? "mono" : ""}`}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (key: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          aria-selected={value === item.key}
          className={`tab ${value === item.key ? "active" : ""}`}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {item.count !== undefined && <span className="tab-count">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function StatStrip({ children }: { children: React.ReactNode }) {
  return <div className="stat-strip">{children}</div>;
}

export function StatCell({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="stat-cell">
      <div className="stat-label">{label}</div>
      <span className="stat-value">{value}</span>
      {sub && <div className="metric-hint">{sub}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="stack-sm" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex" style={{ gap: 12 }}>
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className="skeleton" style={{ height: 16, flex: c === 0 ? 1.4 : 1 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

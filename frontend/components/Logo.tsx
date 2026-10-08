export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
      <span
        aria-hidden="true"
        style={{
          display: "grid",
          placeItems: "center",
          width: 26,
          height: 26,
          borderRadius: 6,
          background: "var(--accent)",
          color: "#ffffff",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.02em",
        }}
      >
        LL
      </span>
      {!compact && (
        <span style={{ fontWeight: 650, fontSize: 15, letterSpacing: "-0.02em" }}>LeakLedger</span>
      )}
    </span>
  );
}

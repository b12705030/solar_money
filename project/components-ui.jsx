// Small shared UI building blocks
const { useState, useEffect, useRef, useMemo } = React;

function Info({ tip }) {
  return <span className="info" data-tip={tip}>i</span>;
}

function Badge({ children, tone = "green" }) {
  const styles = {
    green: { background: "var(--green-100)", color: "var(--green-700)" },
    amber: { background: "var(--amber-soft)", color: "#8B5A10" },
    ink:   { background: "var(--ink-100)", color: "var(--ink-700)" },
  }[tone];
  return (
    <span style={{
      ...styles,
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 999,
      fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
    }}>{children}</span>
  );
}

function SunIcon({ size = 20, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" fill={color} stroke="none" />
      <line x1="12" y1="2" x2="12" y2="4.5" />
      <line x1="12" y1="19.5" x2="12" y2="22" />
      <line x1="2" y1="12" x2="4.5" y2="12" />
      <line x1="19.5" y1="12" x2="22" y2="12" />
      <line x1="4.9" y1="4.9" x2="6.7" y2="6.7" />
      <line x1="17.3" y1="17.3" x2="19.1" y2="19.1" />
      <line x1="4.9" y1="19.1" x2="6.7" y2="17.3" />
      <line x1="17.3" y1="6.7" x2="19.1" y2="4.9" />
    </svg>
  );
}

function ChevronIcon({ dir = "right", size = 16 }) {
  const rot = { right: 0, left: 180, up: -90, down: 90 }[dir];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ transform: `rotate(${rot}deg)` }}>
      <path d="M6 3 L11 8 L6 13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5 L6.5 12 L13 4.5" />
    </svg>
  );
}

function XIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M4 4 L12 12 M12 4 L4 12" />
    </svg>
  );
}

// Progress header
function ProgressBar({ step, steps }) {
  return (
    <div className="progress">
      <div className="progress-row">
        {steps.map((label, i) => (
          <React.Fragment key={i}>
            <div className={`progress-step ${i === step ? "active" : i < step ? "done" : ""}`}>
              <div className="progress-step-num">
                {i < step ? <CheckIcon size={12} /> : i + 1}
              </div>
              <span>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`progress-connector ${i < step ? "done" : ""}`} />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// Reusable numeric + unit display
function StatBlock({ label, value, unit, tip, size = "md", accent = "green" }) {
  const sizes = {
    sm: { num: 28, lbl: 12 },
    md: { num: 44, lbl: 13 },
    lg: { num: 64, lbl: 14 },
  }[size];
  const accentColor = accent === "amber" ? "#C8861E" : "var(--green-700)";
  return (
    <div>
      <div className="body-sm" style={{ display: "flex", alignItems: "center", fontSize: sizes.lbl, color: "var(--ink-500)", marginBottom: 6 }}>
        {label}{tip && <Info tip={tip} />}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: sizes.num, fontWeight: 700, color: accentColor, lineHeight: 1 }}>{value}</span>
        {unit && <span style={{ fontSize: sizes.num * 0.35, color: "var(--ink-500)", fontWeight: 500 }}>{unit}</span>}
      </div>
    </div>
  );
}

Object.assign(window, { Info, Badge, SunIcon, ChevronIcon, CheckIcon, XIcon, ProgressBar, StatBlock });

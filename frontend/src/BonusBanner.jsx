import React from "react";

// Bonus draw banner — hides itself automatically after the draw snapshot.
const END = Date.parse("2026-10-08T12:00:00Z");
const RULES_URL = "https://github.com/PBerHH/surge-protocol#bonus-draw-rules";

export default function BonusBanner() {
  if (Date.now() > END) return null;
  return (
    <div
      style={{
        background: "#0a0a0a",
        borderBottom: "1px solid #F5C842",
        color: "#f5f5f5",
        fontFamily: "'DM Sans', system-ui, sans-serif",
        fontSize: 14,
        lineHeight: 1.4,
        padding: "10px 16px",
        textAlign: "center",
      }}
    >
      <strong style={{ color: "#F5C842" }}>25 SUI Bonus Draw</strong>
      {" — stake 10+ SUI by Oct 1, 23:59 UTC, hold until Oct 8. Drawn live during Sui Basecamp. "}
      <a
        href={RULES_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "#F5C842", textDecoration: "underline" }}
      >
        Rules
      </a>
    </div>
  );
}

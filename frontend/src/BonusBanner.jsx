import React, { useState } from "react";

const END = Date.parse("2026-10-08T12:00:00Z");

const RULES = [
  "Prize: 25 SUI, paid by the Surge team to one winner. Normal prize pools continue unchanged.",
  "Eligibility: at least 10 SUI staked in Surge continuously from Oct 1, 2026 23:59 UTC to Oct 8, 2026 12:00 UTC.",
  "Tickets: 1 per whole SUI of your lowest staked balance in that window.",
  "Draw: tickets ordered by wallet address (ascending). Winning ticket = digest of the first Sui Mainnet checkpoint after Oct 8, 2026 12:00 UTC, read as an integer, modulo total tickets.",
  "Transparency: eligible wallets and ticket counts are published before the draw; anyone can recompute the result.",
  "Team wallets are excluded.",
  "Surge never DMs first. The winner is announced publicly on X only.",
  "No purchase necessary. Principal stays fully withdrawable at any time; withdrawing before the snapshot only removes eligibility.",
];

export default function BonusBanner() {
  const [open, setOpen] = useState(false);
  if (Date.now() > END) return null;
  const gold = "#F5C842";
  return (
    <div style={{ background: "#0a0a0a", borderBottom: `1px solid ${gold}`, color: "#f5f5f5", fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 14, lineHeight: 1.4, padding: "10px 16px", textAlign: "center" }}>
      <strong style={{ color: gold }}>25 SUI Bonus Draw</strong>
      {" — stake 10+ SUI by Oct 1, 23:59 UTC, hold until Oct 8. Drawn live during Sui Basecamp. "}
      <button onClick={() => setOpen(!open)} style={{ background: "none", border: "none", color: gold, textDecoration: "underline", cursor: "pointer", font: "inherit", padding: 0 }}>
        {open ? "Hide rules" : "Rules"}
      </button>
      {open && (
        <ul style={{ maxWidth: 720, margin: "10px auto 2px", paddingLeft: 20, textAlign: "left", fontSize: 13, color: "#d4d4d4" }}>
          {RULES.map((r) => <li key={r} style={{ marginBottom: 4 }}>{r}</li>)}
        </ul>
      )}
    </div>
  );
}

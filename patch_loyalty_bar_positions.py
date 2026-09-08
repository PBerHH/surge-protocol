#!/usr/bin/env python3
"""
Fixes the visual mismatch in the Loyalty Multiplier panel: the fill bar
widens linearly with real days-staked (days/365), but the tier labels
(0d/30d/90d/180d/365d) were evenly spaced regardless of the huge gaps
between real day-thresholds — so a wallet at 83 days (22.7% through the
year) visually looked like it was barely past the "30d" label instead of
nearly at "90d".

Fix: position each tier label at its TRUE percentage of 365 days
(0%, 8.2%, 24.7%, 49.3%, 100%) using absolute positioning inside a
relative container, so labels and the fill bar agree with each other.

Run: python3 patch_loyalty_bar_positions.py
Aborts cleanly (writes nothing) if the anchor text isn't found exactly once.
"""
import os, sys

PATH = os.path.expanduser("~/surge-protocol/frontend/src/App.jsx")

with open(PATH, "r") as f:
    s = f.read()

old = '''              <div className="loyalty-tiers">
                {[{ days: "0d", mult: "1.0x", threshold: 0 }, { days: "30d", mult: "1.2x", threshold: 30 }, { days: "90d", mult: "1.5x", threshold: 90 }, { days: "180d", mult: "1.8x", threshold: 180 }, { days: "365d", mult: "2.0x", threshold: 365 }].map(t => {
                  const active = loyaltyData ? loyaltyData.daysStaked >= t.threshold : t.threshold === 0;
                  return <div className={`tier ${active ? "current" : ""}`} key={t.days}><div className="tier-mult">{t.mult}</div><div className="tier-days">{t.days}</div></div>;
                })}
              </div>
              <div className="loyalty-track"><div className="loyalty-fill" style={{ width: `${loyaltyProgress}%` }} /></div>'''

new = '''              <div className="loyalty-tiers" style={{ position: "relative", height: 40 }}>
                {[{ days: "0d", mult: "1.0x", threshold: 0 }, { days: "30d", mult: "1.2x", threshold: 30 }, { days: "90d", mult: "1.5x", threshold: 90 }, { days: "180d", mult: "1.8x", threshold: 180 }, { days: "365d", mult: "2.0x", threshold: 365 }].map(t => {
                  const active = loyaltyData ? loyaltyData.daysStaked >= t.threshold : t.threshold === 0;
                  // True proportional position on the 0-365d scale, clamped
                  // slightly inward at the ends so labels don't clip outside
                  // the track edges.
                  const pct = Math.min(Math.max((t.threshold / 365) * 100, 2), 98);
                  const align = t.threshold === 0 ? "left" : t.threshold === 365 ? "right" : "center";
                  const transform = align === "left" ? "translateX(0)" : align === "right" ? "translateX(-100%)" : "translateX(-50%)";
                  return (
                    <div
                      className={`tier ${active ? "current" : ""}`}
                      key={t.days}
                      style={{ position: "absolute", left: `${pct}%`, transform, textAlign: align }}
                    >
                      <div className="tier-mult">{t.mult}</div>
                      <div className="tier-days">{t.days}</div>
                    </div>
                  );
                })}
              </div>
              <div className="loyalty-track"><div className="loyalty-fill" style={{ width: `${loyaltyProgress}%` }} /></div>'''

count = s.count(old)
if count != 1:
    print(f"ABORT — anchor matched {count} times (need exactly 1). No changes written.")
    sys.exit(1)

s = s.replace(old, new)
with open(PATH, "w") as f:
    f.write(s)

print(f"Done — loyalty tier labels repositioned proportionally in {PATH}")

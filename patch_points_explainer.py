#!/usr/bin/env python3
"""
Adds a short "how points work" explainer under the points banner. Leads with
the concrete, already-real benefit (permanent Early Bird/Pioneer multiplier)
since that's what actually drives trust-based conversion for an anon,
unaudited project — an unhedged airdrop pitch reads as a red flag to
sophisticated DeFi users. The planned airdrop is mentioned, clearly hedged
("planned, no guarantee"), as a bonus rather than the headline.

Run: python3 patch_points_explainer.py
Aborts cleanly (writes nothing) if the anchor text isn't found exactly once.
"""
import os, sys

PATH = os.path.expanduser("~/surge-protocol/frontend/src/App.jsx")

with open(PATH, "r") as f:
    s = f.read()

old = '''                  {pointsData?.referral_count > 0 && (
                    <div style={{ fontSize: "0.72rem", color: "rgba(58,191,170,0.7)", marginTop: "0.4rem" }}>
                      +{(pointsData.referral_bonus * 100).toFixed(0)}% bonus from {pointsData.referral_count} active referral{pointsData.referral_count === 1 ? "" : "s"}
                    </div>
                  )}
                </div>
              )}'''

new = '''                  {pointsData?.referral_count > 0 && (
                    <div style={{ fontSize: "0.72rem", color: "rgba(58,191,170,0.7)", marginTop: "0.4rem" }}>
                      +{(pointsData.referral_bonus * 100).toFixed(0)}% bonus from {pointsData.referral_count} active referral{pointsData.referral_count === 1 ? "" : "s"}
                    </div>
                  )}
                  <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.35)", marginTop: "0.6rem", paddingTop: "0.5rem", borderTop: "1px solid rgba(245,200,66,0.1)", lineHeight: 1.5 }}>
                    Points = stake × multiplier × time, shown on the leaderboard. Early Bird / Pioneer status locks your multiplier in <b style={{ color: "rgba(245,200,66,0.6)" }}>forever</b> — that part's already yours, permanently. A token airdrop for active stakers is planned down the line (no guarantee on timing or amount). Points don't affect draw odds — those come from tickets, tracked separately.
                  </div>
                </div>
              )}'''

count = s.count(old)
if count != 1:
    print(f"ABORT — anchor matched {count} times (need exactly 1). No changes written.")
    sys.exit(1)

s = s.replace(old, new)
with open(PATH, "w") as f:
    f.write(s)

print(f"Done — points explainer added in {PATH}")

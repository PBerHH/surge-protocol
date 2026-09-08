#!/usr/bin/env python3
"""
Inserts the referral link UI into the existing points banner in App.jsx.
Run from anywhere: python3 patch_referral_ui.py
Aborts cleanly (writes nothing) if the anchor text isn't found exactly once.
"""
import os, sys

PATH = os.path.expanduser("~/surge-protocol/frontend/src/App.jsx")

with open(PATH, "r") as f:
    s = f.read()

old = '''                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(255,255,255,0.35)" }}>multiplier · forever</div>
              </div>
            </section>
          )}'''

new = '''                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(255,255,255,0.35)" }}>multiplier · forever</div>
              </div>
              {account?.address && (
                <div style={{ width: "100%", marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(245,200,66,0.15)" }}>
                  <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.45)", marginBottom: "0.35rem" }}>
                    YOUR REFERRAL LINK
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <code style={{ fontSize: "0.78rem", color: "#F5C842", background: "rgba(245,200,66,0.08)", padding: "0.3rem 0.6rem", borderRadius: 6, wordBreak: "break-all" }}>
                      surgeonsui.com/?ref={account.address}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(`https://surgeonsui.com/?ref=${account.address}`)}
                      style={{ fontSize: "0.72rem", padding: "0.3rem 0.7rem", borderRadius: 6, border: "1px solid rgba(245,200,66,0.3)", background: "transparent", color: "#F5C842", cursor: "pointer" }}
                    >
                      Copy
                    </button>
                  </div>
                  {pointsData?.referral_count > 0 && (
                    <div style={{ fontSize: "0.72rem", color: "rgba(58,191,170,0.7)", marginTop: "0.4rem" }}>
                      +{(pointsData.referral_bonus * 100).toFixed(0)}% bonus from {pointsData.referral_count} active referral{pointsData.referral_count === 1 ? "" : "s"}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}'''

count = s.count(old)
if count != 1:
    print(f"ABORT — anchor matched {count} times (need exactly 1). No changes written.")
    sys.exit(1)

s = s.replace(old, new)
with open(PATH, "w") as f:
    f.write(s)

print(f"Done — referral UI inserted into the points banner in {PATH}")

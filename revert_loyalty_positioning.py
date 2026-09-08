#!/usr/bin/env python3
"""
Reverts the loyalty tier proportional-positioning experiment back to the
original evenly-spaced layout (both JSX and CSS). The exact "1.20x · 83d
staked" text below the bar already tells the precise story, so the tier
row can go back to being a simple reference table rather than trying to be
pixel-accurate at 60px label widths that don't fit the real (very uneven)
day-gaps between tiers.

Run: python3 revert_loyalty_positioning.py
Aborts cleanly (writes nothing) if either anchor isn't found exactly once.
"""
import os, sys

APP_PATH = os.path.expanduser("~/surge-protocol/frontend/src/App.jsx")
CSS_PATH = os.path.expanduser("~/surge-protocol/frontend/src/index.css")

with open(APP_PATH, "r") as f:
    app = f.read()
with open(CSS_PATH, "r") as f:
    css = f.read()

app_old = '''              <div className="loyalty-tiers" style={{ position: "relative", height: 40 }}>
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
              </div>'''

app_new = '''              <div className="loyalty-tiers">
                {[{ days: "0d", mult: "1.0x", threshold: 0 }, { days: "30d", mult: "1.2x", threshold: 30 }, { days: "90d", mult: "1.5x", threshold: 90 }, { days: "180d", mult: "1.8x", threshold: 180 }, { days: "365d", mult: "2.0x", threshold: 365 }].map(t => {
                  const active = loyaltyData ? loyaltyData.daysStaked >= t.threshold : t.threshold === 0;
                  return <div className={`tier ${active ? "current" : ""}`} key={t.days}><div className="tier-mult">{t.mult}</div><div className="tier-days">{t.days}</div></div>;
                })}
              </div>'''

css_old = '''.loyalty-tiers{position:relative;margin-bottom:10px}
.tier{position:absolute;top:0;width:60px}'''
css_old_alt = '''.loyalty-tiers { position: relative; margin-bottom: 10px; }
.tier { position: absolute; top: 0; width: 60px; }'''

css_new = '''.loyalty-tiers { display: flex; justify-content: space-between; margin-bottom: 10px; }
.tier { text-align: center; }'''

app_count = app.count(app_old)
if app_count != 1:
    print(f"ABORT — App.jsx anchor matched {app_count} times (need exactly 1). No changes written.")
    sys.exit(1)

if css.count(css_old) == 1:
    css_anchor = css_old
elif css.count(css_old_alt) == 1:
    css_anchor = css_old_alt
else:
    print(f"ABORT — index.css anchor not found exactly once. No changes written.")
    sys.exit(1)

app = app.replace(app_old, app_new)
css = css.replace(css_anchor, css_new)

with open(APP_PATH, "w") as f:
    f.write(app)
with open(CSS_PATH, "w") as f:
    f.write(css)

print("Done — reverted both App.jsx and index.css to the original evenly-spaced layout.")

#!/usr/bin/env python3
"""
Adds a one-line explanation under the referral link so first-time visitors
understand what it does. Run: python3 patch_referral_explainer.py
"""
import os, sys

PATH = os.path.expanduser("~/surge-protocol/frontend/src/App.jsx")

with open(PATH, "r") as f:
    s = f.read()

old = '''                  <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.45)", marginBottom: "0.35rem" }}>
                    YOUR REFERRAL LINK
                  </div>'''

new = '''                  <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.45)", marginBottom: "0.35rem" }}>
                    YOUR REFERRAL LINK
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.5rem", lineHeight: 1.5 }}>
                    Share it — when someone stakes through your link, you earn up to +50% extra points for as long as they stay staked. No effect on their draw odds or principal.
                  </div>'''

count = s.count(old)
if count != 1:
    print(f"ABORT — anchor matched {count} times (need exactly 1). No changes written.")
    sys.exit(1)

s = s.replace(old, new)
with open(PATH, "w") as f:
    f.write(s)

print(f"Done — explainer line added in {PATH}")

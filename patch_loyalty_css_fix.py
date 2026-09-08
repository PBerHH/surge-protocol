#!/usr/bin/env python3
"""
Fixes the loyalty tier label overlap: index.css still had .loyalty-tiers as
a flex container (display:flex; justify-content:space-between), which
conflicts with the position:absolute children set in App.jsx's proportional
positioning patch — flex + absolutely-positioned children fight each other,
causing the overlapping "1.0x/0d" mess.

Run: python3 patch_loyalty_css_fix.py
Aborts cleanly (writes nothing) if the anchor text isn't found exactly once.
"""
import os, sys

PATH = os.path.expanduser("~/surge-protocol/frontend/src/index.css")

with open(PATH, "r") as f:
    s = f.read()

old = '''.loyalty-tiers { display: flex; justify-content: space-between; margin-bottom: 10px; }
.tier { text-align: center; }'''

new = '''.loyalty-tiers { position: relative; margin-bottom: 10px; }
.tier { position: absolute; top: 0; width: 60px; }'''

count = s.count(old)
if count != 1:
    print(f"ABORT — anchor matched {count} times (need exactly 1). No changes written.")
    sys.exit(1)

s = s.replace(old, new)
with open(PATH, "w") as f:
    f.write(s)

print(f"Done — .loyalty-tiers CSS fixed in {PATH}")

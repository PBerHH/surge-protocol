#!/usr/bin/env python3
"""
EMERGENCY ROLLBACK: the password-in-URL endpoint breaks fetch() (both
Node's undici and browser fetch reject URLs with embedded credentials per
the Fetch spec — curl allows it, which is why the curl test worked but the
actual app crashes). Reverting to the old token URL to restore production
immediately. The token being publicly visible is a lesser problem than the
crank/frontend being down.

Run: python3 emergency_rollback_chainstack.py
"""
import os

OLD_URL = "https://youthful-newton:clang-chain-scheme-cyclic-specks-fall@sui-mainnet.core.chainstack.com"
RESTORE_URL = "https://sui-mainnet.core.chainstack.com/396f310746ca72e8a7912556ef34da94"

targets = [
    os.path.expanduser("~/surge-protocol/frontend/src/main.jsx"),
    os.path.expanduser("~/surge-protocol/scripts/crank.js"),
    os.path.expanduser("~/surge-protocol/scripts/points-worker.js"),
]

for path in targets:
    if not os.path.exists(path):
        print(f"SKIP (not found): {path}")
        continue
    with open(path, "r") as f:
        s = f.read()
    count = s.count(OLD_URL)
    if count == 0:
        print(f"NO MATCH in {path} — nothing to revert")
        continue
    s = s.replace(OLD_URL, RESTORE_URL)
    with open(path, "w") as f:
        f.write(s)
    print(f"OK — reverted {count} occurrence(s) in {path}")

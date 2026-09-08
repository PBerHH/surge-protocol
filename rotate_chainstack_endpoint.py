#!/usr/bin/env python3
"""
Rotates the leaked Chainstack RPC URL to the new password-protected endpoint
across all three affected files (frontend, crank, points-worker) in one run.

The old token URL was accidentally committed to the public GitHub repo in a
large batch commit earlier — this replaces it everywhere with the
Basic-Auth endpoint instead, which was never committed.

Run: python3 rotate_chainstack_endpoint.py
Reports each file's result; only writes files where the old URL was found.
"""
import os

OLD_URL = "https://sui-mainnet.core.chainstack.com/396f310746ca72e8a7912556ef34da94"
NEW_URL = "https://youthful-newton:clang-chain-scheme-cyclic-specks-fall@sui-mainnet.core.chainstack.com"

targets = [
    os.path.expanduser("~/surge-protocol/frontend/src/main.jsx"),
    os.path.expanduser("~/surge-protocol/scripts/crank.js"),
    os.path.expanduser("~/surge-protocol/scripts/points-worker.js"),
]

any_missing = False
for path in targets:
    if not os.path.exists(path):
        print(f"SKIP (not found): {path}")
        any_missing = True
        continue
    with open(path, "r") as f:
        s = f.read()
    count = s.count(OLD_URL)
    if count == 0:
        print(f"NO MATCH in {path} — old URL not found verbatim (check manually)")
        continue
    s = s.replace(OLD_URL, NEW_URL)
    with open(path, "w") as f:
        f.write(s)
    print(f"OK — replaced {count} occurrence(s) in {path}")

if any_missing:
    print("\nNote: some target files weren't found at the expected path — check paths manually.")

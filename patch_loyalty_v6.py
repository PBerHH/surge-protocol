#!/usr/bin/env python3
"""
Fixes the Loyalty Multiplier display for V6 stakers: the V6 contract never
got a loyalty_tracker module, so fetchLoyalty found nothing and the UI
silently fell back to 1.0x/0d for every V6 staker regardless of how long
they'd actually been staked.

Fix: when no V5 LoyaltyRecord exists, compute loyalty from the EARLIEST
deposit_ts_ms across the wallet's own V6 receipts (already fetched into
v6Receipts elsewhere in the app) using the same tier formula as before.
Streak bonus stays 0 for V6 (that data only ever existed in the V5
LoyaltyRecord, so it's not fabricated here) — this is a deliberate, honest
simplification, not a bug.

Run: python3 patch_loyalty_v6.py
Aborts cleanly (writes nothing) if the anchor text isn't found exactly once.
"""
import os, sys

PATH = os.path.expanduser("~/surge-protocol/frontend/src/App.jsx")

with open(PATH, "r") as f:
    s = f.read()

old = '''  const fetchLoyalty = useCallback(async () => {
    if (!account?.address) return;
    try {
      const res = await Promise.all([PACKAGE, PKG_CALL].map(pkg => client.getOwnedObjects({ owner: account.address, filter: { StructType: `${pkg}::loyalty_tracker::LoyaltyRecord` }, options: { showContent: true } })));
      const objs = { data: res.flatMap(r => r.data) };
      if (objs.data.length > 0) {
        const f = objs.data[0].data?.content?.fields;
        if (f) {
          const daysStaked = Math.floor((Date.now() - Number(f.stake_start_ms)) / 86400000);
          const streakDays = Math.min(Number(f.streak_days ?? 0), 30);
          let baseBp = daysStaked >= 365 ? 20000 : daysStaked >= 180 ? 18000 : daysStaked >= 90 ? 15000 : daysStaked >= 30 ? 12000 : 10000;
          const totalBp = Math.min(baseBp + Math.floor((streakDays * 3000) / 30), 20000);
          setLoyaltyData({ daysStaked, streakDays, multiplier: totalBp / 10000 });
        }
      }
    } catch (e) { console.error(e); }
  }, [account, client]);'''

new = '''  // Same tier formula as the legacy V5 LoyaltyRecord path below, factored
  // out so both paths compute identically instead of drifting apart.
  const loyaltyFromDays = (daysStaked, streakDays = 0) => {
    let baseBp = daysStaked >= 365 ? 20000 : daysStaked >= 180 ? 18000 : daysStaked >= 90 ? 15000 : daysStaked >= 30 ? 12000 : 10000;
    const totalBp = Math.min(baseBp + Math.floor((streakDays * 3000) / 30), 20000);
    return totalBp / 10000;
  };

  const fetchLoyalty = useCallback(async () => {
    if (!account?.address) return;
    try {
      const res = await Promise.all([PACKAGE, PKG_CALL].map(pkg => client.getOwnedObjects({ owner: account.address, filter: { StructType: `${pkg}::loyalty_tracker::LoyaltyRecord` }, options: { showContent: true } })));
      const objs = { data: res.flatMap(r => r.data) };
      if (objs.data.length > 0) {
        const f = objs.data[0].data?.content?.fields;
        if (f) {
          const daysStaked = Math.floor((Date.now() - Number(f.stake_start_ms)) / 86400000);
          const streakDays = Math.min(Number(f.streak_days ?? 0), 30);
          setLoyaltyData({ daysStaked, streakDays, multiplier: loyaltyFromDays(daysStaked, streakDays) });
          return;
        }
      }
      // No V5 LoyaltyRecord (expected for V6-only stakers — the V6 contract
      // has no loyalty_tracker module). Fall back to the earliest
      // deposit_ts_ms across this wallet's V6 receipts. Streak bonus is 0
      // here since that data was never tracked on-chain for V6 — honest
      // rather than fabricated.
      if (v6Receipts.length > 0) {
        const earliestMs = Math.min(...v6Receipts.map(r => Number(r.deposit_ts_ms ?? Date.now())));
        const daysStaked = Math.floor((Date.now() - earliestMs) / 86400000);
        setLoyaltyData({ daysStaked, streakDays: 0, multiplier: loyaltyFromDays(daysStaked, 0) });
      } else {
        setLoyaltyData(null);
      }
    } catch (e) { console.error(e); }
  }, [account, client, v6Receipts]);'''

count = s.count(old)
if count != 1:
    print(f"ABORT — anchor matched {count} times (need exactly 1). No changes written.")
    sys.exit(1)

s = s.replace(old, new)
with open(PATH, "w") as f:
    f.write(s)

print(f"Done — V6 loyalty fallback added in {PATH}")

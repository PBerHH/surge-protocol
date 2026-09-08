#!/usr/bin/env python3
"""
Patches ~/surge-protocol/frontend/src/App.jsx to add the referral system.
Run from anywhere: python3 patch_referral.py
Each edit aborts the whole script if its anchor text isn't found exactly once —
nothing is written unless ALL four edits match cleanly.
"""
import os, sys, re

PATH = os.path.expanduser("~/surge-protocol/frontend/src/App.jsx")

with open(PATH, "r") as f:
    s = f.read()

edits = []

# ── Edit 1: capture ?ref= param once on load, store in localStorage ─────────
old1 = '''const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxY2pndm90ZmZ4dXR2Z3ZhaHNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNjI0MDQsImV4cCI6MjA5NDkzODQwNH0.J6m4cARii-VU3AQIotHY0i6hQC4HOXDZvvcE7MCyVC8";'''
new1 = old1 + '''

// Referral: capture ?ref=<wallet> once on first page load and remember it
// (localStorage), so it survives navigation up to the moment the visitor
// actually stakes. A referral is only ever recorded once per NEW wallet
// (enforced server-side by a unique constraint on referred_address), so this
// capture is harmless even if the same link is opened many times.
if (typeof window !== "undefined") {
  const urlRef = new URLSearchParams(window.location.search).get("ref");
  if (urlRef && /^0x[a-fA-F0-9]{1,64}$/.test(urlRef) && !localStorage.getItem("surge_ref")) {
    localStorage.setItem("surge_ref", urlRef);
  }
}'''
edits.append((old1, new1, "1: ref capture on load"))

# ── Edit 2: send referral to Supabase after a successful stake ──────────────
old2 = '''        onSuccess: (r) => { setTxStatus({ type: "success", msg: `Staked! Tx: ${r.digest.slice(0,16)}...` }); setTimeout(() => { fetchData(); fetchReceipts(); fetchLoyalty(); fetchLeaderboard(); }, 3000); },
        onError: (e) => setTxStatus({ type: "error", msg: e.message }),
      });
    } catch (e) { setTxStatus({ type: "error", msg: e.message }); }
  }

  async function handleUnstakeV6(receiptId) {'''
new2 = '''        onSuccess: (r) => {
          setTxStatus({ type: "success", msg: `Staked! Tx: ${r.digest.slice(0,16)}...` });
          // Fire-and-forget: record the referral if this visitor arrived via
          // a ?ref= link and hasn't already been recorded (server enforces
          // the "once per wallet" and "can't refer yourself" rules — this
          // call is allowed to fail silently, e.g. if already referred).
          const refAddr = typeof window !== "undefined" ? localStorage.getItem("surge_ref") : null;
          if (refAddr && account?.address && refAddr !== account.address) {
            fetch(`${SUPABASE_URL}/rest/v1/referrals`, {
              method: "POST",
              headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
              body: JSON.stringify({ referrer_address: refAddr, referred_address: account.address }),
            }).catch(() => {});
          }
          setTimeout(() => { fetchData(); fetchReceipts(); fetchLoyalty(); fetchLeaderboard(); }, 3000);
        },
        onError: (e) => setTxStatus({ type: "error", msg: e.message }),
      });
    } catch (e) { setTxStatus({ type: "error", msg: e.message }); }
  }

  async function handleUnstakeV6(receiptId) {'''
edits.append((old2, new2, "2: submit referral on successful stake"))

# ── Edit 3: pull referral_bonus/referral_count into pointsData fetch ────────
old3 = '''        const r = await fetch(`${SUPABASE_URL}/rest/v1/wallets?address=eq.${account.address}&select=total_points,multiplier,early_bird_rank,pioneer_rank`, {'''
new3 = '''        const r = await fetch(`${SUPABASE_URL}/rest/v1/wallets?address=eq.${account.address}&select=total_points,multiplier,early_bird_rank,pioneer_rank,referral_bonus,referral_count`, {'''
edits.append((old3, new3, "3: fetch referral fields into pointsData"))

for old, new, label in edits:
    count = s.count(old)
    if count != 1:
        print(f"ABORT — edit [{label}] matched {count} times (need exactly 1). No changes written.")
        sys.exit(1)

for old, new, label in edits:
    s = s.replace(old, new)
    print(f"applied: {label}")

with open(PATH, "w") as f:
    f.write(s)

print(f"\\nDone. {len(edits)} edits applied to {PATH}")
print("NOTE: edit 4 (the 'your referral link' UI element) was NOT auto-applied —")
print("see referral_ui_snippet.jsx for a copy-paste block to drop into your points banner.")

#!/usr/bin/env python3
"""
Ersetzt den bisherigen linearen Loyalty-Balken durch einen Tier-basierten.
Vorher: Balken = daysStaked / 365 (visuell irreführend)
Nachher: Balken = Fortschritt zwischen aktuellem Tier und nächstem Tier

Beispiel bei 91d (1.5x, nächstes Tier 1.8x bei 180d):
- Balken zeigt (91-90)/(180-90) = 1.1% → fast leer (ehrlich: gerade erst 1.5x erreicht)
- Text: "1.50x · 91d staked · next: 1.8x in 89d"

Bei max-Tier (365d+):
- Balken voll (100%)
- Text: "2.0x · max tier reached"
"""
import os, sys

PATH = os.path.expanduser("~/surge-protocol/frontend/src/App.jsx")
with open(PATH) as f: s = f.read()

# 1. Neue Hilfsvariablen statt loyaltyProgress
old_progress = "  const loyaltyProgress = loyaltyData ? Math.min((loyaltyData.daysStaked / 365) * 100, 100) : 5;"
new_progress = """  // Tier-basierter Fortschrittsbalken: zeigt wie weit zum nächsten Tier,
  // nicht wie weit über 365 Tage — viel aussagekräftiger.
  const LOYALTY_TIERS = [
    { days: 0,   mult: 1.0 },
    { days: 30,  mult: 1.2 },
    { days: 90,  mult: 1.5 },
    { days: 180, mult: 1.8 },
    { days: 365, mult: 2.0 },
  ];
  const loyaltyProgress = (() => {
    if (!loyaltyData) return 5;
    const d = loyaltyData.daysStaked;
    const currentIdx = [...LOYALTY_TIERS].reverse().findIndex(t => d >= t.days);
    const idx = LOYALTY_TIERS.length - 1 - currentIdx;
    if (idx >= LOYALTY_TIERS.length - 1) return 100; // max tier
    const from = LOYALTY_TIERS[idx].days;
    const to   = LOYALTY_TIERS[idx + 1].days;
    return Math.min(((d - from) / (to - from)) * 100, 100);
  })();
  const loyaltyNextTier = (() => {
    if (!loyaltyData) return null;
    const d = loyaltyData.daysStaked;
    const next = LOYALTY_TIERS.find(t => t.days > d);
    return next ? { days: next.days, mult: next.mult, daysLeft: next.days - d } : null;
  })();"""

if old_progress not in s:
    print("ABORT — loyaltyProgress Anker nicht gefunden")
    sys.exit(1)
s = s.replace(old_progress, new_progress)

# 2. Text unter dem Balken: "1.50x · 91d staked · 0d streak" → bessere Info
old_text = "{loyaltyData.multiplier.toFixed(2)}x · {loyaltyData.daysStaked}d staked · {loyaltyData.streakDays}d streak"
new_text = "{loyaltyData.multiplier.toFixed(2)}x · {loyaltyData.daysStaked}d staked{loyaltyNextTier ? ` · next ${loyaltyNextTier.mult.toFixed(1)}x in ${loyaltyNextTier.daysLeft}d` : ' · max tier 🏆'}"

if old_text not in s:
    print("ABORT — Text-Anker nicht gefunden")
    sys.exit(1)
s = s.replace(old_text, new_text)

with open(PATH, "w") as f: f.write(s)
print("OK — Tier-basierter Loyalty-Balken eingebaut")

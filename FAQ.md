# Surge Protocol FAQ

## General

### What is Surge Protocol?
Surge Protocol is a no-loss prize savings game on Sui. Staked SUI is converted into haSUI (Haedal liquid staking) and earns real staking yield from the second it arrives — the yield funds prize pools. Winners are selected using on-chain randomness. Your principal is always safe.

### How does it work?
1. Stake SUI through Surge Protocol (minimum 1 SUI)
2. Your SUI is atomically converted to haSUI (Haedal) inside the vault — earning real staking yield (~2-2.5% APY) continuously, no warmup
3. The yield (haSUI appreciation) is harvested automatically — the contract enforces on-chain that harvest can never touch principal
4. Yield funds three prize pools: Spark (every 6h), Pulse (weekly), Surge (monthly)
5. Winners are drawn using `sui::random` — an on-chain random value that can't be predicted in advance

### Is my principal at risk?
No. Your staked SUI is held as haSUI, Sui's largest liquid staking token (Haedal, live since 2023, $200M+ TVL). Only the yield goes to prize pools. You can unstake anytime — exits use Haedal's native redemption at the exact rate (1-2 epochs, ~1-2 days, no fee).

### What is haSUI / Haedal?
haSUI is Haedal's liquid staking token — the largest and oldest LST on Sui (live since 2023, audited, $200M+ TVL). It appreciates against SUI as staking rewards accrue. The Surge vault holds your principal as haSUI, so every SUI earns continuously with no staking warmup. Honest trade-off: the no-loss guarantee depends on haSUI staying solvent and redeemable — mitigated by using native redemption (exact rate) for all principal exits.

---

## Draws & Prizes

### How do I enter draws?

| Draw | Minimum | Tickets | Frequency |
|------|---------|---------|-----------|
| ⚡ Spark | 1 SUI | **1 per wallet** (equal odds) | Every 6h |
| 🔄 Pulse | 10 SUI | √stake × loyalty | Weekly |
| 🌊 Surge | 50 SUI | √stake × loyalty | Monthly |

**Spark is equal odds** — every staker gets exactly 1 ticket regardless of stake size. A 1 SUI staker has the same daily chance as a 10,000 SUI whale.

### What does √stake mean for Pulse and Surge?
Square-root scaling makes draws fairer. A 100 SUI staker gets ~10 tickets, a 10,000 SUI staker ~100 — not 100×. Proportional but anti-whale.

### Do multipliers increase my draw chances?
For Spark: no — it's equal odds, multipliers don't apply.
For Pulse and Surge: yes — your Pioneer/Loyalty multiplier boosts your ticket count.

### How are winners selected?
The random value comes from Sui's on-chain VRF (`sui::random`), so it can't be predicted in advance and is verifiable on-chain.

Being upfront about the current trust model: draws are triggered by a team-operated crank, and ticket counts are presently computed off-chain by that crank and then registered on-chain. So today the system relies on a trusted operator running honest code. On-chain ticket derivation and permissionless draw triggering are on the roadmap to remove this trust.

---

## Fees & Economics

### Where do fees go?
Surge takes 2% of staking yield, split fully on-chain:
- **1% Operations** — crank automation, infrastructure, gas costs
- **1% Marketing** — partnerships, ads, community growth, grants

The remaining 98% goes to prize pools. The pools are split 20% Spark / 30% Pulse / ~48% Surge of gross yield (the 2% fee is taken from the Surge share).

### Why charge fees at all?
Running Surge requires infrastructure: a crank server running 24/7, databases, hosting, and marketing to grow TVL. Bigger TVL = bigger prizes.

---

## Pioneer Points

### What are Pioneer Points?
Points track early adoption and loyalty. They determine your allocation in a potential future $SURGE token airdrop.

### How do I earn points?
- **Base:** 1 point per SUI per day
- **Early Bird (first 100):** 3× multiplier forever
- **Pioneer (first 1,000):** 2× multiplier forever
- **Loyalty bonus:** up to 2× after continuous staking

### What happens to my points if I withdraw?
- **Full withdrawal:** Loyalty multiplier resets to 1.0×, but your Early Bird/Pioneer tier remains

### When is the token airdrop?
TBD, and not guaranteed. The points system is live now to track early supporters.

---

## Technical

### Where is the SUI actually staked?
Inside Haedal's staking pool (haSUI), which delegates across Sui validators automatically. Vault: `0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5` (verified on-chain).

### What's the unstake delay?
1-2 epochs (~1-2 days) via Haedal's native redemption. When you unstake, you receive a redemption ticket; after maturity you claim your full principal directly — no crank involved, no fee, exact rate. Funds are never at risk.

### Is the contract audited?
Not yet. An internal code review has been done; a formal third-party audit is planned before TVL grows significantly. The contract is open source and verifiable on-chain. See the README "Trust model" section for current limitations.

### Can the contract be upgraded?
Yes — the team holds the `UpgradeCap`. Existing struct layouts and public function signatures are preserved across upgrades, but function logic can change. A timelock is planned before the protocol reaches scale.

### What version is the contract?
V6. The contract has been upgraded several times since launch, each time without affecting user funds or requiring any user action.

---

## Contact & Support

- **Website:** [surgeonsui.com](https://surgeonsui.com)
- **GitHub:** [github.com/surge-dev/surge-protocol](https://github.com/surge-dev/surge-protocol)

---

*Last updated: June 2026*

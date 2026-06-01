# Surge Protocol FAQ

## General

### What is Surge Protocol?
Surge Protocol is a no-loss prize savings game on Sui. Stake SUI to earn real validator yield, which funds prize pools. Winners are selected via on-chain VRF randomness. Your principal is always safe.

### How does it work?
1. Stake SUI through Surge Protocol (minimum 1 SUI)
2. Your SUI is delegated to Triton One validator — earning real yield (~2–3% APY)
3. Validator yield is harvested automatically each epoch
4. Yield funds three prize pools: Spark (every 6h), Pulse (weekly), Surge (monthly)
5. Winners drawn via `sui::random` on-chain VRF — provably fair

### Is my principal at risk?
No. Your staked SUI is delegated to Triton One validator via Sui's native staking system. Only the yield goes to prize pools. You can unstake anytime (24h epoch delay).

### What is Triton One?
Triton One is one of Sui's original validators with high uptime and competitive APY. Your SUI is delegated directly to them — the same way you'd stake natively on Sui, just routed through the Surge vault.

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
Square root scaling makes draws fairer. A 100 SUI staker gets 10 tickets, a 10,000 SUI staker gets 100 — not 100×. The relationship is proportional but anti-whale.

### Do multipliers increase my draw chances?
For Spark: no — it's equal odds, multipliers don't apply.  
For Pulse and Surge: yes — your Pioneer/Loyalty multiplier boosts your ticket count.

### How are winners selected?
On-chain via `sui::random` VRF. Provably fair, verifiable, and impossible for the operator to predict or manipulate.

---

## Fees & Economics

### Where do fees go?
Surge takes 2% of staking yield, split fully on-chain:
- **1% Operations** — crank automation, infrastructure, gas costs
- **1% Marketing** — partnerships, ads, community growth, grants

98% of yield goes to prize pools for winners.

### Why charge fees at all?
Running Surge requires infrastructure: a crank server running 24/7, databases, hosting, and marketing to grow TVL. Bigger TVL = bigger prizes.

---

## Pioneer Points

### What are Pioneer Points?
Points track early adoption and loyalty. They determine your allocation in the future $SURGE token airdrop.

### How do I earn points?
- **Base:** 1 point per SUI per day
- **Early Bird (first 100):** 3× multiplier forever
- **Pioneer (first 1,000):** 2× multiplier forever
- **Loyalty bonus:** up to 2× after continuous staking

### What happens to my points if I withdraw?
- **Full withdrawal:** Loyalty multiplier resets to 1.0×, but Early Bird/Pioneer tier remains

### When is the token airdrop?
TBD. Points system is live now to track early supporters.

---

## Technical

### Which validator is used?
Triton One — a professional Sui validator. Address: `0xa608b66f7ae2201286f7dd07a8b073cde7955b35056629636a6c9b3f5275f384` (verified on-chain).

### What's the unstake delay?
1 epoch (~24 hours). Standard Sui protocol requirement.

### Is the contract audited?
Not yet. Audit is planned before TVL exceeds 1M SUI. The contract is fully open source and verifiable on-chain.

### Can the contract be upgraded?
Yes — the team holds the UpgradeCap with a `compatible` upgrade policy. This means bugs can be fixed, but existing structs and public functions cannot be removed or changed. A timelock will be added before the protocol reaches scale.

### What version is the contract?
V6. The contract has been upgraded several times since launch, each time transparently and without affecting user funds or requiring any user action.

---

## Contact & Support

- **Website:** [surgeonsui.com](https://surgeonsui.com)
- **GitHub:** [github.com/surge-dev/surge-protocol](https://github.com/surge-dev/surge-protocol)

---

*Last updated: June 2026*

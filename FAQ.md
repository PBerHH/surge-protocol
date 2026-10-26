# Surge Protocol FAQ

## General

### What is Surge Protocol?
Surge Protocol is a no-loss prize savings game on Sui. Staked SUI is converted into haSUI (Haedal liquid staking) and earns real staking yield from the second it arrives — the yield funds prize pools. Winners are selected using on-chain randomness. Your principal is always safe.

### How does it work?
1. Stake SUI through Surge Protocol (minimum 1 SUI)
2. Your SUI is atomically converted to haSUI (Haedal) inside the vault — earning real staking yield (~2-2.5% APY) continuously, no warmup
3. The yield (haSUI appreciation) is harvested automatically — the contract enforces on-chain that harvest can never touch principal
4. Once a month, at **Surge Night**, the yield is drawn among 8 winners — live on Telegram, where reminders and results are posted automatically
5. Winners are drawn using `sui::random` — an on-chain random value that can't be predicted in advance

### Is my principal at risk?
No. Your staked SUI is held as haSUI, Sui's largest liquid staking token (Haedal, live since 2023, $200M+ TVL). Only the yield goes to prize pools. You can unstake anytime — exits use Haedal's native redemption at the exact rate (1-2 epochs, ~1-2 days, no fee).

### What is haSUI / Haedal?
haSUI is Haedal's liquid staking token — the largest and oldest LST on Sui (live since 2023, audited, $200M+ TVL). It appreciates against SUI as staking rewards accrue. The Surge vault holds your principal as haSUI, so every SUI earns continuously with no staking warmup. Honest trade-off: the no-loss guarantee depends on haSUI staying solvent and redeemable — mitigated by using native redemption (exact rate) for all principal exits.

---

## Draws & Prizes

### How do I enter Surge Night?
Stake at least 1 SUI. That enters you into all 8 prizes of every Surge Night: 1 jackpot (~50% of the pool), 4 prizes (~7.5% each) and 3 prizes (~6.7% each).

### How many tickets do I get?
Every wallet with at least 1 SUI staked holds at least 1 ticket. Beyond that, 1 SUI = 1 ticket, filled up over the 30 days before the draw. A deposit staked for the whole 30 days counts fully; one made 3 days before the draw counts 10%. **Stake early, hold more.**

### Does splitting my SUI across wallets help?
No. Odds are linear — 100 SUI in one wallet has exactly the same chance as 10 wallets with 10 SUI.

### Do Points or multipliers increase my draw chances?
No. Tickets depend only on how much you stake and for how long. Points and multipliers are a separate rewards track.

### Where do I see the draw and the winners?
Live in our Telegram channel [t.me/surge_sui](https://t.me/surge_sui): reminders before the draw and all winners with their on-chain transaction links are posted there automatically, so anyone can verify the result. Updates also on X [@Surge_Sui](https://x.com/Surge_Sui).

### Can the team win?
No. Team wallets are excluded from every draw.

### Why did the draw system change?
Until October 2026 Surge ran three separate draws (Spark every 6h, Pulse weekly, Surge monthly) with different minimums. At today's size that split the yield into pools too small to pay out. Now everything goes into one monthly event with bigger, ranked prizes — and the time-weighting rewards people who actually stake rather than last-minute deposits.

### How are winners selected?
The random value comes from Sui's on-chain VRF (`sui::random`), so it can't be predicted in advance and is verifiable on-chain.

Being upfront about the current trust model: draws are triggered by a team-operated crank, and ticket counts are presently computed off-chain by that crank and then registered on-chain. So today the system relies on a trusted operator running honest code. On-chain ticket derivation and permissionless draw triggering are on the roadmap to remove this trust.

---

## Fees & Economics

### Where do fees go?
Surge takes 2% of staking yield, split fully on-chain:
- **1% Operations** — crank automation, infrastructure, gas costs
- **1% Marketing** — partnerships, ads, community growth, grants

The remaining 98% goes to the Surge Night prize pool: 48% of gross yield funds the jackpot, 30% prizes #2–5 and 20% prizes #6–8.

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

### Do points affect my chances in draws?
No. Draw chances are determined by tickets, not Points. Points reward early adopters through multipliers and leaderboard status, while your tickets determine your entries in each draw.

### When is the token airdrop?
The SURGE token airdrop is planned as part of the protocol's broader rewards ecosystem. Airdrop details, including timing and allocation, will be announced as the rollout takes shape.

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
- **Telegram (Surge Night live, results):** [t.me/surge_sui](https://t.me/surge_sui)
- **X (updates):** [@Surge_Sui](https://x.com/Surge_Sui)
- **GitHub:** [github.com/PBerHH/surge-protocol](https://github.com/PBerHH/surge-protocol)

---

*Last updated: October 2026*

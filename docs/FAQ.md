# Surge Protocol FAQ

## General

### What is Surge Protocol?
Surge Protocol is a no-loss prize savings game on Sui. Stake SUI to earn validator yield, which funds prize pools. Winners are selected via on-chain VRF randomness.

### How does it work?
1. Stake SUI through Surge Protocol
2. Your SUI is delegated to Triton One validator
3. Validator yield is harvested automatically
4. Yield funds three prize pools: Spark (daily), Pulse (weekly), Surge (monthly)
5. Winners drawn via `sui::random` on-chain

### Is my principal at risk?
No. Your staked SUI remains yours. Only the yield goes to prize pools. You can unstake anytime (24h delay).

---

## Fees & Economics

### Where do fees go?
Surge takes 2% of staking yield:
- **1% Operations** - Crank automation, infrastructure, gas costs
- **1% Marketing** - Partnerships, ads, community growth, grants

98% of yield goes to prize pools for winners.

### What is the Marketing Wallet?
**Address:** `0x1de8cef32b6324c2ade5659caa86db8e0dc3c1fd7a76dda17ff4c8de330f5f95`

This wallet receives 1% of staking yield to fund:
- KOL partnerships and influencer campaigns
- Twitter/Discord ads
- Community bounties and grants
- Event sponsorships
- Educational content

All transactions are transparent on-chain. [View on Sui Explorer](https://suiscan.xyz/mainnet/account/0x1de8cef32b6324c2ade5659caa86db8e0dc3c1fd7a76dda17ff4c8de330f5f95)

### Why charge fees at all?
Surge Protocol requires infrastructure:
- Crank server runs 24/7 to harvest yield and execute draws
- Databases, hosting, and MCP tools cost money
- Marketing is needed to grow TVL (bigger pools = bigger prizes)

At small TVL, fees barely cover costs. We're building for scale.

---

## Pioneer Points

### What are Pioneer Points?
Points track early adoption and loyalty. They determine your allocation in the future $SURGE token airdrop.

### How do I earn points?
- **Base:** 1 point per SUI per day
- **Early Bird (first 100):** 3x multiplier FOREVER
- **Pioneer (first 1,000):** 2x multiplier FOREVER
- **Loyalty bonus:** Up to 2x after 365 days of continuous staking

### What happens to my points if I withdraw?
- **Partial withdrawal:** Points and multipliers stay
- **Full withdrawal:** Loyalty multiplier resets to 1.0x, but Early Bird/Pioneer tier remains

### When is the token airdrop?
TBD. Points system is live now to track early supporters. Token launch expected 6-12 months after protocol maturity.

---

## Draws & Prizes

### How do I enter draws?
Automatically based on stake amount:
- **Spark Draw (daily):** 10+ SUI staked = 1 ticket
- **Pulse Draw (weekly):** 50+ SUI staked = 1 ticket
- **Surge Draw (monthly):** 200+ SUI staked = 1 ticket

### Do multipliers increase my draw chances?
No. Pioneer/Loyalty multipliers only affect points, not draw tickets. Draw tickets are purely based on stake amount.

### How are winners selected?
On-chain via `sui::random` VRF. Provably fair and verifiable.

---

## Technical

### Which validator is used?
Triton One - a professional Sui validator with high uptime and competitive APY (~1.5%).

### What's the unstake delay?
1 epoch (~24 hours). Standard Sui protocol requirement.

### Is the contract audited?
Not yet. Protocol is post-hackathon (Sui Overflow 2026). Audit planned before TVL > 1M SUI.

---

## Contact & Support

- **GitHub:** [github.com/PBerHH/surge-protocol](https://github.com/PBerHH/surge-protocol)
- **Website:** [surge-protocol-chi.vercel.app](https://surge-protocol-chi.vercel.app)

---

*Last updated: May 2026*

# 🌊 Surge Protocol

**Prize-linked staking on Sui. Your principal is always safe — only the yield wins prizes.**

Live: [surgeonsui.com](https://surgeonsui.com)

---

## What is Surge?

Surge is a no-loss prize savings game built on Sui. Users stake SUI with a real validator, earn yield, and that yield funds prize pools. Your principal is never at risk — you can always withdraw everything you put in.

Think of it like a savings account where instead of earning interest, you get lottery tickets.

---

## How it works

1. **Stake SUI** — delegated directly to Triton One validator (minimum 1 SUI)
2. **Earn real yield** — ~1.5% APY from on-chain validator rewards
3. **Earn draw tickets** — automatically based on your stake
4. **Yield funds prizes** — harvested every epoch and split into prize pools
5. **Draws trigger automatically** — on-chain via `sui::random` VRF
6. **Winners paid directly** — to their wallet, no claiming needed

### Draw schedule

| Draw | Frequency | Winners | Pool share | Minimum |
|------|-----------|---------|------------|---------|
| ⚡ Spark | Every 6h | 3 | 20% | 1 SUI — equal odds |
| 🔄 Pulse | Weekly | 4 | 30% | 10 SUI — √stake |
| 🌊 Surge | Monthly | 1 jackpot | 50% | 50 SUI — √stake |

**Spark is equal odds** — every staker has the same chance regardless of stake size.  
**Pulse & Surge** use √stake scaling — proportional but anti-whale.

### Pioneer Points

Early stakers earn bonus points for the future $SURGE token airdrop:
- **Early Bird** (first 100): 3× multiplier forever
- **Pioneer** (first 1,000): 2× multiplier forever
- **Loyalty bonus**: up to 2× after continuous staking

---

## Security

### On-chain Randomness
**Problem:** Operator-controlled randomness could allow winner prediction.  
**Fix:** `sui::random::Random` — on-chain verifiable VRF, no one can predict or manipulate.

### Access Control
All sensitive functions require AdminCaps:
- `harvest()` and `claim_rewards()` — `VaultAdminCap`
- `award_spark/pulse/surge()` — `PoolAdminCap`
- `trigger_spark/pulse/surge()` — `DrawAdminCap`

### Principal Safety
User funds are delegated directly to Triton One validator via Sui's native staking. The vault never holds idle SUI — it's always earning real yield on-chain.

### Upgrade Policy
Package uses `compatible` upgrades — bugs can be fixed, but existing structs and public functions cannot be removed or changed. UpgradeCap is held by the team; a timelock is planned before TVL > 1M SUI.

### Security badges
- 🔐 **On-chain VRF** — `sui::random`, not operator-controlled
- 🛡️ **AdminCap protected** — no public drain vectors
- 🔒 **Principal safe** — user funds delegated to Triton One
- ⛓️ **Open source** — fully verifiable on-chain

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Frontend (React + Vite)             │
│                  surgeonsui.com                  │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│              Sui Mainnet Contracts (V6)          │
│                                                  │
│  StakingVault  ──→  Triton One Validator         │
│  (real yield)        (2–3% APY)                  │
│       │                                          │
│       └──→  reward_pool  ◄──  draw_manager       │
│             (prize pools)     (sui::random VRF)  │
│                                                  │
│             loyalty_tracker + ticket_engine      │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│              Crank v6 (Node.js, Fly.io)          │
│  - Harvests real Triton yield every epoch        │
│  - Routes rewards to prize pools (on-chain fee)  │
│  - Registers draw tickets for stakers            │
│  - Triggers draws when due                       │
└─────────────────────────────────────────────────┘
```

---

## Contract addresses (Mainnet)

| Object | Address |
|--------|---------|
| Package (latest) | `0x4ca98688e6cdf7fb6b73cc01d5ebbf77f947a02f5da570afd2f14bf155942b0c` |
| Original ID | `0x330aa337772418f68117556dce74034063f11a8de68f60a99acc9a5ee62f5fb3` |
| StakingVault | `0x50d8b86e95c8c75892e8cc7caa39a81604de123baf1528cf1c9203d8ab702562` |
| DrawState | `0xee9f68a29ab16442600a9e12426431b240aed97cdf5108f44d8325401cc25fb0` |
| RewardPool | `0xacf68b636a55c96a8269ab0b66d735a7bbfadf058821cc17f97bc32d49d6968f` |
| UpgradeCap | `0x5921d677eb94f7020c04eeb37bc4299b5ec00d8bd1ba47d656c6055a93a1c32f` |

Upgrade policy: `compatible` — bugs fixable, public interface preserved.

---

## Fee structure

Transparent 2% fee on staking yield, split fully on-chain:

- **98% → Prize pools** — Spark, Pulse, Surge draws
- **1% → Operations** — crank automation, infrastructure, gas
- **1% → Marketing** — partnerships, campaigns, community growth

All fees are split automatically on-chain in `deposit_yield`. Verifiable on [Suiscan](https://suiscan.xyz).

---

## Tech stack

- **Smart contracts** — Sui Move (Mainnet, V6)
- **Validator** — Triton One (`0xa608b66f...`)
- **Randomness** — `sui::random` (on-chain VRF)
- **Frontend** — React + Vite + @mysten/dapp-kit
- **Crank** — Node.js on Fly.io
- **Points DB** — Supabase
- **Hosting** — Vercel + Porkbun DNS

---

## Running locally

### Contracts
```bash
sui move build
sui client upgrade --upgrade-capability <CAP_ID> --gas-budget 200000000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Crank
```bash
cd scripts
cp .env.example .env  # fill in contract addresses and private key
node crank.js
```

---

## Roadmap

- [x] Real validator staking (Triton One)
- [x] On-chain fee split
- [x] Equal-odds Spark draw
- [x] Anti-whale √stake for Pulse & Surge
- [x] Pioneer Points system
- [ ] Formal security audit
- [ ] UpgradeCap timelock
- [ ] Multi-validator support
- [ ] Partial unstake UI

---

## Built for Sui Overflow 2026

# Surge Protocol

**Prize-linked staking on Sui Mainnet.** Your principal is always safe — only the yield wins prizes.

🌐 [surge-protocol-chi.vercel.app](https://surge-protocol-chi.vercel.app) · 📦 [Mainnet Contract](https://suiscan.xyz/mainnet/object/0x2755c0b895605f21f67b67f8ba58aa4b4b83759cd0d1a1fbb666ec9355c29d50)

---

## What is Surge?

Surge is inspired by UK Premium Bonds — but removes every middleman. Users deposit SUI, it gets natively staked to Triton One validator, and instead of receiving small predictable rewards, the pooled yield is distributed as prizes through three automated draw types.

**Principal is never at risk.** Full withdrawal available anytime after a 1-epoch (~24h) delay.

| Draw | Frequency | Winners | Pool Share | Min. Stake |
|------|-----------|---------|------------|------------|
| ⚡ Spark | Every 6h | 3 | 20% | 10 SUI |
| 🔄 Pulse | Weekly | 4 | 30% | 50 SUI |
| 🌊 Surge | Monthly | 1 jackpot | 50% | 200 SUI |

---

## How It Works

1. **Deposit SUI** → delegated to Triton One validator via `sui_system::request_add_stake_non_entry`
2. **Yield accumulates** → harvested automatically by the Crank (~1.5% APY)
3. **2% protocol fee** deducted at harvest, sent directly to fee wallet
4. **Prizes distributed** → 20% Spark / 30% Pulse / 50% Surge pools
5. **Winners selected** via Pyth Entropy VRF — verifiable, on-chain randomness
6. **Unstake anytime** → 1-epoch delay, principal always returned in full

---

## Architecture

### 5 Move Modules

```
sources/
├── loyalty_tracker.move   # Time-weighted multiplier 1.0x → 2.0x over 365 days
├── ticket_engine.move     # Anti-whale ticket formulas per draw type
├── stake_vault.move       # Native staking + 1-epoch unstaking delay
├── reward_pool.move       # 3 pools (20/30/50%) + 2% protocol fee
└── draw_manager.move      # Draw orchestration + Pyth Entropy VRF
```

### Ticket Formula

```
Spark:  min(stake_SUI, 500)                           × loyalty_multiplier
Pulse:  stake < 1K  → linear
        stake ≥ 1K  → 1000 + √(stake - 1000)         × loyalty_multiplier
Surge:  stake_SUI                                     × loyalty_multiplier
```

### Loyalty Tiers

| Duration | Multiplier |
|----------|-----------|
| 0–29 days | 1.0x |
| 30–89 days | 1.2x |
| 90–179 days | 1.5x |
| 180–364 days | 1.8x |
| 365+ days | 2.0x |

---

## Mainnet Deployment

| Object | ID |
|--------|----|
| Package | `0x2755c0b895605f21f67b67f8ba58aa4b4b83759cd0d1a1fbb666ec9355c29d50` |
| Vault | `0x5cd4c73e20d876b1105fa49049e1ee903e9eac382867ce1d597719c5877e6a26` |
| RewardPool | `0x2a0bc690ff0c1acb1d30b3b51c151444ff8fca09e557a64a423ac3583462f846` |
| DrawState | `0x5e8faab779a88ed2efa9f8523f66ff6238d5e5d7f64b45b365fc05a048e94a2b` |
| Validator | Triton One `0xa608b66f...5384` |

---

## Local Setup

### Prerequisites
- [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) `>= 1.73.0`
- Node.js `>= 18`

### Build & Test

```bash
git clone https://github.com/PBerHH/surge-protocol
cd surge-protocol

# Build
sui move build

# Run tests (21/21)
sui move test
```

### Deploy to Mainnet

```bash
sui client publish --gas-budget 100000000
```

### Run the Crank

```bash
cd scripts
cp .env.example .env   # fill in your contract addresses
npm install
node crank.js
```

The Crank runs on [Fly.io](https://fly.io) in production — harvests yield, runs draws automatically every minute.

---

## Economics (at 100K SUI TVL, 1.5% APY)

| | Amount |
|-|--------|
| Yearly yield | 1,500 SUI |
| Protocol fee (2%) | 30 SUI/year |
| Spark pool | ~0.16 SUI per draw (every 6h, 3 winners) |
| Pulse pool | ~8.6 SUI/week (4 winners) |
| Surge jackpot | ~37 SUI/month (1 winner) |

---

## Randomness

Winner selection uses **Pyth Entropy** — verifiable, manipulation-resistant on-chain VRF. The seed is public, the selection formula is deterministic, and the result is auditable by anyone.

---

## Tech Stack

- **Smart Contracts**: Sui Move (5 modules, 21 tests)
- **Frontend**: React + Vite + `@mysten/dapp-kit`
- **Crank**: Node.js, deployed on Fly.io
- **Hosting**: Vercel
- **Validator**: Triton One (Sui Mainnet)
- **Randomness**: Pyth Entropy VRF

---

## License

MIT

---

*Surge Protocol — Your principal is always safe. Only the yield wins prizes.*

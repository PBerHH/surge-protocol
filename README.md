# Surge Protocol

**Prize-linked staking on Sui.** Your principal is always safe — only the yield wins prizes.

> Built for [Sui Overflow 2026](https://overflow.sui.io) · DeFi & Payments Track

---

## What is Surge?

Surge is inspired by UK Premium Bonds (£120B TVL, 70+ years of product-market fit) — but removes every middleman. Users deposit SUI, it gets staked automatically, and instead of receiving small predictable rewards, the pooled yield is distributed as prizes through three draw types.

| Draw | Frequency | Winners | Pool Share | Min. Stake |
|------|-----------|---------|------------|------------|
| ⚡ Spark | Daily | 15 | 20% | 10 SUI |
| 🔄 Pulse | Weekly | 4 | 30% | 50 SUI |
| 🌊 Surge | Monthly | 1 jackpot | 50% | 200 SUI |

**Principal is never at risk.** Full withdrawal available anytime after a 1-epoch delay.

---

## Architecture

### 5 Move Modules

```
sources/
├── loyalty_tracker.move   # Time-weighted multiplier 1.0x → 2.0x over 365 days
├── ticket_engine.move     # Anti-whale ticket formulas per draw type
├── stake_vault.move       # Principal custody + 1-epoch unstaking delay
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
| 365+ days | 2.0x (hard cap) |

Streak bonus: up to +0.3x for 30 consecutive days staked.

---

## Testnet Deployment (V1)

| Object | ID |
|--------|----|
| Package | `0xa48d643d834ef46af785831b5d9d32c4055229bc2c78ec5ff76f61ffadab4b0a` |
| RewardPool | `0xf329f0952dd4464dac02810b95e206f43e3754f5f30d11cda01185abe5041804` |
| DrawState | `0x952a695a98c9297bfe46cb71f10b6a41143924b3ee5069dfc8c12ac1e36478a5` |

---

## Local Setup

### Prerequisites
- [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) `>= 1.73.0`
- Node.js `>= 18` (for crank script)

### Build & Test

```bash
git clone https://github.com/PBerHH/surge-protocol
cd surge-protocol

# Build V2
cd surge
sui move build

# Run tests
sui move test
```

### Deploy to Testnet

```bash
# Get testnet SUI
sui client faucet

# Deploy
sui client publish --gas-budget 200000000

# Note the Package ID and object IDs from the output
```

### Run the Crank

```bash
cd scripts
npm install
PACKAGE_ID=0x... DRAW_STATE=0x... REWARD_POOL=0x... npx ts-node crank.ts
```

---

## Economics (at 1M SUI TVL, 5% APY)

| | Amount |
|-|--------|
| Yearly yield | 50,000 SUI |
| Protocol fee (2%) | 1,000 SUI/year |
| Spark pool | ~2.7 SUI/day distributed to 15 winners |
| Pulse pool | ~188 SUI/week distributed to 4 winners |
| Surge jackpot | ~1,225 SUI/month to 1 winner |

---

## Randomness

Winner selection uses **Pyth Entropy** — verifiable, manipulation-resistant on-chain VRF. The seed is public, the selection formula is deterministic, and the result is auditable by anyone.

---

## Roadmap

- [x] V1 deployed on Sui Testnet
- [x] V2 contracts designed (5 modules)
- [ ] V2 Testnet deploy
- [ ] Frontend with `@mysten/dapp-kit` wallet integration
- [ ] Security audit (OtterSec / MixBytes)
- [ ] Mainnet launch

---

## License

MIT

---

*Surge Protocol — built on Sui. Your principal is always safe. Only the yield wins prizes.*

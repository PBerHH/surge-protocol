# Surge Protocol

**No-loss prize-staking vault on Sui Mainnet.**  
Principal never leaves the vault. Only validator yield (via haSUI/Haedal) funds tiered prize draws.  
Think: Premium Bonds, on-chain.

Live at: https://surgeonsui.com  
Twitter/X: @Surge_Sui  
Telegram: t.me/surge_sui  
GitHub: github.com/PBerHH/surge-protocol

---

## Core Mechanic

1. User stakes SUI → converts to haSUI via Haedal liquid staking
2. haSUI exchange rate appreciates over time (validator yield)
3. Surplus above principal = harvestable yield → funds prize pools
4. VRF-based draws (Sui `sui::random`) select winners every 6h / weekly / monthly
5. Principal always withdrawable in full

Prize tiers: **Spark** (daily, small) / **Pulse** (weekly) / **Surge** (monthly, big)

---

## Key Addresses (V6 — Mainnet, DO NOT CHANGE)

| Object | Address |
|--------|---------|
| PACKAGE (calls) | `0x4ca98688e6cdf7fb6b73cc01d5ebbf77f947a02f5da570afd2f14bf155942b0c` |
| PACKAGE_TYPE_ID (events, original-id) | `0x330aa337772418f68117556dce74034063f11a8de68f60a99acc9a5ee62f5fb3` |
| STAKING_VAULT | `0x50d8b86e95c8c75892e8cc7caa39a81604de123baf1528cf1c9203d8ab702562` |
| DRAW_STATE | `0xee9f68a29ab16442600a9e12426431b240aed97cdf5108f44d8325401cc25fb0` |
| REWARD_POOL | `0xacf68b636a55c96a8269ab0b66d735a7bbfadf058821cc17f97bc32d49d6968f` |
| UpgradeCap | `0x2d7c1e6e4b26ce37077c373a9d10b0458d422c28411ec495151c195d779df5e0` |
| Triton One validator | `0xa608b66f7ae2201286f7dd07a8b073cde7955b35056629636a6c9b3f5275f384` |

**Wallets:**
- User/Admin: `0x0baa87509dbe704c0932b664bed03b4ac4afe0015fe40a83a6a9d7d2a4fc183b`
- Crank: `0x2a587fd1789212292af4337cacdc7bcbca496e01a6538f46c08968d41d6a83c0`

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Smart contracts | Move (Sui Mainnet, edition 2024.beta) |
| Frontend | React/Vite (App.jsx), Vercel |
| Crank (6h scheduler) | Node.js, Fly.io (`surge-crank`) |
| Points worker | Node.js, Fly.io (`surge-points`) |
| Telegram bot | Node.js, Fly.io (`surge-telegram`) |
| Database | Supabase |
| RPC | Chainstack via env vars |
| LST | Haedal Protocol (haSUI) |

---

## Environment Variables

**Frontend (Vercel):**
- `VITE_RPC_URL` — Chainstack Sui Mainnet JSON-RPC endpoint

**Backend (Fly.io):**
- `RPC_URL` — same Chainstack endpoint
- `NETWORK=mainnet`
- `PACKAGE_ID` — V6 package address
- `PACKAGE_TYPE_ID` — original package ID
- `SUPABASE_URL` + `SUPABASE_SECRET_KEY`
- `TELEGRAM_BOT_TOKEN`

---

## Repository Structure

```
surge-protocol/
├── sources/              # Move smart contracts (V6)
│   ├── stake_vault.move
│   ├── draw_manager.move
│   ├── reward_pool.move
│   ├── ticket_engine.move
│   └── loyalty_tracker.move
├── frontend/             # React frontend (Vite)
│   └── src/
│       └── main.jsx      # Sui dApp-kit integration
├── scripts/              # Backend workers
│   ├── crank.js          # 6h draw/harvest scheduler
│   ├── points-worker.js  # Points calculation
│   └── yield.js          # Debug/manual yield check
├── telegram-bot/         # Telegram notification bot
├── points-app/           # Points Fly.io app
│   └── fly.toml          # Deploy: fly deploy -a surge-points --config points-app/fly.toml --dockerfile points-app/Dockerfile
├── Move.toml
├── Published.toml        # Mainnet addresses
└── env                   # Local env reference (NOT committed)
```

---

## Current State (Sep 2026)

- **TVL:** ~47 SUI principal, 3 stakers
- **DefiLlama:** Listed under "Yield Lottery" → defillama.com/protocol/surge-sui
- **Harvest blocker:** Haedal minimum ~1 SUI per `request_unstake_delay` call — current yield surplus below threshold. ETA shrinks linearly with TVL growth.
- **Pioneer slots:** 97/100 remaining — first 100 stakers lock 3x points multiplier permanently
- **Referral system:** +10% points per referred wallet, cap +50%

---

## Key Technical Decisions

- **No oracle dependency** — principal tracked 1:1 against haSUI exchange rate
- **UpgradeCap retained** — not burned; bug-fix upgrades are realistic necessity; commitment to open comms + eventual timelock
- **No testnet** — development directly on Mainnet; correctness before deployment is critical
- **RPC:** Chainstack JSON-RPC (transition bridge while Sui migrates to gRPC/GraphQL, ends mid-Oct 2026)

---

## Deploy Commands

```bash
# Frontend
vercel --prod

# Crank
fly deploy -a surge-crank

# Points worker
fly deploy -a surge-points --config points-app/fly.toml --dockerfile points-app/Dockerfile

# Check logs
fly logs -a surge-crank
fly logs -a surge-points
```

---

## Important Rules

- **Never mention any hackathon** (incl. Sui Overflow) in any content
- Live-data posts (harvest, winners) must wait for real on-chain data
- No audit exists — be upfront about this everywhere
- Reddit: no external links in comments (spam filter), project name only

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
| RPC | Sui GraphQL (`https://graphql.mainnet.sui.io/graphql`) — JSON-RPC is OFF |
| Frontend RPC | Fly.io CORS proxy `surge-rpc-proxy` → Sui GraphQL (source: `rpc-proxy/`) |
| Sui SDK | `@mysten/sui` v2 (crank, Node 22) · points worker uses plain `fetch` |
| LST | Haedal Protocol (haSUI) |

---

## Environment Variables

**Frontend (Vercel):**
- `VITE_RPC_URL` — `https://surge-rpc-proxy.fly.dev` (CORS proxy; App.jsx POSTs to `${VITE_RPC_URL}/graphql`)

**Backend (Fly.io):**
- `GQL_URL` — optional, defaults to `https://graphql.mainnet.sui.io/graphql`
- `RPC_URL` — legacy, no longer used by crank / points worker
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
├── telegram-bot/         # Telegram notification bot (⚠️ still JSON-RPC — not migrated yet)
├── rpc-proxy/            # Fly.io CORS proxy surge-rpc-proxy → Sui GraphQL
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
- **RPC:** Sui GraphQL since Oct 23 2026. Mainnet JSON-RPC was switched off (~Oct 21 2026, node v1.82); every component broke with 404 until migrated. Chainstack's plan does NOT include GraphQL (403) — use the public Mysten endpoint.

---

## Sui GraphQL — Gotchas (learned the hard way)

- **Endpoint:** `https://graphql.mainnet.sui.io/graphql`. `sui-mainnet.mystenlabs.com/graphql` is dead. No CORS for browsers → frontend goes through `surge-rpc-proxy`.
- **Types use the ORIGINAL package id.** Struct + event type filters match the type origin, not upgraded ids. V5 types/events = `0x330aa337…5fb3` (PACKAGE_TYPE_ID), not `0x4ca9…`/`0x3573…`. V6 `0xaf48…` is v1 → original = itself.
- **Single object:** `object(address){ asMoveObject{ contents{ json } } }`.
- **Owned objects:** `address(address){ objects(filter:{type}){ nodes{ address contents{ json } } } }` — nodes are already `MoveObject`, **no** `asMoveObject` (validation error).
- **Events:** `events(filter:{ type }, first/last){ nodes{ contents{ json } timestamp } }` — filter field is `type`, not `eventType`.
- **Transactions:** SDK v1 GraphQL/gRPC clients cannot resolve txs ("does not support transaction resolution"). Use `@mysten/sui` ≥ 2.x (`SuiGraphQLClient`), which needs Node ≥ 22. v2 is ESM-only but `require()` works on Node 22.
- **Pre-deploy checks (read-only, no key):** `cd scripts && node gql-check.js` (crank) · `node points-check.js` (points worker).

---

## Deploy Commands

```bash
# Frontend
vercel --prod

# Crank
fly deploy -a surge-crank

# Points worker (deploys scripts/points-worker.js — points-app/points-worker.js is a stale copy)
fly deploy -a surge-points --config points-app/fly.toml --dockerfile points-app/Dockerfile

# RPC proxy (frontend → Sui GraphQL)
cd rpc-proxy && fly deploy -a surge-rpc-proxy

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

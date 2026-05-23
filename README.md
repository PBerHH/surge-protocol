# 🌊 Surge Protocol

**Prize-linked staking on Sui. Your principal is always safe — only the yield wins prizes.**

Live: [surge-protocol-chi.vercel.app](https://surge-protocol-chi.vercel.app)

---

## What is Surge?

Surge is a no-loss lottery built on Sui. Users stake SUI, earn yield, and that yield funds prize pools. Your principal is never at risk — you can always withdraw everything you put in.

Think of it like a savings account where instead of earning interest, you get lottery tickets.

---

## How it works

1. **Stake SUI** — deposit into the Surge vault (minimum 1 SUI)
2. **Earn tickets** — the more you stake, the more draw tickets you get
3. **Yield funds prizes** — ~1.5% APY yield is harvested and split into prize pools
4. **Draws happen automatically** — the Crank triggers draws on-chain
5. **Winners are paid** — directly to their wallet, no claiming needed

### Draw schedule

| Draw | Frequency | Winners | Pool share |
|------|-----------|---------|------------|
| ⚡ Spark | Every 6 hours | 3 | 20% |
| 🔄 Pulse | Weekly | 4 | 30% |
| 🌊 Surge | Monthly | 1 jackpot | 50% |

### Ticket gates

| Draw | Minimum stake |
|------|--------------|
| ⚡ Spark | 10 SUI |
| 🔄 Pulse | 50 SUI |
| 🌊 Surge | 200 SUI |

---

## Security

Three critical vulnerabilities were identified and fixed:

### Fix 1: VRF Manipulation
**Problem:** `vrf_bytes` came from the Crank (Node.js `randomBytes`) — the operator could predict winners.  
**Fix:** Replaced with `sui::random::Random` — on-chain verifiable randomness that no one can manipulate.

### Fix 2: Unprotected Prize Claims
**Problem:** `award_spark/pulse/surge()` were `public` without any access control — anyone could drain the prize pools.  
**Fix:** All award functions now require `PoolAdminCap`.

### Fix 3: Yield Theft
**Problem:** `harvest_yield()` was `public` — anyone could steal accumulated yield.  
**Fix:** `harvest_yield()` now requires `VaultAdminCap`.

### Security badges
- 🔐 **On-chain VRF** — `sui::random`, not operator-controlled
- 🛡️ **AdminCap Protected** — no public drain vectors
- 🔒 **Principal Safe** — user funds never at risk
- ⛓️ **Open Source** — fully verifiable on GitHub

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Frontend (React)                │
│         surge-protocol-chi.vercel.app            │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│              Sui Mainnet Contracts               │
│                                                  │
│  stake_vault    ──→  reward_pool                 │
│  (user funds)        (prize pools)               │
│       │                    │                     │
│       └──→  draw_manager ◄─┘                    │
│             (sui::random VRF)                    │
│                    │                             │
│             loyalty_tracker                      │
│             ticket_engine                        │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│              Crank (Node.js)                     │
│              Fly.io — surge-crank                │
│  - Injects simulated yield every minute          │
│  - Harvests yield → reward pool                  │
│  - Registers tickets for stakers                 │
│  - Triggers draws when due                       │
└─────────────────────────────────────────────────┘
```

---

## Contract addresses (Mainnet)

| Object | Address |
|--------|---------|
| Package | `0x330aa337772418f68117556dce74034063f11a8de68f60a99acc9a5ee62f5fb3` |
| Vault | `0x4bca5b44fcbb3cf79f3586c3ff4e4d3494975f1d8434de067a9a95b792150992` |
| DrawState | `0xee9f68a29ab16442600a9e12426431b240aed97cdf5108f44d8325401cc25fb0` |
| RewardPool | `0xacf68b636a55c96a8269ab0b66d735a7bbfadf058821cc17f97bc32d49d6968f` |

Upgrade policy: `incompatible` — full flexibility for future improvements.  
UpgradeCap: `0x5921d677eb94f7020c04eeb37bc4299b5ec00d8bd1ba47d656c6055a93a1c32f`

---

## Tech stack

- **Smart contracts** — Sui Move (Mainnet)
- **Randomness** — `sui::random` (on-chain VRF)
- **Frontend** — React + Vite + @mysten/dapp-kit
- **Crank** — Node.js on Fly.io
- **Hosting** — Vercel

---

## Running locally

### Contracts
```bash
cd surge-protocol
sui client publish --gas-budget 200000000
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

- [ ] Migrate function UI (one-click contract migration)
- [ ] Duplicate winner prevention in draws
- [ ] On-chain ticket calculation via `ticket_engine`
- [ ] Formal security audit
- [ ] UpgradeCap timelock for decentralization
- [ ] Multi-validator support

---

## Built for Sui Overflow 2026

Surge Protocol was built for the Sui Overflow 2026 hackathon.


## Fee Structure

Surge Protocol operates with a transparent 2% fee on staking yield:

- **98% → Prize Pools** - Distributed to winners via Spark, Pulse, and Surge draws
- **1% → Operations** - Covers crank automation, infrastructure, and gas costs
- **1% → Marketing Fund** - Used for partnerships, campaigns, and community growth

**Marketing Wallet (transparent):**0x1de8cef32b6324c2ade5659caa86db8e0dc3c1fd7a76dda17ff4c8de330f5f95
All fees are automatically split on-chain during yield harvests. You can verify transactions on [Sui Explorer](https://suiscan.xyz).


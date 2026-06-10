# 🌊 Surge Protocol

**Prize-linked staking on Sui. Your principal is always safe — only the yield wins prizes.**

Live: [surgeonsui.com](https://surgeonsui.com)

---

## What is Surge?

Surge is a no-loss lottery built on Sui. Users stake SUI, earn real validator yield, and that yield funds prize pools. Your principal is never at risk — you can always withdraw everything you put in.

Think of it like a savings account where instead of earning interest, you get lottery tickets.

---

## How it works

1. **Stake SUI** — deposit into the Surge vault (minimum 1 SUI), delegated to Triton One
2. **Earn tickets** — Spark gives 1 ticket per wallet (equal odds); Pulse and Surge scale with stake (√stake × loyalty)
3. **Yield funds prizes** — ~1.5% APY validator yield is harvested each epoch and split into prize pools
4. **Draws happen automatically** — a team-operated crank triggers draws on-chain
5. **Winners are paid** — directly to their wallet, no claiming needed

### Draw schedule

| Draw | Frequency | Winners | Pool share* |
|------|-----------|---------|-------------|
| ⚡ Spark | Every 6 hours | 3 | 20% of yield |
| 🔄 Pulse | Weekly | 4 | 30% of yield |
| 🌊 Surge | Monthly | 1 jackpot | ~48% of yield |

\* A 2% protocol fee is taken first; the remaining 98% is split across the pools. The fee is carved out of the Surge share, so Surge receives ~48% of gross yield rather than a round 50%.

### Ticket gates

| Draw | Minimum stake |
|------|--------------|
| ⚡ Spark | 1 SUI |
| 🔄 Pulse | 10 SUI |
| 🌊 Surge | 50 SUI |

---

## Security

Three vulnerabilities found during development were fixed before mainnet:

### Fix 1: VRF manipulation
**Problem:** `vrf_bytes` came from the crank (Node.js `randomBytes`) — the operator could predict winners.
**Fix:** Replaced with `sui::random::Random` — the random value is generated on-chain and cannot be predicted in advance.

### Fix 2: Unprotected prize claims
**Problem:** `award_spark/pulse/surge()` were `public` without access control — anyone could drain the prize pools.
**Fix:** All award functions now require `PoolAdminCap`.

### Fix 3: Yield theft
**Problem:** `harvest_yield()` was `public` — anyone could take accumulated yield.
**Fix:** `harvest_yield()` / `claim_rewards()` now require `VaultAdminCap`.

### Trust model (current — read this)

Surge is **not yet trustless**, and we'd rather be upfront than oversell it:

- **Draws are triggered by a team-operated crank** (holds `AdminCap`). The randomness itself is on-chain and unpredictable, but the operator controls *when* a draw runs.
- **Ticket counts are currently computed off-chain by the crank** and registered on-chain. The contract does not yet derive ticket counts from on-chain stake, so fair allocation currently depends on the operator running honest code.
- **Admin capabilities (draw / pool / vault) are held by the team.** A single key currently controls them.
- **The team holds an UpgradeCap** and can ship contract upgrades. Existing struct layouts and public function signatures are preserved, but upgrades can change function logic. No timelock yet.

What's **guaranteed by the contract today:** principal is paid only from staked funds, award/harvest functions are capability-gated (no public drain), and the random value cannot be predicted ahead of time.

On the roadmap to reduce trust: on-chain ticket derivation, permissionless draw triggering, capability separation, and an UpgradeCap timelock (see Roadmap).

### Badges
- 🔐 **On-chain randomness** — `sui::random`, not operator-supplied
- 🛡️ **Capability-gated** — no public drain vectors
- 🔒 **Principal safe** — user funds never at risk
- ⛓️ **Open source** — verifiable on GitHub

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Frontend (React)                │
│                  surgeonsui.com                  │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│              Sui Mainnet Contracts               │
│                                                  │
│  stake_vault    ──→  reward_pool                 │
│  (Triton stake)      (prize pools)               │
│       │                    │                     │
│       └──→  draw_manager ◄─┘                     │
│             (sui::random)                        │
│                    │                             │
│             loyalty_tracker                      │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│              Crank (Node.js)                     │
│              Fly.io — surge-crank                │
│  - Harvests real Triton validator yield/epoch    │
│  - Routes yield → reward pool (2% fee on-chain)  │
│  - Registers tickets for stakers                 │
│  - Triggers draws when due                       │
└─────────────────────────────────────────────────┘
```

---

## Contract addresses (Mainnet)

| Object | Address |
|--------|---------|
| Package (latest, for calls) | `0x4ca98688e6cdf7fb6b73cc01d5ebbf77f947a02f5da570afd2f14bf155942b0c` |
| Package (original-id) | `0x330aa337772418f68117556dce74034063f11a8de68f60a99acc9a5ee62f5fb3` |
| StakingVault (V5, real staking) | `0x50d8b86e95c8c75892e8cc7caa39a81604de123baf1528cf1c9203d8ab702562` |
| Legacy Vault (drain-only) | `0x4bca5b44fcbb3cf79f3586c3ff4e4d3494975f1d8434de067a9a95b792150992` |
| DrawState | `0xee9f68a29ab16442600a9e12426431b240aed97cdf5108f44d8325401cc25fb0` |
| RewardPool | `0xacf68b636a55c96a8269ab0b66d735a7bbfadf058821cc17f97bc32d49d6968f` |

> **Note:** the repo's `Published.toml` currently points to a separate, abandoned publish (`0x53a50af7…`, v1). The live contract lineage is the original-id above. `Published.toml` should be regenerated against the live deployment.

Upgrade policy: team-held `UpgradeCap`, compatible-style upgrades (logic can change; struct layouts and public signatures preserved). A timelock is planned — see Roadmap.

---

## Tech stack

- **Smart contracts** — Sui Move (Mainnet)
- **Randomness** — `sui::random` (on-chain)
- **Staking** — native delegation to Triton One validator
- **Frontend** — React + Vite + @mysten/dapp-kit
- **Crank** — Node.js on Fly.io
- **Hosting** — Vercel (surgeonsui.com)

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

- [ ] On-chain ticket calculation (derive ticket counts from on-chain stake — removes off-chain trust)
- [ ] Permissionless draw triggering (anyone can trigger a due draw)
- [ ] Capability separation / multisig for admin caps
- [ ] UpgradeCap timelock for decentralization
- [ ] Duplicate-winner prevention in draws
- [ ] Formal third-party security audit
- [ ] Multi-validator support

---

## Built for Sui Overflow 2026

Surge Protocol was built for the Sui Overflow 2026 hackathon.

## v6 architecture (in development)

See [docs/v6-architecture.md](docs/v6-architecture.md) — LST-based yield engine, testnet-validated, audit planned before mainnet.

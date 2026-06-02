require('dotenv/config');

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { fromB64 } = require('@mysten/sui/utils');
const fs = require('fs');
const os = require('os');

// ── Env ────────────────────────────────────────────────────────────────────────

const NETWORK          = process.env.NETWORK          ?? 'mainnet';
const PACKAGE_ID       = process.env.PACKAGE_ID       ?? ''; // latest published-at — moveCalls
const PACKAGE_TYPE_ID  = process.env.PACKAGE_TYPE_ID  ?? ''; // original-id — legacy event queries
const STAKING_VAULT    = process.env.STAKING_VAULT    ?? ''; // real staking vault (V5+)
const VAULT            = process.env.VAULT            ?? ''; // legacy idle vault
const DRAW_STATE       = process.env.DRAW_STATE       ?? '';
const REWARD_POOL      = process.env.REWARD_POOL      ?? '';
const ADMIN_CAP_DRAW   = process.env.ADMIN_CAP_DRAW   ?? '';
const POOL_ADMIN_CAP   = process.env.POOL_ADMIN_CAP   ?? '';
const VAULT_ADMIN_CAP  = process.env.VAULT_ADMIN_CAP  ?? '';

const POLL_MS          = 21_600_000; // 6 hours

// Fixed Sui system objects
const SUI_SYSTEM = '0x0000000000000000000000000000000000000000000000000000000000000005';
const SUI_CLOCK  = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_RANDOM = '0x0000000000000000000000000000000000000000000000000000000000000008';

// ── Keypair ───────────────────────────────────────────────────────────────────

function loadKeypair() {
  if (process.env.PRIVATE_KEY_B64) {
    const raw = fromB64(process.env.PRIVATE_KEY_B64);
    const secret = raw.length === 33 ? raw.slice(1) : raw;
    return Ed25519Keypair.fromSecretKey(secret);
  }
  const keystorePath = `${os.homedir()}/.sui/sui_config/sui.keystore`;
  const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf-8'));
  const raw = fromB64(keystore[0]);
  const secret = raw.length === 33 ? raw.slice(1) : raw;
  return Ed25519Keypair.fromSecretKey(secret);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = n => (Number(BigInt(n ?? 0)) / 1e9).toFixed(4);

function formatCountdown(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function balVal(field) {
  return BigInt(field?.fields?.value ?? field ?? 0);
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchStakingVault(client) {
  const obj = await client.getObject({ id: STAKING_VAULT, options: { showContent: true } });
  if (obj.data?.content?.dataType !== 'moveObject') return null;
  const f = obj.data.content.fields;
  return {
    totalPrincipal:    BigInt(f.total_principal    ?? 0),
    pendingRewards:    balVal(f.pending_rewards),
    liquidPrincipal:   balVal(f.liquid_principal),
    pendingUnstake:    BigInt(f.pending_unstake_mist ?? 0),
  };
}

async function fetchLegacyVault(client) {
  if (!VAULT) return null;
  try {
    const obj = await client.getObject({ id: VAULT, options: { showContent: true } });
    if (obj.data?.content?.dataType !== 'moveObject') return null;
    const f = obj.data.content.fields;
    return {
      totalStaked:  BigInt(f.total_staked ?? 0),
      pendingYield: BigInt(f.pending_yield ?? 0),
    };
  } catch { return null; }
}

async function fetchDrawState(client) {
  const obj = await client.getObject({ id: DRAW_STATE, options: { showContent: true } });
  if (obj.data?.content?.dataType !== 'moveObject') throw new Error('DrawState not found');
  const f = obj.data.content.fields;
  return {
    nextSparkMs: BigInt(f.next_spark_ms ?? 0),
    nextPulseMs: BigInt(f.next_pulse_ms ?? 0),
    nextSurgeMs: BigInt(f.next_surge_ms ?? 0),
  };
}

async function fetchPoolBalances(client) {
  const obj = await client.getObject({ id: REWARD_POOL, options: { showContent: true } });
  if (obj.data?.content?.dataType !== 'moveObject') return null;
  const f = obj.data.content.fields;
  return {
    spark: balVal(f.spark_pool),
    pulse: balVal(f.pulse_pool),
    surge: balVal(f.surge_pool),
  };
}

/// Query Staked events from the new StakingVault (V5+V6).
async function fetchStakingStakers(client) {
  try {
    const PACKAGE_V5 = '0x35732358f2e0a683fe2014f5781b8ab67146d40ce63a76ac0a30ac52fdb7b2bb';
    const [e1, e2] = await Promise.all([
      client.queryEvents({ query: { MoveEventType: `${PACKAGE_V5}::stake_vault::Staked` }, limit: 100 }),
      client.queryEvents({ query: { MoveEventType: `${PACKAGE_ID}::stake_vault::Staked` }, limit: 100 }),
    ]);
    const events = { data: [...e1.data, ...e2.data] };
    console.log(`  📋 Found ${events.data.length} stake events (V5+V6)`);
    const stakers = {};
    for (const ev of events.data) {
      const fields = ev.parsedJson;
      if (fields?.staker && fields?.amount_mist) {
        const addr = fields.staker;
        const amt = BigInt(fields.amount_mist);
        stakers[addr] = (stakers[addr] ?? 0n) + amt;
        console.log(`  👤 Staker: ${addr.slice(0, 10)}... ${(Number(amt) / 1e9).toFixed(2)} SUI`);
      }
    }
    return stakers;
  } catch (e) {
    console.error('  ⚠️ Could not fetch staking stakers:', e.message);
    return {};
  }
}

// ── Real Harvest (V5) ─────────────────────────────────────────────────────────

/// 3-step PTB:
///   1. harvest(staking_vault, vault_admin_cap, sui_system) — unstake, route rewards, re-stake
///   2. claim_rewards(staking_vault, vault_admin_cap) → Coin<SUI>
///   3. deposit_yield(reward_pool, coin, pool_admin_cap) — on-chain fee split + pool distribution
///
/// Fee split (2%) is handled entirely on-chain by deposit_yield.
/// No off-chain fee deduction needed.
async function harvestStaking(client, keypair, pendingRewards) {
  console.log(`  🌾 Harvesting real Triton yield — pending: ${fmt(pendingRewards)} SUI`);

  try {
    const tx = new Transaction();
    tx.setGasPrice(1000);

    // Step 1: withdraw all delegations, separate rewards, re-stake principal
    tx.moveCall({
      target: `${PACKAGE_ID}::stake_vault::harvest`,
      arguments: [
        tx.object(STAKING_VAULT),
        tx.object(VAULT_ADMIN_CAP),
        tx.object(SUI_SYSTEM),
      ],
    });

    // Step 2: pull the rewards coin out
    const rewardsCoin = tx.moveCall({
      target: `${PACKAGE_ID}::stake_vault::claim_rewards`,
      arguments: [
        tx.object(STAKING_VAULT),
        tx.object(VAULT_ADMIN_CAP),
      ],
    });

    // Step 3: distribute to pools (on-chain 2% fee split inside deposit_yield)
    tx.moveCall({
      target: `${PACKAGE_ID}::reward_pool::deposit_yield`,
      arguments: [
        tx.object(REWARD_POOL),
        rewardsCoin,
        tx.object(POOL_ADMIN_CAP),
      ],
    });

    const r = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true },
    });

    if (r.effects?.status?.status === 'success') {
      console.log(`  ✅ Harvest complete — tx: ${r.digest}`);
      for (const ev of r.events ?? []) {
        if (ev.type?.includes('Harvested')) {
          const f = ev.parsedJson;
          console.log(`     rewards: ${fmt(f?.rewards_mist)} SUI · principal: ${fmt(f?.total_principal)} SUI`);
        }
        if (ev.type?.includes('YieldDeposited')) {
          const f = ev.parsedJson;
          console.log(`     → Spark: ${fmt(f?.spark_mist)} · Pulse: ${fmt(f?.pulse_mist)} · Surge: ${fmt(f?.surge_mist)} SUI`);
        }
      }
    } else {
      console.error('  ❌ Harvest failed:', r.effects?.status?.error);
    }
  } catch (e) {
    console.error('  ❌ Harvest error:', e.message);
  }
}

// ── Draw Registration + Trigger ───────────────────────────────────────────────

async function registerAndDraw(client, keypair, drawType, stakers, balance) {
  const names = ['Spark', 'Pulse', 'Surge'];
  const registerFn = ['register_spark_tickets', 'register_pulse_tickets', 'register_surge_tickets'];
  const triggerFn  = ['trigger_spark',          'trigger_pulse',          'trigger_surge'];
  const name = names[drawType];

  if (Object.keys(stakers).length === 0) {
    console.log(`  ⚠️ ${name}: no stakers found — skipping draw`);
    return;
  }

  console.log(`  🎲 ${name} draw — registering tickets & triggering...`);

  try {
    const tx = new Transaction();
    tx.setGasPrice(1000);

    for (const [addr, amtMist] of Object.entries(stakers)) {
      const suiAmt = Number(amtMist) / 1e9;
      let tickets;
      if (drawType === 0) {
        tickets = suiAmt >= 1 ? 1 : 0; // Spark: equal odds
      } else if (drawType === 1) {
        tickets = suiAmt < 10 ? 0 : Math.max(1, Math.floor(Math.sqrt(suiAmt))); // Pulse: sqrt
      } else {
        tickets = suiAmt < 50 ? 0 : Math.max(1, Math.floor(Math.sqrt(suiAmt))); // Surge: sqrt
      }

      if (tickets > 0) {
        tx.moveCall({
          target: `${PACKAGE_ID}::draw_manager::${registerFn[drawType]}`,
          arguments: [
            tx.object(DRAW_STATE),
            tx.pure.address(addr),
            tx.pure.u64(tickets),
            tx.object(ADMIN_CAP_DRAW),
          ],
        });
      }
    }

    tx.moveCall({
      target: `${PACKAGE_ID}::draw_manager::${triggerFn[drawType]}`,
      arguments: [
        tx.object(DRAW_STATE),
        tx.object(REWARD_POOL),
        tx.object(POOL_ADMIN_CAP),
        tx.object(SUI_RANDOM),
        tx.object(SUI_CLOCK),
        tx.object(ADMIN_CAP_DRAW),
      ],
    });

    const r = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true },
    });

    if (r.effects?.status?.status === 'success') {
      console.log(`  ✅ ${name} draw complete — tx: ${r.digest}`);
      for (const ev of r.events ?? []) {
        if (ev.type?.includes('PrizeAwarded')) {
          const f = ev.parsedJson;
          console.log(`  🏆 Winner: ${f?.winner} → ${fmt(f?.amount_mist)} SUI`);
        }
      }
    } else {
      console.error(`  ❌ ${name} draw failed:`, r.effects?.status?.error);
    }
  } catch (e) {
    console.error(`  ❌ ${name} draw error:`, e.message);
  }
}

// ── Tick ──────────────────────────────────────────────────────────────────────

async function tick(client, keypair) {
  const now = BigInt(Date.now());
  console.log(`\n⏰ [${new Date().toISOString()}] Tick`);

  // StakingVault (real Triton)
  const sv = await fetchStakingVault(client);
  if (sv) {
    console.log(`  🏦 StakingVault — staked: ${fmt(sv.totalPrincipal)} SUI · rewards: ${fmt(sv.pendingRewards)} SUI · liquid: ${fmt(sv.liquidPrincipal)} SUI`);
  } else {
    console.error('  ❌ StakingVault not found');
    return;
  }

  // Legacy vault — harvest pending_yield into reward pool
  const lv = await fetchLegacyVault(client);
  if (lv && lv.pendingYield > 0n) {
    console.log(`  🏛️  LegacyVault — pending yield: ${fmt(lv.pendingYield)} SUI — harvesting...`);
    try {
      const tx = new Transaction();
      const [coin] = tx.moveCall({
        target: `${PACKAGE_ID}::stake_vault::harvest_yield`,
        arguments: [tx.object(VAULT), tx.object(VAULT_ADMIN_CAP)],
      });
      tx.moveCall({
        target: `${PACKAGE_ID}::reward_pool::deposit_yield`,
        arguments: [tx.object(REWARD_POOL), coin, tx.object(POOL_ADMIN_CAP)],
      });
      const res = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx });
      console.log(`  ✅ Legacy harvest — tx: ${res.digest}`);
    } catch (e) {
      console.error('  ⚠️ Legacy harvest failed:', e.message);
    }
  } else if (lv && lv.totalStaked > 0n) {
    console.log(`  🏛️  LegacyVault — staked: ${fmt(lv.totalStaked)} SUI (no pending yield)`);
  }

  // Harvest real Triton rewards every tick (safe even if rewards = 0)
  if (sv.totalPrincipal > 0n) {
    await harvestStaking(client, keypair, sv.pendingRewards);
  }

  // Pool balances
  const balances = await fetchPoolBalances(client);
  if (balances) {
    console.log(`  💰 Pools — Spark: ${fmt(balances.spark)} · Pulse: ${fmt(balances.pulse)} · Surge: ${fmt(balances.surge)} SUI`);
  }

  // Draw times + stakers
  const drawTimes = await fetchDrawState(client);
  const stakers = await fetchStakingStakers(client);

  const checks = [
    { type: 0, name: 'Spark', icon: '⚡', next: drawTimes.nextSparkMs, bal: balances?.spark },
    { type: 1, name: 'Pulse', icon: '🔄', next: drawTimes.nextPulseMs, bal: balances?.pulse },
    { type: 2, name: 'Surge', icon: '🌊', next: drawTimes.nextSurgeMs, bal: balances?.surge },
  ];

  for (const c of checks) {
    if (now >= c.next) {
      if (c.bal && c.bal > 0n) {
        await registerAndDraw(client, keypair, c.type, stakers, c.bal);
        await new Promise(r => setTimeout(r, 3000));
      } else {
        console.log(`  ${c.icon} ${c.name}: due but pool empty — skipping`);
      }
    } else {
      const sec = Number(c.next - now) / 1000;
      console.log(`  ${c.icon} ${c.name}: next in ${formatCountdown(sec)}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌊 Surge Crank v6 — Real Triton Staking');
  console.log(`   Network:  ${NETWORK}`);
  console.log(`   Package:  ${PACKAGE_ID.slice(0, 10)}...`);
  console.log(`   Vault:    ${STAKING_VAULT.slice(0, 10)}...`);
  console.log(`   Interval: ${POLL_MS / 1000 / 60} minutes`);

  const required = { PACKAGE_ID, STAKING_VAULT, DRAW_STATE, REWARD_POOL, ADMIN_CAP_DRAW, POOL_ADMIN_CAP, VAULT_ADMIN_CAP };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error('❌ Missing env vars:', missing.join(', '));
    process.exit(1);
  }

  const client  = new SuiClient({ url: getFullnodeUrl(NETWORK) });
  const keypair = loadKeypair();
  console.log(`   Address:  ${keypair.getPublicKey().toSuiAddress()}\n`);

  await tick(client, keypair);
  setInterval(() => tick(client, keypair).catch(console.error), POLL_MS);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

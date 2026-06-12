require('dotenv/config');

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { fromB64 } = require('@mysten/sui/utils');
const fs = require('fs');
const os = require('os');

// ── Env ────────────────────────────────────────────────────────────────────────

const NETWORK          = process.env.NETWORK          ?? 'mainnet';
const PACKAGE_ID       = process.env.PACKAGE_ID       ?? ''; // V5 latest published-at — moveCalls
const STAKING_VAULT    = process.env.STAKING_VAULT    ?? ''; // V5 vault (winding down)
const VAULT            = process.env.VAULT            ?? ''; // legacy idle vault
const DRAW_STATE       = process.env.DRAW_STATE       ?? '';
const REWARD_POOL      = process.env.REWARD_POOL      ?? '';
const ADMIN_CAP_DRAW   = process.env.ADMIN_CAP_DRAW   ?? '';
const POOL_ADMIN_CAP   = process.env.POOL_ADMIN_CAP   ?? '';
const VAULT_ADMIN_CAP  = process.env.VAULT_ADMIN_CAP  ?? '';

// ── V6 (haSUI engine) ──────────────────────────────────────────────────────────
// Defaults are the live mainnet deployment; override via env if redeployed.

const V6_PACKAGE   = process.env.V6_PACKAGE   ?? '0xaf489faa2a23db82265e25c833f2cf9b985eb0a8d4acde121c7e14c111c3b62e';
const V6_VAULT     = process.env.V6_VAULT     ?? '0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5';
const V6_ADMIN_CAP = process.env.V6_ADMIN_CAP ?? ''; // VaultV6AdminCap — must be owned by the crank wallet

// Haedal mainnet (verified via sui_getNormalizedMoveModule):
const HAEDAL_PKG_ORIG   = process.env.HAEDAL_PKG_ORIG   ?? '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d';
const HAEDAL_PKG_LATEST = process.env.HAEDAL_PKG_LATEST ?? '0x126e4cfb051cad744706df590ec399e8c02b6feae195c35b8b496280d5442a62';
const HAEDAL_STAKING    = process.env.HAEDAL_STAKING    ?? '0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca';

const RATE_SCALE        = 1_000_000n;
const MIN_HARVEST_HA_V6 = 10_000_000n; // 0.01 haSUI — must match the contract constant

const POLL_MS          = 21_600_000; // 6 hours
const MIN_POOL_MIST    = 1_000_000n; // 0.001 SUI — skip draws on dust pools
const HARVEST_EVERY_EPOCHS = Number(process.env.HARVEST_EVERY_EPOCHS ?? 7); // V5 only

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

function gasCost(effects) {
  const g = effects?.gasUsed ?? {};
  return BigInt(g.computationCost ?? 0) + BigInt(g.storageCost ?? 0) - BigInt(g.storageRebate ?? 0);
}

// ── V5 Fetchers (wind-down) ───────────────────────────────────────────────────

async function fetchStakingVault(client) {
  const obj = await client.getObject({ id: STAKING_VAULT, options: { showContent: true } });
  if (obj.data?.content?.dataType !== 'moveObject') return null;
  const f = obj.data.content.fields;
  const stakes = f.stakes ?? [];
  let activationEpoch = 0;
  for (const s of stakes) {
    const sf = s.fields ?? s;
    const a = Number(sf.stake_activation_epoch ?? 0);
    if (a > activationEpoch) activationEpoch = a;
  }
  return {
    totalPrincipal:  BigInt(f.total_principal ?? 0),
    pendingRewards:  balVal(f.pending_rewards),
    liquidPrincipal: balVal(f.liquid_principal),
    pendingUnstake:  BigInt(f.pending_unstake_mist ?? 0),
    activationEpoch,
  };
}

async function fetchEpoch(client) {
  const s = await client.getLatestSuiSystemState();
  return Number(s.epoch ?? 0);
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

/// V5 stakers from Staked events. Only counted while V5 still holds principal —
/// once the wind-down completes (total_principal == 0) these are ghosts and are
/// skipped entirely in tick().
async function fetchV5Stakers(client) {
  try {
    const PACKAGE_V5 = '0x35732358f2e0a683fe2014f5781b8ab67146d40ce63a76ac0a30ac52fdb7b2bb';
    const [e1, e2] = await Promise.all([
      client.queryEvents({ query: { MoveEventType: `${PACKAGE_V5}::stake_vault::Staked` }, limit: 100 }),
      client.queryEvents({ query: { MoveEventType: `${PACKAGE_ID}::stake_vault::Staked` }, limit: 100 }),
    ]);
    const stakers = {};
    for (const ev of [...e1.data, ...e2.data]) {
      const f = ev.parsedJson;
      if (f?.staker && f?.amount_mist) {
        stakers[f.staker] = (stakers[f.staker] ?? 0n) + BigInt(f.amount_mist);
      }
    }
    return stakers;
  } catch (e) {
    console.error('  ⚠️ Could not fetch V5 stakers:', e.message);
    return {};
  }
}

// ── V6 Fetchers ───────────────────────────────────────────────────────────────

async function fetchV6Vault(client) {
  const obj = await client.getObject({ id: V6_VAULT, options: { showContent: true } });
  if (obj.data?.content?.dataType !== 'moveObject') return null;
  const f = obj.data.content.fields;
  return {
    haBalance:      balVal(f.ha_balance),
    totalPrincipal: BigInt(f.total_principal ?? 0),
    pendingRewards: balVal(f.pending_rewards),
  };
}

/// haSUI→SUI exchange rate (×1e6) via read-only devInspect — costs no gas.
async function fetchHaRate(client, sender) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${HAEDAL_PKG_ORIG}::staking::get_exchange_rate`,
    arguments: [tx.object(HAEDAL_STAKING)],
  });
  const r = await client.devInspectTransactionBlock({ sender, transactionBlock: tx });
  const bytes = r?.results?.[0]?.returnValues?.[0]?.[0];
  if (!bytes) throw new Error('rate devInspect returned no value');
  let v = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
  return v; // u64, little-endian decoded
}

/// V6 stakers = net of StakedV6 − UnstakedV6 per owner.
async function fetchV6Stakers(client) {
  try {
    const [stakedEv, unstakedEv] = await Promise.all([
      client.queryEvents({ query: { MoveEventType: `${V6_PACKAGE}::stake_vault_v6::StakedV6` }, limit: 200 }),
      client.queryEvents({ query: { MoveEventType: `${V6_PACKAGE}::stake_vault_v6::UnstakedV6` }, limit: 200 }),
    ]);
    const stakers = {};
    for (const ev of stakedEv.data) {
      const f = ev.parsedJson;
      if (f?.owner && f?.principal_mist) {
        stakers[f.owner] = (stakers[f.owner] ?? 0n) + BigInt(f.principal_mist);
      }
    }
    for (const ev of unstakedEv.data) {
      const f = ev.parsedJson;
      if (f?.owner && f?.principal_mist) {
        stakers[f.owner] = (stakers[f.owner] ?? 0n) - BigInt(f.principal_mist);
      }
    }
    for (const a of Object.keys(stakers)) {
      if (stakers[a] <= 0n) delete stakers[a];
    }
    return stakers;
  } catch (e) {
    console.error('  ⚠️ Could not fetch V6 stakers:', e.message);
    return {};
  }
}

// ── V6 Harvest (yield only — principal coverage enforced on-chain) ────────────

async function harvestV6(client, keypair) {
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${V6_PACKAGE}::stake_vault_v6::harvest`,
      arguments: [
        tx.object(V6_VAULT),
        tx.object(HAEDAL_STAKING),
        tx.object(V6_ADMIN_CAP),
        tx.object(SUI_CLOCK),
      ],
    });
    const r = await client.signAndExecuteTransaction({
      signer: keypair, transaction: tx,
      options: { showEffects: true, showEvents: true },
    });
    if (r.effects?.status?.status === 'success') {
      console.log(`  ✅ V6 harvest started — tx: ${r.digest}`);
      for (const ev of r.events ?? []) {
        if (ev.type?.includes('HarvestedV6')) {
          const f = ev.parsedJson;
          console.log(`     surplus: ${fmt(f?.surplus_ha)} haSUI @ rate ${Number(f?.rate_scaled) / 1e6} — redemption ticket → crank wallet (claims next tick after 1–2 epochs)`);
        }
      }
    } else {
      console.error('  ❌ V6 harvest failed:', r.effects?.status?.error);
    }
  } catch (e) {
    console.error('  ❌ V6 harvest error:', e.message);
  }
}

// ── V6 Ticket Claiming → Prize Pools ──────────────────────────────────────────
//
// harvest() sends a Haedal UnstakeTicket to the crank wallet. After 1–2 epochs
// claim_v2 redeems it for SUI (sent to the crank wallet by Haedal — it's an
// `entry` fun, so the coin can't be captured in the same PTB). We measure the
// claimed amount from the tx balance change (+ gas back-out) and immediately
// deposit it into the reward pool, where the on-chain 2% fee split applies.
// Only yield ever travels this path — principal never touches the crank.

async function claimMaturedTickets(client, keypair, crankAddr) {
  let tickets;
  try {
    tickets = await client.getOwnedObjects({
      owner: crankAddr,
      filter: { StructType: `${HAEDAL_PKG_ORIG}::staking::UnstakeTicket` },
      options: { showContent: true },
    });
  } catch (e) {
    console.error('  ⚠️ Ticket lookup failed:', e.message);
    return;
  }
  const list = tickets?.data ?? [];
  if (list.length === 0) return;
  console.log(`  🎫 ${list.length} Haedal unstake ticket(s) held — attempting claims...`);

  for (const t of list) {
    const id = t.data?.objectId;
    if (!id) continue;
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${HAEDAL_PKG_LATEST}::interface::claim_v2`,
        arguments: [tx.object(SUI_SYSTEM), tx.object(HAEDAL_STAKING), tx.object(id)],
      });
      const r = await client.signAndExecuteTransaction({
        signer: keypair, transaction: tx,
        options: { showEffects: true, showBalanceChanges: true },
      });
      if (r.effects?.status?.status !== 'success') {
        const err = r.effects?.status?.error ?? '';
        if (err.includes('6)')) {
          console.log(`     ⏳ Ticket ${id.slice(0, 10)}… not matured yet — retrying next tick`);
        } else {
          console.error(`     ❌ Claim failed for ${id.slice(0, 10)}…:`, err);
        }
        continue;
      }
      // claimed = net SUI delta + gas we paid in this tx
      let net = 0n;
      for (const bc of r.balanceChanges ?? []) {
        if (bc.coinType === '0x2::sui::SUI' && bc.owner?.AddressOwner === crankAddr) {
          net += BigInt(bc.amount);
        }
      }
      const claimed = net + gasCost(r.effects);
      console.log(`     ✅ Claimed ${fmt(claimed)} SUI — tx: ${r.digest}`);
      if (claimed > 0n) await depositYield(client, keypair, claimed);
    } catch (e) {
      console.error(`     ❌ Claim error for ${id.slice(0, 10)}…:`, e.message);
    }
    await new Promise(res => setTimeout(res, 2000));
  }
}

async function depositYield(client, keypair, amountMist) {
  try {
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
    tx.moveCall({
      target: `${PACKAGE_ID}::reward_pool::deposit_yield`,
      arguments: [tx.object(REWARD_POOL), coin, tx.object(POOL_ADMIN_CAP)],
    });
    const r = await client.signAndExecuteTransaction({
      signer: keypair, transaction: tx,
      options: { showEffects: true, showEvents: true },
    });
    if (r.effects?.status?.status === 'success') {
      console.log(`     💰 Yield → pools — tx: ${r.digest}`);
      for (const ev of r.events ?? []) {
        if (ev.type?.includes('YieldDeposited')) {
          const f = ev.parsedJson;
          console.log(`        Spark: ${fmt(f?.spark_mist)} · Pulse: ${fmt(f?.pulse_mist)} · Surge: ${fmt(f?.surge_mist)} SUI`);
        }
      }
    } else {
      console.error('     ❌ deposit_yield failed:', r.effects?.status?.error);
    }
  } catch (e) {
    console.error('     ❌ deposit_yield error:', e.message);
  }
}

// ── V5 Harvest (wind-down only) ───────────────────────────────────────────────

async function harvestStaking(client, keypair, pendingRewards) {
  console.log(`  🌾 Harvesting V5 Triton yield — pending: ${fmt(pendingRewards)} SUI`);
  try {
    const tx = new Transaction();
    tx.setGasPrice(1000);
    tx.moveCall({
      target: `${PACKAGE_ID}::stake_vault::harvest`,
      arguments: [tx.object(STAKING_VAULT), tx.object(VAULT_ADMIN_CAP), tx.object(SUI_SYSTEM)],
    });
    const rewardsCoin = tx.moveCall({
      target: `${PACKAGE_ID}::stake_vault::claim_rewards`,
      arguments: [tx.object(STAKING_VAULT), tx.object(VAULT_ADMIN_CAP)],
    });
    tx.moveCall({
      target: `${PACKAGE_ID}::reward_pool::deposit_yield`,
      arguments: [tx.object(REWARD_POOL), rewardsCoin, tx.object(POOL_ADMIN_CAP)],
    });
    const r = await client.signAndExecuteTransaction({
      signer: keypair, transaction: tx,
      options: { showEffects: true, showEvents: true },
    });
    if (r.effects?.status?.status === 'success') {
      console.log(`  ✅ V5 harvest complete — tx: ${r.digest}`);
    } else {
      console.error('  ❌ V5 harvest failed:', r.effects?.status?.error);
    }
  } catch (e) {
    console.error('  ❌ V5 harvest error:', e.message);
  }
}

// ── Draw Registration + Trigger (unchanged) ───────────────────────────────────

async function registerAndDraw(client, keypair, drawType, stakers, balance) {
  const names = ['Spark', 'Pulse', 'Surge'];
  const registerFn = ['register_spark_tickets', 'register_pulse_tickets', 'register_surge_tickets'];
  const triggerFn  = ['trigger_spark',          'trigger_pulse',          'trigger_surge'];
  const gates = [1, 10, 50];
  const name = names[drawType];

  if (Object.keys(stakers).length === 0) {
    console.log(`  ⚠️ ${name}: no stakers found — skipping draw`);
    return;
  }
  console.log(`  🎲 ${name} draw — registering tickets & triggering...`);

  try {
    const tx = new Transaction();
    tx.setGasPrice(1000);

    let registered = 0;
    for (const [addr, amtMist] of Object.entries(stakers)) {
      const suiAmt = Number(amtMist) / 1e9;
      let tickets;
      if (drawType === 0) {
        tickets = suiAmt >= 1 ? 1 : 0;
      } else if (drawType === 1) {
        tickets = suiAmt < 10 ? 0 : Math.max(1, Math.floor(Math.sqrt(suiAmt)));
      } else {
        tickets = suiAmt < 50 ? 0 : Math.max(1, Math.floor(Math.sqrt(suiAmt)));
      }
      if (tickets > 0) {
        registered++;
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

    if (registered === 0) {
      console.log(`  ⚠️ ${name}: no eligible participants (need ≥${gates[drawType]} SUI staked) — skipping draw, no gas spent`);
      return;
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
      signer: keypair, transaction: tx,
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
  const crankAddr = keypair.getPublicKey().toSuiAddress();
  console.log(`\n⏰ [${new Date().toISOString()}] Tick`);

  // ── V6: the primary yield engine ──
  const v6 = await fetchV6Vault(client);
  if (v6) {
    try {
      const rate = await fetchHaRate(client, crankAddr);
      const haValueSui = (v6.haBalance * rate) / RATE_SCALE;
      const surplusSui = haValueSui > v6.totalPrincipal ? haValueSui - v6.totalPrincipal : 0n;
      const surplusHa  = rate > 0n ? (surplusSui * RATE_SCALE) / rate : 0n;
      console.log(`  🟣 V6 vault — principal: ${fmt(v6.totalPrincipal)} SUI · haSUI: ${fmt(v6.haBalance)} @ ${Number(rate) / 1e6} · value: ${fmt(haValueSui)} SUI · yield: ${fmt(surplusSui)} SUI`);

      if (surplusHa >= MIN_HARVEST_HA_V6 + 5_000_000n) {
        // Comfortable margin above the on-chain minimum so the tx can't race the
        // contract's own threshold and abort.
        console.log(`  🌾 V6 surplus ${fmt(surplusHa)} haSUI ≥ threshold — harvesting`);
        await harvestV6(client, keypair);
      } else {
        console.log(`  ⏳ V6 harvest skipped — surplus ${fmt(surplusHa)}/${fmt(MIN_HARVEST_HA_V6)} haSUI`);
      }
    } catch (e) {
      console.error('  ⚠️ V6 rate/surplus check failed:', e.message);
    }
    // Claim any matured redemption tickets (harvest output) → prize pools
    await claimMaturedTickets(client, keypair, crankAddr);
  } else {
    console.log('  ⚠️ V6 vault not found — skipping V6');
  }

  // ── V5: wind-down (no-ops once principal = 0) ──
  const sv = await fetchStakingVault(client);
  if (sv) {
    if (sv.totalPrincipal > 0n || sv.pendingUnstake > 0n || sv.pendingRewards > 0n) {
      console.log(`  🏦 V5 vault — staked: ${fmt(sv.totalPrincipal)} SUI · rewards: ${fmt(sv.pendingRewards)} SUI · liquid: ${fmt(sv.liquidPrincipal)} SUI`);
      const epoch = await fetchEpoch(client);
      const activeEpochs = sv.activationEpoch > 0 ? Math.max(0, epoch - sv.activationEpoch) : 0;
      const matured = sv.activationEpoch > 0 && activeEpochs >= HARVEST_EVERY_EPOCHS;
      const pendingWithdrawal = sv.pendingUnstake > 0n;
      if ((sv.totalPrincipal > 0n && matured) || pendingWithdrawal || sv.pendingRewards > 0n) {
        await harvestStaking(client, keypair, sv.pendingRewards);
      } else if (sv.totalPrincipal > 0n) {
        console.log(`  ⏳ V5 harvest skipped — active ${activeEpochs}/${HARVEST_EVERY_EPOCHS} epochs, no pending unstake`);
      }
    } else {
      console.log('  🏦 V5 vault — empty (wind-down complete)');
    }
  }

  // Legacy vault
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
      const res = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx, options: { showEffects: true } });
      console.log(`  ✅ Legacy harvest — tx: ${res.digest}`);
    } catch (e) {
      console.error('  ⚠️ Legacy harvest failed:', e.message);
    }
  }

  // Pools
  const balances = await fetchPoolBalances(client);
  if (balances) {
    console.log(`  💰 Pools — Spark: ${fmt(balances.spark)} · Pulse: ${fmt(balances.pulse)} · Surge: ${fmt(balances.surge)} SUI`);
  }

  // Stakers: V6 (net) + V5 (only while V5 still holds principal)
  const v6Stakers = await fetchV6Stakers(client);
  const v5Stakers = sv && sv.totalPrincipal > 0n ? await fetchV5Stakers(client) : {};
  const stakers = { ...v5Stakers };
  for (const [addr, amt] of Object.entries(v6Stakers)) {
    stakers[addr] = (stakers[addr] ?? 0n) + amt;
  }
  console.log(`  👥 Eligible stakers — V6: ${Object.keys(v6Stakers).length} · V5: ${Object.keys(v5Stakers).length}`);

  // Draws
  const drawTimes = await fetchDrawState(client);
  const checks = [
    { type: 0, name: 'Spark', icon: '⚡', next: drawTimes.nextSparkMs, bal: balances?.spark },
    { type: 1, name: 'Pulse', icon: '🔄', next: drawTimes.nextPulseMs, bal: balances?.pulse },
    { type: 2, name: 'Surge', icon: '🌊', next: drawTimes.nextSurgeMs, bal: balances?.surge },
  ];
  for (const c of checks) {
    if (now >= c.next) {
      if (c.bal && c.bal >= MIN_POOL_MIST) {
        await registerAndDraw(client, keypair, c.type, stakers, c.bal);
        await new Promise(r => setTimeout(r, 3000));
      } else {
        console.log(`  ${c.icon} ${c.name}: due but pool below ${fmt(MIN_POOL_MIST)} SUI — skipping`);
      }
    } else {
      const sec = Number(c.next - now) / 1000;
      console.log(`  ${c.icon} ${c.name}: next in ${formatCountdown(sec)}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌊 Surge Crank v3 — haSUI engine (V6) + V5 wind-down');
  console.log(`   Network:    ${NETWORK}`);
  console.log(`   V6 package: ${V6_PACKAGE.slice(0, 10)}...`);
  console.log(`   V6 vault:   ${V6_VAULT.slice(0, 10)}...`);
  console.log(`   Interval:   ${POLL_MS / 1000 / 60} minutes`);

  const required = { PACKAGE_ID, STAKING_VAULT, DRAW_STATE, REWARD_POOL, ADMIN_CAP_DRAW, POOL_ADMIN_CAP, VAULT_ADMIN_CAP, V6_ADMIN_CAP };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error('❌ Missing env vars:', missing.join(', '));
    process.exit(1);
  }

  const client  = new SuiClient({ url: getFullnodeUrl(NETWORK) });
  const keypair = loadKeypair();
  console.log(`   Address:    ${keypair.getPublicKey().toSuiAddress()}\n`);

  await tick(client, keypair);
  setInterval(() => tick(client, keypair).catch(console.error), POLL_MS);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

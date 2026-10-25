require('dotenv/config');

const { SuiGraphQLClient } = require('@mysten/sui/graphql');   // @mysten/sui v2 (Node >= 22)
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { fromBase64, normalizeSuiAddress } = require('@mysten/sui/utils');
const fs = require('fs');
const os = require('os');

// ── GraphQL adapter ────────────────────────────────────────────────────────────
// Sui Mainnet JSON-RPC was switched off (node v1.82, Oct 2026). This adapter
// re-implements exactly the JSON-RPC client methods this crank uses, on top of
// the Sui GraphQL RPC, returning the SAME response shapes — so the draw /
// harvest logic below stays untouched. Transaction building, gas selection,
// simulation and execution go through the SDK v2 GraphQL client.

const GQL_URL = process.env.GQL_URL ?? 'https://graphql.mainnet.sui.io/graphql';

function createGqlClient(url = GQL_URL) {
  const sdk = new SuiGraphQLClient({ url, network: 'mainnet' });

  async function gql(query, variables = {}) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`GraphQL HTTP ${r.status}: ${text.slice(0, 200)}`); }
    if (json.errors?.length) throw new Error('GraphQL: ' + json.errors.map(e => e.message).join('; '));
    return json.data;
  }

  // JSON-RPC style error string, e.g. "MoveAbort(0x..::interface::claim_v2, 6)".
  // claimMaturedTickets() matches the abort code at the end of this string.
  function errorString(err) {
    if (!err) return 'unknown failure';
    if (err.$kind === 'MoveAbort' && err.MoveAbort) {
      const l = err.MoveAbort.location ?? {};
      return `MoveAbort(${l.package ?? '?'}::${l.module ?? '?'}::${l.functionName ?? '?'}, ${err.MoveAbort.abortCode})`;
    }
    return err.message ?? err.$kind ?? JSON.stringify(err);
  }

  return {
    sdk,
    gql,

    async getObject({ id }) {
      const d = await gql(`query($id:SuiAddress!){ object(address:$id){ asMoveObject{ contents{ type{repr} json } } } }`, { id });
      const c = d?.object?.asMoveObject?.contents;
      if (!c) return { data: null };
      return { data: { objectId: id, content: { dataType: 'moveObject', type: c.type?.repr, fields: c.json } } };
    },

    async getLatestSuiSystemState() {
      const d = await gql(`{ epoch { epochId } }`);
      return { epoch: String(d?.epoch?.epochId ?? 0) };
    },

    async queryEvents({ query, limit = 50, cursor = null }) {
      const d = await gql(
        `query($t:String!,$n:Int!,$a:String){ events(first:$n, after:$a, filter:{type:$t}){ pageInfo{ hasNextPage endCursor } nodes{ contents{ type{repr} json } timestamp } } }`,
        { t: query.MoveEventType, n: Math.min(limit, 50), a: cursor },
      );
      const ev = d?.events;
      return {
        data: (ev?.nodes ?? []).map(n => ({
          type: n.contents?.type?.repr,
          parsedJson: n.contents?.json,
          timestampMs: n.timestamp ? String(new Date(n.timestamp).getTime()) : null,
        })),
        hasNextPage: !!ev?.pageInfo?.hasNextPage,
        nextCursor: ev?.pageInfo?.endCursor ?? null,
      };
    },

    async getOwnedObjects({ owner, filter }) {
      const d = await gql(
        `query($o:SuiAddress!,$t:String!){ address(address:$o){ objects(first:50, filter:{type:$t}){ nodes{ address } } } }`,
        { o: owner, t: filter.StructType },
      );
      return { data: (d?.address?.objects?.nodes ?? []).map(n => ({ data: { objectId: n.address } })) };
    },

    // Read-only call; returns JSON-RPC-shaped results[i].returnValues[j] = [bytes[], type]
    async devInspectTransactionBlock({ sender, transactionBlock }) {
      transactionBlock.setSenderIfNotSet(sender);
      const res = await sdk.core.simulateTransaction({
        transaction: transactionBlock,
        checksEnabled: false,
        include: { commandResults: true },
      });
      if (res.$kind === 'FailedTransaction') throw new Error('simulate: ' + errorString(res.FailedTransaction?.status?.error));
      return {
        results: (res.commandResults ?? []).map(o => ({
          returnValues: (o.returnValues ?? []).map(rv => [rv.bcs ? Array.from(rv.bcs) : null, null]),
        })),
      };
    },

    async signAndExecuteTransaction({ signer, transaction }) {
      const res = await sdk.core.signAndExecuteTransaction({
        signer,
        transaction,
        include: { effects: true, events: true, balanceChanges: true },
      });
      const t = res.Transaction ?? res.FailedTransaction;
      // Wait until the tx is indexed so the next tx in this tick resolves
      // fresh object versions (gas coin, caps, pools).
      try { await sdk.core.waitForTransaction({ digest: t.digest }); } catch {}
      return {
        digest: t.digest,
        effects: {
          status: t.status?.success ? { status: 'success' } : { status: 'failure', error: errorString(t.status?.error) },
          gasUsed: t.effects?.gasUsed,
        },
        events: (t.events ?? []).map(e => ({ type: e.eventType, parsedJson: e.json })),
        balanceChanges: (t.balanceChanges ?? []).map(bc => ({
          coinType: /^0x0*2::sui::SUI$/.test(bc.coinType ?? '') ? '0x2::sui::SUI' : bc.coinType,
          owner: { AddressOwner: bc.address ? normalizeSuiAddress(bc.address) : null },
          amount: bc.amount,
        })),
      };
    },
  };
}

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

// ── RPC timeout guard ──────────────────────────────────────────────────────────
// Every Sui RPC call gets a hard timeout. Without this a single unresponsive
// fullnode freezes the whole crank indefinitely (the 07:33 harvest hang).
// On timeout the call REJECTS — caught by the per-step try/catch, so the tick
// logs the failure and the next tick proceeds normally instead of wedging.
// Note: a timeout aborts the WAIT, not necessarily the on-chain tx; the next
// tick always reconciles from live on-chain state, so a late-landing tx is safe.
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS ?? 90_000); // 90s

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`RPC timeout: ${label} exceeded ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Monkey-patch the SuiClient instance so every RPC method we use is time-bounded.
function wrapClientWithTimeout(client, ms) {
  const methods = [
    'getObject', 'multiGetObjects', 'getOwnedObjects', 'queryEvents',
    'devInspectTransactionBlock', 'signAndExecuteTransaction',
    'waitForTransaction', 'getLatestSuiSystemState',
  ];
  for (const m of methods) {
    if (typeof client[m] === 'function') {
      const orig = client[m].bind(client);
      client[m] = (...args) => withTimeout(orig(...args), ms, m);
    }
  }
  return client;
}

// ── Keypair ───────────────────────────────────────────────────────────────────

function loadKeypair() {
  if (process.env.PRIVATE_KEY_B64) {
    const raw = fromBase64(process.env.PRIVATE_KEY_B64);
    const secret = raw.length === 33 ? raw.slice(1) : raw;
    return Ed25519Keypair.fromSecretKey(secret);
  }
  const keystorePath = `${os.homedir()}/.sui/sui_config/sui.keystore`;
  const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf-8'));
  const raw = fromBase64(keystore[0]);
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
  // JSON-RPC: "123" or { fields: { value } } · GraphQL json: "123" or { value }
  return BigInt(field?.fields?.value ?? field?.value ?? field ?? 0);
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
    // GraphQL filters event types by the ORIGINAL package id (type origin),
    // not by upgraded package ids — query all candidates, dedupe by package.
    const PACKAGE_V5      = '0x35732358f2e0a683fe2014f5781b8ab67146d40ce63a76ac0a30ac52fdb7b2bb';
    const PACKAGE_TYPE_ID = process.env.PACKAGE_TYPE_ID ?? '0x330aa337772418f68117556dce74034063f11a8de68f60a99acc9a5ee62f5fb3';
    const pkgs = [...new Set([PACKAGE_TYPE_ID, PACKAGE_V5, PACKAGE_ID])];
    const results = await Promise.all(pkgs.map(p => queryAllEvents(client, `${p}::stake_vault::Staked`)));
    const stakers = {};
    for (const ev of results.flat()) {
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
/// Query ALL events of a type via cursor pagination. Without this, staker
/// enumeration silently caps at the query limit — stakers beyond it would get
/// NO tickets despite having stake. Hard cap of 40 pages (2000 events) with a
/// loud warning so a pathological event flood can't spin the tick forever.
async function queryAllEvents(client, type) {
  const all = [];
  let cursor = null;
  for (let i = 0; i < 40; i++) {
    const res = await client.queryEvents({ query: { MoveEventType: type }, limit: 50, cursor });
    all.push(...res.data);
    if (!res.hasNextPage) return all;
    cursor = res.nextCursor;
  }
  console.error(`  ⚠️ queryAllEvents(${type.split('::').pop()}): >2000 events — enumeration truncated, RAISE PAGE CAP`);
  return all;
}

async function fetchV6Stakers(client) {
  try {
    const [stakedData, unstakedData] = await Promise.all([
      queryAllEvents(client, `${V6_PACKAGE}::stake_vault_v6::StakedV6`),
      queryAllEvents(client, `${V6_PACKAGE}::stake_vault_v6::UnstakedV6`),
    ]);
    const stakedEv = { data: stakedData };
    const unstakedEv = { data: unstakedData };
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
        if (/[（(,]\s*6\)/.test(err) || /\b6\)\s*$/.test(err)) { // MoveAbort code 6 exactly — not 16/26
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

// ── Ticket model ──────────────────────────────────────────────────────────────
//
// Linear odds, identical for all three draws: 1 ticket per TICKET UNIT of stake.
//   unit    = max(1 SUI, ceil(totalEligibleStake / MAX_TICKETS_PER_DRAW))
//   tickets = floor(stake / unit)
// - Linear = sybil-neutral: splitting one wallet into many never adds tickets
//   (the old √-model gave 10 wallets × 10 SUI 3× the tickets of 1 × 100 SUI).
// - No "min 1 ticket": that would re-open the split exploit once unit > 1 SUI.
// - The cap keeps DrawState's vector<address> (32 B per ticket) far below the
//   on-chain object size limit and the per-tx gas budget as TVL grows.
// - Single entry gate: ≥ 1 SUI (= protocol minimum deposit), every draw.
const MIN_TICKET_STAKE_MIST = 1_000_000_000n;   // 1 SUI
const MAX_TICKETS_PER_DRAW  = BigInt(process.env.MAX_TICKETS_PER_DRAW ?? 2000);
const MAX_REGISTRATIONS_PER_TX = 900;           // PTB limit is 1024 commands

// Wallets never entered into draws (team / treasury). Default: admin wallet.
// Set DRAW_EXCLUDE="" to exclude nobody, or a comma list to override.
const ADMIN_WALLET = '0x0baa87509dbe704c0932b664bed03b4ac4afe0015fe40a83a6a9d7d2a4fc183b';
const DRAW_EXCLUDE = new Set(
  (process.env.DRAW_EXCLUDE ?? ADMIN_WALLET).split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
);

function planTickets(stakers) {
  const eligible = Object.entries(stakers)
    .filter(([addr, mist]) => !DRAW_EXCLUDE.has(addr.toLowerCase()) && BigInt(mist) >= MIN_TICKET_STAKE_MIST);
  const total = eligible.reduce((a, [, m]) => a + BigInt(m), 0n);
  const capUnit = (total + MAX_TICKETS_PER_DRAW - 1n) / MAX_TICKETS_PER_DRAW;
  const unit = capUnit > MIN_TICKET_STAKE_MIST ? capUnit : MIN_TICKET_STAKE_MIST;
  const entries = eligible
    .map(([addr, m]) => [addr, BigInt(m) / unit])
    .filter(([, t]) => t > 0n);
  const totalTickets = entries.reduce((a, [, t]) => a + t, 0n);
  const excluded = Object.keys(stakers).filter(a => DRAW_EXCLUDE.has(a.toLowerCase()));
  return { unit, entries, totalTickets, excluded };
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

  const plan = planTickets(stakers);
  if (plan.excluded.length > 0) {
    console.log(`  🚫 ${name}: ${plan.excluded.length} excluded wallet(s) (DRAW_EXCLUDE): ${plan.excluded.map(a => a.slice(0, 10) + '…').join(', ')}`);
  }
  if (plan.entries.length > MAX_REGISTRATIONS_PER_TX) {
    console.error(`  ❌ ${name}: ${plan.entries.length} participants exceed ${MAX_REGISTRATIONS_PER_TX}/tx — batching not implemented yet, skipping draw`);
    return;
  }
  console.log(`  🎲 ${name} draw — ${plan.entries.length} participants · ${plan.totalTickets} tickets · 1 ticket = ${fmt(plan.unit)} SUI`);

  try {
    const tx = new Transaction();
    tx.setGasPrice(1000);

    let registered = 0;
    for (const [addr, ticketsBig] of plan.entries) {
      const tickets = Number(ticketsBig);
      const pct = Number((ticketsBig * 10000n) / plan.totalTickets) / 100;
      console.log(`     ${addr.slice(0, 10)}… ${tickets} tickets (${pct}%)`);
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
      console.log(`  ⚠️ ${name}: no eligible participants (need ≥1 SUI staked, not excluded) — skipping draw, no gas spent`);
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

      // Mirror the on-chain harvest gate EXACTLY (stake_vault_v6::harvest):
      //   exact    = ceil(total_principal * RATE_SCALE / rate)        [ha_for_sui_ceil]
      //   required = ceil(exact * (10000 + SAFETY_BPS) / 10000)        [required_ha, +0.1% margin]
      //   harvest needs:  held > required  AND  (held - required) >= MIN_HARVEST_HA
      const SAFETY_BPS = 10n;
      const ceilDiv = (a, b) => (a + b - 1n) / b;
      const exactHa    = ceilDiv(v6.totalPrincipal * RATE_SCALE, rate);
      const requiredHa = ceilDiv(exactHa * (10_000n + SAFETY_BPS), 10_000n);
      const contractSurplusHa = v6.haBalance > requiredHa ? v6.haBalance - requiredHa : 0n;

      // ── Haedal's OWN floor, not just our contract's ──────────────────────
      // Confirmed from Haedal's staking module source (request_unstake_delay):
      //   assert!(v1 <= get_total_sui(arg0) && v1 >= 1_000_000_000, 8)
      // where v1 = get_sui_by_stsui(surplus_ha) — the SUI VALUE of the haSUI
      // being unstaked. harvest() calls this same function on the surplus, so
      // ANY surplus worth < 1 SUI aborts there with code 8 — regardless of
      // whether our own MIN_HARVEST_HA_V6 gate is satisfied. Our old gate
      // (0.01 ha) was ~100x below Haedal's real floor, so the crank was firing
      // into a guaranteed external abort every 6h. Convert Haedal's 1-SUI
      // floor into a haSUI amount using the current rate, plus a small buffer
      // so a tx can't land right on the boundary and abort by rounding.
      const HAEDAL_MIN_SUI_MIST = 1_000_000_000n; // Haedal's own floor, not ours
      const haedalMinHa = rate > 0n ? ceilDiv(HAEDAL_MIN_SUI_MIST * RATE_SCALE, rate) + 1_000_000n : MIN_HARVEST_HA_V6;
      const effectiveMinHa = haedalMinHa > MIN_HARVEST_HA_V6 ? haedalMinHa : MIN_HARVEST_HA_V6;

      if (v6.haBalance > requiredHa && contractSurplusHa >= effectiveMinHa) {
        console.log(`  🌾 V6 contract-surplus ${fmt(contractSurplusHa)} haSUI ≥ ${fmt(effectiveMinHa)} (Haedal 1-SUI floor) — harvesting`);
        await harvestV6(client, keypair);
      } else {
        const deficitHa = effectiveMinHa > contractSurplusHa ? effectiveMinHa - contractSurplusHa : 0n;
        // Rough ETA from a fixed daily rate-growth estimate (~0.000044/day,
        // derived from observed mainnet rate deltas). Informational only —
        // actual growth depends on Haedal's validator rewards and TVL changes.
        const dailyRateGrowth = 44n; // scaled ×1e6, i.e. 0.000044/day
        const daysEta = dailyRateGrowth > 0n ? (deficitHa * RATE_SCALE) / (v6.totalPrincipal * dailyRateGrowth) : 0n;
        console.log(`  ⏳ V6 harvest skipped — contract-surplus ${fmt(contractSurplusHa)}/${fmt(effectiveMinHa)} haSUI (Haedal requires ≥1 SUI per unstake) — ~${daysEta}d at current TVL/rate-growth`);
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

  const client  = createGqlClient(GQL_URL);
  wrapClientWithTimeout(client, RPC_TIMEOUT_MS);
  console.log(`   GraphQL:    ${GQL_URL}`);
  console.log(`   RPC timeout: ${RPC_TIMEOUT_MS / 1000}s per call`);
  const keypair = loadKeypair();
  console.log(`   Address:    ${keypair.getPublicKey().toSuiAddress()}\n`);

  await tick(client, keypair);
  setInterval(() => tick(client, keypair).catch(console.error), POLL_MS);
}

if (require.main === module) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}

module.exports = {
  createGqlClient, fetchV6Vault, fetchHaRate, fetchDrawState, fetchPoolBalances,
  fetchStakingVault, fetchEpoch, fetchV6Stakers, fetchV5Stakers, planTickets,
};

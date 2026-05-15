require('dotenv/config');

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { fromB64 } = require('@mysten/sui/utils');
const { randomBytes } = require('crypto');
const fs = require('fs');
const os = require('os');

const NETWORK        = process.env.NETWORK ?? 'mainnet';
const PACKAGE_ID     = process.env.PACKAGE_ID ?? '';
const DRAW_STATE     = process.env.DRAW_STATE ?? '';
const REWARD_POOL    = process.env.REWARD_POOL ?? '';
const VAULT          = process.env.VAULT ?? '';
const ADMIN_CAP_DRAW = process.env.ADMIN_CAP_DRAW ?? '';
const POLL_MS        = 60_000;

const APY            = 0.05;
const YIELD_PER_TICK = APY / 365 / 24 / 60;
const MIN_YIELD_MIST = 1_000_000n;

function loadKeypair() {
  const keystorePath = `${os.homedir()}/.sui/sui_config/sui.keystore`;
  const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf-8'));
  const raw = fromB64(keystore[1]);
  const secret = raw.length === 33 ? raw.slice(1) : raw;
  return Ed25519Keypair.fromSecretKey(secret);
}

function formatCountdown(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

async function fetchVault(client) {
  const obj = await client.getObject({ id: VAULT, options: { showContent: true } });
  if (obj.data?.content?.dataType !== 'moveObject') return null;
  const f = obj.data.content.fields;
  // total_staked is tracked as u64 in the vault
  const totalStaked = BigInt(f.total_staked ?? 0);
  const pendingYield = BigInt(f.pending_yield ?? 0);
  return { totalStaked, pendingYield };
}

async function fetchDrawState(client) {
  const obj = await client.getObject({ id: DRAW_STATE, options: { showContent: true } });
  if (obj.data?.content?.dataType !== 'moveObject') throw new Error('DrawState not found');
  const f = obj.data.content.fields;
  return {
    nextSparkMs:   BigInt(f.next_spark_ms ?? 0),
    nextPulseMs:   BigInt(f.next_pulse_ms ?? 0),
    nextSurgeMs:   BigInt(f.next_surge_ms ?? 0),
    sparkTickets:  f.spark_tickets ?? [],
    pulseTickets:  f.pulse_tickets ?? [],
    surgeTickets:  f.surge_tickets ?? [],
  };
}

async function fetchPoolBalances(client) {
  const obj = await client.getObject({ id: REWARD_POOL, options: { showContent: true } });
  if (obj.data?.content?.dataType !== 'moveObject') return null;
  const f = obj.data.content.fields;
  return {
    spark: BigInt(f.spark_pool ?? 0),
    pulse: BigInt(f.pulse_pool ?? 0),
    surge: BigInt(f.surge_pool ?? 0),
  };
}

// Get all StakeReceipts from the vault to build ticket list
async function fetchStakers(client) {
  try {
    const events = await client.queryEvents({
      query: { MoveEventType: `${PACKAGE_ID}::stake_vault::Deposited` },
      limit: 50,
    });
    console.log(`  📋 Found ${events.data.length} deposit events`);
    const stakers = {};
    for (const ev of events.data) {
      const fields = ev.parsedJson;
      if (fields?.staker && fields?.amount_mist) {
        const addr = fields.staker;
        const amt = BigInt(fields.amount_mist);
        stakers[addr] = (stakers[addr] ?? 0n) + amt;
        console.log(`  👤 Staker: ${addr.slice(0,10)}... ${(Number(amt)/1e9).toFixed(2)} SUI`);
      }
    }
    return stakers;
  } catch (e) {
    console.error('  ⚠️ Could not fetch stakers:', e.message);
    return {};
  }
}

async function simulateYield(client, keypair, totalStaked) {
  if (totalStaked === 0n) { console.log('  💤 No stakers — skipping yield'); return; }
  const yieldMist = BigInt(Math.floor(Number(totalStaked) * YIELD_PER_TICK));
  if (yieldMist < MIN_YIELD_MIST) { console.log(`  💤 Yield too small (${yieldMist} MIST) — skipping`); return; }
  console.log(`  🌱 Injecting yield: ${(Number(yieldMist)/1e9).toFixed(6)} SUI`);
  try {
    const tx = new Transaction();
    tx.setGasPrice(1000);
    const [c] = tx.splitCoins(tx.gas, [yieldMist]);
    tx.moveCall({ target: `${PACKAGE_ID}::stake_vault::add_yield`, arguments: [tx.object(VAULT), c] });
    const r = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx, options: { showEffects: true } });
    if (r.effects?.status?.status === 'success') console.log(`  ✅ Yield injected — tx: ${r.digest}`);
    else console.error('  ❌ Yield failed:', r.effects?.status?.error);
  } catch (e) { console.error('  ❌ Yield error:', e.message); }
}

async function harvestYield(client, keypair, pendingYield) {
  if (pendingYield === 0n) return;
  console.log(`  🌾 Harvesting ${(Number(pendingYield)/1e9).toFixed(6)} SUI into RewardPool...`);
  try {
    const tx = new Transaction();
    tx.setGasPrice(1000);
    const harvested = tx.moveCall({ target: `${PACKAGE_ID}::stake_vault::harvest_yield`, arguments: [tx.object(VAULT)] });
    tx.moveCall({ target: `${PACKAGE_ID}::reward_pool::deposit_yield`, arguments: [tx.object(REWARD_POOL), harvested] });
    const r = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx, options: { showEffects: true } });
    if (r.effects?.status?.status === 'success') console.log(`  ✅ Harvest complete — tx: ${r.digest}`);
    else console.error('  ❌ Harvest failed:', r.effects?.status?.error);
  } catch (e) { console.error('  ❌ Harvest error:', e.message); }
}

async function registerAndDraw(client, keypair, drawType, stakers, balance) {
  const names = ['Spark', 'Pulse', 'Surge'];
  const registerFn = [`register_spark_tickets`, `register_pulse_tickets`, `register_surge_tickets`];
  const triggerFn  = [`trigger_spark`, `trigger_pulse`, `trigger_surge`];
  const name = names[drawType];

  if (Object.keys(stakers).length === 0) {
    console.log(`  ⚠️ ${name}: no stakers found — skipping draw`);
    return;
  }

  console.log(`  🎲 ${name} draw — registering tickets & triggering...`);

  try {
    const tx = new Transaction();
    tx.setGasPrice(1000);

    // Register tickets for each staker
    for (const [addr, amtMist] of Object.entries(stakers)) {
      const suiAmt = Number(amtMist) / 1e9;
      const tickets = Math.min(Math.floor(suiAmt), 500); // spark: 1 ticket per SUI, max 500
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

    // VRF = random 32 bytes
    const vrf = Array.from(randomBytes(32));

    // Trigger draw
    tx.moveCall({
      target: `${PACKAGE_ID}::draw_manager::${triggerFn[drawType]}`,
      arguments: [
        tx.object(DRAW_STATE),
        tx.object(REWARD_POOL),
        tx.pure.vector('u8', vrf),
        tx.object('0x6'), // clock
        tx.object(ADMIN_CAP_DRAW),
      ],
    });

    const r = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx, options: { showEffects: true } });
    if (r.effects?.status?.status === 'success') {
      console.log(`  ✅ ${name} draw complete — tx: ${r.digest}`);
    } else {
      console.error(`  ❌ ${name} draw failed:`, r.effects?.status?.error);
    }
  } catch (e) {
    console.error(`  ❌ ${name} draw error:`, e.message);
  }
}

async function tick(client, keypair) {
  const now = BigInt(Date.now());
  console.log(`\n⏰ [${new Date().toISOString()}] Tick`);

  const vault = await fetchVault(client);
  if (!vault) { console.error('  ❌ Vault not found'); return; }

  const fmt = n => (Number(n)/1e9).toFixed(4);
  console.log(`  🏦 Vault — staked: ${fmt(vault.totalStaked)} SUI · pending yield: ${fmt(vault.pendingYield)} SUI`);

  await simulateYield(client, keypair, vault.totalStaked);

  const vaultAfter = await fetchVault(client);
  if (vaultAfter?.pendingYield > 0n) await harvestYield(client, keypair, vaultAfter.pendingYield);

  const balances = await fetchPoolBalances(client);
  if (balances) {
    console.log(`  💰 Pools — Spark: ${fmt(balances.spark)} · Pulse: ${fmt(balances.pulse)} · Surge: ${fmt(balances.surge)} SUI`);
  }

  const drawTimes = await fetchDrawState(client);
  const stakers = await fetchStakers(client);

  const checks = [
    { type: 0, name: 'Spark', icon: '⚡', next: drawTimes.nextSparkMs, bal: balances?.spark },
    { type: 1, name: 'Pulse', icon: '🔄', next: drawTimes.nextPulseMs, bal: balances?.pulse },
    { type: 2, name: 'Surge', icon: '🌊', next: drawTimes.nextSurgeMs, bal: balances?.surge },
  ];

  for (const c of checks) {
    if (now >= c.next) {
      if (c.bal && c.bal > 0n) {
        await registerAndDraw(client, keypair, c.type, stakers, c.bal);
        // Wait 3s between draws so object versions settle
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

async function main() {
  console.log('🌊 Surge Crank v3 — starting up');
  console.log(`   Network:  ${NETWORK}`);
  console.log(`   Package:  ${PACKAGE_ID.slice(0,10)}...`);

  if (!PACKAGE_ID || !DRAW_STATE || !REWARD_POOL || !VAULT || !ADMIN_CAP_DRAW) {
    console.error('❌ Missing env vars — check .env'); process.exit(1);
  }

  const client  = new SuiClient({ url: getFullnodeUrl(NETWORK) });
  const keypair = loadKeypair();
  console.log(`   Address:  ${keypair.getPublicKey().toSuiAddress()}\n`);

  await tick(client, keypair);
  setInterval(() => tick(client, keypair).catch(console.error), POLL_MS);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

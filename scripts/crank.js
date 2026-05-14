require('dotenv/config');

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { fromB64 } = require('@mysten/sui/utils');
const fs = require('fs');
const os = require('os');

const NETWORK       = process.env.NETWORK ?? 'testnet';
const PACKAGE_ID    = process.env.PACKAGE_ID ?? '';
const DRAW_STATE    = process.env.DRAW_STATE ?? '';
const REWARD_POOL   = process.env.REWARD_POOL ?? '';
const VAULT         = process.env.VAULT ?? '';
const ADMIN_CAP_DRAW = process.env.ADMIN_CAP_DRAW ?? '';
const POLL_MS       = 60_000;

function loadKeypair() {
  const keystorePath = `${os.homedir()}/.sui/sui_config/sui.keystore`;
  const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf-8'));
  const raw = fromB64(keystore[0]);
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
    spark: BigInt(f.spark_pool ?? f.spark_pool?.fields?.value ?? 0),
    pulse: BigInt(f.pulse_pool ?? f.pulse_pool?.fields?.value ?? 0),
    surge: BigInt(f.surge_pool ?? f.surge_pool?.fields?.value ?? 0),
  };
}

async function tick(client, keypair) {
  const now = BigInt(Date.now());
  console.log(`\n⏰ [${new Date().toISOString()}] Checking draws...`);

  await harvestYield(client, keypair);
  const drawTimes = await fetchDrawState(client);
  const balances  = await fetchPoolBalances(client);

  if (balances) {
    const fmt = n => (Number(n) / 1e9).toFixed(4);
    console.log(`  💰 Spark: ${fmt(balances.spark)} · Pulse: ${fmt(balances.pulse)} · Surge: ${fmt(balances.surge)} SUI`);
  }

  const checks = [
    { name: 'Spark', icon: '⚡', next: drawTimes.nextSparkMs, bal: balances?.spark, type: 'spark' },
    { name: 'Pulse', icon: '🔄', next: drawTimes.nextPulseMs, bal: balances?.pulse, type: 'pulse' },
    { name: 'Surge', icon: '🌊', next: drawTimes.nextSurgeMs, bal: balances?.surge, type: 'surge' },
  ];

  for (const c of checks) {
    if (now >= c.next) {
      if (c.bal && c.bal > 0n) {
        console.log(`\n🎲 Triggering ${c.name} draw...`);
        // Draw trigger would go here once pool has funds
        console.log(`  ✅ ${c.name} draw ready (pool: ${Number(c.bal)/1e9} SUI)`);
      } else {
        console.log(`  ${c.icon} ${c.name}: pool empty — skipping`);
      }
    } else {
      const sec = Number(c.next - now) / 1000;
      console.log(`  ${c.icon} ${c.name}: ${formatCountdown(sec)} remaining`);
    }
  }
}

async function main() {
  console.log('🌊 Surge Crank — starting up');
  console.log(`   Network: ${NETWORK}`);
  console.log(`   Package: ${PACKAGE_ID.slice(0,10)}...`);

  if (!PACKAGE_ID || !DRAW_STATE || !REWARD_POOL) {
    console.error('❌ Missing env vars'); process.exit(1);
  }

  const client  = new SuiClient({ url: getFullnodeUrl(NETWORK) });
  const keypair = loadKeypair();
  console.log(`   Address: ${keypair.getPublicKey().toSuiAddress()}\n`);

  await tick(client, keypair);
  setInterval(() => tick(client, keypair).catch(console.error), POLL_MS);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

async function harvestYield(client, keypair) {
  const vault = await client.getObject({ id: VAULT, options: { showContent: true } });
  if (vault.data?.content?.dataType !== 'moveObject') return;
  const pending = BigInt(vault.data.content.fields?.pending_yield?.fields?.value ?? 0);
  if (pending === 0n) return;
  console.log(`  🌾 Harvesting ${(Number(pending)/1e9).toFixed(4)} SUI yield into RewardPool...`);

  const tx = new Transaction();
  const harvestedCoin = tx.moveCall({
    target: `${PACKAGE_ID}::stake_vault::harvest_yield`,
    arguments: [tx.object(VAULT)],
  });
  tx.moveCall({
    target: `${PACKAGE_ID}::reward_pool::deposit_yield`,
    arguments: [tx.object(REWARD_POOL), harvestedCoin],
  });

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  });

  if (result.effects?.status?.status === 'success') {
    console.log(`  ✅ Harvest complete — tx: ${result.digest}`);
  } else {
    console.error('  ❌ Harvest failed:', result.effects?.status?.error);
  }
}

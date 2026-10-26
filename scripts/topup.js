// Top up the prize pool via reward_pool::deposit_yield, signed by the crank wallet
// (it owns the PoolAdminCap). Split on-chain: 48% Surge (jackpot) · 30% Pulse ·
// 20% Spark · 1% marketing · 1% operations.
//
//   node topup.js 21            → SIMULATE only (no SUI moves)
//   node topup.js 21 --execute  → send the transaction
//
// Key: read from ~/.sui/sui_config/sui.keystore — the entry whose address is the
// crank wallet (never printed). Override with PRIVATE_KEY_B64 if needed.
const fs = require('fs');
const os = require('os');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { fromBase64, normalizeSuiAddress } = require('@mysten/sui/utils');
const { createGqlClient } = require('./crank.js');

const CRANK = '0x2a587fd1789212292af4337cacdc7bcbca496e01a6538f46c08968d41d6a83c0';
const PACKAGE_ID      = process.env.PACKAGE_ID      ?? '0x4ca98688e6cdf7fb6b73cc01d5ebbf77f947a02f5da570afd2f14bf155942b0c';
const PACKAGE_TYPE_ID = process.env.PACKAGE_TYPE_ID ?? '0x330aa337772418f68117556dce74034063f11a8de68f60a99acc9a5ee62f5fb3';
const REWARD_POOL     = process.env.REWARD_POOL     ?? '0xacf68b636a55c96a8269ab0b66d735a7bbfadf058821cc17f97bc32d49d6968f';

const fmt = (m) => (Number(m) / 1e9).toFixed(4);

function loadCrankKeypair() {
  const candidates = [];
  if (process.env.PRIVATE_KEY_B64) candidates.push(process.env.PRIVATE_KEY_B64);
  const path = `${os.homedir()}/.sui/sui_config/sui.keystore`;
  if (fs.existsSync(path)) candidates.push(...JSON.parse(fs.readFileSync(path, 'utf-8')));
  for (const b64 of candidates) {
    const raw = fromBase64(b64);
    if (raw.length === 33 && raw[0] !== 0) continue; // not ed25519
    const kp = Ed25519Keypair.fromSecretKey(raw.length === 33 ? raw.slice(1) : raw);
    if (normalizeSuiAddress(kp.getPublicKey().toSuiAddress()) === CRANK) return kp;
  }
  throw new Error(`no ed25519 key for crank wallet ${CRANK.slice(0, 10)}… found in keystore`);
}

async function poolBalances(client) {
  const obj = await client.getObject({ id: REWARD_POOL });
  const f = obj.data?.content?.fields ?? {};
  const v = (x) => BigInt(x?.value ?? x ?? 0);
  return { spark: v(f.spark_pool), pulse: v(f.pulse_pool), surge: v(f.surge_pool) };
}

(async () => {
  const amountSui = Number(process.argv[2]);
  const execute = process.argv.includes('--execute');
  if (!(amountSui > 0) || amountSui > 1000) {
    console.log('Usage: node topup.js <SUI amount, 0–1000> [--execute]');
    process.exit(1);
  }
  const mist = BigInt(Math.round(amountSui * 1e9));
  const client = createGqlClient();
  const keypair = loadCrankKeypair();
  console.log(`🔑 Crank wallet key found (${CRANK.slice(0, 10)}…)`);

  const caps = await client.getOwnedObjects({ owner: CRANK, filter: { StructType: `${PACKAGE_TYPE_ID}::reward_pool::PoolAdminCap` } });
  const cap = process.env.POOL_ADMIN_CAP ?? caps.data[0]?.data?.objectId;
  if (!cap) throw new Error('PoolAdminCap not found in crank wallet — set POOL_ADMIN_CAP');
  console.log(`🎫 PoolAdminCap ${cap.slice(0, 10)}…`);

  const before = await poolBalances(client);
  console.log(`💰 Pools now   — Jackpot ${fmt(before.surge)} · #2–5 pool ${fmt(before.pulse)} · #6–8 pool ${fmt(before.spark)} SUI`);
  const fee = (mist * 100n) / 10000n; // 1% marketing + 1% operations, each rounded like the contract
  const expect = { surge: before.surge + mist - fee - fee - (mist * 2000n) / 10000n - (mist * 3000n) / 10000n,
                   pulse: before.pulse + (mist * 3000n) / 10000n, spark: before.spark + (mist * 2000n) / 10000n };
  console.log(`📈 After ${amountSui} SUI — Jackpot ${fmt(expect.surge)} · #2–5 each ${fmt(expect.pulse / 4n)} · #6–8 each ${fmt(expect.spark / 3n)} SUI`);

  const tx = new Transaction();
  tx.setSender(CRANK);
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(mist)]);
  tx.moveCall({
    target: `${PACKAGE_ID}::reward_pool::deposit_yield`,
    arguments: [tx.object(REWARD_POOL), coin, tx.object(cap)],
  });

  if (!execute) {
    const sim = await client.sdk.core.simulateTransaction({ transaction: tx, include: { effects: true } });
    if (sim.$kind === 'FailedTransaction') {
      const err = sim.FailedTransaction?.status?.error;
      console.log(`❌ Simulation failed: ${err?.message ?? JSON.stringify(err)}`);
      console.log('   Most likely: the crank wallet holds less than the amount + gas. Send SUI to it first.');
      process.exit(1);
    }
    console.log('✅ Simulation OK — nothing was sent. Re-run with --execute to deposit.');
    process.exit(0);
  }

  const r = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx });
  if (r.effects?.status?.status !== 'success') {
    console.log(`❌ Deposit failed: ${r.effects?.status?.error} — tx ${r.digest}`);
    process.exit(1);
  }
  console.log(`✅ Deposited ${amountSui} SUI — tx ${r.digest}`);
  const after = await poolBalances(client);
  console.log(`💰 Pools now   — Jackpot ${fmt(after.surge)} · #2–5 pool ${fmt(after.pulse)} · #6–8 pool ${fmt(after.spark)} SUI`);
  process.exit(0);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });

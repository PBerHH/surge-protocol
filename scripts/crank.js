require('dotenv/config');

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { fromB64 } = require('@mysten/sui/utils');
const fs = require('fs');
const os = require('os');

const NETWORK          = process.env.NETWORK ?? 'mainnet';
const PACKAGE_ID       = process.env.PACKAGE_ID ?? '';
const DRAW_STATE       = process.env.DRAW_STATE ?? '';
const REWARD_POOL      = process.env.REWARD_POOL ?? '';
const VAULT            = process.env.VAULT ?? '';
const ADMIN_CAP_DRAW   = process.env.ADMIN_CAP_DRAW ?? '';
const POOL_ADMIN_CAP   = process.env.POOL_ADMIN_CAP ?? '';
const VAULT_ADMIN_CAP  = process.env.VAULT_ADMIN_CAP ?? '';

const POLL_MS          = 10_800_000;  // 3 hours

// Sui shared Random object (fixed address on all networks)
const SUI_RANDOM = '0x0000000000000000000000000000000000000000000000000000000000000008';

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
  return {
    totalStaked: BigInt(f.total_staked ?? 0),
    pendingYield: BigInt(f.pending_yield ?? 0),
  };
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
    spark: BigInt(f.spark_pool?.fields?.value ?? f.spark_pool ?? 0),
    pulse: BigInt(f.pulse_pool?.fields?.value ?? f.pulse_pool ?? 0),
    surge: BigInt(f.surge_pool?.fields?.value ?? f.surge_pool ?? 0),
  };
}

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

// Protocol Fees (in basis points, 100 = 1%)
const CRANK_FEE_BPS = 100n;   // 1% to crank wallet (operations)
const OWNER_FEE_BPS = 100n;   // 1% to owner wallet (revenue)
const OWNER_ADDRESS = '0x1de8cef32b6324c2ade5659caa86db8e0dc3c1fd7a76dda17ff4c8de330f5f95';

async function harvestYield(client, keypair, pendingYield) {
  const crankFee = (pendingYield * CRANK_FEE_BPS) / 10000n;
  const ownerFee = (pendingYield * OWNER_FEE_BPS) / 10000n;
  const toPool = pendingYield - crankFee - ownerFee;
  
  console.log(`  🌾 Harvesting ${(Number(pendingYield)/1e9).toFixed(6)} SUI`);
  console.log(`     → Pool: ${(Number(toPool)/1e9).toFixed(6)} SUI (98%)`);
  console.log(`     → Crank: ${(Number(crankFee)/1e9).toFixed(6)} SUI (1%)`);
  console.log(`     → Owner: ${(Number(ownerFee)/1e9).toFixed(6)} SUI (1%)`);
  
  try {
    const tx = new Transaction();
    tx.setGasPrice(1000);
    
    // 1. Harvest from vault → returns Coin<SUI>
    const harvested = tx.moveCall({
      target: `${PACKAGE_ID}::stake_vault::harvest_yield`,
      arguments: [
        tx.object(VAULT),
        tx.object(VAULT_ADMIN_CAP),
      ],
    });
    
    // 2. Split: [crank_fee, owner_fee] from harvested coin
    // Only split if amounts > 0 (Sui doesn't allow 0 splits)
    if (crankFee > 0n && ownerFee > 0n) {
      const [crankCoin, ownerCoin] = tx.splitCoins(harvested, [crankFee, ownerFee]);
      tx.transferObjects([crankCoin], keypair.toSuiAddress());
      tx.transferObjects([ownerCoin], OWNER_ADDRESS);
    } else if (crankFee > 0n) {
      const [crankCoin] = tx.splitCoins(harvested, [crankFee]);
      tx.transferObjects([crankCoin], keypair.toSuiAddress());
    }
    
    // 3. Deposit remainder to pool
    tx.moveCall({
      target: `${PACKAGE_ID}::reward_pool::deposit_yield`,
      arguments: [
        tx.object(REWARD_POOL),
        harvested,
        tx.object(POOL_ADMIN_CAP),
      ],
    });
    
    const r = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx, options: { showEffects: true } });
    if (r.effects?.status?.status === 'success') console.log(`  ✅ Harvest complete — tx: ${r.digest}`);
    else console.error('  ❌ Harvest failed:', r.effects?.status?.error);
  } catch (e) { console.error('  ❌ Harvest error:', e.message); }
}

async function registerAndDraw(client, keypair, drawType, stakers, balance) {
  const names = ['Spark', 'Pulse', 'Surge'];
  const registerFn = ['register_spark_tickets', 'register_pulse_tickets', 'register_surge_tickets'];
  const triggerFn  = ['trigger_spark', 'trigger_pulse', 'trigger_surge'];
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
        tickets = Math.min(Math.floor(suiAmt), 500);
      } else if (drawType === 1) {
        tickets = suiAmt < 50 ? 0
          : suiAmt <= 1000 ? Math.floor(suiAmt)
          : Math.floor(1000 + Math.sqrt(suiAmt - 1000));
      } else {
        tickets = suiAmt < 200 ? 0 : Math.floor(suiAmt);
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
        tx.object('0x6'),
        tx.object(ADMIN_CAP_DRAW),
      ],
    });

    const r = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx, options: { showEffects: true, showEvents: true } });
    if (r.effects?.status?.status === 'success') {
      console.log(`  ✅ ${name} draw complete — tx: ${r.digest}`);
      for (const ev of r.events ?? []) {
        if (ev.type?.includes('PrizeAwarded')) {
          const f = ev.parsedJson;
          console.log(`  🏆 Winner: ${f?.winner} → ${(Number(f?.amount_mist ?? 0)/1e9).toFixed(4)} SUI`);
        }
      }
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

  // Harvest immediately if there's any yield
  if (vault.pendingYield > 0n) {
    await harvestYield(client, keypair, vault.pendingYield);
  }

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
  console.log('🌊 Surge Crank v5 — Production');
  console.log(`   Network:  ${NETWORK}`);
  console.log(`   Package:  ${PACKAGE_ID.slice(0,10)}...`);
  console.log(`   Interval: ${POLL_MS/1000/60} minutes (harvest after each potential draw)`);

  if (!PACKAGE_ID || !DRAW_STATE || !REWARD_POOL || !VAULT || !ADMIN_CAP_DRAW || !POOL_ADMIN_CAP || !VAULT_ADMIN_CAP) {
    console.error('❌ Missing env vars — check .env');
    console.error('   Required: PACKAGE_ID, DRAW_STATE, REWARD_POOL, VAULT, ADMIN_CAP_DRAW, POOL_ADMIN_CAP, VAULT_ADMIN_CAP');
    process.exit(1);
  }

  const client  = new SuiClient({ url: getFullnodeUrl(NETWORK) });
  const keypair = loadKeypair();
  console.log(`   Address:  ${keypair.getPublicKey().toSuiAddress()}\n`);

  await tick(client, keypair);
  setInterval(() => tick(client, keypair).catch(console.error), POLL_MS);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

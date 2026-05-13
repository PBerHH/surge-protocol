/**
 * Surge Protocol — Crank Script
 * Runs continuously, monitors draw timers, and triggers draws when due.
 * Also registers tickets for stakers before each draw.
 *
 * Usage:
 *   PACKAGE_ID=0x... DRAW_STATE=0x... REWARD_POOL=0x... VAULT=0x... \
 *   ADMIN_CAP_DRAW=0x... ADMIN_CAP_POOL=0x... \
 *   npx ts-node crank.ts
 */

import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { TransactionBlock } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromB64 } from "@mysten/sui/utils";

// ── Config ────────────────────────────────────────────────────────────────────

const NETWORK = (process.env.NETWORK as "testnet" | "mainnet") ?? "testnet";
const PACKAGE_ID  = process.env.PACKAGE_ID  ?? "";
const DRAW_STATE  = process.env.DRAW_STATE  ?? "";
const REWARD_POOL = process.env.REWARD_POOL ?? "";
const VAULT       = process.env.VAULT       ?? "";
const ADMIN_CAP_DRAW = process.env.ADMIN_CAP_DRAW ?? "";
const ADMIN_CAP_POOL = process.env.ADMIN_CAP_POOL ?? "";

// Private key — load from env or Sui keystore
// Set PRIVATE_KEY_B64 to your base64-encoded private key
// OR leave empty to load from ~/.sui/sui_config/sui.keystore
const PRIVATE_KEY_B64 = process.env.PRIVATE_KEY_B64 ?? "";

const POLL_INTERVAL_MS = 60_000; // check every 60 seconds

// ── Setup ─────────────────────────────────────────────────────────────────────

function validateConfig() {
  const required = { PACKAGE_ID, DRAW_STATE, REWARD_POOL, VAULT, ADMIN_CAP_DRAW };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    console.error("❌ Missing env vars:", missing.join(", "));
    process.exit(1);
  }
}

function loadKeypair(): Ed25519Keypair {
  if (PRIVATE_KEY_B64) {
    const raw = fromB64(PRIVATE_KEY_B64);
    // Strip the 1-byte flag if present (Sui exports with flag byte)
    const secret = raw.length === 33 ? raw.slice(1) : raw;
    return Ed25519Keypair.fromSecretKey(secret);
  }
  // Fallback: load first key from Sui CLI keystore
  const fs = require("fs");
  const os = require("os");
  const keystorePath = `${os.homedir()}/.sui/sui_config/sui.keystore`;
  const keystore: string[] = JSON.parse(fs.readFileSync(keystorePath, "utf-8"));
  const raw = fromB64(keystore[0]);
  const secret = raw.length === 33 ? raw.slice(1) : raw;
  return Ed25519Keypair.fromSecretKey(secret);
}

// ── Draw State Reader ─────────────────────────────────────────────────────────

interface DrawTimes {
  nextSparkMs: bigint;
  nextPulseMs: bigint;
  nextSurgeMs: bigint;
  sparkTickets: number;
  pulseTickets: number;
  surgeTickets: number;
}

async function fetchDrawState(client: SuiClient): Promise<DrawTimes> {
  const obj = await client.getObject({
    id: DRAW_STATE,
    options: { showContent: true },
  });

  if (obj.data?.content?.dataType !== "moveObject") {
    throw new Error("DrawState object not found or wrong type");
  }

  const fields = obj.data.content.fields as any;
  return {
    nextSparkMs: BigInt(fields.next_spark_ms ?? 0),
    nextPulseMs: BigInt(fields.next_pulse_ms ?? 0),
    nextSurgeMs: BigInt(fields.next_surge_ms ?? 0),
    sparkTickets: Number(fields.spark_tickets?.length ?? 0),
    pulseTickets: Number(fields.pulse_tickets?.length ?? 0),
    surgeTickets: Number(fields.surge_tickets?.length ?? 0),
  };
}

async function fetchRewardPoolBalances(client: SuiClient) {
  const obj = await client.getObject({
    id: REWARD_POOL,
    options: { showContent: true },
  });
  if (obj.data?.content?.dataType !== "moveObject") return null;
  const fields = obj.data.content.fields as any;
  return {
    spark: BigInt(fields.spark_pool?.fields?.value ?? 0),
    pulse: BigInt(fields.pulse_pool?.fields?.value ?? 0),
    surge: BigInt(fields.surge_pool?.fields?.value ?? 0),
  };
}

// ── Staker Registry ───────────────────────────────────────────────────────────

interface StakerInfo {
  address: string;
  principalMist: bigint;
}

async function fetchStakers(client: SuiClient): Promise<StakerInfo[]> {
  // Query StakeReceipt objects owned by the Vault (shared)
  // In practice: query all StakeReceipt objects on-chain
  const receipts = await client.queryEvents({
    query: {
      MoveEventType: `${PACKAGE_ID}::stake_vault::Deposited`,
    },
    limit: 50,
  });

  const stakers = new Map<string, bigint>();
  for (const event of receipts.data) {
    const fields = event.parsedJson as any;
    if (fields?.staker && fields?.amount_mist) {
      const addr = fields.staker as string;
      const prev = stakers.get(addr) ?? 0n;
      stakers.set(addr, prev + BigInt(fields.amount_mist));
    }
  }

  return Array.from(stakers.entries()).map(([address, principalMist]) => ({
    address,
    principalMist,
  }));
}

// ── VRF Seed ──────────────────────────────────────────────────────────────────

function generateVrfSeed(): number[] {
  // On testnet: use pseudo-random seed from current timestamp + block height
  // On mainnet: replace with actual Pyth Entropy request/reveal flow
  const now = Date.now();
  const seed: number[] = [];
  for (let i = 0; i < 32; i++) {
    seed.push(Math.floor((now * (i + 1) * 6364136223846793005n % 256n) as any) & 0xff);
  }
  // Simpler approach for testnet:
  const buf = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf);
}

// ── Transaction Builders ──────────────────────────────────────────────────────

async function registerTickets(
  client: SuiClient,
  keypair: Ed25519Keypair,
  stakers: StakerInfo[],
  drawType: "spark" | "pulse" | "surge"
) {
  if (stakers.length === 0) {
    console.log(`  ⚠️  No stakers for ${drawType} — skipping ticket registration`);
    return;
  }

  console.log(`  📝 Registering tickets for ${stakers.length} stakers (${drawType})...`);

  const tx = new TransactionBlock();

  for (const staker of stakers) {
    const stakeInSui = Number(staker.principalMist) / 1_000_000_000;

    // Calculate tickets based on draw type
    let ticketCount: number;
    if (drawType === "spark") {
      ticketCount = Math.min(Math.floor(stakeInSui), 500);
    } else if (drawType === "pulse") {
      ticketCount = stakeInSui < 50 ? 0
        : stakeInSui <= 1000 ? Math.floor(stakeInSui)
        : Math.floor(1000 + Math.sqrt(stakeInSui - 1000));
    } else {
      ticketCount = stakeInSui < 200 ? 0 : Math.floor(stakeInSui);
    }

    if (ticketCount === 0) continue;

    const fnName = `register_${drawType}_tickets`;
    tx.moveCall({
      target: `${PACKAGE_ID}::draw_manager::${fnName}`,
      arguments: [
        tx.object(DRAW_STATE),
        tx.pure.address(staker.address),
        tx.pure.u64(ticketCount),
        tx.object(ADMIN_CAP_DRAW),
      ],
    });
  }

  const result = await client.signAndExecuteTransactionBlock({
    signer: keypair,
    transactionBlock: tx,
    options: { showEffects: true },
  });

  if (result.effects?.status?.status === "success") {
    console.log(`  ✅ Tickets registered — tx: ${result.digest}`);
  } else {
    console.error(`  ❌ Ticket registration failed:`, result.effects?.status);
  }
}

async function triggerDraw(
  client: SuiClient,
  keypair: Ed25519Keypair,
  drawType: "spark" | "pulse" | "surge"
) {
  console.log(`\n🎲 Triggering ${drawType.toUpperCase()} draw...`);

  const vrfSeed = generateVrfSeed();

  const tx = new TransactionBlock();
  const clock = tx.object("0x6"); // Sui shared Clock object

  tx.moveCall({
    target: `${PACKAGE_ID}::draw_manager::trigger_${drawType}`,
    arguments: [
      tx.object(DRAW_STATE),
      tx.object(REWARD_POOL),
      tx.pure(vrfSeed, "vector<u8>"),
      clock,
      tx.object(ADMIN_CAP_DRAW),
    ],
  });

  const result = await client.signAndExecuteTransactionBlock({
    signer: keypair,
    transactionBlock: tx,
    options: { showEffects: true, showEvents: true },
  });

  if (result.effects?.status?.status === "success") {
    console.log(`  ✅ ${drawType.toUpperCase()} draw complete — tx: ${result.digest}`);

    // Log winner events
    for (const event of result.events ?? []) {
      if (event.type?.includes("PrizeAwarded")) {
        const fields = event.parsedJson as any;
        const amtSui = (Number(fields?.amount_mist ?? 0) / 1e9).toFixed(4);
        console.log(`  🏆 Winner: ${fields?.winner} → ${amtSui} SUI`);
      }
    }
  } else {
    console.error(`  ❌ Draw failed:`, result.effects?.status?.error);
  }
}

// ── Main Loop ─────────────────────────────────────────────────────────────────

async function tick(client: SuiClient, keypair: Ed25519Keypair) {
  const now = BigInt(Date.now());
  console.log(`\n⏰ [${new Date().toISOString()}] Checking draws...`);

  let drawTimes: DrawTimes;
  try {
    drawTimes = await fetchDrawState(client);
  } catch (e) {
    console.error("  ❌ Failed to fetch DrawState:", e);
    return;
  }

  const balances = await fetchRewardPoolBalances(client);
  if (balances) {
    const fmt = (n: bigint) => (Number(n) / 1e9).toFixed(4);
    console.log(`  💰 Pools — Spark: ${fmt(balances.spark)} SUI · Pulse: ${fmt(balances.pulse)} SUI · Surge: ${fmt(balances.surge)} SUI`);
  }

  const stakers = await fetchStakers(client);
  console.log(`  👥 Active stakers: ${stakers.length}`);

  // ── Spark (daily) ──
  if (now >= drawTimes.nextSparkMs) {
    if (balances && balances.spark > 0n) {
      await registerTickets(client, keypair, stakers, "spark");
      await triggerDraw(client, keypair, "spark");
    } else {
      console.log("  ℹ️  Spark pool empty — skipping draw");
    }
  } else {
    const secLeft = Number(drawTimes.nextSparkMs - now) / 1000;
    console.log(`  ⚡ Spark: ${formatCountdown(secLeft)} remaining`);
  }

  // ── Pulse (weekly) ──
  if (now >= drawTimes.nextPulseMs) {
    if (balances && balances.pulse > 0n) {
      await registerTickets(client, keypair, stakers, "pulse");
      await triggerDraw(client, keypair, "pulse");
    } else {
      console.log("  ℹ️  Pulse pool empty — skipping draw");
    }
  } else {
    const secLeft = Number(drawTimes.nextPulseMs - now) / 1000;
    console.log(`  🔄 Pulse: ${formatCountdown(secLeft)} remaining`);
  }

  // ── Surge (monthly) ──
  if (now >= drawTimes.nextSurgeMs) {
    if (balances && balances.surge > 0n) {
      await registerTickets(client, keypair, stakers, "surge");
      await triggerDraw(client, keypair, "surge");
    } else {
      console.log("  ℹ️  Surge pool empty — skipping draw");
    }
  } else {
    const secLeft = Number(drawTimes.nextSurgeMs - now) / 1000;
    console.log(`  🌊 Surge: ${formatCountdown(secLeft)} remaining`);
  }
}

function formatCountdown(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

async function main() {
  console.log("🌊 Surge Crank — starting up");
  console.log(`   Network:    ${NETWORK}`);
  console.log(`   Package:    ${PACKAGE_ID}`);
  console.log(`   Poll:       every ${POLL_INTERVAL_MS / 1000}s`);

  validateConfig();

  const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });
  const keypair = loadKeypair();
  console.log(`   Crank addr: ${keypair.getPublicKey().toSuiAddress()}\n`);

  // Run immediately, then on interval
  await tick(client, keypair);
  setInterval(() => tick(client, keypair), POLL_INTERVAL_MS);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});

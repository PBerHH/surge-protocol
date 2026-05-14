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
import { Transaction } from "@mysten/sui/transactions";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromB64 } from "@mysten/sui/utils";
import "dotenv/config";

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
  const buf = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf);
}


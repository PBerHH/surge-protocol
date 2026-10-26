import { useState, useEffect, useCallback, useRef } from "react";
import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

// ── Contract Config ───────────────────────────────────────────────────────────
const PKG_CALL    = "0x4ca98688e6cdf7fb6b73cc01d5ebbf77f947a02f5da570afd2f14bf155942b0c";
const PACKAGE     = "0x35732358f2e0a683fe2014f5781b8ab67146d40ce63a76ac0a30ac52fdb7b2bb";
const PACKAGE_TYPE_ID = "0x330aa337772418f68117556dce74034063f11a8de68f60a99acc9a5ee62f5fb3"; // original-id: struct + event types
const VAULT       = "0x50d8b86e95c8c75892e8cc7caa39a81604de123baf1528cf1c9203d8ab702562";
const DRAW_STATE  = "0xee9f68a29ab16442600a9e12426431b240aed97cdf5108f44d8325401cc25fb0";
const REWARD_POOL = "0xacf68b636a55c96a8269ab0b66d735a7bbfadf058821cc17f97bc32d49d6968f";

const V6_PACKAGE = "0xaf489faa2a23db82265e25c833f2cf9b985eb0a8d4acde121c7e14c111c3b62e";
const V6_VAULT   = "0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5";
const HAEDAL_STAKING    = "0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca";
const HAEDAL_PKG_ORIG   = "0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d";
const HAEDAL_PKG_LATEST = "0x126e4cfb051cad744706df590ec399e8c02b6feae195c35b8b496280d5442a62";

const SUPABASE_URL = "https://dqcjgvotffxutvgvahse.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxY2pndm90ZmZ4dXR2Z3ZhaHNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNjI0MDQsImV4cCI6MjA5NDkzODQwNH0.J6m4cARii-VU3AQIotHY0i6hQC4HOXDZvvcE7MCyVC8";

const LEGACY_PACKAGE  = "0xc44d56c34b04fc54386ed2de7d757133ab77bbab60c18de3d0a1d640298f3396";
const LEGACY_VAULT    = "0x0aa9c18818087b3e9e32c6eef8f3b17ce98670d5ac00eb54fd559d0d98db76be";
const LEGACY2_PACKAGE = "0x51ce7917adc5b9d7e7faa5988dfbbc1e2abbac5ae14cb38834f23e9a1d6109dc";
const LEGACY2_VAULT   = "0x0430bf6c920033e5df27a371071a2f54844da65a103d08e35fb316eaa7134db9";
const LEGACY3_PACKAGE = "0x2755c0b895605f21f67b67f8ba58aa4b4b83759cd0d1a1fbb666ec9355c29d50";
const LEGACY3_VAULT   = "0x5cd4c73e20d876b1105fa49049e1ee903e9eac382867ce1d597719c5877e6a26";
const LEGACY4_PACKAGE = "0x53a50af7d0aeb7190f5b06031b33dc3fb68859c00a767fc6683e6d8c406e2be0";
const LEGACY4_VAULT   = "0x64df43a049c9b24720e9aaa8939072907dda5cca69a7e557424b541ad16071e5";

// ── GraphQL proxy URL (our Fly.io proxy, avoids CORS) ────────────────────────
const PROXY = import.meta.env.VITE_RPC_URL || "https://surge-rpc-proxy.fly.dev";

async function gql(query, variables = {}) {
  const r = await fetch(`${PROXY}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await r.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

// Parse object content fields from GraphQL response
function parseFields(obj) {
  const content = obj?.object?.contents;
  if (!content) return null;
  const fields = {};
  if (content.type?.__typename === "MoveObject" || content.__typename === "MoveObject") {
    // fields come as JSON string in some endpoints
  }
  // Try to parse from json field
  if (content.json) {
    try { return JSON.parse(content.json); } catch { return content.json; }
  }
  return null;
}

// Fetch a single object's content via GraphQL
async function fetchObject(id) {
  const data = await gql(`
    query GetObject($id: SuiAddress!) {
      object(address: $id) {
        asMoveObject { contents { json } }
      }
    }
  `, { id });
  const json = data?.object?.asMoveObject?.contents?.json;
  if (!json) return null;
  try { return typeof json === "string" ? JSON.parse(json) : json; } catch { return null; }
}

// Fetch owned objects of a given type
async function fetchOwnedObjects(owner, structType) {
  const data = await gql(`
    query OwnedObjects($owner: SuiAddress!, $type: String!) {
      address(address: $owner) {
        objects(first: 50, filter: { type: $type }) {
          nodes {
            objectId: address
            contents { json }
          }
        }
      }
    }
  `, { owner, type: structType });
  const nodes = data?.address?.objects?.nodes ?? [];
  return nodes.map(n => {
    const json = n.contents?.json;
    let fields = null;
    try { fields = typeof json === "string" ? JSON.parse(json) : json; } catch {}
    return fields ? { ...fields, objectId: n.objectId } : null;
  }).filter(Boolean);
}

// Query events by event type
async function queryEvents(eventType, limit = 20) {
  const data = await gql(`
    query Events($type: String!, $limit: Int!) {
      events(filter: { type: $type }, last: $limit) {
        nodes {
          contents { json }
          timestamp
        }
      }
    }
  `, { type: eventType, limit });
  return (data?.events?.nodes ?? []).map(n => {
    let parsed = null;
    try { parsed = typeof n.contents?.json === "string" ? JSON.parse(n.contents.json) : n.contents?.json; } catch {}
    return { type: eventType, parsedJson: parsed, timestampMs: n.timestamp ? new Date(n.timestamp).getTime().toString() : "0" };
  });
}

if (typeof window !== "undefined") {
  const urlRef = new URLSearchParams(window.location.search).get("ref");
  if (urlRef && /^0x[a-fA-F0-9]{1,64}$/.test(urlRef) && !localStorage.getItem("surge_ref")) {
    localStorage.setItem("surge_ref", urlRef);
  }
}

function fmt(mist, dec = 3) { return (Number(BigInt(mist ?? 0)) / 1e9).toFixed(dec); }
function fmtSui(mist) {
  const n = Number(BigInt(mist ?? 0)) / 1e9;
  if (n >= 1000) return (n / 1000).toFixed(2) + "K";
  return n.toFixed(3);
}
const MIN_POOL_MIST = 1_000_000n;

function drawStatus(ms, poolMist) {
  const pool = BigInt(poolMist ?? 0);
  if (pool < MIN_POOL_MIST) return { label: "Filling — draws after next harvest", urgent: false };
  return countdown(ms);
}

function countdown(ms) {
  if (!ms || Number(ms) === 0) return { label: "Ready ✓", urgent: true };
  const diff = Number(BigInt(ms)) - Date.now();
  if (diff <= 0) return { label: "Ready ✓", urgent: true };
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (d > 0) return { label: `${d}d ${h}h ${m}m`, urgent: false };
  if (h > 0) return { label: `${h}h ${m}m ${s}s`, urgent: false };
  return { label: `${m}m ${s}s`, urgent: diff < 3600000 };
}

function launchConfetti() {
  const colors = ["#F5C842", "#3ABFAA", "#C67FE8", "#E8A027", "#FF6B35"];
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;";
  document.body.appendChild(container);
  const style = document.createElement("style");
  style.textContent = `@keyframes confetti-fall{to{transform:translateY(110vh) rotate(720deg);opacity:0}}`;
  document.head.appendChild(style);
  for (let i = 0; i < 80; i++) {
    const el = document.createElement("div");
    const color = colors[Math.floor(Math.random() * colors.length)];
    const x = Math.random() * 100;
    const delay = Math.random() * 0.8;
    const dur = 1.5 + Math.random() * 1.5;
    const size = 6 + Math.random() * 8;
    el.style.cssText = `position:absolute;left:${x}%;top:-20px;width:${size}px;height:${size}px;background:${color};border-radius:${Math.random() > 0.5 ? "50%" : "2px"};animation:confetti-fall ${dur}s ${delay}s ease-in forwards;`;
    container.appendChild(el);
  }
  setTimeout(() => { container.remove(); style.remove(); }, 4000);
}

function SecurityBadges() {
  const badges = [
    { icon: "🔐", label: "On-chain VRF", sub: "sui::random" },
    { icon: "🛡️", label: "AdminCap Protected", sub: "No public drain" },
    { icon: "🔒", label: "Principal Safe", sub: "Never at risk" },
    { icon: "⛓️", label: "Open Source", sub: "GitHub verified" },
  ];
  return (
    <div className="sec-badges">
      {badges.map(b => (
        <div key={b.label} style={{ background: "rgba(58,191,170,0.05)", border: "0.5px solid rgba(58,191,170,0.15)", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
          <div style={{ fontSize: 18, marginBottom: 4 }}>{b.icon}</div>
          <div style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", color: "#3ABFAA", fontWeight: 500, marginBottom: 2 }}>{b.label}</div>
          <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: "rgba(255,255,255,0.3)" }}>{b.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Monthly prize event ──────────────────────────────────────────────────────
// One draw per month, 8 ranked prizes. On-chain the yield still lands in three
// buckets (Surge 50% / Pulse 30% / Spark 20%); the crank draws all three at the
// same moment with the same tickets → #1 = Surge pool, #2–#5 = Pulse / 4,
// #6–#8 = Spark / 3. Keep in sync with scripts/crank.js DRAW_NOT_BEFORE_MS.
const FIRST_EVENT_MS = Date.UTC(2026, 10, 8, 19, 0, 0); // Sun 8 Nov 2026 · 20:00 CET
const EVENT_URL = "https://x.com/Surge_Sui"; // Surge Night runs as a live X Space
const TELEGRAM_URL = "https://t.me/surge_sui"; // bot posts countdown + results automatically

function nextEventMs(drawData) {
  const onChain = Number(drawData?.next_surge_ms ?? 0);
  return Math.max(FIRST_EVENT_MS, onChain);
}

function eventDateLabel(ms) {
  const d = new Date(ms);
  const date = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Berlin" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
  return `${date} · ${time} CET`;
}

function prizeLadder(poolData) {
  const surge = Number(BigInt(poolData?.surge_pool ?? 0));
  const pulse = Number(BigInt(poolData?.pulse_pool ?? 0));
  const spark = Number(BigInt(poolData?.spark_pool ?? 0));
  const total = surge + pulse + spark;
  const live = (bucket) => bucket >= Number(MIN_POOL_MIST); // crank skips dust buckets
  const rows = [{ rank: 1, label: "Jackpot", mist: surge, tier: "jackpot", live: live(surge) }];
  for (let i = 0; i < 4; i++) rows.push({ rank: 2 + i, label: "Prize", mist: pulse / 4, tier: "major", live: live(pulse) });
  for (let i = 0; i < 3; i++) rows.push({ rank: 6 + i, label: "Prize", mist: spark / 3, tier: "minor", live: live(spark) });
  return { rows, total };
}

function EventStrip({ drawData }) {
  const label = eventDateLabel(nextEventMs(drawData));
  return (
    <a className="event-strip" href={EVENT_URL} target="_blank" rel="noreferrer">
      <span className="event-strip-dot" />
      <span className="event-strip-k">{Number(drawData?.surge_draw_count ?? 0) === 0 ? "First Surge Night" : "Next Surge Night"}</span>
      <span className="event-strip-v">{label} · live on X</span>
      <span className="event-strip-arrow">→</span>
    </a>
  );
}

function CountTile({ value, unit }) {
  return (
    <div className="ev-tile">
      <div className="ev-tile-num" key={value}>{String(value).padStart(2, "0")}</div>
      <div className="ev-tile-unit">{unit}</div>
    </div>
  );
}

function JackpotEvent({ poolData, drawData, suiPrice }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const eventAt = nextEventMs(drawData);
  const diff = Math.max(0, eventAt - now);
  const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000), sec = Math.floor((diff % 60000) / 1000);
  const { rows, total } = prizeLadder(poolData);
  const drawNo = Number(drawData?.surge_draw_count ?? 0) + 1;
  const pct = (mist) => (total > 0 ? (mist / total) * 100 : 0);

  return (
    <section className="event" aria-label="Monthly prize draw">
      <div className="event-glow" aria-hidden="true" />
      <div className="event-main">
        <div className="event-eyebrow">
          <span>The Surge</span><span className="event-sep">/</span><span>Monthly prize draw</span><span className="event-badge">#{drawNo}</span>
        </div>
        <div className="event-pot-label">Total prize pool</div>
        <div className="event-pot">
          {(total / 1e9).toFixed(3)}<span className="event-pot-unit">SUI</span>
        </div>
        <div className="event-pot-sub">
          8 winners{suiPrice ? ` · ≈ $${((total / 1e9) * suiPrice).toFixed(2)}` : ""} · grows with every harvest until draw night
        </div>

        <div className="event-count" role="timer" aria-live="off">
          {diff > 0 ? <>
            <CountTile value={d} unit="days" />
            <CountTile value={h} unit="hrs" />
            <CountTile value={m} unit="min" />
            <CountTile value={sec} unit="sec" />
          </> : <div className="event-live-now">● Drawing now</div>}
        </div>
        <div className="event-when">{eventDateLabel(eventAt)} · drawn on-chain with <code>sui::random</code></div>
        <div className="event-links">
          <a href={EVENT_URL} target="_blank" rel="noreferrer">Live on X →</a>
          <a href={TELEGRAM_URL} target="_blank" rel="noreferrer">Reminders &amp; results on Telegram →</a>
        </div>

        <div className="event-rules">
          <span>1 SUI = 1 ticket</span>
          <span>Stake early, hold more</span>
          <span>Principal never at risk</span>
          <span>Team wallets excluded</span>
        </div>
      </div>

      <ol className="ladder" aria-label="Prize ladder">
        {rows.map((r, i) => (
          <li key={r.rank} className={`stub stub-${r.tier}${r.live ? "" : " stub-idle"}`} style={{ "--i": i }}>
            <span className="stub-rank">{r.rank}</span>
            <span className="stub-label">{r.label}</span>
            <span className="stub-amt">{r.live ? `${(r.mist / 1e9).toFixed(r.tier === "jackpot" ? 3 : 4)} SUI` : "filling"}</span>
            <span className="stub-pct">{pct(r.mist).toFixed(1)}%</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function App() {
  const account = useCurrentAccount();
  const { mutate: signAndExecute } = useSignAndExecuteTransaction();

  const [poolData, setPoolData] = useState(null);
  const [drawData, setDrawData] = useState(null);
  const [vaultData, setVaultData] = useState(null);
  const [v6VaultData, setV6VaultData] = useState(null);
  const [haRate, setHaRate] = useState(null);
  const [pointsData, setPointsData] = useState(null);
  const [v6Receipts, setV6Receipts] = useState([]);
  const [haTickets, setHaTickets] = useState([]);
  const [stakeAmount, setStakeAmount] = useState("100");
  const [txStatus, setTxStatus] = useState(null);
  const [userReceipts, setUserReceipts] = useState([]);
  const [legacyReceipts, setLegacyReceipts] = useState([]);
  const [legacyStatus, setLegacyStatus] = useState(null);
  const [tick, setTick] = useState(0);
  const [suiPrice, setSuiPrice] = useState(null);
  const [lastWinners, setLastWinners] = useState([]);
  const [myWinnings, setMyWinnings] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [stakerCount, setStakerCount] = useState(0);
  const [openFaq, setOpenFaq] = useState(null);
  const [activeTab, setActiveTab] = useState("stake");
  const [loyaltyData, setLoyaltyData] = useState(null);
  const prevWinnersRef = useRef([]);

  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 1000); return () => clearInterval(t); }, []);

  // ── Main data fetch (objects) ─────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const [pool, draw, vault, v6vault] = await Promise.all([
        fetchObject(REWARD_POOL),
        fetchObject(DRAW_STATE),
        fetchObject(VAULT),
        fetchObject(V6_VAULT),
      ]);
      if (pool) setPoolData(pool);
      if (draw) setDrawData(draw);
      if (vault) setVaultData(vault);
      if (v6vault) setV6VaultData(v6vault);
    } catch (e) { console.error("fetchData:", e); }
  }, []);

  useEffect(() => { fetchData(); const t = setInterval(fetchData, 15000); return () => clearInterval(t); }, [fetchData]);

  // ── Recent winners ────────────────────────────────────────────────────────
  const fetchLastWinners = useCallback(async () => {
    try {
      const [ev1, ev2] = await Promise.all([
        queryEvents(`${PACKAGE_TYPE_ID}::reward_pool::PrizeAwarded`, 20),
        queryEvents(`${PKG_CALL}::reward_pool::PrizeAwarded`, 20),
      ]);
      const all = [...ev1, ...ev2];
      const winners = all
        .filter(e => e.parsedJson?.amount_mist && Number(e.parsedJson.amount_mist) > 0)
        .map(e => ({
          winner: e.parsedJson.winner,
          amount: Number(e.parsedJson.amount_mist) / 1e9,
          pool: ['Prize', 'Prize', 'Jackpot'][e.parsedJson.pool] ?? 'Prize',
          ts: e.timestampMs,
        }))
        .sort((a, b) => Number(b.ts) - Number(a.ts));
      if (prevWinnersRef.current.length > 0 && winners.length > 0 && winners[0]?.ts !== prevWinnersRef.current[0]?.ts) launchConfetti();
      prevWinnersRef.current = winners;
      setLastWinners(winners);
    } catch (e) { console.error("fetchLastWinners:", e); }
  }, []);

  useEffect(() => { fetchLastWinners(); const t = setInterval(fetchLastWinners, 15000); return () => clearInterval(t); }, [fetchLastWinners]);

  // ── User receipts ─────────────────────────────────────────────────────────
  const fetchReceipts = useCallback(async () => {
    if (!account?.address) return;
    try {
      const [r1, r2] = await Promise.all([
        fetchOwnedObjects(account.address, `${PACKAGE_TYPE_ID}::stake_vault::StakingReceipt`),
        fetchOwnedObjects(account.address, `${PKG_CALL}::stake_vault::StakingReceipt`),
      ]);
      setUserReceipts([...r1, ...r2]);
    } catch (e) { console.error("V5 receipts:", e); setUserReceipts([]); }
    try {
      const v6res = await fetchOwnedObjects(account.address, `${V6_PACKAGE}::stake_vault_v6::StakeReceiptV6`);
      setV6Receipts(v6res);
    } catch (e) { console.error("V6 receipts:", e); setV6Receipts([]); }
    try {
      const tix = await fetchOwnedObjects(account.address, `${HAEDAL_PKG_ORIG}::staking::UnstakeTicket`);
      setHaTickets(tix.map(t => ({ id: t.objectId })).filter(t => t.id));
    } catch (e) { console.error("Haedal tickets:", e); setHaTickets([]); }
  }, [account]);

  useEffect(() => { fetchReceipts(); }, [fetchReceipts]);

  const loyaltyFromDays = (daysStaked, streakDays = 0) => {
    let baseBp = daysStaked >= 365 ? 20000 : daysStaked >= 180 ? 18000 : daysStaked >= 90 ? 15000 : daysStaked >= 30 ? 12000 : 10000;
    const totalBp = Math.min(baseBp + Math.floor((streakDays * 3000) / 30), 20000);
    return totalBp / 10000;
  };

  const fetchLoyalty = useCallback(async () => {
    if (!account?.address) return;
    try {
      const [r1, r2] = await Promise.all([
        fetchOwnedObjects(account.address, `${PACKAGE_TYPE_ID}::loyalty_tracker::LoyaltyRecord`),
        fetchOwnedObjects(account.address, `${PKG_CALL}::loyalty_tracker::LoyaltyRecord`),
      ]);
      const objs = [...r1, ...r2];
      if (objs.length > 0) {
        const f = objs[0];
        if (f) {
          const daysStaked = Math.floor((Date.now() - Number(f.stake_start_ms)) / 86400000);
          const streakDays = Math.min(Number(f.streak_days ?? 0), 30);
          setLoyaltyData({ daysStaked, streakDays, multiplier: loyaltyFromDays(daysStaked, streakDays) });
          return;
        }
      }
      if (v6Receipts.length > 0) {
        const earliestMs = Math.min(...v6Receipts.map(r => Number(r.deposit_ts_ms ?? Date.now())));
        const daysStaked = Math.floor((Date.now() - earliestMs) / 86400000);
        setLoyaltyData({ daysStaked, streakDays: 0, multiplier: loyaltyFromDays(daysStaked, 0) });
      } else {
        setLoyaltyData(null);
      }
    } catch (e) { console.error("loyalty:", e); }
  }, [account, v6Receipts]);

  useEffect(() => { fetchLoyalty(); }, [fetchLoyalty]);

  const fetchLegacyReceipts = useCallback(async () => {
    if (!account?.address) return;
    try {
      const [o1, o2, o3, o4] = await Promise.all([
        fetchOwnedObjects(account.address, `${LEGACY_PACKAGE}::stake_vault::StakeReceipt`),
        fetchOwnedObjects(account.address, `${LEGACY2_PACKAGE}::stake_vault::StakeReceipt`),
        fetchOwnedObjects(account.address, `${LEGACY3_PACKAGE}::stake_vault::StakeReceipt`),
        fetchOwnedObjects(account.address, `${LEGACY4_PACKAGE}::stake_vault::StakeReceipt`),
      ]);
      const map = (objs, pkg, vault) => objs.map(f => f ? { ...f, legacyPkg: pkg, legacyVault: vault } : null).filter(Boolean);
      setLegacyReceipts([...map(o1, LEGACY_PACKAGE, LEGACY_VAULT), ...map(o2, LEGACY2_PACKAGE, LEGACY2_VAULT), ...map(o3, LEGACY3_PACKAGE, LEGACY3_VAULT), ...map(o4, LEGACY4_PACKAGE, LEGACY4_VAULT)]);
    } catch (e) { console.error("legacy:", e); }
  }, [account]);

  useEffect(() => { fetchLegacyReceipts(); }, [fetchLegacyReceipts]);

  const fetchMyWinnings = useCallback(async () => {
    if (!account?.address) return;
    try {
      const [ev1, ev2] = await Promise.all([
        queryEvents(`${PACKAGE_TYPE_ID}::reward_pool::PrizeAwarded`, 50),
        queryEvents(`${PKG_CALL}::reward_pool::PrizeAwarded`, 50),
      ]);
      const all = [...ev1, ...ev2];
      setMyWinnings(all
        .filter(e => e.parsedJson?.winner === account.address)
        .map(e => ({ amount: Number(e.parsedJson.amount_mist) / 1e9, pool: ['Prize', 'Prize', 'Jackpot'][e.parsedJson.pool] ?? 'Prize', ts: e.timestampMs })));
    } catch (e) { console.error("myWinnings:", e); }
  }, [account]);

  useEffect(() => { fetchMyWinnings(); }, [fetchMyWinnings]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const [stakedV6, unstakedV6] = await Promise.all([
        queryEvents(`${V6_PACKAGE}::stake_vault_v6::StakedV6`, 200),
        queryEvents(`${V6_PACKAGE}::stake_vault_v6::UnstakedV6`, 200),
      ]);
      const stakes = {};
      for (const ev of stakedV6) {
        const f = ev.parsedJson;
        if (f?.owner && f?.principal_mist) stakes[f.owner] = (stakes[f.owner] ?? 0n) + BigInt(f.principal_mist);
      }
      for (const ev of unstakedV6) {
        const f = ev.parsedJson;
        if (f?.owner && f?.principal_mist) stakes[f.owner] = (stakes[f.owner] ?? 0n) - BigInt(f.principal_mist);
      }
      for (const a of Object.keys(stakes)) { if (stakes[a] <= 0n) delete stakes[a]; }
      setStakerCount(Object.keys(stakes).length);
      setLeaderboard(Object.entries(stakes).sort((a, b) => b[1] > a[1] ? 1 : -1).slice(0, 10).map(([addr, mist], i) => ({ rank: i + 1, addr, sui: Number(mist) / 1e9 })));
    } catch (e) { console.error("leaderboard:", e); }
  }, []);

  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

  useEffect(() => {
    if (!account?.address || !SUPABASE_ANON_KEY) { setPointsData(null); return; }
    (async () => {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/wallets?address=eq.${account.address}&select=total_points,multiplier,early_bird_rank,pioneer_rank,referral_bonus,referral_count`, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        });
        const rows = await r.json();
        if (Array.isArray(rows) && rows[0]) setPointsData(rows[0]);
      } catch { }
    })();
  }, [account?.address]);

  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd")
      .then(r => r.json()).then(d => setSuiPrice(d?.sui?.usd ?? null)).catch(() => {});
  }, []);

  // ── Wallet interactions (unchanged — use dapp-kit for signing) ────────────
  async function handleStake() {
    if (!account) return;
    const amt = Math.floor(parseFloat(stakeAmount) * 1e9);
    if (amt < 1e9) { setTxStatus({ type: "error", msg: "Minimum 1 SUI" }); return; }
    setTxStatus({ type: "pending", msg: "Confirm in wallet..." });
    try {
      const tx = new Transaction();
      tx.setGasPrice(1000);
      const [coin] = tx.splitCoins(tx.gas, [amt]);
      tx.moveCall({
        target: `${V6_PACKAGE}::stake_vault_v6::stake`,
        arguments: [
          tx.object(V6_VAULT),
          tx.sharedObjectRef({ objectId: "0x0000000000000000000000000000000000000000000000000000000000000005", initialSharedVersion: 1, mutable: true }),
          tx.object(HAEDAL_STAKING),
          coin,
          tx.object("0x6"),
        ],
      });
      signAndExecute({ transaction: tx }, {
        onSuccess: (r) => {
          setTxStatus({ type: "success", msg: `Staked! Tx: ${r.digest.slice(0,16)}...` });
          const refAddr = typeof window !== "undefined" ? localStorage.getItem("surge_ref") : null;
          if (refAddr && account?.address && refAddr !== account.address) {
            fetch(`${SUPABASE_URL}/rest/v1/referrals`, {
              method: "POST",
              headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
              body: JSON.stringify({ referrer_address: refAddr, referred_address: account.address }),
            }).catch(() => {});
          }
          setTimeout(() => { fetchData(); fetchReceipts(); fetchLoyalty(); fetchLeaderboard(); }, 3000);
        },
        onError: (e) => setTxStatus({ type: "error", msg: e.message }),
      });
    } catch (e) { setTxStatus({ type: "error", msg: e.message }); }
  }

  async function handleUnstakeV6(receiptId) {
    setTxStatus({ type: "pending", msg: "Requesting unstake..." });
    const tx = new Transaction();
    tx.setGasPrice(1000);
    tx.moveCall({
      target: `${V6_PACKAGE}::stake_vault_v6::request_unstake`,
      arguments: [tx.object(V6_VAULT), tx.object(HAEDAL_STAKING), tx.object(receiptId), tx.object("0x6")],
    });
    signAndExecute({ transaction: tx }, {
      onSuccess: () => { setTxStatus({ type: "success", msg: "Unstake started — your SUI redemption ticket appears below, claimable after 1–2 epochs (~1–2 days)" }); setTimeout(fetchReceipts, 3000); },
      onError: (e) => setTxStatus({ type: "error", msg: e.message }),
    });
  }

  async function handleClaimTicket(ticketId) {
    setTxStatus({ type: "pending", msg: "Claiming redemption..." });
    const tx = new Transaction();
    tx.setGasPrice(1000);
    tx.moveCall({
      target: `${HAEDAL_PKG_LATEST}::interface::claim_v2`,
      arguments: [
        tx.sharedObjectRef({ objectId: "0x0000000000000000000000000000000000000000000000000000000000000005", initialSharedVersion: 1, mutable: true }),
        tx.object(HAEDAL_STAKING),
        tx.object(ticketId),
      ],
    });
    signAndExecute({ transaction: tx }, {
      onSuccess: (r) => { setTxStatus({ type: "success", msg: `Claimed! Your SUI is back in your wallet. Tx: ${r.digest.slice(0,16)}...` }); setTimeout(() => { fetchReceipts(); fetchData(); }, 3000); },
      onError: (e) => setTxStatus({ type: "error", msg: e.message?.includes("6)") ? "Not matured yet — redemption takes 1–2 epochs (~1–2 days). Try again later." : e.message }),
    });
  }

  async function handleUnstake(receiptId) {
    setTxStatus({ type: "pending", msg: "Requesting unstake..." });
    const tx = new Transaction();
    tx.setGasPrice(1000);
    tx.moveCall({
      target: `${PKG_CALL}::stake_vault::request_unstake_staked`,
      arguments: [tx.object(VAULT), tx.object(receiptId), tx.object("0x6")],
    });
    signAndExecute({ transaction: tx }, {
      onSuccess: () => { setTxStatus({ type: "success", msg: "Unstake requested — withdrawable in ~24h (1 epoch)" }); setTimeout(fetchReceipts, 3000); },
      onError: (e) => setTxStatus({ type: "error", msg: e.message }),
    });
  }

  async function handleWithdraw(receiptId) {
    if (!account) return;
    setTxStatus({ type: "pending", msg: "Preparing withdrawal..." });
    try {
      const loyaltyObjs = await fetchOwnedObjects(account.address, `${PACKAGE_TYPE_ID}::loyalty_tracker::LoyaltyRecord`);
      const hasRecord = loyaltyObjs.length > 0;
      const tx = new Transaction();
      tx.setGasPrice(1000);
      const loyaltyArg = hasRecord
        ? tx.object(loyaltyObjs[0].objectId)
        : tx.moveCall({ target: `${PKG_CALL}::loyalty_tracker::new_record`, arguments: [tx.object("0x6")] });
      tx.moveCall({
        target: `${PKG_CALL}::stake_vault::withdraw_staked`,
        arguments: [tx.object(VAULT), tx.object(receiptId), loyaltyArg, tx.object("0x6")],
      });
      if (!hasRecord) tx.transferObjects([loyaltyArg], tx.pure.address(account.address));
      signAndExecute({ transaction: tx }, {
        onSuccess: (r) => { setTxStatus({ type: "success", msg: `Withdrawn! Tx: ${r.digest.slice(0,16)}...` }); setTimeout(() => { fetchReceipts(); fetchData(); fetchLoyalty(); }, 3000); },
        onError: (e) => setTxStatus({ type: "error", msg: e.message?.includes("InsufficientLiquidity") || e.message?.includes("E_INSUFFICIENT") ? "Buffer not topped up yet — retry after the next harvest (~1 epoch)." : e.message }),
      });
    } catch (e) { setTxStatus({ type: "error", msg: e.message }); }
  }

  async function handleLegacyRequestUnstake(receiptId, pkg) {
    setLegacyStatus({ type: "pending", msg: "Requesting unstake..." });
    try {
      const tx = new Transaction();
      tx.setGasPrice(1000);
      tx.moveCall({ target: `${pkg}::stake_vault::request_unstake`, arguments: [tx.object(receiptId), tx.object("0x6")] });
      signAndExecute({ transaction: tx }, {
        onSuccess: (r) => { setLegacyStatus({ type: "success", msg: `Requested! Tx: ${r.digest.slice(0,16)}...` }); setTimeout(fetchLegacyReceipts, 3000); },
        onError: (e) => setLegacyStatus({ type: "error", msg: e.message }),
      });
    } catch (e) { setLegacyStatus({ type: "error", msg: e.message }); }
  }

  async function handleLegacyWithdraw(receiptId, pkg, vault) {
    setLegacyStatus({ type: "pending", msg: "Step 1/2: Creating loyalty record..." });
    try {
      const tx1 = new Transaction();
      tx1.setGasPrice(1000);
      const record = tx1.moveCall({ target: `${pkg}::loyalty_tracker::new_record`, arguments: [tx1.object("0x6")] });
      tx1.transferObjects([record], tx1.pure.address(account.address));
      signAndExecute({ transaction: tx1 }, {
        onSuccess: async () => {
          setLegacyStatus({ type: "pending", msg: "Step 2/2: Withdrawing SUI..." });
          await new Promise(res => setTimeout(res, 3000));
          const objs = await fetchOwnedObjects(account.address, `${pkg}::loyalty_tracker::LoyaltyRecord`);
          if (!objs.length) { setLegacyStatus({ type: "error", msg: "LoyaltyRecord not found" }); return; }
          const loyaltyId = objs[0].objectId;
          const needsSuiSystem = pkg === LEGACY_PACKAGE || pkg === LEGACY2_PACKAGE;
          const tx2 = new Transaction();
          tx2.setGasPrice(1000);
          if (needsSuiSystem) {
            tx2.moveCall({
              target: `${pkg}::stake_vault::withdraw`,
              arguments: [tx2.object(vault), tx2.sharedObjectRef({ objectId: "0x0000000000000000000000000000000000000000000000000000000000000005", initialSharedVersion: 1, mutable: true }), tx2.object(receiptId), tx2.object(loyaltyId), tx2.object("0x6")],
            });
          } else {
            tx2.moveCall({
              target: `${pkg}::stake_vault::withdraw`,
              arguments: [tx2.object(vault), tx2.object(receiptId), tx2.object(loyaltyId), tx2.object("0x6")],
            });
          }
          signAndExecute({ transaction: tx2 }, {
            onSuccess: (r2) => { setLegacyStatus({ type: "success", msg: `Withdrawn! Tx: ${r2.digest.slice(0,16)}...` }); setTimeout(fetchLegacyReceipts, 3000); },
            onError: (e) => setLegacyStatus({ type: "error", msg: e.message }),
          });
        },
        onError: (e) => setLegacyStatus({ type: "error", msg: e.message }),
      });
    } catch (e) { setLegacyStatus({ type: "error", msg: e.message }); }
  }

  function handleShare() {
    const pot = fmtSui([poolData?.spark_pool, poolData?.pulse_pool, poolData?.surge_pool].reduce((acc, v) => acc + BigInt(v ?? 0), 0n));
    const text = `🌊 Surge Night on Sui — ${pot} SUI prize pool, 8 winners, ${eventDateLabel(nextEventMs(drawData))}.\n\nStake SUI, keep 100% of your principal. Only the yield is raffled. 1 SUI = 1 ticket.\n\nhttps://surgeonsui.com`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
  }

  const sui = parseFloat(stakeAmount) || 0;
  const totalStaked = BigInt(vaultData?.total_principal ?? 0) + BigInt(v6VaultData?.total_principal ?? 0);
  // Mirrors crank planTickets() + weightStakers(): 1 ticket per unit of stake,
  // each receipt weighted by min(1, time staked before the draw / 30 days).
  const TICKET_CYCLE_MS = 30 * 86400000;
  const eventAtMs = nextEventMs(drawData);
  const weightAt = (depositMs) => Math.min(1, Math.max(0, eventAtMs - depositMs) / TICKET_CYCLE_MS);
  const ticketUnitSui = Math.max(1, Math.ceil((Number(totalStaked) / 1e9 + sui) / 2000));
  const newStakeWeight = weightAt(Date.now());
  const drawTickets = sui >= 1 ? Math.floor((sui * newStakeWeight) / ticketUnitSui) : 0;
  const myWeightedSui = v6Receipts.reduce((acc, r) => acc + (Number(BigInt(r.principal_mist ?? 0)) / 1e9) * weightAt(Number(r.deposit_ts_ms ?? Date.now())), 0);
  const myTicketsAtDraw = Math.floor(myWeightedSui / ticketUnitSui);
  const sparkTickets = drawTickets;
  const pulseTickets = drawTickets;
  const surgeTickets = drawTickets;
  const pioneerTaken = stakerCount;
  const pioneerLeft = Math.max(0, 1000 - pioneerTaken);
  const earlyBirdLeft = Math.max(0, 100 - pioneerTaken);
  const totalPrizes = [poolData?.spark_pool, poolData?.pulse_pool, poolData?.surge_pool].reduce((acc, v) => acc + Number(BigInt(v ?? 0)), 0);
  const myV6Mist = v6Receipts.reduce((acc, r) => acc + Number(BigInt(r.principal_mist ?? 0)), 0);
  const myV5Mist = userReceipts.reduce((acc, r) => acc + Number(BigInt(r.principal_mist ?? 0)), 0);
  const myStakeSui = (myV6Mist + myV5Mist) / 1e9;
  const myTotalWon = myWinnings.reduce((acc, w) => acc + w.amount, 0);

  const LOYALTY_TIERS = [
    { days: 0,   mult: 1.0 },
    { days: 30,  mult: 1.2 },
    { days: 90,  mult: 1.5 },
    { days: 180, mult: 1.8 },
    { days: 365, mult: 2.0 },
  ];
  const loyaltyProgress = (() => {
    if (!loyaltyData) return 5;
    const d = loyaltyData.daysStaked;
    const currentIdx = [...LOYALTY_TIERS].reverse().findIndex(t => d >= t.days);
    const idx = LOYALTY_TIERS.length - 1 - currentIdx;
    if (idx >= LOYALTY_TIERS.length - 1) return 100;
    const from = LOYALTY_TIERS[idx].days;
    const to   = LOYALTY_TIERS[idx + 1].days;
    return Math.min(((d - from) / (to - from)) * 100, 100);
  })();
  const loyaltyNextTier = (() => {
    if (!loyaltyData) return null;
    const d = loyaltyData.daysStaked;
    const next = LOYALTY_TIERS.find(t => t.days > d);
    return next ? { days: next.days, mult: next.mult, daysLeft: next.days - d } : null;
  })();


  const tabs = [
    { id: "stake", label: "Stake" },
    { id: "winners", label: `Winners${lastWinners.length > 0 ? ` (${lastWinners.length})` : ""}` },
    { id: "leaderboard", label: "Leaderboard" },
    { id: "mywinnings", label: `My Wins${myWinnings.length > 0 ? ` (${myWinnings.length})` : ""}` },
  ];

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-left"><div className="nav-logo">SURGE</div></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={handleShare} style={{ background: "transparent", border: "0.5px solid var(--border2)", borderRadius: 8, padding: "6px 12px", fontSize: 11, fontFamily: "'DM Mono',monospace", color: "var(--text2)", cursor: "pointer" }}>
            𝕏 Share
          </button>
          <ConnectButton />
        </div>
      </nav>

      <div style={{ padding: "8px 2rem 0" }}>
        <EventStrip drawData={drawData} />
      </div>

      <header className="hero">
        <div className="hero-eyebrow">Prize-linked staking on Sui</div>
        <h1 className="hero-title">Your principal is safe.<br /><em>Only the yield wins prizes.</em></h1>

        <div style={{ display: "flex", gap: "1px", maxWidth: 520, margin: "2.5rem auto 0", background: "rgba(255,255,255,0.06)", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ flex: 1, padding: "1.5rem 1.75rem", background: "rgba(255,255,255,0.03)", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <div style={{ fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>Total Staked</div>
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1 }}>{fmtSui(totalStaked)}<span style={{ fontSize: "0.9rem", fontWeight: 400, color: "rgba(255,255,255,0.4)", marginLeft: 6 }}>SUI</span></div>
            <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.25)" }}>Principal protected</div>
          </div>
          <div style={{ width: 1, background: "rgba(255,255,255,0.06)" }} />
          <div style={{ flex: 1, padding: "1.5rem 1.75rem", background: "rgba(198,127,232,0.05)", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <div style={{ fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(198,127,232,0.6)", fontWeight: 600 }}>Prize Pool</div>
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "#C67FE8", letterSpacing: "-0.02em", lineHeight: 1, textShadow: "0 0 24px rgba(198,127,232,0.4)" }}>{fmtSui(totalPrizes)}<span style={{ fontSize: "0.9rem", fontWeight: 400, color: "rgba(198,127,232,0.5)", marginLeft: 6 }}>SUI</span></div>
            <div style={{ fontSize: "0.75rem", color: "rgba(198,127,232,0.35)" }}>8 prizes · {eventDateLabel(nextEventMs(drawData))}</div>
          </div>
          {account && myStakeSui > 0 && <>
            <div style={{ width: 1, background: "rgba(255,255,255,0.06)" }} />
            <div style={{ flex: 1, padding: "1.5rem 1.75rem", background: "rgba(58,191,170,0.05)", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <div style={{ fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(58,191,170,0.6)", fontWeight: 600 }}>My Stake</div>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: "#3ABFAA", letterSpacing: "-0.02em", lineHeight: 1 }}>{myStakeSui.toFixed(3)}<span style={{ fontSize: "0.9rem", fontWeight: 400, color: "rgba(58,191,170,0.5)", marginLeft: 6 }}>SUI</span></div>
              <div style={{ fontSize: "0.75rem", color: "rgba(58,191,170,0.4)" }}>{suiPrice ? `≈ $${(myStakeSui * suiPrice).toFixed(2)} USD` : "Loading..."}</div>
            </div>
          </>}
        </div>

        {pioneerLeft > 0 && (
          <div style={{ maxWidth: 520, margin: "1rem auto 0", padding: "0.85rem 1.25rem", borderRadius: 12, border: "1px solid rgba(245,200,66,0.3)", background: "linear-gradient(90deg, rgba(245,200,66,0.08), rgba(198,127,232,0.06))", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.8rem", color: "#F5C842", fontWeight: 600, letterSpacing: "0.04em" }}>
              🚀 PIONEER PHASE — {pioneerTaken}/1000 joined
            </div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.72rem", color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
              {earlyBirdLeft > 0
                ? `First 100 stakers earn 3x points forever (${earlyBirdLeft} left) · first 1000 earn 2x`
                : `First 1000 stakers earn 2x points forever (${pioneerLeft} left)`}
            </div>
          </div>
        )}
      </header>

      <main className="main">
        <SecurityBadges />

        <JackpotEvent poolData={poolData} drawData={drawData} suiPrice={suiPrice} />

        <div style={{ display: "flex", gap: 4, background: "var(--bg3)", borderRadius: 10, padding: 4 }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ flex: 1, padding: "7px 4px", background: activeTab === tab.id ? "var(--bg2)" : "transparent", border: activeTab === tab.id ? "0.5px solid var(--border2)" : "none", borderRadius: 7, fontSize: 11, fontFamily: "'DM Mono',monospace", color: activeTab === tab.id ? "var(--text)" : "var(--text2)", cursor: "pointer", transition: "all 0.15s" }}>{tab.label}</button>
          ))}
        </div>

        {activeTab === "stake" && <>
          {pointsData && (
            <section className="panel" style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "baseline", justifyContent: "space-between", borderColor: "rgba(245,200,66,0.35)" }}>
              <div>
                <div className="panel-title" style={{ margin: 0, color: "#F5C842" }}>
                  {pointsData.early_bird_rank ? `🌟 Early Bird #${pointsData.early_bird_rank}` : pointsData.pioneer_rank ? `🏆 Pioneer #${pointsData.pioneer_rank}` : "👤 Points"}
                </div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: "1.8rem", color: "#F5C842", marginTop: "0.3rem" }}>
                  {Number(pointsData.total_points ?? 0).toFixed(2)} <span style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.4)" }}>pts</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: "1.4rem", color: "#F5C842" }}>{Number(pointsData.multiplier ?? 1).toFixed(1)}x</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(255,255,255,0.35)" }}>multiplier · forever</div>
              </div>
              {account?.address && (
                <div style={{ width: "100%", marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(245,200,66,0.15)" }}>
                  <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.45)", marginBottom: "0.35rem" }}>YOUR REFERRAL LINK</div>
                  <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.5rem", lineHeight: 1.5 }}>
                    Share it — when someone stakes through your link, you earn up to +50% extra points for as long as they stay staked.
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <code style={{ fontSize: "0.78rem", color: "#F5C842", background: "rgba(245,200,66,0.08)", padding: "0.3rem 0.6rem", borderRadius: 6, wordBreak: "break-all" }}>
                      surgeonsui.com/?ref={account.address}
                    </code>
                    <button onClick={() => navigator.clipboard.writeText(`https://surgeonsui.com/?ref=${account.address}`)} style={{ fontSize: "0.72rem", padding: "0.3rem 0.7rem", borderRadius: 6, border: "1px solid rgba(245,200,66,0.3)", background: "transparent", color: "#F5C842", cursor: "pointer" }}>Copy</button>
                    <a href={`https://x.com/intent/tweet?text=${encodeURIComponent("Staking SUI with zero risk to principal. Only the yield wins prizes — join via my link: https://surgeonsui.com/?ref=" + account.address)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.72rem", padding: "0.3rem 0.7rem", borderRadius: 6, border: "1px solid rgba(29,155,240,0.4)", background: "transparent", color: "rgba(29,155,240,0.9)", cursor: "pointer", textDecoration: "none" }}>Share on X</a>
                  </div>
                  {pointsData?.referral_count > 0 && (
                    <div style={{ fontSize: "0.72rem", color: "rgba(58,191,170,0.7)", marginTop: "0.4rem" }}>
                      +{(pointsData.referral_bonus * 100).toFixed(0)}% bonus from {pointsData.referral_count} active referral{pointsData.referral_count === 1 ? "" : "s"}
                    </div>
                  )}
                  <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.35)", marginTop: "0.6rem", paddingTop: "0.5rem", borderTop: "1px solid rgba(245,200,66,0.1)", lineHeight: 1.5 }}>
                    Points = stake × multiplier × time. Early Bird / Pioneer status locks your multiplier in <b style={{ color: "rgba(245,200,66,0.6)" }}>forever</b>.
                  </div>
                </div>
              )}
            </section>
          )}
          <div className="two-col">
            <section className="panel stake-panel">
              <div className="panel-title">Deposit SUI</div>
              <div className="input-row">
                <input className="stake-input" type="number" value={stakeAmount} onChange={e => { setStakeAmount(e.target.value); setTxStatus(null); }} placeholder="100" min="1" />
                <span className="input-denom">SUI</span>
              </div>
              <div className="ticket-one">
                <div>
                  <div className="ticket-one-k">Tickets on draw night</div>
                  <div className="ticket-one-v">{drawTickets > 0 ? `+${drawTickets}` : "—"}</div>
                  <div className="ticket-one-sub">{sui >= 1 ? `${Math.round(newStakeWeight * 100)}% of ${Math.floor(sui)} · tickets fill over 30 days` : "min 1 SUI"}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="ticket-one-k">Jackpot chance</div>
                  <div className="ticket-one-odds">{drawTickets + myTicketsAtDraw > 0 ? `≥ ${Math.min(100, ((drawTickets + myTicketsAtDraw) / Math.max(1, Number(totalStaked) / 1e9 + sui)) * 100).toFixed(1)}%` : "—"}</div>
                  {account && myTicketsAtDraw > 0 && <div className="ticket-one-sub">you already hold {myTicketsAtDraw}</div>}
                </div>
              </div>
              {txStatus && <div className={`tx-status ${txStatus.type}`}>{txStatus.msg}</div>}
              <button className="stake-btn" onClick={handleStake} disabled={!account || txStatus?.type === "pending"}>
                {!account ? "Connect wallet to stake" : txStatus?.type === "pending" ? "Confirming..." : `Stake ${stakeAmount || "0"} SUI`}
              </button>
              <p className="stake-note">Principal always protected · 1-epoch unstake · On-chain VRF</p>
            </section>

            <section className="panel loyalty-panel">
              <div className="panel-title">Loyalty Multiplier</div>
              <div className="loyalty-tiers">
                {[{ days: "0d", mult: "1.0x", threshold: 0 }, { days: "30d", mult: "1.2x", threshold: 30 }, { days: "90d", mult: "1.5x", threshold: 90 }, { days: "180d", mult: "1.8x", threshold: 180 }, { days: "365d", mult: "2.0x", threshold: 365 }].map(t => {
                  const active = loyaltyData ? loyaltyData.daysStaked >= t.threshold : t.threshold === 0;
                  return <div className={`tier ${active ? "current" : ""}`} key={t.days}><div className="tier-mult">{t.mult}</div><div className="tier-days">{t.days}</div></div>;
                })}
              </div>
              <div className="loyalty-track"><div className="loyalty-fill" style={{ width: `${loyaltyProgress}%` }} /></div>
              {loyaltyData && (
                <div style={{ fontSize: 12, fontFamily: "'DM Mono',monospace", color: "#E8A027", marginBottom: 6 }}>
                  {loyaltyData.multiplier.toFixed(2)}x · {loyaltyData.daysStaked}d staked{loyaltyNextTier ? ` · next ${loyaltyNextTier.mult.toFixed(1)}x in ${loyaltyNextTier.daysLeft}d` : ' · max tier 🏆'}
                </div>
              )}
              <p className="loyalty-note">Streak bonus up to +0.3x · Resets on full withdrawal</p>
              <div className="info-rows">
                <div className="info-row"><span>Min. deposit</span><span>1 SUI</span></div>
                <div className="info-row"><span>Prize draw</span><span>Monthly · 8 winners</span></div>
                <div className="info-row"><span>Draw entry</span><span>1 SUI</span></div>
                <div className="info-row"><span>Odds</span><span>Linear · 1 SUI = 1 ticket</span></div>
                <div className="info-row"><span>Tickets</span><span>Fill up over 30 days</span></div>
                <div className="info-row"><span>Unstake delay</span><span>1–2 epochs (~1–2 days)</span></div>
                <div className="info-row"><span>Protocol fee</span><span>2% of yield</span></div>
                <div className="info-row"><span>Randomness</span><span>sui::random (on-chain)</span></div>
              </div>
            </section>
          </div>

          {account && (v6Receipts.length > 0 || haTickets.length > 0) && (
            <section className="panel positions">
              <div className="panel-title">Your Stakes</div>
              {v6Receipts.map((r, i) => (
                <div className="position-row" key={`v6-${i}`}>
                  <div>
                    <div className="pos-amount">{fmt(r.principal_mist, 4)} SUI</div>
                    <div className="pos-status">✅ Active — earning since {r.deposit_ts_ms ? new Date(Number(r.deposit_ts_ms)).toLocaleDateString() : "now"}</div>
                  </div>
                  <button className="unstake-btn" onClick={() => handleUnstakeV6(r.id?.id || r.objectId)}>Unstake</button>
                </div>
              ))}
              {haTickets.map((t, i) => (
                <div className="position-row" key={`tix-${i}`}>
                  <div>
                    <div className="pos-amount">Redemption ticket</div>
                    <div className="pos-status">⏳ Claimable after 1–2 epochs — returns your full principal</div>
                  </div>
                  <button className="unstake-btn" style={{ background: "rgba(58,191,170,0.15)", color: "#3ABFAA", borderColor: "rgba(58,191,170,0.3)" }} onClick={() => handleClaimTicket(t.id)}>Claim</button>
                </div>
              ))}
            </section>
          )}

          {account && userReceipts.length > 0 && (
            <section className="panel positions" style={{ borderColor: "rgba(245,200,66,0.3)" }}>
              <div className="panel-title" style={{ color: "#F5C842" }}>Your V5 Stakes (migrating)</div>
              <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.4)", marginBottom: "1rem" }}>The protocol upgraded to the v6 haSUI engine. Unstake + withdraw here, then re-stake above to keep earning tickets.</p>
              {userReceipts.map((r, i) => {
                const unlockMs = r.unlock_ts_ms ? Number(r.unlock_ts_ms) : null;
                const ready = unlockMs !== null && Date.now() >= unlockMs;
                return (
                  <div className="position-row" key={i}>
                    <div>
                      <div className="pos-amount">{fmt(r.principal_mist, 4)} SUI</div>
                      <div className="pos-status">{unlockMs === null ? "✅ Active — earning tickets" : ready ? "✓ Ready to withdraw" : "⏳ Unstaking — ready in ~24h"}</div>
                    </div>
                    {unlockMs === null
                      ? <button className="unstake-btn" onClick={() => handleUnstake(r.id?.id || r.objectId)}>Unstake</button>
                      : ready
                        ? <button className="unstake-btn" style={{ background: "rgba(58,191,170,0.15)", color: "#3ABFAA", borderColor: "rgba(58,191,170,0.3)" }} onClick={() => handleWithdraw(r.id?.id || r.objectId)}>Withdraw</button>
                        : null}
                  </div>
                );
              })}
            </section>
          )}

          {account && legacyReceipts.length > 0 && (
            <section className="panel positions" style={{ borderColor: "rgba(245,200,66,0.3)" }}>
              <div className="panel-title" style={{ color: "#F5C842" }}>⚠️ Legacy Stakes (old contract)</div>
              <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.4)", marginBottom: "1rem" }}>These stakes are from a previous contract version. Withdraw to recover your SUI.</p>
              {legacyStatus && <div className={`tx-status ${legacyStatus.type}`} style={{ marginBottom: "1rem" }}>{legacyStatus.msg}</div>}
              {legacyReceipts.map((r, i) => (
                <div className="position-row" key={i}>
                  <div>
                    <div className="pos-amount">{fmt(r.principal_mist, 4)} SUI</div>
                    <div className="pos-status">{r.unlock_ts_ms ? "⏳ Ready to withdraw" : "🔒 Needs unstake request"}</div>
                  </div>
                  {!r.unlock_ts_ms
                    ? <button className="unstake-btn" style={{ background: "rgba(245,200,66,0.15)", color: "#F5C842", borderColor: "rgba(245,200,66,0.3)" }} onClick={() => handleLegacyRequestUnstake(r.objectId, r.legacyPkg)}>Request Unstake</button>
                    : <button className="unstake-btn" style={{ background: "rgba(58,191,170,0.15)", color: "#3ABFAA", borderColor: "rgba(58,191,170,0.3)" }} onClick={() => handleLegacyWithdraw(r.objectId, r.legacyPkg, r.legacyVault)}>Withdraw</button>
                  }
                </div>
              ))}
            </section>
          )}
        </>}

        {activeTab === "winners" && (
          <section className="panel">
            <div className="panel-title">🏆 Recent Winners</div>
            {lastWinners.length === 0
              ? <div style={{ fontSize: 12, fontFamily: "'DM Mono',monospace", color: "var(--text3)", padding: "1rem 0" }}>No draws yet on this contract.</div>
              : lastWinners.map((w, i) => (
                <div className="position-row" key={i}>
                  <div>
                    <div className="pos-amount" style={{ fontSize: "0.85rem" }}>
                      <span style={{ color: w.pool === 'Jackpot' ? '#C67FE8' : '#3ABFAA', marginRight: 8 }}>{w.pool === 'Jackpot' ? '🏆' : '🎟'} {w.pool}</span>
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'DM Mono, monospace', fontSize: '0.75rem' }}>{w.winner.slice(0, 6)}...{w.winner.slice(-4)}</span>
                    </div>
                    <div className="pos-status">{new Date(Number(w.ts)).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                  <div style={{ fontFamily: 'DM Mono, monospace', color: '#3ABFAA', fontWeight: 600 }}>+{w.amount.toFixed(4)} SUI</div>
                </div>
              ))
            }
          </section>
        )}

        {activeTab === "leaderboard" && (
          <section className="panel">
            <div className="panel-title">🥇 Top Stakers</div>
            {leaderboard.length === 0
              ? <div style={{ fontSize: 12, fontFamily: "'DM Mono',monospace", color: "var(--text3)", padding: "1rem 0" }}>No stakers yet.</div>
              : leaderboard.map((s, i) => (
                <div className="position-row" key={i}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 16, color: i === 0 ? "#F5C842" : i === 1 ? "#aaa" : i === 2 ? "#CD7F32" : "var(--text3)", minWidth: 24 }}>
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${s.rank}`}
                    </span>
                    <div>
                      <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "var(--text)" }}>
                        {s.addr.slice(0, 6)}...{s.addr.slice(-4)}
                        {account?.address === s.addr && <span style={{ color: "#3ABFAA", marginLeft: 8 }}>← you</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontFamily: "'DM Mono',monospace", color: "#E8A027", fontWeight: 600 }}>{s.sui.toFixed(2)} SUI</div>
                </div>
              ))
            }
          </section>
        )}

        {activeTab === "mywinnings" && (
          <section className="panel">
            <div className="panel-title">💰 My Winnings</div>
            {!account
              ? <div style={{ fontSize: 12, fontFamily: "'DM Mono',monospace", color: "var(--text3)", padding: "1rem 0" }}>Connect wallet to see your winnings.</div>
              : myWinnings.length === 0
                ? <div style={{ fontSize: 12, fontFamily: "'DM Mono',monospace", color: "var(--text3)", padding: "1rem 0" }}>No wins yet — keep staking! 🍀</div>
                : <>
                  <div style={{ background: "rgba(58,191,170,0.08)", border: "0.5px solid rgba(58,191,170,0.2)", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontFamily: "'DM Mono',monospace", fontSize: 13 }}>
                    Total won: <span style={{ color: "#3ABFAA", fontWeight: 600 }}>{myTotalWon.toFixed(4)} SUI</span>
                    {suiPrice && <span style={{ color: "var(--text2)", marginLeft: 8 }}>≈ ${(myTotalWon * suiPrice).toFixed(2)}</span>}
                  </div>
                  {myWinnings.map((w, i) => (
                    <div className="position-row" key={i}>
                      <div>
                        <div className="pos-amount" style={{ fontSize: "0.85rem" }}>
                          <span style={{ color: w.pool === 'Jackpot' ? '#C67FE8' : '#3ABFAA', marginRight: 8 }}>{w.pool === 'Jackpot' ? '🏆' : '🎟'} {w.pool}</span>
                        </div>
                        <div className="pos-status">{new Date(Number(w.ts)).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                      <div style={{ fontFamily: 'DM Mono, monospace', color: '#3ABFAA', fontWeight: 600 }}>+{w.amount.toFixed(4)} SUI</div>
                    </div>
                  ))}
                </>
            }
          </section>
        )}

        {v6VaultData && haRate && (() => {
          const principal = BigInt(v6VaultData.total_principal ?? 0);
          const ha = BigInt(v6VaultData.ha_balance ?? 0);
          const value = (ha * haRate) / 1000000n;
          const accrued = value > principal ? value - principal : 0n;
          return (
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: "0.72rem", color: "rgba(255,255,255,0.35)", margin: "0 0 1.5rem", textAlign: "center" }}>
              🔍 proof of funds: principal {fmt(principal, 4)} · vault value {fmt(value, 4)} · yield +{fmt(accrued, 6)} SUI · <a href="https://suivision.xyz/object/0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5" target="_blank" rel="noreferrer" style={{ color: "rgba(245,200,66,0.7)" }}>verify on-chain ↗</a>
            </div>
          );
        })()}

        <section className="panel" style={{ marginBottom: "2rem" }}>
          <div className="panel-title">FAQ</div>
          {[
            { q: "Is my principal safe?", a: "Yes. Your deposited SUI is held in the vault. Only the staking yield goes into prize pools — your principal is never at risk." },
            { q: "How does the prize pool get funded?", a: "Your stake is held as haSUI (Haedal liquid staking) and earns continuously. The yield is harvested into the prize pool (2% protocol fee) and paid out once a month to 8 winners: 1 jackpot (~50%), 4 prizes (~7.5% each) and 3 prizes (~6.7% each)." },
            { q: "How are winners selected?", a: "Winners are chosen using sui::random — Sui's native on-chain verifiable randomness. No one can predict or manipulate the outcome. Team wallets are excluded from every draw." },
            { q: "How often are draws held?", a: "Once a month — Surge Night. All 8 prizes are drawn at the same moment, announced in advance and hosted live in an X Space on @Surge_Sui. Reminders before the draw and all winners with their on-chain transaction links are posted automatically to our Telegram channel t.me/surge_sui, so anyone can verify the result. 1 SUI = 1 ticket, and tickets fill up over the 30 days before the draw: SUI staked for the full 30 days counts fully, SUI staked 3 days before counts 10%. Stake early to hold more tickets." },
            { q: "What is the unstake delay?", a: "1-2 epochs (~1-2 days) via Haedal's native redemption. You receive a redemption ticket on unstake; once matured, claim your full principal — exact rate, no fee." },
            { q: "What is the minimum deposit?", a: "1 SUI minimum — that enters you into every draw (Spark, Pulse and Surge). Odds are linear: 1 SUI staked = 1 ticket, so splitting a stake across wallets never improves your chances." },
            { q: "Is the contract audited?", a: "Not yet — Surge is early and unaudited. Open source on GitHub, every number verifiable on-chain, principal coverage enforced by the contract. Formal audit planned before external TVL scales. Stake only what you'd put into an experiment." },
          ].map((item, i) => (
            <div key={i} style={{ borderBottom: "0.5px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 0", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.9rem", color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>{item.q}</span>
                <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "1.2rem", lineHeight: 1, transform: openFaq === i ? "rotate(45deg)" : "none", transition: "transform 0.2s" }}>+</span>
              </button>
              {openFaq === i && <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.8rem", color: "rgba(255,255,255,0.45)", lineHeight: 1.7, paddingBottom: "1rem" }}>{item.a}</div>}
            </div>
          ))}
        </section>
      </main>

      <footer className="footer">
        <span>Surge Protocol · Sui Mainnet · V3</span>
        <a href="https://github.com/PBerHH/surge-protocol" target="_blank" rel="noreferrer">GitHub ↗</a>
      </footer>
    </div>
  );
}

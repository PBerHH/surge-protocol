import { useState, useEffect, useCallback, useRef } from "react";
import { ConnectButton, useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

// ── Contract Config (V5 — real native staking via Triton) ───────────────────
// moveCalls target the LATEST package (PKG_CALL). StructType filters + event
// queries use the V5 ORIGINAL package id (PACKAGE) where types/events were first
// defined — confirmed against the crank & points-worker (PACKAGE_V5 = 0x35732358).
const PKG_CALL    = "0x4ca98688e6cdf7fb6b73cc01d5ebbf77f947a02f5da570afd2f14bf155942b0c"; // moveCalls
const PACKAGE     = "0x35732358f2e0a683fe2014f5781b8ab67146d40ce63a76ac0a30ac52fdb7b2bb"; // V5 types + events
const VAULT       = "0x50d8b86e95c8c75892e8cc7caa39a81604de123baf1528cf1c9203d8ab702562"; // V5 StakingVault
const DRAW_STATE  = "0xee9f68a29ab16442600a9e12426431b240aed97cdf5108f44d8325401cc25fb0";
const REWARD_POOL = "0xacf68b636a55c96a8269ab0b66d735a7bbfadf058821cc17f97bc32d49d6968f";

// ── V6 (haSUI yield engine — live on mainnet, primary stake target) ─────────
const V6_PACKAGE = "0xaf489faa2a23db82265e25c833f2cf9b985eb0a8d4acde121c7e14c111c3b62e";
const V6_VAULT   = "0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5";
// Haedal (verified on mainnet): types/events live in ORIG, calls route to LATEST
const HAEDAL_STAKING    = "0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca";
const HAEDAL_PKG_ORIG   = "0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d";
const HAEDAL_PKG_LATEST = "0x126e4cfb051cad744706df590ec399e8c02b6feae195c35b8b496280d5442a62";
// Supabase (points) — paste the anon/public key from Supabase → Settings → API
const SUPABASE_URL = "https://dqcjgvotffxutvgvahse.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxY2pndm90ZmZ4dXR2Z3ZhaHNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNjI0MDQsImV4cCI6MjA5NDkzODQwNH0.J6m4cARii-VU3AQIotHY0i6hQC4HOXDZvvcE7MCyVC8";

// ── Legacy Contracts (withdraw-only — let old depositors recover their SUI) ──
const LEGACY_PACKAGE  = "0xc44d56c34b04fc54386ed2de7d757133ab77bbab60c18de3d0a1d640298f3396";
const LEGACY_VAULT    = "0x0aa9c18818087b3e9e32c6eef8f3b17ce98670d5ac00eb54fd559d0d98db76be";
const LEGACY2_PACKAGE = "0x51ce7917adc5b9d7e7faa5988dfbbc1e2abbac5ae14cb38834f23e9a1d6109dc";
const LEGACY2_VAULT   = "0x0430bf6c920033e5df27a371071a2f54844da65a103d08e35fb316eaa7134db9";
const LEGACY3_PACKAGE = "0x2755c0b895605f21f67b67f8ba58aa4b4b83759cd0d1a1fbb666ec9355c29d50";
const LEGACY3_VAULT   = "0x5cd4c73e20d876b1105fa49049e1ee903e9eac382867ce1d597719c5877e6a26";
// the PREVIOUS frontend deposited here (simulated Vault) — now withdraw-only:
const LEGACY4_PACKAGE = "0x53a50af7d0aeb7190f5b06031b33dc3fb68859c00a767fc6683e6d8c406e2be0";
const LEGACY4_VAULT   = "0x64df43a049c9b24720e9aaa8939072907dda5cca69a7e557424b541ad16071e5";

function fmt(mist, dec = 3) { return (Number(BigInt(mist ?? 0)) / 1e9).toFixed(dec); }
function fmtSui(mist) {
  const n = Number(BigInt(mist ?? 0)) / 1e9;
  if (n >= 1000) return (n / 1000).toFixed(2) + "K";
  return n.toFixed(3);
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
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
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

function LiveDrawTicker({ drawData, poolData }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 1000); return () => clearInterval(t); }, []);
  const items = [
    { name: "SPARK", next: drawData?.next_spark_ms, pool: poolData?.spark_pool, color: "#F5C842" },
    { name: "PULSE", next: drawData?.next_pulse_ms, pool: poolData?.pulse_pool, color: "#3ABFAA" },
    { name: "SURGE", next: drawData?.next_surge_ms, pool: poolData?.surge_pool, color: "#C67FE8" },
  ];
  return (
    <div style={{ background: "var(--bg3)", border: "0.5px solid var(--border)", borderRadius: 10, padding: "8px 14px", display: "flex", gap: 24, alignItems: "center", overflowX: "auto", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
      <span style={{ color: "var(--text3)", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>LIVE</span>
      {items.map(item => {
        const { label, urgent } = countdown(item.next);
        return (
          <div key={item.name} style={{ display: "flex", gap: 8, alignItems: "center", whiteSpace: "nowrap" }}>
            <span style={{ color: item.color, fontWeight: 600 }}>{item.name}</span>
            <span style={{ color: "var(--text2)" }}>{fmtSui(item.pool ?? 0)} SUI</span>
            <span style={{ color: urgent ? item.color : "var(--text3)" }}>→ {label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const account = useCurrentAccount();
  const client = useSuiClient();
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
  const [openFaq, setOpenFaq] = useState(null);
  const [activeTab, setActiveTab] = useState("stake");
  const [loyaltyData, setLoyaltyData] = useState(null);
  const prevWinnersRef = useRef([]);

  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 1000); return () => clearInterval(t); }, []);

  const fetchData = useCallback(async () => {
    try {
      const [pool, draw, vault, v6vault] = await Promise.all([
        client.getObject({ id: REWARD_POOL, options: { showContent: true } }),
        client.getObject({ id: DRAW_STATE, options: { showContent: true } }),
        client.getObject({ id: VAULT, options: { showContent: true } }),
        client.getObject({ id: V6_VAULT, options: { showContent: true } }),
      ]);
      if (pool.data?.content?.fields) setPoolData(pool.data.content.fields);
      if (draw.data?.content?.fields) setDrawData(draw.data.content.fields);
      if (vault.data?.content?.fields) setVaultData(vault.data.content.fields);
      if (v6vault.data?.content?.fields) setV6VaultData(v6vault.data.content.fields);
      try {
        const rtx = new Transaction();
        rtx.moveCall({ target: `${HAEDAL_PKG_ORIG}::staking::get_exchange_rate`, arguments: [rtx.object(HAEDAL_STAKING)] });
        const ins = await client.devInspectTransactionBlock({ sender: "0x0000000000000000000000000000000000000000000000000000000000000001", transactionBlock: rtx });
        const bytes = ins?.results?.[0]?.returnValues?.[0]?.[0];
        if (bytes) { let v = 0n; for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]); setHaRate(v); }
      } catch { /* rate unavailable — panel hides itself */ }
    } catch (e) { console.error(e); }
  }, [client]);

  useEffect(() => { fetchData(); const t = setInterval(fetchData, 15000); return () => clearInterval(t); }, [fetchData]);

  const fetchLastWinners = useCallback(async () => {
    try {
      const res = await Promise.all([PACKAGE, PKG_CALL].map(pkg => client.queryEvents({ query: { MoveModule: { package: pkg, module: 'reward_pool' } }, limit: 20, order: 'descending' })));
      const events = { data: res.flatMap(r => r.data) };
      const winners = events.data.filter(e => e.type?.includes('PrizeAwarded') && Number(e.parsedJson?.amount_mist) > 0)
        .map(e => ({ winner: e.parsedJson.winner, amount: Number(e.parsedJson.amount_mist) / 1e9, pool: ['Spark', 'Pulse', 'Surge'][e.parsedJson.pool] ?? 'Draw', ts: e.timestampMs }));
      if (prevWinnersRef.current.length > 0 && winners.length > 0 && winners[0]?.ts !== prevWinnersRef.current[0]?.ts) launchConfetti();
      prevWinnersRef.current = winners;
      setLastWinners(winners);
    } catch (e) { console.error(e); }
  }, [client]);

  useEffect(() => { fetchLastWinners(); const t = setInterval(fetchLastWinners, 15000); return () => clearInterval(t); }, [fetchLastWinners]);

  const fetchReceipts = useCallback(async () => {
    if (!account?.address) return;
    try {
      const res = await Promise.all([PACKAGE, PKG_CALL].map(pkg => client.getOwnedObjects({ owner: account.address, filter: { StructType: `${pkg}::stake_vault::StakingReceipt` }, options: { showContent: true } })));
      setUserReceipts(res.flatMap(r => r.data).map(o => o.data?.content?.fields).filter(Boolean));
      const v6res = await client.getOwnedObjects({ owner: account.address, filter: { StructType: `${V6_PACKAGE}::stake_vault_v6::StakeReceiptV6` }, options: { showContent: true } });
      setV6Receipts(v6res.data.map(o => o.data?.content?.fields).filter(Boolean));
      const tix = await client.getOwnedObjects({ owner: account.address, filter: { StructType: `${HAEDAL_PKG_ORIG}::staking::UnstakeTicket` }, options: { showContent: true } });
      setHaTickets(tix.data.map(o => ({ id: o.data?.objectId })).filter(t => t.id));
    } catch (e) { console.error(e); }
  }, [account, client]);

  useEffect(() => { fetchReceipts(); }, [fetchReceipts]);

  const fetchLoyalty = useCallback(async () => {
    if (!account?.address) return;
    try {
      const res = await Promise.all([PACKAGE, PKG_CALL].map(pkg => client.getOwnedObjects({ owner: account.address, filter: { StructType: `${pkg}::loyalty_tracker::LoyaltyRecord` }, options: { showContent: true } })));
      const objs = { data: res.flatMap(r => r.data) };
      if (objs.data.length > 0) {
        const f = objs.data[0].data?.content?.fields;
        if (f) {
          const daysStaked = Math.floor((Date.now() - Number(f.stake_start_ms)) / 86400000);
          const streakDays = Math.min(Number(f.streak_days ?? 0), 30);
          let baseBp = daysStaked >= 365 ? 20000 : daysStaked >= 180 ? 18000 : daysStaked >= 90 ? 15000 : daysStaked >= 30 ? 12000 : 10000;
          const totalBp = Math.min(baseBp + Math.floor((streakDays * 3000) / 30), 20000);
          setLoyaltyData({ daysStaked, streakDays, multiplier: totalBp / 10000 });
        }
      }
    } catch (e) { console.error(e); }
  }, [account, client]);

  useEffect(() => { fetchLoyalty(); }, [fetchLoyalty]);

  const fetchLegacyReceipts = useCallback(async () => {
    if (!account?.address) return;
    try {
      const [o1, o2, o3, o4] = await Promise.all([
        client.getOwnedObjects({ owner: account.address, filter: { StructType: `${LEGACY_PACKAGE}::stake_vault::StakeReceipt` }, options: { showContent: true } }),
        client.getOwnedObjects({ owner: account.address, filter: { StructType: `${LEGACY2_PACKAGE}::stake_vault::StakeReceipt` }, options: { showContent: true } }),
        client.getOwnedObjects({ owner: account.address, filter: { StructType: `${LEGACY3_PACKAGE}::stake_vault::StakeReceipt` }, options: { showContent: true } }),
        client.getOwnedObjects({ owner: account.address, filter: { StructType: `${LEGACY4_PACKAGE}::stake_vault::StakeReceipt` }, options: { showContent: true } }),
      ]);
      const map = (objs, pkg, vault) => objs.data.map(o => o.data?.content?.fields && { ...o.data.content.fields, objectId: o.data.objectId, legacyPkg: pkg, legacyVault: vault }).filter(Boolean);
      setLegacyReceipts([...map(o1, LEGACY_PACKAGE, LEGACY_VAULT), ...map(o2, LEGACY2_PACKAGE, LEGACY2_VAULT), ...map(o3, LEGACY3_PACKAGE, LEGACY3_VAULT), ...map(o4, LEGACY4_PACKAGE, LEGACY4_VAULT)]);
    } catch (e) { console.error(e); }
  }, [account, client]);

  useEffect(() => { fetchLegacyReceipts(); }, [fetchLegacyReceipts]);

  const fetchMyWinnings = useCallback(async () => {
    if (!account?.address) return;
    try {
      const res = await Promise.all([PACKAGE, PKG_CALL].map(pkg => client.queryEvents({ query: { MoveModule: { package: pkg, module: 'reward_pool' } }, limit: 50, order: 'descending' })));
      const events = { data: res.flatMap(r => r.data) };
      setMyWinnings(events.data.filter(e => e.type?.includes('PrizeAwarded') && e.parsedJson?.winner === account.address)
        .map(e => ({ amount: Number(e.parsedJson.amount_mist) / 1e9, pool: ['Spark', 'Pulse', 'Surge'][e.parsedJson.pool] ?? 'Draw', ts: e.timestampMs })));
    } catch (e) { console.error(e); }
  }, [account, client]);

  useEffect(() => { fetchMyWinnings(); }, [fetchMyWinnings]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      // V5 events are gross (no per-amount unstake events) — only counted while the
      // V5 vault still holds principal; after wind-down V6 net is the whole truth.
      const v5Vault = await client.getObject({ id: VAULT, options: { showContent: true } });
      const v5Active = BigInt(v5Vault.data?.content?.fields?.total_principal ?? 0) > 0n;
      const queries = [
        client.queryEvents({ query: { MoveEventType: `${V6_PACKAGE}::stake_vault_v6::StakedV6` }, limit: 50 }),
        client.queryEvents({ query: { MoveEventType: `${V6_PACKAGE}::stake_vault_v6::UnstakedV6` }, limit: 50 }),
      ];
      if (v5Active) queries.push(...[PACKAGE, PKG_CALL].map(pkg => client.queryEvents({ query: { MoveEventType: `${pkg}::stake_vault::Staked` }, limit: 50 })));
      const [stakedV6, unstakedV6, ...v5res] = await Promise.all(queries);
      const stakes = {};
      for (const ev of stakedV6.data) {
        const f = ev.parsedJson;
        if (f?.owner && f?.principal_mist) stakes[f.owner] = (stakes[f.owner] ?? 0n) + BigInt(f.principal_mist);
      }
      for (const ev of unstakedV6.data) {
        const f = ev.parsedJson;
        if (f?.owner && f?.principal_mist) stakes[f.owner] = (stakes[f.owner] ?? 0n) - BigInt(f.principal_mist);
      }
      for (const r of v5res) for (const ev of r.data) {
        const f = ev.parsedJson;
        if (f?.staker && f?.amount_mist) stakes[f.staker] = (stakes[f.staker] ?? 0n) + BigInt(f.amount_mist);
      }
      for (const a of Object.keys(stakes)) { if (stakes[a] <= 0n) delete stakes[a]; }
      setLeaderboard(Object.entries(stakes).sort((a, b) => b[1] > a[1] ? 1 : -1).slice(0, 10).map(([addr, mist], i) => ({ rank: i + 1, addr, sui: Number(mist) / 1e9 })));
    } catch (e) { console.error(e); }
  }, [client]);

  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

  useEffect(() => {
    if (!account?.address || !SUPABASE_ANON_KEY) { setPointsData(null); return; }
    (async () => {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/wallets?address=eq.${account.address}&select=total_points,multiplier,early_bird_rank,pioneer_rank`, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        });
        const rows = await r.json();
        if (Array.isArray(rows) && rows[0]) setPointsData(rows[0]);
      } catch { /* points unavailable — banner hides */ }
    })();
  }, [account?.address]);

  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd")
      .then(r => r.json()).then(d => setSuiPrice(d?.sui?.usd ?? null)).catch(() => {});
  }, []);

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
          tx.sharedObjectRef({ objectId: "0x0000000000000000000000000000000000000000000000000000000000000005", initialSharedVersion: 1, mutable: true }), // SuiSystemState
          tx.object(HAEDAL_STAKING),
          coin,
          tx.object("0x6"), // Clock
        ],
      });
      signAndExecute({ transaction: tx }, {
        onSuccess: (r) => { setTxStatus({ type: "success", msg: `Staked! Tx: ${r.digest.slice(0,16)}...` }); setTimeout(() => { fetchData(); fetchReceipts(); fetchLoyalty(); fetchLeaderboard(); }, 3000); },
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
      // withdraw_staked needs a LoyaltyRecord; create one inline if the user has none
      const loyaltyObjs = await client.getOwnedObjects({ owner: account.address, filter: { StructType: `${PACKAGE}::loyalty_tracker::LoyaltyRecord` }, options: { showContent: true } });
      const hasRecord = loyaltyObjs.data.length > 0;
      const tx = new Transaction();
      tx.setGasPrice(1000);
      const loyaltyArg = hasRecord
        ? tx.object(loyaltyObjs.data[0].data.objectId)
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
          const objs = await client.getOwnedObjects({ owner: account.address, filter: { StructType: `${pkg}::loyalty_tracker::LoyaltyRecord` }, options: { showContent: true } });
          if (!objs.data.length) { setLegacyStatus({ type: "error", msg: "LoyaltyRecord not found" }); return; }
          const loyaltyId = objs.data[0].data.objectId;
          // Old contracts (0xc44d, 0x51ce) need @0x5 SuiSystemState param
          // New contracts (0x2755+) use simpler withdraw without @0x5
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
    const text = `🌊 Surge Protocol — Prize-linked staking on Sui!\n\n${fmtSui(vaultData?.total_principal ?? 0)} SUI staked. Your principal is always safe — only the yield wins prizes.\n\n⚡ Spark · 🔄 Pulse · 🌊 Surge draws\n\nhttps://surge-protocol-chi.vercel.app`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
  }

  const sui = parseFloat(stakeAmount) || 0;
  const sparkTickets = sui >= 1 ? 1 : 0;
  const pulseTickets = sui >= 10 ? Math.floor(Math.sqrt(sui)) : 0;
  const surgeTickets = sui >= 50 ? Math.floor(Math.sqrt(sui)) : 0;
  const totalStaked = BigInt(vaultData?.total_principal ?? 0) + BigInt(v6VaultData?.total_principal ?? 0);
  const totalPrizes = [poolData?.spark_pool, poolData?.pulse_pool, poolData?.surge_pool].reduce((acc, v) => acc + Number(BigInt(v ?? 0)), 0);
  const myStakeMist = userReceipts.reduce((acc, r) => acc + Number(BigInt(r.principal_mist ?? 0)), 0);
  const myStakeSui = myStakeMist / 1e9;
  const myTotalWon = myWinnings.reduce((acc, w) => acc + w.amount, 0);
  const loyaltyProgress = loyaltyData ? Math.min((loyaltyData.daysStaked / 365) * 100, 100) : 5;

  const draws = [
    { name: "Spark", emoji: "⚡", color: "#F5C842", colorDim: "rgba(245,200,66,0.1)", freq: "Every 6h · 3 winners", share: "20%", pool: poolData?.spark_pool, next: drawData?.next_spark_ms },
    { name: "Pulse", emoji: "🔄", color: "#3ABFAA", colorDim: "rgba(58,191,170,0.1)", freq: "Weekly · 4 winners", share: "30%", pool: poolData?.pulse_pool, next: drawData?.next_pulse_ms },
    { name: "Surge", emoji: "🌊", color: "#C67FE8", colorDim: "rgba(198,127,232,0.1)", freq: "Monthly · 1 jackpot", share: "50%", pool: poolData?.surge_pool, next: drawData?.next_surge_ms },
  ];

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
        <LiveDrawTicker drawData={drawData} poolData={poolData} />
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
            <div style={{ fontSize: "0.75rem", color: "rgba(198,127,232,0.35)" }}>Spark · Pulse · Surge</div>
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
      </header>

      <main className="main">
        <SecurityBadges />

        <section className="draws">
          {draws.map(d => {
            const { label, urgent } = countdown(d.next);
            const diff = d.next && d.next !== '0' ? Number(BigInt(d.next)) - Date.now() : Infinity;
            const isFomo = d.name === "Spark" && diff > 0 && diff < 3600000;
            return (
              <div className={`draw-card${isFomo ? " spark-fomo" : ""}`} key={d.name} style={{ "--accent": d.color, "--accent-dim": d.colorDim }}>
                <div className="draw-header"><span className="draw-emoji">{d.emoji}</span><span className="draw-name">{d.name}</span><span className="draw-share">{d.share}</span></div>
                <div className="draw-prize">{fmtSui(d.pool ?? 0)} <span className="draw-sui">SUI</span></div>
                <div className="draw-freq">{d.freq}</div>
                <div className={`draw-countdown ${isFomo ? "fomo" : urgent ? "urgent" : ""}`} key={tick}>{label}</div>
              </div>
            );
          })}
        </section>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, background: "var(--bg3)", borderRadius: 10, padding: 4 }}>
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ flex: 1, padding: "7px 4px", background: activeTab === tab.id ? "var(--bg2)" : "transparent", border: activeTab === tab.id ? "0.5px solid var(--border2)" : "none", borderRadius: 7, fontSize: 11, fontFamily: "'DM Mono',monospace", color: activeTab === tab.id ? "var(--text)" : "var(--text2)", cursor: "pointer", transition: "all 0.15s" }}>{tab.label}</button>
          ))}
        </div>

        {/* Tab: Stake */}
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
            </section>
          )}
          <div className="two-col">
            <section className="panel stake-panel">
              <div className="panel-title">Deposit SUI</div>
              <div className="input-row">
                <input className="stake-input" type="number" value={stakeAmount} onChange={e => { setStakeAmount(e.target.value); setTxStatus(null); }} placeholder="100" min="1" />
                <span className="input-denom">SUI</span>
              </div>
              <div className="tickets">
                {[{ name: "⚡ Spark", gate: 1, count: sparkTickets, color: "#F5C842" }, { name: "🔄 Pulse", gate: 10, count: pulseTickets, color: "#3ABFAA" }, { name: "🌊 Surge", gate: 50, count: surgeTickets, color: "#C67FE8" }].map(t => (
                  <div className={`ticket ${t.count > 0 ? "active" : ""}`} key={t.name} style={{ "--tc": t.color }}>
                    <span className="ticket-name">{t.name}</span>
                    <span className="ticket-count">{t.count > 0 ? `${t.count} tickets` : `min ${t.gate} SUI`}</span>
                  </div>
                ))}
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
                  {loyaltyData.multiplier.toFixed(2)}x · {loyaltyData.daysStaked}d staked · {loyaltyData.streakDays}d streak
                </div>
              )}
              <p className="loyalty-note">Streak bonus up to +0.3x · Resets on full withdrawal</p>
              <div className="info-rows">
                <div className="info-row"><span>Min. deposit</span><span>1 SUI</span></div>
                <div className="info-row"><span>Draw entry</span><span>1 / 10 / 50 SUI</span></div>
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
                  <button className="unstake-btn" onClick={() => handleUnstakeV6(r.id?.id)}>Unstake</button>
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
                    ? <button className="unstake-btn" onClick={() => handleUnstake(r.id?.id)}>Unstake</button>
                    : ready
                      ? <button className="unstake-btn" style={{ background: "rgba(58,191,170,0.15)", color: "#3ABFAA", borderColor: "rgba(58,191,170,0.3)" }} onClick={() => handleWithdraw(r.id?.id)}>Withdraw</button>
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

        {/* Tab: Winners */}
        {activeTab === "winners" && (
          <section className="panel">
            <div className="panel-title">🏆 Recent Winners</div>
            {lastWinners.length === 0
              ? <div style={{ fontSize: 12, fontFamily: "'DM Mono',monospace", color: "var(--text3)", padding: "1rem 0" }}>No draws yet on this contract.</div>
              : lastWinners.map((w, i) => (
                <div className="position-row" key={i}>
                  <div>
                    <div className="pos-amount" style={{ fontSize: "0.85rem" }}>
                      <span style={{ color: w.pool === 'Spark' ? '#F5C842' : w.pool === 'Pulse' ? '#3ABFAA' : '#C67FE8', marginRight: 8 }}>{w.pool === 'Spark' ? '⚡' : w.pool === 'Pulse' ? '🔄' : '🌊'} {w.pool}</span>
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

        {/* Tab: Leaderboard */}
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

        {/* Tab: My Winnings */}
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
                          <span style={{ color: w.pool === 'Spark' ? '#F5C842' : w.pool === 'Pulse' ? '#3ABFAA' : '#C67FE8', marginRight: 8 }}>{w.pool === 'Spark' ? '⚡' : w.pool === 'Pulse' ? '🔄' : '🌊'} {w.pool}</span>
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


        {/* Transparency strip */}
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

        {/* FAQ */}
        <section className="panel" style={{ marginBottom: "2rem" }}>
          <div className="panel-title">FAQ</div>
          {[
            { q: "Is my principal safe?", a: "Yes. Your deposited SUI is held in the vault. Only the staking yield goes into prize pools — your principal is never at risk." },
            { q: "How does the prize pool get funded?", a: "Your stake is held as haSUI (Haedal liquid staking) and earns continuously. The yield is harvested and split: 20% Spark, 30% Pulse, ~48% Surge, 2% protocol fee. Harvest can mathematically never touch principal — coverage is enforced on-chain." },
            { q: "How are winners selected?", a: "Winners are chosen using sui::random — Sui's native on-chain verifiable randomness. No one can predict or manipulate the outcome." },
            { q: "How often are draws held?", a: "Spark every 6h (3 winners), Pulse weekly (4 winners), Surge monthly (1 jackpot). Fully automated." },
            { q: "What is the unstake delay?", a: "1-2 epochs (~1-2 days) via Haedal's native redemption. You receive a redemption ticket on unstake; once matured, claim your full principal — exact rate, no fee." },
            { q: "What is the minimum deposit?", a: "1 SUI minimum to deposit, which also enters you into Spark draws. Pulse draws need 10 SUI, Surge draws 50 SUI." },
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
        <span>Surge Protocol · Sui Mainnet · v6 engine</span>
        <a href="https://github.com/PBerHH/surge-protocol" target="_blank" rel="noreferrer">GitHub ↗</a>
      </footer>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchUserPoints, fetchStats } from "./supabase";
import { ConnectButton, useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

// ── Contract Config (V3 — Security Fixed) ───────────────────────────────────
const PACKAGE     = "0x4ca98688e6cdf7fb6b73cc01d5ebbf77f947a02f5da570afd2f14bf155942b0c"; // V6
const PACKAGE_V5    = "0x35732358f2e0a683fe2014f5781b8ab67146d40ce63a76ac0a30ac52fdb7b2bb"; // V5 StakingReceipt type
const STAKING_VAULT = "0x50d8b86e95c8c75892e8cc7caa39a81604de123baf1528cf1c9203d8ab702562";
const SUI_SYSTEM   = "0x0000000000000000000000000000000000000000000000000000000000000005";
const PACKAGE_TYPE = "0x330aa337772418f68117556dce74034063f11a8de68f60a99acc9a5ee62f5fb3";  // original-id — Typ-Filter & Event-Queries
const VAULT       = "0x4bca5b44fcbb3cf79f3586c3ff4e4d3494975f1d8434de067a9a95b792150992";
const DRAW_STATE  = "0xee9f68a29ab16442600a9e12426431b240aed97cdf5108f44d8325401cc25fb0";
const REWARD_POOL = "0xacf68b636a55c96a8269ab0b66d735a7bbfadf058821cc17f97bc32d49d6968f";

// ── Legacy Contracts ─────────────────────────────────────────────────────────
const LEGACY_PACKAGE  = "0xc44d56c34b04fc54386ed2de7d757133ab77bbab60c18de3d0a1d640298f3396";
const LEGACY_VAULT    = "0x0aa9c18818087b3e9e32c6eef8f3b17ce98670d5ac00eb54fd559d0d98db76be";
const LEGACY2_PACKAGE = "0x51ce7917adc5b9d7e7faa5988dfbbc1e2abbac5ae14cb38834f23e9a1d6109dc";
const LEGACY2_VAULT   = "0x0430bf6c920033e5df27a371071a2f54844da65a103d08e35fb316eaa7134db9";
const LEGACY3_PACKAGE = "0x2755c0b895605f21f67b67f8ba58aa4b4b83759cd0d1a1fbb666ec9355c29d50";
const LEGACY3_VAULT   = "0x5cd4c73e20d876b1105fa49049e1ee903e9eac382867ce1d597719c5877e6a26";
const LEGACY4_PACKAGE = "0x53a50af7d0aeb7190f5b06031b33dc3fb68859c00a767fc6683e6d8c406e2be0";
const LEGACY4_VAULT   = "0x64df43a049c9b24720e9aaa8939072907dda5cca69a7e557424b541ad16071e5";
const LEGACY5_PACKAGE = "0x9b9f9e13070024a61b19699f1f5bcf92b4eaff0c3498c07113dde0cfb137aeef";
const LEGACY5_VAULT   = "0x0a1d78d1e0084ddcc00b7b64de0703d6ed79ab6944e1bf27f38399cc979cb506";

// Check if a receipt is in unstaking state
function isUnstaking(receipt) {
  if (!receipt) return false;
  const u = receipt.unlock_ts_ms;
  // null/undefined = not unstaking
  if (u === null || u === undefined) return false;
  // String or number with value = unstaking
  if (typeof u === 'string' || typeof u === 'number') {
    return String(u).length > 0 && u !== '0';
  }
  // Object with vec (Option<u64> shape)
  if (u.vec && Array.isArray(u.vec)) return u.vec.length > 0;
  if (u.fields?.vec && Array.isArray(u.fields.vec)) return u.fields.vec.length > 0;
  return false;
}

// Get unlock timestamp from receipt (returns number or null)
function getUnlockTs(receipt) {
  if (!receipt) return null;
  const u = receipt.unlock_ts_ms;
  if (u === null || u === undefined) return null;
  if (typeof u === 'string') return Number(u);
  if (typeof u === 'number') return u;
  if (u.vec?.[0]) return Number(u.vec[0]);
  if (u.fields?.vec?.[0]) return Number(u.fields.vec[0]);
  return null;
}

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

function ApyCalculator({ suiPrice }) {
  const [calcAmount, setCalcAmount] = useState("100");
  const sui = parseFloat(calcAmount) || 0;
  const yearlyYield = sui * 0.05;
  const sparkTickets = sui >= 1 ? 1 : 0;
  const pulseTickets = sui < 10 ? 0 : Math.max(1, Math.floor(Math.sqrt(sui)));
  const surgeTickets = sui < 50 ? 0 : Math.max(1, Math.floor(Math.sqrt(sui)));
  return (
    <div className="panel">
      <div className="panel-title">📊 APY Calculator</div>
      <div className="input-row" style={{ marginBottom: 16 }}>
        <input className="stake-input" type="number" value={calcAmount} onChange={e => setCalcAmount(e.target.value)} placeholder="100" min="1" />
        <span className="input-denom">SUI</span>
      </div>
      <div className="info-rows">
        <div className="info-row"><span>Stake value</span><span>{sui.toFixed(2)} SUI{suiPrice ? ` ≈ $${(sui * suiPrice).toFixed(2)}` : ""}</span></div>
        <div className="info-row"><span>Yearly yield (~5% APY)</span><span style={{ color: "#3ABFAA" }}>{yearlyYield.toFixed(4)} SUI</span></div>
        <div className="info-row"><span>⚡ Spark tickets</span><span style={{ color: sparkTickets > 0 ? "#F5C842" : "var(--text3)" }}>{sparkTickets > 0 ? sparkTickets : "min 10 SUI"}</span></div>
        <div className="info-row"><span>🔄 Pulse tickets</span><span style={{ color: pulseTickets > 0 ? "#3ABFAA" : "var(--text3)" }}>{pulseTickets > 0 ? pulseTickets : "min 50 SUI"}</span></div>
        <div className="info-row"><span>🌊 Surge tickets</span><span style={{ color: surgeTickets > 0 ? "#C67FE8" : "var(--text3)" }}>{surgeTickets > 0 ? surgeTickets : "min 50 SUI"}</span></div>
      </div>
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
  const [userPoints, setUserPoints] = useState(null);
  const [globalStats, setGlobalStats] = useState(null);
  const [openFaq, setOpenFaq] = useState(null);
  const [activeTab, setActiveTab] = useState("stake");
  const [loyaltyData, setLoyaltyData] = useState(null);
  const prevWinnersRef = useRef([]);

  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 1000); return () => clearInterval(t); }, []);

  const fetchData = useCallback(async () => {
    try {
      const [pool, draw, vault] = await Promise.all([
        client.getObject({ id: REWARD_POOL, options: { showContent: true } }),
        client.getObject({ id: DRAW_STATE, options: { showContent: true } }),
        client.getObject({ id: STAKING_VAULT, options: { showContent: true } }),
      ]);
      if (pool.data?.content?.fields) setPoolData(pool.data.content.fields);
      if (draw.data?.content?.fields) setDrawData(draw.data.content.fields);
      if (vault.data?.content?.fields) {
        const f = vault.data.content.fields;
        setVaultData({ ...f, total_staked: f.total_principal ?? 0, pending_yield: f.pending_rewards?.fields?.value ?? f.pending_rewards ?? 0 });
      }
    } catch (e) { console.error(e); }
  }, [client]);

  useEffect(() => { fetchData(); const t = setInterval(fetchData, 15000); return () => clearInterval(t); }, [fetchData]);

  const fetchLastWinners = useCallback(async () => {
    try {
      const events = await client.queryEvents({ query: { MoveModule: { package: PACKAGE_TYPE, module: 'draw_manager' } }, limit: 20, order: 'descending' });
      const winners = events.data.filter(e => e.type?.includes('PrizeAwarded') && Number(e.parsedJson?.amount_mist) > 0)
        .map(e => ({ winner: e.parsedJson.winner, amount: Number(e.parsedJson.amount_mist) / 1e9, pool: ['Spark', 'Pulse', 'Surge'][e.parsedJson.pool] ?? 'Draw', ts: e.timestampMs }));
      if (prevWinnersRef.current.length > 0 && winners.length > 0 && winners[0]?.ts !== prevWinnersRef.current[0]?.ts) launchConfetti();
      prevWinnersRef.current = winners;
      setLastWinners(winners);
    } catch (e) { console.error(e); }
  }, [client]);

  useEffect(() => { fetchLastWinners(); const t = setInterval(fetchLastWinners, 15000); return () => clearInterval(t); }, [fetchLastWinners]);

  useEffect(() => {
    const loadPointsData = async () => {
      const stats = await fetchStats();
      setGlobalStats(stats);
      if (account?.address) {
        const points = await fetchUserPoints(account.address);
        setUserPoints(points);
      }
    };
    loadPointsData();
    const t = setInterval(loadPointsData, 30000);
    return () => clearInterval(t);
  }, [account?.address]);

  const fetchReceipts = useCallback(async () => {
    if (!account?.address) return;
    try {
      const [r1, r2] = await Promise.all([
        client.getOwnedObjects({ owner: account.address, filter: { StructType: `${PACKAGE}::stake_vault::StakingReceipt` }, options: { showContent: true } }),
        client.getOwnedObjects({ owner: account.address, filter: { StructType: `${PACKAGE_V5}::stake_vault::StakingReceipt` }, options: { showContent: true } }),
      ]);
      const all = [...r1.data, ...r2.data].map(o => o.data?.content?.fields && { ...o.data.content.fields, objectId: o.data.objectId }).filter(Boolean);
      setUserReceipts(all);
    } catch (e) { console.error(e); }
  }, [account, client]);

  useEffect(() => { fetchReceipts(); }, [fetchReceipts]);

  const fetchLoyalty = useCallback(async () => {
    if (!account?.address) return;
    try {
      const objs = await client.getOwnedObjects({ owner: account.address, filter: { StructType: `${PACKAGE_TYPE}::loyalty_tracker::LoyaltyRecord` }, options: { showContent: true } });
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
      const [o1, o2, o3, o4, o5] = await Promise.all([
        client.getOwnedObjects({ owner: account.address, filter: { StructType: `${LEGACY_PACKAGE}::stake_vault::StakeReceipt` }, options: { showContent: true } }),
        client.getOwnedObjects({ owner: account.address, filter: { StructType: `${LEGACY2_PACKAGE}::stake_vault::StakeReceipt` }, options: { showContent: true } }),
        client.getOwnedObjects({ owner: account.address, filter: { StructType: `${LEGACY3_PACKAGE}::stake_vault::StakeReceipt` }, options: { showContent: true } }),
        client.getOwnedObjects({ owner: account.address, filter: { StructType: `${LEGACY4_PACKAGE}::stake_vault::StakeReceipt` }, options: { showContent: true } }),
        client.getOwnedObjects({ owner: account.address, filter: { StructType: `${LEGACY5_PACKAGE}::stake_vault::StakeReceipt` }, options: { showContent: true } }),
      ]);
      const map = (objs, pkg, vault) => objs.data.map(o => o.data?.content?.fields && { ...o.data.content.fields, objectId: o.data.objectId, legacyPkg: pkg, legacyVault: vault }).filter(Boolean);
      setLegacyReceipts([...map(o1, LEGACY_PACKAGE, LEGACY_VAULT), ...map(o2, LEGACY2_PACKAGE, LEGACY2_VAULT), ...map(o3, LEGACY3_PACKAGE, LEGACY3_VAULT), ...map(o4, LEGACY4_PACKAGE, LEGACY4_VAULT), ...map(o5, LEGACY5_PACKAGE, LEGACY5_VAULT)]);
    } catch (e) { console.error(e); }
  }, [account, client]);

  useEffect(() => { fetchLegacyReceipts(); }, [fetchLegacyReceipts]);

  const fetchMyWinnings = useCallback(async () => {
    if (!account?.address) return;
    try {
      const events = await client.queryEvents({ query: { MoveModule: { package: PACKAGE_TYPE, module: 'draw_manager' } }, limit: 50, order: 'descending' });
      setMyWinnings(events.data.filter(e => e.type?.includes('PrizeAwarded') && e.parsedJson?.winner === account.address)
        .map(e => ({ amount: Number(e.parsedJson.amount_mist) / 1e9, pool: ['Spark', 'Pulse', 'Surge'][e.parsedJson.pool] ?? 'Draw', ts: e.timestampMs })));
    } catch (e) { console.error(e); }
  }, [account, client]);

  useEffect(() => { fetchMyWinnings(); }, [fetchMyWinnings]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const [e1, e2] = await Promise.all([
        client.queryEvents({ query: { MoveEventType: `${PACKAGE_V5}::stake_vault::Staked` }, limit: 50 }),
        client.queryEvents({ query: { MoveEventType: `${PACKAGE}::stake_vault::Staked` }, limit: 50 }),
      ]);
      const stakes = {};
      for (const ev of [...e1.data, ...e2.data]) {
        const f = ev.parsedJson;
        if (f?.staker && f?.amount_mist) stakes[f.staker] = (stakes[f.staker] ?? 0n) + BigInt(f.amount_mist);
      }
      setLeaderboard(Object.entries(stakes).sort((a, b) => b[1] > a[1] ? 1 : -1).slice(0, 10).map(([addr, mist], i) => ({ rank: i + 1, addr, sui: Number(mist) / 1e9 })));
    } catch (e) { console.error(e); }
  }, [client]);

  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

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
      tx.moveCall({ target: `${PACKAGE}::stake_vault::stake`, arguments: [tx.object(STAKING_VAULT), tx.object(SUI_SYSTEM), coin, tx.object("0x6")] });
      signAndExecute({ transaction: tx }, {
        onSuccess: (r) => { setTxStatus({ type: "success", msg: `Staked! Tx: ${r.digest.slice(0,16)}...` }); setTimeout(() => { fetchData(); fetchReceipts(); fetchLoyalty(); fetchLeaderboard(); }, 3000); },
        onError: (e) => setTxStatus({ type: "error", msg: e.message }),
      });
    } catch (e) { setTxStatus({ type: "error", msg: e.message }); }
  }

  async function handleUnstake(receiptId) {
    setTxStatus({ type: "pending", msg: "Requesting unstake..." });
    const tx = new Transaction();
    tx.setGasPrice(1000);
    tx.moveCall({ target: `${PACKAGE}::stake_vault::request_unstake_staked`, arguments: [tx.object(STAKING_VAULT), tx.object(receiptId), tx.object("0x6")] });
    signAndExecute({ transaction: tx }, {
      onSuccess: () => { setTxStatus({ type: "success", msg: "Unstake requested — 1 epoch delay" }); setTimeout(fetchReceipts, 3000); },
      onError: (e) => setTxStatus({ type: "error", msg: e.message }),
    });
  }


  async function handleWithdraw(receiptId) {
    setTxStatus({ type: "pending", msg: "Withdrawing..." });
    try {
      // Check if LoyaltyRecord exists
      const objs = await client.getOwnedObjects({ 
        owner: account.address, 
        filter: { StructType: `${PACKAGE_TYPE}::loyalty_tracker::LoyaltyRecord` }, 
        options: { showContent: true } 
      });
      
      if (!objs.data.length) {
        // Step 1: Create LoyaltyRecord first
        setTxStatus({ type: "pending", msg: "Step 1/2: Creating loyalty record..." });
        const tx1 = new Transaction();
        tx1.setGasPrice(1000);
        const record = tx1.moveCall({ 
          target: `${PACKAGE}::loyalty_tracker::new_record`, 
          arguments: [tx1.object("0x6")] 
        });
        tx1.transferObjects([record], tx1.pure.address(account.address));
        
        signAndExecute({ transaction: tx1 }, {
          onSuccess: async () => {
            setTxStatus({ type: "pending", msg: "Step 2/2: Withdrawing..." });
            await new Promise(res => setTimeout(res, 3000));
            
            const objs2 = await client.getOwnedObjects({ 
              owner: account.address, 
              filter: { StructType: `${PACKAGE_TYPE}::loyalty_tracker::LoyaltyRecord` }, 
              options: { showContent: true } 
            });
            if (!objs2.data.length) { 
              setTxStatus({ type: "error", msg: "LoyaltyRecord creation failed" }); 
              return; 
            }
            const loyaltyId = objs2.data[0].data.objectId;
            const tx2 = new Transaction();
            tx2.setGasPrice(1000);
            tx2.moveCall({
              target: `${PACKAGE}::stake_vault::withdraw_staked`,
              arguments: [tx2.object(STAKING_VAULT), tx2.object(receiptId), tx2.object(loyaltyId), tx2.object("0x6")],
            });
            signAndExecute({ transaction: tx2 }, {
              onSuccess: (r) => { 
                setTxStatus({ type: "success", msg: `Withdrawn! Tx: ${r.digest.slice(0,16)}...` }); 
                setTimeout(() => { fetchData(); fetchReceipts(); fetchLoyalty(); }, 3000); 
              },
              onError: (e) => setTxStatus({ type: "error", msg: e.message }),
            });
          },
          onError: (e) => setTxStatus({ type: "error", msg: e.message }),
        });
        return;
      }
      
      // LoyaltyRecord exists — direct withdraw
      const loyaltyId = objs.data[0].data.objectId;
      const tx = new Transaction();
      tx.setGasPrice(1000);
      tx.moveCall({
        target: `${PACKAGE}::stake_vault::withdraw_staked`,
        arguments: [tx.object(STAKING_VAULT), tx.object(receiptId), tx.object(loyaltyId), tx.object("0x6")],
      });
      signAndExecute({ transaction: tx }, {
        onSuccess: (r) => { 
          setTxStatus({ type: "success", msg: `Withdrawn! Tx: ${r.digest.slice(0,16)}...` }); 
          setTimeout(() => { fetchData(); fetchReceipts(); fetchLoyalty(); }, 3000); 
        },
        onError: (e) => setTxStatus({ type: "error", msg: e.message }),
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


  async function handleWithdraw(receiptId) {
    setTxStatus({ type: "pending", msg: "Withdrawing..." });
    try {
      // Check if LoyaltyRecord exists
      const objs = await client.getOwnedObjects({ 
        owner: account.address, 
        filter: { StructType: `${PACKAGE_TYPE}::loyalty_tracker::LoyaltyRecord` }, 
        options: { showContent: true } 
      });
      
      if (!objs.data.length) {
        // Step 1: Create LoyaltyRecord first
        setTxStatus({ type: "pending", msg: "Step 1/2: Creating loyalty record..." });
        const tx1 = new Transaction();
        tx1.setGasPrice(1000);
        const record = tx1.moveCall({ 
          target: `${PACKAGE}::loyalty_tracker::new_record`, 
          arguments: [tx1.object("0x6")] 
        });
        tx1.transferObjects([record], tx1.pure.address(account.address));
        
        signAndExecute({ transaction: tx1 }, {
          onSuccess: async () => {
            setTxStatus({ type: "pending", msg: "Step 2/2: Withdrawing..." });
            await new Promise(res => setTimeout(res, 3000));
            
            const objs2 = await client.getOwnedObjects({ 
              owner: account.address, 
              filter: { StructType: `${PACKAGE_TYPE}::loyalty_tracker::LoyaltyRecord` }, 
              options: { showContent: true } 
            });
            if (!objs2.data.length) { 
              setTxStatus({ type: "error", msg: "LoyaltyRecord creation failed" }); 
              return; 
            }
            const loyaltyId = objs2.data[0].data.objectId;
            const tx2 = new Transaction();
            tx2.setGasPrice(1000);
            tx2.moveCall({
              target: `${PACKAGE}::stake_vault::withdraw_staked`,
              arguments: [tx2.object(STAKING_VAULT), tx2.object(receiptId), tx2.object(loyaltyId), tx2.object("0x6")],
            });
            signAndExecute({ transaction: tx2 }, {
              onSuccess: (r) => { 
                setTxStatus({ type: "success", msg: `Withdrawn! Tx: ${r.digest.slice(0,16)}...` }); 
                setTimeout(() => { fetchData(); fetchReceipts(); fetchLoyalty(); }, 3000); 
              },
              onError: (e) => setTxStatus({ type: "error", msg: e.message }),
            });
          },
          onError: (e) => setTxStatus({ type: "error", msg: e.message }),
        });
        return;
      }
      
      // LoyaltyRecord exists — direct withdraw
      const loyaltyId = objs.data[0].data.objectId;
      const tx = new Transaction();
      tx.setGasPrice(1000);
      tx.moveCall({
        target: `${PACKAGE}::stake_vault::withdraw_staked`,
        arguments: [tx.object(STAKING_VAULT), tx.object(receiptId), tx.object(loyaltyId), tx.object("0x6")],
      });
      signAndExecute({ transaction: tx }, {
        onSuccess: (r) => { 
          setTxStatus({ type: "success", msg: `Withdrawn! Tx: ${r.digest.slice(0,16)}...` }); 
          setTimeout(() => { fetchData(); fetchReceipts(); fetchLoyalty(); }, 3000); 
        },
        onError: (e) => setTxStatus({ type: "error", msg: e.message }),
      });
    } catch (e) { setTxStatus({ type: "error", msg: e.message }); }
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


  async function handleMigrate(receiptId, pkg, vault) {
    setLegacyStatus({ type: "pending", msg: "Migrating to new contract..." });
    try {
      const tx = new Transaction();
      tx.setGasPrice(1000);
      
      // Call migrate_from_legacy on the NEW contract
      // It will: withdraw from old vault, deposit to new vault, preserve loyalty timestamp
      const migrateCall = tx.moveCall({
        target: `${PACKAGE}::stake_vault::migrate_from_legacy`,
        arguments: [
          tx.object(VAULT),           // new vault
          tx.object(vault),           // old vault
          tx.object(receiptId),       // old receipt
          tx.object("0x6")            // clock
        ]
      });
      
      signAndExecute({ transaction: tx }, {
        onSuccess: (r) => { 
          setLegacyStatus({ type: "success", msg: `Migrated! Tx: ${r.digest.slice(0,16)}...` }); 
          setTimeout(() => { fetchLegacyReceipts(); fetchVaultData(); }, 3000); 
        },
        onError: (e) => setLegacyStatus({ type: "error", msg: e.message }),
      });
    } catch (e) { setLegacyStatus({ type: "error", msg: e.message }); }
  }

  function handleShare() {
    const text = `🌊 Surge Protocol — Prize-linked staking on Sui!\n\n${fmtSui(vaultData?.total_staked ?? 0)} SUI staked. Your principal is always safe — only the yield wins prizes.\n\n⚡ Spark · 🔄 Pulse · 🌊 Surge draws\n\nhttps://surgeonsui.com`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
  }

  const sui = parseFloat(stakeAmount) || 0;
  const sparkTickets = sui >= 1 ? 1 : 0;
  const pulseTickets = sui < 10 ? 0 : Math.max(1, Math.floor(Math.sqrt(sui)));
  const surgeTickets = sui < 50 ? 0 : Math.max(1, Math.floor(Math.sqrt(sui)));
  const totalStaked = vaultData?.total_staked ?? 0;
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
            <div style={{ flex: 1, padding: "1.5rem 1.75rem", background: "rgba(58,191,170,0.05)", display: "flex", flexDirection: "column", gap: "0.35rem", minWidth: 0 }}>
              <div style={{ fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(58,191,170,0.6)", fontWeight: 600 }}>My Stake</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#3ABFAA", letterSpacing: "-0.02em", lineHeight: 1, whiteSpace: "nowrap" }}>{myStakeSui.toFixed(2)}<span style={{ fontSize: "0.8rem", fontWeight: 400, color: "rgba(58,191,170,0.5)", marginLeft: 6 }}>SUI</span></div>
              <div style={{ fontSize: "0.75rem", color: "rgba(58,191,170,0.4)" }}>{suiPrice ? `≈ $${(myStakeSui * suiPrice).toFixed(2)} USD` : "Loading..."}</div>
            </div>
          </>}
        </div>
      </header>

      <main className="main">
        {globalStats && globalStats.pioneer_slots_left > 0 && (
          <div className="pioneer-banner" style={{ background: "linear-gradient(135deg, rgba(198,127,232,0.15), rgba(245,200,66,0.15))", border: "1px solid rgba(198,127,232,0.3)", borderRadius: 12, padding: "1rem 1.5rem", marginBottom: "1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <div style={{ fontSize: "0.85rem", color: "#C67FE8", fontWeight: 700, marginBottom: 4 }}>
                🏆 PIONEER PHASE — {globalStats.pioneer_slots_left}/1000 SLOTS LEFT
              </div>
              <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.6)" }}>
                First 1000 stakers earn 2x points forever. First 100 earn 3x.
              </div>
            </div>
            <div style={{ display: "flex", gap: "1.5rem", fontSize: "0.75rem", fontFamily: "DM Mono, monospace" }}>
              <div><span style={{ color: "rgba(255,255,255,0.4)" }}>Early Birds:</span> <span style={{ color: "#F5C842" }}>{globalStats.early_birds_filled}/100</span></div>
              <div><span style={{ color: "rgba(255,255,255,0.4)" }}>TVL:</span> <span style={{ color: "#3ABFAA" }}>{fmtSui(vaultData?.total_staked ?? 0)} SUI</span></div>
            </div>
          </div>
        )}
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
          {account && userPoints && (
            <section className="panel" style={{ background: userPoints.early_bird_rank ? "linear-gradient(135deg, rgba(245,200,66,0.08), rgba(198,127,232,0.08))" : userPoints.pioneer_rank ? "linear-gradient(135deg, rgba(198,127,232,0.08), rgba(58,191,170,0.08))" : "rgba(255,255,255,0.02)", border: userPoints.early_bird_rank ? "1px solid rgba(245,200,66,0.3)" : userPoints.pioneer_rank ? "1px solid rgba(198,127,232,0.3)" : "1px solid rgba(255,255,255,0.06)", marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
                <div>
                  <div style={{ fontSize: "0.75rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>
                    {userPoints.early_bird_rank ? "🌟 EARLY BIRD" : userPoints.pioneer_rank ? "🏆 PIONEER" : "👤 STAKER"} #{userPoints.early_bird_rank || userPoints.pioneer_rank || "—"}
                  </div>
                  <div style={{ fontSize: "2rem", fontWeight: 700, fontFamily: "DM Mono, monospace", color: userPoints.early_bird_rank ? "#F5C842" : userPoints.pioneer_rank ? "#C67FE8" : "#fff" }}>
                    {Number(userPoints.total_points).toFixed(2)}<span style={{ fontSize: "0.9rem", marginLeft: 6, color: "rgba(255,255,255,0.4)" }}>pts</span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Multiplier</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700, color: userPoints.early_bird_rank ? "#F5C842" : userPoints.pioneer_rank ? "#C67FE8" : "#3ABFAA" }}>
                    {Number(userPoints.multiplier).toFixed(1)}x
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.5)", marginTop: 2 }}>FOREVER</div>
                </div>
              </div>
              <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.4)", marginTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "0.75rem" }}>
                Earn ~{(Number(userPoints.current_stake_sui) * Number(userPoints.multiplier)).toFixed(2)} pts/day · {Number(userPoints.current_stake_sui).toFixed(2)} SUI staked
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
                {[{ name: "⚡ Spark", gate: 10, count: sparkTickets, color: "#F5C842" }, { name: "🔄 Pulse", gate: 50, count: pulseTickets, color: "#3ABFAA" }, { name: "🌊 Surge", gate: 200, count: surgeTickets, color: "#C67FE8" }].map(t => (
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
              <p className="loyalty-note">Resets on full withdrawal</p>
              <div className="info-rows">
                <div className="info-row"><span>Min. deposit</span><span>1 SUI</span></div>
                <div className="info-row"><span>Draw entry</span><span>1 / 10 / 50 SUI</span></div>
                <div className="info-row"><span>Unstake delay</span><span>1 epoch (~24h)</span></div>
                <div className="info-row"><span>Protocol fee</span><span style={{fontSize:"0.8rem", textAlign:"right"}}>2% of yield<br/><span style={{color:"rgba(255,255,255,0.4)"}}>1% ops · 1% marketing</span></span></div>
                <div className="info-row"><span>Randomness</span><span>sui::random (on-chain)</span></div>
              </div>
            </section>
          </div>

          {account && userReceipts.length > 0 && (
            <section className="panel positions">
              <div className="panel-title">Your Stakes</div>
              {userReceipts.map((r, i) => (
                <div className="position-row" key={i}>
                  <div>
                    <div className="pos-amount">{fmt(r.principal_mist, 4)} SUI</div>
                    <div className="pos-status">{(() => {
                      if (!r.unlock_ts_ms) return "✅ Active — earning tickets";
                      const unlockTs = Number(r.unlock_ts_ms);
                      if (Date.now() >= unlockTs) return "🟢 Ready to withdraw";
                      const diff = unlockTs - Date.now();
                      const h = Math.floor(diff / 3600000);
                      const m = Math.floor((diff % 3600000) / 60000);
                      return `⏳ Unstaking — ${h}h ${m}m left`;
                    })()}</div>
                  </div>
                  {!r.unlock_ts_ms && <button className="unstake-btn" onClick={() => handleUnstake(r.id?.id)}>Unstake</button>}
                  {r.unlock_ts_ms && Date.now() >= Number(r.unlock_ts_ms) && (
                    <button className="unstake-btn" style={{ background: "rgba(58,191,170,0.15)", color: "#3ABFAA", borderColor: "rgba(58,191,170,0.3)" }} onClick={() => handleWithdraw(r.id?.id)}>Withdraw</button>
                  )}
                </div>
              ))}
            </section>
          )}

          {account && legacyReceipts.length > 0 && (
            <section className="panel positions" style={{ borderColor: "rgba(245,200,66,0.3)" }}>
              <div className="panel-title" style={{ color: "#F5C842" }}>⚠️ Legacy Stakes (old contract)</div>
              <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.4)", marginBottom: "1rem" }}>These stakes are from a previous contract version. Withdraw to recover your SUI.</p>
              {legacyStatus && <div className={`tx-status ${legacyStatus.type}`} style={{ marginBottom: "1rem" }}>{legacyStatus.msg}</div>}
              {legacyReceipts.map((r, i) => {
                const canMigrate = !r.unlock_ts_ms && r.deposit_ts_ms; // still staked
                const isReady = r.unlock_ts_ms && Date.now() >= parseInt(r.unlock_ts_ms);
                return (
                  <div className="position-row" key={i}>
                    <div>
                      <div className="pos-amount">{fmt(r.principal_mist, 4)} SUI</div>
                      <div className="pos-status">{isReady ? "⏰ Ready to withdraw" : canMigrate ? "🔄 Can migrate seamlessly" : "⏳ Unstaking..."}</div>
                    </div>
                    {canMigrate ? (
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button className="unstake-btn" style={{ background: "rgba(198,127,232,0.15)", color: "#C67FE8", borderColor: "rgba(198,127,232,0.3)" }} onClick={() => handleMigrate(r.objectId, r.legacyPkg, r.legacyVault)}>Migrate</button>
                        <button className="unstake-btn" style={{ background: "rgba(245,200,66,0.05)", color: "rgba(245,200,66,0.6)", borderColor: "rgba(245,200,66,0.2)", fontSize: "0.8rem" }} onClick={() => handleLegacyRequestUnstake(r.objectId, r.legacyPkg)}>Unstake</button>
                      </div>
                    ) : isReady ? (
                      <button className="unstake-btn" style={{ background: "rgba(58,191,170,0.15)", color: "#3ABFAA", borderColor: "rgba(58,191,170,0.3)" }} onClick={() => handleLegacyWithdraw(r.objectId, r.legacyPkg, r.legacyVault)}>Withdraw</button>
                    ) : null}
                  </div>
                );
              })}
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

        {/* Tab: APY Calculator */}
        {activeTab === "calculator" && <ApyCalculator suiPrice={suiPrice} />}

        {/* FAQ */}
        <section style={{ padding: "0 0 2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.5rem" }}>
            <div style={{ flex: 1, height: "0.5px", background: "rgba(255,255,255,0.06)" }} />
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.18em", color: "rgba(255,255,255,0.25)" }}>FAQ</div>
            <div style={{ flex: 1, height: "0.5px", background: "rgba(255,255,255,0.06)" }} />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
          {[
            { q: "Is my principal safe?", a: "Yes. Your deposited SUI is held in the vault. Only the staking yield goes into prize pools — your principal is never at risk.", icon: "🔒" },
            { q: "How does the prize pool get funded?", a: "Yield is harvested and split: 20% Spark, 30% Pulse, 50% Surge. A 2% protocol fee is deducted first.", icon: "💰" },
            { q: "How are winners selected?", a: "Winners are chosen using sui::random — Sui's native on-chain verifiable randomness. No one can predict or manipulate the outcome.", icon: "🎲" },
            { q: "How often are draws held?", a: "Spark every 6h (3 winners), Pulse weekly (4 winners), Surge monthly (1 jackpot). Fully automated by the Crank.", icon: "⏰" },
            { q: "What is the unstake delay?", a: "1 epoch (~24 hours). After requesting unstake, wait one epoch, then withdraw your full principal.", icon: "⏳" },
            { q: "What is the minimum deposit?", a: "1 SUI to deposit. You need 10 SUI for Spark draws, 50 SUI for Pulse, 200 SUI for Surge.", icon: "📥" },
            { q: "Is the contract audited?", a: "Built for Sui Overflow 2026, open source on GitHub (surge-dev). Security fixes include AdminCap protection and on-chain VRF. Formal audit planned post-hackathon.", icon: "🛡️" },
          ].map((item, i) => (
            <div key={i} style={{ background: openFaq === i ? "rgba(232,160,39,0.04)" : "var(--bg2)", border: `0.5px solid ${openFaq === i ? "rgba(232,160,39,0.2)" : "var(--border)"}`, borderRadius: 10, overflow: "hidden", transition: "all 0.2s" }}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "1rem 1.2rem", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontSize: 16, minWidth: 24 }}>{item.icon}</span>
                <span style={{ flex: 1, fontFamily: "'DM Sans', sans-serif", fontSize: "0.875rem", color: openFaq === i ? "#E8A027" : "rgba(255,255,255,0.8)", fontWeight: 500, transition: "color 0.2s" }}>{item.q}</span>
                <span style={{ color: "rgba(255,255,255,0.25)", fontSize: "1.1rem", lineHeight: 1, transform: openFaq === i ? "rotate(45deg)" : "none", transition: "transform 0.2s", minWidth: 20, textAlign: "center" }}>+</span>
              </button>
              {openFaq === i && <div style={{ padding: "0 1.2rem 1rem 3.2rem", fontFamily: "'DM Mono', monospace", fontSize: "0.8rem", color: "rgba(255,255,255,0.5)", lineHeight: 1.75 }}>{item.a}</div>}
            </div>
          ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>Surge Protocol · Sui Mainnet · V4</span>
        <a href="https://github.com/PBerHH/surge-protocol" target="_blank" rel="noreferrer">GitHub ↗</a>
        <a href="https://x.com/Surge_Sui" target="_blank" rel="noreferrer">𝕏 Twitter ↗</a>
        <a href="https://t.me/surge_sui" target="_blank" rel="noreferrer">Telegram ↗</a>
      </footer>
    </div>
  );
}

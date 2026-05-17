import { useState, useEffect, useCallback } from "react";
import { ConnectButton, useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

// ── Contract Config ─────────────────────────────────────────────────────────
const PACKAGE    = "0x2755c0b895605f21f67b67f8ba58aa4b4b83759cd0d1a1fbb666ec9355c29d50";
const VAULT      = "0x5cd4c73e20d876b1105fa49049e1ee903e9eac382867ce1d597719c5877e6a26";
const DRAW_STATE = "0x5e8faab779a88ed2efa9f8523f66ff6238d5e5d7f64b45b365fc05a048e94a2b";
const REWARD_POOL = "0x2a0bc690ff0c1acb1d30b3b51c151444ff8fca09e557a64a423ac3583462f846";
const SUI_SYSTEM_STATE = "0x5";

// ── Legacy Contract Addresses ────────────────────────────────────────────────
const LEGACY_PACKAGE = "0xc44d56c34b04fc54386ed2de7d757133ab77bbab60c18de3d0a1d640298f3396";
const LEGACY_VAULT   = "0x0aa9c18818087b3e9e32c6eef8f3b17ce98670d5ac00eb54fd559d0d98db76be";
const LEGACY2_PACKAGE = "0x51ce7917adc5b9d7e7faa5988dfbbc1e2abbac5ae14cb38834f23e9a1d6109dc";
const LEGACY2_VAULT   = "0x0430bf6c920033e5df27a371071a2f54844da65a103d08e35fb316eaa7134db9";


function fmt(mist, dec = 3) {
  return (Number(BigInt(mist ?? 0)) / 1e9).toFixed(dec);
}

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

// ── Main App ─────────────────────────────────────────────────────────────────
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
  const [openFaq, setOpenFaq] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [pool, draw, vault] = await Promise.all([
        client.getObject({ id: REWARD_POOL, options: { showContent: true } }),
        client.getObject({ id: DRAW_STATE, options: { showContent: true } }),
        client.getObject({ id: VAULT, options: { showContent: true } }),
      ]);
      if (pool.data?.content?.fields) setPoolData(pool.data.content.fields);
      if (draw.data?.content?.fields) setDrawData(draw.data.content.fields);
      if (vault.data?.content?.fields) setVaultData(vault.data.content.fields);
    } catch (e) { console.error(e); }
  }, [client]);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 15000);
    return () => clearInterval(t);
  }, [fetchData]);


  const fetchLastWinners = useCallback(async () => {
    try {
      const events = await client.queryEvents({
        query: { MoveModule: { package: PACKAGE, module: 'reward_pool' } },
        limit: 9,
        order: 'descending',
      });
      const winners = events.data
        .filter(e => e.type?.includes('PrizeAwarded') && Number(e.parsedJson?.amount_mist) > 0)
        .map(e => ({
          winner: e.parsedJson.winner,
          amount: Number(e.parsedJson.amount_mist) / 1e9,
          pool: ['Spark', 'Pulse', 'Surge'][e.parsedJson.pool] ?? 'Draw',
          ts: e.timestampMs,
        }));
      setLastWinners(winners);
    } catch (e) { console.error(e); }
  }, [client]);

  useEffect(() => {
    fetchLastWinners();
    const t = setInterval(fetchLastWinners, 30000);
    return () => clearInterval(t);
  }, [fetchLastWinners]);

  const fetchReceipts = useCallback(async () => {
    if (!account?.address) return;
    try {
      const objs = await client.getOwnedObjects({
        owner: account.address,
        filter: { StructType: `${PACKAGE}::stake_vault::StakeReceipt` },
        options: { showContent: true },
      });
      setUserReceipts(objs.data.map(o => o.data?.content?.fields).filter(Boolean));
    } catch (e) { console.error(e); }
  }, [account, client]);

  useEffect(() => { fetchReceipts(); }, [fetchReceipts]);

  // Fetch legacy receipts from all old contracts
  const fetchLegacyReceipts = useCallback(async () => {
    if (!account?.address) return;
    try {
      const [objs1, objs2] = await Promise.all([
        client.getOwnedObjects({ owner: account.address, filter: { StructType: `${LEGACY_PACKAGE}::stake_vault::StakeReceipt` }, options: { showContent: true } }),
        client.getOwnedObjects({ owner: account.address, filter: { StructType: `${LEGACY2_PACKAGE}::stake_vault::StakeReceipt` }, options: { showContent: true } }),
      ]);
      const r1 = objs1.data.map(o => o.data?.content?.fields && { ...o.data.content.fields, objectId: o.data.objectId, legacyPkg: LEGACY_PACKAGE, legacyVault: LEGACY_VAULT }).filter(Boolean);
      const r2 = objs2.data.map(o => o.data?.content?.fields && { ...o.data.content.fields, objectId: o.data.objectId, legacyPkg: LEGACY2_PACKAGE, legacyVault: LEGACY2_VAULT }).filter(Boolean);
      setLegacyReceipts([...r1, ...r2]);
    } catch (e) { console.error(e); }
  }, [account, client]);

  useEffect(() => { fetchLegacyReceipts(); }, [fetchLegacyReceipts]);

  async function handleLegacyRequestUnstake(receiptId, pkg) {
    setLegacyStatus({ type: "pending", msg: "Requesting unstake..." });
    try {
      const tx = new Transaction();
      tx.setGasPrice(1000);
      tx.moveCall({
        target: `${pkg}::stake_vault::request_unstake`,
        arguments: [tx.object(receiptId), tx.object("0x6")],
      });
      signAndExecute({ transaction: tx }, {
        onSuccess: (r) => { setLegacyStatus({ type: "success", msg: `Unstake requested! Wait ~24h. Tx: ${r.digest.slice(0,16)}...` }); setTimeout(fetchLegacyReceipts, 3000); },
        onError: (e) => setLegacyStatus({ type: "error", msg: e.message }),
      });
    } catch (e) { setLegacyStatus({ type: "error", msg: e.message }); }
  }

  async function handleLegacyWithdraw(receiptId, pkg, vault) {
    setLegacyStatus({ type: "pending", msg: "Step 1/2: Creating loyalty record..." });
    try {
      // Step 1: Create LoyaltyRecord
      const tx1 = new Transaction();
      tx1.setGasPrice(1000);
      const record = tx1.moveCall({
        target: `${pkg}::loyalty_tracker::new_record`,
        arguments: [tx1.object("0x6")],
      });
      tx1.transferObjects([record], tx1.pure.address(account.address));

      signAndExecute({ transaction: tx1 }, {
        onSuccess: async (r1) => {
          setLegacyStatus({ type: "pending", msg: "Step 2/2: Withdrawing SUI..." });

          // Find the created LoyaltyRecord object
          await new Promise(res => setTimeout(res, 3000));
          const objs = await client.getOwnedObjects({
            owner: account.address,
            filter: { StructType: `${pkg}::loyalty_tracker::LoyaltyRecord` },
            options: { showContent: true },
          });
          if (!objs.data.length) {
            setLegacyStatus({ type: "error", msg: "LoyaltyRecord not found after creation" });
            return;
          }
          const loyaltyId = objs.data[0].data.objectId;

          // Step 2: Withdraw
          const tx2 = new Transaction();
          tx2.setGasPrice(1000);
          tx2.moveCall({
            target: `${pkg}::stake_vault::withdraw`,
            arguments: [
              tx2.object(vault),
              tx2.sharedObjectRef({ objectId: "0x0000000000000000000000000000000000000000000000000000000000000005", initialSharedVersion: 1, mutable: true }),
              tx2.object(receiptId),
              tx2.object(loyaltyId),
              tx2.object("0x6"),
            ],
          });
          signAndExecute({ transaction: tx2 }, {
            onSuccess: (r2) => { setLegacyStatus({ type: "success", msg: `Withdrawn! Tx: ${r2.digest.slice(0,16)}...` }); setTimeout(fetchLegacyReceipts, 3000); },
            onError: (e) => setLegacyStatus({ type: "error", msg: e.message }),
          });
        },
        onError: (e) => setLegacyStatus({ type: "error", msg: e.message }),
      });
    } catch (e) { setLegacyStatus({ type: "error", msg: e.message }); }
  }

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
        target: `${PACKAGE}::stake_vault::deposit`,
        arguments: [
          tx.object(VAULT),
          tx.sharedObjectRef({ objectId: "0x0000000000000000000000000000000000000000000000000000000000000005", initialSharedVersion: 1, mutable: true }),
          coin,
          tx.object("0x6"),
        ],
      });
      signAndExecute({ transaction: tx }, {
        onSuccess: (r) => {
          setTxStatus({ type: "success", msg: `Staked! Tx: ${r.digest.slice(0,16)}...` });
          setTimeout(() => { fetchData(); fetchReceipts(); }, 3000);
        },
        onError: (e) => setTxStatus({ type: "error", msg: e.message }),
      });
    } catch (e) { setTxStatus({ type: "error", msg: e.message }); }
  }

  async function handleUnstake(receiptId) {
    setTxStatus({ type: "pending", msg: "Requesting unstake..." });
    const tx = new Transaction();
    tx.setGasPrice(1000);
    tx.moveCall({
      target: `${PACKAGE}::stake_vault::request_unstake`,
      arguments: [tx.object(receiptId), tx.object("0x6")],
    });
    signAndExecute({ transaction: tx }, {
      onSuccess: () => { setTxStatus({ type: "success", msg: "Unstake requested — 1 epoch delay" }); setTimeout(fetchReceipts, 3000); },
      onError: (e) => setTxStatus({ type: "error", msg: e.message }),
    });
  }

  const sui = parseFloat(stakeAmount) || 0;
  const sparkTickets = sui >= 10 ? Math.min(Math.floor(sui), 500) : 0;
  const pulseTickets = sui >= 50 ? (sui <= 1000 ? Math.floor(sui) : Math.floor(1000 + Math.sqrt(sui - 1000))) : 0;
  const surgeTickets = sui >= 200 ? Math.floor(sui) : 0;

  const totalStaked = vaultData?.total_staked ?? 0;
  const totalPrizes = [poolData?.spark_pool, poolData?.pulse_pool, poolData?.surge_pool]
    .reduce((acc, v) => acc + Number(BigInt(v ?? 0)), 0);

  const myStakeMist = userReceipts.reduce((acc, r) => acc + Number(BigInt(r.principal_mist ?? 0)), 0);
  const myStakeSui = myStakeMist / 1e9;

  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd")
      .then(r => r.json())
      .then(d => setSuiPrice(d?.sui?.usd ?? null))
      .catch(() => {});
  }, []);

  const draws = [
    { name: "Spark", emoji: "⚡", color: "#F5C842", colorDim: "rgba(245,200,66,0.1)", freq: "Every 6h · 3 winners", share: "20%", pool: poolData?.spark_pool, next: drawData?.next_spark_ms },
    { name: "Pulse", emoji: "🔄", color: "#3ABFAA", colorDim: "rgba(58,191,170,0.1)", freq: "Weekly · 4 winners", share: "30%", pool: poolData?.pulse_pool, next: drawData?.next_pulse_ms },
    { name: "Surge", emoji: "🌊", color: "#C67FE8", colorDim: "rgba(198,127,232,0.1)", freq: "Monthly · 1 jackpot", share: "50%", pool: poolData?.surge_pool, next: drawData?.next_surge_ms },
  ];

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-left">
          <div className="nav-logo">SURGE</div>
          
        </div>
        <ConnectButton />
      </nav>

      <header className="hero">
        <div className="hero-eyebrow">Prize-linked staking on Sui</div>
        <h1 className="hero-title">
          Your principal is safe.<br />
          <em>Only the yield wins prizes.</em>
        </h1>

        <div style={{
          display: "flex",
          gap: "1px",
          maxWidth: 520,
          margin: "2.5rem auto 0",
          background: "rgba(255,255,255,0.06)",
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          {/* Total Staked */}
          <div style={{
            flex: 1,
            padding: "1.5rem 1.75rem",
            background: "rgba(255,255,255,0.03)",
            display: "flex",
            flexDirection: "column",
            gap: "0.35rem",
          }}>
            <div style={{ fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>
              Total Staked
            </div>
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1 }}>
              {fmtSui(totalStaked)}
              <span style={{ fontSize: "0.9rem", fontWeight: 400, color: "rgba(255,255,255,0.4)", marginLeft: 6 }}>SUI</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.25)" }}>Principal protected</div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, background: "rgba(255,255,255,0.06)" }} />

          {/* Total Prize Pool */}
          <div style={{
            flex: 1,
            padding: "1.5rem 1.75rem",
            background: "rgba(198,127,232,0.05)",
            display: "flex",
            flexDirection: "column",
            gap: "0.35rem",
          }}>
            <div style={{ fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(198,127,232,0.6)", fontWeight: 600 }}>
              Prize Pool
            </div>
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "#C67FE8", letterSpacing: "-0.02em", lineHeight: 1, textShadow: "0 0 24px rgba(198,127,232,0.4)" }}>
              {fmtSui(totalPrizes)}
              <span style={{ fontSize: "0.9rem", fontWeight: 400, color: "rgba(198,127,232,0.5)", marginLeft: 6 }}>SUI</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "rgba(198,127,232,0.35)" }}>Spark · Pulse · Surge</div>
          </div>

          {account && myStakeSui > 0 && <>
            <div style={{ width: 1, background: "rgba(255,255,255,0.06)" }} />
            <div style={{
              flex: 1,
              padding: "1.5rem 1.75rem",
              background: "rgba(58,191,170,0.05)",
              display: "flex",
              flexDirection: "column",
              gap: "0.35rem",
            }}>
              <div style={{ fontSize: "0.7rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(58,191,170,0.6)", fontWeight: 600 }}>
                My Stake
              </div>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: "#3ABFAA", letterSpacing: "-0.02em", lineHeight: 1 }}>
                {myStakeSui.toFixed(3)}
                <span style={{ fontSize: "0.9rem", fontWeight: 400, color: "rgba(58,191,170,0.5)", marginLeft: 6 }}>SUI</span>
              </div>
              <div style={{ fontSize: "0.75rem", color: "rgba(58,191,170,0.4)" }}>
                {suiPrice ? `≈ $${(myStakeSui * suiPrice).toFixed(2)} USD` : "Loading price..."}
              </div>
            </div>
          </>}
        </div>
      </header>

      <main className="main">
        <section className="draws">
          {draws.map(d => {
            const { label, urgent } = countdown(d.next);
            const diff = d.next && d.next !== '0' ? Number(BigInt(d.next)) - Date.now() : Infinity;
            const isFomo = d.name === "Spark" && diff > 0 && diff < 3600000;
            return (
              <div className={`draw-card${isFomo ? " spark-fomo" : ""}`} key={d.name} style={{ "--accent": d.color, "--accent-dim": d.colorDim }}>
                <div className="draw-header">
                  <span className="draw-emoji">{d.emoji}</span>
                  <span className="draw-name">{d.name}</span>
                  <span className="draw-share">{d.share}</span>
                </div>
                <div className="draw-prize">{fmtSui(d.pool ?? 0)} <span className="draw-sui">SUI</span></div>
                <div className="draw-freq">{d.freq}</div>
                <div className={`draw-countdown ${isFomo ? "fomo" : urgent ? "urgent" : ""}`} key={tick}>{label}</div>
              </div>
            );
          })}
        </section>

        <div className="two-col">
          <section className="panel stake-panel">
            <div className="panel-title">Deposit SUI</div>
            <div className="input-row">
              <input
                className="stake-input"
                type="number"
                value={stakeAmount}
                onChange={e => { setStakeAmount(e.target.value); setTxStatus(null); }}
                placeholder="100"
                min="1"
              />
              <span className="input-denom">SUI</span>
            </div>

            <div className="tickets">
              {[
                { name: "⚡ Spark", gate: 10, count: sparkTickets, color: "#F5C842" },
                { name: "🔄 Pulse", gate: 50, count: pulseTickets, color: "#3ABFAA" },
                { name: "🌊 Surge", gate: 200, count: surgeTickets, color: "#C67FE8" },
              ].map(t => (
                <div className={`ticket ${t.count > 0 ? "active" : ""}`} key={t.name} style={{ "--tc": t.color }}>
                  <span className="ticket-name">{t.name}</span>
                  <span className="ticket-count">{t.count > 0 ? `${t.count} tickets` : `min ${t.gate} SUI`}</span>
                </div>
              ))}
            </div>

            {txStatus && (
              <div className={`tx-status ${txStatus.type}`}>{txStatus.msg}</div>
            )}

            <button className="stake-btn" onClick={handleStake} disabled={!account || txStatus?.type === "pending"}>
              {!account ? "Connect wallet to stake" : txStatus?.type === "pending" ? "Confirming..." : `Stake ${stakeAmount || "0"} SUI`}
            </button>
            <p className="stake-note">Principal always protected · 1-epoch unstake · Pyth Entropy VRF</p>
          </section>

          <section className="panel loyalty-panel">
            <div className="panel-title">Loyalty Multiplier</div>
            <div className="loyalty-tiers">
              {[
                { days: "0d", mult: "1.0x", active: true },
                { days: "30d", mult: "1.2x", active: false },
                { days: "90d", mult: "1.5x", active: false },
                { days: "180d", mult: "1.8x", active: false },
                { days: "365d", mult: "2.0x", active: false },
              ].map(t => (
                <div className={`tier ${t.active ? "current" : ""}`} key={t.days}>
                  <div className="tier-mult">{t.mult}</div>
                  <div className="tier-days">{t.days}</div>
                </div>
              ))}
            </div>
            <div className="loyalty-track"><div className="loyalty-fill" style={{ width: "5%" }} /></div>
            <p className="loyalty-note">Streak bonus up to +0.3x · Resets on full withdrawal</p>

            <div className="info-rows">
              <div className="info-row"><span>Min. deposit</span><span>1 SUI (10 SUI for Spark draws)</span></div>
              <div className="info-row"><span>Unstake delay</span><span>1 epoch</span></div>
              <div className="info-row"><span>Protocol fee</span><span>2% of yield</span></div>
              <div className="info-row"><span>Randomness</span><span>Pyth Entropy</span></div>
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
                  <div className="pos-status">{r.unlock_ts_ms ? "⏳ Unstaking in progress" : "✅ Active — earning tickets"}</div>
                </div>
                {!r.unlock_ts_ms && (
                  <button className="unstake-btn" onClick={() => handleUnstake(r.id?.id)}>Unstake</button>
                )}
              </div>
            ))}
          </section>
        )}

        {account && legacyReceipts.length > 0 && (
          <section className="panel positions" style={{ borderColor: "rgba(245,200,66,0.3)" }}>
            <div className="panel-title" style={{ color: "#F5C842" }}>⚠️ Legacy Stakes (old contract)</div>
            <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.4)", marginBottom: "1rem" }}>
              These stakes are from a previous contract version. Unstake and withdraw to recover your SUI.
            </p>
            {legacyStatus && (
              <div className={`tx-status ${legacyStatus.type}`} style={{ marginBottom: "1rem" }}>{legacyStatus.msg}</div>
            )}
            {legacyReceipts.map((r, i) => (
              <div className="position-row" key={i}>
                <div>
                  <div className="pos-amount">{fmt(r.principal_mist, 4)} SUI</div>
                  <div className="pos-status">{r.unlock_ts_ms ? "⏳ Ready to withdraw" : "🔒 Needs unstake request"}</div>
                </div>
                {!r.unlock_ts_ms ? (
                  <button className="unstake-btn" style={{ background: "rgba(245,200,66,0.15)", color: "#F5C842", borderColor: "rgba(245,200,66,0.3)" }}
                    onClick={() => handleLegacyRequestUnstake(r.objectId, r.legacyPkg)}>
                    Request Unstake
                  </button>
                ) : (
                  <button className="unstake-btn" style={{ background: "rgba(58,191,170,0.15)", color: "#3ABFAA", borderColor: "rgba(58,191,170,0.3)" }}
                    onClick={() => handleLegacyWithdraw(r.objectId, r.legacyPkg, r.legacyVault)}>
                    Withdraw
                  </button>
                )}
              </div>
            ))}
          </section>
        )}
      </main>


        {lastWinners.length > 0 && (
          <section className="panel" style={{ marginTop: 0 }}>
            <div className="panel-title">🏆 Recent Winners</div>
            {lastWinners.map((w, i) => (
              <div className="position-row" key={i}>
                <div>
                  <div className="pos-amount" style={{ fontSize: "0.85rem" }}>
                    <span style={{ color: w.pool === 'Spark' ? '#F5C842' : w.pool === 'Pulse' ? '#3ABFAA' : '#C67FE8', marginRight: 8 }}>
                      {w.pool === 'Spark' ? '⚡' : w.pool === 'Pulse' ? '🔄' : '🌊'} {w.pool}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'DM Mono, monospace', fontSize: '0.75rem' }}>
                      {w.winner.slice(0, 6)}...{w.winner.slice(-4)}
                    </span>
                  </div>
                  <div className="pos-status">{new Date(Number(w.ts)).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <div style={{ fontFamily: 'DM Mono, monospace', color: '#3ABFAA', fontWeight: 600 }}>
                  +{w.amount.toFixed(4)} SUI
                </div>
              </div>
            ))}
          </section>
        )}


        <section style={{ maxWidth: 800, margin: "0 auto", padding: "0 0 2rem" }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(255,255,255,0.3)", marginBottom: "1rem" }}>FAQ</div>
          {[
            { q: "Is my principal safe?", a: "Yes. Your deposited SUI is delegated to Triton One validator via Sui's native staking. Only the staking yield goes into prize pools — your principal is never at risk and can always be withdrawn." },
            { q: "How does the prize pool get funded?", a: "When you stake SUI, it earns ~1.5% APY from Triton One. This yield is automatically harvested and split: 20% into Spark, 30% into Pulse, 50% into Surge. A 2% protocol fee is deducted before distribution." },
            { q: "How are winners selected?", a: "Winners are chosen using Pyth Entropy VRF — a verifiable random function on-chain. Every staker gets tickets proportional to their stake. The more you stake, the higher your chances." },
            { q: "How often are draws held?", a: "Spark draws every 6 hours (3 winners), Pulse weekly (4 winners), Surge monthly (1 jackpot winner). All draws are fully automated by the Crank." },
            { q: "What is the unstake delay?", a: "1 epoch (~24 hours). After requesting unstake you wait one epoch, then you can withdraw your full principal." },
            { q: "What is the protocol fee?", a: "2% of yield is taken as a protocol fee at harvest time. This goes directly to the fee wallet. Your principal is never charged." },
            { q: "Which validator is used?", a: "Triton One — a professional, high-performance validator on Sui Mainnet with 99.9% uptime and 4% commission rate." },
            { q: "Is the contract audited?", a: "The protocol was built for Sui Overflow 2026 and is open source on GitHub. A formal audit is planned post-hackathon." },
          ].map((item, i) => (
            <div key={i} style={{ borderBottom: "0.5px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 0", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.9rem", color: "rgba(255,255,255,0.85)", fontWeight: 500 }}>{item.q}</span>
                <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "1.2rem", lineHeight: 1, transform: openFaq === i ? "rotate(45deg)" : "none", transition: "transform 0.2s" }}>+</span>
              </button>
              {openFaq === i && (
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.8rem", color: "rgba(255,255,255,0.45)", lineHeight: 1.7, paddingBottom: "1rem" }}>
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </section>
      <footer className="footer">
        <span>Surge Protocol · Sui Mainnet · V2</span>
        <a href="https://github.com/PBerHH/surge-protocol" target="_blank" rel="noreferrer">GitHub ↗</a>
      </footer>
    </div>
  );
}

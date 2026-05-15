import { useState, useEffect, useCallback } from "react";
import { ConnectButton, useCurrentAccount, useSuiClient, useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";

// ── Contract Config ─────────────────────────────────────────────────────────
const PACKAGE    = "0xc44d56c34b04fc54386ed2de7d757133ab77bbab60c18de3d0a1d640298f3396";
const VAULT      = "0x4d859f119d1d55dca5858d07a1ef59f743baff05fc67aae0a03debef8d207f9a";
const DRAW_STATE = "0x57c94b7c05cb0499575fd06ed4e31c1ec026a01a0fe87973e608f675a672ee8a";
const REWARD_POOL = "0xb92ec4274ad888e5394f38fa12e8fcf780acab7ff4429a4a628f66b82f8e8115";
const SUI_SYSTEM_STATE = "0x5";

// ── Helpers ──────────────────────────────────────────────────────────────────
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
  const [tick, setTick] = useState(0);

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

  const draws = [
    { name: "Spark", emoji: "⚡", color: "#F5C842", colorDim: "rgba(245,200,66,0.1)", freq: "Daily · 15 winners", share: "20%", pool: poolData?.spark_pool, next: drawData?.next_spark_ms },
    { name: "Pulse", emoji: "🔄", color: "#3ABFAA", colorDim: "rgba(58,191,170,0.1)", freq: "Weekly · 4 winners", share: "30%", pool: poolData?.pulse_pool, next: drawData?.next_pulse_ms },
    { name: "Surge", emoji: "🌊", color: "#C67FE8", colorDim: "rgba(198,127,232,0.1)", freq: "Monthly · 1 jackpot", share: "50%", pool: poolData?.surge_pool, next: drawData?.next_surge_ms },
  ];

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-left">
          <div className="nav-logo">SURGE</div>
          <div className="nav-tagline">Prize-linked staking · Sui Testnet</div>
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
        </div>
      </header>

      <main className="main">
        <section className="draws">
          {draws.map(d => {
            const { label, urgent } = countdown(d.next);
            return (
              <div className="draw-card" key={d.name} style={{ "--accent": d.color, "--accent-dim": d.colorDim }}>
                <div className="draw-header">
                  <span className="draw-emoji">{d.emoji}</span>
                  <span className="draw-name">{d.name}</span>
                  <span className="draw-share">{d.share}</span>
                </div>
                <div className="draw-prize">{fmtSui(d.pool ?? 0)} <span className="draw-sui">SUI</span></div>
                <div className="draw-freq">{d.freq}</div>
                <div className={`draw-countdown ${urgent ? "urgent" : ""}`} key={tick}>{label}</div>
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
      </main>

      <footer className="footer">
        <span>Surge Protocol · Sui Mainnet · V2 · Built for Sui Overflow 2026</span>
        <a href="https://github.com/PBerHH/surge-protocol" target="_blank" rel="noreferrer">GitHub ↗</a>
      </footer>
    </div>
  );
}

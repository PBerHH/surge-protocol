require('dotenv/config');

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');

// ── Config ────────────────────────────────────────────────────────────────────

const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID          = process.env.TELEGRAM_CHAT_ID   ?? '';
const PACKAGE_ID       = process.env.PACKAGE_ID         ?? '';
const PACKAGE_TYPE_ID  = process.env.PACKAGE_TYPE_ID    ?? '';
const STAKING_VAULT    = process.env.STAKING_VAULT      ?? '';
const REWARD_POOL      = process.env.REWARD_POOL        ?? '';
const V6_PACKAGE       = process.env.V6_PACKAGE ?? '0xaf489faa2a23db82265e25c833f2cf9b985eb0a8d4acde121c7e14c111c3b62e';
const V6_VAULT         = process.env.V6_VAULT   ?? '0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5';
const HAEDAL_PKG_ORIG  = process.env.HAEDAL_PKG_ORIG ?? '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d';
const HAEDAL_STAKING   = process.env.HAEDAL_STAKING  ?? '0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca';
const NETWORK          = process.env.NETWORK            ?? 'mainnet';

const POLL_MS          = 60_000;   // check for new events every minute
const STATS_INTERVAL   = 86_400_000; // post stats once per day
const WHALE_MIN_SUI    = 100;      // minimum stake size for a whale alert

if (!TELEGRAM_TOKEN || !CHAT_ID || !PACKAGE_ID) {
  console.error('❌ Missing env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, PACKAGE_ID');
  process.exit(1);
}

// ── Telegram ──────────────────────────────────────────────────────────────────

async function sendMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
  });
  const data = await res.json();
  if (!data.ok) console.error('Telegram error:', data.description);
}

// ── Sui ───────────────────────────────────────────────────────────────────────

const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

function fmt(mist) {
  return (Number(BigInt(mist ?? 0)) / 1e9).toFixed(4);
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// Watermarks: only events with timestampMs strictly greater than these get alerted.
// Set on startup to the newest existing event so historical events are never re-sent.
let lastWinnerTs = 0;
let lastWhaleTs  = 0;

// Winner events (PrizeAwarded) are emitted under the draw_manager module, across
// BOTH packages (original-id for V5 events, latest package for V6+). We query both,
// dedup, and sort newest-first.
async function fetchWinnerEvents(limit) {
  const [a, b] = await Promise.all([
    client.queryEvents({ query: { MoveModule: { package: PACKAGE_ID, module: 'draw_manager' } }, limit, order: 'descending' }).catch(() => ({ data: [] })),
    client.queryEvents({ query: { MoveModule: { package: PACKAGE_TYPE_ID, module: 'draw_manager' } }, limit, order: 'descending' }).catch(() => ({ data: [] })),
  ]);
  const seen = new Set();
  const merged = [];
  for (const ev of [...a.data, ...b.data]) {
    const key = `${ev.id?.txDigest}:${ev.id?.eventSeq}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ev);
  }
  merged.sort((x, y) => Number(y.timestampMs ?? 0) - Number(x.timestampMs ?? 0));
  return { data: merged };
}

async function checkNewWinners() {
  try {
    const events = await fetchWinnerEvents(20);
    if (events.data.length === 0) return;

    // Advance the watermark to the newest event we've now seen, regardless of
    // whether it gets alerted. Prevents both backlog dumps and re-sends.
    const newestTs = Math.max(...events.data.map(e => Number(e.timestampMs ?? 0)));

    // Only events strictly newer than the last processed timestamp, oldest-first.
    const fresh = events.data
      .filter(e => Number(e.timestampMs ?? 0) > lastWinnerTs)
      .sort((x, y) => Number(x.timestampMs ?? 0) - Number(y.timestampMs ?? 0));

    lastWinnerTs = Math.max(lastWinnerTs, newestTs);

    if (fresh.length === 0) return;

    for (const ev of fresh) {
      if (!ev.type?.includes('PrizeAwarded')) continue;
      const f = ev.parsedJson;
      if (!f?.winner || !f?.amount_mist) continue;
      if (BigInt(f.amount_mist) <= 0n) continue; // skip dust / zero-prize draws

      const drawNames = { 0: '⚡ Spark', 1: '🔄 Pulse', 2: '🌊 Surge' };
      const drawName = drawNames[f.pool] ?? '🎲 Draw';
      const amount = fmt(f.amount_mist);

      const msg =
        `🏆 <b>${drawName} Winner!</b>\n\n` +
        `Winner: <code>${shortAddr(f.winner)}</code>\n` +
        `Prize: <b>${amount} SUI</b>\n\n` +
        `<a href="https://suiscan.xyz/mainnet/tx/${ev.id?.txDigest}">View on Suiscan</a>`;

      await sendMessage(msg);
    }
  } catch (e) {
    console.error('Error checking winners:', e.message);
  }
}


async function checkWhaleStakes() {
  try {
    const [e1, e2, e3] = await Promise.all([
      client.queryEvents({ query: { MoveEventType: `${PACKAGE_ID}::stake_vault::Staked` }, limit: 20, order: 'descending' }).catch(() => ({ data: [] })),
      client.queryEvents({ query: { MoveEventType: `${PACKAGE_TYPE_ID}::stake_vault::Staked` }, limit: 20, order: 'descending' }).catch(() => ({ data: [] })),
      client.queryEvents({ query: { MoveEventType: `${V6_PACKAGE}::stake_vault_v6::StakedV6` }, limit: 20, order: 'descending' }).catch(() => ({ data: [] })),
    ]);
    const events = [...e1.data, ...e2.data, ...e3.data];
    if (events.length === 0) return;

    const newestTs = Math.max(...events.map(e => Number(e.timestampMs ?? 0)));
    const fresh = events
      .filter(e => Number(e.timestampMs ?? 0) > lastWhaleTs)
      .sort((x, y) => Number(x.timestampMs ?? 0) - Number(y.timestampMs ?? 0));

    lastWhaleTs = Math.max(lastWhaleTs, newestTs);

    if (fresh.length === 0) return;

    for (const ev of fresh) {
      const f = ev.parsedJson;
      const staker = f?.staker ?? f?.owner;            // V5: staker · V6: owner
      const amount = f?.amount_mist ?? f?.principal_mist; // V5 · V6
      if (!staker || !amount) continue;
      const sui = Number(BigInt(amount)) / 1e9;
      if (sui >= WHALE_MIN_SUI) {
        const msg = `🐋 <b>Whale Alert!</b>\n\n` +
          `<code>${shortAddr(staker)}</code> just staked <b>${sui.toFixed(0)} SUI</b>\n` +
          `\n🌊 <a href="https://surgeonsui.com">surgeonsui.com</a>`;
        await sendMessage(msg);
      }
    }
  } catch (e) { console.error('Whale check error:', e.message); }
}

async function postStats() {
  try {
    const [vaultObj, poolObj, v6Obj] = await Promise.all([
      client.getObject({ id: STAKING_VAULT, options: { showContent: true } }),
      client.getObject({ id: REWARD_POOL, options: { showContent: true } }),
      client.getObject({ id: V6_VAULT, options: { showContent: true } }),
    ]);

    const vf = vaultObj.data?.content?.fields ?? {};
    const pf = poolObj.data?.content?.fields ?? {};
    const v6 = v6Obj.data?.content?.fields ?? {};

    const v5Principal = BigInt(vf.total_principal ?? 0);
    const v6Principal = BigInt(v6.total_principal ?? 0);
    const tvl = fmt(v5Principal + v6Principal);

    // Live accrued yield: ha_balance × haSUI rate − principal (read on-chain, gasless)
    let accrued = 0n;
    try {
      const { Transaction } = require('@mysten/sui/transactions');
      const rtx = new Transaction();
      rtx.moveCall({ target: `${HAEDAL_PKG_ORIG}::staking::get_exchange_rate`, arguments: [rtx.object(HAEDAL_STAKING)] });
      const ins = await client.devInspectTransactionBlock({ sender: '0x0000000000000000000000000000000000000000000000000000000000000001', transactionBlock: rtx });
      const bytes = ins?.results?.[0]?.returnValues?.[0]?.[0];
      if (bytes) {
        let rate = 0n;
        for (let i = bytes.length - 1; i >= 0; i--) rate = (rate << 8n) | BigInt(bytes[i]);
        const ha = BigInt(v6.ha_balance?.fields?.value ?? v6.ha_balance ?? 0);
        const value = (ha * rate) / 1000000n;
        if (value > v6Principal) accrued = value - v6Principal;
      }
    } catch {}
    const rewards = fmt(vf.pending_rewards?.fields?.value ?? vf.pending_rewards ?? 0);

    const spark = fmt(pf.spark_pool?.fields?.value ?? pf.spark_pool ?? 0);
    const pulse = fmt(pf.pulse_pool?.fields?.value ?? pf.pulse_pool ?? 0);
    const surge = fmt(pf.surge_pool?.fields?.value ?? pf.surge_pool ?? 0);

    const msg =
      `📊 <b>Surge Protocol — Daily Stats</b>\n\n` +
      `🏦 TVL: <b>${tvl} SUI</b> — earning via haSUI (Haedal)\n` +
      `🌾 Accrued yield: <b>+${fmt(accrued)} SUI</b> · <a href="https://suivision.xyz/object/${V6_VAULT}">verify on-chain</a>\n\n` +
      `<b>Prize Pools</b>\n` +
      `⚡ Spark: ${spark} SUI\n` +
      `🔄 Pulse: ${pulse} SUI\n` +
      `🌊 Surge: ${surge} SUI\n\n` +
      `🔗 <a href="https://surgeonsui.com">surgeonsui.com</a>`;

    await sendMessage(msg);
  } catch (e) {
    console.error('Error posting stats:', e.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🤖 Surge Telegram Bot — starting');
  console.log(`   Chat ID: ${CHAT_ID}`);
  console.log(`   Network: ${NETWORK}`);

  // Startup message
  await sendMessage(
    `🌊 <b>Surge Protocol Bot online</b>\n\n` +
    `Monitoring draws and yield on Sui mainnet.\n` +
    `Stake at <a href="https://surgeonsui.com">surgeonsui.com</a>`
  );

  // Initialize watermarks to the newest existing events so nothing historical is alerted.
  try {
    const w = await fetchWinnerEvents(1);
    if (w.data.length > 0) lastWinnerTs = Number(w.data[0].timestampMs ?? 0);
  } catch {}
  try {
    const [e1, e2, e3] = await Promise.all([
      client.queryEvents({ query: { MoveEventType: `${PACKAGE_ID}::stake_vault::Staked` }, limit: 1, order: 'descending' }).catch(() => ({ data: [] })),
      client.queryEvents({ query: { MoveEventType: `${PACKAGE_TYPE_ID}::stake_vault::Staked` }, limit: 1, order: 'descending' }).catch(() => ({ data: [] })),
      client.queryEvents({ query: { MoveEventType: `${V6_PACKAGE}::stake_vault_v6::StakedV6` }, limit: 1, order: 'descending' }).catch(() => ({ data: [] })),
    ]);
    const all = [...e1.data, ...e2.data, ...e3.data].map(e => Number(e.timestampMs ?? 0));
    if (all.length > 0) lastWhaleTs = Math.max(...all);
  } catch {}

  // Post initial stats
  await postStats();

  // Poll for new winners every minute, whales every 5 minutes
  setInterval(() => checkNewWinners().catch(console.error), POLL_MS);
  setInterval(() => checkWhaleStakes().catch(console.error), 300_000);

  // Post stats once per day
  setInterval(() => postStats().catch(console.error), STATS_INTERVAL);

  console.log('✅ Bot running');
  // Keep process alive
  setInterval(() => {}, 3_600_000);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

require('dotenv/config');

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');

// ── Config ────────────────────────────────────────────────────────────────────

const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID          = process.env.TELEGRAM_CHAT_ID   ?? '';
const PACKAGE_ID       = process.env.PACKAGE_ID         ?? '';
const PACKAGE_TYPE_ID  = process.env.PACKAGE_TYPE_ID    ?? '';
const STAKING_VAULT    = process.env.STAKING_VAULT      ?? '';
const REWARD_POOL      = process.env.REWARD_POOL        ?? '';
const NETWORK          = process.env.NETWORK            ?? 'mainnet';

const POLL_MS          = 60_000;   // check for new events every minute
const STATS_INTERVAL   = 3600_000; // post stats every hour

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

// Track last seen event cursor to avoid duplicate alerts
let lastEventCursor = null;

async function checkNewWinners() {
  try {
    const events = await client.queryEvents({
      query: { MoveModule: { package: PACKAGE_TYPE_ID, module: 'reward_pool' } },
      limit: 20,
      order: 'descending',
    });

    if (events.data.length === 0) return;

    const newest = events.data[0];
    if (lastEventCursor === newest.id?.txDigest) return;

    const newEvents = lastEventCursor
      ? events.data.filter(e => e.id?.txDigest !== lastEventCursor)
      : [];

    lastEventCursor = newest.id?.txDigest;

    // Only process on subsequent polls (skip first run to avoid spam)
    if (newEvents.length === 0) return;

    for (const ev of newEvents.reverse()) {
      if (!ev.type?.includes('PrizeAwarded')) continue;
      const f = ev.parsedJson;
      if (!f?.winner || !f?.amount_mist) continue;

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

async function postStats() {
  try {
    const [vaultObj, poolObj] = await Promise.all([
      client.getObject({ id: STAKING_VAULT, options: { showContent: true } }),
      client.getObject({ id: REWARD_POOL, options: { showContent: true } }),
    ]);

    const vf = vaultObj.data?.content?.fields ?? {};
    const pf = poolObj.data?.content?.fields ?? {};

    const tvl = fmt(vf.total_principal ?? 0);
    const rewards = fmt(vf.pending_rewards?.fields?.value ?? vf.pending_rewards ?? 0);

    const spark = fmt(pf.spark_pool?.fields?.value ?? pf.spark_pool ?? 0);
    const pulse = fmt(pf.pulse_pool?.fields?.value ?? pf.pulse_pool ?? 0);
    const surge = fmt(pf.surge_pool?.fields?.value ?? pf.surge_pool ?? 0);

    const msg =
      `📊 <b>Surge Protocol — Hourly Stats</b>\n\n` +
      `🏦 TVL: <b>${tvl} SUI</b> (staked at Triton One)\n` +
      `🌾 Pending rewards: ${rewards} SUI\n\n` +
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

  // Initialize cursor without sending alerts
  try {
    const events = await client.queryEvents({
      query: { MoveModule: { package: PACKAGE_TYPE_ID, module: 'reward_pool' } },
      limit: 1, order: 'descending',
    });
    if (events.data.length > 0) lastEventCursor = events.data[0].id?.txDigest;
  } catch {}

  // Post initial stats
  await postStats();

  // Poll for new winners every minute
  setInterval(() => checkNewWinners().catch(console.error), POLL_MS);

  // Post stats every hour
  setInterval(() => postStats().catch(console.error), STATS_INTERVAL);

  console.log('✅ Bot running');
  // Keep process alive
  setInterval(() => {}, 3_600_000);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

require('dotenv/config');

// Surge Telegram bot — fully automatic channel posts for Surge Night.
// Reads chain data via the Sui GraphQL RPC (JSON-RPC is switched off), plain
// fetch, no SDK. Posts:
//   • Surge Night countdown: T-7d, T-3d, T-1d, T-3h, T-15min, with live pool
//   • Results right after the draw: all 8 prizes in ONE message + tx links
//   • New stakes (≥ NEW_STAKE_MIN_SUI) as social proof
//   • Weekly status, Mondays 18:00 Berlin time (WEEKLY_DAY: 1=Mon)

// ── Config ────────────────────────────────────────────────────────────────────

const TELEGRAM_TOKEN  = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID         = process.env.TELEGRAM_CHAT_ID   ?? '';
const GQL_URL         = process.env.GQL_URL ?? 'https://graphql.mainnet.sui.io/graphql';
const PACKAGE_TYPE_ID = process.env.PACKAGE_TYPE_ID ?? '0x330aa337772418f68117556dce74034063f11a8de68f60a99acc9a5ee62f5fb3';
const REWARD_POOL     = process.env.REWARD_POOL ?? '0xacf68b636a55c96a8269ab0b66d735a7bbfadf058821cc17f97bc32d49d6968f';
const DRAW_STATE      = process.env.DRAW_STATE  ?? '0xee9f68a29ab16442600a9e12426431b240aed97cdf5108f44d8325401cc25fb0';
const V6_PACKAGE      = process.env.V6_PACKAGE  ?? '0xaf489faa2a23db82265e25c833f2cf9b985eb0a8d4acde121c7e14c111c3b62e';
const V6_VAULT        = process.env.V6_VAULT    ?? '0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5';
// Must match the crank's DRAW_NOT_BEFORE_MS (first Surge Night).
const DRAW_NOT_BEFORE_MS = Number(process.env.DRAW_NOT_BEFORE_MS ?? Date.UTC(2026, 10, 8, 19, 0, 0));
const X_URL           = process.env.X_URL ?? 'https://x.com/Surge_Sui';
const SITE            = 'https://surgeonsui.com';
// Team wallets: never in draws (crank DRAW_EXCLUDE) → not counted as participants either.
const TEAM = new Set((process.env.DRAW_EXCLUDE ?? '0x0baa87509dbe704c0932b664bed03b4ac4afe0015fe40a83a6a9d7d2a4fc183b,0x2c487e8e12025933b4c19fa596dcc5e6a0c9d840e6ba1dfc86ec930f9d62a726')
  .split(',').map(a => a.trim().toLowerCase()).filter(Boolean));
const RESULTS_WAIT_MS = Number(process.env.RESULTS_WAIT_MS ?? 90_000);

const POLL_MS            = 60_000;
const NEW_STAKE_MIN_SUI  = Number(process.env.NEW_STAKE_MIN_SUI ?? 1);
const DAILY_HOUR_BERLIN  = Number(process.env.DAILY_HOUR_BERLIN ?? 18);
const WEEKLY_DAY         = Number(process.env.WEEKLY_DAY ?? 1); // 0=Sun … 1=Mon
const TICKET_CYCLE_MS    = 30 * 86_400_000;
const MIN_POOL_MIST      = 1_000_000n; // crank skips dust buckets

const COUNTDOWN = [ // [ms before event, key, headline]
  [7 * 86_400_000, 't7d',  '🗓 <b>Surge Night in 7 days</b>'],
  [3 * 86_400_000, 't3d',  '⏳ <b>Surge Night in 3 days</b>'],
  [1 * 86_400_000, 't1d',  '🔥 <b>Surge Night is tomorrow</b>'],
  [3 * 3_600_000,  't3h',  '⚡ <b>Surge Night in 3 hours</b>'],
  [15 * 60_000,    't15m', '🎙 <b>Surge Night starts in 15 minutes</b>'],
];
const COUNTDOWN_WINDOW_MS = 30 * 60_000; // post only if we are within 30 min after the mark

if (!TELEGRAM_TOKEN || !CHAT_ID) {
  console.error('❌ Missing env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID');
  process.exit(1);
}

// ── Telegram ──────────────────────────────────────────────────────────────────

async function sendMessage(text) {
  if (process.env.DRY_RUN) { console.log('--- [DRY_RUN] would post ---\n' + text + '\n---'); return; }
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const data = await res.json();
  if (!data.ok) console.error('Telegram error:', data.description);
}

// ── Sui GraphQL ───────────────────────────────────────────────────────────────

async function gql(query, variables = {}) {
  const r = await fetch(GQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`GraphQL HTTP ${r.status}: ${text.slice(0, 200)}`); }
  if (json.errors?.length) throw new Error('GraphQL: ' + json.errors.map(e => e.message).join('; '));
  return json.data;
}

async function getFields(id) {
  const d = await gql(`query($id:SuiAddress!){ object(address:$id){ asMoveObject{ contents{ json } } } }`, { id });
  return d?.object?.asMoveObject?.contents?.json ?? {};
}

// Newest `limit` events of a type, each { json, ts, digest }.
async function latestEvents(type, limit = 20) {
  const d = await gql(
    `query($t:String!,$n:Int!){ events(last:$n, filter:{type:$t}){ nodes{ contents{ json } timestamp transaction{ digest } } } }`,
    { t: type, n: limit },
  );
  return (d?.events?.nodes ?? []).map(n => ({
    json: n.contents?.json ?? {},
    ts: n.timestamp ? new Date(n.timestamp).getTime() : 0,
    digest: n.transaction?.digest ?? '',
  }));
}

// All events of a type (paged), for the participant count.
async function allEvents(type) {
  const out = [];
  let after = null;
  for (let i = 0; i < 40; i++) {
    const d = await gql(
      `query($t:String!,$a:String){ events(first:50, after:$a, filter:{type:$t}){ pageInfo{ hasNextPage endCursor } nodes{ contents{ json } } } }`,
      { t: type, a: after },
    );
    out.push(...(d?.events?.nodes ?? []).map(n => n.contents?.json ?? {}));
    if (!d?.events?.pageInfo?.hasNextPage) break;
    after = d.events.pageInfo.endCursor;
  }
  return out;
}

const PRIZE_TYPE    = `${PACKAGE_TYPE_ID}::reward_pool::PrizeAwarded`;
const STAKED_TYPE   = `${V6_PACKAGE}::stake_vault_v6::StakedV6`;
const UNSTAKED_TYPE = `${V6_PACKAGE}::stake_vault_v6::UnstakedV6`;

// ── Helpers ───────────────────────────────────────────────────────────────────

const toBig = (x) => BigInt(x?.value ?? x?.fields?.value ?? x ?? 0);
const fmt = (mist, d = 3) => (Number(BigInt(mist ?? 0)) / 1e9).toFixed(d);
const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const txLink = (digest) => `https://suivision.xyz/txblock/${digest}`;

function eventAt(drawFields) {
  return Math.max(DRAW_NOT_BEFORE_MS, Number(drawFields?.next_surge_ms ?? 0));
}

function berlinLabel(ms) {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Berlin' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  return `${date} · ${time} CET`;
}

async function snapshot() {
  const [pool, draw, vault] = await Promise.all([getFields(REWARD_POOL), getFields(DRAW_STATE), getFields(V6_VAULT)]);
  const surge = toBig(pool.surge_pool), pulse = toBig(pool.pulse_pool), spark = toBig(pool.spark_pool);
  return {
    surge, pulse, spark,
    total: surge + pulse + spark,
    tvl: toBig(vault.total_principal),
    at: eventAt(draw),
    drawNo: Number(draw.surge_draw_count ?? 0) + 1,
  };
}

async function participantCount() {
  const [st, un] = await Promise.all([allEvents(STAKED_TYPE), allEvents(UNSTAKED_TYPE)]);
  const net = {};
  for (const e of st) if (e.owner && e.principal_mist) net[e.owner] = (net[e.owner] ?? 0n) + BigInt(e.principal_mist);
  for (const e of un) if (e.owner && e.principal_mist) net[e.owner] = (net[e.owner] ?? 0n) - BigInt(e.principal_mist);
  return Object.entries(net).filter(([a, v]) => v > 0n && !TEAM.has(a.toLowerCase())).length;
}

function ladderLines(s) {
  const live = (b) => b >= MIN_POOL_MIST;
  return [
    `🏆 #1 Jackpot: <b>${fmt(s.surge)} SUI</b>`,
    `🎟 #2–5: ${live(s.pulse) ? `${fmt(s.pulse / 4n)} SUI each` : 'filling'}`,
    `🎟 #6–8: ${live(s.spark) ? `${fmt(s.spark / 3n)} SUI each` : 'filling'}`,
  ].join('\n');
}

// ── Surge Night countdown ─────────────────────────────────────────────────────

const sentCountdown = new Set(); // `${eventAt}:${key}`

async function checkCountdown() {
  const s = await snapshot();
  const now = Date.now();
  for (const [before, key, headline] of COUNTDOWN) {
    const mark = s.at - before;
    const id = `${s.at}:${key}`;
    if (sentCountdown.has(id) || now < mark || now > mark + COUNTDOWN_WINDOW_MS) continue;
    sentCountdown.add(id);
    const ticketShare = Math.round(Math.min(1, Math.max(0, s.at - now) / TICKET_CYCLE_MS) * 100);
    const people = await participantCount().catch(() => null);
    const live = key === 't15m'
      ? `\n🎙 Join the live X Space: ${X_URL}\nThe draw transaction will be posted here the moment it lands on-chain.`
      : `\nStake now → you hold <b>${ticketShare}%</b> of your tickets on draw night. Earlier = more.`;
    await sendMessage(
      `${headline}\n<b>Surge Night #${s.drawNo}</b> · ${berlinLabel(s.at)}\n\n` +
      `💰 Prize pool: <b>${fmt(s.total)} SUI</b> · 8 winners\n${ladderLines(s)}\n` +
      (people !== null ? `👥 ${people} participant${people === 1 ? '' : 's'}\n` : '') +
      live +
      `\n\n🔒 Principal stays yours · 1 SUI = 1 ticket\n👉 <a href="${SITE}">surgeonsui.com</a>`,
    );
  }
}

// ── Results ───────────────────────────────────────────────────────────────────

let lastPrizeTs = 0;

async function checkResults() {
  const first = await latestEvents(PRIZE_TYPE, 20);
  const fresh = first.filter(e => e.ts > lastPrizeTs);
  if (fresh.length === 0) return;
  // The event draws Jackpot → Pulse → Spark in three txs a few seconds apart:
  // wait, then collect everything into ONE results post.
  await new Promise(r => setTimeout(r, RESULTS_WAIT_MS));
  const all = (await latestEvents(PRIZE_TYPE, 30)).filter(e => e.ts > lastPrizeTs && BigInt(e.json.amount_mist ?? 0) > 0n);
  lastPrizeTs = Math.max(lastPrizeTs, ...first.map(e => e.ts), ...all.map(e => e.ts));
  if (all.length === 0) return;

  const rank = { 2: 0, 1: 1, 0: 2 }; // jackpot first
  all.sort((a, b) => (rank[a.json.pool] ?? 3) - (rank[b.json.pool] ?? 3) || a.ts - b.ts);
  const total = all.reduce((acc, e) => acc + BigInt(e.json.amount_mist), 0n);
  const lines = all.map((e, i) => {
    const label = e.json.pool === 2 ? '🏆 Jackpot' : `🎟 #${i + 1}`;
    return `${label}: <code>${shortAddr(e.json.winner)}</code> · <b>${fmt(e.json.amount_mist, 4)} SUI</b>`;
  });
  const digests = [...new Set(all.map(e => e.digest).filter(Boolean))];
  const s = await snapshot().catch(() => null);

  await sendMessage(
    `🌊 <b>Surge Night — results are in!</b>\n\n${lines.join('\n')}\n\n` +
    `💸 ${fmt(total)} SUI paid out to ${all.length} winner${all.length === 1 ? '' : 's'}. Principal of every staker untouched.\n` +
    `🔎 Verify on-chain: ${digests.map((d, i) => `<a href="${txLink(d)}">tx ${i + 1}</a>`).join(' · ')}\n` +
    (s ? `\n📅 Next Surge Night: ${berlinLabel(s.at)} — tickets for it start filling now.\n` : '') +
    `👉 <a href="${SITE}">surgeonsui.com</a>`,
  );
}

// ── New stakes ────────────────────────────────────────────────────────────────

let lastStakeTs = 0;

async function checkNewStakes() {
  const evs = await latestEvents(STAKED_TYPE, 20);
  const fresh = evs.filter(e => e.ts > lastStakeTs).sort((a, b) => a.ts - b.ts);
  if (evs.length) lastStakeTs = Math.max(lastStakeTs, ...evs.map(e => e.ts));
  for (const e of fresh) {
    const sui = Number(BigInt(e.json.principal_mist ?? 0)) / 1e9;
    if (sui < NEW_STAKE_MIN_SUI) continue;
    const s = await snapshot().catch(() => null);
    await sendMessage(
      `${sui >= 100 ? '🐋 <b>Whale stake</b>' : '🌊 <b>New stake</b>'}: <b>${sui.toFixed(sui < 10 ? 2 : 0)} SUI</b> just entered Surge Night` +
      (s ? `\n💰 Prize pool ${fmt(s.total)} SUI · draw ${berlinLabel(s.at)}` : '') +
      `\n👉 <a href="${SITE}">surgeonsui.com</a>`,
    );
  }
}

// ── Weekly status ──────────────────────────────────────────────────────────────

let lastDailyDate = '';

async function checkDaily() {
  const nowB = new Date().toLocaleString('en-CA', { timeZone: 'Europe/Berlin', hour12: false });
  const [date, time] = nowB.split(', ');
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday !== WEEKLY_DAY || Number(time.slice(0, 2)) !== DAILY_HOUR_BERLIN || lastDailyDate === date) return;
  lastDailyDate = date;
  const s = await snapshot();
  const days = Math.max(0, Math.ceil((s.at - Date.now()) / 86_400_000));
  // Countdown posts cover the last 7 days → weekly status only outside them, to avoid double posts.
  if (days <= 7 && days > 0) return;
  await sendMessage(
    `📊 <b>Surge weekly</b>\n\n🏦 Staked: <b>${fmt(s.tvl)} SUI</b> (always withdrawable)\n` +
    `💰 Prize pool: <b>${fmt(s.total)} SUI</b> · 8 winners\n` +
    `📅 Surge Night #${s.drawNo}: ${berlinLabel(s.at)} (${days} day${days === 1 ? '' : 's'})\n` +
    `🔎 <a href="https://suivision.xyz/object/${V6_VAULT}">Verify the vault on-chain</a>\n👉 <a href="${SITE}">surgeonsui.com</a>`,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

function guard(name, fn) {
  return () => fn().catch(e => console.error(`${name}:`, e.message));
}

async function main() {
  console.log('🤖 Surge Telegram Bot v2 — Sui GraphQL · Surge Night automation');
  console.log(`   Chat: ${CHAT_ID} · GraphQL: ${GQL_URL}${process.env.DRY_RUN ? ' · DRY_RUN' : ''}`);

  // Watermarks = newest existing events, so nothing historical is re-posted on restart.
  try { const p = await latestEvents(PRIZE_TYPE, 1); if (p[0]) lastPrizeTs = p[0].ts; } catch (e) { console.error('init prizes:', e.message); }
  try { const st = await latestEvents(STAKED_TYPE, 1); if (st[0]) lastStakeTs = st[0].ts; } catch (e) { console.error('init stakes:', e.message); }
  const s = await snapshot();
  console.log(`   Next Surge Night: ${berlinLabel(s.at)} · pool ${fmt(s.total)} SUI`);

  if (process.env.DRY_RUN === 'preview') {
    // Render one of each message without posting (for a local check).
    const realNow = Date.now; Date.now = () => s.at - 3 * 86_400_000 + 60_000;
    await checkCountdown(); Date.now = realNow;
    if (process.env.PREVIEW_RESULTS) { lastPrizeTs = 0; await checkResults(); }
    return;
  }

  let running = false; // checkResults can wait 90s — never overlap ticks
  const tick = async () => {
    if (running) return;
    running = true;
    try {
    await guard('countdown', checkCountdown)();
    await guard('results', checkResults)();
    await guard('stakes', checkNewStakes)();
    await guard('daily', checkDaily)();
    } finally { running = false; }
  };
  await tick();
  setInterval(tick, POLL_MS);
  console.log('✅ Bot running');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

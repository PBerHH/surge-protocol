require('dotenv/config');

const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const cron = require('node-cron');

// Config
const NETWORK = process.env.NETWORK ?? 'mainnet';
const PACKAGE_ID      = process.env.PACKAGE_ID      ?? '';
const PACKAGE_TYPE_ID  = process.env.PACKAGE_TYPE_ID  ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? '';

if (!PACKAGE_ID || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('❌ Missing env vars: PACKAGE_ID, SUPABASE_URL, SUPABASE_SECRET_KEY');
  process.exit(1);
}

// Sui Mainnet JSON-RPC was switched off (node v1.82, Oct 2026). This worker
// only READS chain data, so it talks to the Sui GraphQL RPC directly via
// fetch — no SDK needed. The two methods below mirror the JSON-RPC response
// shapes the code further down expects.
const GQL_URL = process.env.GQL_URL ?? 'https://graphql.mainnet.sui.io/graphql';
const GQL_TIMEOUT_MS = 60_000;

async function gql(query, variables = {}) {
  const r = await fetch(GQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(GQL_TIMEOUT_MS),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`GraphQL HTTP ${r.status}: ${text.slice(0, 200)}`); }
  if (json.errors?.length) throw new Error('GraphQL: ' + json.errors.map(e => e.message).join('; '));
  return json.data;
}

const sui = {
  async queryEvents({ query, limit = 50, cursor = null }) {
    const d = await gql(
      `query($t:String!,$n:Int!,$a:String){ events(first:$n, after:$a, filter:{type:$t}){ pageInfo{ hasNextPage endCursor } nodes{ contents{ json } timestamp } } }`,
      { t: query.MoveEventType, n: Math.min(limit, 50), a: cursor },
    );
    const ev = d?.events;
    return {
      data: (ev?.nodes ?? []).map(n => ({
        parsedJson: n.contents?.json,
        timestampMs: n.timestamp ? String(new Date(n.timestamp).getTime()) : null,
      })),
      hasNextPage: !!ev?.pageInfo?.hasNextPage,
      nextCursor: ev?.pageInfo?.endCursor ?? null,
    };
  },

  async getOwnedObjects({ owner, filter, cursor = null }) {
    const d = await gql(
      `query($o:SuiAddress!,$t:String!,$a:String){ address(address:$o){ objects(first:50, after:$a, filter:{type:$t}){ pageInfo{ hasNextPage endCursor } nodes{ address contents{ json } } } } }`,
      { o: owner, t: filter.StructType, a: cursor },
    );
    const objs = d?.address?.objects;
    return {
      data: (objs?.nodes ?? []).map(n => ({ data: { objectId: n.address, content: { fields: n.contents?.json } } })),
      hasNextPage: !!objs?.pageInfo?.hasNextPage,
      nextCursor: objs?.pageInfo?.endCursor ?? null,
    };
  },
};

const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { realtime: { transport: ws } });

// Constants
const PIONEER_LIMIT = 1000;
const EARLY_BIRD_LIMIT = 100;
const EARLY_BIRD_MULT = 3.0;
const PIONEER_MULT = 2.0;
const REGULAR_MULT = 1.0;
const POINTS_PER_SUI_PER_DAY = 1.0;

// Referral bonus: +10% additive multiplier per actively-staking referred
// wallet, capped at 5 (so +50% max). "Actively staking" = current stake > 0,
// checked fresh every tick — the bonus disappears the moment a referred
// wallet fully unstakes, which is what stops referral farm-and-dump abuse.
const REFERRAL_BONUS_PER_ACTIVE = 0.10;
const REFERRAL_BONUS_CAP = 0.50;

// StakingReceipt types — V5 + V6.
// GraphQL matches struct/event types by the ORIGINAL package id (type origin),
// not by upgraded package ids — so the V5 original id must be included.
const PACKAGE_V5 = '0x35732358f2e0a683fe2014f5781b8ab67146d40ce63a76ac0a30ac52fdb7b2bb';
const PACKAGE_V5_ORIG = PACKAGE_TYPE_ID || '0x330aa337772418f68117556dce74034063f11a8de68f60a99acc9a5ee62f5fb3';
const PACKAGE_V6 = process.env.V6_PACKAGE ?? '0xaf489faa2a23db82265e25c833f2cf9b985eb0a8d4acde121c7e14c111c3b62e';
const V5_PACKAGES = [...new Set([PACKAGE_V5_ORIG, PACKAGE_V5, PACKAGE_ID])];
const RECEIPT_TYPES = [
  ...V5_PACKAGES.map(p => `${p}::stake_vault::StakingReceipt`),
  `${PACKAGE_V6}::stake_vault_v6::StakeReceiptV6`,
];

function calculateLoyaltyMultiplier(daysStaked) {
  if (daysStaked >= 365) return 2.0;
  if (daysStaked >= 180) return 1.8;
  if (daysStaked >= 90) return 1.5;
  if (daysStaked >= 30) return 1.2;
  return 1.0;
}

async function fetchAllStakers() {
  console.log('📡 Fetching stakers from chain...');

  let allEvents = [];
  let cursor = null;

  // Staked events only give us candidate addresses + first stake time — V5 + V6
  const EVENT_TYPES = [
    ...V5_PACKAGES.map(p => `${p}::stake_vault::Staked`),
    `${PACKAGE_V6}::stake_vault_v6::StakedV6`,
  ];
  for (const eventType of EVENT_TYPES) {
    cursor = null;
    while (true) {
      const result = await sui.queryEvents({
        query: { MoveEventType: eventType },
        limit: 50, cursor,
      });
      allEvents = allEvents.concat(result.data.map(e => ({ ...e, _eventType: 'staking' })));
      if (!result.hasNextPage) break;
      cursor = result.nextCursor;
    }
  }

  // Build candidate list with earliest stake timestamp
  const stakers = {};
  for (const ev of allEvents) {
    const staker = ev.parsedJson?.staker ?? ev.parsedJson?.owner; // V5: staker · V6: owner
    if (!staker) continue;
    if (!stakers[staker]) {
      stakers[staker] = { totalMist: 0n, realMist: 0n, firstStakeMs: parseInt(ev.timestampMs) };
    }
    stakers[staker].firstStakeMs = Math.min(stakers[staker].firstStakeMs, parseInt(ev.timestampMs));
  }

  // Authoritative current stake: sum live StakingReceipt objects per wallet.
  // Unstaking destroys the receipt, so owned receipts == current principal.
  // Fully-unstaked wallets end up at 0 (and get zeroed in the DB below).
  for (const addr of Object.keys(stakers)) {
    let principal = 0n;
    for (const type of RECEIPT_TYPES) {
      let c = null;
      do {
        const res = await sui.getOwnedObjects({
          owner: addr,
          filter: { StructType: type },
          options: { showContent: true },
          cursor: c,
        });
        for (const o of res.data) {
          const f = o.data?.content?.fields;
          if (f?.principal_mist) principal += BigInt(f.principal_mist);
        }
        c = res.hasNextPage ? res.nextCursor : null;
      } while (c);
    }
    stakers[addr].totalMist = principal;
    stakers[addr].realMist  = principal;
  }

  return stakers;
}

async function getOrCreateWallet(address, firstStakeMs) {
  // Check if wallet exists
  const { data: existing } = await db
    .from('wallets')
    .select('*')
    .eq('address', address)
    .single();

  if (existing) return existing;

  // Get current rank counts
  const { count: totalCount } = await db
    .from('wallets')
    .select('*', { count: 'exact', head: true });

  const newRank = (totalCount || 0) + 1;

  // Determine tier
  let multiplier = REGULAR_MULT;
  let pioneerRank = null;
  let earlyBirdRank = null;

  if (newRank <= EARLY_BIRD_LIMIT) {
    multiplier = EARLY_BIRD_MULT;
    earlyBirdRank = newRank;
    pioneerRank = newRank; // Early birds are also pioneers
  } else if (newRank <= PIONEER_LIMIT) {
    multiplier = PIONEER_MULT;
    pioneerRank = newRank;
  }

  const { data: newWallet, error } = await db
    .from('wallets')
    .insert({
      address,
      pioneer_rank: pioneerRank,
      early_bird_rank: earlyBirdRank,
      first_stake_at: new Date(firstStakeMs).toISOString(),
      multiplier,
      total_points: 0,
      current_stake_sui: 0,
    })
    .select()
    .single();

  if (error) {
    console.error(`  ❌ Failed to create wallet ${address}:`, error.message);
    return null;
  }

  console.log(`  🆕 New ${earlyBirdRank ? '🌟 Early Bird' : pioneerRank ? '🏆 Pioneer' : '👤 Regular'} #${newRank}: ${address.slice(0, 10)}...`);
  return newWallet;
}

// Returns { referrer_address -> bonus } for every referrer who has at least
// one actively-staking referred wallet this tick. Recomputed fresh every
// tick from live stake amounts, so the bonus tracks reality automatically —
// no separate "deactivate referral" logic needed anywhere.
async function computeReferralBonuses(stakers) {
  const { data: refs, error } = await db.from('referrals').select('referrer_address, referred_address');
  if (error) {
    console.error('  ⚠️ Failed to load referrals (referral bonuses skipped this tick):', error.message);
    return { bonuses: {}, counts: {} };
  }
  const bonuses = {};
  const counts = {};
  for (const r of refs ?? []) {
    const referredInfo = stakers[r.referred_address];
    const referredStakeSui = referredInfo ? Number(referredInfo.realMist) / 1e9 : 0;
    if (referredStakeSui > 0) {
      counts[r.referrer_address] = (counts[r.referrer_address] ?? 0) + 1;
    }
  }
  for (const [addr, count] of Object.entries(counts)) {
    bonuses[addr] = Math.min(count * REFERRAL_BONUS_PER_ACTIVE, REFERRAL_BONUS_CAP);
  }
  return { bonuses, counts };
}

async function calculateAndUpdatePoints() {
  console.log(`\n⏰ [${new Date().toISOString()}] Points calculation tick`);

  try {
    const stakers = await fetchAllStakers();
    console.log(`  📊 Found ${Object.keys(stakers).length} stakers`);

    const { bonuses: referralBonuses, counts: referralCounts } = await computeReferralBonuses(stakers);

    const now = Date.now();
    let processed = 0;

    for (const [address, info] of Object.entries(stakers)) {
      const stakeSui = Number(info.realMist ?? info.totalMist) / 1e9;

      // Get or create wallet
      const wallet = await getOrCreateWallet(address, info.firstStakeMs);
      if (!wallet) continue;

      // Calculate loyalty
      const firstStakeMs = new Date(wallet.first_stake_at).getTime();
      const daysStaked = (now - firstStakeMs) / 86400000;
      const loyaltyMult = calculateLoyaltyMultiplier(daysStaked);

      // Referral bonus is ADDITIVE to the base tier multiplier (e.g. 1.0 base
      // + 0.20 for 2 active referrals = 1.20 effective before loyalty).
      const referralBonus = referralBonuses[address] ?? 0;
      const referralCount = referralCounts[address] ?? 0;
      const effectiveMultiplier = wallet.multiplier + referralBonus;

      // Calculate points earned this period (0 if fully unstaked)
      const lastUpdatedMs = new Date(wallet.last_updated).getTime();
      const hoursSinceUpdate = (now - lastUpdatedMs) / 3600000;
      const pointsThisPeriod = (stakeSui * POINTS_PER_SUI_PER_DAY / 24) * hoursSinceUpdate * effectiveMultiplier * loyaltyMult;

      // Update wallet
      const newTotal = parseFloat(wallet.total_points) + pointsThisPeriod;

      await db
        .from('wallets')
        .update({
          total_points: newTotal,
          current_stake_sui: stakeSui,
          referral_bonus: referralBonus,
          referral_count: referralCount,
          last_updated: new Date().toISOString(),
        })
        .eq('address', address);

      // Insert history
      await db.from('stakes_history').insert({
        wallet_address: address,
        amount_sui: stakeSui,
        points_earned: pointsThisPeriod,
      });

      processed++;

      if (pointsThisPeriod > 0.01) {
        const refNote = referralBonus > 0 ? ` +ref${(referralBonus * 100).toFixed(0)}%` : '';
        console.log(`  ✨ ${address.slice(0, 10)}... : +${pointsThisPeriod.toFixed(2)} pts (${stakeSui.toFixed(2)} SUI × ${effectiveMultiplier.toFixed(2)}x${refNote} × ${loyaltyMult.toFixed(1)}x) = ${newTotal.toFixed(2)} total`);
      }
    }

    console.log(`  ✅ Updated ${processed} wallets`);

    // Print stats
    const { data: stats } = await db.from('stats').select('*').single();
    if (stats) {
      console.log(`  📈 Stats: ${stats.total_wallets} wallets · ${stats.pioneer_slots_left}/${PIONEER_LIMIT} pioneer slots left · ${stats.total_tvl_sui} SUI TVL`);
    }

  } catch (e) {
    console.error('❌ Points calculation error:', e.message, e.stack);
  }
}

async function main() {
  console.log('🏆 Surge Points Worker v3 — referral bonuses + Sui GraphQL');
  console.log(`   Network:  ${NETWORK}`);
  console.log(`   GraphQL:  ${GQL_URL}`);
  console.log(`   Package:  ${PACKAGE_ID.slice(0, 10)}...`);
  console.log(`   Supabase: ${SUPABASE_URL}`);

  // Run immediately on startup
  await calculateAndUpdatePoints();

  // Then every hour
  cron.schedule('0 * * * *', () => {
    calculateAndUpdatePoints().catch(console.error);
  });

  console.log('\n⏳ Worker running. Next tick at start of next hour.\n');
}

if (require.main === module) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}

module.exports = { sui, fetchAllStakers };

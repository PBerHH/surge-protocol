require('dotenv/config');

const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
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

const sui = new SuiClient({ url: getFullnodeUrl(NETWORK) });
const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { realtime: { transport: ws } });

// Constants
const PIONEER_LIMIT = 1000;
const EARLY_BIRD_LIMIT = 100;
const EARLY_BIRD_MULT = 3.0;
const PIONEER_MULT = 2.0;
const REGULAR_MULT = 1.0;
const POINTS_PER_SUI_PER_DAY = 1.0;

// StakingReceipt types — V5 (current receipts) + V6 (future upgrades)
const PACKAGE_V5 = '0x35732358f2e0a683fe2014f5781b8ab67146d40ce63a76ac0a30ac52fdb7b2bb';
const PACKAGE_V6 = process.env.V6_PACKAGE ?? '0xaf489faa2a23db82265e25c833f2cf9b985eb0a8d4acde121c7e14c111c3b62e';
const RECEIPT_TYPES = [
  `${PACKAGE_V5}::stake_vault::StakingReceipt`,
  `${PACKAGE_ID}::stake_vault::StakingReceipt`,
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
    `${PACKAGE_V5}::stake_vault::Staked`,
    `${PACKAGE_ID}::stake_vault::Staked`,
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

async function calculateAndUpdatePoints() {
  console.log(`\n⏰ [${new Date().toISOString()}] Points calculation tick`);

  try {
    const stakers = await fetchAllStakers();
    console.log(`  📊 Found ${Object.keys(stakers).length} stakers`);

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

      // Calculate points earned this period (0 if fully unstaked)
      const lastUpdatedMs = new Date(wallet.last_updated).getTime();
      const hoursSinceUpdate = (now - lastUpdatedMs) / 3600000;
      const pointsThisPeriod = (stakeSui * POINTS_PER_SUI_PER_DAY / 24) * hoursSinceUpdate * wallet.multiplier * loyaltyMult;

      // Update wallet
      const newTotal = parseFloat(wallet.total_points) + pointsThisPeriod;

      await db
        .from('wallets')
        .update({
          total_points: newTotal,
          current_stake_sui: stakeSui,
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
        console.log(`  ✨ ${address.slice(0, 10)}... : +${pointsThisPeriod.toFixed(2)} pts (${stakeSui.toFixed(2)} SUI × ${wallet.multiplier}x × ${loyaltyMult.toFixed(1)}x) = ${newTotal.toFixed(2)} total`);
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
  console.log('🏆 Surge Points Worker v1 — starting up');
  console.log(`   Network:  ${NETWORK}`);
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

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

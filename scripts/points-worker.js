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

  // Query old Deposited events (legacy vault, for historical points)
  let cursor = null;
  while (true) {
    const result = await sui.queryEvents({
      query: { MoveEventType: `${PACKAGE_TYPE_ID}::stake_vault::Deposited` },
      limit: 50, cursor,
    });
    allEvents = allEvents.concat(result.data.map(e => ({ ...e, _eventType: 'legacy' })));
    if (!result.hasNextPage) break;
    cursor = result.nextCursor;
  }

  // Query new Staked events (real StakingVault, Triton)
  cursor = null;
  while (true) {
    const result = await sui.queryEvents({
      query: { MoveEventType: `${PACKAGE_ID}::stake_vault::Staked` },
      limit: 50, cursor,
    });
    allEvents = allEvents.concat(result.data.map(e => ({ ...e, _eventType: 'staking' })));
    if (!result.hasNextPage) break;
    cursor = result.nextCursor;
  }
  
  // Aggregate by staker
  const stakers = {};
  for (const ev of allEvents) {
    const { staker, amount_mist } = ev.parsedJson;
    if (!staker || !amount_mist) continue;
    
    if (!stakers[staker]) {
      stakers[staker] = { totalMist: 0n, firstStakeMs: parseInt(ev.timestampMs) };
    }
    
    stakers[staker].totalMist += BigInt(amount_mist);
    if (ev._eventType === 'staking') stakers[staker].realMist = (stakers[staker].realMist ?? 0n) + BigInt(amount_mist);
    stakers[staker].firstStakeMs = Math.min(stakers[staker].firstStakeMs, parseInt(ev.timestampMs));
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
      
      // Calculate points earned this period
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
    console.error('❌ Points calculation error:', e.message);
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

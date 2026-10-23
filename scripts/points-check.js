// Read-only pre-deploy check for the points worker's GraphQL reads.
// Touches NO database (dummy Supabase creds), sends nothing.  Usage:  node points-check.js
process.env.PACKAGE_ID ||= '0x4ca98688e6cdf7fb6b73cc01d5ebbf77f947a02f5da570afd2f14bf155942b0c';
process.env.SUPABASE_URL = 'https://dummy.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'dummy';

const { fetchAllStakers } = require('./points-worker.js');

(async () => {
  try {
    const stakers = await fetchAllStakers();
    const rows = Object.entries(stakers).map(([addr, s]) => ({
      addr: addr.slice(0, 10) + '…',
      stakeSui: Number(s.realMist) / 1e9,
      firstStake: new Date(s.firstStakeMs).toISOString().slice(0, 10),
    }));
    console.log(`✅ ${rows.length} candidate wallets, ${rows.filter(r => r.stakeSui > 0).length} with live stake`);
    console.table(rows);
    const total = rows.reduce((a, r) => a + r.stakeSui, 0);
    console.log(`   Total live stake: ${total} SUI (V6 vault principal should match)`);
  } catch (e) {
    console.log('❌ fetchAllStakers:', e.message);
  }
  process.exit(0);
})();

// Read-only pre-deploy check for the crank's GraphQL adapter.
// Sends NO transactions, needs NO private key.   Usage:  node gql-check.js
const D = {
  PACKAGE_ID:    '0x4ca98688e6cdf7fb6b73cc01d5ebbf77f947a02f5da570afd2f14bf155942b0c',
  STAKING_VAULT: '0x50d8b86e95c8c75892e8cc7caa39a81604de123baf1528cf1c9203d8ab702562',
  DRAW_STATE:    '0xee9f68a29ab16442600a9e12426431b240aed97cdf5108f44d8325401cc25fb0',
  REWARD_POOL:   '0xacf68b636a55c96a8269ab0b66d735a7bbfadf058821cc17f97bc32d49d6968f',
};
for (const [k, v] of Object.entries(D)) if (!process.env[k]) process.env[k] = v;

const CRANK = '0x2a587fd1789212292af4337cacdc7bcbca496e01a6538f46c08968d41d6a83c0';
const HAEDAL_TICKET = '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::staking::UnstakeTicket';

const c = require('./crank.js');
const client = c.createGqlClient();
const big = (_, v) => (typeof v === 'bigint' ? v.toString() : v);
const show = (x) => JSON.stringify(x, big);

async function step(name, fn) {
  try { console.log(`✅ ${name}: ${show(await fn()).slice(0, 400)}`); }
  catch (e) { console.log(`❌ ${name}: ${e.message}`); }
}

async function fields(type) {
  const d = await client.gql(`query($n:String!){ __type(name:$n){ fields{ name args{ name } type{ name kind ofType{ name ofType{ name } } } } } }`, { n: type });
  return (d?.__type?.fields ?? []).map(f => `${f.name}${f.args?.length ? '(' + f.args.map(a => a.name).join(',') + ')' : ''}:${f.type?.name ?? f.type?.ofType?.name ?? f.type?.ofType?.ofType?.name}`);
}

(async () => {
  console.log('── Schema');
  await step('Query.simulateTransaction args', async () => {
    const d = await client.gql(`{ __type(name:"Query"){ fields{ name args{ name } } } }`);
    return d.__type.fields.find(f => f.name === 'simulateTransaction');
  });
  for (const t of ['SimulationResult', 'CommandResult', 'CommandOutput', 'TransactionEffects']) {
    await step(`${t} fields`, () => fields(t));
  }

  console.log('\n── Crank reads (mainnet, read-only)');
  await step('fetchV6Vault', () => c.fetchV6Vault(client));
  await step('fetchHaRate (simulate)', () => c.fetchHaRate(client, CRANK));
  await step('fetchDrawState', () => c.fetchDrawState(client));
  await step('fetchPoolBalances', () => c.fetchPoolBalances(client));
  await step('fetchStakingVault (V5)', () => c.fetchStakingVault(client));
  await step('fetchEpoch', () => c.fetchEpoch(client));
  await step('fetchV6Stakers', () => c.fetchV6Stakers(client));
  await step('fetchV5Stakers', () => c.fetchV5Stakers(client));
  await step('Haedal tickets (crank)', () => client.getOwnedObjects({ owner: CRANK, filter: { StructType: HAEDAL_TICKET } }));

  console.log('\n── Ticket plan for the next draw (same for Spark / Pulse / Surge)');
  try {
    const plan = c.planTickets(await c.fetchV6Stakers(client));
    console.log(`   1 ticket = ${Number(plan.unit) / 1e9} SUI · ${plan.totalTickets} tickets · excluded: ${plan.excluded.map(a => a.slice(0, 10) + '…').join(', ') || 'none'}`);
    for (const [addr, t] of plan.entries) {
      console.log(`   ${addr.slice(0, 10)}…  ${t} tickets  → ${(Number(t) / Number(plan.totalTickets) * 100).toFixed(1)}% win chance`);
    }
  } catch (e) { console.log('❌ planTickets:', e.message); }
  process.exit(0);
})();

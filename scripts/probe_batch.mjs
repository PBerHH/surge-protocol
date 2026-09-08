import { SuiGrpcClient } from '@mysten/sui/grpc';
const VAULT = '0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5';
const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' });
const util = await import('node:util');

console.log('--- getObjects (batch) ---');
try {
  const r = await client.getObjects({ objectIds: [VAULT], readMask: { paths: ['json'] } });
  console.log(util.inspect(r, { depth: 6 }));
} catch (e) { console.log('error:', e.message); }

console.log('\n--- core.getObjects ---');
try {
  const r2 = await client.core.getObjects({ objectIds: [VAULT], readMask: { paths: ['json'] } });
  console.log(util.inspect(r2, { depth: 6 }));
} catch (e) { console.log('error:', e.message); }

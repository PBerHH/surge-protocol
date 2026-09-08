import { SuiGrpcClient } from '@mysten/sui/grpc';
const VAULT = '0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5';
const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://sui-grpc.publicnode.com:443' });
const util = await import('node:util');
try {
  const v = await client.getObject({ objectId: VAULT, readMask: { paths: ['json'] } });
  console.log(util.inspect(v.object, { depth: 6 }));
} catch (e) { console.log('error:', e.message); }

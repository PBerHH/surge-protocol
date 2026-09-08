import { SuiGrpcClient } from '@mysten/sui/grpc';
const VAULT = '0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5';
const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' });
const v = await client.getObject({ objectId: VAULT, readMask: { paths: ['json', 'objectType'] } });
console.log(JSON.stringify(v, (k, val) => typeof val === 'bigint' ? val.toString() : val, 2));

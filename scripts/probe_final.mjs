import { SuiGrpcClient } from '@mysten/sui/grpc';

const VAULT = '0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5';
const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' });

const dump = (label, obj) => {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(obj, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
};

const attempts = [['json'], ['contents'], ['bcs'], ['object_type', 'json'], ['*']];

for (const paths of attempts) {
  try {
    const v = await client.getObject({ objectId: VAULT, readMask: { paths } });
    dump(`paths=${JSON.stringify(paths)}`, v);
  } catch (e) {
    console.log(`\n=== paths=${JSON.stringify(paths)} → ERROR: ${e.message} ===`);
  }
}

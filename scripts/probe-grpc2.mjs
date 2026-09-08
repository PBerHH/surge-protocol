import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';

const VAULT = '0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5';
const HAEDAL_PKG = '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d';
const HAEDAL_STAKING = '0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca';
const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' });
const show = (x) => console.log(JSON.stringify(x, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));

console.log("=== getObject mit readMask (Feld-Inhalt anfordern) ===");
try {
  const v1 = await client.getObject({ objectId: VAULT, readMask: { paths: ['*'] } });
  show(v1);
} catch (e) { console.log("readMask *:", e.message); }

console.log("\n=== getObject mit explizitem contents-Pfad ===");
try {
  const v2 = await client.getObject({ objectId: VAULT, readMask: { paths: ['contents', 'objectType', 'json'] } });
  show(v2);
} catch (e) { console.log("readMask contents:", e.message); }

console.log("\n=== simulateTransaction mit readMask fuer command outputs ===");
const tx = new Transaction();
tx.moveCall({ target: `${HAEDAL_PKG}::staking::get_exchange_rate`, arguments: [tx.object(HAEDAL_STAKING)] });
try {
  const ins = await client.simulateTransaction({
    transaction: tx,
    sender: '0x' + '0'.repeat(63) + '1',
    readMask: { paths: ['*'] },
  });
  show(ins);
} catch (e) { console.log("simulate readMask *:", e.message); }

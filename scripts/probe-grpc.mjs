import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';

const VAULT = '0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5';
const HAEDAL_PKG = '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d';
const HAEDAL_STAKING = '0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca';

const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' });

console.log("=== getObject(VAULT) ===");
const v = await client.getObject({ objectId: VAULT });
console.log(JSON.stringify(v, (k, val) => typeof val === 'bigint' ? val.toString() : val, 2).slice(0, 2500));

console.log("\n=== simulateTransaction (get_exchange_rate) ===");
const tx = new Transaction();
tx.moveCall({ target: `${HAEDAL_PKG}::staking::get_exchange_rate`, arguments: [tx.object(HAEDAL_STAKING)] });
try {
  const ins = await client.simulateTransaction({ transaction: tx, sender: '0x' + '0'.repeat(63) + '1' });
  console.log(JSON.stringify(ins, (k, val) => typeof val === 'bigint' ? val.toString() : val, 2).slice(0, 2500));
} catch (e) {
  console.log("Fehler mit 'sender':", e.message);
  console.log("--- probiere 'transaction' als bytes statt Transaction-Objekt oder anderer Param-Name ---");
}

import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';

// Sui's official public JSON-RPC endpoints were disabled the week of July 27,
// 2026 (ecosystem-wide migration to gRPC/GraphQL). Chainstack still serves a
// JSON-RPC-compatible endpoint during the transition (full JSON-RPC removal
// from node software isn't until mid-October 2026), so no code changes were
// needed here beyond the client import path and this URL.
// Manual debug script — run with RPC_URL=... node scripts/yield.mjs (see .env.example).
const RPC_URL = process.env.RPC_URL || 'https://sui-mainnet.core.chainstack.com/396f310746ca72e8a7912556ef34da94';

const VAULT = '0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5';
const HAEDAL_PKG = '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d';
const HAEDAL_STAKING = '0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca';

(async () => {
  const client = new SuiJsonRpcClient({ url: RPC_URL });
  const v = await client.getObject({ id: VAULT, options: { showContent: true } });
  const f = v.data.content.fields;
  const principal = BigInt(f.total_principal);
  const ha = BigInt(f.ha_balance);
  const tx = new Transaction();
  tx.moveCall({ target: `${HAEDAL_PKG}::staking::get_exchange_rate`, arguments: [tx.object(HAEDAL_STAKING)] });
  const ins = await client.devInspectTransactionBlock({ sender: '0x' + '0'.repeat(63) + '1', transactionBlock: tx });
  const bytes = ins.results[0].returnValues[0][0];
  let rate = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) rate = (rate << 8n) | BigInt(bytes[i]);
  const value = (ha * rate) / 1000000n;
  const yld = value > principal ? value - principal : 0n;
  const s = (x) => (Number(x) / 1e9).toFixed(9);
  console.log(`principal:  ${s(principal)} SUI`);
  console.log(`haSUI:      ${s(ha)} @ ${(Number(rate) / 1e6).toFixed(6)}`);
  console.log(`value:      ${s(value)} SUI`);
  console.log(`yield:      +${s(yld)} SUI`);
})().catch((e) => console.error('ERROR:', e.message));

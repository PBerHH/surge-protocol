const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');

const VAULT = '0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5';
const HAEDAL_PKG = '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d';
const HAEDAL_STAKING = '0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca';

(async () => {
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
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
})();

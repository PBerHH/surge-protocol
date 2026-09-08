import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";

const SENDER         = "0x2c487e8e12025933b4c19fa596dcc5e6a0c9d840e6ba1dfc86ec930f9d62a726";
const V6_PACKAGE     = "0xaf489faa2a23db82265e25c833f2cf9b985eb0a8d4acde121c7e14c111c3b62e";
const V6_VAULT       = "0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5";
const HAEDAL_STAKING = "0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca";
const CLOCK          = "0x0000000000000000000000000000000000000000000000000000000000000006";

const RECEIPTS = [
  "0x55909a3be05f1eeaa85e85454201fd005af808b46923e8619adc42e1b93e4b09",
  "0x5f63ef4128b5b13f412fb5cc0c6d4fb7101fe9b9aeb2bce4c1ff08fe9a253cc4",
];

const client = new SuiClient({ url: getFullnodeUrl("mainnet") });

for (const rid of RECEIPTS) {
  const obj = await client.getObject({ id: rid, options: { showContent: true } });
  const principal = obj.data?.content?.fields?.principal_mist ?? "?";
  const tx = new Transaction();
  tx.moveCall({
    target: `${V6_PACKAGE}::stake_vault_v6::request_unstake`,
    arguments: [tx.object(V6_VAULT), tx.object(HAEDAL_STAKING), tx.object(rid), tx.object(CLOCK)],
  });
  const r = await client.devInspectTransactionBlock({ sender: SENDER, transactionBlock: tx });
  console.log(`Receipt ${rid.slice(0, 10)}… (principal ${Number(principal) / 1e9} SUI):`);
  console.log(`  STATUS: ${r.effects?.status?.status}`);
  console.log(`  ERROR : ${r.effects?.status?.error ?? "(none)"}`);
}

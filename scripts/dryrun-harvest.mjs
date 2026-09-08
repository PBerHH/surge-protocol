import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";

const SENDER         = "0x2a587fd1789212292af4337cacdc7bcbca496e01a6538f46c08968d41d6a83c0";
const V6_PACKAGE     = "0xaf489faa2a23db82265e25c833f2cf9b985eb0a8d4acde121c7e14c111c3b62e";
const V6_VAULT       = "0xcc6a5e55e3099b2b9d777b9f51b6a5807a03888c613be0b401468a94cc3f1ba5";
const HAEDAL_STAKING = "0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca";
const V6_ADMIN_CAP   = "0x49f6efce40760911b78cbd8b6394303227524956685c1c697aefd70d4ee9e520";
const CLOCK          = "0x0000000000000000000000000000000000000000000000000000000000000006";

const client = new SuiClient({ url: getFullnodeUrl("mainnet") });
const tx = new Transaction();
tx.moveCall({
  target: `${V6_PACKAGE}::stake_vault_v6::harvest`,
  arguments: [tx.object(V6_VAULT), tx.object(HAEDAL_STAKING), tx.object(V6_ADMIN_CAP), tx.object(CLOCK)],
});
const r = await client.devInspectTransactionBlock({ sender: SENDER, transactionBlock: tx });
console.log("STATUS:", r.effects?.status?.status);
console.log("ERROR :", r.effects?.status?.error ?? "(none)");

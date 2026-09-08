import React from "react";
import ReactDOM from "react-dom/client";
import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";
import "@mysten/dapp-kit/dist/index.css";

const queryClient = new QueryClient();

// Sui's official public JSON-RPC endpoints were disabled the week of July 27,
// 2026 (ecosystem-wide migration to gRPC/GraphQL) — getFullnodeUrl("mainnet")
// now points at a dead endpoint. Chainstack still serves JSON-RPC during the
// transition (full removal from node software isn't until mid-Oct 2026), so
// pointing directly at that URL restores the site with zero other changes.
const networks = {
  mainnet: { url: "https://sui-mainnet.core.chainstack.com/396f310746ca72e8a7912556ef34da94" },
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork="mainnet">
        <WalletProvider autoConnect>
          <App />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </React.StrictMode>
);

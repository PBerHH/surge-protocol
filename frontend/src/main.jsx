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
//
// URL comes from a Vite build-time env var (set VITE_RPC_URL in Vercel
// project settings) instead of being committed to source. Keep the same
// token-in-path format Chainstack issues — a prior attempt to switch to a
// Basic-Auth (user:pass@) URL broke prod, since both browser fetch() and
// Node's undici reject URLs with embedded credentials per the Fetch spec.
// The fallback below is only a safety net for local dev before the env var
// is set; once VITE_RPC_URL is live on Vercel this hardcoded value is dead
// code and should be deleted (and the token rotated in the Chainstack
// dashboard, since it was previously exposed in git history).
const networks = {
  mainnet: { url: import.meta.env.VITE_RPC_URL || "https://sui-mainnet.core.chainstack.com/396f310746ca72e8a7912556ef34da94" },
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

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
// transition (full removal from node software isn't until mid-Oct 2026).
//
// URL comes from a Vite build-time env var — VITE_RPC_URL is set in Vercel
// project settings, confirmed live 11.09. Keep the same token-in-path format
// Chainstack issues — a prior attempt to switch to a Basic-Auth (user:pass@)
// URL broke prod, since browser fetch() rejects URLs with embedded
// credentials per the Fetch spec.
const networks = {
  mainnet: { url: import.meta.env.VITE_RPC_URL },
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

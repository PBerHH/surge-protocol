import React from "react";
import ReactDOM from "react-dom/client";
import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import BonusBanner from "./BonusBanner";
import "./index.css";
import "@mysten/dapp-kit/dist/index.css";

const queryClient = new QueryClient();

const networks = {
  mainnet: { url: import.meta.env.VITE_RPC_URL },
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork="mainnet">
        <WalletProvider autoConnect>
          <BonusBanner />
          <App />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </React.StrictMode>
);

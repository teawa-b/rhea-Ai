/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Railway backend URL, e.g. https://rhea-api.up.railway.app (unset in local dev). */
  readonly VITE_API_URL?: string;
  readonly VITE_PRIVY_APP_ID?: string;
  /** Solana RPC the browser uses for Privy's wallet UI (falls back to the public endpoint). */
  readonly VITE_SOLANA_RPC_URL?: string;
  /** Websocket endpoint for the same RPC; derived from VITE_SOLANA_RPC_URL when unset. */
  readonly VITE_SOLANA_WS_URL?: string;
}

declare module "world-atlas/countries-110m.json" {
  const value: unknown;
  export default value;
}

/* Authentication + embedded Solana wallet (spec §13) via Privy.
 *
 * `useAuth()` exposes one small interface to the rest of the app. When
 * VITE_PRIVY_APP_ID is not configured the app still runs in "guest" mode
 * (globe, AI research, charts) with trading disabled, so judges without keys
 * can still explore. The private key never touches app code: signing goes
 * through Privy's signTransaction / signMessage.
 */
import { PrivyProvider, usePrivy, useLogin, useLogout } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { toSolanaWalletConnectors, useSignMessage, useSignTransaction, useWallets, type ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { xrStore } from "@/scene/xrStore";
import { useMarket } from "@/state/market";

export type RheaAuth = {
  mode: "privy" | "guest";
  ready: boolean;
  authenticated: boolean;
  displayName: string | null;
  address: string | null;
  /** True when the signer is Privy's embedded wallet, which can sign without any DOM prompt (see signTransaction). */
  embedded: boolean;
  login: () => void;
  logout: () => Promise<void>;
  signTransaction: (tx: Uint8Array) => Promise<Uint8Array>;
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>;
};

const GUEST: RheaAuth = {
  mode: "guest",
  ready: true,
  authenticated: false,
  displayName: null,
  address: null,
  embedded: false,
  login: () => alert("Set VITE_PRIVY_APP_ID to enable sign-in and the embedded Solana wallet."),
  logout: async () => undefined,
  signTransaction: async () => { throw new Error("Sign in to trade"); },
  signMessage: async () => { throw new Error("Sign in to continue"); },
};

const AuthCtx = createContext<RheaAuth>(GUEST);
export const useAuth = () => useContext(AuthCtx);

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

/* Privy's own wallet UI (the confirm-and-send screen behind showWalletUIs) resolves an
 * @solana/kit client per chain and throws "No RPC configuration found for chain
 * solana:mainnet" while rendering if we don't hand it one — which took the whole React
 * tree down the moment Buy opened the modal. The backend's SOLANA_RPC_URL never reaches
 * the browser, so the client needs its own VITE_SOLANA_RPC_URL; the public endpoint is a
 * rate-limited last resort that keeps the modal alive rather than blank. */
const RPC_HTTP = (import.meta.env.VITE_SOLANA_RPC_URL as string | undefined)?.trim() || "https://api.mainnet-beta.solana.com";
const RPC_WS = (import.meta.env.VITE_SOLANA_WS_URL as string | undefined)?.trim() || RPC_HTTP.replace(/^http/, "ws");

const SOLANA_RPCS = {
  "solana:mainnet": {
    rpc: createSolanaRpc(RPC_HTTP),
    rpcSubscriptions: createSolanaRpcSubscriptions(RPC_WS),
    blockExplorerUrl: "https://explorer.solana.com",
  },
} as const;

/* Privy's confirm screen is a DOM modal, and an immersive WebXR session hides the DOM (the
 * headset ignores dom-overlay). The embedded wallet doesn't need that screen: it signs over
 * postMessage, so while immersive the holo card that already lists spend / receive / route /
 * fees is the confirmation and Privy is told to stay quiet. On the flat page the modal stays
 * as a second look. External wallets keep their own popup, which XRPanels hands off for. */
const walletUi = (embedded: boolean) => ({ showWalletUIs: !(embedded && xrStore.getState().mode != null) });

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();
  const { wallets, ready: walletsReady } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();
  const setWallet = useMarket((s) => s.setWallet);

  /* Prefer the Privy embedded wallet; fall back to any connected Solana wallet. */
  const wallet: ConnectedStandardSolanaWallet | null = useMemo(() => {
    if (!walletsReady) return null;
    return wallets.find((w) => w.standardWallet?.name === "Privy") ?? wallets[0] ?? null;
  }, [wallets, walletsReady]);

  const address = authenticated ? wallet?.address ?? null : null;
  /* A real sign-in ends the read-only ?demo=1 portfolio and takes over the store wallet. Signed out, the demo
   * wallet (set by App's Boot) must survive: clearing to null is only for a visitor who isn't in demo mode. */
  useEffect(() => {
    const m = useMarket.getState();
    if (authenticated) { m.exitDemo(); setWallet(address); }
    else if (!m.demoMode) setWallet(null);
  }, [authenticated, address, setWallet]);

  const embedded = wallet?.standardWallet?.name === "Privy";
  const displayName = user?.google?.name ?? user?.email?.address ?? user?.google?.email ?? (address ? `${address.slice(0, 4)}…${address.slice(-4)}` : null);

  const value = useMemo<RheaAuth>(() => ({
    mode: "privy",
    ready,
    authenticated,
    displayName,
    address,
    embedded,
    login: () => login({ loginMethods: ["google", "email", "wallet"] }),
    logout: async () => { await logout(); },
    signTransaction: async (tx) => {
      if (!wallet) throw new Error("No Solana wallet available — sign in first");
      const { signedTransaction } = await signTransaction({ transaction: tx, wallet, chain: "solana:mainnet", options: { uiOptions: walletUi(embedded) } });
      return signedTransaction;
    },
    signMessage: async (msg) => {
      if (!wallet) throw new Error("No Solana wallet available — sign in first");
      const { signature } = await signMessage({ message: msg, wallet, options: { uiOptions: walletUi(embedded) } });
      return signature;
    },
  }), [ready, authenticated, displayName, address, embedded, wallet, login, logout, signTransaction, signMessage]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function RheaAuthProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <AuthCtx.Provider value={GUEST}>{children}</AuthCtx.Provider>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#3fe0ff",
          logo: "/favicon.svg",
          walletChainType: "solana-only",
          showWalletLoginFirst: false,
        },
        loginMethods: ["google", "email", "wallet"],
        embeddedWallets: {
          solana: { createOnLogin: "all-users" },
          showWalletUIs: true,
        },
        externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
        solana: { rpcs: SOLANA_RPCS },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

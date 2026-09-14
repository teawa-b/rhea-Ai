/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Railway backend URL, e.g. https://rhea-api.up.railway.app (unset in local dev). */
  readonly VITE_API_URL?: string;
  readonly VITE_PRIVY_APP_ID?: string;
}

declare module "world-atlas/countries-110m.json" {
  const value: unknown;
  export default value;
}

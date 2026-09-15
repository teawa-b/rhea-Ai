/* Verified-on-mainnet snapshot: public signatures of the real transactions Rhea made (swap, order deposit,
 * cancel/refund, fill). Committed by hand after the dry run, because order history needs the wallet's own
 * Jupiter JWT and a logged-out judge can't fetch it. The HUD lists these with Solscan links; empty renders nothing. */

export type VerifiedTx = {
  /** What happened, e.g. "Buy $20 NVDAx · Jupiter swap". */
  label: string;
  /** Base58 transaction signature (public). */
  signature: string;
  /** ISO time the transaction confirmed. */
  at: string;
  /** Session wording at that time, e.g. "regular session closed" or "US market closed for the weekend". */
  session: string;
};

export const VERIFIED_ON_MAINNET: VerifiedTx[] = [];

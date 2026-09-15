/* troika-three-text ships no types; drei wraps it. Only what scene/fonts.ts uses. */
declare module "troika-three-text" {
  export function preloadFont(opts: { font?: string; characters?: string | string[] }, callback: () => void): void;
}

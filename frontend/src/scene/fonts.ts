/* Self-hosted fonts for every troika <Text> in the scene. Without a `font`
 * prop troika fetches Roboto (and per-glyph fallback fonts) from a CDN at
 * runtime, which in the headset shows up as text popping in late. These are
 * the same faces the flat page uses (theme FONT / MONO), latin subset only, so
 * scene strings stick to latin glyphs — symbols are drawn as icons (icons.ts).
 * Text outside the subset (e.g. a CJK headline) still resolves via troika's
 * fallback. */
import { preloadFont } from "troika-three-text";
import { preload } from "suspend-react";
/* .woff, not .woff2: the troika build drei bundles rejects woff2 ("woff2 fonts not supported"). */
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff?url";
import inter800 from "@fontsource/inter/files/inter-latin-800-normal.woff?url";
import mono600 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff?url";

export const FONT_BODY = inter600;
export const FONT_BOLD = inter800;
/** Tabular digits, so live prices don't shimmy as they tick. */
export const FONT_NUM = mono600;

/* drei's <Text> suspends on ['troika-text', font, characters] until the font is
 * parsed. Warming the same cache keys up front means a font's first use (a pill
 * appearing in the headset) never suspends the whole scene for a frame. */
for (const font of [FONT_BODY, FONT_BOLD, FONT_NUM]) {
  preload(() => new Promise<void>((res) => preloadFont({ font, characters: undefined }, () => res())), ["troika-text", font, undefined]);
}

/** Latin-subset stand-ins for the math symbols the rule/intent helpers use. */
export const latinText = (s: string) => s.replace(/≤/g, "at or below").replace(/≥/g, "at or above");

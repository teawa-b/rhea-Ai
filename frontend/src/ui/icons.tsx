/* Small stroke icons for the HUD (inherit currentColor). */
type P = { size?: number };
const base = (size = 18) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true });

export function MicIcon({ size }: P) {
  return (
    <svg {...base(size)}>
      <rect x="9" y="2.5" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3.5" />
    </svg>
  );
}

export function MicOffIcon({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M15 9.3V5.5a3 3 0 0 0-5.7-1.3" />
      <path d="M9 9v2.5a3 3 0 0 0 5.1 2.1" />
      <path d="M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 10.7 5.9" />
      <path d="M12 18v3.5" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function ChevronLeftIcon({ size }: P) {
  return <svg {...base(size)}><path d="M15 5l-7 7 7 7" /></svg>;
}

export function CloseIcon({ size }: P) {
  return <svg {...base(size)}><path d="M6 6l12 12M18 6L6 18" /></svg>;
}

export function GlobeIcon({ size }: P) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </svg>
  );
}

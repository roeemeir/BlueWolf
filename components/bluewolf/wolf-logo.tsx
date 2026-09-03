import { cn } from "@/lib/utils";

export function WolfLogo({ className, animated = false }: { className?: string; animated?: boolean }) {
  return (
    <svg className={cn("wolf-logo", animated && "is-animated", className)} viewBox="0 0 96 96" role="img" aria-label="לוגו זאב כחול">
      <defs>
        <linearGradient id="wolfFur" x1="18" y1="14" x2="78" y2="82" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7CF5E4" />
          <stop offset="0.48" stopColor="#28CFC3" />
          <stop offset="1" stopColor="#3E7BEA" />
        </linearGradient>
        <linearGradient id="wolfShade" x1="48" y1="38" x2="48" y2="82" gradientUnits="userSpaceOnUse">
          <stop stopColor="#173E62" />
          <stop offset="1" stopColor="#0A1D35" />
        </linearGradient>
        <filter id="wolfGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path className="wolf-halo" d="M48 7C25.4 7 7 25.4 7 48s18.4 41 41 41 41-18.4 41-41S70.6 7 48 7Z" fill="url(#wolfFur)" opacity=".13" />
      <path d="M22 20 38 31h20l16-11-4 26 7 15-16 21H35L19 61l7-15-4-26Z" fill="url(#wolfFur)" stroke="rgba(255,255,255,.72)" strokeWidth="2.2" strokeLinejoin="round" filter="url(#wolfGlow)" />
      <path d="M27 31 38 38h20l11-7-4 19 6 10-13 17H38L25 60l6-10-4-19Z" fill="url(#wolfShade)" opacity=".92" />
      <path d="m35 47 10 5-11 3 1-8Zm26 0-10 5 11 3-1-8Z" fill="#BFFFF6" />
      <circle cx="39" cy="51" r="2.4" fill="#07111F" />
      <circle cx="57" cy="51" r="2.4" fill="#07111F" />
      <path d="M40 64h16l-8 8-8-8Z" fill="#66E6D7" />
      <path d="M34 72c8 5 20 5 28 0" fill="none" stroke="#7CF5E4" strokeWidth="2" strokeLinecap="round" opacity=".75" />
    </svg>
  );
}

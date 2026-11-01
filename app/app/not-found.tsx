import Link from "next/link";

// 404: a danfo bus drives over a bumpy road. Its wheels hit the bumps in time with the vibration trace
// behind it, which is what the Wildroads app measures. Pure CSS motion; stops for reduced-motion users.
// Timing: road scrolls 600 units in 6 s (100 units/s). Bumps sit at x=100 and x=400 of each 600-unit tile,
// the bus is at x=300, so the wheels (at x=262 and x=338) meet them at 0.62 s, 1.38 s, 3.62 s and 4.38 s.

export default function NotFound() {
  return (
    <div className="content nf">
      <p className="nf-code" aria-hidden="true">
        <span className="nf-d nf-d1">4</span>
        <svg className="nf-ring" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="var(--paint)" strokeWidth="9" strokeDasharray="16.5 16.5" />
          <g className="nf-orbit">
            <circle cx="50" cy="8" r="7" fill="var(--ink)" />
          </g>
        </svg>
        <span className="nf-d nf-d2">4</span>
      </p>

      <svg className="nf-scene" viewBox="0 44 600 226" role="img" aria-label="A yellow danfo bus drives over bumps while a vibration trace is drawn behind it">
        <defs>
          <linearGradient id="nf-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#000" />
            <stop offset="0.45" stopColor="#fff" />
            <stop offset="1" stopColor="#fff" />
          </linearGradient>
          <mask id="nf-fade" maskUnits="userSpaceOnUse" x="0" y="222" width="300" height="46">
            <rect x="0" y="222" width="300" height="46" fill="url(#nf-grad)" />
          </mask>

          <g id="nf-hills">
            <path d="M0 120 C60 90 120 100 180 118 S300 135 360 112 S480 86 540 108 S590 118 600 120 V152 H0 Z" fill="var(--line)" />
          </g>

          <g id="nf-tile">
            <path d="M0 150 H84 Q100 132 116 150 H384 Q400 132 416 150 H600 V218 H0 Z" fill="var(--nf-road)" />
            <path d="M0 150 H84 Q100 132 116 150 H384 Q400 132 416 150 H600" fill="none" stroke="var(--muted)" strokeWidth="2" />
            <line x1="0" y1="186" x2="600" y2="186" stroke="var(--paint)" strokeWidth="4" strokeDasharray="28 22" />
            <rect x="518" y="92" width="4" height="58" fill="var(--muted)" />
            <rect x="476" y="60" width="88" height="42" rx="7" fill="#0f7b4f" stroke="#fff" strokeWidth="2" />
            <text x="520" y="91" textAnchor="middle" fontSize="26" fontWeight="800" fill="#fff" letterSpacing="1">404</text>
          </g>

          <g id="nf-spikes" fill="none" stroke="var(--paint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M346 245 L354 245 L357 229 L361 258 L365 236 L369 252 L373 243 L378 245" />
            <path d="M422 245 L430 245 L433 231 L437 256 L441 238 L445 250 L449 244 L454 245" />
            <path d="M46 245 L54 245 L57 229 L61 258 L65 236 L69 252 L73 243 L78 245" />
            <path d="M122 245 L130 245 L133 231 L137 256 L141 238 L145 250 L149 244 L154 245" />
          </g>
        </defs>

        <g className="nf-hills">
          <use href="#nf-hills" x="0" />
          <use href="#nf-hills" x="600" />
        </g>

        <g className="nf-road">
          <use href="#nf-tile" x="0" />
          <use href="#nf-tile" x="600" />
        </g>

        <line x1="0" y1="245" x2="600" y2="245" stroke="var(--line)" strokeWidth="1.5" />
        <g mask="url(#nf-fade)">
          <g className="nf-road">
            <use href="#nf-spikes" x="0" />
            <use href="#nf-spikes" x="600" />
          </g>
        </g>
        <circle className="nf-pulse" cx="300" cy="245" r="4" fill="var(--paint)" />
        <circle cx="300" cy="245" r="4" fill="var(--paint)" />

        <g transform="translate(300 0)">
          <g className="nf-body">
            <path d="M66 117 L150 100 L150 138 Z" fill="#fff" opacity="0.1" />
            <rect x="-65" y="88" width="130" height="44" rx="10" fill="var(--paint)" />
            <rect x="-65" y="109" width="130" height="8" fill="var(--paint-ink)" />
            <rect x="-58" y="94" width="24" height="12" rx="3" fill="var(--nf-glass)" />
            <rect x="-30" y="94" width="24" height="12" rx="3" fill="var(--nf-glass)" />
            <rect x="-2" y="94" width="24" height="12" rx="3" fill="var(--nf-glass)" />
            <rect x="26" y="94" width="24" height="12" rx="3" fill="var(--nf-glass)" />
            <rect x="52" y="94" width="9" height="13" rx="3" fill="var(--nf-glass)" />
            <rect x="-67" y="119" width="4" height="9" rx="1.5" fill="var(--r2)" />
            <circle cx="63" cy="123" r="3" fill="#fff" />
          </g>
          <g transform="translate(-38 137)">
            <g className="nf-hop-r">
              <g className="nf-spin">
                <circle r="13" fill="#10171d" />
                <circle r="6" fill="#aab6bf" />
                <path d="M-6 0 H6 M0 -6 V6" stroke="#10171d" strokeWidth="2" />
              </g>
            </g>
          </g>
          <g transform="translate(38 137)">
            <g className="nf-hop-f">
              <g className="nf-spin">
                <circle r="13" fill="#10171d" />
                <circle r="6" fill="#aab6bf" />
                <path d="M-6 0 H6 M0 -6 V6" stroke="#10171d" strokeWidth="2" />
              </g>
            </g>
          </g>
        </g>
      </svg>

      <p className="nf-cap">The wiggle under the road is what a phone feels.</p>

      <h1>This road isn&rsquo;t on the map yet.</h1>
      <p className="nf-lead">The page you asked for doesn&rsquo;t exist, or nobody has driven there yet. Every road on this map started with someone&rsquo;s first trip.</p>
      <div className="nf-actions">
        <Link className="btn" href="/">Back to the map</Link>
        <Link className="btn secondary" href="/record">Record a trip</Link>
      </div>
    </div>
  );
}

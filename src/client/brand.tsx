// The Marche Bou Makk mark: a shopping bag carrying a globe, in market green and gold.
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="18" fill="#0b7a4b" />
      <path d="M24 23.5c0-4.7 3.6-8.5 8-8.5s8 3.8 8 8.5" fill="none" stroke="#ffffff" strokeWidth="3.6" strokeLinecap="round" />
      <rect x="15" y="23" width="34" height="27" rx="8" fill="#ffffff" />
      <circle cx="32" cy="36.5" r="7.2" fill="none" stroke="#e8a317" strokeWidth="2.8" />
      <path
        d="M24.8 36.5h14.4M32 29.3c-2 2.2-3.1 4.8-3.1 7.2s1.1 5 3.1 7.2c2-2.2 3.1-4.8 3.1-7.2s-1.1-5-3.1-7.2z"
        fill="none"
        stroke="#e8a317"
        strokeWidth="1.5"
      />
    </svg>
  );
}

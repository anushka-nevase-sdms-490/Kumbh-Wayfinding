import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

function Svg({ size = 22, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Line icon per kind of place (node_type). */
export function PlaceIcon({ type, ...p }: IconProps & { type: string }) {
  switch (type) {
    case "ghat":
      return (
        <Svg {...p}>
          <path d="M2 7c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0 3-1.2 4.5 0" />
          <path d="M2 12c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0 3-1.2 4.5 0" />
          <path d="M2 17c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0 3-1.2 4.5 0" />
        </Svg>
      );
    case "medical":
      return (
        <Svg {...p}>
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <path d="M12 8v8M8 12h8" />
        </Svg>
      );
    case "parking":
      return (
        <Svg {...p}>
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <path d="M9.5 17V7h3.5a3 3 0 0 1 0 6H9.5" />
        </Svg>
      );
    case "transport":
      return (
        <Svg {...p}>
          <rect x="4" y="3" width="16" height="14" rx="3" />
          <path d="M4 10h16M8 21l1-4M16 21l-1-4" />
          <path d="M8 13.5h.01M16 13.5h.01" />
        </Svg>
      );
    case "tent_city":
      return (
        <Svg {...p}>
          <path d="M2 21h20M12 3 3 21M12 3l9 18M12 13l-3 8M12 13l3 8" />
        </Svg>
      );
    case "akhara":
      return (
        <Svg {...p}>
          <path d="M5 21V4M5 4c4-2 7 2 14 0v9c-7 2-10-2-14 0" />
        </Svg>
      );
    case "toilet":
      return (
        <Svg {...p}>
          <path d="M7 3v18M17 3v18M4 12h6M14 12h6" />
        </Svg>
      );
    case "help":
      return (
        <Svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.3M12 17h.01" />
        </Svg>
      );
    case "lost_found":
      return (
        <Svg {...p}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </Svg>
      );
    default:
      return (
        <Svg {...p}>
          <path d="M19 10c0 6-7 11-7 11s-7-5-7-11a7 7 0 0 1 14 0Z" />
          <circle cx="12" cy="10" r="2.5" />
        </Svg>
      );
  }
}

export function ScanIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 12h10" />
    </Svg>
  );
}

export function BoardsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3v3M21 14v.01M14 21h7v-4" />
    </Svg>
  );
}

export function CompassIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </Svg>
  );
}

export function WalkerIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="13" cy="4" r="2" />
      <path d="m9 21 2.5-6.5L14 17v4M7 12l2.5-4 4 1 2.5 3.5M11.5 14.5 13.5 9" />
    </Svg>
  );
}

export function VolunteerIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10Z" />
    </Svg>
  );
}

export function PinPlusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M19 10c0 6-7 11-7 11s-7-5-7-11a7 7 0 0 1 14 0Z" />
      <path d="M12 7.5v5M9.5 10h5" />
    </Svg>
  );
}

export function BlockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.7 5.7 12.6 12.6" />
    </Svg>
  );
}

export function ChevronIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

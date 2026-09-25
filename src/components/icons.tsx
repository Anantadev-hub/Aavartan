import type { SVGProps } from "react";

// Proper SVG icon set for navigation and key actions — no unicode symbols.

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps): IconProps {
  return {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...props,
  };
}

export const HomeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
  </svg>
);

export const PriceTagIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20.6 13.4 12 22 2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z" />
    <circle cx="7.5" cy="7.5" r="1.5" />
  </svg>
);

export const PlusIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const LotsIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
    <path d="m3 8 9 5 9-5" />
    <path d="M12 13v8" />
  </svg>
);

export const WalletIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" />
    <path d="M16.5 12.5h.01" />
  </svg>
);

export const GridIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
  </svg>
);

export const BuildingIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M9 7h1.5M13.5 7H15M9 11h1.5M13.5 11H15" />
    <path d="M10 21v-4h4v4" />
  </svg>
);

export const CameraIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 8h2.5L9 5h6l2.5 3H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="14" r="3.5" />
  </svg>
);

export const ImageIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m5 19 5.5-5.5 3 3L17 13l4 4" />
  </svg>
);

export const ShieldCheckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 2 4 5.5v5.6c0 4.9 3.4 8.6 8 10.4 4.6-1.8 8-5.5 8-10.4V5.5Z" />
    <path d="m8.8 11.8 2.2 2.2 4.2-4.4" />
  </svg>
);

export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m4.5 12.5 5 5L20 7" />
  </svg>
);

export const CheckCircleIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.2 12.3 2.6 2.6 5-5.4" />
  </svg>
);

export const ClockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.2 2" />
  </svg>
);

export const XCircleIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="m9 9 6 6M15 9l-6 6" />
  </svg>
);

export const StarIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m12 3 2.7 5.8 6.3.7-4.7 4.3 1.3 6.2-5.6-3.2-5.6 3.2L7.7 13.8 3 9.5l6.3-.7Z" />
  </svg>
);

export const MapPinIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);

export const PhoneIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 3h3.5l1.5 4.5L7.6 9a12.5 12.5 0 0 0 7.4 7.4l1.5-2.4L21 15.5V19a2 2 0 0 1-2.2 2A16.8 16.8 0 0 1 3 5.2 2 2 0 0 1 5 3Z" />
  </svg>
);

export const TruckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 6h11v9H3zM14 9h3.5L21 12.5V15h-7" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </svg>
);

export const SpeakerIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5Z" />
    <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
  </svg>
);

export const WarningIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3 2.5 20h19Z" />
    <path d="M12 10v4M12 17.2h.01" />
  </svg>
);

export const CloudUpIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 18a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 8.5 4 4 0 0 1 17.5 18" />
    <path d="M12 12v8M8.8 15.2 12 12l3.2 3.2" />
  </svg>
);

export const CloudOffIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 18a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 8.5 4 4 0 0 1 17.5 18H7Z" />
    <path d="M3 3l18 18" />
  </svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m15 5-7 7 7 7" />
  </svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5 9 7 7 7-7" />
  </svg>
);

export const SparkleIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </svg>
);

export const TrendUpIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m3 17 6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </svg>
);

export const TrendDownIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m3 7 6 6 4-4 8 8" />
    <path d="M15 17h6v-6" />
  </svg>
);

export const RecycleIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 19H4.8a1.7 1.7 0 0 1-1.5-2.6l2.3-3.9M12 5l2.2-3.2a1.7 1.7 0 0 1 3 .2L19 6.5M17 19h2.2a1.7 1.7 0 0 0 1.5-2.6L18 12" />
    <path d="M7 19c2.5 2 7.5 2 10 0M9.5 21 7 19l2-2.2M14.5 3.5 12 5l2 2.2" />
  </svg>
);

export const LogOutIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </svg>
);

export const FilterIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 5h18M6 12h12M10 19h4" />
  </svg>
);

export const RefreshIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5" />
  </svg>
);

export const LayersIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m12 3 9 5-9 5-9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
);

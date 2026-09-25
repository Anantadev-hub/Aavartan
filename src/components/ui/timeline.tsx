import { cn } from "@/lib/utils";

export type TimelineStep = {
  label: string;
  timestamp: number | null;
  state: "done" | "pending" | "todo";
  description: string;
};

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="space-y-0">
      {steps.map((step, i) => (
        <li key={step.label} className="relative flex gap-3.5 pb-6 last:pb-0">
          {/* connector */}
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className={cn(
                "absolute left-[15px] top-8 h-[calc(100%-14px)] w-1 rounded-full",
                step.state === "done" ? "bg-teal/70" : "bg-border",
              )}
            />
          )}
          <span
            aria-hidden
            className={cn(
              "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full text-white",
              step.state === "done" && "bg-[var(--verified)] shadow-[var(--clay-1)]",
              step.state === "pending" && "bg-[var(--pending)] shadow-[var(--clay-1)]",
              step.state === "todo" && "bg-slate-300 text-slate-500",
            )}
          >
            {step.state === "done" ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m5 13 4.5 4.5L19 7" />
              </svg>
            ) : step.state === "pending" ? (
              <span className="size-2.5 rounded-full bg-white/95" />
            ) : (
              <span className="size-2 rounded-full bg-slate-400/70" />
            )}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className={cn("text-[15px] font-bold", step.state === "todo" ? "text-muted2" : "text-navy")}>
                {step.label}
              </p>
              <span className="shrink-0 text-xs text-muted2">
                {step.timestamp
                  ? new Date(step.timestamp).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
                  : step.state === "pending"
                    ? "In progress"
                    : ""}
              </span>
            </div>
            <p className="mt-0.5 text-[13px] leading-snug text-muted2">{step.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Lightweight inline SVG line chart for price trends (7/30/90 day windows). */
export function TrendChart({
  points,
  height = 120,
  stroke = "var(--teal)",
}: {
  points: number[];
  height?: number;
  stroke?: string;
}) {
  if (points.length < 2) {
    return <div className="clay-track h-[120px]" />;
  }
  const w = 320;
  const h = height;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const px = (i: number) => (i / (points.length - 1)) * w;
  const py = (v: number) => h - 12 - ((v - min) / range) * (h - 24);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  const last = points[points.length - 1];

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Price trend chart">
        <path d={area} fill={stroke} opacity="0.12" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={px(points.length - 1)} cy={py(last)} r="4.5" fill={stroke} />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted2">
        <span>start</span>
        <span>now</span>
      </div>
    </div>
  );
}

/**
 * RefreshIndicator.tsx
 *
 * Pieni "live"-mittari kortin ylä- tai alalaitaan:
 *   ● 12s sitten · ↻ 1:48
 *
 * - Vihreä piste kun data on tuoretta (< intervalMs * 1.5)
 * - Harmaa piste + sykkivä uudelleenlatauskuvake kun data vanhentunutta
 * - Päivittyy joka sekunti ilman että triggeröi parent-komponentin renderointia
 */

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface RefreshIndicatorProps {
  lastFetch: Date | null;
  intervalMs: number;
  label?: string;
  className?: string;
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s sitten`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")} sitten`;
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "nyt";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const RefreshIndicator = ({
  lastFetch,
  intervalMs,
  label,
  className,
}: RefreshIndicatorProps) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  if (!lastFetch) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60",
          className
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
        Odottaa dataa…
      </div>
    );
  }

  const ageMs = now - lastFetch.getTime();
  const ageSec = Math.floor(ageMs / 1000);
  const remainingSec = Math.max(0, Math.ceil((intervalMs - ageMs) / 1000));
  const isFresh = ageMs < intervalMs * 1.5;

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider",
        isFresh ? "text-primary" : "text-muted-foreground/70",
        className
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isFresh ? "bg-primary animate-pulse" : "bg-muted-foreground/40"
        )}
      />
      {label ? <span className="text-muted-foreground/60">{label}</span> : null}
      <span>{formatAge(ageSec)}</span>
      <span className="text-muted-foreground/40">·</span>
      <RefreshCw
        className={cn(
          "h-2.5 w-2.5",
          remainingSec <= 5 && "animate-spin"
        )}
      />
      <span className="font-mono">{formatCountdown(remainingSec)}</span>
    </div>
  );
};

export default RefreshIndicator;

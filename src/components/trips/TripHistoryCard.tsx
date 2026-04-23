import { useEffect, useState } from "react";
import { BarChart3, MapPin, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getTodayStats, getCurrentHourPattern, type TodayStats } from "@/lib/trips";

const TripHistoryCard = () => {
  const [today, setToday] = useState<TodayStats>({ count: 0, avgFare: 0, totalRevenue: 0 });
  const [pattern, setPattern] = useState<{ totalTrips: number; bestArea: string | null; bestAreaCount: number }>({
    totalTrips: 0, bestArea: null, bestAreaCount: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [t, p] = await Promise.all([getTodayStats(), getCurrentHourPattern()]);
      if (!cancelled) {
        setToday(t);
        setPattern(p);
        setLoading(false);
      }
    };
    load();
    const id = window.setInterval(load, 5 * 60 * 1000); // 5 min
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const hourLabel = `${new Date().getHours().toString().padStart(2, "0")}:00`;

  return (
    <div className="px-4 py-3">
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-black text-foreground">Kyytihistoria</h2>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md bg-card-foreground/5 p-3">
            <p className="text-xs text-muted-foreground uppercase">Tänään</p>
            <p className="text-3xl font-black text-foreground">{today.count}</p>
            <p className="text-xs text-muted-foreground">
              kyytiä · avg {today.avgFare.toFixed(2)}€
            </p>
          </div>
          <div className="rounded-md bg-card-foreground/5 p-3">
            <p className="text-xs text-muted-foreground uppercase flex items-center gap-1">
              <Clock className="w-3 h-3" /> Klo {hourLabel} hist.
            </p>
            <p className="text-3xl font-black text-foreground">{pattern.totalTrips}</p>
            <p className="text-xs text-muted-foreground">kyytiä tyypillisesti</p>
          </div>
        </div>

        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground uppercase flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Paras lähtöalue tähän aikaan
          </p>
          {loading ? (
            <p className="text-sm text-muted-foreground mt-1">Ladataan...</p>
          ) : pattern.bestArea ? (
            <>
              <p className="text-xl font-black text-primary mt-1 truncate">{pattern.bestArea}</p>
              <p className="text-xs text-muted-foreground">{pattern.bestAreaCount} kyytiä historiassa</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground mt-1">Ei dataa tälle ajalle</p>
          )}
        </div>
      </Card>
    </div>
  );
};

export default TripHistoryCard;
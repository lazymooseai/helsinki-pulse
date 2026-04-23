import { useEffect, useState } from "react";
import { BarChart3, MapPin, Clock, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getTodayStats, getTopAreasForWindow, type TodayStats, type AreaPrediction } from "@/lib/trips";

const TripHistoryCard = () => {
  const [today, setToday] = useState<TodayStats>({ count: 0, avgFare: 0, totalRevenue: 0 });
  const [nowPattern, setNowPattern] = useState<{ totalTrips: number; areas: AreaPrediction[] }>({
    totalTrips: 0, areas: [],
  });
  const [nextPattern, setNextPattern] = useState<{ totalTrips: number; areas: AreaPrediction[] }>({
    totalTrips: 0, areas: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const now = new Date();
      const hour = now.getHours();
      const nextHour = (hour + 1) % 24;
      const [t, p, p2] = await Promise.all([
        getTodayStats(),
        getTopAreasForWindow({ hours: [hour], topN: 3 }),
        getTopAreasForWindow({ hours: [nextHour, (nextHour + 1) % 24], topN: 3 }),
      ]);
      if (!cancelled) {
        setToday(t);
        setNowPattern(p);
        setNextPattern(p2);
        setLoading(false);
      }
    };
    load();
    const id = window.setInterval(load, 5 * 60 * 1000); // 5 min
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const hour = new Date().getHours();
  const hourLabel = `${hour.toString().padStart(2, "0")}:00`;
  const nextLabel = `${((hour + 1) % 24).toString().padStart(2, "0")}–${((hour + 3) % 24).toString().padStart(2, "0")}`;

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
            <p className="text-3xl font-black text-foreground">{nowPattern.totalTrips}</p>
            <p className="text-xs text-muted-foreground">kyytiä tyypillisesti</p>
          </div>
        </div>

        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground uppercase flex items-center gap-1 mb-2">
            <MapPin className="w-3 h-3" /> Top alueet — klo {hourLabel} (sama viikonpäivä)
          </p>
          {loading ? (
            <p className="text-sm text-muted-foreground">Ladataan...</p>
          ) : nowPattern.areas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ei dataa tälle ajalle</p>
          ) : (
            <ol className="space-y-1.5">
              {nowPattern.areas.map((a, i) => (
                <li key={a.area} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`w-5 h-5 rounded-full text-xs font-black flex items-center justify-center shrink-0 ${
                      i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}>{i + 1}</span>
                    <span className={`truncate ${i === 0 ? "text-base font-black text-primary" : "text-sm font-bold text-foreground"}`}>
                      {a.area}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {a.trips}× · {a.avgFare.toFixed(0)}€
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground uppercase flex items-center gap-1 mb-2">
            <TrendingUp className="w-3 h-3" /> Ennuste — klo {nextLabel}
          </p>
          {loading ? (
            <p className="text-sm text-muted-foreground">Ladataan...</p>
          ) : nextPattern.areas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ei dataa</p>
          ) : (
            <div className="flex gap-1.5 flex-wrap">
              {nextPattern.areas.map((a, i) => (
                <span
                  key={a.area}
                  className={`px-2 py-1 rounded text-xs font-bold border ${
                    i === 0
                      ? "bg-primary/10 text-primary border-primary"
                      : "bg-card text-foreground border-border"
                  }`}
                >
                  {a.area} <span className="opacity-70">({a.trips})</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default TripHistoryCard;
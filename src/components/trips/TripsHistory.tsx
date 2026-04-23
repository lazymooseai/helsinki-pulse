import { useEffect, useMemo, useState } from "react";
import { Search, Download, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  queryTrips,
  computeStats,
  tripsToCsv,
  downloadCsv,
  DAY_LABELS_FI,
  type TaxiTripStored,
  type TripFilters,
} from "@/lib/trips";

const TripsHistory = () => {
  const [search, setSearch] = useState("");
  const [hourRange, setHourRange] = useState<[number, number]>([0, 23]);
  const [days, setDays] = useState<number[]>([]);
  const [fareMin, setFareMin] = useState("");
  const [fareMax, setFareMax] = useState("");
  const [trips, setTrips] = useState<TaxiTripStored[]>([]);
  const [loading, setLoading] = useState(false);

  const stats = useMemo(() => computeStats(trips), [trips]);

  const runSearch = async () => {
    setLoading(true);
    const filters: TripFilters = {
      search: search.trim() || undefined,
      hourMin: hourRange[0],
      hourMax: hourRange[1],
      daysOfWeek: days.length > 0 ? days : undefined,
      fareMin: fareMin ? parseFloat(fareMin) : undefined,
      fareMax: fareMax ? parseFloat(fareMax) : undefined,
      limit: 500,
    };
    const data = await queryTrips(filters);
    setTrips(data);
    setLoading(false);
  };

  useEffect(() => { runSearch(); /* alkulataus */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleDay = (d: number) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  const onExport = () => {
    if (trips.length === 0) return;
    downloadCsv(`kyydit-${new Date().toISOString().slice(0, 10)}.csv`, tripsToCsv(trips));
  };

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <div>
          <Label htmlFor="trip-search">Haku (lähtö- tai kohdeosoite)</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="trip-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="esim. Kallio, Lentoasema..."
              className="pl-9"
              maxLength={100}
            />
          </div>
        </div>

        <div>
          <Label>Kellonaika: {hourRange[0]}:00 – {hourRange[1]}:59</Label>
          <Slider
            min={0} max={23} step={1}
            value={hourRange}
            onValueChange={(v) => setHourRange([v[0], v[1]] as [number, number])}
            className="mt-3"
          />
        </div>

        <div>
          <Label>Viikonpäivät</Label>
          <div className="flex gap-2 mt-2 flex-wrap">
            {DAY_LABELS_FI.map((label, idx) => {
              const dow = idx + 1;
              const active = days.includes(dow);
              return (
                <button
                  key={dow}
                  type="button"
                  onClick={() => toggleDay(dow)}
                  className={`px-3 py-1.5 rounded-md text-sm font-semibold border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-foreground border-border hover:bg-accent/10"
                  }`}
                >{label}</button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="fareMin">Min hinta (€)</Label>
            <Input id="fareMin" inputMode="decimal" value={fareMin} onChange={(e) => setFareMin(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="fareMax">Max hinta (€)</Label>
            <Input id="fareMax" inputMode="decimal" value={fareMax} onChange={(e) => setFareMax(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={runSearch} disabled={loading} className="flex-1">
            {loading ? "Haetaan..." : "Hae"}
          </Button>
          <Button onClick={onExport} variant="outline" disabled={trips.length === 0}>
            <Download className="w-4 h-4" />
            CSV
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-xs text-muted-foreground uppercase">Kyytejä</p>
            <p className="text-2xl font-black text-foreground">{stats.count}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase">Avg €</p>
            <p className="text-2xl font-black text-foreground">{stats.avgFare.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase">Avg km</p>
            <p className="text-2xl font-black text-foreground">{stats.avgDistance.toFixed(1)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase">Top lähtö</p>
            <p className="text-sm font-bold text-foreground truncate" title={stats.topStartArea ?? ""}>
              {stats.topStartArea ?? "—"}
            </p>
            {stats.topStartAreaCount > 0 && (
              <p className="text-xs text-muted-foreground">×{stats.topStartAreaCount}</p>
            )}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {trips.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>Ei tuloksia hakuehdoilla</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aika</TableHead>
                <TableHead>Lähtö</TableHead>
                <TableHead>Kohde</TableHead>
                <TableHead className="text-right">€</TableHead>
                <TableHead className="text-right">km</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trips.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {new Date(t.start_time).toLocaleString("fi-FI", { dateStyle: "short", timeStyle: "short" })}
                  </TableCell>
                  <TableCell className="text-xs max-w-[140px] truncate">{t.start_address ?? "—"}</TableCell>
                  <TableCell className="text-xs max-w-[140px] truncate">{t.end_address ?? "—"}</TableCell>
                  <TableCell className="text-xs text-right font-bold">{t.fare_eur?.toFixed(2) ?? "—"}</TableCell>
                  <TableCell className="text-xs text-right">{t.distance_km?.toFixed(1) ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
};

export default TripsHistory;
/**
 * DispatchLiveCard.tsx
 *
 * Sijaintitietoinen tolppa-dashboard: näyttää kysyntä/tarjonta-luvut
 * 4 näkökulmasta:
 *   1. LÄHIMMÄT — top 5 lähintä tolppaa autosta + etäisyys (km)
 *   2. VYÖHYKE — yhteenveto per alue + paras tolppa per vyöhyke
 *   3. SUOSITUS — yksi "mene tänne nyt" pisteytyksellä (K-T diff vs etäisyys)
 *   4. HEATMAP — tunti × tolppa -aggregaatti viim. 14 päivän skannauksista
 *
 * Tilaa realtime-päivitykset dispatch_scans-tauluun.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  MapPin,
  Navigation,
  Target,
  Flame,
  Crosshair,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  getLatestPerTolppa,
  listScansSince,
  type DispatchScan,
} from "@/lib/dispatchScans";
import {
  TOLPAT,
  ALL_ZONES,
  findTolppa,
  distanceKm,
  type TolppaLocation,
  type Zone,
} from "@/lib/tolppaLocations";
import { useGeolocation } from "@/hooks/useGeolocation";
import { listUpcomingBookings, type PreBooking } from "@/lib/prebookings";

// ---------- apurit ----------

const formatAge = (iso: string) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "juuri nyt";
  if (mins < 60) return `${mins} min sitten`;
  const h = Math.floor(mins / 60);
  return `${h} h sitten`;
};

type DemandSig = { color: string; bg: string; icon: typeof TrendingUp; label: string };
const demandSignal = (k: number | null, t: number | null): DemandSig => {
  if (k === null || t === null) return { color: "text-muted-foreground", bg: "bg-slate-700", icon: Minus, label: "—" };
  const diff = k - t;
  if (diff >= 3) return { color: "text-green-400", bg: "bg-green-500/20", icon: TrendingUp, label: "KYSYNTA" };
  if (diff <= -3) return { color: "text-red-400", bg: "bg-red-500/20", icon: TrendingDown, label: "YLITARJONTA" };
  return { color: "text-amber-400", bg: "bg-amber-500/20", icon: Minus, label: "TASAPAINO" };
};

/** Pisteytys suositukselle: K-T diff painotettuna etäisyydellä (km). */
function recommendationScore(scan: DispatchScan, distKm: number | null): number {
  const k = scan.k_now ?? 0;
  const t = scan.t_now ?? 0;
  const diff = k - t;
  // 30 min ennuste mukaan kevyellä painolla
  const futureDiff = (scan.k_30 ?? 0) - (scan.t_30 ?? 0);
  const demand = diff * 1.5 + futureDiff * 0.5;
  if (distKm === null) return demand;
  // Vähennä pisteitä etäisyydeltä: -1.0 / km
  return demand - distKm;
}

interface ScanWithLocation {
  scan: DispatchScan;
  location?: TolppaLocation;
  distanceKm: number | null;
}

// ---------- pää-komponentti ----------

const DispatchLiveCard = () => {
  const [latest, setLatest] = useState<DispatchScan[]>([]);
  const [history, setHistory] = useState<DispatchScan[]>([]);
  const [upcomingBookings, setUpcomingBookings] = useState<PreBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const geo = useGeolocation();

  const refresh = async () => {
    const [latestMap, hist, ub] = await Promise.all([
      getLatestPerTolppa(24 * 60), // 24h ikkuna
      listScansSince(14),
      listUpcomingBookings(0),
    ]);
    setLatest(
      Array.from(latestMap.values()).sort(
        (a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime(),
      ),
    );
    setHistory(hist);
    setUpcomingBookings(ub);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const ch = supabase
      .channel("dispatch-scans-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dispatch_scans" },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pre_bookings" },
        () => refresh(),
      )
      .subscribe();
    const interval = setInterval(refresh, 60_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(interval);
    };
  }, []);

  // Liitä koordinaatit + etäisyys jokaiseen skannaukseen
  const enriched: ScanWithLocation[] = useMemo(() => {
    return latest.map((scan) => {
      const loc = findTolppa(scan.tolppa);
      const dist =
        loc && geo.lat !== null && geo.lon !== null
          ? distanceKm(geo.lat, geo.lon, loc.lat, loc.lon)
          : null;
      return { scan, location: loc, distanceKm: dist };
    });
  }, [latest, geo.lat, geo.lon]);

  if (loading) {
    return (
      <div className="px-4 py-3">
        <Card className="p-5 bg-slate-900 border-slate-700">
          <p className="text-sm text-muted-foreground">Ladataan tolppadataa...</p>
        </Card>
      </div>
    );
  }

  if (latest.length === 0) {
    return (
      <div className="px-4 py-3">
        <Card className="p-5 bg-slate-900 border-slate-700">
          <div className="flex items-center gap-3 mb-2">
            <Camera className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Kysynta tolpilla
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Ei viimeaikaisia skannauksia. Skannaa valityslaite tai lataa HTML/PDF/TXT alanapista.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <Card className="p-4 bg-slate-900 border-slate-700">
        <Header geo={geo} count={latest.length} />

        <Tabs defaultValue="nearest" className="mt-3">
          <TabsList className="grid w-full grid-cols-4 bg-slate-800">
            <TabsTrigger value="nearest" className="text-xs">
              <Navigation className="h-3 w-3 mr-1" /> Lähimmät
            </TabsTrigger>
            <TabsTrigger value="zones" className="text-xs">
              <MapPin className="h-3 w-3 mr-1" /> Vyöhyke
            </TabsTrigger>
            <TabsTrigger value="recommend" className="text-xs">
              <Target className="h-3 w-3 mr-1" /> Suositus
            </TabsTrigger>
            <TabsTrigger value="heatmap" className="text-xs">
              <Flame className="h-3 w-3 mr-1" /> Heatmap
            </TabsTrigger>
          </TabsList>

          <TabsContent value="nearest" className="mt-3">
            <NearestView enriched={enriched} hasLocation={geo.lat !== null} />
          </TabsContent>
          <TabsContent value="zones" className="mt-3">
            <ZonesView enriched={enriched} />
          </TabsContent>
          <TabsContent value="recommend" className="mt-3">
            <RecommendView
              enriched={enriched}
              hasLocation={geo.lat !== null}
              upcomingBookings={upcomingBookings}
              myLat={geo.lat}
              myLon={geo.lon}
            />
          </TabsContent>
          <TabsContent value="heatmap" className="mt-3">
            <HeatmapView history={history} />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
};

// ---------- header (sijainti-banneri) ----------

const Header = ({
  geo,
  count,
}: {
  geo: ReturnType<typeof useGeolocation>;
  count: number;
}) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Camera className="h-5 w-5 text-primary" />
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Kysynta tolpilla
        </h3>
      </div>
      <Badge variant="outline" className="text-xs border-green-600 text-green-400">
        {count} tolppaa
      </Badge>
    </div>

    <div className="flex items-center gap-2 p-2 rounded-md bg-slate-800 border border-slate-700">
      <Crosshair
        className={`h-4 w-4 shrink-0 ${
          geo.source === "gps"
            ? "text-green-400"
            : geo.source === "manual"
              ? "text-amber-400"
              : "text-muted-foreground"
        }`}
      />
      <div className="flex-1 min-w-0 text-xs">
        {geo.source === "gps" && (
          <span className="text-foreground">
            GPS: {geo.lat?.toFixed(4)}, {geo.lon?.toFixed(4)}
            {geo.accuracyMeters && (
              <span className="text-muted-foreground"> (±{Math.round(geo.accuracyMeters)} m)</span>
            )}
          </span>
        )}
        {geo.source === "manual" && (
          <span className="text-foreground">Sijainti: {geo.zone} (manuaalinen)</span>
        )}
        {geo.source === "none" && (
          <span className="text-muted-foreground">
            {geo.error ?? "Sijaintia ei ole asetettu"}
          </span>
        )}
      </div>
      <Select
        value={geo.zone ?? ""}
        onValueChange={(v) => geo.setManualZone(v as Zone)}
      >
        <SelectTrigger className="h-7 w-32 text-xs bg-slate-900 border-slate-700">
          <SelectValue placeholder="Valitse alue" />
        </SelectTrigger>
        <SelectContent>
          {ALL_ZONES.map((z) => (
            <SelectItem key={z} value={z} className="text-xs">
              {z}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={geo.requestGps}
        disabled={geo.loading}
        title="Hae GPS uudelleen"
      >
        <RefreshCw className={`h-3 w-3 ${geo.loading ? "animate-spin" : ""}`} />
      </Button>
    </div>
  </div>
);

// ---------- näkymä 1: lähimmät 5 ----------

const NearestView = ({
  enriched,
  hasLocation,
}: {
  enriched: ScanWithLocation[];
  hasLocation: boolean;
}) => {
  const sorted = useMemo(() => {
    if (!hasLocation) {
      return enriched.slice(0, 6);
    }
    return [...enriched]
      .filter((e) => e.distanceKm !== null)
      .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
      .slice(0, 6);
  }, [enriched, hasLocation]);

  if (!hasLocation) {
    return (
      <p className="text-xs text-muted-foreground p-3 text-center">
        Aseta sijainti yllä nahdaksesi lahimmat tolpat. Naytetaan uusimmat skannaukset.
      </p>
    );
  }

  if (sorted.length === 0) {
    return (
      <p className="text-xs text-muted-foreground p-3 text-center">
        Yhtaan tunnistettua tolppaa lahistolla. Tarkista tolpan nimi skannauksessa.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {sorted.map((e) => (
        <ScanRow key={e.scan.id} item={e} showDistance />
      ))}
    </div>
  );
};

// ---------- näkymä 2: vyöhykkeet ----------

const ZonesView = ({ enriched }: { enriched: ScanWithLocation[] }) => {
  const byZone = useMemo(() => {
    const map = new Map<Zone, ScanWithLocation[]>();
    for (const e of enriched) {
      if (!e.location) continue;
      const arr = map.get(e.location.zone) ?? [];
      arr.push(e);
      map.set(e.location.zone, arr);
    }
    return map;
  }, [enriched]);

  if (byZone.size === 0) {
    return (
      <p className="text-xs text-muted-foreground p-3 text-center">
        Yhtaan tolppaa ei voitu liittaa vyöhykkeeseen. Tarkista nimet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {ALL_ZONES.filter((z) => byZone.has(z)).map((zone) => {
        const items = byZone.get(zone)!;
        const totalK = items.reduce((s, e) => s + (e.scan.k_now ?? 0), 0);
        const totalT = items.reduce((s, e) => s + (e.scan.t_now ?? 0), 0);
        const sig = demandSignal(totalK, totalT);
        const Icon = sig.icon;
        const best = [...items].sort(
          (a, b) => (b.scan.k_now ?? 0) - (b.scan.t_now ?? 0) - ((a.scan.k_now ?? 0) - (a.scan.t_now ?? 0)),
        )[0];
        return (
          <div key={zone} className="p-3 rounded-lg bg-slate-800 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-foreground">{zone}</span>
                <Badge variant="outline" className="text-[10px] border-slate-600">
                  {items.length} tolppaa
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                <Icon className={`h-4 w-4 ${sig.color}`} />
                <span className={`text-xs font-bold ${sig.color}`}>{sig.label}</span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">
                Yht: K+ <span className="text-green-400 font-bold">{totalK}</span> / T+{" "}
                <span className="text-red-400 font-bold">{totalT}</span>
              </span>
              <span className="text-muted-foreground">|</span>
              <span className="text-foreground">
                Paras: <span className="font-bold">{best.scan.tolppa}</span>{" "}
                <span className="text-green-400">
                  ({best.scan.k_now ?? "—"}/{best.scan.t_now ?? "—"})
                </span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------- näkymä 3: suositus ----------

const RecommendView = ({
  enriched,
  hasLocation,
  upcomingBookings,
  myLat,
  myLon,
}: {
  enriched: ScanWithLocation[];
  hasLocation: boolean;
  upcomingBookings: PreBooking[];
  myLat: number | null;
  myLon: number | null;
}) => {
  const ranked = useMemo(() => {
    return [...enriched]
      .filter((e) => e.scan.k_now !== null && e.scan.t_now !== null)
      .map((e) => ({ ...e, score: recommendationScore(e.scan, e.distanceKm) }))
      .sort((a, b) => b.score - a.score);
  }, [enriched]);

  // Lasketaan: ennakot 60 min sisaan & ≤ 5 km autosta tai ilman sijaintia kaikki
  const nearbyBookings = useMemo(() => {
    const cutoff = Date.now() + 60 * 60_000;
    return upcomingBookings
      .filter((b) => new Date(b.pickup_at).getTime() <= cutoff)
      .map((b) => {
        const loc = findTolppa(b.tolppa);
        const dist =
          loc && myLat !== null && myLon !== null
            ? distanceKm(myLat, myLon, loc.lat, loc.lon)
            : null;
        return { booking: b, location: loc, distanceKm: dist };
      })
      .filter((b) => b.distanceKm === null || b.distanceKm <= 5)
      .sort((a, b) => new Date(a.booking.pickup_at).getTime() - new Date(b.booking.pickup_at).getTime())
      .slice(0, 5);
  }, [upcomingBookings, myLat, myLon]);

  if (ranked.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground p-3 text-center">
          Ei riittavaa dataa suositusta varten.
        </p>
        {nearbyBookings.length > 0 && <BookingAlert items={nearbyBookings} />}
      </div>
    );
  }

  const top = ranked[0];
  const sig = demandSignal(top.scan.k_now, top.scan.t_now);

  return (
    <div className="space-y-3">
      {nearbyBookings.length > 0 && <BookingAlert items={nearbyBookings} />}

      <div className={`p-4 rounded-lg ${sig.bg} border-2 ${sig.color.replace("text-", "border-")}`}>
        <div className="flex items-center gap-2 mb-2">
          <Target className={`h-5 w-5 ${sig.color}`} />
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Mene tanne nyt
          </span>
        </div>
        <div className="text-3xl font-black text-foreground mb-1">{top.scan.tolppa}</div>
        <div className="flex items-center gap-4 mb-2">
          <span className="text-xl font-black text-green-400">K+ {top.scan.k_now}</span>
          <span className="text-xl font-black text-red-400">T+ {top.scan.t_now}</span>
          <span className={`text-lg font-bold ${sig.color}`}>
            diff {(top.scan.k_now ?? 0) - (top.scan.t_now ?? 0) >= 0 ? "+" : ""}
            {(top.scan.k_now ?? 0) - (top.scan.t_now ?? 0)}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {top.distanceKm !== null && (
            <span className="flex items-center gap-1">
              <Navigation className="h-3 w-3" /> {top.distanceKm.toFixed(1)} km
            </span>
          )}
          {top.location && <span>{top.location.zone}</span>}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {formatAge(top.scan.scanned_at)}
          </span>
        </div>
        {!hasLocation && (
          <p className="text-[10px] text-muted-foreground mt-2 italic">
            Ilman sijaintia suositus perustuu vain K-T eroon.
          </p>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1">
          Vaihtoehdot
        </div>
        {ranked.slice(1, 5).map((r) => (
          <ScanRow key={r.scan.id} item={r} showDistance compact />
        ))}
      </div>
    </div>
  );
};

// ---------- ennakkotilaus-halytys ----------

interface NearbyBooking {
  booking: PreBooking;
  location?: TolppaLocation;
  distanceKm: number | null;
}

const BookingAlert = ({ items }: { items: NearbyBooking[] }) => {
  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const min = Math.round((d.getTime() - Date.now()) / 60_000);
    if (min <= 0) return "nyt";
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)}h ${min % 60}min`;
  };
  return (
    <div className="p-3 rounded-lg bg-amber-500/10 border-2 border-amber-500/40">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="h-4 w-4 text-amber-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
          {items.length} ennakko{items.length === 1 ? "" : "a"} l\u00e4hist\u00f6ll\u00e4 60 min
        </span>
      </div>
      <div className="space-y-1">
        {items.map((nb) => (
          <div key={nb.booking.id} className="flex items-center justify-between text-xs">
            <span className="font-bold text-foreground truncate">{nb.booking.tolppa}</span>
            <div className="flex items-center gap-2 shrink-0">
              {nb.distanceKm !== null && (
                <span className="text-muted-foreground">{nb.distanceKm.toFixed(1)} km</span>
              )}
              <span className="font-bold text-amber-400">{formatTime(nb.booking.pickup_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------- näkymä 4: heatmap (tunti × tolppa) ----------

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const HeatmapView = ({ history }: { history: DispatchScan[] }) => {
  const [selectedZone, setSelectedZone] = useState<Zone | "all">("all");

  // Aggregoi: tolppa → tunti → keskimääräinen K-T diff
  const grid = useMemo(() => {
    const acc = new Map<string, Map<number, { sum: number; count: number }>>();
    for (const s of history) {
      if (s.k_now === null || s.t_now === null) continue;
      const loc = findTolppa(s.tolppa);
      if (selectedZone !== "all" && loc?.zone !== selectedZone) continue;
      const hour = new Date(s.scanned_at).getHours();
      const diff = s.k_now - s.t_now;
      if (!acc.has(s.tolppa)) acc.set(s.tolppa, new Map());
      const hmap = acc.get(s.tolppa)!;
      const cur = hmap.get(hour) ?? { sum: 0, count: 0 };
      hmap.set(hour, { sum: cur.sum + diff, count: cur.count + 1 });
    }
    return acc;
  }, [history, selectedZone]);

  const tolpat = useMemo(
    () =>
      Array.from(grid.keys()).sort((a, b) => {
        // Lajittele kuumimman tunnin diff:n mukaan
        const max = (name: string) => {
          const hmap = grid.get(name);
          if (!hmap) return 0;
          let m = -Infinity;
          for (const v of hmap.values()) m = Math.max(m, v.sum / v.count);
          return m;
        };
        return max(b) - max(a);
      }),
    [grid],
  );

  if (history.length === 0) {
    return (
      <p className="text-xs text-muted-foreground p-3 text-center">
        Ei historiadataa. Lataa lisää HTML/PDF/TXT-tiedostoja eri ajankohdista.
      </p>
    );
  }

  const cellColor = (avgDiff: number | null) => {
    if (avgDiff === null) return "bg-slate-800";
    if (avgDiff >= 5) return "bg-green-500";
    if (avgDiff >= 2) return "bg-green-500/60";
    if (avgDiff >= 0) return "bg-amber-500/40";
    if (avgDiff >= -3) return "bg-red-500/40";
    return "bg-red-500/80";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Vyöhyke:</span>
        <Select value={selectedZone} onValueChange={(v) => setSelectedZone(v as Zone | "all")}>
          <SelectTrigger className="h-7 flex-1 text-xs bg-slate-800 border-slate-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Kaikki vyöhykkeet</SelectItem>
            {ALL_ZONES.map((z) => (
              <SelectItem key={z} value={z} className="text-xs">{z}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-[10px] border-slate-600">
          {history.length} näytettä
        </Badge>
      </div>

      {tolpat.length === 0 ? (
        <p className="text-xs text-muted-foreground p-3 text-center">
          Ei dataa tälle vyöhykkeelle.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            {/* Header: tunnit */}
            <div className="flex items-center gap-px mb-1 sticky top-0">
              <div className="w-28 shrink-0 text-[10px] text-muted-foreground">Tolppa \\ tunti</div>
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="flex-1 text-[9px] text-center text-muted-foreground"
                  style={{ minWidth: 18 }}
                >
                  {h % 3 === 0 ? h : ""}
                </div>
              ))}
            </div>
            {tolpat.slice(0, 12).map((name) => {
              const hmap = grid.get(name)!;
              return (
                <div key={name} className="flex items-center gap-px mb-px">
                  <div className="w-28 shrink-0 text-[10px] text-foreground truncate pr-1" title={name}>
                    {name}
                  </div>
                  {HOURS.map((h) => {
                    const cell = hmap.get(h);
                    const avg = cell ? cell.sum / cell.count : null;
                    return (
                      <div
                        key={h}
                        className={`flex-1 h-5 ${cellColor(avg)} border border-slate-900`}
                        style={{ minWidth: 18 }}
                        title={
                          avg === null
                            ? `${name} klo ${h}: ei dataa`
                            : `${name} klo ${h}: ka K-T = ${avg.toFixed(1)} (${cell!.count} näyt.)`
                        }
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legenda */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>Ylitarjonta</span>
        <div className="flex">
          <div className="w-4 h-3 bg-red-500/80" />
          <div className="w-4 h-3 bg-red-500/40" />
          <div className="w-4 h-3 bg-amber-500/40" />
          <div className="w-4 h-3 bg-green-500/60" />
          <div className="w-4 h-3 bg-green-500" />
        </div>
        <span>Kysyntä</span>
      </div>
    </div>
  );
};

// ---------- jaettu rivi ----------

const ScanRow = ({
  item,
  showDistance,
  compact,
}: {
  item: ScanWithLocation;
  showDistance?: boolean;
  compact?: boolean;
}) => {
  const sig = demandSignal(item.scan.k_now, item.scan.t_now);
  const Icon = sig.icon;
  return (
    <div
      className={`flex items-center justify-between rounded-lg bg-slate-800 border border-slate-700 ${
        compact ? "p-2" : "p-3"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className={`font-black text-foreground truncate ${compact ? "text-sm" : "text-base"}`}
          >
            {item.scan.tolppa}
          </span>
          <Icon className={`h-4 w-4 ${sig.color}`} />
          {item.location && (
            <Badge variant="outline" className="text-[10px] border-slate-600 px-1 py-0">
              {item.location.zone}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {showDistance && item.distanceKm !== null && (
            <span className="flex items-center gap-1 text-amber-400">
              <Navigation className="h-3 w-3" /> {item.distanceKm.toFixed(1)} km
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {formatAge(item.scan.scanned_at)}
          </span>
          {item.scan.k_30 !== null && item.scan.t_30 !== null && (
            <span>
              30min: {item.scan.k_30}/{item.scan.t_30}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-center">
          <div className="text-[10px] text-muted-foreground">K+</div>
          <div className={`font-black text-green-400 leading-none ${compact ? "text-lg" : "text-2xl"}`}>
            {item.scan.k_now ?? "—"}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-muted-foreground">T+</div>
          <div className={`font-black text-red-400 leading-none ${compact ? "text-lg" : "text-2xl"}`}>
            {item.scan.t_now ?? "—"}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DispatchLiveCard;
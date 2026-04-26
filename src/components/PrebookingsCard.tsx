/**
 * PrebookingsCard.tsx
 *
 * Naytttaa ennakkotilaukset kahdesta nakokulmasta:
 *  - LISTA: aikaj. tulevat ennakot, lahimmat ensin (countdown + vyohyke)
 *  - HEATMAP: tunti × paiva-aggregaatti viim. 30 paivan ennakoista
 *    (suodatus vyohykkeen mukaan)
 *
 * Tilaa realtime-paivitykset pre_bookings-tauluun.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Clock,
  MapPin,
  Flame,
  List,
  Trash2,
  Plus,
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
  deleteBooking,
  listBookingsHistory,
  listUpcomingBookings,
  type PreBooking,
} from "@/lib/prebookings";
import { ALL_ZONES, findTolppa, type Zone } from "@/lib/tolppaLocations";
import PrebookingScanner from "./PrebookingScanner";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_LABELS = ["Ma", "Ti", "Ke", "To", "Pe", "La", "Su"];

/** "klo HH:MM" tai "huomenna HH:MM" */
const formatPickup = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();
  const time = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  if (sameDay) return `klo ${time}`;
  if (isTomorrow) return `huom ${time}`;
  return `${d.getDate()}.${d.getMonth() + 1}. ${time}`;
};

/** "30 min" / "2 h 15 min" / "menossa nyt" / "myohassa 5 min" */
const formatCountdown = (iso: string) => {
  const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (diffMin <= -1) return { label: `myohassa ${-diffMin} min`, urgent: true };
  if (diffMin <= 5) return { label: "menossa nyt", urgent: true };
  if (diffMin < 60) return { label: `${diffMin} min`, urgent: diffMin <= 15 };
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return { label: m ? `${h} h ${m} min` : `${h} h`, urgent: false };
};

const PrebookingsCard = () => {
  const [upcoming, setUpcoming] = useState<PreBooking[]>([]);
  const [history, setHistory] = useState<PreBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);

  const refresh = async () => {
    const [u, h] = await Promise.all([
      listUpcomingBookings(15),
      listBookingsHistory(30),
    ]);
    setUpcoming(u);
    setHistory(h);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const ch = supabase
      .channel("pre-bookings-live")
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

  return (
    <div className="px-4 py-3">
      <Card className="p-4 bg-slate-900 border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Ennakkotilaukset
            </h3>
            <Badge variant="outline" className="text-xs border-amber-600 text-amber-400">
              {upcoming.length} tulossa
            </Badge>
          </div>
          <Button
            onClick={() => setScannerOpen(true)}
            size="sm"
            className="h-8 bg-primary text-primary-foreground"
          >
            <Plus className="h-3 w-3 mr-1" /> Lisaa
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground py-2">Ladataan ennakkoja...</p>
        ) : upcoming.length === 0 && history.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Ei ennakkotilauksia. Lisaa kuvalla, PDF:lla tai tekstilla.
          </p>
        ) : (
          <Tabs defaultValue="list">
            <TabsList className="grid w-full grid-cols-2 bg-slate-800">
              <TabsTrigger value="list" className="text-xs">
                <List className="h-3 w-3 mr-1" /> Lista
              </TabsTrigger>
              <TabsTrigger value="heatmap" className="text-xs">
                <Flame className="h-3 w-3 mr-1" /> Heatmap (30pv)
              </TabsTrigger>
            </TabsList>

            <TabsContent value="list" className="mt-3">
              <UpcomingList items={upcoming} onDelete={refresh} />
            </TabsContent>
            <TabsContent value="heatmap" className="mt-3">
              <BookingsHeatmap history={history} />
            </TabsContent>
          </Tabs>
        )}
      </Card>

      <PrebookingScanner open={scannerOpen} onOpenChange={setScannerOpen} onSaved={refresh} />
    </div>
  );
};

// ---------- Lista ----------

const UpcomingList = ({
  items,
  onDelete,
}: {
  items: PreBooking[];
  onDelete: () => void;
}) => {
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground p-3 text-center">
        Ei tulevia ennakkotilauksia.
      </p>
    );
  }

  // Ryhmittele: nyt/15 min, tunti, tana paivana, myohemmin
  return (
    <div className="space-y-1.5">
      {items.slice(0, 30).map((b) => {
        const cd = formatCountdown(b.pickup_at);
        const loc = findTolppa(b.tolppa);
        return (
          <div
            key={b.id}
            className={`flex items-center justify-between p-3 rounded-lg border ${
              cd.urgent
                ? "bg-amber-500/10 border-amber-500/40"
                : "bg-slate-800 border-slate-700"
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-black text-foreground truncate">{b.tolppa}</span>
                {loc && (
                  <Badge variant="outline" className="text-[10px] border-slate-600 px-1 py-0">
                    {loc.zone}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {formatPickup(b.pickup_at)}
                </span>
                <span className="text-[10px]">{b.source}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`font-bold text-sm ${
                  cd.urgent ? "text-amber-400" : "text-foreground"
                }`}
              >
                {cd.label}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-red-400/70"
                onClick={async () => {
                  if (await deleteBooking(b.id)) onDelete();
                }}
                title="Poista"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------- Heatmap (paiva × tunti) ----------

const BookingsHeatmap = ({ history }: { history: PreBooking[] }) => {
  const [selectedZone, setSelectedZone] = useState<Zone | "all">("all");

  // Aggregoi: viikonpaiva (0=ma..6=su) × tunti → count
  const grid = useMemo(() => {
    const m = new Map<string, number>();
    let max = 0;
    for (const b of history) {
      const loc = findTolppa(b.tolppa);
      if (selectedZone !== "all" && loc?.zone !== selectedZone) continue;
      const d = new Date(b.pickup_at);
      const dow = (d.getDay() + 6) % 7; // ma=0..su=6
      const hour = d.getHours();
      const key = `${dow}-${hour}`;
      const v = (m.get(key) ?? 0) + 1;
      m.set(key, v);
      if (v > max) max = v;
    }
    return { m, max };
  }, [history, selectedZone]);

  if (history.length === 0) {
    return (
      <p className="text-xs text-muted-foreground p-3 text-center">
        Ei historiadataa. Tallenna ennakkoja jotta heatmap kerää dataa.
      </p>
    );
  }

  const cellColor = (count: number, max: number) => {
    if (count === 0) return "bg-slate-800";
    const ratio = max > 0 ? count / max : 0;
    if (ratio >= 0.8) return "bg-amber-400";
    if (ratio >= 0.5) return "bg-amber-500/70";
    if (ratio >= 0.25) return "bg-amber-500/40";
    return "bg-amber-500/20";
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

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="flex items-center gap-px mb-1">
            <div className="w-10 shrink-0 text-[10px] text-muted-foreground">Pv \\ tunti</div>
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
          {DAY_LABELS.map((day, dow) => (
            <div key={day} className="flex items-center gap-px mb-px">
              <div className="w-10 shrink-0 text-[10px] text-foreground pr-1">{day}</div>
              {HOURS.map((h) => {
                const count = grid.m.get(`${dow}-${h}`) ?? 0;
                return (
                  <div
                    key={h}
                    className={`flex-1 h-5 ${cellColor(count, grid.max)} border border-slate-900 flex items-center justify-center`}
                    style={{ minWidth: 18 }}
                    title={`${day} klo ${h}: ${count} ennakkoa`}
                  >
                    {count > 0 && grid.max <= 9 && (
                      <span className="text-[8px] font-bold text-slate-900">{count}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <MapPin className="h-3 w-3" />
        <span>Vahan</span>
        <div className="flex">
          <div className="w-4 h-3 bg-amber-500/20" />
          <div className="w-4 h-3 bg-amber-500/40" />
          <div className="w-4 h-3 bg-amber-500/70" />
          <div className="w-4 h-3 bg-amber-400" />
        </div>
        <span>Paljon ennakkoja</span>
      </div>
    </div>
  );
};

export default PrebookingsCard;
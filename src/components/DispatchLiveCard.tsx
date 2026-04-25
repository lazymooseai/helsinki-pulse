/**
 * DispatchLiveCard.tsx
 *
 * Nayttaa viimeisimmat valityslaite-skannaukset tolppakohtaisesti
 * dashboardilla. Paivittyy realtime-tilauksena.
 *
 * Visuaalinen logiikka:
 * - K+ > T+ -> vihrea (kysynta yli tarjonnan, mene sinne!)
 * - K+ ~ T+ -> harmaa (tasapaino)
 * - K+ < T+ -> punainen (liikaa autoja)
 */

import { useEffect, useState } from "react";
import { Camera, Clock, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { getLatestPerTolppa, type DispatchScan } from "@/lib/dispatchScans";

const formatAge = (iso: string) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "juuri nyt";
  if (mins < 60) return `${mins} min sitten`;
  const h = Math.floor(mins / 60);
  return `${h} h sitten`;
};

const demandSignal = (k: number | null, t: number | null): { color: string; icon: typeof TrendingUp; label: string } => {
  if (k === null || t === null) return { color: "text-muted-foreground", icon: Minus, label: "—" };
  const diff = k - t;
  if (diff >= 3) return { color: "text-green-400", icon: TrendingUp, label: "KYSYNTA" };
  if (diff <= -3) return { color: "text-red-400", icon: TrendingDown, label: "YLITARJONTA" };
  return { color: "text-amber-400", icon: Minus, label: "TASAPAINO" };
};

const DispatchLiveCard = () => {
  const [scans, setScans] = useState<DispatchScan[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const map = await getLatestPerTolppa(120);
    setScans(Array.from(map.values()).sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime()));
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const ch = supabase
      .channel("dispatch-scans-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "dispatch_scans" }, () => {
        refresh();
      })
      .subscribe();
    const interval = setInterval(refresh, 60_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="px-4 py-3">
        <Card className="p-5 bg-slate-900 border-slate-700">
          <p className="text-sm text-muted-foreground">Ladataan skannauksia...</p>
        </Card>
      </div>
    );
  }

  if (scans.length === 0) {
    return (
      <div className="px-4 py-3">
        <Card className="p-5 bg-slate-900 border-slate-700">
          <div className="flex items-center gap-3 mb-2">
            <Camera className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Kysynta tolpilla</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Ei viimeaikaisia skannauksia. Skannaa valityslaite alanapista nahdaksesi reaaliaikaiset luvut.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <Card className="p-4 bg-slate-900 border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">Kysynta tolpilla</h3>
          </div>
          <Badge variant="outline" className="text-xs border-green-600 text-green-400">
            {scans.length} aktiivista
          </Badge>
        </div>

        <div className="space-y-2">
          {scans.slice(0, 6).map((scan) => {
            const sig = demandSignal(scan.k_now, scan.t_now);
            const Icon = sig.icon;
            return (
              <div
                key={scan.id}
                className="flex items-center justify-between p-3 rounded-lg bg-slate-800 border border-slate-700"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base font-black text-foreground truncate">{scan.tolppa}</span>
                    <Icon className={`h-4 w-4 ${sig.color}`} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {formatAge(scan.scanned_at)}
                    </span>
                    {scan.k_30 !== null && scan.t_30 !== null && (
                      <span>
                        30min: {scan.k_30}/{scan.t_30}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground">K+</div>
                    <div className="text-2xl font-black text-green-400 leading-none">
                      {scan.k_now ?? "—"}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground">T+</div>
                    <div className="text-2xl font-black text-red-400 leading-none">
                      {scan.t_now ?? "—"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

export default DispatchLiveCard;
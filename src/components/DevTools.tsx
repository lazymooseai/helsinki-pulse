/**
 * DevTools.tsx
 *
 * Kehittajan debug-tyokalu — kelluva nappi oikeassa alakulmassa.
 * Nayttaa reaaliaikaisen tilan ja tarjoaa testaustyokalut.
 *
 * Sisaltaa:
 * - Paivitysnappi kaikelle datalle
 * - Laivan saapumisen simulointi (Tallink Megastar, 15min)
 * - Tilan nollaus
 * - Live debug-info: junat, laivat, saa, liukkausindeksi, halytykset
 */

import { useDashboard } from "@/context/DashboardContext";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Bug, Ship, RotateCcw, RefreshCw, Loader2, Thermometer } from "lucide-react";

const DevTools = () => {
  const {
    refreshAll,
    simulateShipArrival,
    resetState,
    state,
    alerts,
    isLoading,
    lastFetch,
  } = useDashboard();

  const jackpotCount = alerts.filter((a) => a.level === "jackpot").length;
  const highCount = alerts.filter((a) => a.level === "high").length;
  const delayedTrains = state.trainDelays.filter((t) => t.delayMinutes > 30).length;
  const slippery = state.weather.slipperyIndex ?? 0;
  const isSlipperyDangerous = slippery >= 0.6;

  const weatherLabel =
    state.weather.condition === "Rain"
      ? "Sade"
      : state.weather.condition === "Snow"
      ? "Lumi"
      : "Selkea";

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <button
          className="fixed bottom-6 right-4 z-50 h-10 w-10 rounded-full bg-secondary flex items-center justify-center border border-border active:scale-95 transition-transform"
          aria-label="DevTools"
        >
          <Bug className="h-4 w-4 text-muted-foreground" />
        </button>
      </DrawerTrigger>

      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-foreground">
            DevTools — Live-data
          </DrawerTitle>
          <DrawerDescription className="text-muted-foreground">
            Fintraffic + Open-Meteo + Averio + LinkedEvents
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-6 flex flex-col gap-3">
          {/* Paivitysnappi */}
          <button
            onClick={refreshAll}
            disabled={isLoading}
            className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-bold text-foreground active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
            ) : (
              <RefreshCw className="h-5 w-5 text-primary" />
            )}
            {isLoading ? "Haetaan..." : "Paivita kaikki tiedot"}
          </button>

          {/* Viimeisin paivitys */}
          {lastFetch && (
            <p className="text-xs text-muted-foreground px-1">
              Päivitetty: {lastFetch.toLocaleTimeString("fi-FI")} —{" "}
              {state.trainDelays.length} junaa,{" "}
              {state.shipArrivals.length} laivaa,{" "}
              {state.events.length} tapahtumaa
            </p>
          )}

          {/* Laivan simulointi */}
          <button
            onClick={simulateShipArrival}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold text-foreground active:scale-[0.98] transition-transform"
          >
            <Ship className="h-5 w-5 text-primary" />
            Simuloi laivan saapuminen (2800 hlo, 15min)
          </button>

          {/* Nollaa */}
          <button
            onClick={resetState}
            className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold text-muted-foreground active:scale-[0.98] transition-transform"
          >
            <RotateCcw className="h-5 w-5" />
            Nollaa & paivita
          </button>

          {/* Debug-info */}
          <div className="mt-1 rounded-lg bg-muted p-3 text-xs text-muted-foreground font-mono space-y-1.5">
            {/* Halytykset */}
            <p className="font-black text-foreground text-[11px] uppercase tracking-wider mb-1">
              Halytykset
            </p>
            <p>
              Jackpot:{" "}
              <span className={jackpotCount > 0 ? "text-destructive font-bold" : ""}>
                {jackpotCount}
              </span>{" "}
              | High:{" "}
              <span className={highCount > 0 ? "text-accent font-bold" : ""}>
                {highCount}
              </span>{" "}
              | Yhteensa: {alerts.length}
            </p>

            {/* Junat */}
            <p className="font-black text-foreground text-[11px] uppercase tracking-wider mt-2 mb-1">
              Junat
            </p>
            <p>
              Myohassa {">"}30min:{" "}
              <span className={delayedTrains > 0 ? "text-destructive font-bold" : ""}>
                {delayedTrains}
              </span>{" "}
              / {state.trainDelays.length}
            </p>

            {/* Saa */}
            <p className="font-black text-foreground text-[11px] uppercase tracking-wider mt-2 mb-1">
              Saa
            </p>
            <p>
              {state.weather.temp > 0 ? "+" : ""}{state.weather.temp}C{" "}
              {weatherLabel} | Tuuli: {Math.round(state.weather.windSpeed)} m/s
            </p>
            <p>
              Sade:{" "}
              {(state.weather.rain + state.weather.showers).toFixed(1)} mm |
              Lumi: {state.weather.snowfall.toFixed(1)} mm
            </p>
            <p>
              Sademodus:{" "}
              <span className={state.weather.rainModeActive ? "text-accent font-bold" : ""}>
                {state.weather.rainModeActive ? "AKTIIVINEN" : "pois"}
              </span>
            </p>

            {/* Liukkausindeksi */}
            <div className="flex items-center gap-2 mt-1">
              <Thermometer
                className={`h-3.5 w-3.5 ${isSlipperyDangerous ? "text-destructive" : "text-muted-foreground"}`}
              />
              <span>
                Liukkausindeksi:{" "}
                <span
                  className={
                    isSlipperyDangerous
                      ? "text-destructive font-bold"
                      : slippery >= 0.3
                      ? "text-accent font-bold"
                      : ""
                  }
                >
                  {slippery.toFixed(1)}
                </span>
                {isSlipperyDangerous && (
                  <span className="text-destructive font-bold ml-1">
                    — SAIRAALA-SIGNAALI
                  </span>
                )}
              </span>
            </div>

            {/* Jackpot-syyt */}
            {alerts.length > 0 && (
              <>
                <p className="font-black text-foreground text-[11px] uppercase tracking-wider mt-2 mb-1">
                  Aktiiviset halytykset
                </p>
                {alerts.slice(0, 3).map((a, i) => (
                  <p key={i} className={a.level === "jackpot" ? "text-destructive" : "text-accent"}>
                    [{a.level.toUpperCase()}] {a.zone}
                  </p>
                ))}
                {alerts.length > 3 && (
                  <p className="text-muted-foreground/60">
                    + {alerts.length - 3} muuta...
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default DevTools;

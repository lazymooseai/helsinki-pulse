/**
 * DashboardContext.tsx
 *
 * Globaali tilanhallinta Helsinki Taxi Pulse -sovellukselle.
 * Tarjoaa kaiken datan ja toiminnot kaikille komponenteille.
 *
 * Paivitykset:
 * - DEFAULT_STATE sisaltaa slipperyIndex: 0
 * - simulateShipArrival kayttaa oikeaa terminaalinimea
 * - Toast-viestit ilman emojeja (parempi yhteensopivuus)
 * - slipperyIndex-varoitus toast-viestissa
 */

import {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { DashboardState, JackpotAlert } from "@/lib/types";
import { calculateOpportunityScore } from "@/lib/scoring";
import { fetchLiveTrains, type TrainStation } from "@/lib/fintraffic";
import { fetchLiveWeather } from "@/lib/weather";
import { fetchHarborPaxEstimates, averioShipsToArrivals } from "@/lib/harbors";
import { fetchEventsBundle } from "@/lib/events";
import { fetchFlightArrivals } from "@/lib/flights";
import { fetchSportsEvents } from "@/lib/sports";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Oletustila — kaikki kentat maaritelty, ei TypeScript-virheita
// ---------------------------------------------------------------------------

const DEFAULT_STATE: DashboardState = {
  trainDelays: [],
  shipArrivals: [],
  events: [],
  flights: [],
  sportsEvents: [],
  weather: {
    condition: "Clear",
    temp: 0,
    rain: 0,
    showers: 0,
    snowfall: 0,
    windSpeed: 0,
    rainModeActive: false,
    slipperyIndex: 0,
  },
};

// ---------------------------------------------------------------------------
// Tyypit
// ---------------------------------------------------------------------------

export type CrowdOverride = "quiet" | "normal" | "rush";

export interface DispatchEdit {
  name?: string;
  endTime?: string;
  pax?: number;
}

// Päivitysvälit (millisekuntia)
export const TRAIN_REFRESH_MS = 2 * 60 * 1000;   // 2 min — Fintraffic tukee tihea polling
export const FLIGHT_REFRESH_MS = 2 * 60 * 1000;  // 2 min — Finavia, lentodata muuttuu usein
export const WEATHER_REFRESH_MS = 2 * 60 * 1000; // 2 min — Open-Meteo päivittyy 15 min, mutta poll usein
export const OTHERS_REFRESH_MS = 5 * 60 * 1000;  // 5 min — laivat, tapahtumat
export const SPORTS_REFRESH_MS = 15 * 60 * 1000; // 15 min — urheilu päivittyy harvoin

export interface SourceTimestamps {
  trains: Date | null;
  ships: Date | null;
  weather: Date | null;
  events: Date | null;
  flights: Date | null;
  sportsEvents: Date | null;
}

interface DashboardContextValue {
  state: DashboardState;
  alerts: JackpotAlert[];
  topAlert: JackpotAlert | null;
  hasJackpot: boolean;
  isLoading: boolean;
  lastFetch: Date | null;
  sourceTimestamps: SourceTimestamps;
  upcomingEvents: import("@/lib/types").EventInfo[];
  refreshAll: () => Promise<void>;
  refreshTrains: () => Promise<void>;
  simulateShipArrival: () => void;
  resetState: () => void;
  crowdOverrides: Record<string, CrowdOverride>;
  setCrowdOverride: (eventId: string, override: CrowdOverride) => void;
  dispatchEdits: Record<string, DispatchEdit>;
  setDispatchEdit: (eventId: string, edit: DispatchEdit) => void;
  trainStation: TrainStation;
  setTrainStation: (station: TrainStation) => void;
}

// ---------------------------------------------------------------------------
// Konteksti
// ---------------------------------------------------------------------------

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DashboardState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<import("@/lib/types").EventInfo[]>([]);
  const [sourceTimestamps, setSourceTimestamps] = useState<SourceTimestamps>({
    trains: null,
    ships: null,
    weather: null,
    events: null,
    flights: null,
    sportsEvents: null,
  });

  // Crowd overrides — sessiomuisti (tyhjenee kun selain suljetaan)
  const [crowdOverrides, setCrowdOverrides] = useState<Record<string, CrowdOverride>>({});

  // Dispatch edits — pysyva muisti (sailyy selainistuntojen valilla)
  const [dispatchEdits, setDispatchEdits] = useState<Record<string, DispatchEdit>>({});

  // Asemavalinta — sessiomuisti
  const [trainStation, setTrainStationState] = useState<TrainStation>(() => {
    try {
      return (sessionStorage.getItem("trainStation") as TrainStation) || "HKI";
    } catch { return "HKI"; }
  });

  // AbortController — peruuttaa kesken olevan haun kun uusi alkaa
  const abortRef = useRef<AbortController | null>(null);
  const trainAbortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // Setterit
  // ---------------------------------------------------------------------------

  const setTrainStation = useCallback((station: TrainStation) => {
    setTrainStationState(station);
    try { sessionStorage.setItem("trainStation", station); } catch {}
  }, []);

  const setCrowdOverride = useCallback((eventId: string, override: CrowdOverride) => {
    setCrowdOverrides((prev) => {
      const next = { ...prev, [eventId]: override };
      try { sessionStorage.setItem("crowdOverrides", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const setDispatchEdit = useCallback((eventId: string, edit: DispatchEdit) => {
    setDispatchEdits((prev) => {
      const next = { ...prev, [eventId]: edit };
      try { localStorage.setItem("dispatchEdits", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Pisteytys (memo — lasketaan vain kun state muuttuu)
  // ---------------------------------------------------------------------------

  const alerts = useMemo(() => calculateOpportunityScore(state), [state]);
  const topAlert = alerts.length > 0 ? alerts[0] : null;
  const hasJackpot = alerts.some((a) => a.level === "jackpot");

  // ---------------------------------------------------------------------------
  // Junien haku (2 min sykli — Fintraffic tukee tihea polling)
  // ---------------------------------------------------------------------------

  const refreshTrains = useCallback(async () => {
    if (trainAbortRef.current) trainAbortRef.current.abort();
    const controller = new AbortController();
    trainAbortRef.current = controller;

    try {
      const trains = await fetchLiveTrains(trainStation);
      if (controller.signal.aborted) return;

      setState((prev) => ({ ...prev, trainDelays: trains }));
      setSourceTimestamps((prev) => ({ ...prev, trains: new Date() }));
    } catch (err) {
      if (controller.signal.aborted) return;
      console.warn("refreshTrains epaonnistui:", err);
    }
  }, [trainStation]);

  useEffect(() => {
    setState((prev) => ({ ...prev, trainDelays: [] }));
    refreshTrains();
  }, [trainStation]);

  // Lentojen haku (2 min sykli — Finavia API edge functionin kautta)
  const flightAbortRef = useRef<AbortController | null>(null);
  const refreshFlights = useCallback(async () => {
    if (flightAbortRef.current) flightAbortRef.current.abort();
    const controller = new AbortController();
    flightAbortRef.current = controller;

    try {
      const flights = await fetchFlightArrivals();
      if (controller.signal.aborted) return;

      setState((prev) => ({ ...prev, flights }));
      setSourceTimestamps((prev) => ({ ...prev, flights: new Date() }));
    } catch (err) {
      if (controller.signal.aborted) return;
      console.warn("refreshFlights epaonnistui:", err);
    }
  }, []);

  // Sään haku (2 min sykli — reaaliaikainen päivitys)
  const weatherAbortRef = useRef<AbortController | null>(null);
  const refreshWeather = useCallback(async () => {
    if (weatherAbortRef.current) weatherAbortRef.current.abort();
    const controller = new AbortController();
    weatherAbortRef.current = controller;

    try {
      const weather = await fetchLiveWeather();
      if (controller.signal.aborted) return;

      setState((prev) => ({ ...prev, weather }));
      setSourceTimestamps((prev) => ({ ...prev, weather: new Date() }));
    } catch (err) {
      if (controller.signal.aborted) return;
      console.warn("refreshWeather epaonnistui:", err);
    }
  }, []);

  // Urheilun haku (15 min sykli — LinkedEvents + manuaalinen fallback)
  const sportsAbortRef = useRef<AbortController | null>(null);
  const refreshSports = useCallback(async () => {
    if (sportsAbortRef.current) sportsAbortRef.current.abort();
    const controller = new AbortController();
    sportsAbortRef.current = controller;

    try {
      const sportsEvents = await fetchSportsEvents();
      if (controller.signal.aborted) return;

      setState((prev) => ({ ...prev, sportsEvents }));
      setSourceTimestamps((prev) => ({ ...prev, sportsEvents: new Date() }));
    } catch (err) {
      if (controller.signal.aborted) return;
      console.warn("refreshSports epaonnistui:", err);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Paahaku — kaikki lähteet (5 min sykli, mukaan lukien junat)
  // ---------------------------------------------------------------------------

  const refreshAll = useCallback(async () => {
    // Peruuta edellinen kesken oleva haku
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);

    try {
      const [weather, harborPax, eventsBundle] = await Promise.all([
        fetchLiveWeather(),
        fetchHarborPaxEstimates().catch((e) => {
          console.warn("Harbor pax fetch epaonnistui:", e);
          return null;
        }),
        fetchEventsBundle().catch((e) => {
          console.warn("Events bundle fetch epaonnistui:", e);
          return { today: [] as import("@/lib/types").EventInfo[], upcoming: [] as import("@/lib/types").EventInfo[] };
        }),
      ]);

      // Hylkaa tulokset jos haku peruttiin lennossa
      if (controller.signal.aborted) return;

      const ships = harborPax ? averioShipsToArrivals(harborPax.ships ?? []) : [];
      const events = eventsBundle.today;
      setUpcomingEvents(eventsBundle.upcoming);
      const fetchedAt = new Date();

      setState((prev) => ({
        ...prev,
        weather,
        shipArrivals: ships,
        events,
      }));
      setLastFetch(fetchedAt);
      setSourceTimestamps((prev) => ({
        ...prev,
        ships: fetchedAt,
        weather: fetchedAt,
        events: fetchedAt,
      }));

      // Toast-notifikaatiot — prioriteettijärjestyksessä
      const delayed = state.trainDelays.filter((t) => t.delayMinutes > 30);
      const isSlippery = (weather.slipperyIndex ?? 0) >= 0.6;

      if (isSlippery) {
        toast.error("Liukas keli — sairaala-signaali aktiivinen", {
          description: `Liukkausindeksi ${weather.slipperyIndex?.toFixed(1)} — Meilahti / Jorvi / Peijas`,
        });
      } else if (delayed.length > 0 || weather.rainModeActive) {
        const parts: string[] = [];
        if (delayed.length > 0) parts.push(`${delayed.length} juna myohassa`);
        if (weather.rainModeActive) parts.push("Sademodus aktiivinen");
        toast.error(parts.join(" + "), {
          description: delayed.map((t) => `${t.line} +${t.delayMinutes}min`).join(", ") ||
            `${weather.condition}, ${weather.temp}C`,
        });
      } else {
        toast.success(
          `${state.trainDelays.length} junaa | ${ships.length} laivaa | ${events.length} tapahtumaa | ${weather.temp}C`,
          { description: "Ei merkittavia myohastymisia tai saavaroltuksia." }
        );
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error("refreshAll epaonnistui:", err);
      toast.error("Tietojen haku epaonnistui", {
        description: "Tarkista verkkoyhteys.",
      });
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [trainStation]);

  // Alkuhaku + viisi erillista paivityssykl: junat/lennot/sää 2 min, muut 5 min, urheilu 15 min
  useEffect(() => {
    refreshAll();
    refreshFlights();
    refreshSports();
    const allInterval = setInterval(refreshAll, OTHERS_REFRESH_MS);
    const trainInterval = setInterval(refreshTrains, TRAIN_REFRESH_MS);
    const flightInterval = setInterval(refreshFlights, FLIGHT_REFRESH_MS);
    const weatherInterval = setInterval(refreshWeather, WEATHER_REFRESH_MS);
    const sportsInterval = setInterval(refreshSports, SPORTS_REFRESH_MS);

    return () => {
      clearInterval(allInterval);
      clearInterval(trainInterval);
      clearInterval(flightInterval);
      clearInterval(weatherInterval);
      clearInterval(sportsInterval);
    };
  }, [refreshAll, refreshTrains, refreshFlights, refreshWeather, refreshSports]);

  // Realtime: kun events-taulu paivittyy (skrapaus tai manuaalinen lisays), refetch
  useEffect(() => {
    const eventsChannel = supabase
      .channel("events-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => {
        fetchEventsBundle().then((b) => {
          setState((prev) => ({ ...prev, events: b.today }));
          setUpcomingEvents(b.upcoming);
        }).catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(eventsChannel); };
  }, []);

  // ---------------------------------------------------------------------------
  // DevTools-apufunktiot
  // ---------------------------------------------------------------------------

  /**
   * Simuloi suuren laivan saapumisen 15 minuutin paahan.
   * Kayttaa oikeaa terminaalinimea jotta scoring.ts toimii oikein.
   * Lansiterminaali = P3 = Tallink (ei "Jatkasaari")
   */
  const simulateShipArrival = useCallback(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 15);
    const eta =
      now.getHours().toString().padStart(2, "0") +
      ":" +
      now.getMinutes().toString().padStart(2, "0");

    setState((prev) => ({
      ...prev,
      shipArrivals: [
        ...prev.shipArrivals.filter((s) => s.id !== "sim-ship"),
        {
          id: "sim-ship",
          ship: "Tallink Megastar",
          harbor: "Lansiterminaali", // Korjattu: oli "Jatkasaari"
          pax: 2800,
          estimatedPax: 2520,
          eta,
        },
      ],
    }));
  }, []);

  const resetState = useCallback(() => {
    setState(DEFAULT_STATE);
    refreshAll();
  }, [refreshAll]);

  // ---------------------------------------------------------------------------
  // Provider
  // ---------------------------------------------------------------------------

  return (
    <DashboardContext.Provider
      value={{
        state,
        alerts,
        topAlert,
        hasJackpot,
        isLoading,
        lastFetch,
        sourceTimestamps,
        upcomingEvents,
        refreshAll,
        refreshTrains,
        simulateShipArrival,
        resetState,
        crowdOverrides,
        setCrowdOverride,
        dispatchEdits,
        setDispatchEdit,
        trainStation,
        setTrainStation,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    // Vite Fast Refresh voi hetkellisesti renderoida lapsi-komponentteja
    // ennen kuin uudelleenluotu DashboardProvider on valmis. Palautetaan
    // turvallinen tyhja stub etta sovellus ei kaadu HMR-transientteihin.
    if (import.meta.env.DEV) {
      console.warn("[useDashboard] context missing — HMR transient, rendering empty stub.");
      return {
        state: DEFAULT_STATE,
        alerts: [],
        topAlert: null,
        hasJackpot: false,
        isLoading: false,
        lastFetch: null,
        sourceTimestamps: { trains: null, ships: null, weather: null, events: null, flights: null, sportsEvents: null },
        upcomingEvents: [],
        refreshAll: async () => {},
        refreshTrains: async () => {},
        simulateShipArrival: () => {},
        resetState: () => {},
        crowdOverrides: {},
        setCrowdOverride: () => {},
        dispatchEdits: {},
        setDispatchEdit: () => {},
        trainStation: "HKI" as TrainStation,
        setTrainStation: () => {},
      } as unknown as DashboardContextValue;
    }
    throw new Error("useDashboard must be used within DashboardProvider");
  }
  return ctx;
}

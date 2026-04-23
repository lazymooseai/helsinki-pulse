/**
 * DetailTabs.tsx
 *
 * Välilehtinäkymä: Junat / Laivat / Lennot / Urheilu / Tapahtumat / Sää.
 * Jokainen kortti avaa sisäisen DetailSheet-näkymän tarkemmilla tiedoilla.
 */

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TrainFront, Ship, Ticket, CloudRain, ExternalLink, Plane, Trophy } from "lucide-react";
import {
  useDashboard,
  TRAIN_REFRESH_MS,
  OTHERS_REFRESH_MS,
  FLIGHT_REFRESH_MS,
  SPORTS_REFRESH_MS,
} from "@/context/DashboardContext";
import { TRAIN_STATIONS } from "@/lib/fintraffic";
import DetailSheet from "@/components/DetailSheet";
import RefreshIndicator from "@/components/RefreshIndicator";
import type {
  TrainDelay,
  ShipArrival,
  EventInfo,
  WeatherData,
  FlightArrival,
  SportsEvent,
} from "@/lib/types";

/* ── Deep links ── */
const LINKS = {
  train: "https://junalahdot.fi/helsinki",
  ship: "https://averio.fi/laivat",
  weather: "https://www.ilmatieteenlaitos.fi/saa/helsinki",
  event: "https://tapahtumat.hel.fi/fi/",
  flight: "https://www.finavia.fi/fi/lentoasemat/helsinki-vantaa/saapuvat-lennot",
};

const VENUE_LINKS: Record<string, string> = {
  olympiastadion: "https://www.stadion.fi/tapahtumat",
  jaahalli: "https://helsinginjaahalli.fi/tapahtumat",
  jäähalli: "https://helsinginjaahalli.fi/tapahtumat",
  nordis: "https://helsinginjaahalli.fi/tapahtumat",
  hartwall: "https://www.veikkausarena.fi/",
  veikkausarena: "https://www.veikkausarena.fi/",
  "helsinki halli": "https://www.veikkausarena.fi/",
  messukeskus: "https://messukeskus.com/tapahtumat/",
  ooppera: "https://oopperabaletti.fi/kalenteri/",
  musiikkitalo: "https://www.musiikkitalo.fi/tapahtumat",
  "bolt arena": "https://www.hjk.fi/ottelut/",
};

function venueLink(venue: string): string {
  const v = venue.toLowerCase();
  for (const key of Object.keys(VENUE_LINKS)) {
    if (v.includes(key)) return VENUE_LINKS[key];
  }
  return LINKS.event;
}

/* ── Selected item state ── */
type Selected =
  | { kind: "train"; data: TrainDelay }
  | { kind: "ship"; data: ShipArrival }
  | { kind: "event"; data: EventInfo }
  | { kind: "weather"; data: WeatherData }
  | { kind: "flight"; data: FlightArrival }
  | { kind: "sports"; data: SportsEvent }
  | null;

/* ── Compact card used in tabs ── */
interface MiniCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  time?: string;
  status: "green" | "amber" | "red";
  onClick: () => void;
}

const STATUS_BORDER = {
  green: "border-l-primary",
  amber: "border-l-accent",
  red: "border-l-destructive",
};

const STATUS_TEXT = {
  green: "text-primary",
  amber: "text-accent",
  red: "text-destructive",
};

const MiniCard = ({ icon, title, subtitle, time, status, onClick }: MiniCardProps) => (
  <button
    onClick={onClick}
    className={`w-full text-left flex items-center gap-3 rounded-xl bg-card border-l-4 ${STATUS_BORDER[status]} border border-border px-4 py-3 active:scale-[0.98] transition-all`}
  >
    <div className={`shrink-0 ${STATUS_TEXT[status]}`}>{icon}</div>
    <div className="flex-1 min-w-0">
      <p className="font-black text-base text-foreground truncate">{title}</p>
      {subtitle && (
        <p className="text-sm text-muted-foreground font-semibold truncate mt-0.5">{subtitle}</p>
      )}
    </div>
    {time && (
      <span className={`text-xl font-mono font-black ${STATUS_TEXT[status]}`}>{time}</span>
    )}
    <ExternalLink className="h-4 w-4 text-muted-foreground/40 shrink-0" />
  </button>
);

/* ── Main component ── */
const DetailTabs = () => {
  const { state, trainStation, setTrainStation, sourceTimestamps } = useDashboard();
  const [selected, setSelected] = useState<Selected>(null);

  const stationName =
    TRAIN_STATIONS.find((s) => s.code === trainStation)?.name || "Helsinki";

  return (
    <div className="mt-6 px-4">
      <h2 className="text-lg font-black uppercase tracking-widest text-muted-foreground mb-3">
        Datalähteet
      </h2>

      <Tabs defaultValue="trains" className="w-full">
        <TabsList className="grid w-full grid-cols-6 h-auto bg-muted">
          <TabsTrigger value="trains" className="flex flex-col gap-1 py-2 data-[state=active]:bg-background">
            <TrainFront className="h-4 w-4" />
            <span className="text-[9px] font-black uppercase">Junat</span>
          </TabsTrigger>
          <TabsTrigger value="flights" className="flex flex-col gap-1 py-2 data-[state=active]:bg-background">
            <Plane className="h-4 w-4" />
            <span className="text-[9px] font-black uppercase">Lennot</span>
          </TabsTrigger>
          <TabsTrigger value="ships" className="flex flex-col gap-1 py-2 data-[state=active]:bg-background">
            <Ship className="h-4 w-4" />
            <span className="text-[9px] font-black uppercase">Laivat</span>
          </TabsTrigger>
          <TabsTrigger value="sports" className="flex flex-col gap-1 py-2 data-[state=active]:bg-background">
            <Trophy className="h-4 w-4" />
            <span className="text-[9px] font-black uppercase">Urheilu</span>
          </TabsTrigger>
          <TabsTrigger value="events" className="flex flex-col gap-1 py-2 data-[state=active]:bg-background">
            <Ticket className="h-4 w-4" />
            <span className="text-[9px] font-black uppercase">Tapaht.</span>
          </TabsTrigger>
          <TabsTrigger value="weather" className="flex flex-col gap-1 py-2 data-[state=active]:bg-background">
            <CloudRain className="h-4 w-4" />
            <span className="text-[9px] font-black uppercase">Sää</span>
          </TabsTrigger>
        </TabsList>

        {/* Junat */}
        <TabsContent value="trains" className="space-y-2">
          <RefreshIndicator
            lastFetch={sourceTimestamps.trains}
            intervalMs={TRAIN_REFRESH_MS}
            label="Fintraffic"
            className="px-1 pt-1"
          />
          <div className="flex gap-1 mb-2">
            {TRAIN_STATIONS.map((s) => (
              <button
                key={s.code}
                onClick={() => setTrainStation(s.code)}
                className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all active:scale-95 ${
                  trainStation === s.code
                    ? "bg-accent text-accent-foreground"
                    : "bg-muted text-muted-foreground border border-border"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
          {state.trainDelays.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Ei saapuvia kaukojunia
            </p>
          ) : (
            state.trainDelays.map((t) => (
              <MiniCard
                key={t.id}
                icon={<TrainFront className="h-5 w-5" />}
                title={`${t.line} ${t.origin} → ${stationName}`}
                subtitle={t.delayMinutes > 0 ? `Myöhässä +${t.delayMinutes} min` : "Aikataulussa"}
                time={t.arrivalTime}
                status={t.delayMinutes > 60 ? "red" : t.delayMinutes > 10 ? "amber" : "green"}
                onClick={() => setSelected({ kind: "train", data: t })}
              />
            ))
          )}
        </TabsContent>

        {/* Lennot — HEL-Vantaa saapuvat 2h */}
        <TabsContent value="flights" className="space-y-2">
          <RefreshIndicator
            lastFetch={sourceTimestamps.flights}
            intervalMs={FLIGHT_REFRESH_MS}
            label="Finavia HEL"
            className="px-1 pt-1"
          />
          {state.flights.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Ei saapuvia lentoja seuraavan 2h aikana
            </p>
          ) : (
            state.flights.map((f) => (
              <MiniCard
                key={f.id}
                icon={<Plane className="h-5 w-5" />}
                title={`${f.flightNumber} • ${f.origin}`}
                subtitle={`${f.demandTag}${f.terminal ? ` • ${f.terminal}` : ""}${
                  f.delayMinutes > 0 ? ` • +${f.delayMinutes}min` : ""
                }`}
                time={f.estimatedTime}
                status={f.demandLevel}
                onClick={() => setSelected({ kind: "flight", data: f })}
              />
            ))
          )}
        </TabsContent>

        {/* Laivat */}
        <TabsContent value="ships" className="space-y-2">
          <RefreshIndicator
            lastFetch={sourceTimestamps.ships}
            intervalMs={OTHERS_REFRESH_MS}
            label="Averio"
            className="px-1 pt-1"
          />
          {state.shipArrivals.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Ei tulossa olevia laivoja
            </p>
          ) : (
            state.shipArrivals.map((s) => {
              const pax = s.estimatedPax ?? s.pax;
              return (
                <MiniCard
                  key={s.id}
                  icon={<Ship className="h-5 w-5" />}
                  title={s.ship}
                  subtitle={`${s.harbor} • ~${pax.toLocaleString()} hlö`}
                  time={s.eta}
                  status={pax > 2000 ? "red" : pax > 1000 ? "amber" : "green"}
                  onClick={() => setSelected({ kind: "ship", data: s })}
                />
              );
            })
          )}
        </TabsContent>

        {/* Urheilu */}
        <TabsContent value="sports" className="space-y-2">
          <RefreshIndicator
            lastFetch={sourceTimestamps.sportsEvents}
            intervalMs={SPORTS_REFRESH_MS}
            label="Linkedevents + manuaalinen"
            className="px-1 pt-1"
          />
          {state.sportsEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Ei urheilutapahtumia tänään
            </p>
          ) : (
            state.sportsEvents.map((s) => (
              <MiniCard
                key={s.id}
                icon={<Trophy className="h-5 w-5" />}
                title={`${s.homeTeam} – ${s.awayTeam}`}
                subtitle={`${s.venue} • ~${s.expectedAttendance.toLocaleString()} hlö • ${s.league}`}
                time={s.startTime}
                status={s.demandLevel}
                onClick={() => setSelected({ kind: "sports", data: s })}
              />
            ))
          )}
        </TabsContent>

        {/* Tapahtumat */}
        <TabsContent value="events" className="space-y-2">
          <RefreshIndicator
            lastFetch={sourceTimestamps.events}
            intervalMs={OTHERS_REFRESH_MS}
            label="Linkedevents"
            className="px-1 pt-1"
          />
          {state.events.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Ei tapahtumia tänään
            </p>
          ) : (
            state.events.map((e) => (
              <MiniCard
                key={e.id}
                icon={<Ticket className="h-5 w-5" />}
                title={e.name}
                subtitle={`${e.venue}${e.startTime ? ` • ${e.startTime}` : ""}`}
                time={e.startTime}
                status={e.demandLevel || (e.soldOut ? "red" : "amber")}
                onClick={() => setSelected({ kind: "event", data: e })}
              />
            ))
          )}
        </TabsContent>

        {/* Sää */}
        <TabsContent value="weather" className="space-y-2">
          <RefreshIndicator
            lastFetch={sourceTimestamps.weather}
            intervalMs={OTHERS_REFRESH_MS}
            label="Open-Meteo"
            className="px-1 pt-1"
          />
          <MiniCard
            icon={<CloudRain className="h-5 w-5" />}
            title={`${state.weather.condition} • ${state.weather.temp}°C`}
            subtitle={
              state.weather.rainModeActive
                ? "Sademodus aktiivinen"
                : `Tuuli ${state.weather.windSpeed} m/s`
            }
            status={
              state.weather.rainModeActive || (state.weather.slipperyIndex ?? 0) >= 0.6
                ? "red"
                : state.weather.rain > 0 || state.weather.snowfall > 0
                ? "amber"
                : "green"
            }
            onClick={() => setSelected({ kind: "weather", data: state.weather })}
          />
        </TabsContent>
      </Tabs>

      {/* Detail Sheet */}
      {selected?.kind === "train" && (
        <DetailSheet
          open
          onClose={() => setSelected(null)}
          icon={<TrainFront className="h-7 w-7" />}
          title={`${selected.data.line} → ${stationName}`}
          subtitle={`Lähtöpaikka: ${selected.data.origin}`}
          fields={[
            { label: "Saapumisaika", value: selected.data.arrivalTime, highlight: true },
            { label: "Myöhästyminen", value: selected.data.delayMinutes > 0 ? `+${selected.data.delayMinutes} min` : "Aikataulussa" },
            { label: "Asema", value: stationName },
          ]}
          externalUrl={LINKS.train}
          externalLabel="Avaa junalahdot.fi"
        />
      )}

      {selected?.kind === "flight" && (
        <DetailSheet
          open
          onClose={() => setSelected(null)}
          icon={<Plane className="h-7 w-7" />}
          title={`${selected.data.flightNumber} • ${selected.data.airline}`}
          subtitle={`${selected.data.origin} → Helsinki-Vantaa`}
          fields={[
            { label: "Saapumisaika (ETA)", value: selected.data.estimatedTime, highlight: true },
            { label: "Aikataulun mukainen", value: selected.data.scheduledTime },
            ...(selected.data.delayMinutes !== 0
              ? [{ label: "Viive", value: `${selected.data.delayMinutes > 0 ? "+" : ""}${selected.data.delayMinutes} min` }]
              : []),
            ...(selected.data.terminal ? [{ label: "Terminaali", value: selected.data.terminal }] : []),
            ...(selected.data.gate ? [{ label: "Portti", value: selected.data.gate }] : []),
            ...(selected.data.belt ? [{ label: "Matkatavarahihna", value: selected.data.belt }] : []),
            { label: "Lähtöpaikka", value: `${selected.data.origin} (${selected.data.originCode})` },
            { label: "Kysyntä", value: selected.data.demandTag },
          ]}
          externalUrl={LINKS.flight}
          externalLabel="Avaa Finavia saapuvat"
        />
      )}

      {selected?.kind === "ship" && (
        <DetailSheet
          open
          onClose={() => setSelected(null)}
          icon={<Ship className="h-7 w-7" />}
          title={selected.data.ship}
          subtitle={selected.data.harbor}
          fields={[
            { label: "ETA", value: selected.data.eta, highlight: true },
            {
              label: "Matkustajia (live)",
              value: selected.data.estimatedPax
                ? `~${selected.data.estimatedPax.toLocaleString()}`
                : "—",
            },
            { label: "Maksimikapasiteetti", value: selected.data.pax.toLocaleString() },
            { label: "Satama", value: selected.data.harbor },
          ]}
          externalUrl={LINKS.ship}
          externalLabel="Avaa averio.fi/laivat"
        />
      )}

      {selected?.kind === "sports" && (
        <DetailSheet
          open
          onClose={() => setSelected(null)}
          icon={<Trophy className="h-7 w-7" />}
          title={`${selected.data.homeTeam} – ${selected.data.awayTeam}`}
          subtitle={`${selected.data.league} • ${selected.data.venue}`}
          fields={[
            { label: "Alkamisaika", value: selected.data.startTime, highlight: true },
            { label: "Yleisöarvio", value: `~${selected.data.expectedAttendance.toLocaleString()} hlö` },
            { label: "Kapasiteetti", value: selected.data.capacity.toLocaleString() },
            { label: "Täyttö", value: `${Math.round((selected.data.expectedAttendance / selected.data.capacity) * 100)}%` },
            ...(selected.data.endsIn > 0
              ? [{ label: "Päättyy n.", value: `${selected.data.endsIn} min kuluttua` }]
              : []),
            { label: "Kysyntä", value: selected.data.demandTag },
          ]}
          externalUrl={venueLink(selected.data.venue)}
          externalLabel="Avaa tapahtumapaikka"
        />
      )}

      {selected?.kind === "event" && (
        <DetailSheet
          open
          onClose={() => setSelected(null)}
          icon={<Ticket className="h-7 w-7" />}
          title={selected.data.name}
          subtitle={selected.data.venue}
          fields={[
            ...(selected.data.startTime
              ? [{ label: "Alkamisaika", value: selected.data.startTime, highlight: true }]
              : []),
            ...(selected.data.endsIn > 0
              ? [{ label: "Päättyy", value: `${selected.data.endsIn} min kuluttua` }]
              : []),
            { label: "Loppuunmyyty", value: selected.data.soldOut ? "Kyllä" : "Ei" },
            ...(selected.data.demandTag
              ? [{ label: "Kysyntä", value: selected.data.demandTag }]
              : []),
          ]}
          externalUrl={venueLink(selected.data.venue)}
          externalLabel="Avaa tapahtumapaikka"
        />
      )}

      {selected?.kind === "weather" && (
        <DetailSheet
          open
          onClose={() => setSelected(null)}
          icon={<CloudRain className="h-7 w-7" />}
          title={`Sää: ${selected.data.condition}`}
          subtitle={selected.data.rainModeActive ? "Sademodus aktiivinen" : "Normaali"}
          fields={[
            { label: "Lämpötila", value: `${selected.data.temp} °C`, highlight: true },
            { label: "Sade", value: `${selected.data.rain.toFixed(1)} mm/h` },
            { label: "Sadekuurot", value: `${selected.data.showers.toFixed(1)} mm/h` },
            { label: "Lumisade", value: `${selected.data.snowfall.toFixed(1)} mm/h` },
            { label: "Tuuli", value: `${selected.data.windSpeed} m/s` },
            ...(selected.data.slipperyIndex !== undefined
              ? [{ label: "Liukkausindeksi", value: selected.data.slipperyIndex.toFixed(2) }]
              : []),
          ]}
          externalUrl={LINKS.weather}
          externalLabel="Avaa Ilmatieteen laitos"
        />
      )}
    </div>
  );
};

export default DetailTabs;

import { Navigation, Plane, TrainFront, Ship, Trophy, CloudRain, ExternalLink } from "lucide-react";
import { useDashboard } from "@/context/DashboardContext";
import { JackpotAlert } from "@/lib/types";
import { openExternal } from "@/lib/openExternal";

/* ── Map alert type + zone to a deep link ── */
const ZONE_LINKS: Record<string, string> = {
  "pasila": "https://junalahdot.fi/pasila",
  "pasila / rautatientori": "https://junalahdot.fi/pasila",
  "rautatientori": "https://junalahdot.fi/helsinki",
  "helsinki-vantaa": "https://www.finavia.fi/fi/lentoasemat/helsinki-vantaa/lennot?tab=arr",
  "jätkäsaari": "https://averio.fi/laivat",
  "länsiterminaali": "https://averio.fi/laivat",
  "katajanokka": "https://averio.fi/laivat",
  "olympiaterminaali": "https://averio.fi/laivat",
};

const TYPE_FALLBACK_LINKS: Record<string, string> = {
  train: "https://www.vr.fi/liikennetilanne",
  ship: "https://averio.fi/laivat",
  weather: "https://www.ilmatieteenlaitos.fi/sadealueet-suomessa",
};

function getAlertDeepLink(alert: JackpotAlert | null): string | null {
  if (!alert) return null;
  const zoneKey = alert.zone.toLowerCase();
  if (ZONE_LINKS[zoneKey]) return ZONE_LINKS[zoneKey];
  for (const [key, url] of Object.entries(ZONE_LINKS)) {
    if (zoneKey.includes(key) || key.includes(zoneKey)) return url;
  }
  return TYPE_FALLBACK_LINKS[alert.type] || null;
}

function getZoneDeepLink(zone: string): string | null {
  const zoneKey = zone.toLowerCase();
  if (ZONE_LINKS[zoneKey]) return ZONE_LINKS[zoneKey];
  for (const [key, url] of Object.entries(ZONE_LINKS)) {
    if (zoneKey.includes(key) || key.includes(zoneKey)) return url;
  }
  if (zoneKey.includes("vantaa") || zoneKey.includes("lentoasema")) {
    return "https://www.finavia.fi/fi/lentoasemat/helsinki-vantaa/lennot?tab=arr";
  }
  if (zoneKey.includes("jäähalli") || zoneKey.includes("jaahalli") || zoneKey.includes("nordis")) {
    return "https://helsinginjaahalli.fi/tapahtumat";
  }
  if (zoneKey.includes("bolt") || zoneKey.includes("töölö")) {
    return "https://www.hjk.fi/ottelut";
  }
  return null;
}

const CommandCenter = () => {
  const { topAlert, hasJackpot, state } = useDashboard();

  const isJackpot = topAlert?.level === "jackpot";

  // Apuri: muuta minuutit kellonajaksi (esim. 95 -> "21:35")
  const minutesToClock = (minsFromNow: number): string => {
    const d = new Date(Date.now() + minsFromNow * 60_000);
    return d.getHours().toString().padStart(2, "0") + ":" +
           d.getMinutes().toString().padStart(2, "0");
  };

  // Dynaaminen fallback-suositus kun ei aktiivista alerttia:
  // valitaan paras alue todellisesta datasta (laivat > urheilu > tapahtumat > lennot > sää).
  const dynamicFallback = (() => {
    // 1. Iso laiva tulossa < 60 min
    const ship = state.shipArrivals[0];
    if (ship && (ship.estimatedPax ?? ship.pax) > 800) {
      const paxNum = ship.estimatedPax ?? ship.pax;
      return {
        zone: ship.harbor,
        reason: `${ship.ship} • ETA ${ship.eta} • ~${paxNum.toLocaleString("fi-FI")} matkustajaa`,
        icon: <Ship className="h-5 w-5 text-primary" />,
      };
    }
    // 2. Urheilutapahtuma alkamassa / käynnissä
    const sport = state.sportsEvents[0];
    if (sport) {
      const endClock = sport.endsIn > 0 ? minutesToClock(sport.endsIn) : "loppunut";
      return {
        zone: sport.venue,
        reason: `${sport.homeTeam}–${sport.awayTeam} • päättyy ~${endClock} • ~${sport.expectedAttendance.toLocaleString("fi-FI")} hlö`,
        icon: <Trophy className="h-5 w-5 text-primary" />,
      };
    }
    // 3. Tapahtuma jonka kysyntä korkea
    const event = state.events.find((e) => e.demandLevel === "red") ?? state.events[0];
    if (event) {
      const endClock = event.endsIn > 0 ? minutesToClock(event.endsIn) : "loppunut";
      return {
        zone: event.venue,
        reason: `${event.name} • päättyy ~${endClock}${event.demandTag ? ` • ${event.demandTag}` : ""}`,
        icon: <Trophy className="h-5 w-5 text-primary" />,
      };
    }
    // 4. Lentoja seuraavan 2h sisällä
    if (state.flights.length > 0) {
      const next = state.flights[0];
      return {
        zone: "Helsinki-Vantaa",
        reason: `${state.flights.length} lentoa 2h sisällä • seuraava ${next.flightNumber} ${next.originCode} klo ${next.estimatedTime}`,
        icon: <Plane className="h-5 w-5 text-primary" />,
      };
    }
    // 5. Sää-pohjainen
    if (state.weather.rainModeActive) {
      return {
        zone: "Keskusta",
        reason: `Sade ${state.weather.rain.toFixed(1)} mm/h — kysyntä nousee`,
        icon: <CloudRain className="h-5 w-5 text-primary" />,
      };
    }
    // 6. Oletus
    return {
      zone: "Keskusta",
      reason: `Rauhallista — ${state.weather.temp}°C, ${state.weather.condition === "Rain" ? "sade" : state.weather.condition === "Snow" ? "lumi" : "selkeä"}`,
      icon: <TrainFront className="h-5 w-5 text-accent" />,
    };
  })();

  const zone = topAlert?.zone ?? dynamicFallback.zone;
  const deepLink = getAlertDeepLink(topAlert) ?? getZoneDeepLink(zone);

  const handleClick = () => {
    if (deepLink) openExternal(deepLink);
  };

  return (
    <div
      onClick={handleClick}
      className={`mx-4 rounded-2xl border p-5 transition-all duration-500 ${
        deepLink ? "cursor-pointer active:scale-[0.98]" : ""
      } ${
        isJackpot
          ? "border-destructive/60 bg-destructive/10 animate-flash-border glow-red"
          : hasJackpot
          ? "border-accent/40 bg-accent/5 glow-amber"
          : "border-primary/30 bg-card animate-pulse-glow"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Navigation className={`h-6 w-6 ${isJackpot ? "text-destructive" : "text-primary"}`} />
          <span
            className={`text-sm font-black uppercase tracking-widest ${
              isJackpot ? "text-destructive" : "text-primary"
            }`}
          >
            {isJackpot ? "⚡ JACKPOT-ALUE" : "SUOSITUSALUE"}
          </span>
        </div>
        {deepLink && (
          <ExternalLink className="h-4 w-4 text-muted-foreground/50" />
        )}
      </div>

      <h1
        className={`text-4xl font-black leading-tight mb-2 ${
          isJackpot ? "text-destructive text-glow-red" : "text-foreground text-glow-green"
        }`}
      >
        {zone.toUpperCase()}
      </h1>

      {topAlert ? (
        <p className="text-base font-bold text-muted-foreground">{topAlert.reason}</p>
      ) : (
        <div className="flex items-center gap-2 text-base font-bold text-muted-foreground">
          {dynamicFallback.icon}
          <span>{dynamicFallback.reason}</span>
        </div>
      )}
    </div>
  );
};

export default CommandCenter;

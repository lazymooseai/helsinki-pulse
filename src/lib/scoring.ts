/**
 * scoring.ts
 *
 * TaxiCEO-pisteytysmalli: laskee JackpotAlert-listat kaikista signaalilahteista.
 *
 * Prioriteettijarjestys:
 *   1. Jackpot-alertit (tason nosto saakerroimella)
 *   2. High-alertit
 *   3. Tapahtumat (red > amber > green)
 *
 * Liukkausindeksi >= 0.6 tuottaa erillisen sairaala-signaalin.
 */

import { DashboardState, JackpotAlert } from "./types";
import { getWeatherMultiplier, getWeatherDescription } from "./weather";

// ---------------------------------------------------------------------------
// Apufunktiot
// ---------------------------------------------------------------------------

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hours: h ?? 0, minutes: m ?? 0 };
}

function minutesUntil(eta: string): number {
  const now = new Date();
  const { hours, minutes } = parseTime(eta);
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);
  if (target < now) target.setDate(target.getDate() + 1);
  return Math.round((target.getTime() - now.getTime()) / 60000);
}

function isLongDistance(line: string): boolean {
  // IC = InterCity, P = Pendolino, S = S-juna (pikajuna)
  return /^(IC|P|S)\s?\d*/i.test(line);
}

function isLateNight(): boolean {
  const h = new Date().getHours();
  return h >= 22 || h < 5;
}

// ---------------------------------------------------------------------------
// Paapisteytys
// ---------------------------------------------------------------------------

/**
 * Laskee kaikki mahdolliset JackpotAlert-ilmoitukset nykyisesta tilasta.
 *
 * Saannot tarkistujarjestyksessa:
 *   1. VR kaukojuna myohassa > 30 min
 *   2. Suuri laiva saapuu < 30 min (pax > 2000)
 *   3. Liukas keli (slipperyIndex >= 0.6)
 *   4. Kova sade/myrsky
 *   5. Tapahtuma red-tasolla (loppuunmyyty/korkea kysyntä)
 *   6. Saakertoimen nosto high -> jackpot
 */
export function calculateOpportunityScore(state: DashboardState): JackpotAlert[] {
  const alerts: JackpotAlert[] = [];
  const weatherMultiplier = getWeatherMultiplier(state.weather);

  // -- Saailisays tekstiin --
  function wtag(): string {
    if (state.weather.rainModeActive) return " + Sademodus";
    if (state.weather.snowfall > 0.1) return " + Lumisade";
    if (state.weather.slipperyIndex && state.weather.slipperyIndex >= 0.6) {
      return " + Liukas keli";
    }
    return "";
  }

  // ------------------------------------------------------------------
  // Saanto 1: VR kaukojuna myohassa > 30 min
  // ------------------------------------------------------------------
  for (const train of state.trainDelays) {
    if (!isLongDistance(train.line) || train.delayMinutes <= 30) continue;

    if (isLateNight()) {
      alerts.push({
        level: "jackpot",
        zone: "Pasila / Rautatientori",
        reason: `${train.line} (${train.origin}) +${train.delayMinutes} min myohassa. Pasila tayteen.${wtag()}`,
        type: "train",
      });
    } else {
      alerts.push({
        level: "high",
        zone: "Pasila",
        reason: `${train.line} (${train.origin}) myohassa +${train.delayMinutes} min.${wtag()}`,
        type: "train",
      });
    }
  }

  // ------------------------------------------------------------------
  // Saanto 2: Suuri laiva saapuu pian
  // ------------------------------------------------------------------
  for (const ship of state.shipArrivals) {
    const minsUntil = minutesUntil(ship.eta);
    const effectivePax = ship.estimatedPax ?? ship.pax;

    if (effectivePax > 2000 && minsUntil >= 0 && minsUntil <= 30) {
      alerts.push({
        level: "jackpot",
        zone: ship.harbor,
        reason: `${ship.ship} (~${effectivePax.toLocaleString()} hlö) saapuu ${minsUntil} min paasta.${wtag()}`,
        type: "ship",
      });
    } else if (effectivePax > 1000 && minsUntil >= 0 && minsUntil <= 45) {
      alerts.push({
        level: "high",
        zone: ship.harbor,
        reason: `${ship.ship} (~${effectivePax.toLocaleString()} hlö) saapumassa.${wtag()}`,
        type: "ship",
      });
    }
  }

  // ------------------------------------------------------------------
  // Saanto 3: Liukas keli -> sairaala-signaali
  // ------------------------------------------------------------------
  if (
    state.weather.slipperyIndex !== undefined &&
    state.weather.slipperyIndex >= 0.6
  ) {
    alerts.push({
      level: "jackpot",
      zone: "Sairaalat (Meilahti / Jorvi / Peijas)",
      reason: `Liukas keli — indeksi ${state.weather.slipperyIndex.toFixed(1)}. Kaatumiset lisaantyvat. Sairaalat kuumia.`,
      type: "weather",
    });
  }

  // ------------------------------------------------------------------
  // Saanto 4: Kova sade tai myrsky
  // ------------------------------------------------------------------
  if (state.weather.rainModeActive && weatherMultiplier >= 1.5) {
    alerts.push({
      level: "high",
      zone: "Koko Helsinki",
      reason: getWeatherDescription(state.weather),
      type: "weather",
    });
  }

  // ------------------------------------------------------------------
  // Saanto 5: Tapahtumat red-tasolla
  // ------------------------------------------------------------------
  for (const event of state.events) {
    if (event.demandLevel !== "red") continue;
    if (event.endsIn > 120) continue; // Ei viela alkamassa

    const minsUntilEnd = event.endsIn;
    const isPurkuhetki = minsUntilEnd <= 30 && minsUntilEnd >= 0;

    if (isPurkuhetki) {
      alerts.push({
        level: "jackpot",
        zone: event.venue,
        reason: `${event.name} paattyy ${minsUntilEnd} min paasta. Purkupiikki alkaa!`,
        type: "event",
      });
    } else if (event.soldOut) {
      alerts.push({
        level: "high",
        zone: event.venue,
        reason: `${event.name} — ${event.demandTag ?? "Korkea kysyntä"}`,
        type: "event",
      });
    }
  }

  // ------------------------------------------------------------------
  // Saakertoimen nosto: high -> jackpot kun saakerroin >= 1.5
  // ------------------------------------------------------------------
  if (weatherMultiplier >= 1.5) {
    for (const alert of alerts) {
      if (alert.level === "high") {
        alert.level = "jackpot";
        alert.reason += ` (x${weatherMultiplier} saakerroin)`;
      }
    }
  }

  // ------------------------------------------------------------------
  // Jarjesta: jackpot ensin, sitten high
  // ------------------------------------------------------------------
  alerts.sort((a, b) => {
    if (a.level === b.level) return 0;
    return a.level === "jackpot" ? -1 : 1;
  });

  return alerts;
}

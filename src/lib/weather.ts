/**
 * weather.ts
 *
 * Hakee reaaliaikaiset saatiedot Open-Meteo API:sta (ilmainen, ei API-avainta).
 * Lisaa liukkausindeksin (0.0-1.0) sairaala/liukastumis-signaaleja varten.
 *
 * Liukkausindeksi >= 0.6 -> sairaala-signaali (sama logiikka kuin Taxi_AI_v1.0)
 */

import { WeatherData } from "./types";

// Helsinki keskusta koordinaatit
const OPEN_METEO_URL =
  "https://api.open-meteo.com/v1/forecast" +
  "?latitude=60.1695&longitude=24.9354" +
  "&current=temperature_2m,rain,showers,snowfall,wind_speed_10m,precipitation,apparent_temperature" +
  "&wind_speed_unit=ms" +
  "&timezone=Europe%2FHelsinki";

interface OpenMeteoResponse {
  current: {
    temperature_2m: number;
    rain: number;
    showers: number;
    snowfall: number;
    wind_speed_10m: number;
    precipitation: number;
    apparent_temperature: number;
  };
}

/**
 * Maarittaa saaolosuhteen numeerisista arvoista.
 */
function deriveCondition(
  rain: number,
  showers: number,
  snowfall: number
): "Rain" | "Snow" | "Clear" {
  if (snowfall > 0.1) return "Snow";
  if (rain + showers > 0.1) return "Rain";
  return "Clear";
}

/**
 * Laskee liukkausindeksin (0.0-1.0) saaparametreista.
 *
 * Indeksi perustuu:
 * - Lampotila lahella 0 astetta (jaa/sula vaihtelee)
 * - Lumisade aktiivinen
 * - Kova tuuli + sade
 * - Yopakkanen (alle -5 astetta aamulla)
 *
 * >= 0.6 -> sairaala/liukastumissignaali kuljettajalle
 */
function calculateSlipperyIndex(
  temp: number,
  snowfall: number,
  rain: number,
  windSpeed: number,
  precipitation: number
): number {
  let index = 0.0;

  // Lampotila kriittisella alueella (-3..+2 astetta) -> liukas
  if (temp >= -3 && temp <= 2) {
    index += 0.4;
  } else if (temp > 2 && temp <= 4 && snowfall > 0) {
    // Sulamis-jaatymissykli
    index += 0.3;
  } else if (temp < -10) {
    // Kova pakkanen -> kuiva, ei liukas
    index += 0.0;
  } else if (temp < -3) {
    index += 0.1;
  }

  // Lumisade lisaa liukkautta merkittavasti
  if (snowfall > 0.5) index += 0.35;
  else if (snowfall > 0.1) index += 0.2;

  // Sade + kylma = jaatava sade (erittain liukas)
  if (rain > 0.2 && temp <= 1) index += 0.3;

  // Kova tuuli pahentaa
  if (windSpeed > 15 && precipitation > 0) index += 0.1;

  // Rajaa 0.0-1.0 valille
  return Math.min(1.0, Math.max(0.0, Math.round(index * 10) / 10));
}

/**
 * Hakee reaaliaikaiset saatiedot Open-Meteo API:sta.
 * Sisaltaa liukkausindeksin ja tunteenomaisen lampotilan.
 */
export async function fetchLiveWeather(): Promise<WeatherData> {
  const res = await fetch(OPEN_METEO_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`Open-Meteo API error: ${res.status} ${res.statusText}`);
  }

  const data: OpenMeteoResponse = await res.json();
  const {
    temperature_2m,
    rain,
    showers,
    snowfall,
    wind_speed_10m,
    precipitation,
  } = data.current;

  const condition = deriveCondition(rain, showers, snowfall);

  // Nostettu kynnys: 1.0 mm/h jotta pienet sumutukset eivat aktivoi
  const rainModeActive = rain + showers + snowfall > 1.0;

  const slipperyIndex = calculateSlipperyIndex(
    temperature_2m,
    snowfall,
    rain,
    wind_speed_10m,
    precipitation
  );

  return {
    condition,
    temp: Math.round(temperature_2m),
    rain,
    showers,
    snowfall,
    windSpeed: wind_speed_10m,
    rainModeActive,
    slipperyIndex,
  };
}

/**
 * Laskee saakerroin pisteytykseen.
 * Kayttaa liukkausindeksia jos saatavilla, muuten sadearvoja.
 *
 * Palauttaa: 1.0 (normaali) | 1.2 (tuulinen) | 1.5 (sade/lumi)
 */
export function getWeatherMultiplier(weather: WeatherData): number {
  // Liukkausindeksi ylittaa kynnyksen -> korkein kerroin
  if (weather.slipperyIndex !== undefined && weather.slipperyIndex >= 0.6) {
    return 1.5;
  }
  if (weather.rain + weather.showers > 1.0 || weather.snowfall > 0.1) {
    return 1.5;
  }
  if (weather.windSpeed > 10) {
    return 1.2;
  }
  return 1.0;
}

/**
 * Palauttaa saaolosuhteen selkokielisen kuvauksen suomeksi.
 * Kayttaa liukkausindeksia jos saatavilla.
 */
export function getWeatherDescription(weather: WeatherData): string {
  if (weather.slipperyIndex !== undefined && weather.slipperyIndex >= 0.6) {
    return `Liukas (indeksi ${weather.slipperyIndex.toFixed(1)}) — sairaala-signaali`;
  }
  if (weather.snowfall > 0.1) return `Lumisadetta — ${weather.snowfall.toFixed(1)} mm/h`;
  if (weather.rain + weather.showers > 1.0) {
    return `Sadetta — ${(weather.rain + weather.showers).toFixed(1)} mm/h`;
  }
  if (weather.windSpeed > 15) return `Tuulinen — ${Math.round(weather.windSpeed)} m/s`;
  return "Selkea";
}

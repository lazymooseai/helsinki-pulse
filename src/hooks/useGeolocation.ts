/**
 * useGeolocation.ts
 *
 * Hakee selaimen GPS-sijainnin ja tarjoaa fallbackin manuaalivalintaan.
 * Persisoi viimeisimmän valinnan localStorageen jotta refresh ei nollaa.
 */

import { useEffect, useState, useCallback } from "react";
import { ZONE_CENTERS, type Zone } from "@/lib/tolppaLocations";

const STORAGE_KEY = "taxi-pulse:manual-zone";

export type LocationSource = "gps" | "manual" | "none";

export interface LocationState {
  lat: number | null;
  lon: number | null;
  source: LocationSource;
  zone: Zone | null;            // Manuaalivalinnan vyöhyke (jos source=manual)
  accuracyMeters: number | null;
  error: string | null;
  loading: boolean;
}

export function useGeolocation() {
  const [state, setState] = useState<LocationState>(() => {
    // Lataa manuaalivalinta jos se on tallennettu
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY) as Zone | null;
      if (saved && saved in ZONE_CENTERS) {
        const c = ZONE_CENTERS[saved];
        return {
          lat: c.lat,
          lon: c.lon,
          source: "manual",
          zone: saved,
          accuracyMeters: null,
          error: null,
          loading: false,
        };
      }
    }
    return {
      lat: null,
      lon: null,
      source: "none",
      zone: null,
      accuracyMeters: null,
      error: null,
      loading: false,
    };
  });

  const requestGps = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState((s) => ({ ...s, error: "GPS ei ole tuettu tassa selaimessa", loading: false }));
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          source: "gps",
          zone: null,
          accuracyMeters: pos.coords.accuracy,
          error: null,
          loading: false,
        });
        // GPS voittaa manuaalivalinnan → tyhjennä
        localStorage.removeItem(STORAGE_KEY);
      },
      (err) => {
        setState((s) => ({
          ...s,
          loading: false,
          error: err.code === err.PERMISSION_DENIED ? "GPS-lupa evatty" : "GPS-haku epaonnistui",
        }));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  const setManualZone = useCallback((zone: Zone) => {
    const c = ZONE_CENTERS[zone];
    localStorage.setItem(STORAGE_KEY, zone);
    setState({
      lat: c.lat,
      lon: c.lon,
      source: "manual",
      zone,
      accuracyMeters: null,
      error: null,
      loading: false,
    });
  }, []);

  const clear = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState({
      lat: null,
      lon: null,
      source: "none",
      zone: null,
      accuracyMeters: null,
      error: null,
      loading: false,
    });
  }, []);

  // Yritä GPS:ää automaattisesti jos ei ole tallennettua manuaalivalintaa
  useEffect(() => {
    if (state.source === "none") {
      requestGps();
    }
    // Päivitä GPS jatkuvasti jos käyttäjä on antanut luvan (5 min välein)
    if (state.source === "gps") {
      const id = setInterval(requestGps, 5 * 60_000);
      return () => clearInterval(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.source]);

  return { ...state, requestGps, setManualZone, clear };
}
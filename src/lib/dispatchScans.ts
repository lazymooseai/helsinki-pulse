/**
 * dispatchScans.ts
 *
 * Data-kerros valityslaitteen naytön skannauksille.
 * Sisaltaa OCR-kutsun (scan-dispatch edge function),
 * Storage-uploadin ja Supabase CRUD-operaatiot.
 */

import { supabase } from "@/integrations/supabase/client";

export interface DispatchScan {
  id: string;
  tolppa: string;
  k_now: number | null;
  t_now: number | null;
  k_30: number | null;
  t_30: number | null;
  raw_image_url: string | null;
  ocr_confidence: number | null;
  ocr_raw_text: string | null;
  notes: string | null;
  is_verified: boolean;
  scanned_at: string;
  scanned_by_device: string | null;
  source: string;
}

export interface OcrResult {
  tolppa: string;
  k_now: number | null;
  t_now: number | null;
  k_30: number | null;
  t_30: number | null;
  confidence: number;
  raw_text?: string;
}

/**
 * Ajaa kuvan AI-OCR:n lapi ja palauttaa luetut luvut.
 */
export type OcrCallResult =
  | { ok: true; result: OcrResult; error?: undefined }
  | { ok: false; error: string; result?: undefined };

export async function runOcr(dataUrl: string): Promise<OcrCallResult> {
  try {
    const { data, error } = await supabase.functions.invoke("scan-dispatch", {
      body: { image: dataUrl },
    });
    if (error) {
      return { ok: false, error: error.message ?? "AI-luenta epaonnistui" };
    }
    if (!data || typeof data !== "object" || !data.tolppa) {
      return { ok: false, error: data?.error ?? "AI ei pystynyt lukemaan kuvaa" };
    }
    return { ok: true, result: data as OcrResult };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "tuntematon virhe" };
  }
}

/**
 * Lataa raakakuvan Storageen ja palauttaa julkisen URL:n.
 */
export async function uploadScanImage(blob: Blob, scanId: string): Promise<string | null> {
  const ext = blob.type.includes("png") ? "png" : "jpg";
  const path = `${new Date().toISOString().slice(0, 10)}/${scanId}.${ext}`;
  const { error } = await supabase.storage.from("dispatch-scans").upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: true,
  });
  if (error) {
    console.warn("Kuvan upload epaonnistui:", error.message);
    return null;
  }
  const { data } = supabase.storage.from("dispatch-scans").getPublicUrl(path);
  return data.publicUrl;
}

export type InsertScanResult =
  | { ok: true; id: string; error?: undefined }
  | { ok: false; error: string; id?: undefined };

export async function insertScan(payload: {
  tolppa: string;
  k_now: number | null;
  t_now: number | null;
  k_30: number | null;
  t_30: number | null;
  raw_image_url: string | null;
  ocr_confidence: number | null;
  ocr_raw_text: string | null;
  notes: string | null;
  is_verified: boolean;
  source: string;
  scanned_at?: string;
}): Promise<InsertScanResult> {
  const { data, error } = await supabase
    .from("dispatch_scans")
    .insert({
      ...payload,
      scanned_by_device: navigator.userAgent.slice(0, 100),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

export async function listRecentScans(limit = 20): Promise<DispatchScan[]> {
  const { data, error } = await supabase
    .from("dispatch_scans")
    .select("*")
    .order("scanned_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("listRecentScans virhe:", error.message);
    return [];
  }
  return (data ?? []) as DispatchScan[];
}

export async function deleteScan(id: string): Promise<boolean> {
  const { error } = await supabase.from("dispatch_scans").delete().eq("id", id);
  return !error;
}

/**
 * Hae viimeisin skannaus per tolppa (live-tila).
 * Palauttaa Mapin tolppa -> uusin skannaus.
 */
export async function getLatestPerTolppa(maxAgeMin = 60): Promise<Map<string, DispatchScan>> {
  const cutoff = new Date(Date.now() - maxAgeMin * 60_000).toISOString();
  const { data, error } = await supabase
    .from("dispatch_scans")
    .select("*")
    .gte("scanned_at", cutoff)
    .order("scanned_at", { ascending: false });
  if (error || !data) return new Map();
  const map = new Map<string, DispatchScan>();
  for (const row of data as DispatchScan[]) {
    if (!map.has(row.tolppa)) map.set(row.tolppa, row);
  }
  return map;
}

/**
 * Konvertoi File -> data URL (AI-syötetta varten).
 */
export function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/**
 * Pura videosta tasaisin valein N avainkehysta JPEG-blob+dataUrl-muodossa.
 * Tarkistaa ensin keston (max sallittu sekunteina).
 */
export interface VideoFrame {
  blob: Blob;
  dataUrl: string;
  timeSec: number;
}

export async function extractVideoFrames(
  file: File | Blob,
  opts: { frameCount?: number; maxDurationSec?: number; quality?: number } = {},
): Promise<{ ok: true; frames: VideoFrame[]; duration: number } | { ok: false; error: string }> {
  const frameCount = opts.frameCount ?? 4;
  const maxDurationSec = opts.maxDurationSec ?? 30;
  const quality = opts.quality ?? 0.85;

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    const cleanup = () => URL.revokeObjectURL(url);

    video.onerror = () => {
      cleanup();
      resolve({ ok: false, error: "Videon avaus epaonnistui" });
    };

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        cleanup();
        resolve({ ok: false, error: "Videon kestoa ei voitu lukea" });
        return;
      }
      if (duration > maxDurationSec + 0.5) {
        cleanup();
        resolve({ ok: false, error: `Video on liian pitka (${duration.toFixed(1)}s, max ${maxDurationSec}s)` });
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        resolve({ ok: false, error: "Canvas-konteksti puuttuu" });
        return;
      }

      const seekTo = (t: number) =>
        new Promise<void>((res, rej) => {
          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            res();
          };
          const onErr = () => {
            video.removeEventListener("error", onErr);
            rej(new Error("seek epaonnistui"));
          };
          video.addEventListener("seeked", onSeeked, { once: true });
          video.addEventListener("error", onErr, { once: true });
          video.currentTime = Math.min(t, Math.max(0, duration - 0.05));
        });

      const frames: VideoFrame[] = [];
      try {
        for (let i = 0; i < frameCount; i++) {
          const t = (duration * (i + 1)) / (frameCount + 1);
          await seekTo(t);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob: Blob | null = await new Promise((r) =>
            canvas.toBlob((b) => r(b), "image/jpeg", quality),
          );
          if (!blob) continue;
          const dataUrl = await fileToDataUrl(blob);
          frames.push({ blob, dataUrl, timeSec: t });
        }
      } catch (e) {
        cleanup();
        resolve({ ok: false, error: e instanceof Error ? e.message : "frame-irrotus epaonnistui" });
        return;
      }

      cleanup();
      if (frames.length === 0) {
        resolve({ ok: false, error: "Yhtaan framea ei saatu irrotettua" });
        return;
      }
      resolve({ ok: true, frames, duration });
    };
  });
}
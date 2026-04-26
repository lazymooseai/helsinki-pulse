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
 * Aja PDF-tiedosto AI-jäsentäjän läpi (sama edge-funktio, eri payload).
 * PDF lähetetään base64-data URL:na — Gemini tukee PDF:n suoraan inlineDatassa.
 */
export async function runPdfOcr(pdfDataUrl: string): Promise<OcrCallResult> {
  try {
    const { data, error } = await supabase.functions.invoke("scan-dispatch", {
      body: { pdf: pdfDataUrl },
    });
    if (error) {
      return { ok: false, error: error.message ?? "PDF-luenta epaonnistui" };
    }
    if (!data || typeof data !== "object" || !data.tolppa) {
      return { ok: false, error: data?.error ?? "AI ei pystynyt lukemaan PDF:aa" };
    }
    return { ok: true, result: data as OcrResult };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "tuntematon virhe" };
  }
}

/**
 * Jäsennä raakateksti (TXT / leikepöytä / CSV-rivi) → OcrResult.
 * Tunnistaa tolpan + K+/T+/K-30/T-30 luvut joustavasti:
 * - "Rautatientori" \n "K+ 8 T+ 3 K-30 12 T-30 5"
 * - "Kamppi K+:8 T+:3 K-30:12 T-30:5"
 * - JSON-objekti { tolppa, k_now, t_now, k_30, t_30 }
 * - CSV: "Pasila,8,3,12,5"
 */
export function parseTextToOcr(raw: string): OcrCallResult {
  // Jos syöte näyttää HTML:lta, riisu tagit ennen jäsennystä.
  const looksLikeHtml = /<\/?[a-z][\s\S]*?>/i.test(raw) && /<(html|body|div|span|table|p|td|th|li|h\d)\b/i.test(raw);
  const text = (looksLikeHtml ? htmlToText(raw) : raw).trim();
  if (!text) return { ok: false, error: "Tiedosto on tyhja" };

  // 1. JSON-yritys
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === "object" && (obj.tolppa || obj.name)) {
      const num = (v: unknown) => {
        const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
        return Number.isFinite(n) ? n : null;
      };
      return {
        ok: true,
        result: {
          tolppa: String(obj.tolppa ?? obj.name ?? "Tuntematon").slice(0, 100),
          k_now: num(obj.k_now ?? obj.kNow ?? obj.k),
          t_now: num(obj.t_now ?? obj.tNow ?? obj.t),
          k_30: num(obj.k_30 ?? obj.k30),
          t_30: num(obj.t_30 ?? obj.t30),
          confidence: 1,
          raw_text: text.slice(0, 500),
        },
      };
    }
  } catch {
    // ei JSON, jatka
  }

  // 2. Avain-arvo regex (joustava: K+, K +, K_now, K-30 jne.)
  const grab = (re: RegExp): number | null => {
    const m = text.match(re);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
  };
  const k_now = grab(/K\s*\+?\s*(?:nyt)?\s*[:=]?\s*(\d{1,3})\b(?!\s*-?\s*30)/i);
  const t_now = grab(/T\s*\+?\s*(?:nyt)?\s*[:=]?\s*(\d{1,3})\b(?!\s*-?\s*30)/i);
  const k_30 = grab(/K\s*[-_]?\s*30\s*[:=]?\s*(\d{1,3})/i);
  const t_30 = grab(/T\s*[-_]?\s*30\s*[:=]?\s*(\d{1,3})/i);

  // 3. Tolpan nimi: ensimmäinen ei-numeerinen rivi tai "tolppa:" -kentta
  let tolppa = "";
  const tolppaMatch = text.match(/(?:tolppa|asema|paikka|station)\s*[:=]\s*([^\n,;]+)/i);
  if (tolppaMatch) {
    tolppa = tolppaMatch[1].trim();
  } else {
    // CSV-tyyli: "Pasila,8,3,12,5"
    const csv = text.split(/[\n;]/)[0].split(",").map((s) => s.trim());
    if (csv.length >= 2 && csv[0] && !/^\d+$/.test(csv[0])) {
      tolppa = csv[0];
      if (k_now === null && csv[1]) {
        const cn = parseInt(csv[1], 10);
        const ct = parseInt(csv[2] ?? "", 10);
        const ck30 = parseInt(csv[3] ?? "", 10);
        const ct30 = parseInt(csv[4] ?? "", 10);
        return {
          ok: true,
          result: {
            tolppa: tolppa.slice(0, 100),
            k_now: Number.isFinite(cn) ? cn : null,
            t_now: Number.isFinite(ct) ? ct : null,
            k_30: Number.isFinite(ck30) ? ck30 : null,
            t_30: Number.isFinite(ct30) ? ct30 : null,
            confidence: 0.95,
            raw_text: text.slice(0, 500),
          },
        };
      }
    } else {
      // Ensimmainen rivi joka ei ole pelkkia numeroita/erotinmerkkeja
      const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
      tolppa = lines.find((l) => /[a-zA-ZäöåÄÖÅ]/.test(l) && l.length <= 60) ?? "Tuntematon";
    }
  }

  if (!tolppa && k_now === null && t_now === null) {
    return { ok: false, error: "Tekstista ei löytynyt tolppaa eika lukuja" };
  }

  return {
    ok: true,
    result: {
      tolppa: (tolppa || "Tuntematon").slice(0, 100),
      k_now,
      t_now,
      k_30,
      t_30,
      confidence: 0.9,
      raw_text: text.slice(0, 500),
    },
  };
}

/**
 * Karsii HTML:sta tagit, skriptit ja tyylit → puhdas teksti.
 * Toimii sekä DOMParserilla (selain) että regex-fallbackilla.
 */
export function htmlToText(html: string): string {
  try {
    if (typeof DOMParser !== "undefined") {
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
      // Lisää rivinvaihtoja lohkotason elementeille jotta tolppa + luvut erottuvat
      doc.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
      doc
        .querySelectorAll("p, div, tr, li, h1, h2, h3, h4, h5, h6, td, th")
        .forEach((el) => el.append("\n"));
      const txt = doc.body?.textContent ?? doc.documentElement.textContent ?? "";
      return decodeEntities(txt).replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
    }
  } catch {
    // fallback alle
  }
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h\d|td|th)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

/** Lue File tekstiksi UTF-8 muodossa. */
export function fileToText(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file, "utf-8");
  });
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
 * Lukee kuvan ja koodaa sen uudelleen JPEG:ksi canvasilla.
 * Tarpeen koska Gemini ei tue HEIC/DNG/RAW-tyyppeja, mutta selain
 * osaa silti dekoodata monet niista <img>-tagilla.
 * Skaala max 1600px pitkimmalle sivulle, jotta payload pysyy pienena.
 */
export async function fileToJpegDataUrl(file: File | Blob, maxDim = 1600, quality = 0.9): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Selain ei osaa avata tata kuvatyyppia (esim. HEIC/DNG). Ota kuva JPEG:na."));
      el.src = objectUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas-konteksti ei toimi");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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

export type ExtractFramesResult =
  | { ok: true; frames: VideoFrame[]; duration: number; error?: undefined }
  | { ok: false; error: string; frames?: undefined; duration?: undefined };

export async function extractVideoFrames(
  file: File | Blob,
  opts: { frameCount?: number; maxDurationSec?: number; quality?: number } = {},
): Promise<ExtractFramesResult> {
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
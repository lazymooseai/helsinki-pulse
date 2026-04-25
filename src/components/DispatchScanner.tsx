/**
 * DispatchScanner.tsx
 *
 * Kuljettajan skannausnakyma. Kayttaja:
 * 1. ottaa kuvan kameralla TAI valitsee tiedoston
 * 2. AI lukee K+/T+/K-30/T-30 luvut + tolpan nimen
 * 3. kuljettaja korjaa tarvittaessa ja vahvistaa
 * 4. data tallennetaan dispatch_scans tauluun (live + historia)
 */

import { useRef, useState } from "react";
import { Camera, Upload, Check, X, Loader2, Video as VideoIcon } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  extractVideoFrames,
  fileToJpegDataUrl,
  insertScan,
  runOcr,
  type OcrResult,
} from "@/lib/dispatchScans";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

type Stage = "capture" | "analyzing" | "review";

const numField = (v: number | null) => (v === null || v === undefined ? "" : String(v));
const MAX_VIDEO_SEC = 30;
const MAX_VIDEO_MB = 50;
const MAX_IMAGE_MB = 20;

const DispatchScanner = ({ open, onOpenChange, onSaved }: Props) => {
  const [stage, setStage] = useState<Stage>("capture");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [form, setForm] = useState({
    tolppa: "",
    k_now: "",
    t_now: "",
    k_30: "",
    t_30: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoCamRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);
  const [analyzeNote, setAnalyzeNote] = useState<string>("");

  const reset = () => {
    setStage("capture");
    setImageDataUrl(null);
    setImageBlob(null);
    setOcr(null);
    setForm({ tolppa: "", k_now: "", t_now: "", k_30: "", t_30: "", notes: "" });
    setSaving(false);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handlePicked = async (file: File | undefined) => {
    if (!file) return;
    // Sallitaan myos tyhja MIME (iOS lahettaa joskus naita) — canvas ratkaisee sopivuuden
    if (file.type && !file.type.startsWith("image/")) {
      toast.error("Vain kuvatiedostot kelpaavat");
      return;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      toast.error(`Kuva on liian iso (max ${MAX_IMAGE_MB} MB)`);
      return;
    }
    setImageBlob(file);
    setStage("analyzing");
    setAnalyzeNote("Pakataan kuvaa...");
    try {
      // Pakotetaan JPEG:ksi: Gemini ei tue DNG/HEIC/RAW-tyyppeja
      const dataUrl = await fileToJpegDataUrl(file);
      setImageDataUrl(dataUrl);
      setAnalyzeNote("Gemini AI lukee numeroita...");
      const res = await runOcr(dataUrl);
      if (!res.ok) {
        toast.error("AI-luenta epaonnistui: " + res.error);
        setStage("capture");
        return;
      }
      setOcr(res.result);
      setForm({
        tolppa: res.result.tolppa ?? "",
        k_now: numField(res.result.k_now),
        t_now: numField(res.result.t_now),
        k_30: numField(res.result.k_30),
        t_30: numField(res.result.t_30),
        notes: "",
      });
      setStage("review");
    } catch (e) {
      toast.error("Kuvan kasittely epaonnistui");
      setStage("capture");
    }
  };

  const handleVideoPicked = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Vain videotiedostot kelpaavat");
      return;
    }
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      toast.error(`Video on liian iso (max ${MAX_VIDEO_MB} MB)`);
      return;
    }
    setStage("analyzing");
    setAnalyzeNote("Puretaan videon avainkehyksia...");
    try {
      const ext = await extractVideoFrames(file, { frameCount: 4, maxDurationSec: MAX_VIDEO_SEC });
      if (!ext.ok) {
        toast.error(ext.error);
        setStage("capture");
        return;
      }
      // Esikatselu: nayta ensimmainen frame heti
      setImageDataUrl(ext.frames[0].dataUrl);
      setAnalyzeNote(`AI lukee ${ext.frames.length} avainkehysta videosta...`);

      // Aja OCR jokaiselle framelle, valitse korkein confidence
      const results = await Promise.all(ext.frames.map((f) => runOcr(f.dataUrl)));
      let bestIdx = -1;
      let bestConf = -1;
      let bestRes: OcrResult | null = null;
      results.forEach((r, i) => {
        if (r.ok && r.result.confidence > bestConf) {
          bestConf = r.result.confidence;
          bestRes = r.result;
          bestIdx = i;
        }
      });

      if (!bestRes || bestIdx < 0) {
        const firstErr = results.find((r): r is { ok: false; error: string } => !r.ok);
        toast.error("AI-luenta epaonnistui: " + (firstErr ? firstErr.error : "tuntematon"));
        setStage("capture");
        return;
      }

      // Tallenna paras frame still-kuvana (yhteensopiva nykyisen kuva-Storage-rakenteen kanssa)
      const bestFrame = ext.frames[bestIdx];
      setImageBlob(bestFrame.blob);
      setImageDataUrl(bestFrame.dataUrl);
      setOcr(bestRes);
      setForm({
        tolppa: bestRes.tolppa ?? "",
        k_now: numField(bestRes.k_now),
        t_now: numField(bestRes.t_now),
        k_30: numField(bestRes.k_30),
        t_30: numField(bestRes.t_30),
        notes: `Video ${ext.duration.toFixed(1)}s, paras frame @ ${bestFrame.timeSec.toFixed(1)}s`,
      });
      setStage("review");
    } catch (e) {
      toast.error("Videon kasittely epaonnistui");
      setStage("capture");
    }
  };

  const handleSave = async () => {
    if (!form.tolppa.trim()) {
      toast.error("Tolpan nimi on pakollinen");
      return;
    }
    setSaving(true);

    const parseIntOrNull = (v: string) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    };

    const result = await insertScan({
      tolppa: form.tolppa.trim(),
      k_now: parseIntOrNull(form.k_now),
      t_now: parseIntOrNull(form.t_now),
      k_30: parseIntOrNull(form.k_30),
      t_30: parseIntOrNull(form.t_30),
      raw_image_url: null,
      ocr_confidence: ocr?.confidence ?? null,
      ocr_raw_text: ocr?.raw_text ?? null,
      notes: form.notes.trim() || null,
      is_verified: true,
      source: imageBlob ? "camera" : "manual",
    });

    setSaving(false);
    if (result.ok) {
      toast.success("Skannaus tallennettu");
      onSaved?.();
      reset();
      onOpenChange(false);
    } else {
      toast.error("Tallennus epaonnistui: " + result.error);
    }
  };

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="bottom" className="h-[92vh] overflow-y-auto bg-slate-900 border-slate-700">
        <SheetHeader>
          <SheetTitle className="text-2xl font-black text-foreground">
            {stage === "capture" && "Skannaa valityslaite"}
            {stage === "analyzing" && "AI lukee numeroita..."}
            {stage === "review" && "Tarkista luvut"}
          </SheetTitle>
        </SheetHeader>

        {stage === "capture" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Ota kuva valityslaitteen naytösta tai lisaa olemassa oleva kuvatiedosto.
              AI lukee K+/T+/K-30/T-30 luvut ja tolpan nimen automaattisesti.
            </p>

            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handlePicked(e.target.files?.[0])}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handlePicked(e.target.files?.[0])}
            />
            <input
              ref={videoCamRef}
              type="file"
              accept="video/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleVideoPicked(e.target.files?.[0])}
            />
            <input
              ref={videoFileRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => handleVideoPicked(e.target.files?.[0])}
            />

            <Button
              onClick={() => cameraRef.current?.click()}
              className="w-full h-20 text-xl font-bold bg-primary"
            >
              <Camera className="h-7 w-7 mr-3" />
              Ota kuva kameralla
            </Button>

            <Button
              onClick={() => fileRef.current?.click()}
              variant="outline"
              className="w-full h-20 text-xl font-bold border-slate-600"
            >
              <Upload className="h-7 w-7 mr-3" />
              Lisaa kuvatiedosto
            </Button>

            <div className="pt-2 border-t border-slate-700" />
            <p className="text-xs text-muted-foreground text-center">
              Video (max {MAX_VIDEO_SEC}s) — AI poimii parhaan kehyksen
            </p>

            <Button
              onClick={() => videoCamRef.current?.click()}
              variant="outline"
              className="w-full h-16 text-lg font-bold border-slate-600"
            >
              <VideoIcon className="h-6 w-6 mr-3" />
              Kuvaa video kameralla
            </Button>

            <Button
              onClick={() => videoFileRef.current?.click()}
              variant="outline"
              className="w-full h-16 text-lg font-bold border-slate-600"
            >
              <Upload className="h-6 w-6 mr-3" />
              Lisaa videotiedosto
            </Button>

            <Button
              onClick={() => {
                setStage("review");
                setOcr(null);
              }}
              variant="ghost"
              className="w-full text-muted-foreground"
            >
              Syöta luvut kasin (ilman kuvaa)
            </Button>
          </div>
        )}

        {stage === "analyzing" && (
          <div className="mt-10 flex flex-col items-center justify-center gap-4 py-10">
            <Loader2 className="h-16 w-16 animate-spin text-primary" />
            <p className="text-lg font-bold text-center px-4">{analyzeNote || "Gemini AI lukee numeroita..."}</p>
            {imageDataUrl && (
              <img src={imageDataUrl} alt="Esikatselu" className="max-h-64 rounded-lg border border-slate-700" />
            )}
          </div>
        )}

        {stage === "review" && (
          <div className="mt-6 space-y-4">
            {imageDataUrl && (
              <div className="relative">
                <img src={imageDataUrl} alt="Skannaus" className="w-full max-h-48 object-contain rounded-lg border border-slate-700 bg-black" />
                {ocr && (
                  <Badge
                    className={`absolute top-2 right-2 ${
                      ocr.confidence >= 0.8 ? "bg-green-600" : ocr.confidence >= 0.5 ? "bg-amber-600" : "bg-red-600"
                    }`}
                  >
                    AI {Math.round(ocr.confidence * 100)}%
                  </Badge>
                )}
              </div>
            )}

            <div>
              <Label htmlFor="tolppa" className="text-base font-bold">Tolppa</Label>
              <Input
                id="tolppa"
                value={form.tolppa}
                onChange={(e) => set("tolppa")(e.target.value)}
                placeholder="esim. Rautatientori"
                className="text-lg h-12 bg-slate-800 border-slate-600"
                maxLength={100}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Card className="p-3 bg-slate-800 border-slate-700">
                <Label htmlFor="k_now" className="text-xs uppercase text-muted-foreground">K+ nyt</Label>
                <Input
                  id="k_now"
                  inputMode="numeric"
                  value={form.k_now}
                  onChange={(e) => set("k_now")(e.target.value.replace(/[^0-9]/g, ""))}
                  className="text-3xl font-black h-14 text-center bg-transparent border-0 text-green-400"
                />
              </Card>
              <Card className="p-3 bg-slate-800 border-slate-700">
                <Label htmlFor="t_now" className="text-xs uppercase text-muted-foreground">T+ nyt</Label>
                <Input
                  id="t_now"
                  inputMode="numeric"
                  value={form.t_now}
                  onChange={(e) => set("t_now")(e.target.value.replace(/[^0-9]/g, ""))}
                  className="text-3xl font-black h-14 text-center bg-transparent border-0 text-red-400"
                />
              </Card>
              <Card className="p-3 bg-slate-800 border-slate-700">
                <Label htmlFor="k_30" className="text-xs uppercase text-muted-foreground">K-30 min</Label>
                <Input
                  id="k_30"
                  inputMode="numeric"
                  value={form.k_30}
                  onChange={(e) => set("k_30")(e.target.value.replace(/[^0-9]/g, ""))}
                  className="text-3xl font-black h-14 text-center bg-transparent border-0 text-green-400/80"
                />
              </Card>
              <Card className="p-3 bg-slate-800 border-slate-700">
                <Label htmlFor="t_30" className="text-xs uppercase text-muted-foreground">T-30 min</Label>
                <Input
                  id="t_30"
                  inputMode="numeric"
                  value={form.t_30}
                  onChange={(e) => set("t_30")(e.target.value.replace(/[^0-9]/g, ""))}
                  className="text-3xl font-black h-14 text-center bg-transparent border-0 text-red-400/80"
                />
              </Card>
            </div>

            <div>
              <Label htmlFor="notes">Muistiinpano (vapaaehtoinen)</Label>
              <Input
                id="notes"
                value={form.notes}
                onChange={(e) => set("notes")(e.target.value)}
                placeholder="esim. ruuhkaa, sade alkanut"
                className="bg-slate-800 border-slate-600"
                maxLength={200}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                onClick={() => setStage("capture")}
                variant="outline"
                className="flex-1 border-slate-600"
                disabled={saving}
              >
                <X className="h-4 w-4 mr-2" /> Peruuta
              </Button>
              <Button onClick={handleSave} disabled={saving} className="flex-[2] bg-primary font-bold">
                {saving ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Check className="h-5 w-5 mr-2" /> Tallenna
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default DispatchScanner;
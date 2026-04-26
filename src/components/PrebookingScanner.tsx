/**
 * PrebookingScanner.tsx
 *
 * Sheet-UI ennakkotilausten syottamiseen:
 *  - Kuva (kamera tai galleria) → AI lukee listan
 *  - PDF → AI lukee listan
 *  - TXT/CSV/JSON/HTML → lokaali jasennys
 *  - Manuaalinen lisays (yksi tilaus kerrallaan)
 *
 * Tarkista vahvistettavat rivit ennen tallennusta.
 */

import { useRef, useState } from "react";
import { Camera, Upload, FileText, Loader2, Check, X, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  fileToDataUrl,
  fileToJpegDataUrl,
  fileToText,
} from "@/lib/dispatchScans";
import {
  insertBookings,
  parseTextToBookings,
  runImageBookings,
  runPdfBookings,
  type ParsedBooking,
} from "@/lib/prebookings";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

type Stage = "capture" | "analyzing" | "review";

const MAX_IMAGE_MB = 20;
const MAX_PDF_MB = 10;
const MAX_TEXT_MB = 2;

/**
 * Muotoile ISO → "YYYY-MM-DDTHH:MM" Helsinki-ajassa.
 * Selaimen aikavyohyke ei saa vaikuttaa: kuljettaja ajattelee aina Suomen aikaa.
 */
const isoToLocalInput = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // sv-SE → "YYYY-MM-DD HH:MM"; muunna T-erottimella
  return dtf.format(d).replace(" ", "T");
};

/** Tulkitsee `datetime-local` -arvon (esim. "2026-04-26T16:30") aina Helsinki-aikana. */
const inputToIso = (v: string): string => {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return new Date().toISOString();
  const [, y, mo, d, h, mi] = m;
  const naiveUtcMs = Date.UTC(+y, +mo - 1, +d, +h, +mi, 0);
  // Lasketaan Helsinki-offset talle hetkelle (kesa/talvi)
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Helsinki",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = dtf.formatToParts(new Date(naiveUtcMs)).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const asHelsinkiUtc = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    parts.hour === "24" ? 0 : +parts.hour, +parts.minute, +parts.second,
  );
  const offsetMin = Math.round((asHelsinkiUtc - naiveUtcMs) / 60000);
  return new Date(naiveUtcMs - offsetMin * 60_000).toISOString();
};

const PrebookingScanner = ({ open, onOpenChange, onSaved }: Props) => {
  const [stage, setStage] = useState<Stage>("capture");
  const [analyzeNote, setAnalyzeNote] = useState<string>("");
  const [bookings, setBookings] = useState<ParsedBooking[]>([]);
  const [sourceLabel, setSourceLabel] = useState<string>("manual");
  const [rawText, setRawText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStage("capture");
    setBookings([]);
    setSourceLabel("manual");
    setRawText(null);
    setSaving(false);
    setAnalyzeNote("");
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleImagePicked = async (file: File | undefined, source: string) => {
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) {
      toast.error("Vain kuvatiedostot kelpaavat");
      return;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      toast.error(`Kuva on liian iso (max ${MAX_IMAGE_MB} MB)`);
      return;
    }
    setStage("analyzing");
    setAnalyzeNote("Pakataan kuvaa...");
    try {
      const dataUrl = await fileToJpegDataUrl(file);
      setAnalyzeNote("Gemini AI lukee ennakkotilauksia...");
      const res = await runImageBookings(dataUrl);
      if (!res.ok) {
        toast.error("AI-luenta epaonnistui: " + res.error);
        setStage("capture");
        return;
      }
      if (res.bookings.length === 0) {
        toast.warning("AI ei loytanyt ennakkotilauksia kuvasta");
        setStage("capture");
        return;
      }
      setBookings(res.bookings);
      setSourceLabel(source);
      setRawText(res.raw_text ?? null);
      setStage("review");
    } catch (e) {
      toast.error("Kuvan kasittely epaonnistui");
      setStage("capture");
    }
  };

  const handleDocPicked = async (file: File | undefined) => {
    if (!file) return;
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isText =
      file.type.startsWith("text/") ||
      file.type === "application/json" ||
      /\.(txt|csv|json|md|html?|xml)$/i.test(file.name);

    if (!isPdf && !isText) {
      toast.error("Tuetut: TXT, CSV, JSON, HTML, PDF");
      return;
    }
    const maxMb = isPdf ? MAX_PDF_MB : MAX_TEXT_MB;
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`Tiedosto on liian iso (max ${maxMb} MB)`);
      return;
    }

    setStage("analyzing");
    try {
      let res;
      if (isPdf) {
        setAnalyzeNote("Gemini AI lukee PDF:aa...");
        const dataUrl = await fileToDataUrl(file);
        res = await runPdfBookings(dataUrl);
        setSourceLabel("pdf");
      } else {
        setAnalyzeNote("Jasennetaan tekstia...");
        const text = await fileToText(file);
        res = parseTextToBookings(text);
        setSourceLabel("text");
        setRawText(text.slice(0, 1000));
      }
      if (!res.ok) {
        toast.error("Luenta epaonnistui: " + res.error);
        setStage("capture");
        return;
      }
      if (res.bookings.length === 0) {
        toast.warning("Ei loydetty ennakkotilauksia");
        setStage("capture");
        return;
      }
      setBookings(res.bookings);
      if (isPdf) setRawText(res.raw_text ?? null);
      setStage("review");
    } catch (e) {
      toast.error("Tiedoston kasittely epaonnistui");
      setStage("capture");
    }
  };

  const handleManual = () => {
    setBookings([
      { tolppa: "", pickup_at: new Date(Date.now() + 30 * 60_000).toISOString(), confidence: 1 },
    ]);
    setSourceLabel("manual");
    setStage("review");
  };

  const updateBooking = (i: number, patch: Partial<ParsedBooking>) => {
    setBookings((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  };

  const removeBooking = (i: number) => {
    setBookings((prev) => prev.filter((_, idx) => idx !== i));
  };

  const addBooking = () => {
    setBookings((prev) => [
      ...prev,
      { tolppa: "", pickup_at: new Date(Date.now() + 30 * 60_000).toISOString(), confidence: 1 },
    ]);
  };

  const handleSave = async () => {
    const valid = bookings.filter((b) => b.tolppa.trim() && b.pickup_at);
    if (valid.length === 0) {
      toast.error("Yhtaan kelvollista tilausta (tolppa + aika pakollisia)");
      return;
    }
    setSaving(true);
    const result = await insertBookings(valid, { source: sourceLabel, raw_text: rawText });
    setSaving(false);
    if (result.ok) {
      toast.success(`Tallennettu ${result.inserted} ennakkotilausta`);
      onSaved?.();
      reset();
      onOpenChange(false);
    } else {
      toast.error("Tallennus epaonnistui: " + (result.error ?? "tuntematon"));
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="bottom" className="h-[92vh] overflow-y-auto bg-slate-900 border-slate-700">
        <SheetHeader>
          <SheetTitle className="text-2xl font-black text-foreground">
            {stage === "capture" && "Lisaa ennakkotilaukset"}
            {stage === "analyzing" && "AI lukee ennakkoja..."}
            {stage === "review" && `Tarkista ${bookings.length} ennakkoa`}
          </SheetTitle>
        </SheetHeader>

        {stage === "capture" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Lisaa kuva, PDF tai tekstitiedosto ennakkotilauslistasta.
              AI lukee jokaisen tilauksen tolpan ja noutoajan.
            </p>

            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleImagePicked(e.target.files?.[0], "camera")}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleImagePicked(e.target.files?.[0], "image")}
            />
            <input
              ref={docRef}
              type="file"
              accept=".txt,.csv,.json,.md,.html,.htm,.xml,.pdf,text/plain,text/csv,text/html,application/json,application/pdf,application/xml"
              className="hidden"
              onChange={(e) => handleDocPicked(e.target.files?.[0])}
            />

            <Button
              onClick={() => cameraRef.current?.click()}
              className="w-full h-20 text-xl font-bold bg-primary"
            >
              <Camera className="h-7 w-7 mr-3" />
              Ota kuva ennakkolistasta
            </Button>

            <Button
              onClick={() => fileRef.current?.click()}
              variant="outline"
              className="w-full h-16 text-lg font-bold border-slate-600"
            >
              <Upload className="h-6 w-6 mr-3" />
              Lisaa kuvatiedosto
            </Button>

            <div className="pt-2 border-t border-slate-700" />

            <Button
              onClick={() => docRef.current?.click()}
              variant="outline"
              className="w-full h-16 text-lg font-bold border-slate-600"
            >
              <FileText className="h-6 w-6 mr-3" />
              Lisaa TXT / HTML / PDF
            </Button>

            <div className="pt-2 border-t border-slate-700" />

            <Button
              onClick={handleManual}
              variant="ghost"
              className="w-full text-muted-foreground"
            >
              <Plus className="h-4 w-4 mr-2" /> Lisaa kasin yksi tilaus
            </Button>
          </div>
        )}

        {stage === "analyzing" && (
          <div className="mt-10 flex flex-col items-center justify-center gap-4 py-10">
            <Loader2 className="h-16 w-16 animate-spin text-primary" />
            <p className="text-lg font-bold text-center px-4">{analyzeNote}</p>
          </div>
        )}

        {stage === "review" && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="border-slate-600">
                Lahde: {sourceLabel}
              </Badge>
              <Button onClick={addBooking} size="sm" variant="ghost" className="text-xs">
                <Plus className="h-3 w-3 mr-1" /> Lisaa rivi
              </Button>
            </div>

            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {bookings.map((b, i) => (
                <Card key={i} className="p-3 bg-slate-800 border-slate-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs uppercase text-muted-foreground">
                      Rivi {i + 1}
                      {typeof b.confidence === "number" && (
                        <span className="ml-2 text-[10px]">
                          AI {Math.round((b.confidence ?? 0) * 100)}%
                        </span>
                      )}
                    </Label>
                    <Button
                      onClick={() => removeBooking(i)}
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <Input
                    value={b.tolppa}
                    onChange={(e) => updateBooking(i, { tolppa: e.target.value })}
                    placeholder="Tolppa / osoite"
                    className="bg-slate-900 border-slate-600 text-base font-semibold"
                    maxLength={100}
                  />
                  <Input
                    type="datetime-local"
                    value={isoToLocalInput(b.pickup_at)}
                    onChange={(e) => updateBooking(i, { pickup_at: inputToIso(e.target.value) })}
                    className="bg-slate-900 border-slate-600"
                  />
                </Card>
              ))}
            </div>

            <div className="flex gap-2 pt-3 sticky bottom-0 bg-slate-900 pb-2">
              <Button
                onClick={() => setStage("capture")}
                variant="outline"
                className="flex-1 border-slate-600"
                disabled={saving}
              >
                <X className="h-4 w-4 mr-2" /> Peruuta
              </Button>
              <Button
                onClick={handleSave}
                className="flex-1 bg-primary text-primary-foreground"
                disabled={saving || bookings.length === 0}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Tallenna {bookings.length}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default PrebookingScanner;
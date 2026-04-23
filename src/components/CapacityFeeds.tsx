import { useState } from "react";
import { Ship, TrainFront, Flame, Snowflake, Ticket, CheckCircle, MinusCircle, AlertTriangle, Pencil, X, Save, ExternalLink, Plus, Trash2, Plane } from "lucide-react";
import { useDashboard, CrowdOverride, DispatchEdit } from "@/context/DashboardContext";
import { EventInfo } from "@/lib/types";
import { TRAIN_STATIONS, type TrainStation } from "@/lib/fintraffic";
import { addManualEvent, deleteManualEvent, triggerEventScrape } from "@/lib/events";
import { toast } from "sonner";
import EventsTimeline from "@/components/EventsTimeline";
import DetailSheet from "@/components/DetailSheet";
import type { TimelineItem } from "@/lib/eventCategories";
import type { FlightArrival, ShipArrival, TrainDelay, SportsEvent } from "@/lib/types";

/**
 * Merkittävä-suodatus: tapahtuma kelpaa jos jokin näistä pätee:
 *  - Manuaalisesti lisätty (kuljettajan override)
 *  - Venue-kapasiteetti >= 300 hlö
 *  - Loppuunmyyty TAI korkea kysyntä (red demand level)
 *  - Arvioitu yleisö >= 300 hlö
 * Tämä karsii baarit, kahvilat ja pienet klubit oletuksesta.
 */
const SIGNIFICANT_CAPACITY_THRESHOLD = 300;
function isSignificantEvent(ev: EventInfo): boolean {
  // Manuaaliset AINA näkyviin (id ei sisällä "scraped")
  if (ev.id && !ev.id.includes("scraped") && !ev.id.startsWith("fallback")) return true;
  if (ev.soldOut) return true;
  if (ev.demandLevel === "red") return true;
  if (ev.capacity && ev.capacity >= SIGNIFICANT_CAPACITY_THRESHOLD) return true;
  if (ev.estimatedAttendance && ev.estimatedAttendance >= SIGNIFICANT_CAPACITY_THRESHOLD) return true;
  return false;
}

/* ── Deep Link URL Mapping (VERIFIED direct pages, not homepages) ── */
const DEEP_LINKS: Record<string, string> = {
  finavia: "https://www.finavia.fi/fi/lentoasemat/helsinki-vantaa/lennot?tab=arr",
  junat: "https://junalahdot.fi/helsinki",
  vr: "https://www.vr.fi/liikennetilanne",
  satama: "https://averio.fi/laivat",
  messukeskus: "https://messukeskus.com/tapahtumat/",
  olympiastadion: "https://www.stadion.fi/tapahtumat",
  jaahalli: "https://helsinginjaahalli.fi/tapahtumat",
  "helsinki halli": "https://www.veikkausarena.fi/",
  saa: "https://www.ilmatieteenlaitos.fi/sadealueet-suomessa",
  ooppera: "https://oopperabaletti.fi/kalenteri/",
  musiikkitalo: "https://www.musiikkitalo.fi/tapahtumat",
  dipoli: "https://www.aalto.fi/fi/sijainnit/dipoli",
};

function getDeepLinkForVenue(venue: string): string | null {
  const v = venue.toLowerCase();
  if (v.includes("olympiastadion")) return DEEP_LINKS.olympiastadion;
  if (v.includes("jäähalli") || v.includes("nordis")) return DEEP_LINKS.jaahalli;
  if (v.includes("helsinki halli") || v.includes("hartwall")) return DEEP_LINKS["helsinki halli"];
  if (v.includes("messukeskus") || v.includes("expo")) return DEEP_LINKS.messukeskus;
  if (v.includes("ooppera") || v.includes("kansallisooppera")) return DEEP_LINKS.ooppera;
  if (v.includes("musiikkitalo")) return DEEP_LINKS.musiikkitalo;
  if (v.includes("dipoli")) return DEEP_LINKS.dipoli;
  return null;
}

function getDeepLinkForFeed(type: "ship" | "train"): string {
  return type === "ship" ? DEEP_LINKS.satama : DEEP_LINKS.junat;
}

interface FeedItem {
  icon: React.ReactNode;
  title: string;
  titleExtra?: React.ReactNode;
  detail: string;
  subDetail?: string;
  time: string;
  status: "green" | "amber" | "red";
  badge?: string;
  demandTag?: string;
  deepLink?: string;
  isLive?: boolean;
}

const statusBorder = {
  green: "border-l-primary",
  amber: "border-l-accent",
  red: "border-l-destructive",
};

const statusTimeColor = {
  green: "text-primary text-glow-green",
  amber: "text-accent text-glow-amber",
  red: "text-destructive text-glow-red",
};

const FeedCard = ({ icon, title, titleExtra, detail, subDetail, time, status, badge, demandTag, deepLink, isLive }: FeedItem) => (
  <div
    className={`flex items-center gap-4 rounded-xl bg-card border-l-4 ${statusBorder[status]} border border-border px-5 py-5 ${deepLink ? "cursor-pointer active:scale-[0.98] transition-all" : ""}`}
    onClick={() => deepLink && window.open(deepLink, "_blank", "noopener,noreferrer")}
  >
    <div className={`shrink-0 ${status === "red" ? "text-destructive" : status === "amber" ? "text-accent" : "text-primary"}`}>
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className="font-black text-xl text-foreground truncate">{title}</p>
        {titleExtra}
        {/* Live/Stale status dot */}
        {isLive !== undefined && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${isLive ? "text-primary" : "text-muted-foreground/50"}`}>
            <span className={`h-2 w-2 rounded-full ${isLive ? "bg-primary animate-pulse" : "bg-muted-foreground/30"}`} />
            {isLive ? "Live" : "Aikataulu"}
          </span>
        )}
      </div>
      <p className="text-base text-muted-foreground font-bold mt-0.5">{detail}</p>
      {subDetail && <p className="text-sm text-muted-foreground/70 mt-0.5">{subDetail}</p>}
      {demandTag && (
        <span className={`inline-block mt-1.5 text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded-md ${
          demandTag.includes("LOPPUUNMYYTY") || demandTag.includes("KORKEA")
            ? "bg-destructive/20 text-destructive"
            : demandTag.includes("PREMIUM")
            ? "bg-accent/20 text-accent"
            : "bg-muted text-muted-foreground"
        }`}>
          {demandTag}
        </span>
      )}
      {badge && (
        <span className="inline-block mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 bg-muted px-2 py-0.5 rounded">
          {badge}
        </span>
      )}
    </div>
    <div className="flex flex-col items-end gap-1 shrink-0">
      {time && (
        <span className={`text-4xl font-mono font-black ${statusTimeColor[status]}`}>
          {time}
        </span>
      )}
      {deepLink && (
        <ExternalLink className="h-4 w-4 text-muted-foreground/50" />
      )}
    </div>
  </div>
);
function getHeatIcon(estimatedPax?: number) {
  if (!estimatedPax) return null;
  if (estimatedPax > 2000) return <Flame className="h-6 w-6 text-destructive animate-pulse" />;
  if (estimatedPax < 500) return <Snowflake className="h-5 w-5 text-primary" />;
  return null;
}

/* ── Dispatch Edit Modal ── */

interface EditModalProps {
  event: EventInfo;
  dispatchEdit?: DispatchEdit;
  onSave: (edit: DispatchEdit) => void;
  onClose: () => void;
}

const DispatchEditModal = ({ event, dispatchEdit, onSave, onClose }: EditModalProps) => {
  const [name, setName] = useState(dispatchEdit?.name || event.name);
  const [endTime, setEndTime] = useState(dispatchEdit?.endTime || "");
  const [pax, setPax] = useState<number>(dispatchEdit?.pax ?? 0);

  const handleSave = () => {
    onSave({ name, endTime: endTime || undefined, pax: pax || undefined });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 flex flex-col" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black text-foreground uppercase tracking-wide">
            ✏️ Dispatch Override
          </h2>
          <button onClick={onClose} className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center">
            <X className="h-6 w-6 text-muted-foreground" />
          </button>
        </div>

        {/* Event Name */}
        <div className="space-y-2">
          <label className="text-sm font-black uppercase tracking-widest text-muted-foreground">
            Tapahtuman Nimi
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border-2 border-border bg-card px-4 py-4 text-xl font-bold text-foreground focus:border-primary focus:outline-none"
          />
        </div>

        {/* End Time */}
        <div className="space-y-2">
          <label className="text-sm font-black uppercase tracking-widest text-muted-foreground">
            Purkuaika (Päättymisaika)
          </label>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full rounded-xl border-2 border-border bg-card px-4 py-4 text-4xl font-mono font-black text-accent text-center focus:border-accent focus:outline-none"
          />
        </div>

        {/* Pax */}
        <div className="space-y-2">
          <label className="text-sm font-black uppercase tracking-widest text-muted-foreground">
            Väkimäärä (Arvio)
          </label>
          <input
            type="number"
            value={pax || ""}
            onChange={(e) => setPax(Number(e.target.value))}
            placeholder="0"
            className="w-full rounded-xl border-2 border-border bg-card px-4 py-4 text-3xl font-black text-foreground text-center focus:border-primary focus:outline-none"
          />
          {/* Quick Pax Buttons */}
          <div className="flex gap-2 mt-2">
            {[1000, 3000, 10000].map((v) => (
              <button
                key={v}
                onClick={() => setPax(v)}
                className={`flex-1 rounded-xl border-2 min-h-[48px] font-black text-lg transition-all active:scale-95 ${
                  pax === v
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border bg-muted text-muted-foreground"
                }`}
              >
                {v >= 10000 ? "10k+" : v.toLocaleString()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 px-5 pb-6 pt-2">
        <button
          onClick={onClose}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-destructive bg-destructive/15 min-h-[56px] font-black text-lg text-destructive active:scale-95 transition-transform"
        >
          <X className="h-6 w-6" />
          PERUUTA
        </button>
        <button
          onClick={handleSave}
          className="flex-[2] flex items-center justify-center gap-2 rounded-xl bg-primary min-h-[56px] font-black text-lg text-primary-foreground active:scale-95 transition-transform glow-green"
        >
          <Save className="h-6 w-6" />
          TALLENNA
        </button>
      </div>
    </div>
  );
};

/* ── Event Card with Tactical Bar ── */

interface EventCardProps {
  event: EventInfo;
  override: CrowdOverride | undefined;
  onOverride: (override: CrowdOverride) => void;
  dispatchEdit?: DispatchEdit;
  onEdit: () => void;
  isLive?: boolean;
}

const EventCard = ({ event, override, onOverride, dispatchEdit, onEdit, isLive }: EventCardProps) => {
  const isRush = override === "rush";
  const isQuiet = override === "quiet";
  const isVerified = !!dispatchEdit;
  const deepLink = getDeepLinkForVenue(event.venue);

  const displayName = dispatchEdit?.name || event.name;
  // Näytä paattymisaika (purkuaika) ensisijaisesti - kuljettajalle tarkein
  const endTime = dispatchEdit?.endTime || event.endTime || "";
  const startTime = event.startTime || "";
  const displayTime = endTime || startTime;
  const isShowingEndTime = !!endTime;
  const showBothTimes = !!endTime && !!startTime && startTime !== endTime;

  // Tayttoaste: dispatch override > API-arvio > ei nayteta
  const attendanceCount = dispatchEdit?.pax ?? event.estimatedAttendance;
  const capacity = event.capacity;
  const loadPct = capacity && attendanceCount
    ? Math.min(100, Math.round((attendanceCount / capacity) * 100))
    : null;

  const cardStatus: "green" | "amber" | "red" = isRush
    ? "red"
    : isQuiet
    ? "green"
    : (event.demandLevel || (event.soldOut ? "red" : "amber"));

  const bgClass = isRush
    ? "bg-destructive/15 border-destructive/40"
    : isQuiet
    ? "bg-muted/50 border-border opacity-60"
    : "bg-card border-border";

  return (
    <div className={`rounded-xl border-l-4 ${statusBorder[cardStatus]} border ${bgClass} transition-all duration-300`}>
      {/* Top badges row */}
      <div className="flex justify-between items-center px-4 pt-3">
        <div className="flex gap-2 items-center">
          {isVerified && (
            <span className="text-[11px] font-black uppercase tracking-widest text-accent bg-accent/15 border border-accent/30 px-2.5 py-1 rounded-md">
              ✅ KESKUS VAHVISTANUT
            </span>
          )}
          {isRush && (
            <span className="text-[11px] font-black uppercase tracking-widest text-destructive bg-destructive/20 px-2.5 py-1 rounded-md animate-pulse">
              🔥 LIVE JONO
            </span>
          )}
          {/* Live/Stale status */}
          {isLive !== undefined && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${isLive ? "text-primary" : "text-muted-foreground/50"}`}>
              <span className={`h-2 w-2 rounded-full ${isLive ? "bg-primary animate-pulse" : "bg-muted-foreground/30"}`} />
              {isLive ? "Live Data" : "Aikataulu"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {deepLink && (
            <button
              onClick={(e) => { e.stopPropagation(); window.open(deepLink, "_blank", "noopener,noreferrer"); }}
              className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center border border-border active:bg-foreground/10 transition-colors"
              title="Avaa lähde"
            >
              <ExternalLink className={`h-4 w-4 text-muted-foreground ${!isLive ? "animate-pulse" : ""}`} />
            </button>
          )}
          <button
            onClick={onEdit}
            className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center border border-border active:bg-foreground/10 transition-colors"
          >
            <Pencil className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 px-5 pt-1 pb-3">
        <div className={`shrink-0 ${cardStatus === "red" ? "text-destructive" : cardStatus === "amber" ? "text-accent" : "text-primary"}`}>
          <Ticket className="h-7 w-7" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`font-black text-xl truncate ${isQuiet ? "text-muted-foreground" : "text-foreground"}`}>
            {displayName}
          </p>
          <p className={`text-base font-bold mt-0.5 ${isQuiet ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
            {event.venue}
          </p>
          {dispatchEdit?.pax && (
            <p className="text-base font-black text-primary mt-0.5">
              ~{dispatchEdit.pax.toLocaleString()} hlö
            </p>
          )}
          {!dispatchEdit?.pax && attendanceCount && capacity && (
            <p className="text-base font-black text-primary mt-0.5">
              ~{attendanceCount.toLocaleString("fi-FI")} / {capacity.toLocaleString("fi-FI")} hlö
              {loadPct !== null && (
                <span className={`ml-2 text-sm font-black ${loadPct >= 90 ? "text-destructive" : loadPct >= 70 ? "text-accent" : "text-muted-foreground"}`}>
                  ({loadPct}%)
                </span>
              )}
            </p>
          )}
          {event.endsIn > 0 && !isQuiet && !dispatchEdit?.endTime && (
            <p className="text-sm text-muted-foreground/70 mt-0.5">Päättyy {event.endsIn} min kuluttua</p>
          )}
          {!isRush && !isQuiet && event.demandTag && (
            <span className={`inline-block mt-1.5 text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded-md ${
              event.demandTag.includes("LOPPUUNMYYTY") || event.demandTag.includes("KORKEA")
                ? "bg-destructive/20 text-destructive"
                : event.demandTag.includes("PREMIUM")
                ? "bg-accent/20 text-accent"
                : "bg-muted text-muted-foreground"
            }`}>
              {event.demandTag}
            </span>
          )}
          {isQuiet && (
            <span className="inline-block mt-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground/50">
              OHI / HILJAINEN
            </span>
          )}
        </div>
        {displayTime && (
          <div className="flex flex-col items-end shrink-0">
            <span className={`text-[9px] font-black uppercase tracking-widest ${
              isQuiet ? "text-muted-foreground/40" : "text-muted-foreground"
            }`}>
              {isShowingEndTime ? "Päättyy" : "Alkaa"}
            </span>
            <span className={`text-4xl font-mono font-black ${
              isQuiet
                ? "text-muted-foreground/40"
                : isShowingEndTime
                ? "text-accent text-glow-amber"
                : statusTimeColor[cardStatus]
            }`}>
              {displayTime}
            </span>
            {showBothTimes && (
              <span className={`text-[10px] font-bold mt-0.5 ${
                isQuiet ? "text-muted-foreground/40" : "text-muted-foreground/70"
              }`}>
                Alkoi {startTime}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tactical Bar */}
      <div className="flex gap-2 px-4 pb-4">
        <button
          onClick={() => onOverride("quiet")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl font-black text-sm min-h-[48px] transition-all active:scale-95 ${
            override === "quiet"
              ? "bg-primary/20 border-2 border-primary text-primary"
              : "bg-muted border-2 border-transparent text-muted-foreground hover:border-primary/30"
          }`}
        >
          <CheckCircle className="h-5 w-5" />
          OHI
        </button>
        <button
          onClick={() => onOverride("normal")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl font-black text-sm min-h-[48px] transition-all active:scale-95 ${
            override === "normal" || !override
              ? "bg-accent/15 border-2 border-accent/40 text-accent"
              : "bg-muted border-2 border-transparent text-muted-foreground hover:border-accent/30"
          }`}
        >
          <MinusCircle className="h-5 w-5" />
          NORMAALI
        </button>
        <button
          onClick={() => onOverride("rush")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl font-black text-sm min-h-[48px] transition-all active:scale-95 ${
            override === "rush"
              ? "bg-destructive/25 border-2 border-destructive text-destructive animate-pulse glow-red"
              : "bg-muted border-2 border-transparent text-muted-foreground hover:border-destructive/30"
          }`}
        >
          <AlertTriangle className="h-5 w-5" />
          JONO!
        </button>
      </div>
    </div>
  );
};

/* ── Upcoming Event Card (compact, for next 7 days) ── */

const UpcomingEventCard = ({ event, onDelete }: { event: EventInfo; onDelete: () => void }) => {
  const isManual = event.id && !event.id.includes("scraped");
  // Tarkista onko start_time isompi paivaa eteenpain - naytetaan paivamaara
  const startLabel = event.startTime ? event.startTime : "—";
  const endLabel = event.endTime ? event.endTime : "";
  const loadPct = event.capacity && event.estimatedAttendance
    ? Math.min(100, Math.round((event.estimatedAttendance / event.capacity) * 100))
    : null;
  const levelClass = event.demandLevel === "red"
    ? "border-l-destructive"
    : event.demandLevel === "amber"
    ? "border-l-accent"
    : "border-l-primary";

  return (
    <div className={`rounded-xl bg-card border-l-4 ${levelClass} border border-border px-4 py-3`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-black text-base text-foreground truncate">{event.name}</p>
          <p className="text-sm text-muted-foreground font-bold mt-0.5">{event.venue}</p>
          {loadPct !== null && (
            <p className="text-xs font-black text-primary mt-1">
              ~{event.estimatedAttendance?.toLocaleString("fi-FI")} / {event.capacity?.toLocaleString("fi-FI")} hlö
              <span className={`ml-1.5 ${loadPct >= 90 ? "text-destructive" : loadPct >= 70 ? "text-accent" : "text-muted-foreground"}`}>
                ({loadPct}%)
              </span>
            </p>
          )}
          {event.demandTag && (
            <span className={`inline-block mt-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
              event.demandTag.includes("LOPPUUNMYYTY") || event.demandTag.includes("KORKEA")
                ? "bg-destructive/20 text-destructive"
                : event.demandTag.includes("PREMIUM")
                ? "bg-accent/20 text-accent"
                : "bg-muted text-muted-foreground"
            }`}>
              {event.demandTag}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span className="text-2xl font-mono font-black text-foreground">{startLabel}</span>
          {endLabel && <span className="text-[10px] font-bold text-muted-foreground/70">→ {endLabel}</span>}
          {isManual && (
            <button
              onClick={onDelete}
              className="mt-1 h-7 w-7 rounded-md bg-destructive/15 flex items-center justify-center"
              title="Poista"
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/* ── Add Event Modal (manual entry) ── */

const KNOWN_VENUES = [
  { name: "Suomen Kansallisooppera", capacity: 1350 },
  { name: "Helsingin Jäähalli", capacity: 8200 },
  { name: "Helsinki Halli", capacity: 15500 },
  { name: "Olympiastadion", capacity: 36000 },
  { name: "Musiikkitalo", capacity: 1700 },
  { name: "Messukeskus", capacity: 12000 },
  { name: "Helsingin Kaupunginteatteri", capacity: 1120 },
  { name: "Suomen Kansallisteatteri", capacity: 880 },
  { name: "Tanssin Talo", capacity: 700 },
  { name: "Savoy-teatteri", capacity: 700 },
  { name: "Bolt Arena", capacity: 10770 },
];

const CUSTOM_VENUE = "__custom__";

const AddEventModal = ({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) => {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState("");
  const [venue, setVenue] = useState(KNOWN_VENUES[0].name);
  const [customVenue, setCustomVenue] = useState("");
  const [customCapacity, setCustomCapacity] = useState<number>(0);
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("21:30");
  const [pax, setPax] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  const isCustom = venue === CUSTOM_VENUE;
  const venueObj = KNOWN_VENUES.find((v) => v.name === venue);
  const finalVenueName = isCustom ? customVenue.trim() : venue;
  const capacity = isCustom ? (customCapacity || undefined) : venueObj?.capacity;

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Anna tapahtuman nimi");
      return;
    }
    if (isCustom && !finalVenueName) {
      toast.error("Anna paikan nimi");
      return;
    }
    setSaving(true);
    // Helsinki time -> ISO with offset (yksinkertainen +03:00 / +02:00 detection)
    const offset = new Date().getTimezoneOffset() === -180 ? "+03:00" : "+02:00";
    const start_time = `${date}T${startTime}:00${offset}`;
    const end_time = endTime ? `${date}T${endTime}:00${offset}` : undefined;
    const r = await addManualEvent({
      name: name.trim(),
      venue: finalVenueName,
      start_time,
      end_time,
      capacity,
      tickets_sold: pax || undefined,
    });
    setSaving(false);
    if (r.ok) {
      toast.success("Tapahtuma lisätty");
      onSaved();
    } else {
      toast.error("Tallennus epäonnistui", { description: r.error });
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 flex flex-col" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black text-foreground uppercase tracking-wide">+ Lisää tapahtuma</h2>
          <button onClick={onClose} className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center">
            <X className="h-6 w-6 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Nimi</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Esim. Bruce Springsteen"
            className="w-full rounded-xl border-2 border-border bg-card px-4 py-4 text-lg font-bold text-foreground focus:border-primary focus:outline-none"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Paikka</label>
          <select
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            className="w-full rounded-xl border-2 border-border bg-card px-4 py-4 text-lg font-bold text-foreground focus:border-primary focus:outline-none"
          >
            {KNOWN_VENUES.map((v) => (
              <option key={v.name} value={v.name}>{v.name} ({v.capacity.toLocaleString("fi-FI")})</option>
            ))}
            <option value={CUSTOM_VENUE}>+ Muu paikka (esim. taksitolppa)…</option>
          </select>
          {isCustom && (
            <div className="grid grid-cols-3 gap-2 mt-2">
              <input
                type="text"
                value={customVenue}
                onChange={(e) => setCustomVenue(e.target.value)}
                placeholder="Esim. OP Vallila"
                className="col-span-2 rounded-xl border-2 border-accent bg-card px-3 py-3 text-base font-bold text-foreground focus:outline-none"
              />
              <input
                type="number"
                value={customCapacity || ""}
                onChange={(e) => setCustomCapacity(Number(e.target.value))}
                placeholder="Pax"
                className="rounded-xl border-2 border-border bg-card px-2 py-3 text-base font-black text-center text-foreground focus:border-primary focus:outline-none"
              />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Päivä</label>
          <input
            type="date"
            value={date}
            min={today}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border-2 border-border bg-card px-4 py-4 text-lg font-bold text-foreground focus:border-primary focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Alkaa</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-xl border-2 border-border bg-card px-3 py-4 text-2xl font-mono font-black text-center text-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Päättyy</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-xl border-2 border-border bg-card px-3 py-4 text-2xl font-mono font-black text-center text-accent focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
            Myydyt liput {capacity && <span className="text-muted-foreground/60">/ {capacity.toLocaleString("fi-FI")}</span>}
          </label>
          <input
            type="number"
            value={pax || ""}
            onChange={(e) => setPax(Number(e.target.value))}
            placeholder="Esim. 8000"
            className="w-full rounded-xl border-2 border-border bg-card px-4 py-4 text-2xl font-black text-center text-foreground focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div className="flex gap-3 px-5 pb-6 pt-2">
        <button
          onClick={onClose}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-destructive bg-destructive/15 min-h-[56px] font-black text-lg text-destructive active:scale-95"
        >
          <X className="h-6 w-6" /> PERUUTA
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-[2] flex items-center justify-center gap-2 rounded-xl bg-primary min-h-[56px] font-black text-lg text-primary-foreground active:scale-95 disabled:opacity-50"
        >
          <Save className="h-6 w-6" /> {saving ? "TALLENNETAAN…" : "TALLENNA"}
        </button>
      </div>
    </div>
  );
};

/* ── Detail Sheet for Timeline items (yhdistaa kaikki lahteet) ── */
const TimelineDetailSheet = ({ item, onClose }: { item: TimelineItem | null; onClose: () => void }) => {
  if (!item) return null;

  // Yhteinen otsikko + tagi-renderointi, kohteen mukaan tarkat kentat
  type Field = { label: string; value: string; highlight?: boolean };
  let icon: React.ReactNode = <Ticket className="h-7 w-7" />;
  let title = item.title;
  let subtitle = item.subtitle;
  let fields: Field[] = [];
  let externalUrl: string | undefined;
  let externalLabel: string | undefined;

  switch (item.raw.kind) {
    case "flight": {
      const f = item.raw.data as FlightArrival;
      icon = <Plane className="h-7 w-7" />;
      title = `${f.flightNumber} • ${f.airline}`;
      subtitle = `${f.origin} → Helsinki-Vantaa`;
      fields = [
        { label: "Saapumisaika (ETA)", value: f.estimatedTime, highlight: true },
        { label: "Aikataulun mukainen", value: f.scheduledTime },
        ...(f.delayMinutes !== 0
          ? [{ label: "Viive", value: `${f.delayMinutes > 0 ? "+" : ""}${f.delayMinutes} min` }]
          : []),
        ...(f.terminal ? [{ label: "Terminaali", value: f.terminal }] : []),
        ...(f.gate ? [{ label: "Portti", value: f.gate }] : []),
        ...(f.belt ? [{ label: "Matkatavarahihna", value: f.belt }] : []),
        { label: "Kysyntä", value: f.demandTag },
      ];
      externalUrl = "https://www.finavia.fi/fi/lentoasemat/helsinki-vantaa/saapuvat-lennot";
      externalLabel = "Avaa Finavia";
      break;
    }
    case "train": {
      const t = item.raw.data as TrainDelay;
      icon = <TrainFront className="h-7 w-7" />;
      title = `${t.line} ${t.origin}`;
      subtitle = `Saapuu ${item.subtitle}`;
      fields = [
        { label: "Saapumisaika", value: t.arrivalTime, highlight: true },
        { label: "Myöhästyminen", value: t.delayMinutes > 0 ? `+${t.delayMinutes} min` : "Aikataulussa" },
      ];
      externalUrl = "https://junalahdot.fi/helsinki";
      externalLabel = "Avaa junalahdot.fi";
      break;
    }
    case "ship": {
      const s = item.raw.data as ShipArrival;
      icon = <Ship className="h-7 w-7" />;
      title = s.ship;
      subtitle = s.harbor;
      fields = [
        { label: "ETA", value: s.eta, highlight: true },
        { label: "Matkustajia (live)", value: s.estimatedPax ? `~${s.estimatedPax.toLocaleString("fi-FI")}` : "—" },
        { label: "Maksimikapasiteetti", value: s.pax.toLocaleString("fi-FI") },
      ];
      externalUrl = "https://averio.fi/laivat";
      externalLabel = "Avaa averio.fi";
      break;
    }
    case "sports": {
      const sp = item.raw.data as SportsEvent;
      icon = <Ticket className="h-7 w-7" />;
      title = `${sp.homeTeam} – ${sp.awayTeam}`;
      subtitle = `${sp.league} • ${sp.venue}`;
      fields = [
        { label: "Alkamisaika", value: sp.startTime, highlight: true },
        { label: "Yleisöarvio", value: `~${sp.expectedAttendance.toLocaleString("fi-FI")} hlö` },
        { label: "Kapasiteetti", value: sp.capacity.toLocaleString("fi-FI") },
        { label: "Täyttö", value: `${Math.round((sp.expectedAttendance / sp.capacity) * 100)}%` },
        { label: "Kysyntä", value: sp.demandTag },
      ];
      externalUrl = getDeepLinkForVenue(sp.venue) ?? undefined;
      externalLabel = externalUrl ? "Avaa tapahtumapaikka" : undefined;
      break;
    }
    case "event":
    default: {
      const e = item.raw.data as EventInfo;
      icon = <Ticket className="h-7 w-7" />;
      title = e.name;
      subtitle = e.venue;
      fields = [
        ...(e.startTime ? [{ label: "Alkamisaika", value: e.startTime, highlight: true }] : []),
        ...(e.endTime ? [{ label: "Päättyy", value: e.endTime }] : []),
        ...(e.capacity ? [{ label: "Kapasiteetti", value: e.capacity.toLocaleString("fi-FI") }] : []),
        ...(e.estimatedAttendance ? [{ label: "Yleisöarvio", value: `~${e.estimatedAttendance.toLocaleString("fi-FI")} hlö` }] : []),
        { label: "Loppuunmyyty", value: e.soldOut ? "Kyllä" : "Ei" },
        ...(e.demandTag ? [{ label: "Kysyntä", value: e.demandTag }] : []),
      ];
      externalUrl = getDeepLinkForVenue(e.venue) ?? undefined;
      externalLabel = externalUrl ? "Avaa tapahtumapaikka" : undefined;
      break;
    }
  }

  return (
    <DetailSheet
      open
      onClose={onClose}
      icon={icon}
      title={title}
      subtitle={subtitle}
      fields={fields}
      externalUrl={externalUrl}
      externalLabel={externalLabel}
    />
  );
};

const CapacityFeeds = () => {
  const { state, lastFetch, trainStation, setTrainStation, refreshAll } = useDashboard();
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedTimelineItem, setSelectedTimelineItem] = useState<TimelineItem | null>(null);

  const editingEvent = editingEventId ? state.events.find((e) => e.id === editingEventId) : null;

  // Determine if data is "live" (fetched within 30 min)
  const isDataLive = lastFetch ? (Date.now() - lastFetch.getTime()) < 30 * 60 * 1000 : false;

  const shipFeeds: FeedItem[] = state.shipArrivals.map((s) => {
    const displayPax = s.estimatedPax ?? s.pax;
    const heatStatus: "green" | "amber" | "red" =
      displayPax > 2000 ? "red" : displayPax > 1000 ? "amber" : "green";

    return {
      icon: <Ship className="h-7 w-7" />,
      titleExtra: getHeatIcon(s.estimatedPax),
      title: s.ship,
      detail: s.estimatedPax
        ? `Tulossa: ~${s.estimatedPax.toLocaleString()} hlö`
        : `~${s.pax.toLocaleString()} hlö (kapasiteetti)`,
      subDetail: s.estimatedPax ? `Max: ${s.pax.toLocaleString()} • ${s.harbor}` : s.harbor,
      time: s.eta,
      status: heatStatus,
      badge: s.estimatedPax ? "Lähde: Averio/Port of Helsinki" : undefined,
      deepLink: getDeepLinkForFeed("ship"),
      isLive: !!s.estimatedPax && isDataLive,
    };
  });

  const stationName = TRAIN_STATIONS.find(s => s.code === trainStation)?.name || "Helsinki";

  const trainFeeds: FeedItem[] = state.trainDelays.map((t) => ({
    icon: <TrainFront className="h-7 w-7" />,
    title: `${t.line} ${t.origin} → ${stationName}`,
    detail: t.delayMinutes > 0 ? `Myöhässä +${t.delayMinutes} min` : "Aikataulussa",
    time: t.arrivalTime,
    status: (t.delayMinutes > 60 ? "red" : t.delayMinutes > 10 ? "amber" : "green") as "red" | "amber" | "green",
    deepLink: getDeepLinkForFeed("train"),
    isLive: isDataLive,
  }));

  return (
    <>
      <div className="mt-4 px-4 space-y-6">
        {shipFeeds.length > 0 && (
          <section>
            <h2 className="text-lg font-black uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
              <Ship className="h-5 w-5 text-primary" />
              Satamat (Laivat)
            </h2>
            <div className="flex flex-col gap-2">
              {shipFeeds.map((feed, i) => (
                <FeedCard key={`ship-${i}`} {...feed} />
              ))}
            </div>
          </section>
        )}

        {trainFeeds.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <TrainFront className="h-5 w-5 text-accent" />
                Junat (Kauko)
              </h2>
              <div className="flex gap-1">
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
            </div>
            <div className="flex flex-col gap-2">
              {trainFeeds.map((feed, i) => (
                <FeedCard key={`train-${i}`} {...feed} />
              ))}
            </div>
          </section>
        )}

        <EventsTimeline
          onSelect={setSelectedTimelineItem}
          onAddEvent={() => setShowAddForm(true)}
        />
      </div>

      {/* Edit Modal */}
      {editingEvent && (
        <DispatchEditModal
          event={editingEvent}
          onSave={() => {}}
          onClose={() => setEditingEventId(null)}
        />
      )}

      {showAddForm && (
        <AddEventModal
          onClose={() => setShowAddForm(false)}
          onSaved={() => { setShowAddForm(false); refreshAll(); }}
        />
      )}

      {/* Detail-paneeli aikajananakymalle */}
      <TimelineDetailSheet
        item={selectedTimelineItem}
        onClose={() => setSelectedTimelineItem(null)}
      />
    </>
  );
};

export default CapacityFeeds;

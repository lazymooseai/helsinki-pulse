/**
 * FeedbackButtons.tsx
 *
 * Kuljettajan palaute nykyisesta alueesta: "Alue hiljainen" / "Alue kuuma".
 * Palaute tallennetaan Supabase-tietokantaan jos yhteys on saatavilla.
 * Ilman Supabasea toimii paikallisesti (graceful degradation).
 *
 * Ominaisuudet:
 * - 5 minuutin cooldown (ei spammata tietokantaa)
 * - Tallennetaan trainStation + aikaleima + koordinaatit (jos saatavilla)
 * - Supabase-virhe ei nayta kayttajalle virhetta
 */

import { ThumbsDown, ThumbsUp, Clock } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useDashboard } from "@/context/DashboardContext";
import { supabase } from "@/integrations/supabase/client";

type VoteType = "hot" | "dead";

// Cooldown 5 minuuttia millisekunteina
const COOLDOWN_MS = 5 * 60 * 1000;
const STORAGE_KEY = "feedbackLastVote";

interface StoredVote {
  type: VoteType;
  timestamp: number;
}

function getStoredVote(): StoredVote | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function storeVote(type: VoteType): void {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ type, timestamp: Date.now() })
    );
  } catch {}
}

const FeedbackButtons = () => {
  const { trainStation, state } = useDashboard();
  const [voted, setVoted] = useState<VoteType | null>(null);
  const [cooldownSecs, setCooldownSecs] = useState(0);

  // Palauta edellinen aanestys sessiomuistista
  useEffect(() => {
    const stored = getStoredVote();
    if (!stored) return;
    const elapsed = Date.now() - stored.timestamp;
    if (elapsed < COOLDOWN_MS) {
      setVoted(stored.type);
      setCooldownSecs(Math.ceil((COOLDOWN_MS - elapsed) / 1000));
    }
  }, []);

  // Countdown-ajastin
  useEffect(() => {
    if (cooldownSecs <= 0) return;
    const timer = setInterval(() => {
      setCooldownSecs((prev) => {
        if (prev <= 1) {
          setVoted(null);
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSecs]);

  const formatCooldown = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
  };

  const handleVote = useCallback(async (type: VoteType) => {
    if (voted !== null) return;

    setVoted(type);
    storeVote(type);
    setCooldownSecs(Math.ceil(COOLDOWN_MS / 1000));

    // Toast-palaute kuljettajalle
    toast(
      type === "hot" ? "Merkitty kuumaksi" : "Merkitty hiljaiseksi",
      { description: "Kiitos tiedosta, kuski." }
    );

    // Tallenna Supabaseen (ei estä toimintaa jos epäonnistuu)
    try {
      await (supabase.from as any)("driver_feedback").insert({
        vote_type: type,
        station: trainStation,
        weather_condition: state.weather.condition,
        temp_c: state.weather.temp,
        rain_active: state.weather.rainModeActive,
        slippery_index: state.weather.slipperyIndex ?? 0,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      // Hiljainen virhe — palaute toimii ilman tietokantaakin
      console.warn("Feedback tallennus epaonnistui:", err);
    }
  }, [voted, trainStation, state.weather]);

  const isDisabled = voted !== null;

  return (
    <div className="flex flex-col gap-2 px-4 mt-4">
      <div className="flex gap-3">
        {/* Hiljainen-nappi */}
        <button
          onClick={() => handleVote("dead")}
          disabled={isDisabled}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl border-2 py-3 font-bold text-sm transition-all active:scale-[0.98]
            ${voted === "dead"
              ? "border-destructive bg-destructive/20 text-destructive"
              : "border-border bg-card text-muted-foreground hover:border-destructive hover:text-destructive"
            } disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          <ThumbsDown className="h-5 w-5" />
          Alue hiljainen
        </button>

        {/* Kuuma-nappi */}
        <button
          onClick={() => handleVote("hot")}
          disabled={isDisabled}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl border-2 py-3 font-bold text-sm transition-all active:scale-[0.98]
            ${voted === "hot"
              ? "border-primary bg-primary/20 text-primary"
              : "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary"
            } disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          <ThumbsUp className="h-5 w-5" />
          Alue kuuma
        </button>
      </div>

      {/* Cooldown-ilmaisin */}
      {cooldownSecs > 0 && (
        <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/70">
          <Clock className="h-3.5 w-3.5" />
          <span>Seuraava palaute: {formatCooldown(cooldownSecs)}</span>
        </div>
      )}
    </div>
  );
};

export default FeedbackButtons;

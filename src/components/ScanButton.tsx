/**
 * ScanButton.tsx
 *
 * Kelluva kamera-/skannausnappi dashboardin alareunassa.
 * Talla hetkella nayttaa "tulossa pian" -toastin.
 *
 * Tulevaisuudessa: kuljettaja voi skannata Taksi Helsinki
 * dispatch-nakyton josta AI lukee K+/T+/K-30/T-30 luvut
 * automaattisesti (OCR).
 */

import { Camera } from "lucide-react";
import { toast } from "sonner";
import { useDashboard } from "@/context/DashboardContext";

const ScanButton = () => {
  const { isLoading } = useDashboard();

  const handleScan = () => {
    // TODO: Tassa kaynnistetaan kameran kuvakaappaus + OCR-analyysi
    // kun Supabase Edge Function on valmis dispatch-nayton lukemiseen.
    toast("Skanneri tulossa pian", {
      description: "AI-nakoanalyysi tulee saataville tulevassa paivityksessa.",
    });
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-1">
      <button
        onClick={handleScan}
        disabled={isLoading}
        aria-label="Skannaa dispatch-naytto"
        className={`h-16 w-16 rounded-full bg-primary flex items-center justify-center shadow-2xl transition-all
          ${isLoading
            ? "opacity-50 cursor-not-allowed"
            : "glow-green active:scale-95"
          }`}
      >
        <Camera className="h-7 w-7 text-primary-foreground" />
      </button>
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Skannaa
      </span>
    </div>
  );
};

export default ScanButton;

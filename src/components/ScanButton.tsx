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

import { useState } from "react";
import { Camera } from "lucide-react";
import { useDashboard } from "@/context/DashboardContext";
import DispatchScanner from "./DispatchScanner";

const ScanButton = () => {
  const { isLoading } = useDashboard();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-1">
        <button
          onClick={() => setOpen(true)}
          disabled={isLoading}
          aria-label="Skannaa valityslaitteen naytto"
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
      <DispatchScanner open={open} onOpenChange={setOpen} />
    </>
  );
};

export default ScanButton;

import { AlertTriangle } from "lucide-react";
import { useDashboard } from "@/context/DashboardContext";

const alertTypeLabel: Record<string, string> = {
  train: "VR-MYÖHÄSTYMINEN",
  ship: "SUURI KYSYNTÄ",
  weather: "SÄÄVAROITUS",
  combined: "YHDISTELMÄHÄLYTYS",
  event: "TAPAHTUMA",
};

const JackpotAlert = () => {
  const { alerts, hasJackpot } = useDashboard();
  const jackpotAlerts = alerts.filter((a) => a.level === "jackpot");

  if (!hasJackpot) return null;

  return (
    <div className="mx-4 mt-4 flex flex-col gap-2">
      {jackpotAlerts.map((alert, i) => (
        <div
          key={i}
          className="rounded-xl border-2 animate-flash-border bg-destructive/10 px-5 py-4 glow-red"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-7 w-7 shrink-0 text-destructive animate-flash-icon mt-0.5" />
            <div>
              <p className="text-base font-black uppercase tracking-wide text-destructive text-glow-red">
                {alertTypeLabel[alert.type] || "HÄLYTYS"} — {alert.zone}
              </p>
              <p className="text-base font-bold text-foreground mt-1">{alert.reason}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default JackpotAlert;

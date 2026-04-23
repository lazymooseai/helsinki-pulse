import { X, AlertTriangle } from "lucide-react";
import { useHslAlerts } from "@/lib/hsl";

const HslTicker = () => {
  const { alerts, dismiss } = useHslAlerts(60000);

  if (alerts.length === 0) return null;

  return (
    <div className="px-4 space-y-1.5 mb-2">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-bold transition-all ${
            alert.isTransitCritical
              ? "border-destructive/50 bg-destructive/15 text-destructive"
              : "border-accent/40 bg-accent/10 text-accent"
          }`}
        >
          <AlertTriangle
            className={`h-4 w-4 mt-0.5 shrink-0 ${
              alert.isTransitCritical ? "text-destructive animate-flash-icon" : "text-accent"
            }`}
          />
          <div className="flex-1 min-w-0">
            <span className="uppercase tracking-wider text-xs font-black mr-2">
              {alert.isTransitCritical ? "🚨 HÄIRIÖ" : "⚠️ VAROITUS"}
            </span>
            <span className="text-foreground">{alert.headerText || alert.descriptionText}</span>
          </div>
          <button
            onClick={() => dismiss(alert.id)}
            className="shrink-0 rounded p-0.5 hover:bg-secondary transition-colors"
            aria-label="Sulje"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      ))}
    </div>
  );
};

export default HslTicker;

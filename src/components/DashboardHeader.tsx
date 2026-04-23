import { useEffect, useState } from "react";
import { CloudRain, Snowflake, Sun, Wind, Droplets, ExternalLink } from "lucide-react";
import { useDashboard } from "@/context/DashboardContext";
import ControlRoomDrawer from "@/components/ControlRoomDrawer";

const WEATHER_DEEP_LINK = "https://www.ilmatieteenlaitos.fi/sadealueet-suomessa";

const weatherIcons = {
  Rain: CloudRain,
  Snow: Snowflake,
  Clear: Sun,
};

const DashboardHeader = () => {
  const [time, setTime] = useState(new Date());
  const { state } = useDashboard();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = time.getHours().toString().padStart(2, "0");
  const minutes = time.getMinutes().toString().padStart(2, "0");
  const seconds = time.getSeconds().toString().padStart(2, "0");

  const WeatherIcon = weatherIcons[state.weather.condition];
  const { weather } = state;

  return (
    <header className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-5xl font-black tracking-wider text-foreground">
          {hours}
          <span className="animate-flash-icon text-primary">:</span>
          {minutes}
          <span className="text-muted-foreground text-3xl ml-1">{seconds}</span>
        </div>

        <div className="flex items-center gap-2">
          <ControlRoomDrawer />
          <div
            className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 cursor-pointer active:scale-[0.97] transition-all"
            onClick={() => window.open(WEATHER_DEEP_LINK, "_blank", "noopener,noreferrer")}
          >
            <WeatherIcon className={`h-7 w-7 ${weather.condition === "Clear" ? "text-primary" : "text-accent"}`} />
            <div className="text-right">
              <p className="text-2xl font-black text-foreground">
                {weather.temp > 0 ? "+" : ""}{weather.temp}°C
              </p>
              <div className="flex items-center gap-1.5 justify-end">
                {weather.windSpeed > 0 && (
                  <span className="flex items-center gap-0.5 text-xs font-bold text-muted-foreground">
                    <Wind className="h-3.5 w-3.5" />{Math.round(weather.windSpeed)}m/s
                  </span>
                )}
                {(weather.rain + weather.showers) > 0 && (
                  <span className="flex items-center gap-0.5 text-xs font-bold text-accent">
                    <Droplets className="h-3.5 w-3.5" />{(weather.rain + weather.showers).toFixed(1)}mm
                  </span>
                )}
                <ExternalLink className="h-3 w-3 text-muted-foreground/50" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {weather.rainModeActive && (
        <div
          className="flex items-center gap-2 rounded-lg bg-accent/15 border border-accent/30 px-3 py-2 cursor-pointer active:scale-[0.97] transition-all"
          onClick={() => window.open(WEATHER_DEEP_LINK, "_blank", "noopener,noreferrer")}
        >
          <CloudRain className="h-5 w-5 text-accent animate-flash-icon" />
          <span className="text-sm font-black uppercase tracking-widest text-accent text-glow-amber flex-1">
            Sademodus Aktiivinen — Kysyntä ×1.5
          </span>
          <ExternalLink className="h-4 w-4 text-accent/50" />
        </div>
      )}
    </header>
  );
};

export default DashboardHeader;
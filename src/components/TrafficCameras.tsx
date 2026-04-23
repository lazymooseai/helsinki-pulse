import { useState, useCallback, useEffect, useRef } from "react";
import { Camera, RefreshCw, X, Maximize2 } from "lucide-react";
import { HELSINKI_CAMERAS, getCameraWithCacheBust, type TrafficCamera } from "@/lib/cameras";

const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 min

const TrafficCameras = () => {
  const [expanded, setExpanded] = useState(false);
  const [fullscreenCam, setFullscreenCam] = useState<TrafficCamera | null>(null);
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshAllCameras = useCallback(() => {
    const now = Date.now();
    setRefreshKeys(Object.fromEntries(HELSINKI_CAMERAS.map((c) => [c.id, now])));
  }, []);

  const refreshCamera = useCallback((camId: string) => {
    setRefreshKeys((prev) => ({ ...prev, [camId]: Date.now() }));
  }, []);

  // Auto-refresh when expanded
  useEffect(() => {
    if (expanded) {
      refreshAllCameras();
      intervalRef.current = setInterval(refreshAllCameras, AUTO_REFRESH_MS);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [expanded, refreshAllCameras]);

  const getImageSrc = useCallback(
    (cam: TrafficCamera) => {
      const key = refreshKeys[cam.id] || 0;
      return key ? `${cam.imageUrl}?t=${key}` : cam.thumbnailUrl;
    },
    [refreshKeys]
  );

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="mx-4 mb-3 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-black uppercase tracking-widest text-muted-foreground active:scale-[0.98] transition-all hover:border-primary/40 hover:text-foreground w-full"
      >
        <Camera className="h-5 w-5 text-primary" />
        <span>Kamerat — Liikennetilanne ({HELSINKI_CAMERAS.length})</span>
      </button>
    );
  }

  return (
    <div className="mx-4 mb-3 rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-primary" />
          <span className="text-sm font-black uppercase tracking-widest text-foreground">
            Kamerat
          </span>
        </div>
        <button onClick={() => setExpanded(false)} className="p-1 rounded hover:bg-secondary">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 p-3">
        {HELSINKI_CAMERAS.map((cam) => (
          <div key={cam.id} className="relative group">
            <div className="rounded-lg overflow-hidden border border-border bg-secondary aspect-video">
              <img
                src={getImageSrc(cam)}
                alt={cam.label}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "/placeholder.svg";
                }}
              />
            </div>
            <div className="mt-1 px-1">
              <p className="text-xs font-bold text-foreground truncate">{cam.label}</p>
              <p className="text-xs text-muted-foreground truncate">{cam.zone}</p>
            </div>
            <div className="absolute top-1 right-1 flex gap-1">
              <button
                onClick={() => refreshCamera(cam.id)}
                className="rounded bg-background/80 p-1.5 hover:bg-background active:scale-90 transition-transform"
                title="Päivitä"
              >
                <RefreshCw className="h-3.5 w-3.5 text-foreground" />
              </button>
              <button
                onClick={() => setFullscreenCam(cam)}
                className="rounded bg-background/80 p-1.5 hover:bg-background active:scale-90 transition-transform"
                title="Suurenna"
              >
                <Maximize2 className="h-3.5 w-3.5 text-foreground" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground text-center px-4 pb-3">
        © Fintraffic / digitraffic.fi — Kuvat päivittyvät ~10 min välein
      </p>

      {/* Fullscreen overlay */}
      {fullscreenCam && (
        <div
          className="fixed inset-0 z-50 bg-background/90 flex flex-col items-center justify-center p-4"
          onClick={() => setFullscreenCam(null)}
        >
          <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-black text-foreground">{fullscreenCam.label}</h3>
                <p className="text-sm text-muted-foreground">{fullscreenCam.zone}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => refreshCamera(fullscreenCam.id)}
                  className="rounded-lg bg-secondary px-3 py-2 text-sm font-bold text-foreground hover:bg-secondary/80 flex items-center gap-1"
                >
                  <RefreshCw className="h-4 w-4" /> Päivitä
                </button>
                <button
                  onClick={() => setFullscreenCam(null)}
                  className="rounded-lg bg-secondary px-3 py-2"
                >
                  <X className="h-4 w-4 text-foreground" />
                </button>
              </div>
            </div>
            <img
              src={getCameraWithCacheBust(fullscreenCam)}
              alt={fullscreenCam.label}
              className="w-full rounded-xl border border-border"
              onError={(e) => {
                (e.target as HTMLImageElement).src = "/placeholder.svg";
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default TrafficCameras;

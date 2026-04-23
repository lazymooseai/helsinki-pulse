import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { insertSingleTrip, PAYMENT_METHODS } from "@/lib/trips";
import { toast } from "sonner";

const tripSchema = z.object({
  start_time: z.string().min(1, "Aika vaaditaan"),
  start_address: z.string().trim().min(1, "Lähtöpaikka vaaditaan").max(200),
  start_lat: z.string().optional(),
  start_lon: z.string().optional(),
  end_address: z.string().trim().min(1, "Kohde vaaditaan").max(200),
  fare_eur: z.string().min(1, "Hinta vaaditaan"),
  distance_km: z.string().optional(),
  duration_min: z.string().optional(),
  vehicle_id: z.string().trim().max(50).optional(),
  payment_method: z.enum(PAYMENT_METHODS),
});

const initial = {
  start_time: new Date().toISOString().slice(0, 16),
  start_address: "",
  start_lat: "",
  start_lon: "",
  end_address: "",
  fare_eur: "",
  distance_km: "",
  duration_min: "",
  vehicle_id: "",
  payment_method: "kortti" as typeof PAYMENT_METHODS[number],
};

const TripsManualForm = () => {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = tripSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Tarkista kentät");
      return;
    }
    setSaving(true);
    const trip_id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await insertSingleTrip({
      trip_id,
      start_time: new Date(form.start_time).toISOString(),
      start_address: form.start_address,
      start_lat: form.start_lat ? parseFloat(form.start_lat) : null,
      start_lon: form.start_lon ? parseFloat(form.start_lon) : null,
      end_address: form.end_address,
      fare_eur: parseFloat(form.fare_eur),
      distance_km: form.distance_km ? parseFloat(form.distance_km) : null,
      duration_min: form.duration_min ? parseInt(form.duration_min, 10) : null,
      vehicle_id: form.vehicle_id || null,
      payment_method: form.payment_method,
      source_file: "manual",
    });
    setSaving(false);
    if (result.ok) {
      toast.success("Kyyti tallennettu");
      setForm({ ...initial, start_time: new Date().toISOString().slice(0, 16) });
    } else {
      toast.error("Tallennus epäonnistui: " + (result.error ?? "tuntematon virhe"));
    }
  };

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Card className="p-5">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="start_time">Lähtöaika</Label>
          <Input id="start_time" type="datetime-local" value={form.start_time}
            onChange={(e) => set("start_time", e.target.value)} />
        </div>

        <div>
          <Label htmlFor="start_address">Lähtöpaikka</Label>
          <Input id="start_address" value={form.start_address} maxLength={200}
            onChange={(e) => set("start_address", e.target.value)} placeholder="esim. Helsinki-Vantaa T2" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="start_lat">Lat</Label>
            <Input id="start_lat" inputMode="decimal" value={form.start_lat}
              onChange={(e) => set("start_lat", e.target.value)} placeholder="60.317" />
          </div>
          <div>
            <Label htmlFor="start_lon">Lon</Label>
            <Input id="start_lon" inputMode="decimal" value={form.start_lon}
              onChange={(e) => set("start_lon", e.target.value)} placeholder="24.963" />
          </div>
        </div>

        <div>
          <Label htmlFor="end_address">Kohde</Label>
          <Input id="end_address" value={form.end_address} maxLength={200}
            onChange={(e) => set("end_address", e.target.value)} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="fare_eur">Hinta (€)</Label>
            <Input id="fare_eur" inputMode="decimal" value={form.fare_eur}
              onChange={(e) => set("fare_eur", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="distance_km">Matka (km)</Label>
            <Input id="distance_km" inputMode="decimal" value={form.distance_km}
              onChange={(e) => set("distance_km", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="duration_min">Kesto (min)</Label>
            <Input id="duration_min" inputMode="numeric" value={form.duration_min}
              onChange={(e) => set("duration_min", e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="vehicle_id">Auto</Label>
            <Input id="vehicle_id" value={form.vehicle_id} maxLength={50}
              onChange={(e) => set("vehicle_id", e.target.value)} placeholder="ABC-123" />
          </div>
          <div>
            <Label>Maksutapa</Label>
            <Select value={form.payment_method} onValueChange={(v) => set("payment_method", v as typeof PAYMENT_METHODS[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button type="submit" disabled={saving} className="w-full">
          {saving ? "Tallennetaan..." : "Tallenna kyyti"}
        </Button>
      </form>
    </Card>
  );
};

export default TripsManualForm;
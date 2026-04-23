import { useState, useCallback, useRef } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseTripsFile, importTrips, type ParseResult, type ImportResult } from "@/lib/trips";
import { toast } from "sonner";

const TripsImport = () => {
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setImportResult(null);
    try {
      const result = await parseTripsFile(file);
      setParseResult(result);
      if (result.errors.length > 0 && result.rows.length === 0) {
        toast.error("Tiedoston luku epäonnistui");
      } else {
        toast.success(`Luettu ${result.rows.length} riviä — tarkista ja vahvista`);
      }
    } catch (e) {
      toast.error("Tiedoston luku epäonnistui: " + String(e));
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onConfirm = async () => {
    if (!parseResult || parseResult.rows.length === 0) return;
    setImporting(true);
    const result = await importTrips(parseResult.rows);
    setImporting(false);
    setImportResult(result);
    if (result.failed === 0) {
      toast.success(`${result.inserted} uutta kyytiä tuotu, ${result.skipped} ohitettu`);
    } else {
      toast.error(`${result.failed} riviä epäonnistui`);
    }
  };

  const reset = () => {
    setParseResult(null);
    setImportResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-4">
      {!parseResult && (
        <Card
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`p-10 border-2 border-dashed cursor-pointer transition-colors text-center ${
            dragActive ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
          }`}
        >
          <Upload className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-lg font-bold text-foreground mb-1">Raahaa CSV/XLSX tähän</p>
          <p className="text-sm text-muted-foreground">tai klikkaa valitaksesi tiedoston</p>
          <p className="text-xs text-muted-foreground mt-3">
            Pakolliset sarakkeet: <code className="text-foreground">trip_id</code>,{" "}
            <code className="text-foreground">start_time</code>
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </Card>
      )}

      {parseResult && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-6 h-6 text-primary" />
              <div>
                <p className="font-bold text-foreground">{parseResult.fileName}</p>
                <p className="text-sm text-muted-foreground">
                  {parseResult.rows.length} validia / {parseResult.totalRows} riviä
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={reset}>
              <X className="w-5 h-5" />
            </Button>
          </div>

          {parseResult.errors.length > 0 && (
            <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/30">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                <div className="text-sm text-destructive">
                  <p className="font-semibold mb-1">{parseResult.errors.length} virhettä</p>
                  <ul className="text-xs space-y-0.5 max-h-24 overflow-auto">
                    {parseResult.errors.slice(0, 10).map((e, i) => <li key={i}>• {e}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {parseResult.rows.length > 0 && (
            <>
              <p className="text-sm font-semibold text-foreground mb-2">Esikatselu (10 ensimmäistä riviä)</p>
              <div className="border border-border rounded-md overflow-x-auto mb-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>trip_id</TableHead>
                      <TableHead>aika</TableHead>
                      <TableHead>lähtö</TableHead>
                      <TableHead>kohde</TableHead>
                      <TableHead className="text-right">€</TableHead>
                      <TableHead className="text-right">km</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parseResult.rows.slice(0, 10).map((r) => (
                      <TableRow key={r.trip_id}>
                        <TableCell className="font-mono text-xs">{r.trip_id}</TableCell>
                        <TableCell className="text-xs">{new Date(r.start_time).toLocaleString("fi-FI")}</TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate">{r.start_address ?? "—"}</TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate">{r.end_address ?? "—"}</TableCell>
                        <TableCell className="text-xs text-right">{r.fare_eur ?? "—"}</TableCell>
                        <TableCell className="text-xs text-right">{r.distance_km ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {!importResult && (
                <div className="flex gap-2">
                  <Button onClick={onConfirm} disabled={importing} className="flex-1">
                    {importing ? "Tuodaan..." : `Vahvista ja tuo ${parseResult.rows.length} kyytiä`}
                  </Button>
                  <Button variant="outline" onClick={reset}>Peruuta</Button>
                </div>
              )}

              {importResult && (
                <div className="p-4 rounded-md bg-card border border-border space-y-1">
                  <div className="flex items-center gap-2 text-primary font-bold">
                    <CheckCircle2 className="w-5 h-5" />
                    Tuonti valmis
                  </div>
                  <p className="text-sm text-foreground">✓ {importResult.inserted} uutta kyytiä tuotu</p>
                  <p className="text-sm text-muted-foreground">↷ {importResult.skipped} duplikaattia ohitettu</p>
                  {importResult.failed > 0 && (
                    <p className="text-sm text-destructive">✗ {importResult.failed} epäonnistui</p>
                  )}
                  <Button onClick={reset} variant="outline" size="sm" className="mt-2">Tuo uusi tiedosto</Button>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
};

export default TripsImport;
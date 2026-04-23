/**
 * DetailSheet.tsx
 *
 * Sisäinen detaljinäkymä korteille. Avautuu alhaalta nousevana sheettinä.
 * Näyttää kaiken saatavilla olevan tiedon + ulkoinen "Avaa virallinen lähde" -nappi.
 */

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

export interface DetailField {
  label: string;
  value: string | number;
  highlight?: boolean;
}

interface DetailSheetProps {
  open: boolean;
  onClose: () => void;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  fields: DetailField[];
  externalUrl?: string;
  externalLabel?: string;
  extra?: ReactNode;
}

const DetailSheet = ({
  open,
  onClose,
  icon,
  title,
  subtitle,
  fields,
  externalUrl,
  externalLabel = "Avaa virallinen lähde",
  extra,
}: DetailSheetProps) => {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="bg-card border-t border-border max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <div className="flex items-center gap-3">
            <div className="shrink-0 text-primary">{icon}</div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-2xl font-black uppercase tracking-tight text-foreground">
                {title}
              </SheetTitle>
              {subtitle && (
                <SheetDescription className="text-base font-bold text-muted-foreground mt-1">
                  {subtitle}
                </SheetDescription>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-3">
          {fields.map((f, i) => (
            <div
              key={i}
              className={`flex items-baseline justify-between gap-4 rounded-xl border px-4 py-3 ${
                f.highlight ? "border-primary/40 bg-primary/10" : "border-border bg-muted/40"
              }`}
            >
              <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                {f.label}
              </span>
              <span
                className={`font-mono font-black text-right ${
                  f.highlight ? "text-primary text-2xl" : "text-foreground text-lg"
                }`}
              >
                {f.value}
              </span>
            </div>
          ))}
        </div>

        {extra && <div className="mt-4">{extra}</div>}

        {externalUrl && (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 w-full flex items-center justify-center gap-2 rounded-xl bg-primary min-h-[56px] font-black text-lg text-primary-foreground active:scale-95 transition-transform glow-green"
          >
            <ExternalLink className="h-5 w-5" />
            {externalLabel}
          </a>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default DetailSheet;

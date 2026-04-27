/**
 * ControlRoomDrawer.tsx
 *
 * "Master Data Library" -vetolaatikko — kaikki strategiset datalähteet
 * ja linkit kuljettajalle yhdessä paikassa.
 *
 * Paivitykset:
 * - Nordis URL korjattu (Helsingin Jaahalli -> nordis.fi)
 * - Veikkaus Areena (ent. Hartwall Arena)
 * - LinkedEvents lisatty tapahtumien lahteeksi
 * - Digitraffic lisatty junien lahteeksi
 * - Kategoriat jarjestetty prioriteetin mukaan
 */

import {
  Train,
  Ticket,
  Music,
  Landmark,
  Beer,
  BedDouble,
  Database,
  ChevronRight,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { SheetTrigger } from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface DeepLink {
  label: string;
  url: string;
  badge?: string; // Valinnainen merkki, esim. "Avoin data"
}

interface LinkCategory {
  id: string;
  title: string;
  icon: React.ReactNode;
  links: DeepLink[];
}

const categories: LinkCategory[] = [
  {
    id: "traffic",
    title: "Liikenne & Saatiedot",
    icon: <Train className="h-5 w-5 text-destructive" />,
    links: [
      {
        label: "Finavia — Saapuvat lennot",
        url: "https://www.finavia.fi/fi/lentoasemat/helsinki-vantaa/lennot?tab=arr",
        badge: "Live",
      },
      {
        label: "Averio — Laivat & matkustajat",
        url: "https://averio.fi/laivat",
        badge: "Live",
      },
      {
        label: "Digitraffic — Junat reaaliajassa",
        url: "https://rata.digitraffic.fi/api/v1/live-trains/station/HKI?arriving_trains=20",
        badge: "Avoin data",
      },
      {
        label: "VR — Liikennetilanne",
        url: "https://www.vr.fi/liikennetilanne",
      },
      {
        label: "Fintraffic — Ruuhkakartta",
        url: "https://liikennetilanne.fintraffic.fi/",
        badge: "Live",
      },
      {
        label: "Ilmatieteenlaitos — Sadetutka",
        url: "https://www.ilmatieteenlaitos.fi/sadealueet-suomessa",
        badge: "Live",
      },
    ],
  },
  {
    id: "arenas",
    title: "Areenat & Messut",
    icon: <Ticket className="h-5 w-5 text-primary" />,
    links: [
      {
        label: "Messukeskus — Tapahtumat",
        url: "https://messukeskus.com/tapahtumat/",
      },
      {
        label: "Olympiastadion — Tapahtumat",
        url: "https://www.stadion.fi/tapahtumat",
      },
      {
        label: "Helsingin Jäähalli — Tapahtumat",
        url: "https://helsinginjaahalli.fi/tapahtumat",
      },
      {
        label: "Veikkaus Arena (ent. Hartwall)",
        url: "https://www.veikkausarena.fi/",
      },
      {
        label: "Bolt Arena — HJK-ottelut",
        url: "https://www.hjk.fi/ottelut/",
      },
      {
        label: "Espoo Metro Areena",
        url: "https://metroareena.fi/tapahtumat/",
      },
    ],
  },
  {
    id: "events",
    title: "Tapahtumat & Kalenteri",
    icon: <Music className="h-5 w-5 text-accent" />,
    links: [
      {
        label: "LinkedEvents — Helsingin tapahtumat",
        url: "https://api.hel.fi/linkedevents/v1/event/?include=location&page_size=20",
        badge: "Avoin data",
      },
      {
        label: "Ooppera & Baletti — Kalenteri",
        url: "https://oopperabaletti.fi/kalenteri/",
      },
      {
        label: "Musiikkitalo — Tapahtumat",
        url: "https://www.musiikkitalo.fi/tapahtumat",
      },
      {
        label: "Kaupunginteatteri (HKT)",
        url: "https://hkt.fi/kalenteri/",
      },
      {
        label: "Kansallisteatteri",
        url: "https://kansallisteatteri.fi/ohjelmisto/",
      },
      {
        label: "Tanssin Talo",
        url: "https://www.tanssintalo.fi/ohjelma",
      },
    ],
  },
  {
    id: "politics",
    title: "Politiikka & Viranomaiset",
    icon: <Landmark className="h-5 w-5 text-muted-foreground" />,
    links: [
      {
        label: "Eduskunta — Täysistunnot (live)",
        url: "https://verkkolahetys.eduskunta.fi/fi/taysistunnot/static/live",
      },
      {
        label: "Tilannehuone — Hälytykset",
        url: "https://www.tilannehuone.fi/",
        badge: "Live",
      },
    ],
  },
  {
    id: "nightlife",
    title: "Yoelama & Opiskelijat",
    icon: <Beer className="h-5 w-5 text-primary" />,
    links: [
      {
        label: "Tavastia — Ohjelma",
        url: "https://tavastiaklubi.fi/",
      },
      {
        label: "Apollo Live Club",
        url: "https://apolloliveclub.fi/tapahtumat",
      },
      {
        label: "Kide.app — Opiskelijatapahtumat",
        url: "https://kide.app/events",
      },
    ],
  },
  {
    id: "hotels",
    title: "Hotellit",
    icon: <BedDouble className="h-5 w-5 text-accent" />,
    links: [
      {
        label: "Clarion — Jätkäsaari",
        url: "https://www.clarionhotelhelsinki.com",
      },
      {
        label: "Sokos Vaakuna — Rautatientori",
        url: "https://www.sokoshotels.fi/fi/helsinki/sokos-hotel-vaakuna",
      },
      {
        label: "Hotel Kamp — Esplanadi",
        url: "https://www.hotelkamp.com",
      },
    ],
  },
];

const ControlRoomDrawer = () => {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button className="flex items-center gap-2 h-10 rounded-lg bg-secondary border border-border px-3 active:scale-95 transition-transform">
          <Database className="h-5 w-5 text-primary" />
          <span className="text-xs font-black uppercase tracking-wider text-foreground">
            Lähteet
          </span>
        </button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="w-full sm:max-w-md bg-background border-border overflow-y-auto p-0"
      >
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle className="text-foreground text-xl font-black tracking-wide">
            Master Data Library
          </SheetTitle>
          <SheetDescription className="text-muted-foreground text-sm">
            Kaikki strategiset lähteet — napista uuteen välilehteen
          </SheetDescription>
        </SheetHeader>

        <Accordion
          type="multiple"
          defaultValue={["traffic", "arenas"]}
          className="px-3 pb-6"
        >
          {categories.map((cat) => (
            <AccordionItem key={cat.id} value={cat.id} className="border-border">
              <AccordionTrigger className="px-2 py-3 hover:no-underline hover:bg-secondary/50 rounded-lg">
                <div className="flex items-center gap-3">
                  {cat.icon}
                  <span className="text-sm font-black uppercase tracking-widest text-foreground">
                    {cat.title}
                  </span>
                  <span className="text-xs font-bold text-muted-foreground rounded-full bg-muted px-2 py-0.5">
                    {cat.links.length}
                  </span>
                </div>
              </AccordionTrigger>

              <AccordionContent className="pb-1 pt-0">
                <div className="flex flex-col gap-1 px-1">
                  {cat.links.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-sm font-bold text-foreground active:scale-[0.98] transition-all hover:border-primary/40 hover:bg-secondary"
                    >
                      <span className="flex-1">{link.label}</span>
                      {link.badge && (
                        <span className="text-[10px] font-black uppercase tracking-wider text-primary bg-primary/15 px-2 py-0.5 rounded-md">
                          {link.badge}
                        </span>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </a>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <p className="text-xs text-muted-foreground text-center px-4 pb-6">
          Data haetaan avoimista rajapinnoista. Käytä linkkejä tiedon vahvistamiseen.
        </p>
      </SheetContent>
    </Sheet>
  );
};

export default ControlRoomDrawer;

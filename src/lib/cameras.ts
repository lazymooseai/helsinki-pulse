export interface TrafficCamera {
  id: string;
  label: string;
  zone: string;
  presetId: string;
  imageUrl: string;
  thumbnailUrl: string;
}

// Hardcoded Helsinki hotspot cameras
// Preset IDs from Fintraffic weathercam API for key locations
export const HELSINKI_CAMERAS: TrafficCamera[] = [
  {
    id: "cam-kehä1-leppävaara",
    label: "Kehä I Leppävaara",
    zone: "Espoo / Lentokenttä",
    presetId: "C0150301",
    imageUrl: "https://weathercam.digitraffic.fi/C0150301.jpg",
    thumbnailUrl: "https://weathercam.digitraffic.fi/C0150301.jpg?thumbnail=true",
  },
  {
    id: "cam-länsiväylä",
    label: "Länsiväylä (Lauttasaari)",
    zone: "Länsisatama / Jätkäsaari",
    presetId: "C0150801",
    imageUrl: "https://weathercam.digitraffic.fi/C0150801.jpg",
    thumbnailUrl: "https://weathercam.digitraffic.fi/C0150801.jpg?thumbnail=true",
  },
  {
    id: "cam-hakamäentie",
    label: "Hakamäentie / Pasila",
    zone: "Rautatientori / Pasila",
    presetId: "C0150401",
    imageUrl: "https://weathercam.digitraffic.fi/C0150401.jpg",
    thumbnailUrl: "https://weathercam.digitraffic.fi/C0150401.jpg?thumbnail=true",
  },
  {
    id: "cam-tuusulanväylä",
    label: "Tuusulanväylä (Käpylä)",
    zone: "Helsinki-Vantaa suunta",
    presetId: "C0150201",
    imageUrl: "https://weathercam.digitraffic.fi/C0150201.jpg",
    thumbnailUrl: "https://weathercam.digitraffic.fi/C0150201.jpg?thumbnail=true",
  },
];

export function getCameraWithCacheBust(cam: TrafficCamera): string {
  return `${cam.imageUrl}?t=${Date.now()}`;
}

/** Data contracts for the files in public/data. See docs/DATA.md. */

export type Finish = "matt" | "satin" | "silk" | "gloss";
export type Use = "interior" | "exterior" | "both";

export interface Brand {
  name: string;
  shortName: string;
  tagline: string;
  /** Shown under the header when the catalogue is placeholder data. */
  sampleDataNotice?: string;
  madeBy?: string;
  colours: {
    primary: string;
    primaryInk: string;
  };
  currency: string;
  locale: string;
  /** International format without "+", e.g. 2348012345678. Used when a distributor has no WhatsApp number. */
  whatsappFallback?: string;
  disclaimer: string;
  segmentation: {
    /** URL of the MediaPipe interactive segmentation model (.tflite). Relative paths are served by this app. */
    modelUrl: string;
    /** Tried when `modelUrl` can't be loaded (e.g. Google's hosted copy). */
    modelFallbackUrl?: string;
    /** Folder holding the MediaPipe vision WASM runtime, relative to the app. */
    wasmBase: string;
    /** Set false to always use the built-in edge-based detector. */
    enabled: boolean;
  };
  analytics: {
    provider: "none" | "ga4" | "plausible";
    id?: string;
  };
}

export interface Family {
  id: string;
  label: string;
}

export interface Shade {
  id: string;
  name: string;
  code: string;
  hex: string;
  family: string;
  collection?: string;
  /** Light reflectance value from the manufacturer. Computed from hex when absent. */
  lrv?: number;
  /** Product ids this colour can be tinted in. All products when absent. */
  products?: string[];
}

export interface TinSize {
  litres: number;
  price: number;
}

export interface Product {
  id: string;
  name: string;
  finish: Finish;
  use: Use;
  /** Square metres covered by one litre for one coat. */
  coverage: number;
  sizes: TinSize[];
  description?: string;
}

export interface Distributor {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  phone?: string;
  /** International format without "+", e.g. 2348012345678. */
  whatsapp?: string;
  hours?: string;
  /** Marks placeholder records so the app can label them. */
  sample?: boolean;
}

export interface Catalogue {
  brand: Brand;
  families: Family[];
  shades: Shade[];
  products: Product[];
  distributors: Distributor[];
}

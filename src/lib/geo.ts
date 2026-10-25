/** Great-circle distance in kilometres. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatKm(km: number): string {
  if (km < 1) return "under 1 km";
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function sortByDistance<T extends { lat: number; lng: number }>(items: T[], from: { lat: number; lng: number }): Array<T & { km: number }> {
  return items.map((d) => ({ ...d, km: distanceKm(from, d) })).sort((x, y) => x.km - y.km);
}

/** Opens directions in Google Maps (works in the browser and the Maps app). */
export function directionsUrl(d: { lat: number; lng: number; name: string }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}&travelmode=driving`;
}

export interface Position { lat: number; lng: number; accuracy?: number }

export function currentPosition(timeoutMs = 12000): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Location isn't available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => {
        const msg =
          e.code === e.PERMISSION_DENIED
            ? "Location permission was refused. Choose your area from the list instead, or allow location in your browser's site settings."
            : e.code === e.TIMEOUT
              ? "Finding your location took too long. Choose your area from the list instead."
              : "Your location couldn't be found. Choose your area from the list instead.";
        reject(new Error(msg));
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 300000 },
    );
  });
}

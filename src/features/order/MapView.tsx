import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Distributor } from "../../data/types";

interface Props {
  distributors: Array<Distributor & { km?: number }>;
  selectedId: string | null;
  me: { lat: number; lng: number } | null;
  onSelect: (id: string) => void;
  visible: boolean;
}

/** OpenStreetMap view of nearby distributors. Uses circle markers (no image assets). */
export function MapView({ distributors, selectedId, me, onSelect, visible }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const bounds = useRef<L.LatLngBounds | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([6.5244, 3.3792], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!visible || !map.current) return;
    const t = setTimeout(() => {
      map.current?.invalidateSize();
      if (bounds.current) map.current?.fitBounds(bounds.current, { padding: [28, 28], maxZoom: 14 });
    }, 60);
    return () => clearTimeout(t);
  }, [visible]);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim() || "#4B37BF";
    const pts: L.LatLngExpression[] = [];
    distributors.forEach((d) => {
      const sel = d.id === selectedId;
      const mk = L.circleMarker([d.lat, d.lng], { radius: sel ? 10 : 7, color: "#fff", weight: 2, fillColor: sel ? accent : "#6E6A80", fillOpacity: 1 })
        .bindTooltip(d.name)
        .on("click", () => onSelectRef.current(d.id));
      mk.addTo(g);
      pts.push([d.lat, d.lng]);
    });
    if (me) {
      L.circleMarker([me.lat, me.lng], { radius: 8, color: "#fff", weight: 3, fillColor: "#1F7AE0", fillOpacity: 1 }).bindTooltip("You").addTo(g);
      pts.push([me.lat, me.lng]);
    }
    if (pts.length) {
      bounds.current = L.latLngBounds(pts);
      if (el.current && el.current.clientWidth) m.fitBounds(bounds.current, { padding: [28, 28], maxZoom: 14 });
    }
  }, [distributors, selectedId, me]);

  return <div ref={el} className="map" role="region" aria-label="Map of distributors" />;
}

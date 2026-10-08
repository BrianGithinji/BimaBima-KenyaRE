import { useEffect, useRef } from "react";
import { Map, NavigationControl, AttributionControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const TIER_COLOR = {
  Low:     "#059669",
  Medium:  "#d97706",
  High:    "#ea580c",
  Decline: "#dc2626",
};

const TIER_LABEL = {
  Low: "Low Risk", Medium: "Moderate Risk", High: "High Risk", Decline: "Very High Risk",
};

const fmt = (n) => n >= 1e9 ? `KES ${(n/1e9).toFixed(2)}B` : `KES ${(n/1e6).toFixed(1)}M`;

// Inline raster style — no external style.json needed, works offline
const makeStyle = () => ({
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [{ id: "osm-tiles", type: "raster", source: "osm" }],
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
});

// ── Single-pin map (Assessor page) ───────────────────────────────────────────
export function SinglePinMap({ lat, lon, tier, label }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: makeStyle(),
      center: [lon, lat],
      zoom: 13,
      attributionControl: false,
    });

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      map.addSource("pin", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: { tier, label },
        },
      });

      map.addLayer({
        id: "pin-glow",
        type: "circle",
        source: "pin",
        paint: {
          "circle-radius": 22,
          "circle-color": TIER_COLOR[tier] || "#4f46e5",
          "circle-opacity": 0.18,
          "circle-blur": 0.6,
        },
      });

      map.addLayer({
        id: "pin-dot",
        type: "circle",
        source: "pin",
        paint: {
          "circle-radius": 10,
          "circle-color": TIER_COLOR[tier] || "#4f46e5",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.on("click", "pin-dot", (e) => {
        const { tier: t, label: l } = e.features[0].properties;
        new Popup({ offset: 14, closeButton: false })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-size:12px;line-height:1.6;min-width:160px">
              <div style="font-weight:700;color:#1a202c;margin-bottom:4px">${l || "Property"}</div>
              <div style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:700;
                background:${TIER_COLOR[t]}22;color:${TIER_COLOR[t]}">${TIER_LABEL[t] || t}</div>
              <div style="margin-top:6px;font-size:11px;color:#718096">${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E</div>
            </div>`)
          .addTo(map);
      });

      map.on("mouseenter", "pin-dot", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "pin-dot", () => { map.getCanvas().style.cursor = ""; });
    });

    return () => map.remove();
  }, [lat, lon, tier, label]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

// ── Portfolio dot map ─────────────────────────────────────────────────────────
export function PortfolioDotMap({ buildings, onSelect, selectedId }) {
  const containerRef  = useRef(null);
  const mapRef        = useRef(null);
  const popupRef      = useRef(null);
  const onSelectRef   = useRef(onSelect);
  const mountedRef    = useRef(false);
  const buildingsRef  = useRef(buildings);

  // Keep refs fresh without re-triggering effects
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { buildingsRef.current = buildings; }, [buildings]);

  const toGeoJSON = (list) => ({
    type: "FeatureCollection",
    features: list.map((b) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [b.lon, b.lat] },
      properties: {
        loc_id:    b.loc_id,
        tier:      b.risk_tier,
        color:     TIER_COLOR[b.risk_tier] || "#4f46e5",
        tiv:       b.tiv_kes,
        flood_pct: (b.flood_probability * 100).toFixed(1),
        dr:        (b.damage_ratio_rp100 * 100).toFixed(1),
        flagged:   b.ml3_flag,
      },
    })),
  });

  // Mount map once
  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return;
    mountedRef.current = true;

    const map = new Map({
      container: containerRef.current,
      style: makeStyle(),
      center: [34.5, 0.5],
      zoom: 8,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      map.addSource("buildings", { type: "geojson", data: toGeoJSON(buildingsRef.current) });

      map.addLayer({
        id: "dots-shadow",
        type: "circle",
        source: "buildings",
        paint: {
          "circle-radius": 9,
          "circle-color": "#000",
          "circle-opacity": 0.25,
          "circle-translate": [1, 2],
        },
      });

      map.addLayer({
        id: "dots",
        type: "circle",
        source: "buildings",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 4, 10, 7, 13, 11],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.88,
        },
      });

      map.addLayer({
        id: "dots-selected",
        type: "circle",
        source: "buildings",
        filter: ["==", ["get", "loc_id"], ""],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 9, 10, 14, 13, 18],
          "circle-color": "transparent",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.on("mouseenter", "dots", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const p = e.features[0].properties;
        popupRef.current = new Popup({ offset: 10, closeButton: false, closeOnClick: false })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-size:12px;line-height:1.7;min-width:180px">
              <div style="font-weight:700;color:#1a202c;margin-bottom:4px">${p.loc_id}</div>
              <div style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:10px;font-weight:700;
                background:${p.color}22;color:${p.color};margin-bottom:6px">${TIER_LABEL[p.tier] || p.tier}</div>
              <div style="font-size:11px;color:#4a5568">Value: <b>${fmt(p.tiv)}</b></div>
              <div style="font-size:11px;color:#4a5568">Flood prob: <b>${p.flood_pct}%</b></div>
              <div style="font-size:11px;color:#4a5568">Damage RP100: <b>${p.dr}%</b></div>
              ${p.flagged ? '<div style="margin-top:4px;font-size:10px;color:#d97706">⚠ Flagged for review</div>' : ""}
              <div style="margin-top:6px;font-size:10px;color:#a0aec0">Click to open full analysis</div>
            </div>`)
          .addTo(map);
      });

      map.on("mouseleave", "dots", () => {
        map.getCanvas().style.cursor = "";
        popupRef.current?.remove();
        popupRef.current = null;
      });

      map.on("click", "dots", (e) => {
        onSelectRef.current(e.features[0].properties.loc_id);
      });
    });

    return () => { popupRef.current?.remove(); map.remove(); mountedRef.current = false; };
  }, []);

  // Update dots when filter changes — no remount needed
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const src = map.getSource("buildings");
    if (src) src.setData(toGeoJSON(buildings));
  }, [buildings]);

  // Update selected ring
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (map.getLayer("dots-selected"))
      map.setFilter("dots-selected", ["==", ["get", "loc_id"], selectedId || ""]);
  }, [selectedId]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

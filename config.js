// ============================================================
// Rockford Sanborn Fire Insurance Maps — config
// Studio GWA
// ============================================================

// Bump this on every deploy so browsers never mix old data with new code.
const BUILD = "2026-10-09f";

const CONFIG = {
  // Mapbox public access token (pk...), same one used on the Rockford survey map.
  // See DEPLOYMENT.md § Mapbox token for the URL-restriction step.
  MAPBOX_TOKEN: "pk.eyJ1IjoibWljaGFlbC1zbWl0aCIsImEiOiJjbXYwaHlqNWowNGp2MndwbWdlMXd3cGp4In0.YoKYkO_CSSSSM2C0LTBx8Q",

  // "Light" keeps the basemap muted so the historic sheets and overlays stay legible.
  MAPBOX_STYLE: "mapbox://styles/mapbox/light-v11",

  // Third base map: OpenStreetMap-based tiles served by Stadia Maps (raster, so it works in Mapbox GL).
  //   ENABLED  false hides the button
  //   API_KEY  "" works on localhost; on the published site either authorize the domain in the
  //            Stadia dashboard or paste a key here (see DEPLOYMENT.md)
  //   STYLE    osm_bright (current) | alidade_smooth (lighter, grayer) | outdoors | ...
  STADIA: { ENABLED: true, API_KEY: "", STYLE: "osm_bright", EXT: "png", RETINA: true, LABEL: "OSM Light" },

  // Initial view: downtown Rockford, on both sides of the Rock River
  INITIAL_CENTER: [-89.0940, 42.2711],
  INITIAL_ZOOM: 14.2,

  // Which copy of the map images to load.
  //   "loc"         Library of Congress originals, tiled (default; safe on phones)
  //   "chronoscope" quarter-size copies, but each sheet is one huge tile and crashes iPhones
  // Both use the same georeferencing; only the image address differs.
  IMAGE_SOURCE: "loc",

  // Edition shown on first load, and starting opacity of the historic sheets
  DEFAULT_YEAR: "1913",
  DEFAULT_OPACITY: 0.85,

  // Sanborn editions. Each "year" button loads every volume listed for it.
  YEARS: [
    { id: "1897", label: "1897", volumes: ["sanborn02127_003"],
      note: "1897 edition" },
    { id: "1913", label: "1913", volumes: ["sanborn02127_004", "sanborn02127_005"],
      note: "1913 edition, Vols. 1–2" },
    { id: "1950", label: "1950", volumes: ["sanborn02127_006", "sanborn02127_007"],
      note: "1913 base maps, corrected to 1950, Vols. 1–2" },
    { id: "1951", label: "1951", volumes: ["sanborn02127_008", "sanborn02127_009", "sanborn02127_010"],
      note: "1913 base maps, republished 1951, Vols. 1–3" },
  ],

  // Volume labels for the sheet popup
  VOLUMES: {
    sanborn02127_003: "1897",
    sanborn02127_004: "1913, Vol. 1",
    sanborn02127_005: "1913, Vol. 2",
    sanborn02127_006: "1950, Vol. 1",
    sanborn02127_007: "1950, Vol. 2",
    sanborn02127_008: "1951, Vol. 1",
    sanborn02127_009: "1951, Vol. 2",
    sanborn02127_010: "1951, Vol. 3",
  },

  // Data files (all WGS84 / EPSG:4326)
  DATA: {
    parcels: "data/parcels.geojson",
    centroids: "data/parcel_centroids.geojson",
  },
  IIIF_ROOT: "data/iiif/",

  // Base URL used to build shareable links
  SHARE_BASE_URL: window.location.origin + window.location.pathname,
};

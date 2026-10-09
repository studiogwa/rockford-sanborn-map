# Rockford Sanborn Map — Deployment

Static site, no build step. Same pattern as the Rockford survey map and Elgin.

## Files (28)
`index.html`, `style.css`, `app.js`, `config.js`, `assets/` (4 PNGs), `data/parcels.geojson`, `data/parcel_centroids.geojson`, `data/iiif/chronoscope/` (8 JSON), `data/iiif/loc/` (8 JSON), `vendor/allmaps-mapbox.js`, `DEPLOYMENT.md`.
Under GitHub's 100-file web-upload limit.

## View locally
Do not double-click index.html (browsers block data loading from file://).
```
cd "<this folder>"
python3 -m http.server 8000
```
Open http://localhost:8000

## Base maps
Buttons in the sidebar (and the mobile "Maps & layers" panel): **Grayscale** (Mapbox Light), **Aerial** (Mapbox Satellite, current imagery) and **OSM Light** (OpenStreetMap-based tiles from Stadia Maps). `?b=aerial` or `?b=osm` in the URL opens that view.

### OSM Light (Stadia) setup
1. Sign up at https://client.stadiamaps.com.
2. Localhost works with no key. For the live site, add `studiogwa.github.io` under your property's authentication settings, or paste an API key into `STADIA.API_KEY` in `config.js`.
3. `STADIA.STYLE` picks the look (`osm_bright`, `alidade_smooth`, `outdoors`, ...).
4. Check Stadia's current terms: the free plan is aimed at testing/non-commercial use. To remove the button, set `ENABLED: false`.

## Publish to GitHub Pages (studiogwa org)
1. github.com/organizations/studiogwa/repositories/new, name `rockford-sanborn-map`, Public (or Private if your plan serves private Pages), add a README, Create.
2. Add file > Upload files. Drag the CONTENTS of this folder (not the folder itself) in. Wait for every file to finish. Commit directly to main.
3. Settings > Pages > Deploy from a branch > main / (root) > Save.
   If no "pages build and deployment" run appears under Actions, make a small edit to the README and commit.
4. Site address: https://studiogwa.github.io/rockford-sanborn-map/
5. Mapbox token: account.mapbox.com > Access tokens > the token in `config.js` > add `https://studiogwa.github.io/*` to allowed URLs.
6. Replace both `G-XXXXXXXXXX` in `index.html` with the GA4 Measurement ID.
7. For later edits, bump `BUILD` in `config.js` and the `?v=` strings in `index.html` so browsers fetch fresh files.

## Config (`config.js`)
- `IMAGE_SOURCE`: `"chronoscope"` (default) or `"loc"`. Switch to `"loc"` if scans fail to show (CORS error in console).
- `YEARS`, `INITIAL_CENTER`, `INITIAL_ZOOM`, `DEFAULT_YEAR`, `DEFAULT_OPACITY`.

## Notes
- Placements come from mapsnap v1.3 (automatic; can be off by a block in places; ODbL, keep the credit).
- Not included: 1887/1891 volumes, items 001/002 (withheld by mapsnap).
- `vendor/allmaps-mapbox.js` is a bundled adapter that lets Allmaps draw on Mapbox GL JS.

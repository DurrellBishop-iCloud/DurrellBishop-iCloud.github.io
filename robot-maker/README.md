# Robot Shape Maker

A static GitHub Pages camera test for turning white 2D geometric robot parts on a dark background into colored 3D robot volumes.

## Run locally

```sh
npm start
```

Open `http://localhost:4173`.

Camera access on iPhone needs HTTPS, so the real phone test should be from GitHub Pages rather than a plain LAN URL.

## Publish

The app is static. Publish the folder with GitHub Pages from the repository root. Keep these files in the repo:

- `index.html`
- `styles.css`
- `app.js`
- `vendor/three/**`
- `.nojekyll`

`node_modules/` is only for local dependency management and is ignored.

## Current test features

- Full-screen live camera.
- One shutter button: tap once for a still build, or hold it down to generate a new version about once per second.
- White-on-dark silhouette detection.
- Nearby separated parts use magnetic attraction before becoming 3D.
- Close parallel flat edges are detected, pulled together, and slid into alignment so flats prefer flats.
- Overlapping/touching white parts become visible merged silhouettes.
- Colored robot palette inspired by the reference robots.
- Rotating color palettes influenced by Nathalie Du Pasquier/Memphis-era painted constructions and cut-paper pattern work.
- Shape grammar that mixes straight extrusions, very thin plates, deep blocks, one-sided tapers, curved ribbons, spheroids, and tube-like rings.
- Separate geometry builders for outline lofts, ellipsoid/turned bodies, box prisms, and wedge prisms.
- Mostly sharp-edged robot parts, with rounded volumes only when the silhouette suggests a curved object.
- Lit mesh rendering without the drawn black edge-line overlay.
- Per-part material treatment: matte, glossy, satin, rubbery, or textured, with striped bands, face-by-face color, and arbitrary split-color patches.

For desktop testing without a camera, open `http://localhost:4173/?test`.

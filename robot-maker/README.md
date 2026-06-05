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
- One shutter button.
- White-on-dark silhouette detection.
- Nearby separated parts use stronger nearest-surface attraction before becoming 3D.
- Overlapping/touching white parts become visible merged silhouettes.
- Colored robot palette inspired by the reference robots.
- Shape grammar that mixes straight extrusions, very thin plates, deep blocks, one-sided tapers, curved ribbons, spheroids, and tube-like rings.
- Mostly sharp-edged robot parts, with rounded volumes only when the silhouette suggests a curved object.
- Lit mesh rendering without the drawn black edge-line overlay.

For desktop testing without a camera, open `http://localhost:4173/?test`.

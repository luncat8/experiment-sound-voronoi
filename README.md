# experiment-sound-voronoi

A Voronoi diagram is the terrain: every point has mass, so its cell *is* its
gravity well. Drag on the canvas to launch a probe through the field; **only the
containing Voronoi cell and its Voronoi-adjacent cells** drive a polyphonic
spatial Web Audio synth.

Open `index.html` — no build, no server, no network.

## controls

| input | effect |
| --- | --- |
| click empty canvas | add a point |
| drag empty canvas | slingshot the probe |
| drag a point | move it (field rebuilds live) |
| right-click a point | remove it |
| N | rebuild diagram with `N` points |
| R / C | random field / clear |
| 1 / 2 / 3 | toggle `freq` / `volume` / `envelope` radio group |
| M / P | mute / pause |
| space | kick the probe in a random direction |

## synth sound (3 radio groups + steepness sliders)

Only `{nearest} U adj(nearest)` generate sound; non-adjacent cells remain silent.
Voices are pinned by `cellId` in a 20-voice pool so crossing edges or changing
neighbor distances never slides pitches or jumps stereo pans between unrelated
points.

1. **freq** (`point id` | `distance 10k–10Hz` + `steep` slider)
   - `point id`: plays the cell's pentatonic tone (`C3..B4`, matching cell color).
   - `distance`: `10 kHz` right at `0 px`, decaying logarithmically toward `10 Hz`
     at far distances; `steep` adjusts how quickly pitch falls with distance.
2. **volume** (`distance` | `const` + `steep` slider)
   - `distance`: inverse-square falloff from the point; `steep` adjusts falloff rate.
   - `const`: equal-power constant volume across all active cells in the Voronoi
     neighborhood, independent of distance.
3. **envelope** (`distance (<20px cont, 30–0.1Hz)` | `off` + `steep` slider)
   - `distance`: pure unipolar `sine` amplitude modulation — strictly continuous
     inside `<20 px`, sweeping from `30 Hz` in the mid range down to `0.1 Hz` far
     away; `steep` adjusts how fast modulation rate drops with distance.
   - `off`: unmodulated continuous volume.

**Stereo LR**: each voice pans by the horizontal direction vector from the probe
to its point (`dx / dist`), fading smoothly through center inside the `20 px` core.

## musical cell placement

Spatial `260x220 px` zones select roots from the circle of fifths (`0, 7, 2, 9, 5`)
so neighboring zones share four of five pentatonic pitch classes without repeating
one static 5-note pattern across the canvas. Two coordinate-descent passes over
the exact Voronoi adjacency graph (`Tones.tuneField`) eliminate unison neighbors
(`0.00 %` exact unison, `< 0.2 %` harsh intervals across 2,400+ adjacent pairs).
Cell hue encodes pitch class and lightness separates octaves.

## files

    index.html                     HUD, styles, script tags
    src/voronoi.js                 allocation-free half-plane Voronoi + adjacency
    src/physics.js                 softened gravity probe, bounce, stall recovery
    src/tones.js                   pentatonic placement, Voronoi tuning, curves
    src/sound.js                   cell-pinned 20-voice Web Audio synth
    src/app.js                     field state, audio frame, rendering, controls
    experiments/                   Node test suites, flight telemetry, WAV renderer

## checks

    npm test                       voronoi + physics + tones + page smoke suite
    npm run measure                flight parameter stats across radio presets
    npm run render                 offline WAV render + peak/RMS/clipping check

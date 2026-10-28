# experiment-sound-voronoi

A Voronoi diagram is the terrain: every point has mass, so its cell *is* its
gravity well. A probe flies through the field, and the cell under the probe plus
its two nearest neighbours are played by a small Web Audio synth. Pitch, volume,
tremolo and stereo position all come from the geometry.

Open `index.html` — no build, no server, no network.

## controls

| input | effect |
| --- | --- |
| click empty canvas | add a point |
| drag empty canvas | slingshot the probe (direction and size of the drag) |
| drag a point | move it, the field rebuilds live |
| right-click a point | remove it |
| R / C | random field / clear |
| 1 / 2 | sound mode |
| M | mute |
| P | pause (suspends audio) |
| space | kick the probe in a random direction |

## sound

Three voices: the cell under the probe and its two nearest neighbours, each voice
playing **its own cell tone** (no octave folding), so the chord is polyphonic and
a cell's colour is exactly the pitch you hear. Distances are normalised by the
cell's own radius: 0 on a point, 1 at the cell border.

- **pitch / cell** — sustained. Pitch is the cell tone, volume falls with the
  distance to the cell's point (the slider sets how hard), a slight shimmer keeps
  it alive.
- **tone / distance** — pulsed. Pitch and articulation both follow the distance:
  pitch `55 Hz · 2^(u·span/12)`, and one plucked envelope per cycle at
  30 Hz close … 0.1 Hz far, i.e. buzz near a point and a rare swell far from one.
  The slider sets the pitch span.

Panning follows the *direction* to a point, so a cell on the left is heard on the
left even when the probe is deep inside it.

## tuning of the field

Each new point takes the pentatonic degree that clashes least with the points
near it, priced with a dissonance table over pitch-class intervals (unison is
expensive). Every 260x220 px zone picks a root from the circle of fifths, so the
same degree is not repeated across the canvas while neighbouring zones share four
of five pitch classes. Measured on random fields: ~8 % of adjacent pairs share a
tone, < 1 % are a minor second or a tritone, and the field stays inside
C3..B4. `npm run check:tones` prints the current numbers.

## files

    index.html                    page, HUD, styles
    src/voronoi.js                flat Voronoi: half-plane clipping, adjacency
    src/physics.js                probe motion, trail, stall recovery
    src/tones.js                  pentatonic placement, distance mappings
    src/sound.js                  Web Audio voices
    src/app.js                    sites, interaction, audio frame, rendering
    experiments/                  node checks and measurements (not loaded by the page)

## checks

    npm test                      all four suites
    npm run check:voronoi         clipping exactness, adjacency, 300-site timing
    npm run check:physics         bounds, stability, stall recovery
    npm run check:tones           interval statistics of generated fields
    npm run check:page            drives the real page against a stub DOM/audio
    npm run measure               pitch/chord/pan/pulse-rate over a flight
    npm run render                offline synth render to sound-distance.wav

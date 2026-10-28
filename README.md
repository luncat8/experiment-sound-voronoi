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

Two modes, both driven by the nearest cell and its two nearest neighbours:

- **pitch / cell** — every point owns a pentatonic tone, so the pitch *is* the
  cell; volume falls with the distance to the cell's point. Cells are coloured by
  their tone, and the three sounding cells are outlined.
- **tone / distance** — pitch follows the distance to each point (55 Hz up to
  about 2.5 octaves) and the tremolo rate spans 30 Hz near … 0.1 Hz far, which
  turns the tremolo into an AM timbre up close.

The slider weights the distance → volume mapping in the first mode and the
distance → pitch span in the second. Left/right direction to a cell becomes the stereo pan.

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
    experiments/                  node checks (not loaded by the page)

## checks

    npm test                      all four suites
    npm run check:voronoi         clipping exactness, adjacency, 300-site timing
    npm run check:physics         bounds, stability, stall recovery
    npm run check:tones           interval statistics of generated fields
    npm run check:page            drives the real page against a stub DOM/audio

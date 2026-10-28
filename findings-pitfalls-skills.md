# findings, pitfalls, skills

Notes for agents working on this repo.

## audio in a headless sandbox

- Nothing to listen to and usually no browser: validate sound **numerically**.
  `experiments/smoke.js` runs the page scripts in a `vm` context against a stub
  DOM plus a stub `AudioContext` whose `AudioParam` records its
  `setTargetAtTime` target. That is enough to assert "mode 1 pitches are cell
  tones", "tremolo stays within 0.05..30 Hz" and "voices mute when the field is
  empty" — the three things that actually break.
- Keep the parametrization in a pure module (`src/tones.js`) and the Web Audio
  graph in another (`src/sound.js`); then endpoints like `tremolo(0) === 30` are
  unit-testable without a context.
- The stub orders node creation, so per voice the carrier is created before its
  LFO: even indices are carriers, odd are LFOs. Prefer distinguishing nodes by
  an explicit field if the graph ever grows.

## stereo and articulation (learned the hard way)

- **Pan by direction, not by distance.** `pan = dx / (width/2)` sounds like a
  fault report: inside a cell the nearest point is only tens of pixels away, so
  pan sits around ±0.1 and the stereo field is effectively dead. Normalise the
  vector first (`dx/|d|`) and fade the result near the point so a point directly
  under the listener does not snap to a side.
- **Octave doubling is not polyphony.** Three voices at `f`, `2f`, `0.5f` fuse
  into one perceived pitch *and* stop representing their source (a cell colour
  mapped to `f` was heard at `2f`). If voices are supposed to be distinguishable,
  give each its own pitch.
- **A sine tremolo never articulates.** Smooth amplitude modulation reads as a
  wobble at any rate. For "rare events far away, fast events up close" the
  envelope has to be a shaped one-shot per cycle: sawtooth LFO → WaveShaper with
  `attack·exp(-k·phase)` → the tremolo gain. Swapping the shaper curve and the LFO
  type on mode change is cheaper than rebuilding nodes.
- When switching between a modulation scheme and a fixed gain, zero the
  modulation depth first: base + leftover depth briefly doubles the gain (audible
  click/blip).
- **Normalise distances by the local scale.** `u = d / diagonal` compresses
  everything: the nearest site is rarely a third of the diagonal away, so a
  0.1..30 Hz mapping only ever produced 2..15 Hz. `u = d / cellRadius` puts
  `u = 0` on the point and `u = 1` on the cell border and makes the whole range
  reachable inside one cell.

## auditioning without speakers

- Keep the parameter stream observable (`page.voice(i)` in the stub) and print
  statistics over a flight: distinct pitches per frame, mean |pan| with a
  left/right split, min/median/max rate, and the share of samples in the fast and
  rare ends. Those numbers catch every failure above.
- `experiments/render-audio.js` renders the same parameter stream through a small
  software synth (triangle → one-pole lowpass → envelope → equal-power pan) into a
  WAV. It verifies the signal itself (peak, clipping, RMS, envelope attacks per
  second, silent windows) and can be played back by a human.

## voronoi by half-plane clipping

- Clip the view rect per site with `f(p) = |p-si|² - |p-sj|²`, which is affine:
  `a = 2(xj-xi)`, `b = 2(yj-yi)`, `c = |si|² - |sj|²`. One multiply-add per test,
  exact crossings, no trigonometry.
- The squared distance to the farthest current vertex (`reach`) bounds the work:
  a site beyond `2·reach` cannot clip the cell. Cheap to maintain during clipping
  and it makes the naive O(n²) loop fast enough (~1.7 ms for 300 sites).
- Adjacency needs no Delaunay either: j is a neighbour of i iff some vertex of
  cell i satisfies `|f| <= 1e-4·d²`. Same loop, same predicate, and it is
  symmetric by construction.
- Gotcha: `nbr` is flat with stride `MAX_NEIGHBORS`, so cell 1 starts at index
  `1 * stride`, not at `1` — `voronoi.nbr[1]` is still cell 0's list. Test bugs
  here look like "adjacency is wrong" when the code is fine.

## visual checks without a browser

- ImageMagick's SVG delegate may be missing (`rsvg-convert`), and PNG via
  `convert` then fails. A ~120-line software rasterizer (polygon scanline fill +
  alpha blend + `zlib` PNG writer) renders the exact scene maths to a PNG that
  can be inspected — useful for brightness/layout decisions.
- For cell brightness, compare candidates by rendering the same field several
  times with only the alpha changed; pick by looking, not by guessing.

## tuning placement algorithms

- Measure the outcome, don't trust the weights: `experiments/check-tones.js` builds
  40 random fields and prints the interval histogram of adjacent pairs. The first
  weighting produced 34 % unison and 53 % fifths (the unison penalty was too low);
  raising it and adding the zone root gave 8 % unison, < 1 % harsh.
- Randomness in placement makes results noisy per field; always aggregate over
  dozens of seeds before changing a constant.
- A position hash is a good tie-breaker but a bad main score — as a full score it
  makes adjacent cells random.

## misc

- Per-frame code: no literals, closures or string building. Preallocate the frame
  struct, the palette strings (rebuilt only when a site changes) and the trail.
- `setTargetAtTime` on every parameter every frame is simpler and safer than
  keeping smoothing state in JS; it survives dropped frames without clicks.

# findings, pitfalls, skills

Notes for agents working on this repo.

## voice-to-cell pinning vs rank-ordered voice slots

- Mapping `voice[0], voice[1], voice[2]` by distance rank (`nearest, 2nd, 3rd`)
  causes two audible bugs:
  1. It silently drops most Voronoi neighbors (`nbrCount` averages ~5.5, up to 12+).
  2. Whenever two neighbors swap rank in distance, `voice[1]` and `voice[2]` trade
     cells and `setTargetAtTime` glides frequency and pans across the listener's
     head between unrelated points.
- Fix: preallocate a voice pool (`MAX_VOICES = 20`) with `slotCell[slot] = cellId`.
  Cells staying in `{near} U adj(near)` keep their slot; newly entering cells snap
  `osc.frequency`, `pan`, `lfo.frequency` via `cancelScheduledValues` +
  `setValueAtTime` while `level.gain` starts at `0`, then ramp level up. Exiting
  cells ramp `level.gain` to `0` before releasing their slot.

## unipolar sine envelope without clicks or WaveShaper

- A bipolar Web Audio `sine` LFO (`-1..+1`) creates clean unipolar `[0..1]`
  modulation when `envGain = 1 - 0.5 * depth` and `modGain = 0.5 * depth`.
- Driving both `envGain.gain` and `modGain.gain` with the **identical**
  `setTargetAtTime` time constant preserves `envGain(t) + modGain(t) === 1` at
  every sample during transitions (entering `<20 px` continuous core or toggling
  the envelope radio button) — zero gain overshoot and zero WaveShaper overhead.

## tuning over actual Voronoi adjacency vs sequential insertion

- Scoring candidate pentatonic tones only at insertion time against Euclidean
  distance `< 340 px` ignores points inserted later between existing sites,
  leaving ~8 % exact-unison Voronoi neighbors.
- Running 2 coordinate-descent passes (`Tones.tuneField`) directly over
  `voronoi.nbr` after `voronoi.build()` drops exact-unison Voronoi neighbors from
  `8.3 %` to `0.00 %` and harsh cross-zone intervals to `0.12 %` with zero heap
  allocations.

## distance curves across both center and adjacent cells

- Normalising distance as `u = clamp(d / cellRadius, 0, 1)` pins almost every
  adjacent cell at `u = 1.0` because adjacent sites sit outside `cellRadius`.
- Smooth asymptotic curves over pixel distance (`10 * 1000^exp(-d / scale)` for
  `10 kHz -> 10 Hz`, `1 / (1 + (d / scale)^2)` for volume, and
  `0.1 * 300^exp(-max(0, d - 20) / scale)` for `30 Hz -> 0.1 Hz` sine modulation)
  keep both the nearest site and all adjacent cells differentiated while steepness
  sliders scale `scale = maxPx * (minPx / maxPx)^steep` geometrically.
- Lowpass cutoff must allow up to `18 kHz` (`clamp(freq * 4.5, 90, 18000)`) so
  `10 kHz` close-range tones are not muffled, while keeping a `90 Hz` floor so
  `10 Hz` triangle carriers remain audible via gentle odd harmonics (`30, 50, 70 Hz`).

## audio in a headless sandbox

- Validate sound numerically via `experiments/stub-page.js` (`FakeParam` must
  record both `setValueAtTime` and `setTargetAtTime` targets), `measure-sound.js`
  (flight parameter distributions), and `render-audio.js` (offline WAV render +
  peak/RMS/clipping checks).

## voronoi by half-plane clipping

- Clip the view rect per site with `f(p) = |p-si|^2 - |p-sj|^2 = a*x + b*y + c`.
- Squared distance to the farthest current vertex (`reach`) bounds clipping work:
  sites with `d^2 > 4*reach` cannot clip the cell (~1.6 ms for 300 sites).
- `nbr` is flat with stride `MAX_NEIGHBORS`; cell `i` starts at `i * nbrStride`.

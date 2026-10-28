(function (root) {
	'use strict';

	const PENTA = [0, 2, 4, 7, 9];
	// Circle-of-fifths roots: pentatonics built on these overlap in four of five
	// pitch classes, so zone borders stay consonant while the same degree is not
	// repeated across the whole canvas.
	const FIFTHS = [0, 7, 2, 9, 5];
	// Rough dissonance per pitch-class interval above the lower note. Unison is
	// expensive so neighbours never share a tone; in a pentatonic set only the
	// minor second and the tritone are actually harsh.
	const DISSONANCE = [7, 10, 1.5, 1, 0.8, 2.2, 10];
	const ZONE_W = 260;
	const ZONE_H = 220;
	const INFLUENCE = 340;
	const INFLUENCE2 = INFLUENCE * INFLUENCE;
	const BASE_FREQ = 130.81;   // C3 = semitone 0
	const MAX_SEMITONE = 23;    // two octaves above C3

	function mix(x, y) {
		let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
		h = Math.imul(h ^ (h >>> 13), 1274126177);
		return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
	}

	// Cheapest pentatonic degree for a new point: candidates are scored against
	// the points within INFLUENCE px, near ones weighing more. The hash term only
	// breaks ties, which keeps the placement deterministic for a given position.
	function pick(x, y, xs, ys, semitones, count, skip) {
		const zoneRoot = FIFTHS[(mix(Math.floor(x / ZONE_W), Math.floor(y / ZONE_H)) * 5) | 0];
		let best = 0;
		let bestScore = Infinity;
		for (let s = 0; s < 10; s++) {
			const semitone = ((zoneRoot + PENTA[s % 5]) % 12) + 12 * ((s / 5) | 0);
			if (semitone > MAX_SEMITONE) continue;
			let score = mix(x * 31 + s * 17, y * 13 - s * 7);
			for (let i = 0; i < count; i++) {
				if (i === skip) continue;
				const dx = xs[i] - x;
				const dy = ys[i] - y;
				const d2 = dx * dx + dy * dy;
				if (d2 > INFLUENCE2) continue;
				let interval = Math.abs(semitones[i] - semitone) % 12;
				if (interval > 6) interval = 12 - interval;
				score += DISSONANCE[interval] * 320 / (Math.sqrt(d2) + 40);
			}
			if (score < bestScore) {
				bestScore = score;
				best = semitone;
			}
		}
		return best;
	}

	// Mode "tone / distance": u = 0 at the point, 1 at the reference distance.
	// One plucked envelope per cycle: 30 Hz close (an AM timbre) down to 0.1 Hz
	// far away (a single swell every ten seconds).
	function pulseRate(u) {
		const k = u < 0 ? 0 : u > 1 ? 1 : u;
		return 0.1 * Math.pow(300, 1 - k);
	}

	function pitch(u, spanSemitones) {
		const k = u < 0 ? 0 : u > 1 ? 1 : u;
		return 55 * Math.pow(2, (k * spanSemitones) / 12);
	}

	function hz(semitone) {
		return BASE_FREQ * Math.pow(2, semitone / 12);
	}

	function hue(semitone) {
		return (((semitone % 12) + 12) % 12) * 30;
	}

	const api = { pick, hz, hue, pulseRate, pitch };
	root.GS = root.GS || {};
	root.GS.Tones = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

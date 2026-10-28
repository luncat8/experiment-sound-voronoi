(function (root) {
	'use strict';

	const PENTA = [0, 2, 4, 7, 9];
	// Circle-of-fifths roots: adjacent spatial zones share four of five pitch
	// classes, keeping borders consonant without repeating one scale globally.
	const FIFTHS = [0, 7, 2, 9, 5];
	const DISSONANCE = [8, 12, 1.5, 1, 0.8, 2.2, 12];
	const ZONE_W = 260;
	const ZONE_H = 220;
	const INFLUENCE = 340;
	const INFLUENCE2 = INFLUENCE * INFLUENCE;
	const BASE_FREQ = 130.81; // C3 = semitone 0
	const MAX_SEMITONE = 23;  // C3..B4

	const FREQ_MIN = 10;
	const FREQ_MAX = 10000;
	const ENV_CONT_PX = 20;
	const ENV_RAMP_PX = 8;
	const ENV_MIN_HZ = 0.1;
	const ENV_MAX_HZ = 30;

	function clamp01(v) {
		return v < 0 ? 0 : v > 1 ? 1 : v;
	}

	function scalePx(steep, minPx, maxPx) {
		return maxPx * Math.pow(minPx / maxPx, clamp01(steep));
	}

	function mix(x, y) {
		let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
		h = Math.imul(h ^ (h >>> 13), 1274126177);
		return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
	}

	function zoneRoot(x, y) {
		return FIFTHS[(mix(Math.floor(x / ZONE_W), Math.floor(y / ZONE_H)) * 5) | 0];
	}

	function intervalPenalty(a, b) {
		if (a === b) return 22;
		let iv = Math.abs(a - b) % 12;
		if (iv > 6) iv = 12 - iv;
		return DISSONANCE[iv];
	}

	function pick(x, y, xs, ys, semitones, count, skip) {
		const rootNote = zoneRoot(x, y);
		let best = 0;
		let bestScore = Infinity;
		for (let s = 0; s < 10; s++) {
			const semitone = ((rootNote + PENTA[s % 5]) % 12) + 12 * ((s / 5) | 0);
			if (semitone > MAX_SEMITONE) continue;
			let score = mix(x * 31 + s * 17, y * 13 - s * 7) * 0.6;
			for (let i = 0; i < count; i++) {
				if (i === skip) continue;
				const dx = xs[i] - x;
				const dy = ys[i] - y;
				const d2 = dx * dx + dy * dy;
				if (d2 > INFLUENCE2) continue;
				score += intervalPenalty(semitones[i], semitone) * 320 / (Math.sqrt(d2) + 40);
			}
			if (score < bestScore) {
				bestScore = score;
				best = semitone;
			}
		}
		return best;
	}

	// Refines tones directly over the Voronoi adjacency graph so neighboring cells
	// avoid unison and harsh cross-zone intervals regardless of insertion order.
	function tuneField(xs, ys, semitones, count, nbr, nbrCount, nbrStride) {
		for (let pass = 0; pass < 2; pass++) {
			for (let i = 0; i < count; i++) {
				semitones[i] = tuneCell(i, xs, ys, semitones, nbr, nbrCount, nbrStride);
			}
		}
	}

	function tuneCell(i, xs, ys, semitones, nbr, nbrCount, nbrStride) {
		const x = xs[i];
		const y = ys[i];
		const rootNote = zoneRoot(x, y);
		const base = i * nbrStride;
		const deg = nbrCount[i];
		let best = semitones[i];
		let bestScore = Infinity;
		for (let s = 0; s < 10; s++) {
			const semitone = ((rootNote + PENTA[s % 5]) % 12) + 12 * ((s / 5) | 0);
			if (semitone > MAX_SEMITONE) continue;
			let score = mix(x * 31 + s * 17, y * 13 - s * 7) * 0.4;
			for (let k = 0; k < deg; k++) {
				const j = nbr[base + k];
				const dx = xs[j] - x;
				const dy = ys[j] - y;
				const d = Math.sqrt(dx * dx + dy * dy);
				score += intervalPenalty(semitones[j], semitone) * 360 / (d + 36);
			}
			if (score < bestScore) {
				bestScore = score;
				best = semitone;
			}
		}
		return best;
	}

	// Distance -> frequency: 10 kHz at 0 px, decaying toward 10 Hz far away.
	function distFreq(distPx, steep) {
		const d = distPx <= 0 ? 0 : distPx;
		const scale = scalePx(steep, 20, 280);
		return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, Math.exp(-d / scale));
	}

	// Distance -> normalized volume (0..1): 1 at 0 px, Lorentzian falloff.
	function distVolume(distPx, steep) {
		const d = distPx <= 0 ? 0 : distPx;
		const scale = scalePx(steep, 22, 320);
		const u = d / scale;
		return 1 / (1 + u * u);
	}

	// Envelope modulation depth: strictly 0 (continuous) inside <20 px, smooth ramp
	// to full unipolar sine modulation outside.
	function envDepth(distPx) {
		if (distPx < ENV_CONT_PX) return 0;
		const over = distPx - ENV_CONT_PX;
		if (over >= ENV_RAMP_PX) return 1;
		const t = over / ENV_RAMP_PX;
		return t * t * (3 - 2 * t);
	}

	// Envelope sine frequency: 30 Hz entering mid range (>=20 px) down to 0.1 Hz far.
	function envRate(distPx, steep) {
		const over = distPx <= ENV_CONT_PX ? 0 : distPx - ENV_CONT_PX;
		const scale = scalePx(steep, 28, 300);
		return ENV_MIN_HZ * Math.pow(ENV_MAX_HZ / ENV_MIN_HZ, Math.exp(-over / scale));
	}

	function hz(semitone) {
		return BASE_FREQ * Math.pow(2, semitone / 12);
	}

	function hue(semitone) {
		return (((semitone % 12) + 12) % 12) * 30;
	}

	function lightness(semitone) {
		return semitone >= 12 ? 60 : 48;
	}

	const api = {
		ENV_CONT_PX,
		FREQ_MIN,
		FREQ_MAX,
		ENV_MIN_HZ,
		ENV_MAX_HZ,
		pick,
		tuneCell,
		tuneField,
		distFreq,
		distVolume,
		envDepth,
		envRate,
		hz,
		hue,
		lightness,
	};
	root.GS = root.GS || {};
	root.GS.Tones = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

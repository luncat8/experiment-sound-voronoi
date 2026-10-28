'use strict';
// Measures the generated tuning: is the field pentatonic, are adjacent cells
// consonant, and how often do neighbours share a tone?
const path = require('path');
const Voronoi = require(path.join(__dirname, '..', 'src', 'voronoi.js'));
const Tones = require(path.join(__dirname, '..', 'src', 'tones.js'));

const W = 1280;
const H = 720;
const PENTA = [0, 2, 4, 7, 9];
const SEEDS = 40;
let failures = 0;

function check(name, ok, detail) {
	if (ok) {
		console.log('  ok   ' + name);
		return;
	}
	failures++;
	console.log('  FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']'));
}

function rand(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Same placement rule the app uses: random position, reject closer than MIN_GAP.
function field(n, seed, minGap) {
	const rnd = rand(seed);
	const xs = new Float64Array(n);
	const ys = new Float64Array(n);
	let count = 0;
	let tries = 0;
	while (count < n && tries++ < 20000) {
		const x = 30 + rnd() * (W - 60);
		const y = 30 + rnd() * (H - 60);
		let ok = true;
		for (let i = 0; i < count; i++) {
			const dx = xs[i] - x;
			const dy = ys[i] - y;
			if (dx * dx + dy * dy < minGap * minGap) {
				ok = false;
				break;
			}
		}
		if (!ok) continue;
		xs[count] = x;
		ys[count] = y;
		count++;
	}
	return { xs, ys, count };
}

function measure(minGap, n, label) {
	const v = new Voronoi();
	const histogram = new Array(7).fill(0);
	let pairs = 0;
	let unison = 0;
	let harsh = 0;
	let third = 0;
	let offScale = 0;

	for (let seed = 1; seed <= SEEDS; seed++) {
		const f = field(n, seed, minGap);
		const semitones = new Int16Array(f.count);
		for (let i = 0; i < f.count; i++) {
			semitones[i] = Tones.pick(f.xs[i], f.ys[i], f.xs, f.ys, semitones, f.count, i);
			const root = zoneRootAt(f.xs[i], f.ys[i]);
			const pitchClass = ((semitones[i] % 12) + 12) % 12;
			if (!PENTA.some(degree => (degree + root) % 12 === pitchClass)) offScale++;
		}
		v.build(f.xs, f.ys, f.count, W, H);
		for (let i = 0; i < f.count; i++) {
			for (let k = 0; k < v.nbrCount[i]; k++) {
				const j = v.nbr[i * v.nbrStride + k];
				if (j < i) continue;
				let interval = Math.abs(semitones[i] - semitones[j]) % 12;
				if (interval > 6) interval = 12 - interval;
				histogram[interval]++;
				pairs++;
				if (interval === 0) unison++;
				if (interval === 1 || interval === 6) harsh++;
				if (interval === 3 || interval === 4) third++;
			}
		}
	}

	const sameTone = (100 * unison) / pairs;
	const harshShare = (100 * harsh) / pairs;
	const thirdShare = (100 * third) / pairs;
	console.log(
		'  ..   ' + label + ': ' + pairs + ' adjacent pairs, unison ' + sameTone.toFixed(1) + '%, harsh ' +
		harshShare.toFixed(1) + '%, thirds ' + thirdShare.toFixed(1) + '%, off-scale ' + offScale
	);
	console.log('  ..   interval classes 0..6 ' + histogram.map(h => ((100 * h) / pairs).toFixed(1)).join(' / '));
	return { pairs, sameTone, harshShare, thirdShare, offScale };
}

// Zone root for a position, mirroring the zone hash inside Tones.
function zoneRootAt(x, y) {
	const zoneRoots = [0, 7, 2, 9, 5];
	let h = Math.imul(Math.floor(x / 260) | 0, 374761393) ^ Math.imul(Math.floor(y / 220) | 0, 668265263);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
	return zoneRoots[(h * 5) | 0];
}

console.log('tuning');
const normal = measure(34, 26, '26 sites');
check('every cell stays on the pentatonic grid', normal.offScale === 0, normal.offScale);
check('neighbours rarely share a tone', normal.sameTone < 15, normal.sameTone.toFixed(1) + '%');
check('neighbours are almost never harsh', normal.harshShare < 4, normal.harshShare.toFixed(1) + '%');
check('thirds and fourths dominate', normal.thirdShare > 15, normal.thirdShare.toFixed(1) + '%');

const sparse = measure(90, 10, '10 sites, wide gaps');
check('sparse fields stay consonant', sparse.harshShare < 8, sparse.harshShare.toFixed(1) + '%');

console.log('range');
{
	let low = Infinity;
	let high = -Infinity;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const f = field(26, seed, 34);
		const semitones = new Int16Array(f.count);
		for (let i = 0; i < f.count; i++) {
			semitones[i] = Tones.pick(f.xs[i], f.ys[i], f.xs, f.ys, semitones, f.count, i);
			low = Math.min(low, semitones[i]);
			high = Math.max(high, semitones[i]);
		}
	}
	console.log('  ..   semitone range ' + low + ' .. ' + high + ' (' + Tones.hz(low).toFixed(1) + ' Hz .. ' + Tones.hz(high).toFixed(1) + ' Hz)');
	check('stays in the C3..B4 register', low >= 0 && high <= 23, low + '..' + high);
}

console.log('distance mapping');
{
	check('pulse rate is 30 Hz at the point', Math.abs(Tones.pulseRate(0) - 30) < 1e-9, Tones.pulseRate(0));
	check('pulse rate is 0.1 Hz at the reference distance', Math.abs(Tones.pulseRate(1) - 0.1) < 1e-9, Tones.pulseRate(1));
	check('pulse rate clamps outside 0..1', Tones.pulseRate(-3) === 30 && Tones.pulseRate(4) === 0.1);
	let falling = true;
	let previous = Infinity;
	for (let i = 0; i <= 20; i++) {
		const rate = Tones.pulseRate(i / 20);
		if (rate >= previous) falling = false;
		previous = rate;
	}
	check('pulse rate falls monotonically with distance', falling);

	check('pitch starts at 55 Hz', Math.abs(Tones.pitch(0, 30) - 55) < 1e-9, Tones.pitch(0, 30));
	check('pitch spans the requested interval', Math.abs(Tones.pitch(1, 30) - 55 * Math.pow(2, 30 / 12)) < 1e-6, Tones.pitch(1, 30));
	check('a wider slider stretches the pitch range', Tones.pitch(0.5, 44) > Tones.pitch(0.5, 14));
}

console.log('hue');
{
	const hues = new Set();
	for (let s = 0; s <= 23; s++) hues.add(Tones.hue(s));
	check('twelve distinct hues', hues.size === 12, hues.size);
	check('same pitch class shares a hue', Tones.hue(3) === Tones.hue(15));
}

console.log(failures === 0 ? '\nall tone checks passed' : '\n' + failures + ' tone check(s) failed');
process.exitCode = failures === 0 ? 0 : 1;

'use strict';
// Measures pentatonic field placement + Voronoi relaxation + distance curves.
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

function zoneRootAt(x, y) {
	const zoneRoots = [0, 7, 2, 9, 5];
	let h = Math.imul(Math.floor(x / 260) | 0, 374761393) ^ Math.imul(Math.floor(y / 220) | 0, 668265263);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
	return zoneRoots[(h * 5) | 0];
}

function measure(minGap, n, label) {
	const v = new Voronoi();
	const histogram = new Array(7).fill(0);
	let pairs = 0;
	let exactUnison = 0;
	let octaveUnison = 0;
	let harsh = 0;
	let third = 0;
	let offScale = 0;
	const globalPitchClasses = new Set();

	for (let seed = 1; seed <= SEEDS; seed++) {
		const f = field(n, seed, minGap);
		const semitones = new Int16Array(f.count);
		for (let i = 0; i < f.count; i++) {
			semitones[i] = Tones.pick(f.xs[i], f.ys[i], f.xs, f.ys, semitones, f.count, i);
		}
		v.build(f.xs, f.ys, f.count, W, H);
		Tones.tuneField(f.xs, f.ys, semitones, f.count, v.nbr, v.nbrCount, v.nbrStride);

		for (let i = 0; i < f.count; i++) {
			const root = zoneRootAt(f.xs[i], f.ys[i]);
			const pc = ((semitones[i] % 12) + 12) % 12;
			globalPitchClasses.add(pc);
			if (!PENTA.some(degree => (degree + root) % 12 === pc)) offScale++;
		}
		for (let i = 0; i < f.count; i++) {
			for (let k = 0; k < v.nbrCount[i]; k++) {
				const j = v.nbr[i * v.nbrStride + k];
				if (j < i) continue;
				if (semitones[i] === semitones[j]) exactUnison++;
				let interval = Math.abs(semitones[i] - semitones[j]) % 12;
				if (interval > 6) interval = 12 - interval;
				histogram[interval]++;
				pairs++;
				if (interval === 0) octaveUnison++;
				if (interval === 1 || interval === 6) harsh++;
				if (interval === 3 || interval === 4) third++;
			}
		}
	}

	const exactShare = (100 * exactUnison) / pairs;
	const sameClass = (100 * octaveUnison) / pairs;
	const harshShare = (100 * harsh) / pairs;
	const thirdShare = (100 * third) / pairs;
	console.log(
		'  ..   ' + label + ': ' + pairs + ' pairs, exact unison ' + exactShare.toFixed(2) +
		'%, pitch-class unison ' + sameClass.toFixed(1) + '%, harsh ' + harshShare.toFixed(2) +
		'%, thirds ' + thirdShare.toFixed(1) + '%, pitch classes ' + globalPitchClasses.size
	);
	console.log('  ..   interval classes 0..6 ' + histogram.map(h => ((100 * h) / pairs).toFixed(1)).join(' / '));
	return { pairs, exactShare, sameClass, harshShare, thirdShare, offScale, classes: globalPitchClasses.size };
}

console.log('tuning');
const normal = measure(34, 26, '26 sites');
check('every cell stays on its local pentatonic grid', normal.offScale === 0, normal.offScale);
check('canvas shifts pentatonic zones (not one 5-note repeat)', normal.classes > 5, normal.classes);
check('voronoi neighbors almost never share exact tone', normal.exactShare < 1, normal.exactShare.toFixed(2) + '%');
check('voronoi neighbors rarely share pitch class', normal.sameClass < 10, normal.sameClass.toFixed(1) + '%');
check('voronoi neighbors avoid harsh intervals', normal.harshShare < 1.5, normal.harshShare.toFixed(2) + '%');
check('thirds and fourths dominate', normal.thirdShare > 15, normal.thirdShare.toFixed(1) + '%');

const sparse = measure(90, 10, '10 sites, wide gaps');
check('sparse fields stay consonant', sparse.harshShare < 3, sparse.harshShare.toFixed(2) + '%');

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

console.log('distance -> frequency (10 kHz at 0 px .. 10 Hz far)');
{
	check('0 px hits 10 kHz', Math.abs(Tones.distFreq(0, 0.5) - 10000) < 1e-9, Tones.distFreq(0, 0.5));
	check('far distance approaches 10 Hz', Tones.distFreq(2000, 0.5) < 10.05 && Tones.distFreq(2000, 0.5) >= 10, Tones.distFreq(2000, 0.5));
	let monotone = true;
	let prev = Infinity;
	for (let d = 0; d <= 500; d += 25) {
		const f = Tones.distFreq(d, 0.5);
		if (f >= prev) monotone = false;
		prev = f;
	}
	check('frequency falls monotonically with distance', monotone);
	check('steeper slider makes frequency fall faster', Tones.distFreq(80, 0.9) < Tones.distFreq(80, 0.1));
}

console.log('distance -> volume');
{
	check('0 px hits full normalized volume 1', Tones.distVolume(0, 0.5) === 1);
	check('far distance decays near 0', Tones.distVolume(800, 0.5) < 0.02, Tones.distVolume(800, 0.5));
	check('steeper slider makes volume fall faster', Tones.distVolume(80, 0.9) < Tones.distVolume(80, 0.1));
}

console.log('distance -> sine envelope (<20 px continuous, mid 30 Hz .. far 0.1 Hz)');
{
	let contInside20 = true;
	for (let d = 0; d < 20; d += 2) {
		if (Tones.envDepth(d) !== 0) contInside20 = false;
	}
	check('<20 px has zero modulation depth (continuous)', contInside20);
	check('>=28 px reaches full sine modulation depth 1', Tones.envDepth(28) === 1 && Tones.envDepth(200) === 1);
	check('mid-range onset at 20 px is 30 Hz', Math.abs(Tones.envRate(20, 0.5) - 30) < 1e-9, Tones.envRate(20, 0.5));
	check('far range approaches 0.1 Hz', Tones.envRate(2500, 0.5) < 0.101 && Tones.envRate(2500, 0.5) >= 0.1, Tones.envRate(2500, 0.5));
	let monotone = true;
	let prev = Infinity;
	for (let d = 20; d <= 520; d += 25) {
		const r = Tones.envRate(d, 0.5);
		if (r >= prev) monotone = false;
		prev = r;
	}
	check('envelope rate falls monotonically outside 20 px', monotone);
	check('steeper slider makes envelope rate fall faster', Tones.envRate(90, 0.9) < Tones.envRate(90, 0.1));
}

console.log('color mapping');
{
	const colors = new Set();
	for (let s = 0; s <= 23; s++) colors.add(Tones.hue(s) + ':' + Tones.lightness(s));
	check('24 distinct tone colors across two octaves', colors.size === 24, colors.size);
	check('same pitch class shares hue', Tones.hue(4) === Tones.hue(16));
}

console.log(failures === 0 ? '\nall tone checks passed' : '\n' + failures + ' tone check(s) failed');
process.exitCode = failures === 0 ? 0 : 1;

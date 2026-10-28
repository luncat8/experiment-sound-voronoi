'use strict';
// Samples live voice parameters over a 45 s flight for any combination of the
// three radio groups: <point|dist>-<dist|const>-<env|off>.
const { createPage } = require('./stub-page');

const PRESETS = {
	cell: ['freq-point', 'vol-dist', 'env-off'],
	distance: ['freq-dist', 'vol-const', 'env-dist'],
};

function parsePreset(arg) {
	if (!arg) return ['freq-point', 'vol-dist', 'env-dist'];
	if (PRESETS[arg]) return PRESETS[arg];
	const parts = arg.split('-');
	return [
		parts[0] === 'dist' ? 'freq-dist' : 'freq-point',
		parts[1] === 'const' ? 'vol-const' : 'vol-dist',
		parts[2] === 'off' ? 'env-off' : 'env-dist',
	];
}

const label = process.argv[2] || 'point-dist-env';
const [freqId, volId, envId] = parsePreset(process.argv[2]);
const page = createPage();
const Tones = page.sandbox.GS.Tones;

function pick(id, group) {
	for (const g of group) page.element(g).checked = g === id;
	page.element(id).dispatch('change');
}

page.dispatchWindow('keydown', { key: 'r' });
pick(freqId, ['freq-point', 'freq-dist']);
pick(volId, ['vol-dist', 'vol-const']);
pick(envId, ['env-dist', 'env-off']);
page.dispatchWindow('keydown', { key: ' ' });
page.tick(30, 0);

const SECONDS = 45;
const STEP_FRAMES = 3;
const stats = {
	frames: 0,
	voices: 0,
	distinct: 0,
	pans: [],
	rates: [],
	mods: [],
	levels: [],
	left: 0,
	right: 0,
	contSamples: 0,
	pitches: [],
};

let time = 0;
const steps = Math.round((SECONDS * 60) / STEP_FRAMES);
for (let step = 0; step < steps; step++) {
	time = page.tick(STEP_FRAMES, time);
	const active = page.activeVoices().filter(v => v.level.gain.target > 0.005);
	if (active.length === 0) continue;
	stats.frames++;
	stats.voices += active.length;
	const pitches = active.map(v => v.carrier.frequency.target);
	stats.pitches.push.apply(stats.pitches, pitches);
	stats.distinct += new Set(pitches.map(p => p.toFixed(1))).size;
	for (const v of active) {
		stats.levels.push(v.level.gain.target);
		stats.rates.push(v.lfo.frequency.target);
		const mod = v.mod.gain.target;
		stats.mods.push(mod);
		if (mod === 0) stats.contSamples++;
		const pan = v.pan.pan.target;
		stats.pans.push(pan);
		if (pan < -0.15) stats.left++;
		if (pan > 0.15) stats.right++;
	}
}

const avg = list => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
const median = list => {
	const sorted = list.slice().sort((a, b) => a - b);
	return sorted[(sorted.length / 2) | 0] || 0;
};

let minPitch = Infinity;
let maxPitch = -Infinity;
for (const p of stats.pitches) {
	if (p < minPitch) minPitch = p;
	if (p > maxPitch) maxPitch = p;
}
let minRate = Infinity;
let maxRate = -Infinity;
for (const r of stats.rates) {
	if (r < minRate) minRate = r;
	if (r > maxRate) maxRate = r;
}

const fast = stats.rates.filter(r => r > 8).length;
const slow = stats.rates.filter(r => r < 0.5).length;
const onGrid = stats.pitches.every(hz => {
	for (let s = 0; s <= 23; s++) if (Math.abs(hz - Tones.hz(s)) < 1e-6) return true;
	return false;
});

console.log('preset          ' + label + ' (' + freqId + ', ' + volId + ', ' + envId + ')');
console.log('frames sampled  ' + stats.frames + ' (' + SECONDS + ' s)');
console.log('voices / frame  ' + (stats.voices / Math.max(1, stats.frames)).toFixed(2));
console.log('distinct pitch  ' + (stats.distinct / Math.max(1, stats.frames)).toFixed(2) + ' per frame');
console.log('pitch range     ' + minPitch.toFixed(1) + ' .. ' + maxPitch.toFixed(1) + ' Hz, ' +
	new Set(stats.pitches.map(p => p.toFixed(0))).size + ' distinct');
console.log('level / voice   ' + avg(stats.levels).toFixed(3));
console.log('pan             mean |pan| ' + avg(stats.pans.map(Math.abs)).toFixed(2) + ', left ' +
	((100 * stats.left) / Math.max(1, stats.pans.length)).toFixed(0) + '%, right ' +
	((100 * stats.right) / Math.max(1, stats.pans.length)).toFixed(0) + '%');
console.log('env rate        ' + minRate.toFixed(2) + ' .. ' + maxRate.toFixed(2) + ' Hz, median ' + median(stats.rates).toFixed(2));
console.log('env regimes     ' + ((100 * stats.contSamples) / Math.max(1, stats.mods.length)).toFixed(1) +
	'% continuous, ' + ((100 * fast) / Math.max(1, stats.rates.length)).toFixed(0) + '% fast (>8 Hz), ' +
	((100 * slow) / Math.max(1, stats.rates.length)).toFixed(0) + '% slow (<0.5 Hz)');
console.log('tone            ' + (onGrid ? 'all cell tones' : 'continuous distance pitches'));

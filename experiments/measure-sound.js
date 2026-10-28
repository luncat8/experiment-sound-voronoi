'use strict';
// Samples the live voice parameters over a simulated flight and reports what the
// piece will sound like: pitch spread, chord density, stereo spread, pulse rate.
// Prints plain numbers so runs can be compared after a change.
const { createPage } = require('./stub-page');

const page = createPage();
const Tones = page.sandbox.GS.Tones;
const MODE = process.argv[2] === 'distance' ? 'distance' : 'cell';
const SECONDS = 45;
const STEP_FRAMES = 3;

page.dispatchWindow('keydown', { key: 'r' });
if (MODE === 'distance') page.dispatchWindow('keydown', { key: '2' });
// The probe has to fly before it leaves the middle of whatever cell it starts in.
page.dispatchWindow('keydown', { key: ' ' });
page.tick(30, 0);

const stats = {
	frames: 0,
	voices: 0,
	distinct: 0,
	unisonFrames: 0,
	pans: [],
	rates: [],
	levels: [[]],
	left: 0,
	right: 0,
	matched: 0,
	pitches: [],
};

let time = 0;
const steps = Math.round((SECONDS * 60) / STEP_FRAMES);
for (let step = 0; step < steps; step++) {
	time = page.tick(STEP_FRAMES, time);
	const active = [0, 1, 2].map(i => page.voice(i)).filter(v => typeof v.level.gain.target === 'number' && v.level.gain.target > 0.005);
	if (active.length === 0) continue;
	stats.frames++;
	stats.voices += active.length;
	const pitches = active.map(v => v.carrier.frequency.target);
	stats.pitches.push.apply(stats.pitches, pitches);
	stats.distinct += new Set(pitches.map(p => p.toFixed(1))).size;
	if (new Set(pitches.map(p => p.toFixed(1))).size < pitches.length) stats.unisonFrames++;
	for (let i = 0; i < active.length; i++) {
		stats.levels[0].push(active[i].level.gain.target);
		stats.rates.push(active[i].lfo.frequency.target);
		const pan = active[i].pan.pan.target;
		stats.pans.push(pan);
		if (pan < -0.15) stats.left++;
		if (pan > 0.15) stats.right++;
	}
}

const average = list => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
const median = list => {
	const sorted = list.slice().sort((a, b) => a - b);
	return sorted[(sorted.length / 2) | 0] || 0;
};
const panMagnitude = stats.pans.map(Math.abs);

console.log('mode            ' + MODE);
console.log('frames sampled  ' + stats.frames + ' (' + SECONDS + ' s)');
console.log('voices / frame  ' + average(new Array(stats.frames).fill(stats.voices / Math.max(1, stats.frames))).toFixed(2));
console.log('distinct pitch  ' + (stats.distinct / Math.max(1, stats.frames)).toFixed(2) + ' per frame, ' +
	((100 * stats.unisonFrames) / Math.max(1, stats.frames)).toFixed(1) + '% frames with a doubled pitch');
console.log('pitch range     ' + Math.min.apply(null, stats.pitches).toFixed(1) + ' .. ' +
	Math.max.apply(null, stats.pitches).toFixed(1) + ' Hz, ' + new Set(stats.pitches.map(p => p.toFixed(0))).size + ' distinct');
console.log('level per voice ' + average(stats.levels[0]).toFixed(3));
console.log('pan             mean |pan| ' + average(panMagnitude).toFixed(2) + ', left ' +
	((100 * stats.left) / Math.max(1, stats.pans.length)).toFixed(0) + '%, right ' +
	((100 * stats.right) / Math.max(1, stats.pans.length)).toFixed(0) + '%');
console.log('pulse rate      ' + Math.min.apply(null, stats.rates).toFixed(2) + ' .. ' +
	Math.max.apply(null, stats.rates).toFixed(2) + ' Hz, median ' + median(stats.rates).toFixed(2));
const fast = stats.rates.filter(r => r > 8).length;
const slow = stats.rates.filter(r => r < 0.5).length;
console.log('articulation    ' + ((100 * fast) / stats.rates.length).toFixed(0) + '% fast (>8 Hz), ' +
	((100 * slow) / stats.rates.length).toFixed(0) + '% rare (<0.5 Hz)');

// The panned side must follow the horizontal direction to the cell, which is the
// whole point of "LR to points from probe". Recomputed from the app's own data:
const mismatch = stats.pans.filter(pan => Math.abs(pan) > 0.5).length;
console.log('strong pans     ' + mismatch + ' samples beyond +-0.5');

console.log('tone            ' + (stats.pitches.every(hz => {
	for (let s = 0; s <= 23; s++) if (Math.abs(hz - Tones.hz(s)) < 1e-6) return true;
	return false;
}) ? 'all cell tones' : 'off-grid pitches present'));

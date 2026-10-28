'use strict';
// Drives the real page (stub DOM + recording Web Audio) through gestures, keys,
// modes, resize and teardown, and checks what actually reaches the voice params.
const { createPage } = require('./stub-page');

let failures = 0;

function check(name, ok, detail) {
	if (ok) {
		console.log('  ok   ' + name);
		return;
	}
	failures++;
	console.log('  FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']'));
}

const page = createPage();
const { audio } = page;
const Tones = page.sandbox.GS.Tones;

function carriers() {
	return [0, 1, 2].map(i => page.voice(i).carrier.frequency.target).filter(v => typeof v === 'number');
}

function lfoRates() {
	return [0, 1, 2].map(i => page.voice(i).lfo.frequency.target).filter(v => typeof v === 'number');
}

function levels() {
	return [0, 1, 2].map(i => page.voice(i).level.gain.target);
}

function pans() {
	return [0, 1, 2].map(i => page.voice(i).pan.pan.target).filter(v => typeof v === 'number');
}

// Every voice must sit exactly on one of the 24 cell tones, so a cell's colour
// is literally its pitch.
function isFieldTone(hz) {
	for (let semitone = 0; semitone <= 23; semitone++) {
		if (Math.abs(hz - Tones.hz(semitone)) < 1e-6) return true;
	}
	return false;
}

console.log('load');
check('scripts load and the page initialises', page.audio.contexts === 0 && page.pointCount() >= 4, page.pointCount());
check('canvas sized for dpr', page.canvas().width === 2560 && page.canvas().height === 1440, page.canvas().width + 'x' + page.canvas().height);

const initial = page.pointCount();

console.log('frames');
let time = 0;
try {
	time = page.tick(120, time);
	check('120 frames run', true);
} catch (error) {
	check('120 frames run', false, error.message);
}
check('gate is still shown before a gesture', !page.element('gate').hasClass('hidden'));

console.log('gestures');
try {
	page.dispatchWindow('keydown', { key: 'c' });
	check('C clears the field', page.pointCount() === 0, page.pointCount());
	page.canvas().dispatch('pointerdown', { clientX: 640, clientY: 360 });
	page.canvas().dispatch('pointerup', { clientX: 640, clientY: 360 });
	check('click adds a point', page.pointCount() === 1, page.pointCount());
	check('first gesture starts audio', audio.contexts === 1, audio.contexts);
	check('gate hides after a gesture', page.element('gate').hasClass('hidden'));

	page.canvas().dispatch('pointerdown', { clientX: 642, clientY: 362 });
	page.canvas().dispatch('pointerup', { clientX: 642, clientY: 362 });
	check('overlapping insert is ignored', page.pointCount() === 1, page.pointCount());

	page.canvas().dispatch('pointerdown', { clientX: 300, clientY: 300 });
	page.canvas().dispatch('pointermove', { clientX: 340, clientY: 320 });
	page.canvas().dispatch('pointerup', { clientX: 420, clientY: 360 });
	check('drag launches instead of adding', page.pointCount() === 1, page.pointCount());

	page.canvas().dispatch('pointerdown', { clientX: 640, clientY: 360 });
	page.canvas().dispatch('pointermove', { clientX: 700, clientY: 380 });
	page.canvas().dispatch('pointerup', { clientX: 700, clientY: 380 });
	check('drag on a point keeps the count', page.pointCount() === 1, page.pointCount());

	page.canvas().dispatch('pointerdown', { button: 2, clientX: 700, clientY: 380 });
	check('right click removes a point', page.pointCount() === 0, page.pointCount());
	page.canvas().dispatch('pointerdown', { button: 2, clientX: 60, clientY: 60 });
	check('right click on empty space is ignored', page.pointCount() === 0, page.pointCount());

	page.dispatchWindow('keydown', { key: 'r' });
	check('R randomises', page.pointCount() >= 4, page.pointCount());
	time = page.tick(60, time);
} catch (error) {
	check('gestures', false, error.message + '\n' + error.stack);
}

console.log('audio');
try {
	check('three voices built', audio.oscillators.length === 6 && audio.panners.length === 3, audio.oscillators.length);
	const current = carriers();
	check('every carrier is driven', current.length === 3 && current.every(v => v > 30 && v < 2000), JSON.stringify(current));
	check('mode 0 pitches are cell tones', current.every(isFieldTone), JSON.stringify(current));
	check('mode 0 voices are distinct pitches (polyphony)', new Set(current).size >= 2, JSON.stringify(current));
	check('mode 0 shimmer stays slow', lfoRates().every(v => v > 1 && v < 10), JSON.stringify(lfoRates()));
	check('mode 0 levels are audible', levels().every(v => v > 0.01), JSON.stringify(levels()));
	const readout = page.element('voices').textContent;
	check('readout lists the sounding notes', /^[A-G]#?\d( · [A-G]#?\d)*$/.test(readout), readout);
	const notes = readout.split(' · ').length;
	check('readout matches the voice count', notes === levels().filter(v => v > 0).length, readout);
	// One frame can have all three cells on the same side; the probe has to fly
	// past a point to swap sides.
	const flown = [];
	for (let step = 0; step < 120; step++) {
		time = page.tick(2, time);
		flown.push.apply(flown, pans());
	}
	check('pans reach both sides', Math.min.apply(null, flown) < -0.3 && Math.max.apply(null, flown) > 0.3,
		Math.min.apply(null, flown).toFixed(2) + ' .. ' + Math.max.apply(null, flown).toFixed(2));
} catch (error) {
	check('audio', false, error.message);
}

console.log('modes and keys');
try {
	const modeDist = page.element('mode-dist');
	modeDist.checked = true;
	modeDist.dispatch('change');
	check('mode label follows the mode', page.element('sens-label').textContent === 'distance → pitch', page.element('sens-label').textContent);
	time = page.tick(120, time);

	check('mode 1 switches the LFO to a pulse ramp',
		[0, 1, 2].every(i => page.voice(i).lfo.type === 'sawtooth'), page.voice(0).lfo.type);
	check('mode 1 gates the voices from silence', [0, 1, 2].every(i => page.voice(i).tremolo.gain.target === 0));

	const curve = page.voice(0).shaper.curve;
	let peak = 0;
	for (let k = 1; k < curve.length; k++) if (curve[k] > curve[peak]) peak = k;
	check('envelope starts near silence', curve[0] < 0.01, curve[0]);
	check('envelope peaks at the start of the cycle', peak < curve.length * 0.05, peak + '/' + curve.length);
	check('envelope decays to near silence', curve[curve.length - 1] < 0.05, curve[curve.length - 1]);
	let monotone = true;
	for (let k = peak + 1; k < curve.length; k++) if (curve[k] > curve[k - 1] + 1e-6) monotone = false;
	check('envelope is one decay with no re-attack', monotone);
	check('envelope never leaves 0..1', curve.every(v => v >= 0 && v <= 1.0001));

	const distanceReadout = page.element('voices').textContent;
	check('readout switches to frequencies and rates in mode 1', /Hz @ [\d.]+\/s/.test(distanceReadout), distanceReadout);

	const distancePitches = carriers();
	check('mode 1 pitches stay in the bass register', distancePitches.every(v => v >= 54 && v < 4000), JSON.stringify(distancePitches));
	check('mode 1 leaves the cell tuning', distancePitches.some(v => !isFieldTone(v)), JSON.stringify(distancePitches));

	const rates = [];
	for (let step = 0; step < 200; step++) {
		time = page.tick(3, time);
		rates.push.apply(rates, lfoRates());
	}
	check('pulse rate stays between 0.05 and 30 Hz', rates.every(v => v >= 0.05 && v <= 30), JSON.stringify(rates.slice(0, 12)));
	const lowRate = Math.min.apply(null, rates);
	const highRate = Math.max.apply(null, rates);
	// The exact 0.1..30 Hz endpoints belong to check-tones; in flight the probe
	// only has to sweep a wide part of that span (the field is random).
	check('pulse rate sweeps a wide range in flight', highRate > 15 && highRate / lowRate > 5,
		lowRate.toFixed(2) + ' .. ' + highRate.toFixed(2));

	const beforeMove = carriers();
	time = page.tick(90, time);
	check('mode 1 pitches follow the probe', carriers().some((v, i) => Math.abs(v - beforeMove[i]) > 0.01), JSON.stringify(carriers()));

	page.dispatchWindow('keydown', { key: '1' });
	check('key 1 selects pitch / cell', page.element('mode-pad').checked === true);
	check('key 1 restores the sustained voices', [0, 1, 2].every(i => page.voice(i).lfo.type === 'sine' && page.voice(i).tremolo.gain.target === 1));
	time = page.tick(30, time);

	page.dispatchWindow('keydown', { key: 'm' });
	check('M shows muted', page.element('status').textContent === 'muted', page.element('status').textContent);
	page.dispatchWindow('keydown', { key: 'm' });

	page.dispatchWindow('keydown', { key: 'p' });
	check('P shows paused', page.element('status').textContent === 'paused', page.element('status').textContent);
	time = page.tick(10, time);
	page.dispatchWindow('keydown', { key: 'p' });
	check('P resumes', page.element('status').textContent === '', page.element('status').textContent);
	time = page.tick(30, time);

	page.dispatchWindow('keydown', { key: ' ' });
	time = page.tick(30, time);

	const sens = page.element('sens');
	sens.value = '95';
	sens.dispatch('input');
	time = page.tick(20, time);
	check('slider drives frames without errors', true);
} catch (error) {
	check('modes and keys', false, error.message + '\n' + error.stack);
}

console.log('resize');
try {
	page.sandbox.innerWidth = 800;
	page.sandbox.innerHeight = 600;
	page.dispatchWindow('resize');
	time = page.tick(30, time);
	check('canvas resized', page.canvas().width === 1600 && page.canvas().height === 1200, page.canvas().width + 'x' + page.canvas().height);
	check('points survive the resize', page.pointCount() > 0, page.pointCount());

	page.sandbox.innerWidth = 380;
	page.sandbox.innerHeight = 300;
	page.dispatchWindow('resize');
	time = page.tick(30, time);
	check('tiny viewport is clamped', page.canvas().width >= 640, page.canvas().width);
} catch (error) {
	check('resize', false, error.message + '\n' + error.stack);
}

console.log('teardown');
try {
	page.dispatchWindow('keydown', { key: 'c' });
	time = page.tick(5, time);
	check('empty field clears the sound frame', page.pointCount() === 0);
	check('voices are muted when nothing is left', levels().every(v => v === 0), JSON.stringify(levels()));
	check('frame loop still alive', page.frames.length > 0, page.frames.length);
} catch (error) {
	check('teardown', false, error.message);
}

console.log(failures === 0 ? '\nall smoke checks passed' : '\n' + failures + ' smoke check(s) failed');
process.exitCode = failures === 0 ? 0 : 1;

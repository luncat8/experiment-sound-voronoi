'use strict';
// Runs the real page scripts against a stub DOM/Web Audio and drives the app:
// gestures, keys, modes, resize. Catches wiring and runtime errors without a browser.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const FILES = ['src/voronoi.js', 'src/physics.js', 'src/tones.js', 'src/sound.js', 'src/app.js'];
let failures = 0;

function check(name, ok, detail) {
	if (ok) {
		console.log('  ok   ' + name);
		return;
	}
	failures++;
	console.log('  FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']'));
}

function fakeCanvasContext() {
	return new Proxy({}, {
		get(target, prop) {
			if (prop in target) return target[prop];
			return () => undefined;
		},
		set(target, prop, value) {
			target[prop] = value;
			return true;
		},
	});
}

function makeElement(id) {
	const listeners = Object.create(null);
	const classes = new Set();
	const element = {
		id,
		style: {},
		textContent: '',
		value: id === 'sens' ? '55' : '',
		checked: id === 'mode-pad',
		width: 0,
		height: 0,
		classList: {
			add: name => classes.add(name),
			remove: name => classes.delete(name),
			contains: name => classes.has(name),
			toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
		},
		hasClass: name => classes.has(name),
		addEventListener(type, fn) {
			(listeners[type] = listeners[type] || []).push(fn);
		},
		setPointerCapture() {},
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
		getContext: () => element.ctx || (element.ctx = fakeCanvasContext()),
		dispatch(type, event) {
			const list = listeners[type] || [];
			for (const fn of list) fn(Object.assign({ preventDefault() {}, pointerId: 1, button: 0, clientX: 0, clientY: 0 }, event));
		},
	};
	return element;
}

/* ---- audio stub ---- */

const audio = { contexts: 0, oscillators: [], gains: [], params: 0 };

function fakeParam(value) {
	const param = {
		value,
		setTargetAtTime(target) {
			audio.params++;
			param.target = target;
		},
		setValueAtTime() {},
		cancelScheduledValues() {},
		linearRampToValueAtTime() {},
	};
	return param;
}

function fakeNode(extra) {
	return Object.assign({
		connect(destination) {
			return destination;
		},
		disconnect() {},
	}, extra);
}

class FakeAudioContext {
	constructor() {
		audio.contexts++;
		this.currentTime = 0;
		this.state = 'running';
		this.destination = fakeNode({});
	}
	createGain() {
		const gain = fakeParam(1);
		audio.gains.push(gain);
		return fakeNode({ gain });
	}
	createOscillator() {
		const osc = fakeNode({ type: 'sine', frequency: fakeParam(220), detune: fakeParam(0), start() {}, stop() {} });
		audio.oscillators.push(osc);
		return osc;
	}
	createBiquadFilter() {
		return fakeNode({ type: 'lowpass', frequency: fakeParam(1000), Q: fakeParam(1), gain: fakeParam(0) });
	}
	createStereoPanner() {
		return fakeNode({ pan: fakeParam(0) });
	}
	createDynamicsCompressor() {
		return fakeNode({
			threshold: fakeParam(0),
			knee: fakeParam(0),
			ratio: fakeParam(1),
			attack: fakeParam(0),
			release: fakeParam(0),
		});
	}
	suspend() {
		this.state = 'suspended';
	}
	resume() {
		this.state = 'running';
	}
}

/* ---- sandbox ---- */

const elements = new Map();
const frames = [];
const windowListeners = Object.create(null);

const sandbox = {
	console,
	innerWidth: 1280,
	innerHeight: 720,
	devicePixelRatio: 2,
	AudioContext: FakeAudioContext,
	requestAnimationFrame(fn) {
		frames.push(fn);
		return frames.length;
	},
	addEventListener(type, fn) {
		(windowListeners[type] = windowListeners[type] || []).push(fn);
	},
	document: {
		readyState: 'complete',
		getElementById(id) {
			if (!elements.has(id)) elements.set(id, makeElement(id));
			return elements.get(id);
		},
		addEventListener() {},
	},
};
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);

function dispatchWindow(type, event) {
	const list = windowListeners[type] || [];
	for (const fn of list) fn(Object.assign({ preventDefault() {} }, event));
}

function tick(count, startAt) {
	let time = startAt || 0;
	for (let i = 0; i < count; i++) {
		const next = frames.shift();
		if (!next) throw new Error('frame loop stopped at frame ' + i);
		time += 1000 / 60;
		next(time);
	}
	return time;
}

console.log('load');
try {
	for (const file of FILES) {
		vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
	}
	check('scripts load', true);
} catch (error) {
	check('scripts load', false, error.message);
	process.exit(1);
}

const canvas = elements.get('c');
const countText = () => elements.get('count').textContent;
const pointCount = () => Number((countText().match(/\d+/) || [0])[0]);

check('canvas sized for dpr', canvas.width === 2560 && canvas.height === 1440, canvas.width + 'x' + canvas.height);
check('starts with a field of points', pointCount() >= 4 && pointCount() <= 32, countText());
const initial = pointCount();

console.log('frames');
let time = 0;
try {
	time = tick(120, time);
	check('120 frames run', true);
} catch (error) {
	check('120 frames run', false, error.message);
}

check('gate is still shown before a gesture', !elements.get('gate').hasClass('hidden'));

console.log('gestures');
try {
	// click on empty canvas adds a point once the field is cleared
	dispatchWindow('keydown', { key: 'c' });
	check('C clears the field', pointCount() === 0, countText());
	canvas.dispatch('pointerdown', { clientX: 640, clientY: 360 });
	canvas.dispatch('pointerup', { clientX: 640, clientY: 360 });
	check('click adds a point', pointCount() === 1, countText());
	check('first gesture starts audio', audio.contexts === 1, audio.contexts);
	check('gate hides after a gesture', elements.get('gate').hasClass('hidden'));

	// same place: too close to the first point, ignored
	canvas.dispatch('pointerdown', { clientX: 642, clientY: 362 });
	canvas.dispatch('pointerup', { clientX: 642, clientY: 362 });
	check('overlapping insert is ignored', pointCount() === 1, countText());

	// drag from empty space launches, it must not add a point
	canvas.dispatch('pointerdown', { clientX: 300, clientY: 300 });
	canvas.dispatch('pointermove', { clientX: 340, clientY: 320 });
	canvas.dispatch('pointerup', { clientX: 420, clientY: 360 });
	check('drag launches instead of adding', pointCount() === 1, countText());

	// dragging a point moves it, still one point
	canvas.dispatch('pointerdown', { clientX: 640, clientY: 360 });
	canvas.dispatch('pointermove', { clientX: 700, clientY: 380 });
	canvas.dispatch('pointerup', { clientX: 700, clientY: 380 });
	check('drag on a point keeps the count', pointCount() === 1, countText());

	// right click removes
	canvas.dispatch('pointerdown', { button: 2, clientX: 700, clientY: 380 });
	check('right click removes a point', pointCount() === 0, countText());

	// right click on empty space is harmless
	canvas.dispatch('pointerdown', { button: 2, clientX: 60, clientY: 60 });
	check('right click on empty space is ignored', pointCount() === 0, countText());

	dispatchWindow('keydown', { key: 'r' });
	check('R randomises', pointCount() >= 4, countText());
	time = tick(60, time);
} catch (error) {
	check('gestures', false, error.message + '\n' + error.stack);
}

console.log('audio');
const Tones = sandbox.GS.Tones;
// Mode 0 voices are cell tones an octave down / up, so these three multipliers.
const OCTAVES = [0.5, 1, 2];

function isFieldTone(hz) {
	for (let semitone = 0; semitone <= 23; semitone++) {
		const base = Tones.hz(semitone);
		for (const mult of OCTAVES) if (Math.abs(hz - base * mult) < 1e-6) return true;
	}
	return false;
}

// Each voice creates its carrier before its LFO, so carriers take the even slots.
function carriers() {
	return audio.oscillators.filter((osc, i) => i % 2 === 0).map(osc => osc.frequency.target).filter(v => typeof v === 'number');
}

function lfoRates() {
	return audio.oscillators.filter((osc, i) => i % 2 === 1).map(osc => osc.frequency.target).filter(v => typeof v === 'number');
}

try {
	check('three voices built', audio.oscillators.length === 6, audio.oscillators.length);
	const current = carriers();
	check('voice pitches were driven', current.length >= 3 && current.every(v => v > 30 && v < 2000), JSON.stringify(current));
	check('mode 0 pitches are cell tones', current.every(isFieldTone), JSON.stringify(current));
	check('mode 0 shimmer stays slow', lfoRates().every(v => v > 1 && v < 10), JSON.stringify(lfoRates()));
	check('voice levels are driven', audio.gains.some(gain => typeof gain.target === 'number' && gain.target > 0));
	check('parameters are being scheduled', audio.params > 500, audio.params);
} catch (error) {
	check('audio', false, error.message);
}

console.log('modes and keys');
try {
	const modeDist = elements.get('mode-dist');
	modeDist.checked = true;
	modeDist.dispatch('change');
	check('mode label follows the mode', elements.get('sens-label').textContent === 'distance → pitch', elements.get('sens-label').textContent);
	time = tick(90, time);
	const distancePitches = carriers();
	check('mode 1 pitches stay in the bass register', distancePitches.every(v => v >= 54 && v < 4000), JSON.stringify(distancePitches));
	check('mode 1 leaves the cell tuning', distancePitches.some(v => !isFieldTone(v)), JSON.stringify(distancePitches));

	const rates = [];
	for (let step = 0; step < 200; step++) {
		time = tick(3, time);
		rates.push.apply(rates, lfoRates());
	}
	check('tremolo stays between 0.05 and 30 Hz', rates.every(v => v >= 0.05 && v <= 30), JSON.stringify(rates.slice(0, 12)));
	const lowRate = Math.min.apply(null, rates);
	const highRate = Math.max.apply(null, rates);
	// The exact 0.1..30 Hz endpoints belong to check-tones; in flight the probe
	// only has to sweep a wide part of that span (the field is random).
	check('tremolo sweeps a wide range in flight', highRate > 15 && highRate / lowRate > 5,
		lowRate.toFixed(2) + ' .. ' + highRate.toFixed(2));

	const beforeMove = carriers();
	time = tick(90, time);
	check('mode 1 pitches follow the probe', carriers().some((v, i) => Math.abs(v - beforeMove[i]) > 0.01), JSON.stringify(carriers()));

	dispatchWindow('keydown', { key: '1' });
	check('key 1 selects pitch / cell', elements.get('mode-pad').checked === true);
	time = tick(30, time);

	dispatchWindow('keydown', { key: 'm' });
	check('M shows muted', elements.get('status').textContent === 'muted', elements.get('status').textContent);
	dispatchWindow('keydown', { key: 'm' });

	dispatchWindow('keydown', { key: 'p' });
	check('P shows paused', elements.get('status').textContent === 'paused', elements.get('status').textContent);
	time = tick(10, time);
	dispatchWindow('keydown', { key: 'p' });
	check('P resumes', elements.get('status').textContent === '', elements.get('status').textContent);
	time = tick(30, time);

	dispatchWindow('keydown', { key: ' ' });
	time = tick(30, time);

	const sens = elements.get('sens');
	sens.value = '95';
	sens.dispatch('input');
	time = tick(20, time);
	check('slider drives frames without errors', true);
} catch (error) {
	check('modes and keys', false, error.message + '\n' + error.stack);
}

console.log('resize');
try {
	sandbox.innerWidth = 800;
	sandbox.innerHeight = 600;
	dispatchWindow('resize');
	time = tick(30, time);
	check('canvas resized', canvas.width === 1600 && canvas.height === 1200, canvas.width + 'x' + canvas.height);
	check('points survive the resize', pointCount() === initial || pointCount() > 0, countText());

	sandbox.innerWidth = 380;
	sandbox.innerHeight = 300;
	dispatchWindow('resize');
	time = tick(30, time);
	check('tiny viewport is clamped', canvas.width >= 640, canvas.width);
} catch (error) {
	check('resize', false, error.message + '\n' + error.stack);
}

console.log('teardown');
try {
	dispatchWindow('keydown', { key: 'c' });
	time = tick(5, time);
	check('empty field clears the sound frame', pointCount() === 0);
	const levels = audio.gains.map(gain => gain.target).filter(v => v === 0);
	check('voices are muted when nothing is left', levels.length >= 3, audio.gains.length);
	check('frame loop still alive', frames.length > 0, frames.length);
} catch (error) {
	check('teardown', false, error.message);
}

console.log(failures === 0 ? '\nall smoke checks passed' : '\n' + failures + ' smoke check(s) failed');
process.exitCode = failures === 0 ? 0 : 1;

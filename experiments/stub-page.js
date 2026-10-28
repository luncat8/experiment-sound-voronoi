'use strict';
// Loads the real page scripts against a stub DOM and a recording Web Audio API.
// The recording is what the checks and the measurements read: no browser, no ear.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = ['src/voronoi.js', 'src/physics.js', 'src/tones.js', 'src/sound.js', 'src/app.js'];

/* ---- canvas ---- */

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
		blur() {},
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
		getContext: () => element.ctx || (element.ctx = fakeCanvasContext()),
		dispatch(type, event) {
			const list = listeners[type] || [];
			for (const fn of list) fn(Object.assign({ preventDefault() {}, pointerId: 1, button: 0, clientX: 0, clientY: 0 }, event));
		},
	};
	return element;
}

/* ---- web audio ---- */

function fakeParam(value) {
	const param = {
		value,
		target: undefined,
		setTargetAtTime(target) {
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
	constructor(record) {
		this.record = record;
		record.contexts++;
		this.currentTime = 0;
		this.state = 'running';
		this.destination = fakeNode({});
	}
	createGain() {
		const node = fakeNode({ gain: fakeParam(1) });
		this.record.gains.push(node);
		return node;
	}
	createOscillator() {
		const osc = fakeNode({ type: 'sine', frequency: fakeParam(220), detune: fakeParam(0), start() {}, stop() {} });
		this.record.oscillators.push(osc);
		return osc;
	}
	createBiquadFilter() {
		return fakeNode({ type: 'lowpass', frequency: fakeParam(1000), Q: fakeParam(1), gain: fakeParam(0) });
	}
	createStereoPanner() {
		const node = fakeNode({ pan: fakeParam(0) });
		this.record.panners.push(node);
		return node;
	}
	createWaveShaper() {
		const shaper = fakeNode({ curve: null, oversample: 'none' });
		this.record.shapers.push(shaper);
		return shaper;
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

/* ---- page ---- */

function createPage() {
	const audio = { contexts: 0, oscillators: [], gains: [], panners: [], shapers: [] };
	const elements = new Map();
	const frames = [];
	const windowListeners = Object.create(null);

	const sandbox = {
		console,
		innerWidth: 1280,
		innerHeight: 720,
		devicePixelRatio: 2,
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
	sandbox.AudioContext = function AudioContext() {
		return new FakeAudioContext(audio);
	};
	const context = vm.createContext(sandbox);

	for (const file of FILES) {
		vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
	}

	const page = {
		sandbox,
		elements,
		audio,
		frames,
		context,
		element: id => elements.get(id),
		canvas: () => elements.get('c'),
		pointCount: () => Number((elements.get('count').textContent.match(/\d+/) || [0])[0]),
		tick(count, startAt) {
			let time = startAt || 0;
			for (let i = 0; i < count; i++) {
				const next = frames.shift();
				if (!next) throw new Error('frame loop stopped at frame ' + i);
				time += 1000 / 60;
				next(time);
			}
			return time;
		},
		dispatchWindow(type, event) {
			const list = windowListeners[type] || [];
			for (const fn of list) fn(Object.assign({ preventDefault() {} }, event));
		},
		// Node layout of src/sound.js: master gain, then per voice the tremolo,
		// level and mod gains; per voice a carrier then an LFO, and one panner.
		voice(i) {
			const gainBase = 1 + i * 3;
			return {
				carrier: audio.oscillators[i * 2],
				lfo: audio.oscillators[i * 2 + 1],
				tremolo: audio.gains[gainBase],
				level: audio.gains[gainBase + 1],
				mod: audio.gains[gainBase + 2],
				pan: audio.panners[i],
				shaper: audio.shapers[i],
			};
		},
	};

	return page;
}

module.exports = { createPage, FILES };

'use strict';
// Loads the real page scripts against a stub DOM and a recording Web Audio API.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = ['src/voronoi.js', 'src/physics.js', 'src/tones.js', 'src/sound.js', 'src/settings.js', 'src/app.js'];

const DEFAULTS = {
	'freq-steep': '50',
	'vol-steep': '50',
	'env-steep': '50',
	'n-points': '26',
};
const CHECKED = new Set(['freq-point', 'vol-dist', 'env-dist']);
const RADIOS = new Set(['freq-point', 'freq-dist', 'vol-dist', 'vol-const', 'env-dist', 'env-off']);
const RANGES = new Set(['freq-steep', 'vol-steep', 'env-steep']);

/* ---- canvas ---- */

function fakeCanvasContext() {
	const context = {
		recording: false,
		operations: [],
		path: [],
		beginPath() {
			if (this.recording) this.path = [];
		},
		arc(x, y, radius, start, end) {
			if (this.recording) this.path.push({ x, y, radius, start, end });
		},
		stroke() {
			if (this.recording) this.operations.push({ arcs: this.path, alpha: this.globalAlpha, width: this.lineWidth });
		},
	};
	return new Proxy(context, {
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
	const type = id === 'n-points' ? 'number' : id === 'share-url' ? 'text' :
		RADIOS.has(id) ? 'radio' : RANGES.has(id) ? 'range' : '';
	const element = {
		id,
		tagName: type ? 'INPUT' : id === 'copy-url' ? 'BUTTON' : 'DIV',
		type,
		style: {},
		textContent: '',
		value: DEFAULTS[id] || '',
		checked: CHECKED.has(id),
		hidden: id === 'share-fallback',
		focused: false,
		selected: false,
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
		blur() { element.focused = false; },
		focus() { element.focused = true; },
		select() { element.selected = true; },
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
		getContext: () => element.ctx || (element.ctx = fakeCanvasContext()),
		dispatch(type, event) {
			const list = listeners[type] || [];
			const payload = Object.assign({
				defaultPrevented: false,
				preventDefault() { this.defaultPrevented = true; },
				target: element,
				pointerId: 1,
				button: 0,
				clientX: 0,
				clientY: 0,
			}, event);
			const results = [];
			for (const fn of list) results.push(fn(payload));
			return { event: payload, results };
		},
	};
	return element;
}

/* ---- web audio ---- */

function fakeParam(value) {
	const param = {
		value,
		target: value,
		setTargetAtTime(target) {
			param.target = target;
		},
		setValueAtTime(next) {
			param.value = next;
			param.target = next;
		},
		cancelScheduledValues() {},
		linearRampToValueAtTime(next) {
			param.target = next;
		},
	};
	return param;
}

function fakeNode(extra) {
	return Object.assign({
		connections: [],
		connect(destination) {
			this.connections.push(destination);
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
	createConstantSource() {
		const source = fakeNode({ offset: fakeParam(1), start() {}, stop() {} });
		this.record.sources.push(source);
		return source;
	}
	createAnalyser() {
		const analyser = fakeNode({
			fftSize: 2048,
			sample: 0,
			getFloatTimeDomainData(data) { data.fill(this.sample); },
		});
		this.record.analysers.push(analyser);
		return analyser;
	}
	createBiquadFilter() {
		const filter = fakeNode({ type: 'lowpass', frequency: fakeParam(1000), Q: fakeParam(1), gain: fakeParam(0) });
		this.record.filters.push(filter);
		return filter;
	}
	createStereoPanner() {
		const node = fakeNode({ pan: fakeParam(0) });
		this.record.panners.push(node);
		return node;
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

function createPage(options = {}) {
	const audio = { contexts: 0, oscillators: [], gains: [], panners: [], filters: [], analysers: [], sources: [] };
	const clipboard = { text: '', writes: 0 };
	const elements = new Map();
	const frames = [];
	const windowListeners = Object.create(null);

	const sandbox = {
		console,
		URL,
		URLSearchParams,
		btoa,
		atob,
		location: { href: options.url || 'https://example.test/index.html' },
		navigator: {},
		innerWidth: options.width || 1280,
		innerHeight: options.height || 720,
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
	if (options.clipboard !== 'unavailable') {
		sandbox.navigator.clipboard = {
			writeText(text) {
				clipboard.writes++;
				if (options.clipboard === 'reject') return Promise.reject(new Error('denied'));
				clipboard.text = text;
				return Promise.resolve();
			},
		};
	}
	sandbox.globalThis = sandbox;
	sandbox.AudioContext = function AudioContext() {
		return new FakeAudioContext(audio);
	};
	const context = vm.createContext(sandbox);

	for (const file of FILES) {
		vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
	}

	const voiceCount = () => sandbox.GS.Sound.MAX_VOICES;

	const page = {
		sandbox,
		elements,
		audio,
		clipboard,
		frames,
		context,
		voiceCount,
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
		// Master, then per voice: envGain, level, mod, meterEnv, meterLevel.
		voice(i) {
			const gainBase = 1 + i * 5;
			return {
				carrier: audio.oscillators[i * 2],
				lfo: audio.oscillators[i * 2 + 1],
				filter: audio.filters[i],
				envGain: audio.gains[gainBase],
				level: audio.gains[gainBase + 1],
				mod: audio.gains[gainBase + 2],
				meterEnv: audio.gains[gainBase + 3],
				meterLevel: audio.gains[gainBase + 4],
				envelopeMeter: audio.analysers[i * 2],
				signalMeter: audio.analysers[i * 2 + 1],
				pan: audio.panners[i],
			};
		},
		activeVoices() {
			const out = [];
			const total = voiceCount();
			for (let i = 0; i < total; i++) {
				const v = page.voice(i);
				if (v.carrier && v.level.gain.target > 1e-4) out.push(v);
			}
			return out;
		},
	};

	return page;
}

module.exports = { createPage, FILES };

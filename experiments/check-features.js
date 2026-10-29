'use strict';

const assert = require('node:assert/strict');
const Settings = require('../src/settings');
const { createPage } = require('./stub-page');

const BASE = 'https://example.test/index.html?source=test';

function scene(overrides = {}) {
	return Object.assign({
		v: Settings.VERSION,
		size: [1280, 720],
		modes: [0, 0, 1],
		steep: [50, 50, 50],
		n: 6,
		flags: [0, 0],
		probe: [595, 360, 0, 0],
		sites: [
			[640, 360, 1, 0],
			[420, 360, 1, 2],
			[860, 360, 1, 4],
			[640, 160, 1, 7],
			[640, 560, 1, 9],
			[1180, 360, 1, 12],
		],
	}, overrides);
}

function close(actual, expected, tolerance = 1e-4) {
	assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' != ' + expected);
}

async function copy(page) {
	const result = page.element('copy-url').dispatch('click');
	await Promise.all(result.results);
	return page.clipboard.text;
}

function capture(page, time) {
	const ctx = page.canvas().ctx;
	ctx.operations.length = 0;
	ctx.recording = true;
	const next = page.tick(1, time);
	ctx.recording = false;
	return { time: next, operations: ctx.operations.slice() };
}

function haloAt(operations, x, y) {
	return operations.find(op => op.arcs.length === 1 && op.arcs[0].x === x && op.arcs[0].y === y &&
		op.arcs[0].start === 0 && op.width > 1 && op.width < 2.5);
}

async function checkHalos() {
	const page = createPage({ url: Settings.toUrl(scene(), BASE) });
	page.canvas().dispatch('pointerdown', { clientX: 640, clientY: 360 });
	page.canvas().dispatch('pointerup', { clientX: 640, clientY: 360 });
	page.canvas().dispatch('pointerleave');
	let time = page.tick(2, 0);
	const slots = [];
	for (let i = 0; i < page.voiceCount(); i++) {
		if (page.voice(i).level.gain.target > 1e-4) slots.push(i);
	}
	assert.equal(slots.length, 5, 'only the nearest site and its four neighbors sound');
	assert.ok(page.audio.analysers.every(a => a.fftSize === 32));
	for (const slot of slots) {
		const voice = page.voice(slot);
		assert.ok(voice.mod.connections.includes(voice.envGain.gain));
		assert.ok(voice.mod.connections.includes(voice.meterEnv.gain));
		assert.ok(page.audio.sources[0].connections.includes(voice.meterEnv));
		assert.ok(voice.meterEnv.connections.includes(voice.envelopeMeter));
		assert.ok(voice.meterEnv.connections.includes(voice.meterLevel));
		assert.ok(voice.meterLevel.connections.includes(voice.signalMeter));
		assert.equal(voice.signalMeter.connections.length, 0, 'monitor never reaches the speaker');
	}

	function meters(envelope, signal) {
		for (const slot of slots) {
			page.voice(slot).envelopeMeter.sample = envelope;
			page.voice(slot).signalMeter.sample = signal;
		}
	}
	meters(0.2, 0.05);
	let shot = capture(page, time); time = shot.time;
	const quiet = haloAt(shot.operations, 640, 360);
	assert.ok(quiet, 'nearest cell has a halo');
	for (const p of scene().sites.slice(0, 5)) assert.ok(haloAt(shot.operations, p[0], p[1]), 'active cell has a halo');
	assert.equal(haloAt(shot.operations, 1180, 360), undefined, 'non-adjacent cell has no halo');

	meters(0.8, 0.05);
	shot = capture(page, time); time = shot.time;
	const loudPhase = haloAt(shot.operations, 640, 360);
	close(loudPhase.arcs[0].radius - quiet.arcs[0].radius, 7.2);
	close(loudPhase.alpha, quiet.alpha);
	meters(0.8, 0.4);
	shot = capture(page, time); time = shot.time;
	assert.ok(haloAt(shot.operations, 640, 360).alpha > loudPhase.alpha, 'signal level changes halo brightness');

	page.element('env-off').dispatch('change');
	meters(1, 0.2);
	shot = capture(page, time); time = shot.time;
	const sustained = haloAt(shot.operations, 640, 360);
	shot = capture(page, time);
	close(haloAt(shot.operations, 640, 360).arcs[0].radius, sustained.arcs[0].radius);
	for (const slot of slots) {
		const voice = page.voice(slot);
		assert.equal(voice.envGain.gain.target, voice.meterEnv.gain.target);
		assert.equal(voice.level.gain.target, voice.meterLevel.gain.target);
	}
	console.log('  ok   active-cell halos follow measured envelope and signal; continuous mode stays steady');

	const sound = new page.sandbox.GS.Sound();
	sound.start();
	const frame = {
		count: 2,
		cell: new Int32Array([7, 2]),
		freq: new Float64Array([220, 330]),
		amp: new Float64Array([0.2, 0.3]),
		pan: new Float64Array([0, 0]),
		rate: new Float64Array([1, 2]),
		depth: new Float64Array([1, 0.5]),
		envelope: new Float64Array(2),
		signal: new Float64Array(2),
	};
	sound.apply(frame);
	const a = sound.findSlotForCell(7);
	const b = sound.findSlotForCell(2);
	const buffer = sound.voices[a].envelopeData;
	sound.voices[a].envelopeMeter.sample = 0.25;
	sound.voices[a].signalMeter.sample = 0.05;
	sound.voices[b].envelopeMeter.sample = 0.75;
	sound.voices[b].signalMeter.sample = 0.2;
	frame.cell[0] = 2;
	frame.cell[1] = 7;
	sound.apply(frame);
	close(frame.envelope[0], 0.75);
	close(frame.signal[0], 0.2);
	close(frame.envelope[1], 0.25);
	close(frame.signal[1], 0.05);
	for (let i = 0; i < 50; i++) sound.apply(frame);
	assert.equal(sound.voices[a].envelopeData, buffer, 'meter buffer is reused across frames');
	frame.count = 1;
	sound.apply(frame);
	assert.equal(sound.voices[a].meterLevel.gain.target, 0, 'release meter follows the voice');
	console.log('  ok   meters follow pinned voice slots and reuse preallocated buffers');
}

async function checkWheel() {
	const one = scene({ n: 3, probe: [640, 360, 0, 0], sites: [[450, 360, 1, 0]] });
	const url = Settings.toUrl(one, BASE);
	const page = createPage({ url });
	const canvas = page.canvas();
	canvas.dispatch('pointermove', { clientX: 450, clientY: 360 });
	assert.match(page.element('mass-readout').textContent, /mass 1\.00/);
	let event = canvas.dispatch('wheel', { clientX: 450, clientY: 360, deltaY: -100, deltaMode: 0 });
	assert.equal(event.event.defaultPrevented, true);
	let saved = Settings.fromUrl(await copy(page));
	close(saved.sites[0][2], Math.exp(0.15), 0.0001);
	assert.match(page.element('mass-readout').textContent, /mass 1\.16/);

	event = canvas.dispatch('wheel', { clientX: 1000, clientY: 650, deltaY: -100 });
	assert.equal(event.event.defaultPrevented, false, 'empty-space scrolling is not intercepted');
	event = canvas.dispatch('wheel', { clientX: 450, clientY: 360, deltaY: -100, ctrlKey: true });
	assert.equal(event.event.defaultPrevented, false, 'pinch/zoom is not intercepted');
	canvas.dispatch('wheel', { clientX: 450, clientY: 360, deltaY: 100 });
	saved = Settings.fromUrl(await copy(page));
	close(saved.sites[0][2], 1);
	canvas.dispatch('wheel', { clientX: 450, clientY: 360, deltaY: -1, deltaMode: 1 });
	saved = Settings.fromUrl(await copy(page));
	close(saved.sites[0][2], Math.exp(0.024), 0.0001);
	canvas.dispatch('wheel', { clientX: 450, clientY: 360, deltaY: -1, deltaMode: 2 });
	saved = Settings.fromUrl(await copy(page));
	close(saved.sites[0][2], Math.exp(1.024), 0.0001);
	for (let i = 0; i < 20; i++) canvas.dispatch('wheel', { clientX: 450, clientY: 360, deltaY: -1000 });
	saved = Settings.fromUrl(await copy(page));
	close(saved.sites[0][2], 5.775);
	for (let i = 0; i < 20; i++) canvas.dispatch('wheel', { clientX: 450, clientY: 360, deltaY: 1000 });
	saved = Settings.fromUrl(await copy(page));
	close(saved.sites[0][2], 0.3063);
	canvas.dispatch('pointerleave');
	assert.match(page.element('mass-readout').textContent, /hover a point/);
	console.log('  ok   wheel changes hovered mass in both directions, clamps it, and preserves normal scrolling');

	const low = createPage({ url });
	const high = createPage({ url });
	high.canvas().dispatch('wheel', { clientX: 450, clientY: 360, deltaY: -500 });
	low.dispatchWindow('keydown', { key: 'p' });
	high.dispatchWindow('keydown', { key: 'p' });
	low.tick(1, 0);
	high.tick(1, 0);
	const lowProbe = Settings.fromUrl(await copy(low)).probe;
	const highProbe = Settings.fromUrl(await copy(high)).probe;
	assert.ok(highProbe[2] < lowProbe[2] && lowProbe[2] < 0, 'heavier point pulls the probe harder');
	console.log('  ok   adjusted mass changes the simulated gravitational pull');
}

async function checkSharing() {
	const original = scene({
		modes: [1, 1, 0], steep: [37, 64, 93], flags: [0, 1], n: 8,
		probe: [700, 450, -50, 40], sites: [[450, 360, 1.4, 2], [1000, 600, 2.75, 19]],
	});
	const url = Settings.toUrl(original, BASE + '#old');
	assert.match(url, /^https:\/\/example\.test\/index\.html\?source=test#scene=/);
	assert.deepEqual(Settings.fromUrl(url), original);
	const page = createPage({ url });
	assert.equal(page.pointCount(), 2);
	assert.equal(page.audio.contexts, 0, 'loading a link does not start audio');
	assert.equal(page.element('freq-dist').checked, true);
	assert.equal(page.element('vol-const').checked, true);
	assert.equal(page.element('env-off').checked, true);
	assert.equal(page.element('freq-steep').value, '37');
	assert.equal(page.element('vol-steep').value, '64');
	assert.equal(page.element('env-steep').value, '93');
	assert.equal(page.element('status').textContent, 'paused');
	assert.deepEqual(Settings.fromUrl(await copy(page)), original, 'full scene round trips');
	assert.equal(page.element('copy-status').textContent, 'link copied');
	page.canvas().dispatch('pointerdown', { clientX: 450, clientY: 360 });
	page.canvas().dispatch('pointerup', { clientX: 450, clientY: 360 });
	assert.equal(page.audio.gains[0].gain.target, 0, 'restored mute applies when audio starts');

	const smaller = createPage({ url, width: 640, height: 360 });
	const scaled = Settings.fromUrl(await copy(smaller));
	assert.deepEqual(scaled.size, [640, 360]);
	assert.deepEqual(scaled.sites[0], [225, 180, 1.4, 2]);
	assert.deepEqual(scaled.sites[1], [500, 300, 2.75, 19]);
	assert.deepEqual(scaled.probe, [350, 225, -25, 20]);

	page.element('freq-point').dispatch('change');
	page.element('vol-steep').value = '21';
	page.element('vol-steep').dispatch('input');
	page.canvas().dispatch('wheel', { clientX: 450, clientY: 360, deltaY: -100 });
	const changed = Settings.fromUrl(await copy(page));
	assert.equal(changed.modes[0], 0);
	assert.equal(changed.steep[1], 21);
	assert.ok(changed.sites[0][2] > original.sites[0][2]);
	page.sandbox.location.href = url;
	page.dispatchWindow('hashchange');
	assert.deepEqual(Settings.fromUrl(await copy(page)), original, 'same-page hash navigation restores the scene');

	page.dispatchWindow('keydown', { key: 'c' });
	const emptyUrl = await copy(page);
	assert.equal(Settings.fromUrl(emptyUrl).sites.length, 0);
	assert.equal(createPage({ url: emptyUrl }).pointCount(), 0, 'empty field is shareable');
	const single = scene({ n: 1, sites: [[450, 360, 1, 0]] });
	const singlePage = createPage({ url: Settings.toUrl(single, BASE) });
	assert.equal(Settings.fromUrl(await copy(singlePage)).n, 1, 'one-point N value is preserved');
	console.log('  ok   copied links restore settings, points, masses, probe, pause/mute, and scaled layouts');

	const focused = createPage({ url });
	focused.dispatchWindow('keydown', { key: 'p', target: focused.element('freq-dist') });
	assert.equal(Settings.fromUrl(await copy(focused)).flags[0], 1, 'shortcuts work after focusing a radio');
	focused.dispatchWindow('keydown', { key: ' ', target: focused.element('freq-dist') });
	assert.equal(focused.audio.contexts, 0, 'space is left to the focused control');
	focused.dispatchWindow('keydown', { key: 'p', target: focused.element('copy-url') });
	assert.equal(Settings.fromUrl(await copy(focused)).flags[0], 0, 'shortcuts work after focusing a button');

	for (const clipboard of ['unavailable', 'reject']) {
		const fallback = createPage({ url, clipboard });
		await copy(fallback);
		assert.equal(fallback.element('share-fallback').hidden, false);
		assert.equal(fallback.element('share-url').selected, true);
		assert.deepEqual(Settings.fromUrl(fallback.element('share-url').value), original);
		fallback.dispatchWindow('keydown', { key: 'c', ctrlKey: true, target: fallback.element('share-url') });
		fallback.dispatchWindow('keydown', { key: 'c', target: fallback.element('share-url') });
		assert.equal(fallback.pointCount(), 2, 'copying or typing in the fallback does not trigger shortcuts');
	}
	const fileUrl = Settings.toUrl(original, 'file:///tmp/index.html');
	assert.deepEqual(Settings.fromUrl(fileUrl), original);
	assert.equal(Settings.fromUrl('file:///tmp/index.html#scene=broken'), null);
	assert.equal(Settings.decode('a'.repeat(120001)), null);
	assert.equal(Settings.decode(Settings.encode(scene({ v: 2 }))), null);
	assert.equal(Settings.decode(Settings.encode(scene({ sites: [[0, 0, 1e10, 0]] }))), null);
	assert.equal(Settings.decode(Settings.encode(scene({ modes: [9, 0, 1] }))), null);
	assert.equal(Settings.decode(Settings.encode(scene({ steep: [50.5, 50, 50] }))), null);
	assert.equal(Settings.decode(Settings.encode(scene({ sites: Array(401).fill([0, 0, 1, 0]) }))), null);
	assert.ok(createPage({ url: BASE + '#scene=broken' }).pointCount() > 0, 'invalid links fall back safely');
	console.log('  ok   clipboard fallback, file URLs, and malformed scene validation');
}

(async () => {
	await checkHalos();
	await checkWheel();
	await checkSharing();
	console.log('\nall feature checks passed');
})().catch(error => {
	console.error(error.stack);
	process.exitCode = 1;
});

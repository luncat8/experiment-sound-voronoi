(function (root) {
	'use strict';

	const { Voronoi, Physics, Sound, Tones } = root.GS;
	const $ = id => document.getElementById(id);

	const MAX_POINTS = Voronoi.MAX_POINTS;
	const MAX_ACTIVE = Sound.MAX_VOICES;
	const TAU = Math.PI * 2;
	const MIN_GAP = 34;
	const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
	const MIDI_BASE = 48; // C3
	const READOUT_EVERY = 7;
	const LAUNCH_GAIN = 2.4;
	const TRAIL_RAMP = 32;
	const PAN_REACH = 20;
	const MAX_VOICE_AMP = 0.46;
	const CONST_TOTAL_AMP = 0.42;

	const voronoi = new Voronoi();
	const physics = new Physics();
	const sound = new Sound();

	const sites = {
		count: 0,
		x: new Float64Array(MAX_POINTS),
		y: new Float64Array(MAX_POINTS),
		radius: new Float64Array(MAX_POINTS),
		mass: new Float64Array(MAX_POINTS),
		semitone: new Int16Array(MAX_POINTS),
	};

	// freqMode: 0 = point id, 1 = distance (10k..10 Hz)
	// volMode:  0 = distance, 1 = const
	// envMode:  0 = off,      1 = distance (<20px cont, 30..0.1 Hz sine)
	const state = {
		viewW: 0,
		viewH: 0,
		dpr: 1,
		freqMode: 0,
		volMode: 0,
		envMode: 1,
		freqSteep: 0.5,
		volSteep: 0.5,
		envSteep: 0.5,
		running: true,
		muted: false,
		aiming: false,
		sounding: new Int32Array(MAX_ACTIVE),
		soundingCount: 0,
		lastTime: 0,
		readoutTick: 0,
	};

	const drag = { active: false, kind: 0, index: -1, ox: 0, oy: 0, x0: 0, y0: 0, x: 0, y: 0, moved: false };

	const frame = {
		count: 0,
		cell: new Int32Array(MAX_ACTIVE),
		freq: new Float64Array(MAX_ACTIVE),
		amp: new Float64Array(MAX_ACTIVE),
		pan: new Float64Array(MAX_ACTIVE),
		rate: new Float64Array(MAX_ACTIVE),
		depth: new Float64Array(MAX_ACTIVE),
	};

	const fillColor = new Array(MAX_POINTS);
	const adjColor = new Array(MAX_POINTS);
	const hotColor = new Array(MAX_POINTS);
	const strokeColor = new Array(MAX_POINTS);
	const dotColor = new Array(MAX_POINTS);
	const glowColor = new Array(MAX_POINTS);
	const coreColor = new Array(MAX_POINTS);
	// 0 idle, 1 adjacent sounding cell, 2 nearest cell containing the probe.
	const role = new Int8Array(MAX_POINTS);
	const noteName = new Array(MAX_POINTS);
	const trailColor = new Array(TRAIL_RAMP);

	let canvas = null;
	let ctx = null;
	let ui = null;

	function clamp(value, min, max) {
		if (value < min) return min;
		if (value > max) return max;
		return value;
	}

	function paintSite(i) {
		const st = sites.semitone[i];
		const midi = MIDI_BASE + st;
		noteName[i] = NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
		const hue = Tones.hue(st).toFixed(0);
		const light = Tones.lightness(st);
		fillColor[i] = 'hsla(' + hue + ', 74%, ' + light + '%, 0.24)';
		adjColor[i] = 'hsla(' + hue + ', 82%, ' + (light + 4) + '%, 0.34)';
		hotColor[i] = 'hsla(' + hue + ', 90%, ' + (light + 8) + '%, 0.45)';
		strokeColor[i] = 'hsla(' + hue + ', 80%, 62%, 0.44)';
		dotColor[i] = 'hsla(' + hue + ', 92%, 70%, 0.96)';
		glowColor[i] = 'hsla(' + hue + ', 90%, 60%, 0.24)';
		coreColor[i] = 'hsla(' + hue + ', 88%, 72%, 0.22)';
	}

	function paintAllSites() {
		for (let i = 0; i < sites.count; i++) paintSite(i);
	}

	function buildPalette() {
		for (let k = 0; k < TRAIL_RAMP; k++) {
			const fade = (k + 1) / TRAIL_RAMP;
			trailColor[k] = 'rgba(150, 236, 255, ' + (fade * 0.5).toFixed(3) + ')';
		}
	}

	/* ---- diagram ---- */

	function rebuild() {
		voronoi.build(sites.x, sites.y, sites.count, state.viewW, state.viewH);
	}

	function tooClose(x, y, gap) {
		const g2 = gap * gap;
		for (let i = 0; i < sites.count; i++) {
			const dx = sites.x[i] - x;
			const dy = sites.y[i] - y;
			if (dx * dx + dy * dy < g2) return true;
		}
		return false;
	}

	function insertSite(x, y, gap) {
		if (sites.count >= MAX_POINTS || tooClose(x, y, gap)) return -1;
		const i = sites.count++;
		const radius = 7 + Math.random() * 13;
		const mass = radius / 12;
		sites.x[i] = x;
		sites.y[i] = y;
		sites.radius[i] = radius;
		sites.mass[i] = mass * mass * 0.9 + 0.15;
		sites.semitone[i] = Tones.pick(x, y, sites.x, sites.y, sites.semitone, sites.count, i);
		paintSite(i);
		return i;
	}

	function addPoint(x, y) {
		const i = insertSite(x, y, MIN_GAP);
		if (i < 0) return;
		rebuild();
		sites.semitone[i] = Tones.tuneCell(i, sites.x, sites.y, sites.semitone, voronoi.nbr, voronoi.nbrCount, voronoi.nbrStride);
		paintSite(i);
		syncCountInput();
	}

	function removePoint(index) {
		clearSounding();
		sound.releaseAll();
		const last = --sites.count;
		if (index !== last) {
			sites.x[index] = sites.x[last];
			sites.y[index] = sites.y[last];
			sites.radius[index] = sites.radius[last];
			sites.mass[index] = sites.mass[last];
			sites.semitone[index] = sites.semitone[last];
			paintSite(index);
		}
		rebuild();
		syncCountInput();
	}

	function movePoint(index, x, y) {
		sites.x[index] = clamp(x, 8, state.viewW - 8);
		sites.y[index] = clamp(y, 8, state.viewH - 8);
		rebuild();
	}

	function retune(index) {
		const st = Tones.tuneCell(index, sites.x, sites.y, sites.semitone, voronoi.nbr, voronoi.nbrCount, voronoi.nbrStride);
		if (st === sites.semitone[index]) return;
		sites.semitone[index] = st;
		paintSite(index);
	}

	function hitSite(x, y) {
		let best = -1;
		let bestDist = Infinity;
		for (let i = 0; i < sites.count; i++) {
			const dx = sites.x[i] - x;
			const dy = sites.y[i] - y;
			const d = dx * dx + dy * dy;
			const reach = sites.radius[i] + 8;
			if (d < reach * reach && d < bestDist) {
				bestDist = d;
				best = i;
			}
		}
		return best;
	}

	function clearPoints() {
		clearSounding();
		sound.releaseAll();
		sites.count = 0;
		frame.count = 0;
		rebuild();
		updateCount();
	}

	function defaultPointCount() {
		return clamp(Math.round(state.viewW * state.viewH / 36000), 6, 36);
	}

	function randomize(requestedN) {
		clearSounding();
		sound.releaseAll();
		sites.count = 0;
		const target = clamp(requestedN || defaultPointCount(), 3, 300);
		const areaPerSite = (state.viewW * state.viewH) / target;
		const gap = Math.min(MIN_GAP, Math.max(8, Math.sqrt(areaPerSite) * 0.36));
		const margin = Math.min(26, Math.max(10, gap));
		let guard = 0;
		while (sites.count < target && guard++ < 8000) {
			insertSite(
				margin + Math.random() * (state.viewW - margin * 2),
				margin + Math.random() * (state.viewH - margin * 2),
				gap
			);
		}
		rebuild();
		Tones.tuneField(sites.x, sites.y, sites.semitone, sites.count, voronoi.nbr, voronoi.nbrCount, voronoi.nbrStride);
		paintAllSites();
		syncCountInput();
	}

	/* ---- sound frame ---- */

	function clearSounding() {
		for (let i = 0; i < state.soundingCount; i++) role[state.sounding[i]] = 0;
		state.soundingCount = 0;
	}

	function markSounding(index, cellRole) {
		if (state.soundingCount >= MAX_ACTIVE) return;
		role[index] = cellRole;
		state.sounding[state.soundingCount++] = index;
	}

	// Horizontal direction LR from probe to point, faded smoothly inside the 20 px core.
	function panFromDelta(dx, dist) {
		if (dist < 1e-3) return 0;
		const fade = dist < PAN_REACH ? dist / PAN_REACH : 1;
		return clamp(0.95 * (dx / dist) * fade, -1, 1);
	}

	function buildFrame() {
		clearSounding();
		if (sites.count === 0) {
			frame.count = 0;
			return;
		}
		const px = physics.x;
		const py = physics.y;
		const near = voronoi.nearest(px, py);
		markSounding(near, 2);

		const nbrBase = near * voronoi.nbrStride;
		const nbrCount = voronoi.nbrCount[near];
		for (let k = 0; k < nbrCount; k++) {
			markSounding(voronoi.nbr[nbrBase + k], 1);
		}

		const total = state.soundingCount;
		frame.count = total;
		const constAmp = CONST_TOTAL_AMP / Math.sqrt(total);

		for (let m = 0; m < total; m++) {
			const c = state.sounding[m];
			const dx = sites.x[c] - px;
			const dy = sites.y[c] - py;
			const d = Math.sqrt(dx * dx + dy * dy);
			frame.cell[m] = c;
			frame.freq[m] = state.freqMode === 0 ? Tones.hz(sites.semitone[c]) : Tones.distFreq(d, state.freqSteep);
			frame.amp[m] = state.volMode === 0 ? MAX_VOICE_AMP * Tones.distVolume(d, state.volSteep) : constAmp;
			frame.pan[m] = panFromDelta(dx, d);
			frame.depth[m] = state.envMode === 1 ? Tones.envDepth(d) : 0;
			frame.rate[m] = state.envMode === 1 ? Tones.envRate(d, state.envSteep) : 1;
		}
	}

	/* ---- readout ---- */

	function formatVoice(m) {
		const pitch = state.freqMode === 0 ? noteName[frame.cell[m]] : Math.round(frame.freq[m]) + 'Hz';
		if (state.envMode === 0) return pitch;
		const env = frame.depth[m] < 0.05 ? 'cont' : frame.rate[m].toFixed(1) + 'Hz';
		return pitch + '@' + env;
	}

	function updateVoices() {
		const shown = Math.min(frame.count, 4);
		let text = '';
		for (let m = 0; m < shown; m++) {
			text += (m === 0 ? '' : ' · ') + formatVoice(m);
		}
		if (frame.count > shown) text += ' +' + (frame.count - shown);
		ui.voices.textContent = text;
	}

	/* ---- render ---- */

	function drawCells() {
		const polyX = voronoi.polyX;
		const polyY = voronoi.polyY;
		const verts = voronoi.verts;
		const stride = voronoi.stride;
		for (let i = 0; i < voronoi.n; i++) {
			const count = verts[i];
			if (count < 3) continue;
			const base = i * stride;
			ctx.beginPath();
			ctx.moveTo(polyX[base], polyY[base]);
			for (let k = 1; k < count; k++) ctx.lineTo(polyX[base + k], polyY[base + k]);
			ctx.closePath();
			const cellRole = role[i];
			ctx.fillStyle = cellRole === 2 ? hotColor[i] : cellRole === 1 ? adjColor[i] : fillColor[i];
			ctx.fill();
			ctx.lineWidth = cellRole === 2 ? 1.7 : cellRole === 1 ? 1.25 : 0.9;
			ctx.strokeStyle = cellRole === 2 ? dotColor[i] : strokeColor[i];
			ctx.stroke();
		}
	}

	function drawSites() {
		const showCore = state.envMode === 1;
		for (let i = 0; i < sites.count; i++) {
			const x = sites.x[i];
			const y = sites.y[i];
			const radius = sites.radius[i];
			if (showCore && role[i] > 0) {
				ctx.beginPath();
				ctx.arc(x, y, Tones.ENV_CONT_PX, 0, TAU);
				ctx.strokeStyle = coreColor[i];
				ctx.lineWidth = 1;
				ctx.stroke();
			}
			ctx.beginPath();
			ctx.arc(x, y, radius, 0, TAU);
			ctx.fillStyle = glowColor[i];
			ctx.fill();
			ctx.beginPath();
			ctx.arc(x, y, radius * 0.42, 0, TAU);
			ctx.fillStyle = dotColor[i];
			ctx.fill();
		}
	}

	function drawProbe() {
		const trailX = physics.trailX;
		const trailY = physics.trailY;
		const count = physics.trailCount;
		ctx.lineWidth = 2;
		ctx.lineCap = 'round';
		for (let k = 1; k < count; k++) {
			ctx.strokeStyle = trailColor[((k / count) * (TRAIL_RAMP - 1)) | 0];
			ctx.beginPath();
			ctx.moveTo(trailX[k - 1], trailY[k - 1]);
			ctx.lineTo(trailX[k], trailY[k]);
			ctx.stroke();
		}
		if (state.aiming) {
			ctx.setLineDash([4, 7]);
			ctx.strokeStyle = 'rgba(150, 236, 255, 0.4)';
			ctx.beginPath();
			ctx.moveTo(drag.x0, drag.y0);
			ctx.lineTo(drag.x0 + (drag.x - drag.x0) * 0.5, drag.y0 + (drag.y - drag.y0) * 0.5);
			ctx.stroke();
			ctx.setLineDash([]);
		}
		ctx.beginPath();
		ctx.arc(physics.x, physics.y, 3.4, 0, TAU);
		ctx.fillStyle = '#eafcff';
		ctx.fill();
		ctx.beginPath();
		ctx.arc(physics.x, physics.y, 9, 0, TAU);
		ctx.strokeStyle = 'rgba(150, 236, 255, 0.45)';
		ctx.lineWidth = 1.2;
		ctx.stroke();
	}

	function render() {
		const w = state.viewW;
		const h = state.viewH;
		ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
		ctx.fillStyle = '#07070d';
		ctx.fillRect(0, 0, w, h);
		drawCells();
		drawSites();
		drawProbe();
	}

	/* ---- loop ---- */

	function loop(now) {
		const dt = state.lastTime ? Math.min(0.05, (now - state.lastTime) / 1000) : 0.016;
		state.lastTime = now;
		if (state.running && !state.aiming) {
			physics.step(sites.x, sites.y, sites.mass, sites.count, state.viewW, state.viewH, dt);
		}
		buildFrame();
		sound.apply(frame);
		if ((state.readoutTick++ & READOUT_EVERY) === 0) updateVoices();
		render();
		requestAnimationFrame(loop);
	}

	/* ---- ui ---- */

	function updateCount() {
		ui.count.textContent = sites.count + (sites.count === 1 ? ' point' : ' points');
	}

	function syncCountInput() {
		updateCount();
		if (sites.count > 0) ui.nPoints.value = String(sites.count);
	}

	function updateStatus() {
		ui.status.textContent = state.running ? (state.muted ? 'muted' : '') : 'paused';
	}

	function setFreqMode(mode) {
		state.freqMode = mode;
		ui.freqPoint.checked = mode === 0;
		ui.freqDist.checked = mode === 1;
		ui.rowFreqSteep.classList.toggle('disabled', mode === 0);
	}

	function setVolMode(mode) {
		state.volMode = mode;
		ui.volDist.checked = mode === 0;
		ui.volConst.checked = mode === 1;
		ui.rowVolSteep.classList.toggle('disabled', mode === 1);
	}

	function setEnvMode(mode) {
		state.envMode = mode;
		ui.envOff.checked = mode === 0;
		ui.envDist.checked = mode === 1;
		ui.rowEnvSteep.classList.toggle('disabled', mode === 0);
	}

	function startAudio() {
		if (sound.start()) {
			if (!state.running) sound.suspend();
			ui.gate.classList.add('hidden');
			return;
		}
		ui.gate.textContent = 'audio unavailable';
		ui.gate.classList.add('hidden');
	}

	function toggleMute() {
		state.muted = !state.muted;
		sound.setMuted(state.muted);
		updateStatus();
	}

	function toggleRunning() {
		state.running = !state.running;
		if (state.running) sound.resume();
		else sound.suspend();
		updateStatus();
	}

	/* ---- input ---- */

	function onPointerDown(event) {
		startAudio();
		const rect = canvas.getBoundingClientRect();
		const cx = event.clientX - rect.left;
		const cy = event.clientY - rect.top;
		if (event.button === 2) {
			const hit = hitSite(cx, cy);
			if (hit >= 0) removePoint(hit);
			return;
		}
		drag.active = true;
		drag.moved = false;
		drag.ox = rect.left;
		drag.oy = rect.top;
		drag.x0 = cx;
		drag.y0 = cy;
		drag.x = cx;
		drag.y = cy;
		drag.index = hitSite(cx, cy);
		drag.kind = drag.index >= 0 ? 1 : 0;
		canvas.setPointerCapture(event.pointerId);
	}

	function onPointerMove(event) {
		if (!drag.active) return;
		drag.x = event.clientX - drag.ox;
		drag.y = event.clientY - drag.oy;
		if (drag.kind === 1) {
			drag.moved = true;
			movePoint(drag.index, drag.x, drag.y);
			return;
		}
		if (drag.moved) return;
		const dx = drag.x - drag.x0;
		const dy = drag.y - drag.y0;
		if (dx * dx + dy * dy < 36) return;
		drag.moved = true;
		state.aiming = true;
		physics.place(drag.x0, drag.y0);
	}

	function onPointerUp() {
		if (!drag.active) return;
		drag.active = false;
		if (drag.kind === 1) {
			retune(drag.index);
			return;
		}
		if (!drag.moved) {
			addPoint(drag.x0, drag.y0);
			return;
		}
		state.aiming = false;
		physics.launch((drag.x - drag.x0) * LAUNCH_GAIN, (drag.y - drag.y0) * LAUNCH_GAIN);
	}

	function onKeyDown(event) {
		if (event.target && event.target.tagName === 'INPUT' && event.target.type === 'number') return;
		const key = event.key;
		if (key === 'r' || key === 'R') {
			startAudio();
			randomize(parseInt(ui.nPoints.value, 10));
			return;
		}
		if (key === 'c' || key === 'C') {
			clearPoints();
			return;
		}
		if (key === '1') {
			setFreqMode(state.freqMode ^ 1);
			return;
		}
		if (key === '2') {
			setVolMode(state.volMode ^ 1);
			return;
		}
		if (key === '3') {
			setEnvMode(state.envMode ^ 1);
			return;
		}
		if (key === 'm' || key === 'M') {
			toggleMute();
			return;
		}
		if (key === 'p' || key === 'P') {
			toggleRunning();
			return;
		}
		if (key === ' ') {
			event.preventDefault();
			startAudio();
			const angle = Math.random() * TAU;
			physics.launch(Math.cos(angle) * 420, Math.sin(angle) * 420);
		}
	}

	function resize() {
		const dpr = Math.min(2, root.devicePixelRatio || 1);
		const w = Math.max(320, root.innerWidth || 320);
		const h = Math.max(240, root.innerHeight || 240);
		state.viewW = w;
		state.viewH = h;
		state.dpr = dpr;
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		canvas.style.width = w + 'px';
		canvas.style.height = h + 'px';
		for (let i = 0; i < sites.count; i++) {
			sites.x[i] = clamp(sites.x[i], 8, w - 8);
			sites.y[i] = clamp(sites.y[i], 8, h - 8);
		}
		physics.x = clamp(physics.x, 0, w);
		physics.y = clamp(physics.y, 0, h);
		rebuild();
	}

	function bindEvents() {
		canvas.addEventListener('pointerdown', onPointerDown);
		canvas.addEventListener('pointermove', onPointerMove);
		canvas.addEventListener('pointerup', onPointerUp);
		canvas.addEventListener('pointercancel', onPointerUp);
		canvas.addEventListener('contextmenu', event => event.preventDefault());
		root.addEventListener('keydown', onKeyDown);
		root.addEventListener('resize', resize);

		ui.freqPoint.addEventListener('change', () => setFreqMode(0));
		ui.freqDist.addEventListener('change', () => setFreqMode(1));
		ui.volDist.addEventListener('change', () => setVolMode(0));
		ui.volConst.addEventListener('change', () => setVolMode(1));
		ui.envDist.addEventListener('change', () => setEnvMode(1));
		ui.envOff.addEventListener('change', () => setEnvMode(0));

		ui.freqSteep.addEventListener('input', () => { state.freqSteep = ui.freqSteep.value / 100; });
		ui.volSteep.addEventListener('input', () => { state.volSteep = ui.volSteep.value / 100; });
		ui.envSteep.addEventListener('input', () => { state.envSteep = ui.envSteep.value / 100; });

		ui.nPoints.addEventListener('change', () => {
			startAudio();
			randomize(parseInt(ui.nPoints.value, 10));
		});
		ui.random.addEventListener('click', () => {
			ui.random.blur();
			startAudio();
			randomize(parseInt(ui.nPoints.value, 10));
		});
		ui.clear.addEventListener('click', () => {
			ui.clear.blur();
			clearPoints();
		});
	}

	function init() {
		canvas = $('c');
		ctx = canvas.getContext('2d');
		ui = {
			freqPoint: $('freq-point'),
			freqDist: $('freq-dist'),
			volDist: $('vol-dist'),
			volConst: $('vol-const'),
			envDist: $('env-dist'),
			envOff: $('env-off'),
			freqSteep: $('freq-steep'),
			volSteep: $('vol-steep'),
			envSteep: $('env-steep'),
			rowFreqSteep: $('row-freq-steep'),
			rowVolSteep: $('row-vol-steep'),
			rowEnvSteep: $('row-env-steep'),
			nPoints: $('n-points'),
			count: $('count'),
			voices: $('voices'),
			status: $('status'),
			random: $('random'),
			clear: $('clear'),
			gate: $('gate'),
		};
		buildPalette();
		bindEvents();
		resize();
		physics.place(state.viewW * 0.5, state.viewH * 0.5);
		state.freqSteep = ui.freqSteep.value / 100;
		state.volSteep = ui.volSteep.value / 100;
		state.envSteep = ui.envSteep.value / 100;
		setFreqMode(0);
		setVolMode(0);
		setEnvMode(1);
		ui.nPoints.value = String(defaultPointCount());
		randomize(parseInt(ui.nPoints.value, 10));
		updateStatus();
		requestAnimationFrame(loop);
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();
})(typeof globalThis !== 'undefined' ? globalThis : this);

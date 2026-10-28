(function (root) {
	'use strict';

	const { Voronoi, Physics, Sound, Tones } = root.GS;
	const $ = id => document.getElementById(id);

	const MAX_POINTS = Voronoi.MAX_POINTS;
	const VOICES = 3;
	const TAU = Math.PI * 2;
	const MIN_GAP = 34;
	const LAUNCH_GAIN = 2.4;
	const TRAIL_RAMP = 32;

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

	const state = {
		viewW: 0,
		viewH: 0,
		dpr: 1,
		mode: 0,
		sensitivity: 0.55,
		running: true,
		muted: false,
		aiming: false,
		sounding: new Int32Array(VOICES),
		soundingCount: 0,
		soundRef: 420,
		toneRef: 240,
		lastTime: 0,
	};

	const drag = { active: false, kind: 0, index: -1, x0: 0, y0: 0, x: 0, y: 0, moved: false };

	// Reused every frame; never reallocated.
	const frame = {
		count: 0,
		depth: 0.1,
		freq: new Float64Array(VOICES),
		amp: new Float64Array(VOICES),
		pan: new Float64Array(VOICES),
		lfo: new Float64Array(VOICES),
	};

	const fillColor = new Array(MAX_POINTS);
	const hotColor = new Array(MAX_POINTS);
	const strokeColor = new Array(MAX_POINTS);
	const dotColor = new Array(MAX_POINTS);
	const glowColor = new Array(MAX_POINTS);
	// 0 idle, 1 adjacent sounding cell, 2 cell under the probe.
	const role = new Int8Array(MAX_POINTS);
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
		const hue = Tones.hue(sites.semitone[i]).toFixed(0);
		fillColor[i] = 'hsla(' + hue + ', 76%, 54%, 0.26)';
		hotColor[i] = 'hsla(' + hue + ', 88%, 58%, 0.42)';
		strokeColor[i] = 'hsla(' + hue + ', 80%, 62%, 0.45)';
		dotColor[i] = 'hsla(' + hue + ', 90%, 68%, 0.95)';
		glowColor[i] = 'hsla(' + hue + ', 90%, 60%, 0.24)';
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

	function tooClose(x, y) {
		for (let i = 0; i < sites.count; i++) {
			const dx = sites.x[i] - x;
			const dy = sites.y[i] - y;
			if (dx * dx + dy * dy < MIN_GAP * MIN_GAP) return true;
		}
		return false;
	}

	function insertSite(x, y) {
		if (sites.count >= MAX_POINTS || tooClose(x, y)) return -1;
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
		if (insertSite(x, y) < 0) return;
		rebuild();
		updateCount();
	}

	function removePoint(index) {
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
		updateCount();
	}

	function movePoint(index, x, y) {
		sites.x[index] = clamp(x, 8, state.viewW - 8);
		sites.y[index] = clamp(y, 8, state.viewH - 8);
		rebuild();
	}

	// Retuning on release instead of on every move keeps the pitch stable while
	// a point is dragged.
	function retune(index) {
		const semitone = Tones.pick(sites.x[index], sites.y[index], sites.x, sites.y, sites.semitone, sites.count, index);
		if (semitone === sites.semitone[index]) return;
		sites.semitone[index] = semitone;
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
		sites.count = 0;
		frame.count = 0;
		rebuild();
		updateCount();
	}

	function randomize() {
		sites.count = 0;
		const target = clamp(Math.round(state.viewW * state.viewH / 46000), 4, 32);
		const margin = 26;
		let guard = 0;
		while (sites.count < target && guard++ < 4000) {
			insertSite(
				margin + Math.random() * (state.viewW - margin * 2),
				margin + Math.random() * (state.viewH - margin * 2)
			);
		}
		rebuild();
		updateCount();
	}

	/* ---- sound frame ---- */

	function clearSounding() {
		for (let i = 0; i < state.soundingCount; i++) role[state.sounding[i]] = 0;
		state.soundingCount = 0;
	}

	function markSounding(index, cellRole) {
		role[index] = cellRole;
		state.sounding[state.soundingCount++] = index;
	}

	function panOf(index) {
		return clamp((sites.x[index] - physics.x) * (0.9 / (state.viewW * 0.5)), -1, 1);
	}

	// Adjacent cells sit farther away than the cell under the probe; this keeps
	// them audible as colour without competing for the foreground.
	function relative(front, other) {
		return clamp((front + 44) / (other + 44), 0, 1);
	}

	function setVoice(v, cell, hz, amp, lfoHz) {
		frame.freq[v] = hz;
		frame.amp[v] = amp;
		frame.pan[v] = panOf(cell);
		frame.lfo[v] = lfoHz;
	}

	// The nearest point is rarely farther than a third of the diagonal, so the
	// tremolo and pitch ranges are spread over that distance, not the full canvas.
	function toneVoice(v, cell, dist, amp) {
		const u = dist / state.toneRef;
		setVoice(v, cell, Tones.pitch(u, 14 + 30 * state.sensitivity), amp, Tones.tremolo(u));
	}

	function buildFrame() {
		const f = frame;
		clearSounding();
		if (sites.count === 0) {
			f.count = 0;
			return;
		}
		const px = physics.x;
		const py = physics.y;
		const near = voronoi.nearest(px, py);
		const dx = sites.x[near] - px;
		const dy = sites.y[near] - py;
		const d0 = Math.sqrt(dx * dx + dy * dy);

		// Nearest two neighbours of the cell under the probe. Only these three
		// cells reach the synth.
		let n1 = -1;
		let n2 = -1;
		let d1 = Infinity;
		let d2 = Infinity;
		const base = near * voronoi.nbrStride;
		for (let k = 0, c = voronoi.nbrCount[near]; k < c; k++) {
			const j = voronoi.nbr[base + k];
			const jx = sites.x[j] - px;
			const jy = sites.y[j] - py;
			const dd = jx * jx + jy * jy;
			if (dd < d1) {
				d2 = d1;
				n2 = n1;
				d1 = dd;
				n1 = j;
			} else if (dd < d2) {
				d2 = dd;
				n2 = j;
			}
		}
		const e1 = Math.sqrt(d1);
		const e2 = Math.sqrt(d2);

		f.count = 1 + (n1 >= 0 ? 1 : 0) + (n2 >= 0 ? 1 : 0);
		markSounding(near, 2);
		if (n1 >= 0) markSounding(n1, 1);
		if (n2 >= 0) markSounding(n2, 1);

		if (state.mode === 0) {
			// Pitch belongs to the cell, volume follows the distance to its point.
			f.depth = 0.1;
			const falloff = 0.8 + 2.4 * state.sensitivity;
			const u = d0 / (0.35 * state.soundRef);
			const amp = 0.5 / (1 + u * u * falloff);
			setVoice(0, near, Tones.hz(sites.semitone[near]), amp, 4.5);
			// The neighbours double as octave partners, so the chord stays an
			// open fifth-ish stack rather than a cluster.
			if (n1 >= 0) setVoice(1, n1, Tones.hz(sites.semitone[n1]) * 2, amp * 0.8 * relative(d0, e1), 3.7);
			if (n2 >= 0) setVoice(2, n2, Tones.hz(sites.semitone[n2]) * 0.5, amp * 0.6 * relative(d0, e2), 5.3);
			return;
		}

		// Pitch and tremolo rate both follow the distance, per cell: 0.1 Hz far
		// away, 30 Hz close, where the tremolo turns into an AM timbre.
		f.depth = 0.95;
		toneVoice(0, near, d0, 0.5);
		if (n1 >= 0) toneVoice(1, n1, e1, 0.28 * relative(d0, e1));
		if (n2 >= 0) toneVoice(2, n2, e2, 0.2 * relative(d0, e2));
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
			ctx.fillStyle = cellRole === 2 ? hotColor[i] : fillColor[i];
			ctx.fill();
			// Sounding cells get a brighter outline, the one under the probe the brightest.
			ctx.lineWidth = cellRole === 2 ? 1.6 : cellRole === 1 ? 1.2 : 1;
			ctx.strokeStyle = cellRole === 2 ? dotColor[i] : strokeColor[i];
			ctx.stroke();
		}
	}

	function drawSites() {
		for (let i = 0; i < sites.count; i++) {
			const x = sites.x[i];
			const y = sites.y[i];
			const radius = sites.radius[i];
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
		render();
		requestAnimationFrame(loop);
	}

	/* ---- ui ---- */

	function updateCount() {
		ui.count.textContent = sites.count + (sites.count === 1 ? ' point' : ' points');
	}

	function updateStatus() {
		ui.status.textContent = state.running ? (state.muted ? 'muted' : '') : 'paused';
	}

	function setMode(mode) {
		state.mode = mode;
		sound.setMode(mode);
		ui.modePad.checked = mode === 0;
		ui.modeDist.checked = mode === 1;
		ui.sensLabel.textContent = mode === 0 ? 'distance → volume' : 'distance → pitch';
	}

	function startAudio() {
		if (sound.start()) {
			// P could have been pressed before the first gesture created the context.
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
		if (event.button === 2) {
			const hit = hitSite(event.clientX, event.clientY);
			if (hit >= 0) removePoint(hit);
			return;
		}
		drag.active = true;
		drag.moved = false;
		drag.x0 = event.clientX;
		drag.y0 = event.clientY;
		drag.x = drag.x0;
		drag.y = drag.y0;
		drag.index = hitSite(drag.x0, drag.y0);
		drag.kind = drag.index >= 0 ? 1 : 0;
		canvas.setPointerCapture(event.pointerId);
	}

	function onPointerMove(event) {
		if (!drag.active) return;
		drag.x = event.clientX;
		drag.y = event.clientY;
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
		const key = event.key;
		if (key === 'r' || key === 'R') {
			startAudio();
			randomize();
			return;
		}
		if (key === 'c' || key === 'C') {
			clearPoints();
			return;
		}
		if (key === '1' || key === '2') {
			setMode(key === '1' ? 0 : 1);
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
		state.soundRef = Math.max(160, 0.42 * Math.sqrt(w * w + h * h));
		state.toneRef = 0.55 * state.soundRef;
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
		ui.modePad.addEventListener('change', () => setMode(0));
		ui.modeDist.addEventListener('change', () => setMode(1));
		ui.sens.addEventListener('input', () => {
			state.sensitivity = ui.sens.value / 100;
		});
		ui.random.addEventListener('click', () => {
			ui.random.blur();
			startAudio();
			randomize();
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
			modePad: $('mode-pad'),
			modeDist: $('mode-dist'),
			sens: $('sens'),
			sensLabel: $('sens-label'),
			count: $('count'),
			status: $('status'),
			random: $('random'),
			clear: $('clear'),
			gate: $('gate'),
		};
		buildPalette();
		bindEvents();
		resize();
		state.sensitivity = ui.sens.value / 100;
		setMode(0);
		randomize();
		updateStatus();
		requestAnimationFrame(loop);
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();
})(typeof globalThis !== 'undefined' ? globalThis : this);

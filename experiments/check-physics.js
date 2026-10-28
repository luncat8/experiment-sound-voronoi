'use strict';
// Checks that the probe stays finite, in bounds, and never goes silent for long.
const path = require('path');
const Physics = require(path.join(__dirname, '..', 'src', 'physics.js'));

const W = 1280;
const H = 720;
const DT = 1 / 60;
let failures = 0;

function check(name, ok, detail) {
	if (ok) {
		console.log('  ok   ' + name);
		return;
	}
	failures++;
	console.log('  FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']'));
}

function buildField(n, seed) {
	let s = seed >>> 0;
	const rnd = () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const x = new Float64Array(n);
	const y = new Float64Array(n);
	const mass = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		x[i] = 40 + rnd() * (W - 80);
		y[i] = 40 + rnd() * (H - 80);
		const radius = 7 + rnd() * 13;
		mass[i] = Math.pow(radius / 12, 2) * 0.9 + 0.15;
	}
	return { x, y, mass, count: n };
}

function run(p, probe, seconds) {
	const frames = Math.round(seconds / DT);
	let slowFrames = 0;
	let moved = 0;
	let lastX = probe.x;
	let lastY = probe.y;
	for (let f = 0; f < frames; f++) {
		probe.step(p.x, p.y, p.mass, p.count, W, H, DT);
		if (!Number.isFinite(probe.x) || !Number.isFinite(probe.y)) return { ok: false, frames: f };
		if (probe.x < -1e-6 || probe.x > W + 1e-6 || probe.y < -1e-6 || probe.y > H + 1e-6) return { ok: false, frames: f };
		if (Math.hypot(probe.vx, probe.vy) > 981) return { ok: false, frames: f };
		const step = Math.hypot(probe.x - lastX, probe.y - lastY);
		moved += step;
		if (step < 0.2) slowFrames++;
		lastX = probe.x;
		lastY = probe.y;
	}
	return { ok: true, slow: slowFrames / frames, moved };
}

console.log('nominal field of 24 points');
{
	const p = buildField(24, 991);
	const probe = new Physics();
	probe.place(W / 2, H / 2);
	const result = run(p, probe, 60);
	check('stays finite and in bounds', result.ok, result.frames);
	console.log('  ..   travelled ' + result.moved.toFixed(0) + ' px, idle frames ' + (result.slow * 100).toFixed(1) + '%');
	check('keeps flying', result.moved > 6000, result.moved.toFixed(0));
	check('does not hang in one spot', result.slow < 0.25, (result.slow * 100).toFixed(1) + '%');
	check('trail stays bounded', probe.trailCount > 4 && probe.trailCount <= 96, probe.trailCount);
}

console.log('strong single well');
{
	const x = new Float64Array([W / 2]);
	const y = new Float64Array([H / 2]);
	const mass = new Float64Array([2.6]);
	const p = { x, y, mass, count: 1 };
	const probe = new Physics();
	probe.place(W / 2, H / 2);
	const result = run(p, probe, 30);
	check('centre of a heavy point stays finite', result.ok, result.frames);
	check('stall nudges it loose', result.moved > 1500, result.moved.toFixed(0));
}

console.log('empty field');
{
	const p = { x: new Float64Array(0), y: new Float64Array(0), mass: new Float64Array(0), count: 0 };
	const probe = new Physics();
	probe.place(10, 10);
	probe.launch(-400, 0);
	const result = run(p, probe, 10);
	check('ballistic probe bounces inside', result.ok, result.frames);
}

console.log('launch clamp');
{
	const probe = new Physics();
	probe.place(100, 100);
	probe.launch(5000, 5000);
	check('speed is clamped', Math.hypot(probe.vx, probe.vy) <= 980 + 1e-6, Math.hypot(probe.vx, probe.vy).toFixed(1));
}

console.log(failures === 0 ? '\nall physics checks passed' : '\n' + failures + ' physics check(s) failed');
process.exitCode = failures === 0 ? 0 : 1;

'use strict';
// Verifies the flat Voronoi: clipping exactness, containment, adjacency, perf.
const path = require('path');
const Voronoi = require(path.join(__dirname, '..', 'src', 'voronoi.js'));

const W = 1280;
const H = 720;
const v = new Voronoi();
let failures = 0;

function check(name, ok, detail) {
	if (ok) {
		console.log('  ok   ' + name);
		return;
	}
	failures++;
	console.log('  FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']'));
}

function rand(seed) {
	let s = seed >>> 0;
	return function () {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function scatter(n, seed, margin) {
	const rnd = rand(seed);
	const xs = new Float64Array(n);
	const ys = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		xs[i] = margin + rnd() * (W - margin * 2);
		ys[i] = margin + rnd() * (H - margin * 2);
	}
	return { xs, ys };
}

function areaSum() {
	let sum = 0;
	for (let i = 0; i < v.n; i++) sum += v.area[i];
	return sum;
}

function insideCell(i, x, y) {
	const base = i * v.stride;
	const count = v.verts[i];
	let positive = false;
	let negative = false;
	for (let k = 0; k < count; k++) {
		const ax = v.polyX[base + k];
		const ay = v.polyY[base + k];
		const bx = v.polyX[base + ((k + 1) % count)];
		const by = v.polyY[base + ((k + 1) % count)];
		const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
		if (cross > 1e-6) positive = true;
		if (cross < -1e-6) negative = true;
	}
	return !(positive && negative);
}

function convex(i) {
	const base = i * v.stride;
	const count = v.verts[i];
	let positive = false;
	let negative = false;
	for (let k = 0; k < count; k++) {
		const ax = v.polyX[base + k];
		const ay = v.polyY[base + k];
		const bx = v.polyX[base + ((k + 1) % count)];
		const by = v.polyY[base + ((k + 1) % count)];
		const cx = v.polyX[base + ((k + 2) % count)];
		const cy = v.polyY[base + ((k + 2) % count)];
		const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
		if (cross > 1e-6) positive = true;
		if (cross < -1e-6) negative = true;
	}
	return !(positive && negative);
}

console.log('empty');
v.build(new Float64Array(0), new Float64Array(0), 0, W, H);
check('n=0 stays empty', v.n === 0);

console.log('single site');
v.build(new Float64Array([400]), new Float64Array([300]), 1, W, H);
check('cell is the whole view', Math.abs(v.area[0] - W * H) < 1e-6, v.area[0]);
check('four vertices', v.verts[0] === 4, v.verts[0]);
check('no neighbours', v.nbrCount[0] === 0);

console.log('two sites');
{
	const p = scatter(2, 7, 100);
	v.build(p.xs, p.ys, 2, W, H);
	check('areas tile the view', Math.abs(areaSum() - W * H) < 1e-6, areaSum());
	check('both cells polygonised', v.verts[0] >= 3 && v.verts[1] >= 3);
	check('symmetric adjacency', v.nbrCount[0] === 1 && v.nbr[0] === 1 && v.nbrCount[1] === 1 && v.nbr[v.nbrStride] === 0);
}

console.log('40 scattered sites');
{
	const n = 40;
	const p = scatter(n, 12345, 20);
	v.build(p.xs, p.ys, n, W, H);
	check('areas tile the view', Math.abs(areaSum() - W * H) < 1e-6 * W * H, areaSum());
	let bad = 0;
	for (let i = 0; i < n; i++) {
		if (!convex(i)) bad++;
		const base = i * v.stride;
		for (let k = 0; k < v.verts[i]; k++) {
			const x = v.polyX[base + k];
			const y = v.polyY[base + k];
			if (x < -1e-6 || x > W + 1e-6 || y < -1e-6 || y > H + 1e-6) bad++;
		}
	}
	check('convex cells inside the view', bad === 0, bad);

	let violation = 0;
	for (let i = 0; i < n; i++) {
		const base = i * v.stride;
		for (let k = 0; k < v.verts[i]; k++) {
			const x = v.polyX[base + k];
			const y = v.polyY[base + k];
			const di = (x - v.sx[i]) ** 2 + (y - v.sy[i]) ** 2;
			for (let j = 0; j < n; j++) {
				if (j === i) continue;
				const dj = (x - v.sx[j]) ** 2 + (y - v.sy[j]) ** 2;
				if (di > dj + 1e-6 * (di + 1)) violation++;
			}
		}
	}
	check('every vertex is nearest to its own site', violation === 0, violation);

	const rnd = rand(99);
	let misses = 0;
	for (let t = 0; t < 4000; t++) {
		const x = rnd() * W;
		const y = rnd() * H;
		const owner = v.nearest(x, y);
		if (!insideCell(owner, x, y)) misses++;
	}
	check('random probes land in the nearest cell', misses === 0, misses);

	let asymmetric = 0;
	for (let i = 0; i < n; i++) {
		for (let k = 0; k < v.nbrCount[i]; k++) {
			const j = v.nbr[i * v.nbrStride + k];
			let back = false;
			for (let m = 0; m < v.nbrCount[j]; m++) if (v.nbr[j * v.nbrStride + m] === i) back = true;
			if (!back) asymmetric++;
		}
	}
	check('adjacency is symmetric', asymmetric === 0, asymmetric);

	let lonely = 0;
	for (let i = 0; i < n; i++) if (v.nbrCount[i] === 0) lonely++;
	check('every cell has neighbours', lonely === 0, lonely);
}

console.log('collinear sites');
{
	const n = 6;
	const xs = new Float64Array(n);
	const ys = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		xs[i] = 100 + i * 180;
		ys[i] = 360;
	}
	v.build(xs, ys, n, W, H);
	check('still tiles the view', Math.abs(areaSum() - W * H) < 1e-6 * W * H, areaSum());
	check('adjacency follows the line', v.nbrCount[0] === 1 && v.nbr[0] === 1, v.nbrCount[0]);
}

console.log('perf');
{
	const n = 300;
	const p = scatter(n, 4242, 12);
	v.build(p.xs, p.ys, n, W, H);
	const runs = 20;
	const t0 = process.hrtime.bigint();
	for (let r = 0; r < runs; r++) v.build(p.xs, p.ys, n, W, H);
	const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
	console.log('  ..   300 sites rebuilt in ' + ms.toFixed(2) + ' ms');
	check('rebuild under 8 ms', ms < 8, ms.toFixed(2));
}

console.log(failures === 0 ? '\nall voronoi checks passed' : '\n' + failures + ' voronoi check(s) failed');
process.exitCode = failures === 0 ? 0 : 1;

(function (root) {
	'use strict';

	const MAX_POINTS = 400;
	const MAX_VERTS = 64;
	const MAX_NEIGHBORS = 16;
	// A vertex counts as "on the bisector" when the distance difference is below
	// this fraction of the squared site distance (float noise is ~1e-12).
	const ON_BISECTOR = 1e-4;

	function maxReach2(xs, ys, count, cx, cy) {
		let best = 0;
		for (let k = 0; k < count; k++) {
			const dx = xs[k] - cx;
			const dy = ys[k] - cy;
			const d = dx * dx + dy * dy;
			if (d > best) best = d;
		}
		return best;
	}

	// Keep the part of a convex polygon where f(p) = a*x + b*y + c <= 0.
	// f is the squared-distance difference to two sites, hence linear along an
	// edge, so the crossing is a plain interpolation.
	function clipHalfPlane(px, py, count, a, b, c, outX, outY) {
		if (count === 0) return 0;
		let m = 0;
		let prevX = px[count - 1];
		let prevY = py[count - 1];
		let prevF = a * prevX + b * prevY + c;
		for (let k = 0; k < count; k++) {
			const curX = px[k];
			const curY = py[k];
			const curF = a * curX + b * curY + c;
			const curIn = curF <= 0;
			if (curIn !== (prevF <= 0)) {
				const t = prevF / (prevF - curF);
				outX[m] = prevX + (curX - prevX) * t;
				outY[m] = prevY + (curY - prevY) * t;
				m++;
			}
			if (curIn) {
				outX[m] = curX;
				outY[m] = curY;
				m++;
			}
			prevX = curX;
			prevY = curY;
			prevF = curF;
		}
		return m;
	}

	function Voronoi() {
		this.n = 0;
		this.width = 0;
		this.height = 0;
		this.sx = new Float64Array(MAX_POINTS);
		this.sy = new Float64Array(MAX_POINTS);
		// Flat polygon storage: cell i lives at i * stride.
		this.stride = MAX_VERTS;
		this.polyX = new Float64Array(MAX_POINTS * MAX_VERTS);
		this.polyY = new Float64Array(MAX_POINTS * MAX_VERTS);
		this.verts = new Int32Array(MAX_POINTS);
		this.area = new Float64Array(MAX_POINTS);
		this.reach = new Float64Array(MAX_POINTS);
		this.nbrStride = MAX_NEIGHBORS;
		this.nbrCount = new Int32Array(MAX_POINTS);
		this.nbr = new Int32Array(MAX_POINTS * MAX_NEIGHBORS);
		// Two ping-pong buffers; a cell grows by at most one vertex per clip.
		this.bufAX = new Float64Array(MAX_VERTS + MAX_POINTS);
		this.bufAY = new Float64Array(MAX_VERTS + MAX_POINTS);
		this.bufBX = new Float64Array(MAX_VERTS + MAX_POINTS);
		this.bufBY = new Float64Array(MAX_VERTS + MAX_POINTS);
	}

	Voronoi.MAX_POINTS = MAX_POINTS;

	Voronoi.prototype.build = function (srcX, srcY, count, width, height) {
		const n = Math.min(count, MAX_POINTS);
		this.n = n;
		this.width = width;
		this.height = height;
		for (let i = 0; i < n; i++) {
			this.sx[i] = srcX[i];
			this.sy[i] = srcY[i];
		}
		for (let i = 0; i < n; i++) this.clipCell(i);
		this.buildNeighbors();
	};

	Voronoi.prototype.clipCell = function (i) {
		const w = this.width;
		const h = this.height;
		const six = this.sx[i];
		const siy = this.sy[i];
		const si2 = six * six + siy * siy;

		let ax = this.bufAX;
		let ay = this.bufAY;
		let bx = this.bufBX;
		let by = this.bufBY;
		let count = 4;
		ax[0] = 0; ay[0] = 0;
		ax[1] = w; ay[1] = 0;
		ax[2] = w; ay[2] = h;
		ax[3] = 0; ay[3] = h;
		let reach = maxReach2(ax, ay, count, six, siy);

		for (let j = 0; j < this.n; j++) {
			if (j === i) continue;
			const dx = this.sx[j] - six;
			const dy = this.sy[j] - siy;
			const d2 = dx * dx + dy * dy;
			// No vertex of the current cell is farther than reach, so a site at
			// more than 2*reach cannot touch it: one compare replaces a clip.
			if (d2 > 4 * reach + 4) continue;
			const a = 2 * dx;
			const b = 2 * dy;
			const c = si2 - this.sx[j] * this.sx[j] - this.sy[j] * this.sy[j];
			count = clipHalfPlane(ax, ay, count, a, b, c, bx, by);
			if (count < 3) break;
			let swap = ax; ax = bx; bx = swap;
			swap = ay; ay = by; by = swap;
			reach = maxReach2(ax, ay, count, six, siy);
		}

		const base = i * this.stride;
		let shoelace = 0;
		for (let k = 0; k < count; k++) {
			const x0 = ax[k];
			const y0 = ay[k];
			const x1 = k + 1 === count ? ax[0] : ax[k + 1];
			const y1 = k + 1 === count ? ay[0] : ay[k + 1];
			shoelace += x0 * y1 - x1 * y0;
			this.polyX[base + k] = x0;
			this.polyY[base + k] = y0;
		}
		this.verts[i] = count;
		this.area[i] = (shoelace < 0 ? -shoelace : shoelace) * 0.5;
		this.reach[i] = reach;
	};

	Voronoi.prototype.buildNeighbors = function () {
		const n = this.n;
		const stride = this.stride;
		const polyX = this.polyX;
		const polyY = this.polyY;
		for (let i = 0; i < n; i++) {
			const six = this.sx[i];
			const siy = this.sy[i];
			const si2 = six * six + siy * siy;
			const base = i * stride;
			const count = this.verts[i];
			const reach = this.reach[i];
			const out = i * this.nbrStride;
			let found = 0;
			for (let j = 0; j < n && found < MAX_NEIGHBORS; j++) {
				if (j === i) continue;
				const dx = this.sx[j] - six;
				const dy = this.sy[j] - siy;
				const d2 = dx * dx + dy * dy;
				if (d2 > 4 * reach + 4) continue;
				const a = 2 * dx;
				const b = 2 * dy;
				const c = si2 - this.sx[j] * this.sx[j] - this.sy[j] * this.sy[j];
				const tolerance = ON_BISECTOR * d2;
				for (let k = 0; k < count; k++) {
					const f = a * polyX[base + k] + b * polyY[base + k] + c;
					if (f < tolerance && f > -tolerance) {
						this.nbr[out + found++] = j;
						break;
					}
				}
			}
			this.nbrCount[i] = found;
		}
	};

	Voronoi.prototype.nearest = function (x, y) {
		let best = -1;
		let bestDist = Infinity;
		for (let i = 0; i < this.n; i++) {
			const dx = this.sx[i] - x;
			const dy = this.sy[i] - y;
			const d = dx * dx + dy * dy;
			if (d < bestDist) {
				bestDist = d;
				best = i;
			}
		}
		return best;
	};

	root.GS = root.GS || {};
	root.GS.Voronoi = Voronoi;
	if (typeof module !== 'undefined' && module.exports) module.exports = Voronoi;
})(typeof globalThis !== 'undefined' ? globalThis : this);

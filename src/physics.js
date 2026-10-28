(function (root) {
	'use strict';

	const TAU = Math.PI * 2;
	const GRAVITY = 7.2e6;
	const SOFTENING = 3600;     // 60 px, caps the pull close to a point
	const DRAG = 0.9992;
	const MAX_SPEED = 980;
	const RESTITUTION = 0.78;
	const TRAIL_MAX = 96;
	const TRAIL_STEP = 6;
	const STALL_SPEED = 14;
	const STALL_TIME = 2.5;

	function Physics() {
		this.x = 0;
		this.y = 0;
		this.vx = 0;
		this.vy = 0;
		this.trailX = new Float64Array(TRAIL_MAX);
		this.trailY = new Float64Array(TRAIL_MAX);
		this.trailCount = 0;
		this.stall = 0;
	}

	Physics.prototype.place = function (x, y) {
		this.x = x;
		this.y = y;
		this.vx = 0;
		this.vy = 0;
		this.stall = 0;
		this.trailCount = 1;
		this.trailX[0] = x;
		this.trailY[0] = y;
	};

	Physics.prototype.launch = function (vx, vy) {
		const speed = Math.sqrt(vx * vx + vy * vy);
		const scale = speed > MAX_SPEED ? MAX_SPEED / speed : 1;
		this.vx = vx * scale;
		this.vy = vy * scale;
		this.stall = 0;
	};

	Physics.prototype.step = function (siteX, siteY, mass, count, width, height, dt) {
		let ax = 0;
		let ay = 0;
		for (let i = 0; i < count; i++) {
			const dx = siteX[i] - this.x;
			const dy = siteY[i] - this.y;
			const r2 = dx * dx + dy * dy;
			if (r2 < 1e-6) continue;
			const pull = GRAVITY * mass[i] / ((r2 + SOFTENING) * Math.sqrt(r2));
			ax += dx * pull;
			ay += dy * pull;
		}

		this.vx = (this.vx + ax * dt) * DRAG;
		this.vy = (this.vy + ay * dt) * DRAG;
		this.limitSpeed();

		this.x += this.vx * dt;
		this.y += this.vy * dt;
		if (this.x < 0) {
			this.x = 0;
			this.vx = -this.vx * RESTITUTION;
		} else if (this.x > width) {
			this.x = width;
			this.vx = -this.vx * RESTITUTION;
		}
		if (this.y < 0) {
			this.y = 0;
			this.vy = -this.vy * RESTITUTION;
		} else if (this.y > height) {
			this.y = height;
			this.vy = -this.vy * RESTITUTION;
		}

		this.checkStall(dt);
		this.pushTrail();
	};

	Physics.prototype.limitSpeed = function () {
		const speed2 = this.vx * this.vx + this.vy * this.vy;
		if (speed2 <= MAX_SPEED * MAX_SPEED) return;
		const scale = MAX_SPEED / Math.sqrt(speed2);
		this.vx *= scale;
		this.vy *= scale;
	};

	// A probe pinned in a gravity well would hold one tone forever; a nudge keeps
	// the piece moving without a visible reset.
	Physics.prototype.checkStall = function (dt) {
		const speed2 = this.vx * this.vx + this.vy * this.vy;
		if (speed2 > STALL_SPEED * STALL_SPEED) {
			this.stall = 0;
			return;
		}
		this.stall += dt;
		if (this.stall < STALL_TIME) return;
		const angle = Math.random() * TAU;
		this.launch(Math.cos(angle) * 300, Math.sin(angle) * 300);
	};

	Physics.prototype.pushTrail = function () {
		const count = this.trailCount;
		if (count === 0) {
			this.trailCount = 1;
			this.trailX[0] = this.x;
			this.trailY[0] = this.y;
			return;
		}
		const last = count - 1;
		const dx = this.x - this.trailX[last];
		const dy = this.y - this.trailY[last];
		if (dx * dx + dy * dy < TRAIL_STEP * TRAIL_STEP) return;
		if (count === TRAIL_MAX) {
			this.trailX.copyWithin(0, 1);
			this.trailY.copyWithin(0, 1);
			this.trailCount = last;
		}
		const slot = this.trailCount++;
		this.trailX[slot] = this.x;
		this.trailY[slot] = this.y;
	};

	root.GS = root.GS || {};
	root.GS.Physics = Physics;
	if (typeof module !== 'undefined' && module.exports) module.exports = Physics;
})(typeof globalThis !== 'undefined' ? globalThis : this);

(function (root) {
	'use strict';

	const VOICES = 3;
	const MASTER_LEVEL = 0.9;

	function Sound() {
		this.ctx = null;
		this.master = null;
		this.voices = null;
		this.mode = 0;
		this.muted = false;
		this.available = false;
	}

	Sound.prototype.start = function () {
		if (this.ctx) {
			this.resume();
			return true;
		}
		const Ctor = root.AudioContext || root.webkitAudioContext;
		if (!Ctor) return false;
		const ctx = new Ctor();
		const limiter = ctx.createDynamicsCompressor();
		limiter.threshold.value = -10;
		limiter.knee.value = 4;
		limiter.ratio.value = 6;
		limiter.attack.value = 0.004;
		limiter.release.value = 0.2;
		limiter.connect(ctx.destination);
		const master = ctx.createGain();
		master.gain.value = 0;
		master.connect(limiter);
		master.gain.setTargetAtTime(this.muted ? 0 : MASTER_LEVEL, ctx.currentTime, 0.2);

		this.ctx = ctx;
		this.master = master;
		this.voices = [];
		for (let i = 0; i < VOICES; i++) this.voices.push(this.createVoice(ctx, master));
		this.available = true;
		return true;
	};

	Sound.prototype.createVoice = function (ctx, out) {
		const osc = ctx.createOscillator();
		osc.type = this.mode === 1 ? 'sine' : 'triangle';
		osc.frequency.value = 220;
		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = 1400;
		filter.Q.value = this.mode === 1 ? 4 : 0.6;
		const tremolo = ctx.createGain();
		tremolo.gain.value = 0.5;
		const level = ctx.createGain();
		level.gain.value = 0;
		const pan = ctx.createStereoPanner();
		pan.pan.value = 0;
		const lfo = ctx.createOscillator();
		lfo.type = 'sine';
		lfo.frequency.value = 4.5;
		const mod = ctx.createGain();
		mod.gain.value = 0;

		osc.connect(filter).connect(tremolo).connect(level).connect(pan).connect(out);
		lfo.connect(mod).connect(tremolo.gain);
		osc.start();
		lfo.start();
		return { osc, filter, tremolo, level, pan, lfo, mod };
	};

	// frame: { count, freq[], amp[], pan[], lfo[], depth }
	Sound.prototype.apply = function (frame) {
		const ctx = this.ctx;
		if (!ctx) return;
		const now = ctx.currentTime;
		const depth = frame.depth;
		const brightness = this.mode === 1 ? 3.5 : 5;
		for (let i = 0; i < VOICES; i++) {
			const voice = this.voices[i];
			const active = i < frame.count;
			voice.level.gain.setTargetAtTime(active ? frame.amp[i] : 0, now, 0.045);
			if (!active) continue;
			const freq = frame.freq[i];
			voice.osc.frequency.setTargetAtTime(freq, now, 0.04);
			voice.filter.frequency.setTargetAtTime(Math.min(7000, freq * brightness), now, 0.08);
			voice.pan.pan.setTargetAtTime(frame.pan[i], now, 0.06);
			voice.lfo.frequency.setTargetAtTime(frame.lfo[i], now, 0.08);
			voice.mod.gain.setTargetAtTime(depth * 0.5, now, 0.1);
		}
	};

	Sound.prototype.setMode = function (mode) {
		this.mode = mode;
		if (!this.ctx) return;
		for (let i = 0; i < VOICES; i++) {
			const voice = this.voices[i];
			voice.osc.type = mode === 1 ? 'sine' : 'triangle';
			voice.filter.Q.setTargetAtTime(mode === 1 ? 4 : 0.6, this.ctx.currentTime, 0.05);
		}
	};

	Sound.prototype.setMuted = function (muted) {
		this.muted = muted;
		if (!this.ctx) return;
		this.master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, this.ctx.currentTime, 0.05);
	};

	Sound.prototype.suspend = function () {
		if (this.ctx) this.ctx.suspend();
	};

	Sound.prototype.resume = function () {
		if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
	};

	root.GS = root.GS || {};
	root.GS.Sound = Sound;
	if (typeof module !== 'undefined' && module.exports) module.exports = Sound;
})(typeof globalThis !== 'undefined' ? globalThis : this);

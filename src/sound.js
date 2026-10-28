(function (root) {
	'use strict';

	const VOICES = 3;
	const MASTER_LEVEL = 0.9;
	const ENVELOPE_STEPS = 1024;
	const ENVELOPE_ATTACK = 0.02;
	// Decay per cycle of the pulse LFO. At 0.1 Hz that is one ~10 s swell, at
	// 30 Hz it is an AM timbre.
	const ENVELOPE_DECAY = 4.2;

	// The LFO is a sawtooth sweeping -1..1; through this curve one cycle becomes
	// a short attack followed by an exponential decay, i.e. a plucked envelope.
	const PULSE_CURVE = new Float32Array(ENVELOPE_STEPS);
	for (let k = 0; k < ENVELOPE_STEPS; k++) {
		const phase = (k / (ENVELOPE_STEPS - 1)) * 2 - 1;
		const position = (phase + 1) * 0.5;
		const attack = Math.min(1, position / ENVELOPE_ATTACK);
		PULSE_CURVE[k] = attack * Math.exp(-ENVELOPE_DECAY * position);
	}
	// Identity curve keeps the shimmer LFO a sine in the sustained mode.
	const LINEAR_CURVE = new Float32Array([-1, 1]);

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
		limiter.threshold.value = -8;
		limiter.knee.value = 6;
		limiter.ratio.value = 4;
		limiter.attack.value = 0.005;
		limiter.release.value = 0.25;
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
		this.setMode(this.mode);
		return true;
	};

	Sound.prototype.createVoice = function (ctx, out) {
		const osc = ctx.createOscillator();
		osc.type = 'triangle';
		osc.frequency.value = 220;
		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = 1200;
		filter.Q.value = 0.7;
		const tremolo = ctx.createGain();
		tremolo.gain.value = 1;
		const level = ctx.createGain();
		level.gain.value = 0;
		const pan = ctx.createStereoPanner();
		pan.pan.value = 0;
		const lfo = ctx.createOscillator();
		lfo.type = 'sine';
		lfo.frequency.value = 4.5;
		const shaper = ctx.createWaveShaper();
		shaper.curve = LINEAR_CURVE;
		const mod = ctx.createGain();
		mod.gain.value = 0;

		osc.connect(filter).connect(tremolo).connect(level).connect(pan).connect(out);
		lfo.connect(shaper).connect(mod).connect(tremolo.gain);
		osc.start();
		lfo.start();
		return { osc, filter, tremolo, level, pan, lfo, shaper, mod };
	};

	// frame: { count, depth, freq[], amp[], pan[], rate[] }
	Sound.prototype.apply = function (frame) {
		const ctx = this.ctx;
		if (!ctx) return;
		const now = ctx.currentTime;
		const depth = frame.depth;
		const cutoffScale = this.mode === 1 ? 6 : 4;
		const cutoffMax = this.mode === 1 ? 9000 : 6000;
		for (let i = 0; i < VOICES; i++) {
			const voice = this.voices[i];
			const active = i < frame.count;
			voice.level.gain.setTargetAtTime(active ? frame.amp[i] : 0, now, 0.04);
			if (!active) continue;
			const freq = frame.freq[i];
			voice.osc.frequency.setTargetAtTime(freq, now, 0.035);
			voice.filter.frequency.setTargetAtTime(Math.min(cutoffMax, freq * cutoffScale), now, 0.08);
			voice.pan.pan.setTargetAtTime(frame.pan[i], now, 0.05);
			voice.lfo.frequency.setTargetAtTime(frame.rate[i], now, 0.06);
			voice.mod.gain.setTargetAtTime(depth, now, 0.08);
		}
	};

	Sound.prototype.setMode = function (mode) {
		this.mode = mode;
		if (!this.ctx) return;
		const now = this.ctx.currentTime;
		const pulsed = mode === 1;
		for (let i = 0; i < VOICES; i++) {
			const voice = this.voices[i];
			// Pulsed mode: the LFO gates the voice from silence, so the envelope
			// base has to be 0; sustained mode keeps a unity base with a shimmer.
			voice.lfo.type = pulsed ? 'sawtooth' : 'sine';
			voice.shaper.curve = pulsed ? PULSE_CURVE : LINEAR_CURVE;
			// Drop the modulation first, otherwise the base and the old depth add up
			// to a doubled gain for a moment.
			voice.mod.gain.setTargetAtTime(0, now, 0.03);
			voice.tremolo.gain.setTargetAtTime(pulsed ? 0 : 1, now, 0.05);
			voice.filter.Q.setTargetAtTime(pulsed ? 1.6 : 0.7, now, 0.05);
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

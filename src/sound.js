(function (root) {
	'use strict';

	// Pool covers nearest cell + up to 16 Voronoi neighbors + 3 release-tail slots.
	const MAX_VOICES = 20;
	const MASTER_LEVEL = 0.9;
	const CUTOFF_MIN = 90;
	const CUTOFF_MAX = 18000;
	const CUTOFF_MULT = 4.5;
	const METER_SIZE = 32;

	function setImmediate(param, value, now) {
		param.cancelScheduledValues(now);
		param.setValueAtTime(value, now);
	}

	function clampCutoff(freq) {
		const c = freq * CUTOFF_MULT;
		return c < CUTOFF_MIN ? CUTOFF_MIN : c > CUTOFF_MAX ? CUTOFF_MAX : c;
	}

	function Sound() {
		this.ctx = null;
		this.master = null;
		this.voices = null;
		this.muted = false;
		this.available = false;
		this.slotCell = new Int32Array(MAX_VOICES).fill(-1);
		this.slotActive = new Uint8Array(MAX_VOICES);
		this.slotGain = new Float64Array(MAX_VOICES);
		this.matched = new Uint8Array(MAX_VOICES);
	}

	Sound.MAX_VOICES = MAX_VOICES;

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
		master.gain.setTargetAtTime(this.muted ? 0 : MASTER_LEVEL, ctx.currentTime, 0.15);

		const meterSource = ctx.createConstantSource();
		meterSource.start();
		this.ctx = ctx;
		this.master = master;
		this.voices = [];
		for (let i = 0; i < MAX_VOICES; i++) this.voices.push(this.createVoice(ctx, master, meterSource));
		this.available = true;
		return true;
	};

	Sound.prototype.createVoice = function (ctx, out, meterSource) {
		const osc = ctx.createOscillator();
		osc.type = 'triangle';
		osc.frequency.value = 220;

		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = 1200;
		filter.Q.value = 0.7;

		const envGain = ctx.createGain();
		envGain.gain.value = 1;

		const level = ctx.createGain();
		level.gain.value = 0;

		const pan = ctx.createStereoPanner();
		pan.pan.value = 0;

		const lfo = ctx.createOscillator();
		lfo.type = 'sine';
		lfo.frequency.value = 4;

		const mod = ctx.createGain();
		mod.gain.value = 0;

		// A DC copy of the envelope makes the actual audio-rate modulation and level
		// observable without sampling the carrier or guessing the LFO's phase.
		const meterEnv = ctx.createGain();
		meterEnv.gain.value = 1;
		const meterLevel = ctx.createGain();
		meterLevel.gain.value = 0;
		const envelopeMeter = ctx.createAnalyser();
		const signalMeter = ctx.createAnalyser();
		envelopeMeter.fftSize = signalMeter.fftSize = METER_SIZE;
		const envelopeData = new Float32Array(METER_SIZE);
		const signalData = new Float32Array(METER_SIZE);

		osc.connect(filter).connect(envGain).connect(level).connect(pan).connect(out);
		lfo.connect(mod).connect(envGain.gain);
		mod.connect(meterEnv.gain);
		meterSource.connect(meterEnv);
		meterEnv.connect(envelopeMeter);
		meterEnv.connect(meterLevel).connect(signalMeter);
		osc.start();
		lfo.start();
		return { osc, filter, envGain, level, pan, lfo, mod, meterEnv, meterLevel, envelopeMeter, signalMeter, envelopeData, signalData };
	};

	Sound.prototype.findSlotForCell = function (cellId) {
		for (let s = 0; s < MAX_VOICES; s++) {
			if (this.slotCell[s] === cellId) return s;
		}
		return -1;
	};

	Sound.prototype.claimFreeSlot = function () {
		let best = 0;
		let bestGain = Infinity;
		for (let s = 0; s < MAX_VOICES; s++) {
			if (this.slotActive[s]) continue;
			if (this.slotCell[s] === -1) return s;
			if (this.slotGain[s] < bestGain) {
				bestGain = this.slotGain[s];
				best = s;
			}
		}
		return best;
	};

	Sound.prototype.driveSlot = function (slot, frame, k, now, snap) {
		const voice = this.voices[slot];
		const freq = frame.freq[k];
		const amp = frame.amp[k];
		const panVal = frame.pan[k];
		const rate = frame.rate[k];
		const depth = frame.depth[k];
		// Equal time constants keep envBase + modAmp === 1 across all transitions.
		const envBase = 1 - 0.5 * depth;
		const modAmp = 0.5 * depth;
		const cutoff = clampCutoff(freq);

		if (snap) {
			setImmediate(voice.osc.frequency, freq, now);
			setImmediate(voice.filter.frequency, cutoff, now);
			setImmediate(voice.pan.pan, panVal, now);
			setImmediate(voice.lfo.frequency, rate, now);
			setImmediate(voice.envGain.gain, envBase, now);
			setImmediate(voice.meterEnv.gain, envBase, now);
			setImmediate(voice.mod.gain, modAmp, now);
			if (this.slotGain[slot] < 1e-3) {
				setImmediate(voice.level.gain, 0, now);
				setImmediate(voice.meterLevel.gain, 0, now);
			}
		} else {
			voice.osc.frequency.setTargetAtTime(freq, now, 0.035);
			voice.filter.frequency.setTargetAtTime(cutoff, now, 0.06);
			voice.pan.pan.setTargetAtTime(panVal, now, 0.045);
			voice.lfo.frequency.setTargetAtTime(rate, now, 0.055);
			voice.envGain.gain.setTargetAtTime(envBase, now, 0.045);
			voice.meterEnv.gain.setTargetAtTime(envBase, now, 0.045);
			voice.mod.gain.setTargetAtTime(modAmp, now, 0.045);
		}
		voice.level.gain.setTargetAtTime(amp, now, 0.04);
		voice.meterLevel.gain.setTargetAtTime(amp, now, 0.04);
		this.slotGain[slot] = this.slotGain[slot] * 0.65 + amp * 0.35;

		if (snap) {
			frame.envelope[k] = envBase;
			frame.signal[k] = 0;
			return;
		}
		voice.envelopeMeter.getFloatTimeDomainData(voice.envelopeData);
		voice.signalMeter.getFloatTimeDomainData(voice.signalData);
		frame.envelope[k] = Math.max(0, Math.min(1, voice.envelopeData[METER_SIZE - 1]));
		frame.signal[k] = Math.max(0, voice.signalData[METER_SIZE - 1]);
	};

	// frame: { count, cell[], freq[], amp[], pan[], rate[], depth[], envelope[], signal[] }
	Sound.prototype.apply = function (frame) {
		const ctx = this.ctx;
		if (!ctx) return;
		const now = ctx.currentTime;
		const count = Math.min(frame.count, MAX_VOICES);
		this.slotActive.fill(0);
		this.matched.fill(0);

		for (let k = 0; k < count; k++) {
			const slot = this.findSlotForCell(frame.cell[k]);
			if (slot < 0) continue;
			this.slotActive[slot] = 1;
			this.matched[k] = 1;
			this.driveSlot(slot, frame, k, now, false);
		}

		for (let k = 0; k < count; k++) {
			if (this.matched[k]) continue;
			const slot = this.claimFreeSlot();
			this.slotCell[slot] = frame.cell[k];
			this.slotActive[slot] = 1;
			this.driveSlot(slot, frame, k, now, true);
		}

		for (let s = 0; s < MAX_VOICES; s++) {
			if (this.slotActive[s]) continue;
			this.voices[s].level.gain.setTargetAtTime(0, now, 0.04);
			this.voices[s].meterLevel.gain.setTargetAtTime(0, now, 0.04);
			this.slotGain[s] *= 0.72;
			if (this.slotGain[s] < 1e-4) {
				this.slotGain[s] = 0;
				this.slotCell[s] = -1;
			}
		}
	};

	Sound.prototype.releaseAll = function () {
		this.slotCell.fill(-1);
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

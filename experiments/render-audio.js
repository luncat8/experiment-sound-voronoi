'use strict';
// Renders the live parameter stream through a small software synth into a WAV,
// so the piece can be auditioned without a browser and the signal itself can be
// checked (silence, clipping, pulse rate). Node only, not loaded by the page.
//
//   node experiments/render-audio.js cell     [seconds] [out.wav]
//   node experiments/render-audio.js distance [seconds] [out.wav]
const fs = require('fs');
const path = require('path');
const { createPage } = require('./stub-page');

const MODE = process.argv[2] === 'distance' ? 'distance' : 'cell';
const SECONDS = Number(process.argv[3] || 20);
const OUT = process.argv[4] || path.join(__dirname, '..', 'sound-' + MODE + '.wav');

const FS = 44100;
const FRAME = 1 / 60;
const VOICES = 3;
const MASTER = 0.9;
const ENVELOPE_DECAY = 4.2;
const ENVELOPE_ATTACK = 0.02;

// Mirrors the time constants in src/sound.js.
const TAU = { freq: 0.035, level: 0.04, pan: 0.05, mod: 0.08, rate: 0.06 };

function onePole(tau) {
	return 1 - Math.exp(-1 / (tau * FS));
}

function envelope(phase) {
	const attack = Math.min(1, phase / ENVELOPE_ATTACK);
	return attack * Math.exp(-ENVELOPE_DECAY * phase);
}

/* ---- parameter timeline ---- */

const page = createPage();
page.dispatchWindow('keydown', { key: 'r' });
if (MODE === 'distance') page.dispatchWindow('keydown', { key: '2' });
page.dispatchWindow('keydown', { key: ' ' });
page.tick(20, 0);

const framesWanted = Math.round(SECONDS / FRAME);
const timeline = [];
let time = 0;
for (let f = 0; f < framesWanted; f++) {
	time = page.tick(1, time);
	const snapshot = [];
	for (let i = 0; i < VOICES; i++) {
		const voice = page.voice(i);
		snapshot.push({
			freq: voice.carrier.frequency.target || voice.carrier.frequency.value,
			level: voice.level.gain.target,
			pan: voice.pan.pan.target,
			mod: voice.mod.gain.target || 0,
			rate: voice.lfo.frequency.target || 4.5,
			pulsed: voice.lfo.type === 'sawtooth',
		});
	}
	timeline.push(snapshot);
}

/* ---- synthesis ---- */

const total = Math.round(SECONDS * FS);
const left = new Float32Array(total);
const right = new Float32Array(total);

const voices = [];
for (let i = 0; i < VOICES; i++) {
	voices.push({
		phase: Math.random(),
		lfoPhase: Math.random(),
		freq: 220,
		level: 0,
		pan: 0,
		mod: 0,
		rate: 4.5,
		pulsed: MODE === 'distance',
		filter: 0,
		alphaFreq: onePole(TAU.freq),
		alphaLevel: onePole(TAU.level),
		alphaPan: onePole(TAU.pan),
		alphaMod: onePole(TAU.mod),
		alphaRate: onePole(TAU.rate),
	});
}

for (let n = 0; n < total; n++) {
	const snapshot = timeline[Math.min(timeline.length - 1, Math.floor((n / FS) / FRAME))];
	let sumL = 0;
	let sumR = 0;
	for (let i = 0; i < VOICES; i++) {
		const target = snapshot[i];
		const voice = voices[i];
		voice.freq += (target.freq - voice.freq) * voice.alphaFreq;
		voice.level += ((target.level || 0) - voice.level) * voice.alphaLevel;
		voice.pan += (target.pan - voice.pan) * voice.alphaPan;
		voice.mod += (target.mod - voice.mod) * voice.alphaMod;
		voice.rate += (target.rate - voice.rate) * voice.alphaRate;
		voice.pulsed = target.pulsed;
		if (voice.level < 1e-4) continue;

		voice.phase += voice.freq / FS;
		if (voice.phase >= 1) voice.phase -= 1;
		voice.lfoPhase += voice.rate / FS;
		if (voice.lfoPhase >= 1) voice.lfoPhase -= 1;

		const p = voice.phase;
		const triangle = 4 * Math.abs(p - 0.5) - 1;
		// one-pole lowpass following the pitch, like the filter in sound.js
		const cutoff = Math.min(0.45, (voice.freq * (voice.pulsed ? 6 : 4)) / FS);
		voice.filter += (triangle - voice.filter) * cutoff * 2;

		const lfo = voice.pulsed ? envelope(voice.lfoPhase) : Math.sin(2 * Math.PI * voice.lfoPhase);
		const base = voice.pulsed ? 0 : 1;
		const gain = (base + voice.mod * lfo) * voice.level;
		const sample = voice.filter * gain;
		const angle = (Math.max(-1, Math.min(1, voice.pan)) + 1) * Math.PI * 0.25;
		sumL += sample * Math.cos(angle);
		sumR += sample * Math.sin(angle);
	}
	left[n] = Math.tanh(sumL * MASTER);
	right[n] = Math.tanh(sumR * MASTER);
}

/* ---- wav ---- */

const data = Buffer.alloc(total * 4);
for (let n = 0; n < total; n++) {
	data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[n])) * 32767), n * 4);
	data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[n])) * 32767), n * 4 + 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(FS, 24);
header.writeUInt32LE(FS * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
fs.writeFileSync(OUT, Buffer.concat([header, data]));

/* ---- analysis ---- */

let peak = 0;
let energy = 0;
let clipped = 0;
for (let n = 0; n < total; n++) {
	const a = Math.max(Math.abs(left[n]), Math.abs(right[n]));
	if (a > peak) peak = a;
	if (a >= 0.999) clipped++;
	energy += left[n] * left[n] + right[n] * right[n];
}
// Envelope peaks per second = how often a voice attacks: the articulation.
const window = Math.round(FS / 20);
const envelopeTrack = [];
for (let start = 0; start + window < total; start += window) {
	let sum = 0;
	for (let n = start; n < start + window; n++) sum += left[n] * left[n] + right[n] * right[n];
	envelopeTrack.push(Math.sqrt(sum / (window * 2)));
}
let attacks = 0;
for (let k = 1; k + 1 < envelopeTrack.length; k++) {
	if (envelopeTrack[k] > envelopeTrack[k - 1] && envelopeTrack[k] >= envelopeTrack[k + 1] && envelopeTrack[k] > 0.02) attacks++;
}
const silence = envelopeTrack.filter(v => v < 0.005).length / envelopeTrack.length;

console.log('mode        ' + MODE);
console.log('wrote       ' + OUT + ' (' + SECONDS + ' s, ' + (data.length / 1e6).toFixed(1) + ' MB)');
console.log('peak        ' + peak.toFixed(3) + ', clipped samples ' + clipped);
console.log('rms         ' + Math.sqrt(energy / (total * 2)).toFixed(4));
console.log('attacks     ' + (attacks / SECONDS).toFixed(2) + ' per second');
console.log('silence     ' + (100 * silence).toFixed(0) + '% of 50 ms windows below -46 dBFS');

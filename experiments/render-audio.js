'use strict';
// Offline WAV renderer for the multi-voice Web Audio synth across radio presets:
//   node experiments/render-audio.js [point-dist-env|dist-const-env|...] [seconds] [out.wav]
const fs = require('fs');
const path = require('path');
const { createPage } = require('./stub-page');

const PRESETS = {
	cell: ['freq-point', 'vol-dist', 'env-off'],
	distance: ['freq-dist', 'vol-const', 'env-dist'],
};

function parsePreset(arg) {
	if (!arg) return ['freq-point', 'vol-dist', 'env-dist'];
	if (PRESETS[arg]) return PRESETS[arg];
	const parts = arg.split('-');
	return [
		parts[0] === 'dist' ? 'freq-dist' : 'freq-point',
		parts[1] === 'const' ? 'vol-const' : 'vol-dist',
		parts[2] === 'off' ? 'env-off' : 'env-dist',
	];
}

const LABEL = process.argv[2] || 'point-dist-env';
const [freqId, volId, envId] = parsePreset(process.argv[2]);
const SECONDS = Number(process.argv[3] || 15);
const OUT = process.argv[4] || path.join(__dirname, '..', 'sound-' + LABEL + '.wav');

const FS = 44100;
const FRAME = 1 / 60;
const MASTER = 0.9;
const TAU = { freq: 0.035, level: 0.04, pan: 0.045, env: 0.045, rate: 0.055 };

function onePole(tau) {
	return 1 - Math.exp(-1 / (tau * FS));
}

function pick(page, id, group) {
	for (const g of group) page.element(g).checked = g === id;
	page.element(id).dispatch('change');
}

const page = createPage();
const VOICES = page.voiceCount();
page.dispatchWindow('keydown', { key: 'r' });
pick(page, freqId, ['freq-point', 'freq-dist']);
pick(page, volId, ['vol-dist', 'vol-const']);
pick(page, envId, ['env-dist', 'env-off']);
page.dispatchWindow('keydown', { key: ' ' });
page.tick(20, 0);

const framesWanted = Math.round(SECONDS / FRAME);
const timeline = [];
let time = 0;
for (let f = 0; f < framesWanted; f++) {
	time = page.tick(1, time);
	const snapshot = new Array(VOICES);
	for (let i = 0; i < VOICES; i++) {
		const voice = page.voice(i);
		snapshot[i] = {
			freq: voice.carrier.frequency.target,
			level: voice.level.gain.target,
			pan: voice.pan.pan.target,
			envBase: voice.envGain.gain.target,
			mod: voice.mod.gain.target,
			rate: voice.lfo.frequency.target,
		};
	}
	timeline.push(snapshot);
}

const total = Math.round(SECONDS * FS);
const left = new Float32Array(total);
const right = new Float32Array(total);

const aFreq = onePole(TAU.freq);
const aLevel = onePole(TAU.level);
const aPan = onePole(TAU.pan);
const aEnv = onePole(TAU.env);
const aRate = onePole(TAU.rate);

const voices = [];
for (let i = 0; i < VOICES; i++) {
	voices.push({
		phase: Math.random(),
		lfoPhase: Math.random(),
		freq: 220,
		level: 0,
		pan: 0,
		envBase: 1,
		mod: 0,
		rate: 4,
		filter: 0,
	});
}

for (let n = 0; n < total; n++) {
	const snapshot = timeline[Math.min(timeline.length - 1, Math.floor((n / FS) / FRAME))];
	let sumL = 0;
	let sumR = 0;
	for (let i = 0; i < VOICES; i++) {
		const target = snapshot[i];
		const v = voices[i];
		if (v.level < 1e-4 && target.level > 1e-4) {
			v.freq = target.freq;
			v.pan = target.pan;
			v.envBase = target.envBase;
			v.mod = target.mod;
			v.rate = target.rate;
		} else {
			v.freq += (target.freq - v.freq) * aFreq;
			v.pan += (target.pan - v.pan) * aPan;
			v.envBase += (target.envBase - v.envBase) * aEnv;
			v.mod += (target.mod - v.mod) * aEnv;
			v.rate += (target.rate - v.rate) * aRate;
		}
		v.level += (target.level - v.level) * aLevel;
		if (v.level < 1e-4) continue;

		v.phase += v.freq / FS;
		v.phase -= Math.floor(v.phase);
		v.lfoPhase += v.rate / FS;
		v.lfoPhase -= Math.floor(v.lfoPhase);

		const triangle = 4 * Math.abs(v.phase - 0.5) - 1;
		const cutoffHz = Math.max(90, Math.min(18000, v.freq * 4.5));
		const alphaLp = Math.min(0.95, (2 * Math.PI * cutoffHz) / FS);
		v.filter += (triangle - v.filter) * alphaLp;

		const env = v.envBase + v.mod * Math.sin(2 * Math.PI * v.lfoPhase);
		const sample = v.filter * env * v.level;
		const angle = (Math.max(-1, Math.min(1, v.pan)) + 1) * Math.PI * 0.25;
		sumL += sample * Math.cos(angle);
		sumR += sample * Math.sin(angle);
	}
	left[n] = Math.tanh(sumL * MASTER);
	right[n] = Math.tanh(sumR * MASTER);
}

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

let peak = 0;
let energy = 0;
let clipped = 0;
for (let n = 0; n < total; n++) {
	const a = Math.max(Math.abs(left[n]), Math.abs(right[n]));
	if (a > peak) peak = a;
	if (a >= 0.999) clipped++;
	energy += left[n] * left[n] + right[n] * right[n];
}

const win = Math.round(FS / 20);
const envTrack = [];
for (let start = 0; start + win < total; start += win) {
	let sum = 0;
	for (let n = start; n < start + win; n++) sum += left[n] * left[n] + right[n] * right[n];
	envTrack.push(Math.sqrt(sum / (win * 2)));
}
const silence = envTrack.filter(v => v < 0.005).length / envTrack.length;

console.log('preset      ' + LABEL);
console.log('wrote       ' + OUT + ' (' + SECONDS + ' s, ' + (data.length / 1e6).toFixed(1) + ' MB)');
console.log('peak        ' + peak.toFixed(3) + ', clipped samples ' + clipped);
console.log('rms         ' + Math.sqrt(energy / (total * 2)).toFixed(4));
console.log('silence     ' + (100 * silence).toFixed(0) + '% of 50 ms windows below -46 dBFS');

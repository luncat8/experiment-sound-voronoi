'use strict';
// Prints a scene URL/token or a readable params hash as GUI settings.
const Settings = require('../src/settings');

const FREQ = ['point id', 'distance (10k-10Hz)'];
const VOL = ['distance', 'constant'];
const ENV = ['off', 'distance (<20px cont, 30-0.1Hz)'];

function read(text) {
	const scene = Settings.fromUrl(text) || Settings.decode(text);
	if (scene) return { scene, params: Settings.paramsFromScene(scene) };
	const params = Settings.paramsFromUrl(text) || Settings.parseParams(text);
	return params ? { params } : null;
}

function label(list, mode) {
	return mode === undefined ? '?' : list[mode];
}

function steep(value) {
	return value === undefined ? 'steep ?' : 'steep ' + value;
}

function state(scene) {
	const parts = [];
	if (scene.flags[0] === 0) parts.push('paused');
	if (scene.flags[1] === 1) parts.push('muted');
	return parts.length ? parts.join(', ') : 'running, unmuted';
}

function describe(token) {
	const found = read(token);
	if (!found) return null;
	const params = found.params;
	const lines = [];
	if (found.scene) {
		const scene = found.scene;
		const probe = scene.probe;
		lines.push('map       ' + scene.size[0] + ' x ' + scene.size[1] + ', ' + scene.sites.length + ' points, probe ' +
			probe[0] + ',' + probe[1] + ' v ' + probe[2] + ',' + probe[3]);
	}
	lines.push('freq      ' + label(FREQ, params.freq) + ' · ' + steep(params.freqSteep));
	lines.push('volume    ' + label(VOL, params.vol) + ' · ' + steep(params.volSteep));
	lines.push('envelope  ' + label(ENV, params.env) + ' · ' + steep(params.envSteep));
	lines.push('N         ' + (params.n === undefined ? '?' : params.n));
	if (found.scene) lines.push('state     ' + state(found.scene));
	lines.push('params    ' + Settings.formatParams(params));
	return lines.join('\n');
}

const inputs = process.argv.slice(2);
if (!inputs.length) {
	console.error('usage: node experiments/decode-link.js <scene-url|scene-token|params-hash> ...');
	process.exitCode = 1;
} else {
	for (const input of inputs) {
		const text = input.trim();
		const output = describe(text);
		console.log(output || 'unreadable: ' + text);
		console.log('');
	}
}

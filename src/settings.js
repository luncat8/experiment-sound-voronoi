(function (root) {
	'use strict';

	const VERSION = 1;
	const MAX_POINTS = 400;
	const MAX_TOKEN_LENGTH = 120000;

	// One ordered table drives the readable hash, so link order stays stable.
	// labels are listed in scene-mode order: 0, 1. Only visible HUD controls belong
	// here; transport state and the field itself stay in the full scene link.
	const PARAMS = [
		{ key: 'freq', field: 'freq', labels: ['point', 'dist'] },
		{ key: 'freq-steep', field: 'freqSteep', min: 0, max: 100 },
		{ key: 'vol', field: 'vol', labels: ['dist', 'const'] },
		{ key: 'vol-steep', field: 'volSteep', min: 0, max: 100 },
		{ key: 'env', field: 'env', labels: ['off', 'dist'] },
		{ key: 'env-steep', field: 'envSteep', min: 0, max: 100 },
		{ key: 'n', field: 'n', min: 1, max: MAX_POINTS },
	];

	function inRange(value, min, max) {
		return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
	}

	function bits(values, length) {
		return Array.isArray(values) && values.length === length && values.every(v => v === 0 || v === 1);
	}

	function valid(scene) {
		if (!scene || scene.v !== VERSION || !Array.isArray(scene.size) || scene.size.length !== 2) return false;
		const w = scene.size[0];
		const h = scene.size[1];
		if (!inRange(w, 1, 100000) || !inRange(h, 1, 100000)) return false;
		if (!bits(scene.modes, 3) || !bits(scene.flags, 2)) return false;
		if (!Array.isArray(scene.steep) || scene.steep.length !== 3 || !scene.steep.every(v => Number.isInteger(v) && inRange(v, 0, 100))) return false;
		if (!Number.isInteger(scene.n) || !inRange(scene.n, 1, MAX_POINTS)) return false;
		if (!Array.isArray(scene.probe) || scene.probe.length !== 4) return false;
		if (!inRange(scene.probe[0], 0, w) || !inRange(scene.probe[1], 0, h)) return false;
		if (!inRange(scene.probe[2], -1000, 1000) || !inRange(scene.probe[3], -1000, 1000)) return false;
		if (!Array.isArray(scene.sites) || scene.sites.length > MAX_POINTS) return false;
		for (const point of scene.sites) {
			if (!Array.isArray(point) || point.length !== 4) return false;
			if (!inRange(point[0], 0, w) || !inRange(point[1], 0, h) || !inRange(point[2], 0.3, 5.8)) return false;
			if (!Number.isInteger(point[3]) || !inRange(point[3], 0, 23)) return false;
		}
		return true;
	}

	function encode(scene) {
		return root.btoa(JSON.stringify(scene)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	}

	function decode(token) {
		if (!token || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
		try {
			const scene = JSON.parse(root.atob(token.replace(/-/g, '+').replace(/_/g, '/')));
			return valid(scene) ? scene : null;
		} catch (error) {
			return null;
		}
	}

	function toUrl(scene, href) {
		const url = new root.URL(href);
		url.hash = 'scene=' + encode(scene);
		return url.href;
	}

	function fromUrl(href) {
		try {
			const url = new root.URL(href);
			return decode(new root.URLSearchParams(url.hash.slice(1)).get('scene'));
		} catch (error) {
			return null;
		}
	}

	/* ---- readable gui parameters ---- */

	function paramsFromScene(scene) {
		return {
			freq: scene.modes[0], freqSteep: scene.steep[0],
			vol: scene.modes[1], volSteep: scene.steep[1],
			env: scene.modes[2], envSteep: scene.steep[2],
			n: scene.n,
		};
	}

	function formatParams(params) {
		const pairs = [];
		for (const spec of PARAMS) {
			const value = params[spec.field];
			if (value === undefined) continue;
			pairs.push([spec.key, spec.labels ? spec.labels[value] : String(value)]);
		}
		return new root.URLSearchParams(pairs).toString();
	}

	// Any non-empty subset of known keys is a valid preset; unknown keys are rejected.
	function parseParams(text) {
		if (typeof text !== 'string' || !text || text.length > MAX_TOKEN_LENGTH) return null;
		const query = new root.URLSearchParams(text);
		const known = new Set(PARAMS.map(spec => spec.key));
		for (const key of query.keys()) if (!known.has(key)) return null;
		const params = {};
		let seen = 0;
		for (const spec of PARAMS) {
			const raw = query.get(spec.key);
			if (raw === null) continue;
			if (spec.labels) {
				const mode = spec.labels.indexOf(raw);
				if (mode < 0) return null;
				params[spec.field] = mode;
			} else {
				if (!/^\d+$/.test(raw)) return null;
				const value = Number(raw);
				if (value < spec.min || value > spec.max) return null;
				params[spec.field] = value;
			}
			seen++;
		}
		return seen > 0 ? params : null;
	}

	function toParamsUrl(params, href) {
		const url = new root.URL(href);
		url.hash = formatParams(params);
		return url.href;
	}

	function paramsFromUrl(href) {
		try {
			return parseParams(new root.URL(href).hash.slice(1));
		} catch (error) {
			return null;
		}
	}

	const PRESET_LINKS = [
		'freq=point&freq-steep=15&vol=dist&vol-steep=39&env=dist&env-steep=77&n=36',
		'freq=dist&freq-steep=54&vol=dist&vol-steep=53&env=dist&env-steep=6&n=36',
	];
	const PRESET_PARAMS = [
		{ freq: 0, freqSteep: 15, vol: 0, volSteep: 39, env: 1, envSteep: 77, n: 36 },
		{ freq: 1, freqSteep: 54, vol: 0, volSteep: 53, env: 1, envSteep: 6, n: 36 },
	];
	const PRESETS = PRESET_LINKS.slice();
	const PRESET_ITEMS = [
		{ label: 'link 1 (default)', link: PRESET_LINKS[0], params: PRESET_PARAMS[0] },
		{ label: 'link 2', link: PRESET_LINKS[1], params: PRESET_PARAMS[1] },
	];

	const api = {
		VERSION, encode, decode, toUrl, fromUrl,
		paramsFromScene, formatParams, parseParams, toParamsUrl, paramsFromUrl,
		PRESETS, PRESET_LINKS, PRESET_PARAMS, PRESET_ITEMS,
		presets: PRESETS, presetLinks: PRESET_LINKS, presetParams: PRESET_PARAMS, presetItems: PRESET_ITEMS,
		presetsLinks: PRESET_LINKS, preset_links: PRESET_LINKS,
	};
	root.GS = root.GS || {};
	root.GS.Settings = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

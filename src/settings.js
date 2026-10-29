(function (root) {
	'use strict';

	const VERSION = 1;
	const MAX_POINTS = 400;
	const MAX_TOKEN_LENGTH = 120000;

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

	const api = { VERSION, encode, decode, toUrl, fromUrl };
	root.GS = root.GS || {};
	root.GS.Settings = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

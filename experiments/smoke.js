'use strict';
// End-to-end checks for UI, gestures, Voronoi neighborhood voices, 3 radio groups,
// 3 steepness sliders, LR stereo direction, and voice-to-cell pinning.
const { createPage } = require('./stub-page');

let failures = 0;

function check(name, ok, detail) {
	if (ok) {
		console.log('  ok   ' + name);
		return;
	}
	failures++;
	console.log('  FAIL ' + name + (detail === undefined ? '' : '  [' + detail + ']'));
}

const page = createPage();
const { audio } = page;
const Tones = page.sandbox.GS.Tones;
const Sound = page.sandbox.GS.Sound;

function isFieldTone(hz) {
	for (let semitone = 0; semitone <= 23; semitone++) {
		if (Math.abs(hz - Tones.hz(semitone)) < 1e-6) return true;
	}
	return false;
}

function selectRadio(id, groupIds) {
	for (const gid of groupIds) page.element(gid).checked = gid === id;
	page.element(id).dispatch('change');
}

const FREQ_GROUP = ['freq-point', 'freq-dist'];
const VOL_GROUP = ['vol-dist', 'vol-const'];
const ENV_GROUP = ['env-dist', 'env-off'];

console.log('load');
check('scripts load and page initialises', audio.contexts === 0 && page.pointCount() >= 6, page.pointCount());
check('canvas sized for dpr', page.canvas().width === 2560 && page.canvas().height === 1440, page.canvas().width + 'x' + page.canvas().height);

console.log('frames');
let time = 0;
try {
	time = page.tick(60, time);
	check('60 frames run cleanly before audio gesture', true);
} catch (error) {
	check('60 frames run cleanly before audio gesture', false, error.message);
}
check('gate shown before first gesture', !page.element('gate').hasClass('hidden'));

console.log('gestures and N input');
try {
	page.dispatchWindow('keydown', { key: 'c' });
	check('C clears the field', page.pointCount() === 0, page.pointCount());

	page.canvas().dispatch('pointerdown', { clientX: 640, clientY: 360 });
	page.canvas().dispatch('pointerup', { clientX: 640, clientY: 360 });
	check('click adds a point', page.pointCount() === 1, page.pointCount());
	check('first gesture starts audio pool', audio.contexts === 1 && audio.panners.length === Sound.MAX_VOICES, audio.panners.length);
	check('gate hides after gesture', page.element('gate').hasClass('hidden'));

	page.canvas().dispatch('pointerdown', { clientX: 642, clientY: 362 });
	page.canvas().dispatch('pointerup', { clientX: 642, clientY: 362 });
	check('overlapping insert ignored', page.pointCount() === 1, page.pointCount());

	page.canvas().dispatch('pointerdown', { clientX: 300, clientY: 300 });
	page.canvas().dispatch('pointermove', { clientX: 340, clientY: 320 });
	page.canvas().dispatch('pointerup', { clientX: 420, clientY: 360 });
	check('drag launches probe instead of adding point', page.pointCount() === 1, page.pointCount());

	page.canvas().dispatch('pointerdown', { clientX: 640, clientY: 360 });
	page.canvas().dispatch('pointermove', { clientX: 700, clientY: 380 });
	page.canvas().dispatch('pointerup', { clientX: 700, clientY: 380 });
	check('dragging a point preserves count', page.pointCount() === 1, page.pointCount());

	page.canvas().dispatch('pointerdown', { button: 2, clientX: 700, clientY: 380 });
	check('right click removes point', page.pointCount() === 0, page.pointCount());

	const nInput = page.element('n-points');
	nInput.value = '30';
	nInput.dispatch('change');
	check('N input rebuilds exact point count', page.pointCount() === 30, page.pointCount());
	time = page.tick(30, time);
} catch (error) {
	check('gestures and N input', false, error.message + '\n' + error.stack);
}

console.log('voronoi neighborhood voices (nearest + all adjacent cells only)');
try {
	// Controlled 5-point field: center (640,360), left (440,360), right (840,360),
	// top (640,180), far-right-corner (1220,680) non-adjacent to center when blocked.
	page.dispatchWindow('keydown', { key: 'c' });
	const pts = [
		[640, 360],
		[420, 360],
		[860, 360],
		[640, 160],
		[640, 560],
		[1180, 360],
	];
	for (const [x, y] of pts) {
		page.canvas().dispatch('pointerdown', { clientX: x, clientY: y });
		page.canvas().dispatch('pointerup', { clientX: x, clientY: y });
	}
	check('6 controlled sites placed', page.pointCount() === 6, page.pointCount());

	// Start drag in empty space inside center cell at (595, 360) — outside hitSite
	// of (640, 360) — and move 7 px so aiming places probe at (595, 360).
	page.canvas().dispatch('pointerdown', { clientX: 595, clientY: 360 });
	page.canvas().dispatch('pointermove', { clientX: 602, clientY: 360 });
	page.canvas().dispatch('pointerup', { clientX: 602, clientY: 360 });
	page.dispatchWindow('keydown', { key: 'p' }); // freeze at (595, 360)
	time = page.tick(2, time);

	// Center cell (640,360) borders left(420), right(860), top(640,160), bottom(640,560),
	// while (1180,360) is behind right(860,360) and NOT adjacent to center.
	const active = page.activeVoices();
	check('nearest + all 4 adjacent cells sound (5 voices, non-adjacent silent)', active.length === 5, active.length);
	const slotsBefore = [0, 1, 2, 3, 4, 5, 6, 7].filter(i => page.voice(i).level.gain.target > 1e-4);

	const pans = active.map(v => v.pan.pan.target);
	check('left neighbor pans left and right neighbor pans right',
		Math.min.apply(null, pans) < -0.85 && Math.max.apply(null, pans) > 0.85,
		pans.map(p => p.toFixed(2)).join(', '));
	check('all LFOs are pure sine waves', active.every(v => v.lfo.type === 'sine'));
	check('unipolar sine invariant envGain + mod === 1 holds for all voices',
		active.every(v => Math.abs(v.envGain.gain.target + v.mod.gain.target - 1) < 1e-9));

	// Unpause so gravity pulls probe from (595,360) right through (640,360) (<20 px core).
	page.dispatchWindow('keydown', { key: 'p' });
	let sawCoreContinuous = false;
	let slotsPinned = true;
	for (let f = 0; f < 30; f++) {
		time = page.tick(1, time);
		const cur = page.activeVoices();
		if (cur.length === 5) {
			const curSlots = [0, 1, 2, 3, 4, 5, 6, 7].filter(i => page.voice(i).level.gain.target > 1e-4);
			if (curSlots.join(',') !== slotsBefore.join(',')) slotsPinned = false;
		}
		const mods = cur.map(v => v.mod.gain.target);
		if (mods.filter(m => m === 0).length === 1 && mods.filter(m => Math.abs(m - 0.5) < 1e-6).length === 4) {
			sawCoreContinuous = true;
			break;
		}
	}
	check('<20 px point becomes continuous (mod=0) while mid/far neighbors modulate (mod=0.5)', sawCoreContinuous);
	check('voice slots stay pinned to cells across intra-cell motion', slotsPinned);
} catch (error) {
	check('voronoi neighborhood voices', false, error.message + '\n' + error.stack);
}

console.log('three separate radio groups and steepness sliders');
try {
	page.element('n-points').value = '26';
	page.dispatchWindow('keydown', { key: 'r' });
	page.dispatchWindow('keydown', { key: 'p' }); // freeze probe to compare sliders deterministically
	time = page.tick(2, time);

	// 1. Frequency radio group: point id vs distance (10k..10 Hz) + steepness
	selectRadio('freq-point', FREQ_GROUP);
	time = page.tick(1, time);
	const pointFreqs = page.activeVoices().map(v => v.carrier.frequency.target);
	check('freq=point id: all active voices play pentatonic cell tones', pointFreqs.every(isFieldTone), JSON.stringify(pointFreqs));
	check('freq=point id: chord is polyphonic (distinct tones)', new Set(pointFreqs).size >= 3, JSON.stringify(pointFreqs));
	check('freq=point id dims freq steepness row', page.element('row-freq-steep').hasClass('disabled'));

	selectRadio('freq-dist', FREQ_GROUP);
	check('freq=distance enables freq steepness row', !page.element('row-freq-steep').hasClass('disabled'));
	page.element('freq-steep').value = '15';
	page.element('freq-steep').dispatch('input');
	time = page.tick(1, time);
	const gentleFreqs = page.activeVoices().map(v => v.carrier.frequency.target);

	page.element('freq-steep').value = '90';
	page.element('freq-steep').dispatch('input');
	time = page.tick(1, time);
	const steepFreqs = page.activeVoices().map(v => v.carrier.frequency.target);

	check('freq=distance stays within 10 Hz .. 10 kHz',
		gentleFreqs.every(f => f >= 10 && f <= 10000) && steepFreqs.every(f => f >= 10 && f <= 10000),
		JSON.stringify(steepFreqs));
	check('freq steepness slider drops frequency faster with distance',
		steepFreqs.reduce((a, b) => a + b, 0) < gentleFreqs.reduce((a, b) => a + b, 0));

	// 2. Volume radio group: distance vs const + steepness
	selectRadio('vol-dist', VOL_GROUP);
	page.element('vol-steep').value = '15';
	page.element('vol-steep').dispatch('input');
	time = page.tick(1, time);
	const gentleAmps = page.activeVoices().map(v => v.level.gain.target);

	page.element('vol-steep').value = '90';
	page.element('vol-steep').dispatch('input');
	time = page.tick(1, time);
	const steepAmps = page.activeVoices().map(v => v.level.gain.target);
	check('vol steepness slider makes volume fall off faster with distance',
		steepAmps.reduce((a, b) => a + b, 0) < gentleAmps.reduce((a, b) => a + b, 0));

	selectRadio('vol-const', VOL_GROUP);
	check('vol=const dims vol steepness row', page.element('row-vol-steep').hasClass('disabled'));
	time = page.tick(1, time);
	const constAmps = page.activeVoices().map(v => v.level.gain.target);
	const spread = Math.max.apply(null, constAmps) - Math.min.apply(null, constAmps);
	check('vol=const gives identical constant gain across all active cells', spread < 1e-9 && constAmps[0] > 0.05, JSON.stringify(constAmps));

	// 3. Envelope radio group: distance vs off + steepness
	selectRadio('env-dist', ENV_GROUP);
	page.element('env-steep').value = '15';
	page.element('env-steep').dispatch('input');
	time = page.tick(1, time);
	const gentleRates = page.activeVoices().map(v => v.lfo.frequency.target);

	page.element('env-steep').value = '90';
	page.element('env-steep').dispatch('input');
	time = page.tick(1, time);
	const steepRates = page.activeVoices().map(v => v.lfo.frequency.target);
	check('env=distance keeps sine rates within 0.1 .. 30 Hz',
		gentleRates.every(r => r >= 0.1 && r <= 30) && steepRates.every(r => r >= 0.1 && r <= 30));
	check('env steepness slider makes modulation rate fall faster with distance',
		steepRates.reduce((a, b) => a + b, 0) < gentleRates.reduce((a, b) => a + b, 0));

	selectRadio('env-off', ENV_GROUP);
	check('env=off dims env steepness row', page.element('row-env-steep').hasClass('disabled'));
	time = page.tick(1, time);
	check('env=off disables modulation on all voices (continuous)',
		page.activeVoices().every(v => v.mod.gain.target === 0 && v.envGain.gain.target === 1));

	// Restore defaults & flight check
	page.element('freq-steep').value = '50';
	page.element('freq-steep').dispatch('input');
	page.element('vol-steep').value = '50';
	page.element('vol-steep').dispatch('input');
	page.element('env-steep').value = '50';
	page.element('env-steep').dispatch('input');
	selectRadio('freq-dist', FREQ_GROUP);
	selectRadio('vol-dist', VOL_GROUP);
	selectRadio('env-dist', ENV_GROUP);
	page.dispatchWindow('keydown', { key: 'p' }); // resume
	page.dispatchWindow('keydown', { key: ' ' }); // kick probe

	const flightRates = [];
	const flightPans = [];
	const flightFreqs = [];
	for (let step = 0; step < 180; step++) {
		time = page.tick(2, time);
		for (const v of page.activeVoices()) {
			flightRates.push(v.lfo.frequency.target);
			flightPans.push(v.pan.pan.target);
			flightFreqs.push(v.carrier.frequency.target);
		}
	}
	check('flight pans reach both left and right ears',
		Math.min.apply(null, flightPans) < -0.5 && Math.max.apply(null, flightPans) > 0.5);
	check('flight sweeps wide frequency span',
		Math.max.apply(null, flightFreqs) > 1500 && Math.min.apply(null, flightFreqs) < 40,
		Math.min.apply(null, flightFreqs).toFixed(1) + ' .. ' + Math.max.apply(null, flightFreqs).toFixed(0));
	check('flight sweeps wide sine modulation span',
		Math.max.apply(null, flightRates) > 15 && Math.min.apply(null, flightRates) < 0.5,
		Math.min.apply(null, flightRates).toFixed(2) + ' .. ' + Math.max.apply(null, flightRates).toFixed(2));
} catch (error) {
	check('three separate radio groups and steepness sliders', false, error.message + '\n' + error.stack);
}

console.log('keyboard shortcuts, resize and teardown');
try {
	page.dispatchWindow('keydown', { key: '1' });
	check('key 1 toggles freq radio group', page.element('freq-point').checked === true);
	page.dispatchWindow('keydown', { key: '2' });
	check('key 2 toggles volume radio group', page.element('vol-const').checked === true);
	page.dispatchWindow('keydown', { key: '3' });
	check('key 3 toggles envelope radio group', page.element('env-off').checked === true);

	page.dispatchWindow('keydown', { key: 'm' });
	check('M mutes', page.element('status').textContent === 'muted');
	page.dispatchWindow('keydown', { key: 'm' });

	page.sandbox.innerWidth = 800;
	page.sandbox.innerHeight = 600;
	page.dispatchWindow('resize');
	time = page.tick(15, time);
	check('canvas resized cleanly', page.canvas().width === 1600 && page.canvas().height === 1200);

	page.dispatchWindow('keydown', { key: 'c' });
	time = page.tick(5, time);
	check('empty field mutes all voices', page.activeVoices().length === 0);
	check('frame loop stays alive', page.frames.length > 0);
} catch (error) {
	check('keyboard shortcuts, resize and teardown', false, error.message + '\n' + error.stack);
}

console.log(failures === 0 ? '\nall smoke checks passed' : '\n' + failures + ' smoke check(s) failed');
process.exitCode = failures === 0 ? 0 : 1;

const $ = id => document.getElementById(id);
const canvas = $('c');
const ctx = canvas.getContext('2d');
const W = 800, H = 500;
canvas.width = W; canvas.height = H;

let points = []; // {x,y}
let notes = []; // 0..4
let adj = []; // adjacency lists
let areas = [];
let masses = [];
let tris = [];
let cellImage = null;

const PITCHES = [261.63, 293.66, 329.63, 392.00, 440.00];
const NOTE_COLORS = [
	{r:220,g:60,b:60}, {r:60,g:180,b:60}, {r:60,g:100,b:220},
	{r:220,g:180,b:60}, {r:180,g:60,b:200}
];

function rand(a,b){ return a + Math.random()*(b-a); }

function rebuild(n){
	n = Math.max(3, Math.min(300, n|0));
	points = [];
	for (let i=0;i<n;i++){
		points.push({x: rand(30, W-30), y: rand(30, H-30)});
	}
	// triangulate
	tris = triangulate(points);
	// adjacency
	adj = Array.from({length:n}, ()=>new Set());
	for (const t of tris){
		for (let e=0;e<3;e++){
			const a=t[e], b=t[(e+1)%3];
			if (a<n && b<n){ adj[a].add(b); adj[b].add(a); }
		}
	}
	adj = adj.map(s=>[...s]);
	// color notes greedy
	notes = new Array(n).fill(0);
	const colored = new Array(n).fill(false);
	const order = points.map((p,i)=>i).sort((a,b)=>points[a].x-points[b].x);
	for (const i of order){
		const used = new Set();
		for (const nb of adj[i]) if (colored[nb]) used.add(notes[nb]);
		let c=0; while (used.has(c) && c<5) c++;
		if (c>=5) c = 0;
		notes[i]=c;
		colored[i]=true;
	}
	// cell image + areas
	rebuildCells();
	// masses from area
	masses = areas.map(a=> Math.max(1, a/1000));
	// reset probe? keep
	$('info').textContent = 'points '+n;
}

function inCircumcircle(ax,ay,bx,by,cx,cy,dx,dy){
	const ax_=ax-dx, ay_=ay-dy;
	const bx_=bx-dx, by_=by-dy;
	const cx_=cx-dx, cy_=cy-dy;
	return (ax_*ax_+ay_*ay_)*(bx_*cy_-cx_*by_)
		- (bx_*bx_+by_*by_)*(ax_*cy_-cx_*ay_)
		+ (cx_*cx_+cy_*cy_)*(ax_*by_-bx_*ay_) > 0;
}

function triangulate(pts){
	const n = pts.length;
	let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
	for (const p of pts){ if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; }
	const dx=maxX-minX, dy=maxY-minY;
	const dmax=Math.max(dx,dy,1);
	const midx=(minX+maxX)/2, midy=(minY+maxY)/2;
	const s0={x:midx-20*dmax, y:midy-dmax};
	const s1={x:midx+20*dmax, y:midy-dmax};
	const s2={x:midx, y:midy+20*dmax};
	const all = pts.concat([s0,s1,s2]);
	const superIdx=[n,n+1,n+2];
	let tris=[[n,n+1,n+2]];
	for (let i=0;i<n;i++){
		const p=pts[i];
		const bad=[];
		for (const t of tris){
			const a=all[t[0]], b=all[t[1]], c=all[t[2]];
			if (inCircumcircle(a.x,a.y,b.x,b.y,c.x,c.y,p.x,p.y)) bad.push(t);
		}
		const boundary=[];
		for (const t of bad){
			for (let e=0;e<3;e++){
				const ea=t[e], eb=t[(e+1)%3];
				let shared=false;
				for (const t2 of bad){
					if (t2===t) continue;
					if (hasEdge(t2,ea,eb)){ shared=true; break; }
				}
				if (!shared) boundary.push([ea,eb]);
			}
		}
		tris = tris.filter(t=>!bad.includes(t));
		for (const [a,b] of boundary) tris.push([a,b,i]);
	}
	tris = tris.filter(t=> !t.some(v=>superIdx.includes(v)));
	return tris;
}

function hasEdge(t,a,b){
	for (let e=0;e<3;e++){
		const x=t[e], y=t[(e+1)%3];
		if ((x===a&&y===b)||(x===b&&y===a)) return true;
	}
	return false;
}

function rebuildCells(){
	const data = new Uint8ClampedArray(W*H*4);
	const counts = new Array(points.length).fill(0);
	for (let y=0;y<H;y++){
		for (let x=0;x<W;x++){
			let best=-1, bestD=Infinity;
			for (let i=0;i<points.length;i++){
				const dx=x-points[i].x, dy=y-points[i].y, d=dx*dx+dy*dy;
				if (d<bestD){ bestD=d; best=i; }
			}
			counts[best]++;
			const col = NOTE_COLORS[notes[best]];
			const idx=(y*W+x)*4;
			data[idx]=col.r; data[idx+1]=col.g; data[idx+2]=col.b; data[idx+3]=200;
		}
	}
	cellImage = new ImageData(data, W, H);
	areas = counts;
}

// probe
const probe = {x:W/2, y:H/2, vx:0, vy:0, active:false};
let dragging=false, dragStart=null;

canvas.addEventListener('mousedown', e=>{
	const r=canvas.getBoundingClientRect();
	dragStart={x:e.clientX-r.left, y:e.clientY-r.top};
	dragging=true;
});
canvas.addEventListener('mousemove', e=>{
	if (!dragging) return;
	const r=canvas.getBoundingClientRect();
	const x=e.clientX-r.left, y=e.clientY-r.top;
	// preview
});
canvas.addEventListener('mouseup', e=>{
	if (!dragging) return;
	dragging=false;
	const r=canvas.getBoundingClientRect();
	const x=e.clientX-r.left, y=e.clientY-r.top;
	probe.x=dragStart.x; probe.y=dragStart.y;
	probe.vx=(dragStart.x-x)*0.05;
	probe.vy=(dragStart.y-y)*0.05;
	probe.active=true;
	ensureAudio();
});

function nearestPoint(x,y){
	let best=0, bestD=Infinity;
	for (let i=0;i<points.length;i++){
		const dx=x-points[i].x, dy=y-points[i].y, d=dx*dx+dy*dy;
		if (d<bestD){bestD=d;best=i;}
	}
	return best;
}
function dist(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.sqrt(dx*dx+dy*dy); }
function clamp(v,a,b){ return v<a?a:(v>b?b:v); }

// audio
let audioCtx=null, masterGain=null;
let mode=1;
let voices={};

function ensureAudio(){
	if (audioCtx) { audioCtx.resume(); return; }
	audioCtx = new (window.AudioContext||window.webkitAudioContext)();
	masterGain = audioCtx.createGain();
	masterGain.gain.value = 0.3;
	masterGain.connect(audioCtx.destination);
}

function sliderVal(){ return parseInt($('slider').value,10)/100; }

function startVoice(i){
	if (voices[i]) return;
	const osc = audioCtx.createOscillator();
	const gain = audioCtx.createGain();
	const panner = audioCtx.createStereoPanner();
	osc.connect(gain); gain.connect(panner); panner.connect(masterGain);
	let lfo=null, lfoGain=null;
	if (mode===2){
		lfo = audioCtx.createOscillator();
		lfoGain = audioCtx.createGain();
		lfo.connect(lfoGain);
		lfoGain.connect(gain.gain);
		lfo.start();
	}
	osc.start();
	voices[i]={osc,gain,panner,lfo,lfoGain};
}

function stopVoice(i){
	const v=voices[i]; if(!v) return;
	try{v.osc.stop();}catch(e){}
	if (v.lfo) try{v.lfo.stop();}catch(e){}
	delete voices[i];
}

function stopAllVoices(){ for (const id in voices) stopVoice(+id); }

function distToVol(d, s){
	// slider s 0..1 controls decay scale
	const scale = 50 + s*200;
	return 1/(1 + (d/scale));
}
function distToFreq(d, s){
	// map distance to freq 150..900
	const t = clamp(d / (200 + s*400), 0, 1);
	return 150 + (1-t)*750;
}
function distToRate(d){
	const t = clamp(d/400,0,1);
	return 0.1 + (1-t)*29.9;
}

function updateSound(){
	if (!audioCtx || !probe.active) return;
	// considered set
	const near = nearestPoint(probe.x, probe.y);
	const considered = new Set([near]);
	for (const nb of adj[near]) considered.add(nb);
	// stop removed
	for (const id in voices){
		if (!considered.has(+id)) stopVoice(+id);
	}
	// start new
	for (const id of considered){
		if (!voices[id]) startVoice(id);
	}
	const s = sliderVal();
	for (const id of considered){
		const v = voices[id];
		const p = points[id];
		const d = dist(probe, p);
		const pan = clamp((p.x - probe.x)/200, -1, 1);
		v.panner.pan.value = pan;
		if (mode===1){
			v.osc.frequency.value = PITCHES[notes[id]];
			v.gain.gain.value = distToVol(d, s);
		} else {
			v.osc.frequency.value = distToFreq(d, s);
			if (v.lfo) v.lfo.frequency.value = distToRate(d);
			v.gain.gain.value = 0.3;
			if (v.lfoGain) v.lfoGain.gain.value = 0.3;
		}
	}
}

// physics
const G = 2;
function stepPhysics(){
	if (!probe.active) return;
	let ax=0, ay=0;
	for (let i=0;i<points.length;i++){
		const dx = points[i].x - probe.x;
		const dy = points[i].y - probe.y;
		const r2 = dx*dx+dy*dy + 25;
		const r = Math.sqrt(r2);
		const factor = G * masses[i] / (r2 * r);
		ax += factor*dx;
		ay += factor*dy;
	}
	probe.vx += ax;
	probe.vy += ay;
	probe.x += probe.vx;
	probe.y += probe.vy;
	// damping
	probe.vx *= 0.995;
	probe.vy *= 0.995;
	// bounce
	if (probe.x < 0){ probe.x=0; probe.vx*=-0.6; }
	if (probe.x > W){ probe.x=W; probe.vx*=-0.6; }
	if (probe.y < 0){ probe.y=0; probe.vy*=-0.6; }
	if (probe.y > H){ probe.y=H; probe.vy*=-0.6; }
}

function render(){
	ctx.putImageData(cellImage, 0, 0);
	// points
	for (let i=0;i<points.length;i++){
		const p=points[i];
		ctx.fillStyle = 'rgb('+NOTE_COLORS[notes[i]].r+','+NOTE_COLORS[notes[i]].g+','+NOTE_COLORS[notes[i]].b+')';
		ctx.beginPath();
		ctx.arc(p.x,p.y, 4 + Math.sqrt(masses[i])/20, 0, Math.PI*2);
		ctx.fill();
		ctx.strokeStyle='#fff'; ctx.stroke();
	}
	// probe
	if (probe.active){
		ctx.fillStyle='#fff';
		ctx.beginPath();
		ctx.arc(probe.x,probe.y,6,0,Math.PI*2);
		ctx.fill();
	}
	if (dragging && dragStart){
		// nothing
	}
}

function loop(){
	stepPhysics();
	updateSound();
	render();
	requestAnimationFrame(loop);
}

// controls
$('rebuild').addEventListener('click', ()=>{ rebuild(parseInt($('n').value,10)); stopAllVoices(); });
document.querySelectorAll('input[name=mode]').forEach(r=>{
	r.addEventListener('change', ()=>{
		mode = parseInt(r.value,10);
		stopAllVoices();
	});
});
// initial
rebuild(parseInt($('n').value,10));
loop();

if (typeof module !== 'undefined') module.exports = { rebuild };

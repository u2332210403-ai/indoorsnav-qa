/* FILE NAME: src/App.jsx (FULL WORKING VITE REACT APP — CSV + JSON + PROXIMITY DIJKSTRA + VISITED-F0 STATE + ROUTE STEPS + __lastRoute) */
import React, { useEffect, useMemo, useRef, useState } from "react";

/* ===================== HELPERS ===================== */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function normKey(s){
  if(s==null) return "";
  return String(s)
    .replace(/^\uFEFF/,"")
    .replace(/^"|"$/g,"")
    .trim()
    .toLowerCase()
    .replace(/\s+/g,"_");
}
function toBool(v){
  if(v==null) return false;
  const s=String(v).trim().toLowerCase();
  return s==="true"||s==="1"||s==="yes"||s==="y";
}
function toNum(v){
  if(v==null) return NaN;
  let s=String(v).trim().replace(/^"|"$/g,"");
  if(s.includes(",") && !s.includes(".")) s=s.replace(",",".");
  const n=Number(s);
  return Number.isFinite(n)?n:NaN;
}
function parseCsvFlexible(text){
  const lines=text.replace(/\r/g,"").split("\n").filter(l=>l.trim().length);
  if(!lines.length) return [];
  const split=(line)=>{
    const out=[]; let cur=""; let q=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){ q=!q; cur+=ch; continue; }
      if(!q && (ch===";" || ch===",")){ out.push(cur); cur=""; continue; }
      cur+=ch;
    }
    out.push(cur);
    return out.map(s=>s.replace(/^\uFEFF/,"").replace(/^"|"$/g,"").trim());
  };
  const hdr=split(lines[0]).map(normKey);
  const rows=[];
  for(let i=1;i<lines.length;i++){
    const cols=split(lines[i]);
    if(cols.every(c=>c==="")) continue;
    const obj={};
    for(let j=0;j<hdr.length;j++) obj[hdr[j]]=cols[j]??"";
    rows.push(obj);
  }
  return rows;
}
function safeJsonParse(text){ return JSON.parse(text); }
function unwrapConnectionsJson(any){
  if(Array.isArray(any)) return any;
  if(any && typeof any==="object"){
    if(Array.isArray(any.connections)) return any.connections;
    if(Array.isArray(any.edges)) return any.edges;
    if(Array.isArray(any.links)) return any.links;
    if(any.graph && typeof any.graph==="object"){
      if(Array.isArray(any.graph.connections)) return any.graph.connections;
      if(Array.isArray(any.graph.edges)) return any.graph.edges;
      if(Array.isArray(any.graph.links)) return any.graph.links;
    }
    if(any.data && typeof any.data==="object"){
      if(Array.isArray(any.data.connections)) return any.data.connections;
      if(Array.isArray(any.data.edges)) return any.data.edges;
      if(Array.isArray(any.data.links)) return any.data.links;
    }
  }
  return null;
}
function detectFloorFromAnchorRow(row){
  const f = String(row.floor||row.FLOOR||row.Floor||"").trim();
  if(f) return f.toUpperCase();
  const id = String(row.anchor_id||row.ANCHOR_ID||row.id||row.ID||"").trim();
  const m = id.match(/_(B\d+|F\d+|L\d+)$/i);
  return m ? m[1].toUpperCase() : "UNK";
}
function normalizeConnObj(o){
  const from = String(o.from ?? o.FROM ?? o.From ?? "").trim();
  const to   = String(o.to   ?? o.TO   ?? o.To   ?? "").trim();
  if(!from || !to) return null;

  const biRaw = (o.bidirectional ?? o.BIDIRECTIONAL ?? o.BiDirectional ?? o.bi);
  const biStr = (biRaw==null) ? "" : String(biRaw).trim();
  const bidirectional = (biRaw==null || biStr==="") ? true : toBool(biRaw);

  return {
    from,
    to,
    mode: String(o.mode ?? o.MODE ?? "WALK").trim().toUpperCase(),
    bidirectional,
    wheelchair: toBool(o.wheelchair ?? o.WHEELCHAIR),
    stroller: toBool(o.stroller ?? o.STROLLER),
    luggage: toBool(o.luggage ?? o.LUGGAGE),
    created: String(o.created ?? o.CREATED ?? ""),
    status: String(o.status ?? o.STATUS ?? "ACTIVE").trim().toUpperCase()
  };
}
function loadAnchorsFromCsv(text){
  const rows=parseCsvFlexible(text);
  const out=[];
  for(const r of rows){
    const id = String(r.anchor_id||r.ANCHOR_ID||r.id||r.ID||"").trim();
    if(!id) continue;
    const x = toNum(r.x);
    const y = toNum(r.y);
    if(!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const floor = detectFloorFromAnchorRow(r);
    out.push({id,floor,x,y,raw:r});
  }
  return out;
}
function loadConnectionsFromJson(text){
  const parsed=safeJsonParse(text);
  const arr=unwrapConnectionsJson(parsed);
  if(!arr || !Array.isArray(arr)) throw new Error("Connections JSON not recognized. Expected array or {connections:[...]} / {edges:[...]} / {links:[...]}.");
  const out=[];
  for(const o of arr){
    const n=normalizeConnObj(o);
    if(n) out.push(n);
  }
  return out;
}
function idIsElv(id){ return /^ELV_/i.test(id); }
function idIsStr(id){ return /^STR_/i.test(id); }
function idIsRamp(id){ return /^RAMP_/i.test(id); }
function idIsGarageHub(id){ return /^NODE_PARKING_GARAGE_LVL_/i.test(id); }
function idIsCorr(id){ return /^COR_/i.test(id); }

/* ===================== APP ===================== */
export default function App(){
  const [anchors, setAnchors] = useState([]); // {id,floor,x,y}
  const [connections, setConnections] = useState([]); // normalized
  const anchorsById = useMemo(()=> new Map(anchors.map(a=>[a.id,a])), [anchors]);
  const [forceBidirectional, setForceBidirectional] = useState(true);

  const [needWheelchair, setNeedWheelchair] = useState(false);
  const [needStroller, setNeedStroller] = useState(false);
  const [needLuggage, setNeedLuggage] = useState(false);

  const [floor, setFloor] = useState("ALL");
  const [qaFloor, setQaFloor] = useState("ALL");

  const [startId, setStartId] = useState("");
  const [endId, setEndId] = useState("");

  const [route, setRoute] = useState(null); // array of ids
  const [focusedId, setFocusedId] = useState(null);

  const [status, setStatus] = useState("Ready: choose anchors CSV + connections JSON, then Load.");
  const [jsonSample, setJsonSample] = useState("(none)");

  /* ===================== PAN/ZOOM (viewBox) ===================== */
  const svgRef = useRef(null);
  const [viewBox, setViewBox] = useState({x:0,y:0,w:1000,h:600});
  const panRef = useRef({is:false, start:null});

  function resetView(){
    setViewBox({x:0,y:0,w:1000,h:600});
  }
  function clientToSvgPoint(evt){
    const svg=svgRef.current;
    if(!svg) return {x:0,y:0};
    const pt=svg.createSVGPoint();
    pt.x=evt.clientX; pt.y=evt.clientY;
    const ctm=svg.getScreenCTM();
    if(!ctm) return {x:0,y:0};
    const inv=ctm.inverse();
    const sp=pt.matrixTransform(inv);
    return {x:sp.x,y:sp.y};
  }

  /* ===================== GRAPH BUILD (adj + degrees) ===================== */
  const { adj, degrees, missingIdCount, visibleCount, graphNodeCount } = useMemo(()=>{
    const adj = new Map();
    const degrees = new Map();

    // initialize
    for(const a of anchors) adj.set(a.id, new Set());

    // optional accessibility filter
    const needAny = needWheelchair || needStroller || needLuggage;

    let missing = 0;
    for(const c of connections){
      const from=c.from, to=c.to;
      if(!anchorsById.has(from) || !anchorsById.has(to)) { missing++; continue; }

      // If user requires accessibility, only allow edges that support it.
      if(needAny){
        if(needWheelchair && !c.wheelchair) continue;
        if(needStroller && !c.stroller) continue;
        if(needLuggage && !c.luggage) continue;
      }

      if(!adj.has(from)) adj.set(from,new Set());
      adj.get(from).add(to);

      const makeBi = forceBidirectional || c.bidirectional;
      if(makeBi){
        if(!adj.has(to)) adj.set(to,new Set());
        adj.get(to).add(from);
      }
    }

    for(const [id,set] of adj.entries()){
      degrees.set(id, set.size);
    }

    const visibleCount = anchors.filter(a => floor==="ALL" ? true : a.floor===floor).length;
    const graphNodeCount = [...degrees.entries()].filter(([,d])=>d>0).length;

    return { adj, degrees, missingIdCount: missing, visibleCount, graphNodeCount };
  }, [anchors, connections, anchorsById, forceBidirectional, needWheelchair, needStroller, needLuggage, floor]);

  const allIds = useMemo(()=> [...anchorsById.keys()].sort((a,b)=>a.localeCompare(b)), [anchorsById]);
  const floors = useMemo(()=> {
    const fs=[...new Set(anchors.map(a=>a.floor))].sort((a,b)=>a.localeCompare(b));
    return ["ALL", ...fs];
  }, [anchors]);

  const qaFloors = floors;

  const orphans = useMemo(()=>{
    const out=[];
    for(const a of anchors){
      if(qaFloor!=="ALL" && a.floor!==qaFloor) continue;
      const d=degrees.get(a.id) ?? 0;
      if(d===0) out.push(a.id);
    }
    out.sort((a,b)=>a.localeCompare(b));
    return out;
  }, [anchors, degrees, qaFloor]);

  const deadEnds = useMemo(()=>{
    const out=[];
    for(const a of anchors){
      if(qaFloor!=="ALL" && a.floor!==qaFloor) continue;
      const d=degrees.get(a.id) ?? 0;
      if(d===1) out.push(a.id);
    }
    out.sort((a,b)=>a.localeCompare(b));
    return out;
  }, [anchors, degrees, qaFloor]);

  /* ===================== ROUTING (PROXIMITY DIJKSTRA + visitedF0 state) ===================== */
  function getFloor(id){
    return anchorsById.get(id)?.floor ?? "";
  }
  function distCost(aId, bId){
    const a=anchorsById.get(aId);
    const b=anchorsById.get(bId);
    if(!a || !b) return 1e9;
    // scale to something "meter-like" for consistent weighting
    const dx=(b.x-a.x)*1000;
    const dy=(b.y-a.y)*600;
    return Math.hypot(dx,dy);
  }

  // Tunables (keep distance dominant)
  const TUNE = useMemo(()=>({
    // elevator is OK if it is close; we only add a small penalty
    ELV_PENALTY: 10,
    GARAGE_HUB_PENALTY: 20,

    // prefer ramps/stairs slightly (small, distance still dominates)
    RAMP_BONUS: 5,
    STR_BONUS: 2,

    // "above ground asap" bias BEFORE touching F0
    DIRECT_TO_F0_BONUS: 80,      // subtract if next is F0
    VIA_CONNECTOR_TO_F0_BONUS: 40, // subtract if using vertical connector that lands in F0 (handled by checking next floor)
    B_TO_F1_PENALTY: 120,         // add if B* -> F1 before ever visiting F0
    B_TO_F2_PENALTY: 160
  }), []);

  function edgeExtraCost(curId, nxId, visitedF0){
    let extra = 0;

    if(idIsElv(curId) || idIsElv(nxId)) extra += TUNE.ELV_PENALTY;
    if(idIsGarageHub(curId) || idIsGarageHub(nxId)) extra += TUNE.GARAGE_HUB_PENALTY;

    if(idIsRamp(curId) || idIsRamp(nxId)) extra -= TUNE.RAMP_BONUS;
    if(idIsStr(curId) || idIsStr(nxId)) extra -= TUNE.STR_BONUS;

    // tiny corridor preference (optional)
    if(idIsCorr(nxId)) extra -= 1;

    // "above ground asap" only before visiting F0
    if(!visitedF0){
      const fCur=getFloor(curId);
      const fNx=getFloor(nxId);

      if(fNx === "F0") extra -= TUNE.DIRECT_TO_F0_BONUS;

      // penalize going from basement to F1/F2 before reaching F0
      if(/^B/i.test(fCur) && /^F1$/i.test(fNx)) extra += TUNE.B_TO_F1_PENALTY;
      if(/^B/i.test(fCur) && /^F2$/i.test(fNx)) extra += TUNE.B_TO_F2_PENALTY;

      // bonus if moving "toward" F0 via vertical connector landing at F0 (covered by fNx==="F0")
      // leaving hook here for future tuning
    }

    return extra;
  }

  function dijkstraProximityVisitedF0(start, end){
    if(!start || !end) return null;
    if(!adj.has(start) || !adj.has(end)) return null;
    if(start===end) return [start];

    // state is (id, visitedF0Flag)
    const startVF0 = (getFloor(start) === "F0");
    const startKey = `${start}::${startVF0 ? 1 : 0}`;

    const dist = new Map();
    const prev = new Map(); // key -> prevKey
    dist.set(startKey, 0);
    prev.set(startKey, null);

    // small priority queue (array)
    const pq = [{ key: startKey, id: start, vf0: startVF0, d: 0 }];

    function popMin(){
      let bi=0;
      for(let i=1;i<pq.length;i++){
        if(pq[i].d < pq[bi].d) bi=i;
      }
      return pq.splice(bi,1)[0];
    }

    while(pq.length){
      const cur = popMin();
      if((dist.get(cur.key) ?? Infinity) < cur.d) continue;

      if(cur.id === end){
        // reconstruct
        const pathIds=[];
        let k=cur.key;
        while(k!=null){
          const [idPart] = k.split("::");
          pathIds.push(idPart);
          k = prev.get(k);
        }
        pathIds.reverse();
        return pathIds;
      }

      const neigh = adj.get(cur.id);
      if(!neigh) continue;

      for(const nx of neigh){
        const nxVF0 = cur.vf0 || (getFloor(nx) === "F0");
        const nxKey = `${nx}::${nxVF0 ? 1 : 0}`;

        const base = distCost(cur.id, nx);
        const extra = edgeExtraCost(cur.id, nx, cur.vf0);
        const w = base + extra;

        const nd = cur.d + w;
        if(nd < (dist.get(nxKey) ?? Infinity)){
          dist.set(nxKey, nd);
          prev.set(nxKey, cur.key);
          pq.push({ key: nxKey, id: nx, vf0: nxVF0, d: nd });
        }
      }
    }
    return null;
  }

  function computeRoute(){
    const path = dijkstraProximityVisitedF0(startId, endId);
    setRoute(path);
  }

  /* expose to console */
  useEffect(()=>{
    window.__lastRoute = route ? route.slice() : null;
  }, [route]);

  /* ===================== FILE LOADERS ===================== */
  async function readTextFromFile(file){
    return new Promise((res, rej)=>{
      const fr = new FileReader();
      fr.onload = ()=> res(String(fr.result||""));
      fr.onerror = ()=> rej(fr.error||new Error("File read error"));
      fr.readAsText(file);
    });
  }

  async function onLoadFiles(anchorFile, connFile){
    if(!anchorFile) { alert("Pick anchors CSV first."); return; }
    if(!connFile) { alert("Pick connections JSON second."); return; }

    try{
      setStatus("Loading files…");
      const [tA, tC] = await Promise.all([readTextFromFile(anchorFile), readTextFromFile(connFile)]);

      const a = loadAnchorsFromCsv(tA);
      const c = loadConnectionsFromJson(tC);

      setAnchors(a);
      setConnections(c);

      setJsonSample(c[0] ? JSON.stringify(c[0]) : "(none)");

      setFloor("ALL");
      setQaFloor("ALL");
      setStartId("");
      setEndId("");
      setRoute(null);
      setFocusedId(null);
      resetView();

      setStatus("Loaded. Pick Start/End and route.");
    }catch(err){
      console.error(err);
      alert(String(err && err.message ? err.message : err));
      setStatus("Load failed. Check console.");
    }
  }

  /* ===================== UI HELPERS ===================== */
  function focusAnchor(id, center){
    setFocusedId(id);
    if(center){
      const a=anchorsById.get(id);
      if(a){
        const cx=a.x*1000, cy=a.y*600;
        setViewBox(vb=>({ ...vb, x: cx - vb.w/2, y: cy - vb.h/2 }));
      }
    }
  }

  /* ===================== SVG EVENTS ===================== */
  function onWheel(e){
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    const zoomFactor = delta>0 ? 1.12 : 0.89;
    const p=clientToSvgPoint(e);
    setViewBox(vb=>{
      const newW = clamp(vb.w*zoomFactor, 80, 5000);
      const newH = clamp(vb.h*zoomFactor, 50, 5000);
      const rx = (p.x - vb.x)/vb.w;
      const ry = (p.y - vb.y)/vb.h;
      const nx = p.x - rx*newW;
      const ny = p.y - ry*newH;
      return { x:nx, y:ny, w:newW, h:newH };
    });
  }
  function onMouseDown(e){
    const svg=svgRef.current;
    if(!svg) return;
    panRef.current.is=true;
    panRef.current.start={clientX:e.clientX, clientY:e.clientY, vb:{...viewBox}, w:svg.clientWidth, h:svg.clientHeight};
  }
  function onMouseUp(){
    panRef.current.is=false;
  }
  function onMouseMove(e){
    if(!panRef.current.is || !panRef.current.start) return;
    const st=panRef.current.start;
    const dx = (e.clientX - st.clientX) * (st.vb.w / st.w);
    const dy = (e.clientY - st.clientY) * (st.vb.h / st.h);
    setViewBox({ x: st.vb.x - dx, y: st.vb.y - dy, w: st.vb.w, h: st.vb.h });
  }

  /* ===================== RENDER DATA ===================== */
  const visibleAnchors = useMemo(()=>{
    return anchors.filter(a => floor==="ALL" ? true : a.floor===floor);
  }, [anchors, floor]);

  const routePoints = useMemo(()=>{
    if(!route || !route.length) return [];
    const pts=[];
    for(const id of route){
      const a=anchorsById.get(id);
      if(a) pts.push({x:a.x*1000,y:a.y*600});
    }
    return pts;
  }, [route, anchorsById]);

  useEffect(()=>{
    // Keep status line informative
    if(anchors.length===0){
      setStatus("Ready: choose anchors CSV + connections JSON, then Load.");
      return;
    }
    setStatus(
      `Loaded Anchors ${anchors.length} | Visible ${visibleCount} | Connections ${connections.length} | Graph nodes ${graphNodeCount} | Dropdown IDs ${allIds.length}\n`+
      `Mode: CSV (; or ,) + JSON (array or wrapped) | Force bidirectional: ${forceBidirectional}\n`+
      `Access filter: wheelchair=${needWheelchair} stroller=${needStroller} luggage=${needLuggage}\n`+
      `Missing IDs skipped: ${missingIdCount}\n`+
      `JSON sample: ${jsonSample}`
    );
  }, [anchors.length, visibleCount, connections.length, graphNodeCount, allIds.length, forceBidirectional, needWheelchair, needStroller, needLuggage, missingIdCount, jsonSample]);

  return (
    <div style={{padding:14, fontFamily:"system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"}}>
      <h1 style={{margin:"0 0 10px 0", fontSize:34}}>IndoorsNav — Anchor Viewer</h1>

      <div style={{display:"flex",flexWrap:"wrap",gap:10,alignItems:"center",margin:"10px 0"}}>
        <label style={{display:"flex",gap:6,alignItems:"center"}}>
          <span>Anchors CSV:</span>
          <input id="anchorsFile" type="file" accept=".csv,.txt"
            onChange={async (e)=>{
              // do nothing here; load button uses both files
            }}
          />
        </label>

        <label style={{display:"flex",gap:6,alignItems:"center"}}>
          <span>Connections JSON:</span>
          <input id="connsFile" type="file" accept=".json"
            onChange={async (e)=>{
              // do nothing here; load button uses both files
            }}
          />
        </label>

        <button
          onClick={async ()=>{
            const a = document.getElementById("anchorsFile")?.files?.[0];
            const c = document.getElementById("connsFile")?.files?.[0];
            await onLoadFiles(a,c);
          }}
          style={{background:"#111827",color:"#e6edf3",border:0,borderRadius:10,padding:"8px 12px",cursor:"pointer"}}
        >
          Load (CSV + JSON)
        </button>

        <button
          onClick={()=>{ setRoute(null); }}
          disabled={!route || route.length===0}
          style={{background:"#111827",color:"#e6edf3",border:0,borderRadius:10,padding:"8px 12px",cursor:"pointer",opacity:(!route||!route.length)?0.5:1}}
        >
          Clear Route
        </button>

        <button
          onClick={resetView}
          disabled={anchors.length===0}
          style={{background:"#111827",color:"#e6edf3",border:0,borderRadius:10,padding:"8px 12px",cursor:"pointer",opacity:(anchors.length===0)?0.5:1}}
        >
          Reset View
        </button>

        <label style={{display:"flex",gap:6,alignItems:"center"}}>
          Floor:
          <select value={floor} disabled={anchors.length===0} onChange={(e)=>setFloor(e.target.value)}>
            {floors.map(f=><option key={f} value={f}>{f}</option>)}
          </select>
        </label>

        <label style={{display:"flex",gap:6,alignItems:"center"}}>
          <input type="checkbox" checked={forceBidirectional} onChange={(e)=>setForceBidirectional(e.target.checked)} />
          Force bidirectional (QA)
        </label>
      </div>

      <div style={{display:"flex",flexWrap:"wrap",gap:12,alignItems:"center",margin:"10px 0"}}>
        <label style={{display:"flex",gap:6,alignItems:"center"}}>
          Start:
          <select value={startId} disabled={anchors.length===0} onChange={(e)=>setStartId(e.target.value)} style={{minWidth:280}}>
            <option value=""></option>
            {allIds.map(id=><option key={id} value={id}>{id}</option>)}
          </select>
        </label>

        <label style={{display:"flex",gap:6,alignItems:"center"}}>
          End:
          <select value={endId} disabled={anchors.length===0} onChange={(e)=>setEndId(e.target.value)} style={{minWidth:280}}>
            <option value=""></option>
            {allIds.map(id=><option key={id} value={id}>{id}</option>)}
          </select>
        </label>

        <button
          onClick={computeRoute}
          disabled={anchors.length===0 || !startId || !endId}
          style={{background:"#111827",color:"#e6edf3",border:0,borderRadius:10,padding:"8px 12px",cursor:"pointer",opacity:(anchors.length===0||!startId||!endId)?0.5:1}}
        >
          Route (Proximity + reach F0 ASAP)
        </button>
      </div>

      <div style={{display:"flex",flexWrap:"wrap",gap:14,alignItems:"center",margin:"6px 0"}}>
        <div style={{fontSize:13,color:"#6b7280",whiteSpace:"pre-wrap"}}>{status}</div>
      </div>

      <div style={{display:"flex",flexWrap:"wrap",gap:12,alignItems:"center",margin:"6px 0"}}>
        <b style={{fontSize:13}}>Access filter (only if needed):</b>
        <label style={{display:"flex",gap:6,alignItems:"center"}}>
          <input type="checkbox" checked={needWheelchair} onChange={(e)=>setNeedWheelchair(e.target.checked)} />
          wheelchair
        </label>
        <label style={{display:"flex",gap:6,alignItems:"center"}}>
          <input type="checkbox" checked={needStroller} onChange={(e)=>setNeedStroller(e.target.checked)} />
          stroller
        </label>
        <label style={{display:"flex",gap:6,alignItems:"center"}}>
          <input type="checkbox" checked={needLuggage} onChange={(e)=>setNeedLuggage(e.target.checked)} />
          luggage
        </label>
        <span style={{fontSize:13,color:"#6b7280"}}>Console: window.__lastRoute</span>
      </div>

      <div style={{border:"2px solid #dc2626",borderRadius:6,overflow:"hidden",width:"min(980px, 100%)",height:560,marginTop:10}}>
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          width="100%" height="100%"
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onMouseMove={onMouseMove}
          style={{background:"#fff",display:"block",userSelect:"none"}}
        >
          {/* anchors */}
          {visibleAnchors.map(a=>{
            const isS = startId && a.id===startId;
            const isE = endId && a.id===endId;
            const isF = focusedId && a.id===focusedId;
            let fill="#111", stroke="none";
            let r=3;
            if(isS){ fill="#16a34a"; stroke="#065f46"; r=5; }
            if(isE){ fill="#dc2626"; stroke="#7f1d1d"; r=5; }
            if(isF){ fill="#2563eb"; stroke="#1e3a8a"; r=5; }
            return (
              <circle
                key={a.id}
                cx={a.x*1000}
                cy={a.y*600}
                r={r}
                fill={fill}
                stroke={stroke==="none" ? "none" : stroke}
                strokeWidth={stroke==="none" ? 0 : 1}
                style={{cursor:"pointer"}}
                onClick={()=>{
                  focusAnchor(a.id,true);
                  if(!startId) setStartId(a.id);
                  else if(!endId) setEndId(a.id);
                }}
              />
            );
          })}

          {/* route polyline */}
          {routePoints.length>=2 && (
            <polyline
              fill="none"
              stroke="#000"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={routePoints.map(p=>`${p.x},${p.y}`).join(" ")}
            />
          )}

          {/* route node markers */}
          {route && route.length>0 && route.map((id, idx)=>{
            const a=anchorsById.get(id);
            if(!a) return null;
            const isS = idx===0;
            const isE = idx===route.length-1;
            const fill = isS ? "#16a34a" : (isE ? "#dc2626" : "#2563eb");
            const r = isS || isE ? 6 : 4;
            return (
              <circle key={`r-${id}-${idx}`} cx={a.x*1000} cy={a.y*600} r={r} fill={fill} stroke="#0b0f14" strokeWidth="1" />
            );
          })}
        </svg>
      </div>

      {/* QA Panel */}
      <div style={{marginTop:12,border:"1px solid #e5e7eb",borderRadius:12,padding:10,width:"min(980px, 100%)"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{fontWeight:700}}>QA Panel</div>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <label style={{display:"flex",gap:6,alignItems:"center"}}>
              QA Floor:
              <select value={qaFloor} disabled={anchors.length===0} onChange={(e)=>setQaFloor(e.target.value)}>
                {qaFloors.map(f=><option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <button
              onClick={()=>setFocusedId(null)}
              disabled={!focusedId}
              style={{background:"#111827",color:"#e6edf3",border:0,borderRadius:10,padding:"8px 12px",cursor:"pointer",opacity:(!focusedId)?0.5:1}}
            >
              Clear Focus
            </button>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:8}}>
          <div style={{border:"1px solid #e5e7eb",borderRadius:10,padding:8,minHeight:110}}>
            <div style={{fontWeight:700,marginBottom:6}}>Orphans (degree 0): {orphans.length}</div>
            <div style={{maxHeight:180,overflow:"auto",fontFamily:"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New",fontSize:12}}>
              {orphans.map(id=>(
                <a key={id} href="#" onClick={(e)=>{e.preventDefault(); focusAnchor(id,true);}} style={{display:"block",padding:"2px 6px",borderRadius:6,color:"#111",textDecoration:"none"}}>
                  {id}
                </a>
              ))}
            </div>
          </div>

          <div style={{border:"1px solid #e5e7eb",borderRadius:10,padding:8,minHeight:110}}>
            <div style={{fontWeight:700,marginBottom:6}}>Dead Ends (degree 1): {deadEnds.length}</div>
            <div style={{maxHeight:180,overflow:"auto",fontFamily:"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New",fontSize:12}}>
              {deadEnds.map(id=>(
                <a key={id} href="#" onClick={(e)=>{e.preventDefault(); focusAnchor(id,true);}} style={{display:"block",padding:"2px 6px",borderRadius:6,color:"#111",textDecoration:"none"}}>
                  {id}
                </a>
              ))}
            </div>
          </div>

          <div style={{gridColumn:"1 / span 2",border:"1px solid #e5e7eb",borderRadius:10,padding:8,minHeight:110}}>
            <div style={{fontWeight:700,marginBottom:6}}>
              Route Steps (used anchors): {route ? route.length : 0}{" "}
              <span style={{fontSize:12,color:"#6b7280"}}>(console: window.__lastRoute)</span>
            </div>
            <div style={{maxHeight:220,overflow:"auto",fontFamily:"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New",fontSize:12}}>
              {(route && route.length>0) ? route.map((id,i)=>(
                <a key={`${id}-${i}`} href="#" onClick={(e)=>{e.preventDefault(); focusAnchor(id,true);}} style={{display:"block",padding:"2px 6px",borderRadius:6,color:"#111",textDecoration:"none"}}>
                  {String(i+1).padStart(2,"0")}. {id} {anchorsById.get(id)?.floor ? `[${anchorsById.get(id).floor}]` : ""}
                </a>
              )) : <div style={{color:"#6b7280"}}>No route yet.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
/* FILE NAME: src/App.jsx (FULL WORKING VITE REACT APP — AUTOLOAD ONLY + TAP START/END + SAFE ROUTING + QA PANEL + __lastRoute) */
import React, { useEffect, useMemo, useRef, useState } from "react";

/* ===================== HELPERS ===================== */
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function normKey(s){
  if(s==null) return "";
  return String(s)
    .replace(/^\uFEFF/, "")
    .replace(/^"|"$/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}
function toBool(v){
  if(v==null) return false;
  const s = String(v).trim().toLowerCase();
  return s==="true" || s==="1" || s==="yes" || s==="y";
}
function toNum(v){
  if(v==null) return NaN;
  let s = String(v).trim().replace(/^"|"$/g, "");
  if(s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function parseCsvFlexible(text){
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim().length);
  if(!lines.length) return [];
  const split = (line)=>{
    const out = [];
    let cur = "";
    let q = false;
    for(let i=0;i<line.length;i++){
      const ch = line[i];
      if(ch === '"'){ q = !q; cur += ch; continue; }
      if(!q && (ch === ";" || ch === ",")){ out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map(s => s.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").trim());
  };
  const hdr = split(lines[0]).map(normKey);
  const rows = [];
  for(let i=1;i<lines.length;i++){
    const cols = split(lines[i]);
    if(cols.every(c => c === "")) continue;
    const obj = {};
    for(let j=0;j<hdr.length;j++) obj[hdr[j]] = cols[j] ?? "";
    rows.push(obj);
  }
  return rows;
}
function safeJsonParse(text){ return JSON.parse(text); }
function unwrapConnectionsJson(any){
  if(Array.isArray(any)) return any;
  if(any && typeof any === "object"){
    if(Array.isArray(any.connections)) return any.connections;
    if(Array.isArray(any.edges)) return any.edges;
    if(Array.isArray(any.links)) return any.links;
    if(any.graph && typeof any.graph === "object"){
      if(Array.isArray(any.graph.connections)) return any.graph.connections;
      if(Array.isArray(any.graph.edges)) return any.graph.edges;
      if(Array.isArray(any.graph.links)) return any.graph.links;
    }
    if(any.data && typeof any.data === "object"){
      if(Array.isArray(any.data.connections)) return any.data.connections;
      if(Array.isArray(any.data.edges)) return any.data.edges;
      if(Array.isArray(any.data.links)) return any.data.links;
    }
  }
  return null;
}
function detectFloorFromAnchorRow(row){
  const f = String(row.floor || row.FLOOR || row.Floor || "").trim();
  if(f) return f.toUpperCase();
  const id = String(row.anchor_id || row.ANCHOR_ID || row.id || row.ID || "").trim();
  const m = id.match(/_(B\d+|F\d+|L\d+)$/i);
  return m ? m[1].toUpperCase() : "UNK";
}
function normalizeConnObj(o){
  const from = String(o.from ?? o.FROM ?? o.From ?? "").trim();
  const to = String(o.to ?? o.TO ?? o.To ?? "").trim();
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
  const rows = parseCsvFlexible(text);
  const out = [];
  for(const r of rows){
    const id = String(r.anchor_id || r.ANCHOR_ID || r.id || r.ID || "").trim();
    if(!id) continue;
    const x = toNum(r.x);
    const y = toNum(r.y);
    if(!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const floor = detectFloorFromAnchorRow(r);
    out.push({ id, floor, x, y, raw:r });
  }
  return out;
}
function loadConnectionsFromJson(text){
  const parsed = safeJsonParse(text);
  const arr = unwrapConnectionsJson(parsed);
  if(!arr || !Array.isArray(arr)) throw new Error("Connections JSON not recognized. Expected array or {connections:[...]} / {edges:[...]} / {links:[...]}.");
  const out = [];
  for(const o of arr){
    const n = normalizeConnObj(o);
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
  const [anchors, setAnchors] = useState([]);
  const [connections, setConnections] = useState([]);
  const anchorsById = useMemo(()=> new Map(anchors.map(a=>[a.id,a])), [anchors]);

  const [forceBidirectional, setForceBidirectional] = useState(true);

  const [needWheelchair, setNeedWheelchair] = useState(false);
  const [needStroller, setNeedStroller] = useState(false);
  const [needLuggage, setNeedLuggage] = useState(false);

  const [floor, setFloor] = useState("ALL");
  const [qaFloor, setQaFloor] = useState("ALL");

  const [startId, setStartId] = useState("");
  const [endId, setEndId] = useState("");
  const [route, setRoute] = useState(null);
  const [focusedId, setFocusedId] = useState(null);

  const [status, setStatus] = useState("Ready: auto-loading default files...");
  const [jsonSample, setJsonSample] = useState("(none)");
  const [autoLoadTried, setAutoLoadTried] = useState(false);
  const [autoLoadOk, setAutoLoadOk] = useState(false);

  const [tapMode, setTapMode] = useState("start");
  const [lastTapAnchor, setLastTapAnchor] = useState("");

  /* ===================== PAN/ZOOM (viewBox) ===================== */
  const svgRef = useRef(null);
  const [viewBox, setViewBox] = useState({ x:0, y:0, w:1000, h:600 });
  const panRef = useRef({ is:false, start:null });

  function resetView(){
    setViewBox({ x:0, y:0, w:1000, h:600 });
  }
  function clientToSvgPoint(evt){
    const svg = svgRef.current;
    if(!svg) return {x:0,y:0};
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    if(!ctm) return {x:0,y:0};
    const inv = ctm.inverse();
    const sp = pt.matrixTransform(inv);
    return { x:sp.x, y:sp.y };
  }

  /* ===================== GRAPH BUILD ===================== */
  const { adj, degrees, missingIdCount, visibleCount, graphNodeCount } = useMemo(()=>{
    const adj = new Map();
    const degrees = new Map();

    for(const a of anchors) adj.set(a.id, new Set());

    const needAny = needWheelchair || needStroller || needLuggage;
    let missing = 0;

    for(const c of connections){
      const from = c.from;
      const to = c.to;
      if(!anchorsById.has(from) || !anchorsById.has(to)){ missing++; continue; }

      if(needAny){
        if(needWheelchair && !c.wheelchair) continue;
        if(needStroller && !c.stroller) continue;
        if(needLuggage && !c.luggage) continue;
      }

      if(!adj.has(from)) adj.set(from, new Set());
      adj.get(from).add(to);

      const makeBi = forceBidirectional || c.bidirectional;
      if(makeBi){
        if(!adj.has(to)) adj.set(to, new Set());
        adj.get(to).add(from);
      }
    }

    for(const [id, set] of adj.entries()) degrees.set(id, set.size);

    const visibleCount = anchors.filter(a => floor==="ALL" ? true : a.floor===floor).length;
    const graphNodeCount = [...degrees.entries()].filter(([,d]) => d > 0).length;

    return { adj, degrees, missingIdCount:missing, visibleCount, graphNodeCount };
  }, [anchors, connections, anchorsById, forceBidirectional, needWheelchair, needStroller, needLuggage, floor]);

  const floors = useMemo(()=>{
    const fs = [...new Set(anchors.map(a=>a.floor))].sort((a,b)=>a.localeCompare(b));
    return ["ALL", ...fs];
  }, [anchors]);

  const orphans = useMemo(()=>{
    const out = [];
    for(const a of anchors){
      if(qaFloor!=="ALL" && a.floor!==qaFloor) continue;
      const d = degrees.get(a.id) ?? 0;
      if(d===0) out.push(a.id);
    }
    out.sort((a,b)=>a.localeCompare(b));
    return out;
  }, [anchors, degrees, qaFloor]);

  const deadEnds = useMemo(()=>{
    const out = [];
    for(const a of anchors){
      if(qaFloor!=="ALL" && a.floor!==qaFloor) continue;
      const d = degrees.get(a.id) ?? 0;
      if(d===1) out.push(a.id);
    }
    out.sort((a,b)=>a.localeCompare(b));
    return out;
  }, [anchors, degrees, qaFloor]);

  /* ===================== ROUTING ===================== */
  function getFloor(id){
    return anchorsById.get(id)?.floor ?? "";
  }
  function distCost(aId, bId){
    const a = anchorsById.get(aId);
    const b = anchorsById.get(bId);
    if(!a || !b) return 1e9;
    const dx = (b.x - a.x) * 1000;
    const dy = (b.y - a.y) * 600;
    return Math.hypot(dx, dy);
  }

  const TUNE = useMemo(()=>({
    ELV_PENALTY: 10,
    GARAGE_HUB_PENALTY: 20,
    RAMP_BONUS: 5,
    STR_BONUS: 2,
    DIRECT_TO_F0_BONUS: 80,
    B_TO_F1_PENALTY: 120,
    B_TO_F2_PENALTY: 160
  }), []);

  function edgeExtraCost(curId, nxId, visitedF0){
    let extra = 0;

    if(idIsElv(curId) || idIsElv(nxId)) extra += TUNE.ELV_PENALTY;
    if(idIsGarageHub(curId) || idIsGarageHub(nxId)) extra += TUNE.GARAGE_HUB_PENALTY;
    if(idIsRamp(curId) || idIsRamp(nxId)) extra -= TUNE.RAMP_BONUS;
    if(idIsStr(curId) || idIsStr(nxId)) extra -= TUNE.STR_BONUS;
    if(idIsCorr(nxId)) extra -= 1;

    if(!visitedF0){
      const fCur = getFloor(curId);
      const fNx = getFloor(nxId);
      if(fNx === "F0") extra -= TUNE.DIRECT_TO_F0_BONUS;
      if(/^B/i.test(fCur) && /^F1$/i.test(fNx)) extra += TUNE.B_TO_F1_PENALTY;
      if(/^B/i.test(fCur) && /^F2$/i.test(fNx)) extra += TUNE.B_TO_F2_PENALTY;
    }

    return extra;
  }

  function dijkstraProximityVisitedF0(start, end){
    if(!start || !end) return null;
    if(!adj.has(start) || !adj.has(end)) return null;
    if(start===end) return [start];

    const startVF0 = (getFloor(start) === "F0");
    const startKey = `${start}::${startVF0 ? 1 : 0}`;

    const dist = new Map();
    const prev = new Map();
    const seen = new Set();

    dist.set(startKey, 0);
    prev.set(startKey, null);

    const pq = [{ key:startKey, id:start, vf0:startVF0, d:0 }];

    function popMin(){
      let bi = 0;
      for(let i=1;i<pq.length;i++){
        if(pq[i].d < pq[bi].d) bi = i;
      }
      return pq.splice(bi, 1)[0];
    }

    let expansions = 0;
    const MAX_EXPANSIONS = 20000;

    while(pq.length){
      const cur = popMin();
      if(seen.has(cur.key)) continue;
      seen.add(cur.key);

      if((dist.get(cur.key) ?? Infinity) < cur.d) continue;

      expansions++;
      if(expansions > MAX_EXPANSIONS){
        console.warn("Route aborted: too many expansions", { start, end, expansions });
        return null;
      }

      if(cur.id === end){
        const pathIds = [];
        let k = cur.key;
        while(k != null){
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
          pq.push({ key:nxKey, id:nx, vf0:nxVF0, d:nd });
        }
      }
    }

    return null;
  }

  function computeRoute(customStart = startId, customEnd = endId){
    setStatus(`Routing from ${customStart || "(none)"} to ${customEnd || "(none)"}...`);
    const path = dijkstraProximityVisitedF0(customStart, customEnd);
    setRoute(path);
    window.__lastRoute = path ? path.slice() : null;

    if(path && path.length){
      setStatus(`Route found: ${path.length} steps.\nStart: ${customStart}\nEnd: ${customEnd}`);
    }else{
      setStatus(`No route found between ${customStart} and ${customEnd}. Check disconnected graph, missing links, or basement/F0 connectors.`);
    }
  }

  useEffect(()=>{
    window.__lastRoute = route ? route.slice() : null;
  }, [route]);

  /* ===================== DEFAULT AUTOLOAD ===================== */
  function applyLoadedData(a, c, sourceLabel){
    setAnchors(a);
    setConnections(c);
    setJsonSample(c[0] ? JSON.stringify(c[0]) : "(none)");
    setFloor("ALL");
    setQaFloor("ALL");
    setStartId("");
    setEndId("");
    setRoute(null);
    setFocusedId(null);
    setTapMode("start");
    setLastTapAnchor("");
    resetView();
    setStatus(`Loaded from ${sourceLabel}. Tap map for Start, then tap map for End.`);
  }

  async function autoLoadDefaultData(){
    try{
      setStatus("Auto-loading default files...");

      const anchorsRes = await fetch("/data/la_zenia_L0_v1_anchors.csv", { cache:"no-store" });
      if(!anchorsRes.ok) throw new Error(`Default anchors CSV not found: ${anchorsRes.status}`);

      const connectionsRes = await fetch("/data/la_zenia_L0_v1.json", { cache:"no-store" });
      if(!connectionsRes.ok) throw new Error(`Default connections JSON not found: ${connectionsRes.status}`);

      const anchorsText = await anchorsRes.text();
      const connectionsText = await connectionsRes.text();

      const a = loadAnchorsFromCsv(anchorsText);
      const c = loadConnectionsFromJson(connectionsText);

      applyLoadedData(a, c, "default /data files");
      setAutoLoadOk(true);
    }catch(err){
      console.error("Auto-load failed:", err);
      setStatus("Auto-load failed.");
      setAutoLoadOk(false);
    }finally{
      setAutoLoadTried(true);
    }
  }

  useEffect(()=>{
    autoLoadDefaultData();
  }, []);

  /* ===================== INTERACTION ===================== */
  function focusAnchor(id, center){
    setFocusedId(id);
    if(center){
      const a = anchorsById.get(id);
      if(a){
        const cx = a.x * 1000;
        const cy = a.y * 600;
        setViewBox(vb => ({ ...vb, x:cx - vb.w/2, y:cy - vb.h/2 }));
      }
    }
  }

  const visibleAnchors = useMemo(()=>{
    return anchors.filter(a => floor==="ALL" ? true : a.floor===floor);
  }, [anchors, floor]);

  function findNearestVisibleAnchorAtSvgPoint(px, py){
    if(!visibleAnchors.length) return null;
    let best = null;
    let bestD = Infinity;

    for(const a of visibleAnchors){
      const ax = a.x * 1000;
      const ay = a.y * 600;
      const d = Math.hypot(ax - px, ay - py);
      if(d < bestD){
        bestD = d;
        best = a;
      }
    }

    const snapLimit = Math.max(12, Math.min(viewBox.w, viewBox.h) * 0.04);
    if(best && bestD <= snapLimit) return best;
    return best;
  }

  function handleAnchorTap(id){
    if(!id) return;
    setFocusedId(id);
    setLastTapAnchor(id);

    if(!startId){
      setStartId(id);
      setTapMode("end");
      setRoute(null);
      setStatus(`Start set: ${id}. Tap another anchor for End.`);
      return;
    }

    if(!endId){
      if(id === startId){
        setStatus(`Start already set to ${id}. Tap a different anchor for End.`);
        return;
      }
      setEndId(id);
      setTapMode("start");
      setStatus(`End set: ${id}. Computing route...`);
      setTimeout(()=>computeRoute(startId, id), 0);
      return;
    }

    if(tapMode === "start"){
      setStartId(id);
      setEndId("");
      setRoute(null);
      setTapMode("end");
      setStatus(`Start reset to ${id}. Tap another anchor for End.`);
    }else{
      if(id === startId){
        setStatus(`End cannot be same as Start. Tap a different anchor.`);
        return;
      }
      setEndId(id);
      setTapMode("start");
      setStatus(`End set: ${id}. Computing route...`);
      setTimeout(()=>computeRoute(startId, id), 0);
    }
  }

  function onSvgPointerDown(e){
    if(e.target && e.target.dataset && e.target.dataset.anchor === "1") return;
    const svg = svgRef.current;
    if(!svg) return;
    panRef.current.is = true;
    panRef.current.start = {
      clientX:e.clientX,
      clientY:e.clientY,
      vb:{...viewBox},
      w:svg.clientWidth,
      h:svg.clientHeight,
      moved:false
    };
  }

  function onSvgPointerMove(e){
    if(!panRef.current.is || !panRef.current.start) return;
    const st = panRef.current.start;
    const dxPx = e.clientX - st.clientX;
    const dyPx = e.clientY - st.clientY;
    if(Math.abs(dxPx) > 4 || Math.abs(dyPx) > 4) panRef.current.start.moved = true;

    const dx = dxPx * (st.vb.w / st.w);
    const dy = dyPx * (st.vb.h / st.h);
    setViewBox({ x:st.vb.x - dx, y:st.vb.y - dy, w:st.vb.w, h:st.vb.h });
  }

  function onSvgPointerUp(e){
    const st = panRef.current.start;
    const wasPanning = panRef.current.is;
    panRef.current.is = false;
    panRef.current.start = null;
    if(!wasPanning || !st) return;
    if(st.moved) return;

    const p = clientToSvgPoint(e);
    const nearest = findNearestVisibleAnchorAtSvgPoint(p.x, p.y);
    if(nearest) handleAnchorTap(nearest.id);
  }

  function onWheel(e){
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    const zoomFactor = delta > 0 ? 1.12 : 0.89;
    const p = clientToSvgPoint(e);
    setViewBox(vb=>{
      const newW = clamp(vb.w * zoomFactor, 80, 5000);
      const newH = clamp(vb.h * zoomFactor, 50, 5000);
      const rx = (p.x - vb.x) / vb.w;
      const ry = (p.y - vb.y) / vb.h;
      const nx = p.x - rx * newW;
      const ny = p.y - ry * newH;
      return { x:nx, y:ny, w:newW, h:newH };
    });
  }

  function clearRouteOnly(){
    setRoute(null);
    setEndId("");
    setTapMode("end");
    setStatus(startId ? `Route cleared. Start remains ${startId}. Tap anchor for End.` : "Route cleared. Tap anchor for Start.");
  }

  function clearSelection(){
    setStartId("");
    setEndId("");
    setRoute(null);
    setFocusedId(null);
    setTapMode("start");
    setLastTapAnchor("");
    setStatus("Selection cleared. Tap anchor for Start.");
  }

  /* ===================== RENDER DATA ===================== */
  const routePoints = useMemo(()=>{
    if(!route || !route.length) return [];
    const pts = [];
    for(const id of route){
      const a = anchorsById.get(id);
      if(a) pts.push({ x:a.x*1000, y:a.y*600 });
    }
    return pts;
  }, [route, anchorsById]);

  useEffect(()=>{
    if(anchors.length===0){
      if(!autoLoadTried) setStatus("Ready: auto-loading default files...");
      else if(!autoLoadOk) setStatus("Auto-load failed.");
      return;
    }
    if(route && route.length) return;
    setStatus(
      `Loaded Anchors ${anchors.length} | Visible ${visibleCount} | Connections ${connections.length} | Graph nodes ${graphNodeCount} | Auto-load ok: ${autoLoadOk}\n` +
      `Mode: CSV (; or ,) + JSON (array or wrapped) | Force bidirectional: ${forceBidirectional}\n` +
      `Access filter: wheelchair=${needWheelchair} stroller=${needStroller} luggage=${needLuggage}\n` +
      `Missing IDs skipped: ${missingIdCount}\n` +
      `Tap mode: ${tapMode} | Start: ${startId || "(none)"} | End: ${endId || "(none)"} | Last tap: ${lastTapAnchor || "(none)"}\n` +
      `JSON sample: ${jsonSample}`
    );
  }, [anchors.length, visibleCount, connections.length, graphNodeCount, autoLoadOk, forceBidirectional, needWheelchair, needStroller, needLuggage, missingIdCount, tapMode, startId, endId, lastTapAnchor, jsonSample, route]);

  return (
    <div style={{padding:14,fontFamily:"system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"}}>
      <h1 style={{margin:"0 0 10px 0",fontSize:34}}>IndoorsNav — Anchor Viewer</h1>

      <div style={{display:"flex",flexWrap:"wrap",gap:10,alignItems:"center",margin:"10px 0"}}>
        <button
          onClick={resetView}
          disabled={anchors.length===0}
          style={{background:"#111827",color:"#e6edf3",border:0,borderRadius:10,padding:"8px 12px",cursor:"pointer",opacity:(anchors.length===0)?0.5:1}}
        >
          Reset View
        </button>

        <button
          onClick={clearRouteOnly}
          disabled={!route || route.length===0}
          style={{background:"#111827",color:"#e6edf3",border:0,borderRadius:10,padding:"8px 12px",cursor:"pointer",opacity:(!route||!route.length)?0.5:1}}
        >
          Clear Route
        </button>

        <button
          onClick={clearSelection}
          disabled={anchors.length===0}
          style={{background:"#111827",color:"#e6edf3",border:0,borderRadius:10,padding:"8px 12px",cursor:"pointer",opacity:(anchors.length===0)?0.5:1}}
        >
          Clear Selection
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

      <div style={{display:"flex",flexWrap:"wrap",gap:14,alignItems:"center",margin:"6px 0"}}>
        <div style={{fontSize:13,color:"#6b7280",whiteSpace:"pre-wrap"}}>{status}</div>
      </div>

      <div style={{display:"flex",flexWrap:"wrap",gap:12,alignItems:"center",margin:"6px 0"}}>
        <b style={{fontSize:13}}>Tap workflow:</b>
        <span style={{fontSize:13,color:"#111"}}>Start: <b>{startId || "-"}</b></span>
        <span style={{fontSize:13,color:"#111"}}>End: <b>{endId || "-"}</b></span>
        <span style={{fontSize:13,color:"#111"}}>Next tap sets: <b>{tapMode.toUpperCase()}</b></span>
        <span style={{fontSize:13,color:"#6b7280"}}>Console: window.__lastRoute</span>
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
      </div>

      <div style={{border:"2px solid #dc2626",borderRadius:6,overflow:"hidden",width:"min(980px, 100%)",height:560,marginTop:10,touchAction:"none"}}>
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          width="100%"
          height="100%"
          onWheel={onWheel}
          onPointerDown={onSvgPointerDown}
          onPointerUp={onSvgPointerUp}
          onPointerMove={onSvgPointerMove}
          style={{background:"#fff",display:"block",userSelect:"none",touchAction:"none"}}
        >
          {visibleAnchors.map(a=>{
            const isS = startId && a.id===startId;
            const isE = endId && a.id===endId;
            const isF = focusedId && a.id===focusedId;

            let fill = "#111";
            let stroke = "none";
            let r = 3;

            if(isS){ fill="#16a34a"; stroke="#065f46"; r=6; }
            if(isE){ fill="#dc2626"; stroke="#7f1d1d"; r=6; }
            if(isF && !isS && !isE){ fill="#2563eb"; stroke="#1e3a8a"; r=5; }

            return (
              <circle
                key={a.id}
                data-anchor="1"
                cx={a.x*1000}
                cy={a.y*600}
                r={r}
                fill={fill}
                stroke={stroke==="none" ? "none" : stroke}
                strokeWidth={stroke==="none" ? 0 : 1}
                style={{cursor:"pointer"}}
                onPointerUp={(e)=>{
                  e.stopPropagation();
                  handleAnchorTap(a.id);
                }}
              />
            );
          })}

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

          {route && route.length>0 && route.map((id, idx)=>{
            const a = anchorsById.get(id);
            if(!a) return null;
            const isS = idx===0;
            const isE = idx===route.length-1;
            const fill = isS ? "#16a34a" : (isE ? "#dc2626" : "#2563eb");
            const r = isS || isE ? 6 : 4;
            return (
              <circle
                key={`r-${id}-${idx}`}
                cx={a.x*1000}
                cy={a.y*600}
                r={r}
                fill={fill}
                stroke="#0b0f14"
                strokeWidth="1"
              />
            );
          })}
        </svg>
      </div>

      <div style={{marginTop:12,border:"1px solid #e5e7eb",borderRadius:12,padding:10,width:"min(980px, 100%)"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{fontWeight:700}}>QA Panel</div>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <label style={{display:"flex",gap:6,alignItems:"center"}}>
              QA Floor:
              <select value={qaFloor} disabled={anchors.length===0} onChange={(e)=>setQaFloor(e.target.value)}>
                {floors.map(f=><option key={f} value={f}>{f}</option>)}
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
              Route Steps (used anchors): {route ? route.length : 0} <span style={{fontSize:12,color:"#6b7280"}}>(console: window.__lastRoute)</span>
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
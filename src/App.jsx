import { useEffect, useMemo, useRef, useState } from "react";

function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function clamp01(v){return clamp(v,0,1);}
function toNum(v){
  if(v==null) return NaN;
  let s=String(v).trim().replace(/^\uFEFF/,"").replace(/^"|"$/g,"");
  if(!s) return NaN;
  if(s.includes(",") && !s.includes(".")) s=s.replace(",",".");
  const n=Number(s);
  return Number.isFinite(n)?n:NaN;
}
function normKey(s){
  return String(s??"")
    .replace(/^\uFEFF/,"")
    .replace(/^"|"$/g,"")
    .trim()
    .toLowerCase()
    .replace(/\s+/g,"_")
    .replace(/[^a-z0-9_]/g,"");
}
function firstOf(obj, keys){
  for(const k of keys){
    if(obj[k] != null && String(obj[k]).trim() !== "") return obj[k];
  }
  return "";
}
function splitSmart(line){
  const out=[]; let cur=""; let q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch === '"'){ q=!q; cur+=ch; continue; }
    if((ch === ";" || ch === ",") && !q){ out.push(cur); cur=""; continue; }
    cur+=ch;
  }
  out.push(cur);
  return out.map(v=>String(v??"").trim().replace(/^"|"$/g,""));
}
function parseDelimited(text){
  const lines=String(text||"").replace(/\r/g,"").split("\n").filter(x=>x.trim()!=="");
  if(!lines.length) return [];
  const header=splitSmart(lines[0]).map(normKey);
  const rows=[];
  for(let i=1;i<lines.length;i++){
    const parts=splitSmart(lines[i]);
    const obj={};
    for(let j=0;j<header.length;j++) obj[header[j]]=parts[j] ?? "";
    rows.push(obj);
  }
  return rows;
}
function safeJsonParse(t){
  try{return JSON.parse(t);}catch{return null;}
}
function flattenMaybeWrappedJson(j){
  if(Array.isArray(j)) return j;
  if(j && Array.isArray(j.items)) return j.items;
  if(j && Array.isArray(j.rows)) return j.rows;
  if(j && Array.isArray(j.data)) return j.data;
  if(j && Array.isArray(j.connections)) return j.connections;
  if(j && Array.isArray(j.anchors)) return j.anchors;
  if(j && Array.isArray(j.edges)) return j.edges;
  if(j && Array.isArray(j.links)) return j.links;
  return [];
}
function detectType(a){
  const id=String(a.anchor_id||"").toUpperCase();
  const t=String(a.anchor_type||"").toUpperCase();
  const cls=String(a.anchor_class||"").toUpperCase();
  const role=String(a.anchor_role||"").toUpperCase();
  const area=String(a.area_type||"").toUpperCase();
  if(id.startsWith("NODE_DOOR_") || t.includes("DOOR") || cls.includes("DOOR")) return "door";
  if(t.includes("PLAZA") || id.startsWith("PLZ_")) return "plaza";
  if(
    a.vertical===true ||
    String(a.vertical||"").toUpperCase()==="TRUE" ||
    t.includes("ESC") ||
    t.includes("ELV") ||
    t.includes("STAIR") ||
    t.includes("RAMP") ||
    t.includes("STR") ||
    id.startsWith("ESC_") ||
    id.startsWith("ELV_") ||
    id.startsWith("STR_") ||
    id.startsWith("RAMP_")
  ) return "vertical";
  if(t.includes("PARK") || area.includes("PARKING") || id.startsWith("PARK_")) return "parking";
  if(role.includes("AMENITY") || t.includes("ATM") || t.includes("WC") || t.includes("INFO") || t.includes("BUS") || t.includes("TAXI") || t.includes("POI")) return "poi";
  return "corridor";
}
function typeRank(t){
  if(t==="plaza") return 1;
  if(t==="vertical") return 2;
  if(t==="parking") return 3;
  if(t==="poi") return 4;
  if(t==="door") return 5;
  return 6;
}
function typeColor(t){
  if(t==="plaza") return "#2563eb";
  if(t==="vertical") return "#dc2626";
  if(t==="door") return "#16a34a";
  if(t==="poi") return "#d97706";
  if(t==="parking") return "#7c3aed";
  return "#111111";
}
function showAtZoom(t,z){
  if(z < 0.9) return t==="plaza" || t==="vertical" || t==="parking";
  if(z < 1.8) return t!=="door";
  return true;
}
function labelAtZoom(t,z){
  if(z >= 2.5) return true;
  if(z >= 1.8 && (t==="plaza" || t==="vertical" || t==="parking" || t==="poi")) return true;
  return false;
}
function dist(ax,ay,bx,by){
  const dx=ax-bx, dy=ay-by;
  return Math.sqrt(dx*dx+dy*dy);
}
function edgeKey(a,b){ return `${a}__${b}`; }
function fitView(nodes, vw, vh){
  if(!nodes.length) return { scale:1, tx:0, ty:0 };
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const n of nodes){
    minX=Math.min(minX,n.x);
    maxX=Math.max(maxX,n.x);
    minY=Math.min(minY,n.y);
    maxY=Math.max(maxY,n.y);
  }
  const pad=22;
  const w=maxX-minX || 0.01;
  const h=maxY-minY || 0.01;
  const s=Math.min((vw-2*pad)/w,(vh-2*pad)/h);
  const scale=clamp(s,0.5,4000);
  const tx=(vw - w*scale)/2 - minX*scale;
  const ty=(vh - h*scale)/2 - minY*scale;
  return { scale, tx, ty };
}
function isIdPrefix(id,prefix){
  return String(id||"").toUpperCase().startsWith(prefix);
}
function isElv(id){ return isIdPrefix(id,"ELV_"); }
function isStr(id){ return isIdPrefix(id,"STR_"); }
function isRamp(id){ return isIdPrefix(id,"RAMP_"); }
function isEsc(id){ return isIdPrefix(id,"ESC_"); }
function isGarageHub(id){ return isIdPrefix(id,"NODE_PARKING_GARAGE_LVL_"); }
function isEvCharging(id){ return isIdPrefix(id,"EV_CHARGING_"); }
function isPark(id){ return isIdPrefix(id,"PARK_"); }
function isParkingLike(id){
  const s=String(id||"").toUpperCase();
  return s.startsWith("PARK_") || s.startsWith("ENT_PARKING_") || s.startsWith("EV_CHARGING_") || s.startsWith("CAR_WASH_") || s.startsWith("NODE_PARKING_GARAGE_LVL_");
}
function getAnchorFloor(anchorMap,id){
  return anchorMap.get(id)?.floor ?? "";
}
function distCost(anchorMap,aId,bId){
  const a=anchorMap.get(aId);
  const b=anchorMap.get(bId);
  if(!a || !b) return 1e9;
  const dx=(b.x-a.x)*1000;
  const dy=(b.y-a.y)*600;
  return Math.hypot(dx,dy);
}
function buildWeightedAdj(edges, anchorMap){
  const m=new Map();
  for(const e of edges){
    if(e.blockedForFilter) continue;
    if(!anchorMap.has(e.from) || !anchorMap.has(e.to)) continue;
    if(!m.has(e.from)) m.set(e.from,[]);
    if(!m.has(e.to)) m.set(e.to,[]);
    m.get(e.from).push({ to:e.to, edge:e });
    if(e.bidirectional) m.get(e.to).push({ to:e.from, edge:e });
  }
  return m;
}
function hasRampOptionWithin(curId, adjWeighted, anchorMap, threshold){
  const neigh=adjWeighted.get(curId) || [];
  for(const item of neigh){
    if(isRamp(item.to)){
      if(distCost(anchorMap, curId, item.to) <= threshold) return true;
    }
  }
  return false;
}
const TUNE={
  ELV_PENALTY:10,
  EV_CHARGING_PENALTY:300,
  GARAGE_HUB_PENALTY:120,
  PARK_TO_GARAGE_PENALTY:800,
  RAMP_BONUS:8,
  STR_BONUS:1,
  DIRECT_TO_F0_BONUS:80,
  B_TO_F1_PENALTY:120,
  B_TO_F2_PENALTY:160,
  RAMP_PREF_DISTANCE:20,
  STR_NEAR_RAMP_PENALTY:250,
  PARKING_EDGE_PENALTY:220,
  PARKING_NODE_PENALTY:160,
  B1_GENERAL_PENALTY:120,
  FLOOR_CHANGE_PENALTY:60,
  ESC_PENALTY:25,
  DOOR_EDGE_PENALTY:4,
  POI_EDGE_PENALTY:8
};
function edgeExtraCost(curId,nxId,visitedF0,adjWeighted,anchorMap,startId,endId){
  let extra=0;
  const fCur=getAnchorFloor(anchorMap,curId).toUpperCase();
  const fNx=getAnchorFloor(anchorMap,nxId).toUpperCase();
  const startIsParking=isParkingLike(startId);
  const endIsParking=isParkingLike(endId);
  const tripNeedsParking=startIsParking || endIsParking;
  if(isElv(curId) || isElv(nxId)) extra += TUNE.ELV_PENALTY;
  if(isEsc(curId) || isEsc(nxId)) extra += TUNE.ESC_PENALTY;
  if(isEvCharging(curId) || isEvCharging(nxId)) extra += TUNE.EV_CHARGING_PENALTY;
  if(isGarageHub(curId) || isGarageHub(nxId)) extra += TUNE.GARAGE_HUB_PENALTY;
  if(isPark(curId) && isGarageHub(nxId)) extra += TUNE.PARK_TO_GARAGE_PENALTY;
  if(isPark(nxId) && isGarageHub(curId)) extra += TUNE.PARK_TO_GARAGE_PENALTY;
  if(isRamp(curId) || isRamp(nxId)) extra -= TUNE.RAMP_BONUS;
  if(isStr(curId) || isStr(nxId)) extra -= TUNE.STR_BONUS;
  if(isStr(nxId) && hasRampOptionWithin(curId,adjWeighted,anchorMap,TUNE.RAMP_PREF_DISTANCE)) extra += TUNE.STR_NEAR_RAMP_PENALTY;
  if(!visitedF0){
    if(fNx==="F0") extra -= TUNE.DIRECT_TO_F0_BONUS;
    if(/^B/i.test(fCur) && fNx==="F1") extra += TUNE.B_TO_F1_PENALTY;
    if(/^B/i.test(fCur) && fNx==="F2") extra += TUNE.B_TO_F2_PENALTY;
  }
  if(fCur !== fNx) extra += TUNE.FLOOR_CHANGE_PENALTY;
  if(!tripNeedsParking){
    if(isParkingLike(curId) || isParkingLike(nxId)) extra += TUNE.PARKING_EDGE_PENALTY;
    if(fCur==="B1" || fNx==="B1") extra += TUNE.B1_GENERAL_PENALTY;
  }else{
    const curParking=isParkingLike(curId);
    const nxParking=isParkingLike(nxId);
    if((curParking || nxParking) && !(curId===startId || curId===endId || nxId===startId || nxId===endId)){
      extra += 20;
    }
  }
  const curKind=anchorMap.get(curId)?.kind;
  const nxKind=anchorMap.get(nxId)?.kind;
  if(curKind==="door" || nxKind==="door") extra += TUNE.DOOR_EDGE_PENALTY;
  if(curKind==="poi" || nxKind==="poi") extra += TUNE.POI_EDGE_PENALTY;
  if((curKind==="parking" || nxKind==="parking") && !tripNeedsParking) extra += TUNE.PARKING_NODE_PENALTY;
  return extra;
}
function dijkstraVisitedF0(startId,endId,adjWeighted,anchorMap){
  if(!startId || !endId) return [];
  if(!adjWeighted.has(startId) || !adjWeighted.has(endId)) return [];
  if(startId===endId) return [startId];
  const startVF0=(getAnchorFloor(anchorMap,startId).toUpperCase()==="F0");
  const startKey=`${startId}::${startVF0?1:0}`;
  const distMap=new Map();
  const prevMap=new Map();
  const pq=[{ key:startKey, id:startId, vf0:startVF0, d:0 }];
  distMap.set(startKey,0);
  prevMap.set(startKey,null);
  function popMin(){
    let bi=0;
    for(let i=1;i<pq.length;i++) if(pq[i].d < pq[bi].d) bi=i;
    return pq.splice(bi,1)[0];
  }
  while(pq.length){
    const cur=popMin();
    if((distMap.get(cur.key) ?? Infinity) < cur.d) continue;
    if(cur.id===endId){
      const path=[];
      let k=cur.key;
      while(k!=null){
        path.push(k.split("::")[0]);
        k=prevMap.get(k);
      }
      path.reverse();
      return path;
    }
    const neigh=adjWeighted.get(cur.id) || [];
    for(const item of neigh){
      const nx=item.to;
      const nxVF0=cur.vf0 || (getAnchorFloor(anchorMap,nx).toUpperCase()==="F0");
      const nxKey=`${nx}::${nxVF0?1:0}`;
      const base=distCost(anchorMap,cur.id,nx);
      const extra=edgeExtraCost(cur.id,nx,cur.vf0,adjWeighted,anchorMap,startId,endId);
      const w=Math.max(0.001,base+extra);
      const nd=cur.d+w;
      if(nd < (distMap.get(nxKey) ?? Infinity)){
        distMap.set(nxKey,nd);
        prevMap.set(nxKey,cur.key);
        pq.push({ key:nxKey, id:nx, vf0:nxVF0, d:nd });
      }
    }
  }
  return [];
}

export default function App(){
  const svgRef=useRef(null);
  const wrapRef=useRef(null);
  const fileAnchRef=useRef(null);
  const fileConnRef=useRef(null);

  const [anchorsRaw,setAnchorsRaw]=useState([]);
  const [connectionsRaw,setConnectionsRaw]=useState([]);
  const [loading,setLoading]=useState(true);
  const [loadMsg,setLoadMsg]=useState("autoload");
  const [searchText,setSearchText]=useState("");
  const [selectedId,setSelectedId]=useState("");
  const [startId,setStartId]=useState("");
  const [endId,setEndId]=useState("");
  const [route,setRoute]=useState([]);
  const [lastTap,setLastTap]=useState("");
  const [menuOpen,setMenuOpen]=useState(false);
  const [panelOpen,setPanelOpen]=useState(true);
  const [wheelchair,setWheelchair]=useState(false);
  const [stroller,setStroller]=useState(false);
  const [luggage,setLuggage]=useState(false);
  const [currentFloor,setCurrentFloor]=useState("ALL");
  const [viewport,setViewport]=useState({ scale:1, tx:0, ty:0 });
  const [dragging,setDragging]=useState(false);
  const [info,setInfo]=useState(null);
  const touchState=useRef({ mode:"none", startDist:0, startScale:1, startMid:{x:0,y:0}, startTx:0, startTy:0, last:{x:0,y:0} });

  useEffect(()=>{
    (async()=>{
      try{
        setLoading(true);
        const aCandidates=[
          "/data/anchors.csv","/data/anchors.json","/data/la_zenia_anchors.csv","/data/la_zenia_anchors.json",
          "/data/la_zenia_L0_v1_anchors.csv","/data/la_zenia_L0_v1_anchors.json","/data/graph_anchors.csv","/data/graph_anchors.json"
        ];
        const cCandidates=[
          "/data/connections.csv","/data/connections.json","/data/la_zenia_connections.csv","/data/la_zenia_connections.json",
          "/data/la_zenia_L0_v1_connections.csv","/data/la_zenia_L0_v1_connections.json","/data/graph_connections.csv","/data/graph_connections.json"
        ];
        async function loadAny(list){
          for(const url of list){
            try{
              const r=await fetch(url,{cache:"no-store"});
              if(!r.ok) continue;
              const t=await r.text();
              if(!t || !t.trim()) continue;
              if(url.toLowerCase().endsWith(".json")){
                const j=safeJsonParse(t);
                if(j){
                  const arr=flattenMaybeWrappedJson(j);
                  if(arr.length) return arr;
                }
              }else{
                const arr=parseDelimited(t);
                if(arr.length) return arr;
              }
            }catch{}
          }
          return [];
        }
        const [a,c]=await Promise.all([loadAny(aCandidates),loadAny(cCandidates)]);
        setAnchorsRaw(a);
        setConnectionsRaw(c);
        setLoadMsg(a.length && c.length ? "autoload ok" : "autoload partial");
      }finally{
        setLoading(false);
      }
    })();
  },[]);

  const anchors=useMemo(()=>{
    const out=(anchorsRaw||[]).map(r=>{
      const anchor_id=String(firstOf(r,["anchor_id","id","anchorid","name_id","node_id"])).trim();
      const x=toNum(firstOf(r,["x","lonx","px","pos_x"]));
      const y=toNum(firstOf(r,["y","laty","py","pos_y"]));
      const floor=String(firstOf(r,["floor","level","lvl"])).trim().toUpperCase() || "UNKNOWN";
      const obj={
        anchor_id,
        anchor_type:String(firstOf(r,["anchor_type","type"])).trim(),
        name:String(firstOf(r,["name","label","title"])).trim(),
        anchor_role:String(firstOf(r,["anchor_role","role"])).trim(),
        anchor_class:String(firstOf(r,["anchor_class","class"])).trim(),
        floor,
        environment:String(firstOf(r,["environment","enviroment"])).trim(),
        area_type:String(firstOf(r,["area_type"])).trim(),
        vertical:(String(firstOf(r,["vertical"])).trim().toUpperCase()==="TRUE"),
        x:clamp01(x),
        y:clamp01(y),
        walkable:(String(firstOf(r,["walkable"])).trim().toUpperCase()==="TRUE"),
        access_wheelchair:(String(firstOf(r,["access_wheelchair","wheelchair"])).trim().toUpperCase()==="TRUE"),
        access_stroller:(String(firstOf(r,["access_stroller","stroller"])).trim().toUpperCase()==="TRUE"),
        access_luggage:(String(firstOf(r,["access_luggage","luggage"])).trim().toUpperCase()==="TRUE")
      };
      obj.kind=detectType(obj);
      obj.label=obj.name || obj.anchor_id;
      return obj;
    }).filter(a=>a.anchor_id && Number.isFinite(a.x) && Number.isFinite(a.y));
    const seen=new Set();
    return out.filter(a=>{
      if(seen.has(a.anchor_id)) return false;
      seen.add(a.anchor_id);
      return true;
    });
  },[anchorsRaw]);

  const anchorMap=useMemo(()=>{
    const m=new Map();
    for(const a of anchors) m.set(a.anchor_id,a);
    return m;
  },[anchors]);

  const connections=useMemo(()=>{
    const out=[];
    for(const r of (connectionsRaw||[])){
      const from=String(firstOf(r,["from","source","a","node_a"])).trim();
      const to=String(firstOf(r,["to","target","b","node_b"])).trim();
      if(!from || !to) continue;
      const bidirectional=String(firstOf(r,["bidirectional","both_ways","two_way"])).trim().toUpperCase()!=="FALSE";
      const wc=String(firstOf(r,["wheelchair","access_wheelchair"])).trim().toUpperCase()==="TRUE";
      const st=String(firstOf(r,["stroller","access_stroller"])).trim().toUpperCase()==="TRUE";
      const lg=String(firstOf(r,["luggage","access_luggage"])).trim().toUpperCase()==="TRUE";
      const a=anchorMap.get(from);
      const b=anchorMap.get(to);
      if(!a || !b) continue;
      const blockedForFilter=(wheelchair && !wc) || (stroller && !st) || (luggage && !lg);
      out.push({ from,to,bidirectional,wheelchair:wc,stroller:st,luggage:lg,blockedForFilter });
    }
    return out;
  },[connectionsRaw,anchorMap,wheelchair,stroller,luggage]);

  const floors=useMemo(()=>{
    const s=new Set(["ALL"]);
    for(const a of anchors) s.add(a.floor || "UNKNOWN");
    return Array.from(s);
  },[anchors]);

  const visibleAnchors=useMemo(()=>{
    let arr=anchors;
    if(currentFloor!=="ALL") arr=arr.filter(a=>a.floor===currentFloor);
    return [...arr].sort((a,b)=>typeRank(a.kind)-typeRank(b.kind));
  },[anchors,currentFloor]);

  const visibleAnchorMap=useMemo(()=>{
    const m=new Map();
    for(const a of visibleAnchors) m.set(a.anchor_id,a);
    return m;
  },[visibleAnchors]);

  const visibleConnections=useMemo(()=>{
    return connections.filter(e=>{
      const a=visibleAnchorMap.get(e.from);
      const b=visibleAnchorMap.get(e.to);
      return !!a && !!b;
    });
  },[connections,visibleAnchorMap]);

  const routeAdjWeighted=useMemo(()=>{
    return buildWeightedAdj(visibleConnections, visibleAnchorMap);
  },[visibleConnections,visibleAnchorMap]);

  useEffect(()=>{
    if(startId && endId){
      const p=dijkstraVisitedF0(startId,endId,routeAdjWeighted,visibleAnchorMap);
      setRoute(p);
    }else{
      setRoute([]);
    }
  },[startId,endId,routeAdjWeighted,visibleAnchorMap]);

  const routeEdgeSet=useMemo(()=>{
    const s=new Set();
    for(let i=0;i<route.length-1;i++){
      s.add(edgeKey(route[i],route[i+1]));
      s.add(edgeKey(route[i+1],route[i]));
    }
    return s;
  },[route]);

  const stats=useMemo(()=>{
    const graphNodes=new Set();
    for(const e of visibleConnections){
      graphNodes.add(e.from);
      graphNodes.add(e.to);
    }
    return {
      loadedAnchors:anchors.length,
      visibleAnchors:visibleAnchors.length,
      connections:visibleConnections.length,
      graphNodes:graphNodes.size
    };
  },[anchors,visibleAnchors,visibleConnections]);

  useEffect(()=>{
    const el=wrapRef.current;
    if(!el) return;
    const doFit=()=>{
      const r=el.getBoundingClientRect();
      const fit=fitView(visibleAnchors,r.width,r.height);
      setViewport(fit);
    };
    doFit();
    const ro=new ResizeObserver(doFit);
    ro.observe(el);
    return ()=>ro.disconnect();
  },[visibleAnchors]);

  function worldToScreen(x,y){
    return { x:x*viewport.scale + viewport.tx, y:y*viewport.scale + viewport.ty };
  }
  function screenToWorld(x,y){
    return { x:(x - viewport.tx)/viewport.scale, y:(y - viewport.ty)/viewport.scale };
  }
  function resetView(){
    const el=wrapRef.current;
    if(!el) return;
    const r=el.getBoundingClientRect();
    setViewport(fitView(visibleAnchors,r.width,r.height));
  }
  function clearRoute(){
    setStartId("");
    setEndId("");
    setRoute([]);
  }
  function clearSelection(){
    setSelectedId("");
    setInfo(null);
    setLastTap("");
  }
  function onNodeTap(id){
    setLastTap(id);
    setSelectedId(id);
    const a=visibleAnchorMap.get(id) || anchorMap.get(id);
    if(a){
      const cons=visibleConnections.filter(e=>e.from===id || e.to===id);
      const linked=[...new Set(cons.map(e=>e.from===id?e.to:e.from))].sort();
      setInfo({ anchor:a, connections:cons.length, linked });
    }
    if(!startId){
      setStartId(id);
      return;
    }
    if(startId && !endId && id!==startId){
      setEndId(id);
      return;
    }
    if(startId && endId){
      setStartId(id);
      setEndId("");
      setRoute([]);
    }
  }
  function searchAndCenter(){
    const q=searchText.trim().toUpperCase();
    if(!q) return;
    const exact=anchors.find(a=>a.anchor_id.toUpperCase()===q);
    const partial=exact ? null : anchors.find(a=>a.anchor_id.toUpperCase().includes(q) || (a.name||"").toUpperCase().includes(q));
    const hit=exact || partial;
    if(!hit) return;
    if(currentFloor!=="ALL" && hit.floor!==currentFloor) setCurrentFloor(hit.floor);
    setSelectedId(hit.anchor_id);
    const cons=connections.filter(e=>e.from===hit.anchor_id || e.to===hit.anchor_id);
    const linked=[...new Set(cons.map(e=>e.from===hit.anchor_id?e.to:e.from))].sort();
    setInfo({ anchor:hit, connections:cons.length, linked });
    setLastTap(hit.anchor_id);
    const el=wrapRef.current;
    if(!el) return;
    const r=el.getBoundingClientRect();
    const targetScale=Math.max(viewport.scale, r.width*2.2);
    const tx=r.width/2 - hit.x*targetScale;
    const ty=r.height/2 - hit.y*targetScale;
    setViewport({ scale:targetScale, tx, ty });
  }
  function handleWheel(e){
    e.preventDefault();
    const rect=svgRef.current.getBoundingClientRect();
    const sx=e.clientX - rect.left;
    const sy=e.clientY - rect.top;
    const before=screenToWorld(sx,sy);
    const factor=e.deltaY < 0 ? 1.12 : 0.9;
    const newScale=clamp(viewport.scale * factor, 120, 24000);
    const newTx=sx - before.x*newScale;
    const newTy=sy - before.y*newScale;
    setViewport({ scale:newScale, tx:newTx, ty:newTy });
  }
  function handlePointerDown(e){
    if(e.pointerType==="mouse" && e.button!==0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    touchState.current.mode="pan";
    touchState.current.last={x:e.clientX,y:e.clientY};
    setDragging(true);
  }
  function handlePointerMove(e){
    if(touchState.current.mode!=="pan") return;
    const dx=e.clientX - touchState.current.last.x;
    const dy=e.clientY - touchState.current.last.y;
    touchState.current.last={x:e.clientX,y:e.clientY};
    setViewport(v=>({ ...v, tx:v.tx+dx, ty:v.ty+dy }));
  }
  function handlePointerUp(){
    touchState.current.mode="none";
    setDragging(false);
  }
  function getTouches(evt){
    const t=evt.touches || [];
    return Array.from(t).map(x=>({ x:x.clientX, y:x.clientY }));
  }
  function handleTouchStart(e){
    if(e.touches.length===1){
      const t=e.touches[0];
      touchState.current.mode="pan";
      touchState.current.last={x:t.clientX,y:t.clientY};
    }else if(e.touches.length===2){
      const [a,b]=getTouches(e);
      const d=dist(a.x,a.y,b.x,b.y);
      const mid={ x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
      touchState.current.mode="pinch";
      touchState.current.startDist=d;
      touchState.current.startScale=viewport.scale;
      touchState.current.startMid=mid;
      touchState.current.startTx=viewport.tx;
      touchState.current.startTy=viewport.ty;
    }
  }
  function handleTouchMove(e){
    if(touchState.current.mode==="pan" && e.touches.length===1){
      const t=e.touches[0];
      const dx=t.clientX - touchState.current.last.x;
      const dy=t.clientY - touchState.current.last.y;
      touchState.current.last={x:t.clientX,y:t.clientY};
      setViewport(v=>({ ...v, tx:v.tx+dx, ty:v.ty+dy }));
    }else if(touchState.current.mode==="pinch" && e.touches.length===2){
      const [a,b]=getTouches(e);
      const d=dist(a.x,a.y,b.x,b.y);
      const mid={ x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
      const factor=d / Math.max(1,touchState.current.startDist);
      const newScale=clamp(touchState.current.startScale * factor, 120, 24000);
      const rect=svgRef.current.getBoundingClientRect();
      const sx=mid.x - rect.left;
      const sy=mid.y - rect.top;
      const wx=(sx - touchState.current.startTx)/touchState.current.startScale;
      const wy=(sy - touchState.current.startTy)/touchState.current.startScale;
      const newTx=sx - wx*newScale;
      const newTy=sy - wy*newScale;
      setViewport({ scale:newScale, tx:newTx, ty:newTy });
    }
  }
  function handleTouchEnd(e){
    if(e.touches.length===0) touchState.current.mode="none";
    if(e.touches.length===1){
      const t=e.touches[0];
      touchState.current.mode="pan";
      touchState.current.last={x:t.clientX,y:t.clientY};
    }
  }
  async function importAnchorsFile(file){
    const t=await file.text();
    let arr=[];
    if(file.name.toLowerCase().endsWith(".json")){
      const j=safeJsonParse(t);
      arr=flattenMaybeWrappedJson(j);
    }else{
      arr=parseDelimited(t);
    }
    setAnchorsRaw(arr||[]);
  }
  async function importConnectionsFile(file){
    const t=await file.text();
    let arr=[];
    if(file.name.toLowerCase().endsWith(".json")){
      const j=safeJsonParse(t);
      arr=flattenMaybeWrappedJson(j);
    }else{
      arr=parseDelimited(t);
    }
    setConnectionsRaw(arr||[]);
  }

  const selectedAnchor=selectedId ? (visibleAnchorMap.get(selectedId) || anchorMap.get(selectedId)) : null;

  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:"#0b1220",color:"#e5e7eb",fontFamily:"system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif"}}>
      <div style={{padding:"8px 10px",borderBottom:"1px solid #1f2937",background:"#0f172a",position:"sticky",top:0,zIndex:20}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <div style={{fontWeight:800,fontSize:18,whiteSpace:"nowrap"}}>IndoorsNav — Anchor Viewer</div>
          <button onClick={()=>setPanelOpen(v=>!v)} style={btnSmall()}>{panelOpen?"Hide":"Show"} top</button>
          <button onClick={()=>setMenuOpen(v=>!v)} style={btnSmall()}>{menuOpen?"Hide":"Show"} tools</button>
          <button onClick={resetView} style={btnSmallPrimary()}>Reset View</button>
          <button onClick={clearRoute} style={btnSmall()}>Clear Route</button>
          <button onClick={clearSelection} style={btnSmall()}>Clear Selection</button>
        </div>

        {panelOpen && (
          <div style={{marginTop:8,display:"grid",gridTemplateColumns:"1fr",gap:8}}>
            <div style={{fontSize:13,lineHeight:1.35,opacity:0.9}}>
              Loaded Anchors {stats.loadedAnchors} | Visible {stats.visibleAnchors} | Connections {stats.connections} | Graph nodes {stats.graphNodes}<br/>
              Access filter: wheelchair={String(wheelchair)} stroller={String(stroller)} luggage={String(luggage)}<br/>
              Route mode: weighted Dijkstra | prefer same-floor public paths | penalize parking/B1/vertical detours | prefer ramp over stairs when nearby<br/>
              Tap workflow: first tap = START | second tap = END | third tap restarts | Start: {startId || "—"} | End: {endId || "—"} | Last tap: {lastTap || "—"} | {loading ? "Loading..." : loadMsg}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8}}>
              <input value={searchText} onChange={e=>setSearchText(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") searchAndCenter(); }} placeholder="Search anchor ID or name" style={inputStyle()}/>
              <button onClick={searchAndCenter} style={btnSmallPrimary()}>Find</button>
            </div>

            {menuOpen && (
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <label style={labelRow()}><input type="checkbox" checked={wheelchair} onChange={e=>setWheelchair(e.target.checked)}/>wheelchair</label>
                  <label style={labelRow()}><input type="checkbox" checked={stroller} onChange={e=>setStroller(e.target.checked)}/>stroller</label>
                  <label style={labelRow()}><input type="checkbox" checked={luggage} onChange={e=>setLuggage(e.target.checked)}/>luggage</label>
                  <select value={currentFloor} onChange={e=>setCurrentFloor(e.target.value)} style={inputStyle()}>
                    {floors.map(f=><option key={f} value={f}>{f}</option>)}
                  </select>
                </div>

                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <button onClick={()=>fileAnchRef.current?.click()} style={btnSmall()}>Import Anchors</button>
                  <button onClick={()=>fileConnRef.current?.click()} style={btnSmall()}>Import Connections</button>
                  <div style={{fontSize:12,opacity:0.85,lineHeight:1.35}}>
                    Desktop / mobile use:<br/>• Drag = pan<br/>• Pinch or wheel = zoom<br/>• Tap node = info / route<br/>• Labels appear when zoomed in
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <input ref={fileAnchRef} type="file" accept=".csv,.json,.txt" style={{display:"none"}} onChange={async e=>{ const f=e.target.files?.[0]; if(f) await importAnchorsFile(f); e.target.value=""; }}/>
        <input ref={fileConnRef} type="file" accept=".csv,.json,.txt" style={{display:"none"}} onChange={async e=>{ const f=e.target.files?.[0]; if(f) await importConnectionsFile(f); e.target.value=""; }}/>
      </div>

      <div style={{display:"flex",flex:"1 1 auto",minHeight:0}}>
        <div ref={wrapRef} style={{position:"relative",flex:"1 1 auto",minWidth:0,background:"#f8fafc",overflow:"hidden",touchAction:"none"}}>
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`0 0 ${wrapRef.current?.clientWidth || 1000} ${wrapRef.current?.clientHeight || 700}`}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{display:"block",width:"100%",height:"100%",background:"#f8fafc",cursor:dragging?"grabbing":"grab"}}
          >
            <rect x="0" y="0" width="100%" height="100%" fill="#f8fafc"/>

            <g>
              {visibleConnections.map((e,i)=>{
                const a=visibleAnchorMap.get(e.from);
                const b=visibleAnchorMap.get(e.to);
                if(!a || !b) return null;
                if(!showAtZoom(a.kind,viewport.scale/800) && !showAtZoom(b.kind,viewport.scale/800)) return null;
                const p1=worldToScreen(a.x,a.y);
                const p2=worldToScreen(b.x,b.y);
                const inRoute=routeEdgeSet.has(edgeKey(e.from,e.to));
                return (
                  <line
                    key={`${e.from}-${e.to}-${i}`}
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke={inRoute ? "#ef4444" : (e.blockedForFilter ? "#cbd5e1" : "#94a3b8")}
                    strokeWidth={inRoute ? 4 : 1.5}
                    opacity={inRoute ? 1 : 0.8}
                  />
                );
              })}
            </g>

            <g>
              {visibleAnchors.map(a=>{
                const z=viewport.scale/800;
                if(!showAtZoom(a.kind,z)) return null;
                const p=worldToScreen(a.x,a.y);
                const isSelected=a.anchor_id===selectedId;
                const isStart=a.anchor_id===startId;
                const isEnd=a.anchor_id===endId;
                const inRoute=route.includes(a.anchor_id);
                const radius=isSelected ? 8 : (a.kind==="plaza" || a.kind==="vertical" ? 6 : 4.2);
                const fill=isStart ? "#16a34a" : isEnd ? "#dc2626" : inRoute ? "#f97316" : typeColor(a.kind);
                return (
                  <g key={a.anchor_id}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={radius}
                      fill={fill}
                      stroke={isSelected ? "#000000" : "transparent"}
                      strokeWidth={isSelected ? 2 : 0}
                      onClick={(e)=>{ e.stopPropagation(); onNodeTap(a.anchor_id); }}
                    />
                    {labelAtZoom(a.kind,z) && (
                      <text
                        x={p.x + 8}
                        y={p.y - 8}
                        fontSize={12}
                        fill="#111827"
                        stroke="#ffffff"
                        strokeWidth="3"
                        paintOrder="stroke"
                        style={{userSelect:"none",pointerEvents:"none"}}
                      >
                        {a.anchor_id}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          <div style={{position:"absolute",right:10,bottom:10,display:"flex",flexDirection:"column",gap:8,zIndex:10}}>
            <button
              onClick={()=>{
                setViewport(v=>{
                  const rect=wrapRef.current.getBoundingClientRect();
                  const sx=rect.width/2;
                  const sy=rect.height/2;
                  const before=screenToWorld(sx,sy);
                  const scale=clamp(v.scale*1.2,120,24000);
                  return { scale, tx:sx-before.x*scale, ty:sy-before.y*scale };
                });
              }}
              style={zoomBtn()}
            >+</button>
            <button
              onClick={()=>{
                setViewport(v=>{
                  const rect=wrapRef.current.getBoundingClientRect();
                  const sx=rect.width/2;
                  const sy=rect.height/2;
                  const before=screenToWorld(sx,sy);
                  const scale=clamp(v.scale*0.84,120,24000);
                  return { scale, tx:sx-before.x*scale, ty:sy-before.y*scale };
                });
              }}
              style={zoomBtn()}
            >−</button>
          </div>

          <div style={{position:"absolute",left:10,bottom:10,background:"rgba(15,23,42,0.92)",color:"#e5e7eb",padding:"8px 10px",borderRadius:10,fontSize:12,lineHeight:1.35,zIndex:10,maxWidth:"78vw"}}>
            Legend: <span style={{color:"#111111"}}>●</span> corridor <span style={{color:"#2563eb"}}>●</span> plaza <span style={{color:"#dc2626"}}>●</span> vertical <span style={{color:"#16a34a"}}>●</span> door <span style={{color:"#d97706"}}>●</span> poi <span style={{color:"#7c3aed"}}>●</span> parking
          </div>
        </div>

        <div style={{width:selectedAnchor || info ? 310 : 0,transition:"width 0.18s ease",overflow:"hidden",borderLeft:selectedAnchor || info ? "1px solid #1f2937" : "none",background:"#111827"}}>
          <div style={{width:310,height:"100%",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"10px 12px",borderBottom:"1px solid #1f2937",fontWeight:800}}>Anchor Info</div>
            <div style={{padding:12,overflow:"auto",fontSize:14,lineHeight:1.45}}>
              {info ? (
                <>
                  <div style={kvHead()}>ANCHOR_ID</div>
                  <div style={kvVal()}>{info.anchor.anchor_id}</div>

                  <div style={kvHead()}>NAME</div>
                  <div style={kvVal()}>{info.anchor.name || "—"}</div>

                  <div style={kvHead()}>TYPE</div>
                  <div style={kvVal()}>{info.anchor.kind}</div>

                  <div style={kvHead()}>ANCHOR_TYPE</div>
                  <div style={kvVal()}>{info.anchor.anchor_type || "—"}</div>

                  <div style={kvHead()}>FLOOR</div>
                  <div style={kvVal()}>{info.anchor.floor || "—"}</div>

                  <div style={kvHead()}>VERTICAL</div>
                  <div style={kvVal()}>{String(info.anchor.vertical)}</div>

                  <div style={kvHead()}>XY</div>
                  <div style={kvVal()}>{info.anchor.x.toFixed(4)}, {info.anchor.y.toFixed(4)}</div>

                  <div style={kvHead()}>CONNECTIONS</div>
                  <div style={kvVal()}>{info.connections}</div>

                  <div style={kvHead()}>CONNECTED TO</div>
                  <div style={{...kvVal(),whiteSpace:"pre-wrap"}}>{info.linked.length ? info.linked.join("\n") : "—"}</div>

                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}>
                    <button onClick={()=>setStartId(info.anchor.anchor_id)} style={btnSmallPrimary()}>Set Start</button>
                    <button onClick={()=>setEndId(info.anchor.anchor_id)} style={btnSmallPrimary()}>Set End</button>
                  </div>
                </>
              ) : (
                <div style={{opacity:0.8}}>Tap any anchor to see its details and linked nodes.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function btnSmall(){
  return {background:"#1f2937",color:"#e5e7eb",border:"1px solid #334155",borderRadius:10,padding:"8px 10px",fontWeight:700,fontSize:13};
}
function btnSmallPrimary(){
  return {background:"#0f3b82",color:"#ffffff",border:"1px solid #1d4ed8",borderRadius:10,padding:"8px 10px",fontWeight:800,fontSize:13};
}
function inputStyle(){
  return {width:"100%",background:"#0b1220",color:"#e5e7eb",border:"1px solid #334155",borderRadius:10,padding:"10px 12px",fontSize:14};
}
function labelRow(){
  return {display:"flex",alignItems:"center",gap:8,fontSize:14};
}
function zoomBtn(){
  return {width:44,height:44,borderRadius:999,background:"rgba(15,23,42,0.92)",color:"#fff",border:"1px solid #334155",fontSize:24,fontWeight:800};
}
function kvHead(){
  return {marginTop:10,fontSize:12,fontWeight:800,letterSpacing:"0.04em",opacity:0.72};
}
function kvVal(){
  return {fontSize:14,wordBreak:"break-word"};
}
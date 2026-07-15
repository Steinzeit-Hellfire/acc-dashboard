'use strict';
const API='/api';
const TN={nurburgring_24h:'Nürburgring 24h',nurburgring:'Nürburgring',spa:'Spa-Francorchamps',monza:'Monza',barcelona:'Barcelona',silverstone:'Silverstone',hungaroring:'Hungaroring',zandvoort:'Zandvoort',zolder:'Zolder',brands_hatch:'Brands Hatch',misano:'Misano',paul_ricard:'Paul Ricard',imola:'Imola',mount_panorama:'Mount Panorama',suzuka:'Suzuka',laguna_seca:'Laguna Seca',kyalami:'Kyalami',oulton_park:'Oulton Park',donington:'Donington Park',snetterton:'Snetterton',indianapolis:'Indianapolis',watkins_glen:'Watkins Glen',cota:'COTA',valencia:'Valencia',red_bull_ring:'Red Bull Ring'};
const STYP={FP:'Freies Training',Q:'Qualifying',R:'Rennen'};
const AV=['av0','av1','av2','av3','av4','av5','av6','av7'];
let activeTrack=null,activeCar=null,syncTs=null,allDrivers=[],lastRows=[],myPageData=null,champData=null;
let prevRecords={};
let refreshCount=0;

const tn=t=>TN[t]||t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const ini=n=>{if(!n)return'?';const p=n.trim().split(/\s+/);return p.length===1?p[0].slice(0,2).toUpperCase():(p[0][0]+p[p.length-1][0]).toUpperCase()};
const avc=i=>AV[i%AV.length];
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmt=ms=>{if(!ms||ms<=0)return'—';return`${Math.floor(ms/60000)}:${((ms%60000)/1000).toFixed(3).padStart(6,'0')}`};
const parseT=t=>{if(!t||t==='—')return 0;const p=t.split(':');return parseFloat(p[0])*60000+parseFloat(p[1])*1000};
const skel=(n,cls='skel-row')=>Array.from({length:n},()=>`<div class="skeleton ${cls}"></div>`).join('');
async function apiGet(p){const r=await fetch(API+p);if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}

/* ── Toast ── */
let toastT;
function toast(msg,col='var(--te)'){
  const t=document.getElementById('toast');
  t.textContent=msg;t.style.color=col;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT=setTimeout(()=>t.classList.remove('show'),3500);
}

/* ── Theme ── */
let theme=localStorage.getItem('acc-theme')||'dark';
function applyTheme(){
  document.documentElement.setAttribute('data-theme',theme);
  document.getElementById('theme-btn').textContent=theme==='dark'?'☀':'🌙';
}
function toggleTheme(){theme=theme==='dark'?'light':'dark';localStorage.setItem('acc-theme',theme);applyTheme();toast(theme==='light'?'☀ Light Mode aktiviert':'🌙 Dark Mode aktiviert','var(--tx2)');}
applyTheme();

/* ── Font ── */
const FK=['f1','rj','rd'],FL={f1:'F1',rj:'RAJ',rd:'LESBAR'};
let fk=localStorage.getItem('acc-font')||'f1';if(!FK.includes(fk))fk='f1';
function applyFont(){document.body.classList.remove('rj','rd');if(fk==='rj')document.body.classList.add('rj');if(fk==='rd')document.body.classList.add('rd');document.getElementById('font-btn').textContent=FL[fk];}
function toggleFont(){fk=FK[(FK.indexOf(fk)+1)%FK.length];localStorage.setItem('acc-font',fk);applyFont();toast('Schrift: '+{f1:'F1 Orbitron',rj:'Rajdhani',rd:'Inter (Lesbar)'}[fk],'var(--tx2)');}
applyFont();

/* ── Compact Mode ── */
let compact=localStorage.getItem('acc-compact')==='1';
function applyCompact(){document.body.classList.toggle('compact',compact);document.getElementById('compact-btn').classList.toggle('compact-on',compact);}
function toggleCompact(){compact=!compact;localStorage.setItem('acc-compact',compact?'1':'0');applyCompact();toast(compact?'Kompakt-Modus an':'Kompakt-Modus aus','var(--or)');}
applyCompact();

/* ── Search ── */
let searchOpen=false;
function toggleSearch(){
  searchOpen=!searchOpen;
  const bar=document.getElementById('search-bar');
  bar.classList.toggle('open',searchOpen);
  if(searchOpen)setTimeout(()=>document.getElementById('search-input').focus(),50);
  else{document.getElementById('search-input').value='';renderSearchResults([]);}
}
function doSearch(q){
  if(!q.trim()){renderSearchResults([]);return;}
  const ql=q.toLowerCase();
  const results=allDrivers.filter(d=>d.player_name.toLowerCase().includes(ql)||d.steam_id.toLowerCase().includes(ql));
  renderSearchResults(results,q);
}
function renderSearchResults(results,q=''){
  // Show results below search bar as overlay or redirect to fahrer
  if(!results.length)return;
  const page=document.getElementById('page-fahrer');
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.navbtn').forEach(b=>b.classList.remove('active'));
  page.classList.add('active');
  const grid=document.getElementById('drv-grid');
  grid.innerHTML=results.map((d,i)=>`<div class="drv-card glass" onclick="openModal('${esc(d.steam_id)}','${esc(d.player_name)}',${i})"><div class="drv-av ${avc(i)}">${ini(d.player_name)}</div><div style="flex:1;min-width:0"><div class="drv-name">${esc(d.player_name)}</div><div class="drv-steam">${esc(d.steam_id)}</div><div class="drv-stats"><div class="drv-stat"><strong>${d.total_laps}</strong> Rdn</div><div class="drv-stat"><strong>${d.tracks}</strong> Str</div></div></div><div class="drv-best">${d.best_laptime}<div style="font-size:10px;opacity:.5">Best</div></div></div>`).join('');
}

/* ── Season Filter ── */
let fromDate='',toDate='';
function toggleSeasonFilter(){document.getElementById('season-bar').classList.toggle('open');}
function applySeasonFilter(){
  fromDate=document.getElementById('from-date').value;
  toDate=document.getElementById('to-date').value;
  const info=fromDate||toDate?`Gefiltert: ${fromDate||'…'} bis ${toDate||'heute'}`:'';
  document.getElementById('filter-info').textContent=info;
  document.getElementById('filter-btn').classList.toggle('active',!!(fromDate||toDate));
  if(activeTrack)loadLeaderboard(activeTrack,activeCar);
  toast('Saison-Filter angewendet','var(--we)');
}
function clearSeasonFilter(){
  fromDate=toDate='';
  document.getElementById('from-date').value='';
  document.getElementById('to-date').value='';
  document.getElementById('filter-info').textContent='';
  document.getElementById('filter-btn').classList.remove('active');
  if(activeTrack)loadLeaderboard(activeTrack,activeCar);
}

/* ── Keyboard Shortcuts ── */
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT')return;
  const pages=['strecken','aktivitaet','rekorde','meisterschaft','h2h','meine','last','fahrer'];
  const n=parseInt(e.key);
  if(n>=1&&n<=8){
    const btn=document.querySelector(`.navbtn[data-page="${pages[n-1]}"]`);
    if(btn)btn.click();
    return;
  }
  if(e.key==='/'&&!searchOpen){e.preventDefault();toggleSearch();}
  if(e.key==='Escape'){if(searchOpen)toggleSearch();document.getElementById('modal').classList.remove('active');}
  if(e.key==='c'||e.key==='C'){toggleCompact();}
  if(e.key==='t'||e.key==='T'){toggleTheme();}
});

/* ── URL Routing ── */
function applyHash(){
  const h=window.location.hash.slice(1);
  if(!h)return;
  const [page,track]=h.split('/');
  const btn=document.querySelector(`.navbtn[data-page="${page}"]`);
  if(btn){btn.click();}
  if(track&&page==='strecken'){
    setTimeout(()=>{
      const tb=document.querySelector(`.ttab[data-track="${track}"]`);
      if(tb)tb.click();
    },400);
  }
}
window.addEventListener('hashchange',applyHash);
function setHash(page,track=''){window.location.hash=track?`${page}/${track}`:page;}

/* ── Swipe Gestures ── */
let swipeX=null;
document.addEventListener('touchstart',e=>{swipeX=e.touches[0].clientX;},{passive:true});
document.addEventListener('touchend',e=>{
  if(swipeX===null)return;
  const dx=e.changedTouches[0].clientX-swipeX;
  swipeX=null;
  if(Math.abs(dx)<60)return;
  const btns=[...document.querySelectorAll('.mnav-btn')];
  const active=btns.findIndex(b=>b.classList.contains('active'));
  if(dx<0&&active<btns.length-1)btns[active+1].click();
  else if(dx>0&&active>0)btns[active-1].click();
});

/* ── Pill Animation ── */
/* ═══════════════════════════════════════════════
   iOS 26 Liquid Glass Pill Animation
   Korrekt nach Apple Video: Blob-Expand → Contract
   ═══════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════
   Liquid Glass Pill Animation — Cross-Browser Final
   Double-rAF garantiert echten Frame zwischen Phase 0/1
   ═══════════════════════════════════════════════════ */

const _pillTarget = {};
const _pillTimer  = {};

function movePill(navId, bgId, lineId, el) {
  const scrollEl = document.getElementById(navId);
  const wrapEl   = (navId === 'main-nav')
    ? (document.getElementById('nav-wrap') || scrollEl)
    : scrollEl;
  if (!scrollEl || !el) return;
  const nr     = wrapEl.getBoundingClientRect();
  const er     = el.getBoundingClientRect();
  const toLeft = er.left - nr.left + (scrollEl.scrollLeft || 0);
  const toW    = er.width;
  const pillId = (bgId === 'sp-pill') ? 'sp-pill' : bgId;
  liquidGlassPill(pillId, toLeft, toW, wrapEl);
}

function liquidGlassPill(pillId, toLeft, toW, trackEl) {
  const pill = document.getElementById(pillId);
  if (!pill) return;

  /* Startposition: _pillTarget (race-safe) oder style.left (von initPill) */
  const prev = _pillTarget[pillId];
  const curL = prev ? prev.left  : (parseFloat(pill.style.left)  || toLeft);
  const curW = prev ? prev.width : (parseFloat(pill.style.width) || toW);

  /* Ziel speichern + laufenden Phase-2-Timer abbrechen */
  _pillTarget[pillId] = { left: toLeft, width: toW };
  if (_pillTimer[pillId]) {
    clearTimeout(_pillTimer[pillId]);
    _pillTimer[pillId] = null;
  }

  const dist = Math.abs(toLeft - curL);

  /* Kleine Bewegung → direkt */
  if (dist < 4) {
    pill.style.transition = 'left 300ms cubic-bezier(.34,1.56,.64,1), width 300ms cubic-bezier(.34,1.56,.64,1)';
    pill.style.left  = toLeft + 'px';
    pill.style.width = toW    + 'px';
    return;
  }

  /* Blob: beide Tabs abdecken */
  const blobL = Math.min(curL, toLeft);
  const blobW = Math.max(curL + curW, toLeft + toW) - blobL;

  /* Phase 0: Transition aus, auf Startposition snappen */
  pill.style.transition = 'none';
  pill.style.left  = curL + 'px';
  pill.style.width = curW + 'px';

  /* DOUBLE-rAF: garantiert echten gerenderten Frame vor Phase 1.
     Kein offsetWidth-Hack – das funktioniert nicht cross-browser.  */
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {

      /* Phase 1: Expand zu Blob ~130ms ease-in */
      pill.style.transition = 'left 130ms cubic-bezier(.4,0,.6,1), width 130ms cubic-bezier(.4,0,.6,1)';
      pill.style.left  = blobL + 'px';
      pill.style.width = blobW + 'px';

      /* Phase 2: Spring-Contract zu Ziel ~360ms */
      _pillTimer[pillId] = setTimeout(function() {
        _pillTimer[pillId] = null;
        pill.style.transition = 'left 360ms cubic-bezier(.34,1.56,.64,1), width 360ms cubic-bezier(.34,1.56,.64,1)';
        pill.style.left  = toLeft + 'px';
        pill.style.width = toW    + 'px';
      }, 138);

    });
  });
}






function initPill(navId,bgId,lineId,cls){
  const nav=document.getElementById(navId);
  if(!nav)return;
  const active=nav.querySelector('.'+cls+'.active');
  if(!active)return;
  const pillId=(navId==='sub-tabs')?'sp-pill':bgId;
  const pill=document.getElementById(pillId);
  if(!pill)return;
  const wrap = (navId === 'main-nav') 
    ? (document.getElementById('nav-wrap') || nav) 
    : nav;
  const nr=wrap.getBoundingClientRect();
  const er=active.getBoundingClientRect();
  const left=er.left-nr.left+(nav.scrollLeft||0);
  const trackH=nr.height;
  const normalH=trackH-8;
  pill.style.transition='none';
  pill.style.left=left+'px';
  pill.style.width=er.width+'px';
  /* Startposition für Liquid-Animation registrieren */
  _pillTarget[pillId]={left:left,width:er.width};
  pill.offsetWidth; pill.style.transition='';
}

/* ── Navigation ── */
function gotoPage(id,el){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.navbtn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.mnav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+id).classList.add('active');
  if(el){el.classList.add('active');movePill('main-nav','np-bg','np-line',el);}
  const mb=document.getElementById('mb-'+id);if(mb)mb.classList.add('active');
  setHash(id,activeTrack||'');
  if(id==='aktivitaet')loadActivity();
  else if(id==='rekorde')loadRekorde();
  else if(id==='meisterschaft')loadChampionship();
  else if(id==='h2h')prepH2H();
  else if(id==='meine')prepMyPage();
  else if(id==='last')loadLastSession();
  else if(id==='fahrer')loadAllDrivers();
  else if(id==='statistik')loadStatistik();
  else if(id==='teams')loadTeams();
}
function mobileNav(id,el){
  document.querySelectorAll('.mnav-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  const nbtn=document.querySelector(`.navbtn[data-page="${id}"]`);
  if(nbtn)gotoPage(id,nbtn);
  else gotoPage(id,null);
}
function toggleMoreMenu(){
  const nbtn=document.querySelector('.navbtn[data-page="rekorde"]');
  if(nbtn)gotoPage('rekorde',nbtn);
}
function gotoPanel(id,el){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.segtab').forEach(b=>b.classList.remove('active'));
  document.getElementById('panel-'+id).classList.add('active');
  el.classList.add('active');
  /* Use liquid animation for sub-tabs too */
  const seg=document.getElementById('sub-tabs');
  if(seg){
    const nr=seg.getBoundingClientRect();
    const er=el.getBoundingClientRect();
    const toLeft=er.left-nr.left+(seg.scrollLeft||0);
    liquidGlassPill('sp-pill',toLeft,er.width,seg);
  }
  if(id==='quali')renderQuali();
}

/* ── Stats ── */
async function loadStats(){
  try{
    const s=await apiGet('/stats');
    document.getElementById('s-drv').textContent=s.total_drivers??'—';
    document.getElementById('s-sess').textContent=s.total_sessions??'—';
    document.getElementById('s-trk').textContent=s.total_tracks??'—';
    document.getElementById('footer-laps').textContent=(s.total_laps??'—')+' Runden gesamt';
    if(s.fastest_overall){document.getElementById('s-best').textContent=s.fastest_overall.best_laptime;document.getElementById('s-best-sub').textContent=s.fastest_overall.player_name+' · '+tn(s.fastest_overall.track);}
  }catch(e){}
}

/* ── Tracks ── */
async function loadTracks(){
  try{
    const tracks=await apiGet('/tracks');
    const el=document.getElementById('track-tabs');
    if(!tracks.length){el.innerHTML='<div style="color:var(--tx3);font-size:13px">Noch keine Sessions.</div>';return;}
    el.innerHTML='';
    let sparklines={};
    const mySid=localStorage.getItem('acc-my-steam');
    if(mySid){try{sparklines=await apiGet('/sparklines/'+encodeURIComponent(mySid));}catch(e){}}

    tracks.forEach((t,i)=>{
      const b=document.createElement('button');
      b.className='ttab'+(i===0?' active':'');
      b.dataset.track=t.track;
      // Sparkline
      const vals=sparklines[t.track]||[];
      let spark='';
      if(vals.length>1){
        const mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||1;
        spark='<div class="ttab-sparkline">'+vals.map(v=>{
          const h=Math.round(2+((mx-v)/rng)*12);
          return`<span style="height:${h}px"></span>`;
        }).join('')+'</div>';
      }
      b.innerHTML=tn(t.track)+spark;
      b.onclick=()=>selectTrack(t.track,b);
      el.appendChild(b);
    });
    // Target track dropdown
    const tsel=document.getElementById('target-track');
    if(tsel){tsel.innerHTML='<option value="">Alle Strecken</option>'+tracks.map(t=>`<option value="${t.track}">${tn(t.track)}</option>`).join('');}
    selectTrack(tracks[0].track,el.querySelector('.ttab'));
  }catch(e){}
}
async function selectTrack(t,btn){
  document.querySelectorAll('.ttab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  activeTrack=t; activeCar=null;
  document.getElementById('lb-lbl').textContent=tn(t);
  setHash('strecken',t);
  // Skeleton
  document.getElementById('leaderboard').innerHTML=skel(5);
  loadCars(t); loadLeaderboard(t,null); loadSessions(t); loadPenalties(t); loadAnalyse(t);
}

/* ── Car filter ── */
async function loadCars(t){
  const el=document.getElementById('car-filter');
  try{
    const cars=await apiGet('/cars/'+encodeURIComponent(t));
    if(!cars.length){el.innerHTML='';return;}
    let h='<button class="chip active" onclick="pickCar(null,this)">Alle</button>';
    cars.forEach(c=>{h+=`<button class="chip" onclick="pickCar('${esc(c.car)}',this)">${esc(c.car)} <span style="opacity:.45;font-size:11px">${c.laps}</span></button>`;});
    el.innerHTML=h;
  }catch(e){el.innerHTML='';}
}
function pickCar(car,btn){activeCar=car;document.querySelectorAll('.chip').forEach(b=>b.classList.remove('active'));btn.classList.add('active');loadLeaderboard(activeTrack,car);}

/* ── Leaderboard ── */
async function loadLeaderboard(t,car){
  const el=document.getElementById('leaderboard');
  el.innerHTML=skel(5);
  try{
    let url='/leaderboard/'+encodeURIComponent(t);
    const params=[];
    if(car)params.push('car='+encodeURIComponent(car));
    if(fromDate)params.push('from_date='+fromDate);
    if(toDate)params.push('to_date='+toDate);
    if(params.length)url+='?'+params.join('&');
    const rows=await apiGet(url);
    lastRows=rows;
    // Check for new records
    if(refreshCount>0){
      rows.forEach(r=>{
        const k=r.track||t;
        if(prevRecords[k]&&r.position===1&&r.best_ms<prevRecords[k]){
          toast(`🏆 Neuer Streckenrekord! ${r.player_name} — ${r.best_laptime} auf ${tn(k)}`,'var(--gold)');
        }
      });
    }
    if(rows.length)prevRecords[t]=rows[0].best_ms;

    if(!rows.length){el.innerHTML='<div class="load">Keine Daten.</div>';renderSectors([]);return;}
    const pc=['','p1','p2','p3'],nc=['','g','s','b'];
    let h=`<div class="ios-list-head"><span>#</span><span>Fahrer</span><span class="hcar">Fahrzeug</span><span>Bestzeit</span><span>Gap</span><span class="hlaps" style="text-align:right">Rdn</span></div>`;
    rows.forEach((r,i)=>{
      h+=`<div class="ios-list-row ${pc[i]||''}" onclick="openModal('${esc(r.steam_id)}','${esc(r.player_name)}',${i})">
        <div class="lbpos ${nc[i]||''}">${i===0?'▲':r.position}</div>
        <div class="lbdrv"><div class="lbav ${avc(i)}">${ini(r.player_name)}</div>
          <div><div class="lbn">${esc(r.player_name)}</div><div class="lbs">${esc(r.steam_id)}</div></div>
        </div>
        <div class="lbcar">${esc(r.car)}</div>
        <div class="lbtm ${i===0?'best':''}">${r.best_laptime}</div>
        <div class="lbgap">${r.gap}</div>
        <div class="lblaps">${r.total_laps}</div>
      </div>`;
    });
    el.innerHTML=h;
    renderSectors(rows);
    // CSV button
    document.getElementById('csv-btn-wrap').innerHTML=`<button class="csv-btn" onclick="exportCSV()"><i class="ti ti-download"></i> CSV</button>`;
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}

function renderSectors(rows){
  document.getElementById('sector-bests').innerHTML=['best_s1','best_s2','best_s3'].map((k,i)=>{
    const s=rows.filter(r=>r[k]&&r[k]!=='—').sort((a,b)=>{const ta=a[k].split(':'),tb=b[k].split(':');return(parseFloat(ta[0])*60+parseFloat(ta[1]))-(parseFloat(tb[0])*60+parseFloat(tb[1]));});
    const best=s[0];
    return`<div class="seccard"><div class="sec-num">Sektor ${i+1}</div><div class="sec-drv">${best?esc(best.player_name):'—'}</div><div class="sec-tm">${best?best[k]:'—'}</div></div>`;
  }).join('');
}

/* ── CSV Export ── */
function exportCSV(){
  if(!lastRows.length)return;
  const cols=['position','player_name','car','best_laptime','gap','total_laps'];
  const h=cols.join(',');
  const rows=lastRows.map(r=>cols.map(c=>JSON.stringify(r[c]??'')).join(','));
  const csv=h+'\n'+rows.join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download=`acc_${activeTrack}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  toast('CSV exportiert','var(--te)');
}

/* ── Qualifying Grid ── */
function renderQuali(){
  const el=document.getElementById('quali-wrap');
  if(!lastRows.length){el.innerHTML='<div class="load">Keine Daten.</div>';return;}
  const rows=[...lastRows].sort((a,b)=>a.best_ms-b.best_ms);
  const leader=rows[0].best_ms,maxGap=rows[rows.length-1].best_ms-leader||1;
  const grads=['linear-gradient(90deg,var(--pu),#8a60f0)','linear-gradient(90deg,var(--te),#00a870)','linear-gradient(90deg,var(--or),#d48000)'];
  const pcols=['var(--gold)','var(--tx2)','var(--or)'];
  let h=`<div class="ios-list glass" style="margin-bottom:0">`;
  rows.forEach((r,i)=>{
    const gap=r.best_ms-leader,pct=i===0?100:Math.max(12,100-(gap/maxGap*88));
    h+=`<div class="quali-row">
      <div class="quali-pos" style="color:${pcols[i]||'var(--tx3)'}">P${i+1}</div>
      <div class="quali-bw">
        <div class="quali-bar" style="width:${pct}%;background:${grads[i]||'var(--fill2)'}"></div>
        <div class="quali-name">${esc(r.player_name)}</div>
        <div class="quali-car">${esc(r.car)}</div>
      </div>
      <div><div class="quali-time">${r.best_laptime}</div><div class="quali-gap">${i===0?'Pole Position':'+'+fmt(gap)}</div></div>
    </div>`;
  });
  el.innerHTML=h+'</div>';
}

/* ── Sessions ── */
async function loadSessions(t){
  const el=document.getElementById('sessions-wrap');el.innerHTML=skel(4,'skel-row sm');
  try{
    const rows=await apiGet('/sessions/'+encodeURIComponent(t));
    if(!rows.length){el.innerHTML='<div class="load">Keine Sessions.</div>';return;}
    // Stint wird separat über loadAllStintSessions() befüllt
    let h=`<div class="sess-wrap glass"><div class="sess-head"><span>Datum (Berlin)</span><span>Server</span><span>Wetter</span><span>Typ</span><span>Temp</span><span>Fahr.</span><span>Runden</span></div>`;
    rows.forEach(r=>{
      const wet=r.is_wet?'<span class="badge-wet">💧 Nass</span>':'<span class="badge-dry">☀ Trocken</span>';
      const temp=r.ambient_temp>0?`<span style="font-family:var(--mo);font-size:12px;color:var(--tx2)">🌡${r.ambient_temp}°C</span>`:'<span style="color:var(--tx3)">—</span>';
      h+=`<div class="sess-row"><div style="font-family:var(--mo);font-size:12px;color:var(--tx2)">${r.timestamp_berlin}</div><div style="font-size:13px;color:var(--tx2)">${esc(r.server_name||'—')}</div><div>${wet}</div><div style="font-family:var(--f1);font-size:9px;letter-spacing:1px;color:var(--tx2)">${STYP[r.session_type]||r.session_type}</div><div>${temp}</div><div style="font-family:var(--mo);font-size:13px">${r.driver_count||0}</div><div style="font-family:var(--mo);font-size:13px">${r.lap_count||0}</div></div>`;
    });
    el.innerHTML=h+'</div>';
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}

/* ── Penalties ── */
async function loadPenalties(t){
  const el=document.getElementById('strafen-wrap');el.innerHTML=skel(3,'skel-row sm');
  try{
    const rows=await apiGet('/penalties/'+encodeURIComponent(t));
    if(!rows.length){el.innerHTML='<div class="okbox">✓ Keine Strafen</div>';return;}
    let h=`<div class="pen-wrap glass"><div class="pen-head"><span>Datum (Berlin)</span><span>Fahrer</span><span>Strafe</span><span>Grund</span></div>`;
    rows.forEach(r=>{h+=`<div class="pen-row"><div style="font-family:var(--mo);font-size:12px;color:var(--tx2)">${r.timestamp_berlin}</div><div style="font-size:14px;font-weight:700">${esc(r.player_name)}</div><div><span class="badge-pen">${esc(r.penalty_type)}</span></div><div style="font-size:13px;color:var(--tx3)">${esc(r.reason)}</div></div>`;});
    el.innerHTML=h+'</div>';
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}

/* ── Analyse ── */
function scBadge(val,g,all){if(!val||val<=0)return'sb-wh';const s=[...new Set(all.filter(v=>v>0))].sort((a,b)=>a-b);const r=s.indexOf(val);if(r===0)return'sb-pu';if(r===1)return'sb-gr';return'sb-ye';}
async function loadAnalyse(t){
  const el=document.getElementById('analyse-wrap');el.innerHTML=skel(3,'skel-card');
  try{const data=await apiGet('/analysis/'+encodeURIComponent(t));renderAnalyse(data,t);}
  catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}
function renderAnalyse(data,t){
  const el=document.getElementById('analyse-wrap'),dr=data.drivers;
  if(!dr.length){el.innerHTML='<div class="load">Keine Daten.</div>';return;}
  const lead=dr[0],maxGap=dr[dr.length-1].best_ms-lead.best_ms||1;
  const as1=dr.map(d=>d.best_s1).filter(v=>v>0),as2=dr.map(d=>d.best_s2).filter(v=>v>0),as3=dr.map(d=>d.best_s3).filter(v=>v>0);
  const cs=[...dr].sort((a,b)=>b.consistency_pct-a.consistency_pct),bc=cs[0]?.consistency_pct||100;
  const gcol=i=>(['linear-gradient(90deg,var(--pu),#9a60f0)','linear-gradient(90deg,var(--te),#00a870)','linear-gradient(90deg,var(--gold),#d49000)'][i])||'linear-gradient(90deg,var(--tx3),#2a3040)';
  el.innerHTML=`<div class="ag">
    <div class="ios-card glass"><div class="ios-card-title">Gap zum Führenden</div>
      ${dr.map((d,i)=>{const gap=d.best_ms-lead.best_ms,pct=i===0?100:Math.max(8,100-(gap/maxGap*85));return`<div class="gap-row"><div class="gap-name">${esc(d.player_name)}</div><div class="gap-bw"><div class="gap-bar" style="width:${pct}%;background:${gcol(i)}">${i===0?'Leader':'+'+fmt(gap)}</div></div><div class="gap-val">${d.best_laptime}</div></div>`;}).join('')}
    </div>
    <div class="ios-card glass"><div class="ios-card-title">Konsistenz</div>
      ${cs.map(d=>{const pct=d.consistency_pct,bp=(pct/bc*100),col=pct>97?'var(--te)':pct>93?'var(--pu)':pct>88?'var(--gold)':'var(--red)';return`<div class="con-row"><div class="con-name">${esc(d.player_name)}</div><div class="con-bw"><div class="con-bar" style="width:${bp}%;background:${col}"></div></div><div class="con-pct" style="color:${col}">${pct}%</div><div class="con-std">±${d.std_dev}</div></div>`;}).join('')}
    </div>
    <div class="ios-card full"><div class="ios-card-title">Sektor-Vergleich · ${esc(tn(t))}</div>
      <div class="sv-row"><div class="sv-blk sv1">S1</div><div class="sv-con"></div><div class="sv-blk sv2">S2</div><div class="sv-con"></div><div class="sv-blk sv3">S3</div>
        <div style="margin-left:12px;font-size:12px;color:var(--tx2);display:flex;gap:12px;flex-wrap:wrap"><span><span style="color:var(--pu);font-weight:700">■</span> Schnellster</span><span><span style="color:var(--te);font-weight:700">■</span> 2. Schnellster</span><span><span style="color:var(--gold);font-weight:700">■</span> Restliche</span></div>
      </div>
      <table class="ios-table"><thead><tr><th>Fahrer</th><th>Auto</th><th>S1</th><th>S2</th><th>S3</th><th>Best</th><th>Rdn</th></tr></thead><tbody>
        ${dr.map(d=>{const c1=scBadge(d.best_s1,data.global_s1,as1),c2=scBadge(d.best_s2,data.global_s2,as2),c3=scBadge(d.best_s3,data.global_s3,as3);return`<tr><td class="nm">${esc(d.player_name)}</td><td style="font-size:12px;color:var(--tx3)">${esc(d.car||'—')}</td><td><span class="${c1}">${d.best_s1_str}</span></td><td><span class="${c2}">${d.best_s2_str}</span></td><td><span class="${c3}">${d.best_s3_str}</span></td><td style="color:var(--pu);font-weight:700;font-size:15px">${d.best_laptime}</td><td style="color:var(--tx2)">${d.lap_count}</td></tr>`;}).join('')}
        <tr style="border-top:1px solid var(--sep2)"><td class="nm" style="color:var(--tx3)">Theoretisches Optimum</td><td></td><td><span class="sb-pu">${data.global_s1_str}</span></td><td><span class="sb-pu">${data.global_s2_str}</span></td><td><span class="sb-pu">${data.global_s3_str}</span></td><td style="color:var(--tx3)">${fmt(data.global_s1+data.global_s2+data.global_s3)}</td><td></td></tr>
      </tbody></table>
    </div>
    <div class="ios-card full"><div class="ios-card-title">Rundenzeit-Verlauf</div>
      <div class="pb-row" id="pb-row">${dr.map((d,i)=>`<button class="pb-btn${i===0?' active':''}" onclick="pickProg('${esc(d.steam_id)}',this)">${esc(d.player_name)}</button>`).join('')}</div>
      <div id="prog-wrap"></div>
    </div>
    <div class="ios-card glass"><div class="ios-card-title">Schnellstes Fahrzeug</div>
      ${data.car_ranking.map((c,i)=>`<div class="cr-row" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:.5px solid var(--sep)"><div style="font-family:var(--f1);font-size:15px;font-weight:700;width:26px;text-align:center;color:${i===0?'var(--gold)':i===1?'var(--tx2)':i===2?'var(--or)':'var(--tx3)'}">${i+1}</div><div style="flex:1;font-size:15px;color:var(--tx)">${esc(c.car)}</div><div style="text-align:right"><div style="font-family:var(--mo);font-size:14px;color:var(--pu);font-weight:700">${c.best_laptime}</div><div style="font-family:var(--mo);font-size:11px;color:var(--tx3)">${c.drivers} Fahr · ${c.laps} Rdn</div></div></div>`).join('')}
    </div>
    <div class="ios-card glass"><div class="ios-card-title">Fahrer-Statistik</div>
      ${dr.map(d=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:.5px solid var(--sep)"><div><div style="font-size:16px;font-weight:700;color:var(--tx)">${esc(d.player_name)}</div><div style="font-family:var(--mo);font-size:11px;color:var(--tx3);margin-top:2px">${d.lap_count} Runden</div></div><div style="text-align:right"><div style="font-family:var(--mo);font-size:14px;color:var(--pu);font-weight:700">${d.best_laptime}</div><div style="font-family:var(--mo);font-size:11px;color:var(--tx3);margin-top:2px">Avg: ${d.avg_laptime}</div></div></div>`).join('')}
    </div>
  </div>`;
  renderProgChart(dr[0]?.steam_id,t);
}
async function pickProg(sid,btn){document.querySelectorAll('.pb-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderProgChart(sid,activeTrack);}
async function renderProgChart(sid,t){
  const wrap=document.getElementById('prog-wrap');if(!wrap)return;
  wrap.innerHTML='<div class="skeleton" style="height:120px;border-radius:10px"></div>';
  try{
    const laps=await apiGet('/laps/'+encodeURIComponent(t)+'/'+encodeURIComponent(sid));
    if(!laps.length){wrap.innerHTML='<div style="color:var(--tx3);font-size:13px;padding:8px">Keine Runden.</div>';return;}
    const times=laps.map(l=>l.laptime_ms),minT=Math.min(...times),maxT=Math.max(...times);
    const buf=Math.max((maxT-minT)*.12,500),lo=minT-buf,hi=maxT+buf,rng=hi-lo;
    const W=800,H=160,PL=86,PR=20,PT=14,PB=28,CW=W-PL-PR,CH=H-PT-PB,n=laps.length;
    const px=i=>PL+i*(n>1?CW/(n-1):0),py=ms=>PT+((hi-ms)/rng)*CH;
    const pts=laps.map((l,i)=>({x:px(i),y:py(l.laptime_ms),l}));
    const lineD=pts.map((p,i)=>`${i===0?'M':'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaD=`${lineD} L${pts[pts.length-1].x},${PT+CH} L${PL},${PT+CH} Z`;
    const yL=Array.from({length:5},(_,i)=>{const f=i/4,msV=lo+f*rng,yP=PT+(1-f)*CH;return`<text x="${PL-5}" y="${yP.toFixed(1)}" font-size="10" fill="rgba(128,128,128,.5)" text-anchor="end" dominant-baseline="middle">${fmt(Math.round(msV))}</text><line x1="${PL}" y1="${yP.toFixed(1)}" x2="${PL+CW}" y2="${yP.toFixed(1)}" stroke="rgba(128,128,128,.08)" stroke-width="1"/>`;}).join('');
    const xS=Math.max(1,Math.ceil(n/12)),xL=laps.filter((_,i)=>i%xS===0||i===n-1).map((_,j)=>{const idx=Math.min(j*xS,n-1);return`<text x="${px(idx).toFixed(1)}" y="${PT+CH+18}" font-size="10" fill="rgba(128,128,128,.5)" text-anchor="middle">R${idx+1}</text>`;}).join('');
    const pu=theme==='dark'?'#bf5af2':'#af52de';
    const dots=pts.map(p=>`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.l.is_pb?7:4}" fill="${p.l.is_pb?pu:'rgba(128,128,128,.5)'}" stroke="${p.l.is_pb?'rgba(255,255,255,.8)':'none'}" stroke-width="${p.l.is_pb?2:0}"><title>R${p.l.lap_num}: ${p.l.laptime}${p.l.is_pb?' ★':''}</title></circle>`).join('');
    wrap.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible"><defs><linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${pu}" stop-opacity=".2"/><stop offset="100%" stop-color="${pu}" stop-opacity=".02"/></linearGradient></defs><line x1="${PL}" y1="${PT}" x2="${PL}" y2="${PT+CH}" stroke="rgba(128,128,128,.15)" stroke-width="1"/><line x1="${PL}" y1="${PT+CH}" x2="${PL+CW}" y2="${PT+CH}" stroke="rgba(128,128,128,.15)" stroke-width="1"/>${yL}${xL}<path d="${areaD}" fill="url(#gp)"/><path d="${lineD}" fill="none" stroke="${pu}" stroke-width="2.5" stroke-linejoin="round"/>${dots}</svg><div style="font-family:var(--mo);font-size:12px;color:var(--tx3);margin-top:5px;text-align:center">${n} Runden · Best: ${fmt(Math.min(...times))} · Avg: ${fmt(Math.round(times.reduce((a,b)=>a+b,0)/n))}</div>`;
  }catch(e){wrap.innerHTML=`<div class="errbox">${e.message}</div>`;}
}

/* ── Activity Feed ── */
async function loadActivity(){
  const el=document.getElementById('activity-wrap');
  el.innerHTML=skel(6,'skel-row');
  try{
    let url='/activity?limit=80';
    if(fromDate)url+=`&from_date=${fromDate}`;
    if(toDate)url+=`&to_date=${toDate}`;
    const items=await apiGet(url);
    if(!items.length){el.innerHTML='<div class="load">Noch keine Aktivitäten.</div>';return;}
    let h=''
      +'<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;font-size:12px;color:var(--tx2);align-items:center">'
      +'<span style="font-family:var(--f1);font-size:10px;letter-spacing:1px;color:var(--tx3)">LEGENDE:</span>'
      +'<span><span class="badge-rec">REKORD</span>&nbsp;Neuer Streckenrekord</span>'
      +'<span><span class="badge-pb">PB</span>&nbsp;Persönliche Bestzeit</span>'
      +'</div>'
      +'<div class="act-feed ios-list glass">';
    items.forEach(r=>{
      const icon=r.is_record?'🏆':r.is_pb?'⚡':'🔵';
      const cls=r.is_record?'rec':r.is_pb?'pb':'lap';
      const badge=r.is_record?'<span class="badge-rec">REKORD</span>':r.is_pb?'<span class="badge-pb">PB</span>':'';
      h+=`<div class="act-item">
        <div class="act-icon ${cls}">${icon}</div>
        <div class="act-main">
          <div class="act-driver">${esc(r.player_name)}${badge}</div>
          <div class="act-detail">${esc(tn(r.track))} · ${esc(r.car)}${r.is_wet?' 💧':''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div class="act-time-display">${r.laptime}</div>
          <div class="act-meta">${r.timestamp_berlin}</div>
        </div>
      </div>`;
    });
    el.innerHTML=h+'</div>';
    const achSel=document.getElementById('ach-sel');
    if(achSel&&allDrivers.length){
      achSel.innerHTML='<option value="">— wählen —</option>'+allDrivers.map(d=>`<option value="${esc(d.steam_id)}">${esc(d.player_name)}</option>`).join('');
      const saved=localStorage.getItem('acc-my-steam');
      if(saved)achSel.value=saved;
    }
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}

/* ── Achievements ── */
async function loadAchievements(){
  const sid=document.getElementById('ach-sel').value,el=document.getElementById('achievements-wrap');
  if(!sid){el.innerHTML='<div class="load" style="padding:30px">Wähle einen Fahrer</div>';return;}
  el.innerHTML=skel(4,'skel-card');
  try{
    const achs=await apiGet('/achievements/'+encodeURIComponent(sid));
    const earned=achs.filter(a=>a.earned).length;
    document.getElementById('ach-driver-name').textContent=`${earned}/${achs.length} erhalten`;
    let h='<div class="ach-grid">';
    achs.forEach(a=>{
      h+=`<div class="ach-card glass ${a.earned?'earned':''}">
        <div class="ach-emoji">${a.emoji}</div>
        <div><div class="ach-name">${esc(a.name)}</div><div class="ach-desc">${esc(a.desc)}</div></div>
      </div>`;
    });
    el.innerHTML=h+'</div>';
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}

/* ── Rekorde ── */
async function loadRekorde(){
  loadRecords(); loadElo(); loadWeatherStats(); loadImprovementOverview();
}
async function loadRecords(){
  const el=document.getElementById('records-wrap');el.innerHTML=skel(5,'skel-row sm');
  try{
    const rows=await apiGet('/records');
    if(!rows.length){el.innerHTML='<div class="load">Keine Daten.</div>';return;}
    let h=`<div class="rec-list glass"><div class="rec-head"><span>Strecke</span><span>Fahrer</span><span>Fahrzeug</span><span>Rekordzeit</span></div>`;
    rows.forEach(r=>{h+=`<div class="rec-row"><div><div style="font-size:16px;font-weight:700;color:var(--tx)">${esc(tn(r.track))}</div><div style="font-family:var(--mo);font-size:11px;color:var(--tx3);margin-top:2px">${r.record_date}</div></div><div style="font-size:15px;font-weight:700;color:var(--tx2)">${esc(r.player_name)}</div><div style="font-size:13px;color:var(--tx3)">${esc(r.car)}</div><div style="font-family:var(--mo);font-size:18px;color:var(--pu);font-weight:700">${r.best_laptime}</div></div>`;});
    el.innerHTML=h+'</div>';
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}
async function loadElo(){
  const el=document.getElementById('elo-wrap');el.innerHTML=skel(3,'skel-row');
  try{
    const rows=await apiGet('/elo');
    if(!rows.length){el.innerHTML='<div class="load">Keine ELO-Daten.</div>';return;}
    let h=`<div class="elo-info"><strong style="color:var(--tx)">⚡ LFM-kalibriertes Hybrid-ELO</strong> — 60% Speed-Rating + 40% Positions-ELO<div style="margin-top:8px;display:flex;gap:16px;flex-wrap:wrap;font-family:var(--mo);font-size:11px;color:var(--tx3)"><span>⚙ Iron 1000</span><span style="color:var(--or)">🥉 Bronze 1300</span><span style="color:var(--tx2)">🥈 Silver 1700</span><span style="color:var(--gold)">🥇 Gold 2500</span><span style="color:var(--te)">💎 Platinum 5000</span><span style="color:var(--pu)">🌟 Legend 6000</span><span style="color:var(--red)">👽 Alien 8000</span></div></div>
    <div class="elo-list glass"><div class="elo-head"><span>#</span><span>Fahrer</span><span>Lizenz</span><span>Hybrid-ELO</span><span>Speed / Pos</span><span>Siege · Sess</span></div>`;
    rows.forEach((r,i)=>{
      const pc=['var(--gold)','var(--tx2)','var(--or)'][i]||'var(--tx3)';
      h+=`<div class="elo-row"><div class="lbpos" style="color:${pc}">${r.rank}</div><div class="lbdrv"><div class="lbav ${avc(i)}">${ini(r.player_name)}</div><div><div class="lbn">${esc(r.player_name)}</div></div></div><div><span style="background:${r.license_color}20;color:${r.license_color};border:.5px solid ${r.license_color}50;border-radius:6px;padding:3px 12px;font-family:var(--f1);font-size:9px;letter-spacing:1px;font-weight:700">${r.license}</span></div><div><div class="elo-score" style="color:${pc}">${r.elo}</div></div><div style="font-family:var(--mo);font-size:12px"><div style="color:var(--te)">🚀 ${r.speed_elo}</div><div style="color:var(--tx3)">📊 ${r.position_elo}</div></div><div style="font-family:var(--mo);font-size:13px;color:var(--tx2)">🏆${r.wins}·${r.sessions}x</div></div>`;
    });
    const allT=[...new Set(rows.flatMap(r=>Object.keys(r.track_details||{})))];
    if(allT.length){h+=`</div><div style="margin-top:20px;font-family:var(--f1);font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--tx2);margin-bottom:12px">Speed-ELO pro Strecke</div><div style="overflow-x:auto"><table class="ios-table"><thead><tr><th>Fahrer</th>${allT.map(t=>`<th>${esc(tn(t))}</th>`).join('')}</tr></thead><tbody>`;rows.forEach(r=>{h+=`<tr><td class="nm">${esc(r.player_name)}</td>`;allT.forEach(t=>{const inf=(r.track_details||{})[t];if(inf){const e=inf.speed_elo,c=e>=2500?'var(--gold)':e>=1700?'var(--tx2)':e>=1300?'var(--or)':'var(--tx3)';h+=`<td><div style="font-family:var(--mo);font-size:13px;color:${c};font-weight:700">${e}</div><div style="font-size:11px;color:var(--tx3)">${inf.laptime}</div></td>`;}else h+=`<td style="color:var(--tx3)">—</td>`;});h+='</tr>';});h+='</tbody></table></div>';}
    else{h+='</div>';}
    el.innerHTML=h;
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}
async function loadWeatherStats(){
  const el=document.getElementById('weather-wrap');el.innerHTML=skel(3,'skel-card');
  try{
    const rows=await apiGet('/weather-stats');
    if(!rows.length){el.innerHTML='<div class="load">Noch keine Nass-Sessions.</div>';return;}
    let h='<div class="weather-grid">';
    rows.forEach(r=>{
      const dryR=100,wetR=r.wet_laps>0?Math.max(10,90):0;
      h+=`<div class="wcard glass">
        <div class="wcard-name">${esc(r.player_name)}</div>
        <div class="wrow"><div class="wlabel" style="color:var(--te);font-family:var(--f1);font-size:9px;letter-spacing:1px">☀ TROCKEN</div><div class="wbar-w"><div class="wbar" style="width:${dryR}%;background:var(--te)"></div></div><div class="wtime" style="color:var(--te)">${r.dry_best}</div></div>
        <div style="font-family:var(--mo);font-size:11px;color:var(--tx3);margin:2px 0 8px 0">Avg: ${r.dry_avg} · ${r.dry_laps} Runden</div>
        ${r.wet_laps>0?`<div class="wrow"><div class="wlabel" style="color:var(--we);font-family:var(--f1);font-size:9px;letter-spacing:1px">💧 NASS</div><div class="wbar-w"><div class="wbar" style="width:${wetR}%;background:var(--we)"></div></div><div class="wtime" style="color:var(--we)">${r.wet_best}</div></div><div style="font-family:var(--mo);font-size:11px;color:var(--tx3);margin-top:2px">Avg: ${r.wet_avg} · ${r.wet_laps} Runden</div>`
        :'<div style="font-size:12px;color:var(--tx3)">Noch keine Nass-Runden</div>'}
      </div>`;
    });
    el.innerHTML=h+'</div>';
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}
async function loadImprovementOverview(){
  const el=document.getElementById('impr-wrap');el.innerHTML=skel(4,'skel-row sm');
  try{
    let allData=[];
    for(const d of allDrivers){try{const im=await apiGet('/improvement/'+encodeURIComponent(d.steam_id));im.forEach(i=>allData.push({...i,player_name:d.player_name}));}catch(e){}}
    allData=allData.filter(d=>d.improved).sort((a,b)=>b.improvement_ms-a.improvement_ms);
    if(!allData.length){el.innerHTML='<div class="load">Noch keine Verbesserungen.</div>';return;}
    let h=`<div class="impr-list glass"><div class="impr-head"><span>Fahrer &amp; Strecke</span><span>Erste Zeit</span><span>Aktuelle Best</span><span>Verbesserung</span><span>%</span></div>`;
    allData.slice(0,20).forEach(r=>{h+=`<div class="impr-row"><div><div style="font-size:15px;font-weight:700;color:var(--tx)">${esc(r.player_name)}</div><div style="font-size:12px;color:var(--tx3)">${esc(tn(r.track))}</div></div><div style="font-family:var(--mo);font-size:14px;color:var(--tx3)">${r.first_laptime}</div><div style="font-family:var(--mo);font-size:14px;color:var(--pu);font-weight:700">${r.best_laptime}</div><div><span class="badge-impr">-${r.improvement_str}</span></div><div style="font-family:var(--mo);font-size:13px;color:var(--te);font-weight:700">${r.improvement_pct}%</div></div>`;});
    el.innerHTML=h+'</div>';
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}

/* ── Championship ── */
async function loadChampionship(){
  const el=document.getElementById('champ-wrap');el.innerHTML=skel(4,'skel-row');
  try{
    champData=await apiGet('/championship');
    const std=champData.standings,maxPts=std[0]?.points||1;
    const ptsCol=i=>['var(--gold)','var(--tx2)','var(--or)'][i]||'var(--tx3)';
    const barGrad=i=>(['linear-gradient(90deg,var(--gold),var(--or))','linear-gradient(90deg,var(--tx2),var(--tx3))','linear-gradient(90deg,var(--or),#a06000)'][i])||'var(--fill2)';
    let h=`<div class="sh"><span style="font-family:var(--f1);font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--tx2)">Fahrer-Meisterschaft</span><span style="font-family:var(--mo);font-size:11px;color:var(--tx3);margin-left:8px">F1-Punktesystem · ${champData.sessions.length} Wertungsrennen</span></div>
    <div class="champ-wrap glass"><div class="champ-head"><span>#</span><span>Fahrer</span><span>Punkte</span><span>Siege</span><span>Podien</span><span>Sess.</span></div>`;
    std.forEach((r,i)=>{
      const pct=Math.round((r.points/maxPts)*100);
      h+=`<div class="champ-row"><div class="lbpos" style="color:${ptsCol(i)}">${r.rank}</div>
        <div class="lbdrv"><div class="lbav ${avc(i)}">${ini(r.player_name)}</div>
          <div><div class="lbn">${esc(r.player_name)}</div>
            <div class="champ-bar-wrap"><div class="champ-bar" style="width:${pct}%;background:${barGrad(i)}"></div></div>
          </div>
        </div>
        <div><div class="champ-pts" style="color:${ptsCol(i)}">${r.points}</div></div>
        <div style="font-family:var(--mo);font-size:14px;color:var(--te)">🏆 ${r.wins}</div>
        <div style="font-family:var(--mo);font-size:14px;color:var(--tx2)">🥉 ${r.podiums}</div>
        <div style="font-family:var(--mo);font-size:13px;color:var(--tx3)">${r.sessions}</div>
      </div>`;
    });
    h+='</div>';
    // Session results table
    if(champData.sessions.length){
      const driverNames=std.map(d=>d.player_name);
      h+=`<div class="sh" style="margin-top:28px"><span style="font-family:var(--f1);font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--tx2)">Punktehistorie</span></div>
      <div class="champ-sess glass"><table><thead><tr><th>Rennen</th>${driverNames.map(n=>`<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>`;
      champData.sessions.forEach((sess,si)=>{
        h+=`<tr><td style="font-size:13px;color:var(--tx2);white-space:nowrap">R${si+1} · ${esc(tn(sess.track))}${sess.is_wet?' 💧':''}</td>`;
        driverNames.forEach(name=>{
          const r=sess.results.find(x=>x.name===name);
          if(r){
            const cls=r.position===1?'pts-gold':r.position===2?'pts-silver':r.position===3?'pts-bronze':'';
            h+=`<td class="${cls}" style="text-align:center">${r.points>0?r.points:'-'}</td>`;
          }else h+=`<td style="color:var(--tx3);text-align:center">—</td>`;
        });
        h+='</tr>';
      });
      h+='</tbody></table></div>';
    }
    el.innerHTML=h;
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}

/* ── H2H ── */
function prepH2H(){
  const s1=document.getElementById('h2h-s1'),s2=document.getElementById('h2h-s2');
  s1.innerHTML=s2.innerHTML='<option value="">— wählen —</option>';
  allDrivers.forEach(d=>{const o=`<option value="${esc(d.steam_id)}">${esc(d.player_name)}</option>`;s1.innerHTML+=o;s2.innerHTML+=o;});
}
async function loadH2H(){
  const id1=document.getElementById('h2h-s1').value,id2=document.getElementById('h2h-s2').value,el=document.getElementById('h2h-wrap');
  if(!id1||!id2||id1===id2){el.innerHTML='<div class="load" style="padding:60px">Wähle zwei verschiedene Fahrer</div>';return;}
  el.innerHTML=skel(5,'skel-row sm');
  try{
    const data=await apiGet(`/h2h/${encodeURIComponent(id1)}/${encodeURIComponent(id2)}`);
    if(!data.tracks.length){el.innerHTML='<div class="load">Keine gemeinsamen Strecken.</div>';return;}
    const c1=data.wins1>data.wins2?'var(--pu)':data.wins1<data.wins2?'var(--tx3)':'var(--gold)';
    const c2=data.wins2>data.wins1?'var(--pu)':data.wins2<data.wins1?'var(--tx3)':'var(--gold)';
    let h=`<div class="ios-card glass" style="margin-bottom:20px"><div class="h2h-score"><div><div class="h2h-num" style="color:${c1}">${data.wins1}</div><div class="h2h-name">${esc(data.name1)}</div></div><div class="h2h-vs">VS</div><div><div class="h2h-num" style="color:${c2}">${data.wins2}</div><div class="h2h-name">${esc(data.name2)}</div></div></div></div>
    <div class="h2h-list glass"><div class="h2h-head"><span>Strecke</span><span>${esc(data.name1)}</span><span>${esc(data.name2)}</span><span>Delta</span><span>S1 Δ</span><span>S2 Δ</span></div>`;
    data.tracks.forEach(t=>{
      const w1=t.winner===1,w2=t.winner===2;
      const dc=t.delta_ms<0?'var(--te)':t.delta_ms>0?'var(--or)':'var(--tx3)';
      const s1d=t.s1_1&&t.s1_2&&t.s1_1!=='—'&&t.s1_2!=='—'?fmt(Math.abs(parseT(t.s1_1)-parseT(t.s1_2))):'—';
      const s2d=t.s2_1&&t.s2_2&&t.s2_1!=='—'&&t.s2_2!=='—'?fmt(Math.abs(parseT(t.s2_1)-parseT(t.s2_2))):'—';
      h+=`<div class="h2h-row ${w1?'h2h-w1':w2?'h2h-w2':''}"><div style="font-size:15px;font-weight:700;color:var(--tx)">${esc(tn(t.track))}</div><div class="${w1?'h2h-win':'h2h-lose'}">${t.best1} ${w1?'🏆':''}</div><div class="${w2?'h2h-win':'h2h-lose'}">${t.best2} ${w2?'🏆':''}</div><div style="font-family:var(--mo);font-size:13px;color:${dc};font-weight:600">${t.delta_str}</div><div style="font-family:var(--mo);font-size:12px;color:var(--tx3)">${s1d}</div><div style="font-family:var(--mo);font-size:12px;color:var(--tx3)">${s2d}</div></div>`;
    });
    el.innerHTML=h+'</div>';
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}

/* ── Meine Seite ── */
function prepMyPage(){
  const sel=document.getElementById('my-sel'),saved=localStorage.getItem('acc-my-steam');
  sel.innerHTML='<option value="">— wählen —</option>';
  allDrivers.forEach(d=>{sel.innerHTML+=`<option value="${esc(d.steam_id)}" ${d.steam_id===saved?'selected':''}>${esc(d.player_name)}</option>`;});
  if(saved)loadMyPage();
}
async function loadMyPage(){
  const sid=document.getElementById('my-sel').value,el=document.getElementById('my-wrap');
  if(!sid){el.innerHTML='<div class="load" style="padding:60px">Wähle dein Profil</div>';return;}
  localStorage.setItem('acc-my-steam',sid);
  el.innerHTML=skel(4,'skel-card');
  try{
    const[stats,impr,elo]=await Promise.all([apiGet('/my-stats/'+encodeURIComponent(sid)),apiGet('/improvement/'+encodeURIComponent(sid)),apiGet('/elo')]);
    myPageData={stats,impr,elo,sid};
    renderMyPage();
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}
function renderMyPage(){
  if(!myPageData)return;
  const{stats,impr,elo,sid}=myPageData,el=document.getElementById('my-wrap');
  const myElo=elo.find(e=>e.steam_id===sid);
  const imprMap=Object.fromEntries(impr.map(i=>[i.track,i]));
  const targetStr=document.getElementById('target-time')?.value?.trim();
  const targetTrack=document.getElementById('target-track')?.value;
  const targetMs=targetStr?parseT(targetStr):0;

  let h=`<div class="my-stats-g"><div class="scard glass"><div class="scard-l">ELO-Rang</div><div class="scard-v" style="color:var(--gold)">${myElo?myElo.rank:'—'}</div><div class="scard-s">${myElo?myElo.elo+' Punkte':'—'}</div></div><div class="scard glass"><div class="scard-l">Lizenz</div><div class="scard-v" style="color:${myElo?.license_color||'var(--tx2)'};font-size:20px">${myElo?.license||'—'}</div><div class="scard-s">${myElo?'ELO: '+myElo.elo:'—'}</div></div><div class="scard glass"><div class="scard-l">Siege</div><div class="scard-v" style="color:var(--te)">${myElo?myElo.wins:'—'}</div><div class="scard-s">${myElo?myElo.sessions+' Sessions':'—'}</div></div><div class="scard glass"><div class="scard-l">Verbesserungen</div><div class="scard-v" style="color:var(--te)">${impr.filter(i=>i.improved).length}</div><div class="scard-s">von ${stats.tracks.length} Strecken</div></div></div>
  <div class="sh"><span style="font-family:var(--f1);font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--tx2)">Bestzeiten &amp; Sektor-Verluste</span>${targetMs>0?`<span style="font-family:var(--mo);font-size:11px;color:var(--tx3);margin-left:8px">Ziel: ${fmt(targetMs)}${targetTrack?' auf '+tn(targetTrack):' (alle Strecken)'}</span>`:''}</div>
  <div class="my-track-list glass"><div class="my-thead"><span>Strecke</span><span>Meine Best</span><span>Streckenrekord</span><span>Gap</span><span>S1 Δ</span><span>S2 Δ</span><span>S3 Δ</span></div>`;
  stats.tracks.forEach(t=>{
    const im=imprMap[t.track];
    const showTarget=targetMs>0&&(!targetTrack||targetTrack===t.track);
    const myBestMs=t.my_best_ms||parseT(t.my_best||'');
    const tgt=showTarget&&myBestMs?(myBestMs<=targetMs?`<span class="target-beat">✓ Ziel</span>`:`<span class="target-miss">+${fmt(myBestMs-targetMs)}</span>`):'';
    h+=`<div class="my-trow"><div><div style="font-size:15px;font-weight:700;color:var(--tx)">${esc(tn(t.track))}</div>${im&&im.improved?`<div style="font-family:var(--mo);font-size:10px;color:var(--te);margin-top:2px">▼ -${im.improvement_str} (${im.improvement_pct}%)</div>`:''}${tgt?`<div style="margin-top:3px">${tgt}</div>`:''}</div><div style="font-family:var(--mo);font-size:14px;color:var(--pu);font-weight:700">${t.my_best}</div><div style="font-family:var(--mo);font-size:14px;color:var(--tx3)">${t.record_laptime}</div><div style="font-family:var(--mo);font-size:14px;color:${t.gap_ms>0?'var(--or)':'var(--te)'};font-weight:700">${t.gap_str}</div><div>${t.s1_loss>0?`<span class="loss-bad">+${t.s1_loss_str}</span>`:'<span class="loss-ok">=</span>'}</div><div>${t.s2_loss>0?`<span class="loss-bad">+${t.s2_loss_str}</span>`:'<span class="loss-ok">=</span>'}</div><div>${t.s3_loss>0?`<span class="loss-bad">+${t.s3_loss_str}</span>`:'<span class="loss-ok">=</span>'}</div></div>`;
  });
  el.innerHTML=h+'</div>';
}

/* ── Last Session + Stint ── */
async function loadLastSession(){
  const el=document.getElementById('last-wrap');el.innerHTML=skel(5,'skel-row');
  try{
    const s=await apiGet('/last-session');if(!s){el.innerHTML='<div class="load">Keine Sessions.</div>';return;}
    // Strecke für Stint-Analyse merken
    window._lastSessionTrack = s.track;
    const wet=s.is_wet?'<span class="badge-wet">💧 Nass</span>':'<span class="badge-dry">☀ Trocken</span>';
    const pc=['','p1','p2','p3'],nc=['','g','s','b'];
    let h=`<div class="ls-top"><div><div style="font-family:var(--f1);font-size:24px;font-weight:700;margin-bottom:8px;color:var(--tx)">${esc(tn(s.track))}</div><div style="font-family:var(--mo);font-size:13px;color:var(--tx3);margin-bottom:14px">${s.timestamp_berlin} · ${esc(s.server_name||'—')}</div><div style="display:flex;gap:10px;flex-wrap:wrap">${wet} <span style="font-family:var(--f1);font-size:9px;letter-spacing:1px;background:var(--fill2);border:.5px solid var(--sep);border-radius:6px;padding:4px 12px;color:var(--tx2)">${STYP[s.session_type]||s.session_type}</span></div></div><div class="qr-box glass"><div class="qr-lbl">Dashboard-Link</div><div id="qrcode"></div><div style="font-family:var(--mo);font-size:10px;color:var(--tx3);margin-top:10px">${window.location.origin}</div></div></div>
    <div class="ls-info-g"><div class="ls-mini glass"><div class="ls-mini-l">Fahrer</div><div class="ls-mini-v">${s.drivers.length}</div></div><div class="ls-mini glass"><div class="ls-mini-l">Runden</div><div class="ls-mini-v">${s.total_laps}</div></div><div class="ls-mini glass"><div class="ls-mini-l">Schnellste Zeit</div><div class="ls-mini-v" style="color:var(--pu);font-family:var(--mo)">${s.drivers[0]?.best_laptime||'—'}</div></div></div>
    <div class="ls-lb glass"><div class="ls-lbh"><span>#</span><span>Fahrer</span><span class="hcar">Fahrzeug</span><span>Bestzeit</span><span>S1</span><span>S2</span><span>S3</span><span>Rdn</span></div>`;
    s.drivers.forEach((d,i)=>{h+=`<div class="ls-lbr ${pc[i]||''}"><div class="lbpos ${nc[i]||''}">${i===0?'▲':d.position}</div><div class="lbdrv"><div class="lbav ${avc(i)}">${ini(d.player_name)}</div><div><div class="lbn">${esc(d.player_name)}</div><div class="lbgap">${d.gap}</div></div></div><div class="lbcar">${esc(d.car)}</div><div class="lbtm ${i===0?'best':''}">${d.best_laptime}</div><div style="font-family:var(--mo);font-size:13px;color:var(--tx3)">${d.s1}</div><div style="font-family:var(--mo);font-size:13px;color:var(--tx3)">${d.s2}</div><div style="font-family:var(--mo);font-size:13px;color:var(--tx3)">${d.s3}</div><div class="lblaps">${d.laps}</div></div>`;});
    el.innerHTML=h+'</div>';
    try{new QRCode(document.getElementById('qrcode'),{text:window.location.origin,width:120,height:120,colorDark:theme==='dark'?'#bf5af2':'#af52de',colorLight:theme==='dark'?'#1c1c1e':'#ffffff',correctLevel:QRCode.CorrectLevel.M});}catch(e){}
    // Stint: Alle Sessions aller Strecken laden
    loadAllStintSessions();
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}


/* ── Stint Session System ────────────────────────────────
   Lädt alle Sessions aller Strecken, filterbar nach Typ
   ─────────────────────────────────────────────────────── */
let _allStintSessions = [];   // Cache aller Sessions
let _stintTypeFilter  = '';   // Aktiver Filter ('' = alle)

async function loadAllStintSessions() {
  try {
    // Alle Strecken abrufen, dann deren Sessions laden
    const tracks = await apiGet('/tracks');
    const allRows = [];
    for (const t of tracks) {
      try {
        const rows = await apiGet('/sessions/' + encodeURIComponent(t.track));
        rows.forEach(r => allRows.push(r));
      } catch(e) {}
    }
    // Sortieren nach Datum, neueste zuerst
    allRows.sort((a,b) => b.timestamp.localeCompare(a.timestamp));
    _allStintSessions = allRows.filter(r => (r.lap_count||0) > 0);
    document.getElementById('stint-section').style.display = 'block';
    renderStintSessions();
  } catch(e) {
    console.warn('Stint sessions:', e);
  }
}

function renderStintSessions() {
  const ssel = document.getElementById('stint-sess');
  if (!ssel) return;
  const filtered = _stintTypeFilter
    ? _allStintSessions.filter(r => r.session_type === _stintTypeFilter)
    : _allStintSessions;
  const typeName = {FP:'Training', Q:'Qualifying', R:'Rennen'};
  ssel.innerHTML = '<option value="">Session wählen…</option>' +
    filtered.map(r => {
      const typ = typeName[r.session_type] || r.session_type;
      const wet = r.is_wet ? ' 💧' : '';
      return `<option value="${r.id}">${r.timestamp_berlin}${wet} · ${esc(tn(r.track))} · ${typ} · ${r.driver_count||0} Fahr. · ${r.lap_count} Rdn</option>`;
    }).join('');
  // Fahrer-Dropdown zurücksetzen
  const dsel = document.getElementById('stint-drv');
  if (dsel) dsel.innerHTML = '<option value="">Fahrer wählen…</option>';
  document.getElementById('stint-wrap').innerHTML =
    '<div class="load" style="padding:30px">Session und Fahrer wählen</div>';
}

function filterStintSessions(type, btn) {
  _stintTypeFilter = type;
  document.querySelectorAll('#stype-all,#stype-fp,#stype-q,#stype-r')
    .forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderStintSessions();
}

async function onStintSessionChange() {
  const sessId = document.getElementById('stint-sess').value;
  const dsel   = document.getElementById('stint-drv');
  if (!sessId) {
    dsel.innerHTML = '<option value="">Fahrer wählen…</option>';
    return;
  }
  // Session aus Cache holen
  const sess = _allStintSessions.find(r => r.id === sessId);
  if (sess && sess.drivers_list && sess.drivers_list.length) {
    dsel.innerHTML = '<option value="">Fahrer wählen…</option>' +
      sess.drivers_list.map(d =>
        `<option value="${esc(d.steam_id)}">${esc(d.player_name)}</option>`
      ).join('');
  } else {
    // Fallback: Fahrer direkt von API laden
    try {
      const track = sess ? sess.track : (activeTrack || window._lastSessionTrack || '');
      if (track) {
        const rows = await apiGet('/sessions/' + encodeURIComponent(track));
        const found = rows.find(r => r.id === sessId);
        if (found && found.drivers_list) {
          dsel.innerHTML = '<option value="">Fahrer wählen…</option>' +
            found.drivers_list.map(d =>
              `<option value="${esc(d.steam_id)}">${esc(d.player_name)}</option>`
            ).join('');
        }
      }
    } catch(e) {}
  }
}

/* ── Stint Analysis ── */
async function loadStint(){
  const sessId=document.getElementById('stint-sess').value;
  const drvId=document.getElementById('stint-drv').value;
  if(!sessId||!drvId){return;}
  const el=document.getElementById('stint-wrap');
  el.innerHTML='<div class="skeleton" style="height:160px;border-radius:10px"></div>';
  try{
    const laps=await apiGet(`/stint/${encodeURIComponent(sessId)}/${encodeURIComponent(drvId)}`);
    if(!laps.length){el.innerHTML='<div class="load">Keine Runden.</div>';return;}
    const valid=laps.filter(l=>l.valid);
    if(!valid.length){el.innerHTML='<div class="load">Keine gültigen Runden.</div>';return;}
    const times=valid.map(l=>l.laptime_ms),n=valid.length;
    const avg=Math.round(times.reduce((a,b)=>a+b,0)/n);
    const best=Math.min(...times),worst=Math.max(...times);
    // Trend: is driver improving?
    const firstHalfAvg=Math.round(times.slice(0,Math.ceil(n/2)).reduce((a,b)=>a+b,0)/Math.ceil(n/2));
    const secondHalfAvg=Math.round(times.slice(Math.ceil(n/2)).reduce((a,b)=>a+b,0)/Math.floor(n/2)||1);
    const trend=firstHalfAvg>secondHalfAvg?'📈 Verbesserung im Stint':secondHalfAvg>firstHalfAvg*1.01?'📉 Zeiten werden langsamer':'➡ Konstante Leistung';
    const buf=(worst-best)*.15||500,lo=best-buf,hi=worst+buf,rng=hi-lo;
    const W=800,H=160,PL=86,PR=20,PT=14,PB=28,CW=W-PL-PR,CH=H-PT-PB;
    const allLaps=laps,nAll=allLaps.length;
    const px=i=>PL+i*(nAll>1?CW/(nAll-1):0);
    const py=ms=>PT+((hi-ms)/rng)*CH;
    const pts=allLaps.map((l,i)=>({x:px(i),y:l.valid?py(l.laptime_ms):null,l}));
    const lineSegs=[];let seg=[];
    pts.forEach(p=>{if(p.y!==null){seg.push(p);}else{if(seg.length>1)lineSegs.push(seg);seg=[];}});
    if(seg.length>1)lineSegs.push(seg);
    const lineD=lineSegs.map(s=>s.map((p,i)=>`${i===0?'M':'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')).join(' ');
    const avgY=py(avg);
    const yL=Array.from({length:4},(_,i)=>{const f=i/3,msV=lo+f*rng,yP=PT+(1-f)*CH;return`<text x="${PL-5}" y="${yP.toFixed(1)}" font-size="10" fill="rgba(128,128,128,.5)" text-anchor="end" dominant-baseline="middle">${fmt(Math.round(msV))}</text><line x1="${PL}" y1="${yP.toFixed(1)}" x2="${PL+CW}" y2="${yP.toFixed(1)}" stroke="rgba(128,128,128,.07)" stroke-width="1"/>`;}).join('');
    const xL=allLaps.filter((_,i)=>i%Math.max(1,Math.ceil(nAll/12))===0||i===nAll-1).map((_,j,arr)=>{const idx=Math.min(j*Math.max(1,Math.ceil(nAll/12)),nAll-1);return`<text x="${px(idx).toFixed(1)}" y="${PT+CH+18}" font-size="10" fill="rgba(128,128,128,.5)" text-anchor="middle">R${idx+1}</text>`;}).join('');
    const dots=pts.map(p=>{if(p.y===null)return`<circle cx="${p.x.toFixed(1)}" cy="${PT+CH/2}" r="3" fill="rgba(255,59,48,.4)"><title>R${p.l.lap_num}: Ungültig</title></circle>`;const pb=p.l.is_pb;return`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${pb?7:4}" fill="${pb?'var(--pu)':'rgba(128,128,128,.55)'}" stroke="${pb?'rgba(255,255,255,.8)':'none'}" stroke-width="${pb?2:0}"><title>R${p.l.lap_num}: ${p.l.laptime}${pb?' ★':''}</title></circle>`;}).join('');
    el.innerHTML=`<div class="ios-card glass">
      <div style="display:flex;gap:20px;margin-bottom:14px;flex-wrap:wrap">
        <div><div style="font-family:var(--f1);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--tx3)">Bestzeit</div><div style="font-family:var(--mo);font-size:17px;color:var(--pu);font-weight:700">${fmt(best)}</div></div>
        <div><div style="font-family:var(--f1);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--tx3)">Ø Rundenzeit</div><div style="font-family:var(--mo);font-size:17px;color:var(--tx2);font-weight:600">${fmt(avg)}</div></div>
        <div><div style="font-family:var(--f1);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--tx3)">Langsamste</div><div style="font-family:var(--mo);font-size:17px;color:var(--or);font-weight:600">${fmt(worst)}</div></div>
        <div style="margin-left:auto"><div style="font-family:var(--f1);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:var(--tx3)">Trend</div><div style="font-size:14px;font-weight:600;color:var(--tx);margin-top:4px">${trend}</div></div>
      </div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible">
        <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${PT+CH}" stroke="rgba(128,128,128,.15)" stroke-width="1"/>
        <line x1="${PL}" y1="${PT+CH}" x2="${PL+CW}" y2="${PT+CH}" stroke="rgba(128,128,128,.15)" stroke-width="1"/>
        <line x1="${PL}" y1="${avgY.toFixed(1)}" x2="${PL+CW}" y2="${avgY.toFixed(1)}" stroke="rgba(255,159,10,.4)" stroke-width="1.5" stroke-dasharray="6,3"/>
        <text x="${PL+CW+4}" y="${avgY.toFixed(1)}" font-size="9" fill="rgba(255,159,10,.7)" dominant-baseline="middle">Avg</text>
        ${yL}${xL}
        <path d="${lineD}" fill="none" stroke="var(--pu)" stroke-width="2.5" stroke-linejoin="round"/>
        ${dots}
      </svg>
      <div style="font-family:var(--mo);font-size:11px;color:var(--tx3);margin-top:6px;display:flex;gap:16px;flex-wrap:wrap">
        <span>${nAll} Runden gesamt (${valid.length} gültig)</span>
        <span style="color:rgba(255,59,48,.6)">● Ungültige Runde</span>
        <span style="color:var(--pu)">● Persönliche Bestzeit</span>
        <span style="color:rgba(255,159,10,.7)">— Durchschnitt</span>
      </div>
    </div>`;
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}

/* ── All Drivers ── */
async function loadAllDrivers(){
  const el=document.getElementById('drv-grid');
  el.innerHTML=skel(6,'skel-card');
  try{
    allDrivers=await apiGet('/drivers');
    const dc=document.getElementById('drv-count');if(dc)dc.textContent=allDrivers.length+' Fahrer';
    if(!allDrivers.length){el.innerHTML='<div class="load">Keine Fahrer.</div>';return;}
    el.innerHTML=allDrivers.map((d,i)=>`<div class="drv-card glass" onclick="openModal('${esc(d.steam_id)}','${esc(d.player_name)}',${i})"><div class="drv-av ${avc(i)}">${ini(d.player_name)}</div><div style="flex:1;min-width:0"><div class="drv-name">${esc(d.player_name)}</div><div class="drv-steam">${esc(d.steam_id)}</div><div class="drv-stats"><div class="drv-stat"><strong>${d.total_laps}</strong> Runden</div><div class="drv-stat"><strong>${d.tracks}</strong> Strecken</div><div class="drv-stat"><strong>${d.cars_driven}</strong> Autos</div></div><div style="font-family:var(--mo);font-size:10px;color:var(--tx3);margin-top:4px">Zuletzt: ${d.last_seen_berlin}</div></div><div class="drv-best">${d.best_laptime}<div style="font-size:10px;margin-top:3px;opacity:.5">Best</div></div></div>`).join('');
  }catch(e){el.innerHTML=`<div class="errbox">${e.message}</div>`;}
}

/* ── Modal ── */
/* Ripple/scale feedback */
function pressEl(el){if(!el)return;el.style.transition='transform .1s';el.style.transform='scale(.97)';setTimeout(()=>{el.style.transform='';},150);}

async function openModal(sid,name,idx){
  document.getElementById('m-name').textContent=name;
  document.getElementById('m-steam').textContent=sid;
  document.getElementById('modal').classList.add('active');
  const tb=document.querySelector('#m-table tbody');
  tb.innerHTML='<tr><td colspan="4" style="color:var(--tx3);text-align:center;padding:20px">Lade…</td></tr>';
  try{
    const d=await apiGet('/driver/'+encodeURIComponent(sid));
    tb.innerHTML=d.tracks.length?d.tracks.map(t=>`<tr><td>${esc(tn(t.track))}</td><td style="font-size:12px;color:var(--tx3)">${esc(t.car)}</td><td style="color:var(--pu);font-weight:700;font-size:15px">${t.best_laptime}</td><td style="font-family:var(--mo);text-align:right;color:var(--tx2)">${t.total_laps}</td></tr>`).join('')
    :'<tr><td colspan="4" style="color:var(--tx3);text-align:center">Keine Daten</td></tr>';
  }catch(e){tb.innerHTML=`<tr><td colspan="4" style="color:var(--red)">${e.message}</td></tr>`;}
}
function closeModal(){document.getElementById('modal').classList.remove('active');}
document.getElementById('modal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal();});

/* ── Server Status ── */
async function checkServerStatus(){
  try{
    const data=await apiGet('/server-status');
    const servers=Object.values(data.servers);
    ['sd0','sd1','sd2'].forEach((id,i)=>{
      const el=document.getElementById(id);
      if(el&&servers[i]){el.classList.toggle('online',servers[i].online);el.classList.toggle('offline',!servers[i].online);}
    });
  }catch(e){}
}

/* ── Backup ── */
async function doBackup(){
  try{
    const data=await fetch(API+'/backup',{method:'POST'}).then(r=>r.json());
    if(data.ok)toast(`✓ Backup erstellt (${data.size_kb} KB)`,'var(--te)');
    else toast('Backup fehlgeschlagen: '+data.error,'var(--red)');
  }catch(e){toast('Backup-Fehler','var(--red)');}
}

/* ── Sync & Countdown ── */
let nextRefreshAt=null;
async function updateSync(){
  try{
    const d=await apiGet('/sync-time');
    if(d.sync_time){
      const newTs=new Date(d.sync_time*1000);
      if(syncTs&&newTs>syncTs&&refreshCount>0){
        toast('⟳ Neue Daten synchronisiert');
      }
      syncTs=newTs;
    }
  }catch(e){}
  renderSync();
}
function renderSync(){
  const el=document.getElementById('sync-display');
  if(!syncTs){el.textContent='—';return;}
  const diff=Math.floor((new Date()-syncTs)/1000);
  const ago=diff<60?`${diff}s`:diff<3600?`${Math.floor(diff/60)} min`:`${Math.floor(diff/3600)}h`;
  const secToNext=nextRefreshAt?Math.max(0,Math.round((nextRefreshAt-Date.now())/1000)):null;
  const countdown=secToNext!==null?` · nächste: ${secToNext}s`:'';
  el.innerHTML=`<span class="sync-ring"></span>${syncTs.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} (${ago})${countdown}`;
}
setInterval(renderSync,1000);

/* ── Resize ── */
window.addEventListener('resize',()=>{
  const an=document.querySelector('.navbtn.active');
  if(an)movePill('main-nav','np-bg','np-line',an);
  /* Re-init both pills on resize (no animation) */
  initPill('main-nav','np-bg','np-line','navbtn');
  initPill('sub-tabs','sp-pill','sp-pill','segtab');
});

/* ── Init ── */
(async()=>{
  await loadStats();
  await loadTracks();
  await updateSync();
  await loadAllDrivers();
  checkServerStatus();
  initPill('main-nav','np-bg','np-line','navbtn');
  initPill('sub-tabs','sp-pill','sp-pill','segtab');
  applyHash();

  setInterval(async()=>{
    refreshCount++;
    nextRefreshAt=Date.now()+60000;
    await loadStats();
    await updateSync();
    checkServerStatus();
    if(activeTrack)loadLeaderboard(activeTrack,activeCar);
  },60000);
  nextRefreshAt=Date.now()+60000;
  // Status-Leiste NACH dem Init befüllen (Daten sind jetzt geladen)
  updateServerBar();
})();

/* ═══════════════════════════════════════════════════════
   Feature-Update 2 — Neue Funktionen
   ═══════════════════════════════════════════════════════ */

/* ── Shortcut-Hilfe ── */
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === '?') {
    document.getElementById('shortcut-modal').style.display = 'flex';
  }
});

/* ── Einstellungen ── */
async function loadSettings() {
  try {
    const d = await apiGet('/config/sync-interval');
    const sl = document.getElementById('sync-slider');
    const sv = document.getElementById('sync-val');
    if (sl && d.minutes) { sl.value = d.minutes; sv.textContent = d.minutes; }
  } catch(e) {}
}
async function saveSyncInterval() {
  const m = parseInt(document.getElementById('sync-slider').value);
  try {
    await fetch(API + '/config/sync-interval', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({minutes: m})});
    toast(`⟳ Sync-Intervall: alle ${m} min gespeichert`, 'var(--te)');
  } catch(e) { toast('Fehler beim Speichern', 'var(--red)'); }
}
async function savePassword() {
  const pw = document.getElementById('admin-pw').value;
  try {
    await fetch(API + '/config/password', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({password: pw})});
    toast(pw ? '🔒 Passwort gesetzt' : '🔓 Passwort entfernt', 'var(--te)');
    document.getElementById('admin-pw').value = '';
  } catch(e) {}
}

/* ── Statistik-Seite ── */
async function loadStatistik() {
  loadPodium(); loadRaceAnalysis();
  // Form-Dropdown befüllen
  const sel = document.getElementById('form-sel');
  if (sel && allDrivers.length) {
    sel.innerHTML = '<option value="">Fahrer wählen…</option>' +
      allDrivers.map(d => `<option value="${esc(d.steam_id)}">${esc(d.player_name)}</option>`).join('');
    const saved = localStorage.getItem('acc-my-steam');
    if (saved) { sel.value = saved; loadForm(); }
  }
  // Strecken-Dropdown für Fahrzeug-Stats
  const tsel = document.getElementById('carstat-track');
  if (tsel) {
    try {
      const tracks = await apiGet('/tracks');
      tsel.innerHTML = '<option value="">Strecke wählen…</option>' +
        tracks.map(t => `<option value="${t.track}">${esc(tn(t.track))}</option>`).join('');
    } catch(e) {}
  }
}

async function loadPodium() {
  const el = document.getElementById('podium-wrap');
  el.innerHTML = skel(4, 'skel-row sm');
  try {
    const rows = await apiGet('/podium');
    if (!rows.length) { el.innerHTML = '<div class="load">Noch keine Rennen.</div>'; return; }
    let h = `<div class="podium-wrap"><div class="podium-head"><span>Fahrer</span><span style="text-align:center">🏆 P1</span><span style="text-align:center">🥈 P2</span><span style="text-align:center">🥉 P3</span><span style="text-align:center">Podien</span><span style="text-align:center">Sessions</span></div>`;
    rows.forEach((r, i) => {
      const pc = ['var(--gold)', 'var(--tx2)', 'var(--or)'][i] || 'var(--tx3)';
      const podien = r.p1 + r.p2 + r.p3;
      const pct = Math.round(podien / Math.max(1, r.sessions) * 100);
      h += `<div class="podium-row">
        <div class="lbdrv"><div class="lbav ${avc(i)}">${ini(r.player_name)}</div>
          <div><div class="lbn" style="color:${pc}">${esc(r.player_name)}</div>
          <div style="font-family:var(--mo);font-size:10px;color:var(--tx3)">${pct}% Podium-Rate</div></div>
        </div>
        <div style="text-align:center"><span class="p-badge p-gold">${r.p1}</span></div>
        <div style="text-align:center"><span class="p-badge p-silver">${r.p2}</span></div>
        <div style="text-align:center"><span class="p-badge p-bronze">${r.p3}</span></div>
        <div style="font-family:var(--mo);font-size:15px;font-weight:700;text-align:center;color:var(--pu)">${podien}</div>
        <div style="font-family:var(--mo);font-size:13px;text-align:center;color:var(--tx3)">${r.sessions}</div>
      </div>`;
    });
    el.innerHTML = h + '</div>';
  } catch(e) { el.innerHTML = `<div class="errbox">${e.message}</div>`; }
}

async function loadRaceAnalysis() {
  const el = document.getElementById('race-analysis-wrap');
  el.innerHTML = skel(3, 'skel-row sm');
  try {
    const rows = await apiGet('/race-analysis');
    if (!rows.length) { el.innerHTML = '<div class="load">Noch keine Rennen.</div>'; return; }
    const totalMin = rows.reduce((a, r) => a + r.total_min, 0);
    const totalLaps = rows.reduce((a, r) => a + r.lap_count, 0);
    let h = `<div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
      <div class="scard glass"><div class="scard-l">Gesamte Rennzeit</div><div class="scard-v mono">${Math.round(totalMin)} min</div><div class="scard-s">${rows.length} Rennen</div></div>
      <div class="scard glass"><div class="scard-l">Runden total</div><div class="scard-v">${totalLaps}</div><div class="scard-s">alle Rennen</div></div>
      <div class="scard glass"><div class="scard-l">Ø Renndauer</div><div class="scard-v mono">${Math.round(totalMin / Math.max(1, rows.length))} min</div><div class="scard-s">pro Rennen</div></div>
    </div>
    <div class="ios-list glass"><div class="ios-list-head" style="grid-template-columns:1fr 120px 100px 100px 80px"><span>Strecke & Datum</span><span>Runden</span><span>Ø Pace</span><span>Beste Zeit</span><span>Dauer</span></div>`;
    rows.forEach(r => {
      const wet = r.is_wet ? ' 💧' : '';
      h += `<div class="ios-list-row" style="grid-template-columns:1fr 120px 100px 100px 80px">
        <div><div class="lbn">${esc(tn(r.track))}${wet}</div><div class="lbs">${r.timestamp_berlin}</div></div>
        <div style="font-family:var(--mo);font-size:13px;color:var(--tx2)">${r.lap_count} Rdn · ${r.drivers} Fahr.</div>
        <div style="font-family:var(--mo);font-size:13px;color:var(--tx2)">${r.avg_lap_str}</div>
        <div style="font-family:var(--mo);font-size:14px;font-weight:700;color:var(--pu)">${r.best_lap_str}</div>
        <div style="font-family:var(--mo);font-size:13px;color:var(--tx3)">${r.total_min} min</div>
      </div>`;
    });
    el.innerHTML = h + '</div>';
  } catch(e) { el.innerHTML = `<div class="errbox">${e.message}</div>`; }
}

async function loadForm() {
  const sid = document.getElementById('form-sel').value;
  const el  = document.getElementById('form-wrap');
  if (!sid) { el.innerHTML = '<div class="load" style="padding:30px">Fahrer wählen</div>'; return; }
  el.innerHTML = skel(3, 'skel-card');
  try {
    const data = await apiGet('/form/' + encodeURIComponent(sid));
    const tracks = Object.keys(data);
    if (!tracks.length) { el.innerHTML = '<div class="load">Nicht genug Sessions für Analyse.</div>'; return; }
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const pu = isDark ? '#bf5af2' : '#af52de';
    let h = '<div class="ag">';
    tracks.forEach(track => {
      const d = data[track];
      const trend = d.trend;
      const trendIcon = trend === 'improving' ? '📈' : trend === 'declining' ? '📉' : '➡';
      const trendCol = trend === 'improving' ? 'var(--te)' : trend === 'declining' ? 'var(--red)' : 'var(--tx2)';
      const pts = d.points;
      const mn = Math.min(...pts.map(p => p.best));
      const mx = Math.max(...pts.map(p => p.best));
      const rng = mx - mn || 1;
      const W = 320, H = 80, PL = 8, PR = 8, PT = 8, PB = 8;
      const CW = W - PL - PR, CH = H - PT - PB;
      const px = i => PL + i * (pts.length > 1 ? CW/(pts.length-1) : 0);
      const py = ms => PT + ((mx - ms)/rng) * CH;
      const lineD = pts.map((p,i) => `${i===0?'M':'L'}${px(i).toFixed(0)},${py(p.best).toFixed(0)}`).join(' ');
      h += `<div class="form-card glass">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div><div style="font-size:15px;font-weight:700;color:var(--tx)">${esc(tn(track))}</div>
            <div style="font-size:12px;color:var(--tx3);margin-top:2px">${pts.length} Sessions</div></div>
          <div style="text-align:right"><div style="font-size:18px">${trendIcon}</div>
            <div style="font-size:12px;color:${trendCol};font-weight:600">${trend==='improving'?'-'+d.improvement_str:trend==='declining'?'+'+d.improvement_str:'Konstant'}</div></div>
        </div>
        <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">
          <path d="${lineD}" fill="none" stroke="${pu}" stroke-width="2.5" stroke-linejoin="round"/>
          ${pts.map((p,i) => `<circle cx="${px(i).toFixed(0)}" cy="${py(p.best).toFixed(0)}" r="4" fill="${pu}"><title>${p.laptime}</title></circle>`).join('')}
        </svg>
        <div style="display:flex;justify-content:space-between;font-family:var(--mo);font-size:11px;color:var(--tx3);margin-top:4px">
          <span>Start: ${pts[0].laptime}</span><span>Aktuell: ${pts[pts.length-1].laptime}</span>
        </div>
      </div>`;
    });
    el.innerHTML = h + '</div>';
  } catch(e) { el.innerHTML = `<div class="errbox">${e.message}</div>`; }
}

async function loadCarStats() {
  const track = document.getElementById('carstat-track').value;
  const el    = document.getElementById('carstat-wrap');
  if (!track) { el.innerHTML = '<div class="load" style="padding:30px">Strecke wählen</div>'; return; }
  el.innerHTML = skel(4, 'skel-row sm');
  try {
    const rows = await apiGet('/car-stats/' + encodeURIComponent(track));
    if (!rows.length) { el.innerHTML = '<div class="load">Keine Daten.</div>'; return; }
    const maxGap = rows[rows.length-1].gap_ms || 1;
    let h = `<div class="carstat-wrap"><div class="carstat-head"><span>Fahrzeug</span><span>Fahr.</span><span>Runden</span><span>Bestzeit</span><span>Avg</span><span>Gap</span></div>`;
    rows.forEach((r, i) => {
      const pc = i === 0 ? 'var(--gold)' : i === 1 ? 'var(--tx2)' : 'var(--tx3)';
      const barPct = i === 0 ? 100 : Math.max(5, 100 - (r.gap_ms / maxGap) * 85);
      h += `<div class="carstat-row">
        <div><div style="font-size:15px;font-weight:700;color:var(--tx)">${esc(r.car)}</div>
          <div style="height:4px;background:var(--bg3);border-radius:2px;margin-top:4px;overflow:hidden"><div style="height:100%;width:${barPct}%;background:${pc};border-radius:2px"></div></div></div>
        <div style="font-family:var(--mo);font-size:13px;color:var(--tx2);text-align:center">${r.drivers}</div>
        <div style="font-family:var(--mo);font-size:13px;color:var(--tx2);text-align:center">${r.laps}</div>
        <div style="font-family:var(--mo);font-size:14px;font-weight:700;color:${pc}">${r.best}</div>
        <div style="font-family:var(--mo);font-size:12px;color:var(--tx3)">${r.avg}</div>
        <div style="font-family:var(--mo);font-size:12px;color:var(--tx3)">${i===0?'Leader':'+'+r.gap}</div>
      </div>`;
    });
    el.innerHTML = h + '</div>';
  } catch(e) { el.innerHTML = `<div class="errbox">${e.message}</div>`; }
}

/* ── Session-Notizen (in Last Session) ── */
async function loadNote(sessId) {
  try {
    const d = await apiGet('/notes/' + encodeURIComponent(sessId));
    const ta = document.getElementById('note-area');
    if (ta) ta.value = d.text || '';
  } catch(e) {}
}
async function saveNote() {
  const sessId = document.getElementById('note-session-id')?.value;
  const text   = document.getElementById('note-area')?.value || '';
  if (!sessId) return;
  try {
    await fetch(API + '/notes/' + encodeURIComponent(sessId), {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text})
    });
    toast('📝 Notiz gespeichert', 'var(--te)');
  } catch(e) {}
}

/* ── Teams ── */
let _editingTeamId = null;
let _selectedTeamColor = '#bf5af2';
let _selectedTeamMembers = new Set();

async function loadTeams() {
  loadTeamList(); loadTeamStandings();
}
async function loadTeamList() {
  const el = document.getElementById('teams-wrap');
  try {
    const teams = await apiGet('/teams');
    if (!teams.length) {
      el.innerHTML = '<div class="load">Noch keine Teams. Erstelle dein erstes Team!</div>'; return;
    }
    el.innerHTML = teams.map(t => `
      <div class="team-card glass">
        <div class="team-dot" style="background:${t.color}"></div>
        <div style="flex:1">
          <div style="font-size:18px;font-weight:700;color:var(--tx)">${esc(t.name)}</div>
          <div class="team-members">${(t.members||[]).map(m =>
            `<span class="team-chip" style="border-color:${t.color}40;color:${t.color}">${esc(m.player_name||m.steam_id)}</span>`
          ).join('')}</div>
        </div>
        <button class="csv-btn" onclick="editTeam(${JSON.stringify(t).replace(/"/g,'&quot;')})"><i class="ti ti-edit"></i></button>
        <button class="csv-btn" onclick="deleteTeam(${t.id})" style="color:var(--red)"><i class="ti ti-trash"></i></button>
      </div>
    `).join('');
  } catch(e) { el.innerHTML = `<div class="errbox">${e.message}</div>`; }
}
async function loadTeamStandings() {
  const el = document.getElementById('team-standings-wrap');
  try {
    const teams = await apiGet('/team-standings');
    if (!teams.length) { el.innerHTML = '<div class="load">Noch keine Team-Punkte.</div>'; return; }
    const maxPts = teams[0]?.points || 1;
    let h = '<div class="team-standings">';
    teams.forEach((t, i) => {
      const pct = Math.round((t.points / maxPts) * 100);
      const pc = ['var(--gold)','var(--tx2)','var(--or)'][i] || 'var(--tx3)';
      h += `<div class="team-stand-row">
        <div style="font-family:var(--f1);font-size:17px;font-weight:700;width:26px;color:${pc}">${i+1}</div>
        <div class="team-dot" style="background:${t.color}"></div>
        <div style="flex:1">
          <div style="font-size:16px;font-weight:700;color:var(--tx)">${esc(t.name)}</div>
          <div class="team-pts-bar"><div class="team-pts-fill" style="width:${pct}%;background:${t.color}"></div></div>
        </div>
        <div style="font-family:var(--f1);font-size:20px;font-weight:900;color:${pc}">${t.points}</div>
      </div>`;
    });
    el.innerHTML = h + '</div>';
  } catch(e) {}
}
function openTeamEditor(team=null) {
  _editingTeamId = team?.id || null;
  _selectedTeamColor = team?.color || '#bf5af2';
  _selectedTeamMembers = new Set((team?.members||[]).map(m => m.steam_id));
  document.getElementById('team-name').value = team?.name || '';
  // Fahrer-Picks
  const el = document.getElementById('team-member-picks');
  el.innerHTML = allDrivers.map(d =>
    `<div class="chip ${_selectedTeamMembers.has(d.steam_id)?'active':''}"
      onclick="toggleTeamMember('${esc(d.steam_id)}',this)">${esc(d.player_name)}</div>`
  ).join('');
  document.getElementById('team-editor').style.display = 'flex';
}
function editTeam(team) { openTeamEditor(team); }
function toggleTeamMember(sid, el) {
  if (_selectedTeamMembers.has(sid)) { _selectedTeamMembers.delete(sid); el.classList.remove('active'); }
  else { _selectedTeamMembers.add(sid); el.classList.add('active'); }
}
function pickTeamColor(color, btn) {
  _selectedTeamColor = color;
  document.querySelectorAll('#team-color-picks .chip').forEach(b => b.style.outline='none');
  btn.style.outline = `2px solid ${color}`;
}
async function saveTeam() {
  const name = document.getElementById('team-name').value.trim();
  if (!name) { toast('Team-Name fehlt', 'var(--red)'); return; }
  try {
    await fetch(API+'/teams',{method:'POST',headers:{'Content-Type':'application/json'},
      body: JSON.stringify({id:_editingTeamId, name, color:_selectedTeamColor, members:[..._selectedTeamMembers]})});
    document.getElementById('team-editor').style.display = 'none';
    loadTeams();
    toast('Team gespeichert', 'var(--te)');
  } catch(e) { toast('Fehler: '+e.message,'var(--red)'); }
}
async function deleteTeam(id) {
  if (!confirm('Team wirklich löschen?')) return;
  try {
    await fetch(API+'/teams/'+id,{method:'DELETE'});
    loadTeams(); toast('Team gelöscht','var(--te)');
  } catch(e) {}
}

/* ── Rekord-Notification verbessert ── */
function toastRecord(msg) {
  const t = document.getElementById('toast');
  t.textContent = '🏆 ' + msg;
  t.style.color = 'var(--gold)';
  t.className = 'toast glass record show';
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.classList.remove('show'); t.className = 'toast glass'; }, 5000);
}

/* gotoPage Erweiterung → direkt in der Funktion */

/* Settings beim Start laden */
setTimeout(loadSettings, 1000);

/* ═══════════════════════════════════════════════════════
   Live-Timing + PDF-Report + weitere Features
   ═══════════════════════════════════════════════════════ */

/* ── Live-Timing via Polling ─────────────────────────────
   Pollt /api/live-poll alle _liveInterval Sekunden.
   Kein SSE/WebSocket – funktioniert durch jeden Nginx-Proxy.
   ─────────────────────────────────────────────────────── */
let _liveTimer    = null;
let _liveInterval = 5;       // Sekunden
let _liveKnownIds = new Set(); // bereits gezeigte Runden

function startLive() {
  _liveKnownIds.clear();
  stopLive();
  pollLive();   // sofort
  _liveTimer = setInterval(pollLive, _liveInterval * 1000);
  const status = document.getElementById('live-status');
  if (status) {
    status.innerHTML = '<span class="live-dot-anim" style="color:var(--te)">●</span> LIVE · alle ' + _liveInterval + 's';
    status.style.color = 'var(--te)';
  }
}

function stopLive() {
  if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
}

async function pollLive() {
  try {
    const d = await apiGet('/live-poll');
    renderLiveData(d);
  } catch(e) {
    const status = document.getElementById('live-status');
    if (status) { status.textContent = '✕ Verbindungsfehler'; status.style.color = 'var(--red)'; }
  }
}

function renderLiveData(d) {
  if (!d) return;
  const sess = d.session;
  
  // Meta-Karten
  const trackEl = document.getElementById('live-track');
  const typeEl  = document.getElementById('live-type');
  const updEl   = document.getElementById('live-updated');
  if (!sess) {
    if (trackEl) trackEl.textContent = 'Keine aktive Session';
    return;
  }
  if (trackEl) trackEl.textContent = sess.track_name || tn(sess.track) || '—';
  if (typeEl)  typeEl.textContent  = sess.session_type_name || '—';
  if (updEl)   updEl.textContent   = new Date().toLocaleTimeString('de-DE',
    {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  
  // Fahrer-Standings (vom Backend bereits sortiert nach Bestzeit)
  const drivers = d.drivers || [];
  const pc = ['var(--gold)','var(--tx2)','var(--or)'];
  
  const container = document.getElementById('live-laps');
  if (!container) return;
  
  if (!drivers.length) {
    container.innerHTML = '<div class="load">Noch keine Runden in dieser Session.</div>';
    return;
  }
  
  let html = `<div class="ios-list-head" style="grid-template-columns:44px 1fr 140px 115px 90px 70px">
    <span>P</span><span>Fahrer</span><span>Fahrzeug</span><span>Bestzeit</span><span>Gap</span><span>Rdn</span>
  </div>`;
  
  drivers.forEach((drv, i) => {
    const col = pc[i] || 'var(--tx3)';
    const isLast = drv.last_valid;
    html += `<div class="live-lap-row" style="grid-template-columns:44px 1fr 140px 115px 90px 70px">
      <div class="lbpos" style="color:${col};font-size:17px">${i===0?'▲':(i+1)}</div>
      <div class="lbdrv">
        <div class="lbav ${avc(i)}">${ini(drv.player_name)}</div>
        <div style="margin-left:10px">
          <div class="lbn" style="color:${col}">${esc(drv.player_name)}</div>
          <div style="font-size:10px;color:var(--tx3);font-family:var(--mo)">Letzte: ${drv.last_lap}</div>
        </div>
      </div>
      <div style="font-size:13px;color:var(--tx2)">${esc(drv.car||'—')}</div>
      <div style="font-family:var(--mo);font-size:15px;font-weight:700;color:${i===0?'var(--pu)':col}">${drv.best}</div>
      <div style="font-family:var(--mo);font-size:13px;color:var(--tx2)">${drv.gap}</div>
      <div style="font-family:var(--mo);font-size:13px;color:var(--tx3)">${drv.laps}</div>
    </div>`;
  });
  
  container.innerHTML = html;
  
  // Sync-Zeit anzeigen
  const status = document.getElementById('live-status');
  if (status && d.total_laps !== undefined) {
    status.innerHTML = 
      `<span class="live-dot-anim" style="color:var(--te)">●</span> `+
      `${d.total_laps} Runden · alle ${_liveInterval}s`;
  }
}

/* ── gotoPage: Live-Timing starten/stoppen ── */
const _gotoPageOrig2 = gotoPage;
/* Patch via event delegation instead of function override */
document.addEventListener('click', e => {
  const btn = e.target.closest('.navbtn[data-page]');
  if (!btn) return;
  const page = btn.dataset.page;
  if (page === 'live') {
    setTimeout(startLive, 100);
  } else {
    stopLive();
  }
}, true);

/* ── PDF Druck-Button in Last Session ── */
function printSession() {
  window.print();
}

/* ── Session-Notizen in Last Session einbinden ── */
(function patchLoadLastSession() {
  const orig = loadLastSession;
  window.loadLastSession = async function() {
    await orig.apply(this, arguments);
    // Notiz-Bereich nach Session-Content einfügen
    const wrap = document.getElementById('last-wrap');
    if (!wrap) return;
    const sessIdMatch = window.location.hash.match(/last\/([^/]+)/);
    // Hole Session-ID aus dem letzten geladenen Inhalt
    const stintSess = document.getElementById('stint-sess');
    const sessId = stintSess?.options[1]?.value || '';
    if (!sessId) return;

    // Notiz-Bereich anhängen
    const noteDiv = document.createElement('div');
    noteDiv.style.marginTop = '24px';
    noteDiv.innerHTML = `
      <div class="sh"><span class="section-title">📝 Session-Notizen</span></div>
      <input type="hidden" id="note-session-id" value="${esc(sessId)}">
      <div class="ios-card glass" style="margin-bottom:16px">
        <textarea id="note-area" placeholder="Notizen zur Session… (Setup, Ereignisse, Wetter, Feedback)"
          style="width:100%;background:transparent;border:none;color:var(--tx);font-family:var(--bo);font-size:14px;line-height:1.6;resize:vertical;min-height:80px;outline:none"
          onchange="saveNote()"></textarea>
      </div>`;
    wrap.appendChild(noteDiv);
    loadNote(sessId);

    // Print-Button
    const printDiv = document.createElement('div');
    printDiv.innerHTML = `<button class="csv-btn" onclick="window.print()" style="margin-top:8px"><i class="ti ti-printer"></i> Als PDF drucken</button>`;
    wrap.appendChild(printDiv);
  };
})();

/* ── Sektor-Rekorde Timeline ── */
async function loadSectorTimeline(track) {
  if (!track) return;
  const el = document.getElementById('sector-timeline-wrap');
  if (!el) return;
  el.innerHTML = skel(3, 'skel-row sm');
  try {
    const data = await apiGet('/sector-timeline/' + encodeURIComponent(track));
    if (!data.length) { el.innerHTML = '<div class="load">Noch keine Rekord-Progression.</div>'; return; }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const colors = { s1: isDark?'#bf5af2':'#8944c8', s2: isDark?'#30d158':'#28a745', s3: isDark?'#ffd60a':'#aa6800', lap: isDark?'#0a84ff':'#007aff' };

    // Chart
    const W=800,H=140,PL=88,PR=20,PT=14,PB=30,CW=W-PL-PR,CH=H-PT-PB,n=data.length;
    const px=i=>PL+i*(n>1?CW/(n-1):0);
    const makeLines=(key)=>{
      const vals=data.map(d=>d[key+'_ms']).filter(v=>v>0);
      if(!vals.length)return'';
      const mn=Math.min(...vals),mx=Math.max(...vals),rng=mx-mn||1;
      const py=ms=>PT+((mx-ms)/rng)*CH;
      const pts=data.filter(d=>d[key+'_ms']>0).map((d,i)=>({x:px(data.indexOf(d)),y:py(d[key+'_ms']),d}));
      const line=pts.map((p,i)=>`${i===0?'M':'L'}${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' ');
      const dots=pts.map(p=>`<circle cx="${p.x.toFixed(0)}" cy="${p.y.toFixed(0)}" r="4" fill="${colors[key]}"><title>${p.d.ts}: ${p.d[key]}</title></circle>`).join('');
      return `<path d="${line}" fill="none" stroke="${colors[key]}" stroke-width="2" stroke-linejoin="round"/>${dots}`;
    };

    el.innerHTML = `
      <div class="ios-card glass" style="margin-bottom:16px">
        <div class="ios-card-title">Rekord-Progression · ${esc(tn(track))}</div>
        <div style="display:flex;gap:16px;margin-bottom:10px;font-size:12px;flex-wrap:wrap">
          <span style="color:${colors.s1}">■ Sektor 1</span>
          <span style="color:${colors.s2}">■ Sektor 2</span>
          <span style="color:${colors.s3}">■ Sektor 3</span>
          <span style="color:${colors.lap}">■ Runde</span>
        </div>
        <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible">
          ${makeLines('s1')}${makeLines('s2')}${makeLines('s3')}${makeLines('lap')}
        </svg>
        <div style="font-family:var(--mo);font-size:11px;color:var(--tx3);margin-top:6px">
          ${data.length} Rekord-Änderungen · Älteste → Neueste
        </div>
      </div>
      <div class="ios-list glass">
        <div class="ios-list-head" style="grid-template-columns:130px 1fr 100px 100px 100px 100px">
          <span>Datum</span><span>Fahrer</span><span>S1</span><span>S2</span><span>S3</span><span>Runde</span>
        </div>
        ${data.map(r=>`<div class="ios-list-row" style="grid-template-columns:130px 1fr 100px 100px 100px 100px">
          <div style="font-family:var(--mo);font-size:11px;color:var(--tx3)">${r.ts}</div>
          <div class="lbn" style="font-size:14px">${esc(r.driver)}</div>
          <div style="font-family:var(--mo);font-size:13px;color:${colors.s1}">${r.s1}</div>
          <div style="font-family:var(--mo);font-size:13px;color:${colors.s2}">${r.s2}</div>
          <div style="font-family:var(--mo);font-size:13px;color:${colors.s3}">${r.s3}</div>
          <div style="font-family:var(--mo);font-size:14px;font-weight:700;color:${colors.lap}">${r.lap}</div>
        </div>`).join('')}
      </div>`;
  } catch(e) { el.innerHTML = `<div class="errbox">${e.message}</div>`; }
}

/* ── Sektor-Timeline in Statistik-Seite ── */
(function addSectorTimeline() {
  const origLoadStatistik = loadStatistik;
  window.loadStatistik = async function() {
    await origLoadStatistik.apply(this, arguments);
    // Sektor-Timeline nach Fahrzeug-Stats einfügen
    const wrap = document.querySelector('#page-statistik');
    if (!wrap) return;
    if (document.getElementById('sector-timeline-wrap')) return;
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="sh" style="margin-top:28px">
        <span class="section-title">Sektor-Rekorde Timeline</span>
        <div class="my-pick-group" style="max-width:220px;margin-left:12px">
          <select id="timeline-track" onchange="loadSectorTimeline(this.value)">
            <option value="">Strecke wählen…</option>
          </select>
        </div>
      </div>
      <div id="sector-timeline-wrap"></div>`;
    wrap.appendChild(div);
    // Strecken laden
    try {
      const tracks = await apiGet('/tracks');
      const tsel = document.getElementById('timeline-track');
      if (tsel) tsel.innerHTML = '<option value="">Strecke wählen…</option>' +
        tracks.map(t=>`<option value="${t.track}">${esc(tn(t.track))}</option>`).join('');
    } catch(e) {}
  };
})();

/* Live stoppt automatisch via click-listener */

/* Settings beim Start laden */
setTimeout(loadSettings, 1500);

/* ═══════════════════════════════════════════════════════
   Server-Statusleiste
   ═══════════════════════════════════════════════════════ */
let _sbLastY = 0;
let _sbHideTimer = null;

/* Statusleiste immer sichtbar – kein auto-hide */

async function updateServerBar() {
  const dot    = document.getElementById('sb-dot');
  const sbName = document.getElementById('sb-servername');
  const plEl   = document.getElementById('sb-players');
  const trEl   = document.getElementById('sb-track');
  const tyEl   = document.getElementById('sb-session-type');
  const syncEl = document.getElementById('sb-sync-text');
  if (!dot) return;

  try {
    const s = await apiGet('/server-status');

    // ── Online/Offline ──
    const online = s.any_online;
    dot.className = 'sb-dot ' + (online ? 'online' : 'offline');

    if (sbName) {
      if (s.any_tcp) {
        // TCP direkt erreichbar → zeige Server-Name
        const name = Object.entries(s.servers||{}).find(([,v])=>v.online)?.[0];
        sbName.textContent = name || 'Server Online';
      } else if (s.sync_recent) {
        sbName.textContent = 'Server Online';
      } else {
        sbName.textContent = 'Server Offline';
      }
    }

    // ── Spieleranzahl ──
    if (plEl) {
      const n = s.player_count || 0;
      plEl.textContent = n > 0
        ? n + (n === 1 ? ' Fahrer' : ' Fahrer')
        : 'Keine Fahrer';
    }

    // ── Letzter Sync ──
    if (syncEl && s.last_sync) {
      const d   = new Date(s.last_sync);
      const ago = Math.round((Date.now() - d.getTime()) / 60000);
      syncEl.textContent = ago < 2
        ? 'Gerade synced'
        : 'vor ' + ago + ' min';
    }

  } catch(e) {
    dot.className = 'sb-dot offline';
    if (sbName) sbName.textContent = 'Keine Verbindung';
  }

  // ── Strecke aus live-poll ──
  try {
    const live = await apiGet('/live-poll');
    const sess = live?.session;
    const typeMap = {FP:'Training', Q:'Qualifying', R:'Rennen'};

    if (trEl) trEl.textContent = sess
      ? (sess.track_name || tn(sess.track) || '—') : '—';

    if (tyEl && sess) {
      const wet = sess.is_wet ? ' 💧' : '';
      tyEl.textContent = (typeMap[sess.session_type]||sess.session_type||'—') + wet;
    } else if (tyEl) {
      tyEl.textContent = '—';
    }
  } catch(e) {}
}

async function manualSync() {
  const icon = document.getElementById('sb-sync-icon');
  const text = document.getElementById('sb-sync-text');
  if (!icon) return;
  icon.style.animation = 'spin 1s linear infinite';
  if (text) text.textContent = '…';
  try {
    const reloadResp = await fetch(API + '/reload', { method: 'POST' });
    await new Promise(r => setTimeout(r, 2000));
    toast('♻ Daten neu geladen', 'var(--te)');
    // Sync-Zeit aktualisieren
    await fetch(API + '/config/sync-interval', {method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({minutes: parseInt(localStorage.getItem('acc-sync-min')||'5')})
    }).catch(()=>{});
  } catch(e) {}
  icon.style.animation = '';
  await updateServerBar();
}

// Sofort beim Laden + alle 15 Sekunden
updateServerBar();
setInterval(updateServerBar, 15000);

/* ═══════════════════════════════════════════════════════
   ACC Connector – acc-connect:// Protokoll
   Öffnet ACC Connector App auf dem Windows-PC
   ═══════════════════════════════════════════════════════ */

// Server-Liste kommt dynamisch vom Backend (nicht mehr hardcoded)
const ACC_SERVERS = []; // wird beim Öffnen des Modals geladen

async function openAccConnect() {
  const modal = document.getElementById('acc-modal');
  const list  = document.getElementById('acc-server-list');
  if (!list) return;
  modal.style.display = 'flex';

  // Lade-Skeleton
  list.innerHTML = '<div class="load" style="padding:20px">Lade Server…</div>';

  try {
    // Server dynamisch vom Backend laden (inkl. Online-Status)
    const servers = await apiGet('/acc-servers');

    if (!servers.length) {
      list.innerHTML = '<div class="load">Keine Server konfiguriert.</div>';
      return;
    }

    list.innerHTML = servers.map(s => {
      const online  = s.online;
      const url     = `acc-connect://${s.ip}:${s.port}?persistent=true&name=${encodeURIComponent(s.name)}&password=${encodeURIComponent(s.password||'')}`;
      const dotColor = online ? '#30d158' : '#ff453a';
      const dotGlow  = online ? '0 0 8px rgba(48,209,88,.7)' : '0 0 6px rgba(255,69,58,.5)';
      const statusTxt = online ? 'Online' : 'Offline';
      const statusCol = online ? '#30d158' : '#ff453a';
      const btnStyle  = online
        ? 'padding:7px 16px;background:rgba(191,90,242,.2);border:.5px solid rgba(191,90,242,.4);border-radius:10px;color:#bf5af2;font-size:13px;font-weight:700;cursor:pointer'
        : 'padding:7px 16px;background:rgba(255,255,255,.05);border:.5px solid rgba(255,255,255,.10);border-radius:10px;color:var(--tx3);font-size:13px;cursor:not-allowed;opacity:.5';

      return `<a href="${online ? url : 'javascript:void(0)'}"
          style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;text-decoration:none;
                 background:rgba(255,255,255,.07);border:.5px solid ${online?'rgba(48,209,88,.2)':'rgba(255,255,255,.10)'};transition:all .18s"
          onmouseover="if(${online})this.style.background='rgba(48,209,88,.06)'"
          onmouseout="this.style.background='rgba(255,255,255,.07)'">
        <div style="width:10px;height:10px;border-radius:50%;background:${dotColor};box-shadow:${dotGlow};flex-shrink:0;${online?'animation:sbGlow 2s ease-in-out infinite':''}"></div>
        <div style="flex:1">
          <div style="font-size:15px;font-weight:700;color:var(--tx)">${esc(s.name)}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:3px;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:600;color:${statusCol}">${statusTxt}</span>
            <span style="font-size:10px;color:var(--tx3);font-family:var(--mo)">Port ${s.port}</span>
            ${s.track ? `<span style="font-size:10px;color:var(--pu)">🏁 ${esc(tn(s.track))}</span>` : ''}
          </div>
        </div>
        <div>
          ${s.password ? `<div style="font-size:9px;color:var(--tx3);margin-bottom:3px;text-align:right;font-family:var(--mo)">PW: ${esc(s.password)}</div>` : ''}
          <div style="${btnStyle}">${online ? 'Beitreten →' : 'Offline'}</div>
        </div>
      </a>`;
    }).join('');

  } catch(e) {
    list.innerHTML = `<div class="errbox">${e.message}</div>`;
  }
}


/* ── Server-Verwaltung (Einstellungen Modal) ── */
async function loadServerManageList() {
  const el = document.getElementById('server-manage-list');
  if (!el) return;
  try {
    const servers = await apiGet('/acc-servers');
    el.innerHTML = servers.map(s => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                  border-radius:12px;background:rgba(255,255,255,.06);border:.5px solid rgba(255,255,255,.10)">
        <div style="width:8px;height:8px;border-radius:50%;background:${s.online?'#30d158':'#ff453a'};flex-shrink:0"></div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:var(--tx)">${esc(s.name)}</div>
          <div style="font-size:10px;color:var(--tx3);font-family:var(--mo)">${s.ip}:${s.port}</div>
        </div>
        <button onclick="editServer(${JSON.stringify(s).replace(/"/g,'&quot;')})"
          style="padding:4px 10px;border-radius:8px;background:var(--fill);border:.5px solid var(--sep);color:var(--tx2);font-size:12px;cursor:pointer">
          ✏️
        </button>
        <button onclick="deleteServer(${s.id})"
          style="padding:4px 10px;border-radius:8px;background:rgba(255,69,58,.1);border:.5px solid rgba(255,69,58,.3);color:#ff453a;font-size:12px;cursor:pointer">
          🗑️
        </button>
      </div>`).join('');
  } catch(e) {}
}

function openAddServerModal() {
  document.getElementById('edit-server-id').value = '';
  document.getElementById('srv-name').value = '';
  document.getElementById('srv-ip').value = '152.53.47.94';
  document.getElementById('srv-port').value = '9600';
  document.getElementById('srv-pw').value = '123R321';
  document.getElementById('add-server-modal').style.display = 'flex';
}

function editServer(s) {
  document.getElementById('edit-server-id').value = s.id;
  document.getElementById('srv-name').value = s.name;
  document.getElementById('srv-ip').value = s.ip;
  document.getElementById('srv-port').value = s.port;
  document.getElementById('srv-pw').value = s.password || '';
  document.getElementById('add-server-modal').style.display = 'flex';
}

async function saveServerEntry() {
  const id   = document.getElementById('edit-server-id').value;
  const name = document.getElementById('srv-name').value.trim();
  const ip   = document.getElementById('srv-ip').value.trim();
  const port = parseInt(document.getElementById('srv-port').value);
  const pw   = document.getElementById('srv-pw').value;

  if (!name || !ip || !port) { toast('Bitte alle Felder ausfüllen', 'var(--red)'); return; }

  try {
    await fetch(API + '/acc-servers', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ id: id || null, name, ip, port, password: pw })
    });
    document.getElementById('add-server-modal').style.display = 'none';
    toast('✅ Server gespeichert', 'var(--te)');
    loadServerManageList();
  } catch(e) { toast('Fehler: ' + e.message, 'var(--red)'); }
}

async function deleteServer(id) {
  if (!confirm('Server wirklich löschen?')) return;
  try {
    await fetch(API + '/acc-servers/' + id, { method: 'DELETE' });
    toast('Server gelöscht', 'var(--te)');
    loadServerManageList();
  } catch(e) {}
}

// Beim Öffnen der Einstellungen Server-Liste laden
const _origSettings = document.getElementById('settings-modal')?.style;
document.addEventListener('click', e => {
  if (e.target.closest('[onclick*="settings-modal"]')) {
    setTimeout(loadServerManageList, 100);
  }
});

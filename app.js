(function(){
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtQ=n=>Number.isInteger(n)?String(n):String(n).replace('.',',');
const fmtF=id=>{if(!id)return'';const[y,m,d]=id.split('-');return d+'/'+m+'/'+y};
const DIAS=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const diaF=id=>{const[y,m,d]=id.split('-').map(Number);return DIAS[new Date(y,m-1,d).getDay()]};
const keyOf=c=>(String(c).replace(/[^A-Za-z0-9_\-.~:@+]/g,'_')||'x');
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}

let fecha=null,lista=null,marcas={};
let filtro='todos',q='';
let toastT;
function toast(t){const el=$('#toast');el.textContent=t;el.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>el.hidden=true,2600)}

/* ---------- vistas ---------- */
function route(){
  let v=(location.hash||'#revisar').slice(1);
  if(!['revisar','resumen'].includes(v))v='revisar';
  ['revisar','resumen'].forEach(n=>{$('#v-'+n).hidden=n!==v;const t=$('#t-'+n);if(n===v)t.setAttribute('aria-current','page');else t.removeAttribute('aria-current')});
  $('#bar').hidden=v!=='revisar';
  if(v==='resumen')renderResumen();
  window.scrollTo(0,0);
}
addEventListener('hashchange',route);

/* ---------- nombre ---------- */
const nombreEl=$('#nombre');
nombreEl.value=lsGet('av_nombre')||'';
nombreEl.addEventListener('input',()=>lsSet('av_nombre',nombreEl.value.trim()));

/* ---------- estado ---------- */
const est=it=>(marcas[it.k]||{}).estado||null;
const isIssue=it=>{const m=marcas[it.k]||{};return m.estado==='no'||m.estado==='parcial'||!!(m.nota&&m.nota.trim())};
function persist(){lsSet('av_marcas_'+fecha,JSON.stringify(marcas))}

/* ---------- construir lista ---------- */
function buildList(){
  const root=$('#lista');
  if(!lista){root.innerHTML='<div class="empty"><h2>No se pudo cargar la lista</h2><p>Revisa la conexión y recarga la página.</p></div>';return}
  const groups=[];const idx={};
  lista.items.forEach(it=>{if(!(it.g in idx)){idx[it.g]=groups.length;groups.push({g:it.g,items:[]})}groups[idx[it.g]].items.push(it)});
  root.innerHTML=groups.map(gr=>`
    <section class="sec" data-g="${esc(gr.g)}">
      <div class="sec-h">
        <button class="tog" type="button" aria-expanded="true"><span class="name">${esc(gr.g)}</span><span class="cnt"></span><span class="car">▾</span></button>
        <button class="allok" type="button" data-allok="${esc(gr.g)}">Todo bien</button>
      </div>
      <div class="items">${gr.items.map(itemHTML).join('')}</div>
    </section>`).join('');
  refreshAll();
}
function itemHTML(it){
  return `<article class="item" id="it-${esc(it.k)}" data-k="${esc(it.k)}">
    <div class="row1"><span class="code">${esc(it.c)}</span><span class="qty"><b>${fmtQ(it.q)}</b> uds</span></div>
    <p class="desc">${esc(it.d)}</p>
    <div class="acts">
      <button type="button" class="b-si" data-a="si" aria-pressed="false">Tengo</button>
      <button type="button" class="b-parcial" data-a="parcial" aria-pressed="false">Faltan algunas</button>
      <button type="button" class="b-no" data-a="no" aria-pressed="false">No hay</button>
    </div>
    <div class="extra">
      <div class="quedan" hidden>Quedan
        <span class="step"><button type="button" data-st="-1" aria-label="Menos">−</button><input id="q-${esc(it.k)}" type="number" inputmode="decimal" min="0" max="${it.q}" step="1" aria-label="Unidades que quedan"><button type="button" data-st="1" aria-label="Más">+</button></span>
        de ${fmtQ(it.q)}
      </div>
      <div class="nota" hidden><input id="n-${esc(it.k)}" type="text" placeholder="Anotación / incidencia" aria-label="Anotación"></div>
    </div>
    <button type="button" class="add-nota">+ Añadir nota</button>
  </article>`;
}
function refreshItem(it){
  const el=document.getElementById('it-'+it.k);if(!el)return;
  const m=marcas[it.k]||{};const s=m.estado||null;
  el.classList.toggle('st-si',s==='si');el.classList.toggle('st-parcial',s==='parcial');el.classList.toggle('st-no',s==='no');
  el.querySelectorAll('.acts button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.a===s)));
  const qd=el.querySelector('.quedan'),qi=qd.querySelector('input');
  qd.hidden=s!=='parcial';
  if(document.activeElement!==qi)qi.value=m.quedan==null?'':m.quedan;
  const nd=el.querySelector('.nota'),ni=nd.querySelector('input');
  const showNota=s==='no'||s==='parcial'||!!m.nota||el.dataset.notaOpen==='1';
  nd.hidden=!showNota;el.querySelector('.add-nota').hidden=showNota;
  if(document.activeElement!==ni)ni.value=m.nota||'';
  const qs=q.toLowerCase();
  const matchQ=!qs||it.c.toLowerCase().includes(qs)||it.d.toLowerCase().includes(qs);
  const matchF=filtro==='todos'||(filtro==='pend'&&!s)||(filtro==='falt'&&isIssue(it));
  el.hidden=!(matchQ&&matchF);
}
function refreshAll(){
  if(!lista){renderStats();return}
  lista.items.forEach(refreshItem);
  document.querySelectorAll('.sec').forEach(sec=>{
    const its=lista.items.filter(i=>i.g===sec.dataset.g);
    const done=its.filter(est).length;
    sec.querySelector('.cnt').textContent=done+'/'+its.length;
    sec.querySelector('.allok').hidden=done===its.length;
    sec.hidden=!its.some(i=>!document.getElementById('it-'+i.k).hidden);
  });
  renderStats();
  if(!$('#v-resumen').hidden)renderResumen();
}
function counts(){
  const c={si:0,parcial:0,no:0,pend:0,total:lista?lista.items.length:0};
  if(lista)lista.items.forEach(i=>{const s=est(i);if(s)c[s]++;else c.pend++});
  return c;
}
function renderStats(){
  const st=$('#stats');
  if(!lista){st.innerHTML='<span>Sin lista para mostrar</span>';$('#pbar').style.width='0';return}
  const c=counts();const rev=c.total-c.pend;
  $('#pbar').style.width=(c.total?rev/c.total*100:0)+'%';
  st.innerHTML=`<span><b>${rev}</b> de ${c.total} revisados</span><span class="s-si"><b>${c.si}</b> tengo</span><span class="s-par"><b>${c.parcial}</b> faltan algunas</span><span class="s-no"><b>${c.no}</b> no hay</span>`;
  const n=lista.items.filter(isIssue).length;
  $('#bar-btn').textContent=n?`Resumen y envío · ${n} con faltas`:'Resumen y envío';
}

/* ---------- guardar marcas (en este teléfono) ---------- */
function needName(){if(nombreEl.value.trim())return false;nombreEl.focus();toast('Escribe tu nombre antes de marcar');return true}
function save(it,patch){
  const next={...(marcas[it.k]||{}),...patch,ts:new Date().toISOString()};
  if(!next.estado&&!(next.nota&&next.nota.trim()))delete marcas[it.k];else marcas[it.k]=next;
  persist();refreshAll();
}
const itemByK=k=>lista&&lista.items.find(i=>i.k===k);

$('#lista').addEventListener('click',e=>{
  const sec=e.target.closest('.sec');
  const tog=e.target.closest('.tog');
  if(tog){sec.classList.toggle('closed');tog.setAttribute('aria-expanded',String(!sec.classList.contains('closed')));return}
  const ok=e.target.closest('[data-allok]');
  if(ok){if(needName())return;lista.items.filter(i=>i.g===ok.dataset.allok&&!est(i)).forEach(i=>save(i,{estado:'si'}));toast('Proveedor '+ok.dataset.allok+' marcado como completo');return}
  const el=e.target.closest('.item');if(!el)return;
  const it=itemByK(el.dataset.k);if(!it)return;
  const a=e.target.closest('[data-a]');
  if(a){if(needName())return;
    const nv=est(it)===a.dataset.a?null:a.dataset.a;
    const patch={estado:nv};
    if(nv!=='parcial')patch.quedan=null;
    else if((marcas[it.k]||{}).quedan==null)patch.quedan=Math.max(0,Math.floor(it.q)-1);
    save(it,patch);
    if(nv==='parcial')setTimeout(()=>{const i=el.querySelector('.quedan input');if(i){i.focus();i.select()}},50);
    return}
  const st=e.target.closest('[data-st]');
  if(st){const m=marcas[it.k]||{};let v=Number(m.quedan??0)+Number(st.dataset.st);v=Math.min(Math.max(0,v),it.q);if(v>=it.q){save(it,{estado:'si',quedan:null});return}save(it,{quedan:v});return}
  if(e.target.closest('.add-nota')){el.dataset.notaOpen='1';refreshItem(it);el.querySelector('.nota input').focus()}
});
$('#lista').addEventListener('change',e=>{
  const el=e.target.closest('.item');if(!el)return;const it=itemByK(el.dataset.k);if(!it)return;
  if(e.target.matches('.quedan input')){
    const v=e.target.value===''?null:Number(e.target.value);
    if(v!=null&&(isNaN(v)||v<0)){toast('Escribe un número de 0 a '+fmtQ(it.q));refreshItem(it);return}
    if(v!=null&&v>=it.q){save(it,{estado:'si',quedan:null});return}
    save(it,{quedan:v});
  }
  if(e.target.matches('.nota input')){if(needName())return;save(it,{nota:e.target.value.trim()})}
});
$('#buscar').addEventListener('input',e=>{q=e.target.value.trim();refreshAll()});
document.querySelectorAll('.chip').forEach(b=>b.addEventListener('click',()=>{filtro=b.dataset.f;document.querySelectorAll('.chip').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));refreshAll()}));

/* ---------- resumen + WhatsApp ---------- */
function buildMsg(){
  if(!lista)return'';
  const c=counts();
  let out=`FALTANTES · ANTONIO VIÑA · ${fmtF(fecha)}\nRevisó: ${nombreEl.value.trim()||'Sin indicar'}\nRevisados ${c.total-c.pend}/${c.total} · Pendientes ${c.pend}\n`;
  const iss=lista.items.filter(isIssue);
  if(!iss.length)return out+'\nSin faltantes.';
  let g=null;
  iss.forEach(it=>{
    const m=marcas[it.k]||{};
    if(it.g!==g){g=it.g;out+=`\n${g}\n`}
    let l=`• ${it.c} ${it.d} — pedido ${fmtQ(it.q)}`;
    if(m.estado==='no')l+=' · NO HAY';
    else if(m.estado==='parcial'&&m.quedan!=null)l+=` · quedan ${fmtQ(m.quedan)} · faltan ${fmtQ(Math.max(0,it.q-m.quedan))}`;
    if(m.nota)l+=`\n   Nota: ${m.nota}`;
    out+=l+'\n';
  });
  return out.trim();
}
function renderResumen(){
  if(!lista)return;
  const c=counts();
  $('#sumgrid').innerHTML=`<div><b>${c.total-c.pend}</b><span>Revisados</span></div><div class="g-si"><b>${c.si}</b><span>Tengo</span></div><div class="g-par"><b>${c.parcial}</b><span>Faltan alg.</span></div><div class="g-no"><b>${c.no}</b><span>No hay</span></div>`;
  $('#sumwho').textContent=c.pend?c.pend+' artículos sin revisar.':'Lista completa.';
  const iss=lista.items.filter(isIssue);
  if(!iss.length){$('#issues').innerHTML='<span class="lbl">Faltantes</span><p class="hint" style="margin:0">No hay faltantes marcados.</p>'}
  else{
    let h='<span class="lbl">Faltantes por proveedor</span>',g=null,open=false;
    iss.forEach(it=>{const m=marcas[it.k]||{};
      if(it.g!==g){if(open)h+='</ul>';g=it.g;h+=`<h3>${esc(g)}</h3><ul>`;open=true}
      const st=m.estado==='no'?'<span class="no">No hay</span>':m.estado==='parcial'?`<span class="par">Quedan ${fmtQ(m.quedan??0)} · faltan ${fmtQ(Math.max(0,it.q-(m.quedan??0)))}</span>`:'Con nota';
      h+=`<li><span class="t">${esc(it.d)}</span><span class="m">${esc(it.c)} · pedido ${fmtQ(it.q)} · ${st}</span>${m.nota?`<span class="m">Nota: ${esc(m.nota)}</span>`:''}</li>`});
    $('#issues').innerHTML=h+'</ul>';
  }
  const msg=buildMsg();$('#msg').textContent=msg;
  $('#wa').href='https://wa.me/?text='+encodeURIComponent(msg);
}
$('#copiar').addEventListener('click',()=>{
  const t=buildMsg();
  const sel=()=>{const r=document.createRange();r.selectNodeContents($('#msg'));const s=getSelection();s.removeAllRanges();s.addRange(r);toast('Texto seleccionado: cópialo')};
  try{navigator.clipboard.writeText(t).then(()=>toast('Texto copiado'),sel)}catch(e){sel()}
});

/* ---------- arranque ---------- */
route();
fetch('lista.json?v='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(r.status);return r.json()}).then(data=>{
  fecha=data.fecha;
  const seen={};
  lista={items:(data.items||[]).map(i=>{let k=keyOf(i.c);if(seen[k]){seen[k]++;k+='~'+seen[k]}else seen[k]=1;return{g:i.g,c:String(i.c),q:Number(i.q),d:i.d,k}})};
  try{marcas=JSON.parse(lsGet('av_marcas_'+fecha)||'{}')||{}}catch(e){marcas={}}
  $('#fecha').innerHTML=`<option>${diaF(fecha)} ${fmtF(fecha)} · ${lista.items.length} artículos</option>`;
  document.title='Control de existencias · '+fmtF(fecha);
  buildList();
}).catch(()=>{lista=null;$('#fecha').innerHTML='<option>Sin lista</option>';buildList();renderStats()});
})();

(function(){
'use strict';

const $=(s,r=document)=>r.querySelector(s);
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ');
const clean=v=>String(v??'').trim();

function getCatalog(){
  try{
    if(typeof catalogo!=='undefined' && Array.isArray(catalogo)) return catalogo;
  }catch(e){}
  if(Array.isArray(window.catalogo)) return window.catalogo;
  throw new Error('Catálogo de códigos não disponível.');
}
function codeOf(x){return clean(x?.code ?? x?.codigo ?? x?.cod ?? x?.serviceCode ?? x?.codigoServico)}
function descOf(x){return clean(x?.description ?? x?.descricao ?? x?.servico ?? x?.nome)}
function timeOf(x){return Number(x?.standardMin ?? x?.tempoPadrao ?? x?.tempo ?? x?.minutos ?? 0)||0}
function parseNumber(v){
  if(typeof v==='number' && Number.isFinite(v))return v;
  const s=clean(v).replace(/\s/g,'').replace(',','.');
  const n=Number(s);return Number.isFinite(n)?n:0;
}
function parseMinutes(v,header){
  const h=norm(header),raw=clean(v);
  if(!raw)return 0;
  if(/^\d{1,2}:\d{1,2}(:\d{1,2})?$/.test(raw)){
    const p=raw.split(':').map(Number);return Math.round((p[0]||0)*60+(p[1]||0)+(p[2]||0)/60);
  }
  let n=parseNumber(v);if(!n)return 0;
  if(h.includes('hora'))return Math.round(n*60);
  if(h.includes('min'))return Math.round(n);
  // Planilhas de mão de obra costumam usar hora decimal (0,5 = 30 min).
  if(n>0 && n<=8)return Math.round(n*60);
  return Math.round(n);
}
function findHeader(rows){
  const aliases=['codigo','cod','descricao','servico','tempo','padrao','minuto','hora'];
  let best={idx:0,score:-1};
  rows.slice(0,20).forEach((r,i)=>{
    const score=(r||[]).reduce((a,c)=>a+(aliases.some(x=>norm(c).includes(x))?1:0),0);
    if(score>best.score)best={idx:i,score};
  });
  return best.idx;
}
function locate(headers,tests){
  const hs=headers.map(norm);
  for(const t of tests){const i=hs.findIndex(h=>t(h));if(i>=0)return i}
  return -1;
}
function makeId(){return (crypto?.randomUUID?.()||('cat-'+Date.now()+'-'+Math.random().toString(36).slice(2)))}
function show(msg,type=''){
  const el=$('#ajcCodeImportStatus');if(el){el.textContent=msg;el.className='ajc-import-status '+type}
  try{if(typeof toast==='function')toast(msg)}catch(e){}
}
function saveCatalog(){
  try{if(typeof persist==='function')persist()}catch(e){console.warn('persist catálogo',e)}
  try{if(typeof renderCatalogo==='function')renderCatalogo()}catch(e){console.warn('render catálogo',e)}
  try{window.oficinaCloud?.queueSync?.()}catch(e){}
}

async function importFile(file){
  if(!file)return;
  if(!window.XLSX){show('Biblioteca de Excel não carregada. Atualize a página e tente novamente.','err');return}
  try{
    show('Lendo planilha...');
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array',cellDates:false});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
    if(!rows.length)throw new Error('A planilha está vazia.');
    const hi=findHeader(rows),headers=(rows[hi]||[]).map(clean);
    const ci=locate(headers,[h=>h==='codigo',h=>h==='cod',h=>h.includes('codigo servico'),h=>h.startsWith('codigo'),h=>h.startsWith('cod ')]);
    const di=locate(headers,[h=>h==='descricao',h=>h.includes('descricao'),h=>h==='servico',h=>h.includes('servico')]);
    const ti=locate(headers,[h=>h.includes('tempo padrao'),h=>h.includes('padrao'),h=>h.includes('minuto'),h=>h.includes('tempo'),h=>h.includes('hora')]);
    const gi=locate(headers,[h=>h.includes('categoria'),h=>h.includes('grupo'),h=>h==='tipo']);
    if(ci<0)throw new Error('Não encontrei a coluna CÓDIGO. Use o modelo disponível no botão ao lado.');
    const arr=getCatalog();
    const map=new Map(arr.map((x,i)=>[norm(codeOf(x)),{x,i}]).filter(([k])=>k));
    let added=0,updated=0,ignored=0;
    for(let r=hi+1;r<rows.length;r++){
      const row=rows[r]||[],code=clean(row[ci]);
      if(!code){ignored++;continue}
      const desc=di>=0?clean(row[di]):'', mins=ti>=0?parseMinutes(row[ti],headers[ti]):0, group=gi>=0?clean(row[gi]):'';
      const key=norm(code),found=map.get(key);
      if(found){
        const x=found.x;
        // grava aliases para manter compatibilidade com versões anteriores do catálogo
        x.code=code;x.codigo=code;
        if(desc){x.description=desc;x.descricao=desc}
        if(mins>0){x.standardMin=mins;x.tempoPadrao=mins;x.minutos=mins}
        if(group){x.category=group;x.categoria=group}
        if(x.active==null)x.active=true;
        updated++;
      }else{
        const item={id:makeId(),code,codigo:code,description:desc,descricao:desc,standardMin:mins,tempoPadrao:mins,minutos:mins,category:group,categoria:group,active:true};
        arr.push(item);map.set(key,{x:item,i:arr.length-1});added++;
      }
    }
    saveCatalog();
    show('Importação concluída: '+added+' novos, '+updated+' atualizados'+(ignored?' e '+ignored+' linhas ignoradas.':'.'),'ok');
  }catch(e){
    console.error(e);show('Erro ao importar: '+(e?.message||e),'err');
  }finally{
    const input=$('#ajcCodeFile');if(input)input.value='';
  }
}
function downloadTemplate(){
  if(!window.XLSX){show('Biblioteca de Excel não carregada.','err');return}
  const data=[
    ['Código','Descrição','Tempo Padrão (min)','Categoria'],
    ['EX001','Exemplo de serviço',30,'Mecânica']
  ];
  const ws=XLSX.utils.aoa_to_sheet(data),wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Codigos');
  XLSX.writeFile(wb,'MODELO_IMPORTACAO_CODIGOS_AJC.xlsx');
}
function installUI(){
  // remove os blocos experimentais da Home mesmo se uma versão antiga tentar recriá-los
  $('#v177HomeGrid')?.remove();$('#v177Footer')?.remove();
  document.querySelectorAll('.v177-home-grid,.v177-page-footer').forEach(x=>x.remove());

  const sec=$('#servicos');if(!sec||$('#ajcCodeImportBox'))return;
  const box=document.createElement('div');box.id='ajcCodeImportBox';box.className='ajc-code-import';
  box.innerHTML='<div class="ajc-code-import-copy"><strong>Importar planilha de códigos / tempos</strong><span>Excel ou CSV • Código obrigatório • Descrição, tempo padrão e categoria são opcionais.</span></div><div class="ajc-code-import-actions"><button type="button" class="ajc-import-btn" id="ajcImportCodesBtn">⬆ Importar planilha</button><button type="button" class="ajc-template-btn" id="ajcTemplateCodesBtn">⇩ Baixar modelo</button><input id="ajcCodeFile" type="file" accept=".xlsx,.xls,.csv,text/csv" hidden></div><div class="ajc-import-status" id="ajcCodeImportStatus">Ao importar, códigos já existentes serão atualizados; códigos novos serão adicionados.</div>';
  const head=sec.querySelector('.section-head');
  if(head)head.insertAdjacentElement('afterend',box);else sec.prepend(box);
  $('#ajcImportCodesBtn')?.addEventListener('click',()=>$('#ajcCodeFile')?.click());
  $('#ajcTemplateCodesBtn')?.addEventListener('click',downloadTemplate);
  $('#ajcCodeFile')?.addEventListener('change',e=>importFile(e.target.files?.[0]));
}
function boot(){installUI();setTimeout(installUI,800);setTimeout(installUI,2200)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
window.AJC_IMPORT_CODES={importFile,downloadTemplate};
})();
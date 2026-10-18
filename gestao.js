'use strict';
/* =====================================================================================
   GESTÃO DO CONFINAMENTO — lotes, pesagens, insumos, rações, leitura de cocho e relatórios
   O consumo de cada lote vem do realizado no trato (curral a curral), já lançado no app.
   Tudo fica no celular (funciona sem internet) e sobe para a planilha (aba "Gestao").
   ===================================================================================== */
const GK='confinamento-gestao-v1';
let G={it:{},pend:[]};
function gLoad(){try{const x=JSON.parse(localStorage.getItem(GK));if(x&&x.it)G=x;}catch(e){}G.it=G.it||{};G.pend=G.pend||[];}
function gSave(){try{localStorage.setItem(GK,JSON.stringify(G));}catch(e){toast('Memória do celular cheia');}}
gLoad();

/* ---------- utilidades ---------- */
const gNum=v=>{if(v==null)return NaN;let s=String(v).trim().replace(/\s/g,'').replace(/^R\$/i,'').replace(/%$/,'');if(!s)return NaN;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');return parseFloat(s);};
const ok=n=>n!=null&&isFinite(n);
const nf=(n,d=0)=>ok(n)?n.toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const rs=(n,d=2)=>ok(n)?'R$ '+nf(n,d):'—';
const pc=(n,d=1)=>ok(n)?nf(n,d)+'%':'—';
const vIn=n=>ok(n)?String(+(+n).toFixed(4)).replace('.',','):'';
const dB=k=>k?diaBR(k):'—';
const pD=s=>{const [y,m,d]=s.split('-').map(Number);return Date.UTC(y,m-1,d);};
const difDias=(a,b)=>Math.round((pD(b)-pD(a))/864e5);
const somaDias=(k,n)=>{const [y,m,d]=k.split('-').map(Number);return diaKey(new Date(y,m-1,d+n));};
const porNome=(a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR',{numeric:true});
const porDia=(a,b)=>a.dia<b.dia?-1:a.dia>b.dia?1:(a.ts||0)-(b.ts||0);
const novoId=p=>p+'-'+((S&&S.aparelho)||'x')+'-'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
/* lista com histórico ({desde,...}): vale o último com data <= dia; antes do primeiro vale o primeiro */
function vig(arr,dia){if(!arr||!arr.length)return null;const s=arr.slice().sort((a,b)=>a.desde<b.desde?-1:a.desde>b.desde?1:0);let r=s[0];for(const x of s){if(x.desde<=dia)r=x;else break;}return r;}
function setHist(arr,desde,obj){const i=arr.findIndex(x=>x.desde===desde);const n=Object.assign({desde},obj);if(i>=0)arr[i]=n;else arr.push(n);arr.sort((a,b)=>a.desde<b.desde?-1:1);}

/* ---------- banco: itens com uid; o mais novo vale ---------- */
function gPut(x){const old=G.it[x.uid];x.ts=Math.max(Date.now(),old?(old.ts||0)+1:0);G.it[x.uid]=x;if(!G.pend.includes(x.uid))G.pend.push(x.uid);gSave();gAgendar();}
function gDel(uid){const x=G.it[uid];if(!x)return;x.del=1;gPut(x);}
const gTodos=t=>Object.values(G.it).filter(x=>x.tipo===t&&!x.del);
const gPend=()=>G.pend.length;

/* ---------- nuvem ---------- */
let gSinc=false,gTimer=null,gUltPuxa=0;
function gAgendar(){clearTimeout(gTimer);gTimer=setTimeout(()=>gSync(true).catch(()=>{}),2000);if(typeof statusNuvem==='function')statusNuvem();}
async function gSync(puxar){
  if(!apiUrl()||!navigator.onLine||gSinc)return;
  gSinc=true;
  try{
    if(G.pend.length){
      const ids=G.pend.slice(0,300),enviado={};
      const itens=ids.map(u=>{const x=G.it[u];if(x)enviado[u]=x.ts;return x;}).filter(Boolean);
      const j=await postApi({acao:'gestao',itens});
      const okU=new Set(j.uids||[]);
      G.pend=G.pend.filter(u=>!(okU.has(u)&&(!G.it[u]||G.it[u].ts===enviado[u])));gSave();
    }
    if(puxar||Date.now()-gUltPuxa>2*60000){
      gUltPuxa=Date.now();
      const r=await fetch(apiUrl()+'?acao=gestao',{cache:'no-store'});const j=await r.json();
      if(j&&j.ok&&Array.isArray(j.itens)){let mud=false;
        j.itens.forEach(x=>{if(!x||!x.uid)return;const l=G.it[x.uid];
          if(!l||((+x.ts||0)>(l.ts||0)&&!G.pend.includes(x.uid))){G.it[x.uid]=x;mud=true;}});
        if(mud){gSave();if(!$('viewGest').hidden&&!gEditando())gRender();}
      }
    }
  }finally{gSinc=false;if(typeof statusNuvem==='function')statusNuvem();}
}
const gEditando=()=>{const a=document.activeElement;return a&&$('gBox').contains(a)&&/INPUT|SELECT|TEXTAREA/.test(a.tagName);};
setInterval(()=>{if(modoVer&&!$('viewGest').hidden&&navigator.onLine&&document.visibilityState==='visible')gSync(true).catch(()=>{});},20000);

/* ---------- configurações ---------- */
const NOTAS_PADRAO=[
  {n:0,t:'Cocho limpo, lambido',p:10},
  {n:1,t:'Pouca sobra (ideal)',p:0},
  {n:2,t:'Sobra pequena',p:-5},
  {n:3,t:'Sobra média',p:-10},
  {n:4,t:'Muita sobra',p:-15}];
function gCfg(){const c=G.it.config&&!G.it.config.del?G.it.config:{uid:'config',tipo:'config'};
  if(!Array.isArray(c.taxa))c.taxa=[];if(!Array.isArray(c.notas)||!c.notas.length)c.notas=NOTAS_PADRAO.map(x=>Object.assign({},x));
  if(!ok(c.arred))c.arred=10;if(!ok(c.pvIni))c.pvIni=2.2;if(!ok(c.rc))c.rc=52;return c;}
const taxaEm=dia=>{const v=vig(gCfg().taxa,dia);return v?+v.rs||0:0;};

/* ---------- insumos e rações ---------- */
const precoIns=(ins,dia)=>{const v=vig(ins.precos,dia);return v?+v.rs:NaN;}; // R$ por tonelada (matéria natural)
function compRacao(rac,dia){
  const v=vig(rac&&rac.versoes,dia);if(!v)return null;
  const itens=(v.itens||[]).map(i=>{const ins=G.it[i.ins];const vivo=ins&&!ins.del;
    return {ins:vivo?ins:null,nome:vivo?ins.nome:'(insumo apagado)',pMS:+i.pMS||0,ms:vivo?+ins.ms:NaN,preco:vivo?precoIns(ins,dia):NaN};});
  let somaM=0;itens.forEach(i=>{i.m=i.pMS/((i.ms||NaN)/100);somaM+=i.m;});
  const somaMS=itens.reduce((a,i)=>a+i.pMS,0);
  itens.forEach(i=>i.pMN=i.m/somaM*100);
  const ms=somaMS/somaM*100;                                       // % de matéria seca da mistura
  const custoMN=itens.reduce((a,i)=>a+(i.pMN/100)*(i.preco/1000),0); // R$ por kg de matéria natural
  return {itens,ms,custoMN,custoMS:custoMN/(ms/100),somaMS,desde:v.desde};
}

/* ---------- lotes ---------- */
const saidasDe=l=>gTodos('saida').filter(s=>s.lote===l.uid).sort(porDia);
const pesagensDe=l=>gTodos('pesagem').filter(s=>s.lote===l.uid).sort(porDia);
/* cabeças que comem no dia (quem sai no dia ainda comeu de manhã) e cabeças para a taxa operacional */
function cabPres(l,dia,sd){if(!l.ent||dia<l.ent.dia)return 0;let c=+l.ent.cab||0;(sd||saidasDe(l)).forEach(s=>{if(s.dia<dia)c-=+s.cab||0;});return Math.max(0,c);}
function cabEm(l,dia,sd){if(!l.ent||dia<l.ent.dia)return 0;let c=+l.ent.cab||0;(sd||saidasDe(l)).forEach(s=>{if(s.dia<=dia)c-=+s.cab||0;});return Math.max(0,c);}
const cabAtual=l=>cabEm(l,hojeKey());
const curralEm=(l,dia)=>{const v=vig(l.curr,dia);return v?v.c:'';};
const racaoEm=(l,dia)=>{const v=vig(l.rac,dia);const r=v&&G.it[v.r];return r&&!r.del?r:null;};
function pesoEm(l,dia,pz){if(!l.ent)return NaN;let b={dia:l.ent.dia,peso:+l.ent.peso};(pz||pesagensDe(l)).forEach(p=>{if(p.dia<=dia)b=p;});return +b.peso+(+l.gmd||0)*difDias(b.dia,dia);}
const fimLote=l=>{if(cabAtual(l)>0)return null;const sd=saidasDe(l);return sd.length?sd[sd.length-1].dia:null;};
const ativo=l=>cabAtual(l)>0||(l.ent&&l.ent.dia>hojeKey());
const lotesAtivos=()=>gTodos('lote').filter(ativo).sort(porNome);
function valorCompra(l){const e=l.ent||{};const cab=+e.cab||0,peso=+e.peso||0,p=+e.preco||0;
  const v=e.unid==='cab'?cab*p:e.unid==='kg'?cab*peso*p:cab*peso/30*p;return v+(+e.outros||0);}
const arrobaVenda=s=>(+s.cab||0)*(+s.peso||0)*((+s.rc||0)/100)/15;
function valorVenda(s){const cab=+s.cab||0,peso=+s.peso||0,p=+s.preco||0;
  const v=s.unid==='cab'?cab*p:s.unid==='kg'?cab*peso*p:arrobaVenda(s)*p;return v-(+s.desc||0);}

/* ---------- consumo e custo por dia (a partir do realizado do trato) ---------- */
function gIndice(){const m=new Map();(HIST||[]).forEach(r=>{const k=r.dia+'|'+r.curral;m.set(k,(m.get(k)||0)+(+r.forn||0));});return m;}
function gCtx(){const L=gTodos('lote');const sd=new Map(),pz=new Map();L.forEach(l=>{sd.set(l.uid,saidasDe(l));pz.set(l.uid,pesagensDe(l));});return {ix:gIndice(),L,sd,pz};}
function diaLote(l,dia,X){
  const sd=X.sd.get(l.uid),cab=cabPres(l,dia,sd);if(!cab)return null;
  const c=curralEm(l,dia),tot=X.ix.get(dia+'|'+c)||0;
  const juntos=X.L.filter(o=>curralEm(o,dia)===c&&cabPres(o,dia,X.sd.get(o.uid))>0);
  const cabTot=juntos.reduce((a,o)=>a+cabPres(o,dia,X.sd.get(o.uid)),0)||cab;
  const mn=tot*cab/cabTot,rac=racaoEm(l,dia),cp=rac?compRacao(rac,dia):null;
  const ms=cp?mn*cp.ms/100:NaN,peso=pesoEm(l,dia,X.pz.get(l.uid)),cabOp=cabEm(l,dia,sd);
  return {dia,c,cab,cabOp,peso,mn,ms,mnCab:mn/cab,msCab:ms/cab,pv:ms/cab/peso*100,
    custoR:cp?mn*cp.custoMN:NaN,custoOp:cabOp*taxaEm(dia),rac:rac?rac.nome:'—',tem:tot>0,juntos:juntos.length};
}
function resumoLote(l,ate){
  const X=gCtx(),ini=l.ent.dia,fim=ate||fimLote(l)||hojeKey();
  const r={dias:0,cabDias:0,cabOpDias:0,mn:0,ms:0,custoR:0,custoOp:0,pvS:0,pvN:0,semPreco:0,semReg:0};
  if(ini>fim)return r;
  for(let d=ini,i=0;d<=fim&&i<4000;d=somaDias(d,1),i++){const x=diaLote(l,d,X);if(!x)continue;r.dias++;r.cabDias+=x.cab;r.cabOpDias+=x.cabOp;r.mn+=x.mn;
    if(ok(x.ms))r.ms+=x.ms;if(ok(x.custoR))r.custoR+=x.custoR;else if(x.mn>0)r.semPreco++;r.custoOp+=x.custoOp;if(!x.tem)r.semReg++;
    if(ok(x.pv)&&x.mn>0){r.pvS+=x.pv;r.pvN++;}}
  return r;
}

/* =====================================================================================
   TELAS
   ===================================================================================== */
let GT={t:'home'};const gPilha=[];
function gIr(t){gPilha.push(GT);GT=t;gRender();window.scrollTo({top:0});}
function gVoltar(){GT=gPilha.pop()||{t:'home'};gRender();window.scrollTo({top:0});}
const voltar=(txt)=>`<button class="gVoltar" data-g="voltar">❮ ${txt||'Voltar'}</button>`;
const card=(t,b,cls)=>`<section class="panel ${cls||''}"><h2>${t}</h2>${b}</section>`;
const st=(rot,val,cls)=>`<div class="${cls||''}"><small>${rot}</small><b class="num">${val}</b></div>`;
function campo(f){const id='gf_'+f.k,v=f.v==null?'':f.v;let inp;
  if(f.t==='sel')inp=`<select id="${id}">${f.op.map(([a,b])=>`<option value="${esc(a)}"${String(a)===String(v)?' selected':''}>${esc(b)}</option>`).join('')}</select>`;
  else if(f.t==='dia')inp=`<input type="date" id="${id}" value="${esc(v)}">`;
  else if(f.t==='num')inp=`<input type="text" inputmode="decimal" id="${id}" value="${esc(vIn(v))}" placeholder="${esc(f.ph||'')}" autocomplete="off">`;
  else inp=`<input type="text" id="${id}" value="${esc(v)}" placeholder="${esc(f.ph||'')}" autocomplete="off">`;
  return `<div class="gCampo${f.meia?' meia':''}"><label for="${id}">${esc(f.l)}${f.suf?` <span class="gSuf">(${esc(f.suf)})</span>`:''}</label>${inp}${f.ajuda?`<p class="note">${f.ajuda}</p>`:''}</div>`;}
const fv=k=>{const e=$('gf_'+k);return e?e.value.trim():'';};
const fn=k=>gNum(fv(k));
const opCurrais=()=>(S.cadastro||[]).map(n=>[n,n]);
const opRacoes=()=>[['','— escolher —']].concat(gTodos('racao').sort(porNome).map(r=>[r.uid,r.nome]));
const opInsumos=()=>gTodos('insumo').sort(porNome).map(r=>[r.uid,r.nome]);
const UNID_C=[['arroba','R$ por @ (peso vivo ÷ 30)'],['cab','R$ por cabeça'],['kg','R$ por kg vivo']];
const UNID_V=[['arroba','R$ por @ (carcaça ÷ 15)'],['cab','R$ por cabeça'],['kg','R$ por kg vivo']];

function gRender(){
  const b=$('gBox');if(!b)return;
  const f={home:tHome,lotes:tLotes,lote:tLote,loteForm:tLoteForm,pesForm:tPesForm,saiForm:tSaiForm,mudForm:tMudForm,rel:tRelLote,
    cocho:tCocho,dia:tDia,racoes:tRacoes,racForm:tRacForm,insumos:tInsumos,insForm:tInsForm,cfg:tCfg}[GT.t]||tHome;
  b.innerHTML=f(GT);
  if(GT.t==='racForm')calcRacao();
  if(GT.t==='rel')calcSimul();
}

/* ---------- início ---------- */
function tHome(){
  const hj=hojeKey(),ont=somaDias(hj,-1),X=gCtx(),A=lotesAtivos();
  let cab=0,mn=0,cus=0;A.forEach(l=>{cab+=cabAtual(l);const x=diaLote(l,ont,X);if(x){mn+=x.mn;cus+=(ok(x.custoR)?x.custoR:0)+x.custoOp;}});
  const semLeit=cochoCurrais(hj).filter(c=>!G.it[idLeit(hj,c)]).length;
  return `<section class="panel"><h2>Resumo</h2><div class="stat">${st('Lotes ativos',nf(A.length))}${st('Cabeças',nf(cab))}${st('Trato ontem',nf(mn)+' kg')}${st('Custo ontem',rs(cus,0))}</div>
    ${semLeit?`<p class="aviso warn">Leitura de cocho de hoje: falta em ${semLeit} curral(is).</p>`:''}</section>
  <div class="gGrade">
    <button class="gBig" data-g="ir" data-t="lotes">🐂<b>Lotes</b><small>entrada, pesagem, venda</small></button>
    <button class="gBig" data-g="ir" data-t="cocho">🥣<b>Leitura de cocho</b><small>ajusta o previsto</small></button>
    <button class="gBig" data-g="ir" data-t="dia">📋<b>Relatório do dia</b><small>consumo e custo</small></button>
    <button class="gBig" data-g="ir" data-t="racoes">🌾<b>Rações</b><small>formulação e custo</small></button>
    <button class="gBig" data-g="ir" data-t="insumos">🧺<b>Insumos</b><small>preço e matéria seca</small></button>
    <button class="gBig" data-g="ir" data-t="cfg">⚙️<b>Configurações</b><small>taxa e notas</small></button>
  </div>`;
}

/* ---------- lotes ---------- */
function tLotes(t){
  const hj=hojeKey(),X=gCtx(),todosL=gTodos('lote').sort(porNome),lista=t.enc?todosL.filter(l=>!ativo(l)):todosL.filter(ativo);
  const ont=somaDias(hj,-1);
  const cards=lista.map(l=>{const cab=cabAtual(l),r=racaoEm(l,hj),x=diaLote(l,ont,X),fim=fimLote(l);
    return `<button class="gItem" data-g="lote" data-id="${l.uid}"><div class="gItemTopo"><b>${esc(l.nome)}</b><span class="pill">${esc(curralEm(l,hj)||'—')}</span></div>
      <div class="gItemInfo">${fim?`Encerrado em ${dB(fim)}`:`${nf(cab)} cab · ${nf(difDias(l.ent.dia,hj))} dias · ${nf(pesoEm(l,hj))} kg proj.`}<br>${esc(r?r.nome:'sem ração')}${x&&x.mn>0?` · ontem ${nf(x.msCab,2)} kg MS/cab (${pc(x.pv,2)} PV)`:''}</div></button>`;}).join('');
  return `${voltar('Gestão')}<section class="panel"><div class="curhead"><h2>${t.enc?'Lotes encerrados':'Lotes ativos'}</h2><span class="note">${lista.length}</span></div>
    ${cards||`<p class="note">${t.enc?'Nenhum lote encerrado.':'Nenhum lote ainda. Toque em “+ Novo lote”.'}</p>`}
    ${t.enc?'':'<button class="lima" data-g="novoLote">+ Novo lote</button>'}
    <button data-g="ir" data-t="lotes" data-enc="${t.enc?'':'1'}">${t.enc?'Ver lotes ativos':'Ver lotes encerrados'}</button></section>`;
}
function tLoteForm(t){
  const l=t.id?G.it[t.id]:null,e=(l&&l.ent)||{},hj=hojeKey(),novo=!l,cfg=gCfg();
  const fs=[{k:'nome',l:'Nome do lote',v:l?l.nome:'',ph:'Ex.: Lote 1 - Nelore'}];
  if(novo)fs.push({k:'curral',l:'Curral / pasto',t:'sel',op:opCurrais(),v:''});
  fs.push({k:'dia',l:'Data de entrada',t:'dia',v:e.dia||hj,meia:1},{k:'cab',l:'Cabeças',t:'num',v:e.cab,meia:1},
    {k:'peso',l:'Peso médio de entrada',suf:'kg',t:'num',v:e.peso,meia:1},{k:'gmd',l:'Ganho por dia (meta)',suf:'kg/cab/dia',t:'num',v:l?l.gmd:1.5,meia:1},
    {k:'unid',l:'Preço de compra em',t:'sel',op:UNID_C,v:e.unid||'arroba'},{k:'preco',l:'Preço de compra',suf:'R$',t:'num',v:e.preco,meia:1},
    {k:'outros',l:'Frete e outros custos de compra',suf:'R$ total',t:'num',v:e.outros,meia:1});
  if(novo)fs.push({k:'racao',l:'Ração',t:'sel',op:opRacoes(),v:''});
  fs.push({k:'alvo',l:'Peso de saída desejado (opcional)',suf:'kg',t:'num',v:l?l.alvo:''},{k:'obs',l:'Observação',v:l?l.obs:''});
  return `${voltar()}<section class="panel"><h2>${novo?'Novo lote':'Editar lote'}</h2><div class="gForm">${fs.map(campo).join('')}</div>
    ${novo?'':'<p class="note">Curral e ração mudam pelos botões “Mudar curral” e “Mudar ração” do lote, com a data da mudança.</p>'}
    <button class="primary" data-g="salvaLote" data-id="${t.id||''}">Salvar</button></section>`;
}
function salvaLote(id){
  const nome=fv('nome'),dia=fv('dia'),cab=fn('cab'),peso=fn('peso');
  if(!nome)return toast('Coloque o nome do lote');if(!dia)return toast('Coloque a data de entrada');
  if(!(cab>0))return toast('Coloque as cabeças');if(!(peso>0))return toast('Coloque o peso médio de entrada');
  const l=id?JSON.parse(JSON.stringify(G.it[id])):{uid:novoId('lote'),tipo:'lote',curr:[],rac:[]};
  if(!id){const c=fv('curral');if(!c)return toast('Escolha o curral');l.curr=[{desde:dia,c}];const r=fv('racao');l.rac=r?[{desde:dia,r}]:[];}
  else{if(l.curr.length&&l.curr[0].desde>dia)l.curr[0].desde=dia;if(l.rac.length&&l.rac[0].desde>dia)l.rac[0].desde=dia;}
  l.nome=nome;l.ent={dia,cab,peso,unid:fv('unid'),preco:fn('preco'),outros:fn('outros')||0};l.gmd=fn('gmd')||0;l.alvo=fn('alvo')||null;l.obs=fv('obs');
  gPut(l);toast('Lote salvo');gPilha.pop();GT={t:'lote',id:l.uid};gRender();
}
function tLote(t){
  const l=G.it[t.id];if(!l||l.del)return `${voltar()}<p class="note">Lote não encontrado.</p>`;
  const hj=hojeKey(),cab=cabAtual(l),fim=fimLote(l),ref=fim||hj,X=gCtx(),ont=somaDias(hj,-1),x=fim?null:diaLote(l,ont,X);
  const r=racaoEm(l,ref),pz=pesagensDe(l),sd=saidasDe(l),pj=pesoEm(l,ref);
  let prevAlvo='';if(!fim&&l.alvo&&l.gmd>0){const falta=(l.alvo-pj)/l.gmd;prevAlvo=falta<=0?'já atingiu o peso desejado':`${dB(somaDias(hj,Math.ceil(falta)))} (${nf(Math.ceil(falta))} dias)`;}
  const proj=fim?'':`<div class="tablebox"><table><thead><tr><th>Projeção</th><th>Data</th><th>Peso (kg)</th><th>@ (÷30)</th></tr></thead><tbody>${[0,30,60,90].map(n=>{const d=somaDias(hj,n),p=pesoEm(l,d);return `<tr><td>${n?'+'+n+' dias':'Hoje'}</td><td>${dB(d)}</td><td>${nf(p)}</td><td>${nf(p/30,1)}</td></tr>`;}).join('')}</tbody></table></div>`;
  let ant={dia:l.ent.dia,peso:+l.ent.peso};
  const lp=pz.map(p=>{const dd=difDias(ant.dia,p.dia),g=dd>0?(p.peso-ant.peso)/dd:NaN;ant=p;
    return `<tr><td>${dB(p.dia)}</td><td>${nf(p.peso)}</td><td>${nf(g,3)}</td><td>${p.cab?nf(p.cab):'—'}</td><td class="acoes"><button class="mini danger" data-g="apaga" data-id="${p.uid}" data-o="pesagem">✕</button></td></tr>`;}).join('');
  const ls=sd.map(s=>`<tr><td>${dB(s.dia)}</td><td>${s.mot==='morte'?'Morte':'Venda'}</td><td>${nf(s.cab)}</td><td>${s.mot==='morte'?'—':nf(s.peso)}</td><td>${s.mot==='morte'?'—':rs(valorVenda(s),0)}</td><td class="acoes"><button class="mini danger" data-g="apaga" data-id="${s.uid}" data-o="saída">✕</button></td></tr>`).join('');
  const hist=(arr,fmt,o)=>(arr||[]).map((h,i)=>`<tr><td>${dB(h.desde)}</td><td>${esc(fmt(h))}</td><td class="acoes">${i?`<button class="mini danger" data-g="apagaHist" data-id="${l.uid}" data-o="${o}" data-i="${i}">✕</button>`:''}</td></tr>`).join('');
  return `${voltar('Lotes')}<section class="panel"><div class="curhead"><h2>${esc(l.nome)}</h2><span class="pill${fim?'':' done'}">${fim?'Encerrado':'Ativo'}</span></div>
    <div class="stat">${st('Curral',esc(curralEm(l,ref)||'—'))}${st('Cabeças',nf(cab))}${st('Dias',nf(difDias(l.ent.dia,ref)))}</div>
    <div class="stat">${st('Entrada',nf(l.ent.peso)+' kg')}${st(fim?'Peso final proj.':'Peso hoje (proj.)',nf(pj)+' kg')}${st('Meta GMD',nf(l.gmd,2)+' kg')}</div>
    <div class="stat">${st('Ração',esc(r?r.nome:'—'))}${x&&x.mn>0?st('Ontem MS/cab',nf(x.msCab,2)+' kg')+st('% do peso vivo',pc(x.pv,2)):st('Consumo ontem','sem trato')}</div>
    ${prevAlvo?`<p class="note">Peso desejado de ${nf(l.alvo)} kg: ${prevAlvo}.</p>`:''}
    ${l.obs?`<p class="note">${esc(l.obs)}</p>`:''}
    ${proj}
    <div class="gAcoes">
      ${fim?'':`<button class="lima" data-g="ir" data-t="pesForm" data-id="${l.uid}">⚖️ Pesagem</button>
      <button class="lima" data-g="ir" data-t="saiForm" data-id="${l.uid}" data-o="venda">💲 Venda / saída</button>
      <button data-g="ir" data-t="saiForm" data-id="${l.uid}" data-o="morte">✝ Morte</button>
      <button data-g="ir" data-t="mudForm" data-id="${l.uid}" data-o="curr">↔ Mudar curral</button>
      <button data-g="ir" data-t="mudForm" data-id="${l.uid}" data-o="rac">🌾 Mudar ração</button>`}
      <button data-g="ir" data-t="loteForm" data-id="${l.uid}">✎ Editar dados</button>
    </div>
    <button class="primary" data-g="ir" data-t="rel" data-id="${l.uid}">📊 ${fim?'Relatório final':'Resultado até hoje'}</button></section>
  ${card('Pesagens',`<div class="tablebox"><table><thead><tr><th>Data</th><th>Peso</th><th>GMD real</th><th>Cab.</th><th></th></tr></thead><tbody>
    <tr><td>${dB(l.ent.dia)}</td><td>${nf(l.ent.peso)}</td><td>entrada</td><td>${nf(l.ent.cab)}</td><td></td></tr>${lp}</tbody></table></div>`)}
  ${sd.length?card('Saídas',`<div class="tablebox"><table><thead><tr><th>Data</th><th>Tipo</th><th>Cab.</th><th>Peso</th><th>Valor</th><th></th></tr></thead><tbody>${ls}</tbody></table></div>`):''}
  ${card('Curral e ração',`<div class="tablebox"><table><thead><tr><th>Desde</th><th>Curral</th><th></th></tr></thead><tbody>${hist(l.curr,h=>h.c,'curr')}</tbody></table></div>
    <div class="tablebox"><table><thead><tr><th>Desde</th><th>Ração</th><th></th></tr></thead><tbody>${hist(l.rac,h=>{const r=G.it[h.r];return r&&!r.del?r.nome:'(apagada)';},'rac')||'<tr><td colspan="3">Sem ração escolhida</td></tr>'}</tbody></table></div>`)}
  <section class="panel"><button class="dangerfill" data-g="apagaLote" data-id="${l.uid}">Apagar lote</button></section>`;
}
function tPesForm(t){const l=G.it[t.id];
  return `${voltar()}<section class="panel"><h2>Pesagem · ${esc(l.nome)}</h2><div class="gForm">${[
    {k:'dia',l:'Data',t:'dia',v:hojeKey(),meia:1},{k:'peso',l:'Peso médio',suf:'kg',t:'num',meia:1},
    {k:'cab',l:'Cabeças pesadas (opcional)',t:'num',meia:1},{k:'obs',l:'Observação'}].map(campo).join('')}</div>
    <p class="note">A projeção do peso passa a partir desta pesagem.</p>
    <button class="primary" data-g="salvaPes" data-id="${l.uid}">Salvar pesagem</button></section>`;}
function tSaiForm(t){const l=G.it[t.id],m=t.o==='morte',cfg=gCfg();
  const fs=m?[{k:'dia',l:'Data',t:'dia',v:hojeKey(),meia:1},{k:'cab',l:'Cabeças',t:'num',v:1,meia:1},{k:'obs',l:'Causa / observação'}]:
   [{k:'dia',l:'Data da saída',t:'dia',v:hojeKey(),meia:1},{k:'cab',l:'Cabeças',t:'num',v:cabAtual(l),meia:1},
    {k:'peso',l:'Peso vivo médio na saída',suf:'kg',t:'num',v:Math.round(pesoEm(l,hojeKey())),meia:1},{k:'rc',l:'Rendimento de carcaça',suf:'%',t:'num',v:cfg.rc,meia:1},
    {k:'unid',l:'Preço de venda em',t:'sel',op:UNID_V,v:'arroba'},{k:'preco',l:'Preço de venda',suf:'R$',t:'num',meia:1},
    {k:'desc',l:'Descontos (frete, impostos)',suf:'R$ total',t:'num',meia:1},{k:'obs',l:'Comprador / observação'}];
  return `${voltar()}<section class="panel"><h2>${m?'Morte':'Venda / saída'} · ${esc(l.nome)}</h2><p class="note">No lote agora: ${nf(cabAtual(l))} cabeças.</p>
    <div class="gForm">${fs.map(campo).join('')}</div><button class="primary" data-g="salvaSai" data-id="${l.uid}" data-o="${m?'morte':'venda'}">Salvar</button></section>`;}
function tMudForm(t){const l=G.it[t.id],c=t.o==='curr';
  return `${voltar()}<section class="panel"><h2>${c?'Mudar curral':'Mudar ração'} · ${esc(l.nome)}</h2><div class="gForm">${[
    {k:'desde',l:'A partir de',t:'dia',v:hojeKey()},
    c?{k:'val',l:'Novo curral / pasto',t:'sel',op:opCurrais(),v:curralEm(l,hojeKey())}:{k:'val',l:'Nova ração',t:'sel',op:opRacoes(),v:(vig(l.rac,hojeKey())||{}).r||''}].map(campo).join('')}</div>
    <button class="primary" data-g="salvaMud" data-id="${l.uid}" data-o="${t.o}">Salvar</button></section>`;}

/* ---------- relatório do lote ---------- */
function tRelLote(t){
  const l=G.it[t.id],fim=fimLote(l),hj=hojeKey(),ate=fim||hj,R=resumoLote(l,ate),sd=saidasDe(l),cfg=gCfg();
  const vendas=sd.filter(s=>s.mot!=='morte'),mortes=sd.filter(s=>s.mot==='morte').reduce((a,s)=>a+(+s.cab||0),0);
  const cabE=+l.ent.cab,pesoE=+l.ent.peso,compra=valorCompra(l);
  const cabV=vendas.reduce((a,s)=>a+(+s.cab||0),0),arrV=vendas.reduce((a,s)=>a+arrobaVenda(s),0),receita=vendas.reduce((a,s)=>a+valorVenda(s),0);
  const pesoV=cabV?vendas.reduce((a,s)=>a+s.cab*s.peso,0)/cabV:NaN;
  const ganhoV=vendas.reduce((a,s)=>a+s.cab*(s.peso-pesoE),0),cabDiasV=vendas.reduce((a,s)=>a+s.cab*difDias(l.ent.dia,s.dia),0);
  const alim=R.custoR,op=R.custoOp,custo=compra+alim+op;
  const msCab=R.ms/R.cabDias,mnCab=R.mn/R.cabDias,pv=R.pvN?R.pvS/R.pvN:NaN;
  const avisos=[R.semPreco?`${R.semPreco} dia(s) com ração sem preço ou sem matéria seca completa.`:'',R.semReg?`${R.semReg} dia(s) sem trato lançado no curral do lote.`:''].filter(Boolean);
  const comum=`<div class="gLinhas">
    ${lin('Período',`${dB(l.ent.dia)} a ${dB(ate)} · ${nf(difDias(l.ent.dia,ate))} dias`)}
    ${lin('Entrada',`${nf(cabE)} cab · ${nf(pesoE)} kg · ${nf(pesoE/30,2)} @/cab`)}
    ${lin('Consumo matéria natural',`${nf(R.mn)} kg · ${nf(mnCab,2)} kg/cab/dia`)}
    ${lin('Consumo matéria seca',`${nf(R.ms)} kg · ${nf(msCab,2)} kg/cab/dia`)}
    ${lin('MS em % do peso vivo (média)',pc(pv,2))}
    ${lin('Custo de compra',rs(compra))}
    ${lin('Custo da ração',rs(alim))}
    ${lin('Custo operacional',`${rs(op)} (${nf(R.cabOpDias)} cab-dia)`)}
    ${lin('Custo alimentação + operacional / cab / dia',rs((alim+op)/R.cabDias))}
    ${lin('Custo total',rs(custo),'forte')}</div>`;
  let fecha='';
  if(cabV){
    const arrE=cabV*pesoE/30,arrProd=arrV-arrE,lucro=receita-custo;
    fecha=card(fim?'Resultado final':'Vendas até agora',`<div class="gLinhas">
      ${lin('Vendidos',`${nf(cabV)} cab · ${nf(pesoV)} kg vivo médio`)}${mortes?lin('Mortes',`${nf(mortes)} cab`):''}
      ${lin('@ vendidas (carcaça)',nf(arrV,2))}${lin('Receita líquida',rs(receita))}
      ${lin('GMD real',`${nf(cabDiasV?ganhoV/cabDiasV:NaN,3)} kg/dia`)}
      ${lin('@ produzidas',nf(arrProd,2))}
      ${lin('Custo da @ produzida',rs((alim+op)/arrProd))}
      ${lin('Conversão alimentar (kg MS / kg ganho)',nf(R.ms/ganhoV,2))}
      ${fim?lin(lucro>=0?'LUCRO':'PREJUÍZO',`${rs(lucro)} · ${rs(lucro/cabE)} por cab`,lucro>=0?'forte ok':'forte bad'):''}</div>
      ${fim?'':'<p class="note">O lote ainda tem animais: o lucro final aparece quando sair o último.</p>'}`);
  }
  const sim=fim?'':card('Simular venda hoje',`<div class="gForm">${[
    {k:'sPeso',l:'Peso vivo',suf:'kg',t:'num',v:Math.round(pesoEm(l,hj)),meia:1},{k:'sRc',l:'Rendimento',suf:'%',t:'num',v:cfg.rc,meia:1},
    {k:'sPreco',l:'Preço da @',suf:'R$',t:'num',v:t.sp||'',meia:1}].map(campo).join('')}</div><div id="gSimRes" class="gLinhas"></div>`);
  GT.calc={cab:cabAtual(l),pesoE,compraCab:compra/cabE,alimOp:alim+op,custo,receita,cabE,cabV,arrV,dias:difDias(l.ent.dia,hj),ms:R.ms,ganhoV};
  return `${voltar()}<section class="panel"><div class="curhead"><h2>${esc(l.nome)}</h2><span class="pill">${fim?'Relatório final':'Até hoje'}</span></div>
    ${avisos.map(a=>`<p class="aviso warn">${a}</p>`).join('')}${comum}
    <button class="verde" data-g="compRel" data-id="${l.uid}">📤 Enviar resumo</button></section>${fecha}${sim}`;
}
const lin=(a,b,c)=>`<div class="${c||''}"><span>${a}</span><b class="num">${b}</b></div>`;
function calcSimul(){const box=$('gSimRes');if(!box)return;const c=GT.calc,peso=fn('sPeso'),rc=fn('sRc'),pr=fn('sPreco');
  if(!(peso>0&&rc>0&&pr>0)){box.innerHTML='<p class="note">Coloque o preço da @ para ver o resultado estimado com os animais que estão no lote.</p>';return;}
  const arr=c.cab*peso*rc/100/15,rec=arr*pr+c.receita,lucro=rec-c.custo;
  const arrProd=c.arrV+arr-(c.cabV+c.cab)*c.pesoE/30,ganho=c.ganhoV+c.cab*(peso-c.pesoE);
  box.innerHTML=lin('@ por cabeça',nf(peso*rc/100/15,2))+lin('Receita estimada',rs(rec))+lin('Custo da @ produzida',rs(c.alimOp/arrProd))+
    lin('Conversão alimentar',nf(c.ms/ganho,2))+lin(lucro>=0?'Lucro estimado':'Prejuízo estimado',`${rs(lucro)} · ${rs(lucro/c.cabE)} por cab`,lucro>=0?'forte ok':'forte bad');}
function textoRel(){return [...$('gBox').querySelectorAll('.panel')].map(p=>{const h=p.querySelector('h2');
  const ls=[...p.querySelectorAll('.gLinhas>div')].map(d=>`${d.children[0].textContent}: ${d.children[1].textContent}`);
  return ls.length?`*${h?h.textContent:''}*\n`+ls.join('\n'):'';}).filter(Boolean).join('\n\n');}

/* ---------- leitura de cocho ---------- */
const idLeit=(dia,c)=>'lc-'+dia+'-'+chave(c);
function cochoCurrais(dia){const set=new Set();const A=gTodos('lote').filter(l=>cabPres(l,dia)>0);A.forEach(l=>set.add(curralEm(l,dia)));
  return (S.cadastro||[]).filter(c=>set.has(c));}
const prevTotal=c=>Object.values(S.prev||{}).reduce((a,m)=>a+(typeof m[c]==='number'?m[c]:0),0);
function tCocho(t){
  const dia=t.dia||hojeKey(),ont=somaDias(dia,-1),ix=gIndice(),cfg=gCfg(),Cs=cochoCurrais(dia),hoje=dia===hojeKey();
  GT.dia=dia;GT.sel=GT.sel||{};
  const rows=Cs.map(c=>{const L=gTodos('lote').filter(l=>curralEm(l,dia)===c&&cabPres(l,dia)>0);
    const ontem=ix.get(ont+'|'+c)||0,pt=prevTotal(c),cab=L.reduce((a,l)=>a+cabPres(l,dia),0);
    let base=ontem,orig='realizado ontem';
    if(!base&&pt){base=pt;orig='previsto atual';}
    if(!base){const ms=L.reduce((a,l)=>{const r=racaoEm(l,dia),cp=r&&compRacao(r,dia);return a+(cp?cabPres(l,dia)*pesoEm(l,dia)*cfg.pvIni/100/(cp.ms/100):0);},0);base=Math.round(ms);orig=`sugestão ${nf(cfg.pvIni,1)}% PV`;}
    const lt=G.it[idLeit(dia,c)],sel=GT.sel[c]||(lt&&!lt.del?{n:lt.nota,kg:lt.novo}:null);
    const nota=sel?sel.n:null,cn=cfg.notas.find(x=>x.n===nota);
    const sug=cn?arred(base*(1+cn.p/100),cfg.arred):null,kg=sel&&ok(sel.kg)?sel.kg:sug;
    return `<div class="gCocho${lt&&!lt.del?' feito':''}" data-c="${esc(c)}" data-base="${base}">
      <div class="gCoTopo"><b>${esc(c)}</b><span>${esc(L.map(l=>l.nome).join(', '))} · ${nf(cab)} cab</span></div>
      <div class="gCoBase">Base: <b class="num">${nf(base)} kg</b> <small>(${orig})</small></div>
      <div class="gNotas">${cfg.notas.map(x=>`<button class="${x.n===nota?'sel':''}" data-g="nota" data-c="${esc(c)}" data-n="${x.n}" title="${esc(x.t)}">${x.n}<small>${x.p>0?'+':''}${nf(x.p,0)}%</small></button>`).join('')}</div>
      <div class="gCoNovo"><span>${cn?esc(cn.t):'Toque na nota'}</span><input class="cell num" inputmode="numeric" data-kg="${esc(c)}" value="${kg!=null?kg:''}" placeholder="kg"><small>kg/dia</small></div></div>`;}).join('');
  return `${voltar('Gestão')}<section class="panel"><h2>Leitura de cocho</h2>
    <div class="gCampo"><label for="gCoDia">Data da leitura</label><input type="date" id="gCoDia" value="${dia}"></div>
    <details class="gLeg"><summary class="note">Ver as notas</summary>${cfg.notas.map(x=>`<p class="note"><b>${x.n}</b> — ${esc(x.t)}: ${x.p>0?'+':''}${nf(x.p,0)}%</p>`).join('')}</details>
    ${rows||'<p class="note">Nenhum lote ativo nesta data. Cadastre os lotes primeiro.</p>'}
    ${rows?`<button class="primary" data-g="salvaCocho">${hoje?'Salvar e ajustar o previsto':'Salvar leitura'}</button>
    <p class="note">${hoje?'O total do dia de cada curral é dividido entre os tratos na mesma proporção do previsto atual.':'Data diferente de hoje: só guarda a leitura, sem mexer no previsto.'}</p>`:''}</section>`;
}
const arred=(v,a)=>a>0?Math.round(v/a)*a:Math.round(v);
function salvaCocho(){
  const dia=GT.dia,hoje=dia===hojeKey(),cfg=gCfg();let n=0,ap=0;
  document.querySelectorAll('#gBox .gCocho').forEach(el=>{const c=el.dataset.c,s=GT.sel[c];const inp=el.querySelector('input[data-kg]');const kg=gNum(inp.value);
    const lt=G.it[idLeit(dia,c)];const nota=s?s.n:(lt&&!lt.del?lt.nota:null);if(nota==null)return;
    const cn=cfg.notas.find(x=>x.n===nota);
    gPut({uid:idLeit(dia,c),tipo:'leitura',dia,curral:c,nota,pct:cn?cn.p:0,base:+el.dataset.base||0,novo:ok(kg)?kg:null});n++;
    if(hoje&&ok(kg)&&kg>0&&aplicaPrev(c,kg))ap++;});
  if(!n)return toast('Marque a nota de pelo menos um curral');
  if(ap){marcarPrev();if(typeof render==='function')render();}
  GT.sel={};toast(hoje?`Leitura salva · previsto ajustado em ${ap} curral(is)`:'Leitura salva');gRender();
}
function aplicaPrev(c,total){
  const ks=['1','2','3','4','5'];S.prev=S.prev||{};
  const atual=ks.map(k=>{const m=S.prev[k]||{};return typeof m[c]==='number'?m[c]:0;});
  let soma=atual.reduce((a,b)=>a+b,0),pesos=atual;
  if(!soma){const usados=ks.map(k=>lista(k).length>0?1:0);pesos=usados.some(Boolean)?usados:[1,0,0,0,0];soma=pesos.reduce((a,b)=>a+b,0);}
  const a=gCfg().arred||1;let resto=total;const novos=pesos.map(()=>0);
  const idx=pesos.map((p,i)=>p>0?i:-1).filter(i=>i>=0);
  idx.forEach((i,j)=>{if(j===idx.length-1)novos[i]=Math.max(0,resto);else{novos[i]=Math.max(0,arred(total*pesos[i]/soma,a));resto-=novos[i];}});
  let mud=false;idx.forEach(i=>{const m=mapaPrev(ks[i]);if(m[c]!==novos[i]){m[c]=novos[i];mud=true;}});return mud;
}

/* ---------- relatório do dia ---------- */
function tDia(t){
  const dia=t.dia||somaDias(hojeKey(),-1),X=gCtx();
  const ls=X.L.map(l=>({l,x:diaLote(l,dia,X)})).filter(o=>o.x).sort((a,b)=>porNome(a.l,b.l));
  const T={cab:0,mn:0,ms:0,cr:0,co:0,pvS:0,pvP:0};
  const rows=ls.map(({l,x})=>{T.cab+=x.cab;T.mn+=x.mn;if(ok(x.ms))T.ms+=x.ms;if(ok(x.custoR))T.cr+=x.custoR;T.co+=x.custoOp;T.pvP+=x.cab*x.peso;
    const tot=(ok(x.custoR)?x.custoR:0)+x.custoOp;
    return `<tr><td class="c">${esc(l.nome)}<small>${esc(x.c)} · ${esc(x.rac)}</small></td><td>${nf(x.cab)}</td><td>${nf(x.peso)}</td><td>${nf(x.mn)}<small>${nf(x.mnCab,1)}/cab</small></td><td>${nf(x.ms)}<small>${nf(x.msCab,2)}/cab</small></td><td>${pc(x.pv,2)}</td><td>${rs(tot,0)}<small>${rs(tot/x.cab)}/cab</small></td></tr>`;}).join('');
  const tot=T.cr+T.co;
  return `${voltar('Gestão')}<section class="panel"><h2>Relatório do dia</h2>
    <div class="gCampo"><label for="gDiaDia">Data</label><input type="date" id="gDiaDia" value="${dia}"></div>
    <div class="stat">${st('Cabeças',nf(T.cab))}${st('Matéria natural',nf(T.mn)+' kg')}${st('Matéria seca',nf(T.ms)+' kg')}</div>
    <div class="stat">${st('Custo ração',rs(T.cr,0))}${st('Operacional',rs(T.co,0))}${st('Custo/cab/dia',rs(T.cab?tot/T.cab:NaN))}</div>
    <div class="stat">${st('MS/cab',nf(T.cab?T.ms/T.cab:NaN,2)+' kg')}${st('% peso vivo',pc(T.pvP?T.ms/T.pvP*100:NaN,2))}${st('Custo total',rs(tot,0))}</div>
    <div class="tablebox"><table class="gTab"><thead><tr><th>Lote</th><th>Cab</th><th>Peso</th><th>MN kg</th><th>MS kg</th><th>%PV</th><th>Custo</th></tr></thead>
    <tbody>${rows||'<tr><td colspan="7">Nenhum lote nesta data.</td></tr>'}</tbody></table></div>
    <p class="note">Peso = projetado pela última pesagem e a meta de ganho. MN = trato realizado no curral (dividido por cabeça se houver mais de um lote).</p>
    ${rows?'<button class="verde" data-g="compDia">📤 Enviar relatório</button>':''}</section>`;
}
function textoDia(){const dia=$('gDiaDia').value,X=gCtx();const ls=X.L.map(l=>({l,x:diaLote(l,dia,X)})).filter(o=>o.x).sort((a,b)=>porNome(a.l,b.l));
  let cab=0,mn=0,ms=0,c=0;const linhas=ls.map(({l,x})=>{cab+=x.cab;mn+=x.mn;ms+=ok(x.ms)?x.ms:0;const t=(ok(x.custoR)?x.custoR:0)+x.custoOp;c+=t;
    return `*${l.nome}* (${x.c}) ${nf(x.cab)} cab · ${nf(x.peso)} kg\n  MN ${nf(x.mn)} kg (${nf(x.mnCab,1)}/cab) · MS ${nf(x.msCab,2)} kg/cab · ${pc(x.pv,2)} PV\n  Custo ${rs(t,0)} (${rs(t/x.cab)}/cab)`;});
  return `*Relatório do dia ${dB(dia)}*\n\n${linhas.join('\n\n')}\n\n*Total:* ${nf(cab)} cab · MN ${nf(mn)} kg · MS ${nf(ms)} kg · ${rs(c,0)}`;}
async function enviarTexto(txt){try{if(navigator.share){await navigator.share({text:txt});return;}}catch(e){if(e&&e.name==='AbortError')return;}
  if(typeof copiar==='function')copiar(txt,'Copiado. Cole no WhatsApp');else window.open('https://wa.me/?text='+encodeURIComponent(txt));}

/* ---------- rações ---------- */
function tRacoes(){
  const hj=hojeKey(),R=gTodos('racao').sort(porNome);
  const cards=R.map(r=>{const cp=compRacao(r,hj);const usam=lotesAtivos().filter(l=>{const x=racaoEm(l,hj);return x&&x.uid===r.uid;}).length;
    return `<button class="gItem" data-g="ir" data-t="racForm" data-id="${r.uid}"><div class="gItemTopo"><b>${esc(r.nome)}</b><span class="pill">${usam?usam+' lote(s)':'sem lote'}</span></div>
      <div class="gItemInfo">${cp?`MS ${pc(cp.ms)} · ${rs(cp.custoMN,3)}/kg MN · ${rs(cp.custoMS,3)}/kg MS<br>${cp.itens.map(i=>`${esc(i.nome)} ${nf(i.pMS,1)}%`).join(' · ')}`:'sem fórmula'}</div></button>`;}).join('');
  return `${voltar('Gestão')}<section class="panel"><h2>Rações</h2>${cards||'<p class="note">Nenhuma ração. Cadastre os insumos primeiro e depois a ração.</p>'}
    <button class="lima" data-g="ir" data-t="racForm">+ Nova ração</button></section>`;
}
function tRacForm(t){
  const r=t.id?G.it[t.id]:null,hj=hojeKey(),v=r?vig(r.versoes,hj):null;
  if(!GT.itens)GT.itens=v?v.itens.map(i=>({ins:i.ins,pMS:i.pMS})):[{ins:'',pMS:''}];
  const ops=opInsumos();
  if(!ops.length)return `${voltar()}<section class="panel"><h2>Nova ração</h2><p class="note">Cadastre os insumos primeiro (silagem, DDG, núcleo…).</p><button class="lima" data-g="ir" data-t="insForm">+ Novo insumo</button></section>`;
  const linhas=GT.itens.map((i,k)=>`<div class="gRacLin"><select data-ri="${k}"><option value="">— insumo —</option>${ops.map(([a,b])=>`<option value="${a}"${a===i.ins?' selected':''}>${esc(b)}</option>`).join('')}</select>
    <input class="cell num" inputmode="decimal" data-rp="${k}" value="${esc(vIn(gNum(i.pMS)))}" placeholder="% MS"><button class="mini danger" data-g="racRm" data-i="${k}">✕</button></div>`).join('');
  const vers=r?(r.versoes||[]).slice().sort((a,b)=>a.desde<b.desde?1:-1).map(x=>`<p class="note">Desde ${dB(x.desde)}: ${x.itens.map(i=>{const n=G.it[i.ins];return `${esc(n?n.nome:'?')} ${nf(+i.pMS,1)}%`;}).join(' · ')}</p>`).join(''):'';
  return `${voltar()}<section class="panel"><h2>${r?'Ração':'Nova ração'}</h2>
    <div class="gForm">${campo({k:'nome',l:'Nome da ração',v:GT.nome!=null?GT.nome:(r?r.nome:''),ph:'Ex.: Terminação'})}${campo({k:'desde',l:'Fórmula vale a partir de',t:'dia',v:GT.desde||(r?hj:'2000-01-01'),ajuda:r?'Mudou a fórmula? Os dias antes dessa data continuam com a fórmula antiga.':''})}</div>
    <label>Insumos (% na matéria seca)</label>${linhas}
    <button data-g="racAdd">+ Adicionar insumo</button>
    <div id="gRacCalc"></div>
    <button class="primary" data-g="salvaRac" data-id="${t.id||''}">Salvar ração</button></section>
    <section class="panel"><h2>Receita do vagão</h2><div class="gCampo"><label for="gVag">Total a misturar (kg de matéria natural)</label><input id="gVag" type="text" class="num" inputmode="decimal" value="${GT.vag||1000}"></div><div id="gVagRes"></div></section>
    ${r?`<section class="panel"><h2>Histórico da fórmula</h2>${vers}<button class="dangerfill" data-g="apagaRac" data-id="${r.uid}">Apagar ração</button></section>`:''}`;
}
function lerItensRac(){if($('gf_nome'))GT.nome=$('gf_nome').value;if($('gf_desde'))GT.desde=$('gf_desde').value;document.querySelectorAll('#gBox [data-ri]').forEach(s=>{const k=+s.dataset.ri;if(GT.itens[k])GT.itens[k].ins=s.value;});
  document.querySelectorAll('#gBox [data-rp]').forEach(s=>{const k=+s.dataset.rp;if(GT.itens[k])GT.itens[k].pMS=s.value;});}
function calcRacao(){
  const box=$('gRacCalc');if(!box)return;lerItensRac();const hj=hojeKey();
  const its=GT.itens.filter(i=>i.ins&&gNum(i.pMS)>0).map(i=>({ins:i.ins,pMS:gNum(i.pMS)}));
  const cp=its.length?compRacao({versoes:[{desde:'2000-01-01',itens:its}]},hj):null;
  if(!cp){box.innerHTML='<p class="note">Escolha os insumos e a % de cada um na matéria seca (soma 100%).</p>';$('gVagRes').innerHTML='';return;}
  const soma=cp.somaMS,okS=Math.abs(soma-100)<0.05;
  box.innerHTML=`<div class="tablebox"><table><thead><tr><th>Insumo</th><th>% MS</th><th>% MN</th><th>MS do insumo</th><th>R$/t</th></tr></thead><tbody>
    ${cp.itens.map(i=>`<tr><td>${esc(i.nome)}</td><td>${nf(i.pMS,1)}</td><td>${nf(i.pMN,1)}</td><td>${pc(i.ms,0)}</td><td>${nf(i.preco,0)}</td></tr>`).join('')}
    <tr class="grp"><td>Total</td><td class="${okS?'ok':'bad'}">${nf(soma,1)}</td><td>100</td><td></td><td></td></tr></tbody></table></div>
    ${okS?'':`<p class="aviso bad">A soma na matéria seca está em ${nf(soma,1)}%. Precisa dar 100%.</p>`}
    <div class="stat">${st('MS da ração',pc(cp.ms))}${st('R$/kg MN',rs(cp.custoMN,3))}${st('R$/kg MS',rs(cp.custoMS,3))}</div>`;
  const tot=gNum(($('gVag')||{}).value);GT.vag=($('gVag')||{}).value;
  $('gVagRes').innerHTML=tot>0?`<div class="tablebox"><table><thead><tr><th>Insumo</th><th>kg no vagão</th></tr></thead><tbody>${cp.itens.map(i=>`<tr><td>${esc(i.nome)}</td><td>${nf(tot*i.pMN/100)}</td></tr>`).join('')}
    <tr class="grp"><td>Total</td><td>${nf(tot)}</td></tr></tbody></table></div><p class="note">Custo desta mistura: ${rs(tot*cp.custoMN)}.</p>`:'';
}
function salvaRac(id){
  lerItensRac();const nome=fv('nome'),desde=fv('desde')||hojeKey();if(!nome)return toast('Coloque o nome da ração');
  const its=GT.itens.filter(i=>i.ins&&gNum(i.pMS)>0).map(i=>({ins:i.ins,pMS:gNum(i.pMS)}));
  if(!its.length)return toast('Coloque os insumos');
  const soma=its.reduce((a,i)=>a+i.pMS,0);if(Math.abs(soma-100)>=0.05)return toast(`A soma na MS está em ${nf(soma,1)}%. Precisa dar 100%`);
  const r=id?JSON.parse(JSON.stringify(G.it[id])):{uid:novoId('rac'),tipo:'racao',versoes:[]};
  r.nome=nome;const v=vig(r.versoes,desde),igual=v&&JSON.stringify(v.itens)===JSON.stringify(its);
  if(!igual)setHist(r.versoes,desde,{itens:its});
  gPut(r);toast('Ração salva');GT.itens=null;GT.nome=null;GT.desde=null;gVoltar();
}

/* ---------- insumos ---------- */
function tInsumos(){
  const hj=hojeKey(),I=gTodos('insumo').sort(porNome);
  const rows=I.map(i=>{const p=precoIns(i,hj);return `<tr data-g="ir" data-t="insForm" data-id="${i.uid}" class="gClic"><td class="c">${esc(i.nome)}</td><td>${pc(+i.ms,0)}</td><td>${rs(p,0)}</td><td>${rs(p/1000/(i.ms/100),3)}</td></tr>`;}).join('');
  return `${voltar('Gestão')}<section class="panel"><h2>Insumos</h2>
    <div class="tablebox"><table><thead><tr><th>Insumo</th><th>MS</th><th>R$/t</th><th>R$/kg MS</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Nenhum insumo ainda.</td></tr>'}</tbody></table></div>
    <p class="note">Preço por tonelada como comprado (matéria natural). Toque no insumo para mudar o preço.</p>
    <button class="lima" data-g="ir" data-t="insForm">+ Novo insumo</button></section>`;
}
function tInsForm(t){const i=t.id?G.it[t.id]:null,hj=hojeKey();
  const hist=i?(i.precos||[]).slice().reverse().map((p,k,a)=>`<tr><td>${dB(p.desde)}</td><td>${rs(+p.rs,2)}</td><td class="acoes">${a.length>1?`<button class="mini danger" data-g="insPrecoRm" data-id="${i.uid}" data-d="${p.desde}">✕</button>`:''}</td></tr>`).join(''):'';
  return `${voltar()}<section class="panel"><h2>${i?'Insumo':'Novo insumo'}</h2><div class="gForm">${[
    {k:'nome',l:'Nome',v:i?i.nome:'',ph:'Ex.: Silagem de milho'},{k:'ms',l:'Matéria seca',suf:'%',t:'num',v:i?i.ms:'',meia:1},
    {k:'preco',l:'Preço por tonelada',suf:'R$/t',t:'num',v:i?precoIns(i,hj):'',meia:1},
    {k:'desde',l:'Preço vale a partir de',t:'dia',v:i?hj:'2000-01-01',ajuda:i?'Se mudar o preço, os dias antes dessa data continuam com o preço antigo.':''}].map(campo).join('')}</div>
    <button class="primary" data-g="salvaIns" data-id="${t.id||''}">Salvar</button></section>
    ${i?`<section class="panel"><h2>Histórico de preço</h2><div class="tablebox"><table><thead><tr><th>Desde</th><th>R$/t</th><th></th></tr></thead><tbody>${hist}</tbody></table></div>
    <button class="dangerfill" data-g="apagaIns" data-id="${i.uid}">Apagar insumo</button></section>`:''}`;}
function salvaIns(id){const nome=fv('nome'),ms=fn('ms'),preco=fn('preco'),desde=fv('desde')||hojeKey();
  if(!nome)return toast('Coloque o nome');if(!(ms>0&&ms<=100))return toast('Matéria seca entre 1 e 100%');if(!(preco>=0))return toast('Coloque o preço por tonelada');
  const i=id?JSON.parse(JSON.stringify(G.it[id])):{uid:novoId('ins'),tipo:'insumo',precos:[]};
  i.nome=nome;i.ms=ms;const v=vig(i.precos,desde);if(!v||+v.rs!==preco)setHist(i.precos,desde,{rs:preco});
  gPut(i);toast('Insumo salvo');gVoltar();}

/* ---------- configurações ---------- */
function tCfg(){const c=gCfg(),hj=hojeKey(),tx=vig(c.taxa,hj);
  return `${voltar('Gestão')}<section class="panel"><h2>Custo operacional</h2><div class="gForm">${[
    {k:'taxa',l:'Taxa operacional',suf:'R$ por cabeça por dia',t:'num',v:tx?tx.rs:'',meia:1},{k:'tdesde',l:'Vale a partir de',t:'dia',v:tx?hj:'2000-01-01',meia:1}].map(campo).join('')}</div>
    ${(c.taxa||[]).length?`<p class="note">${c.taxa.map(x=>`Desde ${dB(x.desde)}: ${rs(+x.rs)}`).join(' · ')}</p>`:''}</section>
  <section class="panel"><h2>Notas da leitura de cocho</h2>
    ${c.notas.map((x,k)=>`<div class="gNotaCfg"><b>${x.n}</b><input type="text" data-nt="${k}" value="${esc(x.t)}"><input class="cell num" inputmode="decimal" data-np="${k}" value="${esc(vIn(x.p))}"><span>%</span></div>`).join('')}
    <p class="note">Ajuste aplicado em cima do realizado de ontem. Use sinal de menos para diminuir.</p></section>
  <section class="panel"><h2>Outros</h2><div class="gForm">${[
    {k:'arred',l:'Arredondar o previsto de',suf:'kg',t:'num',v:c.arred,meia:1},{k:'rc',l:'Rendimento de carcaça padrão',suf:'%',t:'num',v:c.rc,meia:1},
    {k:'pvIni',l:'Consumo inicial sugerido',suf:'% do PV em MS',t:'num',v:c.pvIni,ajuda:'Usado na leitura de cocho quando o curral ainda não tem trato.'}].map(campo).join('')}</div>
    <button class="primary" data-g="salvaCfg">Salvar configurações</button></section>`;}
function salvaCfg(){const c=JSON.parse(JSON.stringify(gCfg()));const t=fn('taxa'),d=fv('tdesde')||hojeKey();
  if(ok(t)){const v=vig(c.taxa,d);if(!v||+v.rs!==t)setHist(c.taxa,d,{rs:t});}
  document.querySelectorAll('#gBox [data-nt]').forEach(e=>{c.notas[+e.dataset.nt].t=e.value.trim()||c.notas[+e.dataset.nt].t;});
  document.querySelectorAll('#gBox [data-np]').forEach(e=>{const v=gNum(e.value);if(ok(v))c.notas[+e.dataset.np].p=v;});
  const a=fn('arred'),rc=fn('rc'),pv=fn('pvIni');if(ok(a)&&a>=0)c.arred=a;if(rc>0)c.rc=rc;if(pv>0)c.pvIni=pv;
  gPut(c);toast('Configurações salvas');gVoltar();}

/* =====================================================================================
   EVENTOS
   ===================================================================================== */
const SO_VER=new Set(['voltar','ir','lote','compRel','compDia','nota','racAdd','racRm']);
$('gBox').addEventListener('click',e=>{
  const b=e.target.closest('[data-g]');if(!b)return;const a=b.dataset.g,id=b.dataset.id;
  if(!SO_VER.has(a)&&bloqueado())return;
  if(a==='voltar')return gVoltar();
  if(a==='ir'){const t={t:b.dataset.t,id,o:b.dataset.o,enc:b.dataset.enc==='1'};
    if(GT.t==='lotes'&&t.t==='lotes'){GT=t;return gRender();}return gIr(t);}
  if(a==='lote')return gIr({t:'lote',id});
  if(a==='novoLote')return gIr({t:'loteForm'});
  if(a==='salvaLote')return salvaLote(id);
  if(a==='salvaPes'){const dia=fv('dia'),peso=fn('peso');if(!dia||!(peso>0))return toast('Coloque a data e o peso');
    gPut({uid:novoId('pes'),tipo:'pesagem',lote:id,dia,peso,cab:fn('cab')||null,obs:fv('obs')});toast('Pesagem salva');return gVoltar();}
  if(a==='salvaSai'){const l=G.it[id],m=b.dataset.o==='morte',dia=fv('dia'),cab=fn('cab');
    if(!dia||!(cab>0))return toast('Coloque a data e as cabeças');if(dia<l.ent.dia)return toast('A data é antes da entrada do lote');
    const tem=cabPres(l,dia);if(cab>tem)return toast(`Nessa data o lote tem ${nf(tem)} cabeças`);
    const s={uid:novoId('sai'),tipo:'saida',mot:m?'morte':'venda',lote:id,dia,cab,obs:fv('obs')};
    if(!m){s.peso=fn('peso');s.rc=fn('rc');s.unid=fv('unid');s.preco=fn('preco');s.desc=fn('desc')||0;if(!(s.peso>0))return toast('Coloque o peso de saída');if(!(s.preco>0)&&!confirm('Salvar sem o preço de venda?'))return;}
    gPut(s);toast(m?'Morte lançada':'Saída lançada');return gVoltar();}
  if(a==='salvaMud'){const l=JSON.parse(JSON.stringify(G.it[id])),c=b.dataset.o==='curr',d=fv('desde'),v=fv('val');if(!d||!v)return toast('Escolha a data e '+(c?'o curral':'a ração'));
    if(d<l.ent.dia)return toast('A data é antes da entrada do lote');
    if(c){l.curr=l.curr||[];setHist(l.curr,d,{c:v});}else{l.rac=l.rac||[];setHist(l.rac,d,{r:v});}gPut(l);toast('Salvo');return gVoltar();}
  if(a==='apaga'){if(!confirm(`Apagar esta ${b.dataset.o}?`))return;gDel(id);toast('Apagado');return gRender();}
  if(a==='apagaHist'){const l=JSON.parse(JSON.stringify(G.it[id])),arr=l[b.dataset.o];arr.splice(+b.dataset.i,1);gPut(l);return gRender();}
  if(a==='apagaLote'){const l=G.it[id];if(!confirm(`Apagar o lote ${l.nome} com pesagens e saídas? Os tratos lançados não são apagados.`))return;
    gTodos('pesagem').concat(gTodos('saida')).filter(x=>x.lote===id).forEach(x=>gDel(x.uid));gDel(id);toast('Lote apagado');GT={t:'lotes'};gPilha.length=1;return gRender();}
  if(a==='compRel')return enviarTexto(textoRel());
  if(a==='compDia')return enviarTexto(textoDia());
  if(a==='nota'){const c=b.dataset.c,n=+b.dataset.n;GT.sel=GT.sel||{};GT.sel[c]={n};gRender();return;}
  if(a==='salvaCocho')return salvaCocho();
  if(a==='racAdd'){lerItensRac();GT.itens.push({ins:'',pMS:''});const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='racRm'){lerItensRac();GT.itens.splice(+b.dataset.i,1);if(!GT.itens.length)GT.itens.push({ins:'',pMS:''});const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='salvaRac')return salvaRac(id);
  if(a==='apagaRac'){const r=G.it[id],usam=gTodos('lote').filter(l=>(l.rac||[]).some(h=>h.r===id));
    if(usam.length)return toast(`Usada nos lotes: ${usam.map(l=>l.nome).join(', ')}. Não dá para apagar.`);if(!confirm(`Apagar a ração ${r.nome}?`))return;gDel(id);GT.itens=null;return gVoltar();}
  if(a==='salvaIns')return salvaIns(id);
  if(a==='insPrecoRm'){const i=JSON.parse(JSON.stringify(G.it[id]));i.precos=i.precos.filter(p=>p.desde!==b.dataset.d);gPut(i);return gRender();}
  if(a==='apagaIns'){const i=G.it[id],usam=gTodos('racao').filter(r=>(r.versoes||[]).some(v=>v.itens.some(x=>x.ins===id)));
    if(usam.length)return toast(`Usado nas rações: ${usam.map(r=>r.nome).join(', ')}. Não dá para apagar.`);if(!confirm(`Apagar ${i.nome}?`))return;gDel(id);return gVoltar();}
  if(a==='salvaCfg')return salvaCfg();
});
$('gBox').addEventListener('input',e=>{
  const t=e.target;
  if(GT.t==='racForm'&&(t.matches('[data-rp]')||t.id==='gVag'))calcRacao();
  if(GT.t==='rel'&&/^gf_s/.test(t.id))calcSimul();
});
$('gBox').addEventListener('change',e=>{
  const t=e.target;
  if(GT.t==='racForm'&&t.matches('[data-ri]'))calcRacao();
  if(t.id==='gCoDia'){GT.sel={};GT.dia=t.value||hojeKey();gRenderCom({dia:GT.dia});}
  if(t.id==='gDiaDia'){gRenderCom({dia:t.value||hojeKey()});}
  if(t.matches('input[data-kg]')){const c=t.dataset.kg;GT.sel=GT.sel||{};const lt=G.it[idLeit(GT.dia,c)];
    const n=GT.sel[c]?GT.sel[c].n:(lt&&!lt.del?lt.nota:null);if(n==null){toast('Marque a nota primeiro');t.value='';return;}GT.sel[c]={n,kg:gNum(t.value)};}
});
function gRenderCom(o){Object.assign(GT,o);gRender();}


/* ---------- aba ---------- */
function abrirGestao(){if(typeof aba==='function')aba('gest');}
$('tabGest').addEventListener('click',()=>{abrirGestao();});
window.gAoAbrir=()=>{gRender();if(navigator.onLine)gSync(true).catch(()=>{});};
/* nome do curral mudou no Previsto: o lote passa a usar o nome novo a partir de hoje */
window.gRenomearCurral=(de,para)=>{const hj=hojeKey();gTodos('lote').forEach(l=>{if(ativo(l)&&curralEm(l,hj)===de){const x=JSON.parse(JSON.stringify(l));setHist(x.curr,hj,{c:para});gPut(x);}});};

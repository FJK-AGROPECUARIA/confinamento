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
const rs=(n,d=2)=>ok(n)?'R$ '+nf(n,Math.max(2,d)):'—';
const rsIn=n=>ok(n)?'R$ '+nf(n,2):'';
/* máscara de dinheiro: digita só números, vira R$ 1.234,56 */
function mascaraRs(el){const dg=el.value.replace(/\D/g,'').replace(/^0+(?=\d)/,'');el.value=dg?'R$ '+nf(+dg/100,2):'';}
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
      if(j&&j.ok&&Array.isArray(j.itens)){let mud=false;try{marcarAtualiz();}catch(e){}
        j.itens.forEach(x=>{if(!x||!x.uid)return;const l=G.it[x.uid];
          if(!l||((+x.ts||0)>(l.ts||0)&&!G.pend.includes(x.uid))){G.it[x.uid]=x;mud=true;}});
        if(mud){gSave();try{aplicarRenomesHist();limparPrevRenomes();}catch(e){}if(!$('viewGest').hidden&&!gEditando())gRender();}
      }
    }
  }finally{gSinc=false;if(typeof statusNuvem==='function')statusNuvem();}
}
const gEditando=()=>{const a=document.activeElement;return a&&$('gBox').contains(a)&&/INPUT|SELECT|TEXTAREA/.test(a.tagName);};
setInterval(()=>{if(modoVer&&!$('viewGest').hidden&&navigator.onLine&&document.visibilityState==='visible')gSync(true).catch(()=>{});},20000);

/* ---------- configurações ---------- */
const PCT_PADRAO={0:0,1:3,2:6,3:10,4:15};
const NOTAS_PADRAO=[-4,-3,-2,-1,0,1,2,3,4].map(n=>({n,t:n>0?'Aumentar':n<0?'Diminuir':'Manter',p:Math.sign(n)*PCT_PADRAO[Math.abs(n)]}));
const NOTAS_VER=3;
function gCfg(){const c=G.it.config&&!G.it.config.del?G.it.config:{uid:'config',tipo:'config'};
  if(!Array.isArray(c.taxa))c.taxa=[];if(!Array.isArray(c.notas)||!c.notas.length||c.notasV!==NOTAS_VER)c.notas=NOTAS_PADRAO.map(x=>Object.assign({},x));
  if(!Array.isArray(c.racas)||!c.racas.length)c.racas=RACAS_PADRAO.slice();if(!Array.isArray(c.cats)||!c.cats.length)c.cats=CATS_PADRAO.slice();else c.cats=[...new Set(c.cats.map(x=>CAT_PLURAL[x]||x))];if(!ok(c.arred))c.arred=10;if(!ok(c.pvIni))c.pvIni=2.2;if(!ok(c.rc))c.rc=52;return c;}
const taxaEm=dia=>{const v=vig(gCfg().taxa,dia);return v?+v.rs||0:0;};

/* ---------- insumos e rações ---------- */
const precoIns=(ins,dia)=>{const v=vig(ins.precos,dia);return v?+v.rs:NaN;}; // R$ por tonelada (matéria natural)
/* MS do insumo valendo no dia: cada alteração vale do dia dela em diante; antes da 1ª, vale a MS de antes */
function msEm(ins,dia){if(!ins)return NaN;let h=Array.isArray(ins.msHist)&&ins.msHist.length?ins.msHist:(ins.msDia&&ins.msAnt!=null?[{dia:ins.msDia,ts:0,de:+ins.msAnt,para:+ins.ms}]:null);
  if(!h||!dia)return +ins.ms;h=h.slice().sort((a,b)=>(a.dia||'').localeCompare(b.dia||'')||(a.ts||0)-(b.ts||0));
  let v=+h[0].de;h.forEach(x=>{if((x.dia||'')<=dia)v=+x.para;});return v>0?v:+ins.ms;}
window.msEm=msEm;
function compRacao(rac,dia){
  const v=vig(rac&&rac.versoes,dia);if(!v)return null;
  const itens=(v.itens||[]).map(i=>{const ins=G.it[i.ins];const vivo=ins&&!ins.del;
    return {ins:vivo?ins:null,nome:vivo?ins.nome:'(insumo apagado)',pMS:+i.pMS||0,ms:vivo?msEm(ins,dia):NaN,preco:vivo?precoIns(ins,dia):NaN};});
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
const curralEm=(l,dia)=>{const v=vig(l.curr,dia);return v?(typeof nomeAtual==='function'?nomeAtual(v.c):v.c):'';}; // sempre o nome ATUAL (curral renomeado)
const racaoEm=(l,dia)=>{const v=vig(l.rac,dia);const r=v&&G.it[v.r];return r&&!r.del?r:null;};
function pesoEm(l,dia,pz){if(!l.ent)return NaN;let b={dia:l.ent.dia,peso:+l.ent.peso};(pz||pesagensDe(l)).forEach(p=>{if(p.dia<=dia)b=p;});return +b.peso+(+l.gmd||0)*difDias(b.dia,dia);}
const fimLote=l=>{if(cabAtual(l)>0)return null;const sd=saidasDe(l);return sd.length?sd[sd.length-1].dia:null;};
const ativo=l=>cabAtual(l)>0||(l.ent&&l.ent.dia>hojeKey());
const lotesAtivos=()=>gTodos('lote').filter(ativo).sort(porNome);
function valorCompra(l){const e=l.ent||{};const cab=+e.cab||0,peso=+(e.pesoC||e.peso)||0,p=+e.preco||0;
  const rc=+e.rcC||50,v=e.unid==='cab'?cab*p:e.unid==='kg'?cab*peso*p:cab*peso*rc/100/15*p;return v+(+e.outros||0);}
const arrobaVenda=s=>(+s.cab||0)*(+s.peso||0)*((+s.rc||0)/100)/15;
function valorVenda(s){const cab=+s.cab||0,peso=+s.peso||0,p=+s.preco||0;
  const v=s.unid==='cab'?cab*p:s.unid==='kg'?cab*peso*p:arrobaVenda(s)*p;return v-(+s.desc||0);}

/* ---------- consumo e custo por dia (a partir do realizado do trato) ---------- */
const nAt=c=>typeof nomeAtual==='function'?nomeAtual(c):c;  // curral renomeado: registros e lotes se encontram pelo nome atual
function gIndice(){const m=new Map();(HIST||[]).forEach(r=>{const k=r.dia+'|'+nAt(r.curral);m.set(k,(m.get(k)||0)+(+r.forn||0));});return m;}
function gCtx(){const L=gTodos('lote');const sd=new Map(),pz=new Map();L.forEach(l=>{sd.set(l.uid,saidasDe(l));pz.set(l.uid,pesagensDe(l));});return {ix:gIndice(),L,sd,pz};}
function diaLote(l,dia,X){
  const sd=X.sd.get(l.uid),cab=cabPres(l,dia,sd);if(!cab)return null;
  const c=curralEm(l,dia),tot=X.ix.get(dia+'|'+nAt(c))||0;
  const juntos=X.L.filter(o=>curralEm(o,dia)===c&&cabPres(o,dia,X.sd.get(o.uid))>0);
  const cabTot=juntos.reduce((a,o)=>a+cabPres(o,dia,X.sd.get(o.uid)),0)||cab;
  const mn=tot*cab/cabTot,rac=racaoEm(l,dia),cp=rac?compRacao(rac,dia):null;
  const ms=cp?mn*cp.ms/100:NaN,peso=pesoEm(l,dia,X.pz.get(l.uid)),cabOp=cabEm(l,dia,sd);
  return {dia,c,cab,cabOp,peso,mn,ms,mnCab:mn/cab,msCab:ms/cab,pv:ms/cab/peso*100,
    custoR:cp?mn*cp.custoMN:NaN,custoOp:cabOp*taxaEm(dia),rac:rac?rac.nome:'—',tem:tot>0,juntos:juntos.length,cp};
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
  else if(f.t==='rs')inp=`<input type="text" inputmode="numeric" class="gRs" id="${id}" value="${esc(rsIn(f.v===''||f.v==null?NaN:+f.v))}" placeholder="R$ 0,00" autocomplete="off">`;
  else if(f.t==='num')inp=`<input type="text" inputmode="decimal" id="${id}" value="${esc(v===''?'':vIn(v))}" placeholder="${esc(f.ph||'')}" autocomplete="off">`;
  else inp=`<input type="text" id="${id}" value="${esc(v)}" placeholder="${esc(f.ph||'')}" autocomplete="off"${f.lista?` list="${f.lista}"`:''}>`;
  return `<div class="gCampo${f.meia&&f.t!=='dia'?' meia':''}"><label for="${id}">${esc(f.l)}${f.suf?` <span class="gSuf">(${esc(f.suf)})</span>`:''}</label>${inp}${f.ajuda?`<p class="note">${f.ajuda}</p>`:''}</div>`;}
const fv=k=>{const e=$('gf_'+k);return e?e.value.trim():'';};
const fn=k=>gNum(fv(k));
const opCurrais=atual=>(S.cadastro||[]).filter(n=>n===atual||!window.curraisApi||!curraisApi.info(n).inativo).slice().sort((a,b)=>alfa(a,b)).map(n=>[n,n]);
const racAtivas=()=>gTodos('racao').filter(r=>!r.inativa);
const opRacoes=atual=>[['','— escolher —']].concat(gTodos('racao').filter(r=>!r.inativa||r.uid===atual).sort(porNome).map(r=>[r.uid,r.nome+(r.inativa?' (inativa)':'')]));
const opInsumos=()=>gTodos('insumo').sort(porNome).map(r=>[r.uid,r.nome]);
const UNID_C=[['arroba','R$ por @ (peso vivo ÷ 30)'],['cab','R$ por cabeça'],['kg','R$ por kg vivo']];
const UNID_V=[['arroba','R$ por @ (carcaça ÷ 15)'],['cab','R$ por cabeça'],['kg','R$ por kg vivo']];

const RAIZ={home:'home',estoque:'estoque',estIns:'estoque',estForm:'estoque',estNF:'estoque',currais:'currais',curForm:'currais',lotes:'lotes',lote:'lotes',loteForm:'lotes',pesForm:'lotes',saiForm:'lotes',mudForm:'lotes',rel:'lotes',custoForm:'lotes',
  cocho:'cocho',cochoGraf:'cocho',fezes:'cocho',rels:'rels',dia:'rels',indices:'rels',periodo:'rels',comp:'rels',racoes:'racoes',racForm:'racoes',insumos:'insumos',insForm:'insumos',insMS:'insumos',ms:'cocho',cfg:'cfg'};
/* Leitura de cocho fica no menu Tratos (aba 'leit'); o resto da Gestão na aba 'gest' — as duas usam a mesma tela */
function gRaiz(t){GT={t};gPilha.length=0;const alvo=RAIZ[t]==='cocho'&&!document.body.classList.contains('modoGest')?'leit':'gest';if(window.abaAtual!==alvo)aba(alvo);else gRender();window.scrollTo({top:0});}
window.gAbrir=modo=>{const leit=RAIZ[GT.t]==='cocho';if(modo==='leit'&&!leit)GT={t:'cocho'};if(modo==='gest'&&leit&&!document.body.classList.contains('modoGest'))GT={t:'home'};gRender();if(navigator.onLine)gSync(true).catch(()=>{});};
function gRender(){
  const b=$('gBox');if(!b)return;
  if(window.abaAtual==='gest'&&RAIZ[GT.t]==='cocho'&&!document.body.classList.contains('modoGest')){aba('leit');return;}  // leitura abre no menu Tratos
  if(window.abaAtual==='leit'&&RAIZ[GT.t]!=='cocho'){aba('gest');return;}
  const f={home:tHome,estoque:tEstoque,estIns:tEstIns,estForm:tEstForm,estNF:tEstNF,currais:tCurrais,curForm:tCurForm,lotes:tLotes,lote:tLote,loteForm:tLoteForm,pesForm:tPesForm,saiForm:tSaiForm,mudForm:tMudForm,rel:tRelLote,custoForm:tCustoForm,
    cocho:tCocho,cochoGraf:tCochoGraf,fezes:t=>tFezes(t),rels:tRels,dia:tDia,indices:tIndices,periodo:tPeriodo,comp:tComp,racoes:tRacoes,racForm:tRacForm,insumos:tInsumos,insForm:tInsForm,insMS:tInsMS,ms:tInsMS,cfg:tCfg}[GT.t]||tHome;
  const raiz=RAIZ[GT.t]||'home';document.querySelectorAll('#subGest button[data-gt]').forEach(x=>x.setAttribute('aria-selected',String(x.dataset.gt===raiz)));
  const cb=$('cfgTBox');if(cb&&$('cfgTParque')&&cb.parentNode!==$('cfgTParque'))$('cfgTParque').appendChild(cb); // ajustes da balança: guarda antes de redesenhar
  b.innerHTML=f(GT);
  try{const fz=GT.t==='fezes',ms=GT.t==='ms',lt=window.abaAtual==='leit';if($('tabFez'))$('tabFez').setAttribute('aria-selected',String(fz&&lt));if($('tabMS'))$('tabMS').setAttribute('aria-selected',String(ms&&lt));if($('tabLeit')&&lt)$('tabLeit').setAttribute('aria-selected',String(!fz&&!ms));}catch(e){}
  if(GT.t==='cfg'&&cb&&$('cfgBalHost')){$('cfgBalHost').appendChild(cb);if(window.cfgTAoAbrir)cfgTAoAbrir();}
  if(GT.t==='racForm')calcRacao();
  if(GT.t==='rel')calcSimul();
  if(GT.t==='pesForm')calcPes();
  requestAnimationFrame(caberSelos);
}
/* nome do curral/pasto no quadro verde: o maior que couber */
function caberSelos(){document.querySelectorAll('#gBox .gLoteV .gSelo b').forEach(b=>{b.style.fontSize='';let f=parseFloat(getComputedStyle(b).fontSize),w=b.parentNode.clientWidth-12;
  for(let i=0;i<30&&b.scrollWidth>w&&f>11;i++){f-=1;b.style.fontSize=f+'px';}});}
window.addEventListener('resize',()=>requestAnimationFrame(caberSelos));

let gLoc='T'; // filtro dos lotes: T todos, C confinamento, P pasto
/* barra de data com setas: ◀ dia anterior | data | dia seguinte ▶ */
const SEM=['dom.','seg.','ter.','qua.','qui.','sex.','sáb.'];
function navData(id,dia,rot){const hj=hojeKey(),[y,m,d]=dia.split('-').map(Number),sem=SEM[new Date(y,m-1,d).getDay()];
  const tag=dia===hj?'Hoje':dia===somaDias(hj,-1)?'Ontem':'';
  return `<div class="gCampo"><label for="${id}">${rot}</label><div class="gNavData">
    <button class="gSeta" data-g="dataPasso" data-alvo="${id}" data-n="-1" aria-label="Dia anterior">◀</button>
    <label class="gDataBox"><span>${sem} ${dB(dia).slice(0,6)+dB(dia).slice(8)}${tag?` <i>${tag}</i>`:''}</span><input type="date" id="${id}" value="${dia}"></label>
    <button class="gSeta" data-g="dataPasso" data-alvo="${id}" data-n="1" aria-label="Dia seguinte">▶</button></div>
    ${dia!==hj?`<button class="mini gHoje" data-g="dataHoje" data-alvo="${id}">Voltar para hoje</button>`:''}</div>`;}
/* ---------- custos extras do lote (sanidade, medicamento, mão de obra…) ---------- */
const custosDe=l=>gTodos('custo').filter(c=>c.lote===l.uid).sort(porDia);
const TIPOS_CUSTO=['Sanidade / vacina','Medicamento','Mão de obra','Frete','Outros'];
const SEXOS=[['','—'],['M','Macho'],['F','Fêmea']];
const CATS_PADRAO=['Bezerros machos','Garrotes','Bois','Bezerras fêmeas','Novilhas','Vacas'];
const CAT_PLURAL={'Bezerro':'Bezerros machos','Bezerro macho':'Bezerros machos','Bezerros macho':'Bezerros machos','Garrote':'Garrotes','Boi':'Bois','Bezerra':'Bezerras fêmeas','Bezerra fêmea':'Bezerras fêmeas','Bezerras fêmea':'Bezerras fêmeas','Novilha':'Novilhas','Vaca':'Vacas','Touro':'Touros'};
const catNorm=c=>CAT_PLURAL[c]||(c||'');
const opCats=atual=>[['','—']].concat(gCfg().cats.map(c=>[c,c])).concat(atual&&!gCfg().cats.includes(atual)?[[atual,atual]]:[]);
const SISTEMAS=[['Confinamento','🏠 Confinamento'],['Pasto com suplementação','🌿 Pasto']];
const tipoDoSistema=v=>v==='Pasto com suplementação'?'P':'C';
const opCurraisTipo=(tipo,atual)=>[['','— escolher —']].concat(opCurrais(atual).filter(([n])=>n===atual||!window.curraisApi||curraisApi.info(n).tipo===tipo));
const RACAS_PADRAO=['Angus','Cruzado','Nelore'];
/* sexo: só Macho e Fêmea (lotes antigos com macho inteiro/castrado aparecem como Macho) */
const sexoNorm=v=>/^M[IC]?$/.test(v||'')?'M':v==='F'?'F':'';
const sexoTxt=v=>(SEXOS.find(x=>x[0]===sexoNorm(v))||['',''])[1];

/* cálculo completo de um lote (usado no relatório do lote e no comparativo) */
/* venda estimada: animais que estão no lote × peso projetado × rendimento × preço da @ guardado na simulação (+ vendas já feitas). Arquivado: venda real. */
/* estimativa de venda detalhada (lote ativo): animais no lote × peso projetado × rendimento ÷ 15 × preço da @ (+ vendas já feitas) */
function estVendaDet(l,C){C=C||calcLote(l);const pr=+l.simPreco||0,rc=+l.rcPrev||+l.simRc||+gCfg().rc||52,peso=pesoEm(l,C.ate),arrCab=peso*rc/100/15,arrTot=C.cabAt*arrCab;
  const rec=pr>0?arrTot*pr+C.receita:NaN,res=rec-C.custo,arrProd=C.arrV+arrTot-(C.cabV+C.cabAt)*C.pesoE/30;
  return {pr,rc,peso,arrCab,arrTot,rec,res,resCab:res/C.cabE,margem:res/C.custo*100,pontoEq:arrTot>0?(C.custo-C.receita)/arrTot:NaN,custoArr:arrProd>0?C.prod/arrProd:NaN,arrProd,ganho:peso-C.pesoE};}
const UNID_TXT={arroba:'R$ por @',cab:'R$ por cabeça',kg:'R$ por kg vivo'};
function dadosLotePares(l,C){const e=l.ent||{},hj=hojeKey(),r=racaoEm(l,C.ate),rcC=+e.rcC||50;
  const arrC=e.unid==='arroba'||!e.unid?C.cabE*(+(e.pesoC||e.peso)||0)*rcC/100/15:NaN;
  return [['Local',l.sistema&&/Pasto/.test(l.sistema)?'Pasto':linhaDe(curralEm(l,C.ate))==='P'?'Pasto':'Confinamento'],['Curral / pasto',curralEm(l,C.ate)||'—'],
    ['Animais',[sexoTxt(l.sexo),l.raca,catNorm(l.cat)].filter(Boolean).join(' · ')||'—'],['Ração atual',r?r.nome:'sem ração'],
    ['Entrada',`${dB(e.dia)} · ${nf(C.cabE)} cab · ${nf(C.pesoE,1)} kg`],['Cabeças hoje',nf(C.cabAt)+(C.cabV?` (vendidas ${nf(C.cabV)})`:'')+(C.mortes?` · mortes ${nf(C.mortes)}`:'')],
    ['Peso projetado hoje',`${nf(pesoEm(l,C.ate),1)} kg (+${nf(pesoEm(l,C.ate)-C.pesoE,1)} kg)`],['Ganho por dia (meta)',nf(+l.gmd||0,2)+' kg/cab/dia'],
    ['Compra',`${UNID_TXT[e.unid||'arroba']}: ${rs(+e.preco||0)}${(e.unid||'arroba')==='arroba'?` · rendimento ${nf(rcC,1)}% (${nf(arrC,1)} @)`:''}${+e.outros?` · frete/outros ${rs(+e.outros)}`:''}`],
    ['Valor da compra',`${rs(C.compra)} (${rs(C.compra/C.cabE)} por cab)`]];}
function vendaEst(l,C){C=C||calcLote(l);if(C.fim)return {venda:C.receita,res:C.lucro,real:true};
  const pr=+l.simPreco||0;if(!(pr>0))return {venda:NaN,res:NaN};
  const rc=+l.rcPrev||+l.simRc||+gCfg().rc||52,peso=pesoEm(l,C.ate),v=C.cabAt*peso*rc/100/15*pr+C.receita;return {venda:v,res:v-C.custo};}
function calcLote(l){
  const fim=fimLote(l),hj=hojeKey(),ate=fim||hj,R=resumoLote(l,ate),sd=saidasDe(l);
  const vendas=sd.filter(s=>s.mot!=='morte'),mortes=sd.filter(s=>s.mot==='morte').reduce((a,s)=>a+(+s.cab||0),0);
  const cabE=+l.ent.cab,pesoE=+l.ent.peso,compra=valorCompra(l);
  const outros=custosDe(l).filter(c=>c.dia<=ate).reduce((a,c)=>a+(+c.rs||0),0);
  const cabV=vendas.reduce((a,s)=>a+(+s.cab||0),0),arrV=vendas.reduce((a,s)=>a+arrobaVenda(s),0),receita=vendas.reduce((a,s)=>a+valorVenda(s),0);
  const pesoV=cabV?vendas.reduce((a,s)=>a+s.cab*s.peso,0)/cabV:NaN;
  const ganhoV=vendas.reduce((a,s)=>a+s.cab*(s.peso-pesoE),0),cabDiasV=vendas.reduce((a,s)=>a+s.cab*difDias(l.ent.dia,s.dia),0);
  const alim=R.custoR,op=R.custoOp,prod=alim+op+outros,custo=compra+prod,arrProd=cabV?arrV-cabV*pesoE/30:NaN;
  return {fim,ate,R,vendas,mortes,cabE,pesoE,compra,outros,cabV,arrV,receita,pesoV,ganhoV,cabDiasV,alim,op,prod,custo,arrProd,
    dias:difDias(l.ent.dia,ate),cabAt:cabAtual(l),msCab:R.ms/R.cabDias,mnCab:R.mn/R.cabDias,pv:R.pvN?R.pvS/R.pvN:NaN,
    gmdV:cabDiasV?ganhoV/cabDiasV:NaN,custoArr:prod/arrProd,conv:R.ms/ganhoV,lucro:fim?receita-custo:NaN,custoCabDia:(alim+op)/R.cabDias};
}
/* na Gestão os currais/pastos vão sempre em ordem alfabética (nos Tratos continua a ordem definida) */
const alfa=(a,b)=>String(a||'').localeCompare(String(b||''),'pt-BR',{numeric:true,sensitivity:'base'});
const porCurral=(a,b)=>{const h=hojeKey();return alfa(curralEm(a,h),curralEm(b,h))||porNome(a,b);};
/* curral em destaque: "C-10" -> CURRAL / C-10 ; "P-REPRESA-1" -> PASTO / REPRESA-1 */
function seloCurral(c){const p=/^P-/.test(c),t=p?c.replace(/^P-/,''):c;
  return `<div class="gSelo${p?' pasto':''}"><small>${p?'Pasto':'Curral'}</small><b class="${t.length<=4?'t1':t.length<=6?'t2':t.length<=9?'t3':'t4'}">${esc(t||'—').replace(/-/g,'\u2011')}</b></div>`;}

/* cartão padrão de um lote nos relatórios: selo do curral + nome + números em grade de 3 */
function cartaoLote(l,c,sub,pares,cls){return `<button class="gLoteRel ${cls||''}" data-g="lote" data-id="${l.uid}"><div class="gRelTopo">${seloCurral(c)}<div class="gLoteInfo"><b>${esc(l.nome)}</b>${sub?`<span>${sub}</span>`:''}</div></div>
  <div class="gLoteNums gRelNums">${pares.map(([v,r,k])=>`<span${k?` class="${k}"`:''}><b>${v}</b>${r}</span>`).join('')}</div></button>`;}
/* gráfico de evolução do lote: IMS, % PV e peso em 3 faixas com as mesmas datas (sem eixo duplo) */
function dadosEvol(l,fim,n){const X=gCtx(),pts=[];for(let i=n-1;i>=0;i--){const d=somaDias(fim,-i);if(d<l.ent.dia)continue;const x=diaLote(l,d,X);
  pts.push({d,ims:x&&x.mn>0?x.msCab:NaN,pv:x&&x.mn>0?x.pv:NaN,peso:x?x.peso:pesoEm(l,d),mn:x&&x.mn>0?x.mnCab:NaN});}return pts;}
function svgEvol(pts){if(!pts.length)return '<p class="note">Sem dias nesse período.</p>';
  const W=320,PH=74,GAP=20,L=8,Rr=8,top=4,n=pts.length,xs=i=>L+(n===1?(W-L-Rr)/2:i*(W-L-Rr)/(n-1));
  const faixas=[['ims','IMS · kg MS/cab/dia',2],['pv','% do peso vivo',2],['peso','Peso vivo projetado · kg',0]];
  let svg='';faixas.forEach(([k,rot,dec],f)=>{const y0=top+f*(PH+GAP),vs=pts.map(p=>p[k]).filter(ok);
    svg+=`<text x="${L}" y="${y0+11}" class="gEvRot">${rot}</text>`;
    if(!vs.length){svg+=`<text x="${W/2}" y="${y0+PH/2+8}" class="gEvVazio" text-anchor="middle">sem trato lançado</text>`;return;}
    let mn=Math.min(...vs),mx=Math.max(...vs);if(mx-mn<1e-9){mn-=1;mx+=1;}const pad=(mx-mn)*.15;mn-=pad;mx+=pad;
    const ys=v=>y0+18+(PH-24)*(1-(v-mn)/(mx-mn));
    svg+=`<line x1="${L}" x2="${W-Rr}" y1="${y0+PH}" y2="${y0+PH}" class="gEvBase"/>`;
    let dpath='',on=false;pts.forEach((p,i)=>{if(ok(p[k])){dpath+=(on?'L':'M')+xs(i).toFixed(1)+' '+ys(p[k]).toFixed(1);on=true;}else on=false;});
    svg+=`<path d="${dpath}" class="gEvLinha"/>`;
    pts.forEach((p,i)=>{if(ok(p[k])&&(n<=15||i===n-1))svg+=`<circle cx="${xs(i).toFixed(1)}" cy="${ys(p[k]).toFixed(1)}" r="${i===n-1?4:2.5}" class="gEvPto"/>`;});
    const ult=[...pts].reverse().find(p=>ok(p[k]));svg+=`<text x="${W-Rr}" y="${y0+11}" text-anchor="end" class="gEvUlt">${k==='pv'?pc(ult[k],2):nf(ult[k],dec)}</text>`;
    svg+=`<text x="${W-Rr}" y="${y0+PH+11}" text-anchor="end" class="gEvEixo">mín ${k==='pv'?pc(Math.min(...vs),2):nf(Math.min(...vs),dec)} · máx ${k==='pv'?pc(Math.max(...vs),2):nf(Math.max(...vs),dec)}</text>`;});
  const yb=top+3*(PH+GAP)-4,marcas=n<=7?pts.map((_,i)=>i):[0,Math.floor((n-1)/2),n-1];
  marcas.forEach(i=>svg+=`<text x="${xs(i)}" y="${yb}" text-anchor="${i===0?'start':i===n-1?'end':'middle'}" class="gEvEixo">${dB(pts[i].d).slice(0,5)}</text>`);
  svg+=`<line id="gEvCursor" x1="0" x2="0" y1="${top}" y2="${yb-12}" class="gEvCursor" visibility="hidden"/>`;
  pts.forEach((p,i)=>{const w=(W-L-Rr)/Math.max(1,n-1);svg+=`<rect x="${(xs(i)-w/2).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${yb}" class="gEvHit" data-ev="${i}"/>`;});
  GT.evPts=pts;GT.evXs=pts.map((_,i)=>xs(i));
  return `<div class="gEvLeitura" id="gEvLeit">Toque no gráfico para ver o dia</div><svg class="gEvol" viewBox="0 0 ${W} ${yb+4}" role="img" aria-label="Evolução de IMS, % do peso vivo e peso">${svg}</svg>`;}
function evolMostrar(i){const p=GT.evPts&&GT.evPts[i];if(!p)return;const c=$('gEvCursor');if(c){c.setAttribute('x1',GT.evXs[i]);c.setAttribute('x2',GT.evXs[i]);c.setAttribute('visibility','visible');}
  $('gEvLeit').innerHTML=`<b>${dB(p.d).slice(0,5)}</b> · MS/cab <b>${ok(p.ims)?nf(p.ims,2)+' kg':'—'}</b> · <b>${pc(p.pv,2)}</b> IMS · <b>${nf(p.peso)} kg</b>${ok(p.mn)?` · MN ${nf(p.mn,1)} kg`:''}`;}
/* ---------- resumo ---------- */
function tHome(t){
  const hj=hojeKey(),dia=(t&&t.dia)||hj,dd=dB(dia).slice(0,5),X=gCtx();GT.dia=dia;
  const A=gTodos('lote').filter(l=>cabPres(l,dia)>0).sort(porCurral),cabD=l=>cabEm(l,dia)||cabPres(l,dia);
  /* dia */
  let cab=0,mn=0,ms=0,cr=0,co=0,pvP=0,cabO=0;const ins={};
  A.forEach(l=>{cab+=cabD(l);const x=diaLote(l,dia,X);if(x&&x.mn>0){mn+=x.mn;if(ok(x.ms))ms+=x.ms;if(ok(x.custoR))cr+=x.custoR;co+=x.custoOp;pvP+=x.cab*x.peso;cabO+=x.cab;somaInsumos(ins,x);}});
  const pesoM=cab?A.reduce((a,l)=>a+cabD(l)*pesoEm(l,dia),0)/cab:NaN,tem=cabO>0,cus=cr+co;
  /* acumulado do mês até a data */
  const ini=dia.slice(0,8)+'01';let mcd=0,mmn=0,mms=0,mcus=0,msan=0,mcr=0,mco=0;
  for(let d=ini,k=0;d<=dia&&k<40;d=somaDias(d,1),k++)X.L.forEach(l=>{const x=diaLote(l,d,X);if(!x)return;mcd+=x.cab;mmn+=x.mn;if(ok(x.ms))mms+=x.ms;mcus+=(ok(x.custoR)?x.custoR:0)+x.custoOp;mcr+=ok(x.custoR)?x.custoR:0;mco+=x.custoOp;});
  gTodos('custo').forEach(c=>{if(c.dia>=ini&&c.dia<=dia)msan+=+c.rs||0;});
  const mortes=gTodos('saida').filter(s=>s.mot==='morte'&&s.dia>=ini&&s.dia<=dia).reduce((a,s)=>a+(+s.cab||0),0);
  const vendas=gTodos('saida').filter(s=>s.mot!=='morte'&&s.dia>=ini&&s.dia<=dia).reduce((a,s)=>a+(+s.cab||0),0);
  /* rebanho */
  const conta=(f)=>{const m={};A.forEach(l=>{const k=f(l)||'Não informado';m[k]=(m[k]||0)+cabD(l);});return Object.entries(m).sort((a,b)=>b[1]-a[1]);};
  const locs=[['C','Confinamento'],['P','Pasto']].map(([k,n])=>{const L=A.filter(l=>linhaDe(curralEm(l,dia))===k),c=L.reduce((a,l)=>a+cabD(l),0);
    return {n,lotes:L.length,cab:c,peso:c?L.reduce((a,l)=>a+cabD(l)*pesoEm(l,dia),0)/c:NaN};}).filter(o=>o.lotes);
  const porSexo=conta(l=>sexoTxt(l.sexo)),porRaca=conta(l=>l.raca),porCat=conta(l=>catNorm(l.cat));
  /* operação do dia */
  const Cs=cochoCurrais(dia),lidos=Cs.filter(c=>{const x=G.it[idLeit(dia,c)];return x&&!x.del;}),notas=lidos.map(c=>G.it[idLeit(dia,c)].nota);
  const bat=gTodos('carga').filter(c=>c.dia===dia),bp=bat.reduce((a,c)=>a+c.itens.reduce((s,x)=>s+x.prev,0),0),br=bat.reduce((a,c)=>a+c.itens.reduce((s,x)=>s+(+x.real||0),0),0);
  /* alertas (sempre sobre hoje) */
  const alertas=[],AH=lotesAtivos();
  const semLeit=cochoCurrais(hj).filter(c=>!G.it[idLeit(hj,c)]);if(semLeit.length)alertas.push(['warn',`Leitura de cocho de hoje faltando: ${semLeit.join(', ')}`,'cocho']);
  AH.forEach(l=>{if(!racaoEm(l,hj))alertas.push(['bad',`${l.nome}: sem ração escolhida`,'lote',l.uid]);
    const pz=pesagensDe(l),ult=pz.length?pz[pz.length-1].dia:l.ent.dia,d2=difDias(ult,hj);
    if(l.alvo&&l.gmd>0){const f=Math.ceil((l.alvo-pesoEm(l,hj))/l.gmd);if(f<=15)alertas.push(['ok',`${l.nome}: ${f<=0?'já atingiu':'atinge em '+f+' dias'} o peso de saída (${nf(l.alvo)} kg)`,'lote',l.uid]);}
    if(l.diasPrev){const f=l.diasPrev-difDias(l.ent.dia,hj);if(f<=15)alertas.push(['ok',`${l.nome}: ${f<=0?'passou':'faltam '+f} dias ${f<=0?'dos':'para os'} ${l.diasPrev} dias de cocho previstos`,'lote',l.uid]);}});
  gTodos('insumo').forEach(i=>{if(!ok(precoIns(i,hj)))alertas.push(['bad',`Insumo ${i.nome} sem preço`,'insumos']);});
  const lista=(arr)=>arr.map(([k,v])=>`<div><span>${esc(k)}</span><b class="num">${nf(v)} cab</b></div>`).join('');
  const AB=AH.map(l=>({l,a:projAbate(l)})).filter(o=>o.a&&o.a.dia<=somaDias(hj,60)).sort((x,y)=>x.a.dia.localeCompare(y.a.dia));
  window.resDados={dia,dd,A:A.length,cab,pesoM,tem,ms,cabO,pvP,cus,mn,cr,co,mcd,mmn,mms,mcus,msan,mcr,mco,vendas,mortes,locs,porSexo,porRaca,porCat,lidos:lidos.length,Cs:Cs.length,notas,bat:bat.length,bp,br,ins,
    AB:AB.map(o=>({nome:o.l.nome,curral:curralEm(o.l,hj),cab:cabPres(o.l,hj),peso:o.a.peso,dia:o.a.dia,f:difDias(hj,o.a.dia),por:o.a.por})),alertas:alertas.map(a=>a[1])};
  const abHTML=AB.length?card('Abates previstos nos próximos 60 dias',`<div class="tablebox"><table class="gTab"><thead><tr><th>Lote</th><th>Curral</th><th>Cab.</th><th>Peso final</th><th>Abate</th><th>Faltam</th></tr></thead><tbody>
    ${AB.map(o=>{const f=difDias(hj,o.a.dia);return `<tr data-g="lote" data-id="${o.l.uid}" class="gClic"><td class="c">${esc(o.l.nome)}</td><td>${esc(curralEm(o.l,hj)||'')}</td><td>${nf(cabPres(o.l,hj))}</td><td>${nf(o.a.peso)} kg</td><td>${dB(o.a.dia).slice(0,5)}</td><td class="${f<0?'bad':f<=15?'warn':''}">${f<0?'atrasado':f===0?'hoje':nf(f)+' d'}</td></tr>`;}).join('')}
    <tr class="grp"><td>Total</td><td></td><td>${nf(AB.reduce((a,o)=>a+cabPres(o.l,hj),0))}</td><td></td><td></td><td></td></tr></tbody></table></div>
    <p class="note">Previsão pelo peso desejado (com a meta de ganho por dia) ou pelos dias de cocho do lote.</p>`):'';
  return `<section class="panel"><h2>Resumo do dia</h2>
    ${navData('gResDia',dia,'Data')}
    ${A.length?`<div class="row compart fz3 lotesExp"><button class="verde" data-g="resPdf">📄 PDF</button><button class="verde" data-g="resImg">🖼 Foto</button><button class="verde" data-g="resXls">📊 Excel</button></div>`:''}
    <div class="stat gStat3">${st('Lotes ativos',nf(A.length))}${st('Cabeças',nf(cab))}${st('Peso médio',nf(pesoM)+' kg')}
      ${st('MS/cab',tem?nf(ms/cabO,2)+' kg':'—')}${st('% IMS',tem?pc(pvP?ms/pvP*100:NaN,2):'—')}${st('Custo/cab',tem?rs(cus/cabO):'—')}</div>
    ${tem?'':`<p class="aviso warn">Ainda sem trato lançado em ${dd}. Toque em ◀ para ver o dia anterior.</p>`}
    ${A.length?'':'<p class="note">Nenhum lote ativo. Comece por Insumos → Rações → Lotes.</p>'}</section>
  ${alertas.length?`<section class="panel"><h2>Atenção</h2>${alertas.map(a=>`<button class="gAlerta ${a[0]}" data-g="${a[2]==='lote'?'lote':'raiz'}" data-t="${a[2]}" data-id="${a[3]||''}">${esc(a[1])}</button>`).join('')}</section>`:''}
  ${tem?card(`Consumo e custo em ${dd}`,`<div class="stat gStat3">${st('MN total',nf(mn)+' kg')}${st('MS total',nf(ms)+' kg')}${st('MN/cab',nf(mn/cabO,2)+' kg')}
      ${st('Custo ração',rs(cr))}${st('Operacional',rs(co))}${st('Custo do dia',rs(cus))}</div>`):''}
  ${mcd?card(`Consumo e custo do mês: 01/${dia.slice(5,7)} até ${dd}`,`<div class="stat gStat3">${st('MN total',nf(mmn/1000,1)+' t')}${st('MS total',nf(mms/1000,1)+' t')}${st('MN/cab/dia',nf(mmn/mcd,2)+' kg')}
      ${st('Custo ração',rs(mcr))}${st('Operacional',rs(mco))}${st('Custo do mês',rs(mcus))}
      ${st('MS/cab/dia',nf(mms/mcd,2)+' kg')}${st('Custo/cab/dia',rs(mcus/mcd))}${st('Despesas lançadas',rs(msan))}</div>
    <p class="note">Mesmos dados do dia, somados de 01/${dia.slice(5,7)} até ${dd}. Médias por cab/dia = total ÷ (cabeças de cada dia somadas: ${nf(mcd)}). Despesas lançadas = sanidade, medicamento etc. dos lotes (fora do custo do mês).</p>
    ${vendas||mortes?`<p class="note">No mês: ${vendas?nf(vendas)+' cab vendidas':''}${vendas&&mortes?' · ':''}${mortes?nf(mortes)+' morte(s)':''}.</p>`:''}`):''}
  ${A.length?card('Rebanho',`${locs.length?`<div class="tablebox"><table class="gTab"><thead><tr><th>Local</th><th>Lotes</th><th>Cab.</th><th>Peso médio</th></tr></thead><tbody>${locs.map(o=>`<tr><td class="c">${o.n}</td><td>${nf(o.lotes)}</td><td>${nf(o.cab)}</td><td>${nf(o.peso)} kg</td></tr>`).join('')}</tbody></table></div>`:''}
    <div class="gDuas"><div><h3>Sexo</h3><div class="gLinhas">${lista(porSexo)}</div></div><div><h3>Raça</h3><div class="gLinhas">${lista(porRaca)}</div></div></div>
    <div class="gDuas"><div><h3>Categoria</h3><div class="gLinhas">${lista(porCat)}</div></div><div></div></div>`):''}
  ${A.length?card(`Operação em ${dd}`,`<div class="stat gStat3">${st('Leituras',`${nf(lidos.length)} de ${nf(Cs.length)}`)}${st('Nota média',notas.length?(()=>{const m=notas.reduce((a,b)=>a+b,0)/notas.length;return (m>0?'+':'')+nf(m,1);})():'—')}${st('Batidas',nf(bat.length))}</div>
    ${bat.length?`<p class="note">Vagão: previsto ${nf(bp)} kg · carregado ${nf(br)} kg (${br-bp>0?'+':''}${nf(br-bp)} kg).</p>`:''}
    ${Object.keys(ins).length?`<h3>Insumos gastos no dia</h3>${tabInsumos(ins)}`:''}`):''}
  ${abHTML}
`;
}
/* ---------- Resumo: relatório (imagem ou PDF) ---------- */
function resSecoes(){const R=window.resDados;if(!R)return [];const S_=[];
  S_.push(kv('Rebanho e consumo',[['Lotes ativos',nf(R.A)],['Cabeças',nf(R.cab)],['Peso médio',nf(R.pesoM)+' kg'],['MS/cab',R.tem?nf(R.ms/R.cabO,2)+' kg':'—'],['% IMS',R.tem?pc(R.pvP?R.ms/R.pvP*100:NaN,2):'—'],['Custo/cab no dia',R.tem?rs(R.cus/R.cabO):'—']]));
  if(R.tem)S_.push(kv(`Consumo e custo em ${R.dd}`,[['MN total',nf(R.mn)+' kg'],['MS total',nf(R.ms)+' kg'],['Custo ração',rs(R.cr)],['Operacional',rs(R.co)],['Custo do dia',rs(R.cus)]]));
  if(R.mcd)S_.push(kv(`Consumo e custo do mês até ${R.dd}`,[['MN total',nf(R.mmn/1000,1)+' t'],['MS total',nf(R.mms/1000,1)+' t'],['MN/cab/dia',nf(R.mmn/R.mcd,2)+' kg'],['MS/cab/dia',nf(R.mms/R.mcd,2)+' kg'],['Custo ração',rs(R.mcr)],['Operacional',rs(R.mco)],['Custo do mês',rs(R.mcus)],['Custo/cab/dia',rs(R.mcus/R.mcd)],['Despesas lançadas',rs(R.msan)],['Vendas no mês',nf(R.vendas)+' cab'],['Mortes no mês',nf(R.mortes)]]));
  if(R.locs.length)S_.push({cab:'Rebanho por local',cols:[['Local',260,'l'],['Lotes',150,'r'],['Cabeças',200,'r'],['Peso médio',230,'r']],linhas:R.locs.map(o=>[o.n,nf(o.lotes),nf(o.cab),nf(o.peso)+' kg'])});
  const tb=(t,a)=>a.length?{cab:t,cols:[['',560,'l'],['Cabeças',280,'r']],linhas:a.map(([k,v])=>[k,nf(v)])}:null;
  [tb('Sexo',R.porSexo),tb('Raça',R.porRaca),tb('Categoria',R.porCat)].forEach(x=>{if(x)S_.push(x);});
  S_.push(kv(`Operação em ${R.dd}`,[['Leituras de cocho',`${nf(R.lidos)} de ${nf(R.Cs)}`],['Nota média',R.notas.length?nf(R.notas.reduce((a,b)=>a+b,0)/R.notas.length,1):'—'],['Batidas',nf(R.bat)],['Vagão previsto / carregado',R.bat?`${nf(R.bp)} / ${nf(R.br)} kg`:'—']]));
  if(R.AB.length)S_.push({cab:'Abates previstos nos próximos 60 dias',cols:[['Lote',230,'l'],['Curral',140,'l'],['Cab.',90,'r'],['Peso final',140,'r'],['Abate',120,'r'],['Faltam',120,'r']],
    linhas:R.AB.map(o=>[o.nome,o.curral||'',nf(o.cab),nf(o.peso)+' kg',dB(o.dia).slice(0,5),o.f<0?'atrasado':o.f===0?'hoje':nf(o.f)+' d'])});
  if(R.alertas.length)S_.push({cab:'Atenção',cols:[['',840,'l']],linhas:R.alertas.map(a=>[a])});
  return S_;}
/* Excel do resumo: as mesmas seções da imagem, uma embaixo da outra */
function resXls(){const R=window.resDados;if(!R)return;const S_=resSecoes(),ls=[],larg=[];
  S_.forEach(sc=>{ls.push([{v:sc.cab,s:1}]);const temCab=sc.cols.some(c=>c[0]);if(temCab)ls.push(sc.cols.map(c=>({v:c[0],s:1})));
    (sc.linhas||[]).forEach(l=>ls.push(l.map(v=>xc(v))));if(sc.total)ls.push(sc.total.map(v=>({v:v==null?'':v,s:1})));ls.push([]);
    sc.cols.forEach((c,k)=>{larg[k]=Math.max(larg[k]||12,Math.min(40,Math.round(c[1]/9)));});});
  gExcel(`Resumo ${dB(R.dia).replace(/\//g,'-')}`,[['Resumo',[`Resumo do dia ${dB(R.dia)} · FJK Agropecuária`],ls,larg]]);}
function resImg(){const R=window.resDados;if(!R)return;enviarImg(`Resumo · ${dB(R.dia)}`,resSecoes(),`Resumo ${dB(R.dia).replace(/\//g,'-')}`);}
async function resPdf(){const R=window.resDados;if(!R)return;try{const b=await gImagem(`Resumo · ${dB(R.dia)} · FJK Agropecuária`,resSecoes());
  const im=await createImageBitmap(b),cv=document.createElement('canvas');cv.width=im.width;cv.height=im.height;const x=cv.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,cv.width,cv.height);x.drawImage(im,0,0);
  /* imagem comprida: corta em páginas no formato A4 */
  const ph=Math.round(cv.width*1.414),pags=[];for(let y=0;y<cv.height;y+=ph){const c2=document.createElement('canvas');c2.width=cv.width;c2.height=Math.min(ph,cv.height-y);const x2=c2.getContext('2d');x2.fillStyle='#fff';x2.fillRect(0,0,c2.width,c2.height);x2.drawImage(cv,0,-y);pags.push(c2);}
  await compartilharArquivo(fzPdf(pags),`Resumo ${dB(R.dia).replace(/\//g,'-')}.pdf`,'application/pdf');}catch(e){toast('Não consegui gerar o PDF');}}
/* ---------- lotes ---------- */
/* média de todos os dias com trato do lote: MN/cab, MS/cab e % IMS (MS ÷ peso vivo) */
function mediaLote(l,X){const ini=l.ent&&l.ent.dia,fim=fimLote(l)||hojeKey();const m={n:0,mn:0,ms:0,pv:0,nms:0};if(!ini||ini>fim)return m;
  for(let d=ini,i=0;d<=fim&&i<4000;d=somaDias(d,1),i++){const x=diaLote(l,d,X);if(!x||!(x.mn>0))continue;m.n++;m.mn+=x.mnCab;if(ok(x.msCab)&&ok(x.pv)){m.ms+=x.msCab;m.pv+=x.pv;m.nms++;}}
  return m;}
/* botões Todos / Confinamento / Pasto com o número de cada um (ex.: Pasto 0/11 ou Pasto 11) */
function locBotoes(attr,sel,conta,extra){conta=null;return `<div class="linhas gFiltro">${[['T','Todos'],['C',ICO_C+' Confinamento'],['P','🌿 Pasto']].map(([k,r])=>{const n=conta?conta(k):null;return `<button data-g="${attr}" data-l="${k}" class="${sel===k?'sel':''}"${extra||''}>${r}${n!=null?`<small> ${n}</small>`:''}</button>`;}).join('')}</div>`;}
const doLocal=(k,c)=>k==='T'||linhaDe(c)===k;
function tLotes(t){
  const hj=hojeKey(),X=gCtx(),loc=gLoc,noLocal=l=>loc==='T'||linhaDe(curralEm(l,fimLote(l)||hj))===loc;
  const todosL=gTodos('lote').filter(noLocal),lista=(t.enc?todosL.filter(l=>!ativo(l)).sort(porNome):todosL.filter(ativo).sort(porCurral));
  const cards=lista.map(l=>{const fim=fimLote(l),ref=fim&&fim<hj?fim:hj,cab=cabPres(l,ref),r=racaoEm(l,ref),c=curralEm(l,ref),m=mediaLote(l,X);
    const sub=[sexoTxt(l.sexo),l.raca,catNorm(l.cat)].filter(Boolean).join(' · ');
    return `<button class="gLote gLoteV" data-g="lote" data-id="${l.uid}"><div class="gLoteTopo">${seloCurral(c)}
      <div class="gLoteInfo"><b>${esc(l.nome)}</b>${sub?`<span>${esc(sub)}</span>`:''}
      <span class="gRacLote">🌾 ${esc(r?r.nome:'sem ração')}</span>
      ${fim&&fim<hj?`<span>Arquivado em ${dB(fim)}</span>`:l.ent.dia>hj?`<span>Entra em ${dB(l.ent.dia)}</span>`:''}</div></div><div class="gLoteInfo gLoteBaixo">
      <div class="gLoteNums4"><span><b>${nf(cab)}</b> cab</span><span><b>${nf(+l.ent.peso||0)}</b> kg entrada</span><span><b>${nf(pesoEm(l,ref))}</b> kg projetado</span><span><b>${nf(Math.max(0,difDias(l.ent.dia,ref)))}</b> dias</span></div>
      ${(()=>{const A=ativo(l)?projAbate(l):null;if(!A)return `<div class="gLoteNums4 gAbate"><span><b>—</b> peso final projetado</span><span><b>—</b> previsão de abate</span><small>Para ver a previsão, coloque no lote o peso desejado ou os dias de cocho.</small></div>`;
        const f=difDias(hj,A.dia);return `<div class="gLoteNums4 gAbate"><span><b>${nf(A.peso)}</b> kg final projetado</span><span><b>${dB(A.dia).slice(0,5)}/${A.dia.slice(2,4)}</b> previsão de abate</span><span><b>${f<0?'atrasado':f===0?'hoje':nf(f)}</b> ${f<0?nf(-f)+' dias':f===0?'':'dias para o abate'}</span><span>pelo ${esc(A.por)}</span></div>`;})()}
      <div class="gLoteNums4 gMed"><span><b>${m.n?nf(m.mn/m.n,1):'—'}</b> MN/cab</span><span><b>${m.nms?nf(m.ms/m.nms,2):'—'}</b> MS/cab</span><span><b>${m.nms?pc(m.pv/m.nms,2):'—'}</b> % IMS</span><span><b>${nf(m.n)}</b> dias c/ trato</span></div>
      ${(()=>{const C=calcLote(l),V=vendaEst(l,C),cr=ok(V.res)?(V.res>=0?'pos':'neg'):'';return `<div class="gLoteNums4 gCus"><span><b>${ok(C.custoCabDia)?rs(C.custoCabDia):'—'}</b> R$/cab/dia</span><span><b>${C.cabE?rs((C.alim+C.op)/C.cabE):'—'}</b> R$/cab tratos</span><span><b>${C.cabE?rs(C.compra/C.cabE):'—'}</b> R$/cab compra</span>
        <span><b>${rs(C.custo)}</b> custo total do lote</span><span><b>${ok(V.venda)?rs(V.venda):'—'}</b> ${V.real?'venda':'venda estimada'}</span><span class="${cr}"><b>${ok(V.res)?rs(V.res):'—'}</b> resultado</span></div>`;})()}
      <small class="gLoteDica">Médias de todos os tratos do lote · custo total inclui a compra · venda estimada = cabeças × peso projetado × rendimento × preço da @ (editar lote › Estimativa de venda) · toque para abrir</small></div></button>`;}).join('');
  return `<section class="panel"><div class="curhead gLotesTopo"><h2>${t.enc?'Lotes arquivados':'Lotes ativos'} <span class="note">${lista.length}</span></h2>
      <span class="gLotesBts">${t.enc?'':'<button type="button" class="mini lima" data-g="novoLote">+ Novo lote</button>'}<button type="button" class="mini" data-g="ir" data-t="lotes" data-enc="${t.enc?'':'1'}">${t.enc?'Ativos':'Arquivados'}</button></span></div>
    ${(()=>{const base=gTodos('lote').filter(l=>t.enc?!ativo(l):ativo(l));return locBotoes('filtroLoc',loc,k=>base.filter(l=>doLocal(k,curralEm(l,fimLote(l)||hj))).length);})()}
    ${lista.length?`<div class="row compart fz3 lotesExp"><button class="verde" data-g="lotesPdf" data-enc="${t.enc?'1':''}">📄 PDF</button><button class="verde" data-g="lotesImg" data-enc="${t.enc?'1':''}">🖼 Foto</button><button class="verde" data-g="lotesXls" data-enc="${t.enc?'1':''}">📊 Excel</button></div>`:''}
    ${cards||`<p class="note">${t.enc?'Nenhum lote arquivado.':'Nenhum lote ainda. Toque em “+ Novo lote”.'}</p>`}
</section>`;
}
function tLoteForm(t){
  const l=t.id?G.it[t.id]:null,e=(l&&l.ent)||{},hj=hojeKey(),novo=!l,v=k=>l?l[k]:'';
  const fs=[{k:'nome',l:'Nome do lote',v:v('nome'),ph:'Ex.: Lote 1 - Nelore'}];
  const sis=l&&l.sistema==='Pasto com suplementação'?l.sistema:'Confinamento';
  fs.push({k:'sistema',l:'Local',t:'sel',op:SISTEMAS,v:sis});
  if(novo)fs.push({k:'curral',l:'Curral / pasto',t:'sel',op:opCurraisTipo(tipoDoSistema(sis)),v:'',ajuda:'Aparecem só os currais do local escolhido (Gestão › Currais).'});
  fs.push(
    {k:'sexo',l:'Sexo',t:'sel',op:SEXOS,v:sexoNorm(v('sexo')),meia:1},{k:'cat',l:'Categoria',t:'sel',op:opCats(l&&catNorm(l.cat)),v:catNorm(v('cat')),meia:1},
    {k:'raca',l:'Raça',t:'sel',op:[['','—']].concat(gCfg().racas.concat(l&&l.raca&&!gCfg().racas.includes(l.raca)?[l.raca]:[]).sort(alfa).map(r=>[r,r])),v:v('raca'),meia:1},{k:'idade',l:'Idade',suf:'meses',t:'num',v:v('idade'),meia:1},
    {k:'dia',l:'Data de entrada',t:'dia',v:e.dia||hj,meia:1},{k:'cab',l:'Cabeças',t:'num',v:e.cab,meia:1},
    {k:'peso',l:'Peso médio na chegada',suf:'kg',t:'num',v:e.peso,meia:1},{k:'pesoC',l:'Peso médio de compra',suf:'kg, na origem',t:'num',v:e.pesoC,meia:1,ajuda:'Se a compra foi pelo peso da origem. Vazio = usa o da chegada.'},
    {k:'unid',l:'Preço de compra em',t:'sel',op:UNID_C,v:e.unid||'arroba'},{k:'preco',l:'Preço de compra',t:'rs',v:e.preco,meia:1},{k:'rcC',l:'Rendimento de carcaça na compra',suf:'%',t:'num',v:e.rcC||50,meia:1,ajuda:'Compra por @: peso × rendimento ÷ 15. 50% é o mesmo que peso vivo ÷ 30.'},{k:'cGrupo',l:'Compra na alteração em grupo',t:'sel',op:[['0','🔒 Bloqueada (não muda pela lista)'],['1','✓ Liberada (pode mudar pela lista)']],v:l&&l.compraGrupo===false?'0':'1'},
    {k:'outros',l:'Frete, comissão e outros da compra',suf:'total',t:'rs',v:e.outros,meia:1},
    );
  if(novo)fs.push({k:'racao',l:'Ração',t:'sel',op:opRacoes(),v:''});
  fs.push({k:'gmd',l:'Ganho por dia (meta)',suf:'kg/cab/dia',t:'num',v:l?l.gmd:1.5,meia:1},{k:'diasPrev',l:'Dias de cocho previstos',t:'num',v:v('diasPrev'),meia:1},
    {k:'alvo',l:'Peso de saída desejado',suf:'kg',t:'num',v:v('alvo'),meia:1},{k:'rcPrev',l:'Estimativa de venda · rendimento de carcaça',suf:'%',t:'num',v:v('rcPrev')||'',meia:1},{k:'simPreco',l:'Estimativa de venda · preço da @',t:'rs',v:l&&l.simPreco?l.simPreco:'',meia:1},
    {k:'obs',l:'Observação',v:v('obs')});
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
  const e0=l.ent||{};l.nome=nome;l.ent={dia,cab,peso,pesoC:fn('pesoC')||null,unid:fv('unid'),preco:fn('preco'),rcC:fn('rcC')||50,outros:fn('outros')||0,origem:e0.origem||'',gta:e0.gta||''};
  l.sistema=fv('sistema');l.sexo=fv('sexo');l.cat=fv('cat');l.raca=fv('raca');l.idade=fn('idade')||null;
  l.gmd=fn('gmd')||0;l.diasPrev=fn('diasPrev')||null;l.alvo=fn('alvo')||null;l.rcPrev=fn('rcPrev')||null;l.simPreco=fn('simPreco')||null;l.compraGrupo=fv('cGrupo')!=='0';l.obs=fv('obs');
  gPut(l);toast('Lote salvo');gPilha.pop();GT={t:'lote',id:l.uid};window.scrollTo({top:0});gRender();setTimeout(()=>{window.scrollTo({top:0});try{gRender();}catch(e){}},60);
}
/* previsão de abate do lote: pelo peso desejado (meta de ganho) ou pelos dias de cocho previstos */
function projAbate(l){try{const hj=hojeKey();if(fimLote(l)&&fimLote(l)<=hj)return null;const pj=pesoEm(l,hj);
  if(l.alvo&&l.gmd>0){const d=somaDias(hj,Math.max(0,Math.ceil((l.alvo-pj)/l.gmd)));return {dia:d,peso:Math.max(+l.alvo,pj),por:'peso desejado'};}
  if(l.diasPrev&&l.ent&&l.ent.dia){const d=somaDias(l.ent.dia,+l.diasPrev);return {dia:d,peso:d>hj?pesoEm(l,d):pj,por:'dias de cocho'};}
  return null;}catch(e){return null;}}
function tLote(t){
  const l=G.it[t.id];if(!l||l.del)return `${voltar()}<p class="note">Lote não encontrado.</p>`;
  const hj=hojeKey(),cab=cabAtual(l),fim=fimLote(l),ref=fim||hj,X=gCtx(),dRef=t.dia||(fim||hj);GT.dia=dRef;const x=diaLote(l,dRef,X),dd=dB(dRef).slice(0,5);
  const r=racaoEm(l,ref),pz=pesagensDe(l),sd=saidasDe(l),cs=custosDe(l),pj=pesoEm(l,ref),e=l.ent;
  /* saída prevista: pelo peso desejado (meta de ganho) ou pelos dias de cocho previstos */
  let saiDia=null,saiPor='';if(!fim&&l.alvo&&l.gmd>0){saiDia=somaDias(hj,Math.max(0,Math.ceil((l.alvo-pj)/l.gmd)));saiPor=`peso ${nf(l.alvo)} kg`;}
  else if(!fim&&l.diasPrev){saiDia=somaDias(e.dia,l.diasPrev);saiPor=`${nf(l.diasPrev)} dias de cocho`;}
  let ant={dia:e.dia,peso:+e.peso};
  const lp=pz.map(p=>{const d2=difDias(ant.dia,p.dia),g=d2>0?(p.peso-ant.peso)/d2:NaN;ant=p;
    return `<tr><td>${dB(p.dia)}</td><td>${nf(p.peso)}${p.proj?`<small class="${p.peso>=p.proj?'ok':'bad'}">proj. ${nf(p.proj)}</small>`:''}</td><td>${nf(g,3)}</td><td>${p.cab?nf(p.cab):'—'}</td><td class="acoes"><button class="mini danger" data-g="apaga" data-id="${p.uid}" data-o="pesagem">✕</button></td></tr>`;}).join('');
  const ls=sd.map(s=>`<tr><td>${dB(s.dia)}</td><td>${s.mot==='morte'?'Morte':'Venda'}</td><td>${nf(s.cab)}</td><td>${s.mot==='morte'?'—':nf(s.peso)}</td><td>${s.mot==='morte'?'—':rs(valorVenda(s))}</td><td class="acoes"><button class="mini danger" data-g="apaga" data-id="${s.uid}" data-o="saída">✕</button></td></tr>`).join('');
  const lc=cs.map(c=>`<tr><td>${dB(c.dia)}</td><td>${esc(c.cat)}${c.desc?`<small>${esc(c.desc)}</small>`:''}</td><td>${rs(+c.rs)}</td><td class="acoes"><button class="mini danger" data-g="apaga" data-id="${c.uid}" data-o="despesa">✕</button></td></tr>`).join('');
  const hist=(arr,fmt,o)=>(arr||[]).map((h,i)=>`<tr><td>${dB(h.desde)}</td><td>${esc(fmt(h))}</td><td class="acoes">${i?`<button class="mini danger" data-g="apagaHist" data-id="${l.uid}" data-o="${o}" data-i="${i}">✕</button>`:''}</td></tr>`).join('');
  const N=GT.evN||15,pts=dadosEvol(l,dRef,N);
  const tabDias=pts.slice().reverse().map(p=>{const y=diaLote(l,p.d,X),lt=y?G.it[idLeit(p.d,y.c)]:null;return `<tr><td>${dB(p.d).slice(0,5)}</td><td>${y?nf(y.mn):'—'}</td><td>${nf(p.ims,2)}</td><td>${pc(p.pv,2)}</td><td>${lt&&!lt.del?notaTxt(lt.nota):'—'}</td></tr>`;}).join('');
  const ficha=[['Sistema',l.sistema],['Sexo',sexoTxt(l.sexo)],['Raça',l.raca],['Categoria',catNorm(l.cat)],['Idade',l.idade?nf(l.idade)+' meses':''],
    ['Entrada',`${dB(e.dia)} · ${nf(e.cab)} cab · ${nf(e.peso)} kg`],['Peso de compra',e.pesoC?`${nf(e.pesoC)} kg · quebra ${pc((e.pesoC-e.peso)/e.pesoC*100,1)}`:''],
    ['Compra',`${rs(valorCompra(l))} (${rs(valorCompra(l)/e.cab)}/cab)`],['Peso desejado',l.alvo?nf(l.alvo)+' kg':''],['Dias de cocho previstos',l.diasPrev?`${nf(l.diasPrev)} (até ${dB(somaDias(e.dia,l.diasPrev))})`:''],
    ['Rendimento esperado',l.rcPrev?pc(l.rcPrev,1):'']].filter(x=>x[1]);
  const projTxt=fim?'':[30,60,90].map(n=>`+${n} dias: <b>${nf(pesoEm(l,somaDias(hj,n)))} kg</b>`).join(' · ');
  const lt=x?G.it[idLeit(dRef,x.c)]:null,cusDia=x?((ok(x.custoR)?x.custoR:0)+x.custoOp):NaN;
  return `${voltar('Lotes')}<section class="panel"><div class="gLoteTopo">${seloCurral(curralEm(l,ref))}<div><h2>${esc(l.nome)}</h2><span class="pill${fim?'':' done'}">${fim?'Arquivado em '+dB(fim):'Ativo'}</span>
      <p class="note">${esc([sexoTxt(l.sexo),l.raca,catNorm(l.cat)].filter(Boolean).join(' · '))}</p></div></div>
    <div class="stat gStat3">${st('Cabeças',nf(cab))}${st('Dias',nf(difDias(e.dia,ref)))}${st(fim?'Peso final':'Peso hoje',nf(pj)+' kg')}
      ${st('GMD meta',nf(l.gmd,2)+' kg')}${st('Ração',esc(r?r.nome:'—'))}${st('Saída prevista',saiDia?dB(saiDia).slice(0,5)+`<small>${saiPor}</small>`:'—')}</div>
    <div class="gAcoes">
      ${fim?'':`<button class="lima" data-g="ir" data-t="pesForm" data-id="${l.uid}">⚖️ Pesagem</button>
      <button class="lima" data-g="ir" data-t="saiForm" data-id="${l.uid}" data-o="venda">💲 Venda / saída</button>
      <button data-g="ir" data-t="custoForm" data-id="${l.uid}">💉 Sanidade / custo</button>
      <button data-g="ir" data-t="saiForm" data-id="${l.uid}" data-o="morte">✝ Morte</button>
      <button data-g="ir" data-t="mudForm" data-id="${l.uid}" data-o="curr">↔ Mudar curral</button>
      <button data-g="ir" data-t="mudForm" data-id="${l.uid}" data-o="rac">🌾 Mudar ração</button>`}
      <button data-g="ir" data-t="loteForm" data-id="${l.uid}">✎ Editar dados</button>
    </div>
    <button class="primary" data-g="ir" data-t="rel" data-id="${l.uid}">📊 ${fim?'Relatório final':'Resultado até hoje'}</button></section>
  <section class="panel gDiaBox">${navData('gRefDia',dRef,'Consumo do dia')}
    ${x?(()=>{const t=x.mn>0,v=(s)=>t?s:'—';return `<div class="stat gStat3">${st('MN no cocho',v(nf(x.mn)+' kg'))}${st('MN/cab',v(nf(x.mnCab,2)+' kg'))}${st('MS/cab',v(nf(x.msCab,2)+' kg'))}
      ${st('% do peso vivo',v(pc(x.pv,2)))}${st('Custo/cab',rs(cusDia/x.cab))}${st('Nota leitura',lt&&!lt.del?notaTxt(lt.nota):'—')}</div>`;})()+`
    ${x.mn>0?'':`<p class="aviso warn">Sem trato lançado no ${esc(x.c)} em ${dd}.</p>`}`:`<p class="note">O lote não estava no cocho em ${dd}.</p>`}
  </section>
  ${card('Evolução do consumo',`<div class="linhas">${[7,15,30].map(n=>`<button data-g="evolN" data-n="${n}" class="${N===n?'sel':''}">${n} dias</button>`).join('')}</div>${svgEvol(pts)}
    <details class="gMais"><summary>Ver os ${pts.length} dias em tabela</summary><div class="tablebox"><table class="gTab"><thead><tr><th>Dia</th><th>MN kg</th><th>MS/cab</th><th>% IMS</th><th>Nota</th></tr></thead><tbody>${tabDias}</tbody></table></div></details>`)}
  ${card('Pesagens',`<div class="tablebox"><table class="gTab"><thead><tr><th>Data</th><th>Peso</th><th>GMD real</th><th>Cab.</th><th></th></tr></thead><tbody>
    <tr><td>${dB(e.dia)}</td><td>${nf(e.peso)}</td><td>entrada</td><td>${nf(e.cab)}</td><td></td></tr>${lp}</tbody></table></div>${projTxt?`<p class="note">Projeção: ${projTxt}</p>`:''}`)}
  ${cs.length?card('Sanidade e outros custos',`<div class="tablebox"><table class="gTab"><thead><tr><th>Data</th><th>Tipo</th><th>Valor</th><th></th></tr></thead><tbody>${lc}</tbody></table></div><p class="note">Total: ${rs(cs.reduce((a,c)=>a+(+c.rs||0),0))}</p>`):''}
  ${sd.length?card('Saídas',`<div class="tablebox"><table class="gTab"><thead><tr><th>Data</th><th>Tipo</th><th>Cab.</th><th>Peso</th><th>Valor</th><th></th></tr></thead><tbody>${ls}</tbody></table></div>`):''}
  <section class="panel"><details class="gMais gTopo" open><summary>Ficha do lote</summary><div class="gLinhas">${ficha.map(([a,b])=>lin(a,esc(b))).join('')}</div>${l.obs?`<p class="note">${esc(l.obs)}</p>`:''}</details>
    <details class="gMais"><summary>Histórico de curral e ração</summary><div class="tablebox"><table class="gTab"><thead><tr><th>Desde</th><th>Curral</th><th></th></tr></thead><tbody>${hist(l.curr,h=>h.c,'curr')}</tbody></table></div>
    <div class="tablebox"><table class="gTab"><thead><tr><th>Desde</th><th>Ração</th><th></th></tr></thead><tbody>${hist(l.rac,h=>{const rr=G.it[h.r];return rr&&!rr.del?rr.nome:'(apagada)';},'rac')||'<tr><td colspan="3">Sem ração escolhida</td></tr>'}</tbody></table></div></details>
    <button class="dangerfill" data-g="apagaLote" data-id="${l.uid}">Apagar lote</button></section>`;
}
function tPesForm(t){const l=G.it[t.id];GT.pesLote=l.uid;
  return `${voltar()}<section class="panel"><h2>Pesagem · ${esc(l.nome)}</h2><div class="gForm">${[
    {k:'dia',l:'Data da pesagem',t:'dia',v:hojeKey()}].map(campo).join('')}</div>
    <div class="gPesBox"><div><small>Peso projetado</small><b id="gPesProj">—</b><span id="gPesProjInfo"></span></div></div>
    <div class="gForm">${[{k:'peso',l:'Peso pesado (atual)',suf:'kg, média por cabeça',t:'num'}].map(campo).join('')}</div>
    <div class="stat" id="gPesRes"></div>
    <div class="gForm">${[{k:'cab',l:'Cabeças pesadas (opcional)',t:'num',meia:1},{k:'obs',l:'Observação',meia:1}].map(campo).join('')}</div>
    <p class="note">Depois de salvar, a projeção do peso passa a partir desta pesagem.</p>
    <button class="primary" data-g="salvaPes" data-id="${l.uid}">Salvar pesagem</button></section>`;}
function calcPes(){const l=G.it[GT.pesLote];if(!l||!$('gPesProj'))return;const dia=fv('dia')||hojeKey();
  const pz=pesagensDe(l).filter(p=>p.dia<dia);const ant=pz.length?pz[pz.length-1]:{dia:l.ent.dia,peso:+l.ent.peso,ent:1};
  const proj=pesoEm(l,dia,pz);$('gPesProj').textContent=nf(proj)+' kg';
  $('gPesProjInfo').textContent=`${ant.ent?'entrada':'última pesagem'} ${dB(ant.dia)}: ${nf(ant.peso)} kg + ${nf(l.gmd,2)} kg/dia × ${nf(difDias(ant.dia,dia))} dias`;
  const p=fn('peso'),box=$('gPesRes');if(!(p>0)){box.innerHTML='';return;}
  const dif=p-proj,dd=difDias(ant.dia,dia),gmd=dd>0?(p-ant.peso)/dd:NaN,cls=dif>=0?'ok':'bad';
  box.innerHTML=st('Diferença do projetado',`<span class="${cls}">${dif>0?'+':''}${nf(dif)} kg (${dif>0?'+':''}${nf(dif/proj*100,1)}%)</span>`)+st('GMD real no período',`<span class="${gmd>=(l.gmd||0)?'ok':'bad'}">${nf(gmd,3)} kg/dia</span>`);}
function tCustoForm(t){const l=G.it[t.id];
  return `${voltar()}<section class="panel"><h2>Sanidade / custo · ${esc(l.nome)}</h2><div class="gForm">${[
    {k:'dia',l:'Data',t:'dia',v:hojeKey(),meia:1},{k:'cat',l:'Tipo',t:'sel',op:TIPOS_CUSTO.map(x=>[x,x]),v:TIPOS_CUSTO[0],meia:1},
    {k:'desc',l:'Descrição',ph:'Ex.: Vacina aftosa + vermífugo'},{k:'rs',l:'Valor total do lote',t:'rs',meia:1}].map(campo).join('')}</div>
    <p class="note">Entra no custo do lote e no custo da @ produzida.</p>
    <button class="primary" data-g="salvaCusto" data-id="${l.uid}">Salvar</button></section>`;}
function tSaiForm(t){const l=G.it[t.id],m=t.o==='morte',cfg=gCfg();
  const fs=m?[{k:'dia',l:'Data',t:'dia',v:hojeKey(),meia:1},{k:'cab',l:'Cabeças',t:'num',v:1,meia:1},{k:'obs',l:'Causa / observação'}]:
   [{k:'dia',l:'Data da saída',t:'dia',v:hojeKey(),meia:1},{k:'cab',l:'Cabeças',t:'num',v:cabAtual(l),meia:1},
    {k:'peso',l:'Peso vivo médio na saída',suf:'kg',t:'num',v:Math.round(pesoEm(l,hojeKey())),meia:1},{k:'rc',l:'Rendimento de carcaça',suf:'%',t:'num',v:l.rcPrev||cfg.rc,meia:1},
    {k:'unid',l:'Preço de venda em',t:'sel',op:UNID_V,v:'arroba'},{k:'preco',l:'Preço de venda',t:'rs',meia:1},
    {k:'desc',l:'Descontos (frete, impostos)',suf:'total',t:'rs',meia:1},{k:'obs',l:'Comprador / frigorífico'}];
  return `${voltar()}<section class="panel"><h2>${m?'Morte':'Venda / saída'} · ${esc(l.nome)}</h2><p class="note">No lote agora: ${nf(cabAtual(l))} cabeças.</p>
    <div class="gForm">${fs.map(campo).join('')}</div><button class="primary" data-g="salvaSai" data-id="${l.uid}" data-o="${m?'morte':'venda'}">Salvar</button></section>`;}
function tMudForm(t){const l=G.it[t.id],c=t.o==='curr';
  return `${voltar()}<section class="panel"><h2>${c?'Mudar curral':'Mudar ração'} · ${esc(l.nome)}</h2><div class="gForm">${[
    {k:'desde',l:'A partir de',t:'dia',v:hojeKey()},
    c?{k:'val',l:'Novo curral / pasto',t:'sel',op:opCurrais(curralEm(l,hojeKey())),v:curralEm(l,hojeKey())}:{k:'val',l:'Nova ração',t:'sel',op:opRacoes((vig(l.rac,hojeKey())||{}).r),v:(vig(l.rac,hojeKey())||{}).r||''}].map(campo).join('')}</div>
    <button class="primary" data-g="salvaMud" data-id="${l.uid}" data-o="${t.o}">Salvar</button></section>`;}

/* ---------- relatório do lote ---------- */
function tRelLote(t){
  const l=G.it[t.id],C=calcLote(l),R=C.R,hj=hojeKey(),cfg=gCfg(),fim=C.fim,cabE=C.cabE;
  const avisos=[R.semPreco?`${R.semPreco} dia(s) com ração sem preço ou sem matéria seca completa.`:'',R.semReg?`${R.semReg} dia(s) sem trato lançado no curral do lote.`:''].filter(Boolean);
  const gmd=C.cabV?C.gmdV:NaN;
  const res=[];const add=(a,b)=>res.push([a,b]);
  add('Lote',l.nome);add('Período',`${dB(l.ent.dia)} a ${dB(C.ate)} (${nf(C.dias)} dias)`);add('Entrada',`${nf(cabE)} cab · ${nf(C.pesoE)} kg`);
  add('MS/cab/dia',nf(C.msCab,2)+' kg');add('MN/cab/dia',nf(C.mnCab,2)+' kg');add('% do peso vivo',pc(C.pv,2));
  add('Custo de compra',rs(C.compra));add('Custo da ração',rs(C.alim));add('Custo operacional',rs(C.op));add('Sanidade e outros',rs(C.outros));add('Custo total',rs(C.custo));add('Custo por cabeça',rs(C.custo/cabE));
  if(C.cabV){add('Vendidos',`${nf(C.cabV)} cab · ${nf(C.pesoV)} kg`);add('Receita líquida',rs(C.receita));add('GMD real',nf(gmd,3)+' kg/dia');add('@ produzidas',nf(C.arrProd,2));add('Custo da @ produzida',rs(C.custoArr));add('Conversão alimentar',nf(C.conv,2));}
  if(fim)add(C.lucro>=0?'LUCRO':'PREJUÍZO',`${rs(C.lucro)} (${rs(C.lucro/cabE)}/cab)`);
  const E=fim?null:estVendaDet(l,C);
  if(E&&E.pr>0){add('Venda estimada',`${rs(E.rec)} (${nf(E.arrCab,2)} @/cab × ${rs(E.pr)} · rend. ${nf(E.rc,1)}%)`);add(E.res>=0?'Resultado estimado':'Prejuízo estimado',`${rs(E.res)} (${rs(E.resCab)}/cab · ${pc(E.margem,1)})`);add('Preço da @ para empatar',rs(E.pontoEq));}
  const DL=dadosLotePares(l,C);res.splice(1,0,...DL.filter(x=>!/Entrada/.test(x[0])));
  GT.relRes=res;
  const hero=fim?`<div class="gHero ${C.lucro>=0?'pos':'neg'}"><small>${C.lucro>=0?'Lucro':'Prejuízo'}</small><b>${rs(C.lucro)}</b><span>${rs(C.lucro/cabE)} por cabeça · ${pc(C.lucro/C.custo*100,1)} sobre o custo</span></div>`
    :`<div class="gHero"><small>Custo até hoje</small><b>${rs(C.custo)}</b><span>${rs(C.custo/cabE)} por cabeça · ${rs(C.custoCabDia)} por cab/dia (ração + operacional)</span></div>`;
  const cd=R.cabDias||1,linC=(a,v,cls,dia)=>`<tr class="${cls||''}"><td>${a}<small>${pc(C.custo?v/C.custo*100:NaN,1)} do total</small></td><td>${rs(v)}</td><td>${rs(v/cabE)}${dia?`<small>${rs(dia===2?C.custoCabDia:v/cd)} cab/dia</small>`:''}</td></tr>`;
  const custos=`<div class="tablebox"><table class="gCustos"><thead><tr><th>Custo</th><th>Total</th><th>Por cabeça</th></tr></thead><tbody>
    ${linC('Compra',C.compra)}${linC('Ração (tratos)',C.alim,'',1)}${linC('Operacional',C.op,'',1)}${C.outros?linC('Sanidade e outros',C.outros):''}${linC('Total',C.custo,'grp',2)}</tbody></table></div>
    <p class="note"><b>Compra</b>: cabeças × peso × rendimento ÷ 15 × preço da @ (+ frete/outros). <b>Ração</b>: kg fornecidos no curral × custo do kg da ração no dia (se tem mais de um lote no curral, divide pelas cabeças). <b>Operacional</b>: taxa da Config. × cabeças × dias. <b>Cab/dia</b>: ração e operacional divididos por ${nf(cd)} cabeças-dia (no total, sem a compra).</p>`;
  const desemp=`<div class="stat gStat2">${st('MS por cab/dia',nf(C.msCab,2)+' kg')}${st('% do peso vivo',pc(C.pv,2))}${st('MN por cab/dia',nf(C.mnCab,2)+' kg')}${st(C.cabV?'GMD real':'GMD meta',nf(C.cabV?gmd:l.gmd,2)+' kg')}</div>
    ${C.cabV?`<div class="stat gStat2">${st('Conversão alimentar',nf(C.conv,2))}${st('Custo da @ produzida',rs(C.custoArr))}</div>`:''}
    <p class="note">Médias de ${nf(R.dias)} dia(s) com animais no lote${R.semReg?` (${nf(R.semReg)} sem trato lançado)`:''}. MS = matéria seca (MN × % MS da ração). % do peso vivo = MS por cabeça ÷ peso projetado do dia.</p>`;
  const venda=C.cabV?card(fim?'Venda':'Vendas até agora',`<div class="stat gStat2">${st('Cabeças vendidas',nf(C.cabV)+(C.mortes?` <small>+${nf(C.mortes)} morte(s)</small>`:''))}${st('Peso vivo médio',nf(C.pesoV)+' kg')}${st('@ por cabeça',nf(C.arrV/C.cabV,2))}${st('Receita líquida',rs(C.receita))}</div>
    <div class="gLinhas">${lin('@ produzidas',`${nf(C.arrProd,2)} (${nf(C.arrProd/C.cabV,2)} por cab)`)}${lin('Receita por cabeça',rs(C.receita/C.cabV))}</div>
    ${fim?'':'<p class="note">O lote ainda tem animais: o lucro final aparece quando sair o último.</p>'}`):'';
  const est=fim?'':card('Estimativa de venda hoje',E&&E.pr>0?`<div class="gHero ${E.res>=0?'pos':'neg'}"><small>${E.res>=0?'Resultado estimado':'Prejuízo estimado'}</small><b>${rs(E.res)}</b><span>${rs(E.resCab)} por cabeça · ${pc(E.margem,1)} sobre o custo</span></div>
    <div class="gLinhas">${lin('Cabeças no lote',nf(C.cabAt))}${lin('Peso projetado hoje',nf(E.peso,1)+' kg')}${lin('Rendimento de carcaça',pc(E.rc,1))}${lin('@ por cabeça',nf(E.arrCab,2))}${lin('@ total',nf(E.arrTot,1))}${lin('Preço da @',rs(E.pr))}
    ${C.receita?lin('Vendas já feitas',rs(C.receita)):''}${lin('Venda estimada',rs(E.rec))}${lin('Custo total até hoje',rs(C.custo))}${lin('Preço da @ para empatar',rs(E.pontoEq))}${ok(E.custoArr)?lin('Custo da @ produzida (estim.)',rs(E.custoArr)):''}</div>
    <p class="note">Conta: cabeças × peso projetado × rendimento ÷ 15 × preço da @ (+ vendas já feitas) − custo total. Preço e rendimento vêm do cadastro do lote (Estimativa de venda) ou de Config. › Custo/Venda.</p>`
    :'<p class="note">Sem preço da @ de venda neste lote. Coloque em editar lote › Estimativa de venda, ou em Config. › Custo/Venda, ou na simulação abaixo.</p>');
  const dados=card('Dados do lote',`<div class="gLinhas">${dadosLotePares(l,C).map(([a,b])=>lin(a,esc(b))).join('')}</div>`);
  const sim=fim?'':card('Simular venda hoje',`<div class="gForm">${[
    {k:'sPeso',l:'Peso vivo',suf:'kg',t:'num',v:Math.round(pesoEm(l,hj)),meia:1},{k:'sRc',l:'Rendimento',suf:'%',t:'num',v:l.rcPrev||l.simRc||cfg.rc,meia:1},
    {k:'sPreco',l:'Preço da @',t:'rs',v:l.simPreco||'',meia:1}].map(campo).join('')}</div><div id="gSimRes"></div>`);
  GT.calc={uid:l.uid,cab:C.cabAt,pesoE:C.pesoE,prod:C.prod,custo:C.custo,receita:C.receita,cabE,cabV:C.cabV,arrV:C.arrV,ms:R.ms,ganhoV:C.ganhoV};
  return `${voltar()}<section class="panel"><div class="gLoteTopo">${seloCurral(curralEm(l,C.ate))}<div><h2>${esc(l.nome)}</h2><span class="pill${fim?'':' done'}">${fim?'Relatório final':'Resultado até hoje'}</span>
      <p class="note">${dB(l.ent.dia)} a ${dB(C.ate)} · ${nf(C.dias)} dias · ${nf(cabE)} cab · entrada ${nf(C.pesoE)} kg</p></div></div>
    ${hero}
    <div class="row compart"><button class="verde" data-g="imgLote" data-id="${l.uid}">🖼 Foto</button><button class="verde" data-g="xlsLote" data-id="${l.uid}">📊 Excel</button></div></section>
  ${dados}
  ${card('Desempenho',desemp)}
  ${card('Custos',custos)}
  ${venda}${est}${sim}
  ${avisos.length?`<section class="panel">${avisos.map(a=>`<p class="aviso warn">${a}</p>`).join('')}</section>`:''}`;
}
const lin=(a,b,c)=>`<div class="${c||''}"><span>${a}</span><b class="num">${b}</b></div>`;
function calcSimul(){const box=$('gSimRes');if(!box)return;const c=GT.calc,peso=fn('sPeso'),rc=fn('sRc'),pr=fn('sPreco');
  clearTimeout(GT.simT);GT.simT=setTimeout(()=>{const l=G.it[c.uid];if(!l||(typeof bloqueado==='function'&&modoVer))return;const np=pr>0?pr:null,nr=rc>0?rc:null;
    if((l.simPreco||null)!==np||(l.rcPrev||null)!==nr){const x=JSON.parse(JSON.stringify(l));x.simPreco=np;x.rcPrev=nr;gPut(x);}},900);
  if(!(peso>0&&rc>0&&pr>0)){box.innerHTML='<p class="note">Coloque o preço da @ para ver o resultado estimado com os animais que estão no lote. O preço e o rendimento ficam guardados no lote (Estimativa de venda) e aparecem na lista de lotes.</p>';return;}
  const arr=c.cab*peso*rc/100/15,rec=arr*pr+c.receita,lucro=rec-c.custo;
  const arrProd=c.arrV+arr-(c.cabV+c.cab)*c.pesoE/30,ganho=c.ganhoV+c.cab*(peso-c.pesoE);
  box.innerHTML=`<div class="gHero ${lucro>=0?'pos':'neg'}"><small>${lucro>=0?'Lucro estimado':'Prejuízo estimado'}</small><b>${rs(lucro)}</b><span>${rs(lucro/c.cabE)} por cabeça</span></div>
    <div class="stat gStat2">${st('@ por cabeça',nf(peso*rc/100/15,2))}${st('Receita estimada',rs(rec))}${st('Custo da @ produzida',rs(c.prod/arrProd))}${st('Conversão alimentar',nf(c.ms/ganho,2))}</div>`;}
function textoRel(){const r=GT.relRes||[];return r.map(([a,b],i)=>i===0?`*${b}*`:`${a}: ${b}`).join('\n');}

/* ---------- leitura de cocho ---------- */
const idLeit=(dia,c)=>'lc-'+dia+'-'+chave(c);
function cochoCurrais(dia){const set=new Set();const A=gTodos('lote').filter(l=>cabPres(l,dia)>0);A.forEach(l=>set.add(curralEm(l,dia)));
  return [...set].filter(Boolean).sort(alfa);}
const prevTotal=c=>Object.values(S.prev||{}).reduce((a,m)=>a+(typeof m[c]==='number'?m[c]:0),0);
const notaTxt=n=>(n>0?'+':'')+nf(n,0);
/* notas em duas linhas: em cima 0, +1, +2… ; embaixo −1, −2… (cada uma debaixo da sua positiva) */
function gradeNotas(notas,nota,c){const cima=notas.filter(x=>x.n>=0).sort((a,b)=>a.n-b.n),baixo=notas.filter(x=>x.n<0).sort((a,b)=>b.n-a.n);
  const tem0=cima.length&&cima[0].n===0,cols=Math.max(cima.length,baixo.length+(tem0?1:0),1);
  const bt=x=>`<button class="${x.n===nota?'sel':''} ${x.p>0?'mais':x.p<0?'menos':''}" data-g="nota" data-c="${esc(c)}" data-n="${x.n}" title="${esc(x.t)}">${notaTxt(x.n)}<small>${x.p>0?'+':''}${nf(x.p,0)}%</small></button>`;
  /* o 0 ocupa a 1ª coluna nas duas linhas e fica no meio, na altura entre positivos e negativos */
  const z=tem0?bt(cima[0]).replace('<button class="','<button style="grid-column:1;grid-row:1 / span 2;align-self:center" class="gZero '):'',pos=tem0?cima.slice(1):cima;
  return `<div class="gNotas" style="grid-template-columns:repeat(${cols},1fr)">${z}${pos.map(bt).join('')}${'<span></span>'.repeat(Math.max(0,cols-(tem0?1:0)-pos.length))}${baixo.map(bt).join('')}</div>`;}
/* leitura: hoje edita; amanhã libera quando o trato de hoje terminar; leituras antigas não mudam */
function leitPode(dia){const hj=hojeKey();if(dia===hj)return {ok:true};
  if(dia===somaDias(hj,1))return window.prevApi&&prevApi.diaFinalizado(hj)?{ok:true}:{ok:false,msg:'A leitura de amanhã libera quando o trato de hoje terminar (todos os tratos registrados).'};
  if(dia<hj)return {ok:false,msg:'Leitura de dia que já passou: só consulta, não muda.',ver:true};
  return {ok:false,msg:'Só dá para fazer a leitura de hoje ou de amanhã.'};}
function tCocho(t){
  const lc=GT.coLoc||'T',dia=t.dia||hojeKey(),ont=somaDias(dia,-1),ix=gIndice(),cfg=gCfg(),CsT=cochoCurrais(dia),Cs=CsT.filter(c=>lc==='T'||linhaDe(c)===lc),hoje=dia===hojeKey(),pode=leitPode(dia),amanha=dia===somaDias(hojeKey(),1);
  const notas=cfg.notas.slice().sort((a,b)=>a.n-b.n);
  GT.dia=dia;GT.sel=GT.sel||{};
  const rows=Cs.map(c=>{const L=gTodos('lote').filter(l=>curralEm(l,dia)===c&&cabPres(l,dia)>0);
    const ontem=ix.get(ont+'|'+c)||0,pt=prevTotal(c),cab=L.reduce((a,l)=>a+cabPres(l,dia),0);
    let base=ontem,orig=dia===hojeKey()?'realizado ontem':ont===hojeKey()?'realizado de hoje':'realizado do dia anterior';
    /* base escolhida à mão (o dia anterior não serve de referência): outra data, previsto ou digitada */
    const lt0=G.it[idLeit(dia,c)],bs0=(GT.base||{})[c]||(lt0&&!lt0.del&&lt0.baseM&&lt0.baseM!=='ontem'?{m:lt0.baseM,d:lt0.baseDia,kg:lt0.base}:null),bs=bs0&&bs0.m!=='ontem'?bs0:null;
    if(bs&&bs.m==='dia'&&bs.d){base=ix.get(bs.d+'|'+c)||0;orig='realizado de '+diaBR(bs.d).slice(0,5);}
    else if(bs&&bs.m==='prev'){base=window.prevApi?prevApi.totalCurral(c,prevApi.prevDoDia(ont)):0;orig='previsto de '+(ont===hojeKey()?'hoje':diaBR(ont).slice(0,5));}
    else if(bs&&bs.m==='kg'&&ok(bs.kg)){base=+bs.kg;orig='base digitada';}
    const bm=bs?bs.m:'ontem';
    /* MS da ração mudou entre o dia da base e o dia da leitura: a base (kg de matéria natural) é convertida para dar a mesma matéria seca */
    let msFator=1;{const dB_=bm==='kg'?null:bm==='dia'&&bs?bs.d:ont,fx=dB_?fatorMS(c,dB_,dia):1;if(base&&ok(fx)&&Math.abs(fx-1)>0.0005){const a=msRacCurral(c,dB_),b=msRacCurral(c,dia);base=Math.round(base*fx);msFator=fx;orig+=` · ajustado pela MS da ração ${pc(a,1)} → ${pc(b,1)}`;}}
    const chips=[1,2,3].map(i=>{const d=somaDias(dia,-i),v=ix.get(d+'|'+c)||0;return `<button type="button" class="mini${bm==='dia'&&bs&&bs.d===d?' sel':''}" data-g="baseDia" data-c="${esc(c)}" data-d="${d}"${v?'':' disabled'}>${diaBR(d).slice(0,5)}<small>${v?nf(v)+' kg':'sem trato'}</small></button>`;}).join('');
    const opB=(m,txt)=>`<button type="button" class="gBaseBt${bm===m?' sel':''}" data-g="baseM" data-c="${esc(c)}" data-m="${m}">${txt}</button>`;
    if(!base&&!bs&&pt){base=pt;orig='previsto atual';}
    if(!base&&!bs){const ms=L.reduce((a,l)=>{const r=racaoEm(l,dia),cp=r&&compRacao(r,dia);return a+(cp?cabPres(l,dia)*pesoEm(l,dia)*cfg.pvIni/100/(cp.ms/100):0);},0);base=Math.round(ms);orig=`sugestão ${nf(cfg.pvIni,1)}% PV`;}
    const lt=G.it[idLeit(dia,c)],sel=GT.sel[c]||(lt&&!lt.del?{n:lt.nota,kg:lt.novo}:null);
    const nota=sel&&sel.n!=null?sel.n:null,cn=notas.find(x=>x.n===nota);
    const sug=cn?arred(base*(1+cn.p/100),cfg.arred):null,kg=sel&&ok(sel.kg)?sel.kg:sug;
    const ant=[3,2,1].map(i=>{const x=G.it[idLeit(somaDias(dia,-i),c)];return x&&!x.del?notaTxt(x.nota):'·';}).join('  ');
    const pvT=L.reduce((a,l)=>a+cabPres(l,dia)*pesoEm(l,dia),0),msF=(()=>{let w=0,t=0;L.forEach(l=>{const r=racaoEm(l,dia),cp=r&&compRacao(r,dia);if(cp){w+=cabPres(l,dia);t+=cabPres(l,dia)*cp.ms/100;}});return w?t/w:NaN;})();
    const imsOnt=ontem&&pvT&&ok(msF)?ontem*msF/pvT*100:NaN;
    const baseOp=`<details class="gBaseOp"${bs?' open':''}><summary>✎ Base: <b>${nf(base)} kg</b> <small>(${orig})</small> · mudar</summary><div class="gBaseF">
      ${opB('ontem','Realizado do dia anterior')}${opB('prev','Previsto do dia anterior')}${opB('dia','Igual ao trato de uma data')}
      ${bm==='dia'?`<div class="gBaseChips">${chips}</div>`:''}</div></details>`;
    if(lt&&!lt.del&&!GT.sel[c]&&!(GT.coAberto||{})[c])return `<button class="gCochoMin" data-g="coAbre" data-c="${esc(c)}">${seloCurral(c)}<span><b>Nota ${notaTxt(lt.nota)}</b>${ok(+lt.novo)?nf(+lt.novo)+' kg':'—'}<small>✓ feita · toque para alterar</small></span><em class="gMinBase">base<br><b>${ok(+lt.base)?nf(+lt.base)+' kg':'—'}</b><br>${lt.baseM==='prev'?'previsto dia ant.':lt.baseM==='dia'?'trato de '+(lt.baseDia?diaBR(lt.baseDia).slice(0,5):'outra data'):lt.baseM==='kg'?'digitada':'realizado dia ant.'}</em></button>`;  // feita: fica recolhida
    return `<div class="gCocho${lt&&!lt.del?' feito':''}" data-c="${esc(c)}" data-base="${base}" data-msf="${msFator}">
      <div class="gCoTopo">${seloCurral(c)}<div><span><b>${esc(L.map(l=>l.nome).join(', '))}</b> · ${nf(cab)} cab</span><span>Ontem: <b>${ontem?nf(ontem)+' kg':'—'}</b>${ok(imsOnt)?` · ${pc(imsOnt,2)} IMS`:''}</span></div>${lt&&!lt.del&&(GT.coAberto||{})[c]?`<button type="button" class="mini gCoFecha" data-g="coFecha" data-c="${esc(c)}" aria-label="Recolher">▲</button>`:''}</div>
      ${gradeNotas(notas,nota,c)}
      <div class="gCoNovo"><span>${cn?esc(cn.t)+'<small> · toque de novo para desmarcar</small>':'Toque na nota'}</span><input class="cell num" inputmode="numeric" data-kg="${esc(c)}" value="${kg!=null?kg:''}" placeholder="kg"><small>kg/dia</small></div>
      ${baseOp}</div>`;}).join('');
  return `<section class="panel"><h2>Leitura de cocho</h2>
    ${navData('gCoDia',dia,'Data da leitura')}
    ${locBotoes('coLoc',lc,k=>{const A=CsT.filter(c=>doLocal(k,c));return A.filter(c=>G.it[idLeit(dia,c)]&&!G.it[idLeit(dia,c)].del).length+'/'+A.length;})}
    <details class="gLeg"><summary class="note">Ver as notas</summary>${notas.map(x=>`<p class="note"><b>${notaTxt(x.n)}</b> — ${esc(x.t)}: ${x.p>0?'+':''}${nf(x.p,0)}%</p>`).join('')}<p class="note">Para mudar as notas: Config.</p></details>
    ${pode.ok?'':`<p class="aviso">${esc(pode.msg)}</p>`}
    <div class="${pode.ok?'':'gLeitTrava'}">${rows||'<p class="note">Nenhum lote ativo nesta data. Cadastre os lotes primeiro.</p>'}</div>
    ${rows&&pode.ok?`<button class="primary" data-g="salvaCocho">${amanha?'Salvar e montar o previsto de amanhã':'Salvar e ajustar o previsto de hoje'}</button>
    <p class="note">O total do dia de cada curral (realizado de ontem ± a nota) é dividido nos tratos pela quantidade de tratos do curral e pela divisão em % do Config.${amanha?' O previsto de amanhã fica guardado e passa a valer quando virar o dia.':''}</p>`:''}
    <button class="verde" data-g="ir" data-t="cochoGraf">📈 Gráfico dos últimos 10 dias</button></section>`;
}
const arred=(v,a)=>a>0?Math.round(v/a)*a:Math.round(v);
/* % de MS da ração do curral num dia (média pelas cabeças, com a MS dos insumos que valia naquele dia) */
function msRacCurral(c,dia){let w=0,t=0;gTodos('lote').forEach(l=>{if(curralEm(l,dia)!==c)return;const cb=cabPres(l,dia);if(!(cb>0))return;const r=racaoEm(l,dia),cp=r&&compRacao(r,dia);if(cp&&cp.ms>0){w+=cb;t+=cb*cp.ms;}});return w?t/w:NaN;}
/* quanto a matéria natural muda para dar a mesma matéria seca: MS do dia da base ÷ MS do dia da leitura */
function fatorMS(c,dBase,dia){const a=msRacCurral(c,dBase),b=msRacCurral(c,dia);return ok(a)&&ok(b)&&b>0?a/b:1;}
/* mudou a MS de um insumo: as leituras de hoje (se o curral ainda não foi tratado) e de amanhã são refeitas com a MS nova,
   e o previsto desses dias acompanha. Para trás não muda nada. */
function ajustarLeiturasMS(){try{if(typeof modoVer!=='undefined'&&modoVer)return 0;if(!window.prevApi)return 0;const hj=hojeKey(),am=somaDias(hj,1),cfg=gCfg();let n=0,mudHoje=false;const objs={};
  gTodos('leitura').forEach(lt=>{if(lt.dia!==hj&&lt.dia!==am)return;if(!ok(+lt.novo)||!(+lt.novo>0)||lt.baseM==='kg')return;
    const c=nAt(lt.curral),dBase=lt.baseM==='dia'&&lt.baseDia?lt.baseDia:somaDias(lt.dia,-1),fNow=fatorMS(c,dBase,lt.dia),fOld=ok(+lt.msF)&&+lt.msF>0?+lt.msF:1;
    if(!ok(fNow)||Math.abs(fNow/fOld-1)<0.0005)return;
    if(lt.dia===hj&&(typeof HIST!=='undefined'?HIST:[]).some(r=>r.dia===hj&&nAt(r.curral)===c))return;  // já começou a tratar o curral hoje: não mexe
    const novo=arred(+lt.novo*fNow/fOld,cfg.arred),x=Object.assign({},lt,{novo,base:Math.round((+lt.base||0)*fNow/fOld),msF:fNow,msAjuste:Date.now()});gPut(x);n++;
    if(lt.dia===hj){aplicaPrev(c,novo,S.prev);mudHoje=true;}else{if(!objs[lt.dia])objs[lt.dia]=JSON.parse(JSON.stringify(prevApi.prevGuardado(lt.dia)||{}));aplicaPrev(c,novo,objs[lt.dia]);}});
  Object.keys(objs).forEach(d=>prevApi.guardarPrevDia(d,objs[d]));if(mudHoje){if(typeof marcarPrev==='function')marcarPrev();if(typeof render==='function')render();}
  return n;}catch(e){console.error(e);return 0;}}
window.ajustarLeiturasMS=ajustarLeiturasMS;
setTimeout(ajustarLeiturasMS,9000);setInterval(ajustarLeiturasMS,5*60000);
function salvaCocho(){
  const dia=GT.dia,hoje=dia===hojeKey(),cfg=gCfg();let n=0,ap=0,rm=0;
  const pode=leitPode(dia);if(!pode.ok)return toast(pode.msg);
  const amanha=dia===somaDias(hojeKey(),1),obj=hoje?S.prev:JSON.parse(JSON.stringify(prevApi.prevGuardado(dia)||S.prev||{}));
  document.querySelectorAll('#gBox .gCocho').forEach(el=>{const c=el.dataset.c,s=GT.sel[c];const inp=el.querySelector('input[data-kg]');const kg=gNum(inp.value);
    const lt=G.it[idLeit(dia,c)];if(s&&s.n==null){if(lt&&!lt.del){gDel(lt.uid);rm++;
      /* apaga também o previsto que a leitura gerou (só dos tratos que ainda não foram fornecidos) */
      const feitos=new Set((typeof HIST!=='undefined'?HIST:[]).filter(r=>r.dia===dia&&r.curral===c).map(r=>+r.trato));
      for(let k=1;k<=(prevApi.MAXT||8);k++){if(feitos.has(k))continue;const m=obj[String(k)];if(m&&c in m){delete m[c];ap++;}}}return;}const nota=s?s.n:(lt&&!lt.del?lt.nota:null);if(nota==null)return;
    const cn=cfg.notas.find(x=>x.n===nota);
    const bs=(GT.base||{})[c]||(lt&&!lt.del&&lt.baseM?{m:lt.baseM,d:lt.baseDia}:null)||{m:'ontem'};
    gPut({uid:idLeit(dia,c),tipo:'leitura',dia,curral:c,nota,pct:cn?cn.p:0,base:+el.dataset.base||0,baseM:bs.m,baseDia:bs.m==='dia'?bs.d:null,novo:ok(kg)?kg:null,msF:+el.dataset.msf||1});n++;
    if(ok(kg)&&kg>0&&aplicaPrev(c,kg,obj))ap++;});
  if(!n&&!rm)return toast('Marque a nota de pelo menos um curral');if(!n){if(ap){if(hoje){marcarPrev();if(typeof render==='function')render();}else prevApi.guardarPrevDia(dia,obj);}GT.sel={};GT.base={};GT.coAberto={};window.scrollTo({top:0,behavior:'smooth'});toast(`${rm} leitura(s) apagada(s) junto com o previsto que tinham gerado`);return gRender();}
  if(ap){if(hoje){marcarPrev();if(typeof render==='function')render();}else prevApi.guardarPrevDia(dia,obj);}
  GT.sel={};GT.base={};GT.coAberto={};window.scrollTo({top:0,behavior:'smooth'});toast(`${n} leitura(s) salva(s) · previsto ${hoje?'de hoje':'de amanhã'} ${ap?`mudou em ${ap} curral(is)`:'já estava com esses valores'}${rm?` · ${rm} apagada(s)`:''}`);gRender();
}
function aplicaPrev(c,total,obj){obj=obj||S.prev;const antes=JSON.stringify([1,2,3,4,5,6].map(k=>(obj[k]||{})[c]));
  prevApi.distribuir(c,total,prevApi.nTratos(c,obj),obj);return JSON.stringify([1,2,3,4,5,6].map(k=>(obj[k]||{})[c]))!==antes;}
/* % IMS: kg de matéria natural do curral para um % de IMS (peso projetado do lote × cabeças ÷ %MS da ração) */
function baseIms(c,dia){const L=gTodos('lote').filter(l=>curralEm(l,dia)===c&&cabPres(l,dia)>0);let b=0,tem=false;
  L.forEach(l=>{const r=racaoEm(l,dia),cp=r&&compRacao(r,dia);if(!cp||!(cp.ms>0))return;b+=cabPres(l,dia)*pesoEm(l,dia)/100/(cp.ms/100);tem=true;});return tem?b:null;}
window.gMnIms=(c,pct,dia)=>{const b=baseIms(c,dia||hojeKey());return b==null?null:b*pct;};
window.gImsDe=(c,dia,mn)=>{const b=baseIms(c,dia||hojeKey());return b&&mn>0?mn/b:null;};

/* ---------- gráfico da leitura de cocho (10 dias) ---------- */
/* cores divergentes: azul = aumentar, vermelho = diminuir, cinza = manter (o número vai escrito em cada quadro) */
const COR_MAIS=['#dbe9f8','#a9c9ef','#6ea4e3','#2a78d6'],COR_MENOS=['#f9dcdb','#f1aaa9','#ea7877','#e34948'],COR_ZERO='#f0efec';
function corNota(pct){if(!ok(pct)||pct===0)return [COR_ZERO,'#11253d'];const a=Math.abs(pct),i=a<=3?0:a<=6?1:a<=10?2:3;return [(pct>0?COR_MAIS:COR_MENOS)[i],i>=2?'#fff':'#11253d'];}
let gLocG='T',gGrafOff=new Set();
function dadosGraf(fim){const dias=[];for(let i=9;i>=0;i--)dias.push(somaDias(fim,-i));
  const set=new Set();gTodos('leitura').forEach(x=>{if(x.dia>=dias[0]&&x.dia<=fim)set.add(x.curral);});dias.forEach(d=>cochoCurrais(d).forEach(c=>set.add(c)));
  const todos=[...set].filter(c=>gLocG==='T'||linhaDe(c)===gLocG).sort(alfa);
  const linhas=todos.filter(c=>!gGrafOff.has(c)).map(c=>({c,cel:dias.map(d=>{const x=G.it[idLeit(d,c)];return x&&!x.del?x:null;})}));
  return {dias,todos,linhas};}
function tCochoGraf(t){const fim=t.dia||GT.dia||hojeKey();GT.dia=fim;const D=dadosGraf(fim);
  const cab=D.dias.map(d=>`<th>${d.slice(8)}<small>${d.slice(5,7)}</small></th>`).join('');
  const rows=D.linhas.map(o=>{const ns=o.cel.filter(Boolean),med=ns.length?ns.reduce((a,x)=>a+x.nota,0)/ns.length:NaN;
    return `<tr><th class="gHc${/^P-/.test(o.c)?' p':''}" title="${esc(o.c)}">${esc(o.c.replace(/^P-/,''))}</th>${o.cel.map((x,i)=>{if(!x)return `<td class="vazio" data-g="celGraf" data-c="${esc(o.c)}" data-d="${D.dias[i]}">·</td>`;const [bg,fg]=corNota(x.pct);
      return `<td style="background:${bg};color:${fg}" data-g="celGraf" data-c="${esc(o.c)}" data-d="${D.dias[i]}">${notaTxt(x.nota)}</td>`;}).join('')}<td class="gHm">${ok(med)?(med>0?'+':'')+nf(med,1):'—'}</td></tr>`;}).join('');
  const notas=gCfg().notas.slice().sort((a,b)=>a.n-b.n);
  return `${voltar('Leitura')}<section class="panel"><h2>Leitura de cocho · 10 dias</h2>
    ${navData('gGrafDia',fim,'Até o dia')}
    ${(()=>{const set=new Set();D.dias.forEach(d=>cochoCurrais(d).forEach(c=>set.add(c)));gTodos('leitura').forEach(x=>{if(x.dia>=D.dias[0]&&x.dia<=fim)set.add(x.curral);});const A=[...set];return locBotoes('grafLoc',gLocG,k=>A.filter(c=>doLocal(k,c)).length);})()}
    <div class="gChips">${D.todos.map(c=>`<button data-g="grafCur" data-c="${esc(c)}" class="${gGrafOff.has(c)?'':'sel'}">${esc(c)}</button>`).join('')}</div>
    ${rows?`<div class="tablebox"><table class="gHeat"><colgroup><col class="cC">${D.dias.map(()=>'<col>').join('')}<col class="cM"></colgroup><thead><tr><th class="gHc">Local</th>${cab}<th class="gHm">Méd.</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="gLegNota">${notas.map(x=>{const [bg,fg]=corNota(x.p);return `<span style="background:${bg};color:${fg}">${notaTxt(x.n)}<small>${x.p>0?'+':''}${nf(x.p,0)}%</small></span>`;}).join('')}</div>
    <p class="note">Azul = aumentou o trato · vermelho = diminuiu · cinza = manteve · ponto = sem leitura. Toque num quadro para ver os kg.</p>
    <div class="row compart"><button class="verde" data-g="imgGraf">🖼 Foto</button><button class="verde" data-g="xlsGraf">📊 Excel</button></div>`:'<p class="note">Nenhuma leitura nesse período.</p>'}
    <button class="gVoltarFim" data-g="voltar">❮ Voltar para a leitura</button></section>`;}
function imagemGraf(){const fim=GT.dia,D=dadosGraf(fim);if(!D.linhas.length)return toast('Nada para mostrar');
  const esq=120,cw=46,ch=34,top=112,W=esq+cw*10+70+20,H=top+ch*D.linhas.length+110,cv=document.createElement('canvas'),s=2;cv.width=W*s;cv.height=H*s;
  const x=cv.getContext('2d');x.scale(s,s);x.fillStyle='#fff';x.fillRect(0,0,W,H);x.fillStyle='#11253d';x.fillRect(0,0,W,72);x.fillStyle='#a7bc09';x.fillRect(0,72,W,5);
  x.fillStyle='#fff';x.font='bold 22px Arial';x.fillText('Leitura de cocho · 10 dias',16,32);x.font='bold 13px Arial';x.fillStyle='#c8dd1e';x.fillText(`${dB(D.dias[0])} a ${dB(fim)} · Gestão de Tratos · FJK`,16,56);
  x.textAlign='center';x.font='bold 13px Arial';D.dias.forEach((d,i)=>{x.fillStyle='#5d6b7a';x.fillText(d.slice(8)+'/'+d.slice(5,7),esq+cw*i+cw/2,top-10);});x.fillText('Média',esq+cw*10+35,top-10);
  D.linhas.forEach((o,r)=>{const y=top+ch*r;x.textAlign='left';x.fillStyle='#11253d';x.font='bold 15px Arial';x.fillText(o.c,16,y+ch/2+5);
    o.cel.forEach((c,i)=>{const cx=esq+cw*i;if(c){const [bg,fg]=corNota(c.pct);x.fillStyle=bg;x.beginPath();x.roundRect?x.roundRect(cx+2,y+2,cw-4,ch-4,5):x.rect(cx+2,y+2,cw-4,ch-4);x.fill();x.fillStyle=fg;x.font='bold 15px Arial';}else{x.fillStyle='#c4ccd5';x.font='15px Arial';}
      x.textAlign='center';x.fillText(c?notaTxt(c.nota):'·',cx+cw/2,y+ch/2+5);});
    const ns=o.cel.filter(Boolean),m=ns.length?ns.reduce((a,c)=>a+c.nota,0)/ns.length:NaN;x.fillStyle='#11253d';x.font='bold 15px Arial';x.fillText(ok(m)?(m>0?'+':'')+nf(m,1):'—',esq+cw*10+35,y+ch/2+5);});
  const ns=gCfg().notas.slice().sort((a,b)=>a.n-b.n),ly=top+ch*D.linhas.length+30,lw=Math.min(54,(W-32)/ns.length);
  ns.forEach((n,i)=>{const [bg,fg]=corNota(n.p),lx=16+lw*i;x.fillStyle=bg;x.fillRect(lx,ly,lw-3,30);x.fillStyle=fg;x.textAlign='center';x.font='bold 13px Arial';x.fillText(notaTxt(n.n),lx+lw/2-1,ly+14);x.font='10px Arial';x.fillText((n.p>0?'+':'')+nf(n.p,0)+'%',lx+lw/2-1,ly+26);});
  x.textAlign='left';x.fillStyle='#5d6b7a';x.font='12px Arial';x.fillText('Azul = aumentou o trato · vermelho = diminuiu · cinza = manteve · ponto = sem leitura',16,ly+52);
  cv.toBlob(b=>compartilharArquivo(b,`Leitura de cocho ${dB(fim).replace(/\//g,'-')}.png`,'image/png'),'image/png');}

/* ---------- Excel ---------- */
const XS={int:4,dec:11,rs:12,pct:14,dia:2};
const xc=(v,f)=>(v==null||(typeof v==='number'&&!isFinite(v)))?{v:''}:(f?{v:f==='dia'?diaSer(v):v,s:XS[f]}:{v});
const diaSer=k=>{const [y,m,d]=k.split('-').map(Number);return (Date.UTC(y,m-1,d)-Date.UTC(1899,11,30))/864e5;};
async function gExcel(nome,abas){
  try{const ws=abas.map(([n,cab,ls,w])=>[n.slice(0,31),[cab.map(t=>({v:t,s:1})),...ls],w||cab.map(()=>14)]);
    const blob=montarXlsx(ws);await compartilharArquivo(blob,nome.replace(/[\\/:*?"<>|]/g,'-')+'.xlsx',blob.type);}
  catch(e){toast('Não consegui gerar o Excel');}
}
/* insumos que entraram no cocho (pela fórmula da ração do lote naquele dia) */
function somaInsumos(acc,x){if(!x||!x.cp||!(x.mn>0))return;x.cp.itens.forEach(i=>{const k=i.nome,o=acc[k]||(acc[k]={kg:0,rs:0});const kg=x.mn*i.pMN/100;o.kg+=kg;if(ok(i.preco))o.rs+=kg*i.preco/1000;});}
const tabInsumos=acc=>{const e=Object.entries(acc).sort((a,b)=>b[1].kg-a[1].kg);if(!e.length)return '';const tk=e.reduce((a,[,o])=>a+o.kg,0),tr=e.reduce((a,[,o])=>a+o.rs,0);
  return `<div class="tablebox"><table><thead><tr><th>Insumo</th><th>kg (MN)</th><th>Custo</th></tr></thead><tbody>${e.map(([n,o])=>`<tr><td>${esc(n)}</td><td>${nf(o.kg)}</td><td>${rs(o.rs)}</td></tr>`).join('')}
  <tr class="grp"><td>Total</td><td>${nf(tk)}</td><td>${rs(tr)}</td></tr></tbody></table></div>`;};

/* ---------- imagens dos relatórios (mesmo padrão das imagens dos tratos) ----------
   secoes: [{cab:'título', cols:[[nome,largura,'l'|'c'|'r'],...], linhas:[[...]], total:[...]|null, cores:[[...]]}] */
function gImagem(titulo,secoes){
  const W0=Math.max(...secoes.map(s=>s.cols.reduce((a,c)=>a+c[1],0))),M=30,W=M*2+W0,RH=44,esc=2,F='-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  let H=120;const todas=[...secoes,...(secoes.depois||[])];todas.forEach(s=>{H+=50+(s.cols.some(c=>c[0])?40:6)+RH*s.linhas.length+(s.total?52:0)+24;});H+=20+(secoes.totalGeral?(secoes.depois?96:70):0);
  const cv=document.createElement('canvas');cv.width=W*esc;cv.height=H*esc;const c=cv.getContext('2d');c.scale(esc,esc);
  c.fillStyle='#ffffff';c.fillRect(0,0,W,H);c.fillStyle='#11253d';c.fillRect(0,0,W,90);c.fillStyle='#a7bc09';c.fillRect(0,90,W,6);
  c.textBaseline='middle';c.fillStyle='#ffffff';let fs=30;c.font=`700 ${fs}px ${F}`;while(c.measureText(titulo).width>W-2*M&&fs>18){fs--;c.font=`700 ${fs}px ${F}`;}const umaL=secoes.umaLinha;c.fillText(titulo,M,umaL?46:40);
  if(!umaL){c.font=`600 16px ${F}`;c.fillStyle='#c8dd1e';c.fillText('Gestão de Tratos · FJK',M,70);}
  /* sem 'Gerado em' no canto (pedido) */
  let y=120,tgFeito=false;
  /* total geral (soma de todas as seções): azul escuro, destacado no fim */
  const desTG=()=>{tgFeito=true;const TG=secoes.totalGeral;if(TG){const cols=TG.cols,px=(k,a)=>{let x=M;for(let i=0;i<k;i++)x+=cols[i][1];const w=cols[k][1];return a==='l'?x+8:a==='c'?x+w/2:x+w-8;};
    c.fillStyle='#11253d';c.fillRect(M,y,W-2*M,56);c.fillStyle='#a7bc09';c.fillRect(M,y,W-2*M,4);c.font=`800 22px ${F}`;
    TG.v.forEach((v,k)=>{if(v==null||v===''||!cols[k])return;const a=cols[k][2];c.textAlign=a==='l'?'left':a==='c'?'center':'right';c.fillStyle=/^(Carregado|Realizado)$/.test(cols[k][0])?'#c8dd1e':'#ffffff';c.fillText(String(v),k===0?M+12:px(k,a),y+31);});y+=56+30;}};
  todas.forEach((s,iS)=>{if(iS===secoes.length&&!tgFeito)desTG();const cols=s.cols,px=(k,a)=>{let x=M;for(let i=0;i<k;i++)x+=cols[i][1];const w=cols[k][1];return a==='l'?x+8:a==='c'?x+w/2:x+w-8;};
    const al=a=>a==='l'?'left':a==='c'?'center':'right';
    c.fillStyle='#f3f7dc';c.fillRect(M,y,W-2*M,44);c.fillStyle='#a7bc09';c.fillRect(M,y,6,44);c.fillStyle='#11253d';c.font=`700 22px ${F}`;c.textAlign='left';c.fillText(s.cab,M+16,y+22);y+=50;
    if(cols.some(x=>x[0])){c.font=`700 14px ${F}`;c.fillStyle='#5d6b7a';cols.forEach(([t,w,a],k)=>{c.textAlign=al(a);c.fillText(String(t).toUpperCase(),px(k,a),y+20);});y+=40;c.fillStyle='#dde3ea';c.fillRect(M,y-2,W-2*M,2);}else y+=6;
    s.linhas.forEach((l,i)=>{if(i%2){c.fillStyle='#f7f9fb';c.fillRect(M,y,W-2*M,RH);}
      l.forEach((v,k)=>{if(!cols[k])return;const a=cols[k][2];c.textAlign=al(a);c.font=(k===0?'700 ':'500 ')+'19px '+F;c.fillStyle=(s.cores&&s.cores[i]&&s.cores[i][k])||'#11253d';
        let t=String(v??''),f=19;while(c.measureText(t).width>cols[k][1]-12&&f>11){f--;c.font=(k===0?'700 ':'500 ')+f+'px '+F;}c.fillText(t,px(k,a),y+RH/2);});
      y+=RH;c.fillStyle='#dde3ea';c.fillRect(M,y-1,W-2*M,1);});
    if(s.total){c.fillStyle=s.sub?'#4a7fbf':'#11253d';c.fillRect(M,y+6,W-2*M,44);c.font=`700 19px ${F}`;
      s.total.forEach((v,k)=>{if(v==null||v===''||!cols[k])return;c.textAlign=k===0?'left':al(cols[k][2]);c.fillStyle=s.sub?(/^(Carregado|Realizado)$/.test(cols[k][0])?'#eef7b0':'#ffffff'):(k===0?'#ffffff':'#c8dd1e');const tv=String(v);let f=19;c.font=`700 ${f}px ${F}`;if(k>0)while(c.measureText(tv).width>cols[k][1]-10&&f>10){f--;c.font=`700 ${f}px ${F}`;}c.fillText(tv,k===0?M+12:px(k,cols[k][2]),y+28);});y+=52;}  // total: diminui a letra até caber na coluna
    y+=24;});
  if(!tgFeito)desTG();
  return new Promise(ok=>cv.toBlob(ok,'image/png'));
}
const nomeArq=s=>s.replace(/[\\/:*?"<>|]/g,'-');
async function enviarImg(titulo,secoes,nome){if(!secoes.some(s=>s.linhas.length))return toast('Nada para mostrar');
  const pdf=window.__expPdf;window.__expPdf=false;
  try{const b=await gImagem(titulo,secoes);if(pdf)return await compartilharArquivo(await pngsParaPdf([b]),nomeArq(nome)+'.pdf','application/pdf');
    await compartilharArquivo(b,nomeArq(nome)+'.png','image/png');}catch(e){toast(pdf?'Não consegui gerar o PDF':'Não consegui gerar a imagem');}}
/* imagens (png) → um PDF, uma imagem por página */
async function pngsParaPdf(blobs){const cvs=[];for(const b of blobs){const im=await createImageBitmap(b),cv=document.createElement('canvas');cv.width=im.width;cv.height=im.height;const x=cv.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,cv.width,cv.height);x.drawImage(im,0,0);cvs.push(cv);}return fzPdf(cvs);}
window.pngsParaPdf=pngsParaPdf;
const kv=(cab,pares)=>({cab,cols:[['',360,'l'],['',300,'r']],linhas:pares.map(([a,b])=>[a,b])});
const corV='#5f7a00',corR='#b3261e';
function imgDia(){const dia=$('gDiaDia').value,ls=linhasDia(dia),ins={};let T={cab:0,mn:0,ms:0,c:0};
  const L=ls.map(({l,x})=>{somaInsumos(ins,x);const t=(ok(x.custoR)?x.custoR:0)+x.custoOp;T.cab+=x.cab;T.mn+=x.mn;T.ms+=ok(x.ms)?x.ms:0;T.c+=t;
    return [x.c,l.nome,nf(x.cab),nf(x.peso),nf(x.mn),nf(x.msCab,2),pc(x.pv,2),rs(t)];});
  const ie=Object.entries(ins).sort((a,b)=>b[1].kg-a[1].kg);
  enviarImg(`Relatório do dia · ${dB(dia)}`,[{cab:'Consumo e custo por lote',cols:[['Curral',110,'l'],['Lote',190,'l'],['Cab',70,'r'],['Peso',80,'r'],['MN kg',100,'r'],['MS/cab',90,'r'],['% IMS',85,'r'],['Custo',140,'r']],linhas:L,
    total:['TOTAL','',nf(T.cab),'',nf(T.mn),nf(T.cab?T.ms/T.cab:NaN,2),'',rs(T.c)]},
    ...(ie.length?[{cab:'Insumos usados no dia',cols:[['Insumo',420,'l'],['kg (MN)',220,'r'],['Custo',225,'r']],linhas:ie.map(([n,o])=>[n,nf(o.kg),rs(o.rs)]),total:['TOTAL',nf(ie.reduce((a,[,o])=>a+o.kg,0)),rs(ie.reduce((a,[,o])=>a+o.rs,0))]}]:[])],
    `Relatorio do dia ${dB(dia).replace(/\//g,'-')}`);}
function imgPer(){const ini=GT.ini,fim=GT.fim,D=periodoDados(ini,fim);let T={cd:0,mn:0,ms:0,c:0};
  const L=D.lotes.map(o=>{const t=o.cr+o.co+o.out;T.cd+=o.cabDias;T.mn+=o.mn;T.ms+=o.ms;T.c+=t;
    return [curralEm(o.l,fim),o.l.nome,nf(o.dias),nf(o.mn),nf(o.ms/o.cabDias,2),pc(o.pvN?o.pvS/o.pvN:NaN,2),rs(t),rs((o.cr+o.co)/o.cabDias)];});
  const ie=Object.entries(D.ins).sort((a,b)=>b[1].kg-a[1].kg);
  enviarImg(`Relatório de ${dB(ini)} a ${dB(fim)}`,[{cab:'Por lote',cols:[['Curral',110,'l'],['Lote',180,'l'],['Dias',65,'r'],['MN kg',105,'r'],['MS/cab/d',95,'r'],['% IMS',80,'r'],['Custo',140,'r'],['R$/cab/d',105,'r']],linhas:L,
    total:['TOTAL','','',nf(T.mn),nf(T.cd?T.ms/T.cd:NaN,2),'',rs(T.c),'']},
    ...(ie.length?[{cab:'Insumos usados no período',cols:[['Insumo',430,'l'],['kg (MN)',230,'r'],['Custo',220,'r']],linhas:ie.map(([n,o])=>[n,nf(o.kg),rs(o.rs)]),total:['TOTAL',nf(ie.reduce((a,[,o])=>a+o.kg,0)),rs(ie.reduce((a,[,o])=>a+o.rs,0))]}]:[])],
    `Relatorio ${dB(ini).replace(/\//g,'-')} a ${dB(fim).replace(/\//g,'-')}`);}
function imgComp(){const todosL=gTodos('lote').filter(l=>GT.compEnc?!ativo(l):true).sort(porCurral);const cores=[];
  const L=todosL.map(l=>{const C=calcLote(l),V=vendaEst(l,C);cores.push([null,null,null,null,null,null,null,ok(V.res)?(V.res>=0?corV:corR):null]);
    return [l.nome,C.fim?'Arquivado':curralEm(l,hojeKey()),nf(C.dias),nf(C.cabV?C.gmdV:l.gmd,2)+(C.cabV?'':' (meta)'),nf(C.msCab,2),rs(C.custo/C.cabE),ok(V.venda)?rs(V.venda/C.cabE):'—',ok(V.res)?rs(V.res/C.cabE)+(C.fim?'':' est.'):'—'];});
  enviarImg('Comparativo de lotes',[{cab:GT.compEnc?'Lotes arquivados':'Todos os lotes',cols:[['Lote',190,'l'],['Curral',130,'l'],['Dias',60,'r'],['GMD',110,'r'],['MS/cab',85,'r'],['Custo/cab',130,'r'],['Venda/cab',130,'r'],['Result./cab',150,'r']],linhas:L,cores}],'Comparativo de lotes');}
function imgLote(id){const l=G.it[id],C=calcLote(l),cabE=C.cabE;
  const sec=[kv('Lote',[['Lote',l.nome],['Período',`${dB(l.ent.dia)} a ${dB(C.ate)} (${nf(C.dias)} dias)`],['Situação',C.fim?'Encerrado':'Ativo'],...dadosLotePares(l,C)]),
    kv('Desempenho',[['MS por cab/dia',nf(C.msCab,2)+' kg'],['% do peso vivo',pc(C.pv,2)],['MN por cab/dia',nf(C.mnCab,2)+' kg'],[C.cabV?'GMD real':'GMD meta',nf(C.cabV?C.gmdV:l.gmd,2)+' kg/dia'],...(C.cabV?[['Conversão alimentar',nf(C.conv,2)],['Custo da @ produzida',rs(C.custoArr)]]:[])]),
    {cab:'Custos (cab/dia = ração + operacional)',cols:[['Custo',230,'l'],['Total',170,'r'],['Por cabeça',140,'r'],['Cab/dia',120,'r']],linhas:[['Compra',rs(C.compra),rs(C.compra/cabE),'—'],['Ração (tratos)',rs(C.alim),rs(C.alim/cabE),rs(C.alim/(C.R.cabDias||1))],['Operacional',rs(C.op),rs(C.op/cabE),rs(C.op/(C.R.cabDias||1))],...(C.outros?[['Sanidade e outros',rs(C.outros),rs(C.outros/cabE),'—']]:[])],total:['TOTAL',rs(C.custo),rs(C.custo/cabE),rs(C.custoCabDia)]}];
  if(!C.fim){const E=estVendaDet(l,C);if(E.pr>0){const s=kv('Estimativa de venda hoje',[['Peso projetado',nf(E.peso,1)+' kg'],['Rendimento · preço da @',`${nf(E.rc,1)}% · ${rs(E.pr)}`],['@ por cabeça',nf(E.arrCab,2)],['Venda estimada',rs(E.rec)],[E.res>=0?'RESULTADO ESTIMADO':'PREJUÍZO ESTIMADO',rs(E.res)],['Por cabeça',rs(E.resCab)],['Sobre o custo',pc(E.margem,1)],['Preço da @ para empatar',rs(E.pontoEq)]]);s.cores=s.linhas.map((x,i)=>[null,i>=4&&i<=6?(E.res>=0?corV:corR):null]);sec.push(s);}}
  if(C.cabV)sec.push(kv('Venda',[['Vendidos',`${nf(C.cabV)} cab · ${nf(C.pesoV)} kg`],['@ por cabeça',nf(C.arrV/C.cabV,2)],['Receita líquida',rs(C.receita)],['@ produzidas',nf(C.arrProd,2)]]));
  if(C.fim){const s=kv('Resultado',[[C.lucro>=0?'LUCRO':'PREJUÍZO',rs(C.lucro)],['Por cabeça',rs(C.lucro/cabE)],['Sobre o custo',pc(C.lucro/C.custo*100,1)]]);s.cores=s.linhas.map(()=>[null,C.lucro>=0?corV:corR]);sec.push(s);}
  enviarImg(`${C.fim?'Relatório final':'Resultado até hoje'} · ${l.nome}`,sec,`Lote ${l.nome} ${dB(C.ate).replace(/\//g,'-')}`);}
function xlsGraf(){const D=dadosGraf(GT.dia);const cab=['Curral'].concat(D.dias.map(d=>dB(d).slice(0,5)),['Média']);
  gExcel(`Leitura de cocho ate ${dB(GT.dia).replace(/\//g,'-')}`,[['Notas',cab,D.linhas.map(o=>{const ns=o.cel.filter(Boolean);return [xc(o.c)].concat(o.cel.map(x=>x?xc(x.nota,'int'):xc('')),[xc(ns.length?ns.reduce((a,x)=>a+x.nota,0)/ns.length:NaN,'dec')]);}),[16].concat(D.dias.map(()=>8),[9])],
    ['Kg do dia',cab.slice(0,-1),D.linhas.map(o=>[xc(o.c)].concat(o.cel.map(x=>x&&ok(x.novo)?xc(x.novo,'int'):xc('')))),[16].concat(D.dias.map(()=>9))]]);}

/* ---------- relatórios ---------- */
function tRels(){return `<div class="gGrade">
  <button class="gBig" data-g="ir" data-t="dia">📋<b>Do dia</b><small>consumo, custo e insumos por lote</small></button>
  <button class="gBig" data-g="ir" data-t="indices">📈<b>Índices do dia</b><small>MN, MS, % PV e custo por curral</small></button>
  <button class="gBig" data-g="ir" data-t="periodo">📆<b>Por período</b><small>semana, mês ou datas escolhidas</small></button>
  <button class="gBig" data-g="ir" data-t="comp">📊<b>Comparativo de lotes</b><small>desempenho e resultado lado a lado</small></button></div>
  <p class="note">O relatório de um lote fica dentro do lote: Lotes → escolha o lote → Resultado.</p>`;}
function linhasDia(dia){const X=gCtx();return X.L.map(l=>({l,x:diaLote(l,dia,X)})).filter(o=>o.x).sort((a,b)=>porCurral(a.l,b.l));}
function tDia(t){
  const dia=t.dia||hojeKey(),ls=linhasDia(dia),T={cab:0,mn:0,ms:0,cr:0,co:0,pvP:0},ins={};
  const rows=ls.map(({l,x})=>{T.cab+=x.cab;T.mn+=x.mn;if(ok(x.ms))T.ms+=x.ms;if(ok(x.custoR))T.cr+=x.custoR;T.co+=x.custoOp;T.pvP+=x.cab*x.peso;somaInsumos(ins,x);
    const tot=(ok(x.custoR)?x.custoR:0)+x.custoOp;const lt=G.it[idLeit(dia,x.c)];
    return cartaoLote(l,x.c,`${esc(x.rac)}${lt&&!lt.del?' · nota de cocho '+notaTxt(lt.nota):''}`,[[nf(x.cab),'cab'],[nf(x.peso),'kg proj.'],[nf(x.mn),'kg MN'],[nf(x.msCab,2),'MS/cab'],[pc(x.pv,2),'% IMS'],[rs(tot/x.cab),'custo/cab']]);}).join('');
  const tot=T.cr+T.co;
  return `${voltar('Relatórios')}<section class="panel"><h2>Relatório do dia</h2>
    ${navData('gDiaDia',dia,'Data')}
    <div class="stat gStat3">${st('Cabeças',nf(T.cab))}${st('MN total',nf(T.mn)+' kg')}${st('MS/cab',nf(T.cab?T.ms/T.cab:NaN,2)+' kg')}
      ${st('% peso vivo',pc(T.pvP?T.ms/T.pvP*100:NaN,2))}${st('Custo total',rs(tot))}${st('Custo/cab',rs(T.cab?tot/T.cab:NaN))}</div>
    <p class="note">Ração ${rs(T.cr)} + operacional ${rs(T.co)}.</p>
    ${rows||'<p class="note">Nenhum lote nesta data.</p>'}
    <p class="note">Peso = projetado pela última pesagem e a meta de ganho. MN = trato realizado no curral (dividido por cabeça se houver mais de um lote).</p>
    ${rows?'<div class="row compart"><button class="verde" data-g="imgDia">🖼 Foto</button><button class="verde" data-g="xlsDia">📊 Excel</button></div>':''}</section>
  ${Object.keys(ins).length?card('Insumos usados no dia',tabInsumos(ins)+'<p class="note">Calculado pelo trato realizado em cada curral × fórmula da ração do dia.</p>'):''}
  ${batidasDiaCard(dia)}`;
}
/* batidas (carregamentos do vagão) do dia: previsto × carregado de cada uma; o realizado é o que sai do estoque */
function batidasDiaCard(dia){const B=gTodos('carga').filter(c=>c.dia===dia).sort((a,b)=>(a.ts0||0)-(b.ts0||0));if(!B.length)return '';
  const kg=(c,k)=>(c.itens||[]).reduce((a,x)=>a+(k==='real'?(ok(+x.real)&&x.real!==null?+x.real:0):(+x.prev||0)),0);
  const rows=B.map(c=>{const p=kg(c,'prev'),r=kg(c,'real');return `<tr><td class="hora">${esc(c.hora||'')}</td><td class="c">${c.avulso?'Avulsa':'Trato '+esc((c.tratos||[c.trato]).join('+'))}<small>${esc(c.racNome||'')}</small></td><td>${nf(p)}</td><td><b>${r?nf(r):'—'}</b></td><td class="${r?classeDesv(r-p,p):''}">${r?sgn(r-p):''}</td></tr>`;}).join('');
  const tp=B.reduce((a,c)=>a+kg(c,'prev'),0),tr=B.reduce((a,c)=>a+kg(c,'real'),0);
  return card('Batidas do dia',`<div class="tablebox"><table class="gTab"><thead><tr><th>Hora</th><th>Batida</th><th>Previsto</th><th>Carregado</th><th>Dif.</th></tr></thead><tbody>${rows}<tr class="grp"><td></td><td>Total · ${B.length} batida(s)</td><td>${nf(tp)}</td><td>${nf(tr)}</td><td>${tr?sgn(tr-tp):''}</td></tr></tbody></table></div>
    <p class="note">Carregado = soma do realizado de cada produto na batida. É o que sai do Estoque.</p>`);}
function textoDia(){const dia=$('gDiaDia').value,ls=linhasDia(dia);
  let cab=0,mn=0,ms=0,c=0;const linhas=ls.map(({l,x})=>{cab+=x.cab;mn+=x.mn;ms+=ok(x.ms)?x.ms:0;const t=(ok(x.custoR)?x.custoR:0)+x.custoOp;c+=t;
    return `*${x.c}* · ${l.nome} · ${nf(x.cab)} cab · ${nf(x.peso)} kg\n  MN ${nf(x.mn)} kg (${nf(x.mnCab,1)}/cab) · MS ${nf(x.msCab,2)} kg/cab · IMS ${pc(x.pv,2)}\n  Custo ${rs(t)} (${rs(t/x.cab)}/cab)`;});
  return `*Relatório do dia ${dB(dia)}*\n\n${linhas.join('\n\n')}\n\n*Total:* ${nf(cab)} cab · MN ${nf(mn)} kg · MS ${nf(ms)} kg · ${rs(c)}`;}
function xlsDia(){const dia=$('gDiaDia').value,ls=linhasDia(dia),ins={};
  const r=ls.map(({l,x})=>{somaInsumos(ins,x);const t=(ok(x.custoR)?x.custoR:0)+x.custoOp;
    return [xc(dia,'dia'),xc(x.c),xc(l.nome),xc(x.rac),xc(x.cab,'int'),xc(x.peso,'int'),xc(x.mn,'int'),xc(x.ms,'int'),xc(x.mnCab,'dec'),xc(x.msCab,'dec'),xc(x.pv/100,'pct'),xc(x.custoR,'rs'),xc(x.custoOp,'rs'),xc(t,'rs'),xc(t/x.cab,'rs')];});
  gExcel(`Relatório do dia - ${dB(dia).replace(/\//g,'-')}`,[['Por lote',['Data','Curral','Lote','Ração','Cabeças','Peso proj. (kg)','MN (kg)','MS (kg)','MN/cab','MS/cab','% IMS','Custo ração','Custo operacional','Custo total','Custo/cab'],r,[11,10,18,14,9,10,10,10,9,9,8,13,13,13,11]],
    ['Insumos',['Insumo','kg (MN)','Custo'],Object.entries(ins).map(([n,o])=>[xc(n),xc(o.kg,'int'),xc(o.rs,'rs')]),[22,12,14]]]);}

function periodoDados(ini,fim){
  const X=gCtx(),por=new Map(),diario=[],ins={};
  for(let d=ini,i=0;d<=fim&&i<1500;d=somaDias(d,1),i++){X.L.forEach(l=>{const x=diaLote(l,d,X);if(!x)return;
    let o=por.get(l.uid);if(!o){o={l,cabDias:0,mn:0,ms:0,cr:0,co:0,pvS:0,pvN:0,dias:0,cab:0};por.set(l.uid,o);}
    o.dias++;o.cabDias+=x.cab;o.mn+=x.mn;if(ok(x.ms))o.ms+=x.ms;if(ok(x.custoR))o.cr+=x.custoR;o.co+=x.custoOp;if(ok(x.pv)&&x.mn>0){o.pvS+=x.pv;o.pvN++;}o.cab=x.cab;
    somaInsumos(ins,x);diario.push({d,l,x});});}
  por.forEach(o=>{o.out=custosDe(o.l).filter(c=>c.dia>=ini&&c.dia<=fim).reduce((a,c)=>a+(+c.rs||0),0);});
  return {lotes:[...por.values()].sort((a,b)=>porCurral(a.l,b.l)),diario,ins};
}
function tPeriodo(t){
  const hj=hojeKey(),fim=t.fim||hj,ini=t.ini||somaDias(fim,-6);GT.ini=ini;GT.fim=fim;
  const D=periodoDados(ini,fim),T={cd:0,mn:0,ms:0,cr:0,co:0,out:0};
  const rows=D.lotes.map(o=>{T.cd+=o.cabDias;T.mn+=o.mn;T.ms+=o.ms;T.cr+=o.cr;T.co+=o.co;T.out+=o.out;const tot=o.cr+o.co+o.out;
    return cartaoLote(o.l,curralEm(o.l,fim),`${nf(o.dias)} dias no período · ${nf(o.cabDias/o.dias)} cab em média`,[[nf(o.mn),'kg MN'],[nf(o.ms/o.cabDias,2),'MS/cab/dia'],[pc(o.pvN?o.pvS/o.pvN:NaN,2),'% IMS'],[rs(tot),'custo total'],[rs((o.cr+o.co)/o.cabDias),'R$/cab/dia'],[rs(o.out),'sanidade']]);}).join('');
  const tot=T.cr+T.co+T.out;
  const atalho=(n,r)=>`<button class="mini" data-g="perAtalho" data-n="${n}">${r}</button>`;
  return `${voltar('Relatórios')}<section class="panel"><h2>Relatório por período</h2>
    <div class="gForm"><div class="gCampo"><label for="gPerIni">De</label><input type="date" id="gPerIni" value="${ini}"></div><div class="gCampo"><label for="gPerFim">Até</label><input type="date" id="gPerFim" value="${fim}"></div></div>
    <div class="row">${atalho(7,'7 dias')}${atalho(15,'15 dias')}${atalho(30,'30 dias')}${atalho('mes','Este mês')}</div>
    <div class="stat gStat3">${st('Cab-dia',nf(T.cd))}${st('MN total',nf(T.mn)+' kg')}${st('MS/cab/dia',nf(T.cd?T.ms/T.cd:NaN,2)+' kg')}
      ${st('Custo total',rs(tot))}${st('R$/cab/dia',rs(T.cd?(T.cr+T.co)/T.cd:NaN))}${st('Sanidade',rs(T.out))}</div>
    <p class="note">Ração ${rs(T.cr)} + operacional ${rs(T.co)}${T.out?` + sanidade ${rs(T.out)}`:''}.</p>
    ${rows||'<p class="note">Nada nesse período.</p>'}
    ${rows?'<div class="row compart"><button class="verde" data-g="imgPer">🖼 Foto</button><button class="verde" data-g="xlsPer">📊 Excel</button></div>':''}</section>
  ${Object.keys(D.ins).length?card('Insumos usados no período',tabInsumos(D.ins)):''}`;
}
function xlsPer(){const ini=GT.ini,fim=GT.fim,D=periodoDados(ini,fim);
  const r1=D.lotes.map(o=>[xc(curralEm(o.l,fim)),xc(o.l.nome),xc(o.dias,'int'),xc(o.cabDias,'int'),xc(o.mn,'int'),xc(o.ms,'int'),xc(o.mn/o.cabDias,'dec'),xc(o.ms/o.cabDias,'dec'),xc(o.pvN?o.pvS/o.pvN/100:NaN,'pct'),xc(o.cr,'rs'),xc(o.co,'rs'),xc(o.out,'rs'),xc(o.cr+o.co+o.out,'rs'),xc((o.cr+o.co)/o.cabDias,'rs')]);
  const r2=D.diario.map(({d,l,x})=>[xc(d,'dia'),xc(x.c),xc(l.nome),xc(x.rac),xc(x.cab,'int'),xc(x.peso,'int'),xc(x.mn,'int'),xc(x.ms,'int'),xc(x.msCab,'dec'),xc(x.pv/100,'pct'),xc(x.custoR,'rs'),xc(x.custoOp,'rs')]);
  gExcel(`Relatório ${dB(ini).replace(/\//g,'-')} a ${dB(fim).replace(/\//g,'-')}`,[
    ['Por lote',['Curral','Lote','Dias','Cab-dia','MN (kg)','MS (kg)','MN/cab/dia','MS/cab/dia','% IMS médio','Custo ração','Custo operacional','Sanidade/outros','Custo total','Ração+oper./cab/dia'],r1,[10,18,7,9,11,11,10,10,9,13,13,13,13,12]],
    ['Por dia',['Data','Curral','Lote','Ração','Cabeças','Peso proj.','MN (kg)','MS (kg)','MS/cab','% IMS','Custo ração','Custo operacional'],r2,[11,10,18,14,9,10,10,10,9,8,13,13]],
    ['Insumos',['Insumo','kg (MN)','Custo'],Object.entries(D.ins).map(([n,o])=>[xc(n),xc(o.kg,'int'),xc(o.rs,'rs')]),[22,12,14]]]);}

function tComp(t){
  const todosL=gTodos('lote').filter(l=>t.enc?!ativo(l):true).sort(porCurral);
  const Cs=todosL.map(l=>({l,C:calcLote(l)}));GT.compEnc=!!t.enc;
  const rows=Cs.map(({l,C})=>cartaoLote(l,curralEm(l,C.ate),`${C.fim?'Arquivado em '+dB(C.fim):'Ativo'} · ${nf(C.dias)} dias${[sexoTxt(l.sexo),l.raca].filter(Boolean).length?' · '+esc([sexoTxt(l.sexo),l.raca].filter(Boolean).join(' · ')):''}`,
    [[nf(C.cabV?C.gmdV:l.gmd,2),C.cabV?'GMD real':'GMD meta'],[nf(C.msCab,2),'MS/cab/dia'],[pc(C.pv,2),'% IMS'],[ok(C.conv)?nf(C.conv,2):'—','conversão'],[ok(C.custoArr)?rs(C.custoArr):'—','R$/@ prod.'],(()=>{const V=vendaEst(l,C);return [ok(V.res)?rs(V.res/C.cabE):'—',C.fim?'lucro/cab':'result./cab (est.)',ok(V.res)?(V.res>=0?'ok':'bad'):''];})()])).join('');
  return `${voltar('Relatórios')}<section class="panel"><h2>Comparativo de lotes</h2>
    <div class="row"><button class="mini${t.enc?'':' sel'}" data-g="ir" data-t="comp">Todos</button><button class="mini${t.enc?' sel':''}" data-g="ir" data-t="comp" data-enc="1">Só arquivados</button></div>
    ${rows||'<p class="note">Nenhum lote.</p>'}
    <p class="note">Conversão e custo da @ produzida aparecem depois das vendas. Lote arquivado: lucro real. Lote ativo: resultado estimado (peso projetado × rendimento × preço da @ do lote − custo); fica — se o lote não tem preço da @ de venda.</p>
    ${rows?'<div class="row compart"><button class="verde" data-g="imgComp">🖼 Foto</button><button class="verde" data-g="xlsComp">📊 Excel</button></div>':''}</section>`;
}
function xlsComp(){const todosL=gTodos('lote').filter(l=>GT.compEnc?!ativo(l):true).sort(porCurral);
  const r=todosL.map(l=>{const C=calcLote(l),e=l.ent;return [xc(l.nome),xc(C.fim?'Arquivado':'Ativo'),xc(curralEm(l,C.ate)),xc(sexoTxt(l.sexo)),xc(l.raca||''),xc(e.dia,'dia'),xc(C.fim||'','dia'),xc(C.dias,'int'),xc(C.cabE,'int'),xc(C.cabV,'int'),xc(C.mortes,'int'),
    xc(C.pesoE,'int'),xc(C.pesoV,'int'),xc(C.gmdV,'dec'),xc(l.gmd,'dec'),xc(C.msCab,'dec'),xc(C.pv/100,'pct'),xc(C.conv,'dec'),xc(C.compra,'rs'),xc(C.alim,'rs'),xc(C.op,'rs'),xc(C.outros,'rs'),xc(C.custo,'rs'),xc(C.receita,'rs'),xc(C.arrProd,'dec'),xc(C.custoArr,'rs'),xc(C.lucro,'rs'),xc(C.lucro/C.cabE,'rs'),...(()=>{const E=C.fim?null:estVendaDet(l,C);return E&&E.pr>0?[xc(E.pr,'rs'),xc(E.rc/100,'pct'),xc(E.rec,'rs'),xc(E.res,'rs'),xc(E.resCab,'rs'),xc(E.pontoEq,'rs')]:[xc(''),xc(''),xc(''),xc(''),xc(''),xc('')];})(),xc(C.compra/C.cabE,'rs'),xc((C.alim+C.op)/C.cabE,'rs'),xc(C.custoCabDia,'rs')];});
  gExcel('Comparativo de lotes',[['Lotes',['Lote','Situação','Curral','Sexo','Raça','Entrada','Saída','Dias','Cab. entrada','Cab. vendidas','Mortes','Peso entrada','Peso saída','GMD real','GMD meta','MS/cab/dia','% IMS','Conversão','Compra','Ração','Operacional','Sanidade/outros','Custo total','Receita','@ produzidas','Custo @ produzida','Lucro','Lucro/cab','Preço @ venda (est.)','Rendimento venda','Venda estimada','Resultado estimado','Resultado est./cab','Preço @ p/ empatar','R$/cab compra','R$/cab tratos','R$/cab/dia'],r]]);}
function xlsLote(id){const l=G.it[id],C=calcLote(l),X=gCtx(),r=[];
  for(let d=l.ent.dia,i=0;d<=C.ate&&i<4000;d=somaDias(d,1),i++){const x=diaLote(l,d,X);if(!x)continue;const lt=G.it[idLeit(d,x.c)];
    r.push([xc(d,'dia'),xc(x.c),xc(x.rac),xc(x.cab,'int'),xc(x.peso,'int'),xc(x.mn,'int'),xc(x.ms,'int'),xc(x.mnCab,'dec'),xc(x.msCab,'dec'),xc(x.pv/100,'pct'),xc(lt&&!lt.del?lt.nota:''),xc(x.custoR,'rs'),xc(x.custoOp,'rs')]);}
  const res=(GT.relRes||[]).map(([a,b])=>[xc(a),xc(b)]);
  gExcel(`Lote ${l.nome}`,[['Resumo',['Item','Valor'],res,[36,40]],['Dia a dia',['Data','Curral','Ração','Cabeças','Peso proj.','MN (kg)','MS (kg)','MN/cab','MS/cab','% IMS','Nota cocho','Custo ração','Custo operacional'],r,[11,10,14,9,10,10,10,9,9,8,9,13,13]]]);}

/* ---------- rações ---------- */
function tRacoes(){
  const hj=hojeKey(),Rt=gTodos('racao').sort(porNome),R=Rt.filter(r=>!r.inativa),Ri=Rt.filter(r=>r.inativa);
  const card=r=>{const cp=compRacao(r,hj);const usam=lotesAtivos().filter(l=>{const x=racaoEm(l,hj);return x&&x.uid===r.uid;}).length;
    return `<button class="gItem gRacItem${r.inativa?' gInativa':''}" data-g="ir" data-t="racForm" data-id="${r.uid}"><div class="gItemTopo"><b>${esc(r.nome)}</b><span class="pill${usam?' done':''}">${r.inativa?'inativa':usam?usam+' lote(s)':'sem lote'}</span></div>
      ${cp?`<div class="gMini3"><div><small>MS</small><b>${pc(cp.ms)}</b></div><div><small>R$/kg MN</small><b>${rs(cp.custoMN,3)}</b></div><div><small>R$/kg MS</small><b>${rs(cp.custoMS,3)}</b></div></div>
      <div class="gComp"><div class="gCompCab"><span>Insumo</span><span>% MS</span><span>% MN</span></div>${cp.itens.map(i=>`<div><span>${esc(i.nome)}<i style="width:${Math.max(2,Math.min(100,i.pMN||0)).toFixed(1)}%"></i></span><b>${nf(i.pMS,1)}</b><b>${nf(i.pMN,1)}</b></div>`).join('')}</div>`:'<p class="note">sem fórmula</p>'}</button>`;};
  const cards=R.map(card).join('');
  return `<section class="panel"><div class="curhead gLotesTopo"><h2>Rações ativas</h2><span class="gLotesBts"><button type="button" class="mini lima" data-g="ir" data-t="racForm">+ Nova ração</button></span></div>${cards||'<p class="note">Nenhuma ração ativa. Cadastre os insumos primeiro e depois a ração.</p>'}</section>
    ${Ri.length?`<section class="panel"><h2>Rações inativas</h2><p class="note">Não aparecem no Carregar, no Fornecer nem nos lotes. Os registros antigos continuam.</p>${Ri.map(card).join('')}</section>`:''}`;
}
function tRacForm(t){
  const r=t.id?G.it[t.id]:null,hj=hojeKey(),v=r?vig(r.versoes,hj):null;
  if(!GT.itens)GT.itens=v?v.itens.map(i=>({ins:i.ins,pMS:i.pMS})):[{ins:'',pMS:''}];
  const ops=opInsumos();
  if(!ops.length)return `${voltar()}<section class="panel"><h2>Nova ração</h2><p class="note">Cadastre os insumos primeiro (silagem, DDG, núcleo…).</p><button class="lima" data-g="ir" data-t="insForm">+ Novo insumo</button></section>`;
  const linhas=GT.itens.map((i,k)=>`<div class="gRacLin"><select data-ri="${k}"><option value="">— insumo —</option>${ops.map(([a,b])=>`<option value="${a}"${a===i.ins?' selected':''}>${esc(b)}</option>`).join('')}</select>
    <input class="cell num" inputmode="decimal" data-rp="${k}" value="${esc(vIn(gNum(i.pMS)))}" placeholder="% MS"><button class="mini danger" data-g="racRm" data-i="${k}">✕</button></div>`).join('');
  const vers=r?(r.versoes||[]).slice().sort((a,b)=>a.desde<b.desde?1:-1).map(x=>`<div class="gVers"><b>${x.desde<='2000-01-01'?'Fórmula inicial':'Desde '+dB(x.desde)}</b><span>${x.itens.map(i=>{const n=G.it[i.ins];return `${esc(n?n.nome:'?')} ${nf(+i.pMS,1)}%`;}).join(' · ')}</span></div>`).join(''):'';
  return `${voltar()}<section class="panel"><h2>${r?'Ração':'Nova ração'}</h2>
    <div class="gForm">${campo({k:'nome',l:'Nome da ração',v:GT.nome!=null?GT.nome:(r?r.nome:''),ph:'Ex.: Terminação'})}${campo({k:'desde',l:'Fórmula vale a partir de',t:'dia',v:GT.desde||(r?hj:'2000-01-01'),ajuda:r?'Mudou a fórmula? Os dias antes dessa data continuam com a fórmula antiga.':''})}</div>
    <label>Insumos da fórmula</label><div class="gRacLin gRacCab"><span>Insumo</span><span>% na MS</span><span></span></div>${linhas}
    <button data-g="racAdd">+ Adicionar insumo</button>
    <div id="gRacCalc"></div>
    <button class="primary" data-g="salvaRac" data-id="${t.id||''}">Salvar ração</button></section>
    <section class="panel"><h2>Receita do vagão</h2><div class="gCampo"><label for="gVag">Total a misturar (kg de matéria natural)</label><input id="gVag" type="text" class="num" inputmode="decimal" value="${GT.vag||1000}"></div><div id="gVagRes"></div></section>
    ${r?`<section class="panel"><h2>Situação</h2><p class="note">${r.inativa?'<b>Inativa</b>: não aparece no Carregar, no Fornecer nem nos lotes. Os registros antigos continuam.':'<b>Ativa</b>: aparece no Carregar, no Fornecer e nos lotes.'}</p>
      <button class="${r.inativa?'lima':'danger'}" data-g="racAtiva" data-id="${r.uid}">${r.inativa?'✓ Reativar ração':'⏸ Inativar ração (não vai usar mais)'}</button></section>
    <section class="panel"><h2>Histórico da fórmula</h2>${vers}<button class="dangerfill" data-g="apagaRac" data-id="${r.uid}">Apagar ração</button></section>`:''}`;
}
function lerItensRac(){if($('gf_nome'))GT.nome=$('gf_nome').value;if($('gf_desde'))GT.desde=$('gf_desde').value;document.querySelectorAll('#gBox [data-ri]').forEach(s=>{const k=+s.dataset.ri;if(GT.itens[k])GT.itens[k].ins=s.value;});
  document.querySelectorAll('#gBox [data-rp]').forEach(s=>{const k=+s.dataset.rp;if(GT.itens[k])GT.itens[k].pMS=s.value;});}
function calcRacao(){
  const box=$('gRacCalc');if(!box)return;lerItensRac();const hj=hojeKey();
  const its=GT.itens.filter(i=>i.ins&&gNum(i.pMS)>0).map(i=>({ins:i.ins,pMS:gNum(i.pMS)}));
  const cp=its.length?compRacao({versoes:[{desde:'2000-01-01',itens:its}]},hj):null;
  if(!cp){box.innerHTML='<p class="note">Escolha os insumos e a % de cada um na matéria seca (soma 100%).</p>';$('gVagRes').innerHTML='';return;}
  const soma=cp.somaMS,okS=Math.abs(soma-100)<0.05;
  box.innerHTML=`<div class="tablebox"><table class="gTab gRacTab"><thead><tr><th>Insumo</th><th>% MS</th><th>% MN</th></tr></thead><tbody>
    ${cp.itens.map(i=>`<tr><td class="c">${esc(i.nome)}<small>MS ${pc(i.ms,1)} · ${rs(i.preco)}/t</small></td><td>${nf(i.pMS,1)}</td><td>${nf(i.pMN,1)}</td></tr>`).join('')}
    <tr class="grp"><td>Total</td><td class="${okS?'ok':'bad'}">${nf(soma,1)}</td><td>100,0</td></tr></tbody></table></div>
    ${okS?'':`<p class="aviso bad">A soma na matéria seca está em ${nf(soma,1)}%. Precisa dar 100%.</p>`}
    <div class="stat gStat2">${st('MS da ração',pc(cp.ms))}${st('Custo por kg MN',rs(cp.custoMN,3))}${st('Custo por kg MS',rs(cp.custoMS,3))}${st('Custo por tonelada MN',rs(cp.custoMN*1000))}</div>`;
  const tot=gNum(($('gVag')||{}).value);GT.vag=($('gVag')||{}).value;
  $('gVagRes').innerHTML=tot>0?`<div class="tablebox"><table class="gTab"><thead><tr><th>Insumo</th><th>% MN</th><th>kg no vagão</th></tr></thead><tbody>${cp.itens.map(i=>`<tr><td class="c">${esc(i.nome)}</td><td>${nf(i.pMN,1)}</td><td><b>${nf(tot*i.pMN/100)}</b></td></tr>`).join('')}
    <tr class="grp"><td>Total</td><td>100,0</td><td>${nf(tot)}</td></tr></tbody></table></div><div class="stat">${st('Custo desta mistura',rs(tot*cp.custoMN))}${st('Matéria seca',nf(tot*cp.ms/100)+' kg')}</div>`:'';
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
  const rows=I.map(i=>{const p=precoIns(i,hj),e=estoqueIns(i);return `<tr data-g="ir" data-t="insForm" data-id="${i.uid}" class="gClic"><td class="c">${esc(i.nome)}<small>${e.saldo==null?'estoque: sem lançamento':'estoque: '+nf(e.saldo)+' kg'}</small>${i.obs?`<small>📝 ${esc(i.obs)}</small>`:''}</td><td>${pc(+i.ms,1)}</td><td>${rs(p)}<small>${rs(p/1000/(i.ms/100),3)}/kg MS</small></td></tr>`;}).join('');
  return `<section class="panel"><div class="curhead gLotesTopo"><h2>Insumos <span class="note">${I.length}</span></h2>
      <span class="gLotesBts"><button type="button" class="mini lima" data-g="ir" data-t="insForm">+ Novo insumo</button><button type="button" class="mini" data-g="ir" data-t="insMS">💧 Matéria seca</button></span></div>
    ${I.length?`<div class="row compart fz3 lotesExp"><button class="verde" data-g="insPdf">📄 PDF</button><button class="verde" data-g="insImg">🖼 Foto</button><button class="verde" data-g="insXls">📊 Excel</button></div>`:''}
    <div class="tablebox"><table class="gTab"><thead><tr><th>Insumo</th><th>MS</th><th>Preço por tonelada</th></tr></thead><tbody>${rows||'<tr><td colspan="3">Nenhum insumo ainda.</td></tr>'}</tbody></table></div>
    <p class="note">Preço por tonelada como comprado (matéria natural). Toque no insumo para mudar o preço.</p></section>`;
}
/* exportar a lista de insumos (PDF, foto ou Excel) */
function insLinhas(){const hj=hojeKey();return gTodos('insumo').sort(porNome).map(i=>{const p=precoIns(i,hj),e=estoqueIns(i);return {nome:i.nome,ms:+i.ms,p,pms:ok(p)&&+i.ms>0?p/1000/(i.ms/100):NaN,est:e.saldo,obs:i.obs||''};});}
function insExp(tipo){const L=insLinhas();if(!L.length)return toast('Nenhum insumo');const d=dB(hojeKey()),nome=`Insumos ${d.replace(/\//g,'-')}`;
  if(tipo==='xls')return gExcel(nome,[['Insumos',['Insumo','MS (%)','Preço por tonelada (R$)','R$/kg de MS','Estoque (kg)','Observação'],L.map(x=>[xc(x.nome),xc(x.ms,'dec'),xc(x.p,'rs'),xc(x.pms,'rs'),xc(x.est,'int'),xc(x.obs)]),[26,9,18,13,13,40]]]);
  const temObs=L.some(x=>x.obs);
  window.__expPdf=tipo==='pdf';
  return enviarImg(`FJK - Insumos - ${d}`,[{cab:`Insumos · ${L.length}`,cols:[['Insumo',300,'l'],['MS',100,'c'],['Preço por tonelada',200,'r'],['R$/kg de MS',160,'r'],['Estoque',160,'r']].concat(temObs?[['Observação',380,'l']]:[]),
    linhas:L.map(x=>[x.nome,pc(x.ms,1),rs(x.p),ok(x.pms)?rs(x.pms,3):'—',x.est==null?'—':nf(x.est)+' kg'].concat(temObs?[x.obs||'—']:[]))}],nome);}
function msHistTodos(){const L=[];gTodos('insumo').forEach(i=>{const h=Array.isArray(i.msHist)?i.msHist:[];
    const hh=h.length?h:(i.msDia&&i.msAnt!=null?[{dia:i.msDia,ts:0,de:+i.msAnt,para:+i.ms}]:[]);hh.forEach(x=>L.push({nome:i.nome,uid:i.uid,...x}));
    const pri=hh.slice().sort((a,b)=>(a.dia||'').localeCompare(b.dia||'')||(a.ts||0)-(b.ts||0))[0];
    L.push({nome:i.nome,uid:i.uid,dia:'2026-01-01',ts:-1,de:null,para:pri?+pri.de:+i.ms,ini:true});});
  return L.sort((a,b)=>(b.dia||'').localeCompare(a.dia||'')||(b.ts||0)-(a.ts||0));}
/* quando pode alterar a MS: com trato do dia em andamento NÃO; terminou todos os tratos do dia → vale de amanhã; ainda não tratou hoje → vale de hoje */
function msStatus(){const hj=hojeKey(),H=typeof HIST!=='undefined'?HIST:[],P=(typeof S!=='undefined'&&S&&S.prev)||{};
  const feitoHoje=H.filter(r=>r.dia===hj);
  /* conta trato por trato só os currais que estão naquele trato (mesma regra do Fornecer) */
  const ks=(typeof tratosAtivos==='function'?tratosAtivos():[1,2]).map(Number),ativo=c=>typeof curralAtivo!=='function'||curralAtivo(c);
  const porT=ks.map(k=>{const m=P[String(k)]||{};const cs=(S.cadastro||[]).filter(c=>ativo(c)&&typeof m[c]==='number'&&m[c]>0);
    const falta=cs.filter(c=>!feitoHoje.some(r=>+r.trato===k&&r.curral===c)).length;return {k,tot:cs.length,falta};}).filter(x=>x.tot);
  const pend=porT.reduce((a,x)=>a+x.falta,0);
  if(feitoHoje.length&&pend)return {bloq:true,pend,porT};
  const dia=feitoHoje.length?somaDias(hj,1):hj,leit=gTodos('leitura').some(l=>l.dia===dia);return {bloq:false,dia,leit,amanha:dia!==hj};}
function msAvisoHTML(){const m=msStatus();
  if(m.bloq)return `<div class="gMsAviso bloq">⛔ Existem currais pendentes para finalizar o trato do dia:<br>${m.porT.filter(x=>x.falta).map(x=>`<b>Trato ${x.k}</b>: faltam ${x.falta} de ${x.tot} curral(is)`).join(' · ')}.<br>A matéria seca só pode ser alterada após a finalização de todos os tratos do dia (e antes da leitura do dia seguinte).</div>`;
  return `<div class="gMsAviso${m.leit?' atencao':''}">${m.amanha?'✓ Tratos de hoje finalizados. ':''}A nova MS vale a partir de <b>${dB(m.dia)}</b>${m.amanha?' (amanhã)':' (hoje)'}: leitura, previsto, rações e batidas desse dia em diante. Os dias anteriores ficam como estão.${m.leit?`<br>⚠ A leitura de ${dB(m.dia)} já foi feita com a MS antiga: depois de alterar, refaça a leitura para recalcular o previsto.`:''}</div>`;}
function tInsMS(t){const I=gTodos('insumo').sort(porNome),H=msHistTodos(),sel=(t&&t.ins)||'',iS=sel&&G.it[sel];
  const linhas=H.map(x=>`<tr data-msh="${esc(x.uid||'')}"${sel&&x.uid!==sel?' hidden':''}><td>${dB(x.dia)}${x.hora?`<small>${esc(x.hora)}</small>`:''}</td><td class="c">${esc(x.nome)}</td><td>${x.ini?'inicial':pc(+x.de,1)}</td><td><b>${pc(+x.para,1)}</b></td></tr>`).join('');
  return `${t&&t.t==='ms'?'':voltar()}<section class="panel"><h2>💧 Alterar matéria seca</h2>
    <p class="note">Escolha o produto e digite a nova % de MS.</p>
    <label>Produto<select id="gMsIns" onchange="msFiltrar(this.value)">
      <option value=""${sel?'':' selected'} disabled>Escolha o produto</option>${I.map(i=>`<option value="${i.uid}"${i.uid===sel?' selected':''} data-ms="${nf(+i.ms,1)}">${esc(i.nome)}</option>`).join('')}</select></label>
    <div class="gMsLinha"><div><span>MS atual</span><b id="gMsAtual">${iS?pc(+iS.ms,1):'—'}</b></div>
      <label>Nova MS (%)<input type="text" inputmode="decimal" id="gMsNova" placeholder="ex.: 35,5"></label></div>
    ${msAvisoHTML()}
    <button class="primary" data-g="salvaMS"${msStatus().bloq?' disabled':''}>Alterar matéria seca</button></section>
    <section class="panel"><h2 id="gMsHTit">${iS?'Últimas alterações · '+esc(iS.nome):'Últimas alterações'}</h2>
    <div class="tablebox"${H.length?'':' hidden'}><table class="gTab"><thead><tr><th>Vale de</th><th>Produto</th><th>De</th><th>Para</th></tr></thead><tbody>${linhas}</tbody></table></div>
    <p class="note" id="gMsVazio"${H.some(x=>!sel||x.uid===sel)?' hidden':''}>Nenhuma alteração de matéria seca${iS?' desse produto':''} ainda.</p></section>`;}
/* escolheu o produto: mostra a MS atual e só as alterações dele */
window.msFiltrar=uid=>{const i=G.it[uid];if(GT&&(GT.t==='ms'||GT.t==='insMS'))GT.ins=uid;
  const a=document.getElementById('gMsAtual');if(a)a.textContent=i?pc(+i.ms,1):'—';
  const t=document.getElementById('gMsHTit');if(t)t.textContent='Últimas alterações'+(i?' · '+i.nome:'');let n=0;
  document.querySelectorAll('#gBox tr[data-msh]').forEach(r=>{const v=!uid||r.dataset.msh===uid;r.hidden=!v;if(v)n++;});
  const tb=document.querySelector('#gBox tr[data-msh]');if(tb)tb.closest('.tablebox').hidden=!n;
  const z=document.getElementById('gMsVazio');if(z){z.hidden=!!n;z.textContent='Nenhuma alteração de matéria seca'+(i?' desse produto':'')+' ainda.';}
  const nv=document.getElementById('gMsNova');if(nv){nv.value='';nv.focus();}};
function salvaMS(){const st_=msStatus();if(st_.bloq)return toast('Termine todos os tratos de hoje antes de alterar a MS');const sel=document.getElementById('gMsIns'),i=sel&&G.it[sel.value];if(!i)return toast('Escolha o produto');
  const v=Math.round(gNum(document.getElementById('gMsNova').value)*10)/10;if(!(v>0&&v<=100))return toast('A MS deve ficar entre 1 e 100%');
  if(Math.abs(v-(+i.ms))<1e-9)return toast('Essa já é a MS atual de '+i.nome);
  const x=JSON.parse(JSON.stringify(i)),d=new Date(),hist=Array.isArray(x.msHist)?x.msHist:(x.msDia&&x.msAnt!=null?[{dia:x.msDia,ts:0,de:+x.msAnt,para:+x.ms}]:[]);
  hist.push({dia:st_.dia,ts:Date.now(),hora:String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'),de:+i.ms,para:v});
  x.msHist=hist.slice(-30);x.msAnt=+i.ms;x.ms=v;x.msDia=st_.dia;gPut(x);
  const nAj=ajustarLeiturasMS();toast(`${i.nome}: MS ${pc(+i.ms,1)} → ${pc(v,1)} a partir de ${dB(st_.dia)}${nAj?` · leitura e previsto ajustados em ${nAj} curral(is)`:''}`);GT.ins=i.uid;gRender();}
function tInsForm(t){const i=t.id?G.it[t.id]:null,hj=hojeKey();
  const hist=i?(i.precos||[]).slice().reverse().map((p,k,a)=>`<tr><td>${dB(p.desde)}</td><td>${rs(+p.rs,2)}</td><td class="acoes">${a.length>1?`<button class="mini danger" data-g="insPrecoRm" data-id="${i.uid}" data-d="${p.desde}">✕</button>`:''}</td></tr>`).join(''):'';
  return `${voltar()}<section class="panel"><h2>${i?'Insumo':'Novo insumo'}</h2><div class="gForm">${[
    {k:'nome',l:'Nome',v:i?i.nome:'',ph:'Ex.: Silagem de milho'},{k:'ms',l:'Matéria seca',suf:'%',t:'num',v:i?i.ms:'',meia:1},
    {k:'preco',l:'Preço por tonelada',suf:'R$/t',t:'rs',v:i?precoIns(i,hj):'',meia:1},
    {k:'desde',l:'Preço vale a partir de',t:'dia',v:i?hj:'2000-01-01',ajuda:i?'Se mudar o preço, os dias antes dessa data continuam com o preço antigo.':''},
    {k:'estMin',l:'Estoque mínimo (opcional)',suf:'kg',t:'num',v:i&&+i.estMin>0?+i.estMin:'',meia:1,ajuda:'Abaixo disso o estoque avisa que está acabando.'},
    {k:'obs',l:'Observação',v:i&&i.obs?i.obs:'',ph:'Ex.: fornecedor, frete, umidade...'}].map(campo).join('')}</div>
    <button class="primary" data-g="salvaIns" data-id="${t.id||''}">Salvar</button></section>
    ${i?`<section class="panel"><h2>Histórico de preço</h2><div class="tablebox"><table><thead><tr><th>Desde</th><th>R$/t</th><th></th></tr></thead><tbody>${hist}</tbody></table></div>
    <button class="dangerfill" data-g="apagaIns" data-id="${i.uid}">Apagar insumo</button></section>`:''}`;}
function salvaIns(id){const nome=fv('nome'),ms=Math.round(fn('ms')*10)/10,preco=fn('preco'),desde=fv('desde')||hojeKey();
  if(!nome)return toast('Coloque o nome');if(!(ms>0&&ms<=100))return toast('Matéria seca entre 1 e 100%');if(!(preco>=0))return toast('Coloque o preço por tonelada');
  const i=id?JSON.parse(JSON.stringify(G.it[id])):{uid:novoId('ins'),tipo:'insumo',precos:[]};
  i.nome=nome;i.ms=ms;i.obs=(fv('obs')||'').trim();{const em=fn('estMin');if(em>0)i.estMin=em;else delete i.estMin;}const v=vig(i.precos,desde);if(!v||+v.rs!==preco)setHist(i.precos,desde,{rs:preco});
  gPut(i);toast('Insumo salvo');gVoltar();}

/* ---------- configurações ---------- */
/* Config. da Gestão separado em botões: Custo · Notas · Raça · Tratos · Balança */
const CFG_ABAS=[['custo','Custo/Venda'],['notas','Notas'],['raca','Animais'],['tratos','Tratos'],['balanca','Balança'],['senha','Senha'],['backup','Backup']];
function tCfg(){const c=gCfg(),hj=hojeKey(),tx=vig(c.taxa,hj),ab=GT.cab||'custo';
  if(!GT.racasEd)GT.racasEd=c.racas.slice().sort(alfa);if(!GT.catsEd)GT.catsEd=c.cats.slice();
  if(!GT.notasEd)GT.notasEd=c.notas.slice().sort((a,b)=>a.n-b.n).map(x=>Object.assign({},x));
  const botoes=`<div class="gCfgAbas">${CFG_ABAS.map(([k,t])=>`<button data-g="cfgAba" data-k="${k}" class="${k===ab?'sel':''}">${t}</button>`).join('')}</div>`;
  const salvar='<button class="primary" data-g="salvaCfg">Salvar</button>';
  let h='';
  if(ab==='custo')h=`<section class="panel gCfgP"><h2>Custo operacional</h2><div class="gForm">${[
    {k:'taxa',l:'Taxa operacional',suf:'por cabeça por dia',t:'rs',v:tx?tx.rs:'',meia:1},{k:'tdesde',l:'Vale a partir de',t:'dia',v:tx?hj:'2000-01-01',meia:1}].map(campo).join('')}</div>
    ${(c.taxa||[]).length?`<p class="note">${c.taxa.map(x=>`Desde ${dB(x.desde)}: ${rs(+x.rs)}`).join(' · ')}</p>`:''}${salvar}</section>${tEstVenda()}`;
  if(ab==='notas')h=`<section class="panel gCfgP"><h2>Notas da leitura de cocho</h2>
    <div class="gNotaCfg gNotaCab"><span>Nota</span><span>Descrição</span><span>Ajuste %</span><span></span></div>
    ${GT.notasEd.map((x,k)=>`<div class="gNotaCfg"><input class="cell num" inputmode="text" data-nn="${k}" value="${esc(vIn(x.n))}"><input type="text" data-nt="${k}" value="${esc(x.t)}"><input class="cell num" inputmode="text" data-np="${k}" value="${esc(vIn(x.p))}"><button class="mini danger" data-g="notaRm" data-i="${k}">✕</button></div>`).join('')}
    <div class="row"><button data-g="notaAdd">+ Adicionar nota</button><button data-g="notaPadrao">Voltar ao padrão (−4 a +4)</button></div>
    <p class="note">Nota positiva aumenta o trato, negativa diminui. O ajuste é em cima do realizado do dia anterior. Use o sinal de menos (−) para diminuir.</p>
    <div class="gForm">${campo({k:'pvIni',l:'Consumo inicial sugerido',suf:'% do PV em MS',t:'num',v:c.pvIni,meia:1,ajuda:'Usado na leitura de cocho quando o curral ainda não tem trato.'})}</div>${salvar}</section>`;
  if(ab==='raca')h=`<section class="panel gCfgP"><h2>Raças</h2>
    <div class="gEdLista">${GT.racasEd.map((r,k)=>`<div><span>${esc(r)}</span><button class="mini" data-g="racaEd" data-i="${k}">✎ Editar</button><button class="mini danger" data-g="racaRm" data-i="${k}">✕ Excluir</button></div>`).join('')}</div>
    <div class="gRacaAdd"><input type="text" id="gNovaRaca" placeholder="Nova raça" autocomplete="off"><button class="lima" data-g="racaAdd">+ Incluir</button></div>
    <p class="note">Aparecem na ficha do lote. Depois de mexer, toque em Salvar.</p></section>
  <section class="panel gCfgP"><h2>Categorias</h2>
    <div class="gEdLista">${GT.catsEd.map((r,k)=>`<div><span>${esc(r)}</span><button class="mini" data-g="catEd" data-i="${k}">✎ Editar</button><button class="mini danger" data-g="catRm" data-i="${k}">✕ Excluir</button></div>`).join('')}</div>
    <div class="gRacaAdd"><input type="text" id="gNovaCat" placeholder="Nova categoria" autocomplete="off"><button class="lima" data-g="catAdd">+ Incluir</button></div>
    <p class="note">Aparecem na ficha do lote (junto com sexo e raça). Depois de mexer, toque em Salvar.</p>${salvar}</section>`;
  if(ab==='tratos'){const P=window.prevApi,lt=GT.ntLoc||'T',cads=(S.cadastro||[]).filter(n=>(typeof curralAtivo!=='function'||curralAtivo(n))&&(lt==='T'||linhaDe(n)===lt)).sort(alfa);
    const TC=tratosCad();
    h=`<section class="panel gCfgP"><h2>Tratos</h2>
    <p class="note">Só os tratos ativos aparecem nas telas que perguntam o trato (Carregar, Fornecer, Previsto). O nome é opcional (ex.: Manhã, 7h).</p>
    <div class="gEdLista gTrLista">${TC.map(t=>`<div class="${t.ativo?'':'gInativa'}"><span><b>Trato ${t.k}</b>${t.nome?' · '+esc(t.nome):''} <span class="pill${t.ativo?' done':''}">${t.ativo?'ativo':'inativo'}</span></span><button class="mini" data-g="trEd" data-k="${t.k}">✎ Editar</button><button class="mini${t.ativo?' danger':''}" data-g="trAt" data-k="${t.k}">${t.ativo?'Desativar':'Ativar'}</button></div>`).join('')}</div>
    ${TC.length<tratosApi.MAXT?`<button class="lima" data-g="trAdd">+ Novo trato (Trato ${TC.length+1})</button>`:''}</section>
  <section class="panel gCfgP"><h2>Quantidade de tratos por curral</h2>
    <p class="note">Em quantas vezes o total do dia do curral é dividido. <b>Salva sozinho</b> ao escolher (aparece a confirmação embaixo) e o previsto de hoje já é redividido. O botão “Salvar divisão” é só para os % abaixo.</p>
    ${(()=>{const A=(S.cadastro||[]).filter(n=>typeof curralAtivo!=='function'||curralAtivo(n));return locBotoes('ntLoc',lt,k=>A.filter(c=>doLocal(k,c)).length);})()}
    <div class="gNtLista">${cads.map(cu=>{const n=P?P.nTratos(cu):1;return `<label class="gNt"><span>${esc(cu)}</span><select data-ntc="${esc(cu)}">${tratosAtivos().map((_,i)=>i+1).map(x=>`<option value="${x}"${x===n?' selected':''}>${x} trato${x>1?'s':''}</option>`).join('')}</select></label>`;}).join('')||'<p class="note">Cadastre os currais no Previsto.</p>'}</div></section>
  <section class="panel gCfgP"><h2>Divisão do trato (%)</h2>
    <p class="note">Quando o curral tem 2 ou mais tratos, o total do dia é dividido assim. 1 trato = 100% no Trato 1.</p>
    ${tratosAtivos().map((_,i)=>i+1).filter(n=>n>1).map(n=>{const v=P?P.divisao(n):[];return `<div class="gDiv"><b>${n} tratos</b><div class="gDivIn">${v.map((x,k)=>`<label><small>T${tratosAtivos()[k]}</small><input class="cell" inputmode="decimal" data-div="${n}" value="${String(x).replace('.',',')}"></label>`).join('')}</div><small class="gDivSoma" data-divsoma="${n}">${nf(v.reduce((a,b)=>a+b,0),1)}%</small></div>`;}).join('')}
    <button class="primary" data-g="salvaDiv">Salvar divisão</button></section>
  <section class="panel gCfgP"><h2>Compensar no último trato</h2>
    <p class="note">O que for a mais ou a menos nos tratos do dia é ajustado no último trato do curral, para fechar o total do dia. Ex.: total 2.000 (1.000 + 1.000); tratou 1.200 no 1º → o 2º vira 800.</p>
    <select id="cfgComp"><option value="1"${c.compensa===false?'':' selected'}>Ligado (recomendado)</option><option value="0"${c.compensa===false?' selected':''}>Desligado</option></select></section>
  <section class="panel gCfgP"><h2>Arredondamento</h2><div class="gForm">${campo({k:'arred',l:'Arredondar o previsto de',suf:'kg',t:'num',v:c.arred,meia:1})}</div>${salvar}</section>`;}
  if(ab==='balanca')h='<div id="cfgBalHost"></div>';
  if(ab==='senha'){const tu=c.senhaTurno===true;
    h=`<section class="panel gCfgP"><h2>Senha para entrar</h2>
    <div class="linhas gFiltro"><button data-g="senhaTurno" data-v="0" class="${tu?'':'sel'}">Pedir sempre</button><button data-g="senhaTurno" data-v="1" class="${tu?'sel':''}">1 vez de manhã e 1 vez à tarde</button></div>
    <p class="note"><b>1 vez de manhã e 1 vez à tarde:</b> em cada celular, a senha é pedida na primeira entrada da manhã (até 11:59) e na primeira entrada depois do meio-dia. Nas outras vezes do mesmo turno, entra direto. Vale para os Tratos (0000) e para a Gestão (1010), cada um com a sua senha. Um celular que ainda não colocou a senha naquele turno não entra.<br>Editar e apagar registros e batidas continuam pedindo a senha 1010 toda vez.</p></section>`;}
  if(ab==='backup'){const I=window.bkApi?bkApi.info():{};
    h=`<section class="panel gCfgP"><h2>Backup</h2>
    <p class="note"><b>Automático:</b> todo dia às 2h da manhã, no Google Drive (pasta SISTEMA COMPLETO - CONFINAMENTO › Backups). Ficam os 20 mais novos.<br>
    <b>Manual:</b> no botão abaixo. Ficam os 10 mais novos.<br>Cada backup tem 2 arquivos: a cópia do sistema (para restaurar) e a planilha geral com tudo separado em abas.<br>
    A cada 10 dias os 2 arquivos do automático vão por e-mail para alexandre@grupofjk.com.br.</p>
    <p class="note">${I.ult?'Último backup manual feito por este celular: '+esc(I.ult)+'.':''}${I.pend?' Tem backup esperando sinal de internet.':''}</p>
    <button class="lima" data-g="bkAgora">✋ Fazer backup manual agora</button>
    <button data-g="bkRest">↩ Restaurar cópia</button></section>
    <section class="panel gCfgP"><h2>Cópias guardadas</h2><div id="gBkLista"><p class="note">Buscando…</p></div></section>`;
    setTimeout(gBkLista,0);}
  return botoes+h;}
/* ---------- batidas retroativas: uma batida por dia × trato × ração com o realizado dos tratos ---------- */
let RETRO=null;
async function retroCalc(){const box=document.getElementById('gRetro');if(box)box.innerHTML='<p class="note">Buscando os tratos na nuvem…</p>';
  let regs=[];try{const r=await fetch(apiUrl()+'?acao=listar&desde=2026-07-31',{cache:'no-store'});const j=await r.json();if(j&&j.ok)regs=(j.registros||[]).map(x=>({uid:String(x.uid),dia:String(x.dia),trato:+x.trato||1,hora:x.hora,curral:String(x.curral),forn:+x.forn||0,ts:+x.ts||0}));}catch(e){}
  const vistos=new Set(regs.map(x=>x.uid));(typeof HIST!=='undefined'?HIST:[]).forEach(x=>{if(!vistos.has(String(x.uid)))regs.push({uid:String(x.uid),dia:x.dia,trato:+x.trato,hora:x.hora,curral:x.curral,forn:+x.forn||0,ts:+x.ts||0});});
  regs=regs.filter(x=>x.forn>0&&x.dia&&x.dia<=hojeKey());if(!regs.length){if(box)box.innerHTML='<p class="aviso warn">Não achei tratos (sem internet?).</p>';return;}
  const grupos=new Map(),semRac=new Set();
  regs.forEach(x=>{const c=nAt(x.curral),rac=racaoDoCurral(c,x.dia);if(!rac){semRac.add(x.dia+' '+c);return;}const loc=linhaDe(c)||'',k=x.dia+'|'+rac+'|'+loc;  // uma batida por dia para cada ração (e local)
    const g=grupos.get(k)||{dia:x.dia,trs:new Set(),rac,loc,kg:0,ts:Infinity,hora:'',n:0};g.trs.add(+x.trato);g.kg+=x.forn;g.n++;if(x.ts&&x.ts<g.ts){g.ts=x.ts;g.hora=x.hora||'';}grupos.set(k,g);});
  const C=gTodos('carga').filter(c=>!c.retro);  // todas as batidas lançadas serão substituídas
  const novas=[...grupos.values()].sort((a,b)=>a.dia.localeCompare(b.dia)||(a.loc||'').localeCompare(b.loc||''));
  const ins={};let tot=0,semF=0;
  const lista=novas.map(g=>{const r=G.it[g.rac],cp=r&&compRacao(r,g.dia);if(!cp||!cp.itens.length){semF++;return null;}
    const itens=cp.itens.filter(i=>i.ins&&i.pMN>0).map(i=>{const kg=Math.round(g.kg*i.pMN/100);ins[i.nome]=(ins[i.nome]||0)+kg;return {ins:i.ins.uid,nome:i.nome,pMN:i.pMN,prev:kg,ini:null,fim:null,real:kg,hora:''};});
    tot+=g.kg;return {g,r,itens};}).filter(Boolean);
  RETRO=lista;const dias=[...new Set(regs.map(x=>x.dia))].sort();
  box.innerHTML=`<p class="note">Tratos na nuvem: de <b>${dB(dias[0])}</b> a <b>${dB(dias[dias.length-1])}</b> (${nf(dias.length)} dias).</p>
    <div class="stat gStat3">${st('Batidas a criar',nf(lista.length))}${st('Total (kg)',nf(tot))}${st('Batidas atuais (serão apagadas)',nf(C.length))}</div>
    ${Object.keys(ins).length?`<div class="tablebox"><table class="gTab"><thead><tr><th>Produto</th><th>kg</th></tr></thead><tbody>${Object.entries(ins).sort((a,b)=>b[1]-a[1]).map(([n,k])=>`<tr><td class="c">${esc(n)}</td><td>${nf(k)}</td></tr>`).join('')}</tbody></table></div>`:''}
    ${semRac.size?`<p class="aviso warn">${nf(semRac.size)} trato(s) de curral sem lote/ração cadastrado no dia ficaram de fora.</p>`:''}${semF?`<p class="aviso warn">${semF} sem fórmula da ração no dia.</p>`:''}
    ${lista.length?`<button class="lima" data-g="retroGera">✓ Apagar as ${nf(C.length)} batidas atuais e lançar ${nf(lista.length)} batidas (1 por dia por ração)</button>`:'<p class="note">Nada para lançar.</p>'}`;}
async function retroGera(){if(!RETRO||!RETRO.length)return;
  const C=gTodos('carga').filter(c=>!c.retro),R0=gTodos('carga').filter(c=>c.retro);
  if(!await confirmaVermelho(`Apagar ${C.length} batidas e lançar ${RETRO.length}?`,'As batidas lançadas hoje e antes são trocadas por uma batida por dia por ração com o realizado dos tratos. As apagadas ficam guardadas para o Desfazer.','Sim, continuar','Não'))return;
  if(!await confirmaVermelho('Tem certeza?','Confira se fez o backup antes (Fazer backup manual agora).','Sim, trocar as batidas','Não, voltar'))return;
  const ant=(G.it['retro-apagadas']&&!G.it['retro-apagadas'].del&&G.it['retro-apagadas'].itens)||[];
  gPut({uid:'retro-apagadas',tipo:'retroBk',ts:Date.now(),itens:ant.concat(C.map(c=>JSON.parse(JSON.stringify(c))))});
  C.forEach(c=>gDel(c.uid));R0.forEach(c=>gDel(c.uid));
  RETRO.forEach(({g,r,itens},k)=>{const ts0=(isFinite(g.ts)?g.ts:Date.parse(g.dia+'T06:00:00'))-30*60000;
    const trs=[...g.trs].sort((a,b)=>a-b);
    gPut({uid:'carga-retro-'+g.dia+'-'+g.rac+'-'+(g.loc||'x'),tipo:'carga',dia:g.dia,local:g.loc,avulso:false,trato:trs[0],tratos:trs,racao:g.rac,racNome:r.nome,total:itens.reduce((a,i)=>a+i.prev,0),ts0,
      hora:new Date(ts0).toTimeString().slice(0,5),itens,origem:'retroativa',retro:true});});
  toast(`${RETRO.length} batidas retroativas lançadas`);RETRO=null;gRender();}
async function retroApaga(){const L=gTodos('carga').filter(c=>c.retro);if(!L.length)return;const bk=G.it['retro-apagadas'],V=bk&&!bk.del&&bk.itens||[];
  if(!await confirmaVermelho(`Desfazer?`,`Apaga as ${L.length} batidas retroativas e devolve as ${V.length} batidas que estavam antes.`,'Sim, desfazer','Não'))return;
  L.forEach(c=>gDel(c.uid));V.forEach(c=>{const x=Object.assign({},c);delete x.del;gPut(x);});if(bk)gDel(bk.uid);toast('Pronto: batidas de antes devolvidas');gRender();}
function lerNotasEd(){(GT.notasEd||[]).forEach((x,k)=>{const n=document.querySelector(`#gBox [data-nn="${k}"]`),t=document.querySelector(`#gBox [data-nt="${k}"]`),p=document.querySelector(`#gBox [data-np="${k}"]`);
  if(n)x.n=gNum(n.value);if(t)x.t=t.value.trim();if(p)x.p=gNum(p.value);});}
function salvaDiv(){const c=JSON.parse(JSON.stringify(gCfg()));c.div=c.div||{};let ruim=[];
  [...new Set([...document.querySelectorAll('#gBox [data-div]')].map(i=>+i.dataset.div))].forEach(n=>{const v=[...document.querySelectorAll(`#gBox [data-div="${n}"]`)].map(i=>gNum(i.value));  // só as linhas que aparecem (tratos ativos)
    if(v.length!==n||v.some(x=>!ok(x)||x<0)||Math.abs(v.reduce((a,b)=>a+b,0)-100)>0.5){ruim.push(n);return;}c.div[n]=v;});
  if(ruim.length)return toast(`A soma precisa dar 100% (confira: ${ruim.map(n=>n+' tratos').join(', ')})`);
  gPut(c);toast('Divisão dos tratos salva');gRender();}
function salvaCfg(){const c=JSON.parse(JSON.stringify(gCfg()));const t=fn('taxa'),d=fv('tdesde')||hojeKey();
  if(ok(t)){const v=vig(c.taxa,d);if(!v||+v.rs!==t)setHist(c.taxa,d,{rs:t});}
  lerNotasEd();const ns=GT.notasEd.filter(x=>ok(x.n)&&ok(x.p));
  if(new Set(ns.map(x=>x.n)).size!==ns.length)return toast('Tem nota repetida');if(!ns.length)return toast('Coloque pelo menos uma nota');
  c.racas=(GT.racasEd||c.racas).slice();GT.racasEd=null;c.cats=(GT.catsEd||c.cats).slice();GT.catsEd=null;c.notas=ns.map(x=>({n:x.n,t:x.t||(x.p>0?'Aumentar':x.p<0?'Diminuir':'Manter'),p:x.p})).sort((a,b)=>a.n-b.n);c.notasV=NOTAS_VER;
  const a=fn('arred'),rc=fn('rc'),pv=fn('pvIni');if(ok(a)&&a>=0)c.arred=a;if(rc>0)c.rc=rc;if(pv>0)c.pvIni=pv;
  const rR=GT.renR||{},rC=GT.renC||{};GT.renR=null;GT.renC=null;
  gTodos('lote').forEach(l=>{let mud=false;const x=JSON.parse(JSON.stringify(l));if(rR[x.raca]){x.raca=rR[x.raca];mud=true;}const cn=catNorm(x.cat);if(rC[cn]){x.cat=rC[cn];mud=true;}if(mud)gPut(x);});
  gPut(c);GT.notasEd=null;toast('Configurações salvas');gRender();}

/* =====================================================================================
   EVENTOS
   ===================================================================================== */
const SO_VER=new Set(['fzFotoVer','fzHN','fzHPdf','fzHImg','resPdf','resImg','resXls','insPdf','insImg','insXls','estPdf','estImg','estXls','estPerE','estOrd','nfVer','fzPdf','fzImgG','fzCur','fzLoc','fzImg','fzXls','fzXlsHist','cfgAba','coLoc','coAbre','coFecha','estPer','evLoc','evolN','imgDia','imgPer','imgComp','imgLote','xlsGraf','racaAdd','racaRm','grafLoc','grafCur','celGraf','imgGraf','filtroLoc','dataPasso','dataHoje','voltar','ir','lote','raiz','compRel','compDia','xlsDia','xlsPer','xlsComp','xlsLote','perAtalho','nota','racAdd','racRm','notaAdd','notaRm','notaPadrao']);
$('gBox').addEventListener('click',e=>{
  const b=e.target.closest('[data-g]');if(!b)return;const a=b.dataset.g,id=b.dataset.id;
  if(!SO_VER.has(a)&&bloqueado())return;
  if(a==='voltar')return gVoltar();
  if(a==='ir'){const t={t:b.dataset.t,id,o:b.dataset.o,enc:b.dataset.enc==='1'};if(b.dataset.mov)t.mov=b.dataset.mov;if(b.dataset.ins)t.ins=b.dataset.ins;
    if(GT.t==='lotes'&&t.t==='lotes'){GT=t;return gRender();}return gIr(t);}
  if(a==='lote')return gIr({t:'lote',id});
  if(a==='raiz')return gRaiz(b.dataset.t);
  if(a==='filtroLoc'){gLoc=b.dataset.l;return gRender();}
  if(a==='racaAdd'){lerNotasEd();const v=($('gNovaRaca').value||'').trim();if(!v)return toast('Digite o nome da raça');
    if(GT.racasEd.some(r=>alfa(r,v)===0))return toast('Essa raça já está na lista');GT.racasEd.push(v);GT.racasEd.sort(alfa);gRender();return toast('Incluída. Toque em Salvar configurações.');}
  if(a==='ntLoc'){GT.ntLoc=b.dataset.l;return gRender();}
  if(a==='coFecha'){if(GT.coAberto)delete GT.coAberto[b.dataset.c];if(GT.sel)delete GT.sel[b.dataset.c];const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='baseM'){const c=b.dataset.c,m=b.dataset.m;GT.base=GT.base||{};GT.base[c]=m==='dia'?{m:'dia',d:null}:{m};if(GT.sel&&GT.sel[c])delete GT.sel[c].kg;const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='coAbre'){GT.coAberto=GT.coAberto||{};GT.coAberto[b.dataset.c]=1;const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='coLoc'){document.querySelectorAll('#gBox .gCocho').forEach(el=>{const i=el.querySelector('input[data-kg]'),c=el.dataset.c;if(i&&GT.sel&&GT.sel[c]&&i.value)GT.sel[c].kg=gNum(i.value);});GT.coLoc=b.dataset.l;return gRender();}
  if(a==='evLoc'){GT.evLoc=b.dataset.l;return gRender();}
  if(a==='ecTodos'){const rc=gNum(($('gEcRcT')||{}).value),pr=gNum(($('gEcPrT')||{}).value);if(!ok(rc)&&!ok(pr))return toast('Coloque o preço e/ou o rendimento da compra');
    document.querySelectorAll('#gBox [data-ecpr]').forEach(i=>{if(ok(pr))i.value=rsIn(pr);});document.querySelectorAll('#gBox [data-ecrc]').forEach(i=>{if(ok(rc))i.value=vIn(rc);});
    return toast('Compra aplicada em todos da lista. Toque em Salvar estimativas.');}
  if(a==='evTodos'){const rc=gNum(($('gEvRcT')||{}).value),pr=gNum(($('gEvPrT')||{}).value);if(!ok(rc)&&!ok(pr))return toast('Coloque o rendimento e/ou o preço para aplicar');
    document.querySelectorAll('#gBox [data-evrc]').forEach(i=>{if(ok(rc))i.value=vIn(rc);});document.querySelectorAll('#gBox [data-evpr]').forEach(i=>{if(ok(pr))i.value=rsIn(pr);});
    return toast('Aplicado em todos da lista. Toque em Salvar estimativas.');}
  if(a==='evSalvar'){let n=0;document.querySelectorAll('#gBox [data-evrc]').forEach(i=>{const u=i.dataset.evrc,l=G.it[u];if(!l)return;
      const rc=gNum(i.value),pi=document.querySelector(`#gBox [data-evpr="${u}"]`),pr=pi?gNum(pi.value):NaN,nrc=ok(rc)&&rc>0?rc:null,npr=ok(pr)&&pr>0?pr:null;
      const q=k=>{const e=document.querySelector(`#gBox [data-${k}="${u}"]`);const v=e?gNum(e.value):NaN;return ok(v)&&v>0?v:null;},cpr=q('ecpr'),crc=q('ecrc'),e0=l.ent||{};
      const mudaC=l.compraGrupo!==false&&((+e0.preco||null)!==cpr||(+e0.rcC||50)!==(crc||50));
      if((l.rcPrev||null)!==nrc||(l.simPreco||null)!==npr||mudaC){const x=JSON.parse(JSON.stringify(l));x.rcPrev=nrc;x.simPreco=npr;
        if(mudaC){x.ent=x.ent||{};if((+e0.preco||null)!==cpr){x.ent.preco=cpr||0;x.ent.unid='arroba';}x.ent.rcC=crc||50;}gPut(x);n++;}});
    gRender();return toast(n?`Estimativa salva em ${n} lote(s)`:'Nada mudou');}
  if(a==='bkAgora'){if(!window.bkApi)return;Promise.resolve(bkApi.agora()).then(()=>setTimeout(()=>{if(GT.cab==='backup')gRender();},800));return;}
  if(a==='bkRest'){if(window.bkApi)bkApi.restaurar();return;}
  if(a==='trEd'||a==='trAt'||a==='trAdd'){const L=tratosCad().map(t=>Object.assign({},t)),k=+b.dataset.k,t=L.find(x=>x.k===k);
    if(a==='trAdd'){if(L.length>=tratosApi.MAXT)return toast('Máximo de '+tratosApi.MAXT+' tratos');L.push({k:L.length+1,nome:'',ativo:true});tratosApi.salvar(L);gRender();return toast(`Trato ${L.length} cadastrado e ativo`);}
    if(a==='trEd'){const v=prompt(`Nome do Trato ${k} (opcional, ex.: Manhã ou 7h). Deixe vazio para só "Trato ${k}":`,t.nome||'');if(v==null)return;t.nome=v.trim().slice(0,20);tratosApi.salvar(L);gRender();return toast('Trato salvo');}
    if(t.ativo&&L.filter(x=>x.ativo).length<=1)return toast('Precisa ficar pelo menos um trato ativo');
    t.ativo=!t.ativo;tratosApi.salvar(L);gRender();return toast(`Trato ${k} ${t.ativo?'ativado':'desativado'}. Confira a quantidade de tratos dos currais.`);}
  if(a==='catAdd'){lerNotasEd();const v=($('gNovaCat').value||'').trim();if(!v)return toast('Digite o nome da categoria');
    if(GT.catsEd.some(r=>alfa(r,v)===0))return toast('Essa categoria já está na lista');GT.catsEd.push(v);gRender();return toast('Incluída. Toque em Salvar configurações.');}
  if(a==='racaEd'||a==='catEd'){lerNotasEd();const arr=a==='racaEd'?GT.racasEd:GT.catsEd,i=+b.dataset.i,ant=arr[i];const v=(prompt('Novo nome:',ant)||'').trim();if(!v||v===ant)return;
    if(arr.some((r,k)=>k!==i&&alfa(r,v)===0))return toast('Esse nome já está na lista');arr[i]=v;const m=a==='racaEd'?(GT.renR=GT.renR||{}):(GT.renC=GT.renC||{});m[ant]=v;gRender();return toast('Alterado. Toque em Salvar.');}
  if(a==='catRm'){if(!confirm(`Excluir a categoria ${GT.catsEd[+b.dataset.i]}? Os lotes que já têm ela continuam com o nome.`))return;lerNotasEd();GT.catsEd.splice(+b.dataset.i,1);gRender();return toast('Tirada. Toque em Salvar configurações.');}
  if(a==='racaRm'){if(!confirm(`Excluir a raça ${GT.racasEd[+b.dataset.i]}? Os lotes que já têm ela continuam com o nome.`))return;lerNotasEd();GT.racasEd.splice(+b.dataset.i,1);gRender();return toast('Tirada. Toque em Salvar configurações.');}
  if(a==='grafLoc'){gLocG=b.dataset.l;return gRender();}
  if(a==='grafCur'){const c=b.dataset.c;if(gGrafOff.has(c))gGrafOff.delete(c);else gGrafOff.add(c);return gRender();}
  if(a==='imgGraf')return imagemGraf();
  if(a==='celGraf'){const x=G.it[idLeit(b.dataset.d,b.dataset.c)];return toast(x&&!x.del?`${b.dataset.c} · ${dB(b.dataset.d).slice(0,5)}: nota ${notaTxt(x.nota)} (${x.pct>0?'+':''}${nf(x.pct,0)}%) · ${nf(x.novo)} kg (base ${nf(x.base)})`:`${b.dataset.c} · ${dB(b.dataset.d).slice(0,5)}: sem leitura`);}
  if(a==='dataPasso'||a==='dataHoje'){const inp=$(b.dataset.alvo);if(!inp)return;inp.value=a==='dataHoje'?hojeKey():somaDias(inp.value||hojeKey(),+b.dataset.n);inp.dispatchEvent(new Event('change',{bubbles:true}));return;}
  if(a==='salvaCusto'){const dia=fv('dia'),v=fn('rs');if(!dia||!(v>0))return toast('Coloque a data e o valor');
    gPut({uid:novoId('cus'),tipo:'custo',lote:id,dia,cat:fv('cat'),desc:fv('desc'),rs:v});toast('Custo lançado');return gVoltar();}
  if(a==='evolN'){GT.evN=+b.dataset.n;const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='xlsDia')return xlsDia();
  if(a==='imgDia')return imgDia();
  if(a==='imgPer')return imgPer();
  if(a==='imgComp')return imgComp();
  if(a==='imgLote')return imgLote(id);
  if(a==='xlsGraf')return xlsGraf();
  if(a==='xlsPer')return xlsPer();
  if(a==='xlsComp')return xlsComp();
  if(a==='xlsLote')return xlsLote(id);
  if(a==='perAtalho'){const n=b.dataset.n,hj=hojeKey();if(n==='mes')return gRenderCom({ini:hj.slice(0,8)+'01',fim:hj});return gRenderCom({fim:hj,ini:somaDias(hj,-(+n-1))});}
  if(a==='notaAdd'){lerNotasEd();const mx=GT.notasEd.reduce((m,x)=>Math.max(m,ok(x.n)?x.n:0),0);GT.notasEd.push({n:mx+1,t:'Aumentar',p:0});return gRender();}
  if(a==='notaRm'){lerNotasEd();GT.notasEd.splice(+b.dataset.i,1);return gRender();}
  if(a==='notaPadrao'){GT.notasEd=NOTAS_PADRAO.map(x=>Object.assign({},x));gRender();return toast('Notas −4 a +4 de volta. Toque em Salvar.');}
  if(a==='novoLote')return gIr({t:'loteForm'});
  if(a==='salvaLote')return salvaLote(id);
  if(a==='salvaPes'){const dia=fv('dia'),peso=fn('peso');if(!dia||!(peso>0))return toast('Coloque a data e o peso');
    const lp=G.it[id],proj=pesoEm(lp,dia,pesagensDe(lp).filter(p=>p.dia<dia));
    gPut({uid:novoId('pes'),tipo:'pesagem',lote:id,dia,peso,proj:ok(proj)?Math.round(proj):null,cab:fn('cab')||null,obs:fv('obs')});toast('Pesagem salva');return gVoltar();}
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
  if(a==='apagaLote'){const l=G.it[id];
    if(!confirm(`⚠ APAGAR o lote ${l.nome}?\n\nSome o lote com entrada, pesagens, saídas e custos. Não dá para desfazer.\nSe os animais já saíram, o lote fica ARQUIVADO sozinho; não precisa apagar.`))return;
    const w=prompt('Para confirmar, escreva a palavra APAGAR:');if(w==null)return;if(w.trim().toUpperCase()!=='APAGAR')return toast('Não apagou: a palavra não confere');
    gTodos('pesagem').concat(gTodos('saida')).filter(x=>x.lote===id).forEach(x=>gDel(x.uid));gDel(id);toast('Lote apagado');GT={t:'lotes'};gPilha.length=1;return gRender();}
  if(a==='compRel')return enviarTexto(textoRel());
  if(a==='compDia')return enviarTexto(textoDia());
  if(a==='baseDia'){GT.base=GT.base||{};GT.base[b.dataset.c]={m:'dia',d:b.dataset.d};if(GT.sel&&GT.sel[b.dataset.c])delete GT.sel[b.dataset.c].kg;const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='nota'){const c=b.dataset.c,n=+b.dataset.n;GT.sel=GT.sel||{};GT.sel[c]=b.classList.contains('sel')?{n:null}:{n};const y=window.scrollY;gRender();window.scrollTo({top:y});return;}  // tocou de novo na mesma nota: desmarca
  if(a==='salvaCocho')return salvaCocho();
  if(a==='racAdd'){lerItensRac();GT.itens.push({ins:'',pMS:''});const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='racRm'){lerItensRac();GT.itens.splice(+b.dataset.i,1);if(!GT.itens.length)GT.itens.push({ins:'',pMS:''});const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='salvaRac')return salvaRac(id);
  if(a==='apagaRac'){const r=G.it[id],usam=gTodos('lote').filter(l=>(l.rac||[]).some(h=>h.r===id));
    if(usam.length)return toast(`Usada nos lotes: ${usam.map(l=>l.nome).join(', ')}. Não dá para apagar.`);if(!confirm(`Apagar a ração ${r.nome}?`))return;gDel(id);GT.itens=null;return gVoltar();}
  if(a==='salvaIns')return salvaIns(id);
  if(a==='salvaMS')return salvaMS();
  if(a==='resPdf')return resPdf();
  if(a==='resImg')return resImg();
  if(a==='resXls')return resXls();
  if(a==='insPdf'||a==='insImg'||a==='insXls')return insExp(a==='insPdf'?'pdf':a==='insImg'?'img':'xls');
  if(a==='salvaEst')return salvaEst(b.dataset.id);
  if(a==='estRm'){const m=G.it[id];if(!m)return;if(!confirm(`Apagar este lançamento (${m.mov==='ent'?'entrada':m.mov==='inv'?'contagem':'saída'} de ${nf(+m.kg)} kg em ${dB(m.dia)})?`))return;gDel(id);toast('Lançamento apagado');return gRender();}
  if(a==='estPer'){GT.per=+b.dataset.p;return gRender();}
  if(a==='estPerE'){GT.perE=+b.dataset.p;return gRender();}
  if(a==='nfNova'){NF=null;NF_IMG=null;GT={t:'estNF'};gRender();window.scrollTo({top:0});return;}
  if(a==='nfOutra'){NF=null;NF_IMG=null;return gRender();}
  if(a==='nfSalva')return nfSalvar();
  if(a==='nfVer')return nfVer(b.dataset.id,b.dataset.mini);
  if(a==='estOrd'){GT.ordE=b.dataset.o;return gRender();}
  if(a==='estPdf'||a==='estImg'||a==='estXls')return estExp(a==='estPdf'?'pdf':a==='estImg'?'img':'xls');
  if(a==='insPrecoRm'){const i=JSON.parse(JSON.stringify(G.it[id]));i.precos=i.precos.filter(p=>p.desde!==b.dataset.d);gPut(i);return gRender();}
  if(a==='racAtiva'){const r=JSON.parse(JSON.stringify(G.it[id]));const usam=lotesAtivos().filter(l=>{const x=racaoEm(l,hojeKey());return x&&x.uid===id;}).length;
    if(!r.inativa&&usam&&!confirm(`${usam} lote(s) ainda usam esta ração. Inativar mesmo assim?`))return;r.inativa=!r.inativa;gPut(r);toast(r.inativa?'Ração inativada':'Ração reativada');return gRender();}
  if(a==='apagaIns'){const i=G.it[id],usam=gTodos('racao').filter(r=>(r.versoes||[]).some(v=>v.itens.some(x=>x.ins===id)));
    if(usam.length)return toast(`Usado nas rações: ${usam.map(r=>r.nome).join(', ')}. Não dá para apagar.`);if(!confirm(`Apagar ${i.nome}?`))return;gDel(id);return gVoltar();}
  if(a==='salvaCfg')return salvaCfg();
  if(a==='senhaTurno'){const c=JSON.parse(JSON.stringify(gCfg()));c.senhaTurno=b.dataset.v==='1';gPut(c);toast(c.senhaTurno?'Senha: 1 vez de manhã e 1 vez à tarde':'Senha: pedir sempre');return gRender();}
  if(a==='salvaDiv')return salvaDiv();
  if(a==='cfgAba'){lerNotasEd();GT.cab=b.dataset.k;gRender();window.scrollTo({top:0});return;}
  if(a==='retroCalc')return retroCalc();
  if(a==='retroGera')return retroGera();
  if(a==='retroApaga')return retroApaga();
});
['pointerdown','pointermove'].forEach(ev=>$('gBox').addEventListener(ev,e=>{const r=e.target.closest&&e.target.closest('.gEvHit');if(r)evolMostrar(+r.dataset.ev);}));
$('gBox').addEventListener('click',e=>{const i=e.target.closest('.gDataBox input');if(i&&i.showPicker){try{i.showPicker();}catch(_){}}});
$('gBox').addEventListener('change',e=>{const s_=e.target.closest('select[data-ntc]');if(!s_||!window.prevApi)return;if(typeof bloqueado==='function'&&bloqueado())return;
  const cu=s_.dataset.ntc,n=+s_.value;prevApi.setNTratos(cu,n);const t=prevApi.totalCurral(cu);if(t>0){prevApi.distribuir(cu,t,n,S.prev);if(typeof marcarPrev==='function')marcarPrev();if(typeof render==='function')render();}toast(`${cu}: ${n} trato${n>1?'s':''}`);});
$('gBox').addEventListener('input',e=>{
  if(e.target.matches('[data-div]')){const n=e.target.dataset.div,v=[...document.querySelectorAll(`#gBox [data-div="${n}"]`)].map(i=>gNum(i.value)||0),t=v.reduce((a,b)=>a+b,0),el=document.querySelector(`#gBox [data-divsoma="${n}"]`);if(el){el.textContent=nf(t,1)+'%';el.classList.toggle('bad',Math.abs(t-100)>0.5);}}
  const t=e.target;
  if(t.classList.contains('gRs'))mascaraRs(t);
  if(GT.t==='racForm'&&(t.matches('[data-rp]')||t.id==='gVag'))calcRacao();
  if(GT.t==='rel'&&/^gf_s/.test(t.id))calcSimul();
  if(GT.t==='pesForm'&&(t.id==='gf_peso'||t.id==='gf_dia'))calcPes();
});
$('gBox').addEventListener('change',e=>{
  const t=e.target;
  if(GT.t==='racForm'&&t.matches('[data-ri]'))calcRacao();
  if(t.id==='gCoDia'){GT.sel={};GT.base={};GT.dia=t.value||hojeKey();gRenderCom({dia:GT.dia});}
  if(t.id==='gDiaDia'){gRenderCom({dia:t.value||hojeKey()});}
  if(t.id==='gResDia'){gRenderCom({dia:t.value||hojeKey()});}
  if(t.id==='gRefDia'||t.id==='gGrafDia'){gRenderCom({dia:t.value||hojeKey()});}
  if(t.id==='gPerIni'||t.id==='gPerFim'){let a=$('gPerIni').value,b=$('gPerFim').value;if(a&&b&&a>b)[a,b]=[b,a];gRenderCom({ini:a,fim:b});}
  const novaBase=(c,o)=>{GT.base=GT.base||{};GT.base[c]=o;if(GT.sel&&GT.sel[c])delete GT.sel[c].kg;setTimeout(gRender,0);};
  if(t.matches('select[data-bm]')){const c=t.dataset.bm,m=t.value;if(m==='ontem'){novaBase(c,{m:'ontem'});return;}
    novaBase(c,{m,d:m==='dia'?somaDias(GT.dia||hojeKey(),-2):null,kg:null});return;}
  if(t.matches('input[data-bd]')){const c=t.dataset.bd;novaBase(c,{m:'dia',d:t.value||null});return;}
  if(t.matches('input[data-bk]')){const c=t.dataset.bk;novaBase(c,{m:'kg',kg:gNum(t.value)});return;}
  if(t.matches('input[data-kg]')){const c=t.dataset.kg;GT.sel=GT.sel||{};const lt=G.it[idLeit(GT.dia,c)];
    const n=GT.sel[c]?GT.sel[c].n:(lt&&!lt.del?lt.nota:null);if(n==null){toast('Marque a nota primeiro');t.value='';return;}GT.sel[c]={n,kg:gNum(t.value)};}
});
function gRenderCom(o){Object.assign(GT,o);gRender();}


/* ---------- menu: Gestão (Resumo, Lotes, Cocho, Relatórios, Rações, Insumos, Config.) ---------- */
$('tabGrpGest').addEventListener('click',()=>tocarGrupo('gest'));
$('subGest').addEventListener('click',e=>{const b=e.target.closest('button[data-gt]');if(b)gRaiz(b.dataset.gt);});
window.gAoAbrir=()=>{gRender();if(navigator.onLine)gSync(true).catch(()=>{});};
/* nome do curral mudou no Previsto: o lote passa a usar o nome novo a partir de hoje */
window.gRenomearCurral=(de,para)=>{const hj=hojeKey();gTodos('lote').forEach(l=>{if(ativo(l)&&curralEm(l,hj)===de){const x=JSON.parse(JSON.stringify(l));setHist(x.curr,hj,{c:para});gPut(x);}});setTimeout(()=>{try{migrarRenomes();}catch(e){}},300);};

/* valores nos quadros sempre numa linha só: se não couber, diminui a letra até caber */
function encaixarValores(){document.querySelectorAll('.stat b,.res b,.gLoteNums b,.gMini3 b,.gHero b,#cBox .cbCur b,#acBox .cbCur b').forEach(b=>{if(!b.offsetParent)return;b.style.fontSize='';
  let f=parseFloat(getComputedStyle(b).fontSize),n=0;if(b.scrollWidth>b.clientWidth+1&&b.clientWidth>0){f=Math.max(9,Math.floor(f*b.clientWidth/b.scrollWidth*2)/2);b.style.fontSize=f+'px';}
  while(b.scrollWidth>b.clientWidth+1&&f>9&&n<20){f-=0.5;b.style.fontSize=f+'px';n++;}});}
let encTimer=null;new MutationObserver(()=>{clearTimeout(encTimer);encTimer=setTimeout(encaixarValores,30);}).observe(document.querySelector('.wrap'),{childList:true,subtree:true,characterData:true});
window.addEventListener('resize',()=>{clearTimeout(encTimer);encTimer=setTimeout(encaixarValores,100);});

/* =====================================================================================
   CARREGAR (batida do vagão): mesmo jeito do Tratar, ao contrário — a balança SOBE a cada produto
   ===================================================================================== */
const CK='confinamento-carga-v1';
let CG={};try{CG=JSON.parse(localStorage.getItem(CK))||{};}catch(e){CG={};}
/* batida ainda não iniciada: sempre começa limpa (abriu o app, entrou no Carregar, voltou depois de um tempo fora, ou tocou em Cancelar).
   Batida já iniciada (CG.ativa) continua guardada. */
function cLimparSetup(){if(CG.ativa)return;const keep={ativa:null,verDia:CG.verDia};CG=Object.assign({},keep,{passo:1,local:null,rac:null,trato:null,tAuto:false,avulso:false,juntos:[],juntoAberto:false,total:0,totalDe:null,ordem:null,ja:{},sobModo:'rac',sobRac:null,sobKg:0,ordAberto:false,jaAberto:false});try{localStorage.setItem(CK,JSON.stringify(CG));}catch(e){}}
cLimparSetup();
{let saiu=0;document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saiu=Date.now();else if(saiu&&Date.now()-saiu>600000&&!CG.ativa){cLimparSetup();try{cRender();}catch(e){}}});}
const cSave=()=>{try{localStorage.setItem(CK,JSON.stringify(CG));}catch(e){}if(typeof agendarAoVivo==='function')agendarAoVivo();};
/* acompanhamento ao vivo do Carregar */
window.cEstadoAoVivo=auto=>{const B=CG.ativa,base={modo:'carga',origem:auto?'auto':'manual',dia:hojeKey()};
  if(!B)return Object.assign(base,{trato:+CG.trato||1,semBatida:true});
  const it=B.itens[B.atual]||{},pesoAgora=auto&&window.AUTO&&AUTO.peso!=null?Math.round(AUTO.peso):null;
  const fim=ok(it.real)?it.fim:(auto?pesoAgora:it.fim);
  return Object.assign(base,{dia:B.dia,trato:B.trato,rac:B.racNome,prod:it.nome||'',iProd:B.atual+1,nProd:B.itens.length,prev:ok(it.prev)?it.prev:null,
    ini:ok(it.ini)?it.ini:'',fim:ok(fim)?fim:'',feitos:B.itens.filter(x=>ok(x.real)).length,
    its:B.itens.map(x=>[x.nome,+x.prev||0,ok(x.real)?Math.round(x.real):null]),tela:auto&&window.telaAuto&&$('viewAutoC')&&!$('viewAutoC').hidden?telaAuto('ac'):null,ts0:B.ts0||0,bat:JSON.parse(JSON.stringify(Object.assign({},B,{escolha:false}))),deAp:B.deAp||'',contTs:B.contTs||0,carregado:B.itens.reduce((a,x)=>a+(ok(x.real)?x.real:0),0),totalPrev:B.itens.reduce((a,x)=>a+(+x.prev||0),0)});};
let cTec=null,cBuf='';
/* currais do trato que usam a ração (pelo lote) e o total previsto deles */
function sugestaoCarga(trato,racId,loc){const hj=hojeKey(),m=(S.prev||{})[String(trato)]||{},cs=[];let tot=0;
  gTodos('lote').filter(l=>cabPres(l,hj)>0).forEach(l=>{const r=racaoEm(l,hj),c=curralEm(l,hj);if(r&&r.uid===racId&&(!loc||linhaDe(c)===loc)&&typeof m[c]==='number'&&m[c]>0&&!cs.includes(c)){cs.push(c);tot+=m[c];}});
  return {cs:cs.sort(alfa),tot};}
function itensCarga(racId,total){const r=G.it[racId];const cp=r&&!r.del?compRacao(r,hojeKey()):null;if(!cp)return [];
  let resto=Math.round(total);return cp.itens.map((i,k,a)=>{const kg=k===a.length-1?resto:Math.round(total*i.pMN/100);resto-=kg;return {ins:i.ins?i.ins.uid:'',nome:i.nome,pMN:i.pMN,prev:kg,ini:null,fim:null,real:null};});}
const cAtiva=()=>CG.ativa||null;
/* a mesma batida aparece no Carregar manual (#cBox) e no Carregar da Automação (#acBox) */
const cAuto=()=>!!($('viewAutoC')&&!$('viewAutoC').hidden);
const cCaixa=()=>$(cAuto()?'acBox':'cBox');
function cRender(){const auto=cAuto(),b=$(auto?'acBox':'cBox'),o=$(auto?'cBox':'acBox');if(!b)return;if(o)o.innerHTML='';
  if(auto&&window.acTela){b.innerHTML=acTela(cAtiva()?null:cRemHTML()+cTelaNova(),cAtiva()?'':NOTA_BAT)+(cAtiva()?C_NOVA:'')+cBatidasHoje();if(window.acDepois)acDepois();return;}
  b.innerHTML=(cAtiva()?cTelaBatida()+C_NOVA:cRemHTML()+cTelaNova())+(cAtiva()?'':NOTA_BAT)+cBatidasHoje();}
const C_NOVA='<section class="panel abrirNovo"><p class="note">Esta batida está em aberto. Quer começar outra no lugar dela?</p><button data-c="cancelar">＋ Abrir nova batida</button></section>';
/* ---------- continuar em outro aparelho: batida aberta em outro celular/tablet (acabou bateria, travou) ---------- */
let cRem=[];
const cRemOk=(d,todos)=>d&&d.modo==='carga'&&d.bat&&d.bat.itens&&d.ap!==S.aparelho&&d.idade<4*3600e3
  &&!todos.some(e=>e.ap!==d.ap&&e.deAp===d.ap&&e.bat&&e.bat.ts0===d.bat.ts0);
async function cBuscarRemoto(){try{if(modoVer||!navigator.onLine||!apiUrl()||cAtiva())return;
  const j=await (await fetch(apiUrl()+'?acao=aovivo',{cache:'no-store'})).json();if(!j||!j.ok)return;
  const agora=+j.agora||Date.now(),L=Object.entries(j.dados||{}).map(([ap,d])=>Object.assign({ap},d,{idade:agora-(+d.tsServ||0)}));
  const novo=L.filter(d=>cRemOk(d,L)).sort((a,b)=>a.idade-b.idade),mud=JSON.stringify(novo.map(d=>[d.ap,d.bat.ts0,Math.round(d.idade/10000)]))!==JSON.stringify(cRem.map(d=>[d.ap,d.bat.ts0,Math.round(d.idade/10000)]));
  cRem=novo;if(mud&&!cAtiva()&&['carga','autoc'].includes(window.abaAtual))cRender();}catch(e){}}
window.cBuscarRemoto=cBuscarRemoto;
setInterval(()=>{if(!modoVer&&['carga','autoc'].includes(window.abaAtual)&&!cAtiva()&&document.visibilityState==='visible')cBuscarRemoto();},8000);
function cRemHTML(){if(!cRem.length)return '';
  return `<section class="panel contRem"><h2>🔄 Batida em aberto em outro aparelho</h2>${cRem.map(d=>{const B=d.bat,f=B.itens.filter(x=>ok(x.real)).length,kg=B.itens.reduce((a,x)=>a+(ok(x.real)?x.real:0),0),s=Math.round(d.idade/1000);
    return `<div class="contIt"><b>${B.avulso?'Avulsa':'Trato '+esc((B.tratos||[B.trato]).join('+'))} · ${esc(B.racNome||'')}${B.local?' · '+(B.local==='C'?'Confinamento':'Pasto'):''}</b>
      <span>${f} de ${B.itens.length} produtos · ${nf(kg)} de ${nf(B.total)} kg · ${s<20?'🟢 aparelho ativo agora':'parou há '+(s<60?s+' s':Math.round(s/60)+' min')}</span>
      <button class="primary" data-c="contRem" data-ap="${esc(d.ap)}">▶ Continuar esta batida daqui</button></div>`;}).join('')}
    <p class="note">Continua do produto em que parou, com o peso inicial que já estava marcado. O outro aparelho fecha a batida dele.</p></section>`;}
function cContinuarRem(ap){const d=cRem.find(x=>x.ap===ap);if(!d)return;
  const go=()=>{const B=JSON.parse(JSON.stringify(d.bat));B.deAp=d.ap;B.contTs=Date.now();B.escolha=false;CG.ativa=B;CG.local=B.local||null;CG.trato=B.trato;CG.rac=B.rac;CG.total=B.total;cRem=[];
    try{window.diagLog&&diagLog('batida_continuada',{de:d.ap,trato:B.trato,feitos:B.itens.filter(x=>ok(x.real)).length});}catch(e){}
    cSave();if(typeof enviarAoVivo==='function')enviarAoVivo(true);cRender();window.scrollTo({top:0});
    const it=B.itens[B.atual];toast(`Continuando a batida · ${it?it.nome:''}${it&&ok(it.ini)?' · início '+nf(it.ini)+' kg':''}`);};
  if(d.idade<20000&&!confirm('O outro aparelho ainda parece ativo (mandou sinal há menos de 20 s). Continuar a batida aqui mesmo assim?'))return;go();}
/* o aparelho original: se outro continuou a batida dele, fecha a dele */
async function cVerTomado(){try{const A=cAtiva();if(!A||modoVer||!navigator.onLine||!apiUrl())return;
  const j=await (await fetch(apiUrl()+'?acao=aovivo',{cache:'no-store'})).json();if(!j||!j.ok)return;
  const t=Object.entries(j.dados||{}).find(([ap,d])=>ap!==S.aparelho&&d&&d.deAp===S.aparelho&&d.bat&&d.bat.ts0===A.ts0&&(+d.contTs||0)>(A.contTs||0));
  if(!t||cAtiva()!==A)return;CG.ativa=null;cLimparSetup();cRender();
  try{window.diagLog&&diagLog('batida_tomada',{por:t[0],trato:A.trato});}catch(e){}
  toast('Esta batida foi continuada em outro aparelho. Ela foi fechada aqui.');}catch(e){}}
setInterval(()=>{if(document.visibilityState==='visible')cVerTomado();},15000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(cVerTomado,1500);});
const NOTA_BAT='<p class="note" style="text-align:center">As batidas feitas ficam no Histórico › Batidas.</p>';
/* embaixo do Carregar: as batidas feitas hoje, produto por produto (igual os currais no Fornecer) */
function cBatidasHoje(){try{const B=window.batidasLista?batidasLista(hojeKey(),hojeKey(),'T',0):[];
  return `<section class="panel"><div class="curhead"><h2>Batidas de hoje</h2><span class="note">${B.length?B.length+' batida(s)':''}</span></div>${B.length?batidasHTML(B,false,true):'<p class="note">Nenhuma batida concluída hoje ainda.</p>'}</section>`;}catch(e){return '';}}
/* ração ativa de cada curral hoje (pelo lote) e rações usadas em cada local (C = confinamento, P = pasto) */
function racaoDoCurral(c,dia){dia=dia||hojeKey();const l=gTodos('lote').find(l=>curralEm(l,dia)===c&&cabPres(l,dia)>0);const r=l&&racaoEm(l,dia);return r?r.uid:null;}
window.racaoDoCurral=racaoDoCurral;
function racoesDoLocal(loc,dia){dia=dia||hojeKey();const s=new Set();gTodos('lote').filter(l=>cabPres(l,dia)>0).forEach(l=>{const c=curralEm(l,dia),r=racaoEm(l,dia);if(c&&r&&(!loc||linhaDe(c)===loc))s.add(r.uid);});
  return racAtivas().filter(r=>s.has(r.uid)).sort(porNome);}
window.racoesDoLocal=racoesDoLocal;
const NOMELOC={C:'Confinamento',P:'Pasto'};
/* conta os currais com previsto hoje em cada local; modo 'forn' mostra fornecidos/total */
/* número nos botões do local: Carregar = currais com previsto hoje / currais com lote; Fornecer = currais já fornecidos / currais com lote */
function contaLocalPrev(k,modo){try{const hj=hojeKey(),P=S.prev||{},tot=cochoCurrais(hj).filter(c=>linhaDe(c)===k&&(typeof curralAtivo!=='function'||curralAtivo(c)));
  const tsDe=c=>Object.keys(P).filter(t=>+((P[t]||{})[c])>0);
  if(modo!=='forn')return tot.filter(c=>tsDe(c).length).length+'/'+tot.length;
  const H=typeof HIST!=='undefined'?HIST:[];const f=tot.filter(c=>{const ts=tsDe(c);return ts.length&&ts.every(t=>H.some(r=>r.dia===hj&&r.curral===c&&+r.trato===+t));}).length;return f+'/'+tot.length;}catch(e){return '';}}
function escolhaLocal(attr,sel){const modo=attr==='data-floc'?'forn':'carga';return `<div class="gLocal">${['C','P'].map(l=>`<button type="button" ${attr}="${l}" class="${sel===l?'sel':''}">${l==='C'?ICO_C+' Confinamento':'🌿 Pasto'}</button>`).join('')}</div>`;}
window.escolhaLocal=escolhaLocal;
/* tela de início em passos: escolhe o local → abre a ração → abre o trato → abre o total e o botão de iniciar */
function cTelaNova(){let h=cTelaNova0();if(CG.local&&!CG.ativa){const i=h.lastIndexOf('</section>');const bt='<button type="button" class="cCancelar" data-ccancel="1">✕ Cancelar batida</button>';h=i>=0?h.slice(0,i)+bt+h.slice(i):h+bt;}return h;}
function cTelaNova0(){if(!CG.passo){CG.passo=1;CG.local=null;}if(!CG.local)CG.passo=1;
  const ps=CG.passo,cont=n=>`<button type="button" class="lima cCont" data-cpasso="${n}">Continuar ▶</button>`;
  if(ps<=1||!CG.local)return `<section class="panel"><h2>Carregar vagão</h2><label>1. Local</label>${escolhaLocal('data-cloc',null)}<p class="note">Escolha o local para continuar.</p></section>`;
  const todas=racAtivas().sort(porNome);if(!todas.length)return `<section class="panel"><h2>Carregar vagão</h2><p class="note">Cadastre a ração primeiro em Gestão → Rações.</p></section>`;
  const doLocal=racoesDoLocal(CG.local),R=doLocal.length?doLocal:todas;
  if(CG.rac&&!R.some(r=>r.uid===CG.rac))CG.rac=null;if(!CG.rac&&R.length===1)CG.rac=R[0].uid;
  const passoRac=`<section class="panel"><h2>Carregar vagão</h2>
    <label>1. Local</label>${escolhaLocal('data-cloc',CG.local)}
    <div><label for="cRac">2. Ração</label><select id="cRac">${CG.rac?'':'<option value="" selected>— escolha a ração —</option>'}${R.map(r=>`<option value="${r.uid}"${r.uid===CG.rac?' selected':''}>${esc(r.nome)}</option>`).join('')}</select>
      ${doLocal.length===1?`<p class="note">Única ração ativa no ${NOMELOC[CG.local].toLowerCase()}: já selecionada.</p>`:!doLocal.length?`<p class="note">Nenhum lote com ração no ${NOMELOC[CG.local].toLowerCase()}: mostrando todas.</p>`:''}</div>`;
  if(!CG.rac)return passoRac+'</section>';
  const trC=tratosAtivos().filter(k=>sugestaoCarga(k,CG.rac,CG.local).tot>0);
  /* já vem escolhido o próximo trato a fazer (o 1º com currais pendentes); a pessoa pode voltar pela setinha */
  if(!CG.avulso&&typeof fornPendentes==='function'){const pend=k=>fornPendentes(CG.local,CG.rac,k).length,prox=trC.find(k=>pend(k));
    if(!CG.trato||(CG.tAuto&&prox&&+CG.trato!==prox&&!pend(+CG.trato))){CG.trato=prox||trC[trC.length-1]||null;CG.tAuto=true;}}
  else if(!CG.trato&&!CG.avulso&&trC.length===1)CG.trato=trC[0];  // só os tratos com previsto; se for um só, já vem escolhido
  CG.juntos=CG.avulso?[]:(CG.juntos||[]).filter(k=>k!==+CG.trato);const trs=[+CG.trato].concat(CG.juntos).sort((a,b)=>a-b);
  const partes=trs.map(k=>({k,sg:sugestaoCarga(k,CG.rac,CG.local)})),sg={tot:partes.reduce((a,p)=>a+p.sg.tot,0),cs:[...new Set(partes.flatMap(p=>p.sg.cs))]};
  const chave=CG.avulso?'avulso|'+CG.rac:CG.local+'|'+trs.join('+')+'|'+CG.rac;if(CG.totalDe!==chave){CG.total=CG.avulso?0:(sg.tot||0);CG.totalDe=chave;CG.ordem=null;CG.ja={};CG.sobModo='rac';CG.sobRac=null;CG.sobKg=0;CG.ordAberto=false;CG.jaAberto=false;cSave();}
  const its=itensAjust(itensCarga(CG.rac,CG.total||0));
  const passoTrato=passoRac+(CG.avulso?`
    <label>3. Trato</label><div class="cAvInfo">✳ Trato avulso · sem previsto, você digita a quantidade</div>`:`
    <label for="cTrato">3. Trato</label>${window.tratoSeta?tratoSeta('cTrato',CG.trato,'',trC):''}
    <div class="cBotoes c4"><button type="button" class="mini cAvulso" data-cavulso="1">✳ Avulso</button><button type="button" class="mini cJtTog${CG.juntoAberto?' sel':''}" data-cjtog="1">＋ Trato</button>${cBotAjuste()}</div>
    <div class="cJuntoLista">${CG.juntoAberto?tratosAtivos().filter(k=>k!==+CG.trato).map(k=>{const t=sugestaoCarga(k,CG.rac,CG.local).tot;return `<button type="button" data-cjunto="${k}" class="${CG.juntos.includes(k)?'sel':''}"${t||CG.juntos.includes(k)?'':' disabled'}><span>${CG.juntos.includes(k)?'✓ ':''}Trato ${k}</span>${t?`<small>${nf(t)} kg</small>`:''}</button>`;}).join(''):''}</div>`)+
    (CG.avulso?`<div class="cBotoes"><button type="button" class="mini cAvulso sel" data-cavulso="1">↩ Voltar para os tratos do previsto</button>${cBotAjuste()}</div>`:cJaTratadoHTML(trs));
  if(!CG.avulso&&!CG.trato)return passoTrato+'</section>';  // escolhe o trato antes de mostrar o total
  return passoTrato+`
    <div><label>4. Total a carregar (kg)${CG.avulso?' · digite':' · pode mudar'}</label><div class="campoX cTotWrap"><input class="big num" id="cTotal" type="text" readonly inputmode="none" value="${CG.total?nf(CG.total):''}" placeholder="${CG.avulso?'digite':''}" data-ct="total"><div class="cSetas"><button type="button" data-ctot="-50" aria-label="Menos 50 kg">▼</button><button type="button" data-ctot="50" aria-label="Mais 50 kg">▲</button></div></div>
</div>
    ${its.length&&CG.total>0?cTabelaCarga(its):''}
    <button class="primary" data-c="iniciar"${CG.total>0&&its.length?'':' disabled'}>▶ Iniciar batida</button></section>`;}
/* batida em andamento: mostra quando começou e dá para cancelar e começar outra */
function barraBatida(A){const h=A.ts0?new Date(A.ts0).toTimeString().slice(0,5):'';const outroDia=A.dia!==hojeKey();
  return `<div class="fBar${outroDia?' fBarVelha':''}"><span>${outroDia?'⚠ Batida de '+diaBR(A.dia).slice(0,5)+' ainda aberta':'Batida em andamento'}${h?' · iniciada '+h:''}${A.local?' · '+(A.local==='C'?'Confinamento':'Pasto'):''}${A.tratos&&A.tratos.length>1?' · Tratos '+A.tratos.join('+'):''}</span></div>`;}
window.barraBatida=barraBatida;
function cTelaBatida(){const A=cAtiva(),i=A.atual,it=A.itens[i],alvo=it&&ok(it.ini)?it.ini+it.prev:NaN,real=it&&ok(it.ini)&&ok(it.fim)?it.fim-it.ini:NaN,dif=real-(it?it.prev:0);
  const feitos=A.itens.filter(x=>ok(x.real)).length,tp=A.itens.reduce((a,x)=>a+x.prev,0),tr=A.itens.reduce((a,x)=>a+(ok(x.real)?x.real:0),0),tpf=A.itens.reduce((a,x)=>a+(ok(x.real)?x.prev:0),0);
  const cls=(d,p)=>typeof classeDesv==='function'?classeDesv(d,p):'';
  return `${barraBatida(A)}<section class="panel"><div class="curhead"><h2>Batida · ${A.avulso?'Avulsa':'Trato '+A.trato}</h2><span class="note">${esc(A.racNome)} · ${nf(A.total)} kg</span></div>
    <div class="curBox2"><div class="cbCur" data-c="escolher" role="button"><span>Produto ${i+1} de ${A.itens.length} <i class="seta">▼</i></span><b>${esc(it?it.nome:'—')}</b></div>
      <div class="cbPrev"><span>Carregar</span><b class="num">${it?nf(it.prev):'—'}</b></div></div>
    ${A.escolha?`<div class="escolha">${A.itens.map((x,k)=>`<button data-c="ir" data-i="${k}" class="${k===i?'sel':''}">${ok(x.real)?'✓ ':''}${esc(x.nome)} · ${nf(x.prev)} kg</button>`).join('')}</div>`:''}
    ${it&&ok(it.real)?`<p class="avisoJa">Este produto já foi carregado (${nf(it.real)} kg). Se registrar de novo, substitui.</p>`:''}
    <div><label>Balança no início (kg)</label><div class="campoX"><input class="big num" type="text" readonly inputmode="none" value="${it&&ok(it.ini)?it.ini:''}" data-ct="ini"></div></div>
    <div class="led"><span>Parar com balança em</span><b>${ok(alvo)?nf(alvo):'—'}</b></div>
    <div><label>Balança no final (kg)</label><div class="campoX"><input class="big num" type="text" readonly inputmode="none" value="${it&&ok(it.fim)?it.fim:''}" data-ct="fim"></div></div>
    <div class="res"><div><small>Carregado</small><b class="num">${ok(real)?nf(real):'—'}</b></div><div><small>Diferença do previsto</small><b class="num ${ok(real)?cls(dif,it.prev):''}">${ok(real)?(dif>0?'+':'')+nf(dif):'—'}</b></div></div>
    <button class="primary" data-c="registrar"${ok(real)&&real>0?'':' disabled'}>Registrar produto</button>
    <div class="row navtrato"><button data-c="ant"${i>0?'':' disabled'}>◀ Produto anterior</button><button class="lima" data-c="prox"${i<A.itens.length-1?'':' disabled'}>Próximo produto ▶</button></div></section>
  <section class="panel"><div class="curhead"><h2>Produtos da batida</h2><span class="note">${feitos} de ${A.itens.length}</span></div>
    <div class="tablebox"><table class="gTab"><thead><tr><th>Produto</th><th>Previsto</th><th>Carreg.</th><th>Dif.</th></tr></thead><tbody>
    ${A.itens.map((x,k)=>{const d=ok(x.real)?x.real-x.prev:NaN;return `<tr class="${k===i?'cur':''} gClic" data-c="ir" data-i="${k}"><td class="c">${ok(x.real)?'✓ ':''}${esc(x.nome)}</td><td>${nf(x.prev)}</td><td>${ok(x.real)?nf(x.real):'—'}</td><td class="${ok(d)?cls(d,x.prev):''}">${ok(d)?(d>0?'+':'')+nf(d):''}</td></tr>`;}).join('')}
    <tr class="grp"><td>Total</td><td>${nf(tp)}</td><td>${nf(tr)}</td><td>${feitos?(tr-tpf>0?'+':'')+nf(tr-tpf):''}</td></tr></tbody></table></div>
    <button class="primary" data-c="concluir"${feitos?'':' disabled'}>✓ Finalizar batida</button>
    <div class="row"><button data-c="desfazer"${feitos?'':' disabled'}>Desfazer último</button><button class="danger" data-c="cancelar">Cancelar batida</button></div></section>`;}
function cargasDia(dia){return gTodos('carga').filter(c=>c.dia===dia).sort((a,b)=>a.ts0-b.ts0);}
function cTelaDia(){const dia=CG.verDia||hojeKey(),L=cargasDia(dia);
  const cards=L.map(c=>{const tp=c.itens.reduce((a,x)=>a+x.prev,0),tr=c.itens.reduce((a,x)=>a+(+x.real||0),0),d=tr-tp;
    return `<details class="gMais gCarga"><summary><b>${esc(c.hora||'')}</b> · Trato ${c.trato} · ${esc(c.racNome)} <span class="num">${nf(tr)} kg <i class="${typeof classeDesv==='function'?classeDesv(d,tp):''}">(${d>0?'+':''}${nf(d)})</i></span></summary>
      <div class="tablebox"><table class="gTab"><thead><tr><th>Produto</th><th>Previsto</th><th>Carreg.</th><th>Dif.</th></tr></thead><tbody>${c.itens.map(x=>`<tr><td class="c">${esc(x.nome)}</td><td>${nf(x.prev)}</td><td>${ok(+x.real)?nf(+x.real):'—'}</td><td>${ok(+x.real)?((x.real-x.prev)>0?'+':'')+nf(x.real-x.prev):''}</td></tr>`).join('')}</tbody></table></div>
      <button class="mini danger" data-c="apagaCarga" data-id="${c.uid}">Apagar esta batida</button></details>`;}).join('');
  const tp=L.reduce((a,c)=>a+c.itens.reduce((s,x)=>s+x.prev,0),0),tr=L.reduce((a,c)=>a+c.itens.reduce((s,x)=>s+(+x.real||0),0),0);
  return `<section class="panel"><h2>Batidas do dia</h2>${navData('cDia',dia,'Data')}
    ${L.length?`<div class="stat gStat3">${st('Batidas',nf(L.length))}${st('Previsto',nf(tp)+' kg')}${st('Carregado',nf(tr)+' kg')}</div>${cards}
    <div class="row compart"><button class="verde" data-c="imgCarga">🖼 Foto</button><button class="verde" data-c="xlsCarga">📊 Excel</button></div>`:'<p class="note">Nenhuma batida nesta data.</p>'}</section>`;}
/* teclado numérico grande (igual ao do Tratar) */
function cTeclado(campo){if(bloqueado())return;cTec=campo;const A=cAtiva(),it=A&&A.itens[A.atual];
  const v=campo==='total'?CG.total:it?it[campo]:null;cBuf=ok(v)&&v?String(Math.round(v)):'';
  $('ctNome').textContent=campo==='total'?'Total a carregar (kg)':campo==='ini'?'Balança no início (kg)':'Balança no final (kg)';cMostra();$('tecCarga').hidden=false;
  document.body.classList.add('comteclado');cCaixa().querySelectorAll('[data-ct]').forEach(e=>e.classList.toggle('sel',e.dataset.ct===campo));
  requestAnimationFrame(()=>{const f=cCaixa().querySelector(`[data-ct="${campo}"]`);if(!f)return;const r=f.getBoundingClientRect(),livre=innerHeight-$('tecCarga').offsetHeight;
    const mb=typeof topoLivre==='function'?topoLivre():80;if(r.bottom>livre-12||r.top<mb)window.scrollBy({top:r.top-mb,behavior:'smooth'});});}
function cMostra(){$('ctValor').textContent=cBuf?nf(+cBuf):'—';}
function cFecha(){cTec=null;$('tecCarga').hidden=true;document.body.classList.remove('comteclado');document.querySelectorAll('#cBox [data-ct].sel,#acBox [data-ct].sel').forEach(e=>e.classList.remove('sel'));}
function cConfirma(){const v=cBuf===''?null:+cBuf,A=cAtiva();
  if(cTec==='total'){CG.total=v||0;cSave();}
  else if(A){const it=A.itens[A.atual];it[cTec]=v;if(cTec==='ini'&&v!=null&&!ok(it.fim))it.fim=null;cSave();}
  const prox=cTec==='ini'&&A&&!cAuto()?'fim':null;cFecha();cRender();if(prox)cTeclado(prox);}
(function(){const d=document.createElement('div');d.className='teclado';d.id='tecCarga';d.hidden=true;
  d.innerHTML=`<div class="tecTopo"><span id="ctNome"></span><b id="ctValor">—</b></div><div class="tecGrade">${[1,2,3,4,5,6,7,8,9].map(n=>`<button data-k="${n}">${n}</button>`).join('')}<button data-k="limpar" class="tecSec">Limpar</button><button data-k="0">0</button><button data-k="del" class="tecSec">⌫</button></div><div class="tecAcoes"><button data-k="fechar" class="tecSec">Fechar</button><button data-k="ok" class="tecOk">OK</button></div>`;
  document.body.appendChild(d);d.addEventListener('pointerdown',e=>e.preventDefault());
  d.addEventListener('click',e=>{const b=e.target.closest('button[data-k]');if(!b)return;const k=b.dataset.k;
    if(k==='fechar')return cFecha();if(k==='ok')return cConfirma();if(k==='limpar')cBuf='';else if(k==='del')cBuf=cBuf.slice(0,-1);else if(cBuf.length<6)cBuf=(cBuf+k).replace(/^0+(?=\d)/,'');cMostra();});})();
function cClique(e){
  const lb=e.target.closest('[data-cloc]');if(lb){const loc=lb.dataset.cloc;cLimparSetup();CG.local=loc;CG.passo=2;cSave();return cRender();}
  const cp=e.target.closest('[data-cpasso]');if(cp){CG.passo=+cp.dataset.cpasso;cSave();return cRender();}
  if(e.target.closest('[data-ccancel]')){cLimparSetup();cRender();window.scrollTo({top:0});toast('Batida cancelada');return;}
  if(e.target.closest('[data-cjtog]')){if(CG.juntoAberto){CG.juntoAberto=false;CG.juntos=[];}else CG.juntoAberto=true;cSave();return cRender();}  // fechar = tira os tratos juntos
  if(e.target.closest('[data-cordtog]')){CG.ordAberto=!CG.ordAberto;cSave();return cRender();}
  if(e.target.closest('[data-cjatog]')){if(CG.jaAberto){CG.jaAberto=false;CG.ja={};CG.sobRac=null;CG.sobKg=0;CG.sobModo='rac';}else CG.jaAberto=true;cSave();return cRender();}  // fechar = zera a sobra
  {const sm=e.target.closest('[data-csmodo]');if(sm){CG.sobModo=sm.dataset.csmodo;cSave();return cRender();}}
  {const m=e.target.closest('[data-cmov]');if(m){const its=itensAjust(itensCarga(CG.rac,CG.total||0)).map(i=>i.ins),i=its.indexOf(m.dataset.ins),j=i+(+m.dataset.cmov);
    if(i>=0&&j>=0&&j<its.length){[its[i],its[j]]=[its[j],its[i]];const pad=itensCarga(CG.rac,CG.total||0).map(i=>i.ins);CG.ordem=its.join('|')===pad.join('|')?null:its;cSave();cRender();}return;}}  // voltou à ordem original = sem mudança
  if(e.target.closest('[data-cordreset]')){CG.ordem=null;cSave();return cRender();}
  if(e.target.closest('[data-cavulso]')){CG.avulso=!CG.avulso;CG.juntos=[];CG.juntoAberto=false;CG.totalDe=null;cSave();return cRender();}
  const ct=e.target.closest('[data-ctot]');if(ct){CG.total=Math.max(0,(+CG.total||0)+(+ct.dataset.ctot));cSave();return cRender();}
  const jb=e.target.closest('[data-cjunto]');if(jb){const k=+jb.dataset.cjunto;CG.juntos=CG.juntos||[];CG.juntos=CG.juntos.includes(k)?CG.juntos.filter(x=>x!==k):CG.juntos.concat(k);cSave();return cRender();}
  const inp=e.target.closest('[data-ct]');if(inp)return cTeclado(inp.dataset.ct);
  const b=e.target.closest('[data-c],[data-g]');if(!b)return;
  if(b.dataset.g==='dataPasso'||b.dataset.g==='dataHoje'){const i=cCaixa().querySelector('#'+b.dataset.alvo)||$(b.dataset.alvo);i.value=b.dataset.g==='dataHoje'?hojeKey():somaDias(i.value||hojeKey(),+b.dataset.n);CG.verDia=i.value;cSave();return cRender();}
  const a=b.dataset.c,A=cAtiva();if(!a)return;
  if(a==='imgCarga'||a==='xlsCarga')return a==='imgCarga'?imgCarga():xlsCarga();
  if(bloqueado())return;
  if(a==='iniciar'){const r=G.it[CG.rac],tudo=itensAjust(itensCarga(CG.rac,CG.total)),its=tudo.filter(i=>i.prev>0),jaIt=tudo.filter(i=>i.ja>0).map(i=>({ins:i.ins,nome:i.nome,kg:i.ja}));if(!tudo.length)return toast('Ração sem fórmula');if(!its.length)return toast('Tudo já está no vagão: nada para carregar');
    CG.ativa={dia:hojeKey(),local:CG.local||'',avulso:!!CG.avulso,trato:CG.avulso?0:+CG.trato,tratos:CG.avulso?[]:[+CG.trato].concat(CG.juntos||[]).sort((a,b)=>a-b),rac:CG.rac,racNome:r.nome,total:its.reduce((a,i)=>a+i.prev,0),totalMistura:CG.total,jaNoVagao:jaIt,itens:its,atual:0,ts0:Date.now(),origem:cAuto()?'balanca':'manual'};cSave();cRender();window.scrollTo({top:0});if(cAuto()){if(window.acIniciou)acIniciou();return;}return cTeclado('ini');}
  if(a==='contRem')return cContinuarRem(b.dataset.ap);
  if(!A&&a!=='apagaCarga')return;
  if(a==='escolher'){A.escolha=!A.escolha;cSave();return cRender();}
  if(a==='ir'){A.atual=+b.dataset.i;A.escolha=false;cSave();return cRender();}
  if(a==='prox'&&cAuto()&&window.acProximo)return acProximo();
  if(a==='ant'||a==='prox'){A.atual=Math.max(0,Math.min(A.itens.length-1,A.atual+(a==='ant'?-1:1)));const it=A.itens[A.atual],pv=A.itens[A.atual-1];if(a==='prox'&&!ok(it.ini)&&pv&&ok(pv.fim))it.ini=pv.fim;cSave();return cRender();}
  if(a==='registrar'&&cAuto())return window.acRegistrar&&acRegistrar();
  if(a==='registrar'){const it=A.itens[A.atual];if(!(ok(it.ini)&&ok(it.fim)&&it.fim>it.ini))return toast('A balança no final precisa ser maior que no início');
    it.real=it.fim-it.ini;it.hora=new Date().toTimeString().slice(0,5);it.tsReg=Date.now();
    const k=A.itens.findIndex((x,j)=>j>A.atual&&!ok(x.real)),nx=k>=0?k:A.itens.findIndex(x=>!ok(x.real));
    if(nx>=0){A.atual=nx;const n=A.itens[nx];if(!ok(n.real)){n.ini=it.fim;n.fim=null;}}
    cSave();toast(`${it.nome}: ${nf(it.real)} kg`);cRender();if(nx>=0)cTeclado('fim');else toast('Todos os produtos carregados. Toque em Finalizar batida.');return;}
  if(a==='desfazer'){(async()=>{const ult=A.itens.filter(x=>ok(x.real)).sort((p,q)=>(q.tsReg||0)-(p.tsReg||0)||(q.hora||'').localeCompare(p.hora||''))[0];if(!ult)return;if(!await confirmaVermelho('Deseja realmente desfazer o último produto?',`${ult.nome} (${nf(ult.real)} kg) volta a ficar para carregar.`,'Sim, desfazer','Não, manter'))return;if(CG.ativa!==A)return;const feitos=A.itens.map((x,j)=>[x,j]).filter(([x])=>ok(x.real)).sort((p,q)=>((q[0].tsReg||0)-(p[0].tsReg||0))||(q[0].hora||'').localeCompare(p[0].hora||'')||(q[1]-p[1]));if(!feitos.length)return;
    const [x,j]=feitos[0];x.real=null;x.fim=null;A.atual=j;cSave();cRender();})();return;}
  if(a==='cancelar'){const feitos=A.itens.filter(x=>ok(x.real)).length;
    confirmaVermelho('Deseja realmente cancelar a batida?',`${feitos?`Os ${feitos} produto(s) já carregado(s) nesta batida serão perdidos.`:'Esta batida será descartada.'} Nada dela será salvo e não dá para desfazer.`,'Sim, cancelar batida','Não, continuar carregando')
      .then(sim=>sim&&confirmaVermelho('Tem certeza?','A batida será cancelada agora.','Sim, cancelar a batida','Não, voltar')).then(sim=>{if(!sim)return;if(CG.ativa!==A)return;CG.passo=1;CG.local=null;CG.juntos=[];CG.avulso=false;CG.juntoAberto=false;try{window.diagLog&&diagLog('batida_cancelada',{trato:A.trato,itens:A.itens.map(x=>[x.nome,x.prev,x.real])});}catch(e){}CG.ativa=null;cLimparSetup();cRender();toast('Batida cancelada');window.scrollTo({top:0});});return;}
  if(a==='concluir'){const falta=A.itens.filter(x=>!ok(x.real)).length;if(falta&&!confirm(`Faltam ${falta} produto(s). Finalizar assim mesmo?`))return;
    gPut({uid:novoId('carga'),tipo:'carga',dia:A.dia,local:A.local||'',avulso:!!A.avulso,trato:A.trato,tratos:A.tratos||[A.trato],racao:A.rac,racNome:A.racNome,total:A.total,ts0:A.ts0,hora:new Date(A.ts0).toTimeString().slice(0,5),
      itens:A.itens.map(x=>({ins:x.ins,nome:x.nome,pMN:x.pMN,prev:x.prev,ini:x.ini,fim:x.fim,real:ok(x.real)?x.real:null,hora:x.hora||''})),origem:A.origem||''});
    CG.ativa=null;CG.verDia=A.dia;cLimparSetup();toast('Batida salva');cRender();window.scrollTo({top:0});return;}
  if(a==='apagaCarga'){if(!confirm('Apagar esta batida?'))return;gDel(b.dataset.id);return cRender();}
}
$('cBox').addEventListener('click',cClique);$('acBox').addEventListener('click',cClique);
function cMuda(e){const t=e.target;
  if(t.id==='cSobRac'){CG.sobRac=t.value||null;cSave();cRender();return;}
  if(t.id==='cSobKg'){const v=gNum(t.value);CG.sobKg=v>0?v:0;cSave();cRender();return;}
  if(t.dataset&&t.dataset.cja){CG.ja=CG.ja||{};const v=gNum(t.value);if(v>0)CG.ja[t.dataset.cja]=v;else delete CG.ja[t.dataset.cja];cSave();cRender();return;}
  if(t.id==='cTrato'){CG.trato=+t.value||null;CG.tAuto=false;cSave();cRender();}
  if(t.id==='cRac'){CG.rac=t.value||null;CG.trato=null;if(CG.rac)CG.passo=Math.max(CG.passo||1,3);cSave();cRender();}
  if(t.id==='cDia'){CG.verDia=t.value||hojeKey();cSave();cRender();}}
$('cBox').addEventListener('change',cMuda);$('acBox').addEventListener('change',cMuda);
function imgCarga(){const dia=CG.verDia||hojeKey(),L=cargasDia(dia);
  enviarImg(`Batidas do vagão · ${dB(dia)}`,L.map(c=>{const tp=c.itens.reduce((a,x)=>a+x.prev,0),tr=c.itens.reduce((a,x)=>a+(+x.real||0),0);
    return {cab:`${c.hora} · Trato ${c.trato} · ${c.racNome}`,cols:[['Produto',330,'l'],['Previsto',170,'r'],['Carregado',170,'r'],['Diferença',170,'r']],
      linhas:c.itens.map(x=>[x.nome,nf(x.prev),ok(+x.real)?nf(+x.real):'—',ok(+x.real)?((x.real-x.prev)>0?'+':'')+nf(x.real-x.prev):'']),
      cores:c.itens.map(x=>{const d=x.real-x.prev;return [null,null,null,null,!ok(+x.real)?null:Math.abs(d)/x.prev<=.03?'#5f7a00':Math.abs(d)/x.prev<=.08?'#b26a00':'#b3261e'];}),
      total:['TOTAL',nf(tp),nf(tr),(tr-tp>0?'+':'')+nf(tr-tp)]};}),`Batidas ${dB(dia).replace(/\//g,'-')}`);}
function xlsCarga(){const dia=CG.verDia||hojeKey(),L=cargasDia(dia),r=[];
  L.forEach(c=>c.itens.forEach(x=>r.push([xc(dia,'dia'),xc(c.hora),xc(c.trato,'int'),xc(c.racNome),xc(x.nome),xc(x.prev,'int'),xc(ok(+x.real)?+x.real:NaN,'int'),xc(ok(+x.real)?x.real-x.prev:NaN,'int'),xc(ok(+x.ini)?+x.ini:NaN,'int'),xc(ok(+x.fim)?+x.fim:NaN,'int')])));
  gExcel(`Batidas ${dB(dia).replace(/\//g,'-')}`,[['Batidas',['Data','Hora','Trato','Ração','Produto','Previsto (kg)','Carregado (kg)','Diferença (kg)','Balança início','Balança final'],r,[11,7,7,16,22,12,13,13,13,13]]]);}
$('tabCarga').addEventListener('click',()=>aba('carga'));
window.cAoAbrir=()=>{cLimparSetup();cRender();cBuscarRemoto();};window.cLimparSetup=cLimparSetup;window.cFecha=cFecha;

/* confirmação com aviso em vermelho (ex.: cancelar batida) */
function confirmaVermelho(tit,txt,sim,nao){return new Promise(res=>{
  if(!document.getElementById('cvEstilo')){const st=document.createElement('style');st.id='cvEstilo';st.textContent=`.cvFundo{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px}
.cvCaixa{background:var(--card,#fff);border-radius:16px;max-width:420px;width:100%;padding:20px;border:3px solid #d32f2f;box-shadow:0 10px 40px rgba(0,0,0,.35)}
.cvCaixa h3{margin:0 0 10px;color:#d32f2f;font-size:1.25rem}.cvCaixa p{margin:0 0 18px;color:#d32f2f;font-weight:600;line-height:1.35}
.cvCaixa .cvBt{display:grid;gap:10px}.cvCaixa button{padding:14px;font-size:1rem;border-radius:12px}.cvCaixa .cvSim{background:#d32f2f;color:#fff;border-color:#d32f2f}`;document.head.appendChild(st);}
  const f=document.createElement('div');f.className='cvFundo';
  f.innerHTML=`<div class="cvCaixa" role="alertdialog"><h3>⚠️ ${esc(tit)}</h3><p>${esc(txt)}</p><div class="cvBt"><button class="cvSim">${esc(sim)}</button><button class="cvNao">${esc(nao)}</button></div></div>`;
  const fim=v=>{f.remove();res(v);};
  f.querySelector('.cvSim').onclick=()=>fim(true);f.querySelector('.cvNao').onclick=()=>fim(false);
  f.addEventListener('click',e=>{if(e.target===f)fim(false);});document.body.appendChild(f);});}
window.confirmaVermelho=confirmaVermelho;

document.addEventListener('change',e=>{if(e.target&&e.target.id==='cfgComp'){const c=JSON.parse(JSON.stringify(gCfg()));c.compensa=e.target.value==='1';gPut(c);toast(c.compensa?'Compensação ligada':'Compensação desligada');}});

/* ---------- Histórico › Batidas: o que foi carregado no vagão (previsto e carregado de cada ingrediente, data e hora) ---------- */
window.batidasLista=(pa,pb,loc,t)=>gTodos('carga').filter(c=>c.dia>=pa&&c.dia<=pb&&(!loc||loc==='T'||c.local===loc||(!c.local&&false))&&(!t||+c.trato===+t||(c.tratos||[]).includes(+t)))
  .sort((a,b)=>(a.dia+(a.hora||'')).localeCompare(b.dia+(b.hora||'')));  // da primeira batida para a última
window.batidasHTML=(L,mostrarDia,semApagar)=>{if(!L.length)return '<p class="note">Nenhuma batida neste filtro.</p>';
  return L.map(c=>{const tp=c.itens.reduce((a,x)=>a+(+x.prev||0),0),tr=c.itens.reduce((a,x)=>a+(+x.real||0),0),d=tr-tp,cls=(dd,p)=>typeof classeDesv==='function'?classeDesv(dd,p):'';
    return `<details class="gMais gCarga" open><summary><b>${mostrarDia?diaBR(c.dia).slice(0,5)+' ':''}${esc(c.hora||'')}</b> · ${c.avulso?'Avulsa':c.tratos&&c.tratos.length>1?'Tratos '+c.tratos.join('+'):'Trato '+c.trato}${c.local?' · '+(c.local==='C'?'Confinamento':'Pasto'):''} · ${esc(c.racNome||'')} <span class="num">${nf(tr)} kg <i class="${cls(d,tp)}">(${d>0?'+':''}${nf(d)})</i></span></summary>
      <div class="tablebox"><table class="gTab"><thead><tr><th>Hora</th><th>Insumos</th><th>Previsto</th><th>Carreg.</th><th>Dif.</th></tr></thead><tbody>${c.itens.map(x=>{const dd=x.real-x.prev;return `<tr><td>${esc(x.hora||'')}</td><td class="c">${esc(x.nome)}</td><td>${nf(x.prev)}</td><td>${ok(+x.real)?nf(+x.real):'—'}</td><td class="${ok(+x.real)?cls(dd,x.prev):''}">${ok(+x.real)?(dd>0?'+':'')+nf(dd):''}</td></tr>`;}).join('')}
      <tr class="grp"><td></td><td>Total</td><td>${nf(tp)}</td><td>${nf(tr)}</td><td>${(d>0?'+':'')+nf(d)}</td></tr></tbody></table></div>
      ${semApagar||(typeof modoVer!=='undefined'&&modoVer)?'':`<div class="gBatAc"><button class="mini" data-hbed="${c.uid}">✎ Editar</button><button class="mini danger" data-hbdel="${c.uid}">✕ Apagar</button></div>`}</details>`;}).join('');};
/* relatório de batidas — tipo: 'sep' (uma imagem por batida), 'juntas' (todas numa imagem, subtotal azul claro + total geral), 'insumo' (total de cada insumo), 'todos' */
const COLB=[['Hora',110,'l'],['Insumos',330,'c'],['Previsto',170,'r'],['Carregado',170,'r'],['Diferença',170,'r']];
const sgnB=d=>(d>0?'+':'')+nf(d),corB=(r,p)=>!ok(+r)||!p?null:Math.abs(r-p)/p<=.03?'#5f7a00':Math.abs(r-p)/p<=.08?'#b26a00':'#b3261e';
function secaoBat(c,sub,semData){const tp=c.itens.reduce((a,x)=>a+x.prev,0),tr=c.itens.reduce((a,x)=>a+(+x.real||0),0);
  return {cab:`${semData?'':diaBR(c.dia).slice(0,5)+' '}${c.hora} · Trato ${c.trato}${c.local?' · '+(c.local==='C'?'Confinamento':'Pasto'):''} · ${c.racNome}`,cols:COLB,
    linhas:c.itens.map(x=>[x.hora||'',x.nome,nf(x.prev),ok(+x.real)?nf(+x.real):'—',ok(+x.real)?sgnB(x.real-x.prev):'']),
    cores:c.itens.map(x=>[null,null,null,corB(x.real,x.prev)]),
    total:[sub?'SUBTOTAL':'TOTAL','',nf(tp),nf(tr),sgnB(tr-tp)],sub,_p:tp,_r:tr};}
function secsBatJuntas(L){const umDia=new Set(L.map(c=>c.dia)).size===1;const secs=L.map(c=>secaoBat(c,L.length>1,umDia));let GP=0,GR=0;secs.forEach(x=>{GP+=x._p;GR+=x._r;});secs.umaLinha=true;
  if(secs.length>1)secs.totalGeral={cols:COLB,v:['TOTAL - FABRICAÇÃO','',nf(GP),nf(GR),sgnB(GR-GP)]};return secs;}
function secsBatInsumo(L,rot){const m=new Map();L.forEach(c=>c.itens.forEach(x=>{const o=m.get(x.nome)||{p:0,r:0,n:0};o.p+=+x.prev||0;if(ok(+x.real))o.r+=+x.real;o.n++;m.set(x.nome,o);}));
  const ls=[...m.entries()].sort((a,b)=>b[1].p-a[1].p),C=[['Insumos',440,'c'],['Previsto',170,'r'],['Carregado',170,'r'],['Diferença',170,'r']];
  const tp=ls.reduce((a,[,o])=>a+o.p,0),tr=ls.reduce((a,[,o])=>a+o.r,0);
  const s=[{cab:'Utilização de insumos',cols:C,linhas:ls.map(([n,o])=>[n,nf(o.p),nf(o.r),sgnB(o.r-o.p)]),
    cores:ls.map(([,o])=>[null,null,corB(o.r,o.p)])}];s.umaLinha=true;return s;}
window.imgBatidas=async(L,rot,tipo)=>{tipo=tipo||'juntas';const pdf=window.__expPdf;window.__expPdf=false;
  const tit=`FJK - Fabricação de Ração - ${rot}`,base=nomeArq(`Fabricação-${rot.replace(/\//g,'-').replace(/ a /,'_a_')}`),blobs=[],nomes=[];
  try{
    if(tipo==='sep'||tipo==='todos')for(const c of L){const s=[secaoBat(c,false,true)];s.umaLinha=true;blobs.push(await gImagem(tit,s));nomes.push(nomeArq(`${base} (Trato ${c.trato} ${c.hora.replace(':','h')})`)+'.png');}
    if(tipo==='juntas'||tipo==='todos'){const sj=secsBatJuntas(L);if(L.length>1)sj.depois=secsBatInsumo(L,rot);blobs.push(await gImagem(tit,sj));nomes.push(base+(tipo==='todos'?' (batidas juntas)':'')+'.png');}
    if(tipo==='insumo'||tipo==='todos'){blobs.push(await gImagem(tit,secsBatInsumo(L,rot)));nomes.push(base+' (por insumo).png');}
    if(pdf)return await compartilharArquivo(await pngsParaPdf(blobs),base+'.pdf','application/pdf');
    if(blobs.length===1)return await compartilharArquivo(blobs[0],nomes[0],'image/png');
    return await compartilharVarios(blobs,nomes);
  }catch(e){console.error(e);toast(pdf?'Não consegui gerar o PDF':'Não consegui gerar a imagem');}};
window.xlsBatidas=(L,rot)=>{const r=[];L.forEach(c=>c.itens.forEach(x=>r.push([xc(c.dia,'dia'),xc(c.hora),xc(x.hora||''),xc(c.trato,'int'),xc(c.local==='C'?'Confinamento':c.local==='P'?'Pasto':''),xc(c.racNome),xc(x.nome),xc(x.prev,'int'),xc(ok(+x.real)?+x.real:NaN,'int'),xc(ok(+x.real)?x.real-x.prev:NaN,'int'),xc(ok(+x.ini)?+x.ini:NaN,'int'),xc(ok(+x.fim)?+x.fim:NaN,'int')])));
  /* aba das batidas (uma linha por batida) e aba da utilização de insumos (soma de todas as batidas) */
  const rb=L.map(c=>{const tp=c.itens.reduce((a,x)=>a+x.prev,0),tr=c.itens.reduce((a,x)=>a+(+x.real||0),0);return [xc(c.dia,'dia'),xc(c.hora),xc(c.trato,'int'),xc(c.local==='C'?'Confinamento':c.local==='P'?'Pasto':''),xc(c.racNome),xc(tp,'int'),xc(tr,'int'),xc(tr-tp,'int')];});
  const mi=new Map();L.forEach(c=>c.itens.forEach(x=>{const o=mi.get(x.nome)||{p:0,r:0};o.p+=+x.prev||0;if(ok(+x.real))o.r+=+x.real;mi.set(x.nome,o);}));
  const ri=[...mi.entries()].sort((a,b)=>b[1].p-a[1].p).map(([n,o])=>[xc(n),xc(o.p,'int'),xc(o.r,'int'),xc(o.r-o.p,'int')]);
  gExcel(`Fabricação-${rot.replace(/\//g,'-').replace(/ a /,'_a_')}`,[['Fabricação',['Data','Início batida','Hora insumo','Trato','Local','Ração','Insumo','Previsto (kg)','Carregado (kg)','Diferença (kg)','Balança início','Balança final'],r,[11,9,9,7,13,16,22,12,13,13,13,13]],
    ['Por batida',['Data','Início','Trato','Local','Ração','Previsto (kg)','Carregado (kg)','Diferença (kg)'],rb,[11,9,7,13,18,13,14,14]],
    ['Utilização de insumos',['Insumo','Previsto (kg)','Carregado (kg)','Diferença (kg)'],ri,[24,13,14,14]]]);};
/* Histórico › Batidas: ✎ editar (kg de cada insumo) e ✕ apagar, com a senha 1010 */
document.addEventListener('click',async e=>{const b=e.target.closest('[data-hbdel]');if(!b)return;if(typeof bloqueado==='function'&&bloqueado())return;
  if(!await pedirSenhaAcao('Senha para apagar'))return;if(!await confirmaVermelho('Apagar esta batida?','Some do histórico, dos relatórios e do estoque.','Sim, apagar','Não'))return;gDel(b.dataset.hbdel);toast('Batida apagada');if(typeof renderHist==='function')renderHist();});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-hbed]');if(!b)return;if(typeof bloqueado==='function'&&bloqueado())return;const c=G.it[b.dataset.hbed];if(!c||c.del)return;
  if(!await pedirSenhaAcao('Senha para editar'))return;
  const f=document.createElement('div');f.className='cvFundo';
  f.innerHTML=`<div class="cvCaixa gBatEd" style="border-color:#2e6b2f"><h3 style="color:#2e6b2f">✎ Editar batida · ${esc(diaBR(c.dia).slice(0,5))} ${esc(c.hora||'')}</h3>
    <label>Data<input type="date" id="bedDia" value="${esc(c.dia)}"></label><label>Hora<input type="time" id="bedHora" value="${esc(c.hora||'')}"></label>
    ${c.itens.map((x,i)=>`<label>${esc(x.nome)} · previsto ${nf(x.prev)} kg<input class="num" inputmode="decimal" data-bed="${i}" value="${ok(+x.real)?+x.real:''}" placeholder="kg carregado"></label>`).join('')}
    <div class="cvBt"><button class="cvSim" style="background:#2e6b2f;border-color:#2e6b2f">Salvar</button><button class="cvNao">Cancelar</button></div></div>`;
  document.body.appendChild(f);f.querySelector('.cvNao').onclick=()=>f.remove();
  f.querySelector('.cvSim').onclick=()=>{const x=JSON.parse(JSON.stringify(c));f.querySelectorAll('[data-bed]').forEach(inp=>{const v=gNum(inp.value);x.itens[+inp.dataset.bed].real=ok(v)?v:null;});
    const d=f.querySelector('#bedDia').value,h=f.querySelector('#bedHora').value;if(d)x.dia=d;if(h)x.hora=h;gPut(x);f.remove();toast('Batida alterada');if(typeof renderHist==='function')renderHist();};});

/* ---------- Gestão › Currais: nome, tipo (confinamento/pasto) e ativo/inativo ---------- */
function tCurrais(){const A=window.curraisApi;if(!A)return '';const L=A.lista().map(n=>({n,i:A.info(n)}));
  const lotesEm=n=>gTodos('lote').filter(l=>cabPres(l,hojeKey())>0&&curralEm(l,hojeKey())===n).length;
  const item=x=>`<button class="gItem${x.i.inativo?' gInativa':''}" data-g="ir" data-t="curForm" data-id="${esc(x.n)}"><div class="gItemTopo"><b>${esc(x.n)}${x.i.tag?' <small title="Tem tag">🏷</small>':''}</b><span class="pill${lotesEm(x.n)?' done':''}">${x.i.inativo?'inativo':lotesEm(x.n)?lotesEm(x.n)+' lote(s)':'sem lote'}</span></div></button>`;
  const grupo=(tit,arr)=>arr.length?`<h3 class="gSub">${tit} · ${arr.length}</h3>${arr.map(item).join('')}`:'';
  const at=L.filter(x=>!x.i.inativo),ina=L.filter(x=>x.i.inativo);
  return `<section class="panel"><h2>Currais</h2><p class="note">O tipo diz se o curral é do confinamento ou do pasto; vale para os filtros, o Carregar e o Fornecer. Inativo não aparece no Previsto, no Fornecer nem nos lotes (os registros continuam).</p>
    <button class="lima" data-g="ir" data-t="curForm">+ Novo curral</button>
    ${grupo(ICO_C+' Confinamento',at.filter(x=>x.i.tipo==='C'))}${grupo('🌿 Pasto',at.filter(x=>x.i.tipo==='P'))}${grupo('Sem tipo',at.filter(x=>x.i.tipo!=='C'&&x.i.tipo!=='P'))}</section>
    ${ina.length?`<section class="panel"><h2>Inativos</h2>${ina.map(item).join('')}</section>`:''}`;}
function tCurForm(t){const A=window.curraisApi,n=t.id||'',i=n?A.info(n):{tipo:'C',inativo:false};
  return `${voltar()}<section class="panel"><h2>${n?'Curral '+esc(n):'Novo curral'}</h2>
    <div class="gForm">${campo({k:'cnome',l:'Nome do curral',v:n,ph:'Ex.: C-11 ou P-REPRESA-2'})}
    ${campo({k:'ctipo',l:'Tipo',t:'sel',op:[['C','🏠 Confinamento'],['P','🌿 Pasto']],v:i.tipo==='P'?'P':'C'})}
    ${campo({k:'catv',l:'Situação',t:'sel',op:[['1','Ativo'],['0','Inativo (não usa mais)']],v:i.inativo?'0':'1'})}
    <div class="gCampo"><label for="gf_ctag">Tag do curral (leitor de tag)</label><div class="gTagLin"><input type="text" id="gf_ctag" value="${esc(i.tag||'')}" placeholder="Ex.: E28011C1200001D461D50375" autocomplete="off" autocapitalize="characters"><button type="button" class="mini lima" data-g="lerTag">🏷 Ler tag</button></div><p class="note" id="gTagMsg">Toque em Ler tag e passe o leitor na tag deste curral. Pode também digitar o código.</p></div></div>
    <button class="primary" data-g="salvaCur" data-id="${esc(n)}">Salvar curral</button></section>`;}
document.addEventListener('click',e=>{const b=e.target.closest('#gBox [data-g="salvaCur"]');if(!b)return;if(typeof bloqueado==='function'&&bloqueado())return;
  const A=window.curraisApi,n=b.dataset.id,nome=fv('cnome'),tag=String(fv('ctag')).toUpperCase().replace(/[^0-9A-F]/g,''),info={tipo:fv('ctipo')==='P'?'P':'C',inativo:fv('catv')==='0',tag};
  if(tag&&tag.length<8)return toast('Tag muito curta: confira o código');
  if(tag){const outro=A.lista().find(x=>x!==n&&String(A.info(x).tag||'').toUpperCase()===tag);if(outro)return toast(`Esta tag já está no ${outro}`);}
  if(window.tagCaptura)tagCaptura(null);
  const erro=n?A.salvar(n,nome,info):A.novo(nome,info);if(erro)return toast(erro);toast('Curral salvo');gVoltar();},true);

document.addEventListener('click',e=>{const b=e.target.closest('#gBox [data-g="lerTag"]');if(!b)return;const inp=$('gf_ctag'),m=$('gTagMsg');if(!inp)return;
  if(!window.tagCaptura){toast('Leitor de tag indisponível');return;}
  tagCaptura('gf_ctag',m);},true);
/* novo lote: escolheu Confinamento ou Pasto → a lista mostra só os currais desse tipo */
document.addEventListener('change',e=>{if(e.target.id!=='gf_sistema'||GT.t!=='loteForm')return;const c=$('gf_curral');if(!c)return;
  const ops=opCurraisTipo(tipoDoSistema(e.target.value));c.innerHTML=ops.map(([v,t])=>`<option value="${esc(v)}">${esc(t)}</option>`).join('');});

/* Lotes: exportar a lista (com o filtro de local) em imagem e Excel */
function linhasLotes(enc){const hj=hojeKey(),X=gCtx(),loc=gLoc,noLocal=l=>loc==='T'||linhaDe(curralEm(l,fimLote(l)||hj))===loc;
  const todos=gTodos('lote').filter(noLocal),L=enc?todos.filter(l=>!ativo(l)).sort(porNome):todos.filter(ativo).sort(porCurral);
  return L.map(l=>{const fim=fimLote(l),ref=fim&&fim<hj?fim:hj,m=mediaLote(l,X),C=calcLote(l),r=racaoEm(l,ref);
    return {c:curralEm(l,ref)||'',nome:l.nome,desc:[sexoTxt(l.sexo),l.raca,catNorm(l.cat)].filter(Boolean).join(' · '),rac:r?r.nome:'',cab:cabPres(l,ref),pe:+l.ent.peso||0,pp:pesoEm(l,ref),
      dias:Math.max(0,difDias(l.ent.dia,ref)),mn:m.n?m.mn/m.n:NaN,ms:m.nms?m.ms/m.nms:NaN,ims:m.nms?m.pv/m.nms:NaN,...(()=>{const V=vendaEst(l,C);return {ve:V.venda,vr:V.res,vreal:!!V.real};})(),cd:C.custoCabDia,ctr:C.cabE?(C.alim+C.op)/C.cabE:NaN,cco:C.cabE?C.compra/C.cabE:NaN,ct:C.cabE?C.custo/C.cabE:NaN,tot:C.custo,ent:l.ent.dia,fim:fim||''};});}
document.addEventListener('click',e=>{const b=e.target.closest('#gBox [data-g="lotesImg"],#gBox [data-g="lotesXls"],#gBox [data-g="lotesPdf"]');if(!b)return;e.stopPropagation();
  const enc=!!b.dataset.enc,R=linhasLotes(enc),loc=gLoc==='C'?' · Confinamento':gLoc==='P'?' · Pasto':'',tit=`${enc?'Lotes arquivados':'Lotes ativos'}${loc} · ${dB(hojeKey())}`;
  if(!R.length)return toast('Nenhum lote');
  window.__expPdf=b.dataset.g==='lotesPdf';
  if(b.dataset.g==='lotesImg'||b.dataset.g==='lotesPdf'){
    /* linha TOTAL: nº de lotes, soma das cabeças e média (pelas cabeças) do resto; custo, venda e resultado vão num quadro separado embaixo */
    const cabT=R.reduce((a,x)=>a+(+x.cab||0),0),med=(f,d)=>{let s=0,n=0;R.forEach(x=>{const v=f(x);if(ok(v)&&x.cab>0){s+=v*x.cab;n+=x.cab;}});return n?s/n:NaN;},
      som=f=>R.reduce((a,x)=>a+(ok(f(x))?f(x):0),0),mostra=(v,fn)=>ok(v)?fn(v):'—';
    const cT=som(x=>x.tot),temV=R.some(x=>ok(x.ve)),vT=temV?som(x=>x.ve):NaN,rT=temV?som(x=>x.vr):NaN;
    return enviarImg(tit,[{cab:tit,cols:[['Curral',100,'l'],['Lote',200,'l'],['Cab',65,'r'],['Peso proj.',100,'r'],['Dias',60,'r'],['MN/cab',85,'r'],['MS/cab',85,'r'],['% IMS',80,'r'],['R$/cab/dia',110,'r'],['R$/cab tratos',125,'r'],['R$/cab compra',130,'r'],['Custo total',140,'r'],['Venda est.',140,'r'],['Resultado',140,'r']],
    linhas:R.map(x=>[x.c,x.nome,nf(x.cab),nf(x.pp),nf(x.dias),ok(x.mn)?nf(x.mn,1):'—',ok(x.ms)?nf(x.ms,2):'—',ok(x.ims)?pc(x.ims,2):'—',ok(x.cd)?rs(x.cd):'—',ok(x.ctr)?rs(x.ctr):'—',ok(x.cco)?rs(x.cco):'—',rs(x.tot),ok(x.ve)?rs(x.ve):'—',ok(x.vr)?rs(x.vr):'—']),
    total:['TOTAL',`${R.length} lote(s)`,nf(cabT),mostra(med(x=>x.pp),v=>nf(v)),mostra(med(x=>x.dias),v=>nf(v)),mostra(med(x=>x.mn),v=>nf(v,1)),mostra(med(x=>x.ms),v=>nf(v,2)),mostra(med(x=>x.ims),v=>pc(v,2)),mostra(med(x=>x.cd),rs),mostra(med(x=>x.ctr),rs),mostra(med(x=>x.cco),rs),'','','']},
    {cab:'Somatório dos lotes',cols:[['Custo total',520,'c'],['Venda estimada',520,'c'],['Resultado',520,'c']],linhas:[[rs(cT),mostra(vT,rs),mostra(rT,rs)]],cores:[[null,null,!ok(rT)?null:rT<0?'#b3261e':'#2e7d32']]}],`Lotes ${dB(hojeKey()).replace(/\//g,'-')}`);}
  gExcel(`Lotes ${dB(hojeKey()).replace(/\//g,'-')}`,[['Lotes',['Curral','Lote','Sexo · raça · categoria','Ração','Entrada','Arquivado em','Cabeças','Peso entrada (kg)','Peso projetado (kg)','Dias','MN/cab (média)','MS/cab (média)','% IMS (média)','R$/cab/dia','R$/cab tratos','R$/cab compra','R$/cab total','Custo total do lote','Venda estimada (ou real)','Resultado (estimado ou real)'],
    R.map(x=>[xc(x.c),xc(x.nome),xc(x.desc),xc(x.rac),xc(x.ent,'dia'),xc(x.fim,'dia'),xc(x.cab,'int'),xc(x.pe,'int'),xc(x.pp,'int'),xc(x.dias,'int'),xc(x.mn,'dec'),xc(x.ms,'dec'),xc(ok(x.ims)?x.ims/100:NaN,'pct'),xc(x.cd,'rs'),xc(x.ctr,'rs'),xc(x.cco,'rs'),xc(x.ct,'rs'),xc(x.tot,'rs'),xc(x.ve,'rs'),xc(x.vr,'rs')]),[10,22,26,16,11,12,9,11,12,7,11,11,10,11,12,12,12,14,16,16]]]);},true);

/* ---------- Gestão › Config. › Backup: lista das cópias (automáticas e manuais) ---------- */
async function gBkLista(){const el=$('gBkLista');if(!el)return;
  if(!navigator.onLine||!window.bkApi||typeof apiUrl!=='function'||!apiUrl()){el.innerHTML='<p class="note">Precisa de internet para ver as cópias.</p>';return;}
  try{const L=await bkApi.lista(),man=b=>b.tipo?b.tipo==='manual':/manual/i.test(b.nome||'');
    const li=b=>{const d=new Date(b.criado);return `<div class="gBkIt"><b>${d.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'})} · ${d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</b>${b.url?`<a href="${esc(b.url)}" target="_blank" rel="noopener">abrir planilha</a>`:''}</div>`;};
    const au=L.filter(b=>!man(b)),ma=L.filter(man);
    el.innerHTML=`<h3 class="gSub">🕑 Automáticos · ${au.length} de 20</h3>${au.map(li).join('')||'<p class="note">Nenhum ainda.</p>'}
      <h3 class="gSub">✋ Manuais · ${ma.length} de 10</h3>${ma.map(li).join('')||'<p class="note">Nenhum ainda.</p>'}`;
  }catch(e){el.innerHTML='<p class="note">Não consegui buscar as cópias agora.</p>';}}

/* ---------- Config. › Custo: estimativa de venda (rendimento e preço da @) de todos os lotes ativos ---------- */
function tEstVenda(){const hj=hojeKey(),lt=GT.evLoc||'T',L=gTodos('lote').filter(ativo).filter(l=>lt==='T'||linhaDe(curralEm(l,hj))===lt).sort(porCurral);
  const inp=(cls,attr,u,val,ph,mode)=>`<input class="${cls}" inputmode="${mode}" ${attr}="${u}" value="${esc(val)}" placeholder="${esc(ph)}">`;
  return `<section class="panel gCfgP"><h2>Estimativa de compra e venda</h2>
    <p class="note"><b>Compra</b>: preço da @ e rendimento de carcaça na compra (só muda nos lotes com a compra liberada no cadastro; 🔒 = bloqueada). Conta: peso × rendimento ÷ 15 × preço da @ (50% = peso vivo ÷ 30). Vai para o valor de compra do lote.<br><b>Venda</b>: rendimento e preço da @ da venda, sempre pelo peso atual projetado.<br>São os mesmos campos do cadastro do lote. Mude um por um ou aplique a todos da lista e toque em Salvar.</p>
    ${(()=>{const A=gTodos('lote').filter(ativo);return locBotoes('evLoc',lt,k=>A.filter(l=>doLocal(k,curralEm(l,hj))).length);})()}
    <div class="gEvTodos2">
      <div class="gEvGrp"><b>Compra · aplicar a todos</b><div><input class="gRs" id="gEcPrT" inputmode="numeric" placeholder="R$ @"><input class="cell num" id="gEcRcT" inputmode="decimal" placeholder="Rend. %"></div><button class="lima" data-g="ecTodos">Aplicar compra</button></div>
      <div class="gEvGrp"><b>Venda · aplicar a todos</b><div><input class="cell num" id="gEvRcT" inputmode="decimal" placeholder="Rend. %"><input class="gRs" id="gEvPrT" inputmode="numeric" placeholder="R$ @"></div><button class="lima" data-g="evTodos">Aplicar venda</button></div></div>
    ${L.length?`<div class="gEvLista"><div class="gEvLin2 gEvCab"><span class="gEvC">Compra<br>R$ @</span><span class="gEvC">Compra<br>rend. %</span><span class="gEvV">Venda<br>rend. %</span><span class="gEvV">Venda<br>R$ @</span></div>
    ${L.map(l=>{const e=l.ent||{},u=l.uid;return `<div class="gEvItem"><div class="gEvNome"><b>${esc(curralEm(l,hj)||'')}</b> <small>${esc(l.nome)} · ${nf(cabAtual(l))} cab · entrada ${nf(+e.peso||0)} kg · hoje ${nf(pesoEm(l,hj))} kg${e.unid&&e.unid!=='arroba'?` · compra em ${e.unid==='cab'?'R$/cab':'R$/kg'}`:''}</small></div>
      <div class="gEvLin2${l.compraGrupo!==false?'':' gEvTrava'}">${l.compraGrupo!==false?inp('gRs','data-ecpr',u,e.preco?rsIn(+e.preco):'','R$ 0,00','numeric')+inp('cell num','data-ecrc',u,vIn(e.rcC||50),'50','decimal'):`<span class="gEvLock" title="Compra bloqueada no cadastro do lote">🔒 ${e.preco?rsIn(+e.preco):'—'}</span><span class="gEvLock">🔒 ${vIn(e.rcC||50)}%</span>`}${inp('cell num','data-evrc',u,l.rcPrev?vIn(l.rcPrev):'',vIn(gCfg().rc||''),'decimal')}${inp('gRs','data-evpr',u,rsIn(l.simPreco?+l.simPreco:NaN),'R$ 0,00','numeric')}</div></div>`;}).join('')}
    </div><button class="primary" data-g="evSalvar">Salvar estimativas</button>`:'<p class="note">Nenhum lote ativo.</p>'}</section>`;}

/* =====================================================================================
   ESTOQUE dos insumos: entradas e saídas manuais + saídas automáticas pelas batidas
   - movimento manual: {tipo:'estmov', dia, ins, mov:'ent'|'sai'|'inv', kg, rs (valor da entrada), obs}
   - 'inv' = contagem: o saldo daquele dia passa a ser o que foi contado
   - cada batida salva tira do estoque o realizado de cada produto (ou o previsto, se não tiver realizado)
   - as batidas só contam a partir do primeiro lançamento do produto no estoque
   ===================================================================================== */
const MOV_NOME={ent:'Entrada',sai:'Saída manual',inv:'Contagem',bat:'Batida'};
function movsEstoque(insId){const M=gTodos('estmov').filter(m=>m.ins===insId).map(m=>({uid:m.uid,dia:m.dia,mov:m.mov,kg:+m.kg||0,rs:+m.rs||0,obs:m.obs||'',manual:true,ts:m.ts||0,nf:m.nf||null}));
  if(!M.length)return [];const ini=M.reduce((a,m)=>m.dia<a?m.dia:a,M[0].dia);
  gTodos('carga').forEach(c=>{if(!c.dia||c.dia<ini)return;let kg=0;(c.itens||[]).forEach(x=>{if(x.ins===insId)kg+=ok(+x.real)&&x.real!==null?+x.real:(+x.prev||0);});
    if(kg>0)M.push({uid:c.uid,dia:c.dia,mov:'bat',kg,obs:`${c.avulso?'Batida avulsa':'Trato '+((c.tratos||[c.trato]).join('+'))} · ${c.racNome||''}${c.hora?' · '+c.hora:''}`,ts:c.ts0||0});});
  M.sort((a,b)=>a.dia<b.dia?-1:a.dia>b.dia?1:(a.ts-b.ts));  // no mesmo dia: na ordem em que foi lançado
  let sd=0;M.forEach(m=>{if(m.mov==='inv'){m.dif=m.kg-sd;sd=m.kg;}else sd+=m.mov==='ent'?m.kg:-m.kg;m.saldo=sd;});return M;}
function estoqueIns(i){const M=movsEstoque(i.uid),hj=hojeKey(),d7=somaDias(hj,-6);
  const saldo=M.length?M[M.length-1].saldo:null,cons=M.filter(m=>(m.mov==='bat'||m.mov==='sai')&&m.dia>=d7&&m.dia<=hj).reduce((a,m)=>a+m.kg,0)/7;
  return {M,saldo,cons,dias:cons>0&&saldo>0?saldo/cons:NaN,ult:M.length?M[M.length-1]:null,min:+i.estMin||0};}
function tEstoque(){const I=gTodos('insumo').filter(i=>!i.inativo).sort(porNome),hj=hojeKey();
  const L=I.map(i=>({i,e:estoqueIns(i)}));
  const item=({i,e})=>{const baixo=e.saldo!=null&&(e.saldo<=0||(e.min&&e.saldo<e.min)||(ok(e.dias)&&e.dias<3));
    return `<button class="gItem gEstIt${baixo?' gEstBaixo':''}" data-g="ir" data-t="estIns" data-id="${i.uid}"><div class="gItemTopo"><b>${esc(i.nome)}</b><span class="gEstSaldo">${e.saldo==null?'sem lançamento':nf(e.saldo)+' kg'}</span></div>
      <small>${e.saldo==null?'Lance uma entrada ou uma contagem para começar o controle.':`${e.cons>0?`consumo ${nf(e.cons)} kg/dia (7 dias)`:'sem consumo nos últimos 7 dias'}${ok(e.dias)?` · dá para ~${nf(e.dias,1)} dia(s)`:''}${e.min?` · mínimo ${nf(e.min)} kg`:''}`}${baixo?' · ⚠ estoque baixo':''}</small></button>`;};
  return `<section class="panel"><div class="curhead"><h2>Estoque</h2><span class="note">${dB(hj)}</span></div>
    <div class="gEstBtns gEst4"><button class="lima" data-g="ir" data-t="estForm" data-mov="ent">＋ Entrada</button><button class="lima" data-g="nfNova">📎 ＋ NF</button><button data-g="ir" data-t="estForm" data-mov="sai">－ Saída manual</button><button data-g="ir" data-t="estForm" data-mov="inv">✓ Contagem</button></div>
    ${L.length?`<div class="row compart fz3 lotesExp"><button class="verde" data-g="estPdf">📄 PDF</button><button class="verde" data-g="estImg">🖼 Foto</button><button class="verde" data-g="estXls">📊 Excel</button></div>`:''}
    ${L.map(item).join('')||'<p class="note">Cadastre os insumos primeiro (Gestão › Insumos).</p>'}
    <p class="note">As batidas salvas tiram do estoque automaticamente o realizado de cada produto (ou o previsto, se não tiver realizado). Contagem: o saldo do dia passa a ser o que foi contado (acerto). Toque no produto para ver as entradas e saídas.</p></section>
  ${L.length?estMovHTML():''}`;}
/* todas as movimentações do estoque (todos os produtos), com período e ordem */
function estMovs(){const per=GT.perE==null?30:GT.perE,hj=hojeKey(),de=per>0?somaDias(hj,-(per-1)):'0000',novo=GT.ordE!=='antigo';
  const L=[];gTodos('insumo').filter(i=>!i.inativo).forEach(i=>{const e=estoqueIns(i);e.M.forEach((m,k)=>{if(m.dia>=de)L.push(Object.assign({nome:i.nome,k},m));});});
  L.sort((a,b)=>a.dia.localeCompare(b.dia)||(a.ts||0)-(b.ts||0)||a.nome.localeCompare(b.nome)||a.k-b.k);if(novo)L.reverse();return {L,per,novo};}
const movSinal=m=>(m.mov==='ent'?'+':m.mov==='inv'?'=':'−')+nf(m.kg);
const movDet=m=>[m.obs||'',m.mov==='inv'&&ok(m.dif)?`acerto ${m.dif>=0?'+':''}${nf(m.dif)} kg`:'',m.mov==='ent'&&m.rs?rs(m.rs)+(m.kg?` (${rs(m.rs/m.kg)}/kg)`:''):''].filter(Boolean).join(' · ');
function estMovHTML(){const {L,per,novo}=estMovs();
  return `<section class="panel"><div class="curhead"><h2>Movimentações</h2><span class="note">${L.length}</span></div>
    <div class="linhas gFiltro">${[[7,'7 dias'],[30,'30 dias'],[90,'90 dias'],[0,'Tudo']].map(([k,r])=>`<button data-g="estPerE" data-p="${k}" class="${per===k?'sel':''}">${r}</button>`).join('')}</div>
    <div class="linhas gFiltro"><button data-g="estOrd" data-o="novo" class="${novo?'sel':''}">↓ Mais novo primeiro</button><button data-g="estOrd" data-o="antigo" class="${novo?'':'sel'}">↑ Mais antigo primeiro</button></div>
    ${L.length?`<div class="tablebox"><table class="gTab gEstTab"><thead><tr><th>Dia</th><th>Produto · movimento</th><th>kg</th><th>Saldo</th></tr></thead><tbody>${L.map(m=>`<tr><td class="hora">${dB(m.dia).slice(0,5)}</td><td class="c">${esc(m.nome)}<small>${MOV_NOME[m.mov]}${movDet(m)?' · '+esc(movDet(m)):''}${m.nf&&m.nf.id?` <button class="mini" data-g="nfVer" data-id="${esc(m.nf.id)}" data-mini="${esc(m.nf.idMini||'')}">📎 NF</button>`:''}</small></td><td class="${m.mov==='ent'?'ok':m.mov==='inv'?'':'bad'}">${movSinal(m)}</td><td><b>${nf(m.saldo)}</b></td></tr>`).join('')}</tbody></table></div>`:'<p class="note">Nenhum movimento nesse período.</p>'}</section>`;}
function estExp(tipo){const I=gTodos('insumo').filter(i=>!i.inativo).sort(porNome).map(i=>({i,e:estoqueIns(i)})),{L,per}=estMovs(),d=dB(hojeKey()),nome=`Estoque ${d.replace(/\//g,'-')}`,perTxt=per>0?`últimos ${per} dias`:'tudo';
  if(tipo==='xls')return gExcel(nome,[['Saldo',['Produto','Saldo (kg)','Consumo/dia 7 dias (kg)','Dá para (dias)','Estoque mínimo (kg)'],I.map(({i,e})=>[xc(i.nome),xc(e.saldo,'int'),xc(e.cons>0?e.cons:NaN,'int'),xc(ok(e.dias)?e.dias:NaN,'dec'),xc(e.min||NaN,'int')]),[24,12,20,13,17]],
    ['Movimentações',['Data','Produto','Movimento','Quantidade (kg)','Valor total (R$)','Valor por kg (R$)','Fornecedor / observação','Acerto da contagem (kg)','Saldo (kg)'],L.map(m=>[xc(m.dia,'dia'),xc(m.nome),xc(MOV_NOME[m.mov]),xc((m.mov==='ent'||m.mov==='inv'?1:-1)*m.kg,'int'),xc(m.mov==='ent'&&m.rs?m.rs:NaN,'rs'),xc(m.mov==='ent'&&m.rs&&m.kg?m.rs/m.kg:NaN,'rs'),xc(m.obs||''),xc(m.mov==='inv'&&ok(m.dif)?m.dif:NaN,'int'),xc(m.saldo,'int')]),[11,22,14,14,15,15,34,16,11]]]);
  window.__expPdf=tipo==='pdf';
  return enviarImg(`FJK - Estoque - ${d}`,[{cab:`Saldo do estoque · ${d}`,cols:[['Produto',300,'l'],['Saldo',170,'r'],['Consumo/dia',170,'r'],['Dá para',150,'r'],['Mínimo',160,'r']],
      linhas:I.map(({i,e})=>[i.nome,e.saldo==null?'—':nf(e.saldo)+' kg',e.cons>0?nf(e.cons)+' kg':'—',ok(e.dias)?nf(e.dias,1)+' dia(s)':'—',e.min?nf(e.min)+' kg':'—']),
      cores:I.map(({e})=>{const bx=e.saldo!=null&&(e.saldo<=0||(e.min&&e.saldo<e.min)||(ok(e.dias)&&e.dias<3));return [null,bx?'#b3261e':null];})},
    {cab:`Movimentações · ${perTxt}`,cols:[['Data',100,'l'],['Produto',210,'l'],['Movimento',150,'l'],['Quantidade',130,'r'],['Valor total',150,'r'],['R$/kg',110,'r'],['Fornecedor / obs.',260,'l'],['Saldo',120,'r']],
      linhas:L.map(m=>[dB(m.dia).slice(0,5),m.nome,MOV_NOME[m.mov]+(m.mov==='inv'&&ok(m.dif)?` (${m.dif>=0?'+':''}${nf(m.dif)})`:''),movSinal(m)+' kg',m.mov==='ent'&&m.rs?rs(m.rs):'—',m.mov==='ent'&&m.rs&&m.kg?rs(m.rs/m.kg):'—',m.obs||'—',nf(m.saldo)]),
      cores:L.map(m=>[null,null,null,m.mov==='ent'?'#2e7d32':m.mov==='inv'?null:'#b3261e'])}],nome);}
function tEstIns(t){const i=G.it[t.id];if(!i)return voltar();const e=estoqueIns(i),per=GT.per==null?30:GT.per,hj=hojeKey(),de=per>0?somaDias(hj,-(per-1)):'0000';
  const M=e.M.filter(m=>m.dia>=de).reverse();
  const tot=k=>e.M.filter(m=>m.dia>=de&&m.mov===k).reduce((a,m)=>a+m.kg,0);
  const lin=m=>`<tr><td class="hora">${dB(m.dia).slice(0,5)}</td><td class="c">${MOV_NOME[m.mov]}${m.nf&&m.nf.id?` <button class="mini" data-g="nfVer" data-id="${esc(m.nf.id)}" data-mini="${esc(m.nf.idMini||'')}">📎 NF</button>`:''}<small>${esc(m.obs||'')}${m.mov==='inv'&&ok(m.dif)?` · acerto ${m.dif>=0?'+':''}${nf(m.dif)} kg`:''}${m.mov==='ent'&&m.rs?` · ${rs(m.rs)}`:''}</small></td>
    <td class="${m.mov==='ent'?'ok':m.mov==='inv'?'':'bad'}">${m.mov==='ent'?'+':m.mov==='inv'?'=':'−'}${nf(m.kg)}</td><td><b>${nf(m.saldo)}</b></td><td>${m.manual?`<button class="mini" data-g="ir" data-t="estForm" data-id="${m.uid}" aria-label="Editar">✎</button> <button class="mini danger" data-g="estRm" data-id="${m.uid}" aria-label="Apagar">✕</button>`:''}</td></tr>`;
  return `${voltar()}<section class="panel"><div class="curhead"><h2>${esc(i.nome)}</h2><span class="note">estoque</span></div>
    <div class="stat gStat3">${st('Saldo hoje',e.saldo==null?'—':nf(e.saldo)+' kg')}${st('Consumo/dia (7 d)',e.cons>0?nf(e.cons)+' kg':'—')}${st('Dá para',ok(e.dias)?nf(e.dias,1)+' dia(s)':'—')}</div>
    <div class="gEstBtns"><button class="lima" data-g="ir" data-t="estForm" data-mov="ent" data-ins="${i.uid}">＋ Entrada</button><button data-g="ir" data-t="estForm" data-mov="sai" data-ins="${i.uid}">－ Saída</button><button data-g="ir" data-t="estForm" data-mov="inv" data-ins="${i.uid}">✓ Contagem</button></div></section>
  <section class="panel"><h2>Entradas e saídas</h2>
    <div class="linhas gFiltro">${[[7,'7 dias'],[30,'30 dias'],[90,'90 dias'],[0,'Tudo']].map(([k,r])=>`<button data-g="estPer" data-p="${k}" class="${per===k?'sel':''}">${r}</button>`).join('')}</div>
    <div class="stat gStat3">${st('Entradas',nf(tot('ent'))+' kg')}${st('Batidas',nf(tot('bat'))+' kg')}${st('Saídas manuais',nf(tot('sai'))+' kg')}</div>
    ${M.length?`<div class="tablebox"><table class="gTab gEstTab"><thead><tr><th>Dia</th><th>Movimento</th><th>kg</th><th>Saldo</th><th></th></tr></thead><tbody>${M.map(lin).join('')}</tbody></table></div>`:'<p class="note">Nenhum movimento nesse período.</p>'}</section>`;}
function tEstForm(t){const ed=t.id&&G.it[t.id]&&!G.it[t.id].del?G.it[t.id]:null,mov=ed?ed.mov:(t.mov||'ent'),I=gTodos('insumo').filter(i=>!i.inativo||(ed&&i.uid===ed.ins)).sort(porNome),tit=(ed?'Editar ':'')+{ent:'Entrada no estoque',sai:'Saída manual do estoque',inv:'Contagem do estoque'}[mov];
  const vKg=ed?+ed.kg:'',vRs=ed&&+ed.rs>0?+ed.rs:'',vPk=ed&&+ed.rs>0&&+ed.kg>0?Math.round(ed.rs/ed.kg*100)/100:'';
  return `${voltar()}<section class="panel"><h2>${tit}</h2><div class="gForm">${[
    {k:'emov',l:'Tipo',t:'sel',op:[['ent','＋ Entrada (compra/chegada)'],['sai','－ Saída manual (perda, outro uso)'],['inv','✓ Contagem (acerto do saldo)']],v:mov},
    {k:'eins',l:'Produto',t:'sel',op:[['','— escolha —']].concat(I.map(i=>[i.uid,i.nome])),v:ed?ed.ins:(t.ins||'')},
    {k:'edia',l:'Data',t:'dia',v:ed?ed.dia:hojeKey(),meia:1}].map(campo).join('')}
    ${mov==='ent'?`<div class="gTres">${[{k:'ekg',l:'Quantidade',suf:'kg',t:'num',v:vKg},{k:'ers',l:'Valor total da nota',t:'rs',v:vRs},{k:'erkg',l:'Valor por kg',t:'rs',v:vPk}].map(campo).join('')}</div>
      <p class="note gTresNota">Coloque a quantidade e o valor total (o valor por kg sai sozinho), ou a quantidade e o valor por kg.</p>`
      :campo({k:'ekg',l:mov==='inv'?'Quantidade contada':'Quantidade',suf:'kg',t:'num',v:vKg,meia:1})}
    ${[{k:'eobs',l:mov==='ent'?'Fornecedor / nota (opcional)':'Observação (opcional)',v:ed?ed.obs||'':''}].map(campo).join('')}</div>
    <button class="primary" data-g="salvaEst" data-id="${ed?ed.uid:''}">${ed?'Salvar alteração':'Salvar'}</button></section>`;}
/* ---------- ＋ NF: lê a nota fiscal (XML, PDF ou foto) e lança a entrada no estoque ---------- */
let NF=null,NF_IMG=null;
const PDFJS='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
function carregarPdfJs(){if(window.pdfjsLib)return Promise.resolve(window.pdfjsLib);return new Promise((ok_,er)=>{const sc=document.createElement('script');sc.src=PDFJS+'pdf.min.js';
  sc.onload=()=>{try{pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS+'pdf.worker.min.js';ok_(pdfjsLib);}catch(e){er(e);}};sc.onerror=()=>er(new Error('pdf'));document.head.appendChild(sc);});}
const numNF=v=>{if(v==null||v==='')return NaN;let t=String(v).trim();if(/,\d+$/.test(t))t=t.replace(/\./g,'').replace(',','.');else t=t.replace(/,/g,'');return parseFloat(t);};
const semAc=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
function nfDoXml(txt){const d=new DOMParser().parseFromString(txt,'text/xml'),g=(el,t)=>{const x=el&&el.getElementsByTagName(t)[0];return x?x.textContent.trim():'';};
  const ide=d.getElementsByTagName('ide')[0],emit=d.getElementsByTagName('emit')[0],dh=g(ide,'dhEmi')||g(ide,'dEmi');
  const itens=[...d.getElementsByTagName('det')].map(det=>{const p=det.getElementsByTagName('prod')[0];return {desc:g(p,'xProd'),un:g(p,'uCom').toUpperCase(),qtd:numNF(g(p,'qCom')),vTot:numNF(g(p,'vProd'))};});
  return {dia:dh?dh.slice(0,10):'',forn:g(emit,'xFant')||g(emit,'xNome'),num:g(ide,'nNF'),vNF:numNF(g(d.documentElement,'vNF')),itens};}
function nfDoTexto(t){const T=String(t||'').replace(/\s+/g,' '),U=semAc(T);
  const dt=(U.match(/EMISS[^0-9]{0,60}(\d{2}\/\d{2}\/\d{4})/)||U.match(/(\d{2}\/\d{2}\/\d{4})/)||[])[1];
  /* número da nota: pela chave de acesso (44 dígitos) ou pelo "Nº" */
  const ch=((U.match(/((?:\d{4}\s?){10}\d{4})/)||[])[1]||'').replace(/\s/g,'');
  let num=ch.length===44?String(+ch.slice(25,34)):'';
  if(!num)num=((U.match(/N[O0º°]?\s*[.:]?\s*(\d{3}\.\d{3}\.\d{3})/)||U.match(/N[º°O]\.?\s*:?\s*(\d{3,9})\b/)||[])[1]||'').replace(/\./g,'');if(num&&!ch)num=String(+num);
  /* fornecedor = emitente */
  let forn=((T.match(/EMITENTE\s+(.+?)\s+(?:ROD\b|RODOVIA|RUA\b|AV\b|AV\.|AVENIDA|ESTRADA|TRAVESSA|ALAMEDA|PRA[CÇ]A|FAZENDA|TELEFONE|FONE|CNPJ|\d)/i)||[])[1]||'').trim();
  if(!forn||forn.length<4)forn=((T.match(/RECEBEMOS\s+DE\s+(.+?)\s+OS\s+PRODUTOS/i)||[])[1]||'').trim();
  if(/^NF-?E\b|DESTINAT|REMETENTE/i.test(forn))forn='';
  const itens=[];let m;
  /* linha do produto: NCM (8) [CST] CFOP UN QTD V.UNIT V.TOTAL */
  const re=/(\d{8})\s+(?:\d{3}\s+)?([1-7]\d{3})\s+([A-Za-z]{1,6})\s+([\d.]+(?:,\d+)?)\s+([\d.]+,\d{2,10})\s+([\d.]+,\d{2})/g;
  while((m=re.exec(T))){const antes=T.slice(Math.max(0,m.index-80),m.index).replace(/^.*V\.?\s*TOTAL\s*/i,'').replace(/^\d+\s+/,'').trim();
    itens.push({desc:antes,un:semAc(m[3]),qtd:numNF(m[4]),vTot:numNF(m[6])});}
  if(!itens.length){const r2=/\b(KG|KGS|TON|TN|T|SC|UN)\s+([\d.]+(?:,\d+)?)\s+([\d.]+,\d{2,10})\s+([\d.]+,\d{2})/g;while((m=r2.exec(U)))itens.push({desc:'',un:m[1],qtd:numNF(m[2]),vTot:numNF(m[4])});}
  let vNF=numNF((U.match(/VALOR\s+TOTAL\s+DA\s+NOTA[^0-9]{0,40}([\d.]+,\d{2})/)||[])[1]);
  if(!ok(vNF)){const v2=(U.match(/VLR\.?\s*NF\.?\s*R\$\s*([\d.,]+)/)||[])[1];if(v2)vNF=numNF(v2.replace(/\.(\d{2})$/,',$1'));}
  if(!ok(vNF)&&itens.length)vNF=itens.reduce((a,x)=>a+(ok(x.vTot)?x.vTot:0),0);
  /* descrição vazia: procura o nome de um insumo cadastrado no texto da nota */
  itens.forEach(x=>{if(!x.desc||!nfAcharIns(x.desc))x.desc=x.desc||'';x.todo=T;});
  return {dia:dt?dt.split('/').reverse().join('-'):'',forn,num,vNF,itens};}
const nfFator=u=>{u=semAc(u).replace(/[^A-Z]/g,'');return /^(KG|KGS|QUILO|QUILOS|KILO)$/.test(u)?1:/^(TON|TONS|TN|T|TO|TL|TONELADA)$/.test(u)?1000:null;};
function nfAcharIns(desc){const D=semAc(desc),I=gTodos('insumo').filter(i=>!i.inativo);let best=null,bs=0;
  I.forEach(i=>{const ws=semAc(i.nome).split(/[^A-Z0-9]+/).filter(w=>w.length>=3);let sc=0;ws.forEach(w=>{if(D.includes(w))sc+=w.length;});if(sc>bs){bs=sc;best=i;}});return best?best.uid:'';}
function nfCanvasDe(file,max){return new Promise((ok_,er)=>{const u=URL.createObjectURL(file),im=new Image();im.onload=()=>{const k=Math.min(1,max/Math.max(im.width,im.height)),cv=document.createElement('canvas');cv.width=Math.round(im.width*k);cv.height=Math.round(im.height*k);cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);URL.revokeObjectURL(u);ok_(cv);};im.onerror=er;im.src=u;});}
async function nfOCR(cv){if(typeof carregarOCR!=='function')return '';const w=await carregarOCR();const r=await w.recognize(cv);return (r&&r.data&&r.data.text)||'';}
async function nfLer(file){if(!file)return;NF={lendo:true,nome:file.name};gRender();
  try{let r=null,img=null;const nm=(file.name||'').toLowerCase();
    if(nm.endsWith('.xml')||/xml/.test(file.type))r=nfDoXml(await file.text());
    else if(nm.endsWith('.pdf')||file.type==='application/pdf'){const lib=await carregarPdfJs(),pdf=await lib.getDocument({data:await file.arrayBuffer()}).promise;let txt='';
      for(let p=1;p<=Math.min(pdf.numPages,3);p++){const pg=await pdf.getPage(p),tc=await pg.getTextContent();txt+=tc.items.map(i=>i.str).join(' ')+' ';}
      const pg=await pdf.getPage(1),vp=pg.getViewport({scale:2}),cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;const cx=cv.getContext('2d');cx.fillStyle='#fff';cx.fillRect(0,0,cv.width,cv.height);await pg.render({canvasContext:cx,viewport:vp}).promise;
      img=await new Promise(o=>cv.toBlob(o,'image/jpeg',.85));if(txt.replace(/\s/g,'').length<60)txt=await nfOCR(cv);r=nfDoTexto(txt);}
    else{img=file;r=nfDoTexto(await nfOCR(await nfCanvasDe(file,2200)));}
    if(img){try{NF_IMG={big:await fzRedim(img,1600,.7),mini:await fzRedim(img,300,.6)};}catch(e){NF_IMG=null;}}
    const its=(r.itens&&r.itens.length?r.itens:[{desc:'',un:'',qtd:NaN,vTot:r.vNF}]).map(x=>{const f=nfFator(x.un),todo=x.todo;delete x.todo;return Object.assign({},x,{ins:nfAcharIns(x.desc)||(r.itens.length<=1&&todo?nfAcharIns(todo):''),kg:ok(x.qtd)&&f?Math.round(x.qtd*f):NaN});});
    NF=Object.assign({},r,{itens:its,nome:file.name});}
  catch(e){console.error(e);NF={erro:'Não consegui ler esta nota. Tente o arquivo XML ou o PDF da nota, ou uma foto mais nítida.',nome:file.name};}
  gRender();}
function tEstNF(){const I=gTodos('insumo').filter(i=>!i.inativo).sort(porNome),op=[['','— escolha o produto —']].concat(I.map(i=>[i.uid,i.nome]));
  if(!NF)return `${voltar()}<section class="panel"><h2>Entrada pela nota fiscal</h2>
    <p class="note">Anexe a nota: o <b>XML</b> da NF-e (mais certo), o <b>PDF</b> da nota ou uma <b>foto</b> da DANFE. O app lê a data, o fornecedor, o número, os produtos, as quantidades e os valores. Você confere, escolhe o produto e lança.</p>
    <label class="gNfArq">📎 Anexar nota fiscal<input type="file" id="nfArq" accept=".xml,application/xml,text/xml,application/pdf,image/*" hidden></label></section>`;
  if(NF.lendo)return `${voltar()}<section class="panel"><h2>Entrada pela nota fiscal</h2><p class="note">Lendo a nota ${esc(NF.nome||'')}… (foto pode levar alguns segundos)</p></section>`;
  if(NF.erro)return `${voltar()}<section class="panel"><h2>Entrada pela nota fiscal</h2><p class="aviso warn">${esc(NF.erro)}</p><button data-g="nfOutra">Escolher outro arquivo</button></section>`;
  const obs=[NF.forn,NF.num?'NF '+NF.num:''].filter(Boolean).join(' · ');
  return `${voltar()}<section class="panel"><h2>Entrada pela nota fiscal</h2>
    ${NF_IMG?`<img class="gNfImg" src="${NF_IMG.mini}" alt="nota">`:''}<p class="note">Lido de ${esc(NF.nome||'')}${ok(NF.vNF)?` · valor total da nota ${rs(NF.vNF)}`:''}. Confira e corrija se precisar.</p>
    <div class="gForm">${[{k:'edia',l:'Data',t:'dia',v:NF.dia||hojeKey(),meia:1},{k:'eobs',l:'Fornecedor / nota',v:obs}].map(campo).join('')}</div>
    ${NF.itens.map((x,i)=>`<div class="gNfItem"><p class="note"><b>Na nota:</b> ${esc(x.desc||'—')}${ok(x.qtd)?` · ${nf(x.qtd,3)} ${esc(x.un||'')}`:''}${ok(x.vTot)?` · ${rs(x.vTot)}`:''}${ok(x.qtd)&&!nfFator(x.un)?` <b>· unidade ${esc(x.un||'?')}: coloque os kg</b>`:''}</p>
      <div class="gForm">${campo({k:'nfp'+i,l:'Produto',t:'sel',op,v:x.ins})}</div>
      <div class="gTres">${[{k:'nfk'+i,l:'Quantidade',suf:'kg',t:'num',v:ok(x.kg)?x.kg:''},{k:'nfv'+i,l:'Valor total',t:'rs',v:ok(x.vTot)?x.vTot:''},{k:'nfu'+i,l:'Valor por kg',t:'rs',v:ok(x.kg)&&ok(x.vTot)&&x.kg>0?Math.round(x.vTot/x.kg*100)/100:''}].map(campo).join('')}</div></div>`).join('')}
    <p class="note">Item sem produto escolhido não é lançado.</p>
    <button class="primary" data-g="nfSalva">✓ Lançar entrada${NF.itens.length>1?'s':''}</button><button data-g="nfOutra">Escolher outro arquivo</button></section>`;}
document.addEventListener('change',e=>{if(e.target&&e.target.id==='nfArq'&&e.target.files&&e.target.files[0])nfLer(e.target.files[0]);});
document.addEventListener('input',e=>{const m=/^gf_nf([kvu])(\d+)$/.exec((e.target&&e.target.id)||'');if(!m)return;const i=m[2],kg=fn('nfk'+i),tot=fn('nfv'+i),pk=fn('nfu'+i),T=$('gf_nfv'+i),P=$('gf_nfu'+i);if(!T||!P)return;
  if(m[1]==='u'){if(kg>0&&pk>0)T.value=rsIn(Math.round(pk*kg*100)/100);}else if(kg>0&&tot>0)P.value=rsIn(Math.round(tot/kg*100)/100);});
async function nfSalvar(){if(!NF||!NF.itens)return;const dia=fv('edia'),obs=fv('eobs')||'';if(!dia)return toast('Coloque a data');
  const L=NF.itens.map((x,i)=>({ins:fv('nfp'+i),kg:fn('nfk'+i),rs:fn('nfv'+i)>0?fn('nfv'+i):fn('nfu'+i)>0?Math.round(fn('nfu'+i)*fn('nfk'+i)*100)/100:0})).filter(x=>x.ins);
  if(!L.length)return toast('Escolha o produto');if(L.some(x=>!(x.kg>0)))return toast('Coloque a quantidade em kg');
  let anexo=null;if(NF_IMG&&navigator.onLine){toast('Guardando a nota…');try{const r=await postApi({acao:'fotoSalvar',img:NF_IMG.big.split(',')[1],mini:NF_IMG.mini.split(',')[1],nome:`NF ${NF.num||''} ${dB(dia).replace(/\//g,'-')} ${Date.now()}`});if(r&&r.id){anexo={id:r.id,idMini:r.idMini||r.id,num:NF.num||''};FZ_FOTO[anexo.idMini]=NF_IMG.mini;FZ_FOTO[anexo.id]=NF_IMG.big;}}catch(e){}}
  L.forEach(x=>gPut({uid:novoId('est'),tipo:'estmov',dia,ins:x.ins,mov:'ent',kg:x.kg,rs:x.rs,obs,nf:anexo}));
  toast(`${L.length} entrada(s) lançada(s)${NF_IMG&&!anexo?' · a imagem da nota não foi guardada (sem internet)':''}`);NF=null;NF_IMG=null;GT={t:'estoque'};gRender();window.scrollTo({top:0});}
async function nfVer(id,mini){const w=document.createElement('div');w.className='fzFotoTela';w.innerHTML=`<img src="${FZ_FOTO[id]||FZ_FOTO[mini]||''}" alt=""><span class="fzFotoCarr">${FZ_FOTO[id]?'':'carregando…'}</span><button aria-label="Fechar">✕</button>`;
  w.onclick=()=>w.remove();document.body.appendChild(w);if(!FZ_FOTO[id]){await fzFotoCarregar(id);const im=w.querySelector('img'),s_=w.querySelector('.fzFotoCarr');if(FZ_FOTO[id]){im.src=FZ_FOTO[id];s_.textContent='';}else s_.textContent='não consegui abrir a nota (sem internet?)';}}
/* entrada: quantidade × valor por kg = valor total (preenche um a partir dos outros) */
document.addEventListener('input',e=>{const id=e.target&&e.target.id;if(!['gf_ekg','gf_ers','gf_erkg'].includes(id))return;const kg=fn('ekg'),tot=fn('ers'),pk=fn('erkg'),T=$('gf_ers'),P=$('gf_erkg');if(!T||!P)return;
  if(id==='gf_erkg'){if(kg>0&&pk>0)T.value=rsIn(Math.round(pk*kg*100)/100);}
  else if(kg>0&&tot>0)P.value=rsIn(Math.round(tot/kg*100)/100);});
function salvaEst(id){const ed=id&&G.it[id]&&!G.it[id].del?G.it[id]:null;const mov=fv('emov'),ins=fv('eins'),dia=fv('edia'),kg=fn('ekg');
  if(!ins)return toast('Escolha o produto');if(!dia)return toast('Coloque a data');if(!(kg>=0)||(mov!=='inv'&&!(kg>0)))return toast('Coloque a quantidade em kg');
  const rsT=mov==='ent'?(fn('ers')>0?fn('ers'):fn('erkg')>0?Math.round(fn('erkg')*kg*100)/100:0):0;
  gPut(Object.assign({},ed||{},{uid:ed?ed.uid:novoId('est'),tipo:'estmov',dia,ins,mov,kg,rs:rsT,obs:fv('eobs')||''}));
  toast(ed?'Lançamento alterado':mov==='ent'?'Entrada lançada':mov==='inv'?'Contagem lançada':'Saída lançada');gVoltar();}

/* segurança: toda leitura de hoje tem que ter previsto. Se o curral ficou sem previsto (ex.: outro aparelho sobrescreveu) e ainda não foi tratado hoje, refaz pelo kg da leitura */
function garantirPrevLeituras(){try{if(typeof modoVer!=='undefined'&&modoVer)return 0;if(!S||!S.prev||!window.prevApi)return 0;const hj=hojeKey();let n=0;
  gTodos('leitura').filter(x=>x.dia===hj&&+x.novo>0).forEach(x=>{const c=x.curral,tem=Object.keys(S.prev).some(k=>+((S.prev[k]||{})[c])>0),feito=(typeof HIST!=='undefined'?HIST:[]).some(r=>r.dia===hj&&r.curral===c);
    if(!tem&&(typeof curralAtivo!=='function'||curralAtivo(c))){aplicaPrev(c,+x.novo,S.prev);n++;
      /* já tratado hoje (o previsto tinha sumido): o trato feito volta com o previsto que foi usado; o último trato acerta a diferença */
      if(feito){const rs=HIST.filter(r=>r.dia===hj&&r.curral===c),por={};rs.forEach(r=>{por[r.trato]=(por[r.trato]||0)+(+r.prev||0);});
        Object.keys(por).forEach(k=>{if(por[k]>0){S.prev[k]=S.prev[k]||{};S.prev[k][c]=por[k];}});
        try{if(S.prevOrig&&S.prevOrig.v){delete S.prevOrig.v[c];delete S.prevOrig.set[c];}}catch(e){}
        try{const T=+x.novo,ks=Object.keys(S.prev).map(Number).filter(k=>+((S.prev[k]||{})[c])>0).sort((a,b)=>a-b),ult=ks[ks.length-1];
          if(ult&&!por[ult]){const outros=ks.filter(k=>k!==ult).reduce((a,k)=>a+(+S.prev[k][c]),0),real=rs.reduce((a,r)=>a+(+r.forn||0),0),prevFeito=Object.values(por).reduce((a,b)=>a+b,0);
            S.prev[ult][c]=Math.max(0,arredPrev(T-outros-(real-prevFeito)));}}catch(e){}}}});
  if(n){marcarPrev();if(typeof render==='function')render();}return n;}catch(e){return 0;}}
setInterval(garantirPrevLeituras,20000);setTimeout(garantirPrevLeituras,6000);
/* ---------- compensação garantida: terminou um trato e o último trato do curral ainda está com o previsto original?
   ajusta o último trato pelo que foi a mais/a menos (vale para qualquer aparelho em Executar; não mexe se mudaram o previsto à mão) ---------- */
function garantirCompensacao(){try{if(typeof modoVer!=='undefined'&&modoVer)return 0;if(!S||!S.prev||typeof compensarCurral!=='function')return 0;
  const hj=hojeKey();if(typeof diaAtivo==='function'&&diaAtivo()!==hj)return 0;let n=0;
  let a=+gCfg().arred;if(!(a>0))a=10;
  gTodos('leitura').filter(x=>x.dia===hj&&+x.novo>0).forEach(x=>{const c=x.curral;
    const ks=Object.keys(S.prev).map(Number).filter(k=>+((S.prev[k]||{})[c])>0).sort((p,q)=>p-q);if(ks.length<2)return;
    const regs=HIST.filter(r=>r.dia===hj&&r.curral===c);if(!regs.length)return;
    const feitos=new Set(regs.map(r=>+r.trato)),ult=ks[ks.length-1];if(feitos.has(ult))return;
    /* só mexe se o previsto do curral ainda é exatamente a divisão original da leitura (não compensado e ninguém mudou à mão) */
    const tmp={};try{prevApi.distribuir(c,+x.novo,ks.length,tmp);}catch(e){return;}
    const soma=ks.reduce((s_,k)=>s_+(+S.prev[k][c]),0);
    if(soma!==arredPrev(+x.novo)||!ks.every(k=>Math.abs((+((tmp[k]||{})[c])||0)-(+S.prev[k][c]))<=a))return;
    const real=regs.reduce((s_,r)=>s_+(+r.forn||0),0),prevFeito=ks.filter(k=>feitos.has(k)).reduce((s_,k)=>s_+(+S.prev[k][c]),0);
    if(Math.abs(real-prevFeito)<a/2)return;           // fez certinho: nada a ajustar
    if(S.prevOrig&&S.prevOrig.dia===hj&&S.prevOrig.set)delete S.prevOrig.set[c],S.prevOrig.v&&delete S.prevOrig.v[c];
    if(compensarCurral(c))n++;});
  if(n&&typeof render==='function')render();if(n&&typeof renderPrev==='function'&&$('viewPrev')&&!$('viewPrev').hidden)renderPrev();return n;}catch(e){return 0;}}
window.garantirCompensacao=garantirCompensacao;
setInterval(garantirCompensacao,20000);setTimeout(garantirCompensacao,8000);

/* ===================== Escore de fezes (Tratos › Fezes) =====================
   Escala 1 a 5: 1 líquida · 2 mole · 3 ideal (pastosa) · 4 firme · 5 seca/dura.
   Cada avaliação: dia + curral, quantas fezes em cada escore, observação. Média ponderada = Σ(escore × qtd) ÷ total.  */
const FZ_DESC=['','Líquida','Mole','Ideal','Firme','Seca'];
const fzId=(dia,c)=>'fz-'+dia+'-'+c;
const fzItem=(dia,c)=>{const x=G.it[fzId(dia,c)];return x&&!x.del?x:null;};
function fzCalc(cs){cs=(cs||[0,0,0,0,0]).map(n=>+n||0);const tot=cs.reduce((a,b)=>a+b,0);
  return {cs,tot,pct:cs.map(n=>tot?n/tot*100:0),media:tot?cs.reduce((a,n,i)=>a+n*(i+1),0)/tot:null};}
/* leitura: média 2,5 a 3,5 e no máx. 20% em 1+2 (acidose) ou 4+5 (fibra/pouca água) */
function fzStatus(k){if(!k||!k.tot)return {cl:'',txt:'—'};const b=k.pct[0]+k.pct[1],a=k.pct[3]+k.pct[4];
  if(b>20)return {cl:'bad',txt:'Mole demais (risco de acidose)'};if(a>20)return {cl:'warn',txt:'Firme demais'};
  if(k.media<2.5)return {cl:'warn',txt:'Tendendo a mole'};if(k.media>3.5)return {cl:'warn',txt:'Tendendo a firme'};return {cl:'ok',txt:'Ideal'};}
const fz1=v=>v==null?'—':v.toFixed(2).replace('.',',');
const fzPc=v=>v.toFixed(1).replace('.',',')+'%';
function fzCurrais(dia,loc){const s=new Set();gTodos('lote').filter(l=>cabPres(l,dia)>0).forEach(l=>{const c=curralEm(l,dia);if(c&&doLocal(loc||'T',c))s.add(c);});
  gTodos('fezes').filter(x=>x.dia===dia&&doLocal(loc||'T',x.curral)).forEach(x=>s.add(x.curral));
  return [...s].sort(alfa);}  // ordem alfabética (C-3, C-4 … C-10)
function tFezes(t){const hj=hojeKey();t.dia=t.dia||hj;t.loc=t.loc||'T';const dia=t.dia,Cs=fzCurrais(dia,t.loc);
  if(t.cur&&!Cs.includes(t.cur))t.cur=null;
  const chips=Cs.map(c=>{const k=fzCalc((fzItem(dia,c)||{}).c),st=fzStatus(k);
    return `<button class="fzChip ${t.cur===c?'sel':''} ${k.tot?'feito '+st.cl:''}" data-g="fzCur" data-c="${esc(c)}"><b>${esc(c)}</b><small>${k.tot?'✓ média '+fz1(k.media):'avaliar'}</small></button>`;}).join('');
  let ficha='';
  if(t.cur){const c=t.cur,x=fzItem(dia,c),k=fzCalc(x&&x.c),st=fzStatus(k);
    const L=gTodos('lote').filter(l=>curralEm(l,dia)===c&&cabPres(l,dia)>0);
    ficha=`<section class="panel fzFicha"><div class="curhead"><h2>${esc(c)}</h2><span class="note">${L.map(l=>esc(l.nome)+' · '+nf(cabPres(l,dia))+' cab').join(' · ')}</span></div>
      <div class="fzTot"><span>Total de fezes avaliadas</span><b>${k.tot}</b></div>
      ${[1,2,3,4,5].map(i=>`<div class="fzLinha e${i}"><div><b>Escore ${i}</b> · ${fzPc(k.pct[i-1])}<small>${FZ_DESC[i]}</small></div>
        <button class="fzBt" data-g="fzMenos" data-i="${i}" aria-label="Menos escore ${i}"${k.cs[i-1]?'':' disabled'}>−</button><b class="fzN">${k.cs[i-1]}</b>
        <button class="fzBt mais" data-g="fzMais" data-i="${i}" aria-label="Mais escore ${i}">+</button></div>`).join('')}
      <div class="fzMedia ${st.cl}"><span>Escore médio ponderado</span><b>${fz1(k.media)}</b><em>${st.txt}</em></div>
      ${fzFotosHTML(x)}
      <label for="fzObs">Observações</label><textarea id="fzObs" rows="2" placeholder="Ex.: fezes com grãos inteiros, muco, bolhas…">${esc((x&&x.obs)||'')}</textarea>
      ${k.tot?`<button class="mini danger" data-g="fzApagar">Apagar avaliação deste curral</button>`:''}</section>`;}
  /* relatório do dia */
  const R=gTodos('fezes').filter(x=>x.dia===dia&&doLocal(t.loc,x.curral)).map(x=>({c:x.curral,k:fzCalc(x.c),obs:x.obs})).filter(o=>o.k.tot).sort((a,b)=>alfa(a.c,b.c));
  const G5=[0,0,0,0,0];R.forEach(o=>o.k.cs.forEach((n,i)=>G5[i]+=n));const KG=fzCalc(G5);
  const rel=R.length?`<section class="panel"><div class="curhead"><h2>Relatório do dia · ${dB(dia).slice(0,5)}</h2><span class="note">${R.length} curral(is) · ${KG.tot} fezes</span></div>
    <div class="tablebox"><table class="gTab fzTab"><thead><tr><th>Curral</th><th>N</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>Média</th></tr></thead><tbody>
    ${R.map(o=>`<tr data-g="fzCur" data-c="${esc(o.c)}"><td class="c">${esc(o.c)}</td><td>${o.k.tot}</td>${o.k.pct.map((p,i)=>`<td class="${i===2?'fz3':''}">${p?p.toFixed(0)+'%':'·'}</td>`).join('')}<td class="${fzStatus(o.k).cl}"><b>${fz1(o.k.media)}</b></td></tr>`).join('')}
    <tr class="grp"><td>Geral</td><td>${KG.tot}</td>${KG.pct.map(p=>`<td>${p.toFixed(0)}%</td>`).join('')}<td class="${fzStatus(KG).cl}"><b>${fz1(KG.media)}</b></td></tr></tbody></table></div>
    <p class="note">Ideal: maioria no escore 3 e média entre 2,5 e 3,5. Mais de 20% em 1+2 = fezes moles (risco de acidose). Mais de 20% em 4+5 = fezes firmes.</p>
    <div class="row compart fz3"><button class="verde" data-g="fzPdf">📄 PDF</button><button class="verde" data-g="fzImg">🖼 Foto</button><button class="verde" data-g="fzXls">📊 Excel</button></div></section>`
    :`<section class="panel"><p class="note">Nenhuma avaliação de fezes em ${dB(dia)}${t.loc!=='T'?' neste local':''}.</p></section>`;
  /* histórico */
  const hN=[7,15,30].includes(+t.hN)?+t.hN:30,ini=somaDias(dia,-(hN-1)),cH=t.hCur||'';
  const HI=gTodos('fezes').filter(x=>x.dia>=ini&&x.dia<=dia&&(cH?nAt(x.curral)===cH:doLocal(t.loc,nAt(x.curral))));
  const porDia={};HI.forEach(x=>{const k=fzCalc(x.c);if(!k.tot)return;const d=porDia[x.dia]||(porDia[x.dia]=[0,0,0,0,0]);k.cs.forEach((n,i)=>d[i]+=n);});
  const dias=Object.keys(porDia).sort().reverse();
  const opC=[...new Set(gTodos('fezes').map(x=>x.curral))].sort(alfa);
  const hist=`<section class="panel"><div class="curhead"><h2>Histórico</h2><div class="fzHN">${[7,15,30].map(n=>`<button class="${n===hN?'sel':''}" data-g="fzHN" data-n="${n}">${n} dias</button>`).join('')}</div></div>
    <select id="fzHCur"><option value="">${t.loc==='T'?'Todos os currais':t.loc==='C'?'Todo o confinamento':'Todo o pasto'}</option>${opC.map(c=>`<option${c===cH?' selected':''}>${esc(c)}</option>`).join('')}</select>
    ${dias.length?`<div class="fzBarras">${dias.slice().reverse().map(d=>{const k=fzCalc(porDia[d]);return `<div class="fzBar" title="${dB(d)} · média ${fz1(k.media)}">${k.pct.map((p,i)=>`<i class="e${i+1}" style="height:${p}%"></i>`).join('')}<small>${dB(d).slice(0,5)}</small></div>`;}).join('')}</div>
      <div class="fzLeg">${[1,2,3,4,5].map(i=>`<span><i class="e${i}"></i>${i} ${FZ_DESC[i]}</span>`).join('')}</div>
      <div class="tablebox"><table class="gTab fzTab"><thead><tr><th>Dia</th><th>N</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>Média</th></tr></thead><tbody>
      ${dias.map(d=>{const k=fzCalc(porDia[d]);return `<tr><td class="c">${dB(d).slice(0,5)}</td><td>${k.tot}</td>${k.pct.map((p,i)=>`<td class="${i===2?'fz3':''}">${p?p.toFixed(0)+'%':'·'}</td>`).join('')}<td class="${fzStatus(k).cl}"><b>${fz1(k.media)}</b></td></tr>`;}).join('')}</tbody></table></div>
      <div class="row compart fz3"><button class="verde" data-g="fzHPdf">📄 PDF</button><button class="verde" data-g="fzHImg">🖼 Foto</button><button class="verde" data-g="fzXlsHist">📊 Excel</button></div>`:'<p class="note">Sem avaliações nesse período.</p>'}</section>`;
  return `<section class="panel"><h2>Escore de fezes</h2>${navData('fzDia',dia,'Dia da avaliação')}${locBotoes('fzLoc',t.loc)}
    <p class="note">Escolha o curral e toque em + para cada fezes avaliada.</p>
    <div class="fzChips">${chips||'<p class="note">Nenhum curral com lote neste local.</p>'}</div></section>${ficha}${rel}${hist}`;}
function fzMudar(i,d){const t=GT,c=t.cur;if(!c)return;const x=fzItem(t.dia,c)||{uid:fzId(t.dia,c),tipo:'fezes',dia:t.dia,curral:c,c:[0,0,0,0,0],obs:''};
  const n=JSON.parse(JSON.stringify(x));n.c=(n.c||[0,0,0,0,0]).map(v=>+v||0);n.c[i-1]=Math.max(0,n.c[i-1]+d);
  const o=$('fzObs');if(o)n.obs=o.value;gPut(n);const y=window.scrollY;gRender();window.scrollTo({top:y});}
function fzImg(){const t=GT,R=gTodos('fezes').filter(x=>x.dia===t.dia&&doLocal(t.loc,x.curral)).map(x=>({c:x.curral,k:fzCalc(x.c),obs:x.obs})).filter(o=>o.k.tot).sort((a,b)=>alfa(a.c,b.c));
  const G5=[0,0,0,0,0];R.forEach(o=>o.k.cs.forEach((n,i)=>G5[i]+=n));const KG=fzCalc(G5);
  enviarImg(`Escore de fezes · ${dB(t.dia)}`,[{cab:'% de fezes em cada escore (1 líquida · 3 ideal · 5 seca)',cols:[['Curral',170,'l'],['N',60,'r'],['1',90,'r'],['2',90,'r'],['3',90,'r'],['4',90,'r'],['5',90,'r'],['Média',100,'r']],
    linhas:R.map(o=>[o.c,String(o.k.tot)].concat(o.k.pct.map(p=>p.toFixed(0)+'%'),[fz1(o.k.media)])),total:['GERAL',String(KG.tot)].concat(KG.pct.map(p=>p.toFixed(0)+'%'),[fz1(KG.media)])},
    ...(R.some(o=>o.obs)?[{cab:'Observações',cols:[['Curral',170,'l'],['Observação',700,'l']],linhas:R.filter(o=>o.obs).map(o=>[o.c,o.obs])}]:[])],`Escore de fezes ${dB(t.dia).replace(/\//g,'-')}`);}
function fzXls(hist){const t=GT;
  if(!hist){const R=gTodos('fezes').filter(x=>x.dia===t.dia&&doLocal(t.loc,x.curral)).map(x=>({c:x.curral,k:fzCalc(x.c),obs:x.obs})).filter(o=>o.k.tot).sort((a,b)=>alfa(a.c,b.c));
    return gExcel(`Escore de fezes ${dB(t.dia).replace(/\//g,'-')}`,[['Escore de fezes',['Dia','Curral','Total','Esc. 1','Esc. 2','Esc. 3','Esc. 4','Esc. 5','% 1','% 2','% 3','% 4','% 5','Média','Situação','Observação'],
      R.map(o=>[xc(t.dia,'dia'),xc(o.c),xc(o.k.tot,'int')].concat(o.k.cs.map(n=>xc(n,'int')),o.k.pct.map(p=>xc(p/100,'pct')),[xc(o.k.media,'dec'),xc(fzStatus(o.k).txt),xc(o.obs||'')])),[11,16,8,7,7,7,7,7,8,8,8,8,8,8,24,40]]]);}
  const hN=[7,15,30].includes(+t.hN)?+t.hN:30,ini=somaDias(t.dia,-(hN-1)),cH=t.hCur||'';
  const HI=gTodos('fezes').filter(x=>x.dia>=ini&&x.dia<=t.dia&&(cH?nAt(x.curral)===cH:doLocal(t.loc,nAt(x.curral)))).map(x=>({d:x.dia,c:x.curral,k:fzCalc(x.c),obs:x.obs})).filter(o=>o.k.tot).sort((a,b)=>a.d.localeCompare(b.d)||alfa(a.c,b.c));
  gExcel(`Escore de fezes historico ${hN} dias ${(cH||'todos').replace(/[\\/:*?"<>|]/g,'-')} ${dB(t.dia).replace(/\//g,'-')}`,[['Histórico',['Dia','Curral','Total','% 1','% 2','% 3','% 4','% 5','Média','Situação','Observação'],
    HI.map(o=>[xc(o.d,'dia'),xc(o.c),xc(o.k.tot,'int')].concat(o.k.pct.map(p=>xc(p/100,'pct')),[xc(o.k.media,'dec'),xc(fzStatus(o.k).txt),xc(o.obs||'')])),[11,16,8,8,8,8,8,8,8,24,40]]]);}
$('gBox').addEventListener('click',e=>{const b=e.target.closest('[data-g^="fz"]');if(!b||GT.t!=='fezes')return;const a=b.dataset.g;
  if(a==='fzCur'){GT.cur=GT.cur===b.dataset.c&&b.tagName==='BUTTON'?null:b.dataset.c;gRender();if(GT.cur)setTimeout(()=>{const f=document.querySelector('.fzFicha');if(f)f.scrollIntoView({behavior:'smooth',block:'start'});},50);return;}
  if(a==='fzLoc'){GT.loc=b.dataset.l;GT.cur=null;return gRender();}
  if(a==='fzPdf')return fzRelPdf();if(a==='fzImgG')return fzRelImg();
  if(a==='fzImg')return fzImg();if(a==='fzXls')return fzXls(false);if(a==='fzXlsHist')return fzXls(true);
  if(a==='fzHN'){GT.hN=+b.dataset.n;const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='fzHPdf'||a==='fzHImg')return fzHistExport(a==='fzHPdf');
  if(typeof bloqueado==='function'&&bloqueado())return;
  if(a==='fzMais'||a==='fzMenos')return fzMudar(+b.dataset.i,a==='fzMais'?1:-1);
  if(a==='fzFotoAdd'){const f=document.getElementById('fzFotoIn');if(f)f.click();return;}
  if(a==='fzFotoVer')return fzFotoVer(+b.dataset.n);
  if(a==='fzFotoRm')return fzFotoRm(+b.dataset.n);
  if(a==='fzApagar'){if(!confirm(`Apagar a avaliação de fezes do ${GT.cur} em ${dB(GT.dia)}?`))return;const x=fzItem(GT.dia,GT.cur);if(x)gDel(x.uid);return gRender();}});
$('gBox').addEventListener('change',e=>{if(GT.t!=='fezes')return;
  if(e.target.id==='fzDia'){GT.dia=e.target.value||hojeKey();GT.cur=null;return gRender();}
  if(e.target.id==='fzHCur'){GT.hCur=e.target.value;return gRender();}
  if(e.target.id==='fzFotoIn'){const fs=[...(e.target.files||[])];e.target.value='';return fzFotosAnexar(fs);}
  if(e.target.id==='fzObs'){if(typeof bloqueado==='function'&&bloqueado())return;const c=GT.cur;if(!c)return;const x=fzItem(GT.dia,c)||{uid:fzId(GT.dia,c),tipo:'fezes',dia:GT.dia,curral:c,c:[0,0,0,0,0]};
    const n=JSON.parse(JSON.stringify(x));n.obs=e.target.value;gPut(n);toast('Observação salva');}});

/* ---------- Escore de fezes: fotos (até 4 por curral/dia), guardadas no Google Drive pela planilha ---------- */
const FZ_MAXF=6,FZ_FOTO={},FZ_ENV={};   // FZ_FOTO: cache id → dataURL; FZ_ENV: fotos subindo (por curral)
function fzFotosHTML(x){const fo=(x&&x.fotos)||[],env=FZ_ENV[GT.dia+'|'+GT.cur]||0,livre=FZ_MAXF-fo.length-env;
  const th=fo.map((f,n)=>{const src=FZ_FOTO[f.idMini];if(!src)fzFotoCarregar(f.idMini);
    return `<div class="fzFoto"><button class="fzFotoImg" data-g="fzFotoVer" data-n="${n}" aria-label="Ver foto ${n+1}">${src?`<img src="${src}" alt="">`:'<span>⏳</span>'}</button>${typeof modoVer!=='undefined'&&modoVer?'':`<button class="fzFotoX" data-g="fzFotoRm" data-n="${n}" aria-label="Apagar foto ${n+1}">✕</button>`}</div>`;}).join('')
    +Array.from({length:env},()=>'<div class="fzFoto"><span class="fzFotoUp">⬆ enviando…</span></div>').join('');
  return `<div class="fzFotos"><div class="fzFotosTopo"><span>📷 Fotos <small>(${fo.length} de ${FZ_MAXF})</small></span>
    ${livre>0&&!(typeof modoVer!=='undefined'&&modoVer)?`<button class="mini" data-g="fzFotoAdd">📎 Anexar imagens</button>`:''}</div>
    ${th?`<div class="fzFotoGrade">${th}</div>`:''}<input type="file" id="fzFotoIn" accept="image/*" multiple hidden></div>`;}
function fzRedim(file,max,q){return new Promise((ok_,erro)=>{const u=URL.createObjectURL(file),im=new Image();
  im.onload=()=>{const k=Math.min(1,max/Math.max(im.width,im.height)),cv=document.createElement('canvas');cv.width=Math.round(im.width*k);cv.height=Math.round(im.height*k);
    cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);URL.revokeObjectURL(u);ok_(cv.toDataURL('image/jpeg',q));};
  im.onerror=()=>{URL.revokeObjectURL(u);erro(new Error('imagem inválida'));};im.src=u;});}
async function fzFotosAnexar(files){if(typeof bloqueado==='function'&&bloqueado())return;const t=GT,c=t.cur,dia=t.dia;if(!c||!files.length)return;
  if(!navigator.onLine)return toast('Sem internet: anexe as fotos quando tiver sinal');
  const chave=dia+'|'+c,ja=((fzItem(dia,c)||{}).fotos||[]).length,livre=FZ_MAXF-ja-(FZ_ENV[chave]||0);
  if(livre<=0)return toast(`Máximo de ${FZ_MAXF} fotos por curral`);
  if(files.length>livre)toast(`Só cabem mais ${livre} foto(s): as outras ficaram de fora`);
  files=files.slice(0,livre);FZ_ENV[chave]=(FZ_ENV[chave]||0)+files.length;gRender();let okN=0;
  for(const f of files){try{const big=await fzRedim(f,1024,.6),mini=await fzRedim(f,300,.6);  // compactadas: ~100 KB a grande, ~15 KB a miniatura
      const r=await postApi({acao:'fotoSalvar',img:big.split(',')[1],mini:mini.split(',')[1],nome:`${dB(dia).replace(/\//g,'-')} ${c} ${Date.now()}`});
      if(!r.id)throw new Error('sem id');FZ_FOTO[r.idMini||r.id]=mini;
      const x=fzItem(dia,c)||{uid:fzId(dia,c),tipo:'fezes',dia,curral:c,c:[0,0,0,0,0],obs:''},n=JSON.parse(JSON.stringify(x));
      n.fotos=(n.fotos||[]).concat([{id:r.id,idMini:r.idMini||r.id}]).slice(0,FZ_MAXF);const o=$('fzObs');if(o&&GT.cur===c)n.obs=o.value;gPut(n);okN++;}
    catch(e){toast('Não consegui enviar a foto: '+(e.message||e));}
    finally{FZ_ENV[chave]=Math.max(0,(FZ_ENV[chave]||1)-1);if(GT.t==='fezes'){const y=window.scrollY;gRender();window.scrollTo({top:y});}}}
  if(okN)toast(`${okN} foto(s) anexada(s)`);}
const FZ_CARR={};
function fzFotoCarregar(id){if(!id||FZ_FOTO[id])return Promise.resolve();if(FZ_CARR[id])return FZ_CARR[id];
  FZ_CARR[id]=(async()=>{
  try{const u=apiUrl()+(apiUrl().includes('?')?'&':'?')+'acao=fotoVer&id='+encodeURIComponent(id);const j=await (await fetch(u)).json();
    if(j&&j.ok&&j.imagem){FZ_FOTO[id]='data:'+(j.tipo||'image/jpeg')+';base64,'+j.imagem;if(GT.t==='fezes'){const y=window.scrollY;gRender();window.scrollTo({top:y});}}}
  catch(e){}finally{delete FZ_CARR[id];}})();return FZ_CARR[id];}
async function fzFotoVer(n){const f=((fzItem(GT.dia,GT.cur)||{}).fotos||[])[n];if(!f)return;
  const w=document.createElement('div');w.className='fzFotoTela';w.innerHTML=`<img src="${FZ_FOTO[f.id]||FZ_FOTO[f.idMini]||''}" alt=""><span class="fzFotoCarr">${FZ_FOTO[f.id]?'':'carregando…'}</span><button aria-label="Fechar">✕</button>`;
  w.onclick=()=>w.remove();document.body.appendChild(w);
  if(!FZ_FOTO[f.id]){await fzFotoCarregar(f.id);const im=w.querySelector('img'),s_=w.querySelector('.fzFotoCarr');if(FZ_FOTO[f.id]){im.src=FZ_FOTO[f.id];s_.textContent='';}else s_.textContent='não consegui abrir a foto (sem internet?)';}}
async function fzFotoRm(n){if(typeof bloqueado==='function'&&bloqueado())return;const x=fzItem(GT.dia,GT.cur);const f=x&&(x.fotos||[])[n];if(!f)return;
  if(!confirm('Apagar esta foto?'))return;const nx=JSON.parse(JSON.stringify(x));nx.fotos.splice(n,1);gPut(nx);const y=window.scrollY;gRender();window.scrollTo({top:y});
  try{await postApi({acao:'fotoApagar',ids:[f.id,f.idMini].filter((v,i,a)=>v&&a.indexOf(v)===i)});}catch(e){}}
window.fzFotoCarregar=fzFotoCarregar;window.FZ_FOTO=FZ_FOTO;

/* ---------- Escore de fezes: relatório com gráfico de cada curral (PDF e imagem) ---------- */
const FZ_COR=['#c62828','#f2b705','#2e7d32','#8d6e63','#4e342e'];
function fzDadosDia(){const t=GT;return gTodos('fezes').filter(x=>x.dia===t.dia&&doLocal(t.loc,x.curral)).map(x=>({c:x.curral,k:fzCalc(x.c),obs:x.obs||'',fotos:x.fotos||[]})).filter(o=>o.k.tot)
  .sort((a,b)=>alfa(a.c,b.c));}
/* um quadro com o gráfico de barras do curral */
function fzQuadro(x,X,Y,W,H,o,dia){const k=o.k,st=fzStatus(k),L=gTodos('lote').filter(l=>nAt(curralEm(l,dia))===nAt(o.c)&&cabPres(l,dia)>0);
  x.fillStyle='#fff';x.strokeStyle='#d5dde5';x.lineWidth=2;x.beginPath();x.roundRect?x.roundRect(X,Y,W,H,16):x.rect(X,Y,W,H);x.fill();x.stroke();
  x.textAlign='left';x.fillStyle='#13243d';x.font='bold 34px Arial';x.fillText(o.c,X+24,Y+48);
  x.font='20px Arial';x.fillStyle='#5d6b7a';x.fillText(L.map(l=>[[catNorm(l.cat)||l.nome,l.raca||''].filter(Boolean).join(' '),nf(cabPres(l,dia))+' cab',nf(pesoEm(l,dia))+' kg proj.'].join(' – ')).join('  |  ')+(ok(o.pv1)?` – % IMS PV D-1: ${nf(o.pv1,2)}%`:''),X+24,Y+78);
  x.textAlign='right';x.fillStyle='#13243d';x.font='bold 22px Arial';x.fillText(`${k.tot} fezes avaliadas`,X+W-24,Y+44);
  x.fillStyle=st.cl==='bad'?'#b3261e':st.cl==='warn'?'#a86b00':'#2e7d32';x.font='bold 22px Arial';x.fillText(`Média ${fz1(k.media)} · ${st.txt}`,X+W-24,Y+74);
  /* barras */
  const top=Y+110,base=Y+H-(o.obs?96:70),ch=base-top-40,bw=(W-48)/5,mx=Math.max(1,...k.pct);
  x.strokeStyle='#e3e8ee';x.lineWidth=1;for(let g=0;g<=4;g++){const yy=base-ch*g/4;x.beginPath();x.moveTo(X+24,yy);x.lineTo(X+W-24,yy);x.stroke();}
  k.pct.forEach((p,i)=>{const bx=X+24+i*bw+bw*0.18,w=bw*0.64,h=ch*p/mx,by=base-h;
    x.fillStyle=FZ_COR[i];x.fillRect(bx,by,w,Math.max(h,p?2:0));
    x.textAlign='center';x.fillStyle='#13243d';x.font='bold 24px Arial';x.fillText(fzPc(p),bx+w/2,by-30);
    x.font='19px Arial';x.fillStyle='#5d6b7a';x.fillText(`${k.cs[i]} de ${k.tot}`,bx+w/2,by-8);
    x.fillStyle='#13243d';x.font='bold 22px Arial';x.fillText('Escore '+(i+1),bx+w/2,base+28);
    x.fillStyle='#5d6b7a';x.font='18px Arial';x.fillText(FZ_DESC[i+1],bx+w/2,base+52);});
  x.strokeStyle='#9aa7b4';x.lineWidth=2;x.beginPath();x.moveTo(X+24,base);x.lineTo(X+W-24,base);x.stroke();
  if(o.obs){x.textAlign='left';x.fillStyle='#5d6b7a';x.font='italic 18px Arial';x.fillText('Obs.: '+o.obs.slice(0,95),X+24,Y+H-12);}}
/* monta as páginas (A4 em pé, 3 currais por página) */
/* páginas do PDF: curral COM fotos vai sozinho numa página, com as fotos embaixo do gráfico; os SEM fotos vão 3 por página */
function fzPaginas(imgs){const D=fzDadosDia(),dia=GT.dia,W=1240,H=1754,pags=[];if(!D.length)return pags;imgs=imgs||{};
  const G5=[0,0,0,0,0];D.forEach(o=>o.k.cs.forEach((n,i)=>G5[i]+=n));const KG=fzCalc(G5);
  const comF=o=>o.fotos.some(f=>imgs[f.id]||imgs[f.idMini]);
  /* ordem alfabética sempre: curral com fotos ocupa a página inteira no lugar dele; os sem fotos vão juntos, até 3 por página */
  const grupos=[];let buf=[];D.forEach(o=>{if(comF(o)){if(buf.length){grupos.push(buf);buf=[];}grupos.push([o]);}else{buf.push(o);if(buf.length===3){grupos.push(buf);buf=[];}}});if(buf.length)grupos.push(buf);
  /* % IMS do PV do dia anterior (D-1) de cada curral (mesmo cálculo do relatório de índices) */
  try{const X=gCtx(),d1=somaDias(dia,-1);D.forEach(o=>{let s=0,w=0;gTodos('lote').forEach(l=>{if(!l.ent)return;const y=diaLote(l,d1,X);if(!y||nAt(y.c)!==nAt(o.c)||!(y.mn>0)||!ok(y.pv))return;s+=y.pv*y.cab;w+=y.cab;});o.pv1=w?s/w:NaN;});}catch(e){}
  const total=grupos.length;
  grupos.forEach((g,p)=>{const cv=document.createElement('canvas');cv.width=W;cv.height=H;const x=cv.getContext('2d');
    x.fillStyle='#f4f6f2';x.fillRect(0,0,W,H);x.fillStyle='#24502a';x.fillRect(0,0,W,130);
    x.fillStyle='#fff';x.textAlign='left';x.font='bold 40px Arial';x.fillText('Escore de fezes',40,62);
    x.font='24px Arial';x.fillStyle='#d8f06a';x.fillText(`${dB(dia)}${GT.loc==='C'?' · Confinamento':GT.loc==='P'?' · Pasto':''} · FJK Agropecuária`,40,102);
    x.textAlign='right';x.fillStyle='#fff';x.font='bold 24px Arial';x.fillText(`Geral: ${KG.tot} fezes · média ${fz1(KG.media)}`,W-40,62);
    x.font='20px Arial';x.fillText(`${D.length} curral(is) · página ${p+1} de ${total}`,W-40,100);
    const bh=(H-130-90-3*24)/3;
    if(g.length===1&&comF(g[0])){const o=g[0];fzQuadro(x,40,154,W-80,bh,o,dia);
      /* fotos: até 6, 3 por fileira abaixo do gráfico */
      const fs=o.fotos.map(f=>imgs[f.id]||imgs[f.idMini]).filter(Boolean).slice(0,FZ_MAXF),y0=154+bh+30,areaH=H-y0-100,cols=fs.length<=2?Math.max(1,fs.length):3,rows=Math.ceil(fs.length/cols),gap=20;
      const cw=(W-80-(cols-1)*gap)/cols,ch=(areaH-(rows-1)*gap)/rows;
      x.fillStyle='#24502a';x.textAlign='left';x.font='bold 24px Arial';x.fillText(`📷 Fotos · ${o.c}`,40,y0-6);
      fs.forEach((im,i)=>{const cx=40+(i%cols)*(cw+gap),cy=y0+14+Math.floor(i/cols)*(ch+gap),bw=cw,bh2=ch-14;
        /* sempre em pé e do mesmo tamanho: foto deitada gira 90°; preenche o quadro inteiro (corta só a sobra das bordas) */
        const deit=im.width>im.height,iw=deit?im.height:im.width,ih=deit?im.width:im.height,k=Math.max(bw/iw,bh2/ih);
        x.save();x.beginPath();x.rect(cx,cy,bw,bh2);x.clip();x.translate(cx+bw/2,cy+bh2/2);if(deit)x.rotate(Math.PI/2);
        x.drawImage(im,-im.width*k/2,-im.height*k/2,im.width*k,im.height*k);x.restore();x.strokeStyle='#d5dccd';x.lineWidth=2;x.strokeRect(cx,cy,bw,bh2);});}
    else g.forEach((o,j)=>fzQuadro(x,40,154+j*(bh+24),W-80,bh,o,dia));
    x.textAlign='left';x.fillStyle='#5d6b7a';x.font='18px Arial';
    x.fillText('Escala: 1 líquida · 2 mole · 3 ideal (pastosa) · 4 firme · 5 seca. Ideal: maioria no escore 3, média entre 2,5 e 3,5.',40,H-48);
    x.fillText('Mais de 20% em 1+2 = fezes moles (risco de acidose) · mais de 20% em 4+5 = fezes firmes.',40,H-22);
    pags.push(cv);});
  return pags;}
/* busca as fotos (tamanho grande) dos currais do dia para o PDF */
async function fzFotosParaPdf(){const D=fzDadosDia(),imgs={},ids=[];D.forEach(o=>o.fotos.forEach(f=>ids.push(f)));if(!ids.length)return imgs;
  if(ids.some(f=>!FZ_FOTO[f.id])&&!navigator.onLine)toast('Sem internet: o PDF vai sem as fotos que não estão no aparelho');
  else if(ids.some(f=>!FZ_FOTO[f.id]))toast('Buscando as fotos…');
  await Promise.all(ids.map(async f=>{try{if(!FZ_FOTO[f.id])await fzFotoCarregar(f.id);const src=FZ_FOTO[f.id]||FZ_FOTO[f.idMini];if(!src)return;
    imgs[f.id]=await new Promise((ok_,er)=>{const im=new Image();im.onload=()=>ok_(im);im.onerror=er;im.src=src;});}catch(e){}}));
  return imgs;}
/* histórico do escore (7/15/30 dias, um curral ou todos): gráfico + tabela, em PDF ou imagem */
function fzHistCanvas(){const t=GT,dia=t.dia,hN=[7,15,30].includes(+t.hN)?+t.hN:30,ini=somaDias(dia,-(hN-1)),cH=t.hCur||'';
  const porDia={};gTodos('fezes').filter(x=>x.dia>=ini&&x.dia<=dia&&(cH?nAt(x.curral)===cH:doLocal(t.loc,nAt(x.curral)))).forEach(x=>{const k=fzCalc(x.c);if(!k.tot)return;const d=porDia[x.dia]||(porDia[x.dia]=[0,0,0,0,0]);k.cs.forEach((n,i)=>d[i]+=n);});
  const dias=Object.keys(porDia).sort();if(!dias.length)return null;
  const W=1240,top=130,gH=460,rowH=44,H=top+40+gH+70+60+(dias.length+1)*rowH+90,cv=document.createElement('canvas');cv.width=W;cv.height=H;const x=cv.getContext('2d');
  const quem=cH||(t.loc==='C'?'Todo o confinamento':t.loc==='P'?'Todo o pasto':'Todos os currais');
  x.fillStyle='#fff';x.fillRect(0,0,W,H);x.fillStyle='#24502a';x.fillRect(0,0,W,top);
  x.fillStyle='#fff';x.textAlign='left';x.font='bold 40px Arial';x.fillText('Escore de fezes · Histórico',40,62);
  x.font='24px Arial';x.fillStyle='#d8f06a';x.fillText(`${quem} · últimos ${hN} dias (${dB(ini).slice(0,5)} a ${dB(dia).slice(0,5)}) · FJK Agropecuária`,40,102);
  const T5=[0,0,0,0,0];dias.forEach(d=>porDia[d].forEach((n,i)=>T5[i]+=n));const KT=fzCalc(T5);
  x.textAlign='right';x.fillStyle='#fff';x.font='bold 24px Arial';x.fillText(`${KT.tot} fezes · média ${fz1(KT.media)}`,W-40,62);
  /* gráfico: uma coluna por dia avaliado, empilhada 1→5 em % */
  const gx=90,gy=top+40,gw=W-130,n=dias.length,slot=gw/n,bw=Math.min(70,slot*.7);
  x.strokeStyle='#d5dccd';x.lineWidth=1;x.fillStyle='#5d6b7a';x.font='18px Arial';x.textAlign='right';
  [0,25,50,75,100].forEach(v=>{const yy=gy+gH-gH*v/100;x.beginPath();x.moveTo(gx,yy);x.lineTo(gx+gw,yy);x.stroke();x.fillText(v+'%',gx-10,yy+6);});
  dias.forEach((d,j)=>{const k=fzCalc(porDia[d]),bx=gx+slot*j+(slot-bw)/2;let yy=gy+gH;
    k.pct.forEach((p,i)=>{const h=gH*p/100;x.fillStyle=FZ_COR[i];x.fillRect(bx,yy-h,bw,h);yy-=h;});
    x.fillStyle='#1d2b3a';x.textAlign='center';x.font=(n>15?'15px':'18px')+' Arial';x.fillText(dB(d).slice(0,5),bx+bw/2,gy+gH+26);
    x.font='bold '+(n>15?'14px':'17px')+' Arial';x.fillStyle=fzStatus(k).cl==='ok'?'#2e7d32':fzStatus(k).cl==='warn'?'#b26a00':'#b3261e';x.fillText(fz1(k.media),bx+bw/2,gy-8);});
  /* legenda */
  let lx=gx;const ly=gy+gH+62;x.font='20px Arial';x.textAlign='left';
  [1,2,3,4,5].forEach(i=>{x.fillStyle=FZ_COR[i-1];x.fillRect(lx,ly-16,20,20);x.fillStyle='#1d2b3a';const tx=`${i} ${FZ_DESC[i]}`;x.fillText(tx,lx+28,ly);lx+=28+x.measureText(tx).width+34;});
  /* tabela */
  const cols=[['Dia',40,'l'],['N',300,'r'],['1',420,'r'],['2',540,'r'],['3',660,'r'],['4',780,'r'],['5',900,'r'],['Média',1180,'r']];let ty=ly+60;
  x.font='bold 20px Arial';x.fillStyle='#5d6b7a';cols.forEach(([c,cx,al])=>{x.textAlign=al==='l'?'left':'right';x.fillText(c,cx,ty);});
  dias.slice().reverse().concat(['__tot']).forEach((d,r)=>{ty+=rowH;const tot=d==='__tot',k=tot?KT:fzCalc(porDia[d]);
    if(tot){x.fillStyle='#eef3e4';x.fillRect(30,ty-30,W-60,rowH);}else{x.strokeStyle='#e3e8dc';x.beginPath();x.moveTo(30,ty-30);x.lineTo(W-30,ty-30);x.stroke();}
    const v=[tot?'Período':dB(d).slice(0,5),String(k.tot)].concat(k.pct.map(p=>p?p.toFixed(0)+'%':'·')).concat([fz1(k.media)]);
    cols.forEach(([c,cx,al],i)=>{x.textAlign=al==='l'?'left':'right';x.font=(tot||i===4||i===7?'bold ':'')+'21px Arial';
      x.fillStyle=i===7?(fzStatus(k).cl==='ok'?'#2e7d32':fzStatus(k).cl==='warn'?'#b26a00':'#b3261e'):'#1d2b3a';x.fillText(v[i],cx,ty);});});
  x.textAlign='left';x.fillStyle='#5d6b7a';x.font='18px Arial';x.fillText('Ideal: maioria no escore 3, média entre 2,5 e 3,5 · >20% em 1+2 = moles (acidose) · >20% em 4+5 = firmes.',40,H-30);
  return cv;}
async function fzHistExport(pdf){const cv=fzHistCanvas();if(!cv)return toast('Sem avaliações nesse período');const t=GT,hN=[7,15,30].includes(+t.hN)?+t.hN:30;
  const nome=`Escore de fezes historico ${hN} dias ${(t.hCur||'todos').replace(/[\\/:*?"<>|]/g,'-')} ${dB(t.dia).replace(/\//g,'-')}`;
  try{if(pdf)await compartilharArquivo(fzPdf([cv]),nome+'.pdf','application/pdf');
    else cv.toBlob(b=>compartilharArquivo(b,nome+'.png','image/png'),'image/png');}catch(e){toast('Não consegui gerar o arquivo');}}
window.fzHistCanvas=fzHistCanvas;
/* ---------- Relatório zootécnico do dia (Tratos › Histórico): por lote/curral, com consumo MN, MS e % PV ---------- */
function zootDados(dia,loc){const X=gCtx(),L=gTodos('lote').filter(l=>l.ent&&cabPres(l,dia,X.sd.get(l.uid))>0);
  const media=(l,ini,fim,f)=>{let s=0,n=0;for(let d=ini,i=0;d<=fim&&i<4000;d=somaDias(d,1),i++){const x=diaLote(l,d,X);if(x&&x.mn>0){const v=f(x);if(ok(v)){s+=v;n++;}}}return n?s/n:NaN;};
  const rows=[];L.forEach(l=>{const x=diaLote(l,dia,X);if(!x||!doLocal(loc||'T',x.c))return;
    const d1=diaLote(l,somaDias(dia,-1),X),lt=G.it[idLeit(dia,x.c)],ini5=somaDias(dia,-4),ini0=l.ent.dia>ini5?l.ent.dia:ini5;
    rows.push({c:nAt(x.c),lote:l.nome,sexo:sexoNorm(l.sexo)||'',ent:l.ent.dia,cab:x.cab,dias:difDias(l.ent.dia,dia),rac:(()=>{let t=linhaDe(nAt(x.c));if(t==='O')t=linhaDe(x.c);if(t==='O')t=/pasto/i.test(x.rac||'')?'P':'C';return t==='P'?'Pasto':'Conf';})(),racNome:x.rac,nota:lt&&!lt.del&&lt.nota!=null?+lt.nota:null,msRac:x.cp?Math.round(x.cp.ms*10)/10:NaN,
      pE:+l.ent.peso,pP:x.peso,gmd:+l.gmd||NaN,
      mnG:media(l,l.ent.dia,dia,y=>y.mnCab),mnD:x.mn>0?x.mnCab:NaN,
      msG:media(l,l.ent.dia,dia,y=>y.msCab),msD:x.mn>0?x.msCab:NaN,ms1:d1&&d1.mn>0?d1.msCab:NaN,ms5:media(l,ini0,dia,y=>y.msCab),
      pvG:media(l,l.ent.dia,dia,y=>y.pv),pvD:x.mn>0?x.pv:NaN,pv1:d1&&d1.mn>0?d1.pv:NaN,pv5:media(l,ini0,dia,y=>y.pv),
      /* financeiro: custo do dia por cabeça (ração + operacional) e acumulado por cabeça desde a entrada */
      fD:((ok(x.custoR)?x.custoR:0)+x.custoOp)/x.cab,fA:(()=>{let a=0;for(let d=l.ent.dia,i=0;d<=dia&&i<4000;d=somaDias(d,1),i++){const y=diaLote(l,d,X);if(y&&y.cab)a+=((ok(y.custoR)?y.custoR:0)+y.custoOp)/y.cab;}return a;})()});});
  rows.sort((a,b)=>(a.rac==='Conf'?0:1)-(b.rac==='Conf'?0:1)||alfa(a.c,b.c)||alfa(a.lote,b.lote));
  /* totais: médias ponderadas pelas cabeças */
  const cab=rows.reduce((a,r)=>a+r.cab,0),pond=k=>{let s=0,w=0;rows.forEach(r=>{if(ok(r[k])){s+=r[k]*r.cab;w+=r.cab;}});return w?s/w:NaN;};
  const T={cab};['dias','msRac','pE','pP','gmd','mnG','mnD','msG','msD','ms1','ms5','pvG','pvD','pv1','pv5','fD','fA'].forEach(k=>T[k]=pond(k));
  return {dia,loc:loc||'T',rows,T};}
const ZCOLS=[ // [chave, título, grupo, casas, largura no PDF]
  ['c','Curral','id',null,177],['ent','Entrada','id','dia',120],['sexo','Sexo','id',null,48],['cab','Cab.','id',0,70],
  ['dias','Dias','id2',0,60],['rac','Dieta','id2',null,80],['msRac','MS dieta','id2',1,95],
  ['pE','Entrada','pes',0,90],['pP','Projetado','pes',0,105],['gmd','GMD','pes',2,70],
  ['nota','','nt',0,55],
  ['mnG','Geral','mn',2,85],['mnD','Dia','mn',2,85],
  ['msG','Geral','ms',2,80],['msD','Dia','ms',2,80],['ms1','D-1','ms',2,80],['ms5','5 dias','ms',2,80],
  ['pvG','Geral','pv',2,75],['pvD','Dia','pv',2,75],['pv1','D-1','pv',2,75],['pv5','5 dias','pv',2,75],
  ['fD','Diária','fin','rs',95],['fA','Acumulado','fin','rs',115]];
const ZGRP={id:'Identificação',id2:'Trato',nt:'Nota',fin:'R$/cab',pes:'Peso (kg)',mn:'MN kg/cab/dia',ms:'MS kg/cab/dia',pv:'% IMS do PV'};
const ZCOR={id:'#24502a',id2:'#5b8f3e',pes:'#24502a',nt:'#5b8f3e',mn:'#24502a',ms:'#5b8f3e',pv:'#24502a',fin:'#1f5fa8'};
const zVal=(r,k,d)=>{const v=r[k];if(d==='dia')return v?dB(v):'';if(d==='rs')return ok(+v)?nf(+v,2):'—';if(d==null)return v==null?'':String(v);return ok(+v)&&v!==null&&v!==''?nf(+v,d):'—';};
function zootCards(T){return [['Cabeças',nf(T.cab)],['Peso entrada',nf(T.pE,1)+' kg'],['Peso projetado',nf(T.pP,1)+' kg'],['GMD',nf(T.gmd,2)],['Dias (média)',nf(T.dias)],['MN dia',nf(T.mnD,2)+' kg/cab'],['MS dia',nf(T.msD,2)+' kg/cab'],['% PV dia',pc(T.pvD,2)]];}
/* estado único do relatório de índices: o mesmo em Tratos › Histórico › Relatório e em Gestão › Relatórios › Índices do dia */
window.ZST=window.ZST||{dia:null,loc:'T'};
function zootBoxHTML(){const dia=ZST.dia||(ZST.dia=hojeKey()),loc=ZST.loc||'T',D=zootDados(dia,loc);
  const top=`<div class="curhead"><h2>Índices do dia</h2><input type="date" id="zDia" value="${dia}" max="${hojeKey()}" aria-label="Dia do relatório"></div>
    <div class="linhas zLoc">${[['T','Todos'],['C','Confinamento'],['P','🌿 Pasto']].map(([k,t])=>`<button data-zloc="${k}" class="${loc===k?'sel':''}">${t}</button>`).join('')}</div>
    ${D.rows.length?'<div class="row compart fz3"><button class="verde" data-z="pdf">📄 PDF</button><button class="verde" data-z="img">🖼 Foto</button><button class="verde" data-z="xls">📊 Excel</button></div>':''}
    <p class="note">${dB(dia)}: consumo de matéria natural, matéria seca, % do peso vivo e custo por cabeça.</p>`;
  if(!D.rows.length)return top+'<p class="note">Nenhum lote com animais neste dia.</p>';
  const tab=`<div class="tablebox"><table class="gTab zTab"><thead><tr><th>Curral</th><th>Cab</th><th>Dias</th><th>MN dia</th><th>MS dia</th><th>% PV</th></tr></thead><tbody>
    ${D.rows.map(r=>`<tr><td class="c">${esc(r.c)}<small>${r.rac}${r.sexo?' · '+r.sexo:''}${r.nota!=null?' · nota '+r.nota:''}</small><small class="zFin">${rs(r.fD)}/dia · acum. ${rs(r.fA)}</small></td><td>${nf(r.cab)}</td><td>${nf(r.dias)}</td><td>${nf(r.mnD,2)}</td><td><b>${nf(r.msD,2)}</b></td><td>${pc(r.pvD,2)}</td></tr>`).join('')}
    <tr class="grp"><td>Média<small class="zFin">${rs(D.T.fD)}/dia · acum. ${rs(D.T.fA)}</small></td><td>${nf(D.T.cab)}</td><td></td><td>${nf(D.T.mnD,2)}</td><td>${nf(D.T.msD,2)}</td><td>${pc(D.T.pvD,2)}</td></tr></tbody></table></div>
    <p class="note">MN e MS em kg por cabeça no dia. Em azul, o custo por cabeça (ração + operacional): do dia e acumulado desde a entrada. O PDF, a Foto e o Excel trazem o relatório completo.</p>`;
  return top+tab;}
window.zootBoxHTML=zootBoxHTML;
function zootRepintar(){try{if(window.pintarZoot)pintarZoot();}catch(e){}if(GT&&GT.t==='indices')gRender();}
if(!window.__zootEv){window.__zootEv=1;
  document.addEventListener('click',e=>{const box=e.target.closest('.zootBox');if(!box)return;
    const l=e.target.closest('[data-zloc]');if(l){ZST.loc=l.dataset.zloc;zootRepintar();return;}
    const b=e.target.closest('[data-z]');if(b)zootExport(b.dataset.z,ZST.dia||hojeKey(),ZST.loc||'T');});
  document.addEventListener('change',e=>{if(e.target.id==='zDia'&&e.target.closest('.zootBox')&&e.target.value){ZST.dia=e.target.value;zootRepintar();}});}
function tIndices(){return `${voltar('Relatórios')}<section class="panel zootBox">${zootBoxHTML()}</section>`;}
function zootCanvas(D){const W=1754,top=84,rowH=38,hd=72,porPag=Math.max(5,Math.floor((1240-top-30-hd-60)/rowH)),pags=[];
  const all=D.rows.concat([{__tot:1}]),nP=Math.ceil(all.length/porPag);
  const totW=ZCOLS.reduce((a,c)=>a+c[4],0),esc_=(W-60)/totW;
  for(let p=0;p<nP;p++){const R=all.slice(p*porPag,(p+1)*porPag),H=top+30+hd+R.length*rowH+70,cv=document.createElement('canvas');cv.width=W;cv.height=Math.max(H,p===0?0:400);const x=cv.getContext('2d');
    x.fillStyle='#fff';x.fillRect(0,0,W,cv.height);x.fillStyle='#24502a';x.fillRect(0,0,W,top);
    x.fillStyle='#fff';x.textAlign='left';x.font='bold 38px Arial';x.fillText(`FJK Agropecuária - Tratos ${dB(D.dia)}`,40,top/2+13);
    x.textAlign='right';x.font='20px Arial';x.fillStyle='#d8f06a';x.fillText(`${D.loc==='C'?'Confinamento · ':D.loc==='P'?'Pasto · ':''}página ${p+1} de ${nP}`,W-40,top/2+8);
    /* cartões */
    let y=top+30;
    /* cabeçalho da tabela: grupos e colunas */
    let cx=30;const pos=ZCOLS.map(c=>{const w=c[4]*esc_,o={x:cx,w};cx+=w;return o;});
    let g0=0;for(let i=1;i<=ZCOLS.length;i++){if(i===ZCOLS.length||ZCOLS[i][2]!==ZCOLS[g0][2]){const gx=pos[g0].x,gw=pos[i-1].x+pos[i-1].w-gx;
      x.fillStyle=ZCOR[ZCOLS[g0][2]]||'#24502a';x.fillRect(gx+2,y,gw-4,32);x.fillStyle='#fff';x.font='bold 18px Arial';x.textAlign='center';x.fillText(ZGRP[ZCOLS[g0][2]],gx+gw/2,y+22);g0=i;}}
    const ROXO='#24502a';  // linha MÉDIA: verde escuro do cabeçalho
    /* linha dos títulos das colunas: cada grupo na cor do seu título de cima (verde escuro / verde claro alternados; financeiro azul) */
    {let a=0;for(let i=1;i<=ZCOLS.length;i++){if(i===ZCOLS.length||ZCOLS[i][2]!==ZCOLS[a][2]){const gx=pos[a].x,gw=pos[i-1].x+pos[i-1].w-gx;x.fillStyle=ZCOR[ZCOLS[a][2]]||'#24502a';x.fillRect(gx+2,y+38,gw-4,32);a=i;}}}
    x.fillStyle='#fff';x.font='bold 17px Arial';ZCOLS.forEach((c,i)=>{if(c[0]==='c'&&window.ZCALIGN==='left'){x.textAlign='left';x.fillText(c[1],pos[i].x+8,y+60);}else{x.textAlign='center';x.fillText(c[1],pos[i].x+pos[i].w/2,y+60);}});
    y+=hd;
    R.forEach((r,j)=>{const tot=!!r.__tot,v=tot?Object.assign({c:'MÉDIA',lote:'',sexo:'',ent:'',rac:'',nota:null},D.T):r;
      if(tot){x.fillStyle=ROXO;x.fillRect(30,y,W-60,rowH);}else if(j%2){x.fillStyle=window.ZSTRIPE||'#dde6cf';x.fillRect(30,y,W-60,rowH);}  // linhas alternadas: uma clara, uma mais escura
      ZCOLS.forEach((c,i)=>{let t=zVal(v,c[0],c[3]);if(tot&&c[0]==='cab')t=nf(D.T.cab);if(tot&&['nota','dias','msRac'].includes(c[0]))t='';
        x.font=(tot||c[0]==='c'||c[0]==='msD'?'bold ':'')+'18px Arial';x.fillStyle=tot?'#fff':'#1d2b3a';
        const al=c[0]==='c'&&window.ZCALIGN==='left'?'left':'center';x.textAlign=al;
        let tt=t;if(c[0]==='c'){let fs=18;while(fs>11&&x.measureText(tt).width>pos[i].w-10){fs--;x.font=(tot||true?'bold ':'')+fs+'px Arial';}}  // nome do curral: diminui a letra para caber inteiro
        while(tt.length>3&&x.measureText(tt).width>pos[i].w-10)tt=tt.slice(0,-2)+'…';
        x.fillText(tt,al==='left'?pos[i].x+8:pos[i].x+pos[i].w/2,y+26);});
      y+=rowH;});
    x.textAlign='left';x.fillStyle='#5d6b7a';x.font='17px Arial';
    x.fillText('MN/MS em kg por cabeça por dia · Geral = média desde a entrada · D-1 = dia anterior · 5 dias = média dos últimos 5 dias · Média ponderada pelas cabeças.',40,cv.height-26);
    pags.push(cv);}
  return pags;}
async function zootExport(tipo,dia,loc){const D=zootDados(dia,loc);if(!D.rows.length)return toast('Nenhum lote com animais neste dia');
  const nome=`FJK - Tratos ${dB(dia).replace(/\//g,'-')}${D.loc==='C'?' - Confinamento':D.loc==='P'?' - Pasto':''}`;
  try{if(tipo==='xls'){const lin=r=>ZCOLS.map(c=>{const v=r[c[0]];return c[3]==='dia'?xc(v||null,'dia'):c[3]==='rs'?xc(ok(+v)?+v:'','rs'):c[3]==null?xc(v==null?'':v):xc(ok(+v)&&v!==null?+v:'',c[3]===0?'int':'dec');});
      return gExcel(nome,[['Zootécnico',ZCOLS.map(c=>(c[2]==='fin'?c[1]+' R$/cab':c[0]==='gmd'?'GMD':c[0]==='nota'?'Nota':/^id/.test(c[2])?(c[0]==='msRac'?'MS dieta %':c[0]==='ent'?'Data entrada':c[1]):ZGRP[c[2]].replace(' kg/cab/dia','').replace('% IMS do PV','%PV').replace(' (kg)','')+' '+c[1])),D.rows.map(lin).concat([lin(Object.assign({},D.T,{c:'MÉDIA',lote:'',sexo:'',ent:'',rac:'',nota:'',dias:null,msRac:null}))]),ZCOLS.map(c=>Math.max(8,Math.round(c[4]/9)))]]);}
    const P=zootCanvas(D);
    if(tipo==='pdf')return await compartilharArquivo(fzPdf(P),nome+'.pdf','application/pdf');
    if(P.length===1)return P[0].toBlob(b=>compartilharArquivo(b,nome+'.png','image/png'),'image/png');
    const bl=await Promise.all(P.map(c=>new Promise(r=>c.toBlob(r,'image/png'))));return compartilharVarios(bl,bl.map((_,i)=>`${nome} (${i+1}).png`));}
  catch(e){toast('Não consegui gerar o relatório');}}
window.zootExport=zootExport;window.zootDados=zootDados;
/* Carregar: ajustes só desta batida — ordem de fabricação e o que já está no vagão (sobra de outra batida) */
/* sobra no vagão: por ração (kg da ração que sobrou → quanto de cada produto) ou por insumo (digitado produto a produto) */
function sobraPorIns(){if((CG.sobModo||'rac')==='rac'){const kg=+CG.sobKg||0;if(!CG.sobRac||!(kg>0))return {};const m={};itensCarga(CG.sobRac,kg).forEach(i=>{if(i.ins)m[i.ins]=(m[i.ins]||0)+i.prev;});return m;}return CG.ja||{};}
function itensAjust(its){const o=CG.ordem,ja=sobraPorIns();let L=its.map(i=>{const j=Math.max(0,+ja[i.ins]||0);return Object.assign({},i,{prevOrig:i.prev,ja:j,prev:Math.max(0,i.prev-j)});});
  if(Array.isArray(o)&&o.length)L.sort((a,b)=>{const ia=o.indexOf(a.ins),ib=o.indexOf(b.ins);return (ia<0?999:ia)-(ib<0?999:ib);});return L;}
function cBotAjuste(){const nJa=Object.values(sobraPorIns()).filter(v=>v>0).length,mud=Array.isArray(CG.ordem)&&CG.ordem.length;
  /* aberto = verde cheio; fechado com ordem mudada = contorno verde com ✓ (a ordem continua valendo) */
  return `<button type="button" class="mini${CG.ordAberto?' sel':mud?' mud':''}" data-cordtog="1">⇅ Ordem${mud&&!CG.ordAberto?' ✓':''}</button><button type="button" class="mini${CG.jaAberto?' sel':''}" data-cjatog="1">⚖ Sobra${nJa?' ('+nJa+')':''}</button>`;}
function cTabelaCarga(its){const temJa=CG.jaAberto||its.some(i=>i.ja>0),tot=its.reduce((a,i)=>a+i.prev,0),totJa=its.reduce((a,i)=>a+i.ja,0);
  const ord=CG.ordAberto?`<div class="cOrdem"><p class="note">Toque nas setas para mudar a ordem de fabricação <b>só desta batida</b>.</p>
    ${its.map((i,k)=>`<div class="cOrdLin"><b>${k+1}.</b><span>${esc(i.nome)}</span><button type="button" data-cmov="-1" data-ins="${esc(i.ins)}"${k?'':' disabled'} aria-label="Subir">▲</button><button type="button" data-cmov="1" data-ins="${esc(i.ins)}"${k<its.length-1?'':' disabled'} aria-label="Descer">▼</button></div>`).join('')}
    ${Array.isArray(CG.ordem)?'<button type="button" class="mini" data-cordreset="1">↩ Voltar para a ordem da ração</button>':''}</div>`:'';
  let jaNota='';if(CG.jaAberto){const md=(CG.sobModo||'rac')==='rac'?'rac':'ins',sob=sobraPorIns(),noIts=new Set(its.map(i=>i.ins));
    const fora=Object.keys(sob).filter(k=>sob[k]>0&&!noIts.has(k)).map(k=>`${esc((G.it[k]||{}).nome||'?')} ${nf(sob[k])} kg`),
      demais=its.filter(i=>i.ja>i.prevOrig).map(i=>`${esc(i.nome)} (sobra ${nf(i.ja)} kg, a mistura usa ${nf(i.prevOrig)} kg)`);
    const rac=gTodos('racao').filter(r=>!r.inativa||r.uid===CG.sobRac).sort(porNome);
    jaNota=`<div class="cSobra"><div class="linhas"><b>Sobra no vagão:</b><button type="button" data-csmodo="rac" class="${md==='rac'?'sel':''}">Ração</button><button type="button" data-csmodo="ins" class="${md==='ins'?'sel':''}">Insumo</button></div>
      ${md==='rac'?`<div class="cSobLin"><select id="cSobRac"><option value="">— qual ração sobrou —</option>${rac.map(r=>`<option value="${r.uid}"${r.uid===CG.sobRac?' selected':''}>${esc(r.nome)}</option>`).join('')}</select>
        <input type="text" inputmode="decimal" id="cSobKg" placeholder="kg" value="${CG.sobKg?String(CG.sobKg).replace('.',','):''}"></div>
        ${Object.keys(sob).length?`<p class="note">Nessa sobra tem: ${Object.keys(sob).map(k=>`<b>${esc((G.it[k]||{}).nome||'?')}</b> ${nf(sob[k])} kg`).join(' · ')}. Já foi descontado abaixo.</p>`:'<p class="note">Escolha a ração que sobrou e quantos kg. O app calcula quanto tem de cada produto e desconta da batida.</p>'}`
      :'<p class="note">Digite na coluna <b>Sobra</b> quanto de cada produto já está no vagão.</p>'}
      ${fora.length?`<p class="cAviso">⚠ Na sobra tem produto que esta ração não usa: ${fora.join(', ')}. Ele vai junto na mistura.</p>`:''}
      ${demais.length?`<p class="cAviso">⚠ Sobra maior que o necessário: ${demais.join('; ')}.</p>`:''}
      <p class="note">A fórmula da ração não muda; o estoque baixa só o que for carregado agora.</p></div>`;}
  return ord+jaNota+`<div class="tablebox"><table class="gTab"><thead><tr><th>Produto</th><th>% MN</th>${temJa?'<th>Sobra</th>':''}<th>Carregar (kg)</th></tr></thead><tbody>${its.map(i=>`<tr><td class="c">${esc(i.nome)}${i.ja>0?`<small>mistura: ${nf(i.prevOrig)} kg</small>`:''}</td><td>${nf(i.pMN,1)}</td>${temJa?`<td>${CG.jaAberto&&(CG.sobModo||'rac')!=='rac'?`<input type="text" inputmode="decimal" class="cJaIn" data-cja="${esc(i.ins)}" value="${i.ja?String(i.ja).replace('.',','):''}" placeholder="0">`:nf(i.ja)}</td>`:''}<td><b>${nf(i.prev)}</b>${i.ja>0&&i.prev===0?'<small>já tem tudo</small>':''}</td></tr>`).join('')}
      <tr class="grp"><td>Total</td><td>100,0</td>${temJa?`<td>${nf(totJa)}</td>`:''}<td>${nf(tot)}</td></tr></tbody></table></div>
    ${totJa>0?(()=>{const sobT=Object.values(sobraPorIns()).reduce((a,v)=>a+(+v||0),0),fin=sobT+tot;return `<p class="note">Mistura final no vagão: <b>${nf(fin)} kg</b> = ${nf(sobT)} kg de sobra + ${nf(tot)} kg a carregar${Math.abs(fin-CG.total)>1?` (o previsto era ${nf(CG.total)} kg)`:''}.</p>`;})():''}`;}
/* Carregar: avisa (sem bloquear) quando todos os currais do trato escolhido já foram tratados hoje */
function cJaTratadoHTML(trs){if(typeof fornCurrais!=='function'||typeof fornPendentes!=='function')return '';
  const feitos=trs.filter(k=>k>0&&fornCurrais(CG.local,CG.rac,k).length&&!fornPendentes(CG.local,CG.rac,k).length);if(!feitos.length)return '';
  const prox=tratosAtivos().map(Number).find(k=>!trs.includes(k)&&fornPendentes(CG.local,CG.rac,k).length);
  return `<div class="cJaFeito">⚠ ${feitos.length>1?'TRATOS '+feitos.join(' E '):'TRATO '+feitos[0]} (${NOMELOC[CG.local].toUpperCase()}): TODOS JÁ FORAM TRATADOS<small>${prox?`O próximo é o Trato ${prox}. `:''}Se precisar, pode carregar mesmo assim.</small></div>`;}
/* % IMS do PV de um curral num dia ou período (média dos dias com trato, ponderada pelas cabeças dos lotes) */
window.pvCurral=(c,ini,fim)=>{try{const X=gCtx();let s=0,w=0;X.L.forEach(l=>{if(!l.ent)return;for(let d=ini,i=0;d<=fim&&i<400;d=somaDias(d,1),i++){const y=diaLote(l,d,X);if(!y||nAt(y.c)!==nAt(c)||!(y.mn>0)||!ok(y.pv))continue;s+=y.pv*y.cab;w+=y.cab;}});return w?s/w:NaN;}catch(e){return NaN;}};
/* PDF simples: cada página é uma imagem JPEG em folha A4 */
function fzPdf(cvs){const enc=new TextEncoder(),partes=[],offs=[];let tam=0;const add=d=>{const b=typeof d==='string'?enc.encode(d):d;partes.push(b);tam+=b.length;};
  const obj=(n,txt,bin)=>{offs[n]=tam;add(`${n} 0 obj\n`+txt);if(bin){add(bin);add('\nendstream');}add('\nendobj\n');};
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');const n=cvs.length,kids=[];
  const imgs=cvs.map(c=>{const u=c.toDataURL('image/jpeg',0.75),b=atob(u.split(',')[1]),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a;});
  // 1 catálogo, 2 páginas, depois para cada página: página, conteúdo, imagem
  const pw=595.28;
  cvs.forEach((c,i)=>kids.push(3+i*3));
  obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
  obj(2,`<< /Type /Pages /Count ${n} /Kids [${kids.map(k=>k+' 0 R').join(' ')}] >>`);
  cvs.forEach((c,i)=>{const pg=3+i*3,ct=pg+1,im=pg+2,pwc=c.width>c.height?841.89:pw,ph=(pwc*c.height/c.width).toFixed(2),cmd=`q ${pwc} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(pg,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pwc} ${ph}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
    obj(ct,`<< /Length ${cmd.length} >>\nstream\n${cmd}\nendstream`);
    obj(im,`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgs[i].length} >>\nstream\n`,imgs[i]);});
  const tot=3+n*3,xref=tam;let s=`xref\n0 ${tot}\n0000000000 65535 f \n`;for(let i=1;i<tot;i++)s+=String(offs[i]).padStart(10,'0')+' 00000 n \n';
  add(s+`trailer\n<< /Size ${tot} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(partes,{type:'application/pdf'});}
async function fzRelPdf(){if(!fzDadosDia().length)return toast('Nenhuma avaliação neste dia');const P=fzPaginas(await fzFotosParaPdf());if(!P.length)return toast('Nenhuma avaliação neste dia');
  try{await compartilharArquivo(fzPdf(P),`Escore de fezes ${dB(GT.dia).replace(/\//g,'-')}.pdf`,'application/pdf');}catch(e){toast('Não consegui gerar o PDF');}}
async function fzRelImg(){const P=fzPaginas();if(!P.length)return toast('Nenhuma avaliação neste dia');
  const cv=document.createElement('canvas');cv.width=P[0].width;cv.height=P.reduce((a,c)=>a+c.height,0);const x=cv.getContext('2d');let y=0;P.forEach(c=>{x.drawImage(c,0,y);y+=c.height;});
  cv.toBlob(b=>compartilharArquivo(b,`Escore de fezes ${dB(GT.dia).replace(/\//g,'-')}.png`,'image/png'),'image/png');}
window.fzRelPdf=fzRelPdf;window.fzRelImg=fzRelImg;window.fzPdf=fzPdf;window.fzPaginas=fzPaginas;

/* ---------- curral que mudou de nome: leituras e escores de fezes já lançados passam para o nome novo ---------- */
function migrarRenomes(){try{if(typeof modoVer!=='undefined'&&modoVer)return 0;if(typeof nomeAtual!=='function')return 0;let n=0;
  gTodos('leitura').forEach(x=>{const nv=nomeAtual(x.curral);if(!nv||nv===x.curral)return;const id=idLeit(x.dia,nv);
    if(!G.it[id]||G.it[id].del){const y=JSON.parse(JSON.stringify(x));y.uid=id;y.curral=nv;y.nomeAntigo=x.curral;gPut(y);}gDel(x.uid);n++;});
  gTodos('fezes').forEach(x=>{const nv=nomeAtual(x.curral);if(!nv||nv===x.curral)return;const id=fzId(x.dia,nv);
    if(!G.it[id]||G.it[id].del){const y=JSON.parse(JSON.stringify(x));y.uid=id;y.curral=nv;gPut(y);}gDel(x.uid);n++;});
  if(n&&!$('viewGest').hidden&&!gEditando())gRender();return n;}catch(e){return 0;}}
window.migrarRenomes=migrarRenomes;
setTimeout(migrarRenomes,7000);setInterval(migrarRenomes,60000);

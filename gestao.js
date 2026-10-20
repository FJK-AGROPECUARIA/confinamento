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
const PCT_PADRAO={0:0,1:3,2:6,3:10,4:15};
const NOTAS_PADRAO=[-4,-3,-2,-1,0,1,2,3,4].map(n=>({n,t:n>0?'Aumentar':n<0?'Diminuir':'Manter',p:Math.sign(n)*PCT_PADRAO[Math.abs(n)]}));
const NOTAS_VER=3;
function gCfg(){const c=G.it.config&&!G.it.config.del?G.it.config:{uid:'config',tipo:'config'};
  if(!Array.isArray(c.taxa))c.taxa=[];if(!Array.isArray(c.notas)||!c.notas.length||c.notasV!==NOTAS_VER)c.notas=NOTAS_PADRAO.map(x=>Object.assign({},x));
  if(!Array.isArray(c.racas)||!c.racas.length)c.racas=RACAS_PADRAO.slice();if(!ok(c.arred))c.arred=10;if(!ok(c.pvIni))c.pvIni=2.2;if(!ok(c.rc))c.rc=52;return c;}
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
function valorCompra(l){const e=l.ent||{};const cab=+e.cab||0,peso=+(e.pesoC||e.peso)||0,p=+e.preco||0;
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
  else if(f.t==='num')inp=`<input type="text" inputmode="decimal" id="${id}" value="${esc(vIn(v))}" placeholder="${esc(f.ph||'')}" autocomplete="off">`;
  else inp=`<input type="text" id="${id}" value="${esc(v)}" placeholder="${esc(f.ph||'')}" autocomplete="off"${f.lista?` list="${f.lista}"`:''}>`;
  return `<div class="gCampo${f.meia&&f.t!=='dia'?' meia':''}"><label for="${id}">${esc(f.l)}${f.suf?` <span class="gSuf">(${esc(f.suf)})</span>`:''}</label>${inp}${f.ajuda?`<p class="note">${f.ajuda}</p>`:''}</div>`;}
const fv=k=>{const e=$('gf_'+k);return e?e.value.trim():'';};
const fn=k=>gNum(fv(k));
const opCurrais=()=>(S.cadastro||[]).slice().sort((a,b)=>alfa(a,b)).map(n=>[n,n]);
const opRacoes=()=>[['','— escolher —']].concat(gTodos('racao').sort(porNome).map(r=>[r.uid,r.nome]));
const opInsumos=()=>gTodos('insumo').sort(porNome).map(r=>[r.uid,r.nome]);
const UNID_C=[['arroba','R$ por @ (peso vivo ÷ 30)'],['cab','R$ por cabeça'],['kg','R$ por kg vivo']];
const UNID_V=[['arroba','R$ por @ (carcaça ÷ 15)'],['cab','R$ por cabeça'],['kg','R$ por kg vivo']];

const RAIZ={home:'home',lotes:'lotes',lote:'lotes',loteForm:'lotes',pesForm:'lotes',saiForm:'lotes',mudForm:'lotes',rel:'lotes',custoForm:'lotes',
  cocho:'cocho',cochoGraf:'cocho',rels:'rels',dia:'rels',periodo:'rels',comp:'rels',racoes:'racoes',racForm:'racoes',insumos:'insumos',insForm:'insumos',cfg:'cfg'};
function gRaiz(t){GT={t};gPilha.length=0;if($('viewGest').hidden)aba('gest');else gRender();window.scrollTo({top:0});}
function gRender(){
  const b=$('gBox');if(!b)return;
  const f={home:tHome,lotes:tLotes,lote:tLote,loteForm:tLoteForm,pesForm:tPesForm,saiForm:tSaiForm,mudForm:tMudForm,rel:tRelLote,custoForm:tCustoForm,
    cocho:tCocho,cochoGraf:tCochoGraf,rels:tRels,dia:tDia,periodo:tPeriodo,comp:tComp,racoes:tRacoes,racForm:tRacForm,insumos:tInsumos,insForm:tInsForm,cfg:tCfg}[GT.t]||tHome;
  const raiz=RAIZ[GT.t]||'home';document.querySelectorAll('#subGest button[data-gt]').forEach(x=>x.setAttribute('aria-selected',String(x.dataset.gt===raiz)));
  b.innerHTML=f(GT);
  if(GT.t==='racForm')calcRacao();
  if(GT.t==='rel')calcSimul();
  if(GT.t==='pesForm')calcPes();
}

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
const CATS=[['','—'],['Bezerro','Bezerro (macho)'],['Bezerra','Bezerra (fêmea)'],['Garrote','Garrote'],['Novilha','Novilha'],['Boi','Boi'],['Vaca','Vaca']];
const SISTEMAS=[['Confinamento','Confinamento'],['Pasto com suplementação','Pasto com suplementação']];
const RACAS_PADRAO=['Angus','Cruzado','Nelore'];
/* sexo: só Macho e Fêmea (lotes antigos com macho inteiro/castrado aparecem como Macho) */
const sexoNorm=v=>/^M[IC]?$/.test(v||'')?'M':v==='F'?'F':'';
const sexoTxt=v=>(SEXOS.find(x=>x[0]===sexoNorm(v))||['',''])[1];

/* cálculo completo de um lote (usado no relatório do lote e no comparativo) */
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
  $('gEvLeit').innerHTML=`<b>${dB(p.d).slice(0,5)}</b> · IMS <b>${ok(p.ims)?nf(p.ims,2)+' kg':'—'}</b> · <b>${pc(p.pv,2)}</b> PV · <b>${nf(p.peso)} kg</b>${ok(p.mn)?` · MN ${nf(p.mn,1)} kg`:''}`;}
/* ---------- resumo ---------- */
function tHome(t){
  const hj=hojeKey(),dia=(t&&t.dia)||hj,dd=dB(dia).slice(0,5),X=gCtx();GT.dia=dia;
  const A=gTodos('lote').filter(l=>cabPres(l,dia)>0).sort(porCurral),cabD=l=>cabEm(l,dia)||cabPres(l,dia);
  /* dia */
  let cab=0,mn=0,ms=0,cr=0,co=0,pvP=0,cabO=0;const ins={};
  A.forEach(l=>{cab+=cabD(l);const x=diaLote(l,dia,X);if(x&&x.mn>0){mn+=x.mn;if(ok(x.ms))ms+=x.ms;if(ok(x.custoR))cr+=x.custoR;co+=x.custoOp;pvP+=x.cab*x.peso;cabO+=x.cab;somaInsumos(ins,x);}});
  const pesoM=cab?A.reduce((a,l)=>a+cabD(l)*pesoEm(l,dia),0)/cab:NaN,tem=cabO>0,cus=cr+co;
  /* acumulado do mês até a data */
  const ini=dia.slice(0,8)+'01';let mcd=0,mmn=0,mms=0,mcus=0,msan=0;
  for(let d=ini,k=0;d<=dia&&k<40;d=somaDias(d,1),k++)X.L.forEach(l=>{const x=diaLote(l,d,X);if(!x)return;mcd+=x.cab;mmn+=x.mn;if(ok(x.ms))mms+=x.ms;mcus+=(ok(x.custoR)?x.custoR:0)+x.custoOp;});
  gTodos('custo').forEach(c=>{if(c.dia>=ini&&c.dia<=dia)msan+=+c.rs||0;});
  const mortes=gTodos('saida').filter(s=>s.mot==='morte'&&s.dia>=ini&&s.dia<=dia).reduce((a,s)=>a+(+s.cab||0),0);
  const vendas=gTodos('saida').filter(s=>s.mot!=='morte'&&s.dia>=ini&&s.dia<=dia).reduce((a,s)=>a+(+s.cab||0),0);
  /* rebanho */
  const conta=(f)=>{const m={};A.forEach(l=>{const k=f(l)||'Não informado';m[k]=(m[k]||0)+cabD(l);});return Object.entries(m).sort((a,b)=>b[1]-a[1]);};
  const locs=[['C','Confinamento'],['P','Pasto']].map(([k,n])=>{const L=A.filter(l=>linhaDe(curralEm(l,dia))===k),c=L.reduce((a,l)=>a+cabD(l),0);
    return {n,lotes:L.length,cab:c,peso:c?L.reduce((a,l)=>a+cabD(l)*pesoEm(l,dia),0)/c:NaN};}).filter(o=>o.lotes);
  const porSexo=conta(l=>sexoTxt(l.sexo)),porRaca=conta(l=>l.raca);
  /* operação do dia */
  const Cs=cochoCurrais(dia),lidos=Cs.filter(c=>{const x=G.it[idLeit(dia,c)];return x&&!x.del;}),notas=lidos.map(c=>G.it[idLeit(dia,c)].nota);
  const bat=gTodos('carga').filter(c=>c.dia===dia),bp=bat.reduce((a,c)=>a+c.itens.reduce((s,x)=>s+x.prev,0),0),br=bat.reduce((a,c)=>a+c.itens.reduce((s,x)=>s+(+x.real||0),0),0);
  /* alertas (sempre sobre hoje) */
  const alertas=[],AH=lotesAtivos();
  const semLeit=cochoCurrais(hj).filter(c=>!G.it[idLeit(hj,c)]);if(semLeit.length)alertas.push(['warn',`Leitura de cocho de hoje faltando: ${semLeit.join(', ')}`,'cocho']);
  AH.forEach(l=>{if(!racaoEm(l,hj))alertas.push(['bad',`${l.nome}: sem ração escolhida`,'lote',l.uid]);
    const pz=pesagensDe(l),ult=pz.length?pz[pz.length-1].dia:l.ent.dia,d2=difDias(ult,hj);if(d2>=45)alertas.push(['warn',`${l.nome}: ${d2} dias sem pesagem`,'lote',l.uid]);
    if(l.alvo&&l.gmd>0){const f=Math.ceil((l.alvo-pesoEm(l,hj))/l.gmd);if(f<=15)alertas.push(['ok',`${l.nome}: ${f<=0?'já atingiu':'atinge em '+f+' dias'} o peso de saída (${nf(l.alvo)} kg)`,'lote',l.uid]);}
    if(l.diasPrev){const f=l.diasPrev-difDias(l.ent.dia,hj);if(f<=15)alertas.push(['ok',`${l.nome}: ${f<=0?'passou':'faltam '+f} dias ${f<=0?'dos':'para os'} ${l.diasPrev} dias de cocho previstos`,'lote',l.uid]);}});
  gTodos('insumo').forEach(i=>{if(!ok(precoIns(i,hj)))alertas.push(['bad',`Insumo ${i.nome} sem preço`,'insumos']);});
  const lista=(arr)=>arr.map(([k,v])=>`<div><span>${esc(k)}</span><b class="num">${nf(v)} cab</b></div>`).join('');
  return `<section class="panel"><h2>Resumo do dia</h2>
    ${navData('gResDia',dia,'Data')}
    <div class="stat gStat3">${st('Lotes ativos',nf(A.length))}${st('Cabeças',nf(cab))}${st('Peso médio',nf(pesoM)+' kg')}
      ${st('MS/cab',tem?nf(ms/cabO,2)+' kg':'—')}${st('% do PV',tem?pc(pvP?ms/pvP*100:NaN,2):'—')}${st('Custo/cab',tem?rs(cus/cabO):'—')}</div>
    ${tem?'':`<p class="aviso warn">Ainda sem trato lançado em ${dd}. Toque em ◀ para ver o dia anterior.</p>`}
    ${A.length?'':'<p class="note">Nenhum lote ativo. Comece por Insumos → Rações → Lotes.</p>'}</section>
  ${alertas.length?`<section class="panel"><h2>Atenção</h2>${alertas.map(a=>`<button class="gAlerta ${a[0]}" data-g="${a[2]==='lote'?'lote':'raiz'}" data-t="${a[2]}" data-id="${a[3]||''}">${esc(a[1])}</button>`).join('')}</section>`:''}
  ${tem?card(`Consumo e custo em ${dd}`,`<div class="stat gStat3">${st('MN total',nf(mn)+' kg')}${st('MS total',nf(ms)+' kg')}${st('MN/cab',nf(mn/cabO,2)+' kg')}
      ${st('Custo ração',rs(cr))}${st('Operacional',rs(co))}${st('Custo do dia',rs(cus))}</div>`):''}
  ${mcd?card(`Acumulado do mês até ${dd}`,`<div class="stat gStat3">${st('Cab-dia',nf(mcd))}${st('MN total',nf(mmn/1000,1)+' t')}${st('MS/cab/dia',nf(mms/mcd,2)+' kg')}
      ${st('Custo total',rs(mcus+msan))}${st('R$/cab/dia',rs(mcus/mcd))}${st('Sanidade',rs(msan))}</div>
    ${vendas||mortes?`<p class="note">No mês: ${vendas?nf(vendas)+' cab vendidas':''}${vendas&&mortes?' · ':''}${mortes?nf(mortes)+' morte(s)':''}.</p>`:''}`):''}
  ${A.length?card('Rebanho',`${locs.length?`<div class="tablebox"><table class="gTab"><thead><tr><th>Local</th><th>Lotes</th><th>Cab.</th><th>Peso médio</th></tr></thead><tbody>${locs.map(o=>`<tr><td class="c">${o.n}</td><td>${nf(o.lotes)}</td><td>${nf(o.cab)}</td><td>${nf(o.peso)} kg</td></tr>`).join('')}</tbody></table></div>`:''}
    <div class="gDuas"><div><h3>Sexo</h3><div class="gLinhas">${lista(porSexo)}</div></div><div><h3>Raça</h3><div class="gLinhas">${lista(porRaca)}</div></div></div>`):''}
  ${A.length?card(`Operação em ${dd}`,`<div class="stat gStat3">${st('Leituras',`${nf(lidos.length)} de ${nf(Cs.length)}`)}${st('Nota média',notas.length?(()=>{const m=notas.reduce((a,b)=>a+b,0)/notas.length;return (m>0?'+':'')+nf(m,1);})():'—')}${st('Batidas',nf(bat.length))}</div>
    ${bat.length?`<p class="note">Vagão: previsto ${nf(bp)} kg · carregado ${nf(br)} kg (${br-bp>0?'+':''}${nf(br-bp)} kg).</p>`:''}
    ${Object.keys(ins).length?`<h3>Insumos gastos no dia</h3>${tabInsumos(ins)}`:''}`):''}`;
}
/* ---------- lotes ---------- */
function tLotes(t){
  const hj=hojeKey(),X=gCtx(),loc=gLoc,noLocal=l=>loc==='T'||linhaDe(curralEm(l,fimLote(l)||hj))===loc;
  const todosL=gTodos('lote').filter(noLocal),lista=(t.enc?todosL.filter(l=>!ativo(l)).sort(porNome):todosL.filter(ativo).sort(porCurral));
  const ont=t.dia||hj;GT.dia=ont;const dd=dB(ont).slice(0,5);
  const cards=lista.map(l=>{const cab=cabPres(l,ont),r=racaoEm(l,ont),x=diaLote(l,ont,X),fim=fimLote(l),c=curralEm(l,fim&&fim<ont?fim:ont);
    const sub=[sexoTxt(l.sexo),l.raca,l.cat].filter(Boolean).join(' · ');
    return `<button class="gLote" data-g="lote" data-id="${l.uid}">${seloCurral(c)}
      <div class="gLoteInfo"><b>${esc(l.nome)}</b>${sub?`<span>${esc(sub)}</span>`:''}
      <span class="gRacLote">🌾 ${esc(r?r.nome:'sem ração')}</span>
      ${fim&&fim<ont?`<span>Encerrado em ${dB(fim)}</span>`:l.ent.dia>ont?`<span>Entra em ${dB(l.ent.dia)}</span>`:`<div class="gLoteNums"><span><b>${nf(cab)}</b> cab</span><span><b>${nf(difDias(l.ent.dia,ont))}</b> dias</span><span><b>${nf(pesoEm(l,ont))}</b> kg</span></div>
      <div class="gLoteNums"><span><b>${x&&x.mn>0?nf(x.mnCab,1):'—'}</b> MN/cab</span><span><b>${x&&x.mn>0?nf(x.msCab,2):'—'}</b> MS/cab</span><span><b>${x&&x.mn>0?pc(x.pv,2):'—'}</b> PV</span></div>
      ${x&&x.mn>0?'':`<span class="warn">Sem trato em ${dd}</span>`}`}</div></button>`;}).join('');
  return `<section class="panel"><div class="curhead"><h2>${t.enc?'Lotes encerrados':'Lotes ativos'}</h2><span class="note">${lista.length}</span></div>
    <div class="linhas gFiltro">${[['T','Todos'],['C','Confinamento'],['P','Pasto']].map(([k,r])=>`<button data-g="filtroLoc" data-l="${k}" class="${loc===k?'sel':''}">${r}</button>`).join('')}</div>
    ${navData('gRefDia',ont,'Ver os números do dia')}
    ${cards||`<p class="note">${t.enc?'Nenhum lote encerrado.':'Nenhum lote ainda. Toque em “+ Novo lote”.'}</p>`}
    ${t.enc?'':'<button class="lima" data-g="novoLote">+ Novo lote</button>'}
    <button data-g="ir" data-t="lotes" data-enc="${t.enc?'':'1'}">${t.enc?'Ver lotes ativos':'Ver lotes encerrados'}</button></section>`;
}
function tLoteForm(t){
  const l=t.id?G.it[t.id]:null,e=(l&&l.ent)||{},hj=hojeKey(),novo=!l,v=k=>l?l[k]:'';
  const fs=[{k:'nome',l:'Nome do lote',v:v('nome'),ph:'Ex.: Lote 1 - Nelore'}];
  if(novo)fs.push({k:'curral',l:'Curral / pasto',t:'sel',op:opCurrais(),v:''});
  fs.push({k:'sistema',l:'Sistema',t:'sel',op:SISTEMAS,v:l&&l.sistema==='Pasto com suplementação'?l.sistema:'Confinamento'},
    {k:'sexo',l:'Sexo',t:'sel',op:SEXOS,v:sexoNorm(v('sexo')),meia:1},{k:'cat',l:'Categoria',t:'sel',op:CATS.concat(l&&l.cat&&!CATS.some(c=>c[0]===l.cat)?[[l.cat,l.cat]]:[]),v:v('cat'),meia:1},
    {k:'raca',l:'Raça',t:'sel',op:[['','—']].concat(gCfg().racas.concat(l&&l.raca&&!gCfg().racas.includes(l.raca)?[l.raca]:[]).sort(alfa).map(r=>[r,r])),v:v('raca'),meia:1},{k:'idade',l:'Idade',suf:'meses',t:'num',v:v('idade'),meia:1},
    {k:'dia',l:'Data de entrada',t:'dia',v:e.dia||hj,meia:1},{k:'cab',l:'Cabeças',t:'num',v:e.cab,meia:1},
    {k:'peso',l:'Peso médio na chegada',suf:'kg',t:'num',v:e.peso,meia:1},{k:'pesoC',l:'Peso médio de compra',suf:'kg, na origem',t:'num',v:e.pesoC,meia:1,ajuda:'Se a compra foi pelo peso da origem. Vazio = usa o da chegada.'},
    {k:'unid',l:'Preço de compra em',t:'sel',op:UNID_C,v:e.unid||'arroba'},{k:'preco',l:'Preço de compra',t:'rs',v:e.preco,meia:1},
    {k:'outros',l:'Frete, comissão e outros da compra',suf:'total',t:'rs',v:e.outros,meia:1},
    );
  if(novo)fs.push({k:'racao',l:'Ração',t:'sel',op:opRacoes(),v:''});
  fs.push({k:'gmd',l:'Ganho por dia (meta)',suf:'kg/cab/dia',t:'num',v:l?l.gmd:1.5,meia:1},{k:'diasPrev',l:'Dias de cocho previstos',t:'num',v:v('diasPrev'),meia:1},
    {k:'alvo',l:'Peso de saída desejado',suf:'kg',t:'num',v:v('alvo'),meia:1},{k:'rcPrev',l:'Rendimento de carcaça esperado',suf:'%',t:'num',v:v('rcPrev')||'',meia:1},
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
  const e0=l.ent||{};l.nome=nome;l.ent={dia,cab,peso,pesoC:fn('pesoC')||null,unid:fv('unid'),preco:fn('preco'),outros:fn('outros')||0,origem:e0.origem||'',gta:e0.gta||''};
  l.sistema=fv('sistema');l.sexo=fv('sexo');l.cat=fv('cat');l.raca=fv('raca');l.idade=fn('idade')||null;
  l.gmd=fn('gmd')||0;l.diasPrev=fn('diasPrev')||null;l.alvo=fn('alvo')||null;l.rcPrev=fn('rcPrev')||null;l.obs=fv('obs');
  gPut(l);toast('Lote salvo');gPilha.pop();GT={t:'lote',id:l.uid};gRender();
}
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
  const ficha=[['Sistema',l.sistema],['Sexo',sexoTxt(l.sexo)],['Raça',l.raca],['Categoria',l.cat],['Idade',l.idade?nf(l.idade)+' meses':''],
    ['Entrada',`${dB(e.dia)} · ${nf(e.cab)} cab · ${nf(e.peso)} kg`],['Peso de compra',e.pesoC?`${nf(e.pesoC)} kg · quebra ${pc((e.pesoC-e.peso)/e.pesoC*100,1)}`:''],
    ['Compra',`${rs(valorCompra(l))} (${rs(valorCompra(l)/e.cab)}/cab)`],['Peso desejado',l.alvo?nf(l.alvo)+' kg':''],['Dias de cocho previstos',l.diasPrev?`${nf(l.diasPrev)} (até ${dB(somaDias(e.dia,l.diasPrev))})`:''],
    ['Rendimento esperado',l.rcPrev?pc(l.rcPrev,1):'']].filter(x=>x[1]);
  const projTxt=fim?'':[30,60,90].map(n=>`+${n} dias: <b>${nf(pesoEm(l,somaDias(hj,n)))} kg</b>`).join(' · ');
  const lt=x?G.it[idLeit(dRef,x.c)]:null,cusDia=x?((ok(x.custoR)?x.custoR:0)+x.custoOp):NaN;
  return `${voltar('Lotes')}<section class="panel"><div class="gLoteTopo">${seloCurral(curralEm(l,ref))}<div><h2>${esc(l.nome)}</h2><span class="pill${fim?'':' done'}">${fim?'Encerrado em '+dB(fim):'Ativo'}</span>
      <p class="note">${esc([sexoTxt(l.sexo),l.raca,l.cat].filter(Boolean).join(' · '))}</p></div></div>
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
    <details class="gMais"><summary>Ver os ${pts.length} dias em tabela</summary><div class="tablebox"><table class="gTab"><thead><tr><th>Dia</th><th>MN kg</th><th>MS/cab</th><th>% PV</th><th>Nota</th></tr></thead><tbody>${tabDias}</tbody></table></div></details>`)}
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
    c?{k:'val',l:'Novo curral / pasto',t:'sel',op:opCurrais(),v:curralEm(l,hojeKey())}:{k:'val',l:'Nova ração',t:'sel',op:opRacoes(),v:(vig(l.rac,hojeKey())||{}).r||''}].map(campo).join('')}</div>
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
  GT.relRes=res;
  const hero=fim?`<div class="gHero ${C.lucro>=0?'pos':'neg'}"><small>${C.lucro>=0?'Lucro':'Prejuízo'}</small><b>${rs(C.lucro)}</b><span>${rs(C.lucro/cabE)} por cabeça · ${pc(C.lucro/C.custo*100,1)} sobre o custo</span></div>`
    :`<div class="gHero"><small>Custo até hoje</small><b>${rs(C.custo)}</b><span>${rs(C.custo/cabE)} por cabeça · ${rs(C.custoCabDia)} por cab/dia (ração + operacional)</span></div>`;
  const linC=(a,v,cls)=>`<tr class="${cls||''}"><td>${a}</td><td>${rs(v)}</td><td>${rs(v/cabE)}</td></tr>`;
  const custos=`<div class="tablebox"><table class="gCustos"><thead><tr><th>Custo</th><th>Total</th><th>Por cabeça</th></tr></thead><tbody>
    ${linC('Compra',C.compra)}${linC('Ração',C.alim)}${linC('Operacional',C.op)}${C.outros?linC('Sanidade e outros',C.outros):''}${linC('Total',C.custo,'grp')}</tbody></table></div>`;
  const desemp=`<div class="stat gStat2">${st('MS por cab/dia',nf(C.msCab,2)+' kg')}${st('% do peso vivo',pc(C.pv,2))}${st('MN por cab/dia',nf(C.mnCab,2)+' kg')}${st(C.cabV?'GMD real':'GMD meta',nf(C.cabV?gmd:l.gmd,2)+' kg')}</div>
    ${C.cabV?`<div class="stat gStat2">${st('Conversão alimentar',nf(C.conv,2))}${st('Custo da @ produzida',rs(C.custoArr))}</div>`:''}`;
  const venda=C.cabV?card(fim?'Venda':'Vendas até agora',`<div class="stat gStat2">${st('Cabeças vendidas',nf(C.cabV)+(C.mortes?` <small>+${nf(C.mortes)} morte(s)</small>`:''))}${st('Peso vivo médio',nf(C.pesoV)+' kg')}${st('@ por cabeça',nf(C.arrV/C.cabV,2))}${st('Receita líquida',rs(C.receita))}</div>
    <div class="gLinhas">${lin('@ produzidas',`${nf(C.arrProd,2)} (${nf(C.arrProd/C.cabV,2)} por cab)`)}${lin('Receita por cabeça',rs(C.receita/C.cabV))}</div>
    ${fim?'':'<p class="note">O lote ainda tem animais: o lucro final aparece quando sair o último.</p>'}`):'';
  const sim=fim?'':card('Simular venda hoje',`<div class="gForm">${[
    {k:'sPeso',l:'Peso vivo',suf:'kg',t:'num',v:Math.round(pesoEm(l,hj)),meia:1},{k:'sRc',l:'Rendimento',suf:'%',t:'num',v:l.rcPrev||cfg.rc,meia:1},
    {k:'sPreco',l:'Preço da @',t:'rs',v:'',meia:1}].map(campo).join('')}</div><div id="gSimRes"></div>`);
  GT.calc={cab:C.cabAt,pesoE:C.pesoE,prod:C.prod,custo:C.custo,receita:C.receita,cabE,cabV:C.cabV,arrV:C.arrV,ms:R.ms,ganhoV:C.ganhoV};
  return `${voltar()}<section class="panel"><div class="gLoteTopo">${seloCurral(curralEm(l,C.ate))}<div><h2>${esc(l.nome)}</h2><span class="pill${fim?'':' done'}">${fim?'Relatório final':'Resultado até hoje'}</span>
      <p class="note">${dB(l.ent.dia)} a ${dB(C.ate)} · ${nf(C.dias)} dias · ${nf(cabE)} cab · entrada ${nf(C.pesoE)} kg</p></div></div>
    ${hero}
    <div class="row compart"><button class="verde" data-g="imgLote" data-id="${l.uid}">🖼 Imagem</button><button class="verde" data-g="xlsLote" data-id="${l.uid}">📊 Excel</button></div></section>
  ${card('Desempenho',desemp)}
  ${card('Custos',custos)}
  ${venda}${sim}
  ${avisos.length?`<section class="panel">${avisos.map(a=>`<p class="aviso warn">${a}</p>`).join('')}</section>`:''}`;
}
const lin=(a,b,c)=>`<div class="${c||''}"><span>${a}</span><b class="num">${b}</b></div>`;
function calcSimul(){const box=$('gSimRes');if(!box)return;const c=GT.calc,peso=fn('sPeso'),rc=fn('sRc'),pr=fn('sPreco');
  if(!(peso>0&&rc>0&&pr>0)){box.innerHTML='<p class="note">Coloque o preço da @ para ver o resultado estimado com os animais que estão no lote.</p>';return;}
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
function tCocho(t){
  const dia=t.dia||hojeKey(),ont=somaDias(dia,-1),ix=gIndice(),cfg=gCfg(),Cs=cochoCurrais(dia),hoje=dia===hojeKey();
  const notas=cfg.notas.slice().sort((a,b)=>a.n-b.n);
  GT.dia=dia;GT.sel=GT.sel||{};
  const rows=Cs.map(c=>{const L=gTodos('lote').filter(l=>curralEm(l,dia)===c&&cabPres(l,dia)>0);
    const ontem=ix.get(ont+'|'+c)||0,pt=prevTotal(c),cab=L.reduce((a,l)=>a+cabPres(l,dia),0);
    let base=ontem,orig='realizado ontem';
    if(!base&&pt){base=pt;orig='previsto atual';}
    if(!base){const ms=L.reduce((a,l)=>{const r=racaoEm(l,dia),cp=r&&compRacao(r,dia);return a+(cp?cabPres(l,dia)*pesoEm(l,dia)*cfg.pvIni/100/(cp.ms/100):0);},0);base=Math.round(ms);orig=`sugestão ${nf(cfg.pvIni,1)}% PV`;}
    const lt=G.it[idLeit(dia,c)],sel=GT.sel[c]||(lt&&!lt.del?{n:lt.nota,kg:lt.novo}:null);
    const nota=sel?sel.n:null,cn=notas.find(x=>x.n===nota);
    const sug=cn?arred(base*(1+cn.p/100),cfg.arred):null,kg=sel&&ok(sel.kg)?sel.kg:sug;
    const ant=[3,2,1].map(i=>{const x=G.it[idLeit(somaDias(dia,-i),c)];return x&&!x.del?notaTxt(x.nota):'·';}).join('  ');
    return `<div class="gCocho${lt&&!lt.del?' feito':''}" data-c="${esc(c)}" data-base="${base}">
      <div class="gCoTopo">${seloCurral(c)}<div><span>${esc(L.map(l=>l.nome).join(', '))}</span><span>${nf(cab)} cab · últimas notas: <b>${ant}</b></span></div></div>
      <div class="gCoBase">Base: <b class="num">${nf(base)} kg</b> <small>(${orig})</small></div>
      ${gradeNotas(notas,nota,c)}
      <div class="gCoNovo"><span>${cn?esc(cn.t):'Toque na nota'}</span><input class="cell num" inputmode="numeric" data-kg="${esc(c)}" value="${kg!=null?kg:''}" placeholder="kg"><small>kg/dia</small></div></div>`;}).join('');
  return `<section class="panel"><h2>Leitura de cocho</h2>
    ${navData('gCoDia',dia,'Data da leitura')}
    <details class="gLeg"><summary class="note">Ver as notas</summary>${notas.map(x=>`<p class="note"><b>${notaTxt(x.n)}</b> — ${esc(x.t)}: ${x.p>0?'+':''}${nf(x.p,0)}%</p>`).join('')}<p class="note">Para mudar as notas: Config.</p></details>
    ${rows||'<p class="note">Nenhum lote ativo nesta data. Cadastre os lotes primeiro.</p>'}
    ${rows?`<button class="primary" data-g="salvaCocho">${hoje?'Salvar e ajustar o previsto':'Salvar leitura'}</button>
    <p class="note">${hoje?'O total do dia de cada curral é dividido entre os tratos na mesma proporção do previsto atual.':'Data diferente de hoje: só guarda a leitura, sem mexer no previsto.'}</p>`:''}
    <button class="verde" data-g="ir" data-t="cochoGraf">📈 Gráfico dos últimos 10 dias</button></section>`;
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
    <div class="linhas">${[['T','Todos'],['C','Confinamento'],['P','Pasto']].map(([k,r])=>`<button data-g="grafLoc" data-l="${k}" class="${gLocG===k?'sel':''}">${r}</button>`).join('')}</div>
    <div class="gChips">${D.todos.map(c=>`<button data-g="grafCur" data-c="${esc(c)}" class="${gGrafOff.has(c)?'':'sel'}">${esc(c)}</button>`).join('')}</div>
    ${rows?`<div class="tablebox"><table class="gHeat"><colgroup><col class="cC">${D.dias.map(()=>'<col>').join('')}<col class="cM"></colgroup><thead><tr><th class="gHc">Local</th>${cab}<th class="gHm">Méd.</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="gLegNota">${notas.map(x=>{const [bg,fg]=corNota(x.p);return `<span style="background:${bg};color:${fg}">${notaTxt(x.n)}<small>${x.p>0?'+':''}${nf(x.p,0)}%</small></span>`;}).join('')}</div>
    <p class="note">Azul = aumentou o trato · vermelho = diminuiu · cinza = manteve · ponto = sem leitura. Toque num quadro para ver os kg.</p>
    <div class="row compart"><button class="verde" data-g="imgGraf">🖼 Imagem</button><button class="verde" data-g="xlsGraf">📊 Excel</button></div>`:'<p class="note">Nenhuma leitura nesse período.</p>'}</section>`;}
function imagemGraf(){const fim=GT.dia,D=dadosGraf(fim);if(!D.linhas.length)return toast('Nada para mostrar');
  const esq=120,cw=46,ch=34,top=112,W=esq+cw*10+70+20,H=top+ch*D.linhas.length+110,cv=document.createElement('canvas'),s=2;cv.width=W*s;cv.height=H*s;
  const x=cv.getContext('2d');x.scale(s,s);x.fillStyle='#fff';x.fillRect(0,0,W,H);x.fillStyle='#11253d';x.fillRect(0,0,W,72);x.fillStyle='#a7bc09';x.fillRect(0,72,W,5);
  x.fillStyle='#fff';x.font='bold 22px Arial';x.fillText('Leitura de cocho · 10 dias',16,32);x.font='bold 13px Arial';x.fillStyle='#c8dd1e';x.fillText(`${dB(D.dias[0])} a ${dB(fim)} · Sistema Completo Confinamento · FJK`,16,56);
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
    const blob=montarXlsx(ws);await compartilharArquivo(blob,nome.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\\/:*?"<>|]/g,'-')+'.xlsx',blob.type);}
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
  let H=120;secoes.forEach(s=>{H+=50+(s.cols.some(c=>c[0])?40:6)+RH*s.linhas.length+(s.total?52:0)+24;});H+=20;
  const cv=document.createElement('canvas');cv.width=W*esc;cv.height=H*esc;const c=cv.getContext('2d');c.scale(esc,esc);
  c.fillStyle='#ffffff';c.fillRect(0,0,W,H);c.fillStyle='#11253d';c.fillRect(0,0,W,90);c.fillStyle='#a7bc09';c.fillRect(0,90,W,6);
  c.textBaseline='middle';c.fillStyle='#ffffff';let fs=30;c.font=`700 ${fs}px ${F}`;while(c.measureText(titulo).width>W-2*M-230&&fs>18){fs--;c.font=`700 ${fs}px ${F}`;}c.fillText(titulo,M,40);
  c.font=`600 16px ${F}`;c.fillStyle='#c8dd1e';c.fillText('Sistema Completo Confinamento · FJK',M,70);
  c.font=`500 16px ${F}`;c.textAlign='right';c.fillText('Gerado em '+new Date().toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}),W-M,70);c.textAlign='left';
  let y=120;
  secoes.forEach(s=>{const cols=s.cols,px=(k,a)=>{let x=M;for(let i=0;i<k;i++)x+=cols[i][1];const w=cols[k][1];return a==='l'?x+8:a==='c'?x+w/2:x+w-8;};
    const al=a=>a==='l'?'left':a==='c'?'center':'right';
    c.fillStyle='#f3f7dc';c.fillRect(M,y,W-2*M,44);c.fillStyle='#a7bc09';c.fillRect(M,y,6,44);c.fillStyle='#11253d';c.font=`700 22px ${F}`;c.textAlign='left';c.fillText(s.cab,M+16,y+22);y+=50;
    if(cols.some(x=>x[0])){c.font=`700 14px ${F}`;c.fillStyle='#5d6b7a';cols.forEach(([t,w,a],k)=>{c.textAlign=al(a);c.fillText(String(t).toUpperCase(),px(k,a),y+20);});y+=40;c.fillStyle='#dde3ea';c.fillRect(M,y-2,W-2*M,2);}else y+=6;
    s.linhas.forEach((l,i)=>{if(i%2){c.fillStyle='#f7f9fb';c.fillRect(M,y,W-2*M,RH);}
      l.forEach((v,k)=>{if(!cols[k])return;const a=cols[k][2];c.textAlign=al(a);c.font=(k===0?'700 ':'500 ')+'19px '+F;c.fillStyle=(s.cores&&s.cores[i]&&s.cores[i][k])||'#11253d';
        let t=String(v??''),f=19;while(c.measureText(t).width>cols[k][1]-12&&f>11){f--;c.font=(k===0?'700 ':'500 ')+f+'px '+F;}c.fillText(t,px(k,a),y+RH/2);});
      y+=RH;c.fillStyle='#dde3ea';c.fillRect(M,y-1,W-2*M,1);});
    if(s.total){c.fillStyle='#11253d';c.fillRect(M,y+6,W-2*M,44);c.font=`700 19px ${F}`;
      s.total.forEach((v,k)=>{if(v==null||v===''||!cols[k])return;c.textAlign=k===0?'left':al(cols[k][2]);c.fillStyle=k===0?'#ffffff':'#c8dd1e';c.fillText(String(v),k===0?M+12:px(k,cols[k][2]),y+28);});y+=52;}
    y+=24;});
  return new Promise(ok=>cv.toBlob(ok,'image/png'));
}
const nomeArq=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[\\/:*?"<>|]/g,'-');
async function enviarImg(titulo,secoes,nome){if(!secoes.some(s=>s.linhas.length))return toast('Nada para mostrar');
  try{const b=await gImagem(titulo,secoes);await compartilharArquivo(b,nomeArq(nome)+'.png','image/png');}catch(e){toast('Não consegui gerar a imagem');}}
const kv=(cab,pares)=>({cab,cols:[['',360,'l'],['',300,'r']],linhas:pares.map(([a,b])=>[a,b])});
const corV='#5f7a00',corR='#b3261e';
function imgDia(){const dia=$('gDiaDia').value,ls=linhasDia(dia),ins={};let T={cab:0,mn:0,ms:0,c:0};
  const L=ls.map(({l,x})=>{somaInsumos(ins,x);const t=(ok(x.custoR)?x.custoR:0)+x.custoOp;T.cab+=x.cab;T.mn+=x.mn;T.ms+=ok(x.ms)?x.ms:0;T.c+=t;
    return [x.c,l.nome,nf(x.cab),nf(x.peso),nf(x.mn),nf(x.msCab,2),pc(x.pv,2),rs(t)];});
  const ie=Object.entries(ins).sort((a,b)=>b[1].kg-a[1].kg);
  enviarImg(`Relatório do dia · ${dB(dia)}`,[{cab:'Consumo e custo por lote',cols:[['Curral',110,'l'],['Lote',190,'l'],['Cab',70,'r'],['Peso',80,'r'],['MN kg',100,'r'],['MS/cab',90,'r'],['% PV',85,'r'],['Custo',140,'r']],linhas:L,
    total:['TOTAL','',nf(T.cab),'',nf(T.mn),nf(T.cab?T.ms/T.cab:NaN,2),'',rs(T.c)]},
    ...(ie.length?[{cab:'Insumos usados no dia',cols:[['Insumo',420,'l'],['kg (MN)',220,'r'],['Custo',225,'r']],linhas:ie.map(([n,o])=>[n,nf(o.kg),rs(o.rs)]),total:['TOTAL',nf(ie.reduce((a,[,o])=>a+o.kg,0)),rs(ie.reduce((a,[,o])=>a+o.rs,0))]}]:[])],
    `Relatorio do dia ${dB(dia).replace(/\//g,'-')}`);}
function imgPer(){const ini=GT.ini,fim=GT.fim,D=periodoDados(ini,fim);let T={cd:0,mn:0,ms:0,c:0};
  const L=D.lotes.map(o=>{const t=o.cr+o.co+o.out;T.cd+=o.cabDias;T.mn+=o.mn;T.ms+=o.ms;T.c+=t;
    return [curralEm(o.l,fim),o.l.nome,nf(o.dias),nf(o.mn),nf(o.ms/o.cabDias,2),pc(o.pvN?o.pvS/o.pvN:NaN,2),rs(t),rs((o.cr+o.co)/o.cabDias)];});
  const ie=Object.entries(D.ins).sort((a,b)=>b[1].kg-a[1].kg);
  enviarImg(`Relatório de ${dB(ini)} a ${dB(fim)}`,[{cab:'Por lote',cols:[['Curral',110,'l'],['Lote',180,'l'],['Dias',65,'r'],['MN kg',105,'r'],['MS/cab/d',95,'r'],['% PV',80,'r'],['Custo',140,'r'],['R$/cab/d',105,'r']],linhas:L,
    total:['TOTAL','','',nf(T.mn),nf(T.cd?T.ms/T.cd:NaN,2),'',rs(T.c),'']},
    ...(ie.length?[{cab:'Insumos usados no período',cols:[['Insumo',430,'l'],['kg (MN)',230,'r'],['Custo',220,'r']],linhas:ie.map(([n,o])=>[n,nf(o.kg),rs(o.rs)]),total:['TOTAL',nf(ie.reduce((a,[,o])=>a+o.kg,0)),rs(ie.reduce((a,[,o])=>a+o.rs,0))]}]:[])],
    `Relatorio ${dB(ini).replace(/\//g,'-')} a ${dB(fim).replace(/\//g,'-')}`);}
function imgComp(){const todosL=gTodos('lote').filter(l=>GT.compEnc?!ativo(l):true).sort(porCurral);const cores=[];
  const L=todosL.map(l=>{const C=calcLote(l);cores.push([null,null,null,null,null,null,C.fim?(C.lucro>=0?corV:corR):null]);
    return [l.nome,C.fim?'Encerrado':curralEm(l,hojeKey()),nf(C.dias),nf(C.cabV?C.gmdV:l.gmd,2)+(C.cabV?'':' (meta)'),nf(C.msCab,2),rs(C.custoArr),C.fim?rs(C.lucro/C.cabE):'—'];});
  enviarImg('Comparativo de lotes',[{cab:GT.compEnc?'Lotes encerrados':'Todos os lotes',cols:[['Lote',200,'l'],['Curral',120,'l'],['Dias',65,'r'],['GMD',120,'r'],['MS/cab',90,'r'],['R$/@ prod.',130,'r'],['Lucro/cab',130,'r']],linhas:L,cores}],'Comparativo de lotes');}
function imgLote(id){const l=G.it[id],C=calcLote(l),cabE=C.cabE;
  const sec=[kv('Lote',[['Lote',l.nome],['Curral',curralEm(l,C.ate)],['Período',`${dB(l.ent.dia)} a ${dB(C.ate)} (${nf(C.dias)} dias)`],['Entrada',`${nf(cabE)} cab · ${nf(C.pesoE)} kg`],['Situação',C.fim?'Encerrado':'Ativo']]),
    kv('Desempenho',[['MS por cab/dia',nf(C.msCab,2)+' kg'],['% do peso vivo',pc(C.pv,2)],['MN por cab/dia',nf(C.mnCab,2)+' kg'],[C.cabV?'GMD real':'GMD meta',nf(C.cabV?C.gmdV:l.gmd,2)+' kg/dia'],...(C.cabV?[['Conversão alimentar',nf(C.conv,2)],['Custo da @ produzida',rs(C.custoArr)]]:[])]),
    {cab:'Custos',cols:[['Custo',300,'l'],['Total',190,'r'],['Por cabeça',170,'r']],linhas:[['Compra',rs(C.compra),rs(C.compra/cabE)],['Ração',rs(C.alim),rs(C.alim/cabE)],['Operacional',rs(C.op),rs(C.op/cabE)],...(C.outros?[['Sanidade e outros',rs(C.outros),rs(C.outros/cabE)]]:[])],total:['TOTAL',rs(C.custo),rs(C.custo/cabE)]}];
  if(C.cabV)sec.push(kv('Venda',[['Vendidos',`${nf(C.cabV)} cab · ${nf(C.pesoV)} kg`],['@ por cabeça',nf(C.arrV/C.cabV,2)],['Receita líquida',rs(C.receita)],['@ produzidas',nf(C.arrProd,2)]]));
  if(C.fim){const s=kv('Resultado',[[C.lucro>=0?'LUCRO':'PREJUÍZO',rs(C.lucro)],['Por cabeça',rs(C.lucro/cabE)],['Sobre o custo',pc(C.lucro/C.custo*100,1)]]);s.cores=s.linhas.map(()=>[null,C.lucro>=0?corV:corR]);sec.push(s);}
  enviarImg(`${C.fim?'Relatório final':'Resultado até hoje'} · ${l.nome}`,sec,`Lote ${l.nome} ${dB(C.ate).replace(/\//g,'-')}`);}
function xlsGraf(){const D=dadosGraf(GT.dia);const cab=['Curral'].concat(D.dias.map(d=>dB(d).slice(0,5)),['Média']);
  gExcel(`Leitura de cocho ate ${dB(GT.dia).replace(/\//g,'-')}`,[['Notas',cab,D.linhas.map(o=>{const ns=o.cel.filter(Boolean);return [xc(o.c)].concat(o.cel.map(x=>x?xc(x.nota,'int'):xc('')),[xc(ns.length?ns.reduce((a,x)=>a+x.nota,0)/ns.length:NaN,'dec')]);}),[16].concat(D.dias.map(()=>8),[9])],
    ['Kg do dia',cab.slice(0,-1),D.linhas.map(o=>[xc(o.c)].concat(o.cel.map(x=>x&&ok(x.novo)?xc(x.novo,'int'):xc('')))),[16].concat(D.dias.map(()=>9))]]);}

/* ---------- relatórios ---------- */
function tRels(){return `<div class="gGrade">
  <button class="gBig" data-g="ir" data-t="dia">📋<b>Do dia</b><small>consumo, custo e insumos por lote</small></button>
  <button class="gBig" data-g="ir" data-t="periodo">📆<b>Por período</b><small>semana, mês ou datas escolhidas</small></button>
  <button class="gBig" data-g="ir" data-t="comp">📊<b>Comparativo de lotes</b><small>desempenho e resultado lado a lado</small></button></div>
  <p class="note">O relatório de um lote fica dentro do lote: Lotes → escolha o lote → Resultado.</p>`;}
function linhasDia(dia){const X=gCtx();return X.L.map(l=>({l,x:diaLote(l,dia,X)})).filter(o=>o.x).sort((a,b)=>porCurral(a.l,b.l));}
function tDia(t){
  const dia=t.dia||hojeKey(),ls=linhasDia(dia),T={cab:0,mn:0,ms:0,cr:0,co:0,pvP:0},ins={};
  const rows=ls.map(({l,x})=>{T.cab+=x.cab;T.mn+=x.mn;if(ok(x.ms))T.ms+=x.ms;if(ok(x.custoR))T.cr+=x.custoR;T.co+=x.custoOp;T.pvP+=x.cab*x.peso;somaInsumos(ins,x);
    const tot=(ok(x.custoR)?x.custoR:0)+x.custoOp;const lt=G.it[idLeit(dia,x.c)];
    return cartaoLote(l,x.c,`${esc(x.rac)}${lt&&!lt.del?' · nota de cocho '+notaTxt(lt.nota):''}`,[[nf(x.cab),'cab'],[nf(x.peso),'kg proj.'],[nf(x.mn),'kg MN'],[nf(x.msCab,2),'MS/cab'],[pc(x.pv,2),'do PV'],[rs(tot/x.cab),'custo/cab']]);}).join('');
  const tot=T.cr+T.co;
  return `${voltar('Relatórios')}<section class="panel"><h2>Relatório do dia</h2>
    ${navData('gDiaDia',dia,'Data')}
    <div class="stat gStat3">${st('Cabeças',nf(T.cab))}${st('MN total',nf(T.mn)+' kg')}${st('MS/cab',nf(T.cab?T.ms/T.cab:NaN,2)+' kg')}
      ${st('% peso vivo',pc(T.pvP?T.ms/T.pvP*100:NaN,2))}${st('Custo total',rs(tot))}${st('Custo/cab',rs(T.cab?tot/T.cab:NaN))}</div>
    <p class="note">Ração ${rs(T.cr)} + operacional ${rs(T.co)}.</p>
    ${rows||'<p class="note">Nenhum lote nesta data.</p>'}
    <p class="note">Peso = projetado pela última pesagem e a meta de ganho. MN = trato realizado no curral (dividido por cabeça se houver mais de um lote).</p>
    ${rows?'<div class="row compart"><button class="verde" data-g="imgDia">🖼 Imagem</button><button class="verde" data-g="xlsDia">📊 Excel</button></div>':''}</section>
  ${Object.keys(ins).length?card('Insumos usados no dia',tabInsumos(ins)):''}`;
}
function textoDia(){const dia=$('gDiaDia').value,ls=linhasDia(dia);
  let cab=0,mn=0,ms=0,c=0;const linhas=ls.map(({l,x})=>{cab+=x.cab;mn+=x.mn;ms+=ok(x.ms)?x.ms:0;const t=(ok(x.custoR)?x.custoR:0)+x.custoOp;c+=t;
    return `*${x.c}* · ${l.nome} · ${nf(x.cab)} cab · ${nf(x.peso)} kg\n  MN ${nf(x.mn)} kg (${nf(x.mnCab,1)}/cab) · MS ${nf(x.msCab,2)} kg/cab · ${pc(x.pv,2)} PV\n  Custo ${rs(t)} (${rs(t/x.cab)}/cab)`;});
  return `*Relatório do dia ${dB(dia)}*\n\n${linhas.join('\n\n')}\n\n*Total:* ${nf(cab)} cab · MN ${nf(mn)} kg · MS ${nf(ms)} kg · ${rs(c)}`;}
function xlsDia(){const dia=$('gDiaDia').value,ls=linhasDia(dia),ins={};
  const r=ls.map(({l,x})=>{somaInsumos(ins,x);const t=(ok(x.custoR)?x.custoR:0)+x.custoOp;
    return [xc(dia,'dia'),xc(x.c),xc(l.nome),xc(x.rac),xc(x.cab,'int'),xc(x.peso,'int'),xc(x.mn,'int'),xc(x.ms,'int'),xc(x.mnCab,'dec'),xc(x.msCab,'dec'),xc(x.pv/100,'pct'),xc(x.custoR,'rs'),xc(x.custoOp,'rs'),xc(t,'rs'),xc(t/x.cab,'rs')];});
  gExcel(`Relatório do dia - ${dB(dia).replace(/\//g,'-')}`,[['Por lote',['Data','Curral','Lote','Ração','Cabeças','Peso proj. (kg)','MN (kg)','MS (kg)','MN/cab','MS/cab','% PV','Custo ração','Custo operacional','Custo total','Custo/cab'],r,[11,10,18,14,9,10,10,10,9,9,8,13,13,13,11]],
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
    return cartaoLote(o.l,curralEm(o.l,fim),`${nf(o.dias)} dias no período · ${nf(o.cabDias/o.dias)} cab em média`,[[nf(o.mn),'kg MN'],[nf(o.ms/o.cabDias,2),'MS/cab/dia'],[pc(o.pvN?o.pvS/o.pvN:NaN,2),'do PV'],[rs(tot),'custo total'],[rs((o.cr+o.co)/o.cabDias),'R$/cab/dia'],[rs(o.out),'sanidade']]);}).join('');
  const tot=T.cr+T.co+T.out;
  const atalho=(n,r)=>`<button class="mini" data-g="perAtalho" data-n="${n}">${r}</button>`;
  return `${voltar('Relatórios')}<section class="panel"><h2>Relatório por período</h2>
    <div class="gForm"><div class="gCampo"><label for="gPerIni">De</label><input type="date" id="gPerIni" value="${ini}"></div><div class="gCampo"><label for="gPerFim">Até</label><input type="date" id="gPerFim" value="${fim}"></div></div>
    <div class="row">${atalho(7,'7 dias')}${atalho(15,'15 dias')}${atalho(30,'30 dias')}${atalho('mes','Este mês')}</div>
    <div class="stat gStat3">${st('Cab-dia',nf(T.cd))}${st('MN total',nf(T.mn)+' kg')}${st('MS/cab/dia',nf(T.cd?T.ms/T.cd:NaN,2)+' kg')}
      ${st('Custo total',rs(tot))}${st('R$/cab/dia',rs(T.cd?(T.cr+T.co)/T.cd:NaN))}${st('Sanidade',rs(T.out))}</div>
    <p class="note">Ração ${rs(T.cr)} + operacional ${rs(T.co)}${T.out?` + sanidade ${rs(T.out)}`:''}.</p>
    ${rows||'<p class="note">Nada nesse período.</p>'}
    ${rows?'<div class="row compart"><button class="verde" data-g="imgPer">🖼 Imagem</button><button class="verde" data-g="xlsPer">📊 Excel</button></div>':''}</section>
  ${Object.keys(D.ins).length?card('Insumos usados no período',tabInsumos(D.ins)):''}`;
}
function xlsPer(){const ini=GT.ini,fim=GT.fim,D=periodoDados(ini,fim);
  const r1=D.lotes.map(o=>[xc(curralEm(o.l,fim)),xc(o.l.nome),xc(o.dias,'int'),xc(o.cabDias,'int'),xc(o.mn,'int'),xc(o.ms,'int'),xc(o.mn/o.cabDias,'dec'),xc(o.ms/o.cabDias,'dec'),xc(o.pvN?o.pvS/o.pvN/100:NaN,'pct'),xc(o.cr,'rs'),xc(o.co,'rs'),xc(o.out,'rs'),xc(o.cr+o.co+o.out,'rs'),xc((o.cr+o.co)/o.cabDias,'rs')]);
  const r2=D.diario.map(({d,l,x})=>[xc(d,'dia'),xc(x.c),xc(l.nome),xc(x.rac),xc(x.cab,'int'),xc(x.peso,'int'),xc(x.mn,'int'),xc(x.ms,'int'),xc(x.msCab,'dec'),xc(x.pv/100,'pct'),xc(x.custoR,'rs'),xc(x.custoOp,'rs')]);
  gExcel(`Relatório ${dB(ini).replace(/\//g,'-')} a ${dB(fim).replace(/\//g,'-')}`,[
    ['Por lote',['Curral','Lote','Dias','Cab-dia','MN (kg)','MS (kg)','MN/cab/dia','MS/cab/dia','% PV médio','Custo ração','Custo operacional','Sanidade/outros','Custo total','Ração+oper./cab/dia'],r1,[10,18,7,9,11,11,10,10,9,13,13,13,13,12]],
    ['Por dia',['Data','Curral','Lote','Ração','Cabeças','Peso proj.','MN (kg)','MS (kg)','MS/cab','% PV','Custo ração','Custo operacional'],r2,[11,10,18,14,9,10,10,10,9,8,13,13]],
    ['Insumos',['Insumo','kg (MN)','Custo'],Object.entries(D.ins).map(([n,o])=>[xc(n),xc(o.kg,'int'),xc(o.rs,'rs')]),[22,12,14]]]);}

function tComp(t){
  const todosL=gTodos('lote').filter(l=>t.enc?!ativo(l):true).sort(porCurral);
  const Cs=todosL.map(l=>({l,C:calcLote(l)}));GT.compEnc=!!t.enc;
  const rows=Cs.map(({l,C})=>cartaoLote(l,curralEm(l,C.ate),`${C.fim?'Encerrado em '+dB(C.fim):'Ativo'} · ${nf(C.dias)} dias${[sexoTxt(l.sexo),l.raca].filter(Boolean).length?' · '+esc([sexoTxt(l.sexo),l.raca].filter(Boolean).join(' · ')):''}`,
    [[nf(C.cabV?C.gmdV:l.gmd,2),C.cabV?'GMD real':'GMD meta'],[nf(C.msCab,2),'MS/cab/dia'],[pc(C.pv,2),'do PV'],[ok(C.conv)?nf(C.conv,2):'—','conversão'],[ok(C.custoArr)?rs(C.custoArr):'—','R$/@ prod.'],[C.fim?rs(C.lucro/C.cabE):'—','lucro/cab',C.fim?(C.lucro>=0?'ok':'bad'):'']])).join('');
  return `${voltar('Relatórios')}<section class="panel"><h2>Comparativo de lotes</h2>
    <div class="row"><button class="mini${t.enc?'':' sel'}" data-g="ir" data-t="comp">Todos</button><button class="mini${t.enc?' sel':''}" data-g="ir" data-t="comp" data-enc="1">Só encerrados</button></div>
    ${rows||'<p class="note">Nenhum lote.</p>'}
    <p class="note">Conversão e custo da @ produzida aparecem depois das vendas. Lucro só nos lotes encerrados.</p>
    ${rows?'<div class="row compart"><button class="verde" data-g="imgComp">🖼 Imagem</button><button class="verde" data-g="xlsComp">📊 Excel</button></div>':''}</section>`;
}
function xlsComp(){const todosL=gTodos('lote').filter(l=>GT.compEnc?!ativo(l):true).sort(porCurral);
  const r=todosL.map(l=>{const C=calcLote(l),e=l.ent;return [xc(l.nome),xc(C.fim?'Encerrado':'Ativo'),xc(curralEm(l,C.ate)),xc(sexoTxt(l.sexo)),xc(l.raca||''),xc(e.dia,'dia'),xc(C.fim||'','dia'),xc(C.dias,'int'),xc(C.cabE,'int'),xc(C.cabV,'int'),xc(C.mortes,'int'),
    xc(C.pesoE,'int'),xc(C.pesoV,'int'),xc(C.gmdV,'dec'),xc(l.gmd,'dec'),xc(C.msCab,'dec'),xc(C.pv/100,'pct'),xc(C.conv,'dec'),xc(C.compra,'rs'),xc(C.alim,'rs'),xc(C.op,'rs'),xc(C.outros,'rs'),xc(C.custo,'rs'),xc(C.receita,'rs'),xc(C.arrProd,'dec'),xc(C.custoArr,'rs'),xc(C.lucro,'rs'),xc(C.lucro/C.cabE,'rs')];});
  gExcel('Comparativo de lotes',[['Lotes',['Lote','Situação','Curral','Sexo','Raça','Entrada','Saída','Dias','Cab. entrada','Cab. vendidas','Mortes','Peso entrada','Peso saída','GMD real','GMD meta','MS/cab/dia','% PV','Conversão','Compra','Ração','Operacional','Sanidade/outros','Custo total','Receita','@ produzidas','Custo @ produzida','Lucro','Lucro/cab'],r]]);}
function xlsLote(id){const l=G.it[id],C=calcLote(l),X=gCtx(),r=[];
  for(let d=l.ent.dia,i=0;d<=C.ate&&i<4000;d=somaDias(d,1),i++){const x=diaLote(l,d,X);if(!x)continue;const lt=G.it[idLeit(d,x.c)];
    r.push([xc(d,'dia'),xc(x.c),xc(x.rac),xc(x.cab,'int'),xc(x.peso,'int'),xc(x.mn,'int'),xc(x.ms,'int'),xc(x.mnCab,'dec'),xc(x.msCab,'dec'),xc(x.pv/100,'pct'),xc(lt&&!lt.del?lt.nota:''),xc(x.custoR,'rs'),xc(x.custoOp,'rs')]);}
  const res=(GT.relRes||[]).map(([a,b])=>[xc(a),xc(b)]);
  gExcel(`Lote ${l.nome}`,[['Resumo',['Item','Valor'],res,[36,40]],['Dia a dia',['Data','Curral','Ração','Cabeças','Peso proj.','MN (kg)','MS (kg)','MN/cab','MS/cab','% PV','Nota cocho','Custo ração','Custo operacional'],r,[11,10,14,9,10,10,10,9,9,8,9,13,13]]]);}

/* ---------- rações ---------- */
function tRacoes(){
  const hj=hojeKey(),R=gTodos('racao').sort(porNome);
  const cards=R.map(r=>{const cp=compRacao(r,hj);const usam=lotesAtivos().filter(l=>{const x=racaoEm(l,hj);return x&&x.uid===r.uid;}).length;
    return `<button class="gItem gRacItem" data-g="ir" data-t="racForm" data-id="${r.uid}"><div class="gItemTopo"><b>${esc(r.nome)}</b><span class="pill${usam?' done':''}">${usam?usam+' lote(s)':'sem lote'}</span></div>
      ${cp?`<div class="gMini3"><div><small>MS</small><b>${pc(cp.ms)}</b></div><div><small>R$/kg MN</small><b>${rs(cp.custoMN,3)}</b></div><div><small>R$/kg MS</small><b>${rs(cp.custoMS,3)}</b></div></div>
      <div class="gComp"><div class="gCompCab"><span>Insumo</span><span>% MS</span><span>% MN</span></div>${cp.itens.map(i=>`<div><span>${esc(i.nome)}<i style="width:${Math.max(2,Math.min(100,i.pMN||0)).toFixed(1)}%"></i></span><b>${nf(i.pMS,1)}</b><b>${nf(i.pMN,1)}</b></div>`).join('')}</div>`:'<p class="note">sem fórmula</p>'}</button>`;}).join('');
  return `<section class="panel"><h2>Rações</h2>${cards||'<p class="note">Nenhuma ração. Cadastre os insumos primeiro e depois a ração.</p>'}
    <button class="lima" data-g="ir" data-t="racForm">+ Nova ração</button></section>`;
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
  box.innerHTML=`<div class="tablebox"><table class="gTab gRacTab"><thead><tr><th>Insumo</th><th>% MS</th><th>% MN</th></tr></thead><tbody>
    ${cp.itens.map(i=>`<tr><td class="c">${esc(i.nome)}<small>MS ${pc(i.ms,0)} · ${rs(i.preco)}/t</small></td><td>${nf(i.pMS,1)}</td><td>${nf(i.pMN,1)}</td></tr>`).join('')}
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
  const rows=I.map(i=>{const p=precoIns(i,hj);return `<tr data-g="ir" data-t="insForm" data-id="${i.uid}" class="gClic"><td class="c">${esc(i.nome)}</td><td>${pc(+i.ms,0)}</td><td>${rs(p)}<small>${rs(p/1000/(i.ms/100),3)}/kg MS</small></td></tr>`;}).join('');
  return `<section class="panel"><h2>Insumos</h2>
    <div class="tablebox"><table class="gTab"><thead><tr><th>Insumo</th><th>MS</th><th>Preço por tonelada</th></tr></thead><tbody>${rows||'<tr><td colspan="3">Nenhum insumo ainda.</td></tr>'}</tbody></table></div>
    <p class="note">Preço por tonelada como comprado (matéria natural). Toque no insumo para mudar o preço.</p>
    <button class="lima" data-g="ir" data-t="insForm">+ Novo insumo</button></section>`;
}
function tInsForm(t){const i=t.id?G.it[t.id]:null,hj=hojeKey();
  const hist=i?(i.precos||[]).slice().reverse().map((p,k,a)=>`<tr><td>${dB(p.desde)}</td><td>${rs(+p.rs,2)}</td><td class="acoes">${a.length>1?`<button class="mini danger" data-g="insPrecoRm" data-id="${i.uid}" data-d="${p.desde}">✕</button>`:''}</td></tr>`).join(''):'';
  return `${voltar()}<section class="panel"><h2>${i?'Insumo':'Novo insumo'}</h2><div class="gForm">${[
    {k:'nome',l:'Nome',v:i?i.nome:'',ph:'Ex.: Silagem de milho'},{k:'ms',l:'Matéria seca',suf:'%',t:'num',v:i?i.ms:'',meia:1},
    {k:'preco',l:'Preço por tonelada',suf:'R$/t',t:'rs',v:i?precoIns(i,hj):'',meia:1},
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
  if(!GT.racasEd)GT.racasEd=c.racas.slice().sort(alfa);
  if(!GT.notasEd)GT.notasEd=c.notas.slice().sort((a,b)=>a.n-b.n).map(x=>Object.assign({},x));
  return `<section class="panel"><h2>Custo operacional</h2><div class="gForm">${[
    {k:'taxa',l:'Taxa operacional',suf:'por cabeça por dia',t:'rs',v:tx?tx.rs:'',meia:1},{k:'tdesde',l:'Vale a partir de',t:'dia',v:tx?hj:'2000-01-01',meia:1}].map(campo).join('')}</div>
    ${(c.taxa||[]).length?`<p class="note">${c.taxa.map(x=>`Desde ${dB(x.desde)}: ${rs(+x.rs)}`).join(' · ')}</p>`:''}</section>
  <section class="panel"><h2>Notas da leitura de cocho</h2>
    <div class="gNotaCfg gNotaCab"><span>Nota</span><span>Descrição</span><span>Ajuste %</span><span></span></div>
    ${GT.notasEd.map((x,k)=>`<div class="gNotaCfg"><input class="cell num" inputmode="text" data-nn="${k}" value="${esc(vIn(x.n))}"><input type="text" data-nt="${k}" value="${esc(x.t)}"><input class="cell num" inputmode="text" data-np="${k}" value="${esc(vIn(x.p))}"><button class="mini danger" data-g="notaRm" data-i="${k}">✕</button></div>`).join('')}
    <div class="row"><button data-g="notaAdd">+ Adicionar nota</button><button data-g="notaPadrao">Voltar ao padrão (−4 a +4)</button></div>
    <p class="note">Nota positiva aumenta o trato, negativa diminui. O ajuste é em cima do realizado de ontem. Use o sinal de menos (−) para diminuir.</p></section>
  <section class="panel"><h2>Raças</h2>
    <div class="gChips">${GT.racasEd.map((r,k)=>`<button class="sel" data-g="racaRm" data-i="${k}">${esc(r)} ✕</button>`).join('')}</div>
    <div class="gRacaAdd"><input type="text" id="gNovaRaca" placeholder="Nova raça" autocomplete="off"><button class="lima" data-g="racaAdd">+ Incluir</button></div>
    <p class="note">Aparecem na ficha do lote. Toque numa raça para tirar.</p></section>
  <section class="panel"><h2>Outros</h2><div class="gForm">${[
    {k:'arred',l:'Arredondar o previsto de',suf:'kg',t:'num',v:c.arred,meia:1},{k:'rc',l:'Rendimento de carcaça padrão',suf:'%',t:'num',v:c.rc,meia:1},
    {k:'pvIni',l:'Consumo inicial sugerido',suf:'% do PV em MS',t:'num',v:c.pvIni,ajuda:'Usado na leitura de cocho quando o curral ainda não tem trato.'}].map(campo).join('')}</div>
    <button class="primary" data-g="salvaCfg">Salvar configurações</button></section>`;}
function lerNotasEd(){(GT.notasEd||[]).forEach((x,k)=>{const n=document.querySelector(`#gBox [data-nn="${k}"]`),t=document.querySelector(`#gBox [data-nt="${k}"]`),p=document.querySelector(`#gBox [data-np="${k}"]`);
  if(n)x.n=gNum(n.value);if(t)x.t=t.value.trim();if(p)x.p=gNum(p.value);});}
function salvaCfg(){const c=JSON.parse(JSON.stringify(gCfg()));const t=fn('taxa'),d=fv('tdesde')||hojeKey();
  if(ok(t)){const v=vig(c.taxa,d);if(!v||+v.rs!==t)setHist(c.taxa,d,{rs:t});}
  lerNotasEd();const ns=GT.notasEd.filter(x=>ok(x.n)&&ok(x.p));
  if(new Set(ns.map(x=>x.n)).size!==ns.length)return toast('Tem nota repetida');if(!ns.length)return toast('Coloque pelo menos uma nota');
  c.racas=(GT.racasEd||c.racas).slice();GT.racasEd=null;c.notas=ns.map(x=>({n:x.n,t:x.t||(x.p>0?'Aumentar':x.p<0?'Diminuir':'Manter'),p:x.p})).sort((a,b)=>a.n-b.n);c.notasV=NOTAS_VER;
  const a=fn('arred'),rc=fn('rc'),pv=fn('pvIni');if(ok(a)&&a>=0)c.arred=a;if(rc>0)c.rc=rc;if(pv>0)c.pvIni=pv;
  gPut(c);GT.notasEd=null;toast('Configurações salvas');gRender();}

/* =====================================================================================
   EVENTOS
   ===================================================================================== */
const SO_VER=new Set(['evolN','imgDia','imgPer','imgComp','imgLote','xlsGraf','racaAdd','racaRm','grafLoc','grafCur','celGraf','imgGraf','filtroLoc','dataPasso','dataHoje','voltar','ir','lote','raiz','compRel','compDia','xlsDia','xlsPer','xlsComp','xlsLote','perAtalho','nota','racAdd','racRm','notaAdd','notaRm','notaPadrao']);
$('gBox').addEventListener('click',e=>{
  const b=e.target.closest('[data-g]');if(!b)return;const a=b.dataset.g,id=b.dataset.id;
  if(!SO_VER.has(a)&&bloqueado())return;
  if(a==='voltar')return gVoltar();
  if(a==='ir'){const t={t:b.dataset.t,id,o:b.dataset.o,enc:b.dataset.enc==='1'};
    if(GT.t==='lotes'&&t.t==='lotes'){GT=t;return gRender();}return gIr(t);}
  if(a==='lote')return gIr({t:'lote',id});
  if(a==='raiz')return gRaiz(b.dataset.t);
  if(a==='filtroLoc'){gLoc=b.dataset.l;return gRender();}
  if(a==='racaAdd'){lerNotasEd();const v=($('gNovaRaca').value||'').trim();if(!v)return toast('Digite o nome da raça');
    if(GT.racasEd.some(r=>alfa(r,v)===0))return toast('Essa raça já está na lista');GT.racasEd.push(v);GT.racasEd.sort(alfa);gRender();return toast('Incluída. Toque em Salvar configurações.');}
  if(a==='racaRm'){lerNotasEd();GT.racasEd.splice(+b.dataset.i,1);gRender();return toast('Tirada. Toque em Salvar configurações.');}
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
['pointerdown','pointermove'].forEach(ev=>$('gBox').addEventListener(ev,e=>{const r=e.target.closest&&e.target.closest('.gEvHit');if(r)evolMostrar(+r.dataset.ev);}));
$('gBox').addEventListener('click',e=>{const i=e.target.closest('.gDataBox input');if(i&&i.showPicker){try{i.showPicker();}catch(_){}}});
$('gBox').addEventListener('input',e=>{
  const t=e.target;
  if(t.classList.contains('gRs'))mascaraRs(t);
  if(GT.t==='racForm'&&(t.matches('[data-rp]')||t.id==='gVag'))calcRacao();
  if(GT.t==='rel'&&/^gf_s/.test(t.id))calcSimul();
  if(GT.t==='pesForm'&&(t.id==='gf_peso'||t.id==='gf_dia'))calcPes();
});
$('gBox').addEventListener('change',e=>{
  const t=e.target;
  if(GT.t==='racForm'&&t.matches('[data-ri]'))calcRacao();
  if(t.id==='gCoDia'){GT.sel={};GT.dia=t.value||hojeKey();gRenderCom({dia:GT.dia});}
  if(t.id==='gDiaDia'){gRenderCom({dia:t.value||hojeKey()});}
  if(t.id==='gResDia'){gRenderCom({dia:t.value||hojeKey()});}
  if(t.id==='gRefDia'||t.id==='gGrafDia'){gRenderCom({dia:t.value||hojeKey()});}
  if(t.id==='gPerIni'||t.id==='gPerFim'){let a=$('gPerIni').value,b=$('gPerFim').value;if(a&&b&&a>b)[a,b]=[b,a];gRenderCom({ini:a,fim:b});}
  if(t.matches('input[data-kg]')){const c=t.dataset.kg;GT.sel=GT.sel||{};const lt=G.it[idLeit(GT.dia,c)];
    const n=GT.sel[c]?GT.sel[c].n:(lt&&!lt.del?lt.nota:null);if(n==null){toast('Marque a nota primeiro');t.value='';return;}GT.sel[c]={n,kg:gNum(t.value)};}
});
function gRenderCom(o){Object.assign(GT,o);gRender();}


/* ---------- menu: Gestão (Resumo, Lotes, Cocho, Relatórios, Rações, Insumos, Config.) ---------- */
$('tabGrpGest').addEventListener('click',()=>tocarGrupo('gest'));
$('subGest').addEventListener('click',e=>{const b=e.target.closest('button[data-gt]');if(b)gRaiz(b.dataset.gt);});
window.gAoAbrir=()=>{gRender();if(navigator.onLine)gSync(true).catch(()=>{});};
/* nome do curral mudou no Previsto: o lote passa a usar o nome novo a partir de hoje */
window.gRenomearCurral=(de,para)=>{const hj=hojeKey();gTodos('lote').forEach(l=>{if(ativo(l)&&curralEm(l,hj)===de){const x=JSON.parse(JSON.stringify(l));setHist(x.curr,hj,{c:para});gPut(x);}});};

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
const cSave=()=>{try{localStorage.setItem(CK,JSON.stringify(CG));}catch(e){}if(typeof agendarAoVivo==='function')agendarAoVivo();};
/* acompanhamento ao vivo do Carregar */
window.cEstadoAoVivo=auto=>{const B=CG.ativa,base={modo:'carga',origem:auto?'auto':'manual',dia:hojeKey()};
  if(!B)return Object.assign(base,{trato:+CG.trato||1,semBatida:true});
  const it=B.itens[B.atual]||{},pesoAgora=auto&&window.AUTO&&AUTO.peso!=null?Math.round(AUTO.peso):null;
  const fim=ok(it.real)?it.fim:(auto?pesoAgora:it.fim);
  return Object.assign(base,{dia:B.dia,trato:B.trato,rac:B.racNome,prod:it.nome||'',iProd:B.atual+1,nProd:B.itens.length,prev:ok(it.prev)?it.prev:null,
    ini:ok(it.ini)?it.ini:'',fim:ok(fim)?fim:'',feitos:B.itens.filter(x=>ok(x.real)).length,
    carregado:B.itens.reduce((a,x)=>a+(ok(x.real)?x.real:0),0),totalPrev:B.itens.reduce((a,x)=>a+(+x.prev||0),0)});};
let cTec=null,cBuf='';
/* currais do trato que usam a ração (pelo lote) e o total previsto deles */
function sugestaoCarga(trato,racId){const hj=hojeKey(),m=(S.prev||{})[String(trato)]||{},cs=[];let tot=0;
  gTodos('lote').filter(l=>cabPres(l,hj)>0).forEach(l=>{const r=racaoEm(l,hj),c=curralEm(l,hj);if(r&&r.uid===racId&&typeof m[c]==='number'&&m[c]>0&&!cs.includes(c)){cs.push(c);tot+=m[c];}});
  return {cs:cs.sort(alfa),tot};}
function itensCarga(racId,total){const r=G.it[racId];const cp=r&&!r.del?compRacao(r,hojeKey()):null;if(!cp)return [];
  let resto=Math.round(total);return cp.itens.map((i,k,a)=>{const kg=k===a.length-1?resto:Math.round(total*i.pMN/100);resto-=kg;return {ins:i.ins?i.ins.uid:'',nome:i.nome,pMN:i.pMN,prev:kg,ini:null,fim:null,real:null};});}
const cAtiva=()=>CG.ativa||null;
/* a mesma batida aparece no Carregar manual (#cBox) e no Carregar da Automação (#acBox) */
const cAuto=()=>!!($('viewAutoC')&&!$('viewAutoC').hidden);
const cCaixa=()=>$(cAuto()?'acBox':'cBox');
function cRender(){const auto=cAuto(),b=$(auto?'acBox':'cBox'),o=$(auto?'cBox':'acBox');if(!b)return;if(o)o.innerHTML='';
  if(auto&&window.acTela){b.innerHTML=acTela(cAtiva()?null:cTelaNova(),cTelaDia());if(window.acDepois)acDepois();return;}
  b.innerHTML=cAtiva()?cTelaBatida():cTelaNova();b.insertAdjacentHTML('beforeend',cTelaDia());}
function cTelaNova(){const R=gTodos('racao').sort(porNome);if(!CG.trato)CG.trato=S.tratoSel||1;if(!CG.rac||!G.it[CG.rac]||G.it[CG.rac].del)CG.rac=R[0]?R[0].uid:'';
  if(!R.length)return `<section class="panel"><h2>Carregar vagão</h2><p class="note">Cadastre a ração primeiro em Gestão → Rações.</p></section>`;
  const sg=sugestaoCarga(CG.trato,CG.rac);if(CG.totalDe!==CG.trato+'|'+CG.rac){CG.total=sg.tot||CG.total||0;CG.totalDe=CG.trato+'|'+CG.rac;cSave();}
  const its=itensCarga(CG.rac,CG.total||0);
  return `<section class="panel"><h2>Carregar vagão</h2>
    <div class="linhaTrato"><label for="cTrato">Trato</label><select class="trato" id="cTrato">${[1,2,3,4,5].map(k=>`<option value="${k}"${+CG.trato===k?' selected':''}>Trato ${k}</option>`).join('')}</select></div>
    <div><label for="cRac">Ração</label><select id="cRac">${R.map(r=>`<option value="${r.uid}"${r.uid===CG.rac?' selected':''}>${esc(r.nome)}</option>`).join('')}</select></div>
    <div><label>Total a carregar (kg)</label><div class="campoX"><input class="big num" id="cTotal" type="text" readonly inputmode="none" value="${CG.total?nf(CG.total):''}" data-ct="total"></div>
      <p class="note">${sg.cs.length?`Previsto do Trato ${CG.trato} para esta ração: <b>${nf(sg.tot)} kg</b> (${sg.cs.join(', ')})`:`Nenhum curral com esta ração no previsto do Trato ${CG.trato}. Digite o total.`}</p></div>
    ${its.length&&CG.total>0?`<div class="tablebox"><table class="gTab"><thead><tr><th>Produto</th><th>% MN</th><th>Carregar (kg)</th></tr></thead><tbody>${its.map(i=>`<tr><td class="c">${esc(i.nome)}</td><td>${nf(i.pMN,1)}</td><td><b>${nf(i.prev)}</b></td></tr>`).join('')}
      <tr class="grp"><td>Total</td><td>100,0</td><td>${nf(CG.total)}</td></tr></tbody></table></div>`:''}
    <button class="primary" data-c="iniciar"${CG.total>0&&its.length?'':' disabled'}>▶ Iniciar batida</button></section>`;}
function cTelaBatida(){const A=cAtiva(),i=A.atual,it=A.itens[i],alvo=it&&ok(it.ini)?it.ini+it.prev:NaN,real=it&&ok(it.ini)&&ok(it.fim)?it.fim-it.ini:NaN,dif=real-(it?it.prev:0);
  const feitos=A.itens.filter(x=>ok(x.real)).length,tp=A.itens.reduce((a,x)=>a+x.prev,0),tr=A.itens.reduce((a,x)=>a+(ok(x.real)?x.real:0),0),tpf=A.itens.reduce((a,x)=>a+(ok(x.real)?x.prev:0),0);
  const cls=(d,p)=>typeof classeDesv==='function'?classeDesv(d,p):'';
  return `<section class="panel"><div class="curhead"><h2>Batida · Trato ${A.trato}</h2><span class="note">${esc(A.racNome)} · ${nf(A.total)} kg</span></div>
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
    <button class="primary" data-c="concluir"${feitos?'':' disabled'}>✓ Concluir batida</button>
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
    <div class="row compart"><button class="verde" data-c="imgCarga">🖼 Imagem</button><button class="verde" data-c="xlsCarga">📊 Excel</button></div>`:'<p class="note">Nenhuma batida nesta data.</p>'}</section>`;}
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
  const inp=e.target.closest('[data-ct]');if(inp)return cTeclado(inp.dataset.ct);
  const b=e.target.closest('[data-c],[data-g]');if(!b)return;
  if(b.dataset.g==='dataPasso'||b.dataset.g==='dataHoje'){const i=cCaixa().querySelector('#'+b.dataset.alvo)||$(b.dataset.alvo);i.value=b.dataset.g==='dataHoje'?hojeKey():somaDias(i.value||hojeKey(),+b.dataset.n);CG.verDia=i.value;cSave();return cRender();}
  const a=b.dataset.c,A=cAtiva();if(!a)return;
  if(a==='imgCarga'||a==='xlsCarga')return a==='imgCarga'?imgCarga():xlsCarga();
  if(bloqueado())return;
  if(a==='iniciar'){const r=G.it[CG.rac],its=itensCarga(CG.rac,CG.total);if(!its.length)return toast('Ração sem fórmula');
    CG.ativa={dia:hojeKey(),trato:+CG.trato,rac:CG.rac,racNome:r.nome,total:CG.total,itens:its,atual:0,ts0:Date.now(),origem:cAuto()?'balanca':'manual'};cSave();cRender();window.scrollTo({top:0});if(cAuto()){if(window.acIniciou)acIniciou();return;}return cTeclado('ini');}
  if(!A&&a!=='apagaCarga')return;
  if(a==='escolher'){A.escolha=!A.escolha;cSave();return cRender();}
  if(a==='ir'){A.atual=+b.dataset.i;A.escolha=false;cSave();return cRender();}
  if(a==='ant'||a==='prox'){A.atual=Math.max(0,Math.min(A.itens.length-1,A.atual+(a==='ant'?-1:1)));const it=A.itens[A.atual],pv=A.itens[A.atual-1];if(a==='prox'&&!ok(it.ini)&&pv&&ok(pv.fim))it.ini=pv.fim;cSave();return cRender();}
  if(a==='registrar'&&cAuto())return window.acRegistrar&&acRegistrar();
  if(a==='registrar'){const it=A.itens[A.atual];if(!(ok(it.ini)&&ok(it.fim)&&it.fim>it.ini))return toast('A balança no final precisa ser maior que no início');
    it.real=it.fim-it.ini;it.hora=new Date().toTimeString().slice(0,5);it.tsReg=Date.now();
    const k=A.itens.findIndex((x,j)=>j>A.atual&&!ok(x.real)),nx=k>=0?k:A.itens.findIndex(x=>!ok(x.real));
    if(nx>=0){A.atual=nx;const n=A.itens[nx];if(!ok(n.real)){n.ini=it.fim;n.fim=null;}}
    cSave();toast(`${it.nome}: ${nf(it.real)} kg`);cRender();if(nx>=0)cTeclado('fim');else toast('Todos os produtos carregados. Toque em Concluir batida.');return;}
  if(a==='desfazer'){const feitos=A.itens.map((x,j)=>[x,j]).filter(([x])=>ok(x.real)).sort((p,q)=>((q[0].tsReg||0)-(p[0].tsReg||0))||(q[0].hora||'').localeCompare(p[0].hora||'')||(q[1]-p[1]));if(!feitos.length)return;
    const [x,j]=feitos[0];x.real=null;x.fim=null;A.atual=j;cSave();return cRender();}
  if(a==='cancelar'){if(!confirm('Cancelar esta batida? O que foi lançado nela não será salvo.'))return;CG.ativa=null;cSave();return cRender();}
  if(a==='concluir'){const falta=A.itens.filter(x=>!ok(x.real)).length;if(falta&&!confirm(`Faltam ${falta} produto(s). Concluir assim mesmo?`))return;
    gPut({uid:novoId('carga'),tipo:'carga',dia:A.dia,trato:A.trato,racao:A.rac,racNome:A.racNome,total:A.total,ts0:A.ts0,hora:new Date(A.ts0).toTimeString().slice(0,5),
      itens:A.itens.map(x=>({ins:x.ins,nome:x.nome,pMN:x.pMN,prev:x.prev,ini:x.ini,fim:x.fim,real:ok(x.real)?x.real:null,hora:x.hora||''})),origem:A.origem||''});
    CG.ativa=null;CG.verDia=A.dia;cSave();toast('Batida salva');cRender();window.scrollTo({top:0});return;}
  if(a==='apagaCarga'){if(!confirm('Apagar esta batida?'))return;gDel(b.dataset.id);return cRender();}
}
$('cBox').addEventListener('click',cClique);$('acBox').addEventListener('click',cClique);
function cMuda(e){const t=e.target;
  if(t.id==='cTrato'){CG.trato=+t.value;cSave();cRender();}
  if(t.id==='cRac'){CG.rac=t.value;cSave();cRender();}
  if(t.id==='cDia'){CG.verDia=t.value||hojeKey();cSave();cRender();}}
$('cBox').addEventListener('change',cMuda);$('acBox').addEventListener('change',cMuda);
function imgCarga(){const dia=CG.verDia||hojeKey(),L=cargasDia(dia);
  enviarImg(`Batidas do vagão · ${dB(dia)}`,L.map(c=>{const tp=c.itens.reduce((a,x)=>a+x.prev,0),tr=c.itens.reduce((a,x)=>a+(+x.real||0),0);
    return {cab:`${c.hora} · Trato ${c.trato} · ${c.racNome}`,cols:[['Produto',330,'l'],['Previsto',170,'r'],['Carregado',170,'r'],['Diferença',170,'r']],
      linhas:c.itens.map(x=>[x.nome,nf(x.prev),ok(+x.real)?nf(+x.real):'—',ok(+x.real)?((x.real-x.prev)>0?'+':'')+nf(x.real-x.prev):'']),
      cores:c.itens.map(x=>{const d=x.real-x.prev;return [null,null,null,!ok(+x.real)?null:Math.abs(d)/x.prev<=.03?'#5f7a00':Math.abs(d)/x.prev<=.08?'#b26a00':'#b3261e'];}),
      total:['TOTAL',nf(tp),nf(tr),(tr-tp>0?'+':'')+nf(tr-tp)]};}),`Batidas ${dB(dia).replace(/\//g,'-')}`);}
function xlsCarga(){const dia=CG.verDia||hojeKey(),L=cargasDia(dia),r=[];
  L.forEach(c=>c.itens.forEach(x=>r.push([xc(dia,'dia'),xc(c.hora),xc(c.trato,'int'),xc(c.racNome),xc(x.nome),xc(x.prev,'int'),xc(ok(+x.real)?+x.real:NaN,'int'),xc(ok(+x.real)?x.real-x.prev:NaN,'int'),xc(ok(+x.ini)?+x.ini:NaN,'int'),xc(ok(+x.fim)?+x.fim:NaN,'int')])));
  gExcel(`Batidas ${dB(dia).replace(/\//g,'-')}`,[['Batidas',['Data','Hora','Trato','Ração','Produto','Previsto (kg)','Carregado (kg)','Diferença (kg)','Balança início','Balança final'],r,[11,7,7,16,22,12,13,13,13,13]]]);}
$('tabCarga').addEventListener('click',()=>aba('carga'));
window.cAoAbrir=()=>{cRender();};window.cFecha=cFecha;

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
const NOTAS_PADRAO=[-5,-4,-3,-2,-1,0,1,2,3,4,5].map(n=>({n,t:n>0?'Aumentar':n<0?'Diminuir':'Manter',p:n*5}));
function gCfg(){const c=G.it.config&&!G.it.config.del?G.it.config:{uid:'config',tipo:'config'};
  if(!Array.isArray(c.taxa))c.taxa=[];if(!Array.isArray(c.notas)||!c.notas.length||c.notasV!==2)c.notas=NOTAS_PADRAO.map(x=>Object.assign({},x));
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
  return `<div class="gCampo${f.meia?' meia':''}"><label for="${id}">${esc(f.l)}${f.suf?` <span class="gSuf">(${esc(f.suf)})</span>`:''}</label>${inp}${f.ajuda?`<p class="note">${f.ajuda}</p>`:''}</div>`;}
const fv=k=>{const e=$('gf_'+k);return e?e.value.trim():'';};
const fn=k=>gNum(fv(k));
const opCurrais=()=>(S.cadastro||[]).map(n=>[n,n]);
const opRacoes=()=>[['','— escolher —']].concat(gTodos('racao').sort(porNome).map(r=>[r.uid,r.nome]));
const opInsumos=()=>gTodos('insumo').sort(porNome).map(r=>[r.uid,r.nome]);
const UNID_C=[['arroba','R$ por @ (peso vivo ÷ 30)'],['cab','R$ por cabeça'],['kg','R$ por kg vivo']];
const UNID_V=[['arroba','R$ por @ (carcaça ÷ 15)'],['cab','R$ por cabeça'],['kg','R$ por kg vivo']];

const RAIZ={home:'home',lotes:'lotes',lote:'lotes',loteForm:'lotes',pesForm:'lotes',saiForm:'lotes',mudForm:'lotes',rel:'lotes',custoForm:'lotes',
  cocho:'cocho',rels:'rels',dia:'rels',periodo:'rels',comp:'rels',racoes:'racoes',racForm:'racoes',insumos:'insumos',insForm:'insumos',cfg:'cfg'};
function gRaiz(t){GT={t};gPilha.length=0;if($('viewGest').hidden)aba('gest');else gRender();window.scrollTo({top:0});}
function gRender(){
  const b=$('gBox');if(!b)return;
  const f={home:tHome,lotes:tLotes,lote:tLote,loteForm:tLoteForm,pesForm:tPesForm,saiForm:tSaiForm,mudForm:tMudForm,rel:tRelLote,custoForm:tCustoForm,
    cocho:tCocho,rels:tRels,dia:tDia,periodo:tPeriodo,comp:tComp,racoes:tRacoes,racForm:tRacForm,insumos:tInsumos,insForm:tInsForm,cfg:tCfg}[GT.t]||tHome;
  const raiz=RAIZ[GT.t]||'home';document.querySelectorAll('#subGest button[data-gt]').forEach(x=>x.setAttribute('aria-selected',String(x.dataset.gt===raiz)));
  b.innerHTML=f(GT);
  if(GT.t==='racForm')calcRacao();
  if(GT.t==='rel')calcSimul();
}

/* ---------- custos extras do lote (sanidade, medicamento, mão de obra…) ---------- */
const custosDe=l=>gTodos('custo').filter(c=>c.lote===l.uid).sort(porDia);
const TIPOS_CUSTO=['Sanidade / vacina','Medicamento','Mão de obra','Frete','Outros'];
const SEXOS=[['','—'],['MI','Macho inteiro'],['MC','Macho castrado'],['F','Fêmea'],['MX','Misto']];
const CATS=[['','—'],['Bezerro(a)','Bezerro(a)'],['Garrote','Garrote'],['Boi magro','Boi magro'],['Novilha','Novilha'],['Vaca','Vaca'],['Boi','Boi']];
const SISTEMAS=[['Confinamento','Confinamento'],['Semiconfinamento','Semiconfinamento'],['Pasto com suplementação','Pasto com suplementação']];
const RACAS=['Nelore','Anelorado','Cruzado industrial','Angus x Nelore','Mestiço leiteiro','Girolando','Tabapuã','Brahman'];
const sexoTxt=v=>(SEXOS.find(x=>x[0]===v)||['',''])[1];

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
const ordCurral=c=>{const i=(S.cadastro||[]).indexOf(c);return i<0?999:i;};
const porCurral=(a,b)=>{const h=hojeKey(),x=ordCurral(curralEm(a,h)),y=ordCurral(curralEm(b,h));return x-y||porNome(a,b);};
/* curral em destaque: "C-10" -> CURRAL / C-10 ; "P-REPRESA-1" -> PASTO / REPRESA-1 */
function seloCurral(c){const p=/^P-/.test(c),t=p?c.replace(/^P-/,''):c;
  return `<div class="gSelo${p?' pasto':''}"><small>${p?'Pasto':'Curral'}</small><b class="${t.length<=4?'t1':t.length<=6?'t2':t.length<=9?'t3':'t4'}">${esc(t||'—').replace(/-/g,'\u2011')}</b></div>`;}

/* ---------- resumo ---------- */
function tHome(){
  const hj=hojeKey(),ont=somaDias(hj,-1),X=gCtx(),A=lotesAtivos().sort(porCurral);
  let cab=0,mn=0,ms=0,cus=0,pvP=0,cabO=0;const sexo={};
  A.forEach(l=>{const c=cabAtual(l);cab+=c;if(l.sexo)sexo[l.sexo]=(sexo[l.sexo]||0)+c;
    const x=diaLote(l,ont,X);if(x&&x.mn>0){mn+=x.mn;if(ok(x.ms))ms+=x.ms;cus+=(ok(x.custoR)?x.custoR:0)+x.custoOp;pvP+=x.cab*x.peso;cabO+=x.cab;}});
  const pesoM=cab?A.reduce((a,l)=>a+cabAtual(l)*pesoEm(l,hj),0)/cab:NaN;
  const alertas=[];
  const semLeit=cochoCurrais(hj).filter(c=>!G.it[idLeit(hj,c)]);if(semLeit.length)alertas.push(['warn',`Leitura de cocho de hoje faltando: ${semLeit.join(', ')}`,'cocho']);
  A.forEach(l=>{if(!racaoEm(l,hj))alertas.push(['bad',`${l.nome}: sem ração escolhida`,'lote',l.uid]);
    const pz=pesagensDe(l),ult=pz.length?pz[pz.length-1].dia:l.ent.dia,dd=difDias(ult,hj);if(dd>=45)alertas.push(['warn',`${l.nome}: ${dd} dias sem pesagem`,'lote',l.uid]);
    if(l.alvo&&l.gmd>0){const f=Math.ceil((l.alvo-pesoEm(l,hj))/l.gmd);if(f<=15)alertas.push(['ok',`${l.nome}: ${f<=0?'já atingiu':'atinge em '+f+' dias'} o peso de saída (${nf(l.alvo)} kg)`,'lote',l.uid]);}
    if(l.diasPrev){const f=l.diasPrev-difDias(l.ent.dia,hj);if(f<=15)alertas.push(['ok',`${l.nome}: ${f<=0?'passou':'faltam '+f} dias ${f<=0?'dos':'para os'} ${l.diasPrev} dias de cocho previstos`,'lote',l.uid]);}});
  gTodos('insumo').forEach(i=>{if(!ok(precoIns(i,hj)))alertas.push(['bad',`Insumo ${i.nome} sem preço`,'insumos']);});
  const sx=Object.entries(sexo).map(([k,v])=>`${sexoTxt(k)}: ${nf(v)}`).join(' · ');
  const linhas=A.map(l=>{const R=resumoLote(l,hj),cc=(R.custoR+R.custoOp+custosDe(l).reduce((a,c)=>a+(+c.rs||0),0))/Math.max(1,cabAtual(l));
    return `<tr class="gClic" data-g="lote" data-id="${l.uid}"><td class="c">${esc(curralEm(l,hj))}<small>${esc(l.nome)}</small></td><td>${nf(cabAtual(l))}</td><td>${nf(difDias(l.ent.dia,hj))}</td><td>${nf(pesoEm(l,hj))}</td><td>${rs(cc,0)}</td></tr>`;}).join('');
  return `<section class="panel"><h2>Resumo de hoje</h2>
    <div class="stat">${st('Lotes ativos',nf(A.length))}${st('Cabeças',nf(cab))}${st('Peso médio (proj.)',nf(pesoM)+' kg')}</div>
    ${sx?`<p class="note">${sx}</p>`:''}
    <div class="stat">${st('Trato ontem (MN)',nf(mn)+' kg')}${st('MS/cab ontem',nf(cabO?ms/cabO:NaN,2)+' kg')}${st('% do peso vivo',pc(pvP?ms/pvP*100:NaN,2))}</div>
    <div class="stat">${st('Custo ontem',rs(cus,0))}${st('Custo/cab/dia',rs(cabO?cus/cabO:NaN))}${st('Taxa operacional',rs(taxaEm(hj))+'/cab')}</div></section>
  ${alertas.length?`<section class="panel"><h2>Atenção</h2>${alertas.map(a=>`<button class="gAlerta ${a[0]}" data-g="${a[2]==='lote'?'lote':'raiz'}" data-t="${a[2]}" data-id="${a[3]||''}">${esc(a[1])}</button>`).join('')}</section>`:''}
  <section class="panel"><h2>Lotes no cocho</h2>${linhas?`<div class="tablebox"><table class="gTab"><thead><tr><th>Curral / lote</th><th>Cab</th><th>Dias</th><th>Peso</th><th>Custo/cab*</th></tr></thead><tbody>${linhas}</tbody></table></div>
    <p class="note">* Ração + operacional + outros custos até hoje, por cabeça (sem a compra).</p>`:'<p class="note">Nenhum lote ativo. Comece por Insumos → Rações → Lotes.</p>'}</section>`;
}

/* ---------- lotes ---------- */
function tLotes(t){
  const hj=hojeKey(),X=gCtx(),todosL=gTodos('lote'),lista=(t.enc?todosL.filter(l=>!ativo(l)).sort(porNome):todosL.filter(ativo).sort(porCurral));
  const ont=t.dia||somaDias(hj,-1);GT.dia=ont;const dd=dB(ont).slice(0,5);
  const cards=lista.map(l=>{const cab=cabPres(l,ont),r=racaoEm(l,ont),x=diaLote(l,ont,X),fim=fimLote(l),c=curralEm(l,fim&&fim<ont?fim:ont);
    const sub=[sexoTxt(l.sexo),l.raca,l.cat].filter(Boolean).join(' · ');
    return `<button class="gLote" data-g="lote" data-id="${l.uid}">${seloCurral(c)}
      <div class="gLoteInfo"><b>${esc(l.nome)}</b>${sub?`<span>${esc(sub)}</span>`:''}
      ${fim&&fim<ont?`<span>Encerrado em ${dB(fim)}</span>`:l.ent.dia>ont?`<span>Entra em ${dB(l.ent.dia)}</span>`:`<div class="gLoteNums"><span><b>${nf(cab)}</b> cab</span><span><b>${nf(difDias(l.ent.dia,ont))}</b> dias</span><span><b>${nf(pesoEm(l,ont))}</b> kg</span></div>
      <div class="gLoteNums"><span><b>${x&&x.mn>0?nf(x.mnCab,1):'—'}</b> MN/cab</span><span><b>${x&&x.mn>0?nf(x.msCab,2):'—'}</b> MS/cab</span><span><b>${x&&x.mn>0?pc(x.pv,2):'—'}</b> PV</span></div>
      <span>${esc(r?r.nome:'sem ração')}${x&&x.mn>0?` · ${nf(x.mn)} kg no cocho em ${dd}`:` · sem trato em ${dd}`}</span>`}</div></button>`;}).join('');
  return `<section class="panel"><div class="curhead"><h2>${t.enc?'Lotes encerrados':'Lotes ativos'}</h2><span class="note">${lista.length}</span></div>
    <div class="gCampo"><label for="gRefDia">Ver os números do dia</label><input type="date" id="gRefDia" value="${ont}"></div>
    ${cards||`<p class="note">${t.enc?'Nenhum lote encerrado.':'Nenhum lote ainda. Toque em “+ Novo lote”.'}</p>`}
    ${t.enc?'':'<button class="lima" data-g="novoLote">+ Novo lote</button>'}
    <button data-g="ir" data-t="lotes" data-enc="${t.enc?'':'1'}">${t.enc?'Ver lotes ativos':'Ver lotes encerrados'}</button></section>`;
}
function tLoteForm(t){
  const l=t.id?G.it[t.id]:null,e=(l&&l.ent)||{},hj=hojeKey(),novo=!l,v=k=>l?l[k]:'';
  const fs=[{k:'nome',l:'Nome do lote',v:v('nome'),ph:'Ex.: Lote 1 - Nelore'}];
  if(novo)fs.push({k:'curral',l:'Curral / pasto',t:'sel',op:opCurrais(),v:''});
  fs.push({k:'sistema',l:'Sistema',t:'sel',op:SISTEMAS,v:l?l.sistema:'Confinamento'},
    {k:'sexo',l:'Sexo',t:'sel',op:SEXOS,v:v('sexo'),meia:1},{k:'cat',l:'Categoria',t:'sel',op:CATS,v:v('cat'),meia:1},
    {k:'raca',l:'Raça',v:v('raca'),ph:'Ex.: Nelore',lista:'gRacas',meia:1},{k:'idade',l:'Idade',suf:'meses',t:'num',v:v('idade'),meia:1},
    {k:'dia',l:'Data de entrada',t:'dia',v:e.dia||hj,meia:1},{k:'cab',l:'Cabeças',t:'num',v:e.cab,meia:1},
    {k:'peso',l:'Peso médio na chegada',suf:'kg',t:'num',v:e.peso,meia:1},{k:'pesoC',l:'Peso médio de compra',suf:'kg, na origem',t:'num',v:e.pesoC,meia:1,ajuda:'Se a compra foi pelo peso da origem. Vazio = usa o da chegada.'},
    {k:'unid',l:'Preço de compra em',t:'sel',op:UNID_C,v:e.unid||'arroba'},{k:'preco',l:'Preço de compra',t:'rs',v:e.preco,meia:1},
    {k:'outros',l:'Frete, comissão e outros da compra',suf:'total',t:'rs',v:e.outros,meia:1},
    {k:'origem',l:'Origem / fornecedor',v:e.origem,meia:1},{k:'gta',l:'GTA / nota fiscal',v:e.gta,meia:1},
    {k:'ident',l:'Identificação (brincos, marca)',v:v('ident')});
  if(novo)fs.push({k:'racao',l:'Ração',t:'sel',op:opRacoes(),v:''});
  fs.push({k:'gmd',l:'Ganho por dia (meta)',suf:'kg/cab/dia',t:'num',v:l?l.gmd:1.5,meia:1},{k:'diasPrev',l:'Dias de cocho previstos',t:'num',v:v('diasPrev'),meia:1},
    {k:'alvo',l:'Peso de saída desejado',suf:'kg',t:'num',v:v('alvo'),meia:1},{k:'rcPrev',l:'Rendimento de carcaça esperado',suf:'%',t:'num',v:v('rcPrev')||'',meia:1},
    {k:'obs',l:'Observação',v:v('obs')});
  return `${voltar()}<section class="panel"><h2>${novo?'Novo lote':'Editar lote'}</h2><div class="gForm">${fs.map(campo).join('')}</div>
    <datalist id="gRacas">${RACAS.map(r=>`<option value="${r}">`).join('')}</datalist>
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
  l.nome=nome;l.ent={dia,cab,peso,pesoC:fn('pesoC')||null,unid:fv('unid'),preco:fn('preco'),outros:fn('outros')||0,origem:fv('origem'),gta:fv('gta')};
  l.sistema=fv('sistema');l.sexo=fv('sexo');l.cat=fv('cat');l.raca=fv('raca');l.idade=fn('idade')||null;l.ident=fv('ident');
  l.gmd=fn('gmd')||0;l.diasPrev=fn('diasPrev')||null;l.alvo=fn('alvo')||null;l.rcPrev=fn('rcPrev')||null;l.obs=fv('obs');
  gPut(l);toast('Lote salvo');gPilha.pop();GT={t:'lote',id:l.uid};gRender();
}
function tLote(t){
  const l=G.it[t.id];if(!l||l.del)return `${voltar()}<p class="note">Lote não encontrado.</p>`;
  const hj=hojeKey(),cab=cabAtual(l),fim=fimLote(l),ref=fim||hj,X=gCtx(),dRef=t.dia||(fim||somaDias(hj,-1));GT.dia=dRef;const x=diaLote(l,dRef,X),dd=dB(dRef).slice(0,5);
  const r=racaoEm(l,ref),pz=pesagensDe(l),sd=saidasDe(l),cs=custosDe(l),pj=pesoEm(l,ref),e=l.ent;
  let prevAlvo='';if(!fim&&l.alvo&&l.gmd>0){const falta=(l.alvo-pj)/l.gmd;prevAlvo=falta<=0?'já atingiu o peso desejado':`${dB(somaDias(hj,Math.ceil(falta)))} (${nf(Math.ceil(falta))} dias)`;}
  const saidaPrev=l.diasPrev?somaDias(e.dia,l.diasPrev):null;
  const proj=fim?'':`<div class="tablebox"><table><thead><tr><th>Projeção</th><th>Data</th><th>Peso (kg)</th><th>@ (÷30)</th></tr></thead><tbody>${[0,30,60,90].map(n=>{const d=somaDias(hj,n),p=pesoEm(l,d);return `<tr><td>${n?'+'+n+' dias':'Hoje'}</td><td>${dB(d)}</td><td>${nf(p)}</td><td>${nf(p/30,1)}</td></tr>`;}).join('')}${saidaPrev&&saidaPrev>hj?`<tr><td>Saída prevista</td><td>${dB(saidaPrev)}</td><td>${nf(pesoEm(l,saidaPrev))}</td><td>${nf(pesoEm(l,saidaPrev)/30,1)}</td></tr>`:''}</tbody></table></div>`;
  let ant={dia:e.dia,peso:+e.peso};
  const lp=pz.map(p=>{const dd=difDias(ant.dia,p.dia),g=dd>0?(p.peso-ant.peso)/dd:NaN;ant=p;
    return `<tr><td>${dB(p.dia)}</td><td>${nf(p.peso)}</td><td>${nf(g,3)}</td><td>${p.cab?nf(p.cab):'—'}</td><td class="acoes"><button class="mini danger" data-g="apaga" data-id="${p.uid}" data-o="pesagem">✕</button></td></tr>`;}).join('');
  const ls=sd.map(s=>`<tr><td>${dB(s.dia)}</td><td>${s.mot==='morte'?'Morte':'Venda'}</td><td>${nf(s.cab)}</td><td>${s.mot==='morte'?'—':nf(s.peso)}</td><td>${s.mot==='morte'?'—':rs(valorVenda(s),0)}</td><td class="acoes"><button class="mini danger" data-g="apaga" data-id="${s.uid}" data-o="saída">✕</button></td></tr>`).join('');
  const lc=cs.map(c=>`<tr><td>${dB(c.dia)}</td><td>${esc(c.cat)}${c.desc?`<small>${esc(c.desc)}</small>`:''}</td><td>${rs(+c.rs,0)}</td><td class="acoes"><button class="mini danger" data-g="apaga" data-id="${c.uid}" data-o="despesa">✕</button></td></tr>`).join('');
  const hist=(arr,fmt,o)=>(arr||[]).map((h,i)=>`<tr><td>${dB(h.desde)}</td><td>${esc(fmt(h))}</td><td class="acoes">${i?`<button class="mini danger" data-g="apagaHist" data-id="${l.uid}" data-o="${o}" data-i="${i}">✕</button>`:''}</td></tr>`).join('');
  const ult7=[];for(let i=6;i>=0;i--){const d=somaDias(dRef,-i);if(d<e.dia)continue;const y=diaLote(l,d,X);if(!y)continue;const lt=G.it[idLeit(d,y.c)];
    ult7.push(`<tr><td>${dB(d).slice(0,5)}</td><td>${nf(y.mn)}</td><td>${nf(y.msCab,2)}</td><td>${pc(y.pv,2)}</td><td>${lt&&!lt.del?lt.nota:'—'}</td></tr>`);}
  const ficha=[['Sistema',l.sistema],['Sexo',sexoTxt(l.sexo)],['Raça',l.raca],['Categoria',l.cat],['Idade',l.idade?nf(l.idade)+' meses':''],['Origem',e.origem],['GTA / NF',e.gta],['Identificação',l.ident],
    ['Peso de compra',e.pesoC?`${nf(e.pesoC)} kg · quebra ${pc((e.pesoC-e.peso)/e.pesoC*100,1)}`:''],['Compra',rs(valorCompra(l),0)+` (${rs(valorCompra(l)/e.cab,0)}/cab)`],
    ['Dias de cocho previstos',l.diasPrev?`${nf(l.diasPrev)} (saída ${dB(saidaPrev)})`:'']].filter(x=>x[1]);
  return `${voltar('Lotes')}<section class="panel"><div class="gLoteTopo">${seloCurral(curralEm(l,ref))}<div><h2>${esc(l.nome)}</h2><span class="pill${fim?'':' done'}">${fim?'Encerrado':'Ativo'}</span></div></div>
    <div class="stat">${st('Cabeças',nf(cab))}${st('Dias',nf(difDias(e.dia,ref)))}${st('Entrada',dB(e.dia))}</div>
    <div class="stat">${st('Peso chegada',nf(e.peso)+' kg')}${st(fim?'Peso final proj.':'Peso hoje (proj.)',nf(pj)+' kg')}${st('Meta GMD',nf(l.gmd,2)+' kg')}</div>
    <div class="stat">${st('Ração atual',esc(r?r.nome:'—'))}</div>
    <div class="gDiaBox"><div class="gCampo"><label for="gRefDia">Números do dia</label><input type="date" id="gRefDia" value="${dRef}"></div>
    ${x?`<div class="stat">${st('Cabeças',nf(x.cab))}${st('Peso proj.',nf(x.peso)+' kg')}${st('Ração',esc(x.rac))}</div>
    <div class="stat">${st('MN no cocho',nf(x.mn)+' kg')}${st('MN/cab',nf(x.mnCab,2)+' kg')}${st('MS/cab',nf(x.msCab,2)+' kg')}</div>
    <div class="stat">${st('% do peso vivo',pc(x.pv,2))}${st('Custo do dia',rs((ok(x.custoR)?x.custoR:0)+x.custoOp))}${st('Custo/cab',rs(((ok(x.custoR)?x.custoR:0)+x.custoOp)/x.cab))}</div>
    ${x.mn>0?'':`<p class="aviso warn">Sem trato lançado no ${esc(x.c)} em ${dd}.</p>`}`:`<p class="note">O lote não estava no cocho em ${dd}.</p>`}</div>
    ${prevAlvo?`<p class="note">Peso desejado de ${nf(l.alvo)} kg: ${prevAlvo}.</p>`:''}
    ${proj}
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
  ${card('Ficha do lote',`<div class="gLinhas">${ficha.map(([a,b])=>lin(a,esc(b))).join('')}</div>${l.obs?`<p class="note">${esc(l.obs)}</p>`:''}`)}
  ${ult7.length?card(`7 dias até ${dd}`,`<div class="tablebox"><table><thead><tr><th>Dia</th><th>MN kg</th><th>MS/cab</th><th>%PV</th><th>Nota</th></tr></thead><tbody>${ult7.join('')}</tbody></table></div>`):''}
  ${card('Pesagens',`<div class="tablebox"><table><thead><tr><th>Data</th><th>Peso</th><th>GMD real</th><th>Cab.</th><th></th></tr></thead><tbody>
    <tr><td>${dB(e.dia)}</td><td>${nf(e.peso)}</td><td>entrada</td><td>${nf(e.cab)}</td><td></td></tr>${lp}</tbody></table></div>`)}
  ${cs.length?card('Sanidade e outros custos',`<div class="tablebox"><table class="gTab"><thead><tr><th>Data</th><th>Tipo</th><th>Valor</th><th></th></tr></thead><tbody>${lc}</tbody></table></div><p class="note">Total: ${rs(cs.reduce((a,c)=>a+(+c.rs||0),0))}</p>`):''}
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
  const l=G.it[t.id],C=calcLote(l),R=C.R,hj=hojeKey(),cfg=gCfg(),fim=C.fim;
  const avisos=[R.semPreco?`${R.semPreco} dia(s) com ração sem preço ou sem matéria seca completa.`:'',R.semReg?`${R.semReg} dia(s) sem trato lançado no curral do lote.`:''].filter(Boolean);
  const comum=`<div class="gLinhas">
    ${lin('Lote',[sexoTxt(l.sexo),l.raca,l.cat].filter(Boolean).join(' · ')||'—')}
    ${lin('Período',`${dB(l.ent.dia)} a ${dB(C.ate)} · ${nf(C.dias)} dias`)}
    ${lin('Entrada',`${nf(C.cabE)} cab · ${nf(C.pesoE)} kg · ${nf(C.pesoE/30,2)} @/cab`)}
    ${lin('Consumo matéria natural',`${nf(R.mn)} kg · ${nf(C.mnCab,2)} kg/cab/dia`)}
    ${lin('Consumo matéria seca',`${nf(R.ms)} kg · ${nf(C.msCab,2)} kg/cab/dia`)}
    ${lin('MS em % do peso vivo (média)',pc(C.pv,2))}
    ${lin('Custo de compra',rs(C.compra))}
    ${lin('Custo da ração',rs(C.alim))}
    ${lin('Custo operacional',`${rs(C.op)} (${nf(R.cabOpDias)} cab-dia)`)}
    ${lin('Sanidade e outros custos',rs(C.outros))}
    ${lin('Ração + operacional por cab/dia',rs(C.custoCabDia))}
    ${lin('Custo total',rs(C.custo),'forte')}
    ${lin('Custo total por cabeça',rs(C.custo/C.cabE),'')}</div>`;
  let fecha='';
  if(C.cabV){
    fecha=card(fim?'Resultado final':'Vendas até agora',`<div class="gLinhas">
      ${lin('Vendidos',`${nf(C.cabV)} cab · ${nf(C.pesoV)} kg vivo médio`)}${C.mortes?lin('Mortes',`${nf(C.mortes)} cab (${pc(C.mortes/C.cabE*100,1)})`):''}
      ${lin('@ vendidas (carcaça)',`${nf(C.arrV,2)} · ${nf(C.arrV/C.cabV,2)} @/cab`)}${lin('Receita líquida',`${rs(C.receita)} · ${rs(C.receita/C.cabV,0)}/cab`)}
      ${lin('GMD real',`${nf(C.gmdV,3)} kg/dia`)}
      ${lin('@ produzidas',`${nf(C.arrProd,2)} · ${nf(C.arrProd/C.cabV,2)} @/cab`)}
      ${lin('Custo da @ produzida',rs(C.custoArr))}
      ${lin('Conversão alimentar (kg MS / kg ganho)',nf(C.conv,2))}
      ${fim?lin(C.lucro>=0?'LUCRO':'PREJUÍZO',`${rs(C.lucro)} · ${rs(C.lucro/C.cabE)} por cab`,C.lucro>=0?'forte ok':'forte bad'):''}
      ${fim?lin('Rentabilidade sobre o custo',pc(C.lucro/C.custo*100,1)):''}</div>
      ${fim?'':'<p class="note">O lote ainda tem animais: o lucro final aparece quando sair o último.</p>'}`);
  }
  const sim=fim?'':card('Simular venda hoje',`<div class="gForm">${[
    {k:'sPeso',l:'Peso vivo',suf:'kg',t:'num',v:Math.round(pesoEm(l,hj)),meia:1},{k:'sRc',l:'Rendimento',suf:'%',t:'num',v:l.rcPrev||cfg.rc,meia:1},
    {k:'sPreco',l:'Preço da @',t:'rs',v:'',meia:1}].map(campo).join('')}</div><div id="gSimRes" class="gLinhas"></div>`);
  GT.calc={cab:C.cabAt,pesoE:C.pesoE,prod:C.prod,custo:C.custo,receita:C.receita,cabE:C.cabE,cabV:C.cabV,arrV:C.arrV,ms:R.ms,ganhoV:C.ganhoV};
  return `${voltar()}<section class="panel"><div class="curhead"><h2>${esc(l.nome)}</h2><span class="pill">${fim?'Relatório final':'Até hoje'}</span></div>
    ${avisos.map(a=>`<p class="aviso warn">${a}</p>`).join('')}${comum}
    <div class="row compart"><button class="verde" data-g="compRel" data-id="${l.uid}">📤 Enviar resumo</button><button class="verde" data-g="xlsLote" data-id="${l.uid}">📊 Excel</button></div></section>${fecha}${sim}`;
}
const lin=(a,b,c)=>`<div class="${c||''}"><span>${a}</span><b class="num">${b}</b></div>`;
function calcSimul(){const box=$('gSimRes');if(!box)return;const c=GT.calc,peso=fn('sPeso'),rc=fn('sRc'),pr=fn('sPreco');
  if(!(peso>0&&rc>0&&pr>0)){box.innerHTML='<p class="note">Coloque o preço da @ para ver o resultado estimado com os animais que estão no lote.</p>';return;}
  const arr=c.cab*peso*rc/100/15,rec=arr*pr+c.receita,lucro=rec-c.custo;
  const arrProd=c.arrV+arr-(c.cabV+c.cab)*c.pesoE/30,ganho=c.ganhoV+c.cab*(peso-c.pesoE);
  box.innerHTML=lin('@ por cabeça',nf(peso*rc/100/15,2))+lin('Receita estimada',rs(rec))+lin('@ produzidas',nf(arrProd,2))+lin('Custo da @ produzida',rs(c.prod/arrProd))+
    lin('Conversão alimentar',nf(c.ms/ganho,2))+lin(lucro>=0?'Lucro estimado':'Prejuízo estimado',`${rs(lucro)} · ${rs(lucro/c.cabE)} por cab`,lucro>=0?'forte ok':'forte bad');}
function textoRel(){return [...$('gBox').querySelectorAll('.panel')].map(p=>{const h=p.querySelector('h2');
  const ls=[...p.querySelectorAll('.gLinhas>div')].map(d=>`${d.children[0].textContent}: ${d.children[1].textContent}`);
  return ls.length?`*${h?h.textContent:''}*\n`+ls.join('\n'):'';}).filter(Boolean).join('\n\n');}

/* ---------- leitura de cocho ---------- */
const idLeit=(dia,c)=>'lc-'+dia+'-'+chave(c);
function cochoCurrais(dia){const set=new Set();const A=gTodos('lote').filter(l=>cabPres(l,dia)>0);A.forEach(l=>set.add(curralEm(l,dia)));
  return (S.cadastro||[]).filter(c=>set.has(c));}
const prevTotal=c=>Object.values(S.prev||{}).reduce((a,m)=>a+(typeof m[c]==='number'?m[c]:0),0);
const notaTxt=n=>(n>0?'+':'')+nf(n,0);
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
      <div class="gNotas">${notas.map(x=>`<button class="${x.n===nota?'sel':''} ${x.p>0?'mais':x.p<0?'menos':''}" data-g="nota" data-c="${esc(c)}" data-n="${x.n}" title="${esc(x.t)}">${notaTxt(x.n)}<small>${x.p>0?'+':''}${nf(x.p,0)}%</small></button>`).join('')}</div>
      <div class="gCoNovo"><span>${cn?esc(cn.t):'Toque na nota'}</span><input class="cell num" inputmode="numeric" data-kg="${esc(c)}" value="${kg!=null?kg:''}" placeholder="kg"><small>kg/dia</small></div></div>`;}).join('');
  return `<section class="panel"><h2>Leitura de cocho</h2>
    <div class="gCampo"><label for="gCoDia">Data da leitura</label><input type="date" id="gCoDia" value="${dia}"></div>
    <details class="gLeg"><summary class="note">Ver as notas</summary>${notas.map(x=>`<p class="note"><b>${notaTxt(x.n)}</b> — ${esc(x.t)}: ${x.p>0?'+':''}${nf(x.p,0)}%</p>`).join('')}<p class="note">Para mudar as notas: Config.</p></details>
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

/* ---------- relatórios ---------- */
function tRels(){return `<div class="gGrade">
  <button class="gBig" data-g="ir" data-t="dia">📋<b>Do dia</b><small>consumo, custo e insumos por lote</small></button>
  <button class="gBig" data-g="ir" data-t="periodo">📆<b>Por período</b><small>semana, mês ou datas escolhidas</small></button>
  <button class="gBig" data-g="ir" data-t="comp">📊<b>Comparativo de lotes</b><small>desempenho e resultado lado a lado</small></button>
  <button class="gBig" data-g="raiz" data-t="lotes">🐂<b>Relatório de um lote</b><small>escolha o lote e toque em Resultado</small></button></div>`;}
function linhasDia(dia){const X=gCtx();return X.L.map(l=>({l,x:diaLote(l,dia,X)})).filter(o=>o.x).sort((a,b)=>porCurral(a.l,b.l));}
function tDia(t){
  const dia=t.dia||somaDias(hojeKey(),-1),ls=linhasDia(dia),T={cab:0,mn:0,ms:0,cr:0,co:0,pvP:0},ins={};
  const rows=ls.map(({l,x})=>{T.cab+=x.cab;T.mn+=x.mn;if(ok(x.ms))T.ms+=x.ms;if(ok(x.custoR))T.cr+=x.custoR;T.co+=x.custoOp;T.pvP+=x.cab*x.peso;somaInsumos(ins,x);
    const tot=(ok(x.custoR)?x.custoR:0)+x.custoOp;const lt=G.it[idLeit(dia,x.c)];
    return `<tr class="gClic" data-g="lote" data-id="${l.uid}"><td class="c">${esc(x.c)}<small>${esc(l.nome)} · ${esc(x.rac)}${lt&&!lt.del?' · nota '+notaTxt(lt.nota):''}</small></td><td>${nf(x.cab)}</td><td>${nf(x.peso)}</td><td>${nf(x.mn)}<small>${nf(x.mnCab,1)}/cab</small></td><td>${nf(x.ms)}<small>${nf(x.msCab,2)}/cab</small></td><td>${pc(x.pv,2)}</td><td>${rs(tot)}<small>${rs(tot/x.cab)}/cab</small></td></tr>`;}).join('');
  const tot=T.cr+T.co;
  return `${voltar('Relatórios')}<section class="panel"><h2>Relatório do dia</h2>
    <div class="gCampo"><label for="gDiaDia">Data</label><input type="date" id="gDiaDia" value="${dia}"></div>
    <div class="stat">${st('Cabeças',nf(T.cab))}${st('Matéria natural',nf(T.mn)+' kg')}${st('Matéria seca',nf(T.ms)+' kg')}</div>
    <div class="stat">${st('Custo ração',rs(T.cr))}${st('Operacional',rs(T.co))}${st('Custo/cab/dia',rs(T.cab?tot/T.cab:NaN))}</div>
    <div class="stat">${st('MS/cab',nf(T.cab?T.ms/T.cab:NaN,2)+' kg')}${st('% peso vivo',pc(T.pvP?T.ms/T.pvP*100:NaN,2))}${st('Custo total',rs(tot))}</div>
    <div class="tablebox"><table class="gTab"><thead><tr><th>Curral / lote</th><th>Cab</th><th>Peso</th><th>MN kg</th><th>MS kg</th><th>%PV</th><th>Custo</th></tr></thead>
    <tbody>${rows||'<tr><td colspan="7">Nenhum lote nesta data.</td></tr>'}</tbody></table></div>
    <p class="note">Peso = projetado pela última pesagem e a meta de ganho. MN = trato realizado no curral (dividido por cabeça se houver mais de um lote).</p>
    ${rows?'<div class="row compart"><button class="verde" data-g="compDia">📤 Enviar</button><button class="verde" data-g="xlsDia">📊 Excel</button></div>':''}</section>
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
  const hj=hojeKey(),fim=t.fim||somaDias(hj,-1),ini=t.ini||somaDias(fim,-6);GT.ini=ini;GT.fim=fim;
  const D=periodoDados(ini,fim),T={cd:0,mn:0,ms:0,cr:0,co:0,out:0};
  const rows=D.lotes.map(o=>{T.cd+=o.cabDias;T.mn+=o.mn;T.ms+=o.ms;T.cr+=o.cr;T.co+=o.co;T.out+=o.out;const tot=o.cr+o.co+o.out;
    return `<tr class="gClic" data-g="lote" data-id="${o.l.uid}"><td class="c">${esc(curralEm(o.l,fim))}<small>${esc(o.l.nome)} · ${nf(o.dias)} dias</small></td><td>${nf(o.cabDias/o.dias)}</td><td>${nf(o.mn)}<small>${nf(o.mn/o.cabDias,1)}/cab/d</small></td><td>${nf(o.ms)}<small>${nf(o.ms/o.cabDias,2)}/cab/d</small></td><td>${pc(o.pvN?o.pvS/o.pvN:NaN,2)}</td><td>${rs(tot)}<small>${rs((o.cr+o.co)/o.cabDias)}/cab/d</small></td></tr>`;}).join('');
  const tot=T.cr+T.co+T.out;
  const atalho=(n,r)=>`<button class="mini" data-g="perAtalho" data-n="${n}">${r}</button>`;
  return `${voltar('Relatórios')}<section class="panel"><h2>Relatório por período</h2>
    <div class="gForm"><div class="gCampo meia"><label for="gPerIni">De</label><input type="date" id="gPerIni" value="${ini}"></div><div class="gCampo meia"><label for="gPerFim">Até</label><input type="date" id="gPerFim" value="${fim}"></div></div>
    <div class="row">${atalho(7,'7 dias')}${atalho(15,'15 dias')}${atalho(30,'30 dias')}${atalho('mes','Este mês')}</div>
    <div class="stat">${st('Cab-dia',nf(T.cd))}${st('Matéria natural',nf(T.mn)+' kg')}${st('Matéria seca',nf(T.ms)+' kg')}</div>
    <div class="stat">${st('Custo ração',rs(T.cr))}${st('Operacional',rs(T.co))}${st('Sanidade/outros',rs(T.out))}</div>
    <div class="stat">${st('Custo total',rs(tot))}${st('Ração+oper./cab/dia',rs(T.cd?(T.cr+T.co)/T.cd:NaN))}${st('MS/cab/dia',nf(T.cd?T.ms/T.cd:NaN,2)+' kg')}</div>
    <div class="tablebox"><table class="gTab"><thead><tr><th>Curral / lote</th><th>Cab</th><th>MN kg</th><th>MS kg</th><th>%PV</th><th>Custo</th></tr></thead>
    <tbody>${rows||'<tr><td colspan="6">Nada nesse período.</td></tr>'}</tbody></table></div>
    ${rows?'<button class="verde" data-g="xlsPer">📊 Excel (por lote, por dia e insumos)</button>':''}</section>
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
  const rows=Cs.map(({l,C})=>`<tr class="gClic" data-g="lote" data-id="${l.uid}"><td class="c">${esc(l.nome)}<small>${C.fim?'encerrado':esc(curralEm(l,hojeKey()))} · ${nf(C.dias)} dias</small></td>
    <td>${nf(C.cabV?C.gmdV:l.gmd,2)}<small>${C.cabV?'real':'meta'}</small></td><td>${nf(C.msCab,2)}<small>${pc(C.pv,1)}</small></td><td>${nf(C.conv,1)}</td><td>${rs(C.custoArr)}</td><td class="${C.lucro>=0?'ok':C.lucro<0?'bad':''}">${C.fim?rs(C.lucro/C.cabE):'—'}</td></tr>`).join('');
  return `${voltar('Relatórios')}<section class="panel"><h2>Comparativo de lotes</h2>
    <div class="row"><button class="mini${t.enc?'':' sel'}" data-g="ir" data-t="comp">Todos</button><button class="mini${t.enc?' sel':''}" data-g="ir" data-t="comp" data-enc="1">Só encerrados</button></div>
    <div class="tablebox"><table class="gTab"><thead><tr><th>Lote</th><th>GMD</th><th>MS/cab</th><th>Conv.</th><th>R$/@ prod.</th><th>Lucro/cab</th></tr></thead><tbody>${rows||'<tr><td colspan="6">Nenhum lote.</td></tr>'}</tbody></table></div>
    <p class="note">Conversão e custo da @ produzida aparecem depois das vendas. Lucro só nos lotes encerrados.</p>
    ${rows?'<button class="verde" data-g="xlsComp">📊 Excel</button>':''}</section>`;
}
function xlsComp(){const todosL=gTodos('lote').filter(l=>GT.compEnc?!ativo(l):true).sort(porCurral);
  const r=todosL.map(l=>{const C=calcLote(l),e=l.ent;return [xc(l.nome),xc(C.fim?'Encerrado':'Ativo'),xc(curralEm(l,C.ate)),xc(sexoTxt(l.sexo)),xc(l.raca||''),xc(e.dia,'dia'),xc(C.fim||'','dia'),xc(C.dias,'int'),xc(C.cabE,'int'),xc(C.cabV,'int'),xc(C.mortes,'int'),
    xc(C.pesoE,'int'),xc(C.pesoV,'int'),xc(C.gmdV,'dec'),xc(l.gmd,'dec'),xc(C.msCab,'dec'),xc(C.pv/100,'pct'),xc(C.conv,'dec'),xc(C.compra,'rs'),xc(C.alim,'rs'),xc(C.op,'rs'),xc(C.outros,'rs'),xc(C.custo,'rs'),xc(C.receita,'rs'),xc(C.arrProd,'dec'),xc(C.custoArr,'rs'),xc(C.lucro,'rs'),xc(C.lucro/C.cabE,'rs')];});
  gExcel('Comparativo de lotes',[['Lotes',['Lote','Situação','Curral','Sexo','Raça','Entrada','Saída','Dias','Cab. entrada','Cab. vendidas','Mortes','Peso entrada','Peso saída','GMD real','GMD meta','MS/cab/dia','% PV','Conversão','Compra','Ração','Operacional','Sanidade/outros','Custo total','Receita','@ produzidas','Custo @ produzida','Lucro','Lucro/cab'],r]]);}
function xlsLote(id){const l=G.it[id],C=calcLote(l),X=gCtx(),r=[];
  for(let d=l.ent.dia,i=0;d<=C.ate&&i<4000;d=somaDias(d,1),i++){const x=diaLote(l,d,X);if(!x)continue;const lt=G.it[idLeit(d,x.c)];
    r.push([xc(d,'dia'),xc(x.c),xc(x.rac),xc(x.cab,'int'),xc(x.peso,'int'),xc(x.mn,'int'),xc(x.ms,'int'),xc(x.mnCab,'dec'),xc(x.msCab,'dec'),xc(x.pv/100,'pct'),xc(lt&&!lt.del?lt.nota:''),xc(x.custoR,'rs'),xc(x.custoOp,'rs')]);}
  const res=[...$('gBox').querySelectorAll('.gLinhas>div')].map(d=>[xc(d.children[0].textContent),xc(d.children[1].textContent)]);
  gExcel(`Lote ${l.nome}`,[['Resumo',['Item','Valor'],res,[36,40]],['Dia a dia',['Data','Curral','Ração','Cabeças','Peso proj.','MN (kg)','MS (kg)','MN/cab','MS/cab','% PV','Nota cocho','Custo ração','Custo operacional'],r,[11,10,14,9,10,10,10,9,9,8,9,13,13]]]);}

/* ---------- rações ---------- */
function tRacoes(){
  const hj=hojeKey(),R=gTodos('racao').sort(porNome);
  const cards=R.map(r=>{const cp=compRacao(r,hj);const usam=lotesAtivos().filter(l=>{const x=racaoEm(l,hj);return x&&x.uid===r.uid;}).length;
    return `<button class="gItem" data-g="ir" data-t="racForm" data-id="${r.uid}"><div class="gItemTopo"><b>${esc(r.nome)}</b><span class="pill">${usam?usam+' lote(s)':'sem lote'}</span></div>
      <div class="gItemInfo">${cp?`MS ${pc(cp.ms)} · ${rs(cp.custoMN,3)}/kg MN · ${rs(cp.custoMS,3)}/kg MS<br>${cp.itens.map(i=>`${esc(i.nome)} ${nf(i.pMS,1)}%`).join(' · ')}`:'sem fórmula'}</div></button>`;}).join('');
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
  return `<section class="panel"><h2>Insumos</h2>
    <div class="tablebox"><table><thead><tr><th>Insumo</th><th>MS</th><th>R$/t</th><th>R$/kg MS</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Nenhum insumo ainda.</td></tr>'}</tbody></table></div>
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
  if(!GT.notasEd)GT.notasEd=c.notas.slice().sort((a,b)=>a.n-b.n).map(x=>Object.assign({},x));
  return `<section class="panel"><h2>Custo operacional</h2><div class="gForm">${[
    {k:'taxa',l:'Taxa operacional',suf:'por cabeça por dia',t:'rs',v:tx?tx.rs:'',meia:1},{k:'tdesde',l:'Vale a partir de',t:'dia',v:tx?hj:'2000-01-01',meia:1}].map(campo).join('')}</div>
    ${(c.taxa||[]).length?`<p class="note">${c.taxa.map(x=>`Desde ${dB(x.desde)}: ${rs(+x.rs)}`).join(' · ')}</p>`:''}</section>
  <section class="panel"><h2>Notas da leitura de cocho</h2>
    <div class="gNotaCfg gNotaCab"><span>Nota</span><span>Descrição</span><span>Ajuste %</span><span></span></div>
    ${GT.notasEd.map((x,k)=>`<div class="gNotaCfg"><input class="cell num" inputmode="text" data-nn="${k}" value="${esc(vIn(x.n))}"><input type="text" data-nt="${k}" value="${esc(x.t)}"><input class="cell num" inputmode="text" data-np="${k}" value="${esc(vIn(x.p))}"><button class="mini danger" data-g="notaRm" data-i="${k}">✕</button></div>`).join('')}
    <div class="row"><button data-g="notaAdd">+ Adicionar nota</button><button data-g="notaPadrao">Voltar ao padrão (−5 a +5)</button></div>
    <p class="note">Nota positiva aumenta o trato, negativa diminui. O ajuste é em cima do realizado de ontem. Use o sinal de menos (−) para diminuir.</p></section>
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
  c.notas=ns.map(x=>({n:x.n,t:x.t||(x.p>0?'Aumentar':x.p<0?'Diminuir':'Manter'),p:x.p})).sort((a,b)=>a.n-b.n);c.notasV=2;
  const a=fn('arred'),rc=fn('rc'),pv=fn('pvIni');if(ok(a)&&a>=0)c.arred=a;if(rc>0)c.rc=rc;if(pv>0)c.pvIni=pv;
  gPut(c);GT.notasEd=null;toast('Configurações salvas');gRender();}

/* =====================================================================================
   EVENTOS
   ===================================================================================== */
const SO_VER=new Set(['voltar','ir','lote','raiz','compRel','compDia','xlsDia','xlsPer','xlsComp','xlsLote','perAtalho','nota','racAdd','racRm','notaAdd','notaRm','notaPadrao']);
$('gBox').addEventListener('click',e=>{
  const b=e.target.closest('[data-g]');if(!b)return;const a=b.dataset.g,id=b.dataset.id;
  if(!SO_VER.has(a)&&bloqueado())return;
  if(a==='voltar')return gVoltar();
  if(a==='ir'){const t={t:b.dataset.t,id,o:b.dataset.o,enc:b.dataset.enc==='1'};
    if(GT.t==='lotes'&&t.t==='lotes'){GT=t;return gRender();}return gIr(t);}
  if(a==='lote')return gIr({t:'lote',id});
  if(a==='raiz')return gRaiz(b.dataset.t);
  if(a==='salvaCusto'){const dia=fv('dia'),v=fn('rs');if(!dia||!(v>0))return toast('Coloque a data e o valor');
    gPut({uid:novoId('cus'),tipo:'custo',lote:id,dia,cat:fv('cat'),desc:fv('desc'),rs:v});toast('Custo lançado');return gVoltar();}
  if(a==='xlsDia')return xlsDia();
  if(a==='xlsPer')return xlsPer();
  if(a==='xlsComp')return xlsComp();
  if(a==='xlsLote')return xlsLote(id);
  if(a==='perAtalho'){const n=b.dataset.n,hj=hojeKey();if(n==='mes')return gRenderCom({ini:hj.slice(0,8)+'01',fim:hj});return gRenderCom({fim:hj,ini:somaDias(hj,-(+n-1))});}
  if(a==='notaAdd'){lerNotasEd();const mx=GT.notasEd.reduce((m,x)=>Math.max(m,ok(x.n)?x.n:0),0);GT.notasEd.push({n:mx+1,t:'Aumentar',p:(mx+1)*5});return gRender();}
  if(a==='notaRm'){lerNotasEd();GT.notasEd.splice(+b.dataset.i,1);return gRender();}
  if(a==='notaPadrao'){GT.notasEd=NOTAS_PADRAO.map(x=>Object.assign({},x));gRender();return toast('Notas −5 a +5 de volta. Toque em Salvar.');}
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
  if(t.classList.contains('gRs'))mascaraRs(t);
  if(GT.t==='racForm'&&(t.matches('[data-rp]')||t.id==='gVag'))calcRacao();
  if(GT.t==='rel'&&/^gf_s/.test(t.id))calcSimul();
});
$('gBox').addEventListener('change',e=>{
  const t=e.target;
  if(GT.t==='racForm'&&t.matches('[data-ri]'))calcRacao();
  if(t.id==='gCoDia'){GT.sel={};GT.dia=t.value||hojeKey();gRenderCom({dia:GT.dia});}
  if(t.id==='gDiaDia'){gRenderCom({dia:t.value||hojeKey()});}
  if(t.id==='gRefDia'){gRenderCom({dia:t.value||hojeKey()});}
  if(t.id==='gPerIni'||t.id==='gPerFim'){let a=$('gPerIni').value,b=$('gPerFim').value;if(a&&b&&a>b)[a,b]=[b,a];gRenderCom({ini:a,fim:b});}
  if(t.matches('input[data-kg]')){const c=t.dataset.kg;GT.sel=GT.sel||{};const lt=G.it[idLeit(GT.dia,c)];
    const n=GT.sel[c]?GT.sel[c].n:(lt&&!lt.del?lt.nota:null);if(n==null){toast('Marque a nota primeiro');t.value='';return;}GT.sel[c]={n,kg:gNum(t.value)};}
});
function gRenderCom(o){Object.assign(GT,o);gRender();}


/* ---------- menu: Gestão (Resumo, Lotes, Cocho, Relatórios, Rações, Insumos, Config.) ---------- */
$('tabGrpGest').addEventListener('click',()=>aba('gest'));
$('subGest').addEventListener('click',e=>{const b=e.target.closest('button[data-gt]');if(b)gRaiz(b.dataset.gt);});
window.gAoAbrir=()=>{gRender();if(navigator.onLine)gSync(true).catch(()=>{});};
/* nome do curral mudou no Previsto: o lote passa a usar o nome novo a partir de hoje */
window.gRenomearCurral=(de,para)=>{const hj=hojeKey();gTodos('lote').forEach(l=>{if(ativo(l)&&curralEm(l,hj)===de){const x=JSON.parse(JSON.stringify(l));setHist(x.curr,hj,{c:para});gPut(x);}});};

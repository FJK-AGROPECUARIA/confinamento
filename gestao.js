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
function gPut(x){ENT_C=null;APC=null;PM_C=null;const old=G.it[x.uid];x.ts=Math.max(Date.now(),old?(old.ts||0)+1:0);G.it[x.uid]=x;if(!G.pend.includes(x.uid))G.pend.push(x.uid);gSave();gAgendar();}
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
        if(mud){gSave();try{aplicarRenomesHist();limparPrevRenomes();}catch(e){}if(!$('viewGest').hidden&&!gEditando())gRenderManter();}
        recalcUmaVez();
      }
    }
  }finally{gSinc=false;if(typeof statusNuvem==='function')statusNuvem();}
}
/* uma vez em cada aparelho (depois de puxar os dados): refaz o custo guardado nas saídas de todos os lotes, ativos e arquivados,
   com a divisão do trato pelo peso vivo (v214) e as datas de entrada corrigidas. Só grava o que mudou. */
function recalcUmaVez(){try{if((typeof modoVer!=='undefined'&&modoVer)||localStorage.getItem('fjkRecalcPV2')==='1')return;const L=gTodos('lote');if(!L.length)return;
  let n=0;L.forEach(l=>{n+=recalcSaidas(l)||0;});localStorage.setItem('fjkRecalcPV2','1');if(n&&typeof toast==='function')toast(`Custos de ${n} saída(s) refeitos`);}catch(e){}}
const gEditando=()=>{const a=document.activeElement;return a&&$('gBox').contains(a)&&/INPUT|SELECT|TEXTAREA/.test(a.tagName);};
/* redesenho vindo da nuvem (sincronização): não pode apagar o que a pessoa digitou e ainda não salvou.
   Guarda os campos alterados (valor diferente do original) e coloca de volta depois de redesenhar. */
function gChaveCampo(el){if(el.id)return '#'+el.id;const d=Object.entries(el.dataset||{}).map(([k,v])=>k+'='+v).join('&');if(!d)return null;
  const irm=[...$('gBox').querySelectorAll(el.tagName)].filter(x=>Object.entries(x.dataset||{}).map(([k,v])=>k+'='+v).join('&')===d);return d+'#'+irm.indexOf(el);}
function gRenderManter(){const box=$('gBox'),guard=[];
  box.querySelectorAll('input,select,textarea').forEach(el=>{if(el.type==='checkbox'||el.type==='radio'||el.type==='file')return;const ori=el.tagName==='SELECT'?([...el.options].find(o=>o.defaultSelected)||{}).value:el.defaultValue;
    if(ori!==undefined&&el.value!==ori){const k=gChaveCampo(el);if(k)guard.push([k,el.value]);}});
  const y=window.scrollY;gRender();
  if(guard.length){guard.forEach(([k,v])=>{let el=null;if(k[0]==='#')el=document.getElementById(k.slice(1));else{const [d,i]=k.split('#');el=[...box.querySelectorAll('input,select,textarea')].filter(x=>Object.entries(x.dataset||{}).map(([a,b])=>a+'='+b).join('&')===d)[+i];}
    if(el&&el.value!==v){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));}});window.scrollTo({top:y});}}
setInterval(()=>{if(modoVer&&!$('viewGest').hidden&&navigator.onLine&&document.visibilityState==='visible')gSync(true).catch(()=>{});},20000);

/* ---------- configurações ---------- */
const PCT_PADRAO={0:0,1:3,2:6,3:10,4:15};
const NOTAS_PADRAO=[-4,-3,-2,-1,0,1,2,3,4].map(n=>({n,t:n>0?'Aumentar':n<0?'Diminuir':'Manter',p:Math.sign(n)*PCT_PADRAO[Math.abs(n)]}));
const NOTAS_VER=3;
function gCfg(){const c=G.it.config&&!G.it.config.del?G.it.config:{uid:'config',tipo:'config'};
  if(!Array.isArray(c.taxa))c.taxa=[];if(!Array.isArray(c.notas)||!c.notas.length||c.notasV!==NOTAS_VER)c.notas=NOTAS_PADRAO.map(x=>Object.assign({},x));
  if(!Array.isArray(c.racas)||!c.racas.length)c.racas=RACAS_PADRAO.slice();if(!Array.isArray(c.sexos)||!c.sexos.length)c.sexos=SEXOS_PADRAO.map(x=>Object.assign({},x));if(!Array.isArray(c.cats)||!c.cats.length)c.cats=CATS_PADRAO.slice();else c.cats=[...new Set(c.cats.map(x=>CAT_PLURAL[x]||x))];if(!ok(c.arred))c.arred=10;if(!ok(c.pvIni))c.pvIni=2.2;if(!ok(c.rc))c.rc=52;return c;}
const taxaEm=dia=>{const v=vig(gCfg().taxa,dia);return v?+v.rs||0:0;};

/* ---------- insumos e rações ---------- */
/* preço do insumo (R$ por tonelada, matéria natural): o preço médio do estoque (automático pelas entradas com valor);
   antes da primeira entrada com valor, vale o preço manual do cadastro */
const precoIns=(ins,dia)=>{const H=precoMedioHist(ins.uid);if(H.length&&H[0].desde<=dia){const v=vig(H,dia);if(v)return +v.rs;}const v=vig(ins.precos,dia);return v?+v.rs:NaN;};
/* preço médio ponderado (qualquer entrada com valor, manual ou NF): estoque zerado → preço da entrada; com estoque → média ponderada */
var PM_C=null,PM_T=0;
function precoMedioHist(insId){if(!PM_C||Date.now()-PM_T>2000){PM_C={};PM_T=Date.now();}if(PM_C[insId])return PM_C[insId];
  const M=movsEstoque(insId),H=[];let C=NaN,ant=0;
  M.forEach(m=>{const q=Math.max(0,ant);if(m.mov==='ent'&&m.rs>0&&m.kg>0){const Cant=C;C=q>0&&ok(C)?(q*C+m.rs)/(q+m.kg):m.rs/m.kg;
    const r={desde:m.dia,rs:Math.round(C*1000*100)/100,q,kg:m.kg,nota:m.rs,pNota:Math.round(m.rs/m.kg*1000*100)/100,ant:ok(Cant)&&q>0?Math.round(Cant*1000*100)/100:NaN,obs:m.obs||''};
    if(H.length&&H[H.length-1].desde===m.dia)H[H.length-1]=Object.assign(r,{varias:true});else H.push(r);}ant=m.saldo;});
  return PM_C[insId]=H;}
window.precoMedioHist=precoMedioHist;
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
/* + Entrada de animais no mesmo lote (tipo 'entlote'): soma cabeças a partir da data e mistura o peso (média ponderada) */
/* agrupado por lote e guardado (é chamado muitas vezes por dia nos relatórios); refaz ao gravar algo ou a cada 1 s */
var ENT_C=null,ENT_T=0;
function entradasDe(l){if(!ENT_C||Date.now()-ENT_T>1000){ENT_C={};gTodos('entlote').forEach(x=>{(ENT_C[x.lote]=ENT_C[x.lote]||[]).push(x);});Object.values(ENT_C).forEach(a=>a.sort(porDia));ENT_T=Date.now();}return ENT_C[l.uid]||[];}
function cabPres(l,dia,sd){if(!l.ent||dia<l.ent.dia)return 0;let c=+l.ent.cab||0;entradasDe(l).forEach(x=>{if(x.dia<=dia)c+=+x.cab||0;});(sd||saidasDe(l)).forEach(s=>{if(s.dia<dia||(s.mot!=='morte'&&s.dia===dia))c-=+s.cab||0;});  /* venda/sobra: no dia lançado já não conta (sai cedo, sem consumo); o consumo vai até o dia anterior */return Math.max(0,c);}
function cabEm(l,dia,sd){if(!l.ent||dia<l.ent.dia)return 0;let c=+l.ent.cab||0;entradasDe(l).forEach(x=>{if(x.dia<=dia)c+=+x.cab||0;});(sd||saidasDe(l)).forEach(s=>{if(s.dia<=dia)c-=+s.cab||0;});return Math.max(0,c);}
/* cabeças totais que entraram no lote (entrada inicial + entradas depois) e peso médio de entrada de todas */
const cabEntTot=l=>(+l.ent.cab||0)+entradasDe(l).reduce((a,x)=>a+(+x.cab||0),0);
function pesoEntMed(l){const E=entradasDe(l),p0=+(l.ent.pesoE||l.ent.peso);if(!E.length)return p0;const c0=+l.ent.cab||0;let k=c0,t=c0*(p0||0);E.forEach(x=>{k+=+x.cab||0;t+=(+x.cab||0)*(+(x.pesoE||x.peso)||0);});return k?t/k:p0;}   /* transferência a custo: vale o peso de entrada original (pesoE) */
const cabAtual=l=>cabEm(l,hojeKey());
const curralEm=(l,dia)=>{const v=vig(l.curr,dia);return v?(typeof nomeAtual==='function'?nomeAtual(v.c):v.c):'';}; // sempre o nome ATUAL (curral renomeado)
const racaoEm=(l,dia)=>{const v=vig(l.rac,dia);const r=v&&G.it[v.r];return r&&!r.del?r:null;};
function pesoEm(l,dia,pz){if(!l.ent)return NaN;let b={dia:l.ent.dia,peso:+l.ent.peso};(pz||pesagensDe(l)).forEach(p=>{if(p.dia<=dia)b=p;});
  const g=+l.gmd||0,E=entradasDe(l).filter(x=>x.dia>b.dia&&x.dia<=dia);
  /* entrou mais animal depois da última referência: o peso médio do lote naquele dia vira a média ponderada (os de antes × os que chegaram) */
  if(E.length){const sd=saidasDe(l);let ref={dia:b.dia,peso:+b.peso};E.forEach(x=>{const antes=cabEm(l,somaDias(x.dia,-1),sd)+entradasDe(l).filter(y=>y.dia===x.dia&&y!==x&&y.uid<x.uid).reduce((a,y)=>a+(+y.cab||0),0);
      const pA=+ref.peso+g*difDias(ref.dia,x.dia),cN=+x.cab||0;ref={dia:x.dia,peso:antes+cN>0?(antes*pA+cN*(+x.peso||pA))/(antes+cN):pA};});b=ref;}
  return +b.peso+g*difDias(b.dia,dia);}
const fimLote=l=>{if(cabAtual(l)>0)return null;const sd=saidasDe(l);return sd.length?sd[sd.length-1].dia:null;};
const ativo=l=>cabAtual(l)>0||(l.ent&&l.ent.dia>hojeKey());
const lotesAtivos=()=>gTodos('lote').filter(ativo).sort(porNome);
/* ---------- apartação: lote dividido em lotes novos; cada um leva os custos proporcionais ao PESO (cab × peso médio na pesagem da apartação) ---------- */
var APC=null,APT=0;
function partesApart(o){return saidasDe(o).filter(x=>x.mot==='apart');}
function custoHerdado(l,prof){if(!l.apDe)return 0;if(!APC||Date.now()-APT>1500){APC={};APT=Date.now();}if(APC[l.uid]!=null)return APC[l.uid];
  const o=G.it[l.apDe];if(!o||o.del||(prof||0)>8)return 0;const ps=partesApart(o),kgT=ps.reduce((a,x)=>a+(+x.cab||0)*(+x.peso||0),0),me=ps.find(x=>x.destino===l.uid);
  const Co=me&&kgT?calcLote(o):null,cv=Co?Co.vendas.reduce((a,s)=>a+(s.cst?custoSai(s):0),0):0;   /* vendidos antes da apartação já levaram o custo deles */
  const v=Co?(Co.custo-cv)*(+me.cab||0)*(+me.peso||0)/kgT:0;APC[l.uid]=v;return v;}
const rotCompra=l=>l&&l.apDe?'Custo trazido da apartação':'Compra dos animais';
/* linhas de custo separando compra e custo trazido (transferência/apartação) */
function linhasCompra(l,C){const pura=C.compra-C.trazido,nv=l.apDe||(l.ent&&l.ent.unid==='transf'),L=[];if(Math.abs(pura)>0.005||!C.trazido)L.push([(nv?'Compra (entradas)':'Compra dos animais')+(C.cmpAlt?' · pela @ vendida':''),pura]);const tz=C.trazido-(C.trazVI||0);if(Math.abs(tz)>0.005)L.push([l.apDe?'Custo trazido da apartação':'Custo trazido (transferências)',tz]);if(C.trazVI)L.push(['Compra de outros lotes (venda interna)',C.trazVI]);return L;}
const notaTransf=C=>[C.cabT?`${nf(C.cabT)} cab transferidos para outros lotes levaram ${rs(C.trOut)} de custo (já descontado).`:'',C.cabTV?`Venda interna: ${nf(C.cabTV)} cab vendidos para outros lotes por ${rs(C.recInt)} · resultado ${rs(C.resInt)} (entra no lucro deste lote).`:'',C.faltas&&C.fOut?`${nf(C.faltas)} cab sumidos (faltaram) levaram ${rs(C.fOut)} de custo: fica separado e não entra no resultado; se forem achados, o custo vai para o lote onde entrarem.`:''].filter(Boolean).join(' ');
const ehVenda=s=>s.mot!=='morte'&&s.mot!=='apart'&&s.mot!=='transf'&&s.mot!=='falta';
/* preço de compra de SIMULAÇÃO do lote (Estimativa de compra): usado também para os animais que chegam por transferência a custo */
function precoSim(l){const e=l.ent||{};if(e.unid==='transf'){const arr=(+e.cab||0)*(+e.peso||0)*(+e.rcC||50)/100/15;return {unid:'arroba',preco:arr>0?(+e.preco||0)/arr:0,rc:+e.rcC||50};}return {unid:e.unid||'arroba',preco:+e.preco||0,rc:+e.rcC||50};}
const compraSim=(P,cab,peso)=>P.unid==='cab'?cab*P.preco:P.unid==='kg'?cab*peso*P.preco:P.unid==='arrV'?cab*peso/30*P.preco:cab*peso*P.rc/100/15*P.preco;
/* entradas depois da 1ª: compra/venda interna = valor digitado (rs); transferência a custo = custo dos tratos que trouxeram (rs) + compra pela simulação do lote sobre o peso de entrada original */
const entCompra=l=>{const P=precoSim(l);return entradasDe(l).reduce((a,x)=>a+(+x.rs||0)+(x.tc?compraSim(P,+x.cab||0,+(x.pesoE||x.peso)||0):0),0);};
function valorCompra(l){if(l.ent&&l.ent.unid==='transf')return (+l.ent.preco||0)+entCompra(l);if(l.apDe)return custoHerdado(l)+entCompra(l);const e=l.ent||{};const cab=+e.cab||0,peso=+(e.pesoC||e.pesoE||e.peso)||0,p=+e.preco||0;
  const rc=+e.rcC||50,v=e.unid==='cab'?cab*p:e.unid==='kg'?cab*peso*p:e.unid==='arrV'?cab*peso/30*p:cab*peso*rc/100/15*p;return v+(+e.outros||0)+(+e.trz||0)+entCompra(l);}
const arrobaVenda=s=>(+s.cab||0)*(+s.peso||0)*((+s.rc||0)/100)/15;
function valorVenda(s){if(+s.vTot>0)return +s.vTot-(+s.desc||0);  /* valor total da venda digitado/calculado: vale ele */
  const cab=+s.cab||0,peso=+s.peso||0,p=+s.preco||0;
  const v=s.unid==='cab'?cab*p:s.unid==='kg'?cab*peso*p:s.unid==='arrV'?cab*peso/30*p:arrobaVenda(s)*p;return v-(+s.desc||0);}
/* ---------- cada saída (venda, transferência, sobra) guarda a compra real, os custos embutidos e o valor: resultado daqueles animais ---------- */
const crDe=s=>s.cst?(+s.cr>0?+s.cr:+s.cst.compra||0):NaN;   // compra real digitada (ou a prevista, proporcional)
const custoSai=s=>s.cst?crDe(s)+(+s.cst.alim||0)+(+s.cst.op||0)+(+s.cst.outros||0):NaN;
const valorSai=s=>s.mot==='transf'?(+s.vi||0):valorVenda(s);
const resSai=s=>s.cst&&(ehVenda(s)||(s.mot==='transf'&&+s.vi>0))?valorSai(s)-custoSai(s):NaN;   /* faltaram/morte não têm resultado próprio */
const viCalc=(cab,peso,pr,rc,unid)=>cab>0&&peso>0&&pr>0?valorVenda({cab,peso,rc:rc>0&&rc<100?rc:50,unid:unid||'arroba',preco:pr}):NaN;   // venda interna: igual à venda (@ abatida, @ viva, cabeça ou kg)

/* ---------- consumo e custo por dia (a partir do realizado do trato) ---------- */
const nAt=c=>typeof nomeAtual==='function'?nomeAtual(c):c;  // curral renomeado: registros e lotes se encontram pelo nome atual
function gIndice(){const m=new Map();(HIST||[]).forEach(r=>{const k=r.dia+'|'+nAt(r.curral);m.set(k,(m.get(k)||0)+(+r.forn||0));});return m;}
function gCtx(){const L=gTodos('lote');const sd=new Map(),pz=new Map();L.forEach(l=>{sd.set(l.uid,saidasDe(l));pz.set(l.uid,pesagensDe(l));});return {ix:gIndice(),L,sd,pz};}
function diaLote(l,dia,X){
  const sd=X.sd.get(l.uid),cab=cabPres(l,dia,sd);if(!cab)return null;
  const c=curralEm(l,dia),tot=X.ix.get(dia+'|'+nAt(c))||0;
  const juntos=X.L.filter(o=>curralEm(o,dia)===c&&cabPres(o,dia,X.sd.get(o.uid))>0);
  /* dois ou mais lotes no mesmo curral: o trato do dia é dividido pelo PESO VIVO projetado de cada lote (cabeças × peso projetado no dia);
     sem peso, cai para a divisão pelas cabeças */
  const peso=pesoEm(l,dia,X.pz.get(l.uid)),pvL=o=>{const c2=cabPres(o,dia,X.sd.get(o.uid)),p2=o===l?peso:pesoEm(o,dia,X.pz.get(o.uid));return c2*(p2>0?p2:NaN);};
  let sh=1;if(juntos.length>1){const pvs=juntos.map(pvL);if(pvs.every(v=>v>0)){const t=pvs.reduce((a,v)=>a+v,0);sh=pvL(l)/t;}
    else{const cabTot=juntos.reduce((a,o)=>a+cabPres(o,dia,X.sd.get(o.uid)),0)||cab;sh=cab/cabTot;}}
  const mn=tot*sh,rac=racaoEm(l,dia),cp=rac?compRacao(rac,dia):null;
  const ms=cp?mn*cp.ms/100:NaN,cabOp=cabEm(l,dia,sd);
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
  if(f.t==='sel')inp=`<select id="${id}"${f.busca?' data-busca':''}>${f.op.map(([a,b])=>`<option value="${esc(a)}"${String(a)===String(v)?' selected':''}>${esc(b)}</option>`).join('')}</select>`;
  else if(f.t==='dia')inp=`<label class="gDataBox gDiaCampo"><span class="${v?'':'vazio'}">${v?dB(v):'Escolher'}</span><input type="date" id="${id}" value="${esc(v)}"></label>`;   /* data sempre dd/mm/aaaa (o celular mostrava 28 de out. de 2026) */
  else if(f.t==='rs')inp=`<input type="text" inputmode="numeric" class="gRs" id="${id}" value="${esc(rsIn(f.v===''||f.v==null?NaN:+f.v))}" placeholder="R$ 0,00" autocomplete="off">`;
  else if(f.t==='num')inp=`<input type="text" inputmode="decimal" id="${id}" value="${esc(v===''?'':vIn(v))}" placeholder="${esc(f.ph||'')}" autocomplete="off">`;
  else inp=`<input type="text" id="${id}" value="${esc(v)}" placeholder="${esc(f.ph||(f.sug==='forn'?'Digite ou escolha um fornecedor':''))}" autocomplete="off"${f.lista?` list="${f.lista}"`:''}${f.sug?` data-sug="${f.sug}"`:''}>${f.sug?'<div class="gSug" hidden></div>':''}`;
  return `<div class="gCampo${f.meia&&f.t!=='dia'?' meia':''}"><label for="${id}">${esc(f.l)}${f.suf?` <span class="gSuf">(${esc(f.suf)})</span>`:''}</label>${inp}${f.ajuda?`<p class="note">${f.ajuda}</p>`:''}</div>`;}
/* fornecedores: todos os nomes já usados nas entradas do estoque (já ficam cadastrados sozinhos); ao digitar, filtra embaixo */
const fSem=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
/* entrada: fornecedor e número da NF ficam separados (as antigas guardavam "NOME · NF 123" junto na observação) */
const NF_RE=/^(.*?)\s*[·\-–|]?\s*\bNF[\s:.ºo°#-]*(\d[\w./-]*)\s*$/i;
function entForn(m){const o=String((m&&m.obs)||'').trim(),x=NF_RE.exec(o);return x?x[1].replace(/[\s·\-–|]+$/,'').trim():o;}
function entNota(m){if(m&&m.nota)return String(m.nota);const x=NF_RE.exec(String((m&&m.obs)||'').trim());return x?x[2]:((m&&m.nf&&m.nf.num)||'');}
const entTxt=m=>[entForn(m),entNota(m)?'NF '+entNota(m):''].filter(Boolean).join(' · ');
function fornecedores(){const m=new Map();
  gTodos('fornecedor').forEach(f=>{const n=String(f.nome||'').trim();if(n)m.set(fSem(n),n);});
  gTodos('estmov').filter(x=>x.mov==='ent'&&x.obs).sort((a,b)=>(b.dia||'').localeCompare(a.dia||'')).forEach(x=>{const n=entForn(x),k=fSem(n);if(n&&!m.has(k))m.set(k,n);});
  return [...m.values()].sort((a,b)=>a.localeCompare(b,'pt'));}
window.entForn=entForn;window.entNota=entNota;
window.fornecedores=fornecedores;
function sugMostrar(inp){const box=inp.parentNode.querySelector('.gSug');if(!box)return;const tp=inp.dataset.sug,q=fSem(inp.value);
  const base=tp==='prodF'?gTodos('insumo').sort(porNome).map(i=>i.nome):fornecedores(),filtro=tp==='prodF'||tp==='fornF';
  const L=base.filter(n=>!q||fSem(n).includes(q)),igual=L.length===1&&fSem(L[0])===q;
  if(!filtro&&(!L.length||igual)){box.hidden=true;box.innerHTML='';return;}
  const todos=filtro?`<button type="button" data-sugv="" class="gSugTodos">${tp==='prodF'?'Todos os produtos':'Todos os fornecedores'}</button>`:'';
  box.innerHTML=(filtro?'':`<small>${q?'Já cadastrados com esse nome':'Fornecedores já cadastrados'} · toque para escolher</small>`)+todos+L.slice(0,filtro?30:8).map(n=>`<button type="button" data-sugv="${esc(n)}">${esc(n)}</button>`).join('')
    +(!L.length&&filtro?'<small>Nenhum com esse nome</small>':'')+(L.length>(filtro?30:8)?`<small>+${L.length-(filtro?30:8)}: continue digitando para filtrar</small>`:'');box.hidden=false;}
document.addEventListener('input',e=>{if(e.target.matches&&e.target.matches('input[data-sug]'))sugMostrar(e.target);});
document.addEventListener('focusin',e=>{if(e.target.matches&&e.target.matches('input[data-sug]'))sugMostrar(e.target);});
document.addEventListener('focusout',e=>{if(e.target.matches&&e.target.matches('input[data-sug]')){const box=e.target.parentNode.querySelector('.gSug');setTimeout(()=>{if(box&&!box.contains(document.activeElement))box.hidden=true;},200);}});
document.addEventListener('pointerdown',e=>{if(e.target.closest('.gSug'))e.preventDefault();},true);
document.addEventListener('click',e=>{const b=e.target.closest('.gSug [data-sugv]');if(!b)return;e.stopPropagation();const box=b.closest('.gSug'),inp=box.parentNode.querySelector('input[data-sug]');inp.value=b.dataset.sugv;box.hidden=true;inp.dispatchEvent(new Event('change',{bubbles:true}));},true);
const fv=k=>{const e=$('gf_'+k);return e?e.value.trim():'';};
const fn=k=>gNum(fv(k));
const opCurrais=(atual,inat)=>(S.cadastro||[]).filter(n=>inat||n===atual||!window.curraisApi||!curraisApi.info(n).inativo).slice().sort((a,b)=>alfa(a,b)).map(n=>[n,n+(inat&&window.curraisApi&&curraisApi.info(n).inativo?' (inativo)':'')]);
const racAtivas=()=>gTodos('racao').filter(r=>!r.inativa);
const opRacoes=atual=>[['','Selecione']].concat(gTodos('racao').filter(r=>!r.inativa||r.uid===atual).sort(porNome).map(r=>[r.uid,r.nome+(r.inativa?' (inativa)':'')]));
const opInsumos=()=>gTodos('insumo').sort(porNome).map(r=>[r.uid,r.nome+(r.inativo?' (inativo)':'')]);
const UNID_C=[['arroba','R$/@ morto'],['arrV','R$/@ vivo'],['cab','R$/cabeça'],['kg','R$/kg vivo']];
const UNID_V=[['arroba','R$/@ morto'],['arrV','R$/@ vivo'],['cab','R$/cabeça'],['kg','R$/kg vivo']];

const RAIZ={home:'home',entradas:'entradas',saidas:'saidas',estoque:'estoque',estIns:'estoque',estForm:'estoque',estNF:'estoque',fornec:'estoque',fornForm:'estoque',entRel:'estoque',currais:'currais',curForm:'currais',lotes:'lotes',pesNova:'lotes',entNova:'entradas',saiSel:'saidas',lote:'lotes',loteForm:'lotes',pesForm:'lotes',entForm:'lotes',apartForm:'lotes',transfForm:'lotes',fechaForm:'lotes',achouForm:'lotes',saiForm:'lotes',mudForm:'lotes',rel:'lotes',custoForm:'lotes',
  cocho:'cocho',cochoGraf:'cocho',fezes:'cocho',med:'cocho',rels:'rels',dia:'rels',indices:'rels',confBal:'rels',periodo:'rels',comp:'rels',vendas:'rels',compradores:'rels',cprForm:'rels',racoes:'racoes',racForm:'racoes',racCur:'racoes',mudCur:'currais',insumos:'estoque',insForm:'estoque',insMS:'insumos',ms:'cocho',cfg:'cfg'};
/* Leitura de cocho fica no menu Tratos (aba 'leit'); o resto da Gestão na aba 'gest' — as duas usam a mesma tela */
function gRaiz(t){GT={t};gPilha.length=0;const alvo=RAIZ[t]==='cocho'&&!document.body.classList.contains('modoGest')?'leit':'gest';if(window.abaAtual!==alvo)aba(alvo);else gRender();window.scrollTo({top:0});}
window.gAbrir=modo=>{const leit=RAIZ[GT.t]==='cocho';if(modo==='leit'&&!leit)GT={t:'cocho'};if(modo==='gest'&&leit&&!document.body.classList.contains('modoGest'))GT={t:'home'};gRender();if(navigator.onLine)gSync(true).catch(()=>{});};
function gRender(){if(GT&&GT.t!=='rel')RELCMP=null;
  const b=$('gBox');if(!b)return;
  if(window.abaAtual==='gest'&&RAIZ[GT.t]==='cocho'&&!document.body.classList.contains('modoGest')){aba('leit');return;}  // leitura abre no menu Tratos
  if(window.abaAtual==='leit'&&RAIZ[GT.t]!=='cocho'){aba('gest');return;}
  const f={home:tHome,estoque:tEstoque,estIns:tEstIns,estForm:tEstForm,estNF:tEstNF,fornec:tFornec,fornForm:tFornForm,entRel:tEntRel,currais:tCurrais,curForm:tCurForm,lotes:tLotes,pesNova:tPesNova,entNova:tEntNova,saiSel:tSaiSel,entradas:tEntradas,saidas:tSaidas,lote:tLote,loteForm:tLoteForm,pesForm:tPesForm,entForm:tEntForm,apartForm:tApartForm,transfForm:tTransfForm,fechaForm:tFechaForm,achouForm:tAchouForm,saiForm:tSaiForm,mudForm:tMudForm,rel:tRelLote,custoForm:tCustoForm,
    cocho:tCocho,cochoGraf:tCochoGraf,fezes:t=>tFezes(t),med:t=>tMed(t),rels:tRels,dia:tDia,indices:tIndices,periodo:tPeriodo,comp:tComp,vendas:tVendas,compradores:tCompradores,cprForm:tCprForm,racoes:tRacoes,racForm:tRacForm,racCur:tRacCur,mudCur:tMudCur,mudEd:tMudEd,insumos:tInsumos,insForm:tInsForm,insMS:tInsMS,ms:tInsMS,cfg:tCfg}[GT.t]||tHome;
  const raiz=GT.raiz||RAIZ[GT.t]||'home';document.querySelectorAll('#subGest button[data-gt]').forEach(x=>x.setAttribute('aria-selected',String(x.dataset.gt===raiz)));
  const cb=$('cfgTBox');if(cb&&$('cfgTParque')&&cb.parentNode!==$('cfgTParque'))$('cfgTParque').appendChild(cb); // ajustes da balança: guarda antes de redesenhar
  b.innerHTML=GT.nova&&GT.t!=='saiSel'?saiTopo(GT)+f(GT).replace(/<button class="gVoltar"[^>]*>[^<]*<\/button>/,''):f(GT);
  try{const fz=GT.t==='fezes',ms=GT.t==='ms',lt=window.abaAtual==='leit';if($('tabMed'))$('tabMed').setAttribute('aria-selected',String(GT.t==='med'&&lt));if($('tabFez'))$('tabFez').setAttribute('aria-selected',String(fz&&lt));if($('tabMS'))$('tabMS').setAttribute('aria-selected',String(ms&&lt));if($('tabLeit')&&lt)$('tabLeit').setAttribute('aria-selected',String(!fz&&!ms&&GT.t!=='med'));}catch(e){}
  if(GT.t==='cfg'&&cb&&$('cfgBalHost')){$('cfgBalHost').appendChild(cb);if(window.cfgTAoAbrir)cfgTAoAbrir();}
  if(GT.t==='cfg'&&GT.cfgSel!=='confbal')cfgMinimizar();   // Conf. balança: a lista de relatórios já aparece aberta
  if(GT.t==='racForm')calcRacao();
  if(GT.t==='rel')calcSimul();
  if(GT.t==='pesForm')calcPes();
  if(GT.t==='apartForm')apPrevia();
  if(GT.t==='transfForm')trPrevia();
  if(GT.t==='fechaForm')fcPrevia();
  if(GT.t==='saiForm'&&GT.o!=='morte')vdPrevia();
  if(GT.t==='loteForm'||(GT.t==='entNova'&&GT.sel==='__novo'))lfCalc();
  requestAnimationFrame(caberSelos);requestAnimationFrame(alinharCampos);
}
/* campos lado a lado: o título mais curto ganha a mesma altura do vizinho, assim as caixas de escrever ficam alinhadas */
function alinharCampos(){try{document.querySelectorAll('#gBox .gForm').forEach(f=>{const L=[...f.children].filter(c=>c.classList&&c.classList.contains('gCampo')&&c.classList.contains('meia')&&c.offsetParent);
  L.forEach(c=>{const l=c.querySelector(':scope>label');if(l)l.style.minHeight='';});
  const rows={};L.forEach(c=>{const k=Math.round(c.offsetTop);(rows[k]=rows[k]||[]).push(c);});
  Object.values(rows).forEach(r=>{if(r.length<2)return;const ls=r.map(c=>c.querySelector(':scope>label')).filter(Boolean),h=Math.max(...ls.map(l=>l.offsetHeight));ls.forEach(l=>{if(l.offsetHeight<h){l.style.minHeight=h+'px';l.style.display='flex';l.style.alignItems='flex-end';}});});});}catch(e){}}
window.addEventListener('resize',()=>requestAnimationFrame(alinharCampos));
document.addEventListener('change',e=>{if(e.target.closest&&e.target.closest('#gBox'))setTimeout(()=>requestAnimationFrame(alinharCampos),30);},true);
/* nome do curral/pasto no quadro verde: o maior que couber */
function caberSelos(){document.querySelectorAll('#gBox .gLoteV .gSelo b').forEach(b=>{if(!b.offsetParent||b.parentNode.clientWidth<30)return;  /* tela escondida (menu aberto): não mede agora, mede quando aparecer */
  b.style.fontSize='';let f=parseFloat(getComputedStyle(b).fontSize),w=b.parentNode.clientWidth-12;
  for(let i=0;i<30&&b.scrollWidth>w&&f>11;i++){f-=1;b.style.fontSize=f+'px';}});}
window.addEventListener('resize',()=>requestAnimationFrame(caberSelos));
try{const gb=document.getElementById('gBox');if(gb&&window.ResizeObserver)new ResizeObserver(()=>requestAnimationFrame(caberSelos)).observe(gb);}catch(e){}  // a tela apareceu (fechou o menu): acerta o tamanho do nome

/* Config. (todas as abas): cada quadro aparece só com o título (minimizado); tocar no título abre e fecha */
const gMinAb=new Set();
function cfgMinimizar(){document.querySelectorAll('#gBox section.panel').forEach(sec=>{const cab=sec.querySelector(':scope>.curhead')||sec.querySelector(':scope>h2');if(!cab)return;
  const k=(cab.querySelector('h2')||cab).textContent.trim();sec.classList.add('gMinz');sec.dataset.minK=k;cab.classList.add('gMinzCab');sec.classList.toggle('aberto',gMinAb.has(k));});}
document.addEventListener('click',e=>{const c=e.target.closest('#gBox .gMinz>.gMinzCab');if(!c)return;const sec=c.parentNode,k=sec.dataset.minK;
  gMinAb.has(k)?gMinAb.delete(k):gMinAb.add(k);sec.classList.toggle('aberto',gMinAb.has(k));const d=c.querySelector('.gGrpDica');if(d)d.textContent=gMinAb.has(k)?'clique para fechar':'clique para abrir';});
const SEN_TIPOS=[['trato','🚜 Senha dos Tratos','entrar nos Tratos (Leitura, Previsto, Carregar, Fornecer, Automação)'],['ver','👁 Senha do Visualizar','entrar no Visualizar'],['rel','📤 Senha dos Relatórios do dia','enviar os Relatórios do dia da tela inicial'],['gest','📊 Senha da Gestão / Configurações','entrar na Gestão e nas Configurações'],['acao','✏️ Senha de edição e exclusão','editar e apagar registros, carregamentos e cadastros, e restaurar cópia']];
function senhaGrava(k,v){const c=JSON.parse(JSON.stringify(gCfg())),s={trato:senhaDe('trato'),ver:senhaDe('ver'),rel:senhaDe('rel'),gest:senhaDe('gest'),acao:senhaDe('acao')};s[k]=v;c.senhas=s;gPut(c);}
let gLoc='T',gLotCur=''; // filtro dos lotes: T todos, C confinamento, P pasto; curral ('' = todos)
const gLotAb=new Set(),gCurAb=new Set(); // lotes abertos (vários ao mesmo tempo) e grupos de currais abertos
/* barra de data com setas: ◀ dia anterior | data | dia seguinte ▶ */
const SEM=['dom.','seg.','ter.','qua.','qui.','sex.','sáb.'];
function navData(id,dia,rot){const hj=hojeKey(),[y,m,d]=dia.split('-').map(Number),sem=SEM[new Date(y,m-1,d).getDay()];
  const tag=dia===hj?'Hoje':dia===somaDias(hj,-1)?'Ontem':'';
  return `<div class="gCampo"><div class="hNavUm hNavB"><span class="hNavLbl">${rot||'Data'}</span><div class="gNavData">
    <button class="gSeta" data-g="dataPasso" data-alvo="${id}" data-n="-1" aria-label="Dia anterior">◀</button>
    <label class="gDataBox"><span>${sem} ${dB(dia).slice(0,6)+dB(dia).slice(8)}${tag?` <i>${tag}</i>`:''}</span><input type="date" id="${id}" value="${dia}"></label>
    <button class="gSeta" data-g="dataPasso" data-alvo="${id}" data-n="1" aria-label="Dia seguinte">▶</button></div></div>
    ${dia!==hj?`<button class="mini gHoje" data-g="dataHoje" data-alvo="${id}">Voltar para hoje</button>`:''}</div>`;}
/* ---------- custos extras do lote (sanidade, medicamento, mão de obra…) ---------- */
const custosDe=l=>gTodos('custo').filter(c=>c.lote===l.uid).sort(porDia);
const TIPOS_CUSTO=['Sanidade / vacina','Medicamento','Mão de obra','Frete','Outros'];
const SEXOS=[['','Selecione'],['M','Macho'],['F','Fêmea']];
const CATS_PADRAO=['Bezerros machos','Garrotes','Bois','Bezerras fêmeas','Novilhas','Vacas'];
const CAT_PLURAL={'Bezerro':'Bezerros machos','Bezerro macho':'Bezerros machos','Bezerros macho':'Bezerros machos','Garrote':'Garrotes','Boi':'Bois','Bezerra':'Bezerras fêmeas','Bezerra fêmea':'Bezerras fêmeas','Bezerras fêmea':'Bezerras fêmeas','Novilha':'Novilhas','Vaca':'Vacas','Touro':'Touros'};
const catNorm=c=>CAT_PLURAL[c]||(c||'');
const opCats=atual=>[['','Selecione']].concat(gCfg().cats.map(c=>[c,c])).concat(atual&&!gCfg().cats.includes(atual)?[[atual,atual]]:[]);
const SISTEMAS=[['Confinamento','🏠 Confinamento'],['Pasto com suplementação','🌿 Pasto']];
const tipoDoSistema=v=>v==='Pasto com suplementação'?'P':'C';
const opCurraisTipo=(tipo,atual)=>[['','Selecione']].concat(opCurrais(atual).filter(([n])=>n===atual||!window.curraisApi||curraisApi.info(n).tipo===tipo));
const RACAS_PADRAO=['Angus','Cruzado','Nelore'];
/* sexo: só Macho e Fêmea (lotes antigos com macho inteiro/castrado aparecem como Macho) */
/* sexos: cadastro em Configurações › Animais (Macho e Fêmea já vêm). Código fica no lote (M, F ou o nome de um sexo novo); mudar o nome não mexe nos lotes */
const SEXOS_PADRAO=[{c:'M',n:'Macho'},{c:'F',n:'Fêmea'}];
const sexosCad=()=>{try{const L=gCfg().sexos;return Array.isArray(L)&&L.length?L:SEXOS_PADRAO;}catch(e){return SEXOS_PADRAO;}};
const sexoNorm=v=>/^M[IC]?$/.test(v||'')?'M':v==='F'?'F':(v&&sexosCad().some(x=>x.c===v)?v:(v||''));
const sexoTxt=v=>{const c=sexoNorm(v);if(!c)return '';const x=sexosCad().find(z=>z.c===c)||SEXOS_PADRAO.find(z=>z.c===c);return x?x.n:c;};
const opSexos=cur=>{const L=sexosCad().slice(),c=sexoNorm(cur);if(c&&!L.some(x=>x.c===c))L.push({c,n:sexoTxt(c)});return [['','Selecione']].concat(L.map(x=>[x.c,x.n]));};

/* cálculo completo de um lote (usado no relatório do lote e no comparativo) */
/* venda estimada: animais que estão no lote × peso projetado × rendimento × preço da @ guardado na simulação (+ vendas já feitas). Arquivado: venda real. */
/* estimativa de venda detalhada (lote ativo): animais no lote × peso projetado × rendimento ÷ 15 × preço da @ (+ vendas já feitas) */
function estVendaDet(l,C){C=C||calcLote(l);const pr=+l.simPreco||0,rc=+l.rcPrev||+l.simRc||+gCfg().rc||52,peso=pesoEm(l,C.ate),arrCab=peso*rc/100/15,arrTot=C.cabAt*arrCab;
  const rec=pr>0?arrTot*pr+C.receita:NaN,res=rec+(C.resInt||0)-C.custo-(C.perd||0),arrProd=C.arrV+arrTot-(C.cabV+C.cabAt)*C.pesoE/30;
  return {pr,rc,peso,arrCab,arrTot,rec,res,resCab:res/C.cabE,margem:res/C.custo*100,pontoEq:arrTot>0?(C.custo+(C.perd||0)-C.receita-(C.resInt||0))/arrTot:NaN,custoArr:arrProd>0?C.prod/arrProd:NaN,arrProd,ganho:peso-C.pesoE};}
const UNID_TXT={arroba:'R$ por @',cab:'R$ por cabeça',kg:'R$ por kg vivo'};
function dadosLotePares(l,C){const e=l.ent||{},hj=hojeKey(),r=racaoEm(l,C.ate),rcC=+e.rcC||50;
  const pvC=(+e.cab||0)*(+(e.pesoC||e.peso)||0)+entradasDe(l).reduce((a,x)=>a+(+x.cab||0)*(+x.peso||0),0),arrC=e.unid==='arroba'||!e.unid?pvC*rcC/100/15:e.unid==='arrV'?pvC/30:NaN;
  return [['Local',l.sistema&&/Pasto/.test(l.sistema)?'Pasto':linhaDe(curralEm(l,C.ate))==='P'?'Pasto':'Confinamento'],['Curral / pasto',curralEm(l,C.ate)||'—'],
    ['Animais',[sexoTxt(l.sexo),l.raca,catNorm(l.cat)].filter(Boolean).join(' · ')||'—'],['Ração atual',r?r.nome:'sem ração'],
    ['Entrada',`${dB(e.dia)} · ${nf(C.cabE)} cab · ${nf(C.pesoE,1)} kg`],['Cabeças hoje',nf(C.cabAt)+(C.cabV?` (vendidas ${nf(C.cabV)})`:'')+(C.mortes?` · mortes ${nf(C.mortes)}`:'')],
    ['Peso projetado hoje',`${nf(pesoEm(l,C.ate),1)} kg (+${nf(pesoEm(l,C.ate)-C.pesoE,1)} kg)`],['Ganho por dia (meta)',nf(+l.gmd||0,2)+' kg/cab/dia'],
    ...(e.unid==='transf'?[['Veio de transferência',`${esc((G.it[e.deLote]||{}).nome||'—')} em ${dB(e.dia)} · ${nf(e.cab)} cab · ${nf(e.peso,1)} kg`],[e.vi?'Compra (venda interna)':'Custo trazido',`${rs(+e.preco||0)} (${rs((+e.preco||0)/(+e.cab||1))} por cab)${e.vi?'':' · proporcional ao peso'}`]]:l.apDe?[['Veio da apartação',`${esc((G.it[l.apDe]||{}).nome||'—')} em ${dB(e.dia)} · ${nf(e.cab)} cab · ${nf(e.peso,1)} kg`],['Custo trazido da apartação',`${rs(C.compra)} (${rs(C.compra/C.cabE)} por cab) · proporcional ao peso`]]:[['Compra',`${UNID_TXT[e.unid||'arroba']}: ${rs(+e.preco||0)}${(e.unid||'arroba')==='arroba'?` · rendimento ${nf(rcC,1)}% (${nf(arrC,1)} @)`:''}${+e.outros?` · frete/outros ${rs(+e.outros)}`:''}`],
    ['Valor da compra',`${rs(C.compra)} (${rs(C.compra/C.cabE)} por cab)`]])];}
function vendaEst(l,C){C=C||calcLote(l);if(C.fim)return {venda:C.receita,res:C.lucro,real:true};
  const pr=+l.simPreco||0;if(!(pr>0))return {venda:NaN,res:NaN};
  const rc=+l.rcPrev||+l.simRc||+gCfg().rc||52,peso=pesoEm(l,C.ate),v=C.cabAt*peso*rc/100/15*pr+C.receita;return {venda:v,res:v+(C.resInt||0)-C.custo-(C.perd||0)};}
/* relatório de resultado: opção de calcular a compra pelo preço médio da @ vendida (peso de entrada × rendimento da compra ÷ 15 × R$/@ vendida) */
var RELCMP=null;
function compraPelaVenda(l,C){const e=l.ent||{};if(e.unid==='transf'||l.apDe)return null;
  const vendas=C.vendas,trsV=C.trs.filter(s=>+s.vi>0);
  const arrV=vendas.reduce((a,s)=>a+arrobaVenda(s),0),brV=vendas.reduce((a,s)=>a+valorVenda(s)+(+s.desc||0),0);
  const arrI=trsV.reduce((a,s)=>a+(+s.cab||0)*(+s.peso||0)*((+s.rcV||50)/100)/15,0),brI=trsV.reduce((a,s)=>a+(+s.vi||0),0);
  const pV=arrV+arrI>0?(brV+brI)/(arrV+arrI):NaN;if(!(pV>0))return null;
  const rc=(+e.rcC||50)/100,kg=(+e.cab||0)*(+(e.pesoC||e.peso)||0),ents=entradasDe(l).filter(x=>!x.de),kgE=ents.reduce((a,x)=>a+(+x.cab||0)*(+x.peso||0),0);
  const arrC=(kg+kgE)*rc/15,nova=arrC*pV+(+e.outros||0),lanc=valorCompra(l)-entradasDe(l).filter(x=>x.de).reduce((a,x)=>a+(+x.rs||0),0);
  return {pV,arrC,nova,lanc,delta:nova-lanc};}
function calcLote(l){const C=calcLote0(l);if(!RELCMP||RELCMP.uid!==l.uid)return C;const A=compraPelaVenda(l,C);if(!A)return C;
  C.cmpAlt=A;C.compra+=A.delta;C.custo+=A.delta;const den=C.cabE-C.cabT+C.cabTV-C.faltas;
  if(C.fim&&!C.apart){C.lucro=C.receita+C.resInt-C.custo-(C.perd||0);C.lucroCab=den>0?C.lucro/den:NaN;C.lucroArr=C.arrV?C.lucro/C.arrV:NaN;C.rentab=C.custo?C.lucro/(C.custo+(C.perd||0))*100:NaN;}
  return C;}
function calcLote0(l){
  const fim=fimLote(l),hj=hojeKey(),ate=fim||hj,R=resumoLote(l,ate),sd=saidasDe(l);
  const vendas=sd.filter(ehVenda),aps=sd.filter(s=>s.mot==='apart'),trs=sd.filter(s=>s.mot==='transf'),mortes=sd.filter(s=>s.mot==='morte').reduce((a,s)=>a+(+s.cab||0),0),faltas=sd.filter(s=>s.mot==='falta').reduce((a,s)=>a+(+s.cab||0),0);
  const cabE=cabEntTot(l),pesoE=pesoEntMed(l),compra=valorCompra(l);
  const outros=custosDe(l).filter(c=>c.dia<=ate).reduce((a,c)=>a+(+c.rs||0),0);
  const cabV=vendas.reduce((a,s)=>a+(+s.cab||0),0),arrV=vendas.reduce((a,s)=>a+arrobaVenda(s),0),receita=vendas.reduce((a,s)=>a+valorVenda(s),0);
  const pesoV=cabV?vendas.reduce((a,s)=>a+s.cab*s.peso,0)/cabV:NaN;
  const offE=cabE?(entradasDe(l).reduce((a,x)=>a+(+x.cab||0)*difDias(l.ent.dia,x.diaE||x.dia),0)+(l.ent.diaE?(+l.ent.cab||0)*difDias(l.ent.dia,l.ent.diaE):0))/cabE:0;   // transferência a custo: conta os dias desde a entrada original   // entrada de animais depois: média de dias a menos no cocho
  /* desempenho: animais que saíram pesados (vendidos e apartados) */
  const pes=vendas.concat(aps,trs),cabP=pes.reduce((a,s)=>a+(+s.cab||0),0);
  const ganhoV=pes.reduce((a,s)=>a+s.cab*(s.peso-pesoE),0),cabDiasV=pes.reduce((a,s)=>a+s.cab*Math.max(1,difDias(l.ent.dia,s.dia)-offE),0);
  /* transferências para outros lotes: tira o custo que os animais levaram (guardado no dia da transferência) */
  const fts=sd.filter(s=>s.mot==='falta'&&s.cst),tO=k=>trs.concat(fts).reduce((a,s)=>a+(s.cst&&+s.cst[k]||0),0),trOut=trs.reduce((a,s)=>a+(+s.custo||0),0),fOut=fts.reduce((a,s)=>a+(+s.custo||0),0),cabT=trs.reduce((a,s)=>a+(+s.cab||0),0);
  const alimB=R.custoR,opB=R.custoOp,outB=outros,trazido=custoHerdado(l)+(l.ent&&l.ent.unid==='transf'?+l.ent.preco||0:0)+(+(l.ent&&l.ent.trz)||0)+entradasDe(l).filter(x=>x.de).reduce((a,x)=>a+(+x.rs||0),0);
  const alim=alimB-tO('alim'),op=opB-tO('op'),outrosL=outB-tO('outros'),compraL=compra-tO('compra')+vendas.filter(s=>s.cst&&+s.cr>0).reduce((a,s)=>a+(+s.cr)-(+s.cst.compra||0),0),prod=alim+op+outrosL,custo=compraL+prod,arrProd=cabV?arrV-cabV*pesoE/30:NaN;
  /* venda interna (transferência como compra e venda): o resultado desses animais entra no lucro deste lote */
  /* sumidos: saem do lote levando o custo completo deles (compra + trato) e esse custo fica separado até serem achados — não entra como prejuízo do lote */
  const perd=0,sumCusto=fts.reduce((a,s)=>a+(+s.custo||0)*faltaPend(s)/((+s.cab)||1),0);
  const trsV=trs.filter(s=>+s.vi>0),cabTV=trsV.reduce((a,s)=>a+(+s.cab||0),0),recInt=trsV.reduce((a,s)=>a+(+s.vi||0),0),resInt=trsV.reduce((a,s)=>a+resSai(s),0),
    trazVI=(l.ent&&l.ent.unid==='transf'&&l.ent.vi?+l.ent.preco||0:0)+entradasDe(l).filter(x=>x.de&&x.vi).reduce((a,x)=>a+(+x.rs||0),0);
  const apart=aps.length>0,cabA=aps.reduce((a,s)=>a+(+s.cab||0),0),kgA=aps.reduce((a,s)=>a+s.cab*s.peso,0),fimN=fim&&!apart;
  const arrPV=cabP?ganhoV/30:NaN;
  return {fim,ate,R,vendas,faltas,fOut,aps,trs,cabT,trOut,trazido,cabTV,recInt,resInt,trazVI,resVd:vendas.reduce((a,s)=>a+(ok(resSai(s))?resSai(s):0),0),nVdR:vendas.filter(s=>ok(resSai(s))).length,apart,cabA,kgA,pesoA:cabA?kgA/cabA:NaN,mortes,cabE,pesoE,compra:compraL,outros:outrosL,cabV,arrV,receita,pesoV,ganhoV,cabDiasV,cabP,alim,op,prod,custo,arrProd,
    dias:difDias(l.ent.dia,ate),cabAt:cabAtual(l),msCab:R.ms/R.cabDias,mnCab:R.mn/R.cabDias,pv:R.pvN?R.pvS/R.pvN:NaN,
    gmdV:cabDiasV?ganhoV/cabDiasV:NaN,custoArr:prod/arrProd,conv:R.ms/ganhoV,lucro:fimN?receita+resInt-custo-perd:NaN,perd,sumCusto,custoMortes:sd.filter(s=>s.mot==='morte').reduce((a,s)=>a+(+s.custo||0),0),custoCabDia:(alimB+opB)/R.cabDias,
    efic:R.ms?ganhoV/R.ms:NaN,                                  // eficiência alimentar: kg de peso vivo ganho por kg de MS consumida
    arrPV,                                                      // @ produzidas em peso vivo (ganho ÷ 30)
    custoArrPV:prod/arrPV,custoKg:prod/ganhoV,                  // custo da @ (peso vivo) e do kg ganho — usado na apartação
    diasMed:cabE?R.cabDias/cabE:NaN,                            // dias de consumo médios por animal (pondera entradas/saídas em datas diferentes)
    diaria:R.cabDias?(alimB+opB+outB)/R.cabDias:NaN,diaAlim:R.cabDias?alimB/R.cabDias:NaN,diaOp:R.cabDias?opB/R.cabDias:NaN,diaOut:R.cabDias?outB/R.cabDias:NaN,   // diária: todos os animais que passaram pelo lote
    precoArr:arrV?vendas.reduce((a,s)=>a+valorVenda(s)+(+s.desc||0),0)/arrV:NaN,   // preço médio de venda da @ (bruto)
    mortPct:cabE?mortes/cabE*100:NaN,                           // % de mortalidade sobre as cabeças que entraram
    diasCocho:cabP?cabDiasV/cabP:NaN,                           // dias de cocho médios (ponderado por entradas/saídas em datas diferentes)
    lucroCab:fimN&&cabE-cabT+cabTV-faltas>0?(receita+resInt-custo-perd)/(cabE-cabT+cabTV-faltas):NaN,lucroArr:fimN&&arrV?(receita+resInt-custo-perd)/arrV:NaN,rentab:fimN&&custo?(receita+resInt-custo-perd)/(custo+perd)*100:NaN};
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
  const vendas=gTodos('saida').filter(s=>ehVenda(s)&&s.dia>=ini&&s.dia<=dia).reduce((a,s)=>a+(+s.cab||0),0);
  /* rebanho */
  const conta=(f)=>{const m={};A.forEach(l=>{const k=f(l)||'Não informado';m[k]=(m[k]||0)+cabD(l);});return Object.entries(m).sort((a,b)=>b[1]-a[1]);};
  const locs=[['C','Confinamento'],['P','Pasto']].map(([k,n])=>{const L=A.filter(l=>linhaDe(curralEm(l,dia))===k),c=L.reduce((a,l)=>a+cabD(l),0);
    const sx=x=>L.filter(l=>sexoNorm(l.sexo)===x).reduce((a,l)=>a+cabD(l),0);
    return {n,lotes:L.length,mac:sx('M'),fem:sx('F'),cab:c,peso:c?L.reduce((a,l)=>a+cabD(l)*pesoEm(l,dia),0)/c:NaN};}).filter(o=>o.lotes);
  if(locs.length>1){const c=locs.reduce((a,o)=>a+o.cab,0);locs.push({n:'Total',tot:true,lotes:locs.reduce((a,o)=>a+o.lotes,0),mac:locs.reduce((a,o)=>a+o.mac,0),fem:locs.reduce((a,o)=>a+o.fem,0),cab:c,peso:c?locs.reduce((a,o)=>a+o.cab*(o.peso||0),0)/c:NaN});}
  const porSexo=conta(l=>sexoTxt(l.sexo)),porRaca=conta(l=>l.raca),porCat=conta(l=>catNorm(l.cat));
  /* operação do dia */
  const Cs=cochoCurrais(dia),lidos=Cs.filter(c=>{const x=G.it[idLeit(dia,c)];return x&&!x.del;}),notas=lidos.map(c=>G.it[idLeit(dia,c)].nota);
  const bat=gTodos('carga').filter(c=>c.dia===dia),bp=bat.reduce((a,c)=>a+c.itens.reduce((s,x)=>s+x.prev,0),0),br=bat.reduce((a,c)=>a+c.itens.reduce((s,x)=>s+(+x.real||0),0),0);
  /* alertas (sempre sobre hoje) */
  const alertas=[],AH=lotesAtivos();
  const semLeit=cochoCurrais(hj).filter(c=>!G.it[idLeit(hj,c)]);if(semLeit.length)alertas.push(['warn',`Leitura de cocho de hoje faltando: ${semLeit.join(', ')}`,'cocho']);
  AH.forEach(l=>{const cu=curralEm(l,hj),ln=cu?`${cu} · ${l.nome}`:l.nome;   // curral na frente: o nome do lote sozinho não diz onde está
    if(!racaoEm(l,hj))alertas.push(['bad',`${ln}: sem ração escolhida`,'lote',l.uid]);
    const pz=pesagensDe(l),ult=pz.length?pz[pz.length-1].dia:l.ent.dia,d2=difDias(ult,hj);
    /* peso de saída e dias de cocho: ficam nos Abates previstos (logo abaixo do resumo), não repetem aqui */});
  gTodos('insumo').forEach(i=>{if(!ok(precoIns(i,hj)))alertas.push(['bad',`Insumo ${i.nome} sem preço`,'insumos']);});
  const lista=(arr)=>arr.map(([k,v])=>`<div><span>${esc(k)}</span><b class="num">${nf(v)} cab</b></div>`).join('');
  const ABT=AH.map(l=>({l,a:projAbate(l,true)})).filter(o=>o.a).sort((x,y)=>x.a.dia.localeCompare(y.a.dia)||(x.l.nome||'').localeCompare(y.l.nome||'')),
    AB=ABT.filter(o=>o.a.dia<=somaDias(hj,60)),ABM=ABT.filter(o=>o.a.dia>somaDias(hj,60));   // sempre do que falta menos para o que falta mais
  window.resDados={dia,dd,A:A.length,cab,pesoM,tem,ms,cabO,pvP,cus,mn,cr,co,mcd,mmn,mms,mcus,msan,mcr,mco,vendas,mortes,locs,porSexo,porRaca,porCat,lidos:lidos.length,Cs:Cs.length,notas,bat:bat.length,bp,br,ins,
    AB:AB.map(o=>({nome:o.l.nome,curral:curralEm(o.l,hj),cab:cabPres(o.l,hj),atual:o.a.atual,peso:o.a.peso,dia:o.a.dia,f:difDias(hj,o.a.dia),por:o.a.por})),alertas:alertas.map(a=>a[1])};
  const abLin=o=>{const f=difDias(hj,o.a.dia);return `<tr data-g="lote" data-id="${o.l.uid}" class="gClic"><td class="c">${esc(curralEm(o.l,hj)||'')}<small>${esc(o.l.nome)}</small></td><td>${nf(cabPres(o.l,hj))}</td><td>${nf(o.a.atual)}</td><td>${nf(o.a.peso)}</td><td>${dB(o.a.dia).slice(0,5)}</td><td class="${f<0?'bad':f<=15?'warn':''}">${f===0?'hoje':nf(f)}</td></tr>`;};
  const abCab='<thead><tr><th>Curral · lote</th><th>Qtd.</th><th>Peso atual</th><th>Peso abate</th><th>Abate</th><th>Faltam<br>dias</th></tr></thead>';
  const abHTML=ABT.length?card('Abates previstos nos próximos 60 dias',`${AB.length?`<div class="tablebox"><table class="gTab gAbTab">${abCab}<tbody>
    ${AB.map(abLin).join('')}
    <tr class="grp"><td>Total</td><td>${nf(AB.reduce((a,o)=>a+cabPres(o.l,hj),0))}</td><td></td><td></td><td></td><td></td></tr></tbody></table></div>`:'<p class="note">Nenhum lote com abate previsto nos próximos 60 dias.</p>'}
    ${ABM.length?`<div class="gMinz gAbMais${gMinAb.has('abMais')?' aberto':''}" data-min-k="abMais"><div class="gMinzCab"><b>Depois de 60 dias · mais ${ABM.length} lote(s)</b></div>
      <div class="tablebox"><table class="gTab gAbTab">${abCab}<tbody>${ABM.map(abLin).join('')}</tbody></table></div></div>`:''}
    <p class="note">Pesos em kg por cabeça. Previsão pelo peso desejado (com a meta de ganho por dia) ou pelos dias de cocho do lote. Faltam negativo = já passou da data. Toque no lote para abrir.</p>`):'';
  return `<section class="panel"><h2>Resumo do dia</h2>
    ${navData('gResDia',dia,'Data')}
    ${A.length?`<div class="row compart fz3 lotesExp"><button class="verde" data-g="resPdf">📄 PDF</button><button class="verde" data-g="resImg">🖼 Foto</button><button class="verde" data-g="resXls">📊 Excel</button></div>`:''}
    <div class="stat gStat3">${st('Lotes ativos',nf(A.length))}${st('Cabeças',nf(cab))}${st('Peso médio',nf(pesoM)+' kg')}
      ${st('MS/cab',tem?nf(ms/cabO,2)+' kg':'—')}${st('% IMS',tem?pc(pvP?ms/pvP*100:NaN,2):'—')}${st('Custo/cab',tem?rs(cus/cabO):'—')}</div>
    ${tem?'':`<p class="aviso warn">Ainda sem trato lançado em ${dd}. Toque em ◀ para ver o dia anterior.</p>`}
    ${A.length?'':'<p class="note">Nenhum lote ativo. Comece por Insumos → Rações → Lotes.</p>'}</section>
  ${abHTML}
  ${alertas.length?`<section class="panel"><h2>Atenção</h2>${alertas.map(a=>`<button class="gAlerta ${a[0]}" data-g="${a[2]==='lote'?'lote':'raiz'}" data-t="${a[2]}" data-id="${a[3]||''}">${esc(a[1])}</button>`).join('')}</section>`:''}
  ${tem?card(`Consumo e custo em ${dd}`,`<div class="stat gStat3">${st('MN total',nf(mn)+' kg')}${st('MS total',nf(ms)+' kg')}${st('MN/cab',nf(mn/cabO,2)+' kg')}
      ${st('Custo ração',rs(cr))}${st('Operacional',rs(co))}${st('Custo do dia',rs(cus))}</div>`):''}
  ${mcd?card(`Consumo e custo do mês: 01/${dia.slice(5,7)} até ${dd}`,`<div class="stat gStat3">${st('MN total',nf(mmn/1000,1)+' t')}${st('MS total',nf(mms/1000,1)+' t')}${st('MN/cab/dia',nf(mmn/mcd,2)+' kg')}
      ${st('Custo ração',rs(mcr))}${st('Operacional',rs(mco))}${st('Custo do mês',rs(mcus))}
      ${st('MS/cab/dia',nf(mms/mcd,2)+' kg')}${st('Custo/cab/dia',rs(mcus/mcd))}${st('Despesas lançadas',rs(msan))}</div>
    <p class="note">Mesmos dados do dia, somados de 01/${dia.slice(5,7)} até ${dd}. Médias por cab/dia = total ÷ (cabeças de cada dia somadas: ${nf(mcd)}). Despesas lançadas = sanidade, medicamento etc. dos lotes (fora do custo do mês).</p>
    ${vendas||mortes?`<p class="note">No mês: ${vendas?nf(vendas)+' cab vendidas':''}${vendas&&mortes?' · ':''}${mortes?nf(mortes)+' morte(s)':''}.</p>`:''}`):''}
  ${A.length?card('Rebanho',`${locs.length?`<div class="tablebox"><table class="gTab gRebTab"><thead><tr><th>Local</th><th>Lotes</th><th>Machos</th><th>Fêmeas</th><th>Total</th><th>Peso médio</th></tr></thead><tbody>${locs.map(o=>`<tr${o.tot?' class="grp"':''}><td class="c">${o.n}</td><td>${nf(o.lotes)}</td><td>${nf(o.mac)}</td><td>${nf(o.fem)}</td><td><b>${nf(o.cab)}</b></td><td>${nf(o.peso)} kg</td></tr>`).join('')}</tbody></table></div>`:''}
    <div class="gDuas"><div><h3>Categoria</h3><div class="gLinhas">${lista(porCat)}</div></div><div><h3>Raça</h3><div class="gLinhas">${lista(porRaca)}</div></div></div>`):''}
  ${A.length?card(`Operação em ${dd}`,`<div class="stat gStat3">${st('Leituras',`${nf(lidos.length)} de ${nf(Cs.length)}`)}${st('Nota média',notas.length?(()=>{const m=notas.reduce((a,b)=>a+b,0)/notas.length;return (m>0?'+':'')+nf(m,1);})():'—')}${st('Carregamentos',nf(bat.length))}</div>
    ${bat.length?`<p class="note">Vagão: previsto ${nf(bp)} kg · carregado ${nf(br)} kg (${br-bp>0?'+':''}${nf(br-bp)} kg).</p>`:''}
    ${Object.keys(ins).length?`<h3>Insumos gastos no dia</h3>${tabInsumos(ins)}`:''}`):''}
`;
}
/* ---------- Resumo: relatório (imagem ou PDF) ---------- */
function resSecoes(){const R=window.resDados;if(!R)return [];const S_=[];
  S_.push(kv('Rebanho e consumo',[['Lotes ativos',nf(R.A)],['Cabeças',nf(R.cab)],['Peso médio',nf(R.pesoM)+' kg'],['MS/cab',R.tem?nf(R.ms/R.cabO,2)+' kg':'—'],['% IMS',R.tem?pc(R.pvP?R.ms/R.pvP*100:NaN,2):'—'],['Custo/cab no dia',R.tem?rs(R.cus/R.cabO):'—']]));
  if(R.tem)S_.push(kv(`Consumo e custo em ${R.dd}`,[['MN total',nf(R.mn)+' kg'],['MS total',nf(R.ms)+' kg'],['Custo ração',rs(R.cr)],['Operacional',rs(R.co)],['Custo do dia',rs(R.cus)]]));
  if(R.mcd)S_.push(kv(`Consumo e custo do mês até ${R.dd}`,[['MN total',nf(R.mmn/1000,1)+' t'],['MS total',nf(R.mms/1000,1)+' t'],['MN/cab/dia',nf(R.mmn/R.mcd,2)+' kg'],['MS/cab/dia',nf(R.mms/R.mcd,2)+' kg'],['Custo ração',rs(R.mcr)],['Operacional',rs(R.mco)],['Custo do mês',rs(R.mcus)],['Custo/cab/dia',rs(R.mcus/R.mcd)],['Despesas lançadas',rs(R.msan)],['Vendas no mês',nf(R.vendas)+' cab'],['Mortes no mês',nf(R.mortes)]]));
  if(R.locs.length)S_.push({cab:'Rebanho por local',cols:[['Local',200,'l'],['Lotes',100,'r'],['Machos',130,'r'],['Fêmeas',130,'r'],['Total',130,'r'],['Peso médio',150,'r']],linhas:R.locs.map(o=>[o.n,nf(o.lotes),nf(o.mac),nf(o.fem),nf(o.cab),nf(o.peso)+' kg'])});
  const tb=(t,a)=>a.length?{cab:t,cols:[['',560,'l'],['Cabeças',280,'r']],linhas:a.map(([k,v])=>[k,nf(v)])}:null;
  [tb('Categoria',R.porCat),tb('Raça',R.porRaca)].forEach(x=>{if(x)S_.push(x);});
  S_.push(kv(`Operação em ${R.dd}`,[['Leituras de cocho',`${nf(R.lidos)} de ${nf(R.Cs)}`],['Nota média',R.notas.length?nf(R.notas.reduce((a,b)=>a+b,0)/R.notas.length,1):'—'],['Carregamentos',nf(R.bat)],['Vagão previsto / carregado',R.bat?`${nf(R.bp)} / ${nf(R.br)} kg`:'—']]));
  if(R.AB.length)S_.push({cab:'Abates previstos nos próximos 60 dias',cols:[['Curral',140,'l'],['Lote',200,'l'],['Cab.',80,'r'],['Peso atual',120,'r'],['Peso abate',120,'r'],['Abate',100,'r'],['Faltam (dias)',120,'r']],
    linhas:R.AB.map(o=>[o.curral||'',o.nome,nf(o.cab),nf(o.atual)+' kg',nf(o.peso)+' kg',dB(o.dia).slice(0,5),o.f===0?'hoje':nf(o.f)])});
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
/* Rações por curral: um botão só — todos marcados mostra "Desmarcar todos", senão "Marcar todos" */
function rcMarcaBt(){const b=document.querySelector('[data-g=rcMarca]');if(!b)return;const X=[...document.querySelectorAll('[data-rc]:not(:disabled)')],todos=X.length&&X.every(x=>x.checked);
  b.dataset.v=todos?'0':'1';b.textContent=todos?'✕ Desmarcar todos':'✓ Marcar todos';}
document.addEventListener('change',e=>{if(e.target.matches&&e.target.matches('[data-rc]'))rcMarcaBt();});
/* filtro de local no padrão do sistema: Local ◀ [Todos / Confinamento / Pasto] ▶ (Todos primeiro) */
const LOC_SET={ntLoc:v=>{GT.ntLoc=v;},evLoc:v=>{GT.evLoc=v;},rcLoc:v=>{GT.loc=v;},filtroLoc:v=>{gLoc=v;}};
function locBotoes(attr,sel,conta,extra){const LO=window.LOC_OPS;if(typeof selSetas==='function'&&LO&&LOC_SET[attr])return `<div class="gCoLocNav">${selSetas('Local',LO,Math.max(0,LO.findIndex(o=>o[0]===(sel||'T'))),`data-g="locP" data-a="${attr}" data-v0="${sel||'T'}" data-n`,`data-locsel="${attr}"`)}</div>`;
  return locBotoesAnt(attr,sel,conta,extra);}
function locBotoesAnt(attr,sel,conta,extra){conta=null;return `<div class="linhas gFiltro">${[['T','Todos'],['C',ICO_C+' Confinamento'],['P','🌿 Pasto']].map(([k,r])=>{const n=conta?conta(k):null;return `<button data-g="${attr}" data-l="${k}" class="${sel===k?'sel':''}"${extra||''}>${r}${n!=null?`<small> ${n}</small>`:''}</button>`;}).join('')}</div>`;}
const doLocal=(k,c)=>k==='T'||linhaDe(c)===k;
function tLotes(t){
  const hj=hojeKey(),X=gCtx(),loc=gLoc,noLocal=l=>loc==='T'||linhaDe(curralEm(l,fimLote(l)||hj))===loc;
  const curDe=l=>curralEm(l,fimLote(l)||hj),base0=gTodos('lote').filter(noLocal).filter(l=>t.enc?!ativo(l):ativo(l));
  const curOps=[['','Todos']].concat([...new Set(base0.map(curDe).filter(Boolean))].sort(alfa).map(n=>[n,n]));if(gLotCur&&!curOps.some(o=>o[0]===gLotCur))gLotCur='';
  const todosL=gTodos('lote').filter(noLocal).filter(l=>!gLotCur||curDe(l)===gLotCur),lista=(t.enc?todosL.filter(l=>!ativo(l)).sort(porNome):todosL.filter(ativo).sort(porCurral));
  const navCur=typeof selSetas==='function'?`<div class="gCoLocNav">${selSetas('Curral',curOps,Math.max(0,curOps.findIndex(o=>o[0]===gLotCur)),'data-g="lotCurP" data-n','data-lotcsel')}</div>`:'';
  const cards=lista.map(l=>{const fim=fimLote(l),ref=fim&&fim<hj?fim:hj,cab=cabPres(l,ref),r=racaoEm(l,ref),c=curralEm(l,ref),m=mediaLote(l,X);
    const sub=[sexoTxt(l.sexo),l.raca,catNorm(l.cat)].filter(Boolean).join(' · ');
    const ab=gLotAb.has(l.uid);
    return `<div class="gLote gLoteV gLoteMin${ab?' aberto':''}" data-g="loteTog" data-id="${l.uid}" role="button" tabindex="0"><div class="gLoteTopo">${seloCurral(c)}
      <div class="gLoteInfo"><b>${esc(l.nome)}</b>${sub?`<span>${esc(sub)}</span>`:''}
      <span class="gRacLote">🌾 ${esc(r?r.nome:'sem ração')}</span>
      ${fim&&fim<hj?`<span>Arquivado em ${dB(fim)}</span>`:l.ent.dia>hj?`<span>Entra em ${dB(l.ent.dia)}</span>`:''}
      <span class="gLoteResumo"><b>${nf(cab)}</b> cab · <b>${nf(Math.max(0,difDias(l.ent.dia,ref)))}</b> dias</span></div><span class="gLoteSeta" aria-hidden="true">▼</span></div>${ab?`<div class="gLoteInfo gLoteBaixo">
      <div class="gLoteNums4"><span><b>${nf(cab)}</b> cab</span><span><b>${nf(pesoEntMed(l)||0)}</b> kg entrada</span><span><b>${nf(pesoEm(l,ref))}</b> kg projetado</span><span><b>${nf(Math.max(0,difDias(l.ent.dia,ref)))}</b> dias</span></div>
      ${(()=>{const A=ativo(l)?projAbate(l):null;if(!A)return `<div class="gLoteNums4 gAbate"><span><b>—</b> peso final projetado</span><span><b>—</b> previsão de abate</span><small>Para ver a previsão, coloque no lote o peso desejado ou os dias de cocho.</small></div>`;
        const f=difDias(hj,A.dia);return `<div class="gLoteNums4 gAbate"><span><b>${nf(A.peso)}</b> kg final projetado</span><span><b>${dB(A.dia).slice(0,5)}/${A.dia.slice(2,4)}</b> previsão de abate</span><span><b>${f<0?'atrasado':f===0?'hoje':nf(f)}</b> ${f<0?nf(-f)+' dias':f===0?'':'dias para o abate'}</span><span>previsão calculada pelo ${esc(A.por)}</span></div>`;})()}
      <div class="gLoteNums4 gMed"><span><b>${m.n?nf(m.mn/m.n,1):'—'}</b> MN/cab</span><span><b>${m.nms?nf(m.ms/m.nms,2):'—'}</b> MS/cab</span><span><b>${m.nms?pc(m.pv/m.nms,2):'—'}</b> % IMS</span><span><b>${nf(m.n)}</b> dias c/ trato</span></div>
      ${(()=>{const C=calcLote(l),V=vendaEst(l,C),cr=ok(V.res)?(V.res>=0?'pos':'neg'):'',dl=Math.max(0,difDias(l.ent.dia,ref)),rc=ok(V.res)&&cab?V.res/cab:NaN,rcd=ok(rc)&&dl?rc/dl:NaN,crc=v=>ok(v)?(v>=0?'pos':'neg'):'';
        return `<div class="gLoteNums4 gCus"><span><b>${ok(C.custoCabDia)?rs(C.custoCabDia):'—'}</b> custo/cab/dia</span><span><b>${C.cabE?rs((C.alim+C.op)/C.cabE):'—'}</b> custo/cab/total</span><span><b>${C.cabE?rs(C.compra/C.cabE):'—'}</b> custo/compra/cab</span><span><b>${rs(C.custo)}</b> custo/lote/total</span>
        <span><b>${ok(V.venda)?rs(V.venda):'—'}</b> ${V.real?'venda':'venda estimada'}</span><span class="${cr}"><b>${ok(V.res)?rs(V.res):'—'}</b> ${V.real?'resultado':'resultado estimado'}</span><span class="${crc(rc)}"><b>${ok(rc)?rs(rc):'—'}</b> resultado/cab/total</span><span class="${crc(rcd)}"><b>${ok(rcd)?rs(rcd):'—'}</b> resultado/cab/dia</span></div>`;})()}
      <button type="button" class="lima gLoteAbrir" data-g="lote" data-id="${l.uid}">Abrir lote ›</button>
      <small class="gLoteDica">Médias de todos os tratos do lote · custo/cab/total = tratos por cabeça (sem a compra) · custo/lote/total inclui a compra · resultado/cab/dia = resultado/cab/total ÷ dias do lote · venda estimada = cabeças × peso projetado × rendimento × preço da @ (editar lote › Estimativa de venda) · toque no quadro para minimizar</small></div>`:''}</div>`;}).join('');
  return `<section class="panel"><div class="curhead gLotesTopo"><h2>${t.enc?'Lotes arquivados':'Lotes ativos'} <span class="note">${lista.length}</span></h2>
      <span class="gLotesBts">${t.enc?'':'<button type="button" class="mini lima" data-g="novoLote">+ Novo lote</button>'}<button type="button" class="mini" data-g="ir" data-t="lotes" data-enc="${t.enc?'':'1'}">${t.enc?'Ativos':'Arquivados'}</button></span></div>
    ${typeof selSetas==='function'&&window.LOC_OPS?`<div class="gCoLocNav">${selSetas('Local',LOC_OPS,Math.max(0,LOC_OPS.findIndex(o=>o[0]===loc)),'data-g="lotLocP" data-n','data-lotlsel')}</div>`:locBotoes('filtroLoc',loc)}${navCur}
    ${!t.enc||lista.length>1?`<div class="row gLotesAbre">${t.enc?'':`<button type="button" class="mini lima gPesNova" data-g="ir" data-t="pesNova">⚖️ Pesagem</button>`}${lista.length>1?(lista.every(l=>gLotAb.has(l.uid))?`<button type="button" class="mini" data-g="lotTodos" data-v="0">▲ Minimizar todos</button>`:`<button type="button" class="mini" data-g="lotTodos" data-v="1">▼ Abrir todos</button>`):''}</div>`:''}
    ${lista.length?`<div class="row compart fz3 lotesExp"><button class="verde" data-g="lotesPdf" data-enc="${t.enc?'1':''}">📄 PDF</button><button class="verde" data-g="lotesImg" data-enc="${t.enc?'1':''}">🖼 Foto</button><button class="verde" data-g="lotesXls" data-enc="${t.enc?'1':''}">📊 Excel</button></div>`:''}
    ${t.enc?'':painelFaltas()}
    ${cards||`<p class="note">${t.enc?'Nenhum lote arquivado.':'Nenhum lote ainda. Toque em “+ Novo lote”.'}</p>`}
</section>`;
}
/* animais que faltaram num fechamento: o custo fica separado até serem achados */
function gravarFalta(l,d,cab,peso,share,obs,modo){const K=custoAteDia(l,d),cst={};['compra','alim','op','outros'].forEach(k=>cst[k]=Math.round(K[k]*share*100)/100);
  gPut({uid:novoId('sai'),tipo:'saida',mot:'falta',lote:l.uid,dia:d,cab,peso:Math.round(peso*100)/100,pesoE:Math.round((modo==='entrada'?peso:pesoEntMed(l))*100)/100,fmodo:modo==='entrada'?'entrada':'atual',diaE:l.ent.diaE||l.ent.dia,cst,custo:Object.values(cst).reduce((a,v)=>a+v,0),achados:[],obs:obs||''});}
const campoFaltas=(pre,F,attr)=>{const A=k=>attr?`data-fc="${k}"`:`id="${pre}${k}"`;return `<h3 class="gSubT">❓ Faltaram (sumidos)</h3><div class="gForm"><div class="gCampo meia"><label>Quantidade que faltou</label><input type="text" inputmode="decimal" ${A('falta')} value="${esc(F.falta||'')}" placeholder="0" autocomplete="off"></div>
  <div class="gCampo meia"><label>Calcular o custo pelo</label><select ${A('fmodo')}><option value="atual"${F.fmodo!=='entrada'?' selected':''}>Peso de agora / da venda</option><option value="entrada"${F.fmodo==='entrada'?' selected':''}>Peso de entrada</option></select></div>
  <div class="gCampo meia"><label>Peso médio <span class="gSuf">(kg)</span></label><input type="text" inputmode="decimal" ${A('fpeso')} value="${esc(F.fpeso||'')}" placeholder="em branco = média do lote" autocomplete="off"></div>
  <div class="gCampo meia"><label>Peso total <span class="gSuf">(kg)</span></label><input type="text" inputmode="decimal" ${A('fpesoT')} value="${esc(F.fpesoT||'')}" autocomplete="off"></div>
  <div class="gCampo"><label>Observação</label><textarea ${A('fobs')} rows="2" style="min-height:0;height:auto" placeholder="ex.: brincos 1023, 1045">${esc(F.fobs||'')}</textarea></div></div>
  <p class="note">Saem do lote levando o custo deles. <b>Peso de entrada</b>: o custo é a parte que eles eram do peso de entrada do lote. <b>Peso de agora/venda</b>: entra na conta junto com o peso dos vendidos e dos outros. O custo fica separado em Lotes › “Animais que faltaram” até serem achados.</p>`;};
function faltaCalc(l,d,tem,F,pesoRef){const cab=Math.max(0,gNum(F.falta)||0),modo=F.fmodo==='entrada'?'entrada':'atual',pm=gNum(F.fpeso),pt=gNum(F.fpesoT);
  const pE=pesoEntMed(l),p=pm>0?pm:(pt>0&&cab>0?pt/cab:(modo==='entrada'?pE:(pesoRef>0?pesoRef:pesoEm(l,d))));
  if(modo==='entrada'){const base=tem*pE;return {cab,modo,p,kg:0,fixo:base>0?Math.min(1,cab*p/base):0};}
  return {cab,modo,p,kg:cab*(p>0?p:0),fixo:null};}
/* pesos dos animais que faltaram: peso de entrada e peso projetado no dia em que faltaram.
   Se o peso guardado é o de ENTRADA (modo "peso de entrada", ou igual ao peso de entrada de uma das compras do lote), o projetado = entrada + ganho/dia × dias até faltarem. */
function faltaPesos(s,o){const g=+o.gmd||0,proj=(pe,de)=>Math.round((pe+g*Math.max(0,difDias(de,s.dia)))*100)/100;
  if(s.fmodo==='entrada')return {pe:+s.peso,pAt:proj(+s.peso,s.diaE||o.ent.dia)};
  if(s.pesoE!=null)return {pe:+s.pesoE,pAt:+s.peso};
  const grupos=[{peso:+(o.ent.pesoE||o.ent.peso),dia:o.ent.diaE||o.ent.dia}].concat(entradasDe(o).map(x=>({peso:+(x.pesoE||x.peso),dia:x.diaE||x.dia}))),gm=grupos.find(x=>Math.abs(x.peso-(+s.peso))<0.6);
  if(gm)return {pe:gm.peso,pAt:proj(gm.peso,gm.dia)};
  return {pe:pesoEntMed(o),pAt:+s.peso};}
const faltaPend=s=>Math.max(0,(+s.cab||0)-(s.achados||[]).reduce((a,x)=>a+(+x.cab||0),0)-(s.excl?+s.excl.cab||0:0));   // excl = pendentes excluídos (não vão mais ser achados)
function faltasAbertas(){return gTodos('saida').filter(s=>s.mot==='falta'&&faltaPend(s)>0&&G.it[s.lote]&&!G.it[s.lote].del).sort(porDia);}
function painelFaltas(){const F=faltasAbertas();if(!F.length)return '';
  return `<div class="gApInfo gFaltas"><b>❓ Animais que faltaram</b>${F.map(s=>{const p=faltaPend(s),c=(+s.custo||0)*p/(+s.cab||1);return `<span class="gFaltaLin">${nf(p)} cab do <b>${esc(G.it[s.lote].nome)}</b> · ${dB(s.dia)} · ${rs(c)}${s.obs?` · ${esc(s.obs)}`:''}<button class="mini lima" data-g="ir" data-t="achouForm" data-id="${s.uid}">Achou ▸</button><button class="mini danger" data-g="faltaExcl" data-id="${s.uid}">✕ Excluir</button></span>`;}).join('')}</div>`;}
function tAchouForm(t){const s=G.it[t.id],o=G.it[s.lote],hj=hojeKey(),p=faltaPend(s),dest=lotesAtivos().sort(porCurral);t.dest=t.dest||'__novo';
  return `${voltar()}<section class="panel"><h2>Achou os animais · ${esc(o.nome)}</h2>
    <p class="note">Faltaram ${nf(+s.cab)} cab em ${dB(s.dia)} (${nf(s.peso,1)} kg cada, ${s.obs?esc(s.obs)+', ':''}custo separado ${rs(+s.custo||0)}). Ainda faltam ${nf(p)}.</p>
    <div class="gForm">${[{k:'aDest',l:'Vão para o lote',t:'sel',op:[['__novo','＋ Criar lote novo']].concat(dest.map(x=>[x.uid,`${curralEm(x,hj)} · ${x.nome} · ${nf(cabAtual(x))} cab`])),v:t.dest,busca:1},
      {k:'aDia',l:'Data',t:'dia',v:hj,meia:1},{k:'aCab',l:'Quantidade achada',t:'num',v:p,meia:1},{k:'aPeso',l:'Peso médio',suf:'kg',t:'num',v:Math.round(faltaPesos(s,o).pAt||0),meia:1,ajuda:`Vem o peso projetado do dia em que faltaram (${dB(s.dia)}). Se pesar agora, pode trocar.`}].map(campo).join('')}</div>
    <div id="gAchNovo"${t.dest==='__novo'?'':' hidden'}>${campoLoteNovo('id="gf_tN_',{nome:o.nome+' (achados)'},o)}</div>
    ${(()=>{const c=s.cst||{},tr=(+c.alim||0)+(+c.op||0)+(+c.outros||0),FP=faltaPesos(s,o),pe=FP.pe;return `<p class="note">Entram como <b>transferência sem venda</b>: levam o peso de entrada (${nf(pe,1)} kg), o peso projetado do dia em que faltaram (${nf(FP.pAt||0,1)} kg) e só o custo de alimentação, operacional e outros (${rs(tr/(+s.cab||1))} por cabeça). Não levam o custo de compra: no lote destino a compra deles é calculada pelo preço de simulação do lote.</p>`;})()}
    <button class="primary" data-g="salvaAchou" data-id="${s.uid}">✔ Lançar os achados</button></section>`;}
function salvaAchou(id){const s=JSON.parse(JSON.stringify(G.it[id])),o=G.it[s.lote],d=fv('aDia'),cab=fn('aCab'),peso=fn('aPeso')||faltaPesos(G.it[id],G.it[G.it[id].lote]).pAt||+s.peso,nv=fv('aDest')==='__novo',p=faltaPend(s);
  if(!d||!(cab>0))return toast('Coloque a data e a quantidade');if(cab>p)return toast(`Faltam só ${nf(p)} cabeças desse lote`);if(d<s.dia)return toast('A data é antes de terem faltado');
  /* achados = transferência sem venda: levam peso de entrada, peso projetado e só o custo dos tratos (alimentação, operacional, outros); a compra é a simulação do lote destino */
  const c=s.cst||{},fr=cab/(+s.cab||1),custo=Math.round((+s.custo||0)*fr*100)/100,tr=Math.round(((+c.alim||0)+(+c.op||0)+(+c.outros||0))*fr*100)/100,pe=Math.round(faltaPesos(s,o).pe*100)/100,diaE=s.diaE||o.ent.diaE||o.ent.dia,pA=Math.round(peso*100)/100;let dest;
  if(nv){const N={nome:fv('tN_nome'),c:fv('tN_c'),r:fv('tN_r'),obs:fv('tN_obs')||s.obs};if(!N.nome)return toast('Coloque o nome do lote novo');if(!nomeLivre(N.nome))return toast(`Já existe um lote chamado ${N.nome}`);if(!N.c)return toast('Escolha o curral');
    const P=precoSim(o),n={uid:novoId('lote'),tipo:'lote',nome:N.nome.trim(),curr:[{desde:d,c:N.c}],rac:N.r?[{desde:d,r:N.r}]:[],
      ent:{dia:d,cab,peso:pA,pesoE:pe,diaE,unid:P.unid,preco:Math.round(P.preco*100)/100,rcC:P.rc,outros:0,trz:tr,deLote:o.uid,tc:true,origem:'Achados de '+o.nome,gta:''},
      sistema:o.sistema,sexo:o.sexo,cat:o.cat,raca:o.raca,idade:o.idade,gmd:o.gmd,diasPrev:null,alvo:o.alvo,rcPrev:o.rcPrev,simPreco:o.simPreco,obs:(N.obs||'').trim()};gPut(n);dest=n.uid;}
  else{dest=fv('aDest');const B=G.it[dest];if(!B)return toast('Escolha o lote');if(d<B.ent.dia)return toast(`O ${B.nome} só começa em ${dB(B.ent.dia)}`);
    gPut({uid:novoId('entl'),tipo:'entlote',lote:dest,dia:d,cab,peso:pA,pesoE:pe,diaE,rs:tr,tc:true,de:o.uid,falta:s.uid,obs:`Achados do ${o.nome} (peso de entrada ${nf(pe,1)} kg)${s.obs?' · '+s.obs:''}`});}
  s.achados=(s.achados||[]).concat([{cab,dest,dia:d,custo}]);gPut(s);toast(`${nf(cab)} cab achados lançados`);gPilha.pop();GT={t:'lote',id:dest};gRender();}
function tLoteForm(t){
  const l=t.id?G.it[t.id]:null,e=(l&&l.ent)||{},hj=hojeKey(),novo=!l,v=k=>l?l[k]:'';
  const fs=[{k:'nome',l:t.emb?'Nome do lote novo':'Nome do lote',v:v('nome'),ph:'Ex.: Lote 1 - Nelore'}];
  const sis=l&&l.sistema==='Pasto com suplementação'?l.sistema:'Confinamento';
  if(novo&&!t.emb)fs.push({k:'sistema',l:'Local',t:'sel',op:SISTEMAS,v:sis});   /* editando: o local vem do cadastro do curral */
  if(novo&&!t.emb)fs.push({k:'curral',l:'Curral / pasto',t:'sel',op:opCurraisTipo(tipoDoSistema(sis)),v:'',ajuda:'Aparecem só os currais do local escolhido (Gestão › Currais).'});
  fs.push(
    {k:'sexo',l:'Sexo',t:'sel',op:opSexos(v('sexo')),v:sexoNorm(v('sexo')),meia:1},{k:'cat',l:'Categoria',t:'sel',op:opCats(l&&catNorm(l.cat)),v:catNorm(v('cat')),meia:1},
    {k:'raca',l:'Raça',t:'sel',op:[['','Selecione']].concat(gCfg().racas.concat(l&&l.raca&&!gCfg().racas.includes(l.raca)?[l.raca]:[]).sort(alfa).map(r=>[r,r])),v:v('raca'),meia:1},{k:'idade',l:'Idade',suf:'meses',t:'num',v:v('idade'),meia:1},
    {k:'dia',l:'Data de entrada',t:'dia',v:e.dia||hj,meia:1},{k:'cab',l:'Quantidade',t:'num',v:e.cab,meia:1},
    {k:'peso',l:'Peso médio de entrada/compra',suf:'kg',t:'num',v:e.peso,meia:1},
    {k:'unid',l:'Preço de compra em',t:'sel',op:UNID_C,v:e.unid||'arroba'},{k:'preco',l:'Preço de compra',t:'rs',v:e.preco,meia:1},{k:'rcC',l:'Rendimento de carcaça na compra',suf:'%',t:'num',v:e.rcC||50,meia:1,ajuda:'Compra por @: peso × rendimento ÷ 15. 50% é o mesmo que peso vivo ÷ 30.'},{k:'cGrupo',l:'Compra na alteração em grupo',t:'sel',op:[['0','🔒 Bloqueada (não muda pela lista)'],['1','✓ Liberada (pode mudar pela lista)']],v:l&&l.compraGrupo===false?'0':'1'},
    {k:'outros',l:'Frete, comissão e outros da compra',suf:'total',t:'rs',v:e.outros,meia:1},{k:'vTotC',l:'Valor total da compra (entrada)',t:'rs',v:'',meia:1,ajuda:'Calculado pelo preço; digitando o valor total, o preço é calculado.'},
    );
  if(novo)fs.push({k:'racao',l:'Ração',t:'sel',op:opRacoes(),v:''});
  fs.push({k:'gmd',l:'Ganho por dia (meta)',suf:'kg/cab/dia',t:'num',v:l?l.gmd:1.5,meia:1},{k:'diasPrev',l:'Dias de cocho previstos',t:'num',v:v('diasPrev'),meia:1},
    {k:'alvo',l:'Peso de saída desejado',suf:'kg',t:'num',v:v('alvo'),meia:1},{k:'rcPrev',l:'Estimativa de venda · rendimento de carcaça',suf:'%',t:'num',v:v('rcPrev')||'',meia:1},{k:'simPreco',l:'Estimativa de venda · preço da @',t:'rs',v:l&&l.simPreco?l.simPreco:'',meia:1},
    {k:'obs',l:'Observação',v:v('obs')});
  return `${t.emb?'':voltar()}<section class="panel">${t.emb?'<h2>Dados do lote novo e da entrada</h2>':novo?'<h2>Novo lote</h2>':`<div class="gLoteTopo">${seloCurral(curralEm(l,hj))}<div><h2>Editar lote</h2><p class="note"><b>${esc(l.nome)}</b></p></div></div>`}<div class="gForm">${fs.map(campo).join('')}</div>
    <div id="gLfTot" class="gApRes"></div>
    ${novo?'':'<p class="note">Curral e ração mudam pelos botões “Mudar curral” e “Mudar ração” do lote, com a data da mudança.</p>'}
    <button class="primary" data-g="salvaLote" data-id="${t.id||''}">Salvar</button></section>`;
}
/* editar lote: valor total da compra ↔ preço, e o total com as entradas de animais depois */
function lfCalc(q){const box=$('gLfTot');if(!box||!$('gf_preco'))return;const l=GT.id?G.it[GT.id]:null,cab=fn('cab'),peso=fn('pesoC')>0?fn('pesoC'):fn('peso'),u=fv('unid')||'arroba',rc=fn('rcC')>0?fn('rcC'):50;
  const base=u==='cab'?cab:u==='kg'?cab*peso:u==='arrV'?cab*peso/30:cab*peso*rc/100/15;
  if(base>0){if(q==='vTotC'){const v=fn('vTotC');if(v>0)$('gf_preco').value=rsIn(Math.round(v/base*100)/100);}else if(fn('preco')>0)$('gf_vTotC').value=rsIn(Math.round(base*fn('preco')*100)/100);}
  const ent=(fn('vTotC')||0)+(fn('outros')||0),E=l?entradasDe(l):[],eTot=E.reduce((a,x)=>a+(+x.rs||0),0),eCab=E.reduce((a,x)=>a+(+x.cab||0),0);
  box.innerHTML=`<div class="gLinhas">${lin(`Entrada · ${nf(cab)} cab${u==='arroba'?` · ${nf(base,2)} @`:''}`,rs(ent))}${E.length?lin(`Entradas depois · +${nf(eCab)} cab (${E.length}×)`,rs(eTot)):''}${lin(`<b>Total da compra do lote</b> · ${nf(cab+eCab)} cab`,rs(ent+eTot)+`<small> · ${rs((ent+eTot)/((cab+eCab)||1))}/cab</small>`)}</div>`;}
/* entrada do lote corrigida depois: refaz os custos (compra, alimentação, operacional, outros) que cada saída levou, na ordem das datas */
/* lançamento com data passada que muda quem estava num curral (lote novo, transferência, mudança de curral, entrada):
   refaz o custo guardado nas saídas de todos os lotes que passaram por esse curral desde a data (o trato daqueles dias passa a ser dividido de novo) */
function recalcCurral(c,d){if(!c||!d)return 0;const hj=hojeKey();let n=0;gTodos('lote').forEach(L=>{let x=d;for(let k=0;k<800&&x<=hj;k++,x=somaDias(x,1)){if(curralEm(L,x)===c&&cabPres(L,x)>0){n+=recalcSaidas(L)||0;break;}}});return n;}
function recalcSaidas(l){const sd=saidasDe(l).filter(s=>(s.cst||s.mot==='morte')&&s.mot!=='apart');if(!sd.length)return 0;
  const antes=new Map(sd.map(s=>[s.uid,JSON.stringify(s.cst)]));sd.forEach(s=>{s.cst=null;});
  const dias=[...new Set(sd.map(s=>s.dia))].sort(),r2=v=>Math.round(v*100)/100,CAT=['compra','alim','op','outros'];
  dias.forEach(d=>{const g=sd.filter(s=>s.dia===d),K=custoAteDia(l,d),tem=cabPres(l,d,saidasDe(l).filter(x=>!g.includes(x))),pm=pesoEm(l,d);
    const kg=s=>(+s.cab||0)*((+s.peso)>0?+s.peso:pm),cabG=g.reduce((a,s)=>a+(+s.cab||0),0),todos=cabG>=tem,base=g.reduce((a,s)=>a+kg(s),0)+Math.max(0,tem-cabG)*pm;
    const ult=todos?(g.find(s=>ehVenda(s))||g[g.length-1]):null,soma={compra:0,alim:0,op:0,outros:0};
    g.filter(s=>s!==ult).forEach(s=>{const sh=base>0?kg(s)/base:0,shC=tem>0?(+s.cab||0)/tem:0,c={};const cg=s.grp?compraDoGrupo(l,d,+s.cab||0,s.grp,s.uid):null;CAT.forEach(k=>{c[k]=k==='compra'&&cg!=null?cg:r2(K[k]*(k==='compra'?shC:sh));soma[k]+=c[k];});s.cst=c;});
    if(ult){const c={};CAT.forEach(k=>c[k]=r2(K[k]-soma[k]));ult.cst=c;}});
  let n=0;sd.forEach(s=>{if(JSON.stringify(s.cst)===antes.get(s.uid))return;n++;const x=JSON.parse(JSON.stringify(s));const tot=CAT.reduce((a,k)=>a+(+x.cst[k]||0),0);
    if(x.mot==='venda')x.custo=custoSai(x);else x.custo=r2(tot);
    gPut(x);if(x.mot==='transf'&&!(+x.vi>0)&&x.entl&&G.it[x.entl]){const e=JSON.parse(JSON.stringify(G.it[x.entl]));e.rs=r2(tot);gPut(e);}});
  return n;}
function salvaLote(id){
  const nome=fv('nome'),dia=fv('dia'),cab=fn('cab'),peso=fn('peso');
  if(!nome)return toast('Coloque o nome do lote');if(!dia)return toast('Coloque a data de entrada');
  if(!(cab>0))return toast('Coloque as cabeças');if(!(peso>0))return toast('Coloque o peso médio de entrada');
  const l=id?JSON.parse(JSON.stringify(G.it[id])):{uid:novoId('lote'),tipo:'lote',curr:[],rac:[]};
  if(!id){const c=fv('curral');if(!c)return toast('Escolha o curral');l.curr=[{desde:dia,c}];const r=fv('racao');l.rac=r?[{desde:dia,r}]:[];}
  else{if(l.curr.length&&l.curr[0].desde>dia)l.curr[0].desde=dia;if(l.rac.length&&l.rac[0].desde>dia)l.rac[0].desde=dia;}
  const e0=l.ent||{};l.nome=nome;l.ent={dia,cab,peso,pesoC:null,unid:fv('unid'),preco:fn('preco'),rcC:fn('rcC')||50,outros:fn('outros')||0,origem:e0.origem||'',gta:e0.gta||''};
  if($('gf_sexo')&&!fv('sexo'))return toast('Escolha o sexo do lote');if($('gf_sistema'))l.sistema=fv('sistema');l.sexo=fv('sexo');l.cat=fv('cat');l.raca=fv('raca');l.idade=fn('idade')||null;
  l.gmd=fn('gmd')||0;l.diasPrev=fn('diasPrev')||null;l.alvo=fn('alvo')||null;l.rcPrev=fn('rcPrev')||null;l.simPreco=fn('simPreco')||null;l.compraGrupo=fv('cGrupo')!=='0';l.obs=fv('obs');
  gPut(l);if(GT.t==='entNova'){recalcCurral(fv('curral'),dia);toast(`Lote ${l.nome} criado com ${nf(cab)} cab`);return gVoltar();}{const n=recalcSaidas(l);toast(n?`Lote salvo · custos de ${n} saída(s) refeitos`:'Lote salvo');}gPilha.pop();GT={t:'lote',id:l.uid};window.scrollTo({top:0});gRender();setTimeout(()=>{window.scrollTo({top:0});try{gRender();}catch(e){}},60);
}
/* previsão de abate do lote: pelo peso desejado (meta de ganho) ou pelos dias de cocho previstos */
/* passado=true (Resumo): se já passou do peso, a data volta para o dia em que atingiu (os dias que faltam ficam negativos) */
function projAbate(l,passado){try{const hj=hojeKey();if(fimLote(l)&&fimLote(l)<=hj)return null;const pj=pesoEm(l,hj);
  if(l.alvo&&l.gmd>0){const n=Math.ceil((l.alvo-pj)/l.gmd),d=somaDias(hj,passado?n:Math.max(0,n));return {dia:d,peso:passado?+l.alvo:Math.max(+l.alvo,pj),atual:pj,por:'peso desejado'};}
  if(l.diasPrev&&l.ent&&l.ent.dia){const d=somaDias(l.ent.dia,+l.diasPrev);return {dia:d,peso:d>hj||passado?pesoEm(l,d):pj,atual:pj,por:'dias de cocho'};}
  return null;}catch(e){return null;}}
/* ---------- Entrada de animais e Saída de animais (quadros próprios na Gestão; os formulários são os mesmos dos lotes) ---------- */
const PER_ES=[[30,'30 dias'],[90,'90 dias'],[365,'1 ano'],[0,'Tudo']];
const perBts=(g,per)=>`<div class="linhas">${PER_ES.map(([n,t])=>`<button data-g="${g}" data-n="${n}" class="${per===n?'sel':''}">${t}</button>`).join('')}</div>`;
function opLotesSel(comArq,hj){const at=lotesAtivos().sort(porCurral),arq=comArq?gTodos('lote').filter(l=>!ativo(l)).sort(porNome):[];
  return at.map(o=>[o.uid,`${curralEm(o,hj)||'—'} · ${o.nome} · ${nf(cabAtual(o))} cab`]).concat(arq.map(o=>[o.uid,`(arquivado) ${o.nome}`]));}
const loteCel=(l,extra)=>l?`<a class="gLink" data-g="lote" data-id="${l.uid}">${esc(l.nome)}</a><small>${esc([curralEm(l,fimLote(l)||hojeKey()),extra].filter(Boolean).join(' · '))}</small>`:'—';
const dCurto=d=>dB(d).slice(0,6)+dB(d).slice(8);
/* filtro do histórico: local (Confinamento / Pasto) e curral, pelo curral em que o lote estava na data */
/* opções dos filtros do histórico (padrão do sistema: título na esquerda, ◀ quadrinho ▶) */
function hOps(t){const fl=t.fl||'T',A=window.curraisApi,cs=(A?A.lista():[]).filter(n=>fl==='T'||(A.info(n).tipo===fl)).sort(alfa);
  return {per:PER_ES.map(([n,tx])=>[String(n),tx]),loc:(window.LOC_OPS||[['T','Todos'],['C','Confinamento'],['P','Pasto']]),cur:[['','Todos']].concat(cs.map(n=>[n,n]))};}
const hVal=(t,k)=>k==='per'?String(t.per!=null?t.per:90):k==='loc'?(t.fl||'T'):(t.fc||'');
function filtroHist(t){const fl=t.fl||'T',fc=t.fc||'',O=hOps(t);
  const nav=(k,lbl)=>{const L=O[k],i=Math.max(0,L.findIndex(o=>o[0]===hVal(t,k)));return typeof selSetas==='function'?selSetas(lbl,L,i,`data-g="hNav" data-k="${k}" data-n`,`data-hsel="${k}"`):'';};
  const hj=hojeKey(),di=t.dIni||somaDias(hj,-30),df=t.dFim||hj;
  const html=`<div class="gForm gHistPer"><div class="gCampo meia"><label>Período: de</label><input type="date" data-hdt="ini" value="${di}"></div><div class="gCampo meia"><label>até</label><input type="date" data-hdt="fim" value="${df}"></div></div>
    <div class="gCoLocNav gHistFil">${nav('loc','Local')}${nav('cur','Curral')}</div>`;
  const passa=(l,dia)=>{const c=curralEm(l,dia);if(fc)return c===fc;if(fl==='T')return true;return linhaDe(c)===fl;};
  return {html,passa};}
function tEntradas(t){const hj=hojeKey(),desde=t.dIni||somaDias(hj,-30),ate=t.dFim||hj;
  const op=[['','Selecione'],['__novo','＋ Criar lote novo (escolher o curral)']].concat(opLotesSel(true,hj));
  const R=[];
  gTodos('lote').forEach(l=>{const e=l.ent;if(!e||!e.dia)return;const vi=valorCompra(l)-entradasDe(l).reduce((a,x)=>a+(+x.rs||0),0);
    R.push({k:'lote',dia:e.dia,l,cab:+e.cab||0,peso:+e.peso||0,rs:vi,orig:e.origem||(l.apDe?'Apartação':'Compra · lote novo')});});
  gTodos('entlote').forEach(x=>{const l=G.it[x.lote];if(!l||l.del)return;const tr=x.transf&&G.it[x.transf],de=tr&&G.it[tr.lote];
    R.push({k:'ent',x,dia:x.dia,l,cab:+x.cab||0,peso:+x.peso||0,rs:+x.rs||0,orig:x.falta?'Animais achados':de?(x.vi?'Compra (venda interna) de ':'Transferência de ')+de.nome:x.obs||'Compra',auto:!!(x.transf||x.falta)});});
  const FH=filtroHist(t);
  const L=R.filter(r=>r.dia>=desde&&r.dia<=ate&&FH.passa(r.l,r.dia)).sort((a,b)=>b.dia.localeCompare(a.dia)||(b.k==='lote')-(a.k==='lote'));
  const tot=L.reduce((a,r)=>a+r.cab,0);
  const linhas=L.map(r=>`<tr><td>${dCurto(r.dia)}<div class="gAcHist">${r.k==='lote'?`<button class="mini" data-g="ir" data-t="loteForm" data-id="${r.l.uid}" title="Alterar (editar lote)">✎</button>${(()=>{const tr=gTodos('saida').find(x=>x.mot==='transf'&&x.novoLote&&x.destino===r.l.uid);
        return tr?`<button class="mini danger" data-g="apaga" data-id="${tr.uid}" data-o="transferência (o lote ${esc(r.l.nome)} criado nela também é apagado e os animais voltam)" title="Desfazer a transferência">✕</button>`
          :`<button class="mini danger" data-g="apagaLote" data-id="${r.l.uid}" title="Apagar o lote">✕</button>`;})()}`
      :`${r.x.falta?'':r.x.transf?((()=>{const tr=G.it[r.x.transf];return tr&&!tr.del?`<button class="mini" data-g="ir" data-t="transfForm" data-id="${tr.lote}" data-old="${tr.uid}" title="Alterar a transferência">✎</button>`:'';})()):`<button class="mini" data-g="entEd" data-id="${r.l.uid}" data-eid="${r.x.uid}">✎</button>`}<button class="mini danger" data-g="apaga" data-id="${r.x.uid}" data-o="${r.x.transf?'entrada (apaga também a transferência)':'entrada de animais'}">✕</button>`}</div></td><td class="c">${loteCel(r.l,r.orig)}</td><td>${r.k==='ent'?'+':''}${nf(r.cab)}</td><td>${nf(r.peso)}</td><td>${r.rs>0?nf(r.rs):'—'}</td></tr>`).join('');
  return `<section class="panel"><h2>📥 Entrada de animais</h2>
    <button class="primary" data-g="ir" data-t="entNova">＋ Nova entrada</button></section>
  <section class="panel"><h2>Histórico de entradas</h2>${FH.html}
    ${L.length?`<div class="tablebox"><table class="gTab"><thead><tr><th>Data</th><th>Lote · origem</th><th>Qtd.</th><th>Peso</th><th>Valor R$</th></tr></thead><tbody>${linhas}
    <tr class="grp"><td>Total</td><td>${nf(L.length)} entrada(s)</td><td>${nf(tot)}</td><td></td><td>${nf(L.reduce((a,r)=>a+(r.rs>0?r.rs:0),0))}</td></tr></tbody></table></div>
    <p class="note">✎ altera · ✕ exclui. A primeira entrada de cada lote se altera em "Editar lote". Entradas que vieram de transferência se apagam junto com a transferência; animais achados, no lote de origem.</p>`:'<p class="note">Nenhuma entrada nesse período.</p>'}</section>`;}
/* Pesagem: escolhe o lote (com o curral) e vai para a pesagem dele */
function tPesNova(t){const hj=hojeKey();return `${voltar('Lotes')}<section class="panel"><h2>⚖️ Pesagem</h2><p class="note">Escolha o lote que foi pesado (aparece o curral em que ele está).</p>
  <div class="gForm">${campo({k:'pnLote',l:'Lote',t:'sel',busca:1,op:[['','Selecione']].concat(opLotesSel(false,hj)),v:t.lote||''})}</div>
  <button class="primary" data-g="pesNovaOk">Continuar ▸</button></section>`;}
/* Nova entrada: o lote de entrada é escolhido aqui; lote novo abre ao lado o local e o curral de entrada */
function tEntNova(t){const hj=hojeKey(),arq=gTodos('lote').filter(l=>!ativo(l));
  let sel=t.sel!=null?t.sel:(t.lote||'');if(sel&&G.it[sel]&&!ativo(G.it[sel])){t.arq=sel;sel=t.sel='__arq';}
  const opSel=[['','Selecione'],['__novo','＋ Criar lote novo']].concat(opLotesSel(false,hj)).concat(arq.length?[['__arq',`📦 Lotes arquivados (${arq.length})`]]:[]);
  let topo=campo({k:'enSel',l:'Lote de entrada',t:'sel',busca:1,op:opSel,v:sel}),corpo='';
  if(sel==='__arq'){const ca=l=>curralEm(l,fimLote(l)||hj)||'—';
    const opA=[['','Selecione']].concat(arq.slice().sort((a,b)=>alfa(ca(a),ca(b))||alfa(a.nome,b.nome)).map(l=>[l.uid,`${ca(l)} · ${l.nome}${fimLote(l)?' · saiu '+dCurto(fimLote(l)):''}`]));
    topo+=campo({k:'enArq',l:'Lote arquivado (módulo · lote)',t:'sel',busca:1,op:opA,v:t.arq||''});sel=t.arq||'';}
  if(sel==='__novo'){const sis=t.sis||'Confinamento';topo+=campo({k:'sistema',l:'Local de entrada',t:'sel',op:SISTEMAS,v:sis,meia:1})+campo({k:'curral',l:'Curral de entrada',t:'sel',busca:1,op:opCurraisTipo(tipoDoSistema(sis)),v:'',meia:1});corpo=tLoteForm({emb:1});}
  else if(sel&&G.it[sel]){const l=G.it[sel],cE=curralEm(l,ativo(l)?hj:(fimLote(l)||hj));topo+=`<div class="gCampo meia"><label>Local de entrada</label><div class="gInfoBox">${esc(linhaDe(cE)==='P'?'Pasto':'Confinamento')}</div></div><div class="gCampo meia"><label>Curral de entrada</label><div class="gInfoBox">${esc(cE||'—')}</div></div>`;GT.id=sel;corpo=tEntForm({id:sel,emb:1});}
  return `${voltar(t.raiz==='lotes'?'Lotes':'Entrada de animais')}<section class="panel"><h2>＋ Nova entrada de animais</h2><div class="gForm">${topo}</div>${sel?'':'<p class="note">Escolha o lote de entrada ou “＋ Criar lote novo”.</p>'}</section>${corpo}`;}
/* Nova saída: primeiro o tipo (botão), depois o lote de saída; o formulário do tipo abre embaixo */
const SAI_TIT={saiForm:'💲 Venda / saída',fechaForm:'💲 Venda + sobra',transfForm:'↔ Transferência',apartForm:'✂ Apartar / dividir',morte:'✝ Morte'};
function saiTopo(t){const hj=hojeKey(),l=t.id&&G.it[t.id];
  let h=campo({k:'saSel',l:'Lote de saída',t:'sel',busca:1,op:[['','Selecione']].concat(opLotesSel(false,hj)),v:l?l.uid:''});
  if(l){const c=curralEm(l,hj);h+=`<div class="gCampo meia"><label>Local de saída</label><div class="gInfoBox">${esc(linhaDe(c)==='P'?'Pasto':'Confinamento')}</div></div><div class="gCampo meia"><label>Curral de saída</label><div class="gInfoBox">${esc(c||'—')}</div></div>`;}
  return `${voltar('Saída de animais')}<section class="panel"><h2>${SAI_TIT[t.ft==='saiForm'&&t.o==='morte'?'morte':t.ft]||'Saída de animais'}</h2><div class="gForm">${h}</div>${l?'':'<p class="note">Escolha o lote de saída.</p>'}</section>`;}
const tSaiSel=t=>saiTopo(t);
const tipoSai=s=>s.mot==='morte'?'✝ Morte':s.mot==='transf'?(+s.vi>0?'↔ Venda interna':'↔ Transferência'):s.mot==='apart'?'✂ Apartação':s.mot==='falta'?'❓ Faltou / sumiu':'💲 Venda';
function tSaidas(t){const hj=hojeKey(),desde=t.dIni||somaDias(hj,-30),ate=t.dFim||hj;
  const op=[['','Selecione']].concat(opLotesSel(false,hj));
  const FH=filtroHist(t);
  const L=gTodos('saida').filter(x=>G.it[x.lote]&&!G.it[x.lote].del&&x.dia>=desde&&x.dia<=ate&&FH.passa(G.it[x.lote],x.dia)).sort((a,b)=>b.dia.localeCompare(a.dia));
  const dest=s=>{const d=s.destino&&G.it[s.destino];if(d&&!d.del)return '→ '+d.nome;if(ehVenda(s))return nomeCpr(s)||'';return [s.causa,s.obs].filter(Boolean).join(' · ');};
  const linhas=L.map(s=>{const l=G.it[s.lote],v=ehVenda(s)?valorVenda(s):s.mot==='transf'&&+s.vi>0?+s.vi:NaN;
    return `<tr><td>${dCurto(s.dia)}<div class="gAcHist">${s.mot==='transf'&&!s.novoLote&&s.entl?`<button class="mini" data-g="ir" data-t="transfForm" data-id="${l.uid}" data-old="${s.uid}" title="Alterar a transferência">✎</button>`:''}${ehVenda(s)||s.mot==='morte'?`<button class="mini" data-g="ir" data-t="saiForm" data-id="${l.uid}" data-o="${s.mot==='morte'?'morte':'venda'}" data-sid="${s.uid}">✎</button>`:''}${s.mot==='apart'?`<button class="mini" data-g="lote" data-id="${l.uid}" title="Desfazer no lote">▸</button>`:`<button class="mini danger" data-g="apaga" data-id="${s.uid}" data-o="${s.mot==='transf'?'transferência (volta os animais e o custo para o lote de origem)':'saída'}">✕</button>`}</div></td><td class="c"><b>${tipoSai(s)}</b><br>${loteCel(l,dest(s))}</td><td>${nf(s.cab)}</td><td>${s.mot==='morte'?'—':nf(s.peso)}</td><td>${ok(v)&&v>0?nf(v):'—'}</td></tr>`;}).join('');
  const soma=f=>L.filter(f).reduce((a,s)=>a+(+s.cab||0),0);
  const B=(t2,o,ic,txt,cls)=>`<button class="${cls||''}" data-g="saiNova" data-t="${t2}"${o?` data-o="${o}"`:''}>${ic} ${txt}</button>`;
  return `<section class="panel"><h2>📤 Saída de animais</h2>
    <p class="note">Toque no tipo de saída; na próxima tela escolha o lote de saída.</p>
    <div class="gAcoes gSaiTipos">${B('saiForm','venda','💲','Venda / saída','lima')}${B('fechaForm','','💲','Venda + sobra','lima')}${B('transfForm','','↔','Transferência')}${B('apartForm','','✂','Apartar / dividir')}${B('saiForm','morte','✝','Morte')}</div></section>
  <section class="panel"><h2>Histórico de saídas</h2>${FH.html}
    ${L.length?`<div class="tablebox"><table class="gTab"><thead><tr><th>Data</th><th>Saída · lote</th><th>Qtd.</th><th>Peso</th><th>Valor R$</th></tr></thead><tbody>${linhas}
    <tr class="grp"><td>Total</td><td>${nf(L.length)} saída(s)</td><td>${nf(soma(()=>true))}</td><td></td><td>${nf(L.filter(ehVenda).reduce((a,s)=>a+valorVenda(s),0))}</td></tr></tbody></table></div>
    <p class="note">Vendidos ${nf(soma(ehVenda))} · transferidos ${nf(soma(s=>s.mot==='transf'))} · apartados ${nf(soma(s=>s.mot==='apart'))} · mortes ${nf(soma(s=>s.mot==='morte'))}${soma(s=>s.mot==='falta')?' · faltaram '+nf(soma(s=>s.mot==='falta')):''}. ✎ altera a venda · ✕ exclui (transferência volta os animais) · apartação se desfaz no lote (▸).</p>`:'<p class="note">Nenhuma saída nesse período.</p>'}</section>`;}
/* ---------- ficha de cada lote ---------- */
function tLote(t){
  const l=G.it[t.id];if(!l||l.del)return `${voltar()}<p class="note">Lote não encontrado.</p>`;
  const hj=hojeKey(),cab=cabAtual(l),fim=fimLote(l),ref=fim||hj,X=gCtx(),dRef=t.dia||(fim||hj);GT.dia=dRef;const x=diaLote(l,dRef,X),dd=dB(dRef).slice(0,5);
  const r=racaoEm(l,ref),pz=pesagensDe(l),sd=saidasDe(l),cs=custosDe(l),pj=pesoEm(l,ref),e=l.ent;
  /* saída prevista: pelo peso desejado (meta de ganho) ou pelos dias de cocho previstos */
  let saiDia=null,saiPor='';if(!fim&&l.alvo&&l.gmd>0){saiDia=somaDias(hj,Math.max(0,Math.ceil((l.alvo-pj)/l.gmd)));saiPor=`peso ${nf(l.alvo)} kg`;}
  else if(!fim&&l.diasPrev){saiDia=somaDias(e.dia,l.diasPrev);saiPor=`${nf(l.diasPrev)} dias de cocho`;}
  let ant={dia:e.dia,peso:+e.peso};
  const lp=pz.map((p,ip)=>{const d2=difDias(ant.dia,p.dia),pr=pesoEm(l,p.dia,pz.slice(0,ip)),g=d2>0?(+l.gmd||0)+(p.peso-pr)/d2:NaN;ant=p;   // com entrada de animais no meio, compara com o peso já misturado
    return `<tr><td>${dB(p.dia)}</td><td>${nf(p.peso)}${p.proj?`<small class="${p.peso>=p.proj?'ok':'bad'}">proj. ${nf(p.proj)}</small>`:''}</td><td>${nf(g,3)}</td><td>${p.cab?nf(p.cab):'—'}</td><td class="acoes"><button class="mini danger" data-g="apaga" data-id="${p.uid}" data-o="pesagem">✕</button></td></tr>`;}).join('');
  const ls=sd.map(s=>`<tr><td>${dB(s.dia)}</td><td>${s.mot==='falta'?'Faltou / sumiu'+`<small>${s.obs?esc(s.obs)+' · ':''}custo ${rs(+s.custo||0)}${(s.achados||[]).length?` · achados ${nf((s.achados||[]).reduce((a,x)=>a+(+x.cab||0),0))}`:''}${s.excl?` · excluídos ${nf(+s.excl.cab||0)}`:''}</small>`:s.mot==='transf'?'Transferência'+(G.it[s.destino]?`<small>→ ${esc(G.it[s.destino].nome)}${+s.vi>0?'':` · leva ${rs(+s.custo||0)}`}</small>`:''):s.mot==='apart'?'Apartação'+(G.it[s.destino]?`<small>→ ${esc(G.it[s.destino].nome)}</small>`:''):s.mot==='morte'?'Morte':'Venda'+(s.comp&&G.it[s.comp]?`<small>${esc(G.it[s.comp].nome)}</small>`:'')}</td><td>${nf(s.cab)}</td><td>${s.mot==='morte'?'—':nf(s.peso)}</td><td>${s.mot==='transf'&&+s.vi>0?rs(+s.vi)+'<small>venda interna</small>':s.mot==='morte'||s.mot==='apart'||s.mot==='transf'||s.mot==='falta'?'—':rs(valorVenda(s))}</td><td class="acoes">${s.mot==='apart'||s.mot==='transf'||s.mot==='morte'||s.mot==='falta'?'':`<button class="mini" data-g="ir" data-t="saiForm" data-id="${l.uid}" data-o="venda" data-sid="${s.uid}">✎</button>`}${s.mot==='apart'?'':`<button class="mini danger" data-g="apaga" data-id="${s.uid}" data-o="${s.mot==='transf'?'transferência (volta os animais e o custo para este lote)':'saída'}">✕</button>`}</td></tr>${(()=>{const r=resSai(s);return ok(r)?`<tr class="gSaiRes"><td colspan="6"><div>compra ${rs(crDe(s))} + custos ${rs(custoSai(s)-crDe(s))} = ${rs(custoSai(s))} · <b class="${r>=0?'ok':'bad'}">${r>=0?'lucro':'prejuízo'} ${rs(r)}</b></div></td></tr>`:'';})()}`).join('');
  const lc=cs.map(c=>`<tr><td>${dB(c.dia)}</td><td>${esc(c.cat)}${c.desc?`<small>${esc(c.desc)}</small>`:''}</td><td>${rs(+c.rs)}</td><td class="acoes"><button class="mini danger" data-g="apaga" data-id="${c.uid}" data-o="despesa">✕</button></td></tr>`).join('');
  const hist=(arr,fmt,o)=>(arr||[]).map((h,i)=>`<tr><td>${dB(h.desde)}</td><td>${esc(fmt(h))}</td><td class="acoes">${i?`<button class="mini danger" data-g="apagaHist" data-id="${l.uid}" data-o="${o}" data-i="${i}">✕</button>`:''}</td></tr>`).join('');
  const N=GT.evN||15,pts=dadosEvol(l,dRef,N);
  const tabDias=pts.slice().reverse().map(p=>{const y=diaLote(l,p.d,X),lt=y?G.it[idLeit(p.d,y.c)]:null;return `<tr><td>${dB(p.d).slice(0,5)}</td><td>${y?nf(y.mn):'—'}</td><td>${nf(p.ims,2)}</td><td>${pc(p.pv,2)}</td><td>${lt&&!lt.del?notaTxt(lt.nota):'—'}</td></tr>`;}).join('');
  const ficha=[['Local',l.sistema],['Sexo',sexoTxt(l.sexo)],['Raça',l.raca],['Categoria',catNorm(l.cat)],['Idade',l.idade?nf(l.idade)+' meses':''],
    ['Entrada',`${dB(e.dia)} · ${nf(e.cab)} cab · ${nf(e.peso)} kg`],['Peso de compra',e.pesoC?`${nf(e.pesoC)} kg · quebra ${pc((e.pesoC-e.peso)/e.pesoC*100,1)}`:''],
    ['Entradas depois',entradasDe(l).length?`${entradasDe(l).length}× · +${nf(cabEntTot(l)-(+e.cab||0))} cab · total ${nf(cabEntTot(l))} cab`:''],
    ['Compra',`${rs(valorCompra(l))} (${rs(valorCompra(l)/cabEntTot(l))}/cab)`],['Peso desejado',l.alvo?nf(l.alvo)+' kg':''],['Dias de cocho previstos',l.diasPrev?`${nf(l.diasPrev)} (até ${dB(somaDias(e.dia,l.diasPrev))})`:''],
    ['Rendimento esperado',l.rcPrev?pc(l.rcPrev,1):'']].filter(x=>x[1]);
  const projTxt=fim?'':[30,60,90].map(n=>`+${n} dias: <b>${nf(pesoEm(l,somaDias(hj,n)))} kg</b>`).join(' · ');
  const lt=x?G.it[idLeit(dRef,x.c)]:null,cusDia=x?((ok(x.custoR)?x.custoR:0)+x.custoOp):NaN;
  return `${voltar('Lotes')}<section class="panel"><div class="gLoteTopo">${seloCurral(curralEm(l,ref))}<div><h2>${esc(l.nome)}</h2><span class="pill${fim?'':' done'}">${fim?'Arquivado em '+dB(fim):'Ativo'}</span>
      ${(()=>{const t=[sexoTxt(l.sexo),l.raca,catNorm(l.cat)].filter(x=>x&&x!=='—').join(' · ');return t?`<p class="note">${esc(t)}</p>`:'';})()}${l.obs?`<p class="note">📝 ${esc(l.obs)}</p>`:''}</div></div>
    <div class="stat gStat3">${st('Cabeças',nf(cab))}${st('Dias',nf(difDias(e.dia,ref)))}${st(fim?'Peso final':'Peso hoje',nf(pj)+' kg')}
      ${st('GMD meta',nf(l.gmd,2)+' kg')}${st('Ração',esc(r?r.nome:'—'))}${st('Saída prevista',saiDia?dB(saiDia).slice(0,5)+`<small>${saiPor}</small>`:'—')}</div>
    <div class="gAcoes">
      <button data-g="ir" data-t="loteForm" data-id="${l.uid}">✎ Editar dados</button>${fim?'':`
      <button data-g="ir" data-t="custoForm" data-id="${l.uid}">💉 Outros custos</button>`}
    </div>
    ${apInfo(l)}<button class="primary" data-g="ir" data-t="rel" data-id="${l.uid}">📊 ${partesApart(l).length?'Relatório da apartação':fim?'Relatório final':'Resultado até hoje'}</button></section>
  <section class="panel gDiaBox">${navData('gRefDia',dRef,'Consumo do dia')}
    ${x?(()=>{const t=x.mn>0,v=(s)=>t?s:'—';return `<div class="stat gStat3">${st('MN no cocho',v(nf(x.mn)+' kg'))}${st('MN/cab',v(nf(x.mnCab,2)+' kg'))}${st('MS/cab',v(nf(x.msCab,2)+' kg'))}
      ${st('% do peso vivo',v(pc(x.pv,2)))}${st('Custo/cab',rs(cusDia/x.cab))}${st('Nota leitura',lt&&!lt.del?notaTxt(lt.nota):'—')}</div>`;})()+`
    ${x.mn>0?'':`<p class="aviso warn">Sem trato lançado no ${esc(x.c)} em ${dd}.</p>`}`:`<p class="note">O lote não estava no cocho em ${dd}.</p>`}
  </section>
  ${card('Evolução do consumo',`<div class="linhas">${[7,15,30].map(n=>`<button data-g="evolN" data-n="${n}" class="${N===n?'sel':''}">${n} dias</button>`).join('')}</div>${svgEvol(pts)}
    <details class="gMais"><summary>Ver os ${pts.length} dias em tabela</summary><div class="tablebox"><table class="gTab"><thead><tr><th>Dia</th><th>MN kg</th><th>MS/cab</th><th>% IMS</th><th>Nota</th></tr></thead><tbody>${tabDias}</tbody></table></div></details>`)}
  ${card('Pesagens',`<div class="tablebox"><table class="gTab"><thead><tr><th>Data</th><th>Peso</th><th>GMD real</th><th>Qtd.</th><th></th></tr></thead><tbody>
    <tr><td>${dB(e.dia)}</td><td>${nf(e.peso)}</td><td>entrada</td><td>${nf(e.cab)}</td><td></td></tr>${lp}</tbody></table></div>${projTxt?`<p class="note">Projeção: ${projTxt}</p>`:''}`)}
  ${entradasDe(l).length?card('Entradas de animais',`<div class="tablebox"><table class="gTab"><thead><tr><th>Data</th><th>Qtd.</th><th>Peso médio</th><th>Peso total</th><th>Observação</th><th></th></tr></thead><tbody>
    <tr><td>${dB(e.dia)}</td><td>${nf(e.cab)}</td><td>${nf(e.peso)}</td><td>${nf((+e.cab||0)*(+e.peso||0))}</td><td>entrada do lote</td><td></td></tr>
    ${entradasDe(l).map(x=>`<tr><td>${dB(x.dia)}</td><td>+${nf(x.cab)}</td><td>${nf(x.peso)}</td><td>${nf((+x.cab||0)*(+x.peso||0))}</td><td>${esc(x.obs||'')}${+x.rs>0?`<small>${x.de?(x.vi?'compra (venda interna) ':'custo trazido '):''}${rs(+x.rs)}</small>`:''}</td><td class="acoes"><button class="mini danger" data-g="apaga" data-id="${x.uid}" data-o="entrada de animais">✕</button></td></tr>`).join('')}</tbody></table></div>
    <p class="note">Total que entrou: ${nf(cabEntTot(l))} cab · peso médio de entrada ${nf(pesoEntMed(l))} kg. O custo já lançado continua no lote e passa a ser dividido por todas as cabeças.</p>`):''}
  ${cs.length?card('Outros custos',`<div class="tablebox"><table class="gTab"><thead><tr><th>Data</th><th>Tipo</th><th>Valor</th><th></th></tr></thead><tbody>${lc}</tbody></table></div><p class="note">Total: ${rs(cs.reduce((a,c)=>a+(+c.rs||0),0))}</p>`):''}
  ${sd.length?card('Saídas',`<div class="tablebox"><table class="gTab"><thead><tr><th>Data</th><th>Tipo</th><th>Qtd.</th><th>Peso</th><th>Valor</th><th></th></tr></thead><tbody>${ls}</tbody></table></div>`):''}
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
    <div class="gForm">${[{k:'cab',l:'Quantidade pesada (opcional)',t:'num',meia:1},{k:'obs',l:'Observação',meia:1}].map(campo).join('')}</div>
    <p class="note">Depois de salvar, a projeção do peso passa a partir desta pesagem.</p>
    <button class="primary" data-g="salvaPes" data-id="${l.uid}">Salvar pesagem</button></section>`;}
function calcPes(){const l=G.it[GT.pesLote];if(!l||!$('gPesProj'))return;const dia=fv('dia')||hojeKey();
  const pz=pesagensDe(l).filter(p=>p.dia<dia);const ant=pz.length?pz[pz.length-1]:{dia:l.ent.dia,peso:+l.ent.peso,ent:1};
  const proj=pesoEm(l,dia,pz);$('gPesProj').textContent=nf(proj)+' kg';
  $('gPesProjInfo').textContent=`${ant.ent?'entrada':'última pesagem'} ${dB(ant.dia)}: ${nf(ant.peso)} kg + ${nf(l.gmd,2)} kg/dia × ${nf(difDias(ant.dia,dia))} dias`+(entradasDe(l).some(x=>x.dia>ant.dia&&x.dia<=dia)?' · com a entrada de animais no meio (peso misturado)':'');
  const p=fn('peso'),box=$('gPesRes');if(!(p>0)){box.innerHTML='';return;}
  const dif=p-proj,dd=difDias(ant.dia,dia),gmd=dd>0?(+l.gmd||0)+dif/dd:NaN,cls=dif>=0?'ok':'bad';
  box.innerHTML=st('Diferença do projetado',`<span class="${cls}">${dif>0?'+':''}${nf(dif)} kg (${dif>0?'+':''}${nf(dif/proj*100,1)}%)</span>`)+st('GMD real no período',`<span class="${gmd>=(l.gmd||0)?'ok':'bad'}">${nf(gmd,3)} kg/dia</span>`);}
function tCustoForm(t){const l=G.it[t.id];
  return `${voltar()}<section class="panel"><h2>Outros custos · ${esc(l.nome)}</h2><div class="gForm">${[
    {k:'dia',l:'Data',t:'dia',v:hojeKey(),meia:1},{k:'cat',l:'Tipo',t:'sel',op:TIPOS_CUSTO.map(x=>[x,x]),v:TIPOS_CUSTO[0],meia:1},
    {k:'desc',l:'Descrição',ph:'Ex.: Vacina aftosa + vermífugo'},{k:'rs',l:'Valor total do lote',t:'rs',meia:1}].map(campo).join('')}</div>
    <p class="note">Entra no custo do lote e no custo da @ produzida.</p>
    <button class="primary" data-g="salvaCusto" data-id="${l.uid}">Salvar</button></section>`;}
/* ---------- ✂ apartação (dividir o lote) ---------- */
function tApartForm(t){const l=G.it[t.id],hj=hojeKey();t.dia=t.dia||hj;
  if(!t.g){const r=racaoEm(l,hj),c=curralEm(l,hj);t.g=['A','B'].map(x=>({nome:`${l.nome} ${x}`,cab:'',peso:'',c,r:r?r.uid:''}));}
  const opC=opCurrais(''),opR=opRacoes('');
  const grupos=t.g.map((g,i)=>`<div class="gApGr"><div class="gApTop"><b>Lote novo ${i+1}</b>${t.g.length>2?`<button class="mini danger" data-g="apRm" data-i="${i}">✕</button>`:''}</div>
    <div class="gForm"><div class="gCampo"><label>Nome do lote</label><input type="text" data-ap="${i}|nome" value="${esc(g.nome)}" autocomplete="off"></div>
    <div class="gCampo meia"><label>Quantidade</label><input type="text" inputmode="decimal" data-ap="${i}|cab" value="${esc(g.cab)}" autocomplete="off"></div>
    <div class="gCampo meia"><label>Peso médio na pesagem <span class="gSuf">(kg)</span></label><input type="text" inputmode="decimal" data-ap="${i}|peso" value="${esc(g.peso)}" autocomplete="off"></div>
    <div class="gCampo meia"><label>Curral / pasto</label><select data-ap="${i}|c">${opC.map(([a,b])=>`<option value="${esc(a)}"${a===g.c?' selected':''}>${esc(b)}</option>`).join('')}</select></div>
    <div class="gCampo meia"><label>Ração</label><select data-ap="${i}|r">${opR.map(([a,b])=>`<option value="${esc(a)}"${a===g.r?' selected':''}>${esc(b)}</option>`).join('')}</select></div>
    <div class="gCampo"><label>Observação do lote</label><input type="text" data-ap="${i}|obs" value="${esc(g.obs||'')}" autocomplete="off" placeholder="ex.: brincos 1023, 1045"></div></div></div>`).join('');
  return `${voltar()}<section class="panel"><h2>✂ Apartar / dividir · ${esc(l.nome)}</h2>
    <p class="note">O lote <b>${esc(l.nome)}</b> fecha na data da apartação com o ganho de peso medido na pesagem (relatório da apartação). Cada lote novo leva os custos até aqui <b>proporcionais ao peso</b> (cabeças × peso médio): quem pesa mais leva mais custo.</p>
    <div class="gForm"><div class="gCampo meia"><label for="gApDia">Data da apartação (pesagem)</label><input type="date" id="gApDia" value="${t.dia}"></div></div>
    ${grupos}<button data-g="apAdd">＋ Mais um lote</button>
    ${campoFaltas('gAp',t)}
    <div id="gApRes" class="gApRes"></div>
    <button class="primary" data-g="salvaApart" data-id="${l.uid}">✂ Confirmar apartação</button></section>`;}
/* prévia: cabeças, peso e quanto de custo cada lote novo leva */
function apPrevia(){const t=GT,l=G.it[t.id],box=$('gApRes');if(!box||!l)return null;const d=t.dia,tem=cabPres(l,d);
  const ant=somaDias(d,-1),R=resumoLote(l,ant<l.ent.dia?l.ent.dia:ant),outros=custosDe(l).filter(c=>c.dia<=d).reduce((a,c)=>a+(+c.rs||0),0);
  const custo=custoAteDia(l,d).total,G_=t.g.map(g=>({...g,cab:gNum(g.cab),peso:gNum(g.peso)}));
  const kgL0=G_.reduce((a,g)=>a+(g.cab>0&&g.peso>0?g.cab*g.peso:0),0),cabL0=G_.reduce((a,g)=>a+(g.cab>0?g.cab:0),0),FC=faltaCalc(l,d,tem,t,cabL0?kgL0/cabL0:0),cabF=FC.cab,pF=FC.p,kgF=FC.kg;
  const cab=cabL0+cabF,kgL=kgL0,kg=kgL+kgF,shF=FC.fixo!=null?FC.fixo:(kg?kgF/kg:0),fL=k=>kgL?(1-shF)*k/kgL:0;
  const cabL=cab-cabF,pesoM=cabL?kgL/cabL:NaN,pE=pesoEntMed(l),ganho=kgL-cabL*pE,dias=difDias(l.ent.dia,d);
  const lin=G_.map(g=>{const k=g.cab>0&&g.peso>0?g.cab*g.peso:0;return `<tr><td>${esc(g.nome||'—')}</td><td>${nf(g.cab)}</td><td>${nf(g.peso,1)}</td><td>${pc(fL(k)*100,1)}</td><td>${rs(custo*fL(k))}<small>${rs(g.cab?custo*fL(k)/g.cab:NaN)}/cab</small></td></tr>`;}).join('')+(cabF?`<tr><td>Faltaram<small>custo fica separado</small></td><td>${nf(cabF)}</td><td>${nf(pF,1)}<small>${t.fmodo==='entrada'?'entrada':'agora'}</small></td><td>${pc(shF*100,1)}</td><td>${rs(custo*shF)}</td></tr>`:'');
  box.innerHTML=`<div class="stat gStat3">${st('Cabeças',`${nf(cab)} de ${nf(tem)}`,cab===tem?'':'bad')}${st('Peso médio',nf(pesoM,1)+' kg')}${st('Ganho (GMD)',cabL?nf(ganho/cabL/Math.max(1,dias),2)+' kg/dia':'—')}</div>
    ${cab!==tem?`<p class="aviso warn">Em ${dB(d)} o lote tem ${nf(tem)} cabeças: a soma dos lotes novos precisa dar ${nf(tem)} (${cab<tem?'faltam '+nf(tem-cab):'sobram '+nf(cab-tem)}).</p>`:''}
    <div class="tablebox"><table><thead><tr><th>Lote novo</th><th>Qtd.</th><th>Peso</th><th>% do peso</th><th>Custo que leva</th></tr></thead><tbody>${lin}</tbody></table></div>
    <p class="note">Custo do lote até a apartação: <b>${rs(custo)}</b> (compra + alimentação + operacional + outros). GMD estimado = (peso da pesagem − peso de entrada ${nf(pE,1)} kg) ÷ ${nf(dias)} dias.</p>`;
  return {tem,cab,G_,d,cabF,pF,shF};}
function apLer(){document.querySelectorAll('[data-ap]').forEach(e=>{const [i,k]=e.dataset.ap.split('|');if(GT.g&&GT.g[i])GT.g[i][k]=e.value;});const d=$('gApDia');if(d&&d.value)GT.dia=d.value;['falta','fmodo','fpeso','fpesoT','fobs'].forEach(k=>{const e=$('gAp'+k);if(e)GT[k]=e.value;});}
function salvaApart(id){apLer();const l=G.it[id],P=apPrevia();if(!P)return;const {d,tem,cab,G_,cabF,pF,shF}=P;
  if(d<l.ent.dia)return toast('A data é antes da entrada do lote');if(d>hojeKey())return toast('A data não pode ser depois de hoje');
  if(G_.some(g=>!g.nome.trim()))return toast('Coloque o nome de cada lote novo');
  if(G_.some(g=>!(g.cab>0)||!(g.peso>0)))return toast('Coloque cabeças e peso médio de cada lote novo');
  if(G_.some(g=>!g.c))return toast('Escolha o curral de cada lote novo');
  if(cab!==tem)return toast(`A soma precisa dar ${nf(tem)} cabeças`);
  const nomes=G_.map(g=>g.nome.trim().toLowerCase());if(new Set(nomes).size<nomes.length)return toast('Os lotes novos estão com o mesmo nome');
  if(gTodos('lote').some(o=>nomes.includes(String(o.nome||'').trim().toLowerCase())))return toast('Já existe um lote com esse nome');
  if(saidasDe(l).some(s=>s.dia>=d)||entradasDe(l).some(x=>x.dia>d)||pesagensDe(l).some(p=>p.dia>d))return toast('O lote tem lançamentos depois dessa data: apague-os antes de apartar');
  if(!confirm(`Apartar ${l.nome} em ${dB(d)}?\n\n${G_.map(g=>`• ${g.nome}: ${nf(g.cab)} cab · ${nf(g.peso,1)} kg → ${g.c}`).join('\n')}${cabF?`\n• Faltaram ${nf(cabF)} cab (custo fica separado)`:''}\n\nO ${l.nome} fecha nessa data e cada lote novo leva os custos proporcionais ao peso.`))return;
  const ap=novoId('ap');if(cabF>0)gravarFalta(l,d,cabF,pF,shF,GT.fobs,GT.fmodo);
  G_.forEach(g=>{const n={uid:novoId('lote'),tipo:'lote',nome:g.nome.trim(),apDe:l.uid,apId:ap,curr:[{desde:d,c:g.c}],rac:g.r?[{desde:d,r:g.r}]:[],
      ent:{dia:d,cab:g.cab,peso:g.peso,unid:'apart',preco:0,rcC:50,outros:0,origem:'Apartação de '+l.nome,gta:''},
      sistema:l.sistema,sexo:l.sexo,cat:l.cat,raca:l.raca,idade:l.idade,gmd:l.gmd,diasPrev:null,alvo:l.alvo,rcPrev:l.rcPrev,simPreco:l.simPreco,obs:(g.obs||'').trim()};
    gPut(n);gPut({uid:novoId('sai'),tipo:'saida',mot:'apart',apId:ap,lote:l.uid,destino:n.uid,dia:d,cab:g.cab,peso:g.peso,obs:'Apartação → '+n.nome});});
  toast(`${l.nome} apartado em ${G_.length} lotes`);gPilha.pop();GT={t:'rel',id:l.uid};gRender();window.scrollTo({top:0});}
/* desfazer: só se os lotes novos ainda não têm lançamentos próprios */
function desfazerApart(id){const l=G.it[id],ps=partesApart(l),fs=ps.map(s=>G.it[s.destino]).filter(x=>x&&!x.del);
  const uso=fs.filter(f=>saidasDe(f).length||pesagensDe(f).length||custosDe(f).length||entradasDe(f).length||partesApart(f).length);
  if(uso.length)return toast(`Não dá para desfazer: ${uso.map(f=>f.nome).join(', ')} já tem lançamentos (venda, pesagem, custo…)`);
  if(!confirm(`Desfazer a apartação de ${l.nome}? Os lotes ${fs.map(f=>f.nome).join(', ')} serão apagados e o ${l.nome} volta a ficar ativo.`))return;
  fs.forEach(f=>gDel(f.uid));ps.forEach(s=>gDel(s.uid));toast('Apartação desfeita');gRender();}
/* quadro no lote: de onde veio / para onde foi */
function apInfo(l){const ps=partesApart(l);let h='';
  if(ps.length){const kgT=ps.reduce((a,s)=>a+s.cab*s.peso,0);h+=`<div class="gApInfo"><b>✂ Apartado em ${dB(ps[0].dia)}</b> em ${ps.length} lotes:${ps.map(s=>{const f=G.it[s.destino];return f&&!f.del?`<button class="mini" data-g="lote" data-id="${f.uid}">${esc(f.nome)} · ${nf(s.cab)} cab · ${nf(s.peso)} kg · ${pc(s.cab*s.peso/kgT*100,1)} do custo</button>`:'';}).join('')}
    <button class="mini danger" data-g="apDesfaz" data-id="${l.uid}">↩ Desfazer apartação</button></div>`;}
  if(l.apDe){const o=G.it[l.apDe];if(o&&!o.del)h+=`<div class="gApInfo"><b>Veio da apartação</b> de <button class="mini" data-g="lote" data-id="${o.uid}">${esc(o.nome)}</button> em ${dB(l.ent.dia)} · trouxe ${rs(valorCompra(l))} de custo (proporcional ao peso)</div>`;}
  return h;}
/* ---------- ↔ transferir animais para outro lote (outro curral), levando o custo proporcional ao peso ---------- */
/* custo do lote até o dia (antes de transferir), por categoria, já tirando o que outras transferências levaram */
function custoAteDia(l,d,excl){const ant=somaDias(d,-1),R=ant>=l.ent.dia?resumoLote(l,ant):{custoR:0,custoOp:0};
  const o={compra:valorCompra(l)-entradasDe(l).filter(x=>x.dia>d).reduce((a,x)=>a+(+x.rs||0),0),alim:R.custoR||0,op:R.custoOp||0,outros:custosDe(l).filter(c=>c.dia<=d).reduce((a,c)=>a+(+c.rs||0),0)};
  saidasDe(l).filter(s=>s.mot!=='apart'&&s.uid!==excl&&s.dia<=d&&s.cst).forEach(s=>['compra','alim','op','outros'].forEach(k=>o[k]-=+s.cst[k]||0));
  o.total=o.compra+o.alim+o.op+o.outros;return o;}
/* grupos de compra do lote (compra inicial + cada entrada até o dia), com o que ainda resta de cabeças e de valor depois das saídas anteriores.
   saída marcada com o grupo (s.grp) tira daquele grupo; sem grupo, tira de todos na proporção das cabeças (cada um pelo seu preço) */
function gruposCompra(l,d,excl){const e=l.ent||{},E=entradasDe(l),eTot=E.reduce((a,x)=>a+(+x.rs||0),0);
  const G0=[{id:'ent',dia:e.dia,cab:+e.cab||0,rs:valorCompra(l)-eTot,nome:l.apDe?'Apartação':e.unid==='transf'?'Entrada (transferência)':'Compra inicial'}]
    .concat(E.filter(x=>x.dia<=d).map(x=>{const tr=x.transf&&G.it[x.transf],de=tr&&G.it[tr.lote];return {id:x.uid,dia:x.dia,cab:+x.cab||0,rs:+x.rs||0,nome:x.falta?'Animais achados':de?'De '+de.nome:(x.obs||'Compra')};}));
  saidasDe(l).filter(s=>s.mot!=='apart'&&s.uid!==excl&&s.dia<d&&s.cst).slice().sort(porDia).forEach(s=>{const c=+s.cab||0,g=s.grp&&G0.find(x=>x.id===s.grp);
    if(g&&g.cab>0){const q=Math.min(c,g.cab);g.rs-=Math.min(g.rs,+s.cst.compra||0);g.cab-=q;return;}
    const tot=G0.reduce((a,x)=>a+Math.max(0,x.cab),0);if(tot<=0)return;const f=Math.min(1,c/tot);G0.forEach(x=>{if(x.cab>0){x.rs-=x.rs*f;x.cab-=x.cab*f;}});});
  return G0;}
/* compra dos animais que saem: pelo preço do grupo escolhido (cabeças × valor que resta do grupo ÷ cabeças que restam) */
function compraDoGrupo(l,d,cab,grp,excl){if(!grp||grp==='media')return null;const g=gruposCompra(l,d,excl).find(x=>x.id===grp);if(!g||!(g.cab>0.5)||cab>g.cab+0.5)return null;return Math.round(cab*g.rs/g.cab*100)/100;}
/* opções do campo "Animais de qual compra" (só aparece quando o lote tem mais de uma compra/entrada) */
function opGrupos(l,d){const G1=gruposCompra(l,d||hojeKey()).filter(g=>g.cab>0.5);if(G1.length<2)return null;
  return [['media','Média do lote (todas as compras)']].concat(G1.map(g=>[g.id,`${g.nome}${g.dia?' '+dCurto(g.dia):''} · ${nf(Math.round(g.cab))} cab · ${rs(g.rs/g.cab)}/cab`]));}
/* parte do custo que sai com os animais: compra pelas cabeças (todos entraram com o mesmo peso de compra), o resto pelo peso; levando todos, leva o que sobrou */
function saiCalc(l,d,cab,peso,excl,grp){const sd=saidasDe(l).filter(x=>x.uid!==excl),tem=cabPres(l,d,sd),pm=pesoEm(l,d),p=peso>0?peso:pm,base=tem*pm,tudo=cab>0&&cab>=tem,sh=tudo?1:(base>0?Math.min(1,cab*p/base):0),shC=tudo?1:(tem>0?Math.min(1,cab/tem):0),K=custoAteDia(l,d,excl);
  const cst={};['compra','alim','op','outros'].forEach(k=>cst[k]=Math.round(K[k]*(k==='compra'?shC:sh)*100)/100);let porGrupo=false;if(grp){const cg=compraDoGrupo(l,d,cab,grp,excl);if(cg!=null){cst.compra=cg;porGrupo=true;}}const total=Object.values(cst).reduce((a,v)=>a+v,0);
  return {tem,pm,p,sh,shC,K,cst,total,porGrupo,porCab:cab>0?total/cab:NaN};}
const transfCalc=(l,d,cab,peso,grp,excl)=>saiCalc(l,d,cab,peso,excl||null,grp);
function tTransfForm(t){const l=G.it[t.id],hj=hojeKey(),O=t.old&&G.it[t.old]&&!G.it[t.old].del?G.it[t.old]:null,dest=lotesAtivos().filter(o=>o.uid!==l.uid||(O&&o.uid===O.destino)).filter(o=>o.uid!==l.uid).sort(porCurral);
  if(O&&!t.dest)t.dest=O.destino;if(O&&G.it[O.destino]&&!dest.includes(G.it[O.destino]))dest.unshift(G.it[O.destino]);
  const ov=(k,d)=>O&&O[k]!=null&&O[k]!==''?O[k]:d;
  return `${voltar()}<section class="panel"><h2>↔ ${O?'Alterar transferência':'Transferir animais'} · ${esc(l.nome)}</h2>${O?'<p class="aviso">Alterando: ao confirmar, a transferência antiga é trocada por esta (os animais e o custo são refeitos nos dois lotes).</p>':''}
    ${true?`<div class="gForm">${campo({k:'tTipo',l:'Tipo de transferência',t:'sel',op:[['','— Selecione o tipo —'],['custo','Transferência (leva peso de entrada e custos · sem venda)'],['vi','Venda interna (compra e venda)']],v:O?(+O.vi>0?'vi':'custo'):''})}</div>
    <div id="gTrCorpo"${O?'':' hidden'}>
    <p class="note" id="gTrNotaC"><b>Transferência</b>: os animais levam o <b>peso de entrada</b> original, o <b>peso atual</b> projetado e os <b>custos dos tratos</b> (alimentação, operacional e outros) até o dia anterior. Não tem venda: no lote destino o peso de entrada e o custo entram na média, a compra é calculada pelo preço de simulação do lote e o resultado sai só na venda.</p>
    <p class="note" id="gTrNotaV" hidden>Passa animais deste lote para outro lote como uma <b>compra e venda</b>: aqui fica registrada a compra real desses animais, os custos que tiveram até o dia anterior e o valor da venda interna (o resultado deles entra no lucro deste lote). O outro lote recebe os animais como <b>compra</b> por esse valor.</p>
    <div class="gForm">${campo({k:'tDest',l:'Lote destino',t:'sel',op:[['','— Selecione —'],['__novo','＋ Criar lote novo']].concat(dest.map(o=>[o.uid,`${curralEm(o,hj)} · ${o.nome} · ${nf(cabAtual(o))} cab`])),v:t.dest||'',busca:1,meia:1})}
      <div class="gCampo meia" id="gTrCur"${t.dest==='__novo'?'':' hidden'}><label>Curral / pasto onde vai entrar</label>${selCurNovo('id="gf_tN_',{})}</div></div>
      <div id="gTrNovo"${t.dest==='__novo'?'':' hidden'}>${campoLoteNovo('id="gf_tN_',{},l,true)}</div>
      <div class="gForm">${[{k:'tDia',l:'Data',t:'dia',v:ov('dia',hj),meia:1},{k:'tCab',l:'Quantidade',t:'num',v:ov('cab','')},...(()=>{const og=opGrupos(l,ov('dia',hj));return og?[{k:'tGrp',l:'Animais de qual compra',t:'sel',op:og,v:ov('grp','')||'media'}]:[];})(),{k:'tPeso',l:'Peso médio vivo',suf:'kg',t:'num',v:O&&O.pesado?O.peso:'',meia:1},{k:'tPesoT',l:'Peso total vivo',suf:'kg',t:'num',meia:1},{k:'tObs',l:'Observação',v:ov('obs',''),ph:'ex.: brinco 1234, refugo'}].map(campo).join('')}</div>
    <p class="note">Peso em branco: usa o peso projetado do lote.</p>
    <div id="gTrVenda" hidden><h3 class="gSubT">💲 Venda para o outro lote</h3><div class="gForm">${[{k:'tCarcM',l:'Peso médio de carcaça',suf:'kg',t:'num',meia:1},{k:'tCarcT',l:'Peso total de carcaça',suf:'kg',t:'num',v:ov('carcT',''),meia:1},{k:'tArr',l:'Total de arrobas (carcaça)',suf:'@',t:'num',meia:1},{k:'tRc',l:'Rendimento de carcaça',suf:'%',t:'num',v:O&&+O.rcV>0&&+O.rcV!==50?O.rcV:(O&&+O.rcV===50?50:''),ph:'digite o rendimento',meia:1},
      {k:'tUnid',l:'Preço em',t:'sel',op:UNID_V,v:ov('vUnid','arroba')},{k:'tPr',l:'Preço da venda',t:'rs',v:ov('vPr',''),meia:1},{k:'tVi',l:'Valor total da venda',t:'rs',v:ov('vi',''),meia:1}].map(campo).join('')}</div></div><div id="gTrRes" class="gApRes"></div><button class="primary" data-g="salvaTransf" data-id="${l.uid}">↔ Confirmar transferência</button></div><button class="danger" data-g="trCanc">✕ Cancelar transferência</button>`:'<p class="aviso warn">Não há outro lote ativo para receber os animais.</p>'}</section>`;}
function trPrevia(){const box=$('gTrRes'),l=G.it[GT.id];if(!box||!l)return;const d=fv('tDia')||hojeKey(),cab=fn('tCab'),peso=fn('tPeso'),nv=fv('tDest')==='__novo',B=nv?{nome:(fv('tN_nome')||'lote novo')}:G.it[fv('tDest')];if($('gTrNovo'))$('gTrNovo').hidden=!nv;if($('gTrCur'))$('gTrCur').hidden=!nv;
  const tp=fv('tTipo')||'',tc=tp==='custo';if($('gTrCorpo'))$('gTrCorpo').hidden=!tp;if(!tp){box.innerHTML='';return;}[['gTrVenda',tc],['gTrNotaV',tc],['gTrNotaC',!tc]].forEach(([i,h])=>{const e=$(i);if(e)e.hidden=h;});
  if(!(cab>0)){box.innerHTML='';return;}
  if(tc){const T=transfCalc(l,d,cab,peso,fv('tGrp'),GT.old),tr=T.cst.alim+T.cst.op+T.cst.outros,pe=pesoEntMed(l);
    box.innerHTML=`<div class="stat gStat3">${st('Quantidade',`${nf(cab)} de ${nf(T.tem)}`,cab>T.tem?'bad':'')}${st('Peso de entrada',nf(pe,1)+' kg')}${st('Peso atual',nf(T.p,1)+` kg<small>lote ${nf(T.pm)} kg</small>`)}</div>
    <div class="gLinhas">${lin('· alimentação',rs(T.cst.alim))}${lin('· operacional',rs(T.cst.op))}${lin('· outros custos',rs(T.cst.outros))}${lin('Custo dos tratos que vai junto',rs(tr))}${lin('Por cabeça',rs(tr/cab))}</div>
    ${B?`<p class="note">Entram no <b>${esc(B.nome)}</b> em ${dB(d)} sem venda: peso de entrada ${nf(pe,1)} kg e custo ${rs(tr)} somam na média do lote; a compra deles é calculada pelo preço de simulação do lote destino.</p>`:''}`;return;}
  const T=transfCalc(l,d,cab,peso,fv('tGrp'),GT.old),cus=T.total,vi=fn('tVi')||viCalc(cab,T.p,fn('tPr'),fn('tRc'),fv('tUnid')),r=vi-cus;
  box.innerHTML=`<div class="stat gStat3">${st('Quantidade',`${nf(cab)} de ${nf(T.tem)}`,cab>T.tem?'bad':'')}${st('Peso',nf(T.p,1)+` kg<small>lote ${nf(T.pm)} kg</small>`)}${st('% do peso do lote',pc(T.sh*100,2))}</div>
    <div class="gLinhas">${lin(T.porGrupo?'· compra (pelo preço do grupo escolhido)':'· compra (proporcional às cabeças)',rs(T.cst.compra))}${lin('· alimentação',rs(T.cst.alim))}${lin('· operacional',rs(T.cst.op))}${lin('· outros custos',rs(T.cst.outros))}
    ${lin('Custo desses animais',rs(cus))}${lin('Venda',vi>0?rs(vi):'—')}${lin(r>=0?'Lucro desses animais':'Prejuízo desses animais',vi>0?rs(r):'—',vi>0?(r>=0?'ok':'bad'):'')}</div>
    ${B?`<p class="note">Entra no <b>${esc(B.nome)}</b> em ${dB(d)} como <b>compra</b> de ${vi>0?rs(vi):'(coloque o valor da venda interna)'}; o peso médio do lote é refeito.</p>`:''}`;}
/* alterar transferência: tira a antiga (as duas pontas), lança a nova; se a nova não passar, a antiga volta como estava */
function salvaTransfEd(id){const O=G.it[GT.old];if(!O||O.del)return salvaTransf(id);const E=O.entl&&G.it[O.entl]?JSON.parse(JSON.stringify(G.it[O.entl])):null,O2=JSON.parse(JSON.stringify(O));
  gDel(O.uid);if(E)gDel(E.uid);const n0=gTodos('saida').length,t0=GT;salvaTransf(id);
  if(gTodos('saida').length===n0){delete O2.del;gPut(O2);if(E){delete E.del;gPut(E);}GT=t0;return;}
  [O2.lote,O2.destino].forEach(u=>{const L=G.it[u];if(L&&!L.del)recalcSaidas(L);});}
function salvaTransf(id){const l=G.it[id],d=fv('tDia'),cab=fn('tCab'),peso=fn('tPeso'),nv=fv('tDest')==='__novo',N={nome:fv('tN_nome'),c:fv('tN_c'),r:fv('tN_r'),obs:fv('tN_obs')},B=nv?{nome:N.nome,ent:{dia:d}}:G.it[fv('tDest')];
  if(nv){if(!N.nome)return toast('Coloque o nome do lote novo');if(!nomeLivre(N.nome))return toast(`Já existe um lote chamado ${N.nome}`);if(!N.c)return toast('Escolha o curral do lote novo');}
  if(!B)return toast('Escolha o lote que vai receber');if(!d||!(cab>0))return toast('Coloque a data e a quantidade');
  if(d<l.ent.dia)return toast('A data é antes da entrada deste lote');if(d<B.ent.dia)return toast(`O ${B.nome} só começa em ${dB(B.ent.dia)}`);if(d>hojeKey())return toast('A data não pode ser depois de hoje');
  const grp=fv('tGrp')&&fv('tGrp')!=='media'?fv('tGrp'):null,T=transfCalc(l,d,cab,peso,grp);if(cab>T.tem)return toast(`Nessa data o lote tem ${nf(T.tem)} animais`);
  if(!fv('tTipo'))return toast('Escolha o tipo de transferência');
  if(fv('tTipo')==='custo'){const cst={};Object.keys(T.cst).forEach(k=>cst[k]=Math.round(T.cst[k]*100)/100);const tot=Object.values(cst).reduce((a,v)=>a+v,0),tr=Math.round((cst.alim+cst.op+cst.outros)*100)/100,pe=Math.round(pesoEntMed(l)*100)/100,pA=Math.round(T.p*100)/100,diaE=l.ent.diaE||l.ent.dia;
    if(!confirm(`Transferir ${nf(cab)} animais de ${l.nome} para ${B.nome} em ${dB(d)}?\n\nLevam: peso de entrada ${nf(pe,1)} kg · peso atual ${nf(pA,1)} kg · custo dos tratos ${rs(tr)}.\nSem venda: a compra entra pelo preço de simulação do lote destino e o resultado sai na venda.`))return;
    const sU=novoId('sai'),eU=novoId('entl'),obs=fv('tObs');
    if(nv){const P=precoSim(l),n={uid:novoId('lote'),tipo:'lote',nome:N.nome.trim(),curr:[{desde:d,c:N.c}],rac:N.r?[{desde:d,r:N.r}]:[],
        ent:{dia:d,cab,peso:pA,pesoE:pe,diaE,unid:P.unid,preco:Math.round(P.preco*100)/100,rcC:P.rc,outros:0,trz:tr,deLote:l.uid,tc:true,origem:'Transferência de '+l.nome,gta:''},
        sistema:l.sistema,sexo:l.sexo,cat:l.cat,raca:l.raca,idade:l.idade,gmd:l.gmd,diasPrev:null,alvo:l.alvo,rcPrev:l.rcPrev,simPreco:l.simPreco,obs:(N.obs||'').trim()};gPut(n);
      gPut({uid:sU,tipo:'saida',mot:'transf',tc:true,lote:l.uid,destino:n.uid,novoLote:true,dia:d,cab,peso:pA,pesoE:pe,pesado:peso>0,cst,custo:tot,obs,grp});recalcCurral(N.c,d);toast(`Lote ${N.nome} criado com ${nf(cab)} cab`);return gVoltar();}
    gPut({uid:sU,tipo:'saida',mot:'transf',tc:true,lote:l.uid,destino:B.uid,dia:d,cab,peso:pA,pesoE:pe,pesado:peso>0,cst,custo:tot,entl:eU,obs,grp});
    gPut({uid:eU,tipo:'entlote',lote:B.uid,dia:d,cab,peso:pA,pesoE:pe,diaE,rs:tr,tc:true,de:l.uid,transf:sU,obs:`Transferido de ${l.nome} (peso de entrada ${nf(pe,1)} kg)${obs?' · '+obs:''}`});
    recalcCurral(curralEm(B,d),d);toast(`${nf(cab)} cab transferidos para ${B.nome}`);return gVoltar();}
  if((fv('tUnid')||'arroba')==='arroba'&&!(fn('tRc')>0&&fn('tRc')<100)&&!(fn('tCarcT')>0)&&!(fn('tCarcM')>0))return toast('Preço em R$/@ morto: coloque o rendimento de carcaça (ou o peso de carcaça)');
  const cr=null,pr=fn('tPr')>0?fn('tPr'):null,rcV=fn('tRc')>0&&fn('tRc')<100?fn('tRc'):50,vUnid=fv('tUnid')||'arroba',vi=Math.round((fn('tVi')||viCalc(cab,T.p,pr,rcV,vUnid))*100)/100;if(!(vi>0))return toast('Coloque o preço da venda (ou o valor total)');
  const cus=T.total;
  if(!confirm(`Venda de ${nf(cab)} animais (${nf(T.p,1)} kg) de ${l.nome} para ${B.nome} em ${dB(d)}?\n\nCusto deles ${rs(cus)} · venda ${rs(vi)} · ${vi-cus>=0?'lucro':'prejuízo'} ${rs(vi-cus)}\n\n${B.nome} recebe como compra de ${rs(vi)}.`))return;
  const sU=novoId('sai'),eU=novoId('entl'),obs=fv('tObs'),cst={};Object.keys(T.cst).forEach(k=>cst[k]=Math.round(T.cst[k]*100)/100);const tot=Object.values(cst).reduce((a,v)=>a+v,0);
  if(nv){const nu=criarLoteTransf(l,d,cab,Math.round(T.p*100)/100,vi,N,true);gPut({uid:sU,tipo:'saida',mot:'transf',lote:l.uid,destino:nu,novoLote:true,dia:d,cab,peso:Math.round(T.p*100)/100,pesado:peso>0,cst,custo:tot,vPr:pr,vUnid,rcV,carcT:fn('tCarcT')||null,vi,obs,grp});recalcCurral(N.c,d);toast(`Lote ${N.nome} criado com ${nf(cab)} cab`);return gVoltar();}
  gPut({uid:sU,tipo:'saida',mot:'transf',lote:l.uid,destino:B.uid,dia:d,cab,peso:Math.round(T.p*100)/100,pesado:peso>0,cst,custo:tot,vPr:pr,vUnid,rcV,carcT:fn('tCarcT')||null,vi,entl:eU,obs,grp});
  gPut({uid:eU,tipo:'entlote',lote:B.uid,dia:d,cab,peso:Math.round(T.p*100)/100,rs:vi,vi:true,de:l.uid,transf:sU,obs:`Comprado de ${l.nome} (venda interna)${obs?' · '+obs:''}`});
  recalcCurral(curralEm(B,d),d);toast(`${nf(cab)} cab transferidos para ${B.nome}`);return gVoltar();}
/* ---------- 🏁 fechar o lote: venda + os que sobraram vão para outros lotes (custo proporcional ao peso) ---------- */
/* lote novo criado na transferência / fechamento: entra com os animais e o custo que trouxeram; o resto do cadastro copia do lote de origem (dá para completar depois em ✎ Editar dados) */
function criarLoteTransf(o,d,cab,peso,custo,nv,vi){const n={uid:novoId('lote'),tipo:'lote',nome:nv.nome.trim(),curr:[{desde:d,c:nv.c}],rac:nv.r?[{desde:d,r:nv.r}]:[],
    ent:{dia:d,cab,peso,unid:'transf',preco:Math.round(custo*100)/100,deLote:o.uid,rcC:50,outros:0,origem:(vi?'Compra (venda interna) de ':'Transferência de ')+o.nome,gta:'',vi:vi?true:undefined},
    sistema:o.sistema,sexo:o.sexo,cat:o.cat,raca:o.raca,idade:o.idade,gmd:o.gmd,diasPrev:null,alvo:o.alvo,rcPrev:o.rcPrev,simPreco:o.simPreco,obs:(nv.obs||'').trim()};gPut(n);return n.uid;}
/* campos do lote novo (nome, curral, ração) */
/* curral do lote novo: começa em branco (escolher), ativos primeiro */
const selCurNovo=(attr,g)=>`<select ${attr}c" data-busca>${[['','Selecione']].concat(opCurrais('',false),opCurrais('',true).filter(([n])=>window.curraisApi&&curraisApi.info(n).inativo)).map(([a,b])=>`<option value="${esc(a)}"${a===(g.c||'')?' selected':''}>${esc(b)}</option>`).join('')}</select>`;
function campoLoteNovo(attr,g,o,semCurral){const hj=hojeKey(),r=racaoEm(o,hj);return `<div class="gForm gCprNovo"><div class="gCampo"><label>Nome do lote novo</label><input type="text" ${attr}nome" value="${esc(g.nome||'')}" autocomplete="off" placeholder="ex.: ${esc(o.nome)} B"></div>
  ${semCurral?'':`<div class="gCampo meia"><label>Curral / pasto onde vai entrar</label>${selCurNovo(attr,g)}</div>`}
  <div class="gCampo meia"><label>Ração</label><select ${attr}r">${opRacoes('').map(([a,b])=>`<option value="${esc(a)}"${a===(g.r!=null?g.r:(r?r.uid:''))?' selected':''}>${esc(b)}</option>`).join('')}</select></div>
  <div class="gCampo"><label>Observação do lote</label><input type="text" ${attr}obs" value="${esc(g.obs||'')}" autocomplete="off" placeholder="ex.: brincos 1023, 1045, 1102"></div>
  <p class="note" style="grid-column:1/-1">Pode ser o mesmo curral de outro lote: o trato do curral é dividido entre os lotes pelo peso vivo de cada um.</p></div>`;}
function nomeLivre(nm){return nm&&!gTodos('lote').some(o=>String(o.nome||'').trim().toLowerCase()===nm.trim().toLowerCase());}
function tFechaForm(t){const l=G.it[t.id],hj=hojeKey(),cfg=gCfg();
  if(!t.f)t.f={dia:hj,cab:'',falta:'',fobs:'',peso:'',pesoT:'',pesoL:'',rc:'',unid:'arroba',preco:'',desc:'',comp:'',obs:'',tr:[{dest:'',cab:'',peso:'',pesoT:''}]};const F=t.f;
  const dest=lotesAtivos().filter(o=>o.uid!==l.uid).sort(porCurral),opD=[['','Selecione'],['__novo','＋ Criar lote novo']].concat(dest.map(o=>[o.uid,`${curralEm(o,hj)} · ${o.nome} · ${nf(cabAtual(o))} cab`]));
  const inp=(k,lab,v,num,suf,ph)=>{const din=/^R\$/.test(suf||'');  /* valor em dinheiro: máscara R$ 1.234,56 */
    return `<div class="gCampo meia"><label>${lab}${suf&&!din?` <span class="gSuf">(${suf})</span>`:suf&&din&&suf!=='R$'?` <span class="gSuf">(${suf.replace(/^R\$\s*/,'')})</span>`:''}</label><input type="text"${din?' inputmode="numeric" class="gRs"':num?' inputmode="decimal"':''} data-fc="${k}" value="${esc(din?rsIn(gNum(v)):v)}" placeholder="${esc(din?'R$ 0,00':(ph||''))}" autocomplete="off"></div>`;};
  const trs=F.tr.map((g,i)=>`<div class="gApGr"><div class="gApTop"><b>Vai para outro lote ${i+1}</b><button class="mini danger" data-g="fcRm" data-i="${i}">✕</button></div><div class="gForm">
    <div class="gCampo"><label>Lote que recebe</label><select data-ft="${i}|dest" data-busca>${opD.map(([a,b])=>`<option value="${esc(a)}"${a===g.dest?' selected':''}>${esc(b)}</option>`).join('')}</select></div>
    ${g.dest==='__novo'?campoLoteNovo(`data-ft="${i}|`,g,l):''}
    <div class="gCampo"><label>Quantidade</label><input type="text" inputmode="decimal" data-ft="${i}|cab" value="${esc(g.cab)}" autocomplete="off"></div>
    <div class="gCampo meia"><label>Peso médio <span class="gSuf">(kg)</span></label><input type="text" inputmode="decimal" data-ft="${i}|peso" value="${esc(g.peso)}" autocomplete="off"></div>
    <div class="gCampo meia"><label>Peso total <span class="gSuf">(kg)</span></label><input type="text" inputmode="decimal" data-ft="${i}|pesoT" value="${esc(g.pesoT)}" autocomplete="off"></div>
    <div class="gCampo"><label>Rendimento de carcaça <span class="gSuf">(%)</span></label><input type="text" inputmode="decimal" data-ft="${i}|rc" value="${esc(g.rc||'')}" placeholder="em branco = igual aos vendidos" autocomplete="off"></div>
    <div class="gCampo meia"><label>Preço da venda <span class="gSuf">(mesma unidade dos vendidos)</span></label><input type="text" inputmode="numeric" class="gRs" data-ft="${i}|pr" value="${esc(rsIn(gNum(g.pr)))}" placeholder="R$ 0,00" autocomplete="off"></div>
    <div class="gCampo meia"><label>Valor total da venda</label><input type="text" inputmode="numeric" class="gRs" data-ft="${i}|vi" value="${esc(rsIn(gNum(g.vi)))}" placeholder="R$ 0,00" autocomplete="off"></div></div></div>`).join('');
  return `${voltar()}<section class="panel"><h2>💲 Venda + sobra · ${esc(l.nome)}</h2>
    <p class="note">Venda de parte dos animais e os que sobraram vão para um ou mais lotes. O lote fecha nessa data. Os que sobraram são uma <b>venda interna</b>: fica registrada a compra real deles, os custos até o dia anterior e o valor de venda; o outro lote recebe como compra por esse valor. O resto da compra e dos custos fica com os vendidos.</p>
    <div class="gForm"><div class="gCampo meia"><label>Data da venda</label><input type="date" data-fc="dia" value="${esc(F.dia)}"></div>
      ${inp('pesoL','Peso total do lote inteiro',F.pesoL,1,'kg · opcional','se pesou todos juntos')}</div>
    <h3 class="gSubT">💲 Vendidos</h3><div class="gForm"><div class="gCampo"><label>Quantidade vendida</label><input type="text" inputmode="decimal" data-fc="cab" value="${esc(F.cab)}" autocomplete="off"></div>
      ${inp('peso','Peso médio vendido',F.peso,1,'kg')}${inp('pesoT','Peso total vendido',F.pesoT,1,'kg')}
      ${inp('carcM','Peso médio abatido',F.carcM||'',1,'kg')}${inp('carcT','Peso total abatido',F.carcT||'',1,'kg')}
      ${inp('arrT','Total de arrobas abatidas',F.arrT||'',1,'@')}
      <div class="gCampo"><label>Rendimento de carcaça <span class="gSuf">(%)</span></label><input type="text" inputmode="decimal" data-fc="rc" value="${esc(F.rc)}" placeholder="digite o rendimento" autocomplete="off"></div>
      <div class="gCampo"><label>Preço de venda em</label><select data-fc="unid">${UNID_V.map(([a,b])=>`<option value="${a}"${a===F.unid?' selected':''}>${esc(b)}</option>`).join('')}</select></div>
      ${inp('preco','Preço de venda',F.preco,1,'R$')}${inp('vTot','Valor total da venda',F.vTot||'',1,'R$')}
      ${inp('desc','Descontos (frete, impostos)',F.desc,1,'R$ total')}${inp('vLiq','Valor total líquido',F.vLiq||'',1,'R$')}
      <div class="gCampo"><label>Comprador</label><select data-fc="comp">${opCompradores().map(([a,b])=>`<option value="${esc(a)}"${a===F.comp?' selected':''}>${esc(b)}</option>`).join('')}</select></div>
      <div class="gForm gCprNovo" id="gFcNovo"${F.comp==='__novo'?'':' hidden'}><div class="gCampo meia"><label>Nome do novo comprador</label><input type="text" id="gf_cprNome" data-fc="cprNome" value="${esc(F.cprNome||'')}" autocomplete="off"></div>
        <div class="gCampo meia"><label>Tipo</label><select id="gf_cprCat" data-fc="cprCat">${TIPOS_CPR.map(x=>`<option${x===F.cprCat?' selected':''}>${esc(x)}</option>`).join('')}</select></div></div>
      <div class="gCampo"><label>Observação</label><textarea data-fc="obs" rows="2" style="min-height:0;height:auto">${esc(F.obs)}</textarea></div></div>
    <h3 class="gSubT">↔ Os que sobraram</h3>${trs}<button data-g="fcAdd">＋ Mais um lote</button>
    ${campoFaltas('',F,1)}
    <div id="gFcRes" class="gApRes"></div>
    <button class="primary" data-g="salvaFecha" data-id="${l.uid}">💲 Confirmar venda + sobra</button>
    <button class="danger" data-g="vendaCanc">✕ Cancelar venda</button></section>`;}
function fcLer(){const F=GT.f;if(!F)return;document.querySelectorAll('[data-fc]').forEach(e=>F[e.dataset.fc]=e.value);let mudou=false;document.querySelectorAll('[data-ft]').forEach(e=>{const [i,k]=e.dataset.ft.split('|');if(F.tr[i]){if(k==='dest'&&(F.tr[i].dest==='__novo')!==(e.value==='__novo'))mudou=true;F.tr[i][k]=e.value;}});
  if(mudou)setTimeout(()=>{gRender();},0);
  const n=$('gFcNovo');if(n)n.hidden=F.comp!=='__novo';}
/* contas do fechamento: pesos de cada grupo, custo que cada lote leva e o que fica com os vendidos */
function fcCalc(l,F){const d=F.dia||hojeKey(),tem=cabPres(l,d),cabV=gNum(F.cab)||0;
  const T=F.tr.map(g=>{const c=gNum(g.cab)||0,pt=gNum(g.pesoT),pm=gNum(g.peso);const p=pm>0?pm:(pt>0&&c>0?pt/c:NaN);const nv=g.dest==='__novo';return {dest:g.dest,nv,nome:g.nome||'',c:g.c,r:g.r,obs:g.obs||'',rcR:g.rc,pr:g.pr,viT:g.vi,l:nv?{nome:(g.nome||'').trim()||'(lote novo)',ent:{dia:'0000'}}:G.it[g.dest],cab:c,peso:p,kg:c>0&&p>0?c*p:0};});
  const kgT=T.reduce((a,g)=>a+g.kg,0),pL=gNum(F.pesoL);let pV=gNum(F.peso);if(!(pV>0)&&gNum(F.pesoT)>0&&cabV>0)pV=gNum(F.pesoT)/cabV;
  let deLote=false;if(!(pV>0)&&pL>0&&cabV>0&&pL>kgT){pV=(pL-kgT)/cabV;deLote=true;}
  const FC=faltaCalc(l,d,tem,F,pV),cabF=FC.cab,pF=FC.p,kgF=FC.kg;
  const kgV=cabV>0&&pV>0?cabV*pV:0,kgTot=kgV+kgT+kgF,K=custoAteDia(l,d),fixo=FC.fixo!=null?FC.fixo:0,resto=1-fixo;
  T.forEach(g=>{g.sh=kgTot?g.kg/kgTot*resto:0;g.shC=tem>0?Math.min(1,g.cab/tem):0;g.cst={};['compra','alim','op','outros'].forEach(k=>g.cst[k]=K[k]*(k==='compra'?g.shC:g.sh));g.custo=Object.values(g.cst).reduce((a,v)=>a+v,0);
    g.cr=NaN;g.rcV=gNum(g.rcR)>0&&gNum(g.rcR)<100?gNum(g.rcR):(gNum(F.rc)>0&&gNum(F.rc)<100?gNum(F.rc):50);g.cus=g.custo;g.vi=gNum(g.viT)>0?gNum(g.viT):viCalc(g.cab,g.peso,gNum(g.pr),g.rcV,F.unid);g.res=g.vi>0?g.vi-g.cus:NaN;});
    const extraD=0;  /* dia da venda/sobra não tem consumo (sai cedo): custo, diárias e dias vão até o dia anterior */
  const cabTot=cabV+cabF+T.reduce((a,g)=>a+g.cab,0),shF=FC.fixo!=null?fixo:(kgTot?kgF/kgTot:0),custoF=K.total*shF,cstF={};['compra','alim','op','outros'].forEach(k=>cstF[k]=K[k]*shF);const custoV=K.total-T.reduce((a,g)=>a+g.custo,0)-custoF+extraD,cstV={};['compra','alim','op','outros'].forEach(k=>cstV[k]=K[k]-T.reduce((a,g)=>a+g.cst[k],0)-cstF[k]);
  const crV=NaN,custoVR=(crV>0?crV:cstV.compra)+cstV.alim+cstV.op+cstV.outros;
  const rc=gNum(F.rc)>0&&gNum(F.rc)<100?gNum(F.rc):50,s={cab:cabV,peso:pV,rc,unid:F.unid,preco:gNum(F.preco)||0,desc:gNum(F.desc)||0,vTot:gNum(F.vTot)||0},rec=valorVenda(s);
  return {d,tem,cabV,cabF,pF,shF,custoF,cstF,pV,deLote,kgV,T,kgTot,K,cabTot,custoV,cstV,crV,custoVR,rc,rec,res:rec-custoVR};}
/* resumo da venda + sobra: um quadro por destino (cabe na tela do celular) */
const fcL=(nome,sub,q,p,pct,cu,dest)=>`<div class="fcItem${dest?' fcVend':''}"><div class="fcNome"><b>${esc(nome)}</b>${sub?`<small>${esc(sub)}</small>`:''}<span>${nf(q)} animais · ${ok(p)&&p>0?nf(p,1)+' kg':'— kg'} · ${pc(pct,1)} do peso</span></div><div class="fcCusto"><b>${rs(cu)}</b><small>${rs(q?cu/q:NaN)}/cab</small></div></div>`;
function fcPrevia(){const box=$('gFcRes'),l=G.it[GT.id];if(!box||!l||!GT.f)return;const X=fcCalc(l,GT.f);
  box.innerHTML=`<div class="stat gStat3">${st('Quantidade',`${nf(X.cabTot)} de ${nf(X.tem)}`,X.cabTot===X.tem?'':'bad')}${st('Peso dos vendidos',X.pV>0?nf(X.pV,1)+` kg<small>${X.deLote?'pelo peso do lote inteiro':'média'}</small>`:'—')}${st('Peso total',nf(X.kgTot)+' kg')}</div>
    ${X.cabTot!==X.tem?`<p class="aviso warn">Em ${dB(X.d)} o lote tem ${nf(X.tem)} animais: vendidos + os que vão para outros lotes + os que faltaram precisam dar ${nf(X.tem)} (${X.cabTot<X.tem?'faltam '+nf(X.tem-X.cabTot):'sobram '+nf(X.cabTot-X.tem)}).</p>`:''}
    <div class="fcLista">${fcL('Vendidos','',X.cabV,X.pV,X.kgTot?X.kgV/X.kgTot*100*(1-(GT.f.fmodo==='entrada'?X.shF:0)):NaN,X.custoV,1)}
    ${X.cabF?fcL('Faltaram',`custo fica separado · peso ${GT.f.fmodo==='entrada'?'de entrada':'de agora'}`,X.cabF,X.pF,X.shF*100,X.custoF):''}
    ${X.T.map(g=>fcL(g.l?g.l.nome:'(escolha o lote)','vai para este lote',g.cab,g.peso,g.sh*100,g.custo)).join('')}</div>
    ${X.T.length?`<h3 class="gSubT">🧾 Venda interna (os que sobraram)</h3><div class="gLinhas">${X.T.map(g=>`${lin(`<b>${esc(g.l?g.l.nome:'(escolha o lote)')}</b> · venda interna`,g.vi>0?rs(g.vi):'—')}${lin('· compra (proporcional às cabeças)',rs(g.cst.compra))}${lin('· custos até o dia anterior',rs(g.cst.alim+g.cst.op+g.cst.outros))}${g.vi>0?lin(g.res>=0?'· lucro':'· prejuízo',rs(g.res),g.res>=0?'ok':'bad'):''}`).join('')}</div>`:''}
    <h3 class="gSubT">💲 Vendidos</h3><div class="gLinhas">${lin('Custo do lote até a data',rs(X.K.total))}${lin('Compra dos vendidos (o que sobrou da compra)',rs(X.cstV.compra))}${lin('Custo dos vendidos',rs(X.custoVR))}${lin('Receita da venda',X.rec>0?rs(X.rec):'—')}${lin(X.res>=0?'Lucro (vendidos)':'Prejuízo (vendidos)',X.rec>0?rs(X.res):'—',X.rec>0?(X.res>=0?'ok':'bad'):'')}
    ${(()=>{const ri=X.T.reduce((a,g)=>a+(g.res||0),0),tot=(X.rec>0?X.res:0)+ri;return X.T.length&&(X.rec>0||ri)?lin(tot>=0?'Lucro deste fechamento (vendidos + venda interna)':'Prejuízo deste fechamento (vendidos + venda interna)',rs(tot),tot>=0?'ok':'bad'):'';})()}</div>`;}
function salvaFecha(id){fcLer();const l=G.it[id],F=GT.f,X=fcCalc(l,F),d=X.d;
  if(!F.dia)return toast('Coloque a data');if(d<l.ent.dia)return toast('A data é antes da entrada do lote');if(d>hojeKey())return toast('A data não pode ser depois de hoje');
  if(saidasDe(l).some(s=>s.dia>d)||entradasDe(l).some(x=>x.dia>d))return toast('O lote tem lançamentos depois dessa data');
  if(X.cabTot!==X.tem)return toast(`Vendidos + transferidos + faltaram precisam dar ${nf(X.tem)} animais`);
  if(X.cabV>0&&!(X.pV>0))return toast('Coloque o peso dos vendidos (médio, total ou o peso do lote inteiro)');
  {const rcOk=gNum(F.rc)>0&&gNum(F.rc)<100;if(F.unid==='arroba'&&!rcOk&&(X.cabV>0||X.T.some(g=>!(gNum(g.rcR)>0)&&!(gNum(g.viT)>0))))return toast('Preço em R$/@ morto: coloque o rendimento de carcaça');}
  for(const g of X.T){if(!(g.cab>0))return toast('Coloque a quantidade de cada lote que recebe (ou tire a linha)');if(!g.l)return toast('Escolha o lote que recebe');
    if(g.nv){if(!g.nome.trim())return toast('Coloque o nome do lote novo');if(!nomeLivre(g.nome))return toast(`Já existe um lote chamado ${g.nome}`);if(!g.c)return toast('Escolha o curral do lote novo');}if(!(g.peso>0))return toast(`Coloque o peso dos que vão para ${g.l.nome}`);if(!(g.vi>0))return toast(`Coloque o preço da @ viva ou o valor da venda interna para ${g.l.nome}`);if(g.l.ent.dia>d)return toast(`O ${g.l.nome} só começa em ${dB(g.l.ent.dia)}`);}
  {const ds=X.T.filter(g=>!g.nv).map(g=>g.dest),ns=X.T.filter(g=>g.nv).map(g=>g.nome.trim().toLowerCase());if(new Set(ds).size<ds.length||new Set(ns).size<ns.length)return toast('O mesmo lote está em duas linhas: junte numa só');}
  let cp=F.comp;if(cp==='__novo'){const nm=(($('gf_cprNome')||{}).value||'').trim();if(!nm)return toast('Digite o nome do novo comprador');const ja=gTodos('comprador').find(c=>alfa(c.nome,nm)===0);if(ja)cp=ja.uid;else{cp=novoId('cpr');gPut({uid:cp,tipo:'comprador',nome:nm,cat:$('gf_cprCat').value});}}
  if(X.cabV>0&&!(gNum(F.preco)>0)&&!confirm('Salvar a venda sem o preço?'))return;
  if(!confirm(`Fechar ${l.nome} em ${dB(d)}?\n\n${X.cabV?`• Venda: ${nf(X.cabV)} cab · ${nf(X.pV,1)} kg\n`:''}${X.T.map(g=>`• ${nf(g.cab)} cab (${nf(g.peso,1)} kg) → ${g.l.nome} · venda interna ${rs(g.vi)} (${g.res>=0?'lucro':'prejuízo'} ${rs(g.res)})`).join('\n')}${X.cabF?`\n• Faltaram ${nf(X.cabF)} cab (${nf(X.pF,1)} kg) levando ${rs(X.custoF)} (fica separado até serem achados)`:''}`))return;
  /* transferências primeiro (gravam o custo que levam), depois a venda */
  X.T.forEach(g=>{const sU=novoId('sai'),eU=novoId('entl'),cst={};Object.keys(g.cst).forEach(k=>cst[k]=Math.round(g.cst[k]*100)/100);const tot=Object.values(cst).reduce((a,v)=>a+v,0),p=Math.round(g.peso*100)/100;
    const vi=Math.round(g.vi*100)/100,VI={vPr:gNum(g.pr)>0?gNum(g.pr):null,vUnid:F.unid||'arroba',rcV:g.rcV,vi};
    if(g.nv){const nu=criarLoteTransf(l,d,g.cab,p,vi,g,true);gPut(Object.assign({uid:sU,tipo:'saida',mot:'transf',lote:l.uid,destino:nu,novoLote:true,dia:d,cab:g.cab,peso:p,pesado:true,cst,custo:tot,obs:'Fechamento do lote',fech:true},VI));return;}
    gPut(Object.assign({uid:sU,tipo:'saida',mot:'transf',lote:l.uid,destino:g.dest,dia:d,cab:g.cab,peso:p,pesado:true,cst,custo:tot,entl:eU,obs:'Fechamento do lote',fech:true},VI));
    gPut({uid:eU,tipo:'entlote',lote:g.dest,dia:d,cab:g.cab,peso:p,rs:vi,vi:true,de:l.uid,transf:sU,obs:`Comprado de ${l.nome} (venda interna · fechamento)`});});
  if(X.cabF>0){const cst={};Object.keys(X.cstF).forEach(k=>cst[k]=Math.round(X.cstF[k]*100)/100);gPut({uid:novoId('sai'),tipo:'saida',mot:'falta',lote:l.uid,dia:d,cab:X.cabF,peso:Math.round(X.pF*100)/100,pesoE:Math.round((F.fmodo==='entrada'?X.pF:pesoEntMed(l))*100)/100,fmodo:F.fmodo==='entrada'?'entrada':'atual',diaE:l.ent.diaE||l.ent.dia,cst,custo:Object.values(cst).reduce((a,v)=>a+v,0),achados:[],obs:F.fobs||'',fech:true});}
  if(X.cabV>0)gPut({uid:novoId('sai'),tipo:'saida',mot:'venda',lote:l.uid,dia:d,cab:X.cabV,peso:Math.round(X.pV*100)/100,rc:X.rc,pesoVT:X.kgV?Math.round(X.kgV*100)/100:null,carcT:gNum(F.carcT)>0?gNum(F.carcT):(gNum(F.carcM)>0?Math.round(gNum(F.carcM)*X.cabV*100)/100:null),unid:F.unid,preco:gNum(F.preco)||0,vTot:gNum(F.vTot)||null,desc:gNum(F.desc)||0,comp:cp||'',obs:F.obs||'',fech:true,cst:(()=>{const o={};Object.keys(X.cstV).forEach(k=>o[k]=Math.round(X.cstV[k]*100)/100);return o;})()});
  toast(`${l.nome} fechado`);gPilha.pop();GT={t:'rel',id:l.uid};gRender();window.scrollTo({top:0});}
/* entrada proporcional: os animais entram como se fossem do lote desde o começo (mesmo peso de entrada, peso de hoje e custo dos tratos por cabeça) — não muda o resultado por cabeça */
function entPropCalc(l,d,n){const tem=cabPres(l,d),K=custoAteDia(l,d),f=tem>0?n/tem:0,tr=((+K.alim||0)+(+K.op||0)+(+K.outros||0))*f;
  return {tem,pe:pesoEntMed(l),pA:pesoEm(l,d),tr,alim:(+K.alim||0)*f,op:(+K.op||0)*f,outros:(+K.outros||0)*f,porCab:tem>0?((+K.alim||0)+(+K.op||0)+(+K.outros||0))/tem:NaN};}
function entPropPrevia(){const box=$('gEntProp'),l=G.it[GT.entLote];if(!box||!l)return;const d=fv('dia')||hojeKey(),n=fn('cab');if(!(n>0)){box.innerHTML='';return;}const P=entPropCalc(l,d,n);
  box.innerHTML=`<div class="stat gStat3">${st('Peso de entrada',nf(P.pe,1)+' kg')}${st('Peso hoje',nf(P.pA,1)+' kg')}${st('Custo tratos/cab',rs(P.porCab))}</div>
    <div class="gLinhas">${lin('· alimentação',rs(P.alim))}${lin('· operacional',rs(P.op))}${lin('· outros custos',rs(P.outros))}${lin(`Custo dos tratos que entra com os ${nf(n)}`,rs(P.tr))}</div>
    <p class="note">O lote passa de ${nf(P.tem)} para ${nf(P.tem+n)} cabeças com o mesmo peso de entrada, o mesmo peso de hoje e o mesmo custo por cabeça. A compra deles é calculada pelo preço de simulação do lote, igual aos outros.</p>`;}
function tEntForm(t){const l=G.it[t.id];GT.entLote=l.uid;const E=t.eid&&G.it[t.eid]&&!G.it[t.eid].del?G.it[t.eid]:null,V=(k,d)=>E&&E[k]!=null&&E[k]!==''?E[k]:d;
  const tipo=E?'compra':(GT.enTipo||'');
  const cab=`<h2>${E?'✎ Alterar entrada':t.emb?'Dados da entrada':'＋ Entrada de animais'} · ${esc(l.nome)}${curralEm(l,hojeKey())?' <small>('+esc(curralEm(l,hojeKey()))+')</small>':''}</h2><p class="note">Quantidade no lote agora: ${nf(cabAtual(l))} · peso projetado hoje ${nf(pesoEm(l,hojeKey()))} kg${sexoTxt(l.sexo)?` · <b>${esc(sexoTxt(l.sexo))}</b> (o lote inteiro é do mesmo sexo)`:''}.</p>
    ${E?'':`<div class="gForm">${campo({k:'enTipo',l:'Tipo de entrada',t:'sel',op:[['','— Selecione o tipo —'],['compra','Compra / animais novos (peso e preço próprios)'],['prop','Proporcional (mesmo peso de entrada e custo/cab do lote)']],v:tipo})}</div>`}`;
  if(!tipo)return `${t.emb?'':voltar()}<section class="panel">${cab}</section>`;
  if(tipo==='prop')return `${t.emb?'':voltar()}<section class="panel">${cab}
    <p class="note"><b>Proporcional</b>: os animais entram como se estivessem no lote desde ${dB(l.ent.diaE||l.ent.dia)} — com o peso de entrada do lote, o peso projetado de hoje e o custo dos tratos por cabeça. O custo por cabeça, o consumo e o resultado por cabeça continuam os mesmos.</p>
    <div class="gForm">${[{k:'dia',l:'Data da entrada',t:'dia',v:hojeKey(),meia:1},{k:'cab',l:'Quantidade de animais',t:'num',v:'',meia:1},{k:'obs',l:'Observação (de onde veio, etc.)',v:''}].map(campo).join('')}</div>
    <div id="gEntProp" class="gApRes"></div>
    <button class="primary" data-g="salvaEntProp" data-id="${l.uid}">Salvar entrada proporcional</button></section>`;
  return `${t.emb?'':voltar()}<section class="panel">${cab}
    <div class="gForm">${[{k:'dia',l:'Data da entrada',t:'dia',v:V('dia',hojeKey()),meia:1},{k:'cab',l:'Quantidade de animais',t:'num',v:V('cab',''),meia:1},
      {k:'peso',l:'Peso médio individual',t:'num',v:V('peso',''),meia:1},{k:'pesoT',l:'Peso total',t:'num',v:E&&+E.cab>0&&+E.peso>0?Math.round(E.cab*E.peso*100)/100:'',meia:1},
      {k:'prA',l:'Preço da compra (@)',t:'rs',v:V('preco',(!l.ent.unid||l.ent.unid==='arroba')&&+l.ent.preco>0?+l.ent.preco:''),meia:1},{k:'rcE',l:'Rendimento na compra',suf:'%',t:'num',v:V('rcC',+l.ent.rcC||50),meia:1},
      {k:'rs',l:'Valor total da compra',t:'rs',v:V('rs',''),ajuda:'Preço da @ × arrobas (peso total × rendimento ÷ 15). Digitando o valor total, o preço da @ é calculado.'},{k:'sexoE',l:'Sexo',t:'sel',op:opSexos(V('sexo',l.sexo)),v:sexoNorm(V('sexo',l.sexo)),meia:1},{k:'catE',l:'Categoria',t:'sel',op:opCats(catNorm(V('cat',l.cat))),v:catNorm(V('cat',l.cat)),meia:1},
      {k:'racaE',l:'Raça',t:'sel',op:[['','Selecione']].concat(gCfg().racas.concat(V('raca',l.raca)&&!gCfg().racas.includes(V('raca',l.raca))?[V('raca',l.raca)]:[]).sort(alfa).map(r=>[r,r])),v:V('raca',l.raca||''),meia:1},{k:'idadeE',l:'Idade',suf:'meses',t:'num',v:V('idade',l.idade||''),meia:1},
      {k:'obs',l:'Observação (de onde veio, etc.)',v:V('obs','')}].map(campo).join('')}</div>
    <p class="note" id="gEntRes"></p>
    <p class="note">Os animais entram no mesmo lote e no mesmo curral. O peso médio do lote passa a ser a média dos que já estavam com os que chegaram. O custo que o lote já teve continua; daqui pra frente ele é dividido por mais cabeças.</p>
    <button class="primary" data-g="salvaEnt" data-id="${l.uid}"${E?` data-eid="${E.uid}"`:''}>${E?'Salvar alteração':'Salvar entrada'}</button></section>`;}
function calcEnt(qual){if(!$('gf_peso'))return;const c=gNum($('gf_cab')&&$('gf_cab').value),pi=gNum($('gf_peso').value),pt=gNum($('gf_pesoT').value),res=$('gEntRes');
  if(c>0&&qual==='peso'&&pi>0)$('gf_pesoT').value=vIn(Math.round(c*pi*100)/100);
  else if(c>0&&qual==='pesoT'&&pt>0)$('gf_peso').value=vIn(Math.round(pt/c*100)/100);
  else if(c>0&&qual==='cab'){if(pi>0)$('gf_pesoT').value=vIn(Math.round(c*pi*100)/100);else if(pt>0)$('gf_peso').value=vIn(Math.round(pt/c*100)/100);}
  {const P2=gNum($('gf_peso').value),rc=gNum($('gf_rcE')&&$('gf_rcE').value),arr=c>0&&P2>0&&rc>0?c*P2*rc/100/15:NaN,pr=fn('prA'),vt=fn('rs');   /* preço da @ ↔ valor total da compra */
    if(arr>0){if(qual==='rs'){if(vt>0)$('gf_prA').value=rsIn(Math.round(vt/arr*100)/100);}else if(pr>0)$('gf_rs').value=rsIn(Math.round(arr*pr*100)/100);}}
  const l=G.it[GT.entLote],P=gNum($('gf_peso').value),d=fv('dia')||hojeKey();if(!res||!l)return;
  if(c>0&&P>0&&!(GT.eid)){const a=cabEm(l,somaDias(d,-1)),pA=pesoEm(l,d),m=(a*pA+c*P)/(a+c);res.innerHTML=`Depois da entrada: <b>${nf(a+c)} cab</b> · peso médio do lote <b>${nf(m)} kg</b> (antes ${nf(pA)} kg).`;}else res.textContent='';}
/* venda: peso total vendido (vivo) e abatido (carcaça) → rendimento de carcaça sozinho; total ↔ peso médio pelas cabeças */
/* venda: médio ↔ total (vivo e abatido), rendimento ↔ abatido, @ abatidas, preço ↔ valor total e valor líquido */
function vendaAuto(q,g,p,ps){const c=g('cab');
  if(q==='vt'){if(c>0&&g('vt')>0)p('vm',g('vt')/c);}else if((q==='vm'||q==='cab')&&c>0&&g('vm')>0)p('vt',c*g('vm'));
  if(q==='arr'&&g('arr')>0)p('ct',g('arr')*15);
  if(q==='ct'||q==='arr'){if(c>0&&g('ct')>0)p('cm',g('ct')/c);}else if((q==='cm'||q==='cab')&&c>0&&g('cm')>0)p('ct',c*g('cm'));
  const vt=g('vt')||(c>0&&g('vm')>0?c*g('vm'):NaN),vm=g('vm');
  if(q==='rc'){const r=g('rc');if(r>0&&r<100){if(vt>0)p('ct',vt*r/100);if(vm>0)p('cm',vm*r/100);}}
  else if(['cab','vm','vt','cm','ct','arr'].includes(q)){const ct=g('ct'),cm=g('cm'),rc=vt>0&&ct>0?ct/vt*100:vm>0&&cm>0?cm/vm*100:NaN;if(ok(rc)&&rc>0&&rc<100)p('rc',rc);}
  let ct=g('ct');if(!(ct>0)){const r=g('rc');if(vt>0&&r>0&&r<100)ct=vt*r/100;}
  if(q!=='arr'&&ct>0)p('arr',ct/15,2);
  const u=g('unid'),base=u==='cab'?c:u==='kg'?vt:u==='arrV'?vt/30:(ct>0?ct/15:NaN);
  if(q==='vTot'){if(base>0&&g('vTot')>0)ps('preco',g('vTot')/base);}else if(q!=='vLiq'&&base>0&&g('preco')>0)ps('vTot',base*g('preco'));
  const vT=g('vTot');if(vT>0&&q!=='vLiq')ps('vLiq',vT-(g('desc')||0));}
const VENDA_K={cab:'cab',vm:'peso',cm:'carcM',ct:'carcT',arr:'arrT',rc:'rc',unid:'unid',preco:'preco',vTot:'vTot',desc:'desc',vLiq:'vLiq'};
function vendaLiga(el,campo,qDe){const g=k=>{const e=el(k);if(!e)return k==='unid'?'arroba':NaN;return k==='unid'?e.value:gNum(e.value);},
  p=(k,v,d)=>{const e=el(k);if(e&&ok(v)&&v>0)e.value=vIn(Math.round(v*Math.pow(10,d||2))/Math.pow(10,d||2));},ps=(k,v)=>{const e=el(k);if(e&&ok(v))e.value=rsIn(Math.round(v*100)/100);};
  try{vendaAuto(qDe,g,p,ps);}catch(x){}}
function calcSai(q){const M=Object.assign({},VENDA_K,{vt:'pesoVT'}),R={};Object.keys(M).forEach(k=>R[M[k]]=k);vendaLiga(k=>$('gf_'+M[k]),null,R[q]);}
function tSaiForm(t){const l=G.it[t.id],m=t.o==='morte',cfg=gCfg(),E=t.sid?G.it[t.sid]:null,V=(k,d)=>E&&E[k]!=null&&E[k]!==''?E[k]:d;
  const fs=m?[{k:'dia',l:'Data',t:'dia',v:V('dia',hojeKey()),meia:1},{k:'cab',l:'Quantidade',t:'num',v:V('cab',''),ph:'quantos morreram',meia:1},...(()=>{const og=opGrupos(l,V('dia',hojeKey()));return og?[{k:'grp',l:'Animal de qual compra',t:'sel',op:og,v:V('grp','')||'media'}]:[];})(),{k:'causa',l:'Causa',v:V('causa',''),ph:'ex.: pneumonia, timpanismo, acidente, não identificada',lista:'gCausas'},{k:'obs',l:'Observação',v:V('obs',''),ph:'ex.: brinco 1234'}]:
   [{k:'dia',l:'Data da venda',t:'dia',v:V('dia',hojeKey()),meia:1},{k:'cab',l:'Quantidade',t:'num',v:V('cab',cabAtual(l)),meia:1},...(()=>{const og=opGrupos(l,V('dia',hojeKey()));return og?[{k:'grp',l:'Animais de qual compra',t:'sel',op:og,v:V('grp','')||'media',ajuda:'A compra desses animais sai pelo preço do grupo escolhido. Em "Média do lote" sai pela média de todas as compras.'}]:[];})(),
    {k:'peso',l:'Peso vivo médio na saída',suf:'kg',t:'num',v:V('peso',Math.round(pesoEm(l,hojeKey()))),meia:1},{k:'pesoVT',l:'Peso total vendido (vivo)',suf:'kg',t:'num',v:V('pesoVT',''),meia:1},
    {k:'carcM',l:'Peso médio abatido (carcaça)',suf:'kg',t:'num',v:V('carcM',''),meia:1},{k:'carcT',l:'Peso total abatido (carcaça)',suf:'kg',t:'num',v:V('carcT',''),meia:1,ajuda:'Preencha o rendimento ou o peso abatido: o outro é calculado sozinho.'},{k:'arrT',l:'Total de arrobas abatidas',suf:'@',t:'num',v:V('carcT','')?Math.round(+V('carcT',0)/15*100)/100:'',meia:1},{k:'rc',l:'Rendimento de carcaça',suf:'%',t:'num',v:V('rc',''),ph:'digite o rendimento',meia:1,ajuda:'Preço em R$/@ morto: coloque o rendimento ou o peso de carcaça. Em R$/@ vivo, R$/cabeça ou R$/kg pode ficar em branco.'},
    {k:'unid',l:'Preço de venda em',t:'sel',op:UNID_V,v:V('unid','arroba')},{k:'preco',l:'Preço de venda',t:'rs',v:V('preco',''),meia:1},{k:'vTot',l:'Valor total da venda',t:'rs',v:V('vTot',''),meia:1},
    {k:'desc',l:'Descontos (frete, impostos)',suf:'total',t:'rs',v:V('desc',''),meia:1},{k:'vLiq',l:'Valor total líquido',t:'rs',v:V('vTot','')?(+V('vTot',0))-(+V('desc',0)):'',meia:1},
    {k:'comp',l:'Comprador',t:'sel',op:opCompradores(),v:V('comp','')},{k:'obs',l:'Observação',v:V('obs','')}];
  const novo=m?'':`<div class="gForm gCprNovo" id="gCprNovo" hidden><div class="gCampo meia"><label for="gf_cprNome">Nome do novo comprador</label><input type="text" id="gf_cprNome" autocomplete="off"></div>
    <div class="gCampo meia"><label for="gf_cprCat">Tipo</label><select id="gf_cprCat">${TIPOS_CPR.map(x=>`<option>${esc(x)}</option>`).join('')}</select></div></div>`;
  const causas=m?[...new Set(['Pneumonia','Timpanismo','Acidente / trauma','Tristeza parasitária','Clostridiose','Intoxicação','Não identificada'].concat(gTodos('saida').filter(x=>x.mot==='morte'&&x.causa).map(x=>x.causa)))]:[];
  return `${voltar()}<section class="panel"><h2>${E?'Editar ':''}${m?'✝ Morte':'Venda / saída'} · ${esc(l.nome)}${curralEm(l,hojeKey())?' <small>('+esc(curralEm(l,hojeKey()))+')</small>':''}</h2><p class="note">Quantidade no lote agora: ${nf(cabAtual(l))}.</p>
    <div class="gForm">${fs.map(campo).join('')}</div>${m?`<datalist id="gCausas">${causas.map(c=>`<option value="${esc(c)}">`).join('')}</datalist>`:''}${novo}${m?'':`<h3 class="gSubT">📊 Resultado desses animais</h3>
    <p class="note">Compra proporcional às cabeças (peso de entrada ${nf(pesoEntMed(l),1)} kg) e custos de alimentação, operacional e outros até o dia anterior. No relatório de resultado dá para recalcular a compra pelo preço da @ vendida.</p><div id="gVdRes" class="gApRes"></div>`}${!m&&!E?campoFaltas('gf_v',{}):''}<button class="primary" data-g="salvaSai" data-id="${l.uid}" data-o="${m?'morte':'venda'}"${E?` data-sid="${E.uid}"`:''}>Salvar</button>${m||E?'':'<button class="danger" data-g="vendaCanc">✕ Cancelar venda</button>'}</section>${m?(()=>{const ms=saidasDe(l).filter(x=>x.mot==='morte').sort((a,b)=>a.dia<b.dia?1:-1),tot=ms.reduce((a,x)=>a+(+x.cab||0),0);
    return `<section class="panel"><h2>✝ Mortes neste lote</h2>${ms.length?`<div class="tablebox"><table class="gTab"><thead><tr><th>Data</th><th>Qtd.</th><th>Causa / observação</th><th></th></tr></thead><tbody>${ms.map(x=>`<tr><td>${dB(x.dia)}</td><td>${nf(x.cab)}</td><td>${esc([x.causa,x.obs].filter(Boolean).join(' · ')||'—')}</td><td class="acoes"><button class="mini danger" data-g="apaga" data-id="${x.uid}" data-o="morte">✕</button></td></tr>`).join('')}</tbody></table></div>
      <p class="note">Total: <b>${nf(tot)} cab</b> · ${pc(cabEntTot(l)?tot/cabEntTot(l)*100:NaN,2)} dos que entraram.</p>`:'<p class="note">Nenhuma morte lançada neste lote.</p>'}</section>`;})():''}`;}
/* venda: compra real, custos embutidos e resultado desses animais (ao vivo) */
function vdPrevia(){const box=$('gVdRes'),l=G.it[GT.id];if(!box||!l)return;const d=fv('dia')||hojeKey(),cab=fn('cab'),peso=fn('peso');if(!(cab>0)){box.innerHTML='';return;}
  const gp=fv('grp')&&fv('grp')!=='media'?fv('grp'):null,T=saiCalc(l,d,cab,peso,GT.sid,gp),cus=T.total,rc=fn('rc'),
    v=valorVenda({cab,peso:peso>0?peso:T.p,rc:rc>0&&rc<100?rc:50,unid:fv('unid'),preco:fn('preco')||0,desc:fn('desc')||0,vTot:fn('vTot')||0}),r=v-cus;
  box.innerHTML=`<div class="gLinhas">${lin(T.porGrupo?'· compra (pelo preço do grupo escolhido)':'· compra (proporcional às cabeças)',rs(T.cst.compra))}${lin('· alimentação',rs(T.cst.alim))}${lin('· operacional',rs(T.cst.op))}${lin('· outros custos',rs(T.cst.outros))}
    ${lin('Custo desses animais',rs(cus))}${lin('Venda líquida',v>0?rs(v):'—')}${lin(r>=0?'Lucro desses animais':'Prejuízo desses animais',v>0?rs(r):'—',v>0?(r>=0?'ok':'bad'):'')}</div>
    ${T.shC>=1?'<p class="note">Saem todos os animais: a compra prevista é o que sobrou da compra do lote.</p>':''}`;}
/* ---------- compradores ---------- */
const TIPOS_CPR=['Frigorífico','Corretor','Pecuarista / recria','Leilão','Outro'];
const opCompradores=()=>[['','Selecione']].concat(gTodos('comprador').sort(porNome).map(c=>[c.uid,c.nome+(c.cat?' · '+c.cat:'')]),[['__novo','＋ Cadastrar novo comprador…']]);
const nomeCpr=s=>{const c=s.comp&&G.it[s.comp];return c&&!c.del?c.nome:(s.obs?s.obs+' (sem cadastro)':'(sem comprador)');};
const catCpr=s=>{const c=s.comp&&G.it[s.comp];return c&&!c.del?(c.cat||'Outro'):'(sem cadastro)';};
function tCompradores(){const L=gTodos('comprador').sort(porNome),vs=gTodos('saida').filter(ehVenda);
  const rows=L.map(c=>{const v=vs.filter(s=>s.comp===c.uid),cab=v.reduce((a,s)=>a+(+s.cab||0),0);
    return `<tr><td><b>${esc(c.nome)}</b><small>${esc([c.cat,c.cidade].filter(Boolean).join(' · '))}</small></td><td>${nf(v.length)}</td><td>${nf(cab)}</td><td class="acoes"><button class="mini" data-g="ir" data-t="cprForm" data-id="${c.uid}">✎</button><button class="mini danger" data-g="apagaCpr" data-id="${c.uid}">✕</button></td></tr>`;}).join('');
  return `${voltar('Relatórios')}<section class="panel"><h2>Compradores</h2>
    <button class="verde" data-g="ir" data-t="cprForm">＋ Novo comprador</button>
    ${rows?`<div class="tablebox"><table><thead><tr><th>Comprador</th><th>Vendas</th><th>Qtd.</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="note">Nenhum comprador cadastrado. Também dá para cadastrar direto na tela da venda.</p>'}</section>`;}
function tCprForm(t){const c=t.id?G.it[t.id]:{};
  return `${voltar()}<section class="panel"><h2>${t.id?'Editar comprador':'Novo comprador'}</h2><div class="gForm">${[{k:'nome',l:'Nome / frigorífico',v:c.nome||''},{k:'cat',l:'Tipo',t:'sel',op:TIPOS_CPR.map(x=>[x,x]),v:c.cat||TIPOS_CPR[0],meia:1},{k:'cidade',l:'Cidade / planta',v:c.cidade||'',meia:1},{k:'obs',l:'Observação',v:c.obs||''}].map(campo).join('')}</div>
    <button class="primary" data-g="salvaCpr"${t.id?` data-id="${t.id}"`:''}>Salvar</button></section>`;}
/* venda com os números já calculados (preço bruto e líquido por @, por kg vivo e por cabeça) */
function vendaInfo(s){const l=G.it[s.lote],arr=arrobaVenda(s),liq=valorVenda(s),bruto=liq+(+s.desc||0),cab=+s.cab||0,kg=cab*(+s.peso||0);
  return {s,l,lote:l?l.nome:'—',cpr:nomeCpr(s),cat:catCpr(s),sexo:l?sexoTxt(l.sexo)||'—':'—',raca:l&&l.raca||'—',catA:l?catNorm(l.cat)||'—':'—',cab,kg,arr,bruto,liq,desc:+s.desc||0,rc:+s.rc||0};}
const AGRUP_V=[['cpr','Comprador'],['cat','Tipo de comprador'],['sexo','Sexo'],['raca','Raça'],['catA','Categoria']];
function vendasFiltradas(t){return gTodos('saida').filter(s=>ehVenda(s)&&!s.del&&G.it[s.lote]&&!G.it[s.lote].del&&(!t.ini||s.dia>=t.ini)&&(!t.fim||s.dia<=t.fim)&&(!t.cpr||s.comp===t.cpr)).sort((a,b)=>a.dia<b.dia?1:-1).map(vendaInfo);}
function gruposVenda(V,por){const g={};V.forEach(v=>{const k=v[por];const o=g[k]=g[k]||{nome:k,n:0,cab:0,kg:0,arr:0,bruto:0,liq:0,desc:0,rcP:0};
  o.n++;o.cab+=v.cab;o.kg+=v.kg;o.arr+=v.arr;o.bruto+=v.bruto;o.liq+=v.liq;o.desc+=v.desc;o.rcP+=v.rc*v.kg;});
  return Object.values(g).map(o=>Object.assign(o,{peso:o.cab?o.kg/o.cab:NaN,rc:o.kg?o.rcP/o.kg:NaN,arrCab:o.cab?o.arr/o.cab:NaN,prB:o.arr?o.bruto/o.arr:NaN,prL:o.arr?o.liq/o.arr:NaN,rsKg:o.kg?o.liq/o.kg:NaN,rsCab:o.cab?o.liq/o.cab:NaN}))
    .sort((a,b)=>(b.rsKg||0)-(a.rsKg||0));}
function tVendas(t){const hj=hojeKey();t.ini=t.ini||somaDias(hj,-365);t.fim=t.fim||hj;t.por=t.por||'cpr';GT.vF=t;
  const V=vendasFiltradas(t),G_=gruposVenda(V,t.por),T=gruposVenda(V.map(v=>Object.assign({},v,{tudo:'Total'})),'tudo')[0];
  const melhorRc=G_.length>1?Math.max(...G_.map(o=>o.rc).filter(ok)):NaN,melhorKg=G_.length>1?G_[0].rsKg:NaN;
  const cards=G_.map(o=>`<div class="gLoteRel gVendaG"><div class="gLoteInfo"><b>${esc(o.nome)}</b><span>${nf(o.n)} venda(s) · ${nf(o.cab)} cab · ${nf(o.peso)} kg vivo</span></div>
    <div class="gLoteNums gRelNums"><span class="${o.rc===melhorRc?'ok':''}"><b>${pc(o.rc,1)}</b>rendimento</span><span><b>${nf(o.arrCab,2)}</b>@/cab</span><span><b>${rs(o.prB)}</b>@ bruta</span>
    <span><b>${rs(o.prL)}</b>@ líquida</span><span class="${o.rsKg===melhorKg?'ok':''}"><b>${rs(o.rsKg)}</b>R$/kg vivo</span><span><b>${rs(o.rsCab)}</b>R$/cab líq.</span></div></div>`).join('');
  const lista=V.map(v=>`<tr><td>${dB(v.s.dia)}</td><td>${esc(v.cpr)}<small>${esc(v.lote)}</small></td><td>${nf(v.cab)}</td><td>${nf(v.s.peso)}<small>${pc(v.rc,1)}</small></td><td>${rs(v.arr?v.bruto/v.arr:NaN)}<small>líq. ${rs(v.cab?v.liq/v.cab:NaN)}/cab</small></td><td class="acoes"><button class="mini" data-g="ir" data-t="saiForm" data-id="${v.s.lote}" data-o="venda" data-sid="${v.s.uid}">✎</button></td></tr>`).join('');
  return `${voltar('Relatórios')}<section class="panel"><h2>Vendas por comprador</h2>
    <div class="gForm"><div class="gCampo meia"><label for="gVenIni">De</label><input type="date" id="gVenIni" value="${t.ini}"></div><div class="gCampo meia"><label for="gVenFim">Até</label><input type="date" id="gVenFim" value="${t.fim}"></div>
    <div class="gCampo meia"><label for="gVenCpr">Comprador</label><select id="gVenCpr"><option value="">Todos</option>${gTodos('comprador').sort(porNome).map(c=>`<option value="${c.uid}"${t.cpr===c.uid?' selected':''}>${esc(c.nome)}</option>`).join('')}</select></div>
    <div class="gCampo meia"><label for="gVenPor">Comparar por</label><select id="gVenPor">${AGRUP_V.map(([k,n])=>`<option value="${k}"${t.por===k?' selected':''}>${n}</option>`).join('')}</select></div></div>
    ${T?`<div class="stat gStat3">${st('Cabeças vendidas',nf(T.cab))}${st('Rendimento médio',pc(T.rc,1))}${st('@ por cabeça',nf(T.arrCab,2))}${st('@ bruta média',rs(T.prB))}${st('@ líquida média',rs(T.prL))}${st('Receita líquida',rs(T.liq))}</div>`:''}
    ${cards||'<p class="note">Nenhuma venda nesse filtro.</p>'}
    <p class="note">Ordenado pelo <b>R$ por kg vivo líquido</b> (o que mais pagou pelo boi no peso da fazenda). Rendimento médio ponderado pelo peso. @ líquida = (valor − descontos) ÷ @ de carcaça. Em verde: melhor rendimento e melhor R$/kg vivo.</p>
    ${V.length?`<div class="row compart fz3"><button class="verde" data-g="pdfVendas">📄 PDF</button><button class="verde" data-g="imgVendas">🖼 Foto</button><button class="verde" data-g="xlsVendas">📊 Excel</button></div>`:''}</section>
    ${lista?card('Vendas',`<div class="tablebox"><table><thead><tr><th>Data</th><th>Comprador · lote</th><th>Qtd.</th><th>Peso · rend.</th><th>@ bruta</th><th></th></tr></thead><tbody>${lista}</tbody></table></div><p class="note">✎ para colocar ou trocar o comprador de uma venda já lançada.</p>`):''}`;}
function imgVendas(){const t=GT.vF||{},V=vendasFiltradas(t),por=t.por||'cpr',G_=gruposVenda(V,por),nomePor=(AGRUP_V.find(x=>x[0]===por)||[])[1];
  enviarImg(`Vendas por ${String(nomePor).toLowerCase()} · ${dB(t.ini)} a ${dB(t.fim)}`,[{cab:'Comparativo',cols:[[nomePor,230,'l'],['Cab.',70,'r'],['Peso',80,'r'],['Rend.',85,'r'],['@/cab',85,'r'],['@ bruta',120,'r'],['@ líq.',120,'r'],['R$/kg vivo',115,'r']],
    linhas:G_.map(o=>[o.nome,nf(o.cab),nf(o.peso),pc(o.rc,1),nf(o.arrCab,2),rs(o.prB),rs(o.prL),rs(o.rsKg)])},
    {cab:'Vendas',cols:[['Data',110,'l'],['Comprador',220,'l'],['Lote',150,'l'],['Cab.',60,'r'],['Peso',75,'r'],['Rend.',80,'r'],['@ bruta',115,'r']],linhas:V.map(v=>[dB(v.s.dia),v.cpr,v.lote,nf(v.cab),nf(v.s.peso),pc(v.rc,1),rs(v.arr?v.bruto/v.arr:NaN)])}],`Vendas ${dB(t.fim).replace(/\//g,'-')}`);}
function xlsVendas(){const t=GT.vF||{},V=vendasFiltradas(t),por=t.por||'cpr',G_=gruposVenda(V,por),nomePor=(AGRUP_V.find(x=>x[0]===por)||[])[1];
  gExcel(`Vendas ${dB(t.ini).replace(/\//g,'-')} a ${dB(t.fim).replace(/\//g,'-')}`,[
    ['Comparativo',[nomePor,'Vendas','Cabeças','Peso vivo médio','Rendimento','@/cab','@ total','Preço @ bruto','Preço @ líquido','R$/kg vivo líq.','R$/cab líq.','Descontos','Receita líquida'],G_.map(o=>[xc(o.nome),xc(o.n,'int'),xc(o.cab,'int'),xc(o.peso,'int'),xc(o.rc/100,'pct'),xc(o.arrCab,'dec'),xc(o.arr,'dec'),xc(o.prB,'rs'),xc(o.prL,'rs'),xc(o.rsKg,'rs'),xc(o.rsCab,'rs'),xc(o.desc,'rs'),xc(o.liq,'rs')])],
    ['Vendas',['Data','Comprador','Tipo','Lote','Sexo','Raça','Categoria','Cabeças','Peso vivo','Rendimento','@ total','Preço @ bruto','Descontos','Receita líquida','R$/cab líq.','Obs.'],V.map(v=>[xc(v.s.dia,'dia'),xc(v.cpr),xc(v.cat),xc(v.lote),xc(v.sexo),xc(v.raca),xc(v.catA),xc(v.cab,'int'),xc(+v.s.peso,'int'),xc(v.rc/100,'pct'),xc(v.arr,'dec'),xc(v.arr?v.bruto/v.arr:NaN,'rs'),xc(v.desc,'rs'),xc(v.liq,'rs'),xc(v.cab?v.liq/v.cab:NaN,'rs'),xc(v.s.obs||'')])]]);}
/* ---------- Rações por curral: muda a ração de um, de alguns ou de todos os currais (vale para os lotes que estão neles) ---------- */
const lotesNoCur=(n,d)=>gTodos('lote').filter(l=>cabPres(l,d)>0&&curralEm(l,d)===n).sort(porNome);
function tRacCur(t){const A=window.curraisApi,hj=hojeKey(),loc=t.loc||'T';if(!A)return '';
  const L=A.lista().filter(n=>!A.info(n).inativo&&(loc==='T'||A.info(n).tipo===loc)).sort(alfa);
  const linhas=L.map(n=>{const ls=lotesNoCur(n,hj),rac=ls.map(l=>{const r=racaoEm(l,hj);return r?r.nome:'sem ração';});
    return `<label class="gRcLin${ls.length?'':' gInativa'}"><input type="checkbox" data-rc="${esc(n)}"${ls.length?'':' disabled'}><b>${esc(n)}</b><span>${ls.length?esc(ls.map(l=>l.nome).join(' + ')):'sem lote'}</span><em>${esc([...new Set(rac)].join(' / ')||'—')}</em></label>`;}).join('');
  return `${voltar('Rações')}<section class="panel"><h2>🌾 Rações por curral</h2>
    ${locBotoes('rcLoc',loc)}
    <div class="row"><button class="mini" data-g="rcMarca" data-v="1">✓ Marcar todos</button></div>
    <div class="gRcLista"><div class="gRcLin gRcCab"><span></span><b>Curral</b><span>Lote</span><em>Ração agora</em></div>${linhas||'<p class="note">Nenhum curral.</p>'}</div>
    <div class="gForm">${[{k:'rcDesde',l:'A partir de',t:'dia',v:hj,meia:1},{k:'rcRac',l:'Nova ração',t:'sel',op:opRacoes(''),v:'',meia:1}].map(campo).join('')}</div>
    <button class="primary" data-g="salvaRacCur">Mudar a ração dos currais marcados</button>
    <p class="note">A ração muda para o lote que está em cada curral marcado, a partir da data escolhida. O que já foi tratado antes dessa data continua com a ração antiga.</p></section>`;}
/* ---------- Mudar animais de curral: o lote inteiro vai para outro curral e leva tudo (custos, pesagens, histórico) ---------- */
/* lotes do curral de origem: todos já marcados (move tudo); desmarque para mover só um */
function mcLotesHTML(o){if(!o)return '';const ls=lotesNoCur(o,hojeKey());if(!ls.length)return '<p class="note">Nenhum lote nesse curral.</p>';
  return `<label>Lotes que vão mudar</label>${ls.map(l=>`<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-weight:600"><input type="checkbox" data-mclote="${l.uid}" checked style="width:20px;height:20px"> ${esc(l.nome)} · ${nf(cabAtual(l))} cab${sexoTxt(l.sexo)?' · '+esc(sexoTxt(l.sexo)):''}</label>`).join('')}${ls.length>1?'<p class="note">Todos marcados: o curral inteiro muda. Desmarque o lote que deve ficar.</p>':''}`;}
document.addEventListener('change',e=>{if(e.target&&e.target.id==='gf_mcO'){const w=$('mcLotes');if(w)w.innerHTML=mcLotesHTML(e.target.value);}});
function tMudCur(t){const A=window.curraisApi,hj=hojeKey();if(!A)return '';
  const com=A.lista().filter(n=>lotesNoCur(n,hj).length).sort(alfa);
  const opO=[['','Selecione']].concat(com.map(n=>{const ls=lotesNoCur(n,hj);return [n,`${n} · ${ls.map(l=>l.nome+' ('+nf(cabAtual(l))+' cab)').join(' + ')}`];}));
  const opD=[['','Selecione']].concat(opCurrais('',false).map(([n])=>{const ls=lotesNoCur(n,hj);return [n,n+(ls.length?` (ocupado: ${ls.map(l=>l.nome).join(' + ')})`:' (vazio)')];}));
  return `${voltar('Currais')}<section class="panel"><h2>↔ Mudar animais de curral</h2>
    <div class="gForm">${[{k:'mcO',l:'Curral de origem',t:'sel',busca:1,op:opO,v:t.ori||''}].map(campo).join('')}
      <div class="gCampo" id="mcLotes">${mcLotesHTML(t.ori||'')}</div>
      ${[{k:'mcD',l:'Curral de destino',t:'sel',busca:1,op:opD,v:''},{k:'mcDia',l:'A partir de',t:'dia',v:hj}].map(campo).join('')}
      <div class="gCampo"><label for="gf_mcObs">Observação</label><textarea id="gf_mcObs" rows="2" placeholder="Ex.: motivo da mudança" style="width:100%;box-sizing:border-box;resize:vertical;font:inherit"></textarea></div></div>
    <button class="primary" data-g="salvaMudCur">Mudar de curral</button>
    <p class="note">O lote vai inteiro para o curral de destino com tudo o que já tem (entrada, custos, pesagens, ração). Os tratos de cada dia contam para o lote que estava no curral naquele dia: o que foi tratado antes da data continua no curral antigo, e um lote que já saiu (arquivado) não recebe nada novo.</p></section>`;}
/* ---------- ajuste de curral ou ração de um lote ---------- */
function tMudForm(t){const l=G.it[t.id],c=t.o==='curr';
  return `${voltar()}<section class="panel"><h2>${c?'Mudar curral':'Mudar ração'} · ${esc(l.nome)}</h2><div class="gForm">${[
    {k:'desde',l:'A partir de',t:'dia',v:hojeKey()},
    c?{k:'val',l:'Novo curral / pasto',t:'sel',op:opCurrais(curralEm(l,hojeKey())),v:curralEm(l,hojeKey())}:{k:'val',l:'Nova ração',t:'sel',op:opRacoes((vig(l.rac,hojeKey())||{}).r),v:(vig(l.rac,hojeKey())||{}).r||''}].map(campo).join('')}</div>
    <button class="primary" data-g="salvaMud" data-id="${l.uid}" data-o="${t.o}">Salvar</button></section>`;}

/* ---------- relatório do lote ---------- */
/* relatório da apartação (lote que foi dividido): ganho até a pesagem da apartação, custos e para onde foi cada parte */
function tRelApart(l,C){const R=C.R,cabE=C.cabE,cabR=C.cabE-(C.cabT||0)-(C.faltas||0),F=filhosApart(l,C),d=C.aps[0].dia;
  const res=[];const add=(a,b)=>res.push([a,b]);
  add('Lote',l.nome);add('Período',`${dB(l.ent.dia)} a ${dB(d)} (${nf(C.dias)} dias)`);add('Entrada',`${nf(cabE)} cab · ${nf(C.pesoE,1)} kg`);add('Mortes',`${nf(C.mortes)} (${pc(C.mortPct,2)})`);
  add('Apartados',`${nf(C.cabA)} cab · ${nf(C.pesoA,1)} kg`);add('GMD real',nf(C.gmdV,3)+' kg/dia');add('Ganho total',nf(C.ganhoV)+' kg');add('@ produzidas (peso vivo)',nf(C.arrPV,2));
  add('MS/cab/dia',nf(C.msCab,2)+' kg');add('% do peso vivo',pc(C.pv,2));add('Conversão alimentar',nf(C.conv,2));add('Peso de entrada (vivo)',nf(C.pesoE,1)+' kg');add('Peso de saída (vivo)',nf(ok(C.ganhoV)&&C.cabP?C.pesoE+C.ganhoV/C.cabP:NaN,1)+' kg');add('Dias de cocho (média ponderada)',nf(C.diasCocho,1)+' dias');
  linhasCompra(l,C).forEach(([a,v])=>add(a,rs(v)));if(C.cabT)add('Transferidos para outros lotes',`${nf(C.cabT)} cab · levaram ${rs(C.trOut)}`);if(C.cabTV)add('Venda interna (para outros lotes)',`${nf(C.cabTV)} cab · ${rs(C.recInt)} · resultado ${rs(C.resInt)}`);add('Custos de alimentação',rs(C.alim));add('Custo operacional',rs(C.op));add('Outros custos',rs(C.outros));add('Custo total até a apartação',rs(C.custo));
  add('Diária média',rs(C.diaria)+' por cab/dia');add('Custo da @ produzida (peso vivo)',rs(C.custoArrPV));add('Custo do kg ganho',rs(C.custoKg));
  F.forEach(f=>add('→ '+f.nome,`${nf(f.cab)} cab · ${nf(f.peso,1)} kg · ${pc(f.pct,1)} do peso · leva ${rs(f.custo)}`));
  if(ok(F.res))add(F.todos?'Resultado do grupo':'Resultado do grupo (parcial/estimado)',rs(F.res)+(ok(F.rentab)?` · ${pc(F.rentab,1)}`:''));
  GT.relRes=res;
  const cd=R.cabDias||1;
  return `${voltar()}<section class="panel"><div class="gLoteTopo">${seloCurral(curralEm(l,C.ate))}<div><h2>${esc(l.nome)}</h2><span class="pill">Relatório da apartação</span>
      <p class="note">${dB(l.ent.dia)} a ${dB(d)} · ${nf(C.dias)} dias · ${nf(cabE)} cab · entrada ${nf(C.pesoE,1)} kg</p></div></div>
    <div class="gHero"><small>Custo até a apartação</small><b>${rs(C.custo)}</b><span>${rs(C.custo/cabR)} por cabeça · dividido em ${C.aps.length} lotes pelo peso</span></div>
    <div class="row compart fz3"><button class="verde" data-g="pdfLote" data-id="${l.uid}">📄 PDF</button><button class="verde" data-g="imgLote" data-id="${l.uid}">🖼 Foto</button><button class="verde" data-g="xlsLote" data-id="${l.uid}">📊 Excel</button></div></section>
  ${card('Ganho até a apartação',`<div class="stat gStat2">${st('GMD real',nf(C.gmdV,2)+' kg<small>pela pesagem da apartação</small>')}${st('Peso na apartação',nf(C.pesoA,1)+` kg<small>entrada ${nf(C.pesoE,1)} kg · +${nf(C.pesoA-C.pesoE,1)} kg</small>`)}${st('Ganho total',nf(C.ganhoV)+' kg<small>'+nf(C.arrPV,2)+' @ peso vivo</small>')}${st('Dias de cocho',nf(C.diasCocho,1)+' dias<small>média ponderada</small>')}${st('MS por cab/dia',nf(C.msCab,2)+` kg<small>${pc(C.pv,2)} do peso vivo</small>`)}${st('Conversão alimentar',nf(C.conv,2)+`<small>eficiência ${nf(C.efic,3)}</small>`)}${st('Mortes',nf(C.mortes)+`<small>${pc(C.mortPct,2)}</small>`)}${st('Apartados',nf(C.cabA)+' cab')}</div>`)}
  ${card('Custos até a apartação',`<div class="tablebox"><table class="gCustos"><thead><tr><th>Custo</th><th>Total</th><th>Por cabeça</th></tr></thead><tbody>
    ${[...linhasCompra(l,C).map(([a,v])=>[a,v,0]),['Custos de alimentação',C.alim,1],['Operacional',C.op,1],['Outros custos',C.outros,1]].map(([a,v,dd])=>`<tr><td>${a}<small>${pc(C.custo?v/C.custo*100:NaN,1)} do total</small></td><td>${rs(v)}</td><td>${rs(v/cabR)}${dd?`<small>${rs(v/cd)} cab/dia</small>`:''}</td></tr>`).join('')}
    <tr class="grp"><td>Total</td><td>${rs(C.custo)}</td><td>${rs(C.custo/cabR)}<small>${rs(C.diaria)} cab/dia</small></td></tr></tbody></table></div>
    <div class="stat gStat2">${st('Custo da @ produzida',rs(C.custoArrPV)+'<small>custos sem compra ÷ @ peso vivo</small>')}${st('Custo do kg ganho',rs(C.custoKg)+'<small>custos sem compra ÷ kg ganhos</small>')}</div>`)}
  ${card('Divisão na apartação · '+dB(d),`<div class="tablebox"><table><thead><tr><th>Lote novo</th><th>Qtd.</th><th>Peso</th><th>% peso</th><th>Custo que levou</th></tr></thead><tbody>
    ${F.map(f=>`<tr><td><button class="mini" data-g="lote" data-id="${f.uid}">${esc(f.nome)}</button></td><td>${nf(f.cab)}</td><td>${nf(f.peso,1)}</td><td>${pc(f.pct,1)}</td><td>${rs(f.custo)}<small>${rs(f.custo/f.cab)}/cab</small></td></tr>`).join('')}</tbody></table></div>
    <p class="note">Cada lote novo leva o custo total × (cabeças × peso médio dele) ÷ peso total apartado. Quem pesa mais leva mais custo.</p>`)}
  ${card('Resultado do grupo',`<div class="gLinhas">${F.map(f=>lin(`${esc(f.nome)}<small> · ${esc(f.sit)}</small>`,ok(f.res)?rs(f.res)+(f.est?' (est.)':''):'—',ok(f.res)?(f.res>=0?'ok':'bad'):'')).join('')}</div>
    <div class="gHero ${ok(F.res)?(F.res>=0?'pos':'neg'):''}"><small>${F.todos?'Resultado do grupo':'Resultado do grupo (parcial / estimado)'}</small><b>${ok(F.res)?rs(F.res):'—'}</b><span>${ok(F.rentab)?'rentabilidade '+pc(F.rentab,1):'soma o lucro dos lotes novos (já incluem o custo trazido)'}</span></div>`)}`;}
function tRelLote(t){
  RELCMP=t.cmp==='venda'?{uid:t.id}:null;
  const l=G.it[t.id],C=calcLote(l),R=C.R,hj=hojeKey(),cfg=gCfg(),fim=C.fim,cabE=C.cabE,cabR=C.cabE-(C.cabT||0)-(C.faltas||0);if(C.apart)return tRelApart(l,C);
  const avisos=[R.semPreco?`${R.semPreco} dia(s) com ração sem preço ou sem matéria seca completa.`:'',R.semReg?`${R.semReg} dia(s) sem trato lançado no curral do lote.`:''].filter(Boolean);
  const gmd=C.cabV?C.gmdV:NaN;
  const res=[];const add=(a,b)=>res.push([a,b]);
  add('Lote',l.nome);add('Período',`${dB(l.ent.dia)} a ${dB(C.ate)} (${nf(C.dias)} dias)`);add('Entrada',`${nf(cabE)} cab · ${nf(C.pesoE)} kg`);
  add('MS/cab/dia',nf(C.msCab,2)+' kg');add('MN/cab/dia',nf(C.mnCab,2)+' kg');add('% do peso vivo',pc(C.pv,2));
  add('Dias de consumo (média)',nf(C.diasMed,1)+' dias');if(C.cabV)add('Dias de cocho (média ponderada)',nf(C.diasCocho,1)+' dias');add('Mortes',`${nf(C.mortes)} (${pc(C.mortPct,2)} de mortalidade)`);if(C.faltas)add('Faltaram (sumidos)',`${nf(C.faltas)} cab · levaram ${rs(C.fOut)} de custo (aguardando serem achados)`);
  linhasCompra(l,C).forEach(([a,v])=>add(a,rs(v)));if(C.cabT)add('Transferidos para outros lotes',`${nf(C.cabT)} cab · levaram ${rs(C.trOut)}`);if(C.cabTV)add('Venda interna (para outros lotes)',`${nf(C.cabTV)} cab · ${rs(C.recInt)} · resultado ${rs(C.resInt)}`);add('Custos de alimentação',rs(C.alim));add('Custo operacional',rs(C.op));add('Outros custos',rs(C.outros));add('Custo total',rs(C.custo));add('Custo por cabeça',rs(C.custo/cabR));
  add('Diária média (total)',rs(C.diaria)+' por cab/dia');add('Diária · alimentação / operacional / outros',`${rs(C.diaAlim)} / ${rs(C.diaOp)} / ${rs(C.diaOut)}`);if(C.cabV)add('Custo da @ produzida',rs(C.custoArr));
  if(C.cabV){add('Vendidos',`${nf(C.cabV)} cab · ${nf(C.pesoV)} kg`);add('Receita líquida',rs(C.receita));add('Preço de venda da @',rs(C.precoArr));add('GMD real',nf(gmd,3)+' kg/dia');add('@ produzidas (peso vivo)',nf(C.arrPV,2));add('@ produzidas (carcaça)',nf(C.arrProd,2));add('Conversão alimentar',nf(C.conv,2));add('Peso de entrada (vivo)',nf(C.pesoE,1)+' kg');add('Peso de saída (vivo)',nf(ok(C.ganhoV)&&C.cabP?C.pesoE+C.ganhoV/C.cabP:NaN,1)+' kg');}
  if(fim){add(C.lucro>=0?'LUCRO':'PREJUÍZO',rs(C.lucro));add('Lucro por cabeça',rs(C.lucroCab));add('Lucro por @',rs(C.lucroArr));add('Rentabilidade',pc(C.rentab,1)+' (lucro ÷ custo total)');}
  const E=fim?null:estVendaDet(l,C);
  if(E&&E.pr>0){add('Venda estimada',`${rs(E.rec)} (${nf(E.arrCab,2)} @/cab × ${rs(E.pr)} · rend. ${nf(E.rc,1)}%)`);add(E.res>=0?'Resultado estimado':'Prejuízo estimado',`${rs(E.res)} (${rs(E.resCab)}/cab · ${pc(E.margem,1)})`);add('Preço da @ para empatar',rs(E.pontoEq));}
  const DL=dadosLotePares(l,C);res.splice(1,0,...DL.filter(x=>!/Entrada/.test(x[0])));
  GT.relRes=res;
  const hero=fim?`<div class="gHero ${C.lucro>=0?'pos':'neg'}"><small>${C.lucro>=0?'Lucro':'Prejuízo'}</small><b>${rs(C.lucro)}</b><span>${rs(C.lucroCab)} por cabeça · ${rs(C.lucroArr)} por @ · rentabilidade ${pc(C.rentab,1)}</span></div>`
    :`<div class="gHero"><small>Custo até hoje</small><b>${rs(C.custo)}</b><span>${rs(C.custo/cabR)} por cabeça · ${rs(C.custoCabDia)} por cab/dia (ração + operacional)</span></div>`;
  const cd=R.cabDias||1,linC=(a,v,cls,dia)=>`<tr class="${cls||''}"><td>${a}<small>${pc(C.custo?v/C.custo*100:NaN,1)} do total</small></td><td>${rs(v)}</td><td>${rs(v/cabR)}${dia?`<small>${rs(dia===2?C.custoCabDia:v/cd)} cab/dia</small>`:''}</td></tr>`;
  const custos=`<div class="tablebox"><table class="gCustos"><thead><tr><th>Custo</th><th>Total</th><th>Por cabeça</th></tr></thead><tbody>
    ${linhasCompra(l,C).map(([a,v])=>linC(a,v)).join('')}${linC('Custos de alimentação',C.alim,'',1)}${linC('Operacional',C.op,'',1)}${linC('Outros custos',C.outros,'',1)}${linC('Total',C.custo,'grp',2)}</tbody></table></div>
    <div class="stat gStat2">${st('Diária média (total)',rs(C.diaria)+'<small>R$ por cab/dia no período todo · alimentação + operacional + outros</small>')}${st('Separação da diária',`<small>alimentação</small> ${rs(C.diaAlim)}<br><small>operacional</small> ${rs(C.diaOp)}<br><small>outros</small> ${rs(C.diaOut)}`)}</div>
    ${C.cabV?`<div class="stat gStat2">${st('Custo da @ produzida',rs(C.custoArr)+'<small>alimentação + operacional + outros ÷ @ produzidas (carcaça)</small>')}</div>`:''}
    ${notaTransf(C)?`<p class="aviso">${notaTransf(C)}</p>`:''}<p class="note"><b>Compra</b>: cabeças × peso × rendimento ÷ 15 × preço da @ (+ frete/outros). <b>Alimentação</b>: kg fornecidos no curral × custo do kg da ração no dia (se tem mais de um lote no curral, divide pelas cabeças). <b>Operacional</b>: taxa da Config. × cabeças × dias. <b>Cab/dia</b>: ração e operacional divididos por ${nf(cd)} cabeças-dia (no total, sem a compra).</p>`;
  const desemp=`<div class="stat gStat2">${st('MS por cab/dia',nf(C.msCab,2)+' kg')}${st('% do peso vivo',pc(C.pv,2))}${st('MN por cab/dia',nf(C.mnCab,2)+' kg')}${st(C.cabV?'GMD real':'GMD meta',nf(C.cabV?gmd:l.gmd,2)+' kg')}</div>
    <div class="stat gStat2">${st('Dias de consumo',nf(C.diasMed,1)+' dias<small>média por animal</small>')}${C.cabV?st('Dias de cocho',nf(C.diasCocho,1)+' dias<small>média ponderada dos vendidos</small>'):''}${st('Mortes',nf(C.mortes)+`<small>${pc(C.mortPct,2)} de mortalidade${C.faltas?` · ${nf(C.faltas)} faltaram`:''}</small>`)}${C.cabP?st('Peso de entrada · saída',`${nf(C.pesoE,1)} → ${nf(ok(C.ganhoV)&&C.cabP?C.pesoE+C.ganhoV/C.cabP:NaN,1)} kg<small>vivo, média por cabeça</small>`):''}</div>
    ${C.cabV?`<div class="stat gStat2">${st('Conversão alimentar',nf(C.conv,2))}${st('@ produzidas · peso vivo',nf(C.arrPV,2)+`<small>${nf(C.arrPV/C.cabV,2)} por cab</small>`)}${st('@ produzidas · carcaça',nf(C.arrProd,2)+`<small>${nf(C.arrProd/C.cabV,2)} por cab</small>`)}</div>`:''}
    <p class="note">Médias de ${nf(R.dias)} dia(s) com animais no lote${R.semReg?` (${nf(R.semReg)} sem trato lançado)`:''}. MS = matéria seca (MN × % MS da ração). % do peso vivo = MS por cabeça ÷ peso projetado do dia.</p>`;
  const venda=C.cabV?card(fim?'Venda':'Vendas até agora',`<div class="stat gStat2">${st('Cabeças vendidas',nf(C.cabV)+(C.mortes?` <small>+${nf(C.mortes)} morte(s)</small>`:''))}${st('Peso vivo médio',nf(C.pesoV)+' kg')}${st('@ por cabeça',nf(C.arrV/C.cabV,2))}${st('Receita líquida',rs(C.receita))}</div>
    <div class="gLinhas">${lin('Preço de venda da @',rs(C.precoArr))}${lin('Receita por cabeça',rs(C.receita/C.cabV))}${C.nVdR?lin(C.resVd>=0?'Lucro dos vendidos (compra real + custos)':'Prejuízo dos vendidos (compra real + custos)',rs(C.resVd),C.resVd>=0?'ok':'bad'):''}</div>
    ${fim?'':'<p class="note">O lote ainda tem animais: o lucro final aparece quando sair o último.</p>'}`):'';
  const est=fim?'':card('Estimativa de venda hoje',E&&E.pr>0?`<div class="gHero ${E.res>=0?'pos':'neg'}"><small>${E.res>=0?'Resultado estimado':'Prejuízo estimado'}</small><b>${rs(E.res)}</b><span>${rs(E.resCab)} por cabeça · ${pc(E.margem,1)} sobre o custo</span></div>
    <div class="gLinhas">${lin('Cabeças no lote',nf(C.cabAt))}${lin('Peso projetado hoje',nf(E.peso,1)+' kg')}${lin('Rendimento de carcaça',pc(E.rc,1))}${lin('@ por cabeça',nf(E.arrCab,2))}${lin('@ total',nf(E.arrTot,1))}${lin('Preço da @',rs(E.pr))}
    ${C.receita?lin('Vendas já feitas',rs(C.receita)):''}${C.resInt?lin('Resultado das vendas internas',rs(C.resInt)):''}${lin('Venda estimada',rs(E.rec))}${lin('Custo total até hoje',rs(C.custo))}${lin('Preço da @ para empatar',rs(E.pontoEq))}${ok(E.custoArr)?lin('Custo da @ produzida (estim.)',rs(E.custoArr)):''}</div>
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
    ${(()=>{const A=C.cmpAlt||compraPelaVenda(l,calcLote0(l));if(!A)return '';const v=t.cmp==='venda';
      return `<div class="gCmpOp"><span>Compra dos animais</span><div class="row gRelAtalhos"><button type="button" class="mini${v?'':' sel'}" data-g="cmpModo" data-o="lanc">Lançada</button><button type="button" class="mini${v?' sel':''}" data-g="cmpModo" data-o="venda">Pelo preço da @ vendida</button></div>
        ${v?`<p class="note">Compra recalculada: ${nf(A.arrC,2)} @ de entrada (peso de entrada × rendimento ÷ 15) × <b>${rs(A.pV)}/@</b> (média da @ vendida) = <b>${rs(A.nova)}</b> · lançada ${rs(A.lanc)} (${A.delta>=0?'+':''}${rs(A.delta)}).</p>`:''}</div>`;})()}
    <div class="row compart fz3"><button class="verde" data-g="pdfLote" data-id="${l.uid}">📄 PDF</button><button class="verde" data-g="imgLote" data-id="${l.uid}">🖼 Foto</button><button class="verde" data-g="xlsLote" data-id="${l.uid}">📊 Excel</button></div></section>
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
const notaTxt=n=>n==null||n===''?'IMS':(n>0?'+':'')+nf(n,0);   // leitura só por % IMS (sem nota)
/* notas em duas linhas: em cima 0, +1, +2… ; embaixo −1, −2… (cada uma debaixo da sua positiva) */
function gradeNotas(notas,nota,c){const cima=notas.filter(x=>x.n>=0).sort((a,b)=>a.n-b.n),baixo=notas.filter(x=>x.n<0).sort((a,b)=>b.n-a.n);
  const tem0=cima.length&&cima[0].n===0,cols=Math.max(cima.length,baixo.length+(tem0?1:0),1);
  const bt=x=>`<button class="${x.n===nota?'sel':''} ${x.p>0?'mais':x.p<0?'menos':''}" data-g="nota" data-c="${esc(c)}" data-n="${x.n}" title="${esc(x.t)}">${notaTxt(x.n)}<small>${x.p>0?'+':''}${nf(x.p,0)}%</small></button>`;
  /* o 0 ocupa a 1ª coluna nas duas linhas e fica no meio, na altura entre positivos e negativos */
  const z=tem0?bt(cima[0]).replace('<button class="','<button style="grid-column:1;grid-row:1 / span 2;align-self:center" class="gZero '):'',pos=tem0?cima.slice(1):cima;
  return `<div class="gNotas" style="grid-template-columns:repeat(${cols},1fr)">${z}${pos.map(bt).join('')}${'<span></span>'.repeat(Math.max(0,cols-(tem0?1:0)-pos.length))}${baixo.map(bt).join('')}</div>`;}
/* leitura: hoje edita; amanhã libera quando o trato de hoje terminar; leituras antigas não mudam */
function leitPode(dia){const hj=hojeKey();if(dia===hj)return {ok:true};
  if(dia===somaDias(hj,1)){if(window.prevApi&&prevApi.diaFinalizado(hj))return {ok:true};const lb=G.it['libleit_'+hj];if(lb&&!lb.del)return {ok:true};
    const F=window.prevApi&&prevApi.faltaDia?prevApi.faltaDia(hj):[],por={};F.forEach(x=>(por[x.trato]=por[x.trato]||[]).push(x.curral));
    return {ok:false,lib:true,falta:Object.keys(por).map(k=>`Trato ${k}: ${por[k].join(', ')}`),msg:'A leitura de amanhã libera quando o trato de hoje terminar (todos os tratos registrados).'};}
  if(dia<hj)return {ok:false,msg:'Leitura de dia que já passou: só consulta, não muda.',ver:true};
  return {ok:false,msg:'Só dá para fazer a leitura de hoje ou de amanhã.'};}
/* liberar a leitura de amanhã mesmo com curral sem registro hoje (vale para todos os aparelhos, só para o dia) */
async function libLeitura(){const hj=hojeKey(),F=window.prevApi&&prevApi.faltaDia?prevApi.faltaDia(hj):[];
  if(!await pedirSenhaAcao('Senha para liberar a leitura'))return;
  if(F.length&&!confirm(`Liberar a leitura de amanhã sem registrar:\n${F.map(x=>`• Trato ${x.trato} · ${x.curral}`).join('\n')}\n\nEsses tratos continuam podendo ser registrados depois.`))return;
  gPut({uid:'libleit_'+hj,tipo:'libleit',dia:hj,falta:F.map(x=>x.trato+'|'+x.curral),ts0:Date.now()});toast('Leitura de amanhã liberada');gRender();}
function tCocho(t){
  const lc=GT.coLoc||'T',dia=t.dia||hojeKey(),ont=somaDias(dia,-1),ix=gIndice(),cfg=gCfg(),CsT=cochoCurrais(dia).filter(c=>typeof curralAtivo!=='function'||curralAtivo(c)),Cs=CsT.filter(c=>lc==='T'||linhaDe(c)===lc),hoje=dia===hojeKey(),pode=leitPode(dia),amanha=dia===somaDias(hojeKey(),1);
  const notas=cfg.notas.slice().sort((a,b)=>a.n-b.n);
  GT.dia=dia;GT.sel=GT.sel||{};
  const rows=Cs.map(c=>{const L=gTodos('lote').filter(l=>curralEm(l,dia)===c&&cabPres(l,dia)>0);
    const ontem=ix.get(ont+'|'+c)||0,pt=prevTotal(c),cab=L.reduce((a,l)=>a+cabPres(l,dia),0);
    let base=ontem,orig=dia===hojeKey()?'realizado ontem':ont===hojeKey()?'realizado de hoje':'realizado do dia anterior';
    /* base escolhida à mão (o dia anterior não serve de referência): outra data, previsto ou digitada */
    const lt0=G.it[idLeit(dia,c)],bs0=(GT.base||{})[c]||(lt0&&!lt0.del&&lt0.baseM&&lt0.baseM!=='ontem'?{m:lt0.baseM,d:lt0.baseDia,kg:lt0.base}:null),bs=bs0&&bs0.m!=='ontem'?bs0:null;
    if(bs&&bs.m==='dia'&&bs.d){base=ix.get(bs.d+'|'+c)||0;orig='realizado de '+diaBR(bs.d).slice(0,5);}
    else if(bs&&bs.m==='prev'){base=window.prevApi?(prevApi.totalDia||prevApi.totalCurral)(c,prevApi.prevDoDia(ont),ont):0;orig='previsto de '+(ont===hojeKey()?'hoje':diaBR(ont).slice(0,5));}
    else if(bs&&bs.m==='kg'&&ok(bs.kg)){base=+bs.kg;orig='base digitada';}
    /* sem trato no dia anterior: a base é o realizado do primeiro dia anterior que teve trato */
    let dBase=ont;if(!bs&&!ontem){for(let i=2;i<=30;i++){const d=somaDias(dia,-i),v=ix.get(d+'|'+c)||0;if(v){base=v;dBase=d;orig=`realizado de ${diaBR(d).slice(0,5)}, último dia com trato`;break;}}}
    const bm=bs?bs.m:'ontem';
    /* MS da ração mudou entre o dia da base e o dia da leitura: a base (kg de matéria natural) é convertida para dar a mesma matéria seca */
    let msFator=1;{const dB_=bm==='kg'?null:bm==='dia'&&bs?bs.d:dBase,fx=dB_?fatorMS(c,dB_,dia):1;if(base&&ok(fx)&&Math.abs(fx-1)>0.0005){const a=msRacCurral(c,dB_),b=msRacCurral(c,dia);base=Math.round(base*fx);msFator=fx;orig+=` · ajustado pela MS da ração ${pc(a,1)} → ${pc(b,1)}`;}}
    const chips=[1,2,3].map(i=>{const d=somaDias(dia,-i),v=ix.get(d+'|'+c)||0;return `<button type="button" class="mini${bm==='dia'&&bs&&bs.d===d?' sel':''}" data-g="baseDia" data-c="${esc(c)}" data-d="${d}"${v?'':' disabled'}>${diaBR(d).slice(0,5)}<small>${v?nf(v)+' kg':'sem trato'}</small></button>`;}).join('');
    const opB=(m,txt)=>`<button type="button" class="gBaseBt${bm===m?' sel':''}" data-g="baseM" data-c="${esc(c)}" data-m="${m}">${txt}</button>`;
    if(!base&&!bs&&pt){base=pt;orig='previsto atual';}
    if(!base&&!bs){const ms=L.reduce((a,l)=>{const r=racaoEm(l,dia),cp=r&&compRacao(r,dia);return a+(cp?cabPres(l,dia)*pesoEm(l,dia)*cfg.pvIni/100/(cp.ms/100):0);},0);base=Math.round(ms);orig=`sugestão ${nf(cfg.pvIni,1)}% PV`;}
    if(lt0&&!lt0.del&&ok(+lt0.base)&&leitTravada(dia,c)){base=+lt0.base;orig='usada na leitura';}
    const lt=G.it[idLeit(dia,c)],sel=GT.sel[c]||(lt&&!lt.del?{n:lt.nota,kg:lt.novo,ims:lt.ims}:null);
    const nota=sel&&sel.n!=null?sel.n:null,cn=notas.find(x=>x.n===nota);
    const sug=cn?arred(base*(1+cn.p/100),cfg.arred):null,kg=sel&&ok(sel.kg)?sel.kg:sug;
    const ant=[3,2,1].map(i=>{const x=G.it[idLeit(somaDias(dia,-i),c)];return x&&!x.del?notaTxt(x.nota):'·';}).join('  ');
    const pvT=L.reduce((a,l)=>a+cabPres(l,dia)*pesoEm(l,dia),0),msF=(()=>{let w=0,t=0;L.forEach(l=>{const r=racaoEm(l,dia),cp=r&&compRacao(r,dia);if(cp){w+=cabPres(l,dia);t+=cabPres(l,dia)*cp.ms/100;}});return w?t/w:NaN;})();
    /* IMS de ontem: com a MS e o peso do PRÓPRIO dia de ontem (MS alterada depois do trato só vale a partir do dia seguinte) */
    const pvO=L.reduce((a,l)=>a+cabPres(l,ont)*pesoEm(l,ont),0),msO=(()=>{let w=0,t=0;L.forEach(l=>{const r=racaoEm(l,ont),cp=r&&compRacao(r,ont);if(cp){w+=cabPres(l,ont);t+=cabPres(l,ont)*cp.ms/100;}});return w?t/w:NaN;})();
    const imsOnt=ontem&&pvO&&ok(msO)?ontem*msO/pvO*100:NaN;
    const baseOp=`<details class="gBaseOp"${bs?' open':''}><summary>Base: <b>${nf(base)} kg</b> <small>(${orig})</small> <span class="gMudarBt">✎ mudar</span></summary><div class="gBaseF">
      ${opB('ontem','Realizado do dia anterior')}${opB('prev','Previsto do dia anterior')}${opB('dia','Igual ao trato de uma data')}
      ${bm==='dia'?`<div class="gBaseChips">${chips}</div>`:''}</div></details>`;
    const trv=leitTravada(dia,c);if(trv&&GT.sel)delete GT.sel[c];
    /* últimos 3 dias: leitura, kg/dia e % IMS de cada dia · tocar repete a matéria seca daquele dia */
    const podeRep=pode.ok&&!trv,repD=sel&&sel.rep;
    const ult3=`<div class="gUlt3">${[3,2,1].map(i=>{const d=somaDias(dia,-i),x=G.it[idLeit(d,c)],lx=x&&!x.del?x:null,kgd=ix.get(d+'|'+c)||0,bi=baseIms(c,d),im=kgd&&bi?kgd/bi:NaN;
      const cn_=lx&&lx.nota!=null?notas.find(o=>o.n===+lx.nota):null,[bg,fg]=['#eceff1','#11253d'];   /* histórico dos 3 dias: sempre cinza; o escolhido ganha a borda preta e a nota aproximada fica verde embaixo */
      return `<button type="button" class="gU3${repD===d?' sel':''}" style="background:${bg};color:${fg}"${podeRep&&kgd?` data-g="repDia" data-c="${esc(c)}" data-d="${d}"`:' disabled'}><small>${diaBR(d).slice(0,5)}</small><b>${lx&&lx.nota!=null?notaTxt(+lx.nota):'·'}</b><i>${kgd?nf(kgd)+' kg':'sem trato'}</i><em>${ok(im)?pc(im,2)+' IMS':'—'}</em></button>`;}).join('')}</div>`;
    if(trv&&!(lt&&!lt.del))return `<div class="gCochoMin gCoTrav" data-c="${esc(c)}">${seloCurral(c)}<span><b>Sem leitura</b><small>🔒 já teve trato neste dia · a leitura não pode ser feita</small></span></div>`;
    if(lt&&!lt.del&&!GT.sel[c]&&!(GT.coAberto||{})[c])return `<button class="gCochoMin${trv?' gCoTrav':''}" data-g="coAbre" data-c="${esc(c)}">${seloCurral(c)}<span><b>${lt.nota!=null?'Nota '+notaTxt(lt.nota):''}${lt.ims>0?(lt.nota!=null?' · ':'')+'IMS '+pc(+lt.ims,2):''}</b>${ok(+lt.novo)?nf(+lt.novo)+' kg':'—'}<small>${trv?'✓ feita · 🔒 já teve trato · toque para ver':'✓ feita · toque para alterar'}</small></span><em class="gMinBase">${(()=>{const h=lt.hora||(lt.ts?new Date(+lt.ts).toTimeString().slice(0,5):'');return h?`<i class="gMinHora">🕒 ${esc(h)}</i>`:'';})()}</em></button>`;  // feita: fica recolhida
    return `<div class="gCocho${lt&&!lt.del?' feito':''}${trv?' gCoRO':''}" data-c="${esc(c)}" data-base="${base}" data-msf="${msFator}">
      <div class="gCoTopo">${seloCurral(c)}<div><span><b>${esc([...new Set(L.map(l=>catNorm(l.cat)||l.nome))].join(', '))}</b> · ${(()=>{const pm=cab?L.reduce((a,l)=>a+cabPres(l,dia)*pesoEm(l,dia),0)/cab:NaN;return ok(pm)&&pm>0?nf(pm)+' kg projetado':nf(cab)+' cab';})()}</span>${ult3}</div>${lt&&!lt.del&&(GT.coAberto||{})[c]?`<button type="button" class="mini gCoFecha" data-g="coFecha" data-c="${esc(c)}" aria-label="Recolher">▲</button>`:''}</div>
      ${trv?'<p class="gCoROtxt">🔒 Trato feito neste dia: não pode alterar.</p>':''}
      ${gradeNotas(notas,nota,c)}
      <div class="gCoNovo"><b class="gCoPct">% IMS</b><input class="cell num gCoImsIn" inputmode="none" readonly data-tecg="ims" data-ims="${esc(c)}"${trv?' data-trava="1"':''} value="${sel&&sel.ims>0?nf(+sel.ims,2):''}" placeholder="${(()=>{const q=ok(kg)&&window.gImsDe?gImsDe(c,dia,kg):null;return q?nf(q,2):'%';})()}"><input class="cell num" inputmode="none" readonly data-tecg="kg" data-kg="${esc(c)}" value="${kg!=null?kg:''}" placeholder="kg/dia"${trv?' data-trava="1"':''}>${pode.ok&&!trv?`<button type="button" class="gCoSalva" data-g="salvaCocho1" data-c="${esc(c)}" aria-label="Salvar este curral">💾</button>`:''}</div></div>`;}).join('');
  return `<section class="panel"><h2 class="gH2Bt"><span>Leitura de cocho</span>${rows&&pode.ok?'<button type="button" class="gSalvaTop" data-g="salvaCocho">💾 Salvar leitura de cocho</button>':''}</h2>
    ${navData('gCoDia',dia,'')}
    ${typeof selSetas==='function'&&window.LOC_OPS?`<div class="gCoLocNav">${selSetas('Local',LOC_OPS,Math.max(0,LOC_OPS.findIndex(o=>o[0]===lc)),'data-g="coLocP" data-n','data-colsel')}</div>`:locBotoes('coLoc',lc)}
    <div class="gCoGrafRow"><button class="verde gCoGrafBt" data-g="ir" data-t="cochoGraf" data-o="nota">📈 Gráfico de notas</button><button class="verde gCoGrafBt" data-g="ir" data-t="cochoGraf" data-o="ims">📈 Gráfico de %IMS</button></div>
    <details class="gLeg"><summary class="note">Ver as notas</summary>${notas.map(x=>`<p class="note"><b>${notaTxt(x.n)}</b> — ${esc(x.t)}: ${x.p>0?'+':''}${nf(x.p,0)}%</p>`).join('')}<p class="note">Para mudar as notas: Config.</p></details>
    ${pode.ok?'':`<p class="aviso">${esc(pode.msg)}${pode.falta&&pode.falta.length?`<br><b>Ainda sem registro hoje:</b><br>${pode.falta.map(esc).join('<br>')}`:''}</p>
      ${pode.lib?`<p class="note">Se algum desses currais não vai ser tratado hoje (ex.: pasto, curral vazio), libere a leitura assim mesmo.</p><button class="lima" data-g="libLeit">🔓 Liberar a leitura de amanhã</button>`:''}`}
    <div class="${pode.ok?'':'gLeitTrava'}">${rows||'<p class="note">Nenhum lote ativo nesta data. Cadastre os lotes primeiro.</p>'}</div>
    ${rows&&pode.ok?`<button class="primary" data-g="salvaCocho">💾 Salvar leitura de cocho</button>
    <p class="note">O total do dia de cada curral (realizado de ontem ± a nota) é dividido nos tratos pela quantidade de tratos do curral e pela divisão em % do Config.${amanha?' O previsto de amanhã fica guardado e passa a valer quando virar o dia.':''}</p>`:''}
</section>`;
}
/* leitura travada: o curral já recebeu trato no dia da leitura (não pode mudar o previsto do dia no meio) */
const leitTravada=(dia,c)=>(typeof HIST!=='undefined'?HIST:[]).some(r=>r.dia===dia&&nAt(r.curral)===c);
/* ---------- Conferência da batida (Config › Balança): batida + trato que veio depois, com os saltos da balança ---------- */
function confBatDados(dia){const H=(typeof HIST!=='undefined'?HIST:[]).filter(r=>r.dia===dia).slice().sort((a,b)=>(a.ts||0)-(b.ts||0));
  const tsH=(h)=>{const [x,y]=String(h||'0:0').split(':').map(Number);const [Y,M,D]=dia.split('-').map(Number);return new Date(Y,M-1,D,x||0,y||0).getTime();};
  const B=gTodos('carga').filter(c=>c.dia===dia).map(c=>({c,ts:+c.ts0||tsH(c.hora)})).sort((a,b)=>a.ts-b.ts);
  const loc=c=>typeof linhaDe==='function'?linhaDe(c):'';const G_=[];
  B.forEach((b,i)=>{const lc=b.c.local||'',prox=B.slice(i+1).find(x=>(x.c.local||'')===lc||!lc||!(x.c.local));
    G_.push({b:b.c,ts:b.ts,regs:H.filter(r=>(!lc||loc(r.curral)===lc)&&(r.ts||0)>=b.ts&&(!prox||(r.ts||0)<prox.ts))});});
  const usados=new Set(G_.flatMap(g=>g.regs.map(r=>r.uid)));const sobra=H.filter(r=>!usados.has(r.uid));
  if(sobra.length)G_.push({b:null,ts:sobra[0].ts||0,regs:sobra});G_.sort((a,b)=>a.ts-b.ts);
  const Z=G_.map(g=>{const its=(g.b&&g.b.itens||[]).map(x=>Array.isArray(x)?{nome:x[0],prev:+x[1],real:+x[2],ini:null,fim:null,hora:''}:{nome:x.nome+(x.man?' (manual)':''),prev:+x.prev,real:ok(+x.real)?+x.real:null,ini:ok(+x.ini)?+x.ini:null,fim:ok(+x.fim)?+x.fim:null,hora:x.hora&&x.hora!=='manual'?x.hora:'',ts:x.hora&&x.hora!=='manual'?tsH(x.hora)+59000:null});
    its.forEach((x,i)=>{const a=its[i-1];x.salto=i&&a&&ok(a.fim)&&ok(x.ini)?x.ini-a.fim:null;});
    const fimC=[...its].reverse().find(x=>ok(x.fim)),fimCarga=fimC?fimC.fim:null;
    const rs=g.regs.map((r,i,A)=>{const a=A[i-1];const ini=ok(+r.ini)?+r.ini:null,fim=ok(+r.fim)?+r.fim:null;
      const sal=i?(a&&ok(+a.fim)&&ok(ini)?ini-(+a.fim):null):(ok(fimCarga)&&ok(ini)?ini-fimCarga:null);
      return {hora:r.hora||'',nome:r.curral,trato:r.trato,prev:+r.prev||0,real:+r.forn||0,ini,fim,salto:sal,ts:+r.ts||(r.hora?tsH(r.hora)+59000:null)};});
    const soma=(L,k)=>L.reduce((a,x)=>a+(ok(x[k])?x[k]:0),0);
    const sProd=soma(its,'salto'),s1=rs.length&&ok(rs[0].salto)?rs[0].salto:0,sCur=soma(rs.slice(1),'salto'),ult=[...rs].reverse().find(x=>ok(x.fim));
    return {b:g.b,ts:g.ts,its,rs,ini0:its[0]&&ok(its[0].ini)?its[0].ini:null,carregado:soma(its,'real'),fimCarga,ini1:rs[0]?rs[0].ini:null,s1,sProd,sCur,fornecido:soma(rs,'real'),
      prevForn:soma(rs,'prev'),fimFinal:ult?ult.fim:null,apareceu:sProd+s1+sCur,tratos:[...new Set(rs.map(r=>r.trato))].sort(),lc:g.b?(g.b.local||''):(g.regs[0]?loc(g.regs[0].curral):'')};});
  /* salto entre o fim do último curral (do vagão anterior) e o começo desta batida */
  Z.forEach((g,i)=>{g.sAnt=null;g.antTxt='';if(!g.b||!g.its.length||!ok(g.ini0))return;
    /* o "último" é o que o MESMO vagão (mesmo aparelho) fez antes, seja no Confinamento ou no Pasto (antes só olhava o mesmo local e pegava o curral da manhã) */
    const ap=x=>x&&x.uid?String(x.uid).split('-')[1]||'':'';
    for(let j=i-1;j>=0;j--){const a=Z[j];if(a.b&&ap(a.b)&&ap(g.b)&&ap(a.b)!==ap(g.b))continue;if(!a.b&&g.lc&&a.lc&&a.lc!==g.lc)continue;const u=[...a.rs].reverse().find(x=>ok(x.fim))||(!a.rs.length?[...a.its].reverse().find(x=>ok(x.fim)):null);
      if(u){g.sAnt=g.ini0-u.fim;g.antTxt=u.nome;g.its[0].salto=g.sAnt;g.apareceu+=g.sAnt;}break;}});
  /* balanço do vagão: o que já tinha + carregado − fornecido = o que DEVIA sobrar; comparado com o que a balança mostrou no fim.
     A diferença se explica pelos saltos (entre produtos, da carga ao 1º curral, entre currais) e pelo que foi registrado diferente da balança. */
  /* dois carregamentos seguidos sem fornecer entre eles (ex.: 07:47 e 08:06 para o mesmo trato) contam como um só no balanço */
  const apG=x=>x&&x.uid?String(x.uid).split('-')[1]||'':'';let pend={};
  Z.forEach(g=>{g.dev=null;g.dif=null;g.outros=null;g.junto=false;g.iniR=g.ini0;g.carR=g.carregado;g.sProdR=g.sProd;g.nCar=1;if(!g.b)return;
    const k=apG(g.b)+'|'+(g.b.local||''),a=pend[k];
    if(a&&ok(a.iniR)){g.iniR=a.iniR;g.carR=a.carR+g.carregado;g.sProdR=a.sProdR+g.sProd+(g.sAnt||0);g.nCar=a.nCar+1;a.junto=true;}
    pend[k]=g.rs.length?null:g;
    if(!ok(g.iniR)||!g.rs.length||!ok(g.fimFinal))return;
    g.dev=g.iniR+g.carR-g.fornecido;g.dif=g.fimFinal-g.dev;
    /* de onde vem a diferença: carregamento (balança subiu mais que o registrado), trajeto (carga → 1º curral e entre currais) e fornecimento (registrado ≠ o que a balança mostrou saindo) */
    g.entR=ok(g.fimCarga)?g.fimCarga-g.iniR:null;g.difCar=g.entR!=null?g.entR-g.carR:null;
    g.fornBal=g.rs.reduce((a,x)=>a+(ok(x.ini)&&ok(x.fim)?x.ini-x.fim:x.real||0),0);g.difForn=g.fornecido-g.fornBal;
    g.outros=g.dif-((g.difCar||0)+(g.s1||0)+g.sCur+g.difForn);});
  return Z;}
/* linhas do balanço (tela, foto e Excel): [texto, valor, éSalto] */
function confBalLinhas(g){const L=[];if(g.sAnt!=null)L.push([g.nCar>1?`Salto: carregamento anterior → este (${g.antTxt})`:`Salto: último (${g.antTxt}) → este carregamento`,g.sAnt,1]);
  if(g.junto){L.push(['Já estava no vagão antes de carregar',g.ini0],['+ Carregado (registrado)',g.carregado],['Balança no fim da carga',g.fimCarga],['O fornecimento foi junto com o carregamento seguinte',null]);return L.filter(x=>x[1]!=null||/seguinte/.test(x[0]));}
  L.push([(g.iniR>100?'⚠ ':'')+'Já estava no vagão antes de carregar'+(g.nCar>1?` (antes do 1º dos ${g.nCar} carregamentos)`:''),g.iniR]);if(g.b)L.push([g.nCar>1?`+ Carregado nos ${g.nCar} carregamentos (registrado)`:'+ Carregado (registrado)',g.carR]);
  if(g.dev==null){L.push(['Balança no fim da carga',g.fimCarga]);if(g.rs.length)L.push(['Fornecido (registrado)',g.fornecido],['Sobra no vagão (fim)',g.fimFinal]);return L.filter(x=>x[1]!=null);}
  L.push(['− Fornecido (registrado)',g.fornecido],['= Devia sobrar no vagão',g.dev],['Sobrou de verdade (balança no fim)',g.fimFinal]);
  if(g.difCar)L.push([`↳ carregamento: a balança subiu ${nf(g.entR)}, o registrado foi ${nf(g.carR)}`,g.difCar,1]);
  if(g.s1)L.push(['↳ trajeto: do fim da carga ao 1º curral',g.s1,1]);if(g.sCur)L.push(['↳ trajeto: entre os currais',g.sCur,1]);
  if(g.difForn)L.push([`↳ fornecimento: registrado ${nf(g.fornecido)}, a balança mostrou sair ${nf(g.fornBal)}`,g.difForn,1]);
  if(Math.abs(g.outros||0)>=5)L.push(['↳ outros',g.outros,1]);return L;}
/* resumo por carregamento (para o dia ou vários dias) */
function confResumo(dias){const R=[];dias.forEach(d=>{const Z=confBatDados(d);Z.forEach((g,i)=>{if(!g.b||g.junto)return;
  const hs=Z.filter(x=>x.b&&(x===g||(x.junto&&Z.indexOf(x)<i&&(x.b.local||'')===(g.b.local||'')))).slice(-(g.nCar||1)).map(x=>x.b.hora||'');
  const uI=[...g.its].reverse().find(x=>x.hora);
  R.push({dia:d,hora:hs[0]+(hs.length>1?` (+${hs.length-1})`:''),hIni:hs[0],hFim:(()=>{const uR=[...g.rs].reverse().find(x=>x.hora);return uR?uR.hora:(g.b.horaF||(uI?uI.hora:''));})(),noVag:ok(g.iniR)&&ok(g.carR)?g.iniR+g.carR:null,naBal:g.fimCarga,loc:g.b.local==='P'?'Pasto':g.b.local==='C'?'Conf.':'',rac:g.b.racNome||'',ini0:g.iniR,car:g.carR,forn:g.rs.length?g.fornecido:null,dev:g.dev,fim:g.rs.length?g.fimFinal:null,dif:g.dif,sProd:g.difCar,s1:g.s1,sCur:g.sCur,dForn:g.difForn});});});return R;}
/* divide o fornecimento em trechos seguidos do mesmo trato (ex.: Trato 2 e depois Trato 3 com a sobra) */
const runsT=rs=>{const o=[];rs.forEach(x=>{const u=o[o.length-1];if(u&&u[0].trato===x.trato)u.push(x);else o.push([x]);});return o;};
const sg_=v=>v==null||!ok(v)?'':(v>0?'+':'')+nf(v);
function confBatHTML(){const dia=GT.cbDia||hojeKey(),D=confBatDados(dia);
  const tab=(cab,L,ehC)=>`<div class="tablebox"><table class="gTab gCbTab"><thead><tr><th>Hora</th><th>${ehC?'Curral':'Produto'}</th><th>Prev.</th><th>Real.</th><th>Início</th><th>Final</th><th>Salto</th></tr></thead><tbody>${L.map(x=>`<tr><td>${esc(x.hora||'')}</td><td class="c">${esc(x.nome)}${ehC&&x.trato?` <small>T${x.trato}</small>`:''}</td><td>${ok(x.prev)?nf(x.prev):''}</td><td><b>${ok(x.real)?nf(x.real):'—'}</b></td><td>${ok(x.ini)?nf(x.ini):'—'}</td><td>${ok(x.fim)?nf(x.fim):'—'}</td><td class="${x.salto>0?'gCbMais':x.salto<0?'gCbMenos':''}">${sg_(x.salto)}</td></tr>`).join('')}</tbody></table></div>`;
  const bloco=g=>{const b=g.b,t=b?`🚜 Carregamento ${esc(b.hora||'')} · ${esc(b.racNome||'')} · ${b.local==='P'?'Pasto':b.local==='C'?'Confinamento':''}${b.avulso?' · avulsa':''}`:'Tratos sem carregamento antes (vagão já carregado)';
    const res=[...(g.sAnt!=null?[[`↳ salto do último (${esc(g.antTxt)}) → este carregamento`,g.sAnt,1]]:[]),['Balança antes de carregar',g.ini0],['Carregado (registrado)',b?g.carregado:null],['Balança no fim da carga',g.fimCarga],['Balança no 1º curral',g.ini1],['↳ diferença carga → 1º curral',g.s1,1],['Saltos entre produtos',g.sProd,1],['Saltos entre currais',g.sCur,1],['Fornecido (registrado)',g.fornecido],['Previsto dos currais',g.prevForn],['Balança no fim (sobra no vagão)',g.fimFinal]].filter(x=>x[1]!=null&&(x[2]?x[1]!==0||x[0].startsWith('↳'):true));
    return `<div class="gCbBloco"><h3 class="gSubT">${t}</h3>${b&&g.its.length?tab('',g.its,false):''}${g.rs.length?runsT(g.rs).map(L=>`<p class="note"><b>${L[0].hora||''} · Fornecimento · Trato ${L[0].trato}</b>${g.b?'':' (sem carregamento antes)'}</p>`+tab('',L,true)).join(''):'<p class="note">Nenhum trato registrado depois deste carregamento.</p>'}
      <div class="gCbRes">${res.map(x=>`<span>${x[0]}</span><b class="${x[2]?(x[1]>0?'gCbMais':x[1]<0?'gCbMenos':''):''}">${x[2]?sg_(x[1]):nf(x[1])}</b>`).join('')}
      <span><b>Balança “ganhou” sem carregar</b></span><b class="${g.apareceu>0?'gCbMais':g.apareceu<0?'gCbMenos':''}">${sg_(g.apareceu)||'0'} kg</b></div></div>`;};
  return `<section class="panel gCfgP"><h2>Conferência do carregamento</h2>
    <p class="note">Cada carregamento e o trato feito logo depois, com o peso da balança no início e no final de cada produto e curral. <b>Salto</b> = quanto a balança mudou entre o fim de um e o começo do próximo (sem carregar nem descarregar).</p>
    ${navData('gCbDia',dia,'Data')}
    ${D.length?`<div class="row compart fz3"><button class="verde" data-g="cbExp" data-o="pdf">📄 PDF</button><button class="verde" data-g="cbExp" data-o="img">🖼 Foto</button><button class="verde" data-g="cbExp" data-o="xls">📊 Excel</button></div><p class="note">${D.filter(g=>g.b).length} carregamento(s) e ${D.reduce((x,g)=>x+g.rs.length,0)} curral(is) tratados nesse dia. Os dados aparecem no PDF, na Foto e no Excel.</p>${confResumoTela(confResumo([dia]))}`:'<p class="note">Nenhum carregamento nem trato nesse dia.</p>'}
    <h3 class="gSubT">Vários dias (até a data escolhida)</h3>
    <div class="row gRelAtalhos">${[7,15,30].map(n=>`<button type="button" class="mini${(GT.cbN||7)===n?' sel':''}" data-g="cbN" data-n="${n}">${n} dias</button>`).join('')}</div>
    <p class="note"><b>Balanço do vagão</b>: uma linha por carregamento (já tinha, carregado, fornecido, devia sobrar, sobrou e a mais).</p>
    <div class="row compart fz3"><button class="verde" data-g="cbRes" data-o="pdf">📄 PDF</button><button class="verde" data-g="cbRes" data-o="img">🖼 Foto</button><button class="verde" data-g="cbRes" data-o="xls">📊 Excel</button></div>
    <p class="note"><b>Saltos da balança por curral</b>: em quais currais a balança mais sobe ou desce no trajeto, sem descarregar.</p>
    <div class="row compart fz3"><button class="verde" data-g="cbSal" data-o="pdf">📄 PDF</button><button class="verde" data-g="cbSal" data-o="img">🖼 Foto</button><button class="verde" data-g="cbSal" data-o="xls">📊 Excel</button></div>
    <p class="note"><b>Conferência dia a dia</b>: a conferência completa de cada dia (uma página por dia).</p>
    <div class="row compart fz3"><button class="verde" data-g="cbPer" data-o="pdf">📄 PDF</button><button class="verde" data-g="cbPer" data-o="img">🖼 Foto</button><button class="verde" data-g="cbPer" data-o="xls">📊 Excel</button></div>
    <p class="note">Também ficam em Gestão › Relatórios (por dia e por período).</p></section>`;}
function confResumoTela(RS){if(!RS.length)return '';const n=v=>v==null||!ok(v)?'—':nf(v);
  return `<h3 class="gSubT">Balanço do vagão · neste dia</h3><div class="tablebox"><table class="gTab gCbTab"><thead><tr><th>Início</th><th>Fim</th><th>Carregamento</th><th>Já tinha</th><th>Carreg.</th><th>No vagão</th><th>Na balança</th><th>Forn.</th><th>Devia sobrar</th><th>Sobrou</th><th>A mais</th></tr></thead><tbody>${RS.map(x=>`<tr><td>${esc(x.hora)}</td><td>${esc(x.hFim||'—')}</td><td class="c">${esc(x.loc)}<small> ${esc(x.rac)}</small></td><td class="${x.ini0>100?'gCbMais':''}">${n(x.ini0)}</td><td>${n(x.car)}</td><td>${n(x.noVag)}</td><td>${n(x.naBal)}</td><td>${n(x.forn)}</td><td>${n(x.dev)}</td><td>${n(x.fim)}</td><td class="${x.dif>=100?'gCbMais':x.dif<=-100?'gCbMenos':''}"><b>${x.dif==null?'—':sg_(x.dif)||'0'}</b></td></tr>`).join('')}</tbody></table></div>
  <p class="note"><b>Já tinha</b> = ração que estava no vagão antes de carregar (se não usar ⚖ Sobra no Carregar, ela vai a mais). <b>A mais</b> = sobrou de verdade − devia sobrar: vem da balança subindo entre os currais, da carga até o 1º curral ou de produto que entrou sem registrar. Detalhes no PDF/Foto.</p>`;}
/* balança sem sinal (registro do tablet): quando caiu, quando voltou, o peso antes de cair e o primeiro peso quando voltou */
function sinaisDia(dia){const out=[],[Y,M,D]=dia.split('-').map(Number),tms=t=>{const [h,m,x]=String(t||'0:0:0').split(':').map(Number);return new Date(Y,M-1,D,h||0,m||0,x||0).getTime();};
  gTodos('diag').filter(x=>x.dia===dia).forEach(it=>{const ap=it.aparelho||String(it.uid).split('-').pop();let ab=null;const fecha=()=>{if(ab)out.push(ab);ab=null;};
    (it.ev||[]).forEach(e=>{const ts=tms(e.t);
      if(e.tipo==='sem_peso'||e.tipo==='reconectando'){if(ab&&ab.fimTs&&ts-ab.fimTs>20000)fecha();if(!ab)ab={ap,ts,t0:e.t,antes:ok(e.peso)?+e.peso:null,depois:null,fim:'',fimTs:0,hold:e.hold};}
      else if(e.tipo==='reconectou'&&ab){ab.fim=e.t;ab.fimTs=ts;}
      else if(e.tipo==='peso_voltou'){if(!ab)ab={ap,ts,t0:e.t,antes:null};if(ab.antes==null&&ok(e.antes))ab.antes=+e.antes;ab.depois=ok(e.peso)?+e.peso:null;ab.fim=e.t;ab.fimTs=ts;fecha();}});
    fecha();});
  return out.sort((a,b)=>a.ts-b.ts);}
/* encaixa cada queda de sinal antes da linha (produto ou curral) registrada logo depois dela; o que vier depois do último fica no fim */
function sinaisDoBloco(D,g,S){const ap=x=>x&&x.uid?String(x.uid).split('-')[1]||'':'',a=ap(g.b);
  const prox=D.find(x=>x!==g&&x.ts>g.ts&&(!a||!x.b||ap(x.b)===a));
  const E=S.filter(e=>(!a||e.ap===a)&&e.ts>=(g.ts||0)&&(!prox||e.ts<prox.ts));
  const L=[...g.its,...g.rs],antes=new Map(),fim=[];
  E.forEach(e=>{const r=L.find(x=>x.ts&&x.ts>=e.ts);if(r){if(!antes.has(r))antes.set(r,[]);antes.get(r).push(e);}else fim.push(e);});
  return {antes,fim};}
const sinalTxt=e=>`Balança sem sinal ${String(e.t0).slice(0,8)}${e.fim?' → voltou '+String(e.fim).slice(0,8):''}`;
/* modo: 'blob' devolve a imagem (para juntar vários dias); 'rows' devolve as linhas do Excel */
async function confBatExp(o,diaArg,modo){const dia=diaArg||GT.cbDia||hojeKey(),D=confBatDados(dia);if(!D.length)return modo?null:toast('Nada nesse dia');
  const nome=`FJK - Conferência do carregamento - ${dB(dia).replace(/\//g,'-')}`;
  if(o==='xls'){const H=t=>({v:t,s:1}),rows=[[H('Carregamento'),H('Tipo'),H('Hora'),H('Produto / curral'),H('Trato'),H('Previsto'),H('Realizado'),H('Balança início'),H('Balança final'),H('Salto')]];
    const num=v=>ok(v)?{v,s:4}:{v:''},SS=sinaisDia(dia);
    D.forEach(g=>{const bt=g.b?`${g.b.hora||''} ${g.b.racNome||''}`:'sem carregamento',SB=sinaisDoBloco(D,g,SS);
      const sin=e=>rows.push([{v:bt},{v:'Sem sinal'},{v:String(e.t0).slice(0,5)},{v:sinalTxt(e)},{v:''},{v:''},{v:''},num(e.antes),num(e.depois),ok(e.antes)&&ok(e.depois)?num(e.depois-e.antes):{v:''}]);
      g.its.forEach(x=>{(SB.antes.get(x)||[]).forEach(sin);rows.push([{v:bt},{v:'Carregamento'},{v:x.hora||''},{v:x.nome},{v:''},num(x.prev),num(x.real),num(x.ini),num(x.fim),num(x.salto)]);});
      g.rs.forEach(x=>{(SB.antes.get(x)||[]).forEach(sin);rows.push([{v:bt},{v:'Fornecimento'},{v:x.hora||''},{v:x.nome},{v:x.trato||''},num(x.prev),num(x.real),num(x.ini),num(x.fim),num(x.salto)]);});
      SB.fim.forEach(sin);
      confBalLinhas(g).forEach(x=>rows.push([{v:bt,s:9},{v:'Balanço',s:9},{v:'',s:9},{v:x[0],s:9},{v:'',s:9},{v:'',s:9},{v:'',s:9},{v:'',s:9},{v:'',s:9},x[1]==null?{v:'',s:9}:{v:x[1],s:7}]));
      rows.push([{v:bt,s:9},{v:'Balanço',s:9},{v:'',s:9},{v:g.dif!=null?'SOBROU A MAIS DO QUE DEVIA':'Balança ganhou sem carregar',s:9},{v:'',s:9},{v:'',s:9},{v:'',s:9},{v:'',s:9},{v:'',s:9},{v:g.dif!=null?g.dif:g.apareceu,s:7}]);});
    if(modo==='rows')return rows.slice(1).map(r=>{r[0]={v:dB(dia).slice(0,5)+' '+r[0].v,s:r[0].s};return r;});
    return compartilharArquivo(montarXlsx([['Conferência',rows,[18,14,8,24,7,11,11,13,13,10]]]),nome+'.xlsx',XT);}
  const cols=[['Hora',90,'c'],['Produto / curral',230,'c'],['Previsto',120,'r'],['Realizado',130,'r'],['Dif.',100,'r'],['Início',130,'r'],['Final',130,'r'],['Salto',110,'r']];
  const lin=x=>{const dif=ok(x.real)&&ok(x.prev)?x.real-x.prev:null;return {v:[x.hora||'',x.nome+(x.trato?' · T'+x.trato:''),ok(x.prev)?nf(x.prev):'',ok(x.real)?nf(x.real):'—',dif==null?'':sg_(dif),ok(x.ini)?nf(x.ini):'—',ok(x.fim)?nf(x.fim):'—',sg_(x.salto)],prev:x.prev,dif,neg:[1,3]};};
  const SS=sinaisDia(dia),corP=v=>v>=50?'#b3261e':v<=-50?'#1565c0':'#6b7a8f';
  /* caiu no meio de um produto ou curral (o peso já tinha saído do início dele): a diferença é o que estava entrando/saindo, não é salto */
  const linS=(e,x)=>{const d=ok(e.antes)&&ok(e.depois)?e.depois-e.antes:null,carr=x&&x.trato==null,
      meio=e.hold===false&&x&&ok(x.ini)&&ok(x.fim)&&ok(e.antes)&&(carr?e.antes>x.ini+20&&e.antes<=x.fim+20:e.antes<x.ini-20&&e.antes>=x.fim-20),
      tx=meio?(carr?' (carregando '+x.nome+')':' (descarregando no '+x.nome+')'):'';
    return {v:[String(e.t0).slice(0,5),'📶 '+sinalTxt(e)+tx,'','','',ok(e.antes)?nf(e.antes):'—',ok(e.depois)?nf(e.depois):'—',d==null||meio?'':sg_(d)||'0'],neg:[],
    cor:['#6b7a8f','#6b7a8f',null,null,null,'#6b7a8f','#6b7a8f',d==null||meio?'#6b7a8f':corP(d)]};};
  const comS=(L,SB)=>L.flatMap(x=>[...(SB.antes.get(x)||[]).map(e=>linS(e,x)),lin(x)]);
  const secs=[];D.forEach(g=>{const SB=sinaisDoBloco(D,g,SS),b=g.b,cb=b?`Carregamento ${b.hora||''} · ${b.racNome||''}${b.local==='P'?' · Pasto':b.local==='C'?' · Confinamento':''}`:'Tratos sem carregamento antes';
    if(b&&g.its.length)secs.push({cab:`${b.hora||''} · Carregamento · `+cb.replace(/^Carregamento [^·]*· /,''),cols,linhas:comS(g.its,SB).concat(g.rs.length?[]:SB.fim.map(linS)),total:['CARREGADO','',nf(g.its.reduce((a,x)=>a+(x.prev||0),0)),nf(g.carregado),'','',ok(g.fimCarga)?nf(g.fimCarga):'',g.sProd?sg_(g.sProd):'']});
    runsT(g.rs).forEach((L,iR,RR)=>{const pv=L.reduce((a,x)=>a+(x.prev||0),0),fo=L.reduce((a,x)=>a+(x.real||0),0),sl=L.reduce((a,x)=>a+(ok(x.salto)?x.salto:0),0),uf=[...L].reverse().find(x=>ok(x.fim));
      secs.push({cab:`${L[0].hora||''} · Fornecimento · Trato ${L[0].trato}`+(g.b?` (carregamento das ${g.b.hora||''})`:' (sem carregamento antes)'),cols,linhas:comS(L,SB).concat(iR===RR.length-1?SB.fim.map(linS):[]),total:['FORNECIDO','',nf(pv),nf(fo),sg_(fo-pv),'',uf?nf(uf.fim):'',sl?sg_(sl):'']});});
    const corS=v=>v>=50?'#b3261e':v<=-50?'#1565c0':null;
    secs.push({cab:cb+' · balanço do vagão',cols,linhas:confBalLinhas(g).map(x=>({v:['',x[0],'','','','','',x[1]==null?'':x[2]?sg_(x[1]):nf(x[1])],neg:[1],cor:x[2]?[null,null,null,null,null,null,null,corS(x[1])]:x[0].startsWith('⚠')?[null,'#b3261e',null,null,null,null,null,'#b3261e']:null})),
      total:g.dif!=null?['SOBROU A MAIS DO QUE DEVIA','','','','','','',(sg_(g.dif)||'0')+' kg']:g.junto?['BALANÇO NO CARREGAMENTO SEGUINTE','','','','','','','']:['BALANÇA GANHOU SEM CARREGAR','','','','','','',(sg_(g.apareceu)||'0')+' kg']});});
  /* resumo do dia no topo: uma linha por carregamento */
  const RS=confResumo([dia]);if(RS.length)secs.unshift(secResumo(RS,'Resumo do dia · balanço de cada carregamento',false));
  const blob=await desenharTabela(secs,`FJK - Conferência do carregamento - ${dB(dia)}`);if(modo==='blob')return blob;
  if(o==='pdf')return compartilharArquivo(await pngsParaPdf([blob]),nome+'.pdf','application/pdf');
  return compartilharVarios([blob],[nome+'.png']);}
/* Início = hora que começou a batida; Fim = hora do último curral do fornecimento (sem fornecimento: fim do carregamento);
   No vagão = já tinha + carregado (o que devia ter); Na balança = o que a balança mostrou no fim do carregamento */
function secResumo(RS,cab,comDia){const fixas=[['Já tinha',80,'r'],['Carregado',95,'r'],['No vagão',90,'r'],['Na balança',95,'r'],['Fornecido',95,'r'],['Devia sobrar',105,'r'],['Sobrou',80,'r'],['A mais',80,'r']];
  const cols=(comDia?[['Início',110,'c'],['Fim',65,'c'],['Carregamento',145,'c']]:[['Início',70,'c'],['Fim',70,'c'],['Carregamento',180,'c']]).concat(fixas);
  const n=v=>v==null||!ok(v)?'—':nf(v),soma=k=>RS.reduce((a,x)=>a+(ok(x[k])?x[k]:0),0);
  return {cab,cols,tit:cols.map(c=>c[0]),
    linhas:RS.map(x=>({v:[(comDia?dB(x.dia).slice(0,5)+' ':'')+x.hora,x.hFim||'—',`${x.loc} · ${x.rac}`,n(x.ini0),n(x.car),n(x.noVag),n(x.naBal),n(x.forn),n(x.dev),n(x.fim),x.dif==null?'—':sg_(x.dif)||'0'],neg:[5,10],
      cor:[null,null,null,x.ini0>100?'#b3261e':null,null,null,ok(x.naBal)&&ok(x.noVag)&&Math.abs(x.naBal-x.noVag)>=50?'#b3261e':null,null,null,null,x.dif>=100?'#b3261e':x.dif<=-100?'#1565c0':'#5f7a00']})),
    total:['TOTAL','','','',nf(soma('car')),'','',nf(soma('forn')),'','',(sg_(RS.reduce((a,x)=>a+(ok(x.dif)?x.dif:0),0))||'0')+' kg']};}
/* resumo de vários dias: foto/PDF/Excel com uma linha por carregamento */
const diasEntre=(a,b)=>{const L=[];let d=a;for(let i=0;i<400&&d<=b;i++){L.push(d);d=somaDias(d,1);}return L;};
async function confResumoExp(o,nd){const hj=GT.cbDia||hojeKey();return confResumoPer(o,somaDias(hj,-(nd-1)),hj);}
async function confResumoPer(o,ini,fim){const dias=diasEntre(ini,fim);
  const RS=confResumo(dias);if(!RS.length)return toast('Nenhum carregamento nesses dias');const rot=ini===fim?dB(ini):`${dB(dias[0])} a ${dB(dias[dias.length-1])}`,nome=`FJK - Balanço do vagão - ${rot.replace(/\//g,'-')}`;
  if(o==='xls'){const H=t=>({v:t,s:1}),num=v=>ok(v)?{v,s:4}:{v:''};
    const rows=[[H('Dia'),H('Início'),H('Fim (último curral)'),H('Local'),H('Ração'),H('Já tinha no vagão'),H('Carregado'),H('No vagão (já tinha + carregado)'),H('Na balança (fim do carregamento)'),H('Fornecido'),H('Devia sobrar'),H('Sobrou (balança)'),H('A mais'),H('No carregamento'),H('Carga → 1º curral'),H('Entre currais'),H('No fornecimento')]];
    RS.forEach(x=>rows.push([{v:dB(x.dia)},{v:x.hora},{v:x.hFim||''},{v:x.loc},{v:x.rac},num(x.ini0),num(x.car),num(x.noVag),num(x.naBal),num(x.forn),num(x.dev),num(x.fim),num(x.dif),num(x.sProd),num(x.s1),num(x.sCur),num(x.dForn)]));
    return compartilharArquivo(montarXlsx([['Balanço do vagão',rows,[11,11,11,8,16,12,11,14,14,11,12,13,9,14,13,11,13]]]),nome+'.xlsx',XT);}
  const blob=await desenharTabela([secResumo(RS,`Balanço do vagão · ${rot}`,ini!==fim)],`FJK - Balanço do vagão - ${rot}`);
  if(o==='pdf')return compartilharArquivo(await pngsParaPdf([blob]),nome+'.pdf','application/pdf');return compartilharVarios([blob],[nome+'.png']);}
window.confResumoExp=confResumoExp;
/* conferência completa de cada dia do período: PDF com uma página por dia, fotos ou um Excel só */
async function confBalPer(o,ini,fim){const dias=diasEntre(ini,fim).filter(d=>confBatDados(d).length);if(!dias.length)return toast('Nenhum carregamento nesses dias');
  const rot=ini===fim?dB(ini):`${dB(ini)} a ${dB(fim)}`,nome=`FJK - Conferência da balança - ${rot.replace(/\//g,'-')}`;
  if(o==='xls'){const H=t=>({v:t,s:1}),rows=[[H('Carregamento'),H('Tipo'),H('Hora'),H('Produto / curral'),H('Trato'),H('Previsto'),H('Realizado'),H('Balança início'),H('Balança final'),H('Salto')]];
    for(const d of dias){const r=await confBatExp('xls',d,'rows');if(r)rows.push(...r);}
    return compartilharArquivo(montarXlsx([['Conferência',rows,[22,14,8,24,7,11,11,13,13,10]]]),nome+'.xlsx',XT);}
  const B=[];for(const d of dias){const b=await confBatExp('img',d,'blob');if(b)B.push(b);}
  if(o==='pdf')return compartilharArquivo(await pngsParaPdf(B),nome+'.pdf','application/pdf');
  return compartilharVarios(B,dias.map(d=>`FJK - Conferência da balança - ${dB(d).replace(/\//g,'-')}.png`));}
/* saltos da balança por curral: quanto a balança mudou entre o fim do curral anterior (ou da carga) e o começo deste — sem descarregar */
function saltosDados(ini,fim){const M={},C1={n:0,s:0,mx:0,mn:0,m50:0};
  diasEntre(ini,fim).forEach(d=>confBatDados(d).forEach(g=>g.rs.forEach((r,i)=>{if(!ok(r.salto))return;const v=r.salto,pri=i===0&&!!g.b,k=(pri?'1|':'')+r.nome,o=M[k]=M[k]||{n:0,s:0,mx:0,mn:0,m50:0,loc:g.lc,nome:r.nome,pri,hm:0,nh:0};if(pri){C1.n++;C1.s+=v;}if(r.ts){const h=new Date(r.ts);o.hm+=h.getHours()*60+h.getMinutes();o.nh++;}
    o.n++;o.s+=v;o.mx=Math.max(o.mx,v);o.mn=Math.min(o.mn,v);if(v>=50)o.m50++;})));
  /* na ordem do horário em que acontece (média da hora do dia em que o curral foi tratado); o 1º curral aparece como "Fim da carga → C-10" */
  const L=Object.values(M).map(o=>Object.assign({c:o.pri?'Carregamento → '+o.nome:o.nome},o)).sort((a,b)=>(a.nh?a.hm/a.nh:1e9)-(b.nh?b.hm/b.nh:1e9)||(b.pri-a.pri));return {L,C1};}
async function saltosPer(o,ini,fim){const {L}=saltosDados(ini,fim);if(!L.length)return toast('Nenhum trato com balança nesses dias');
  const rot=ini===fim?dB(ini):`${dB(ini)} a ${dB(fim)}`,nome=`FJK - Saltos da balança - ${rot.replace(/\//g,'-')}`;
  /* hora em que o curral foi tratado (em vários dias: a hora média) */
  const hTx=x=>{if(!x.nh)return '';const m=Math.round(x.hm/x.nh);return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};
  const umDia=ini===fim,tira=o=>{if(!umDia){o.v.shift();o.neg=o.neg.map(k=>k-1);o.cor.shift();}return o;};
  const lin=(nm,lc,x)=>tira({v:[hTx(x),lc==='P'?'Pasto':lc==='C'?'Conf.':'',nm,nf(x.n),sg_(Math.round(x.s/x.n))||'0',sg_(x.mx)||'0',sg_(x.mn)||'0',sg_(x.s)||'0',nf(x.m50)],neg:[2,7],
    cor:[null,null,null,null,x.s/x.n>=30?'#b3261e':x.s/x.n<=-30?'#1565c0':null,null,null,x.s>=100?'#b3261e':x.s<=-100?'#1565c0':null,x.m50?'#b3261e':null]});
  if(o==='xls'){const H=t=>({v:t,s:1}),num=v=>({v,s:4}),rows=[[...(umDia?[H('Hora')]:[]),H('Local'),H('Curral'),H('Vezes'),H('Salto médio (kg)'),H('Maior subida'),H('Maior descida'),H('Soma (kg)'),H('Vezes com +50 ou mais')]];
    L.forEach(x=>rows.push([...(umDia?[{v:hTx(x)}]:[]),{v:x.loc==='P'?'Pasto':x.loc==='C'?'Conf.':''},{v:x.c},num(x.n),num(Math.round(x.s/x.n)),num(x.mx),num(x.mn),num(x.s),num(x.m50)]));
    return compartilharArquivo(montarXlsx([['Saltos',rows,[...(umDia?[10]:[]),8,24,8,14,12,12,11,18]]]),nome+'.xlsx',XT);}
  const cols=umDia?[['Hora',90,'c'],['Local',80,'c'],['Curral',250,'c'],['Vezes',80,'r'],['Média',100,'r'],['Maior +',100,'r'],['Maior −',100,'r'],['Soma',110,'r'],['+50 ou mais',130,'r']]:[['Local',90,'c'],['Curral',260,'c'],['Vezes',90,'r'],['Média',110,'r'],['Maior +',110,'r'],['Maior −',110,'r'],['Soma',120,'r'],['+50 ou mais',150,'r']];
  const tit=cols.map(c=>c[0]);
  const secs=[{cab:'Antes de cada curral (o 1º conta desde o fim da carga)',cols,tit,linhas:L.map(x=>lin(x.c,x.loc,x)),total:[...(umDia?['TOTAL','']:['TOTAL']),'','','','','',(sg_(L.reduce((a,x)=>a+x.s,0))||'0')+' kg','']}];
  const blob=await desenharTabela(secs,`FJK - Saltos da balança - ${rot}`);
  if(o==='pdf')return compartilharArquivo(await pngsParaPdf([blob]),nome+'.pdf','application/pdf');return compartilharVarios([blob],[nome+'.png']);}
window.confBalPer=confBalPer;window.saltosPer=saltosPer;window.confResumoPer=confResumoPer;
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
function salvaCocho(so){
  const dia=GT.dia,hoje=dia===hojeKey(),cfg=gCfg();let n=0,ap=0,rm=0;
  const pode=leitPode(dia);if(!pode.ok)return toast(pode.msg);
  /* todos os currais da lista já tiveram trato neste dia: não tem leitura nova para salvar */
  {const els=[...document.querySelectorAll('#gBox .gCocho[data-c],#gBox .gCochoMin[data-c]')].filter(el=>!so||el.dataset.c===so);
    if(els.length&&els.every(el=>leitTravada(dia,el.dataset.c)))return toast(so?`🔒 Não é possível salvar nova leitura: o ${so} já teve trato neste dia`:'🔒 Não é possível salvar nova leitura: todos os currais já tiveram trato neste dia');}
  const amanha=dia===somaDias(hojeKey(),1),obj=hoje?S.prev:JSON.parse(JSON.stringify(prevApi.prevGuardado(dia)||S.prev||{}));
  const feitosC=new Set();document.querySelectorAll('#gBox .gCocho').forEach(el=>{const c=el.dataset.c,s=GT.sel[c];if(so&&c!==so)return;if(leitTravada(dia,c))return;feitosC.add(c);const inp=el.querySelector('input[data-kg]');const kg=gNum(inp.value);
    const lt=G.it[idLeit(dia,c)];if(s&&s.n==null&&!(s.ims>0)){if(lt&&!lt.del){gDel(lt.uid);rm++;
      /* apaga também o previsto que a leitura gerou (só dos tratos que ainda não foram fornecidos) */
      const feitos=new Set((typeof HIST!=='undefined'?HIST:[]).filter(r=>r.dia===dia&&r.curral===c).map(r=>+r.trato));
      for(let k=1;k<=(prevApi.MAXT||8);k++){if(feitos.has(k))continue;const m=obj[String(k)];if(m&&c in m){delete m[c];ap++;}}}return;}const nota=s?s.n:(lt&&!lt.del?lt.nota:null),ims=s?(s.ims>0?+s.ims:null):(lt&&!lt.del&&lt.ims>0?+lt.ims:null);if(nota==null&&!ims)return;
    const cn=cfg.notas.find(x=>x.n===nota);
    const bs=(GT.base||{})[c]||(lt&&!lt.del&&lt.baseM?{m:lt.baseM,d:lt.baseDia}:null)||{m:'ontem'};
    gPut({uid:idLeit(dia,c),tipo:'leitura',dia,curral:c,nota,ims,hora:new Date().toTimeString().slice(0,5),pct:cn?cn.p:0,base:+el.dataset.base||0,baseM:bs.m,baseDia:bs.m==='dia'?bs.d:null,novo:ok(kg)?kg:null,msF:+el.dataset.msf||1});n++;
    if(ok(kg)&&kg>0&&aplicaPrev(c,kg,obj))ap++;});
  /* botão geral: salva tudo — também reaplica no previsto as leituras já salvas (currais recolhidos) */
  let nSalvas=0;if(!so){gTodos('leitura').forEach(lt=>{if(lt.dia!==dia||lt.del)return;const c=nAt(lt.curral);if(feitosC.has(c)||leitTravada(dia,c))return;if(typeof curralAtivo==='function'&&!curralAtivo(c))return;
    nSalvas++;if(ok(+lt.novo)&&+lt.novo>0&&aplicaPrev(c,+lt.novo,obj))ap++;});}
  if(!so&&(n||nSalvas)){if(ap){if(hoje){marcarPrev();if(typeof render==='function')render();}else prevApi.guardarPrevDia(dia,obj);}
    GT.sel={};GT.base={};GT.coAberto={};window.scrollTo({top:0,behavior:'smooth'});
    toast(`✓ Leitura salva · previsto ${hoje?'de hoje':'de amanhã'} ${ap?`atualizado em ${ap} curral(is)`:'já estava atualizado'}${rm?` · ${rm} apagada(s)`:''}`);return gRender();}
  if(!n&&!rm)return toast(so?'Marque a nota ou o % de IMS do '+so:'Marque a nota ou o % de IMS de pelo menos um curral');
  if(so){if(ap){if(hoje){marcarPrev();if(typeof render==='function')render();}else prevApi.guardarPrevDia(dia,obj);}
    [GT.sel,GT.base,GT.coAberto].forEach(o=>{if(o)delete o[so];});const y=window.scrollY;gRender();window.scrollTo({top:y});
    return toast(n?`${so}: leitura salva · previsto ${hoje?'de hoje':'de amanhã'} ${ap?'ajustado':'já estava assim'}`:`${so}: leitura apagada`);}if(!n){if(ap){if(hoje){marcarPrev();if(typeof render==='function')render();}else prevApi.guardarPrevDia(dia,obj);}GT.sel={};GT.base={};GT.coAberto={};window.scrollTo({top:0,behavior:'smooth'});toast(`${rm} leitura(s) apagada(s) junto com o previsto que tinham gerado`);return gRender();}
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
function corNota(pct){if(!ok(pct)||pct===0)return ['#e9ecef','#11253d'];return pct>0?['#dff3dc','#1b5e20']:['#fde3e1','#b3261e'];}   /* gráfico de notas: aumentou = verde claro, diminuiu = vermelho claro, manteve = cinza */
let gLocG='T',gGrafOff=new Set();
function dadosGraf(fim){const dias=[];for(let i=gGrafN-1;i>=0;i--)dias.push(somaDias(fim,-i));
  const set=new Set();gTodos('leitura').forEach(x=>{if(x.dia>=dias[0]&&x.dia<=fim)set.add(x.curral);});dias.forEach(d=>cochoCurrais(d).forEach(c=>set.add(c)));
  const todos=[...set].filter(c=>(gLocG==='T'||linhaDe(c)===gLocG)&&(typeof curralAtivo!=='function'||curralAtivo(c))).sort(alfa);   // só currais ativos
  const linhas=todos.filter(c=>!gGrafOff.has(c)).map(c=>({c,cel:dias.map(d=>{const x=G.it[idLeit(d,c)];return x&&!x.del?x:null;})}));
  return {dias,todos,linhas};}
/* quantos dias os gráficos mostram (7, 10 ou 15) */
var gGrafN=10;
const grafNBts=()=>`<div class="row gRelAtalhos gGrafNBts">${[7,10,15].map(n=>`<button type="button" class="mini${gGrafN===n?' sel':''}" data-g="grafN" data-n="${n}">${n} dias</button>`).join('')}</div>`;
/* filtro de Local dos gráficos: igual ao da Leitura (◀ Local ▶) */
function grafLocNav(){return typeof selSetas==='function'&&window.LOC_OPS?`<div class="gCoLocNav">${selSetas('Local',LOC_OPS,Math.max(0,LOC_OPS.findIndex(o=>o[0]===gLocG)),'data-g="grafLocP" data-n','data-grafsel')}</div>`:`<div class="gForm gGrafFil">${campo({k:'grafLocF',l:'Local',t:'sel',op:[['T','Todos'],['C','Confinamento'],['P','Pasto']],v:gLocG,meia:1})}</div>`;}
/* gráfico de % IMS realizado: o que o curral comeu no dia (realizado, em MS) ÷ peso vivo — dia a dia, para acompanhar o consumo */
function dadosGrafIms(fim){const dias=[];for(let i=gGrafN-1;i>=0;i--)dias.push(somaDias(fim,-i));const ix=gIndice(),set=new Set();
  (typeof HIST!=='undefined'?HIST:[]).forEach(r=>{if(r.dia>=dias[0]&&r.dia<=fim)set.add(nAt(r.curral));});dias.forEach(d=>cochoCurrais(d).forEach(c=>set.add(c)));
  const todos=[...set].filter(c=>(gLocG==='T'||linhaDe(c)===gLocG)&&(typeof curralAtivo!=='function'||curralAtivo(c))).sort(alfa);   // só currais ativos
  const linhas=todos.filter(c=>!gGrafOff.has(c)).map(c=>{let ant=NaN;const cel=dias.map(d=>{const kg=ix.get(d+'|'+c)||0,bi=kg?baseIms(c,d):0,im=kg&&bi?kg/bi:NaN;
      if(!ok(im))return null;const ch=ok(ant)&&ant>0?(im-ant)/ant*100:0,dif=ok(ant)?Math.round(im*100)/100-Math.round(ant*100)/100:0;ant=im;return {im,kg,ch,dif};});
    const v=cel.filter(Boolean),med=v.length?v.reduce((a,x)=>a+x.im,0)/v.length:NaN;return {c,cel,med};});
  return {dias,todos,linhas};}
const gImsTxt=v=>nf(v,2);
/* gráfico de %IMS: só duas cores — subiu do dia anterior = verde claro, baixou = vermelho claro (igual ou 1º dia = sem cor) */
/* variação pequena fica cinza: só muda de cor quando o %IMS sobe ou desce IMS_LIM ou mais em relação ao dia anterior */
const IMS_LIM=0.06;   /* acima de 0,05: só 0,06 ou mais (números com 2 casas) */
const corIms=d=>d>=IMS_LIM-0.005?['#dff3dc','#1b5e20']:d<=-IMS_LIM+0.005?['#fde3e1','#b3261e']:['#e9ecef','#11253d'];
/* gráfico de linhas do %IMS: mesmos dias, mesmo local e só os currais marcados nos botões de cima */
const COR_LIN=['#2e7d32','#1565c0','#c62828','#ef6c00','#6a1b9a','#00838f','#ad1457','#5d4037','#9e9d24','#283593','#00695c','#d84315','#4e342e','#7b1fa2','#0277bd','#558b2f','#e65100','#37474f'];
/* opções do gráfico de linhas: %IMS (o='ims') ou notas de cocho */
const linOpc=()=>GT.o==='ims'?{D:dadosGrafIms(GT.dia),val:x=>x.im,fmt:gImsTxt,eixo:v=>nf(v,2),tit:'%IMS por dia',arq:'IMS',nota:'Um curral com %IMS muito diferente (ex.: MANGUEIRA) achata as outras linhas: desmarque ele para ver melhor.'}
  :{D:dadosGraf(GT.dia),val:x=>+x.nota,fmt:notaTxt,eixo:v=>nf(v,1),tit:'Notas de cocho por dia',arq:'notas',nota:'Nota de cada leitura de cocho por dia.'};
function linhasImsSVG(D,O){O=O||linOpc();const val=O.val;const L=D.linhas.filter(o=>o.cel.some(Boolean));if(!L.length)return '';
  const vs=L.flatMap(o=>o.cel.filter(Boolean).map(val)).filter(v=>ok(v));if(!vs.length)return '';let mn=Math.min(...vs),mx=Math.max(...vs);if(mx-mn<0.2){mn-=0.1;mx+=0.1;}const pad=(mx-mn)*0.08,neg=mn<0;mn=neg?mn-pad:Math.max(0,mn-pad);mx+=pad;
  const W=640,H=340,E=70,Dt=24,T=16,B=46,n=D.dias.length,xw=(W-E-Dt)/Math.max(1,n-1),X=i=>E+(n>1?i*xw:(W-E-Dt)/2),Y=v=>T+(H-T-B)*(1-(v-mn)/(mx-mn||1));
  let g='';for(let k=0;k<=4;k++){const v=mn+(mx-mn)*k/4,y=Y(v);g+=`<line x1="${E}" x2="${W-Dt}" y1="${y}" y2="${y}" stroke="#e3e8e3"/><text x="${E-8}" y="${y+6}" text-anchor="end" font-size="19" fill="#6b7a6b">${O.eixo(v)}</text>`;}
  const passo=Math.ceil(n/6);D.dias.forEach((d,i)=>{if(i%passo&&i!==n-1)return;g+=`<text x="${X(i)}" y="${H-B+28}" text-anchor="middle" font-size="19" fill="#6b7a6b">${d.slice(8)}/${d.slice(5,7)}</text>`;});
  const ls=L.map((o,k)=>{const cor=COR_LIN[k%COR_LIN.length];let dPath='',pts='';o.cel.forEach((x,i)=>{if(!x||!ok(val(x)))return;const v=val(x);dPath+=(dPath&&o.cel[i-1]&&ok(val(o.cel[i-1]))?'L':'M')+X(i).toFixed(1)+','+Y(v).toFixed(1);pts+=`<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="5" fill="${cor}"><title>${esc(o.c)} · ${dB(D.dias[i]).slice(0,5)} · ${O.fmt(v)}</title></circle>`;});
    return `<path d="${dPath}" fill="none" stroke="${cor}" stroke-width="3.5" stroke-linejoin="round"/>${pts}`;}).join('');
  const leg=L.map((o,k)=>`<span><i style="background:${COR_LIN[k%COR_LIN.length]}"></i>${esc(o.c.replace(/^P-/,''))}</span>`).join('');
  return `<h3 class="gSubT">📈 ${O.tit} (linhas)</h3><div class="row compart fz3"><button class="verde" data-g="pdfLinIms">📄 PDF</button><button class="verde" data-g="imgLinIms">🖼 Foto</button><button class="verde" data-g="xlsLinIms">📊 Excel</button></div><div class="gLinIms"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Gráfico de linhas">${g}${ls}</svg></div><div class="gLinLeg">${leg}</div>
    <p class="note">Mostra só os currais marcados nos botões de cima. ${O.nota}</p>`;}
/* PDF / Foto do gráfico de linhas: desenha o mesmo SVG numa imagem com título e legenda */
function imagemLinIms(pdf){const fim=GT.dia,O=linOpc(),D=O.D,h=linhasImsSVG(D,O),m=h.match(/<svg[\s\S]*<\/svg>/);if(!m)return toast('Nada para mostrar');
  const L=D.linhas.filter(o=>o.cel.some(Boolean)),svg=m[0].replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="680" font-family="Arial" ').replace(/<title>[^<]*<\/title>/g,'');
  const img=new Image();img.onload=()=>{const W=1320,top=96,lgH=Math.ceil(L.length/5)*34+20,H=top+680+lgH+20,cv=document.createElement('canvas');cv.width=W;cv.height=H;const x=cv.getContext('2d');
    x.fillStyle='#fff';x.fillRect(0,0,W,H);x.fillStyle='#11253d';x.fillRect(0,0,W,72);x.fillStyle='#a7bc09';x.fillRect(0,72,W,5);
    x.fillStyle='#fff';x.font='bold 28px Arial';x.fillText(`${O.tit} · ${gGrafN} dias`,20,36);x.fillStyle='#c8dd1e';x.font='bold 17px Arial';x.fillText(`${dB(D.dias[0])} a ${dB(D.dias[D.dias.length-1])} · Gestão de Tratos · FJK`,20,62);
    x.drawImage(img,20,top);let lx=30,ly=top+700;L.forEach((o,k)=>{if(k&&k%5===0){lx=30;ly+=34;}x.fillStyle=COR_LIN[k%COR_LIN.length];x.fillRect(lx,ly-6,26,6);x.fillStyle='#11253d';x.font='bold 18px Arial';x.fillText(o.c.replace(/^P-/,''),lx+34,ly);lx+=250;});
    cv.toBlob(async b=>{const n=`Grafico de linhas ${O.arq} ${dB(fim).replace(/\//g,'-')}`;try{if(pdf)return await compartilharArquivo(await pngsParaPdf([b]),n+'.pdf','application/pdf');await compartilharArquivo(b,n+'.png','image/png');}catch(e){toast(pdf?'Não consegui gerar o PDF':'Não consegui gerar a imagem');}},'image/png');};
  img.onerror=()=>toast('Não consegui gerar a imagem');img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);}
function xlsLinIms(){const O=linOpc(),D=O.D,L=D.linhas.filter(o=>o.cel.some(Boolean));const cab=['Curral'].concat(D.dias.map(d=>dB(d).slice(0,5)),['Média']);
  const med=o=>{const v=o.cel.filter(x=>x&&ok(O.val(x))).map(O.val);return v.length?v.reduce((a,b)=>a+b,0)/v.length:NaN;};
  gExcel(`Grafico linhas ${O.arq} ate ${dB(GT.dia).replace(/\//g,'-')}`,[[O.tit,cab,L.map(o=>[xc(o.c)].concat(o.cel.map(x=>x&&ok(O.val(x))?xc(O.val(x),'dec'):xc('')),[xc(med(o),'dec')])),[16].concat(D.dias.map(()=>8),[9])]]);}
function tCochoGrafIms(fim){const D=dadosGrafIms(fim);setTimeout(()=>{const t=document.querySelector('#gBox .gHeatIms');const bx=t&&t.closest('.tablebox');if(bx)bx.scrollLeft=bx.scrollWidth;},30);   // abre mostrando os dias mais recentes
  const cab=D.dias.map(d=>`<th>${d.slice(8)}<small>${d.slice(5,7)}</small></th>`).join('');
  const rows=D.linhas.map(o=>`<tr><th class="gHc${/^P-/.test(o.c)?' p':''}" title="${esc(o.c)}">${esc(o.c.replace(/^P-/,''))}</th>${o.cel.map((x,i)=>{if(!x)return `<td class="vazio" data-g="celGraf" data-c="${esc(o.c)}" data-d="${D.dias[i]}">·</td>`;const [bg,fg]=corIms(x.dif);
      return `<td class="gHims" style="background:${bg};color:${fg}" data-g="celGraf" data-c="${esc(o.c)}" data-d="${D.dias[i]}">${gImsTxt(x.im)}</td>`;}).join('')}<td class="gHm">${ok(o.med)?gImsTxt(o.med):'—'}</td></tr>`).join('');
  const cw=Math.max(5,Math.min(18,Math.max(...D.linhas.map(o=>o.c.replace(/^P-/,'').length),4)+1));
  return `${voltar('Leitura')}<section class="panel"><h2>Gráfico de %IMS · ${gGrafN} dias</h2>
    ${navData('gGrafDia',fim,'Até o dia')}
    ${grafLocNav()}
    ${grafNBts()}
    ${rows?`<div class="row compart fz3"><button class="verde" data-g="pdfGraf">📄 PDF</button><button class="verde" data-g="imgGraf">🖼 Foto</button><button class="verde" data-g="xlsGraf">📊 Excel</button></div>`:''}
    ${D.todos.length>1?`<div class="row gGrafTodos">${D.todos.every(c=>!gGrafOff.has(c))?'<button class="mini" data-g="grafTodos" data-v="0">✕ Desmarcar todos</button>':'<button class="mini" data-g="grafTodos" data-v="1">✓ Marcar todos</button>'}</div>`:''}
    <div class="gChips">${D.todos.map(c=>`<button data-g="grafCur" data-c="${esc(c)}" class="${gGrafOff.has(c)?'':'sel'}">${esc(c)}</button>`).join('')}</div>
    ${rows?`<div class="tablebox"><table class="gHeat gHeatIms" style="--cw:${cw}ch"><colgroup><col class="cC">${D.dias.map(()=>'<col class="cD">').join('')}<col class="cM"></colgroup><thead><tr><th class="gHc">Local</th>${cab}<th class="gHm">Méd.</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">% IMS = matéria seca realizada no dia ÷ peso vivo projetado × 100. Verde = subiu mais de 0,05 em relação ao dia anterior · vermelho = desceu mais de 0,05 · cinza = variação menor · ponto = sem trato. Toque num quadro para ver os kg.</p>${linhasImsSVG(D)}`:'<p class="note">Nenhum trato nesse período.</p>'}</section>`;}
function imagemGrafIms(pdf){const fim=GT.dia,D=dadosGrafIms(fim);if(!D.linhas.length)return toast('Nada para mostrar');
  const mc=document.createElement('canvas').getContext('2d');mc.font='bold 15px Arial';const esq=Math.max(120,Math.ceil(Math.max(...D.linhas.map(o=>mc.measureText(o.c).width)))+30),cw=52,ch=34,top=112,W=esq+cw*gGrafN+70+20,H=top+ch*D.linhas.length+80,cv=document.createElement('canvas'),s=2;cv.width=W*s;cv.height=H*s;
  const x=cv.getContext('2d');x.scale(s,s);x.fillStyle='#fff';x.fillRect(0,0,W,H);x.fillStyle='#11253d';x.fillRect(0,0,W,72);x.fillStyle='#a7bc09';x.fillRect(0,72,W,5);
  x.fillStyle='#fff';x.font='bold 22px Arial';x.fillText(`Gráfico de %IMS · ${gGrafN} dias`,16,32);x.font='bold 13px Arial';x.fillStyle='#c8dd1e';x.fillText(`${dB(D.dias[0])} a ${dB(fim)} · Gestão de Tratos · FJK`,16,56);
  x.textAlign='center';x.font='bold 13px Arial';D.dias.forEach((d,i)=>{x.fillStyle='#5d6b7a';x.fillText(d.slice(8)+'/'+d.slice(5,7),esq+cw*i+cw/2,top-10);});x.fillText('Média',esq+cw*gGrafN+35,top-10);
  D.linhas.forEach((o,r)=>{const y=top+ch*r;x.textAlign='left';x.fillStyle='#11253d';x.font='bold 15px Arial';x.fillText(o.c,16,y+ch/2+5);
    o.cel.forEach((c,i)=>{const cx=esq+cw*i;if(c){const [bg,fg]=corIms(c.dif);x.fillStyle=bg;x.beginPath();x.roundRect?x.roundRect(cx+2,y+2,cw-4,ch-4,5):x.rect(cx+2,y+2,cw-4,ch-4);x.fill();x.fillStyle=fg;x.font='bold 14px Arial';}else{x.fillStyle='#c4ccd5';x.font='15px Arial';}
      x.textAlign='center';x.fillText(c?gImsTxt(c.im):'·',cx+cw/2,y+ch/2+5);});
    x.fillStyle='#11253d';x.font='bold 15px Arial';x.fillText(ok(o.med)?gImsTxt(o.med):'—',esq+cw*gGrafN+35,y+ch/2+5);});
  x.textAlign='left';x.fillStyle='#5d6b7a';x.font='12px Arial';const ly=top+ch*D.linhas.length+26;
  x.fillText('% IMS = MS realizada no dia ÷ peso vivo projetado × 100',16,ly);x.fillText('Verde = subiu mais de 0,05 em relação ao dia anterior · vermelho = desceu mais de 0,05 · cinza = variação menor · ponto = sem trato',16,ly+18);
  cv.toBlob(async b=>{const n=`Gráfico de IMS ${dB(fim).replace(/\//g,'-')}`;try{if(pdf)return await compartilharArquivo(await pngsParaPdf([b]),n+'.pdf','application/pdf');await compartilharArquivo(b,n+'.png','image/png');}catch(e){toast(pdf?'Não consegui gerar o PDF':'Não consegui gerar a imagem');}},'image/png');}
function xlsGrafIms(){const D=dadosGrafIms(GT.dia);const cab=['Curral'].concat(D.dias.map(d=>dB(d).slice(0,5)),['Média']);
  gExcel(`IMS realizado ate ${dB(GT.dia).replace(/\//g,'-')}`,[['% IMS',cab,D.linhas.map(o=>[xc(o.c)].concat(o.cel.map(x=>x?xc(x.im,'dec'):xc('')),[xc(o.med,'dec')])),[16].concat(D.dias.map(()=>8),[9])],
    ['Kg realizado',cab.slice(0,-1),D.linhas.map(o=>[xc(o.c)].concat(o.cel.map(x=>x?xc(x.kg,'int'):xc('')))),[16].concat(D.dias.map(()=>9))]]);}
function tCochoGraf(t){if(!t._ini){t._ini=1;gGrafOff.clear();}   /* ao abrir o gráfico, todos os currais começam marcados */
  if(t.o)GT.o=t.o;const fim=t.dia||GT.dia||hojeKey();GT.dia=fim;if(GT.o==='ims')return tCochoGrafIms(fim);const D=dadosGraf(fim);
  const cab=D.dias.map(d=>`<th>${d.slice(8)}<small>${d.slice(5,7)}</small></th>`).join('');
  const rows=D.linhas.map(o=>{const ns=o.cel.filter(Boolean),med=ns.length?ns.reduce((a,x)=>a+x.nota,0)/ns.length:NaN;
    return `<tr><th class="gHc${/^P-/.test(o.c)?' p':''}" title="${esc(o.c)}">${esc(o.c.replace(/^P-/,''))}</th>${o.cel.map((x,i)=>{if(!x)return `<td class="vazio" data-g="celGraf" data-c="${esc(o.c)}" data-d="${D.dias[i]}">·</td>`;const [bg,fg]=corNota(x.pct);
      return `<td style="background:${bg};color:${fg}" data-g="celGraf" data-c="${esc(o.c)}" data-d="${D.dias[i]}">${notaTxt(x.nota)}</td>`;}).join('')}<td class="gHm">${ok(med)?(med>0?'+':'')+nf(med,1):'—'}</td></tr>`;}).join('');
  const notas=gCfg().notas.slice().sort((a,b)=>a.n-b.n);
  const cw=Math.max(5,Math.min(18,Math.max(...D.linhas.map(o=>o.c.replace(/^P-/,'').length),4)+1));
  return `${voltar('Leitura')}<section class="panel"><h2>Gráfico de notas · ${gGrafN} dias</h2>
    ${navData('gGrafDia',fim,'Até o dia')}
    ${grafLocNav()}
    ${grafNBts()}
    ${rows?`<div class="row compart fz3"><button class="verde" data-g="pdfGraf">📄 PDF</button><button class="verde" data-g="imgGraf">🖼 Foto</button><button class="verde" data-g="xlsGraf">📊 Excel</button></div>`:''}
    ${D.todos.length>1?`<div class="row gGrafTodos">${D.todos.every(c=>!gGrafOff.has(c))?'<button class="mini" data-g="grafTodos" data-v="0">✕ Desmarcar todos</button>':'<button class="mini" data-g="grafTodos" data-v="1">✓ Marcar todos</button>'}</div>`:''}
    <div class="gChips">${D.todos.map(c=>`<button data-g="grafCur" data-c="${esc(c)}" class="${gGrafOff.has(c)?'':'sel'}">${esc(c)}</button>`).join('')}</div>
    ${rows?`<div class="tablebox"><table class="gHeat" style="--cw:${cw}ch"><colgroup><col class="cC">${D.dias.map(()=>'<col class="cD">').join('')}<col class="cM"></colgroup><thead><tr><th class="gHc">Local</th>${cab}<th class="gHm">Méd.</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="gLegNota">${notas.map(x=>{const [bg,fg]=corNota(x.p);return `<span style="background:${bg};color:${fg}">${notaTxt(x.n)}<small>${x.p>0?'+':''}${nf(x.p,0)}%</small></span>`;}).join('')}</div>
    <p class="note">Verde = aumentou o trato · vermelho = diminuiu · cinza = manteve · ponto = sem leitura. Toque num quadro para ver os kg.</p>${linhasImsSVG(D)}`:'<p class="note">Nenhuma leitura nesse período.</p>'}</section>`;}
function imagemGraf(pdf){const fim=GT.dia,D=dadosGraf(fim);if(!D.linhas.length)return toast('Nada para mostrar');
  const mc=document.createElement('canvas').getContext('2d');mc.font='bold 15px Arial';const esq=Math.max(120,Math.ceil(Math.max(...D.linhas.map(o=>mc.measureText(o.c).width)))+30),cw=46,ch=34,top=112,W=esq+cw*gGrafN+70+20,H=top+ch*D.linhas.length+110,cv=document.createElement('canvas'),s=2;cv.width=W*s;cv.height=H*s;
  const x=cv.getContext('2d');x.scale(s,s);x.fillStyle='#fff';x.fillRect(0,0,W,H);x.fillStyle='#11253d';x.fillRect(0,0,W,72);x.fillStyle='#a7bc09';x.fillRect(0,72,W,5);
  x.fillStyle='#fff';x.font='bold 22px Arial';x.fillText(`Gráfico de notas · ${gGrafN} dias`,16,32);x.font='bold 13px Arial';x.fillStyle='#c8dd1e';x.fillText(`${dB(D.dias[0])} a ${dB(fim)} · Gestão de Tratos · FJK`,16,56);
  x.textAlign='center';x.font='bold 13px Arial';D.dias.forEach((d,i)=>{x.fillStyle='#5d6b7a';x.fillText(d.slice(8)+'/'+d.slice(5,7),esq+cw*i+cw/2,top-10);});x.fillText('Média',esq+cw*gGrafN+35,top-10);
  D.linhas.forEach((o,r)=>{const y=top+ch*r;x.textAlign='left';x.fillStyle='#11253d';x.font='bold 15px Arial';x.fillText(o.c,16,y+ch/2+5);
    o.cel.forEach((c,i)=>{const cx=esq+cw*i;if(c){const [bg,fg]=corNota(c.pct);x.fillStyle=bg;x.beginPath();x.roundRect?x.roundRect(cx+2,y+2,cw-4,ch-4,5):x.rect(cx+2,y+2,cw-4,ch-4);x.fill();x.fillStyle=fg;x.font='bold 15px Arial';}else{x.fillStyle='#c4ccd5';x.font='15px Arial';}
      x.textAlign='center';x.fillText(c?notaTxt(c.nota):'·',cx+cw/2,y+ch/2+5);});
    const ns=o.cel.filter(Boolean),m=ns.length?ns.reduce((a,c)=>a+c.nota,0)/ns.length:NaN;x.fillStyle='#11253d';x.font='bold 15px Arial';x.fillText(ok(m)?(m>0?'+':'')+nf(m,1):'—',esq+cw*gGrafN+35,y+ch/2+5);});
  const ns=gCfg().notas.slice().sort((a,b)=>a.n-b.n),ly=top+ch*D.linhas.length+30,lw=Math.min(54,(W-32)/ns.length);
  ns.forEach((n,i)=>{const [bg,fg]=corNota(n.p),lx=16+lw*i;x.fillStyle=bg;x.fillRect(lx,ly,lw-3,30);x.fillStyle=fg;x.textAlign='center';x.font='bold 13px Arial';x.fillText(notaTxt(n.n),lx+lw/2-1,ly+14);x.font='10px Arial';x.fillText((n.p>0?'+':'')+nf(n.p,0)+'%',lx+lw/2-1,ly+26);});
  x.textAlign='left';x.fillStyle='#5d6b7a';x.font='12px Arial';x.fillText('Verde = aumentou o trato · vermelho = diminuiu · cinza = manteve · ponto = sem leitura',16,ly+52);
  cv.toBlob(async b=>{const n=`Gráfico de notas ${dB(fim).replace(/\//g,'-')}`;try{if(pdf)return await compartilharArquivo(await pngsParaPdf([b]),n+'.pdf','application/pdf');await compartilharArquivo(b,n+'.png','image/png');}catch(e){toast(pdf?'Não consegui gerar o PDF':'Não consegui gerar a imagem');}},'image/png');}

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
  return `<div class="tablebox"><table class="gInsTab"><thead><tr><th>Insumo</th><th>kg (MN)</th><th>Custo</th></tr></thead><tbody>${e.map(([n,o])=>`<tr><td>${esc(n)}</td><td>${nf(o.kg)}</td><td>${rs(o.rs)}</td></tr>`).join('')}
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
/* nome do arquivo do resultado do lote: Resultado (curral) lote - data em que fechou (ou a data de hoje, se ainda ativo) */
const nomeRes=(l,C)=>nomeArq(`Resultado (${curralEm(l,C.ate)||'—'}) ${l.nome} - ${dB(C.ate).replace(/\//g,'-')}`);
async function enviarImg(titulo,secoes,nome){if(!secoes.some(s=>s.linhas.length))return toast('Nada para mostrar');
  const pdf=window.__expPdf;window.__expPdf=false;
  try{const b=await gImagem(titulo,secoes);if(pdf)return await compartilharArquivo(await pngsParaPdf([b]),nomeArq(nome)+'.pdf','application/pdf');
    await compartilharArquivo(b,nomeArq(nome)+'.png','image/png');}catch(e){toast(pdf?'Não consegui gerar o PDF':'Não consegui gerar a imagem');}}
/* imagens (png) → um PDF, uma imagem por página */
async function pngsParaPdf(blobs){const cvs=[];for(const b of blobs){const im=await createImageBitmap(b),cv=document.createElement('canvas');cv.width=im.width;cv.height=im.height;const x=cv.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,cv.width,cv.height);x.drawImage(im,0,0);cvs.push(cv);}return fzPdf(cvs);}
window.pngsParaPdf=pngsParaPdf;
const kv=(cab,pares)=>({cab,cols:[['',360,'l'],['',300,'r']],linhas:pares.map(([a,b])=>[a,b])});
const corV='#5f7a00',corR='#b3261e';
function imgDia(d){const dia=d||$('gDiaDia').value,ls=linhasDia(dia),ins={};let T={cab:0,mn:0,ms:0,c:0};
  const L=ls.map(({l,x})=>{somaInsumos(ins,x);const t=(ok(x.custoR)?x.custoR:0)+x.custoOp;T.cab+=x.cab;T.mn+=x.mn;T.ms+=ok(x.ms)?x.ms:0;T.c+=t;
    return [x.c,l.nome,nf(x.cab),nf(x.peso),nf(x.mn),nf(x.msCab,2),pc(x.pv,2),rs(t)];});
  const ie=Object.entries(ins).sort((a,b)=>b[1].kg-a[1].kg);
  return enviarImg(`Relatório do dia · ${dB(dia)}`,[{cab:'Consumo e custo por lote',cols:[['Curral',110,'l'],['Lote',190,'l'],['Cab',70,'r'],['Peso',80,'r'],['MN kg',100,'r'],['MS/cab',90,'r'],['% IMS',85,'r'],['Custo',140,'r']],linhas:L,
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
/* formato antigo (tabelas) — guardado */
function imgLoteTab(id){const l=G.it[id],C=calcLote(l),cabE=C.cabE;
  const sec=[kv('Lote',[['Lote',l.nome],['Período',`${dB(l.ent.dia)} a ${dB(C.ate)} (${nf(C.dias)} dias)`],['Situação',C.fim?'Encerrado':'Ativo'],...dadosLotePares(l,C)]),
    kv('Desempenho',[['MS por cab/dia',nf(C.msCab,2)+' kg'],['% do peso vivo',pc(C.pv,2)],['MN por cab/dia',nf(C.mnCab,2)+' kg'],[C.cabV?'GMD real':'GMD meta',nf(C.cabV?C.gmdV:l.gmd,2)+' kg/dia'],['Dias de consumo (média)',nf(C.diasMed,1)+' dias'],['Mortes',`${nf(C.mortes)} (${pc(C.mortPct,2)})`],...(C.cabV?[['Dias de cocho (média ponderada)',nf(C.diasCocho,1)+' dias'],['Conversão alimentar',nf(C.conv,2)],['Peso de entrada (vivo)',nf(C.pesoE,1)+' kg'],['Peso de saída (vivo)',nf(ok(C.ganhoV)&&C.cabP?C.pesoE+C.ganhoV/C.cabP:NaN,1)+' kg'],['@ produzidas · peso vivo',`${nf(C.arrPV,2)} (${nf(C.arrPV/C.cabV,2)}/cab)`],['@ produzidas · carcaça',`${nf(C.arrProd,2)} (${nf(C.arrProd/C.cabV,2)}/cab)`]]:[])]),
    {cab:'Custos (cab/dia = diária)',cols:[['Custo',230,'l'],['Total',170,'r'],['Por cabeça',140,'r'],['Cab/dia',120,'r']],linhas:[['Compra',rs(C.compra),rs(C.compra/cabE),'—'],['Custos de alimentação',rs(C.alim),rs(C.alim/cabE),rs(C.diaAlim)],['Operacional',rs(C.op),rs(C.op/cabE),rs(C.diaOp)],['Outros custos',rs(C.outros),rs(C.outros/cabE),rs(C.diaOut)]],total:['TOTAL · diária média',rs(C.custo),rs(C.custo/cabE),rs(C.diaria)]}];
  if(C.cabV)sec.push(kv('Custo de produção',[['Custo da @ produzida',rs(C.custoArr)],['@ produzidas (carcaça)',nf(C.arrProd,2)],['Custo de produção (sem a compra)',rs(C.prod)]]));
  if(!C.fim){const E=estVendaDet(l,C);if(E.pr>0){const s=kv('Estimativa de venda hoje',[['Peso projetado',nf(E.peso,1)+' kg'],['Rendimento · preço da @',`${nf(E.rc,1)}% · ${rs(E.pr)}`],['@ por cabeça',nf(E.arrCab,2)],['Venda estimada',rs(E.rec)],[E.res>=0?'RESULTADO ESTIMADO':'PREJUÍZO ESTIMADO',rs(E.res)],['Por cabeça',rs(E.resCab)],['Sobre o custo',pc(E.margem,1)],['Preço da @ para empatar',rs(E.pontoEq)]]);s.cores=s.linhas.map((x,i)=>[null,i>=4&&i<=6?(E.res>=0?corV:corR):null]);sec.push(s);}}
  if(C.cabV)sec.push(kv('Venda',[['Vendidos',`${nf(C.cabV)} cab · ${nf(C.pesoV)} kg`],['@ por cabeça',nf(C.arrV/C.cabV,2)],['Preço de venda da @',rs(C.precoArr)],['Receita líquida',rs(C.receita)]]));
  if(C.fim){const s=kv('Resultado',[[C.lucro>=0?'LUCRO':'PREJUÍZO',rs(C.lucro)],['Lucro por cabeça',rs(C.lucroCab)],['Lucro por @',rs(C.lucroArr)],['Rentabilidade (lucro ÷ custo)',pc(C.rentab,1)]]);s.cores=s.linhas.map(()=>[null,C.lucro>=0?corV:corR]);sec.push(s);}
  enviarImg(`${C.fim?'Relatório final':'Resultado até hoje'} · ${l.nome}`,sec,`Lote ${l.nome} ${dB(C.ate).replace(/\//g,'-')}`);}
/* relatório do lote em formato de painel (foto/PDF): resultado no topo, depois animais, desempenho, custos (com barra), venda e a conta do resultado */
function canvasLote(l,C){
  const W=1000,M=36,F='-apple-system,"Segoe UI",Roboto,Arial,sans-serif',ESC=2,AZ='#11253d',LI='#a7bc09',CI='#5d6b7a',VD='#3f7d20',VM='#b3261e';
  const cv=document.createElement('canvas');cv.width=W*ESC;cv.height=4200*ESC;const c=cv.getContext('2d');c.scale(ESC,ESC);c.textBaseline='middle';
  c.fillStyle='#fff';c.fillRect(0,0,W,4200);
  const fonte=(p,s)=>c.font=`${p} ${s}px ${F}`;
  const txt=(t,x,y,p,s,cor,al,max)=>{t=String(t??'');fonte(p,s);if(max)while(c.measureText(t).width>max&&s>10){s--;fonte(p,s);}c.fillStyle=cor||AZ;c.textAlign=al||'left';c.fillText(t,x,y);};
  const ret=(x,y,w,h,r,cor)=>{c.fillStyle=cor;c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();c.fill();};
  const fim=C.fim,cabE=C.cabE,cabR=C.cabE-(C.cabT||0)-(C.faltas||0),vendas=C.vendas,kgV=vendas.reduce((a,s)=>a+s.cab*s.peso,0),rcM=kgV?vendas.reduce((a,s)=>a+s.cab*s.peso*(+s.rc||0),0)/kgV:NaN;
  const E=fim?null:estVendaDet(l,C);
  /* cabeçalho */
  c.fillStyle=AZ;c.fillRect(0,0,W,128);c.fillStyle=LI;c.fillRect(0,128,W,6);
  const AP=C.apart,FI=AP?filhosApart(l,C):null;
  txt(`${AP?'Relatório da apartação':fim?'Relatório final':'Resultado até hoje'} · ${l.nome}`,M,44,'800',34,'#fff','left',W-2*M);
  const r=racaoEm(l,C.ate);
  txt([curralEm(l,C.ate),[sexoTxt(l.sexo),l.raca].filter(x=>x&&x!=='—').join(' '),r&&r.nome].filter(Boolean).join(' · '),M,82,'600',18,'#c8dd1e','left',W-2*M);
  txt(`${dB(l.ent.dia)} a ${dB(C.ate)} · ${nf(C.dias)} dias · Gestão de Tratos FJK`,M,108,'500',16,'#dfe6ee','left',W-2*M);
  let y=160;
  /* resultado em destaque */
  const lucro=AP?NaN:fim?C.lucro:(E&&E.pr>0?E.res:NaN),pos=!(lucro<0),corH=ok(lucro)?(pos?VD:VM):AZ;
  ret(M,y,W-2*M,150,16,corH);
  const rotH=AP?'CUSTO ATÉ A APARTAÇÃO':fim?(pos?'LUCRO DO LOTE':'PREJUÍZO DO LOTE'):ok(lucro)?(pos?'RESULTADO ESTIMADO HOJE':'PREJUÍZO ESTIMADO HOJE'):'CUSTO ATÉ HOJE';
  txt(rotH,M+28,y+38,'700',17,'rgba(255,255,255,.85)');txt(rs(ok(lucro)?lucro:C.custo),M+28,y+88,'800',44,'#fff','left',400);
  if(AP)txt(`dividido em ${C.aps.length} lotes, proporcional ao peso`,M+28,y+126,'500',14,'rgba(255,255,255,.85)','left',400);
  else if(!fim)txt(ok(lucro)?'estimativa: peso projetado × rendimento × preço da @':'sem preço da @ de venda no lote',M+28,y+126,'500',14,'rgba(255,255,255,.85)','left',400);
  const hb=AP?[['GMD real',nf(C.gmdV,2)+' kg'],['custo @ produzida',rs(C.custoArrPV)],['custo por cabeça',rs(C.custo/cabR)]]:fim?[['por cabeça',rs(C.lucroCab)],['por @ vendida',rs(C.lucroArr)],['rentabilidade',pc(C.rentab,1)]]:ok(lucro)?[['por cabeça',rs(E.resCab)],['sobre o custo',pc(E.margem,1)],['@ p/ empatar',rs(E.pontoEq)]]:[['por cabeça',rs(C.custo/cabR)],['diária',rs(C.diaria)],['cabeças',nf(C.cabAt)]];
  const bw=(W-2*M-470)/3;hb.forEach(([a,b],i)=>{const x=M+450+i*(bw+6);ret(x,y+22,bw,106,12,'rgba(255,255,255,.14)');txt(b,x+bw/2,y+64,'800',24,'#fff','center',bw-12);txt(a,x+bw/2,y+100,'600',14,'rgba(255,255,255,.85)','center',bw-12);});
  y+=180;
  /* título de bloco e quadrinhos */
  const bloco=(n,t,sub)=>{ret(M,y,40,40,10,AZ);txt(n,M+20,y+21,'800',20,'#fff','center');txt(t,M+54,y+21,'800',24,AZ);if(sub)txt(sub,W-M,y+22,'500',14,CI,'right',420);y+=56;};
  const tiles=(arr,cols)=>{const g=12,w=(W-2*M-g*(cols-1))/cols,h=104;arr.forEach((t,i)=>{const x=M+(i%cols)*(w+g),yy=y+Math.floor(i/cols)*(h+g);
      ret(x,yy,w,h,12,t.cor||'#f3f6f9');c.fillStyle=t.barra||LI;c.fillRect(x,yy+14,4,h-28);
      txt(t.r,x+18,yy+24,'700',14,CI,'left',w-30);txt(t.v,x+18,yy+58,'800',28,t.vc||AZ,'left',w-30);if(t.s)txt(t.s,x+18,yy+88,'500',13,CI,'left',w-30);});
    y+=Math.ceil(arr.length/cols)*(h+g)+22;};
  /* 1. animais */
  bloco('1','Animais','ponderado pelas datas de entrada e saída');
  tiles([{r:'ENTRARAM',v:nf(cabE)+' cab',s:`${l.apDe?'peso na apartação':'peso médio'} ${nf(C.pesoE,1)} kg`},AP?{r:'APARTADOS',v:nf(C.cabA)+' cab',s:`peso médio ${nf(C.pesoA,1)} kg`}:{r:'VENDIDOS',v:nf(C.cabV)+' cab',s:(C.cabV?`peso médio ${nf(C.pesoV)} kg`:'nenhuma venda ainda')+(C.cabT?` · ${nf(C.cabT)} transferidos`:'')},
    {r:'MORTES',v:nf(C.mortes),s:`${pc(C.mortPct,2)} de mortalidade`+(C.faltas?` · ${nf(C.faltas)} faltaram`:''),barra:C.mortes||C.faltas?VM:LI},{r:C.cabP?'DIAS DE COCHO':'DIAS DE CONSUMO',v:nf(C.cabP?C.diasCocho:C.diasMed,1)+' dias',s:C.cabP?`média · consumo ${nf(C.diasMed,1)} dias`:'média por animal'}],4);
  /* 2. desempenho */
  bloco('2','Desempenho','quanto o boi ganhou e comeu');
  const pSai=ok(C.ganhoV)&&C.cabP?C.pesoE+C.ganhoV/C.cabP:NaN;
  tiles([{r:'PESO DE ENTRADA · VIVO',v:nf(C.pesoE,1)+' kg',s:'média por cabeça'},{r:'PESO DE SAÍDA · VIVO',v:ok(pSai)?nf(pSai,1)+' kg':'—',s:ok(pSai)?`média por cabeça · +${nf(pSai-C.pesoE,1)} kg`:'aparece após a venda'},{r:C.cabP?'GMD REAL':'GMD META',v:nf(C.cabP?C.gmdV:l.gmd,2)+' kg',s:'ganho por cabeça por dia'},
    {r:'CONSUMO DE MS',v:nf(C.msCab,2)+' kg',s:`por cab/dia · ${pc(C.pv,2)} do peso vivo`},{r:'CONSUMO DE MN',v:nf(C.mnCab,2)+' kg',s:'matéria natural por cab/dia'},
    {r:'CONVERSÃO ALIMENTAR',v:nf(C.conv,2),s:'kg de MS para 1 kg de ganho'},{r:'GANHO TOTAL',v:nf(C.ganhoV)+' kg',s:C.cabP?`${nf(C.ganhoV/C.cabP,1)} kg por cabeça`:'aparece após a venda'},
    {r:'@ PRODUZIDAS · PESO VIVO',v:nf(C.arrPV,2),s:C.cabP?`${nf(C.arrPV/C.cabP,2)} @ por cab (ganho ÷ 30)`:'—'},
    ...(AP?[{r:'PESO NA APARTAÇÃO',v:nf(C.pesoA,1)+' kg',s:`entrada ${nf(C.pesoE,1)} kg · +${nf(C.pesoA-C.pesoE,1)} kg`},{r:'CUSTO DO KG GANHO',v:rs(C.custoKg),s:'custos sem compra ÷ kg ganhos'}]
      :[{r:'@ PRODUZIDAS · CARCAÇA',v:nf(C.arrProd,2),s:C.cabV?`${nf(C.arrProd/C.cabV,2)} @ por cab (@ vendida − @ de entrada)`:'—'},{r:'RENDIMENTO DE CARCAÇA',v:pc(rcM,1),s:'média das vendas'}])],3);
  /* 3. custos com barra de composição */
  bloco('3','Custos',`custo total ${rs(C.custo)}`);
  const partes=[...linhasCompra(l,C).map(([a,v],i)=>[a,v,i?'#7a4fbf':'#11253d']),['Alimentação',C.alim,'#a7bc09'],['Operacional',C.op,'#4a7fbf'],['Outros custos',C.outros,'#e0912f']],tot=C.custo||1;
  let x=M;const bwT=W-2*M;partes.forEach(([n,v,cor])=>{const w=Math.max(0,v/tot*bwT);c.fillStyle=cor;c.fillRect(x,y,w,30);x+=w;});y+=48;
  c.fillStyle='#dde3ea';c.fillRect(M,y-6,bwT,1);
  txt('CUSTO',M+30,y+10,'700',13,CI);txt('TOTAL',M+480,y+10,'700',13,CI,'right');txt('% DO TOTAL',M+600,y+10,'700',13,CI,'right');txt('POR CABEÇA',W-M-130,y+10,'700',13,CI,'right');txt('CAB/DIA',W-M-8,y+10,'700',13,CI,'right');y+=26;
  partes.forEach(([n,v,cor],i)=>{if(i%2){c.fillStyle='#f7f9fb';c.fillRect(M,y,bwT,40);}ret(M+6,y+12,16,16,4,cor);txt(n,M+30,y+20,'700',18,AZ);txt(rs(v),M+480,y+20,'600',18,AZ,'right');txt(pc(v/tot*100,1),M+600,y+20,'600',18,CI,'right');
    txt(rs(v/cabR),W-M-130,y+20,'600',18,AZ,'right');txt(i?rs(v/(C.R.cabDias||NaN)):'—',W-M-8,y+20,'600',18,AZ,'right');y+=40;});
  ret(M,y+4,bwT,46,10,AZ);txt('TOTAL',M+16,y+27,'800',19,'#fff');txt(rs(C.custo),M+480,y+27,'800',19,'#c8dd1e','right');txt("100%",M+600,y+27,'700',18,'#fff','right');txt(rs(C.custo/cabR),W-M-130,y+27,'800',19,'#c8dd1e','right');txt(rs(C.diaria),W-M-8,y+27,'800',19,'#c8dd1e','right');y+=72;
  if(notaTransf(C)){fonte('600',14);const ws=notaTransf(C).split(' ');let ln='';const L=[];ws.forEach(w=>{const t=ln?ln+' '+w:w;if(c.measureText(t).width>bwT&&ln){L.push(ln);ln=w;}else ln=t;});if(ln)L.push(ln);
    L.forEach((t,i)=>txt(t,M,y-8+i*20,'600',14,CI));y+=18+(L.length-1)*20;}   /* nota em várias linhas (não corta) */
  tiles([{r:'DIÁRIA MÉDIA',v:rs(C.diaria),s:'R$ por cab/dia (sem a compra)'},{r:'DIÁRIA · ALIMENTAÇÃO',v:rs(C.diaAlim),s:`operacional ${rs(C.diaOp)} · outros ${rs(C.diaOut)}`},AP?{r:'CUSTO DA @ PRODUZIDA',v:rs(C.custoArrPV),s:'custos sem compra ÷ @ peso vivo produzidas'}:{r:'CUSTO DA @ PRODUZIDA',v:rs(C.custoArr),s:'custos sem compra ÷ @ carcaça produzidas'}],3);
  /* apartação: como o custo foi dividido e como estão os lotes novos */
  if(AP){bloco('4','Divisão na apartação',`${dB(C.aps[0].dia)} · proporcional ao peso`);
    const cores=['#11253d','#a7bc09','#4a7fbf','#e0912f','#7a4fbf','#3f7d20'];let xx=M;FI.forEach((f,i)=>{const w=f.pct/100*bwT;c.fillStyle=cores[i%6];c.fillRect(xx,y,w,30);if(w>60)txt(pc(f.pct,1),xx+w/2,y+16,'800',14,'#fff','center');xx+=w;});y+=48;
    txt('LOTE NOVO',M+30,y,'700',13,CI);txt('CAB.',M+380,y,'700',13,CI,'right');txt('PESO',M+480,y,'700',13,CI,'right');txt('% DO PESO',M+600,y,'700',13,CI,'right');txt('CUSTO QUE LEVOU',W-M-140,y,'700',13,CI,'right');txt('POR CAB.',W-M-8,y,'700',13,CI,'right');y+=16;
    FI.forEach((f,i)=>{if(i%2){c.fillStyle='#f7f9fb';c.fillRect(M,y,bwT,38);}ret(M+6,y+11,16,16,4,cores[i%6]);txt(f.nome,M+30,y+19,'700',17,AZ,'left',300);txt(nf(f.cab),M+380,y+19,'600',17,AZ,'right');txt(nf(f.peso,1)+' kg',M+480,y+19,'600',17,AZ,'right');txt(pc(f.pct,1),M+600,y+19,'600',17,CI,'right');txt(rs(f.custo),W-M-140,y+19,'700',17,AZ,'right');txt(rs(f.custo/f.cab),W-M-8,y+19,'600',17,AZ,'right');y+=38;});
    y+=26;bloco('5','Resultado do grupo',FI.todos?'todos os lotes novos fechados':'lotes novos ainda em andamento');
    txt('LOTE NOVO',M+30,y,'700',13,CI);txt('SITUAÇÃO',M+400,y,'700',13,CI);txt('RESULTADO',W-M-8,y,'700',13,CI,'right');y+=16;
    FI.forEach((f,i)=>{if(i%2){c.fillStyle='#f7f9fb';c.fillRect(M,y,bwT,38);}txt(f.nome,M+30,y+19,'700',17,AZ,'left',340);txt(f.sit,M+400,y+19,'600',15,CI,'left',260);txt(ok(f.res)?rs(f.res)+(f.est?' (est.)':''):'—',W-M-8,y+19,'800',17,ok(f.res)?(f.res>=0?VD:VM):CI,'right');y+=38;});
    ret(M,y+4,bwT,50,10,ok(FI.res)?(FI.res>=0?VD:VM):AZ);txt(FI.todos?'RESULTADO DO GRUPO':'RESULTADO DO GRUPO (parcial / estimado)',M+16,y+29,'800',18,'#fff');txt(ok(FI.res)?rs(FI.res)+(ok(FI.rentab)?` · ${pc(FI.rentab,1)}`:''):'—',W-M-14,y+29,'800',20,'#fff','right');y+=80;}
  /* 4. venda */
  const trsVI=C.trs.filter(s=>+s.vi>0),sumi=saidasDe(l).filter(s=>s.mot==='falta'&&faltaPend(s)>0);
  if((C.cabV||trsVI.length)&&!AP){bloco('4','Venda',`${vendas.length} venda(s)${trsVI.length?` · ${trsVI.length} venda(s) para outros lotes`:''}${sumi.length?` · ${nf(sumi.reduce((a,s)=>a+faltaPend(s),0))} sumido(s)`:''}`);
    const arrI=trsVI.reduce((a,s)=>a+(+s.cab||0)*(+s.peso||0)*(+s.rcV||50)/100/15,0),recI=trsVI.reduce((a,s)=>a+(+s.vi||0),0),cabI=trsVI.reduce((a,s)=>a+(+s.cab||0),0),brV=vendas.reduce((a,s)=>a+valorVenda(s)+(+s.desc||0),0);
    const recT=C.receita+recI,arrT=C.arrV+arrI,cabT2=C.cabV+cabI;   /* vendas para outros lotes entram junto */
    const rcMed=C.arrV&&C.cabV?C.arrV*15/(C.cabV*C.pesoV)*100:NaN,pArr=arrT?(brV+recI)/arrT:NaN,recPerd=s=>{const p=faltaPend(s),pv=ok(C.pesoV)?C.pesoV:+s.peso;return p*pv*(ok(rcMed)?rcMed:50)/100/15*(ok(pArr)?pArr:0);};
    GT.recPerd=sumi.reduce((a,s)=>a+recPerd(s),0);
    tiles([{r:'RECEITA LÍQUIDA',v:rs(recT),s:recI?`frigorífico ${rs(C.receita)} + outros lotes ${rs(recI)}`:'já descontados frete e impostos'},{r:'PREÇO MÉDIO DA @',v:rs(arrT?(brV+recI)/arrT:NaN),s:'bruto, média ponderada'},{r:'@ POR CABEÇA',v:nf(cabT2?arrT/cabT2:NaN,2),s:`${nf(arrT,1)} @ vendidas`}],3);
    const X1=M+8,X2=M+118,X3=M+450,X4=M+545,X5=M+625,X6=M+765,X7=W-M-8,lin1=(i,cor,dia,cpr,cab,peso,rc,arr,val)=>{if(i%2){c.fillStyle='#f7f9fb';c.fillRect(M,y,bwT,36);}txt(dia,X1,y+18,'600',15,cor);txt(cpr,X2,y+18,'700',15,cor,'left',X3-X2-40);txt(cab,X3,y+18,'600',15,cor,'right');txt(peso,X4,y+18,'600',15,cor,'right');txt(rc,X5,y+18,'600',15,cor,'right');txt(arr,X6,y+18,'600',15,cor,'right');txt(val,X7,y+18,'700',15,cor,'right');y+=36;};
    txt('DATA',X1,y,'700',13,CI);txt('COMPRADOR',X2,y,'700',13,CI);txt('CAB.',X3,y,'700',13,CI,'right');txt('PESO',X4,y,'700',13,CI,'right');txt('REND.',X5,y,'700',13,CI,'right');txt('@ BRUTA',X6,y,'700',13,CI,'right');txt('VALOR TOTAL',X7,y,'700',13,CI,'right');y+=16;let k=0;
    vendas.forEach(s=>{const a=arrobaVenda(s);lin1(k++,AZ,dB(s.dia),nomeCpr(s),nf(s.cab),nf(s.peso)+' kg',pc(+s.rc,1),rs(a?(valorVenda(s)+(+s.desc||0))/a:NaN),rs(valorVenda(s)));});
    trsVI.forEach(s=>{const rcV=+s.rcV||50,a=(+s.cab||0)*(+s.peso||0)*rcV/100/15,d=G.it[s.destino];lin1(k++,AZ,dB(s.dia),'→ '+(d?curralEm(d,s.dia)||d.nome:'outro lote')+' (venda interna)',nf(s.cab),nf(s.peso)+' kg',pc(rcV,1),rs(a?(+s.vi)/a:NaN),rs(+s.vi));});
    saidasDe(l).filter(s=>s.mot==='morte').forEach(s=>lin1(k++,VM,dB(s.dia),`✝ Morte${s.causa?' · '+s.causa:''} · prejuízo ${rs(+s.custo||0)}`,nf(s.cab),'—','—','—','—'));
    sumi.forEach(s=>{const p=faltaPend(s);lin1(k++,VM,dB(s.dia),'❓ Sumidos (custo separado)'+(s.obs?' · '+s.obs:''),nf(p),nf(+s.peso)+' kg','—','—','—');});
    ret(M,y+4,bwT,40,10,AZ);txt('TOTAL VENDIDO',X1+8,y+24,'800',16,'#fff');txt(nf(cabT2),X3,y+24,'800',16,'#fff','right');txt(rs(arrT?(brV+recI)/arrT:NaN),X6,y+24,'700',15,'#fff','right');txt(rs(recT),X7,y+24,'800',16,'#c8dd1e','right');y+=50;
    y+=26;}
  /* 5. a conta do resultado */
  if(!AP&&(fim||(E&&E.pr>0))){bloco(C.cabV?'5':'4',fim?'Como chegou no resultado':'Como chegou na estimativa');
    const cTr=(C.recInt||0)-(C.resInt||0),cT=C.custo+cTr+(C.perd||0),rec=(fim?C.receita:E.rec)+(C.recInt||0),linhas=[[fim?(C.recInt?'Receita total':'Receita'):'Receita estimada',rec,VD,'+'],['Custo total',-cT,VM,'−'],[fim?(pos?'Lucro':'Prejuízo'):'Resultado',lucro,corH,'=']],mx=Math.max(Math.abs(rec),cT,Math.abs(lucro))||1;
    linhas.forEach(([n,v,cor,s],i)=>{txt(s,M+10,y+20,'800',24,cor,'center');txt(n,M+34,y+20,'700',18,AZ);const w=Math.abs(v)/mx*(bwT-460);ret(M+250,y+6,Math.max(4,w),28,6,cor);txt(rs(Math.abs(v)),W-M-8,y+20,'800',20,cor,'right');y+=44;
      if(i===1){c.fillStyle=AZ;c.fillRect(M,y-2,bwT,2);y+=6;}});
    if(C.cmpAlt){txt(`Compra calculada pelo preço da @ vendida (${rs(C.cmpAlt.nova)}); a compra lançada é ${rs(C.cmpAlt.lanc)} (${C.cmpAlt.delta>=0?'+':''}${rs(C.cmpAlt.delta)} no custo).`,M,y+4,'700',14,VM,'left',bwT);y+=26;}
    if(cTr>0){txt(`Custo total = custos do lote ${rs(C.custo)} (quadro 3) + ${rs(cTr)} dos ${nf(C.cabTV)} cab vendidos para outros lotes (a venda deles está na receita).`,M,y+4,'700',14,AZ,'left',bwT);y+=26;}
    if(C.sumCusto){const nS=nf(sumi.reduce((a,s)=>a+faltaPend(s),0));
      txt(`Os ${nS} sumidos saíram do lote levando o custo deles (${rs(C.sumCusto)}, compra + trato).`,M,y+4,'700',14,VM,'left',bwT);y+=22;
      txt(`Esse custo fica separado até serem achados e não entra no resultado deste lote.`,M,y+4,'600',14,CI,'left',bwT);y+=26;}
    if(C.custoMortes>0){txt(`Mortes: ${nf(C.mortes)} cab · prejuízo ${rs(C.custoMortes)} (compra pelo preço de entrada + trato até o dia), já incluído no custo total.`,M,y+4,'700',14,VM,'left',bwT);y+=26;}
    y+=20;}
  /* rodapé explicativo */
  fonte('500',13);const notas=['Conversão = MS consumida ÷ kg ganhos. Peso de saída = média de todos os que saíram pesados (vendidos e transferidos).','@ peso vivo = ganho ÷ 30. @ carcaça = (peso × rendimento ÷ 15) − (peso de entrada ÷ 30).','Diária = (alimentação + operacional + outros) ÷ cabeças-dia. Dias de cocho = média ponderada dos vendidos.'];
  c.fillStyle='#dde3ea';c.fillRect(M,y,bwT,1);y+=20;notas.forEach(n=>{txt(n,M,y,'500',13,CI,'left',bwT);y+=20;});y+=16;
  const out=document.createElement('canvas');out.width=W*ESC;out.height=y*ESC;out.getContext('2d').drawImage(cv,0,0);return out;}
/* lotes novos de uma apartação: quanto de custo levou cada um e como está (real se fechou, estimado se ainda tem animais) */
function filhosApart(l,C){C=C||calcLote(l);const kgT=C.kgA||1;let res=0,custo=0,todos=true,algum=false;
  const F=C.aps.map(s=>{const f=G.it[s.destino],pct=s.cab*s.peso/kgT*100,o={nome:f?f.nome:'(apagado)',uid:s.destino,cab:+s.cab,peso:+s.peso,pct,custo:C.custo*pct/100,res:NaN,est:false,sit:'—'};
    if(f&&!f.del){const Cf=calcLote(f);if(Cf.apart){const sub=filhosApart(f,Cf);o.res=sub.res;o.est=!sub.todos;o.sit=`apartado de novo (${Cf.aps.length} lotes)`;if(!sub.todos)todos=false;o.cst=sub.custo;}
      else if(Cf.fim){o.res=Cf.lucro;o.sit=`fechado em ${dB(Cf.fim)}`;o.cst=Cf.custo;}else{const V=vendaEst(f,Cf);o.res=V.res;o.est=true;todos=false;o.sit=`ativo · ${nf(Cf.cabAt)} cab`;o.cst=Cf.custo;}}else todos=false;
    if(ok(o.res)){res+=o.res;algum=true;custo+=o.cst||0;}else todos=false;return o;});
  F.todos=todos;F.res=algum?res:NaN;F.custo=custo;F.rentab=todos&&custo?res/custo*100:NaN;return F;}
async function imgLote(id,pdf){const l=G.it[id],C=calcLote(l),nome=nomeRes(l,C);pdf=pdf||window.__expPdf;window.__expPdf=false;
  try{const cv=canvasLote(l,C);if(pdf)return await compartilharArquivo(fzPdf([cv]),nome+'.pdf','application/pdf');
    await compartilharArquivo(await new Promise(ok=>cv.toBlob(ok,'image/png')),nome+'.png','image/png');}catch(e){console.error(e);toast(pdf?'Não consegui gerar o PDF':'Não consegui gerar a imagem');}}
function xlsGraf(){const D=dadosGraf(GT.dia);const cab=['Curral'].concat(D.dias.map(d=>dB(d).slice(0,5)),['Média']);
  gExcel(`Leitura de cocho ate ${dB(GT.dia).replace(/\//g,'-')}`,[['Notas',cab,D.linhas.map(o=>{const ns=o.cel.filter(Boolean);return [xc(o.c)].concat(o.cel.map(x=>x?xc(x.nota,'int'):xc('')),[xc(ns.length?ns.reduce((a,x)=>a+x.nota,0)/ns.length:NaN,'dec')]);}),[16].concat(D.dias.map(()=>8),[9])],
    ['Kg do dia',cab.slice(0,-1),D.linhas.map(o=>[xc(o.c)].concat(o.cel.map(x=>x&&ok(x.novo)?xc(x.novo,'int'):xc('')))),[16].concat(D.dias.map(()=>9))]]);}

/* ---------- relatórios ---------- */
const REL_ABRE={relDia:'dia',indices:'indices',perLote:'periodo',vendas:'vendas',comp:'comp'};
/* relatórios por período (De … Até) */
const REL_PER=[
  ['tratosPC','Tratos do período por curral','soma de cada curral no período (previsto, realizado e diferença)'],
  ['tratosPJ','Tratos do período dia a dia','todos os tratos de cada dia do período'],
  ['batidasP','Carregamentos do vagão','carregamentos do período com os insumos e o total'],
  ['perLote','Consumo e custo por lote','MN, MS/cab/dia, % IMS e custo de cada lote; insumos usados'],
  ['comp','Comparativo de lotes','todos os lotes lado a lado (não depende da data)'],
  ['estMov','Estoque · movimentações','entradas, saídas e consumo de cada produto no período'],
  ['vendas','Vendas por comprador','vendas do período: preço, rendimento e R$/cab']];
function relModo(){return GT&&GT.relModo==='per'?'per':'dia';}
/* Config › Conf. balança: a mesma lista de relatórios, só com os da balança */
const REL_BAL_DIA=[
  ['confBal','Conferência da balança','carregamentos e tratos com a balança no início e no fim, e o balanço do vagão'],
  ['confRes','Balanço do vagão','uma linha por carregamento: já tinha, carregado, fornecido, devia sobrar, sobrou e a mais'],
  ['saltos','Saltos da balança por curral','quanto a balança subiu ou desceu antes de cada curral, sem descarregar']];
const REL_BAL_PER=[
  ['confResP','Balanço do vagão','uma linha por carregamento do período: já tinha, carregado, fornecido, devia sobrar, sobrou e a mais'],
  ['saltosP','Saltos da balança por curral','em quais currais a balança mais sobe ou desce no trajeto (média, maior, soma)'],
  ['confBalP','Conferência da balança dia a dia','a conferência completa de cada dia do período (uma página por dia)']];
function relBal(){return !!(GT&&GT.t==='cfg'&&GT.cfgSel==='confbal');}
function relLista(){return relBal()?(relModo()==='per'?REL_BAL_PER:REL_BAL_DIA):relModo()==='per'?REL_PER:REL_DIA;}
function relSelK(){return (relBal()?'relExpB':'relExp')+(relModo()==='per'?'P':'');}
function relFaixa(){const hj=hojeKey(),b=GT.rFim||hj,a=GT.rIni||somaDias(b,-6);return a<=b?[a,b]:[b,a];}
function relExpSel(){const ks=new Set(relLista().map(x=>x[0]));return relExpSel0().filter(x=>ks.has(x));}
function relExpSel0(){const per=relModo()==='per',k=relSelK();if(window.__relExpVer&&window.__relExpVer[k])return window.__relExpVer[k];const c=gCfg();return Array.isArray(c[k])?c[k]:relBal()?relLista().map(x=>x[0]):(per?['tratosPC','perLote']:['tratosC','indices','estoque']);}
function tRels(t){const per=relModo()==='per',dia=(t&&t.dia)||hojeKey(),[ini,fim]=relFaixa(),sel=relExpSel(),selM=!!(t&&t.relSel),ab=t&&t.relAb,LST=relLista(),ck=per?ini+'|'+fim:dia;
  if(ab&&!selM&&relVerCache.k!==ab+'|'+ck)setTimeout(relVerCarregar,60);
  const abre=k=>REL_ABRE[k]?`<button type="button" class="mini gRelAbre" data-g="ir" data-t="${REL_ABRE[k]}"${per?` data-ini="${ini}" data-fim="${fim}"`:` data-dia="${dia}"`}>abrir a tela completa ›</button>`:'';
  const grpT=(k,ix)=>{if(relBal()||typeof REL_GRP==='undefined')return '';const g=REL_GRP[k],gA=ix?REL_GRP[LST[ix-1][0]]:null;return g&&g!==gA?`<h3 class="gRelGrp">${g}</h3>`:'';};
  const lista=selM?LST.map(([k,tt,d],ix)=>grpT(k,ix)+`<label class="gRelIt"><input type="checkbox" data-relx="${k}"${sel.includes(k)?' checked':''}><span><b>${tt}</b><small>${d}</small></span></label>`).join('')
    :LST.map(([k,tt,d],ix)=>grpT(k,ix)+`<div class="gRelBloco${ab===k?' ab':''}"><button type="button" class="gRelIt gRelVerBt" data-g="relVer" data-k="${k}"><span><b>${tt}</b><small>${ab===k?'toque para fechar':d}</small></span><i>${ab===k?'▲':'▼'}</i></button>
      ${ab===k?`<div class="gRelVer" id="gRelVer" title="Toque para ver em tela cheia">${relVerCache.k===k+'|'+ck?relVerCache.h:'<p class="note">Carregando o relatório…</p>'}</div>`:''}</div>`).join('');
  const atalho=(n,r)=>`<button type="button" class="mini" data-g="relAtalho" data-n="${n}">${r}</button>`;
  const bal=relBal();
  return `<section class="panel"><h2>${bal?'Conferência da balança':'Relatórios'}</h2>${bal?'<p class="note">Relatórios para conferir a balança e o vagão: o que entrou, o que saiu e o que sobrou, e onde a balança sobe ou desce sem carregar.</p>':''}
  <div class="gRelModo"><button type="button" class="${per?'':'on'}" data-g="relModo" data-m="dia">📅 Por dia</button><button type="button" class="${per?'on':''}" data-g="relModo" data-m="per">📆 Por período</button></div>
  ${per?`<div class="gPerDatas gRelDatas"><label>De<input type="date" id="gRelIni" value="${ini}"></label><label>Até<input type="date" id="gRelFim" value="${fim}"></label></div>
    <div class="row gRelAtalhos">${atalho(7,'7 dias')}${atalho(15,'15 dias')}${atalho(30,'30 dias')}${atalho('mes','Este mês')}</div>`:navData('gRelDia',dia,'Data')}
  <button type="button" class="gRelSelBt${selM?' on':''}" data-g="relSel">${selM?'✕ Cancelar seleção':'☑ Selecionar para exportar'}</button>
  ${selM?`<div class="row compart fz3 expTopo gRelExpBts"><button class="verde" data-g="relExp" data-o="pdf">📄 PDF</button><button class="verde" data-g="relExp" data-o="img">🖼 Foto</button><button class="verde" data-g="relExp" data-o="xls">📊 Excel</button></div>
  <p class="note">Marque os relatórios e toque em <b>PDF</b>, <b>Foto</b> ou <b>Excel</b>: sai tudo junto, ${per?'do período escolhido':'da data escolhida'}. <b id="gRelN">${sel.length} marcado(s)</b></p>`
  :`<p class="note">Toque num relatório para ver aqui embaixo. Para enviar, use <b>Selecionar para exportar</b>.</p>`}
  <div class="gRelLista gRelExpL">${lista}</div>
  ${bal?'':`<button type="button" class="mini gRelCpr" data-g="ir" data-t="compradores">🤝 Cadastro de compradores</button>
  <p class="note">O relatório de um lote fica dentro do lote: Lotes → escolha o lote → Resultado.</p>`}</section>`;}
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
  const rows=B.map(c=>{const p=kg(c,'prev'),r=kg(c,'real');return `<tr><td class="hora">${esc(c.hora||'')}</td><td class="c">${c.avulso?'Avulso':'Trato '+esc((c.tratos||[c.trato]).join('+'))}<small>${esc(c.racNome||'')}</small></td><td>${nf(p)}</td><td><b>${r?nf(r):'—'}</b></td><td class="${r?classeDesv(r-p,p):''}">${r?sgn(r-p):''}</td></tr>`;}).join('');
  const tp=B.reduce((a,c)=>a+kg(c,'prev'),0),tr=B.reduce((a,c)=>a+kg(c,'real'),0);
  return card('Carregamentos do dia',`<div class="tablebox"><table class="gTab"><thead><tr><th>Hora</th><th>Carregamento</th><th>Previsto</th><th>Carregado</th><th>Dif.</th></tr></thead><tbody>${rows}<tr class="grp"><td></td><td>Total · ${B.length} carregamento(s)</td><td>${nf(tp)}</td><td>${nf(tr)}</td><td>${tr?sgn(tr-tp):''}</td></tr></tbody></table></div>
    <p class="note">Carregado = soma do realizado de cada produto no carregamento. É o que sai do Estoque.</p>`);}
function textoDia(){const dia=$('gDiaDia').value,ls=linhasDia(dia);
  let cab=0,mn=0,ms=0,c=0;const linhas=ls.map(({l,x})=>{cab+=x.cab;mn+=x.mn;ms+=ok(x.ms)?x.ms:0;const t=(ok(x.custoR)?x.custoR:0)+x.custoOp;c+=t;
    return `*${x.c}* · ${l.nome} · ${nf(x.cab)} cab · ${nf(x.peso)} kg\n  MN ${nf(x.mn)} kg (${nf(x.mnCab,1)}/cab) · MS ${nf(x.msCab,2)} kg/cab · IMS ${pc(x.pv,2)}\n  Custo ${rs(t)} (${rs(t/x.cab)}/cab)`;});
  return `*Relatório do dia ${dB(dia)}*\n\n${linhas.join('\n\n')}\n\n*Total:* ${nf(cab)} cab · MN ${nf(mn)} kg · MS ${nf(ms)} kg · ${rs(c)}`;}
function xlsDia(d){const dia=d||$('gDiaDia').value,ls=linhasDia(dia),ins={};
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
    return cartaoLote(o.l,curralEm(o.l,fim),`${nf(o.dias)} dias no período · ${nf(o.cabDias/o.dias)} cab em média`,[[nf(o.mn),'kg MN'],[nf(o.ms/o.cabDias,2),'MS/cab/dia'],[pc(o.pvN?o.pvS/o.pvN:NaN,2),'% IMS'],[rs(tot),'custo total'],[rs((o.cr+o.co)/o.cabDias),'R$/cab/dia'],[rs(o.out),'outros custos']]);}).join('');
  const tot=T.cr+T.co+T.out;
  const atalho=(n,r)=>`<button class="mini" data-g="perAtalho" data-n="${n}">${r}</button>`;
  return `${voltar('Relatórios')}<section class="panel"><h2>Relatório por período</h2>
    <div class="gForm"><div class="gCampo"><label for="gPerIni">De</label><input type="date" id="gPerIni" value="${ini}"></div><div class="gCampo"><label for="gPerFim">Até</label><input type="date" id="gPerFim" value="${fim}"></div></div>
    <div class="row">${atalho(7,'7 dias')}${atalho(15,'15 dias')}${atalho(30,'30 dias')}${atalho('mes','Este mês')}</div>
    <div class="stat gStat3">${st('Cab-dia',nf(T.cd))}${st('MN total',nf(T.mn)+' kg')}${st('MS/cab/dia',nf(T.cd?T.ms/T.cd:NaN,2)+' kg')}
      ${st('Custo total',rs(tot))}${st('R$/cab/dia',rs(T.cd?(T.cr+T.co)/T.cd:NaN))}${st('Outros custos',rs(T.out))}</div>
    <p class="note">Ração ${rs(T.cr)} + operacional ${rs(T.co)}${T.out?` + outros custos ${rs(T.out)}`:''}.</p>
    ${rows||'<p class="note">Nada nesse período.</p>'}
    ${rows?'<div class="row compart"><button class="verde" data-g="imgPer">🖼 Foto</button><button class="verde" data-g="xlsPer">📊 Excel</button></div>':''}</section>
  ${Object.keys(D.ins).length?card('Insumos usados no período',tabInsumos(D.ins)):''}`;
}
function xlsPer(){const ini=GT.ini,fim=GT.fim,D=periodoDados(ini,fim);
  const r1=D.lotes.map(o=>[xc(curralEm(o.l,fim)),xc(o.l.nome),xc(o.dias,'int'),xc(o.cabDias,'int'),xc(o.mn,'int'),xc(o.ms,'int'),xc(o.mn/o.cabDias,'dec'),xc(o.ms/o.cabDias,'dec'),xc(o.pvN?o.pvS/o.pvN/100:NaN,'pct'),xc(o.cr,'rs'),xc(o.co,'rs'),xc(o.out,'rs'),xc(o.cr+o.co+o.out,'rs'),xc((o.cr+o.co)/o.cabDias,'rs')]);
  const r2=D.diario.map(({d,l,x})=>[xc(d,'dia'),xc(x.c),xc(l.nome),xc(x.rac),xc(x.cab,'int'),xc(x.peso,'int'),xc(x.mn,'int'),xc(x.ms,'int'),xc(x.msCab,'dec'),xc(x.pv/100,'pct'),xc(x.custoR,'rs'),xc(x.custoOp,'rs')]);
  gExcel(`Relatório ${dB(ini).replace(/\//g,'-')} a ${dB(fim).replace(/\//g,'-')}`,[
    ['Por lote',['Curral','Lote','Dias','Cab-dia','MN (kg)','MS (kg)','MN/cab/dia','MS/cab/dia','% IMS médio','Custos de alimentação','Custo operacional','Outros custos','Custo total','Ração+oper./cab/dia'],r1,[10,18,7,9,11,11,10,10,9,13,13,13,13,12]],
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
    ${rows?'<div class="row compart fz3"><button class="verde" data-g="pdfComp">📄 PDF</button><button class="verde" data-g="imgComp">🖼 Foto</button><button class="verde" data-g="xlsComp">📊 Excel</button></div>':''}</section>`;
}
function xlsComp(){const todosL=gTodos('lote').filter(l=>GT.compEnc?!ativo(l):true).sort(porCurral);
  const r=todosL.map(l=>{const C=calcLote(l),e=l.ent;return [xc(l.nome),xc(C.fim?'Arquivado':'Ativo'),xc(curralEm(l,C.ate)),xc(sexoTxt(l.sexo)),xc(l.raca||''),xc(e.dia,'dia'),xc(C.fim||'','dia'),xc(C.dias,'int'),xc(C.cabE,'int'),xc(C.cabV,'int'),xc(C.mortes,'int'),
    xc(C.pesoE,'int'),xc(C.pesoV,'int'),xc(C.gmdV,'dec'),xc(l.gmd,'dec'),xc(C.msCab,'dec'),xc(C.pv/100,'pct'),xc(C.conv,'dec'),xc(C.compra,'rs'),xc(C.alim,'rs'),xc(C.op,'rs'),xc(C.outros,'rs'),xc(C.custo,'rs'),xc(C.receita,'rs'),xc(C.arrProd,'dec'),xc(C.custoArr,'rs'),xc(C.lucro,'rs'),xc(C.lucro/C.cabE,'rs'),...(()=>{const E=C.fim?null:estVendaDet(l,C);return E&&E.pr>0?[xc(E.pr,'rs'),xc(E.rc/100,'pct'),xc(E.rec,'rs'),xc(E.res,'rs'),xc(E.resCab,'rs'),xc(E.pontoEq,'rs')]:[xc(''),xc(''),xc(''),xc(''),xc(''),xc('')];})(),xc(C.compra/C.cabE,'rs'),xc((C.alim+C.op)/C.cabE,'rs'),xc(C.custoCabDia,'rs')];});
  gExcel('Comparativo de lotes',[['Lotes',['Lote','Situação','Curral','Sexo','Raça','Entrada','Saída','Dias','Cab. entrada','Cab. vendidas','Mortes','Peso entrada','Peso saída','GMD real','GMD meta','MS/cab/dia','% IMS','Conversão','Compra','Custos de alimentação','Operacional','Outros custos','Custo total','Receita','@ produzidas','Custo @ produzida','Lucro','Lucro/cab','Preço @ venda (est.)','Rendimento venda','Venda estimada','Resultado estimado','Resultado est./cab','Preço @ p/ empatar','R$/cab compra','R$/cab tratos','R$/cab/dia'],r]]);}
function xlsLote(id){const l=G.it[id],C=calcLote(l),X=gCtx(),r=[];
  for(let d=l.ent.dia,i=0;d<=C.ate&&i<4000;d=somaDias(d,1),i++){const x=diaLote(l,d,X);if(!x)continue;const lt=G.it[idLeit(d,x.c)];
    r.push([xc(d,'dia'),xc(x.c),xc(x.rac),xc(x.cab,'int'),xc(x.peso,'int'),xc(x.mn,'int'),xc(x.ms,'int'),xc(x.mnCab,'dec'),xc(x.msCab,'dec'),xc(x.pv/100,'pct'),xc(lt&&!lt.del?lt.nota:''),xc(x.custoR,'rs'),xc(x.custoOp,'rs')]);}
  const res=(GT.relRes||[]).map(([a,b])=>[xc(a),xc(b)]);
  gExcel(nomeRes(l,C),[['Resumo',['Item','Valor'],res,[36,40]],['Dia a dia',['Data','Curral','Ração','Cabeças','Peso proj.','MN (kg)','MS (kg)','MN/cab','MS/cab','% IMS','Nota cocho','Custo ração','Custo operacional'],r,[11,10,14,9,10,10,10,9,9,8,9,13,13]],
    ['Vendas e mortes',['Data','Tipo','Comprador','Cabeças','Peso vivo','Rendimento','@ total','Preço @ bruto','Descontos','Receita líquida','Obs.'],saidasDe(l).map(s=>{const m=s.mot!=='venda'&&ehVenda(s)===false,a=m?NaN:arrobaVenda(s);return [xc(s.dia,'dia'),xc({morte:'Morte',falta:'Faltou',transf:'Transferência',apart:'Apartação'}[s.mot]||'Venda'),xc(m?'':nomeCpr(s)),xc(+s.cab,'int'),xc(m?'':+s.peso,'int'),xc(m?'':(+s.rc||0)/100,'pct'),xc(m?'':a,'dec'),xc(m||!a?'':(valorVenda(s)+(+s.desc||0))/a,'rs'),xc(m?'':+s.desc||0,'rs'),xc(m?'':valorVenda(s),'rs'),xc(s.obs||'')];}),[11,8,22,9,10,10,10,12,12,14,22]]]);}

/* ---------- rações ---------- */
function tRacoes(){
  const hj=hojeKey(),Rt=gTodos('racao').sort(porNome),R=Rt.filter(r=>!r.inativa),Ri=Rt.filter(r=>r.inativa);
  const card=r=>{const cp=compRacao(r,hj);const usam=lotesAtivos().filter(l=>{const x=racaoEm(l,hj);return x&&x.uid===r.uid;}).length;
    return `<button class="gItem gRacItem${r.inativa?' gInativa':''}" data-g="ir" data-t="racForm" data-id="${r.uid}"><div class="gItemTopo"><b>${esc(r.nome)}</b><span class="pill${usam?' done':''}">${r.inativa?'inativa':usam?usam+' lote(s)':'sem lote'}</span></div>
      ${cp?`<div class="gMini3"><div><small>MS</small><b>${pc(cp.ms)}</b></div><div><small>R$/kg MN</small><b>${rs(cp.custoMN,3)}</b></div><div><small>R$/kg MS</small><b>${rs(cp.custoMS,3)}</b></div></div>
      <div class="gComp"><div class="gCompCab"><span>Insumo</span><span>% MS</span><span>% MN</span></div>${cp.itens.map(i=>`<div><span>${esc(i.nome)}<i style="width:${Math.max(2,Math.min(100,i.pMN||0)).toFixed(1)}%"></i></span><b>${nf(i.pMS,1)}</b><b>${nf(i.pMN,1)}</b></div>`).join('')}</div>`:'<p class="note">sem fórmula</p>'}</button>`;};
  const cards=R.map(card).join('');
  return `<section class="panel"><div class="curhead gLotesTopo"><h2>Rações ativas</h2><span class="gLotesBts"><button type="button" class="mini lima" data-g="ir" data-t="racForm">+ Nova ração</button></span></div>
    <button class="primary" data-g="ir" data-t="racCur">🌾 Rações por curral (mudar a ração)</button>${cards||'<p class="note">Nenhuma ração ativa. Cadastre os insumos primeiro e depois a ração.</p>'}</section>
    ${Ri.length?`<section class="panel"><h2>Rações inativas</h2><p class="note">Não aparecem no Carregar, no Fornecer nem nos lotes. Os registros antigos continuam.</p>${Ri.map(card).join('')}</section>`:''}`;
}
/* ordem de carregamento da ração (r.ordem = lista de insumos); o que não está na lista vai no fim, na ordem da fórmula */
function ordenarRac(r,L,f){const o=(r&&Array.isArray(r.ordem))?r.ordem:[];if(!o.length)return L.slice();f=f||(i=>i.ins);const p=x=>{const k=o.indexOf(f(x));return k<0?1e6:k;};return L.map((x,j)=>[x,j]).sort((a,b)=>p(a[0])-p(b[0])||a[1]-b[1]).map(z=>z[0]);}
function tRacForm(t){
  const r=t.id?G.it[t.id]:null,hj=hojeKey(),v=r?vig(r.versoes,hj):null;
  if(!GT.itens)GT.itens=v?ordenarRac(r,v.itens).map(i=>({ins:i.ins,pMS:i.pMS})):[{ins:'',pMS:''}];
  const ops=opInsumos();
  if(!ops.length)return `${voltar()}<section class="panel"><h2>Nova ração</h2><p class="note">Cadastre os insumos primeiro (silagem, DDG, núcleo…).</p><button class="lima" data-g="ir" data-t="insForm">+ Novo insumo</button></section>`;
  const linhas=GT.itens.map((i,k)=>`<div class="gRacLin"><select data-ri="${k}"><option value="">Selecione</option>${ops.map(([a,b])=>`<option value="${a}"${a===i.ins?' selected':''}>${esc(b)}</option>`).join('')}</select>
    <input class="cell num" inputmode="decimal" data-rp="${k}" value="${esc(vIn(gNum(i.pMS)))}" placeholder="% MS"><span class="gRacOrd"><button type="button" class="mini" data-g="racUp" data-i="${k}"${k?'':' disabled'} aria-label="Subir">▲</button><button type="button" class="mini" data-g="racDn" data-i="${k}"${k<GT.itens.length-1?'':' disabled'} aria-label="Descer">▼</button></span><button class="mini danger" data-g="racRm" data-i="${k}">✕</button></div>`).join('');
  const vers=r?(r.versoes||[]).slice().sort((a,b)=>a.desde<b.desde?1:-1).map(x=>`<div class="gVers"><b>${x.desde<='2000-01-01'?'Fórmula inicial':'Desde '+dB(x.desde)}</b><span>${x.itens.map(i=>{const n=G.it[i.ins];return `${esc(n?n.nome:'?')} ${nf(+i.pMS,1)}%`;}).join(' · ')}</span></div>`).join(''):'';
  return `${voltar()}<section class="panel"><h2>${r?'Ração':'Nova ração'}</h2>
    <div class="gForm">${campo({k:'nome',l:'Nome da ração',v:GT.nome!=null?GT.nome:(r?r.nome:''),ph:'Ex.: Terminação'})}${campo({k:'desde',l:'Fórmula vale a partir de',t:'dia',v:GT.desde||(r?hj:'2000-01-01'),ajuda:r?'Mudou a fórmula? Os dias antes dessa data continuam com a fórmula antiga.':''})}</div>
    <label>Insumos da fórmula · na ordem de carregamento</label><p class="note">Use ▲ ▼ para mudar a ordem: o vagão é carregado de cima para baixo.</p><div class="gRacLin gRacCab"><span>Insumo</span><span>% na MS</span><span>Ordem</span><span></span></div>${linhas}
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
  r.nome=nome;const srt=L=>JSON.stringify(L.slice().sort((a,b)=>String(a.ins).localeCompare(String(b.ins)))),v=vig(r.versoes,desde),igual=v&&srt(v.itens)===srt(its);r.ordem=its.map(i=>i.ins);  // só mudou a ordem: não cria fórmula nova
  if(!igual)setHist(r.versoes,desde,{itens:its});
  gPut(r);toast('Ração salva');GT.itens=null;GT.nome=null;GT.desde=null;gVoltar();
}

/* ---------- insumos ---------- */
function tInsumos(){
  const hj=hojeKey(),I=gTodos('insumo').sort(porNome);
  const rows=I.map(i=>{const p=precoIns(i,hj),e=estoqueIns(i);return `<tr data-g="ir" data-t="insForm" data-id="${i.uid}" class="gClic"><td class="c">${esc(i.nome)}${i.inativo?' <span class="pill">inativo</span>':''}<small>${e.saldo==null?'estoque: sem lançamento':'estoque: '+nf(e.saldo)+' kg'}</small>${i.obs?`<small>📝 ${esc(i.obs)}</small>`:''}</td><td>${pc(+i.ms,1)}</td><td>${rs(p)}<small>${rs(p/1000/(i.ms/100),3)}/kg MS</small></td></tr>`;}).join('');
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
  return `<div class="gMsAviso${m.leit?' atencao':''}">${m.amanha?'✓ Tratos de hoje finalizados. ':''}A nova MS vale a partir de <b>${dB(m.dia)}</b>${m.amanha?' (amanhã)':' (hoje)'}: leitura, previsto, rações e carregamentos desse dia em diante. Os dias anteriores ficam como estão.${m.leit?`<br>⚠ A leitura de ${dB(m.dia)} já foi feita com a MS antiga: depois de alterar, refaça a leitura para recalcular o previsto.`:''}</div>`;}
function tInsMS(t){const I=gTodos('insumo').sort(porNome),H=msHistTodos(),sel=(t&&t.ins)||'',iS=sel&&G.it[sel];
  let vis=0;const linhas=H.map(x=>{const v=(!sel||x.uid===sel)&&vis<7;if(v)vis++;return `<tr data-msh="${esc(x.uid||'')}"${v?'':' hidden'}><td>${dB(x.dia)}${x.hora?`<small>${esc(x.hora)}</small>`:''}</td><td class="c">${esc(x.nome)}</td><td>${x.ini?'inicial':pc(+x.de,1)}</td><td><b>${pc(+x.para,1)}</b></td></tr>`;}).join('');
  if(!GT.msAberto)return `${t&&t.t==='ms'?'':voltar()}<section class="panel"><h2>💧 Matéria seca</h2>
    <button class="primary" data-g="msAbre">💧 Alterar matéria seca</button></section>
    <section class="panel"><h2 id="gMsHTit">Últimas alterações</h2>
    <div class="tablebox"${H.length?'':' hidden'}><table class="gTab"><thead><tr><th>A partir de</th><th>Produto</th><th>De</th><th>Para</th></tr></thead><tbody>${linhas}</tbody></table></div>
    <p class="note"${H.length?' hidden':''}>Nenhuma alteração de matéria seca ainda.</p></section>`;
  return `${t&&t.t==='ms'?'':voltar()}<section class="panel"><h2>💧 Alterar matéria seca</h2>
    <p class="note">Escolha o produto e digite a nova % de MS.</p>
    <label>Produto<select id="gMsIns" onchange="msFiltrar(this.value)">
      <option value=""${sel?'':' selected'} disabled>Escolha o produto</option>${I.map(i=>`<option value="${i.uid}"${i.uid===sel?' selected':''} data-ms="${nf(+i.ms,1)}">${esc(i.nome)}</option>`).join('')}</select></label>
    <div class="gMsLinha"><div><span>MS atual</span><b id="gMsAtual">${iS?pc(+iS.ms,1):'—'}</b></div>
      <label>Nova MS (%)<input type="text" inputmode="decimal" id="gMsNova" placeholder="ex.: 35,5"></label></div>
    ${msAvisoHTML()}
    <button class="primary" data-g="salvaMS"${msStatus().bloq?' disabled':''}>Alterar matéria seca</button><button class="danger" data-g="msCancela">✕ Cancelar</button></section>
    <section class="panel"><h2 id="gMsHTit">${iS?'Últimas alterações · '+esc(iS.nome):'Últimas alterações'}</h2>
    <div class="tablebox"${H.length?'':' hidden'}><table class="gTab"><thead><tr><th>A partir de</th><th>Produto</th><th>De</th><th>Para</th></tr></thead><tbody>${linhas}</tbody></table></div>
    <p class="note" id="gMsVazio"${H.some(x=>!sel||x.uid===sel)?' hidden':''}>Nenhuma alteração de matéria seca${iS?' desse produto':''} ainda.</p></section>`;}
/* escolheu o produto: mostra a MS atual e só as alterações dele */
window.msFiltrar=uid=>{const i=G.it[uid];if(GT&&(GT.t==='ms'||GT.t==='insMS'))GT.ins=uid;
  const a=document.getElementById('gMsAtual');if(a)a.textContent=i?pc(+i.ms,1):'—';
  const t=document.getElementById('gMsHTit');if(t)t.textContent='Últimas alterações'+(i?' · '+i.nome:'');let n=0;
  document.querySelectorAll('#gBox tr[data-msh]').forEach(r=>{const v=(!uid||r.dataset.msh===uid)&&n<7;r.hidden=!v;if(v)n++;});
  const tb=document.querySelector('#gBox tr[data-msh]');if(tb)tb.closest('.tablebox').hidden=!n;
  const z=document.getElementById('gMsVazio');if(z){z.hidden=!!n;z.textContent='Nenhuma alteração de matéria seca'+(i?' desse produto':'')+' ainda.';}
  const nv=document.getElementById('gMsNova');if(nv){nv.value='';nv.focus();}};
function salvaMS(){const st_=msStatus();if(st_.bloq)return toast('Termine todos os tratos de hoje antes de alterar a MS');const sel=document.getElementById('gMsIns'),i=sel&&G.it[sel.value];if(!i)return toast('Escolha o produto');
  const v=Math.round(gNum(document.getElementById('gMsNova').value)*10)/10;if(!(v>0&&v<=100))return toast('A MS deve ficar entre 1 e 100%');
  if(Math.abs(v-(+i.ms))<1e-9)return toast('Essa já é a MS atual de '+i.nome);
  const x=JSON.parse(JSON.stringify(i)),d=new Date(),hist=Array.isArray(x.msHist)?x.msHist:(x.msDia&&x.msAnt!=null?[{dia:x.msDia,ts:0,de:+x.msAnt,para:+x.ms}]:[]);
  hist.push({dia:st_.dia,ts:Date.now(),hora:String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'),de:+i.ms,para:v});
  x.msHist=hist.slice(-30);x.msAnt=+i.ms;x.ms=v;x.msDia=st_.dia;gPut(x);
  const nAj=ajustarLeiturasMS();toast(`${i.nome}: MS ${pc(+i.ms,1)} → ${pc(v,1)} a partir de ${dB(st_.dia)}${nAj?` · leitura e previsto ajustados em ${nAj} curral(is)`:''}`);GT.ins=i.uid;GT.msAberto=false;gRender();}
function tInsForm(t){const i=t.id?G.it[t.id]:null,hj=hojeKey(),PMH=i?precoMedioHist(i.uid):[];
  const hist=i?(i.precos||[]).slice().reverse().map((p,k,a)=>`<tr><td>${dB(p.desde)}</td><td>${rs(+p.rs,2)}</td><td class="acoes">${a.length>1?`<button class="mini danger" data-g="insPrecoRm" data-id="${i.uid}" data-d="${p.desde}">✕</button>`:''}</td></tr>`).join(''):'';
  return `${voltar()}<section class="panel"><h2>${i?'Insumo':'Novo insumo'}</h2><div class="gForm">${[
    {k:'nome',l:'Nome',v:i?i.nome:'',ph:'Ex.: Silagem de milho'},{k:'ms',l:'Matéria seca',suf:'%',t:'num',v:i?i.ms:'',meia:1},
    ...(PMH.length?[]:[{k:'preco',l:'Preço por tonelada',suf:'R$/t',t:'rs',v:i?precoIns(i,hj):'',meia:1,ajuda:'Só até lançar a primeira entrada com valor no Estoque (manual ou NF). Depois o preço passa a ser o preço médio automático.'},
    {k:'desde',l:'Preço vale a partir de',t:'dia',v:i?hj:'2000-01-01',ajuda:i?'Se mudar o preço, os dias antes dessa data continuam com o preço antigo.':''}]),
    {k:'estMin',l:'Estoque mínimo (opcional)',suf:'kg',t:'num',v:i&&+i.estMin>0?+i.estMin:'',meia:1,ajuda:'Abaixo disso o estoque avisa que está acabando.'},
    {k:'fixo',l:'No carregamento',t:'sel',op:[['0','Registra o que a balança marcar'],['1','Registra sempre o previsto']],v:i&&i.fixo?'1':'0',ajuda:'Use "sempre o previsto" para produto de quantidade pequena (ex.: núcleo), em que a variação da balança atrapalha. A balança só ajuda a ver quanto colocar; ao registrar, passar para o próximo ou finalizar, fica o previsto.'},
    {k:'obs',l:'Observação',v:i&&i.obs?i.obs:'',ph:'Ex.: fornecedor, frete, umidade...'}].map(campo).join('')}</div>
    <button class="primary" data-g="salvaIns" data-id="${t.id||''}">Salvar</button></section>
    ${i?pmHTML(i,PMH):''}
    ${i&&!PMH.length?`<section class="panel"><h2>Histórico de preço (manual)</h2><div class="tablebox"><table><thead><tr><th>Desde</th><th>R$/t</th><th></th></tr></thead><tbody>${hist}</tbody></table></div>
    </section>`:''}${i?`<section class="panel"><h2>Situação</h2><p class="note">${i.inativo?'<b>Inativo</b>: não aparece no estoque nem nas entradas. Os registros antigos continuam.':'<b>Ativo</b>: aparece no estoque e nas entradas.'}</p>
      <button class="${i.inativo?'lima':'danger'}" data-g="insAtiva" data-id="${i.uid}">${i.inativo?'✓ Reativar insumo':'⏸ Inativar insumo (não vai usar mais)'}</button>
      <button class="dangerfill" data-g="apagaIns" data-id="${i.uid}">Apagar insumo</button></section>`:''}`;}
function pmHTML(i,H){const hj=hojeKey(),p=precoIns(i,hj);
  if(!H.length)return `<section class="panel"><h2>Preço médio (automático)</h2><p class="note">Ainda não tem entrada com valor no Estoque. Quando lançar a primeira entrada com valor (Estoque › Entrada ou NF), o preço deste produto passa a ser calculado sozinho e vai direto para o custo das rações.</p></section>`;
  return `<section class="panel"><h2>Preço médio (automático)</h2>
    <div class="stat gStat3">${st('Preço médio hoje',rs(p,2)+'/t')}${st('Por kg',rs(p/1000,4))}${st('Última entrada',`${rs(H[H.length-1].pNota,2)}/t`)}</div>
    <p class="note">Calculado pelas entradas do Estoque. Vale qualquer entrada com valor (manual ou pela NF). <b>Estoque zerado</b> e entra produto: o preço passa a ser o dessa entrada. <b>Ainda tem estoque</b>: média ponderada (o que tem no estoque pelo preço médio + a entrada nova). Entrada sem valor só soma no estoque e não muda o preço. Vai sozinho para o custo das rações; não precisa mexer aqui.</p>
    <div class="tablebox"><table class="gTab"><thead><tr><th>Dia</th><th>Entrada</th><th>Estoque antes</th><th>Preço médio</th></tr></thead><tbody>
    ${H.slice().reverse().map(x=>`<tr><td class="hora">${dB(x.desde).slice(0,5)}</td><td class="c">${nf(x.kg)} kg · ${rs(x.nota)}<small>${rs(x.pNota,2)}/t${x.obs?' · '+esc(x.obs):''}${x.varias?' · mais de uma entrada no dia':''}</small></td><td>${x.q>0?nf(x.q)+' kg'+(ok(x.ant)?`<small>${rs(x.ant,2)}/t</small>`:''):'zerado'}</td><td><b>${rs(x.rs,2)}</b>/t</td></tr>`).join('')}</tbody></table></div></section>`;}
function salvaIns(id){const nome=fv('nome'),ms=Math.round(fn('ms')*10)/10,preco=fn('preco'),desde=fv('desde')||hojeKey();
  if(!nome)return toast('Coloque o nome');if(!(ms>0&&ms<=100))return toast('Matéria seca entre 1 e 100%');const temPM=!!(id&&precoMedioHist(id).length);if(!temPM&&!(preco>=0))return toast('Coloque o preço por tonelada');
  const i=id?JSON.parse(JSON.stringify(G.it[id])):{uid:novoId('ins'),tipo:'insumo',precos:[]};
  i.nome=nome;i.ms=ms;i.obs=(fv('obs')||'').trim();{const em=fn('estMin');if(em>0)i.estMin=em;else delete i.estMin;}if(fv('fixo')==='1')i.fixo=true;else delete i.fixo;if(!temPM){const v=vig(i.precos,desde);if(!v||+v.rs!==preco)setHist(i.precos,desde,{rs:preco});}
  gPut(i);toast('Insumo salvo');gVoltar();}

/* ---------- configurações ---------- */
/* Config. da Gestão separado em botões: Custo · Notas · Raça · Tratos · Balança */
const gCfgGrpAb=new Set(),CFG_ICO={confbal:'📊',rels:'📤',custo:'💲',venda:'🏷',notas:'📝',raca:'🐂',tratos:'🌾',balanca:'⚖️',senha:'🔑',backup:'💾'};
/* ordem e cor dos quadrados: pelo tipo do menu */
const CFG_TILES=['notas','tratos','balanca','custo','venda','raca','rels','senha','backup','confbal'];
const CFG_TIPO={notas:['Tratos','#4f9a52'],tratos:['Tratos','#3d8442'],balanca:['Tratos','#2e7d32'],custo:['Gestão','#b8860b'],venda:['Gestão','#946a0c'],raca:['Gestão','#8a6a4a'],rels:['Relatórios','#3f80c4'],confbal:['Relatórios','#2c6aa8'],senha:['Sistema','#5f6b73'],backup:['Sistema','#455a64']};
const CFG_ABAS=[['custo','Custo'],['venda','Venda'],['notas','Leitura de cocho'],['raca','Animais'],['tratos','Tratos'],['balanca','Balança'],['senha','Senha'],['rels','Relatórios'],['backup','Backup'],['confbal','Conf. balança']];
function tCfg(){const c=gCfg(),hj=hojeKey(),tx=vig(c.taxa,hj),ab=GT.cab||'custo';
  if(!GT.racasEd)GT.racasEd=c.racas.slice().sort(alfa);if(!GT.sexosEd)GT.sexosEd=c.sexos.map(x=>Object.assign({},x));if(!GT.catsEd)GT.catsEd=c.cats.slice();
  if(!GT.notasEd)GT.notasEd=c.notas.slice().sort((a,b)=>a.n-b.n).map(x=>Object.assign({},x));
  const salvar='<button class="primary" data-g="salvaCfg">Salvar</button>';
  let tudo='';for(const [ab,titAba] of CFG_ABAS){if(ab!==GT.cfgSel)continue;let h='';
  if(ab==='custo')h=`<section class="panel gCfgP"><h2>Custo operacional</h2><div class="gForm">${[
    {k:'taxa',l:'Taxa operacional',suf:'por cabeça por dia',t:'rs',v:tx?tx.rs:'',meia:1},{k:'tdesde',l:'Vale a partir de',t:'dia',v:tx?hj:'2000-01-01',meia:1}].map(campo).join('')}</div>
    ${(c.taxa||[]).length?`<p class="note">${c.taxa.map(x=>`Desde ${dB(x.desde)}: ${rs(+x.rs)}`).join(' · ')}</p>`:''}${salvar}</section>`;
  if(ab==='venda')h=tEstVenda();
  if(ab==='notas')h=`<section class="panel gCfgP"><h2>Notas da leitura de cocho</h2>
    <div class="gNotaCfg gNotaCab"><span>Nota</span><span>Descrição</span><span>Ajuste %</span><span></span></div>
    ${GT.notasEd.map((x,k)=>`<div class="gNotaCfg"><input class="cell num" inputmode="text" data-nn="${k}" value="${esc(vIn(x.n))}"><input type="text" data-nt="${k}" value="${esc(x.t)}"><input class="cell num" inputmode="text" data-np="${k}" value="${esc(vIn(x.p))}"><button class="mini danger" data-g="notaRm" data-i="${k}">✕</button></div>`).join('')}
    <div class="row"><button data-g="notaAdd">+ Adicionar nota</button><button data-g="notaPadrao">Voltar ao padrão (−4 a +4)</button></div>
    <p class="note">Nota positiva aumenta o trato, negativa diminui. O ajuste é em cima do realizado do dia anterior. Use o sinal de menos (−) para diminuir.</p>
    <div class="gForm">${campo({k:'pvIni',l:'Consumo inicial sugerido',suf:'% do PV em MS',t:'num',v:c.pvIni,meia:1,ajuda:'Usado na leitura de cocho quando o curral ainda não tem trato.'})}</div>${salvar}</section>`;
  if(ab==='raca')h=`<section class="panel gCfgP"><h2>Sexos</h2>
    <div class="gEdLista">${GT.sexosEd.map((r,k)=>`<div><span>${esc(r.n)}</span><button class="mini" data-g="sexoEd" data-i="${k}">✎ Editar</button><button class="mini danger" data-g="sexoRm" data-i="${k}">✕ Excluir</button></div>`).join('')}</div>
    <div class="gRacaAdd"><input type="text" id="gNovoSexo" placeholder="Novo sexo" autocomplete="off"><button class="lima" data-g="sexoAdd">+ Incluir</button></div>
    <p class="note">Aparecem no lote (novo lote e entrada de animais), nos relatórios e nas listas. Depois de mexer, toque em Salvar.</p></section>
  <section class="panel gCfgP"><h2>Raças</h2>
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
    ${(()=>{const ina=TC.find(t=>!t.ativo);return ina?`<button class="lima" data-g="trAdd">+ Novo trato (Trato ${ina.k})</button>`:TC.length<tratosApi.MAXT?`<button class="lima" data-g="trAdd">+ Novo trato (Trato ${TC.length+1})</button>`:'';})()}</section>
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
  if(ab==='confbal')h=tRels(GT);
  if(ab==='senha'){const tu=c.senhaTurno===true;
    h=`<section class="panel gCfgP"><h2>Senha para entrar</h2>
    <div class="linhas gFiltro"><button data-g="senhaTurno" data-v="0" class="${tu?'':'sel'}">Pedir sempre</button><button data-g="senhaTurno" data-v="1" class="${tu?'sel':''}">1 vez de manhã e 1 vez à tarde</button></div>
    <p class="note"><b>1 vez de manhã e 1 vez à tarde:</b> em cada celular, a senha é pedida na primeira entrada da manhã (até 11:59) e na primeira entrada depois do meio-dia. Nas outras vezes do mesmo turno, entra direto. Vale para cada botão da tela inicial (Tratos, Visualizar, Relatórios do dia e Gestão), cada um com a sua senha. Um celular que ainda não colocou a senha naquele turno não entra.<br>Editar e apagar registros e carregamentos continuam pedindo a senha de alterar e excluir toda vez.</p></section>
    ${modoVer?'':`<section class="panel gCfgP gMinzSim"><h2>🔑 Alterar senhas</h2>
    <p class="note">Só números, de 4 a 8. Quem está aqui nas configurações pode cadastrar, alterar ou tirar. <b>Sem senha</b> = entra ou altera direto, sem pedir.</p>
    ${SEN_TIPOS.map(([k,t,aj])=>{const v=senhaDe(k),ed=GT.snEd===k,ver=GT.snVer===k;
      return `<div class="gSenLin"><div><b>${t}</b><small>${aj}</small><span class="pill${v?' done':''}">${v?(ver?esc(v):'●'.repeat(v.length))+' · cadastrada':'sem senha'}</span></div>
      ${ed?`<div class="gSenIn"><input type="password" id="gSenNova" inputmode="numeric" maxlength="8" autocomplete="new-password" placeholder="Nova senha"><input type="password" id="gSenConf" inputmode="numeric" maxlength="8" autocomplete="new-password" placeholder="Repita"></div>
        <div class="gSenBts"><button class="primary" data-g="senSalva" data-k="${k}">Salvar senha</button><button class="danger" data-g="senCanc">✕ Cancelar</button></div>`
      :`<div class="gSenBts"><button class="lima" data-g="senEd" data-k="${k}">✎ ${v?'Alterar':'Cadastrar'}</button>${v?`<button data-g="senVer" data-k="${k}">${ver?'🙈 Esconder':'👁 Mostrar'}</button><button class="danger" data-g="senTira" data-k="${k}">✕ Tirar senha</button>`:''}</div>`}</div>`;}).join('')}</section>`}`;}
  if(ab==='rels'){const sel=relDiaSel();
    h=`<section class="panel gCfgP"><h2>Relatórios do dia</h2>
    <div class="gRelFmt"><b>Enviar em:</b>${[['pdf','📄 PDF'],['img','🖼 Foto'],['xls','📊 Excel']].map(([v,t])=>`<button type="button" class="${relDiaFmt()===v?'sel':''}" data-g="relDiaFmt" data-v="${v}">${t}</button>`).join('')}</div>
    <p class="note">Marque os relatórios que vão no botão <b>📤 Relatórios do dia</b> da tela inicial. Ao tocar no botão (com o dia finalizado), o app gera os relatórios marcados no formato escolhido acima e abre o compartilhar do celular para escolher o WhatsApp e a conversa ou o grupo. Salva sozinho ao marcar.</p>
    <div class="gRelLista">${REL_DIA.map(([k,t,d])=>`<label class="gRelIt"><input type="checkbox" data-reld="${k}"${sel.includes(k)?' checked':''}><span><b>${t}</b><small>${d}</small></span></label>`).join('')}</div></section>`;}
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
  if(ab===GT.cfgSel)tudo+=h;}
  /* quadrados por tipo (Tratos · Gestão · Relatórios · Sistema); tocou num, abre só ele */
  const sel=CFG_ABAS.find(o=>o[0]===GT.cfgSel);
  if(!sel)return `<div class="gCfgTit">⚙ Configurações</div><div class="gCfgTiles">${CFG_TILES.map(k=>{const [,t]=CFG_ABAS.find(o=>o[0]===k),[g,cor]=CFG_TIPO[k];
    return `<button type="button" data-g="cfgSel" data-k="${k}" style="--c:${cor}"><small>${g}</small><span class="gIc">${CFG_ICO[k]||''}</span><span>${k==='senha'?'Senhas':t}</span></button>`;}).join('')}</div>`;
  return `<button type="button" class="gCfgVolta" data-g="cfgSel" data-k=""><span>◀ Configurações</span><span>${CFG_ICO[sel[0]]||''} ${sel[0]==='senha'?'Senhas':sel[1]}</span></button>`+tudo;}
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
    <div class="stat gStat3">${st('Carregamentos a criar',nf(lista.length))}${st('Total (kg)',nf(tot))}${st('Carregamentos atuais (serão apagados)',nf(C.length))}</div>
    ${Object.keys(ins).length?`<div class="tablebox"><table class="gTab"><thead><tr><th>Produto</th><th>kg</th></tr></thead><tbody>${Object.entries(ins).sort((a,b)=>b[1]-a[1]).map(([n,k])=>`<tr><td class="c">${esc(n)}</td><td>${nf(k)}</td></tr>`).join('')}</tbody></table></div>`:''}
    ${semRac.size?`<p class="aviso warn">${nf(semRac.size)} trato(s) de curral sem lote/ração cadastrado no dia ficaram de fora.</p>`:''}${semF?`<p class="aviso warn">${semF} sem fórmula da ração no dia.</p>`:''}
    ${lista.length?`<button class="lima" data-g="retroGera">✓ Apagar os ${nf(C.length)} carregamentos atuais e lançar ${nf(lista.length)} carregamentos (1 por dia por ração)</button>`:'<p class="note">Nada para lançar.</p>'}`;}
async function retroGera(){if(!RETRO||!RETRO.length)return;
  const C=gTodos('carga').filter(c=>!c.retro),R0=gTodos('carga').filter(c=>c.retro);
  if(!await confirmaVermelho(`Apagar ${C.length} carregamentos e lançar ${RETRO.length}?`,'Os carregamentos lançados hoje e antes são trocados por um carregamento por dia por ração com o realizado dos tratos. Os apagados ficam guardados para o Desfazer.','Sim, continuar','Não'))return;
  const ant=(G.it['retro-apagadas']&&!G.it['retro-apagadas'].del&&G.it['retro-apagadas'].itens)||[];
  gPut({uid:'retro-apagadas',tipo:'retroBk',ts:Date.now(),itens:ant.concat(C.map(c=>JSON.parse(JSON.stringify(c))))});
  C.forEach(c=>gDel(c.uid));R0.forEach(c=>gDel(c.uid));
  RETRO.forEach(({g,r,itens},k)=>{const ts0=(isFinite(g.ts)?g.ts:Date.parse(g.dia+'T06:00:00'))-30*60000;
    const trs=[...g.trs].sort((a,b)=>a-b);
    gPut({uid:'carga-retro-'+g.dia+'-'+g.rac+'-'+(g.loc||'x'),tipo:'carga',dia:g.dia,local:g.loc,avulso:false,trato:trs[0],tratos:trs,racao:g.rac,racNome:r.nome,total:itens.reduce((a,i)=>a+i.prev,0),ts0,
      hora:new Date(ts0).toTimeString().slice(0,5),itens,origem:'retroativa',retro:true});});
  toast(`${RETRO.length} carregamentos retroativos lançados`);RETRO=null;gRender();}
async function retroApaga(){const L=gTodos('carga').filter(c=>c.retro);if(!L.length)return;const bk=G.it['retro-apagadas'],V=bk&&!bk.del&&bk.itens||[];
  if(!await confirmaVermelho(`Desfazer?`,`Apaga os ${L.length} carregamentos retroativos e devolve os ${V.length} carregamentos que estavam antes.`,'Sim, desfazer','Não'))return;
  L.forEach(c=>gDel(c.uid));V.forEach(c=>{const x=Object.assign({},c);delete x.del;gPut(x);});if(bk)gDel(bk.uid);toast('Pronto: carregamentos de antes devolvidos');gRender();}
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
  c.racas=(GT.racasEd||c.racas).slice();GT.racasEd=null;if(GT.sexosEd&&GT.sexosEd.length)c.sexos=GT.sexosEd.map(x=>({c:x.c,n:x.n}));GT.sexosEd=null;c.cats=(GT.catsEd||c.cats).slice();GT.catsEd=null;c.notas=ns.map(x=>({n:x.n,t:x.t||(x.p>0?'Aumentar':x.p<0?'Diminuir':'Manter'),p:x.p})).sort((a,b)=>a.n-b.n);c.notasV=NOTAS_VER;
  const a=fn('arred'),rc=fn('rc'),pv=fn('pvIni');if(ok(a)&&a>=0)c.arred=a;if(rc>0)c.rc=rc;if(pv>0)c.pvIni=pv;
  const rR=GT.renR||{},rC=GT.renC||{};GT.renR=null;GT.renC=null;
  gTodos('lote').forEach(l=>{let mud=false;const x=JSON.parse(JSON.stringify(l));if(rR[x.raca]){x.raca=rR[x.raca];mud=true;}const cn=catNorm(x.cat);if(rC[cn]){x.cat=rC[cn];mud=true;}if(mud)gPut(x);});
  gPut(c);GT.notasEd=null;toast('Configurações salvas');gRender();}

/* =====================================================================================
   EVENTOS
   ===================================================================================== */
const SO_VER=new Set(['cfgSel','relExp','relSel','relVer','relModo','relAtalho','estFilP','estFilLimpa','estIrRel','estVerMov','fornec','pgN','pgP','cfgGrp','perP','cfgAbaP','estInsExp','cbExp','cbRes','cbN','cbSal','cbPer','grafLocP','grafN','cmpModo','lotLocP','hNav','entPer','saiPer','loteTog','lotTodos','curGrp','coLocP','fzLocP','fzFotoVer','fzHN','fzHPdf','fzHImg','resPdf','resImg','resXls','insPdf','insImg','insXls','estPdf','estImg','estXls','estPerE','estOrd','nfVer','fzPdf','fzImgG','fzCur','fzLoc','fzImg','fzXls','fzXlsHist','cfgAba','coLoc','coAbre','coFecha','estPer','evLoc','evolN','imgDia','imgPer','imgComp','imgLote','pdfLote','imgVendas','pdfVendas','xlsVendas','pdfComp','xlsGraf','pdfGraf','racaAdd','racaRm','grafLoc','grafCur','celGraf','imgGraf','filtroLoc','dataPasso','dataHoje','voltar','ir','lote','raiz','compRel','compDia','xlsDia','xlsPer','xlsComp','xlsLote','perAtalho','nota','racAdd','racRm','notaAdd','notaRm','notaPadrao']);
/* ---------- apagar: sempre com senha (1010) e só o que ainda não foi usado ---------- */
const H_=()=>typeof HIST!=='undefined'?HIST:[];
function racUsoTxt(id){const r=G.it[id];if(!r)return '';const L=gTodos('lote').filter(l=>(l.rac||[]).some(h=>h.r===id)),B=gTodos('carga').filter(c=>c.racao===id||(r.nome&&c.racNome===r.nome));
  return L.length||B.length?[L.length?'lotes: '+L.map(l=>l.nome).slice(0,4).join(', '):'',B.length?B.length+' carregamento(s)':''].filter(Boolean).join(' · '):'';}
function insUsoTxt(id){const i=G.it[id];if(!i)return '';const R_=gTodos('racao').filter(r=>(r.versoes||[]).some(v=>(v.itens||[]).some(x=>x.ins===id))),M=gTodos('estmov').filter(m=>m.ins===id),
  B=gTodos('carga').filter(c=>(c.itens||[]).some(x=>Array.isArray(x)?x[0]===i.nome:(x.ins===id||x.nome===i.nome)));
  return [R_.length?'rações: '+R_.map(r=>r.nome).slice(0,4).join(', '):'',B.length?B.length+' carregamento(s)':'',M.length?M.length+' lançamento(s) de estoque':''].filter(Boolean).join(' · ');}
function curUsoTxt(n){const L=gTodos('lote').filter(l=>(l.curr||[]).some(h=>nAt(h.c)===n)),T=H_().filter(r=>nAt(r.curral)===n),Le=gTodos('leitura').filter(x=>nAt(x.curral)===n);
  return [L.length?'lotes: '+L.map(l=>l.nome).slice(0,4).join(', '):'',T.length?T.length+' trato(s)':'',Le.length?Le.length+' leitura(s)':''].filter(Boolean).join(' · ');}
window.curUsoTxt=curUsoTxt;
const APAGAR=new Set(['faltaExcl','apaga','apagaLote','apagaRac','apagaIns','apagaCpr','apagaCur','estRm','apagaCarga','fzApagar','fzFotoRm','catRm','racaRm','insPrecoRm']);
$('gBox').addEventListener('click',e=>{const b=e.target.closest('[data-g]');if(!b||!APAGAR.has(b.dataset.g)||b._senhaOk)return;
  e.stopImmediatePropagation();e.preventDefault();if(typeof bloqueado==='function'&&bloqueado())return;const a=b.dataset.g,id=b.dataset.id;
  if(a==='apagaRac'){const u=racUsoTxt(id);if(u)return toast(`Esta ração já foi usada (${u}): não pode apagar. Use “Inativar ração”.`);}
  if(a==='apagaIns'){const u=insUsoTxt(id);if(u)return toast(`Este insumo já foi usado (${u}): não pode apagar. Use “Inativar insumo”.`);}
  if(a==='apagaCur'){const u=curUsoTxt(id);if(u)return toast(`O ${id} já foi usado (${u}): não pode apagar. Use “Inativar curral”.`);}
  (window.pedirSenhaAcao?pedirSenhaAcao('Senha para apagar'):Promise.resolve(true)).then(ok=>{if(!ok)return;b._senhaOk=1;try{b.click();}finally{b._senhaOk=0;}});},true);
$('gBox').addEventListener('click',e=>{
  const b=e.target.closest('[data-g]');if(!b)return;const a=b.dataset.g,id=b.dataset.id;
  if(!SO_VER.has(a)&&bloqueado())return;
  if(a==='voltar')return gVoltar();
  if(a==='ir'){const t={t:b.dataset.t,id,o:b.dataset.o,enc:b.dataset.enc==='1'};if(b.dataset.mov)t.mov=b.dataset.mov;if(b.dataset.ins)t.ins=b.dataset.ins;if(b.dataset.sid)t.sid=b.dataset.sid;if(b.dataset.old)t.old=b.dataset.old;if(b.dataset.nome)t.nome=b.dataset.nome;if(b.dataset.dia){t.dia=b.dataset.dia;t.cbDia=b.dataset.dia;}if(b.dataset.ini){t.ini=b.dataset.ini;t.fim=b.dataset.fim;}
    if(GT.t==='lotes'&&t.t==='lotes'){GT=t;return gRender();}return gIr(t);}
  if(a==='lote')return gIr({t:'lote',id});
  if(a==='raiz')return gRaiz(b.dataset.t);
  if(a==='filtroLoc'){gLoc=b.dataset.l;return gRender();}
  if(a==='senEd'){GT.snEd=b.dataset.k;GT.snVer=null;gRender();setTimeout(()=>{const i=$('gSenNova');if(i)i.focus();},50);return;}
  if(a==='senCanc'){const n=$('gSenNova'),c_=$('gSenConf');const go=()=>{GT.snEd=null;gRender();};if((n&&n.value)||(c_&&c_.value)){(window.perg?perg('Cancelar a troca da senha?','A senha continua a mesma.','Sim, cancelar','Não'):Promise.resolve(true)).then(x=>{if(x)go();});return;}return go();}
  if(a==='senVer'){GT.snVer=GT.snVer===b.dataset.k?null:b.dataset.k;return gRender();}
  if(a==='senSalva'){const k=b.dataset.k,n=($('gSenNova').value||'').trim(),c_=($('gSenConf').value||'').trim();
    if(!/^\d{4,8}$/.test(n))return toast('A senha precisa ter de 4 a 8 números');if(n!==c_)return toast('As duas senhas não estão iguais');
    senhaGrava(k,n);GT.snEd=null;toast('Senha salva: '+SEN_TIPOS.find(x=>x[0]===k)[1]);return gRender();}
  if(a==='senTira'){const k=b.dataset.k,t=SEN_TIPOS.find(x=>x[0]===k)[1];
    (window.confirmaVermelho?confirmaVermelho(`Tirar a ${t.toLowerCase()}?`,k==='gest'?'Qualquer pessoa com o aplicativo vai poder entrar na Gestão e nas Configurações sem senha.':k==='trato'?'Qualquer pessoa vai poder entrar nos Tratos sem senha.':'Editar e apagar não vão mais pedir senha.','Sim, tirar','Não'):Promise.resolve(confirm('Tirar a senha?'))).then(x=>{if(!x)return;senhaGrava(k,'');toast('Senha tirada');gRender();});return;}
  if(a==='lotCurP'){const O=[['','']].concat([...document.querySelectorAll('select[data-lotcsel] option')].slice(1).map(o=>[o.value])),i=Math.max(0,O.findIndex(o=>o[0]===gLotCur)),j=Math.max(0,Math.min(O.length-1,i+(+b.dataset.n)));gLotCur=O[j][0];return gRender();}
  if(a==='lotLocP'){const L=['T','C','P'];let i=Math.max(0,L.indexOf(gLoc));gLoc=L[Math.max(0,Math.min(2,i+(+b.dataset.n)))];return gRender();}
  if(a==='loteTog'){const y=window.scrollY;gLotAb.has(id)?gLotAb.delete(id):gLotAb.add(id);gRender();window.scrollTo({top:y});return;}
  if(a==='lotTodos'){const y=window.scrollY;document.querySelectorAll('#gBox [data-g="loteTog"]').forEach(el=>b.dataset.v==='1'?gLotAb.add(el.dataset.id):gLotAb.delete(el.dataset.id));gRender();window.scrollTo({top:y});return;}
  if(a==='curGrp'){const y=window.scrollY,k=b.dataset.k;gCurAb.has(k)?gCurAb.delete(k):gCurAb.add(k);gRender();window.scrollTo({top:y});return;}
  if(a==='racaAdd'){lerNotasEd();const v=($('gNovaRaca').value||'').trim();if(!v)return toast('Digite o nome da raça');
    if(GT.racasEd.some(r=>alfa(r,v)===0))return toast('Essa raça já está na lista');GT.racasEd.push(v);GT.racasEd.sort(alfa);gRender();return toast('Incluída. Toque em Salvar configurações.');}
  if(a==='ntLoc'){GT.ntLoc=b.dataset.l;return gRender();}
  if(a==='coFecha'){if(GT.coAberto)delete GT.coAberto[b.dataset.c];if(GT.sel)delete GT.sel[b.dataset.c];const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='baseM'){const c=b.dataset.c,m=b.dataset.m;GT.base=GT.base||{};GT.base[c]=m==='dia'?{m:'dia',d:null}:{m};if(GT.sel&&GT.sel[c])delete GT.sel[c].kg;const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='coAbre'){GT.coAberto=GT.coAberto||{};GT.coAberto[b.dataset.c]=1;const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='cmpModo'){GT.cmp=b.dataset.o==='venda'?'venda':'';return gRender();}
  if(a==='grafN'){gGrafN=+b.dataset.n||10;return gRender();}
  if(a==='grafLocP'){const L=['T','C','P'];const i=Math.max(0,L.indexOf(gLocG||'T'));gLocG=L[Math.max(0,Math.min(2,i+(+b.dataset.n||0)))];return gRender();}
  if(a==='coLocP'){const L=['T','C','P'];let i=Math.max(0,L.indexOf(GT.coLoc||'T'));document.querySelectorAll('#gBox .gCocho').forEach(el=>{const x=el.querySelector('input[data-kg]'),c=el.dataset.c;if(x&&GT.sel&&GT.sel[c]&&x.value)GT.sel[c].kg=gNum(x.value);});GT.coLoc=L[Math.max(0,Math.min(2,i+(+b.dataset.n)))];return gRender();}
  if(a==='coLoc'){document.querySelectorAll('#gBox .gCocho').forEach(el=>{const i=el.querySelector('input[data-kg]'),c=el.dataset.c;if(i&&GT.sel&&GT.sel[c]&&i.value)GT.sel[c].kg=gNum(i.value);});GT.coLoc=b.dataset.l;return gRender();}
  if(a==='evLoc'){GT.evLoc=b.dataset.l;return gRender();}
  if(a==='ecTodos'){const rc=gNum(($('gEcRcT')||{}).value),pr=gNum(($('gEcPrT')||{}).value);if(!ok(rc)&&!ok(pr))return toast('Coloque o preço e/ou o rendimento da compra');
    document.querySelectorAll('#gBox [data-ecpr]').forEach(i=>{if(ok(pr))i.value=rsIn(pr);});document.querySelectorAll('#gBox [data-ecrc]').forEach(i=>{if(ok(rc))i.value=vIn(rc);});
    return toast('Compra aplicada em todos da lista. Toque em Salvar estimativas.');}
  if(a==='evTodos'){const rc=gNum(($('gEvRcT')||{}).value),pr=gNum(($('gEvPrT')||{}).value);if(!ok(rc)&&!ok(pr))return toast('Coloque o rendimento e/ou o preço para aplicar');
    document.querySelectorAll('#gBox [data-evrc]').forEach(i=>{if(ok(rc))i.value=vIn(rc);});document.querySelectorAll('#gBox [data-evpr]').forEach(i=>{if(ok(pr))i.value=rsIn(pr);});
    return toast('Aplicado em todos da lista. Toque em Salvar estimativas.');}
  if(a==='evSalvar'){const caro=[...document.querySelectorAll('#gBox [data-evpr],#gBox [data-ecpr]')].find(i=>gNum(i.value)>1000);if(caro){caro.focus();return toast(`Preço da @ muito alto (${caro.value}). Confira antes de salvar.`);}let n=0;document.querySelectorAll('#gBox [data-evrc]').forEach(i=>{const u=i.dataset.evrc,l=G.it[u];if(!l)return;
      const rc=gNum(i.value),pi=document.querySelector(`#gBox [data-evpr="${u}"]`),pr=pi?gNum(pi.value):NaN,nrc=ok(rc)&&rc>0?rc:null,npr=ok(pr)&&pr>0?pr:null;
      const q=k=>{const e=document.querySelector(`#gBox [data-${k}="${u}"]`);const v=e?gNum(e.value):NaN;return ok(v)&&v>0?v:null;},cpr=q('ecpr'),crc=q('ecrc'),e0=l.ent||{};
      const mudaC=l.compraGrupo!==false&&((+e0.preco||null)!==cpr||(+e0.rcC||50)!==(crc||50));
      if((l.rcPrev||null)!==nrc||(l.simPreco||null)!==npr||mudaC){const x=JSON.parse(JSON.stringify(l));x.rcPrev=nrc;x.simPreco=npr;
        if(mudaC){x.ent=x.ent||{};if((+e0.preco||null)!==cpr){x.ent.preco=cpr||0;x.ent.unid='arroba';}x.ent.rcC=crc||50;}gPut(x);n++;}});
    gRender();return toast(n?`Estimativa salva em ${n} lote(s)`:'Nada mudou');}
  if(a==='bkAgora'){if(!window.bkApi)return;Promise.resolve(bkApi.agora()).then(()=>setTimeout(()=>{gBkLista();},800));return;}
  if(a==='bkRest'){if(window.bkApi)bkApi.restaurar();return;}
  if(a==='trEd'||a==='trAt'||a==='trAdd'){const L=tratosCad().map(t=>Object.assign({},t)),k=+b.dataset.k,t=L.find(x=>x.k===k);
    if(a==='trAdd'){const ina=L.find(x=>!x.ativo);if(ina){ina.ativo=true;tratosApi.salvar(L);gRender();return toast(`Trato ${ina.k} ativo`);}   // usa o primeiro trato que está inativo (ex.: Trato 3)
      if(L.length>=tratosApi.MAXT)return toast('Máximo de '+tratosApi.MAXT+' tratos');L.push({k:L.length+1,nome:'',ativo:true});tratosApi.salvar(L);gRender();return toast(`Trato ${L.length} cadastrado e ativo`);}
    if(a==='trEd'){const v=prompt(`Nome do Trato ${k} (opcional, ex.: Manhã ou 7h). Deixe vazio para só "Trato ${k}":`,t.nome||'');if(v==null)return;t.nome=v.trim().slice(0,20);tratosApi.salvar(L);gRender();return toast('Trato salvo');}
    if(t.ativo&&L.filter(x=>x.ativo).length<=1)return toast('Precisa ficar pelo menos um trato ativo');
    t.ativo=!t.ativo;tratosApi.salvar(L);gRender();return toast(`Trato ${k} ${t.ativo?'ativado':'desativado'}. Confira a quantidade de tratos dos currais.`);}
  if(a==='sexoAdd'){lerNotasEd();const v=($('gNovoSexo').value||'').trim();if(!v)return toast('Digite o nome do sexo');
    if(GT.sexosEd.some(r=>alfa(r.n,v)===0||alfa(r.c,v)===0))return toast('Esse sexo já está na lista');GT.sexosEd.push({c:v,n:v});gRender();return toast('Incluído. Toque em Salvar configurações.');}
  if(a==='sexoEd'){lerNotasEd();const i=+b.dataset.i,x=GT.sexosEd[i];const v=(prompt('Novo nome:',x.n)||'').trim();if(!v||v===x.n)return;
    if(GT.sexosEd.some((r,k)=>k!==i&&alfa(r.n,v)===0))return toast('Esse nome já está na lista');x.n=v;gRender();return toast('Alterado. Toque em Salvar.');}
  if(a==='sexoRm'){const x=GT.sexosEd[+b.dataset.i];const n=gTodos('lote').filter(l=>sexoNorm(l.sexo)===x.c).length;
    if(n)return toast(`Não dá para excluir: ${n} lote(s) estão como ${x.n}. Mude o sexo desses lotes antes.`);
    if(!confirm(`Excluir o sexo ${x.n}?`))return;lerNotasEd();GT.sexosEd.splice(+b.dataset.i,1);gRender();return toast('Tirado. Toque em Salvar configurações.');}
  if(a==='catAdd'){lerNotasEd();const v=($('gNovaCat').value||'').trim();if(!v)return toast('Digite o nome da categoria');
    if(GT.catsEd.some(r=>alfa(r,v)===0))return toast('Essa categoria já está na lista');GT.catsEd.push(v);gRender();return toast('Incluída. Toque em Salvar configurações.');}
  if(a==='racaEd'||a==='catEd'){lerNotasEd();const arr=a==='racaEd'?GT.racasEd:GT.catsEd,i=+b.dataset.i,ant=arr[i];const v=(prompt('Novo nome:',ant)||'').trim();if(!v||v===ant)return;
    if(arr.some((r,k)=>k!==i&&alfa(r,v)===0))return toast('Esse nome já está na lista');arr[i]=v;const m=a==='racaEd'?(GT.renR=GT.renR||{}):(GT.renC=GT.renC||{});m[ant]=v;gRender();return toast('Alterado. Toque em Salvar.');}
  if(a==='catRm'){if(!confirm(`Excluir a categoria ${GT.catsEd[+b.dataset.i]}? Os lotes que já têm ela continuam com o nome.`))return;lerNotasEd();GT.catsEd.splice(+b.dataset.i,1);gRender();return toast('Tirada. Toque em Salvar configurações.');}
  if(a==='racaRm'){if(!confirm(`Excluir a raça ${GT.racasEd[+b.dataset.i]}? Os lotes que já têm ela continuam com o nome.`))return;lerNotasEd();GT.racasEd.splice(+b.dataset.i,1);gRender();return toast('Tirada. Toque em Salvar configurações.');}
  if(a==='grafLoc'){gLocG=b.dataset.l;return gRender();}
  if(a==='grafCur'){const c=b.dataset.c;if(gGrafOff.has(c))gGrafOff.delete(c);else gGrafOff.add(c);return gRender();}
  if(a==='imgLinIms')return imagemLinIms();if(a==='pdfLinIms')return imagemLinIms(true);if(a==='xlsLinIms')return xlsLinIms();
  if(a==='grafTodos'){if(b.dataset.v==='0')(GT.o==='ims'?dadosGrafIms:dadosGraf)(GT.dia||hojeKey()).todos.forEach(c=>gGrafOff.add(c));else gGrafOff.clear();return gRender();}
  if(a==='imgGraf')return GT.o==='ims'?imagemGrafIms():imagemGraf();
  if(a==='pdfGraf')return GT.o==='ims'?imagemGrafIms(true):imagemGraf(true);
  if(a==='celGraf'&&GT.o==='ims'){const c=b.dataset.c,d=b.dataset.d,kg=gIndice().get(d+'|'+c)||0,bi=kg?baseIms(c,d):0;return toast(kg?`${c} · ${dB(d).slice(0,5)}: ${nf(kg)} kg realizado · ${bi?pc(kg/bi,2)+' IMS':'sem peso'}`:`${c} · ${dB(d).slice(0,5)}: sem trato`);}
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
  if(a==='pdfLote')return imgLote(id,true);
  if(a==='xlsGraf')return GT.o==='ims'?xlsGrafIms():xlsGraf();
  if(a==='xlsPer')return xlsPer();
  if(a==='xlsComp')return xlsComp();
  if(a==='xlsLote')return xlsLote(id);
  if(a==='perAtalho'){const n=b.dataset.n,hj=hojeKey();if(n==='mes')return gRenderCom({ini:hj.slice(0,8)+'01',fim:hj});return gRenderCom({fim:hj,ini:somaDias(hj,-(+n-1))});}
  if(a==='notaAdd'){lerNotasEd();const mx=GT.notasEd.reduce((m,x)=>Math.max(m,ok(x.n)?x.n:0),0);GT.notasEd.push({n:mx+1,t:'Aumentar',p:0});return gRender();}
  if(a==='notaRm'){lerNotasEd();GT.notasEd.splice(+b.dataset.i,1);return gRender();}
  if(a==='notaPadrao'){GT.notasEd=NOTAS_PADRAO.map(x=>Object.assign({},x));gRender();return toast('Notas −4 a +4 de volta. Toque em Salvar.');}
  if(a==='entNova'){const v=$('gf_enLote')&&$('gf_enLote').value;if(!v)return toast('Escolha o lote que recebe os animais');if(v==='__novo')return gIr({t:'loteForm',raiz:'entradas'});return gIr({t:'entForm',id:v,raiz:'entradas'});}
  if(a==='entEd')return gIr({t:'entForm',id,eid:b.dataset.eid,raiz:'entradas'});
  if(a==='saiNova')return gIr({t:'saiSel',ft:b.dataset.t,o:b.dataset.o,nova:1,raiz:'saidas'});
  if(a==='raizLote')return gIr({t:b.dataset.t,lote:id});
  if(a==='pesNovaOk'){const v=$('gf_pnLote')&&$('gf_pnLote').value;if(!v)return toast('Escolha o lote');return gIr({t:'pesForm',id:v});}
  if(a==='entPer'||a==='saiPer'){GT.per=+b.dataset.n;return gRender();}
  if(a==='hLoc'){GT.fl=b.dataset.k;GT.fc='';return gRender();}
  if(a==='hNav'){const k=b.dataset.k,L=hOps(GT)[k],i=Math.max(0,L.findIndex(o=>o[0]===hVal(GT,k))),j=Math.max(0,Math.min(L.length-1,i+(+b.dataset.n)));hSet(k,L[j][0]);return gRender();}
  if(a==='novoLote')return gIr({t:'entNova',sel:'__novo',raiz:'lotes'});   /* mesma tela da Nova entrada, já em “Criar lote novo” */
  if(a==='salvaLote')return salvaLote(id);
  if(a==='salvaPes'){const dia=fv('dia'),peso=fn('peso');if(!dia||!(peso>0))return toast('Coloque a data e o peso');
    const lp=G.it[id],proj=pesoEm(lp,dia,pesagensDe(lp).filter(p=>p.dia<dia));
    gPut({uid:novoId('pes'),tipo:'pesagem',lote:id,dia,peso,proj:ok(proj)?Math.round(proj):null,cab:fn('cab')||null,obs:fv('obs')});toast('Pesagem salva');return gVoltar();}
  if(a==='salvaEntProp'){const l=G.it[id],d=fv('dia'),n=fn('cab');if(!d||!(n>0))return toast('Coloque a data e a quantidade');if(d<l.ent.dia)return toast('A data é antes da entrada do lote');if(d>hojeKey())return toast('A data não pode ser depois de hoje');
    const P=entPropCalc(l,d,n);if(!(P.tem>0))return toast('Nessa data o lote não tem animais');
    if(!confirm(`Entrada proporcional de ${nf(n)} animais no ${l.nome} em ${dB(d)}?\n\nPeso de entrada ${nf(P.pe,1)} kg · peso de hoje ${nf(P.pA,1)} kg · custo dos tratos ${rs(P.tr)} (${rs(P.porCab)} por cabeça).`))return;
    const o=fv('obs');gPut({uid:novoId('entl'),tipo:'entlote',lote:l.uid,dia:d,cab:n,peso:Math.round(P.pA*100)/100,pesoE:Math.round(P.pe*100)/100,diaE:l.ent.diaE||l.ent.dia,rs:Math.round(P.tr*100)/100,tc:true,prop:true,sexo:l.sexo||'',cat:l.cat||'',raca:l.raca||'',idade:l.idade||null,obs:`Entrada proporcional${o?' · '+o:''}`});
    recalcCurral(curralEm(l,d),d);{const k=recalcSaidas(l);toast(`+${nf(n)} animais no ${l.nome} (proporcional)`+(k?` · custos de ${k} saída(s) refeitos`:''));}return gVoltar();}
  if(a==='salvaEnt'){const l=G.it[id],dia=fv('dia'),cab=fn('cab');let peso=fn('peso');const pt=fn('pesoT');
    if(!(peso>0)&&pt>0&&cab>0)peso=Math.round(pt/cab*100)/100;
    if(!dia||!(cab>0))return toast('Coloque a data e a quantidade de animais');if(!(peso>0))return toast('Coloque o peso (individual ou total)');
    if(dia<l.ent.dia)return toast('A data é antes da entrada do lote');
    const sxE=fv('sexoE'),catE=fv('catE'),racaE=fv('racaE'),idE=fn('idadeE')||null;if(!sxE)return toast('Escolha o sexo dos animais');
    if(sexoNorm(l.sexo)&&sexoNorm(l.sexo)!==sxE)return toast(`Este lote é ${sexoTxt(l.sexo)}: animais de outro sexo entram em outro lote`);
    {const lx=JSON.parse(JSON.stringify(l));let m=false;if(!sexoNorm(lx.sexo)){lx.sexo=sxE;m=true;}if(!lx.cat&&catE){lx.cat=catE;m=true;}if(!lx.raca&&racaE){lx.raca=racaE;m=true;}if(!lx.idade&&idE){lx.idade=idE;m=true;}if(m)gPut(lx);}
    const prA=fn('prA')>0?fn('prA'):null,rcE=fn('rcE')>0&&fn('rcE')<100?fn('rcE'):50,vt=fn('rs')>0?fn('rs'):(prA?Math.round(cab*peso*rcE/100/15*prA*100)/100:0);
    if(!(vt>0)&&!confirm('Salvar a entrada sem o valor da compra? O custo desses animais fica fora do lote.'))return;
    const eOld=b.dataset.eid&&G.it[b.dataset.eid]?G.it[b.dataset.eid]:null;
    gPut(Object.assign({},eOld||{},{uid:eOld?eOld.uid:novoId('entl'),tipo:'entlote',lote:id,dia,cab,peso,rs:vt,preco:prA,rcC:rcE,obs:fv('obs'),sexo:sxE,cat:catE||'',raca:racaE||'',idade:idE}));recalcCurral(curralEm(l,dia),dia);if(eOld){recalcSaidas(l);toast('Entrada alterada');return gVoltar();}{const n=recalcSaidas(l);if(n)toast(`+${nf(cab)} animais · custos de ${n} saída(s) refeitos`);else toast(`+${nf(cab)} animais no ${l.nome}`);};return gVoltar();}
  if(a==='salvaSai'){const l=G.it[id],m=b.dataset.o==='morte',dia=fv('dia'),cab=fn('cab');
    if(!dia||!(cab>0))return toast('Coloque a data e a quantidade');if(dia<l.ent.dia)return toast('A data é antes da entrada do lote');
    const old=b.dataset.sid?G.it[b.dataset.sid]:null,tem=cabPres(l,dia,saidasDe(l).filter(x=>!old||x.uid!==old.uid)),cabF=!m&&!old?Math.max(0,fn('vfalta')||0):0;if(cab+cabF>tem)return toast(`Nessa data o lote tem ${nf(tem)} animais`+(cabF?' (vendidos + faltaram)':''));
    const s=old?Object.assign(JSON.parse(JSON.stringify(old)),{dia,cab,obs:fv('obs')}):{uid:novoId('sai'),tipo:'saida',mot:m?'morte':'venda',lote:id,dia,cab,obs:fv('obs')};if(m)s.causa=fv('causa');
    if(!m){s.peso=fn('peso');s.rc=fn('rc');s.pesoVT=fn('pesoVT')||null;s.carcT=fn('carcT')||null;s.carcM=fn('carcM')||null;if(!(s.carcT>0)&&s.carcM>0)s.carcT=Math.round(s.carcM*s.cab*100)/100;if(!(s.pesoVT>0)&&s.peso>0)s.pesoVT=Math.round(s.peso*s.cab*100)/100;if(s.pesoVT>0&&s.carcT>0)s.rc=Math.round(s.carcT/s.pesoVT*1000)/10;s.unid=fv('unid');s.preco=fn('preco');s.desc=fn('desc')||0;s.vTot=fn('vTot')||null;if(!(s.peso>0))return toast('Coloque o peso de saída');if(s.unid==='arroba'&&!(s.rc>0&&s.rc<100)&&!(s.carcT>0))return toast('Preço em R$/@ morto: coloque o rendimento de carcaça (ou o peso de carcaça)');if(!(s.rc>0&&s.rc<100))s.rc=50;   // vendeu em peso vivo / sem rendimento: considera 50%
      let cp=fv('comp');if(cp==='__novo'){const nm=(($('gf_cprNome')||{}).value||'').trim();if(!nm)return toast('Digite o nome do novo comprador');
        const ja=gTodos('comprador').find(c=>alfa(c.nome,nm)===0);if(ja)cp=ja.uid;else{cp=novoId('cpr');gPut({uid:cp,tipo:'comprador',nome:nm,cat:$('gf_cprCat').value});}}
      s.comp=cp||'';if(!(s.preco>0)&&!confirm('Salvar sem o preço de venda?'))return;}
    delete s.cr;
    if(cabF>0){const FC=faltaCalc(l,dia,tem,{falta:fv('vfalta'),fmodo:fv('vfmodo'),fpeso:fv('vfpeso'),fpesoT:fv('vfpesoT')},fn('peso')),base=tem*pesoEm(l,dia);gravarFalta(l,dia,cabF,FC.p,FC.fixo!=null?FC.fixo:(base>0?Math.min(1,FC.kg/base):0),fv('vfobs'),fv('vfmodo'));}
    {s.grp=fv('grp')&&fv('grp')!=='media'?fv('grp'):null;const T=saiCalc(l,dia,cab,m?null:s.peso,old?old.uid:null,s.grp);s.cst=T.cst;s.custo=m?Math.round(T.total*100)/100:custoSai(s);}   /* morte também leva o custo dela (compra pelo preço de entrada + trato até o dia): é prejuízo e não fica rateado nos outros */   /* guarda a compra (real ou prevista) e os custos desses animais: o resultado da venda fica registrado */
    gPut(s);toast(old?'Venda atualizada':m?'Morte lançada':'Saída lançada');return gVoltar();}
  if(a==='apAdd'){apLer();GT.g.push({nome:`${G.it[GT.id].nome} ${String.fromCharCode(65+GT.g.length)}`,cab:'',peso:'',c:'',r:(GT.g[0]||{}).r||''});return gRender();}
  if(a==='apRm'){apLer();GT.g.splice(+b.dataset.i,1);return gRender();}
  if(a==='salvaApart')return salvaApart(id);
  if(a==='apDesfaz')return desfazerApart(id);
  if(a==='salvaCpr'){const nm=fv('nome');if(!nm)return toast('Digite o nome');if(gTodos('comprador').some(c=>c.uid!==id&&alfa(c.nome,nm)===0))return toast('Já existe um comprador com esse nome');
    const c=id?JSON.parse(JSON.stringify(G.it[id])):{uid:novoId('cpr'),tipo:'comprador'};Object.assign(c,{nome:nm,cat:fv('cat'),cidade:fv('cidade'),obs:fv('obs')});gPut(c);toast('Comprador salvo');return gVoltar();}
  if(a==='apagaCpr'){const n=gTodos('saida').filter(s=>s.comp===id).length;if(!confirm(n?`Este comprador tem ${n} venda(s). Apagar mesmo assim? As vendas ficam sem comprador.`:'Apagar este comprador?'))return;gDel(id);toast('Apagado');return gRender();}
  if(a==='imgVendas')return imgVendas();
  if(a==='pdfVendas'){window.__expPdf=true;return imgVendas();}
  if(a==='pdfComp'){window.__expPdf=true;return imgComp();}
  if(a==='xlsVendas')return xlsVendas();
  if(a==='locP'){const L=['T','C','P'],i=Math.max(0,L.indexOf(b.dataset.v0)),v=L[Math.max(0,Math.min(2,i+(+b.dataset.n)))];(LOC_SET[b.dataset.a]||(()=>{}))(v);return gRender();}
  if(a==='rcLoc'){GT.loc=b.dataset.k;return gRender();}
  if(a==='rcMarca'){document.querySelectorAll('[data-rc]:not(:disabled)').forEach(x=>x.checked=b.dataset.v==='1');return rcMarcaBt();}
  if(a==='salvaRacCur'){const d=fv('rcDesde'),r=fv('rcRac'),cs=[...document.querySelectorAll('[data-rc]:checked')].map(x=>x.dataset.rc);
    if(!cs.length)return toast('Marque os currais');if(!d||!r)return toast('Escolha a data e a nova ração');
    let n=0;cs.forEach(c=>lotesNoCur(c,hojeKey()).forEach(l0=>{const l=JSON.parse(JSON.stringify(l0));if(d<l.ent.dia)return;l.rac=l.rac||[];setHist(l.rac,d,{r});gPut(l);n++;}));
    toast(`Ração mudada em ${cs.length} curral(is) · ${n} lote(s)`);return gVoltar();}
  if(a==='salvaMudCur'){const o=fv('mcO'),de=fv('mcD'),d=fv('mcDia');if(!o||!de||!d)return toast('Escolha a origem, o destino e a data');if(o===de)return toast('O destino é o mesmo curral');
    const todos=lotesNoCur(o,hojeKey());if(!todos.length)return toast('Nenhum lote nesse curral');
    const mk=[...document.querySelectorAll('[data-mclote]')];const ls=mk.length?todos.filter(l=>mk.some(c=>c.checked&&c.dataset.mclote===l.uid)):todos;if(!ls.length)return toast('Marque pelo menos um lote');const ant=ls.find(l=>d<l.ent.dia);if(ant)return toast(`A data é antes da entrada do ${ant.nome}`);
    const oc=lotesNoCur(de,d).filter(l=>!ls.includes(l));if(oc.length&&!confirm(`O ${de} já tem ${oc.map(l=>l.nome).join(' + ')}. Os lotes vão dividir o trato desse curral pelo peso vivo de cada lote. Mudar mesmo assim?`))return;
    const obs=(($('gf_mcObs')||{}).value||'').trim();
    ls.forEach(l0=>{const l=JSON.parse(JSON.stringify(l0));l.curr=l.curr||[];setHist(l.curr,d,Object.assign({c:de,de:o,ts:Date.now()},obs?{obs}:{}));gPut(l);});recalcCurral(de,d);recalcCurral(o,d);toast(`${ls.map(l=>l.nome).join(' + ')} → ${de}`);return gVoltar();}
  if(a==='salvaMud'){const l=JSON.parse(JSON.stringify(G.it[id])),c=b.dataset.o==='curr',d=fv('desde'),v=fv('val');if(!d||!v)return toast('Escolha a data e '+(c?'o curral':'a ração'));
    if(d<l.ent.dia)return toast('A data é antes da entrada do lote');
    if(c){l.curr=l.curr||[];setHist(l.curr,d,{c:v});}else{l.rac=l.rac||[];setHist(l.rac,d,{r:v});}gPut(l);toast('Salvo');return gVoltar();}
  if(a==='apaga'){const x=G.it[id];if(x&&x.mot==='falta'&&(x.achados||[]).length)return toast('Esses animais já foram achados e lançados em outro lote: apague a entrada deles lá antes');
    if(x&&x.mot==='transf'&&x.novoLote){const n=G.it[x.destino];if(n&&!n.del&&(saidasDe(n).length||pesagensDe(n).length||custosDe(n).length||entradasDe(n).length))return toast(`O lote ${n.nome} (criado nessa transferência) já tem lançamentos: apague-os antes`);
      if(!confirm(`Apagar esta transferência? O lote ${n?n.nome:''} criado nela também é apagado e os animais voltam.`))return;gDel(id);if(n&&!n.del)gDel(n.uid);toast('Apagado');return gRender();}
    if(!confirm(`Apagar esta ${b.dataset.o}?`))return;gDel(id);
    if(x&&x.tipo==='saida'&&x.mot==='transf'&&x.entl&&G.it[x.entl])gDel(x.entl);if(x&&x.tipo==='entlote'&&x.transf&&G.it[x.transf])gDel(x.transf);if(x&&x.tipo==='entlote'&&x.falta&&G.it[x.falta]){const f=JSON.parse(JSON.stringify(G.it[x.falta]));const i=(f.achados||[]).findIndex(y=>y.dest===x.lote&&y.dia===x.dia&&+y.cab===+x.cab);if(i>=0){f.achados.splice(i,1);gPut(f);}}   // transferência: apaga as duas pontas
    if(x&&x.tipo==='entlote'&&!x.transf&&G.it[x.lote])recalcSaidas(G.it[x.lote]);   /* entrada de animais apagada: refaz os custos das saídas */
    if(x&&x.tipo==='saida'&&x.mot==='transf'){[x.lote,x.destino].forEach(u=>{const L=G.it[u];if(L&&!L.del)recalcSaidas(L);});}   /* transferência apagada: refaz os custos das saídas dos dois lotes */
    toast('Apagado');return gRender();}
  if(a==='salvaTransf')return GT.old?salvaTransfEd(id):salvaTransf(id);
  if(a==='trCanc'){(async()=>{const sim=await confirmaVermelho('Deseja realmente cancelar esta transferência?','Nada do que foi preenchido será lançado.','Sim, cancelar transferência','Não, continuar');if(!sim)return;gVoltar();toast('Transferência cancelada: nada foi lançado');})();return;}
  if(a==='vendaCanc'){(async()=>{const sim=await confirmaVermelho('Deseja realmente cancelar esta venda?','Nada do que foi preenchido será lançado.','Sim, cancelar venda','Não, continuar');if(!sim)return;GT.f=null;gVoltar();toast('Venda cancelada: nada foi lançado');})();return;}
  if(a==='fcAdd'){fcLer();GT.f.tr.push({dest:'',cab:'',peso:'',pesoT:''});return gRender();}
  if(a==='fcRm'){fcLer();GT.f.tr.splice(+b.dataset.i,1);return gRender();}
  if(a==='salvaFecha')return salvaFecha(id);
  if(a==='libLeit')return libLeitura();
  if(a==='salvaAchou')return salvaAchou(id);
  if(a==='faltaExcl'){const f=G.it[id];if(!f)return;const p=faltaPend(f),o=G.it[f.lote];(async()=>{const ok_=await confirmaVermelho('Excluir os animais que faltaram?',`${nf(p)} cab do ${o?o.nome:'lote'} (faltaram em ${dB(f.dia)}) saem da lista de pendentes e não vão mais poder ser lançados como achados. O custo separado deles deixa de aparecer.`,'Sim, excluir','Não');
    if(!ok_)return;const x=JSON.parse(JSON.stringify(f));x.excl={cab:p,dia:hojeKey()};gPut(x);toast(`${nf(p)} cab excluídos dos pendentes`);gRender();})();return;}
  if(a==='apagaHist'){const l=JSON.parse(JSON.stringify(G.it[id])),arr=l[b.dataset.o];arr.splice(+b.dataset.i,1);gPut(l);return gRender();}
  if(a==='apagaLote'){const l=G.it[id];
    if(partesApart(l).length)return toast('Este lote foi apartado: use "Desfazer apartação" antes de apagar');
    if(l.apDe&&G.it[l.apDe]&&!G.it[l.apDe].del)return toast(`Este lote veio da apartação de ${G.it[l.apDe].nome}: desfaça a apartação lá`);
    if(!confirm(`⚠ APAGAR o lote ${l.nome}?\n\nSome o lote com entrada, pesagens, saídas e custos. Não dá para desfazer.\nSe os animais já saíram, o lote fica ARQUIVADO sozinho; não precisa apagar.`))return;
    const w=prompt('Para confirmar, escreva a palavra APAGAR:');if(w==null)return;if(w.trim().toUpperCase()!=='APAGAR')return toast('Não apagou: a palavra não confere');
    gTodos('pesagem').concat(gTodos('saida')).filter(x=>x.lote===id).forEach(x=>gDel(x.uid));gDel(id);toast('Lote apagado');if(GT.t!=='entradas'){GT={t:'lotes'};gPilha.length=1;}return gRender();}
  if(a==='compRel')return enviarTexto(textoRel());
  if(a==='compDia')return enviarTexto(textoDia());
  if(a==='baseDia'){GT.base=GT.base||{};GT.base[b.dataset.c]={m:'dia',d:b.dataset.d};if(GT.sel&&GT.sel[b.dataset.c])delete GT.sel[b.dataset.c].kg;const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='repDia'){const c=b.dataset.c,d=b.dataset.d,dia=GT.dia||hojeKey();if(leitTravada(dia,c))return;const ix=gIndice(),kgd=ix.get(d+'|'+c)||0;if(!kgd)return;
    /* mesma matéria seca daquele dia, convertida para a MS da ração de hoje */
    const fx=fatorMS(c,d,dia),kg=Math.round(kgd*(ok(fx)?fx:1)),card=b.closest('.gCocho'),base=card?+card.dataset.base:0,N=gCfg().notas;
    let best=null;if(base>0)N.forEach(o=>{const v=base*(1+o.p/100);if(!best||Math.abs(v-kg)<Math.abs(best.v-kg))best={n:o.n,v};});
    GT.sel=GT.sel||{};if(GT.sel[c]&&GT.sel[c].rep===d){delete GT.sel[c];}else GT.sel[c]={n:best?best.n:null,kg,ims:null,rep:d};
    const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='nota'){const c=b.dataset.c,n=+b.dataset.n;if(leitTravada(GT.dia||hojeKey(),c))return;GT.sel=GT.sel||{};GT.sel[c]=b.classList.contains('sel')?{n:null}:{n};const y=window.scrollY;gRender();window.scrollTo({top:y});return;}  // tocou de novo na mesma nota: desmarca
  if(a==='salvaCocho')return salvaCocho();
  if(a==='salvaCocho1')return salvaCocho(b.dataset.c);
  if(a==='cbExp')return confBatExp(b.dataset.o);
  if(a==='cbRes')return confResumoExp(b.dataset.o,GT.cbN||7);
  if(a==='cbN'){GT.cbN=+b.dataset.n||7;return gRenderManter?gRenderManter():gRender();}
  if(a==='cbSal'||a==='cbPer'){const hj=GT.cbDia||hojeKey(),ini=somaDias(hj,-((GT.cbN||7)-1));return a==='cbSal'?saltosPer(b.dataset.o,ini,hj):confBalPer(b.dataset.o,ini,hj);}
  if(a==='curAtiva'){const A=window.curraisApi,inf=A.info(id),novo=!inf.inativo;A.salvar(id,id,Object.assign({},inf,{inativo:novo}));toast(novo?`${id} inativo (pausado)`:`${id} ativo de novo`);if(typeof render==='function')try{render();}catch(e){}return gRender();}
  if(a==='apagaCur'){if(curUsoTxt(id))return toast('Este curral já foi usado: não pode apagar.');if(!confirm(`Deseja realmente apagar o curral ${id}?`))return;
    const r=window.curraisApi&&curraisApi.apagar?curraisApi.apagar(id):'';if(r)return toast(r);toast(`${id} apagado`);return gVoltar();}
  if(a==='racAdd'){lerItensRac();GT.itens.push({ins:'',pMS:''});const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='racUp'||a==='racDn'){lerItensRac();const k=+b.dataset.i,j=k+(a==='racUp'?-1:1);if(j>=0&&j<GT.itens.length){[GT.itens[k],GT.itens[j]]=[GT.itens[j],GT.itens[k]];}const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='racRm'){lerItensRac();GT.itens.splice(+b.dataset.i,1);if(!GT.itens.length)GT.itens.push({ins:'',pMS:''});const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='salvaRac')return salvaRac(id);
  if(a==='apagaRac'){const r=G.it[id];if(racUsoTxt(id))return toast('Esta ração já foi usada: não pode apagar.');if(!confirm(`Deseja realmente apagar a ração ${r.nome}?`))return;gDel(id);GT.itens=null;return gVoltar();}
  if(a==='salvaIns')return salvaIns(id);
  if(a==='salvaMS')return salvaMS();
  if(a==='msAbre'){GT.msAberto=true;return gRender();}
  if(a==='msCancela'){const nv=document.getElementById('gMsNova'),sl=document.getElementById('gMsIns'),mud=(nv&&nv.value.trim())||(sl&&sl.value);
    (mud&&window.perg?perg('Cancelar a alteração de matéria seca?','O que foi escolhido não vai ser salvo.','Sim, cancelar','Não, continuar',false):Promise.resolve(true)).then(v=>{if(!v)return;GT.msAberto=false;GT.ins='';gRender();});return;}
  if(a==='relExp')return relExpEnviar(b.dataset.o);
  if(a==='relSel'){GT.relSel=!GT.relSel;GT.relAb=null;return gRender();}
  if(a==='relModo'){GT.relModo=b.dataset.m==='per'?'per':'dia';GT.relAb=null;relVerCache={k:'',h:''};return gRender();}
  if(a==='relAtalho'){const hj=hojeKey(),n=b.dataset.n;GT.rFim=hj;GT.rIni=n==='mes'?hj.slice(0,8)+'01':somaDias(hj,-(+n-1));relVerCache={k:'',h:''};return gRender();}
  if(a==='relVer'){GT.relAb=GT.relAb===b.dataset.k?null:b.dataset.k;relVerCache={k:'',h:''};const k=GT.relAb;gRender();
    if(k){const el=document.querySelector(`.gRelVerBt[data-k="${k}"]`);if(el)window.scrollTo({top:Math.max(0,el.getBoundingClientRect().top+scrollY-90),behavior:'smooth'});}return;}
  if(a==='resPdf')return resPdf();
  if(a==='resImg')return resImg();
  if(a==='resXls')return resXls();
  if(a==='insPdf'||a==='insImg'||a==='insXls')return insExp(a==='insPdf'?'pdf':a==='insImg'?'img':'xls');
  if(a==='salvaEst')return salvaEst(b.dataset.id);
  if(a==='estRm'){const m=G.it[id];if(!m)return;if(!confirm(`Apagar este lançamento (${m.mov==='ent'?'entrada':m.mov==='inv'?'contagem':'saída'} de ${nf(+m.kg)} kg em ${dB(m.dia)})?`))return;gDel(id);toast('Lançamento apagado');return gRender();}
  if(a==='estPer'){GT.per=+b.dataset.p;return gRender();}
  if(a==='fornSalva')return fornSalvar();
  if(a==='fornExc'){const f=G.it[id];if(!f)return;if(fornEntradas(f.nome).length)return toast('Tem entradas com este fornecedor: não dá para excluir');
    (window.perg?perg(`Excluir o fornecedor ${f.nome}?`,'Ele sai da lista de fornecedores.','Sim, excluir','Não',false):Promise.resolve(confirm('Excluir?'))).then(v=>{if(!v)return;gDel(id);toast('Fornecedor excluído');gRender();});return;}
  if(a==='entRelExp')return entRelExp(b.dataset.o);
  if(a==='relDiaFmt'){const c=JSON.parse(JSON.stringify(gCfg()));c.relDiaFmt=b.dataset.v;gPut(c);toast('Relatórios do dia: '+({pdf:'PDF',img:'Foto',xls:'Excel'})[c.relDiaFmt]);return gRender();}
  if(a==='estFilLimpa'){GT.tipoE=GT.prodE=GT.fornE=GT.obsE='';GT.pgEP=1;return gRender();}
  if(a==='estIrRel'){gMinAb.add('estRel');gRender();const el=document.querySelector('.gEstRel');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});return;}
  if(a==='estVerMov'){gMinAb.add('estRel');gPilha.length=0;GT={t:'estoque',prodE:(G.it[id]&&G.it[id].nome)||'',tipoE:'',fornE:''};gRender();setTimeout(()=>{const el=document.querySelector('.gEstRel');if(el)el.scrollIntoView({block:'start'});},60);return;}
  if(a==='pgN'){const k=b.dataset.k;GT[k+'N']=+b.dataset.v;GT[k+'P']=1;return gRender();}
  if(a==='pgP'){if(b.disabled)return;const k=b.dataset.k,y=window.scrollY;GT[k+'P']=(GT[k+'P']||1)+(+b.dataset.n);gRender();window.scrollTo({top:y});return;}
  if(a==='perP'){GT.pgEP=GT.pgIP=1;const k=b.dataset.k,O=PER_OPS.map(o=>o[0]);let i=Math.max(0,O.indexOf(perNorm(GT[k]==null?30:GT[k])));GT[k]=O[Math.max(0,Math.min(O.length-1,i+(+b.dataset.n)))];return gRender();}
  if(a==='estPerE'){GT.perE=+b.dataset.p;return gRender();}
  if(a==='nfNova'){NF=null;NF_IMG=null;GT={t:'estNF'};gRender();window.scrollTo({top:0});return;}
  if(a==='nfOutra'){NF=null;NF_IMG=null;return gRender();}
  if(a==='nfSalva')return nfSalvar();
  if(a==='estCancela'){NF=null;NF_IMG=null;toast('Cancelado: nada foi lançado');return gVoltar();}
  if(a==='nfVer')return nfVer(b.dataset.id,b.dataset.mini);
  if(a==='estOrd'){GT.ordE=b.dataset.o;return gRender();}
  if(a==='estMinSalva'){const x=JSON.parse(JSON.stringify(G.it[id])),v=gNum(($('gEstMinIn').value||'').trim());if(v>0)x.estMin=v;else delete x.estMin;gPut(x);toast(v>0?`Estoque mínimo: ${nf(v)} kg`:'Estoque mínimo tirado');return gRender();}
  if(a==='estInsExp')return estInsExp(id,b.dataset.o);
  if(a==='estPdf'||a==='estImg'||a==='estXls')return estExp(a==='estPdf'?'pdf':a==='estImg'?'img':'xls');
  if(a==='insPrecoRm'){const i=JSON.parse(JSON.stringify(G.it[id]));i.precos=i.precos.filter(p=>p.desde!==b.dataset.d);gPut(i);return gRender();}
  if(a==='racAtiva'){const r=JSON.parse(JSON.stringify(G.it[id]));const usam=lotesAtivos().filter(l=>{const x=racaoEm(l,hojeKey());return x&&x.uid===id;}).length;
    if(!r.inativa&&usam&&!confirm(`${usam} lote(s) ainda usam esta ração. Inativar mesmo assim?`))return;r.inativa=!r.inativa;gPut(r);toast(r.inativa?'Ração inativada':'Ração reativada');return gRender();}
  if(a==='insAtiva'){const i=JSON.parse(JSON.stringify(G.it[id]));i.inativo=!i.inativo;gPut(i);toast(i.inativo?'Insumo inativado':'Insumo reativado');return gRender();}
  if(a==='apagaIns'){const i=G.it[id];if(insUsoTxt(id))return toast('Este insumo já foi usado: não pode apagar.');if(!confirm(`Deseja realmente apagar o insumo ${i.nome}?`))return;gDel(id);return gVoltar();}
  if(a==='salvaCfg')return salvaCfg();
  if(a==='senhaTurno'){const c=JSON.parse(JSON.stringify(gCfg()));c.senhaTurno=b.dataset.v==='1';gPut(c);toast(c.senhaTurno?'Senha: 1 vez de manhã e 1 vez à tarde':'Senha: pedir sempre');return gRender();}
  if(a==='salvaDiv')return salvaDiv();
  if(a==='cfgSel'){lerNotasEd();GT.cfgSel=b.dataset.k||null;gRender();window.scrollTo({top:0});return;}
  if(a==='cfgGrp'){const k=b.dataset.k;gCfgGrpAb.has(k)?gCfgGrpAb.delete(k):gCfgGrpAb.add(k);b.parentNode.classList.toggle('aberto',gCfgGrpAb.has(k));return;}
  if(a==='cfgAba'){lerNotasEd();GT.cab=b.dataset.k;gRender();window.scrollTo({top:0});return;}
  if(a==='cfgAbaP'){lerNotasEd();const O=CFG_ABAS.map(o=>o[0]);let i=Math.max(0,O.indexOf(GT.cab||O[0]));GT.cab=O[Math.max(0,Math.min(O.length-1,i+(+b.dataset.n)))];gRender();return;}
  if(a==='retroCalc')return retroCalc();
  if(a==='retroGera')return retroGera();
  if(a==='retroApaga')return retroApaga();
});
['pointerdown','pointermove'].forEach(ev=>$('gBox').addEventListener(ev,e=>{const r=e.target.closest&&e.target.closest('.gEvHit');if(r)evolMostrar(+r.dataset.ev);}));
$('gBox').addEventListener('click',e=>{const i=e.target.closest('.gDataBox input');if(i&&i.showPicker){try{i.showPicker();}catch(_){}}});
$('gBox').addEventListener('change',e=>{const s_=e.target.closest('select[data-ntc]');if(!s_||!window.prevApi)return;if(typeof bloqueado==='function'&&bloqueado())return;
  const cu=s_.dataset.ntc,n=+s_.value;const t=window.mudarNTratos?mudarNTratos(cu,n,S.prev,hojeKey()):(prevApi.setNTratos(cu,n),prevApi.totalCurral(cu));if(t>0){if(!window.mudarNTratos)prevApi.distribuir(cu,t,n,S.prev);if(typeof marcarPrev==='function')marcarPrev();if(typeof render==='function')render();}toast(`${cu}: ${n} trato${n>1?'s':''}`);});
/* venda + sobra: médio ↔ total pela quantidade (vendidos, abatidos, outro lote e faltas); rendimento ↔ peso abatido */
/* campos de R$: ao tocar, seleciona o valor inteiro para o que for digitado substituir (digitar no fim de "R$ 370,00" virava milhões) */
document.addEventListener('focusin',e=>{const t=e.target;if(t&&t.matches&&t.matches('#gBox input.gRs')&&t.value){try{t.setSelectionRange(0,t.value.length);}catch(_){}}});
document.addEventListener('mouseup',e=>{const t=e.target;if(t&&t.matches&&t.matches('#gBox input.gRs')&&t.value&&t.selectionStart===t.selectionEnd&&t._selFeita!==true){t._selFeita=true;try{t.setSelectionRange(0,t.value.length);}catch(_){}}},true);
document.addEventListener('focusout',e=>{if(e.target)e.target._selFeita=false;});
function fcAuto(t){try{if(t.classList&&t.classList.contains('gRs'))mascaraRs(t);const q=s=>document.querySelector('#gBox '+s),g=s=>{const e=q(s);return e?gNum(e.value):NaN;},put=(s,v)=>{const e=q(s);if(e&&ok(v)&&v>0)e.value=vIn(Math.round(v*100)/100);};
  const fc=t.dataset.fc,ft=t.dataset.ft;
  if(ft){const [i,k]=ft.split('|'),c=g(`[data-ft="${i}|cab"]`);if(!(c>0))return;
    {const p=g(`[data-ft="${i}|peso"]`)>0?g(`[data-ft="${i}|peso"]`):g(`[data-ft="${i}|pesoT"]`)/c,ps=(s,v)=>{const e=q(s);if(e&&ok(v)&&v>0)e.value=rsIn(Math.round(v*100)/100);};   /* venda interna: @ viva ↔ valor total */
      const rcG=()=>{const r=g(`[data-ft="${i}|rc"]`),rv=g('[data-fc="rc"]');return r>0&&r<100?r:(rv>0&&rv<100?rv:50);},un=()=>{const e=q('[data-fc="unid"]');return e?e.value:'arroba';};
      if(k==='vi'){const um=viCalc(c,p,1,rcG(),un());if(um>0&&g(`[data-ft="${i}|vi"]`)>0)ps(`[data-ft="${i}|pr"]`,g(`[data-ft="${i}|vi"]`)/um);return;}
      if(k==='pr'){ps(`[data-ft="${i}|vi"]`,viCalc(c,p,g(`[data-ft="${i}|pr"]`),rcG(),un()));return;}
      setTimeout(()=>{const p2=g(`[data-ft="${i}|peso"]`);if(g(`[data-ft="${i}|pr"]`)>0)ps(`[data-ft="${i}|vi"]`,viCalc(c,p2,g(`[data-ft="${i}|pr"]`),rcG(),un()));},0);}
    if(k==='pesoT')put(`[data-ft="${i}|peso"]`,g(`[data-ft="${i}|pesoT"]`)/c);else if(k==='peso'||k==='cab')put(`[data-ft="${i}|pesoT"]`,c*g(`[data-ft="${i}|peso"]`));return;}
  if(!fc)return;
  if(['falta','fpeso','fpesoT'].includes(fc)){const c=g('[data-fc="falta"]');if(!(c>0))return;if(fc==='fpesoT')put('[data-fc="fpeso"]',g('[data-fc="fpesoT"]')/c);else put('[data-fc="fpesoT"]',c*g('[data-fc="fpeso"]'));return;}
  const M=Object.assign({},VENDA_K,{vt:'pesoT'}),R={};Object.keys(M).forEach(k=>R[M[k]]=k);if(!R[fc])return;
  vendaLiga(k=>q(`[data-fc="${M[k]}"]`),null,R[fc]);}catch(x){}}
/* transferir: peso médio ↔ total pela quantidade */
function trAuto(t){try{if(t.classList&&t.classList.contains('gRs'))mascaraRs(t);const id=t.id,c=fn('tCab'),put=(k,v)=>{const e=$('gf_'+k);if(e&&ok(v)&&v>0)e.value=vIn(Math.round(v*100)/100);};if(!(c>0))return;
  /* venda para o outro lote: mesmas contas da venda (peso vivo ↔ total, carcaça ↔ rendimento, @, preço ↔ valor total) */
  const M={cab:'tCab',vm:'tPeso',vt:'tPesoT',cm:'tCarcM',ct:'tCarcT',arr:'tArr',rc:'tRc',unid:'tUnid',preco:'tPr',vTot:'tVi'},R={};Object.keys(M).forEach(k=>R['gf_'+M[k]]=k);
  if(R[id])vendaLiga(k=>$('gf_'+M[k]),null,R[id]);}catch(e){}}
$('gBox').addEventListener('input',e=>{if(GT.t==='transfForm'){trAuto(e.target);trPrevia();}if(GT.t==='fechaForm'){fcAuto(e.target);fcLer();fcPrevia();}});
$('gBox').addEventListener('change',e=>{if(GT.t==='fechaForm'){fcLer();fcPrevia();}});
function hSet(k,v){if(k==='per')GT.per=+v;else if(k==='loc'){GT.fl=v;GT.fc='';}else GT.fc=v;}
$('gBox').addEventListener('change',e=>{if(e.target&&e.target.id==='gf_enTipo'){GT.enTipo=e.target.value;gRender();return;}});
$('gBox').addEventListener('input',e=>{if(e.target&&(e.target.id==='gf_cab'||e.target.id==='gf_dia')&&$('gEntProp'))entPropPrevia();});
document.addEventListener('change',e=>{if(e.target&&e.target.id==='gf_dia'&&$('gEntProp'))entPropPrevia();});
$('gBox').addEventListener('change',e=>{if(GT.nova&&e.target.id==='gf_saSel'){const v=e.target.value;GT={t:v?GT.ft:'saiSel',ft:GT.ft,o:GT.o,id:v||null,nova:1,raiz:'saidas'};gRender();return;}if(GT.t==='entNova'&&e.target.id==='gf_enSel'){GT.sel=e.target.value;GT.arq='';GT.id=null;gRender();}if(GT.t==='entNova'&&e.target.id==='gf_enArq'){GT.arq=e.target.value;GT.id=null;gRender();}});
$('gBox').addEventListener('change',e=>{const q=e.target.dataset&&e.target.dataset.hdt;if((GT.t==='entradas'||GT.t==='saidas')&&q&&e.target.value){if(q==='ini')GT.dIni=e.target.value;else GT.dFim=e.target.value;const y=window.scrollY;gRender();window.scrollTo({top:y});}});
$('gBox').addEventListener('change',e=>{const k=e.target.dataset&&e.target.dataset.hsel;if((GT.t==='entradas'||GT.t==='saidas')&&k){hSet(k,e.target.value);const y=window.scrollY;gRender();window.scrollTo({top:y});}});
$('gBox').addEventListener('change',e=>{if(GT.t==='transfForm')trPrevia();if(GT.t==='achouForm'&&e.target.id==='gf_aDest'&&$('gAchNovo'))$('gAchNovo').hidden=e.target.value!=='__novo';});
$('gBox').addEventListener('input',e=>{if(GT.t==='apartForm'&&e.target.matches&&(e.target.matches('[data-ap]')||/^gAp(falta|fpeso|fpesoT)$/.test(e.target.id))){apLer();apPrevia();}});
$('gBox').addEventListener('input',e=>{
  if(e.target.matches('[data-div]')){const n=e.target.dataset.div,v=[...document.querySelectorAll(`#gBox [data-div="${n}"]`)].map(i=>gNum(i.value)||0),t=v.reduce((a,b)=>a+b,0),el=document.querySelector(`#gBox [data-divsoma="${n}"]`);if(el){el.textContent=nf(t,1)+'%';el.classList.toggle('bad',Math.abs(t-100)>0.5);}}
  const t=e.target;
  if(t.classList.contains('gRs'))mascaraRs(t);
  if(GT.t==='racForm'&&(t.matches('[data-rp]')||t.id==='gVag'))calcRacao();
  if(GT.t==='rel'&&/^gf_s/.test(t.id))calcSimul();
  if(GT.t==='pesForm'&&(t.id==='gf_peso'||t.id==='gf_dia'))calcPes();
  if((GT.t==='entForm'||(GT.t==='entNova'&&GT.sel!=='__novo'&&GT.id))&&/^gf_(cab|peso|pesoT|dia|prA|rcE|rs)$/.test(t.id))calcEnt(t.id.slice(3));
  if((GT.t==='loteForm'||(GT.t==='entNova'&&GT.sel==='__novo'))&&/^gf_(cab|peso|pesoC|unid|preco|rcC|outros|vTotC)$/.test(t.id))lfCalc(t.id.slice(3));
  if(GT.t==='saiForm'&&/^gf_(cab|peso|pesoVT|carcT|carcM|arrT|rc|unid|preco|vTot|desc)$/.test(t.id))calcSai(t.id.slice(3));
  if(GT.t==='saiForm'&&GT.o!=='morte')vdPrevia();
});
/* leitura de cocho: % IMS digitado → calcula na hora o trato do dia (kg de matéria natural) e põe no campo kg */
/* kg digitado → mostra na hora o % de IMS (e vale como leitura mesmo sem nota) */
$('gBox').addEventListener('input',e=>{const t=e.target;if(!t.matches||!t.matches('input[data-kg]'))return;const c=t.dataset.kg,dia=GT.dia||hojeKey(),kg=gNum(t.value);GT.sel=GT.sel||{};
  const pi=t.closest('.gCoNovo')&&t.closest('.gCoNovo').querySelector('input[data-ims]'),lt=G.it[idLeit(dia,c)],n0=GT.sel[c]?GT.sel[c].n:(lt&&!lt.del?lt.nota:null);
  const q=kg>0&&window.gImsDe?gImsDe(c,dia,kg):null,qr=q?Math.round(q*100)/100:null;if(pi){pi.value=qr?nf(qr,2):'';pi.placeholder='%';}
  const nb=kg>0?notaPerto(t.closest('.gCocho'),kg):null;GT.sel[c]={n:nb!=null?nb:n0,ims:(nb!=null?nb:n0)==null?qr:null,kg:kg>0?kg:null};});
/* digitou o kg/dia ou o % IMS: marca sozinha a nota que dá o valor mais próximo (a partir da base do curral) */
function notaPerto(card,kg){if(!card||!(kg>0))return null;const base=+card.dataset.base;if(!(base>0))return null;let best=null;
  gCfg().notas.forEach(o=>{const v=base*(1+o.p/100);if(!best||Math.abs(v-kg)<Math.abs(best.v-kg))best={n:o.n,v};});
  card.querySelectorAll('.gNotas [data-g="nota"]').forEach(b=>b.classList.toggle('sel',best&&+b.dataset.n===best.n));
  card.querySelectorAll('.gU3.sel').forEach(b=>b.classList.remove('sel'));return best?best.n:null;}
$('gBox').addEventListener('input',e=>{const t=e.target;if(!t.matches||!t.matches('input[data-ims]'))return;const c=t.dataset.ims,p=gNum(t.value),dia=GT.dia||hojeKey();
  const card=t.closest('.gCocho'),kgI=card&&card.querySelector('input[data-kg]'),info=card&&card.querySelector('[data-imsinfo]');GT.sel=GT.sel||{};
  const lt=G.it[idLeit(dia,c)],n0=GT.sel[c]?GT.sel[c].n:(lt&&!lt.del?lt.nota:null);
  if(!(p>0)){GT.sel[c]={n:n0,ims:null};if(info)info.textContent='';return;}
  const kg=window.gMnIms?gMnIms(c,p,dia):null;if(kg==null){if(info)info.textContent='sem lote/ração';return;}
  const v=arred(kg,gCfg().arred);if(kgI)kgI.value=v;if(info)info.textContent='→ '+nf(v)+' kg';const nb=notaPerto(card,v);GT.sel[c]={n:nb!=null?nb:n0,ims:p,kg:v};});
$('gBox').addEventListener('change',e=>{
  const t=e.target;
  if(GT.t==='racForm'&&t.matches('[data-ri]'))calcRacao();
  if(t.id==='gf_emov'&&GT.t==='estForm'){const h=document.querySelector('#gBox section h2');if(h)h.textContent=(GT.id?'Editar ':'')+{ent:'Entrada no estoque',sai:'Saída manual do estoque',inv:'Contagem do estoque'}[t.value];}
  if(t.matches&&t.matches('select[data-cfgsel]')){lerNotasEd();GT.cab=t.value;return gRender();}
  if(t.matches&&t.matches('select[data-estf]')){GT[t.dataset.estf]=t.value;GT.pgEP=1;return gRender();}
  if(['gf_perF','gf_tipoF','gf_prodF','gf_fornF'].includes(t.id)){const k={gf_perF:'perE',gf_tipoF:'tipoE',gf_prodF:'prodE',gf_fornF:'fornE'}[t.id];const v=k==='perE'?+t.value:t.value.trim();if(GT[k]===v)return;GT[k]=v;GT.pgEP=1;gMinAb.add('estRel');return gRender();}
  if(t.id==='gf_grafLocF'){gLocG=t.value;return gRender();}
  if(t.matches&&t.matches('select[data-grafsel]')){gLocG=t.value;return gRender();}
  if(t.id==='gf_rForn'||t.id==='gf_rIns'){GT[t.id==='gf_rForn'?'rForn':'rIns']=t.value;GT.pgRP=1;return gRender();}
  if(t.matches&&t.matches('select[data-persel]')){GT.pgEP=GT.pgIP=GT.pgRP=1;GT[t.dataset.persel]=+t.value;return gRender();}
  if(t.matches&&t.matches('input[data-perd]')){if(t.value){GT[t.dataset.perd]=t.value;}return gRender();}
  if(t.matches&&t.matches('select[data-locsel]')&&LOC_SET[t.dataset.locsel]){LOC_SET[t.dataset.locsel](t.value);const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(t.matches&&t.matches('select[data-lotcsel]')){gLotCur=t.value;return gRender();}
  if(t.matches&&t.matches('select[data-lotlsel]')){gLoc=t.value;return gRender();}
  if(t.matches&&t.matches('select[data-colsel]')){document.querySelectorAll('#gBox .gCocho').forEach(el=>{const i=el.querySelector('input[data-kg]'),c=el.dataset.c;if(i&&GT.sel&&GT.sel[c]&&i.value)GT.sel[c].kg=gNum(i.value);});GT.coLoc=t.value;return gRender();}
  if(t.id==='gCbDia'){GT.cbDia=t.value||hojeKey();const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(t.id==='gCoDia'){GT.sel={};GT.base={};GT.dia=t.value||hojeKey();gRenderCom({dia:GT.dia});}
  if(t.id==='gDiaDia'){gRenderCom({dia:t.value||hojeKey()});}
  if(t.id==='gRelDia'){gRenderCom({dia:t.value||hojeKey()});}
  if(t.id==='gRelIni'||t.id==='gRelFim'){if(!t.value)return;GT[t.id==='gRelIni'?'rIni':'rFim']=t.value;relVerCache={k:'',h:''};return gRender();}
  if(t.id==='gResDia'){gRenderCom({dia:t.value||hojeKey()});}
  if(t.id==='gRefDia'||t.id==='gGrafDia'){gRenderCom({dia:t.value||hojeKey()});}
  if(GT.t==='apartForm'&&(t.matches('[data-ap]')||/^gAp/.test(t.id))){apLer();apPrevia();}
  if(t.id==='gf_comp'){const n=$('gCprNovo');if(n){n.hidden=t.value!=='__novo';if(!n.hidden)$('gf_cprNome').focus();}}
  if(['gVenIni','gVenFim','gVenCpr','gVenPor'].includes(t.id)){let a=$('gVenIni').value,b=$('gVenFim').value;if(a&&b&&a>b)[a,b]=[b,a];gRenderCom({ini:a,fim:b,cpr:$('gVenCpr').value,por:$('gVenPor').value});}
  if(t.id==='gPerIni'||t.id==='gPerFim'){let a=$('gPerIni').value,b=$('gPerFim').value;if(a&&b&&a>b)[a,b]=[b,a];gRenderCom({ini:a,fim:b});}
  const novaBase=(c,o)=>{GT.base=GT.base||{};GT.base[c]=o;if(GT.sel&&GT.sel[c])delete GT.sel[c].kg;setTimeout(gRender,0);};
  if(t.matches('select[data-bm]')){const c=t.dataset.bm,m=t.value;if(m==='ontem'){novaBase(c,{m:'ontem'});return;}
    novaBase(c,{m,d:m==='dia'?somaDias(GT.dia||hojeKey(),-2):null,kg:null});return;}
  if(t.matches('input[data-bd]')){const c=t.dataset.bd;novaBase(c,{m:'dia',d:t.value||null});return;}
  if(t.matches('input[data-bk]')){const c=t.dataset.bk;novaBase(c,{m:'kg',kg:gNum(t.value)});return;}
  if(t.matches('input[data-kg]')){const c=t.dataset.kg;GT.sel=GT.sel||{};const lt=G.it[idLeit(GT.dia,c)];
    const n=GT.sel[c]?GT.sel[c].n:(lt&&!lt.del?lt.nota:null),im=GT.sel[c]?GT.sel[c].ims:(lt&&!lt.del?lt.ims:null);if(t.value&&n==null&&!(im>0))toast('Sem lote/ração no curral para calcular o % de IMS — marque a nota');GT.sel[c]={n,ims:im,kg:gNum(t.value)};}
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
function cLimparSetup(){if(CG.ativa)return;const keep={ativa:null,verDia:CG.verDia};CG=Object.assign({},keep,{passo:1,local:null,rac:null,trato:null,tAuto:false,avulso:false,juntos:[],juntoAberto:false,total:0,totalDe:null,ordem:null,ja:{},sobModo:'rac',sobRac:null,sobKg:0,ordAberto:false,jaAberto:false,man:{},manAberto:false});try{localStorage.setItem(CK,JSON.stringify(CG));}catch(e){}}
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
/* previsto de cada trato da batida (o que ela vai levar), sem os currais desmarcados */
function cPrevTr(){const out={};if(CG.avulso||!CG.trato)return out;const ds=CG.desm||[];[+CG.trato].concat(CG.juntos||[]).forEach(k=>{const m=(S.prev||{})[String(k)]||{};out[k]=sugestaoCarga(k,CG.rac,CG.local).cs.filter(c=>!ds.includes(c)).reduce((a,c)=>a+(+m[c]||0),0);});return out;}
function hhmm(ts){return ts?new Date(+ts).toTimeString().slice(0,5):'';}
function sugestaoCarga(trato,racId,loc){const hj=hojeKey(),m=(S.prev||{})[String(trato)]||{},cs=[];let tot=0;
  gTodos('lote').filter(l=>cabPres(l,hj)>0).forEach(l=>{const r=racaoEm(l,hj),c=curralEm(l,hj);if(r&&r.uid===racId&&(!loc||linhaDe(c)===loc)&&(typeof curralAtivo!=='function'||curralAtivo(c))&&typeof m[c]==='number'&&m[c]>0&&!cs.includes(c)){cs.push(c);tot+=m[c];}});
  return {cs:cs.sort(alfa),tot};}
function itensCarga(racId,total){const r=G.it[racId];const cp=r&&!r.del?compRacao(r,hojeKey()):null;if(!cp)return [];
  let resto=Math.round(total);return ordenarRac(r,cp.itens,i=>i.ins?i.ins.uid:'').map((i,k,a)=>{const kg=k===a.length-1?resto:Math.round(total*i.pMN/100);resto-=kg;return {ins:i.ins?i.ins.uid:'',nome:i.nome,pMN:i.pMN,prev:kg,ini:null,fim:null,real:null};});}
const cAtiva=()=>CG.ativa||null;
/* a mesma batida aparece no Carregar manual (#cBox) e no Carregar da Automação (#acBox) */
const cAuto=()=>!!($('viewAutoC')&&!$('viewAutoC').hidden);
const cCaixa=()=>$(cAuto()?'acBox':'cBox');
/* tocou em Confinamento ou Pasto no Carregar: já traz o previsto da nuvem (leitura de cocho de outro aparelho).
   Total ainda igual ao sugerido: troca sozinho. Total mexido na mão: pergunta antes de trocar. */
async function cPrevAoEscolher(loc){if(typeof prevAtualizarAgora!=='function'||CG.ativa)return;
  const sug=()=>{const t=CG.total;let v=null;try{if(CG.trato&&!CG.avulso){cExpAplicar();v=+CG.total||0;}}catch(e){}CG.total=t;return v;};
  const sAntes=sug();const r=await prevAtualizarAgora();if(!r.mudou||CG.ativa||CG.local!==loc)return;
  const sNovo=sug(),tU=+CG.total||0;
  if(sNovo==null||sAntes==null||Math.round(sNovo)===Math.round(sAntes)){cRender();return toast('✓ Previsto atualizado pela leitura de cocho');}
  if(Math.round(tU)===Math.round(sAntes)){CG.total=sNovo;cSave();cRender();return toast(`✓ Previsto atualizado pela leitura de cocho: ${nf(sAntes)} → ${nf(sNovo)} kg`);}
  if(await confirmaVermelho('O previsto mudou',`A leitura de cocho mudou o previsto: era ${nf(sAntes)} kg, agora é ${nf(sNovo)} kg. O total que está na tela (${nf(tU)} kg) foi mudado na mão.`,`Usar o novo (${nf(sNovo)} kg)`,'Manter o que está',true)){if(CG.ativa)return;CG.total=sNovo;cSave();}cRender();}
function cRender(){const y0=window.scrollY;try{cRender0();}finally{if(Math.abs(window.scrollY-y0)>1)window.scrollTo(0,y0);}}  /* redesenha sem a tela pular */
function cRender0(){const auto=cAuto(),b=$(auto?'acBox':'cBox'),o=$(auto?'cBox':'acBox');if(!b)return;if(o)o.innerHTML='';
  /* outro aparelho com batida aberta: primeiro só ela + "Abrir novo carregamento"; ao abrir novo, recolhe numa faixa em cima */
  const rem=cAtiva()?'':cRemHTML(),remSo=!!rem&&!(window.REMNOVO&&REMNOVO.c);
  if(remSo){b.innerHTML=rem+'<button type="button" class="primary remNovoBt" data-remnovo="c">＋ Abrir novo carregamento</button>'+cBatidasHoje();return;}
  const faixa=rem?'<button type="button" class="remFaixa" data-remver="c">🔄 Carregamento em aberto em outro aparelho <b>ver ▼</b></button>':'';
  if(auto&&window.acTela){b.innerHTML=faixa+acTela(cAtiva()?null:cTelaNova(),cAtiva()?'':NOTA_BAT)+(cAtiva()?C_NOVA:'')+cBatidasHoje();if(window.acDepois)acDepois();return;}
  b.innerHTML=faixa+(cAtiva()?cTelaBatida()+C_NOVA:cTelaNova())+(cAtiva()?'':NOTA_BAT)+cBatidasHoje();}
const C_NOVA=''; /* sem "Abrir nova batida": abre uma, finaliza (ou cancela) e só então começa outra */
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
  return `<section class="panel contRem"><h2>🔄 Carregamento em aberto em outro aparelho</h2>${cRem.map(d=>{const B=d.bat,f=B.itens.filter(x=>ok(x.real)).length,kg=B.itens.reduce((a,x)=>a+(ok(x.real)?x.real:0),0),s=Math.round(d.idade/1000);
    return `<div class="contIt"><b>${B.avulso?'Avulso':'Trato '+esc((B.tratos||[B.trato]).join('+'))} · ${esc(B.racNome||'')}${B.local?' · '+(B.local==='C'?'Confinamento':'Pasto'):''}</b>
      <span>${f} de ${B.itens.length} produtos · ${nf(kg)} de ${nf(B.total)} kg · ${s<20?'🟢 aparelho ativo agora':'parou há '+(s<60?s+' s':Math.round(s/60)+' min')}</span>
      <button class="primary" data-c="contRem" data-ap="${esc(d.ap)}">▶ Continuar este carregamento</button></div>`;}).join('')}
    <p class="note">Continua do produto em que parou, com o peso inicial que já estava marcado. O outro aparelho fecha o carregamento dele.</p></section>`;}
function cContinuarRem(ap){const d=cRem.find(x=>x.ap===ap);if(!d)return;
  const go=()=>{const B=JSON.parse(JSON.stringify(d.bat));B.deAp=d.ap;B.contTs=Date.now();B.escolha=false;CG.ativa=B;CG.local=B.local||null;CG.trato=B.trato;CG.rac=B.rac;CG.total=B.total;cRem=[];
    try{window.diagLog&&diagLog('batida_continuada',{de:d.ap,trato:B.trato,feitos:B.itens.filter(x=>ok(x.real)).length});}catch(e){}
    cSave();if(typeof enviarAoVivo==='function')enviarAoVivo(true);cRender();window.scrollTo({top:0});
    const it=B.itens[B.atual];toast(`Continuando o carregamento · ${it?it.nome:''}${it&&ok(it.ini)?' · início '+nf(it.ini)+' kg':''}`);};
  confirmaVermelho('Deseja realmente continuar este carregamento?','O carregamento vai ser fechado no outro aparelho e continua aqui.'+(d.idade<20000?'\n⚠ O outro aparelho ainda parece ativo agora.':''),'Sim, continuar','Cancelar',true).then(v=>{if(v)go();});}
/* o aparelho original: se outro continuou a batida dele, fecha a dele */
async function cVerTomado(){try{const A=cAtiva();if(!A||modoVer||!navigator.onLine||!apiUrl())return;
  const j=await (await fetch(apiUrl()+'?acao=aovivo',{cache:'no-store'})).json();if(!j||!j.ok)return;
  const t=Object.entries(j.dados||{}).find(([ap,d])=>ap!==S.aparelho&&d&&d.deAp===S.aparelho&&d.bat&&d.bat.ts0===A.ts0&&(+d.contTs||0)>(A.contTs||0));
  if(!t||cAtiva()!==A)return;CG.ativa=null;cLimparSetup();cRender();
  try{window.diagLog&&diagLog('batida_tomada',{por:t[0],trato:A.trato});}catch(e){}
  toast('Este carregamento foi continuado em outro aparelho. Ele foi fechado aqui.');}catch(e){}}
setInterval(()=>{if(document.visibilityState==='visible')cVerTomado();},15000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(cVerTomado,1500);});
const NOTA_BAT='<p class="note" style="text-align:center">Os carregamentos feitos ficam em Previsto/Realizado › Carregamentos.</p>';
/* embaixo do Carregar: as batidas feitas hoje, produto por produto (igual os currais no Fornecer) */
function cBatidasHoje(){try{const B=window.batidasLista?batidasLista(hojeKey(),hojeKey(),'T',0):[];
  return `<section class="panel cBatHoje"><details class="cBatHojeD"${window.cBatHojeAb?' open':''} ontoggle="window.cBatHojeAb=this.open"><summary><h2>🚜 Carregamentos de hoje</h2><span class="note">${B.length?B.length+' carregamento(s)':''}</span><i class="hColSeta">▾</i></summary>${B.length?batidasHTML(B,false,true):'<p class="note">Nenhum carregamento concluído hoje ainda.</p>'}</details></section>`;}catch(e){return '';}}
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
function cTelaNova(){let h=cTelaNova0();if(CG.local&&!CG.ativa){const i=h.lastIndexOf('</section>');const bt='<button type="button" class="cCancelar" data-ccancel="1">✕ Cancelar carregamento</button>';h=i>=0?h.slice(0,i)+bt+h.slice(i):h+bt;}return h;}
function cTelaNova0(){if(!CG.passo){CG.passo=1;CG.local=null;}if(!CG.local)CG.passo=1;
  const ps=CG.passo,cont=n=>`<button type="button" class="lima cCont" data-cpasso="${n}">Continuar ▶</button>`;
  if(ps<=1||!CG.local)return `<section class="panel"><h2>Carregar vagão</h2><label>1. Local</label>${escolhaLocal('data-cloc',null)}<p class="note">Escolha o local para continuar.</p></section>`;
  const todas=racAtivas().sort(porNome);if(!todas.length)return `<section class="panel"><h2>Carregar vagão</h2><p class="note">Cadastre a ração primeiro em Gestão → Rações.</p></section>`;
  const doLocal=racoesDoLocal(CG.local),R=doLocal.length?doLocal:todas;
  if(CG.rac&&!R.some(r=>r.uid===CG.rac))CG.rac=null;if(!CG.rac&&R.length===1)CG.rac=R[0].uid;
  const passoRac=`<section class="panel"><h2>Carregar vagão</h2>
    <label>1. Local</label>${escolhaLocal('data-cloc',CG.local)}
    <div><label for="cRac">2. Ração</label><div class="racLin"><select id="cRac">${CG.rac?'':'<option value="" selected>Selecione</option>'}${R.map(r=>`<option value="${r.uid}"${r.uid===CG.rac?' selected':''}>${esc(r.nome)}</option>`).join('')}</select>
      ${doLocal.length===1?`<p class="note">Única ração ativa no ${NOMELOC[CG.local].toLowerCase()}: já selecionada.</p>`:!doLocal.length?`<p class="note">Nenhum lote com ração no ${NOMELOC[CG.local].toLowerCase()}: mostrando todas.</p>`:''}</div></div>`;
  if(!CG.rac)return passoRac+'</section>';
  const trC=tratosAtivos().filter(k=>sugestaoCarga(k,CG.rac,CG.local).tot>0);
  /* já vem escolhido o próximo trato a fazer (o 1º com currais pendentes); a pessoa pode voltar pela setinha */
  if(!CG.avulso&&typeof fornPendentes==='function'){const pend=k=>fornPendentes(CG.local,CG.rac,k).length,prox=trC.find(k=>pend(k));
    if(!CG.trato||(CG.tAuto&&prox&&+CG.trato!==prox&&!pend(+CG.trato))){CG.trato=prox||trC[trC.length-1]||null;CG.tAuto=true;}}
  else if(!CG.trato&&!CG.avulso&&trC.length===1)CG.trato=trC[0];  // só os tratos com previsto; se for um só, já vem escolhido
  CG.juntos=CG.avulso?[]:(CG.juntos||[]).filter(k=>k!==+CG.trato);const trs=[+CG.trato].concat(CG.juntos).sort((a,b)=>a-b);
  const partes=trs.map(k=>({k,sg:sugestaoCarga(k,CG.rac,CG.local)})),sg={tot:partes.reduce((a,p)=>a+p.sg.tot,0),cs:[...new Set(partes.flatMap(p=>p.sg.cs))]};
  const chave=CG.avulso?'avulso|'+CG.rac:CG.local+'|'+trs.join('+')+'|'+CG.rac;if(CG.totalDe!==chave){const mesmaRac=CG.totalDe!=null&&String(CG.totalDe).split('|').pop()===String(CG.rac);CG.total=CG.avulso?0:(sg.tot||0);CG.totalDe=chave;if(!mesmaRac)CG.ordem=null;  /* a Ordem é independente: continua valendo se a ração é a mesma */
    CG.ja={};CG.sobModo='rac';CG.sobRac=null;CG.sobKg=0;CG.ordAberto=false;CG.jaAberto=false;CG.man={};CG.manAberto=false;CG.desm=[];
    /* currais deste trato que já foram carregados hoje em outra batida: já vêm desmarcados (fica só o que falta) */
    if(!CG.avulso&&CG.trato){const ja=cJaCarr(trs),L=cCurrCarga(trs);CG.desm=L.filter(x=>ja.has(x.c)).map(x=>x.c);if(CG.desm.length)cExpAplicar();}
    CG.expAberto=false;  /* a lista de currais começa recolhida; abre no Expandir tratos */
    cSave();}
  if(CG.abrirDepois){if(CG.abrirDepois==='man')CG.manAberto=true;else CG.jaAberto=true;CG.abrirDepois=null;cSave();}
  const its=itensAjust(itensCarga(CG.rac,CG.total||0));
  const passoTrato=passoRac+(CG.avulso?`
    <label>3. Trato</label><div class="cAvInfo">✳ Trato avulso · sem previsto, você digita a quantidade</div>
    <div class="cBotoes c4"><button type="button" class="mini cAvulso sel" data-cavulso="1">✳ Avulso</button>${cBotAjuste()}</div>`:`
    <label for="cTrato">3. Trato</label><div class="cTrLin">${window.tratoSeta?tratoSeta('cTrato',CG.trato,'',trC):''}<button type="button" class="mini cJtTog${CG.juntoAberto?' sel':''}" data-cjtog="1">＋ Trato</button></div>${CG.avulso?'':cJaTratadoHTML(trs)}${CG.trato?cExpHTML(trs):''}
    <div class="cJuntoLista">${CG.juntoAberto?tratosAtivos().filter(k=>k!==+CG.trato&&(CG.juntos.includes(k)||cTratoPendente(k))).map(k=>{const t=sugestaoCarga(k,CG.rac,CG.local).tot;return `<button type="button" data-cjunto="${k}" class="${CG.juntos.includes(k)?'sel':''}"${t||CG.juntos.includes(k)?'':' disabled'}><span>${CG.juntos.includes(k)?'✓ ':''}Trato ${k}</span>${t?`<small>${nf(t)} kg</small>`:''}</button>`;}).join('')||'<p class="note">Nenhum outro trato pendente para juntar.</p>':''}</div>
    <div class="cBotoes c4"><button type="button" class="mini cAvulso" data-cavulso="1">✳ Avulso</button>${cBotAjuste()}</div>`)+
    '';
  if(!CG.avulso&&!CG.trato)return passoTrato+'</section>';  // escolhe o trato antes de mostrar o total
  return passoTrato+`
    <div><label>4. Total a carregar (kg)${CG.avulso?' · digite':' · pode mudar'}</label><div class="campoX cTotWrap"><input class="big num" id="cTotal" type="text" readonly inputmode="none" value="${CG.total?nf(CG.total):''}" placeholder="${CG.avulso?'digite':''}" data-ct="total"><div class="cSetas"><button type="button" data-ctot="-50" aria-label="Menos 50 kg">▼</button><button type="button" data-ctot="50" aria-label="Mais 50 kg">▲</button></div></div>
</div>
    ${its.length&&CG.total>0?cTabelaCarga(its):''}
    ${(()=>{const P=cPrevTr(),ks=Object.keys(P);if(!ks.length)return '';const em=S.prevChecadoEm;return `<p class="note cPrevTr">📋 Previsto: ${ks.map(k=>`Trato ${k} <b>${nf(P[k])}</b>`).join(' · ')}${ks.length>1?` · total <b>${nf(ks.reduce((a,k)=>a+P[k],0))}</b>`:''} kg${em?` · conferido na nuvem às ${hhmm(em)}`:' · ainda não conferido na nuvem'}</p>`;})()}
    <button class="primary" data-c="iniciar"${CG.total>0&&its.length?'':' disabled'}>▶ Iniciar carregamento</button></section>`;}
/* batida em andamento: mostra quando começou e dá para cancelar e começar outra */
function barraBatida(A){const h=A.ts0?new Date(A.ts0).toTimeString().slice(0,5):'';const outroDia=A.dia!==hojeKey();
  return `<div class="fBar${outroDia?' fBarVelha':''}"><span>${outroDia?'⚠ Carregamento de '+diaBR(A.dia).slice(0,5)+' ainda aberto':'Carregamento em andamento'}${h?' · iniciado '+h:''}${A.local?' · '+(A.local==='C'?'Confinamento':'Pasto'):''}${A.tratos&&A.tratos.length>1?' · Tratos '+A.tratos.join('+'):''}</span></div>`;}
window.barraBatida=barraBatida;
function cTelaBatida(){const A=cAtiva(),i=A.atual,it=A.itens[i],alvo=it&&ok(it.ini)?it.ini+it.prev:NaN,real=it&&ok(it.ini)&&ok(it.fim)?it.fim-it.ini:NaN,dif=real-(it?it.prev:0);
  const feitos=A.itens.filter(x=>ok(x.real)).length,tp=A.itens.reduce((a,x)=>a+x.prev,0),tr=A.itens.reduce((a,x)=>a+(ok(x.real)?x.real:0),0),tpf=A.itens.reduce((a,x)=>a+(ok(x.real)?x.prev:0),0);
  const cls=(d,p)=>typeof classeDesv==='function'?classeDesv(d,p):'';
  return `${barraBatida(A)}<section class="panel"><div class="curhead"><h2>Carregamento · ${A.avulso?'Avulso':'Trato '+A.trato}</h2><span class="note">${esc(A.racNome)} · ${nf(A.total)} kg</span></div>
    <div class="curBox2"><div class="cbCur" data-c="escolher" role="button"><span>Produto ${i+1} de ${A.itens.length} <i class="seta">▼</i></span><b>${esc(it?it.nome:'—')}</b></div>
      <div class="cbPrev"><span>Carregar</span><b class="num">${it?nf(it.prev):'—'}</b></div></div>
    ${A.escolha?`<div class="escolha">${A.itens.map((x,k)=>`<button data-c="ir" data-i="${k}" class="${k===i?'sel':''}">${ok(x.real)?'✓ ':''}${esc(x.nome)} · ${nf(x.prev)} kg</button>`).join('')}</div>`:''}
    ${it&&ok(it.real)?`<p class="avisoJa">Este produto já foi carregado (${nf(it.real)} kg). Se registrar de novo, substitui.</p>`:''}
    <div><label>Balança no início (kg)</label><div class="campoX"><input class="big num" type="text" readonly inputmode="none" value="${it&&ok(it.ini)?it.ini:''}" data-ct="ini"></div></div>
    <div class="led"><span>Parar com balança em</span><b>${ok(alvo)?nf(alvo):'—'}</b></div>
    <div><label>Balança no final (kg)</label><div class="campoX"><input class="big num" type="text" readonly inputmode="none" value="${it&&ok(it.fim)?it.fim:''}" data-ct="fim"></div></div>
    <div class="res"><div><small>Carregado</small><b class="num">${ok(real)?nf(real):'—'}</b></div><div><small>Diferença do previsto</small><b class="num ${ok(real)?cls(dif,it.prev):''}">${ok(real)?(dif>0?'+':'')+nf(dif):'—'}</b></div></div>
    ${fixoNota(it)}<button class="primary" data-c="registrar"${(ok(real)&&real>0)||(it&&insFixo(it.ins)&&!ok(it.real))?'':' disabled'}>Registrar produto</button>
    <div class="row navtrato"><button data-c="ant"${i>0?'':' disabled'}>◀ Produto anterior</button><button class="lima" data-c="prox"${i<A.itens.length-1?'':' disabled'}>Próximo produto ▶</button></div></section>
  <section class="panel"><div class="curhead"><h2>Produtos do carregamento</h2><span class="note">${feitos} de ${A.itens.length}</span></div>
    <div class="tablebox"><table class="gTab"><thead><tr><th>Produto</th><th>Previsto</th><th>Carreg.</th><th>Dif.</th></tr></thead><tbody>
    ${A.itens.map((x,k)=>{const d=ok(x.real)?x.real-x.prev:NaN;return `<tr class="${k===i?'cur':''} gClic" data-c="ir" data-i="${k}"><td class="c">${ok(x.real)?'✓ ':''}${esc(x.nome)}</td><td>${nf(x.prev)}</td><td>${ok(x.real)?nf(x.real):'—'}</td><td class="${ok(d)?cls(d,x.prev):''}">${ok(d)?(d>0?'+':'')+nf(d):''}</td></tr>`;}).join('')}
    <tr class="grp"><td>Total</td><td>${nf(tp)}</td><td>${nf(tr)}</td><td>${feitos?(tr-tpf>0?'+':'')+nf(tr-tpf):''}</td></tr></tbody></table></div>
    ${manNotaAtiva(A)}<button class="primary" data-c="concluir"${feitos?'':' disabled'}>✓ Finalizar carregamento</button>
    <div class="row"><button data-c="desfazer"${feitos?'':' disabled'}>Desfazer último</button><button class="danger" data-c="cancelar">Cancelar carregamento</button></div></section>`;}
/* batida com carregamento manual: o produto fica com previsto e carregado = balança + manual (é o que sai do estoque);
   guarda separado: bal (balança) e man (manual). Produto todo manual entra também. */
/* insumo marcado "registra sempre o previsto" (núcleo): no carregamento vale o previsto, não a balança */
const insFixo=id=>{const i=id&&G.it[id];return !!(i&&!i.del&&i.fixo);};window.insFixo=insFixo;
function fixoNota(it){return it&&insFixo(it.ins)&&!ok(it.real)?`<p class="note cFixo">🔒 <b>${esc(it.nome)}</b>: registra sempre o previsto (<b>${nf(it.prev)} kg</b>). A balança só ajuda a ver quanto colocar.</p>`:'';}
window.fixoNota=fixoNota;
function regFixo(A,it,fimBal){if(!it||ok(it.real)||!insFixo(it.ins))return false;   // registra o previsto
  it.real=it.prev;it.fim=ok(fimBal)?fimBal:(ok(it.ini)?it.ini+it.prev:null);it.fixo=true;it.hora=new Date().toTimeString().slice(0,5);it.tsReg=Date.now();return true;}
window.regFixo=regFixo;
function juntaManual(A){const M=A.manual||[],out=A.itens.map(x=>{const m=M.find(q=>q.ins===x.ins),mk=m?+m.kg||0:0,r=ok(x.real)?x.real:null;
    const o={ins:x.ins,nome:x.nome,pMN:x.pMN,prev:x.prev+mk,ini:x.ini,fim:x.fim,real:r==null?(mk?null:null):r+mk,hora:x.hora||''};if(mk){o.man=mk;o.bal=r;}return o;});
  M.filter(m=>!A.itens.some(x=>x.ins===m.ins)).forEach(m=>out.push({ins:m.ins,nome:m.nome,pMN:m.pMN,prev:m.prec!=null?+m.prec:+m.kg,real:+m.kg,man:+m.kg,bal:0,hora:'manual'}));return out;}
function manNotaAtiva(A){const M=(A&&A.manual)||[];return M.length?`<p class="note">✋ Já colocado à mão (manual): ${M.map(m=>`<b>${esc(m.nome)}</b> ${nf(m.kg)} kg`).join(' · ')}. Entra no carregamento e sai do estoque ao finalizar.</p>`:'';}
window.manNotaAtiva=manNotaAtiva;
const nomeMan=x=>esc(x.nome)+(x.man>0?`<small>✋ manual ${nf(x.man)} kg${x.bal?` + balança ${nf(x.bal)} kg`:''}</small>`:'');
function cargasDia(dia){return gTodos('carga').filter(c=>c.dia===dia).sort((a,b)=>a.ts0-b.ts0);}
function cTelaDia(){const dia=CG.verDia||hojeKey(),L=cargasDia(dia);
  const cards=L.map(c=>{const tp=c.itens.reduce((a,x)=>a+x.prev,0),tr=c.itens.reduce((a,x)=>a+(+x.real||0),0),d=tr-tp;
    return `<details class="gMais gCarga"><summary><b>${esc(c.hora||'')}</b> · Trato ${c.trato} · ${esc(c.racNome)} <span class="num">${nf(tr)} kg <i class="${typeof classeDesv==='function'?classeDesv(d,tp):''}">(${d>0?'+':''}${nf(d)})</i></span></summary>
      <div class="tablebox"><table class="gTab"><thead><tr><th>Produto</th><th>Previsto</th><th>Carreg.</th><th>Dif.</th></tr></thead><tbody>${c.itens.map(x=>`<tr><td class="c">${nomeMan(x)}</td><td>${nf(x.prev)}</td><td>${ok(+x.real)?nf(+x.real):'—'}</td><td>${ok(+x.real)?((x.real-x.prev)>0?'+':'')+nf(x.real-x.prev):''}</td></tr>`).join('')}</tbody></table></div>
      <button class="mini danger" data-c="apagaCarga" data-id="${c.uid}">Apagar este carregamento</button></details>`;}).join('');
  const tp=L.reduce((a,c)=>a+c.itens.reduce((s,x)=>s+x.prev,0),0),tr=L.reduce((a,c)=>a+c.itens.reduce((s,x)=>s+(+x.real||0),0),0);
  return `<section class="panel"><h2>Carregamentos do dia</h2>${navData('cDia',dia,'Data')}
    ${L.length?`<div class="stat gStat3">${st('Carregamentos',nf(L.length))}${st('Previsto',nf(tp)+' kg')}${st('Carregado',nf(tr)+' kg')}</div>${cards}
    <div class="row compart"><button class="verde" data-c="imgCarga">🖼 Foto</button><button class="verde" data-c="xlsCarga">📊 Excel</button></div>`:'<p class="note">Nenhum carregamento nesta data.</p>'}</section>`;}
/* teclado numérico grande (igual ao do Tratar) */
function cTeclado(campo,el){if(bloqueado())return;if(cTec)cFecha();cTec=campo;const A=cAtiva(),it=A&&A.itens[A.atual];
  /* campo 'inp': um quadradinho da tela (Sobra kg, Manual, Sobra por produto) — usa este mesmo teclado em vez do teclado do Android */
  window.cTecEl=campo==='inp'?el:null;
  if(campo==='inp'){const v=gNum(el.value);cBuf=v>0?String(Math.round(v)):'';}
  else{const v=campo==='total'?CG.total:it?it[campo]:null;cBuf=ok(v)&&v?String(Math.round(v)):'';}
  const f=cCampoEl();window.cTecOrig=f?f.value:null;window.cNovo=true;   // primeiro número digitado substitui o valor antigo
  $('ctNome').textContent=campo==='inp'?(el.dataset.tecnome||'Quantidade (kg)'):campo==='total'?'Total a carregar (kg)':campo==='ini'?'Balança no início (kg)':'Balança no final (kg)';cMostra();$('tecCarga').hidden=false;
  document.body.classList.add('comteclado');cCaixa().querySelectorAll('[data-ct],[data-tecin]').forEach(e=>e.classList.remove('sel'));if(f)f.classList.add('sel');
  requestAnimationFrame(()=>{const f2=cCampoEl();if(!f2)return;const r=f2.getBoundingClientRect(),livre=innerHeight-$('tecCarga').offsetHeight;
    const mb=typeof topoLivre==='function'?topoLivre():80;if(r.bottom>livre-12||r.top<mb)window.scrollBy({top:r.top-mb,behavior:'smooth'});});}
/* o campo que está sendo digitado (o número aparece nele mesmo, na hora) */
function cCampoEl(){if(cTec==='inp')return window.cTecEl&&document.body.contains(window.cTecEl)?window.cTecEl:null;return cTec?cCaixa().querySelector(`[data-ct="${cTec}"]`):null;}
function cMostra(){const t=cBuf?nf(+cBuf):'';$('ctValor').textContent=t||'—';const f=cCampoEl();if(f)f.value=t;}
function cFecha(){const f=cCampoEl();if(f&&window.cTecOrig!=null)f.value=window.cTecOrig;   // fechou sem OK: o campo volta como estava
  cTec=null;window.cTecEl=null;window.cTecOrig=null;$('tecCarga').hidden=true;document.body.classList.remove('comteclado');document.querySelectorAll('#cBox .sel[data-ct],#acBox .sel[data-ct],#cBox .sel[data-tecin],#acBox .sel[data-tecin]').forEach(e=>e.classList.remove('sel'));}
function cConfirma(){const v=cBuf===''?null:+cBuf,A=cAtiva();
  if(cTec==='inp'){const el=window.cTecEl;window.cTecOrig=null;cFecha();if(el){el.value=v?String(v):'';el.dispatchEvent(new Event('change',{bubbles:true}));}return;}
  if(cTec==='total'){CG.total=v||0;cSave();}
  else if(A){const it=A.itens[A.atual];it[cTec]=v;if(cTec==='ini'&&v!=null&&!ok(it.fim))it.fim=null;cSave();}
  const prox=cTec==='ini'&&A&&!cAuto()?'fim':null;window.cTecOrig=null;cFecha();cRender();if(prox)cTeclado(prox);}
['cBox','acBox'].forEach(id=>{const bx=document.getElementById(id);if(bx)bx.addEventListener('click',e=>{const el=e.target.closest('[data-tecin]');if(!el)return;e.preventDefault();el.blur();cTeclado('inp',el);});});
(function(){const d=document.createElement('div');d.className='teclado';d.id='tecCarga';d.hidden=true;
  d.innerHTML=`<div class="tecTopo"><span id="ctNome"></span><b id="ctValor">—</b></div><div class="tecGrade">${[1,2,3,4,5,6,7,8,9].map(n=>`<button data-k="${n}">${n}</button>`).join('')}<button data-k="limpar" class="tecSec">Limpar</button><button data-k="0">0</button><button data-k="del" class="tecSec">⌫</button></div><div class="tecAcoes"><button data-k="fechar" class="tecSec">Fechar</button><button data-k="ok" class="tecOk">OK</button></div>`;
  document.body.appendChild(d);d.addEventListener('pointerdown',e=>e.preventDefault());
  d.addEventListener('click',e=>{const b=e.target.closest('button[data-k]');if(!b)return;const k=b.dataset.k;
    if(k==='fechar')return cFecha();if(k==='ok')return cConfirma();if(window.cNovo&&k!=='del'){cBuf='';}window.cNovo=false;if(k==='limpar')cBuf='';else if(k==='del')cBuf=cBuf.slice(0,-1);else if(cBuf.length<6)cBuf=(cBuf+k).replace(/^0+(?=\d)/,'');cMostra();});})();
function cClique(e){
  const lb=e.target.closest('[data-cloc]');if(lb){const loc=lb.dataset.cloc;cLimparSetup();CG.local=loc;CG.passo=2;cSave();cRender();cPrevAoEscolher(loc);return;}
  const cp=e.target.closest('[data-cpasso]');if(cp){CG.passo=+cp.dataset.cpasso;cSave();return cRender();}
  if(e.target.closest('[data-ccancel]')){const fz=()=>{cLimparSetup();cRender();window.scrollTo({top:0});toast('Carregamento cancelado');};
    (typeof confirmaVermelho==='function'?confirmaVermelho('Deseja realmente cancelar o carregamento?','O que você escolheu para este carregamento será descartado.','Sim, cancelar carregamento','Não, voltar'):Promise.resolve(confirm('Deseja realmente cancelar o carregamento?'))).then(sim=>{if(sim)fz();});return;}
  {const ab=e.target.closest('[data-cexpall]');if(ab){const trs=[+CG.trato].concat(CG.juntos||[]);CG.desm=ab.dataset.cexpall==='1'?[]:cCurrCarga(trs).map(x=>x.c);cExpAplicar();cSave();return cRender();}}
  if(e.target.closest('[data-cexp]')){CG.expAberto=!CG.expAberto;cSave();return cRender();}
  {const xb=e.target.closest('[data-cexpc]');if(xb){const c=xb.dataset.cexpc;CG.desm=CG.desm||[];CG.desm=CG.desm.includes(c)?CG.desm.filter(x=>x!==c):CG.desm.concat(c);cExpAplicar();cSave();return cRender();}}
  if(e.target.closest('[data-cjtog]')){if(CG.juntoAberto){CG.juntoAberto=false;CG.juntos=[];}else CG.juntoAberto=true;cSave();return cRender();}  // fechar = tira os tratos juntos
  if(e.target.closest('[data-cordtog]')){CG.ordAberto=!CG.ordAberto;cSave();return cRender();}
  if(e.target.closest('[data-cmantog]')){if(CG.manAberto){CG.manAberto=false;CG.man={};}else{CG.jaAberto=false;CG.ja={};CG.sobRac=null;CG.sobKg=0;CG.sobModo='rac';
    if(CG.avulso){CG.avulso=false;CG.totalDe='x|'+CG.rac;CG.abrirDepois='man';}else CG.manAberto=true;}cSave();return cRender();}  // abrir o Manual fecha e zera a Sobra e o Avulso  // fechar = zera o manual
  if(e.target.closest('[data-cjatog]')){if(CG.jaAberto){CG.jaAberto=false;CG.ja={};CG.sobRac=null;CG.sobKg=0;CG.sobModo='rac';}else{CG.manAberto=false;CG.man={};
    if(CG.avulso){CG.avulso=false;CG.totalDe='x|'+CG.rac;CG.abrirDepois='ja';}else CG.jaAberto=true;}cSave();return cRender();}  // abrir a Sobra fecha e zera o Manual e o Avulso  // fechar = zera a sobra
  {const sm=e.target.closest('[data-csmodo]');if(sm){CG.sobModo=sm.dataset.csmodo;cSave();return cRender();}}
  {const m=e.target.closest('[data-cmov]');if(m){const its=itensAjust(itensCarga(CG.rac,CG.total||0)).map(i=>i.ins),i=its.indexOf(m.dataset.ins),j=i+(+m.dataset.cmov);
    if(i>=0&&j>=0&&j<its.length){[its[i],its[j]]=[its[j],its[i]];const pad=itensCarga(CG.rac,CG.total||0).map(i=>i.ins);CG.ordem=its.join('|')===pad.join('|')?null:its;cSave();cRender();}return;}}  // voltou à ordem original = sem mudança
  if(e.target.closest('[data-cordreset]')){CG.ordem=null;cSave();return cRender();}
  if(e.target.closest('[data-cavulso]')){CG.avulso=!CG.avulso;if(CG.avulso){CG.manAberto=false;CG.man={};CG.jaAberto=false;CG.ja={};CG.sobRac=null;CG.sobKg=0;CG.sobModo='rac';}CG.juntos=[];CG.juntoAberto=false;CG.totalDe='x|'+CG.rac;cSave();return cRender();}
  const ct=e.target.closest('[data-ctot]');if(ct){CG.total=Math.max(0,(+CG.total||0)+(+ct.dataset.ctot));cSave();return cRender();}
  const jb=e.target.closest('[data-cjunto]');if(jb){const k=+jb.dataset.cjunto;CG.juntos=CG.juntos||[];CG.juntos=CG.juntos.includes(k)?CG.juntos.filter(x=>x!==k):CG.juntos.concat(k);cSave();return cRender();}
  const inp=e.target.closest('[data-ct]');if(inp)return cTeclado(inp.dataset.ct);
  const b=e.target.closest('[data-c],[data-g]');if(!b)return;
  if(b.dataset.g==='dataPasso'||b.dataset.g==='dataHoje'){const i=cCaixa().querySelector('#'+b.dataset.alvo)||$(b.dataset.alvo);i.value=b.dataset.g==='dataHoje'?hojeKey():somaDias(i.value||hojeKey(),+b.dataset.n);CG.verDia=i.value;cSave();return cRender();}
  const a=b.dataset.c,A=cAtiva();if(!a)return;
  /* confirmação (caixa verde) antes de registrar o produto ou passar para o próximo */
  if((a==='registrar'||a==='prox'||a==='ant')&&A&&!b._okConf&&window.perg){const it=A.itens[A.atual],nx=A.itens[A.atual+1],an=A.itens[A.atual-1];if(!it)return;
    const q=a==='ant'?perg('Deseja voltar ao produto anterior?',`${it.nome}${an?' → '+an.nome:''}`,'✓ Sim, produto anterior','Não',true)
      :a==='registrar'?perg(nx?`Deseja registrar ${it.nome} e ir para o próximo?`:`Deseja registrar ${it.nome}?`,`Previsto ${nf(it.prev)} kg.${nx?' Próximo: '+nx.nome+'.':' É o último produto.'}`,nx?'✓ Sim, registrar e ir':'✓ Sim, registrar','Não',true)
      :perg('Passar para o próximo produto?',`${it.nome}${nx?' → '+nx.nome:''}`,'✓ Sim, próximo produto','Voltar',true);
    q.then(v=>{if(!v)return;b._okConf=1;try{b.click();}finally{b._okConf=0;}});return;}
  if(a==='imgCarga'||a==='xlsCarga')return a==='imgCarga'?imgCarga():xlsCarga();
  if(bloqueado())return;
  /* antes de iniciar o carregamento: atualiza o previsto (leitura de cocho de outro aparelho); se o total mudou, mostra e pede para conferir */
  if(a==='iniciar'&&!b._okPrev&&!b._okIni&&!CG.ativa&&typeof prevAtualizarAgora==='function'){(async()=>{if(CG.prevChecando)return;CG.prevChecando=true;let r;
      try{toast('Atualizando o previsto…');r=await prevAtualizarAgora();}finally{CG.prevChecando=false;}
      if(!r.ok&&!await confirmaVermelho('Previsto pode estar desatualizado',navigator.onLine?'A nuvem não respondeu: o previsto pode não ter as últimas leituras de cocho.':'Sem internet: o previsto pode não ter as últimas leituras de cocho feitas em outro aparelho.','Iniciar mesmo assim','Voltar'))return;
      if(r.mudou&&!CG.avulso&&CG.local){const antes=+CG.total||0;try{cExpAplicar();}catch(e){}cSave();cRender();const novo=+CG.total||0;
        if(Math.round(novo)!==Math.round(antes)){await confirmaVermelho('Previsto atualizado',`A leitura de cocho mudou o previsto. Total do carregamento: ${nf(antes)} → ${nf(novo)} kg. Confira e toque em ▶ Iniciar carregamento de novo.`,'Entendi, vou conferir','Fechar',true);return;}}
      try{window.diagLog&&diagLog('batida_prev',{local:CG.local,tratos:[+CG.trato].concat(CG.juntos||[]),prevTr:cPrevTr(),total:CG.total,conferido:hhmm(S.prevChecadoEm),nuvemOk:!!r.ok,mudou:!!r.mudou});}catch(e){}
      const bt=document.querySelector('[data-c="iniciar"]')||b;bt._okPrev=1;try{bt.click();}finally{bt._okPrev=0;}})();return;}
  if(a==='iniciar'&&!b._okIni&&!CG.avulso&&CG.local&&typeof fornCurrais==='function'&&typeof fornPendentes==='function'){
    const trs=[+CG.trato].concat((CG.juntos||[]).map(Number).filter(k=>k!==+CG.trato)).filter(k=>k>0),fe=trs.filter(k=>fornCurrais(CG.local,CG.rac,k).length&&!fornPendentes(CG.local,CG.rac,k).length);
    if(fe.length){confirmaVermelho('Deseja realmente iniciar o carregamento?',`${fe.length>1?'Os Tratos '+fe.join(' e '):'O Trato '+fe[0]} (${NOMELOC[CG.local]}) já ${fe.length>1?'foram realizados':'foi realizado'} hoje: todos os currais já foram tratados.`,'Sim, iniciar mesmo assim','Não, voltar').then(v=>{if(!v)return;b._okIni=1;try{b.click();}finally{b._okIni=0;}});return;}}
  if(a==='iniciar'){const r=G.it[CG.rac],tudo=itensAjust(itensCarga(CG.rac,CG.total)),its=tudo.filter(i=>i.prev>0),jaIt=tudo.filter(i=>i.ja>0).map(i=>({ins:i.ins,nome:i.nome,kg:i.ja})),manIt=tudo.filter(i=>i.man>0).map(i=>({ins:i.ins,nome:i.nome,pMN:i.pMN,kg:i.man,prec:Math.round(Math.max(0,i.prevOrig-i.ja))}));if(!tudo.length)return toast('Ração sem fórmula');
    if(!its.length&&manIt.length){if(!confirm('Tudo foi lançado no manual: nada para a balança. Salvar o carregamento assim?'))return;   // só manual: salva direto
      const now=Date.now();gPut({uid:novoId('carga'),tipo:'carga',dia:hojeKey(),local:CG.local||'',avulso:!!CG.avulso,trato:CG.avulso?0:+CG.trato,tratos:CG.avulso?[]:[+CG.trato].concat(CG.juntos||[]).sort((a,b)=>a-b),racao:CG.rac,racNome:r.nome,total:manIt.reduce((a,m)=>a+m.kg,0),ts0:now,hora:new Date(now).toTimeString().slice(0,5),tsF:now,horaF:new Date(now).toTimeString().slice(0,5),
        itens:manIt.map(m=>({ins:m.ins,nome:m.nome,pMN:m.pMN,prev:m.prec,real:m.kg,man:m.kg,bal:0,hora:'manual'})),origem:'manual'});
      CG.verDia=hojeKey();cLimparSetup();toast('Carregamento salvo (manual)');cRender();window.scrollTo({top:0});if(window.atualizarAoFinalizar)atualizarAoFinalizar();return;}
    if(!its.length)return toast('Tudo já está no vagão: nada para carregar');
    CG.ativa={prevTr:cPrevTr(),prevEm:S.prevChecadoEm||null,dia:hojeKey(),local:CG.local||'',avulso:!!CG.avulso,trato:CG.avulso?0:+CG.trato,tratos:CG.avulso?[]:[+CG.trato].concat(CG.juntos||[]).sort((a,b)=>a-b),rac:CG.rac,racNome:r.nome,total:its.reduce((a,i)=>a+i.prev,0),totalMistura:CG.total,cur:CG.avulso?null:cCurrCarga([+CG.trato].concat(CG.juntos||[])).filter(x=>!(CG.desm||[]).includes(x.c)).map(x=>x.c),jaNoVagao:jaIt,manual:manIt,itens:its,atual:0,ts0:Date.now(),origem:cAuto()?'balanca':'manual'};cSave();cRender();window.scrollTo({top:0});if(cAuto()){if(window.acIniciou)acIniciou();return;}return cTeclado('ini');}
  if(a==='contRem')return cContinuarRem(b.dataset.ap);
  if(!A&&a!=='apagaCarga')return;
  if(a==='escolher'){A.escolha=!A.escolha;cSave();return cRender();}
  if(a==='ir'){A.atual=+b.dataset.i;A.escolha=false;cSave();return cRender();}
  if(a==='prox'&&cAuto()&&window.acProximo)return acProximo();
  if(a==='prox'){const it=A.itens[A.atual];if(it&&regFixo(A,it,ok(it.fim)?it.fim:null))toast(`${it.nome}: ${nf(it.real)} kg (previsto)`);}
  if(a==='ant'||a==='prox'){A.atual=Math.max(0,Math.min(A.itens.length-1,A.atual+(a==='ant'?-1:1)));const it=A.itens[A.atual],pv=A.itens[A.atual-1];if(a==='prox'&&!ok(it.ini)&&pv&&ok(pv.fim))it.ini=pv.fim;cSave();return cRender();}
  if(a==='registrar'&&cAuto())return window.acRegistrar&&acRegistrar();
  if(a==='registrar'){const it=A.itens[A.atual];
    if(!regFixo(A,it,ok(it.fim)?it.fim:null)){if(!(ok(it.ini)&&ok(it.fim)&&it.fim>it.ini))return toast('A balança no final precisa ser maior que no início');
    it.real=it.fim-it.ini;it.hora=new Date().toTimeString().slice(0,5);it.tsReg=Date.now();}
    const k=A.itens.findIndex((x,j)=>j>A.atual&&!ok(x.real)),nx=k>=0?k:A.itens.findIndex(x=>!ok(x.real));
    if(nx>=0){A.atual=nx;const n=A.itens[nx];if(!ok(n.real)){n.ini=it.fim;n.fim=null;}}
    cSave();toast(`${it.nome}: ${nf(it.real)} kg`);cRender();if(nx>=0)cTeclado('fim');else toast('Todos os produtos carregados. Toque em Finalizar carregamento.');return;}
  if(a==='desfazer'){(async()=>{const ult=A.itens.filter(x=>ok(x.real)).sort((p,q)=>(q.tsReg||0)-(p.tsReg||0)||(q.hora||'').localeCompare(p.hora||''))[0];if(!ult)return;if(!await confirmaVermelho('Deseja realmente desfazer o último produto?',`${ult.nome} (${nf(ult.real)} kg) volta a ficar para carregar.`,'Sim, desfazer','Não, manter'))return;if(CG.ativa!==A)return;const feitos=A.itens.map((x,j)=>[x,j]).filter(([x])=>ok(x.real)).sort((p,q)=>((q[0].tsReg||0)-(p[0].tsReg||0))||(q[0].hora||'').localeCompare(p[0].hora||'')||(q[1]-p[1]));if(!feitos.length)return;
    const [x,j]=feitos[0];x.real=null;x.fim=null;x.lib=false;A.atual=j;cSave();cRender();})();return;}
  if(a==='cancelar'){const feitos=A.itens.filter(x=>ok(x.real)).length;
    confirmaVermelho('Deseja realmente cancelar o carregamento?',`${feitos?`Os ${feitos} produto(s) já carregado(s) neste carregamento serão perdidos.`:'Este carregamento será descartado.'} Nada dele será salvo e não dá para desfazer.`,'Sim, cancelar carregamento','Não, continuar carregando').then(sim=>{if(!sim)return;if(CG.ativa!==A)return;CG.passo=1;CG.local=null;CG.juntos=[];CG.avulso=false;CG.juntoAberto=false;try{window.diagLog&&diagLog('batida_cancelada',{trato:A.trato,itens:A.itens.map(x=>[x.nome,x.prev,x.real])});}catch(e){}CG.ativa=null;cLimparSetup();cRender();toast('Carregamento cancelado');window.scrollTo({top:0});});return;}
  if(a==='concluir'){(async()=>{if(CG.conclAberto)return;CG.conclAberto=true;
    /* igual ao Finalizar fornecimento: tudo carregado → caixa verde; faltando produto → caixa vermelha (alerta) */
    let sim;try{A.itens.forEach(x=>regFixo(A,x,null));const F=A.itens.filter(x=>!ok(x.real)),n=A.itens.length-F.length;
      sim=await confirmaVermelho(F.length?`Deseja finalizar este carregamento? Faltam ${F.length} produto(s)`:'Deseja finalizar este carregamento?',
        F.length?`${n} de ${A.itens.length} produtos carregados. Faltam: ${F.map(x=>x.nome).join(', ')}. Eles ficam sem registro neste carregamento.`:`Todos os ${A.itens.length} produtos carregados.`,
        'Sim, finalizar','Não, continuar carregando',!F.length);}finally{CG.conclAberto=false;}
    if(!sim||CG.ativa!==A)return;
    gPut({uid:novoId('carga'),tipo:'carga',dia:A.dia,local:A.local||'',avulso:!!A.avulso,trato:A.trato,tratos:A.tratos||[A.trato],racao:A.rac,racNome:A.racNome,total:A.total,ts0:A.ts0,hora:new Date(A.ts0).toTimeString().slice(0,5),tsF:Date.now(),horaF:new Date().toTimeString().slice(0,5),
      itens:juntaManual(A),origem:A.origem||'',...(A.prevTr?{prevTr:A.prevTr,prevEm:A.prevEm||null}:{}),...(Array.isArray(A.cur)?{cur:A.cur}:{})});
    CG.ativa=null;CG.verDia=A.dia;cLimparSetup();toast('Carregamento salvo');cRender();window.scrollTo({top:0});if(window.atualizarAoFinalizar)atualizarAoFinalizar();})();return;}
  if(a==='apagaCarga'){if(!confirm('Apagar este carregamento?'))return;gDel(b.dataset.id);return cRender();}
}
$('cBox').addEventListener('click',cClique);$('acBox').addEventListener('click',cClique);
function cMuda(e){const t=e.target;
  if(t.id==='cSobRac'){CG.sobRac=t.value||null;cSave();cRender();return;}
  if(t.id==='cSobKg'){const v=gNum(t.value);CG.sobKg=v>0?v:0;cSave();cRender();return;}
  if(t.dataset&&t.dataset.cman){CG.man=CG.man||{};const v=gNum(t.value);if(v>0)CG.man[t.dataset.cman]=v;else delete CG.man[t.dataset.cman];cSave();cRender();return;}
  if(t.dataset&&t.dataset.cja){CG.ja=CG.ja||{};const v=gNum(t.value);if(v>0)CG.ja[t.dataset.cja]=v;else delete CG.ja[t.dataset.cja];cSave();cRender();return;}
  if(t.id==='cTrato'){CG.trato=+t.value||null;CG.tAuto=false;cSave();cRender();}
  if(t.id==='cRac'){CG.rac=t.value||null;CG.trato=null;if(CG.rac)CG.passo=Math.max(CG.passo||1,3);cSave();cRender();}
  if(t.id==='cDia'){CG.verDia=t.value||hojeKey();cSave();cRender();}}
$('cBox').addEventListener('change',cMuda);$('acBox').addEventListener('change',cMuda);
function imgCarga(){const dia=CG.verDia||hojeKey(),L=cargasDia(dia);
  enviarImg(`Carregamentos do vagão · ${dB(dia)}`,L.map(c=>{const tp=c.itens.reduce((a,x)=>a+x.prev,0),tr=c.itens.reduce((a,x)=>a+(+x.real||0),0);
    return {cab:`${c.hora} · Trato ${c.trato} · ${c.racNome}`,cols:[['Produto',330,'l'],['Previsto',170,'r'],['Carregado',170,'r'],['Diferença',170,'r']],
      linhas:c.itens.map(x=>[x.nome,nf(x.prev),ok(+x.real)?nf(+x.real):'—',ok(+x.real)?((x.real-x.prev)>0?'+':'')+nf(x.real-x.prev):'']),
      cores:c.itens.map(x=>{const d=x.real-x.prev;return [null,null,null,null,!ok(+x.real)?null:Math.abs(d)/x.prev<=.03?'#5f7a00':Math.abs(d)/x.prev<=.08?'#b26a00':'#b3261e'];}),
      total:['TOTAL',nf(tp),nf(tr),(tr-tp>0?'+':'')+nf(tr-tp)]};}),`Carregamentos ${dB(dia).replace(/\//g,'-')}`);}
function xlsCarga(){const dia=CG.verDia||hojeKey(),L=cargasDia(dia),r=[];
  L.forEach(c=>c.itens.forEach(x=>r.push([xc(dia,'dia'),xc(c.hora),xc(c.trato,'int'),xc(c.racNome),xc(x.nome),xc(x.prev,'int'),xc(ok(+x.real)?+x.real:NaN,'int'),xc(ok(+x.real)?x.real-x.prev:NaN,'int'),xc(ok(+x.ini)?+x.ini:NaN,'int'),xc(ok(+x.fim)?+x.fim:NaN,'int')])));
  gExcel(`Carregamentos ${dB(dia).replace(/\//g,'-')}`,[['Carregamentos',['Data','Hora','Trato','Ração','Produto','Previsto (kg)','Carregado (kg)','Diferença (kg)','Balança início','Balança final'],r,[11,7,7,16,22,12,13,13,13,13]]]);}
$('tabCarga').addEventListener('click',()=>aba('carga'));
window.cAoAbrir=()=>{cLimparSetup();cRender();cBuscarRemoto();};window.cLimparSetup=cLimparSetup;window.cFecha=cFecha;

/* confirmação com aviso em vermelho (ex.: cancelar batida) */
function confirmaVermelho(tit,txt,sim,nao,verde,extra,terc){   // terc: 3º botão (devolve 'x')
   // extra: HTML já montado (escapado) que vai logo abaixo do texto
return new Promise(res=>{   // verde=true: tudo certo (caixa verde em vez do alerta vermelho)
  if(!document.getElementById('cvEstilo')){const st=document.createElement('style');st.id='cvEstilo';st.textContent=`.cvFundo{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px}
.cvCaixa{background:var(--card,#fff);border-radius:16px;max-width:420px;width:100%;padding:20px;border:3px solid #d32f2f;box-shadow:0 10px 40px rgba(0,0,0,.35)}
.cvCaixa h3{margin:0 0 10px;color:#d32f2f;font-size:1.25rem}.cvCaixa p{white-space:pre-line;margin:0 0 18px;color:#d32f2f;font-weight:600;line-height:1.35}
.cvCaixa.verde{border-color:#2e7d32}.cvCaixa.verde h3,.cvCaixa.verde p{color:#2e7d32}.cvCaixa.verde .cvSim{background:#2e7d32;border-color:#2e7d32}
.cvFaltas{display:flex;flex-wrap:wrap;gap:6px 18px;margin:-10px 0 14px;font-size:.8rem;line-height:1.3;color:#33475b}.cvFaltas>div{display:flex;flex-direction:column;min-width:64px}.cvFaltas b{font-size:.82rem;color:#b3261e;margin-bottom:2px}.cvCaixa p.cvPerg{margin-top:0}
.cvCaixa .cvBt{display:grid;gap:10px}.cvCaixa .cvTerc{background:#fff;color:#b3261e;border:2px dashed #d32f2f;font-size:.92rem;padding:11px}.cvCaixa button{padding:14px;font-size:1rem;border-radius:12px}.cvCaixa .cvSim{background:#d32f2f;color:#fff;border-color:#d32f2f}`;document.head.appendChild(st);}
  const f=document.createElement('div');f.className='cvFundo';
  f.innerHTML=`<div class="cvCaixa${verde?' verde':''}" role="alertdialog"><h3>${verde?'✅':'⚠️'} ${esc(tit)}</h3><p>${esc(txt)}</p>${extra||''}<div class="cvBt"><button class="cvSim">${esc(sim)}</button><button class="cvNao">${esc(nao)}</button>${terc?`<button class="cvTerc">${esc(terc)}</button>`:''}</div></div>`;
  const fim=v=>{f.remove();res(v);};
  f.querySelector('.cvSim').onclick=()=>fim(true);f.querySelector('.cvNao').onclick=()=>fim(false);if(terc)f.querySelector('.cvTerc').onclick=()=>fim('x');
  f.addEventListener('click',e=>{if(e.target===f)fim(false);});document.body.appendChild(f);});}
window.confirmaVermelho=confirmaVermelho;

document.addEventListener('change',e=>{if(e.target&&e.target.id==='cfgComp'){const c=JSON.parse(JSON.stringify(gCfg()));c.compensa=e.target.value==='1';gPut(c);toast(c.compensa?'Compensação ligada':'Compensação desligada');}});

/* ---------- Histórico › Batidas: o que foi carregado no vagão (previsto e carregado de cada ingrediente, data e hora) ---------- */
window.batidasLista=(pa,pb,loc,t)=>gTodos('carga').filter(c=>c.dia>=pa&&c.dia<=pb&&(!loc||loc==='T'||c.local===loc||(!c.local&&false))&&(!t||+c.trato===+t||(c.tratos||[]).includes(+t)))
  .sort((a,b)=>(a.dia+(a.hora||'')).localeCompare(b.dia+(b.hora||'')));  // da primeira batida para a última
/* Editar/Apagar batida: dois botões pequenos no fim da lista; tocou → escolhe a batida (window.HBSEL = 'ed' ou 'del') */
window.HBSEL=null;
window.batidasHTML=(L,mostrarDia,semApagar)=>{if(!L.length)return '<p class="note">Nenhum carregamento neste filtro.</p>';
  const podeMexer=!semApagar&&!(typeof modoVer!=='undefined'&&modoVer),sel=podeMexer?window.HBSEL:null;
  /* Editar realizado (senha): vira Aplicar (verde) e Cancelar (vermelho); nada é gravado até Aplicar */
  const fim=podeMexer?`<div class="hPvBtns">${sel?'<div class="row pvImsBtns"><button class="primary" type="button" data-hbap="ok">✓ Aplicar</button><button class="dangerfill" type="button" data-hbap="canc">✕ Cancelar</button></div>'
    :'<button class="dangerfill" type="button" data-hbmodo="ed">✎ Editar realizado</button>'}</div>`:'';
  const PE=window.HBPEND||{};
  return L.map(c=>{const tp=c.itens.reduce((a,x)=>a+(+x.prev||0),0),tr=c.itens.reduce((a,x)=>a+(+x.real||0),0),d=tr-tp,cls=(dd,p)=>typeof classeDesv==='function'?classeDesv(dd,p):'';
    return `<details class="gMais gCarga" open><summary><b>${mostrarDia?diaBR(c.dia).slice(0,5)+' ':''}${esc(c.hora||'')}</b> · ${c.avulso?'Avulso':c.tratos&&c.tratos.length>1?'Tratos '+c.tratos.join('+'):'Trato '+c.trato}${c.local?' · '+(c.local==='C'?'Confinamento':'Pasto'):''} · ${esc(c.racNome||'')} <span class="num">${nf(tr)} kg <i class="${cls(d,tp)}">(${d>0?'+':''}${nf(d)})</i></span></summary>
      <div class="tablebox"><table class="gTab"><thead><tr><th>Hora</th><th>Insumos</th><th>Previsto</th><th>Carreg.</th><th>Dif.</th></tr></thead><tbody>${c.itens.map((x,ci)=>{const dd=x.real-x.prev;return `<tr><td>${esc(x.hora||'')}</td><td class="c">${nomeMan(x)}</td><td>${nf(x.prev)}</td><td>${sel==='ed'?`<input class="bEdIn num" inputmode="numeric" data-hbreal="${c.uid}|${ci}" value="${(c.uid+'|'+ci) in PE?esc(PE[c.uid+'|'+ci]):ok(+x.real)?Math.round(+x.real):''}">`:ok(+x.real)?nf(+x.real):'—'}</td><td class="${ok(+x.real)?cls(dd,x.prev):''}">${ok(+x.real)?(dd>0?'+':'')+nf(dd):''}</td></tr>`;}).join('')}
      <tr class="grp"><td></td><td>Total</td><td>${nf(tp)}</td><td>${nf(tr)}</td><td>${(d>0?'+':'')+nf(d)}</td></tr></tbody></table></div>
      </details>`;}).join('')+fim;};
document.addEventListener('click',async e=>{const b=e.target.closest('[data-hbmodo]');if(!b)return;
  /* botão vermelho: senha 1010 SEMPRE (toda vez que toca) */
  if(b.dataset.hbmodo){if(typeof bloqueado==='function'&&bloqueado())return;if(!await pedirSenhaAcao('Senha para editar o realizado'))return;}window.HBPEND={};
  window.HBSEL=b.dataset.hbmodo||null;if(typeof renderHist==='function')renderHist();
  if(window.HBSEL){const t=document.querySelector('#hBat .gBatFim.gbTopo');if(t)t.scrollIntoView({behavior:'smooth',block:'start'});}});
/* relatório de batidas — tipo: 'sep' (uma imagem por batida), 'juntas' (todas numa imagem, subtotal azul claro + total geral), 'insumo' (total de cada insumo), 'todos' */
const COLB=[['Hora',110,'l'],['Insumos',330,'c'],['Previsto',170,'r'],['Carregado',170,'r'],['Diferença',170,'r']];
const sgnB=d=>(d>0?'+':'')+nf(d),corB=(r,p)=>!ok(+r)||!p?null:Math.abs(r-p)/p<=.03?'#5f7a00':Math.abs(r-p)/p<=.08?'#b26a00':'#b3261e';
function secaoBat(c,sub,semData){const tp=c.itens.reduce((a,x)=>a+x.prev,0),tr=c.itens.reduce((a,x)=>a+(+x.real||0),0);
  return {cab:`${semData?'':diaBR(c.dia).slice(0,5)+' '}${c.hora} · Trato ${c.trato}${c.local?' · '+(c.local==='C'?'Confinamento':'Pasto'):''} · ${c.racNome}`,cols:COLB,
    linhas:c.itens.map(x=>[x.hora||'',x.nome+(x.man>0?` (manual ${nf(x.man)})`:''),nf(x.prev),ok(+x.real)?nf(+x.real):'—',ok(+x.real)?sgnB(x.real-x.prev):'']),
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
    if(tipo==='juntas'||tipo==='todos'){const sj=secsBatJuntas(L);if(L.length>1)sj.depois=secsBatInsumo(L,rot);blobs.push(await gImagem(tit,sj));nomes.push(base+(tipo==='todos'?' (carregamentos juntos)':'')+'.png');}
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
  gExcel(`Fabricação-${rot.replace(/\//g,'-').replace(/ a /,'_a_')}`,[['Fabricação',['Data','Início carregamento','Hora insumo','Trato','Local','Ração','Insumo','Previsto (kg)','Carregado (kg)','Diferença (kg)','Balança início','Balança final'],r,[11,9,9,7,13,16,22,12,13,13,13,13]],
    ['Por carregamento',['Data','Início','Trato','Local','Ração','Previsto (kg)','Carregado (kg)','Diferença (kg)'],rb,[11,9,7,13,18,13,14,14]],
    ['Utilização de insumos',['Insumo','Previsto (kg)','Carregado (kg)','Diferença (kg)'],ri,[24,13,14,14]]]);};
/* Histórico › Batidas: ✎ editar (kg de cada insumo) e ✕ apagar, com a senha 1010 */
document.addEventListener('click',async e=>{const b=e.target.closest('[data-hbdel]');if(!b)return;if(typeof bloqueado==='function'&&bloqueado())return;
  if(window.HBSEL!=='ed'&&!await pedirSenhaAcao('Senha para excluir'))return;if(!await confirmaVermelho('Deseja realmente excluir este carregamento?','Some do histórico, dos relatórios e do estoque.','Sim, excluir','Não'))return;gDel(b.dataset.hbdel);toast('Carregamento excluído');if(typeof renderHist==='function')renderHist();});
document.addEventListener('change',e=>{const i=e.target.closest&&e.target.closest('[data-hbreal]');if(!i||window.HBSEL!=='ed')return;
  const [uid,ix]=i.dataset.hbreal.split('|'),c=G.it[uid];if(!c||c.del)return;const x=JSON.parse(JSON.stringify(c)),it=x.itens[+ix];if(!it)return;
  const v=gNum(i.value);if(i.value.trim()!==''&&!(v>=0&&v<=60000)){toast('Digite uma quantidade válida');i.value=ok(+it.real)?Math.round(+it.real):'';return;}
  window.HBPEND=window.HBPEND||{};window.HBPEND[i.dataset.hbreal]=i.value.trim();i.classList.add('mudou');});
/* Aplicar: grava o que mudou · Cancelar: volta tudo como estava */
document.addEventListener('click',e=>{const b=e.target.closest('[data-hbap]');if(!b)return;const P=window.HBPEND||{};let n=0;
  if(b.dataset.hbap==='ok'){const por={};Object.entries(P).forEach(([k,t])=>{const [uid,ix]=k.split('|');const c=G.it[uid];if(!c||c.del)return;
      if(!por[uid])por[uid]=JSON.parse(JSON.stringify(c));const it=por[uid].itens[+ix];if(!it)return;const v=t===''?null:gNum(t);if((ok(+it.real)?Math.round(+it.real):null)===(v==null?null:Math.round(v)))return;it.real=v;n++;});
    Object.values(por).forEach(x=>gPut(x));toast(n?`Realizado alterado em ${n} produto(s)`:'Nada foi alterado');}
  else toast(Object.keys(P).length?'Alteração cancelada: ficou como estava':'Cancelado');
  window.HBPEND={};window.HBSEL=null;if(typeof renderHist==='function')renderHist();});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-hbrmit]');if(!b||window.HBSEL!=='ed')return;
  const [uid,ix]=b.dataset.hbrmit.split('|'),c=G.it[uid];if(!c||c.del)return;const it=c.itens[+ix];if(!it)return;
  if(!await confirmaVermelho(`Deseja realmente excluir ${it.nome} deste carregamento?`,`${nf(+it.real||0)} kg carregado. Some do histórico, dos relatórios e do estoque.`,'Sim, excluir','Não'))return;
  const x=JSON.parse(JSON.stringify(c));x.itens.splice(+ix,1);if(!x.itens.length){gDel(uid);toast('Carregamento excluído');}else{x.total=x.itens.reduce((a,y)=>a+(+y.prev||0),0);gPut(x);toast(`${it.nome} excluído do carregamento`);}
  if(typeof renderHist==='function')renderHist();});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-hbed]');if(!b)return;if(typeof bloqueado==='function'&&bloqueado())return;const c=G.it[b.dataset.hbed];if(!c||c.del)return;
  if(!await pedirSenhaAcao('Senha para editar'))return;
  const f=document.createElement('div');f.className='cvFundo';
  /* editar a batida: muda o kg de cada produto, exclui um produto (✕) ou exclui a batida inteira */
  f.innerHTML=`<div class="cvCaixa gBatEd" style="border-color:#2e6b2f"><h3 style="color:#2e6b2f">✎ Editar carregamento · ${esc(diaBR(c.dia).slice(0,5))} ${esc(c.hora||'')}</h3>
    <label>Data<input type="date" id="bedDia" value="${esc(c.dia)}"></label><label>Hora<input type="time" id="bedHora" value="${esc(c.hora||'')}"></label>
    ${c.itens.map((x,i)=>`<div class="bedLin" data-bedlin="${i}"><label>${esc(x.nome)} · previsto ${nf(x.prev)} kg<input class="num" inputmode="decimal" data-bed="${i}" value="${ok(+x.real)?+x.real:''}" placeholder="kg carregado"></label></div>`).join('')}
    <p class="note" id="bedAviso"></p>
    <div class="cvBt"><button class="cvSim" style="background:#2e6b2f;border-color:#2e6b2f">Salvar</button><button class="cvNao">Cancelar</button></div></div>`;
  document.body.appendChild(f);f.querySelector('.cvNao').onclick=()=>f.remove();const rm=new Set();
  f.querySelectorAll('[data-bedrm]').forEach(bt=>bt.onclick=()=>{const i=+bt.dataset.bedrm,lin=f.querySelector(`[data-bedlin="${i}"]`);if(rm.has(i)){rm.delete(i);lin.classList.remove('bedRm');bt.textContent='✕';}else{rm.add(i);lin.classList.add('bedRm');bt.textContent='↩';}
    f.querySelector('#bedAviso').textContent=rm.size?`${rm.size} produto(s) serão excluídos ao salvar (↩ desfaz).`:'';});
  if(f.querySelector('.cvExc'))f.querySelector('.cvExc').onclick=async()=>{if(!await confirmaVermelho('Excluir o carregamento inteiro?','Some do histórico, dos relatórios e do estoque.','Sim, excluir','Não'))return;gDel(c.uid);f.remove();window.HBSEL=null;toast('Carregamento excluído');if(typeof renderHist==='function')renderHist();};
  f.querySelector('.cvSim').onclick=async()=>{const x=JSON.parse(JSON.stringify(c));f.querySelectorAll('[data-bed]').forEach(inp=>{const v=gNum(inp.value);x.itens[+inp.dataset.bed].real=ok(v)?v:null;});
    if(rm.size){const nomes=[...rm].map(i=>x.itens[i].nome).join(', ');if(!await confirmaVermelho(`Excluir ${rm.size} produto(s) do carregamento?`,nomes+'. Some do histórico, dos relatórios e do estoque.','Sim, excluir','Não'))return;
      x.itens=x.itens.filter((_,i)=>!rm.has(i));if(!x.itens.length){gDel(c.uid);f.remove();window.HBSEL=null;toast('Carregamento excluído');if(typeof renderHist==='function')renderHist();return;}
      x.total=x.itens.reduce((a,y)=>a+(+y.prev||0),0);}
    const d=f.querySelector('#bedDia').value,h=f.querySelector('#bedHora').value;if(d)x.dia=d;if(h)x.hora=h;gPut(x);f.remove();window.HBSEL=null;toast('Carregamento alterado');if(typeof renderHist==='function')renderHist();};});

/* ---------- Gestão › Currais: nome, tipo (confinamento/pasto) e ativo/inativo ---------- */
function tCurrais(){const A=window.curraisApi;if(!A)return '';const L=A.lista().map(n=>({n,i:A.info(n)}));
  const lotesEm=n=>gTodos('lote').filter(l=>cabPres(l,hojeKey())>0&&curralEm(l,hojeKey())===n).length;
  const item=x=>`<button class="gItem${x.i.inativo?' gInativa':''}" data-g="ir" data-t="curForm" data-id="${esc(x.n)}"><div class="gItemTopo"><b>${esc(x.n)}${x.i.tag?' <small title="Tem tag">🏷</small>':''}</b><span class="pill${lotesEm(x.n)?' done':''}">${x.i.inativo?'inativo':lotesEm(x.n)?lotesEm(x.n)+' lote(s)':'sem lote'}</span></div></button>`;
  const grupo=(tit,arr,k)=>{if(!arr.length)return '';const ab=gCurAb.has(k);return `<button type="button" class="gGrpCab${ab?' aberto':''}" data-g="curGrp" data-k="${k}"><span>${tit}</span><small>${arr.length} curral(is)</small><em class="gGrpDica">${ab?'clique para fechar':'clique para abrir'}</em><span class="gLoteSeta">▼</span></button>${ab?`<div class="gGrpCorpo">${arr.map(item).join('')}</div>`:''}`;};
  const at=L.filter(x=>!x.i.inativo),ina=L.filter(x=>x.i.inativo);
  return `<section class="panel"><h2>Currais</h2><p class="note">O local diz se o curral é do confinamento ou do pasto; vale para os filtros, o Carregar e o Fornecer. Inativo não aparece no Previsto, no Fornecer nem nos lotes (os registros continuam).</p>
    <div class="gAcoes"><button class="lima" data-g="ir" data-t="curForm">+ Novo curral</button><button class="primary" data-g="ir" data-t="mudCur">↔ Mudar animais de curral</button></div>
    ${grupo(ICO_C+' Confinamento',at.filter(x=>x.i.tipo==='C'),'C')}${grupo('🌿 Pasto',at.filter(x=>x.i.tipo==='P'),'P')}${grupo('Sem tipo',at.filter(x=>x.i.tipo!=='C'&&x.i.tipo!=='P'),'S')}${grupo('⏸ Inativos',ina,'I')}${mudHistHTML()}</section>`;}
/* ---------- histórico das mudanças de curral (recolhido no fim de Currais): editar e excluir pedem senha ---------- */
function mudHist(){const R=[];gTodos('lote').forEach(l=>{const cs=(l.curr||[]).slice().sort((a,b)=>a.desde<b.desde?-1:1);
  cs.forEach((x,i)=>{if(!i)return;const ant=cs[i-1];if(ant.c===x.c)return;R.push({l,desde:x.desde,de:x.de||ant.c,para:x.c,obs:x.obs||''});});});
  return R.sort((a,b)=>a.desde!==b.desde?(a.desde<b.desde?1:-1):alfa(a.l.nome,b.l.nome));}
function mudHistHTML(){const R=mudHist(),ab=gCurAb.has('M');
  const lin=r=>`<div class="gItem" style="cursor:default"><div class="gItemTopo"><b>${dB(r.desde)} · ${esc(r.de)} → ${esc(r.para)}</b><span class="pill">${esc(r.l.nome)}</span></div>
    ${r.obs?`<small style="display:block;white-space:pre-line">${esc(r.obs)}</small>`:''}
    ${typeof modoVer!=='undefined'&&modoVer?'':`<div class="row" style="margin-top:6px"><button class="mini" data-g="mudHEd" data-id="${r.l.uid}" data-o="${r.desde}">✏ Editar</button><button class="mini danger" data-g="mudHRm" data-id="${r.l.uid}" data-o="${r.desde}">🗑 Excluir</button></div>`}</div>`;
  return `<button type="button" class="gGrpCab${ab?' aberto':''}" data-g="curGrp" data-k="M"><span>📋 Mudanças de curral</span><small>${R.length} mudança(s)</small><em class="gGrpDica">${ab?'clique para fechar':'clique para abrir'}</em><span class="gLoteSeta">▼</span></button>${ab?`<div class="gGrpCorpo">${R.length?R.map(lin).join(''):'<p class="note">Nenhuma mudança registrada.</p>'}</div>`:''}`;}
function tMudEd(t){const l=G.it[t.id],x=l&&(l.curr||[]).find(z=>z.desde===t.o);if(!l||!x)return `${voltar('Currais')}<section class="panel"><p class="note">Mudança não encontrada.</p></section>`;
  const cs=(l.curr||[]).slice().sort((a,b)=>a.desde<b.desde?-1:1),i=cs.indexOf(x),de=x.de||(cs[i-1]||{}).c||'';
  return `${voltar('Currais')}<section class="panel"><h2>✏ Editar mudança de curral</h2><p class="note"><b>${esc(l.nome)}</b> · saiu do ${esc(de)}</p>
    <div class="gForm">${[{k:'meD',l:'Curral de destino',t:'sel',busca:1,op:opCurrais(x.c,false),v:x.c},{k:'meDia',l:'A partir de',t:'dia',v:x.desde}].map(campo).join('')}
      <div class="gCampo"><label for="gf_meObs">Observação</label><textarea id="gf_meObs" rows="2" style="width:100%;box-sizing:border-box;resize:vertical;font:inherit">${esc(x.obs||'')}</textarea></div></div>
    <button class="primary" data-g="mudHSalva" data-id="${l.uid}" data-o="${x.desde}">Salvar alteração</button></section>`;}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-g="mudHEd"],[data-g="mudHRm"],[data-g="mudHSalva"]');if(!b)return;e.preventDefault();e.stopPropagation();
  if(typeof bloqueado==='function'&&bloqueado())return;const a=b.dataset.g,id=b.dataset.id,desde=b.dataset.o,l0=G.it[id];if(!l0)return toast('Lote não encontrado');
  if(a==='mudHEd'){if(window.pedirSenhaAcao&&!await pedirSenhaAcao('Senha para editar'))return;GT={t:'mudEd',id,o:desde};gRender();window.scrollTo({top:0});return;}
  if(a==='mudHRm'){if(window.pedirSenhaAcao&&!await pedirSenhaAcao('Senha para excluir'))return;
    const x=(l0.curr||[]).find(z=>z.desde===desde);if(!x)return;const cs=(l0.curr||[]).slice().sort((p,q)=>p.desde<q.desde?-1:1),ant=cs[cs.indexOf(x)-1];
    if(!await confirmaVermelho('Excluir esta mudança de curral?',`${l0.nome}: ${x.de||(ant||{}).c||''} → ${x.c} em ${dB(desde)}. O lote volta a ficar no ${(ant||{}).c||'curral anterior'} a partir dessa data.`,'Sim, excluir','Não'))return;
    const l=JSON.parse(JSON.stringify(l0));l.curr=(l.curr||[]).filter(z=>z.desde!==desde);gPut(l);recalcCurral(x.c,desde);if(ant)recalcCurral(ant.c,desde);
    toast('Mudança excluída');const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='mudHSalva'){const para=fv('meD'),d=fv('meDia'),obs=(($('gf_meObs')||{}).value||'').trim();if(!para||!d)return toast('Escolha o destino e a data');
    if(d<l0.ent.dia)return toast('A data é antes da entrada do lote');const l=JSON.parse(JSON.stringify(l0)),x=(l.curr||[]).find(z=>z.desde===desde);if(!x)return;
    if(d!==desde&&l.curr.some(z=>z.desde===d))return toast('Já tem outra mudança deste lote nessa data');
    const velho=x.c;l.curr=l.curr.filter(z=>z.desde!==desde);const n={c:para,de:x.de,ts:x.ts||Date.now(),ed:Date.now()};if(obs)n.obs=obs;Object.keys(n).forEach(k=>n[k]==null&&delete n[k]);setHist(l.curr,d,n);gPut(l);
    const d0=d<desde?d:desde;[velho,para,x.de].filter(Boolean).forEach(c=>recalcCurral(c,d0));toast('Mudança alterada');GT={t:'currais'};gCurAb.add('M');gRender();window.scrollTo({top:0});}},true);
function tCurForm(t){const A=window.curraisApi,n=t.id||'',i=n?A.info(n):{tipo:'C',inativo:false};
  return `${voltar()}<section class="panel"><h2>${n?'Curral '+esc(n):'Novo curral'}</h2>
    <div class="gForm">${campo({k:'cnome',l:'Nome do curral',v:n,ph:'Ex.: C-11 ou P-REPRESA-2'})}
    ${campo({k:'ctipo',l:'Local',t:'sel',op:[['C','🏠 Confinamento'],['P','🌿 Pasto']],v:i.tipo==='P'?'P':'C'})}
    ${n?'':campo({k:'catv',l:'Situação',t:'sel',op:[['1','Ativo'],['0','Inativo (pausado)']],v:i.inativo?'0':'1'})}
    ${n?'':`<p class="note gCampo"><b>Inativo</b> só tira o curral do previsto, do carregar, do fornecer e da leitura de cocho. Não apaga nada: o lote, os custos e o histórico continuam, dá para lançar a venda e tirar o relatório normalmente, e você pode voltar para <b>Ativo</b> quando quiser.</p>`}
    <div class="gCampo"><label for="gf_ctag">Tag do curral (leitor de tag)</label><div class="gTagLin"><input type="text" id="gf_ctag" value="${esc(i.tag||'')}" placeholder="Ex.: E28011C1200001D461D50375" autocomplete="off" autocapitalize="characters"><button type="button" class="mini lima" data-g="lerTag">🏷 Ler tag</button></div><p class="note" id="gTagMsg">Toque em Ler tag e passe o leitor na tag deste curral. Pode também digitar o código.</p></div></div>
    <button class="primary" data-g="salvaCur" data-id="${esc(n)}">Salvar curral</button></section>
    ${n?`<section class="panel"><h2>Situação</h2><p class="note">${i.inativo?'<b>Inativo (pausado)</b>: não aparece no previsto, carregar, fornecer nem leitura. Nada foi apagado: lote, custos e histórico continuam, e dá para lançar venda e relatório normalmente.':'<b>Ativo</b>: aparece no previsto, carregar, fornecer e leitura. Inativar só pausa: não apaga nada e dá para reativar quando quiser.'}</p>
      <button class="${i.inativo?'lima':'danger'}" data-g="curAtiva" data-id="${esc(n)}">${i.inativo?'✓ Reativar curral':'⏸ Inativar curral'}</button>
      ${(()=>{const u=curUsoTxt(n);return u?`<p class="note">Não dá para apagar: já foi usado (${esc(u)}). Se não vai usar mais, deixe inativo.</p>`:`<button class="danger" data-g="apagaCur" data-id="${esc(n)}">🗑 Apagar curral</button><p class="note">Só aparece porque este curral nunca teve lote, trato nem leitura.</p>`;})()}</section>`:''}`;}
document.addEventListener('click',e=>{const b=e.target.closest('#gBox [data-g="salvaCur"]');if(!b)return;if(typeof bloqueado==='function'&&bloqueado())return;
  const A=window.curraisApi,n=b.dataset.id,nome=fv('cnome'),tag=String(fv('ctag')).toUpperCase().replace(/[^0-9A-F]/g,''),info={tipo:fv('ctipo')==='P'?'P':'C',inativo:$('gf_catv')?fv('catv')==='0':!!(n&&A.info(n).inativo),tag};
  if(tag&&tag.length<8)return toast('Tag muito curta: confira o código');
  if(tag){const outro=A.lista().find(x=>x!==n&&String(A.info(x).tag||'').toUpperCase()===tag);if(outro)return toast(`Esta tag já está no ${outro}`);}
  if(window.tagCaptura)tagCaptura(null);
  const erro=n?A.salvar(n,nome,info):A.novo(nome,info);if(erro)return toast(erro);toast('Curral salvo');gVoltar();},true);

document.addEventListener('click',e=>{const b=e.target.closest('#gBox [data-g="lerTag"]');if(!b)return;const inp=$('gf_ctag'),m=$('gTagMsg');if(!inp)return;
  if(!window.tagCaptura){toast('Leitor de tag indisponível');return;}
  tagCaptura('gf_ctag',m);},true);
/* novo lote: escolheu Confinamento ou Pasto → a lista mostra só os currais desse tipo */
document.addEventListener('change',e=>{if(e.target.id==='gf_sistema'&&GT.t==='entNova')GT.sis=e.target.value;if(e.target.id!=='gf_sistema'||(GT.t!=='loteForm'&&GT.t!=='entNova'))return;const c=$('gf_curral');if(!c)return;
  const ops=opCurraisTipo(tipoDoSistema(e.target.value));c.innerHTML=ops.map(([v,t])=>`<option value="${esc(v)}">${esc(t)}</option>`).join('');});

/* Lotes: exportar a lista (com o filtro de local) em imagem e Excel */
function linhasLotes(enc){const hj=hojeKey(),X=gCtx(),loc=gLoc,noLocal=l=>loc==='T'||linhaDe(curralEm(l,fimLote(l)||hj))===loc;
  const todos=gTodos('lote').filter(noLocal),L=enc?todos.filter(l=>!ativo(l)).sort(porNome):todos.filter(ativo).sort(porCurral);
  return L.map(l=>{const fim=fimLote(l),ref=fim&&fim<hj?fim:hj,m=mediaLote(l,X),C=calcLote(l),r=racaoEm(l,ref);
    return {c:curralEm(l,ref)||'',nome:l.nome,desc:[sexoTxt(l.sexo),l.raca,catNorm(l.cat)].filter(Boolean).join(' · '),rac:r?r.nome:'',cab:cabPres(l,ref),pe:pesoEntMed(l)||0,pp:pesoEm(l,ref),
      dias:Math.max(0,difDias(l.ent.dia,ref)),dct:m.n,...(()=>{const A=ativo(l)?projAbate(l):null;return A?{pf:A.peso,ad:A.dia,af:difDias(hj,A.dia),apor:A.por}:{pf:NaN,ad:'',af:NaN,apor:''};})(),mn:m.n?m.mn/m.n:NaN,ms:m.nms?m.ms/m.nms:NaN,ims:m.nms?m.pv/m.nms:NaN,...(()=>{const V=vendaEst(l,C),cb=cabPres(l,ref),dd=Math.max(0,difDias(l.ent.dia,ref)),rc=ok(V.res)&&cb?V.res/cb:NaN;return {ve:V.venda,vr:V.res,vreal:!!V.real,rc,rcd:ok(rc)&&dd?rc/dd:NaN};})(),cd:C.custoCabDia,ctr:C.cabE?(C.alim+C.op)/C.cabE:NaN,cco:C.cabE?C.compra/C.cabE:NaN,ct:C.cabE?C.custo/C.cabE:NaN,tot:C.custo,ent:l.ent.dia,fim:fim||''};});}
document.addEventListener('click',e=>{const b=e.target.closest('#gBox [data-g="lotesImg"],#gBox [data-g="lotesXls"],#gBox [data-g="lotesPdf"]');if(!b)return;e.stopPropagation();lotesExp(b.dataset.g,!!b.dataset.enc);},true);
function lotesExp(g,enc){const b={dataset:{g}};
  const R=linhasLotes(enc),loc=gLoc==='C'?' · Confinamento':gLoc==='P'?' · Pasto':'',tit=`${enc?'Lotes arquivados':'Lotes ativos'}${loc} · ${dB(hojeKey())}`;
  if(!R.length)return toast('Nenhum lote');
  window.__expPdf=b.dataset.g==='lotesPdf';
  if(b.dataset.g==='lotesImg'||b.dataset.g==='lotesPdf'){
    /* linha TOTAL: nº de lotes, soma das cabeças e média (pelas cabeças) do resto; custo, venda e resultado vão num quadro separado embaixo */
    const cabT=R.reduce((a,x)=>a+(+x.cab||0),0),med=(f,d)=>{let s=0,n=0;R.forEach(x=>{const v=f(x);if(ok(v)&&x.cab>0){s+=v*x.cab;n+=x.cab;}});return n?s/n:NaN;},
      som=f=>R.reduce((a,x)=>a+(ok(f(x))?f(x):0),0),mostra=(v,fn)=>ok(v)?fn(v):'—';
    const cT=som(x=>x.tot),temV=R.some(x=>ok(x.ve)),vT=temV?som(x=>x.ve):NaN,rT=temV?som(x=>x.vr):NaN;
    return enviarImg(tit,[{cab:tit,cols:[['Curral',100,'l'],['Lote',200,'l'],['Ração',170,'l'],['Cab',65,'r'],['Peso entr.',100,'r'],['Peso proj.',100,'r'],['Dias',60,'r'],['Peso final',100,'r'],['Prev. abate',110,'r'],['Dias c/ trato',115,'r'],['MN/cab',85,'r'],['MS/cab',85,'r'],['% IMS',90,'r'],['Custo/cab/dia',150,'r'],['Custo/cab/total',160,'r'],['Custo/compra/cab',170,'r'],['Custo/lote/total',165,'r'],['Venda estimada',160,'r'],['Resultado estimado',185,'r'],['Resultado/cab/total',190,'r'],['Resultado/cab/dia',175,'r']],
    linhas:R.map(x=>[x.c,x.nome,x.rac||'—',nf(x.cab),nf(x.pe),nf(x.pp),nf(x.dias),ok(x.pf)?nf(x.pf):'—',x.ad?dB(x.ad):'—',nf(x.dct),ok(x.mn)?nf(x.mn,1):'—',ok(x.ms)?nf(x.ms,2):'—',ok(x.ims)?pc(x.ims,2):'—',ok(x.cd)?rs(x.cd):'—',ok(x.ctr)?rs(x.ctr):'—',ok(x.cco)?rs(x.cco):'—',rs(x.tot),ok(x.ve)?rs(x.ve):'—',ok(x.vr)?rs(x.vr):'—',ok(x.rc)?rs(x.rc):'—',ok(x.rcd)?rs(x.rcd):'—']),
    total:['TOTAL',`${R.length} lote(s)`,'',nf(cabT),mostra(med(x=>x.pe),v=>nf(v)),mostra(med(x=>x.pp),v=>nf(v)),mostra(med(x=>x.dias),v=>nf(v)),mostra(med(x=>x.pf),v=>nf(v)),'','',mostra(med(x=>x.mn),v=>nf(v,1)),mostra(med(x=>x.ms),v=>nf(v,2)),mostra(med(x=>x.ims),v=>pc(v,2)),mostra(med(x=>x.cd),rs),mostra(med(x=>x.ctr),rs),mostra(med(x=>x.cco),rs),'','','',mostra(med(x=>x.rc),rs),mostra(med(x=>x.rcd),rs)]},
    {cab:'Somatório dos lotes',cols:[['Custo/lote/total',390,'c'],['Venda estimada',390,'c'],['Resultado estimado',390,'c'],['Resultado/cab/total',390,'c']],linhas:[[rs(cT),mostra(vT,rs),mostra(rT,rs),mostra(ok(rT)&&cabT?rT/cabT:NaN,rs)]],cores:[[null,null,!ok(rT)?null:rT<0?'#b3261e':'#2e7d32',!ok(rT)?null:rT<0?'#b3261e':'#2e7d32']]}],`Lotes ${dB(hojeKey()).replace(/\//g,'-')}`);}
  gExcel(`Lotes ${dB(hojeKey()).replace(/\//g,'-')}`,[['Lotes',['Curral','Lote','Sexo · raça · categoria','Ração','Entrada','Arquivado em','Cabeças','Peso entrada (kg)','Peso projetado (kg)','Dias','Peso final projetado (kg)','Previsão de abate','Dias para o abate','Abate calculado pelo','Dias com trato','MN/cab (média)','MS/cab (média)','% IMS (média)','Custo/cab/dia','Custo/cab/total (tratos)','Custo/compra/cab','Custo/cab com compra','Custo/lote/total','Venda estimada (ou real)','Resultado estimado (ou real)','Resultado/cab/total','Resultado/cab/dia'],
    R.map(x=>[xc(x.c),xc(x.nome),xc(x.desc),xc(x.rac),xc(x.ent,'dia'),xc(x.fim,'dia'),xc(x.cab,'int'),xc(x.pe,'int'),xc(x.pp,'int'),xc(x.dias,'int'),xc(x.pf,'int'),xc(x.ad,'dia'),xc(x.af,'int'),xc(x.apor),xc(x.dct,'int'),xc(x.mn,'dec'),xc(x.ms,'dec'),xc(ok(x.ims)?x.ims/100:NaN,'pct'),xc(x.cd,'rs'),xc(x.ctr,'rs'),xc(x.cco,'rs'),xc(x.ct,'rs'),xc(x.tot,'rs'),xc(x.ve,'rs'),xc(x.vr,'rs'),xc(x.rc,'rs'),xc(x.rcd,'rs')]),[10,22,26,16,11,12,9,11,12,7,13,12,10,14,10,11,11,10,12,14,13,14,14,16,16,14,14]]]);}

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
    <p class="note"><b>Compra</b>: preço da @ e rendimento de carcaça na compra (só muda nos lotes com a compra liberada no cadastro; 🔒 = bloqueada; 🔄 = veio de venda interna, mostra o R$/@ equivalente ao valor total da transferência). Conta: peso × rendimento ÷ 15 × preço da @ (50% = peso vivo ÷ 30). Vai para o valor de compra do lote.<br><b>Venda</b>: rendimento e preço da @ da venda, sempre pelo peso atual projetado.<br>São os mesmos campos do cadastro do lote. Mude um por um ou aplique a todos da lista e toque em Salvar.</p>
    ${(()=>{const A=gTodos('lote').filter(ativo);return locBotoes('evLoc',lt,k=>A.filter(l=>doLocal(k,curralEm(l,hj))).length);})()}
    <div class="gEvTodos2">
      <div class="gEvGrp"><b>Compra · aplicar a todos</b><div><input class="gRs" id="gEcPrT" inputmode="numeric" placeholder="R$ @"><input class="cell num" id="gEcRcT" inputmode="decimal" placeholder="Rend. %"></div><button class="lima" data-g="ecTodos">Aplicar compra</button></div>
      <div class="gEvGrp"><b>Venda · aplicar a todos</b><div><input class="cell num" id="gEvRcT" inputmode="decimal" placeholder="Rend. %"><input class="gRs" id="gEvPrT" inputmode="numeric" placeholder="R$ @"></div><button class="lima" data-g="evTodos">Aplicar venda</button></div></div>
    ${L.length?`<div class="gEvLista"><div class="gEvLin2 gEvCab"><span class="gEvC">Compra<br>R$ @</span><span class="gEvC">Compra<br>rend. %</span><span class="gEvV">Venda<br>rend. %</span><span class="gEvV">Venda<br>R$ @</span></div>
    ${L.map(l=>{const e=l.ent||{},u=l.uid;return `<div class="gEvItem"><div class="gEvNome"><b>${esc(curralEm(l,hj)||'')}</b> <small>${esc(l.nome)} · ${nf(cabAtual(l))} cab · entrada ${nf(pesoEntMed(l)||0)} kg · hoje ${nf(pesoEm(l,hj))} kg${e.unid==='transf'?' · veio de venda interna':e.unid&&e.unid!=='arroba'?` · compra em ${e.unid==='cab'?'R$/cab':e.unid==='arrV'?'R$/@ viva':'R$/kg'}`:''}</small></div>
      <div class="gEvLin2${l.compraGrupo!==false&&e.unid!=='transf'?'':' gEvTrava'}">${e.unid==='transf'?(()=>{const arr=(+e.cab||0)*(+e.peso||0)*(+e.rcC||50)/100/15,pa=arr>0?(+e.preco||0)/arr:NaN;   /* venda interna: o valor guardado é o TOTAL da transferência, não o R$/@ — mostra o R$/@ equivalente e não deixa mudar aqui */
        return `<span class="gEvLock" title="Venda interna: valor total ${rs(+e.preco||0)}">🔄 ${ok(pa)?rsIn(pa):'—'}</span><span class="gEvLock">🔄 ${vIn(e.rcC||50)}%</span>`;})():l.compraGrupo!==false?inp('gRs','data-ecpr',u,e.preco?rsIn(+e.preco):'','R$ 0,00','numeric')+inp('cell num','data-ecrc',u,vIn(e.rcC||50),'50','decimal'):`<span class="gEvLock" title="Compra bloqueada no cadastro do lote">🔒 ${e.preco?rsIn(+e.preco):'—'}</span><span class="gEvLock">🔒 ${vIn(e.rcC||50)}%</span>`}${inp('cell num','data-evrc',u,l.rcPrev?vIn(l.rcPrev):'',vIn(gCfg().rc||''),'decimal')}${inp('gRs','data-evpr',u,rsIn(l.simPreco?+l.simPreco:NaN),'R$ 0,00','numeric')}</div></div>`;}).join('')}
    </div><button class="primary" data-g="evSalvar">Salvar estimativas</button>`:'<p class="note">Nenhum lote ativo.</p>'}</section>`;}

/* =====================================================================================
   ESTOQUE dos insumos: entradas e saídas manuais + saídas automáticas pelas batidas
   - movimento manual: {tipo:'estmov', dia, ins, mov:'ent'|'sai'|'inv', kg, rs (valor da entrada), obs}
   - 'inv' = contagem: o saldo daquele dia passa a ser o que foi contado
   - cada batida salva tira do estoque o realizado de cada produto (ou o previsto, se não tiver realizado)
   - as batidas só contam a partir do primeiro lançamento do produto no estoque
   ===================================================================================== */
const MOV_NOME={ent:'Entrada',sai:'Saída manual',inv:'Contagem',bat:'Carregamento'};
function movsEstoque(insId){const M=gTodos('estmov').filter(m=>m.ins===insId).map(m=>({uid:m.uid,dia:m.dia,mov:m.mov,kg:+m.kg||0,rs:+m.rs||0,obs:m.mov==='ent'?entTxt(m):(m.obs||''),forn:m.mov==='ent'?entForn(m):'',nota:m.mov==='ent'?entNota(m):'',manual:true,ts:m.ts||0,nf:m.nf||null}));
  if(!M.length)return [];const ini=M.reduce((a,m)=>m.dia<a?m.dia:a,M[0].dia);
  gTodos('carga').forEach(c=>{if(!c.dia||c.dia<ini)return;let kg=0;(c.itens||[]).forEach(x=>{if(x.ins===insId)kg+=ok(+x.real)&&x.real!==null?+x.real:(+x.prev||0);});
    if(kg>0)M.push({uid:c.uid,dia:c.dia,mov:'bat',kg,obs:`${c.avulso?'Carregamento avulso':'Trato '+((c.tratos||[c.trato]).join('+'))} · ${c.racNome||''}${c.hora?' · '+c.hora:''}`,ts:c.ts0||0});});
  M.sort((a,b)=>a.dia<b.dia?-1:a.dia>b.dia?1:(a.ts-b.ts));  // no mesmo dia: na ordem em que foi lançado
  let sd=0;M.forEach(m=>{if(m.mov==='inv'){m.dif=m.kg-sd;sd=m.kg;}else sd+=m.mov==='ent'?m.kg:-m.kg;m.saldo=sd;});return M;}
function estoqueIns(i){const M=movsEstoque(i.uid),hj=hojeKey(),d7=somaDias(hj,-6);
  const saldo=M.length?M[M.length-1].saldo:null,cons=M.filter(m=>(m.mov==='bat'||m.mov==='sai')&&m.dia>=d7&&m.dia<=hj).reduce((a,m)=>a+m.kg,0)/7;
  return {M,saldo,cons,dias:cons>0&&saldo>0?saldo/cons:NaN,ult:M.length?M[M.length-1]:null,min:+i.estMin||0};}
/* cor do estoque pelos dias que dá: menos de 7 = vermelho · 7 a 15 = amarelo · 15 ou mais = verde */
function estCor(e){if(e.saldo==null)return '';if(e.saldo<=0)return 'r';if(!ok(e.dias))return 'v';return e.dias<7?'r':e.dias<15?'a':'v';}
function tEstoque(){const I=gTodos('insumo').filter(i=>!i.inativo).sort(porNome),hj=hojeKey();
  const L=I.map(i=>({i,e:estoqueIns(i)}));
  const item=({i,e})=>{const cor=estCor(e),baixo=cor==='r',abMin=e.saldo!=null&&e.min&&e.saldo<e.min;
    const neg=e.saldo!=null&&e.saldo<0;   /* estoque negativo: quadro todo vermelho, letras brancas */
    return `<button class="gItem gEstIt${cor?' gEstC'+cor:''}${neg?' gEstNeg':''}" data-g="ir" data-t="estIns" data-id="${i.uid}"><div class="gItemTopo"><b>${esc(i.nome)}</b><span class="gEstSaldo">${e.saldo==null?'sem lançamento':'<small class="gEstSL">saldo</small>'+nf(e.saldo)+' kg'}</span></div>
      <small class="gEstLin">${e.saldo==null?'Lance uma entrada ou uma contagem para começar o controle.':`<span class="gEstSt">${neg?'⛔ Estoque negativo':cor==='r'?'⚠ Estoque baixo':cor==='a'?'⚠ Estoque atenção':'✓ Estoque ok'}</span><span class="gEstFz">finaliza em</span><span class="gEstDias">${ok(e.dias)?`~${nf(e.dias,1)} dia${Math.round(e.dias*10)===10?'':'s'}`:'—'}</span><span class="gEstRest">${[abMin&&!baixo?'abaixo do mínimo':'',e.cons>0?`consumo ${nf(e.cons)} kg/dia (média 7 dias)`:'sem consumo nos últimos 7 dias',e.min?`mínimo ${nf(e.min)} kg`:''].filter(Boolean).join(' · ')}</span>`}</small></button>`;};
  return `<section class="panel"><div class="curhead"><h2>Estoque</h2><span class="note">${dB(hj)}</span></div>
    <div class="gEstBtns gEst4"><button class="gBtV" data-g="ir" data-t="estForm" data-mov="ent">＋ Entrada</button><button class="gBtV" data-g="nfNova">📎 ＋ NF</button><button class="gBtR" data-g="ir" data-t="estForm" data-mov="sai">－ Saída</button><button class="gBtA" data-g="ir" data-t="estForm" data-mov="inv">Contagem</button></div>
    <div class="gEstBtns gEst3"><button class="gBtC" data-g="ir" data-t="insumos">🌽 Insumos</button><button class="gBtC" data-g="ir" data-t="fornec">🏢 Fornecedores</button><button class="gBtA" data-g="estIrRel">📋 Relatório</button></div>
    ${L.map(item).join('')||'<p class="note">Cadastre os insumos primeiro (Gestão › Insumos).</p>'}
    <p class="note">Os carregamentos salvos tiram do estoque automaticamente o realizado de cada produto (ou o previsto, se não tiver realizado). Contagem: o saldo do dia passa a ser o que foi contado (acerto). Toque no produto para ver o saldo, o consumo e o estoque mínimo.</p></section>
  ${L.length?estMovHTML():''}`;}
/* todas as movimentações do estoque (todos os produtos), com período e ordem */
/* período: um seletor com setas (7, 30, 60 dias, Tudo ou Período escolhendo as datas) */
const PER_OPS=[[7,'Últimos 7 dias'],[30,'Últimos 30 dias'],[60,'Últimos 60 dias'],[0,'Todos'],[-1,'Escolher datas']];
const perNorm=v=>PER_OPS.some(o=>o[0]===v)?v:30;
function perFaixa(per,k){const hj=hojeKey();if(per===-1){const a=GT[k+'De']||somaDias(hj,-29),b=GT[k+'Ate']||hj;return a<=b?[a,b]:[b,a];}return [per>0?somaDias(hj,-(per-1)):'0000','9999-99'];}
function perTexto(per,k){if(per===-1){const [a,b]=perFaixa(per,k);return `${dB(a)} a ${dB(b)}`;}return per>0?`últimos ${per} dias`:'todos os dias';}
function perSelHTML(per,k){const i=Math.max(0,PER_OPS.findIndex(o=>o[0]===per)),[a,b]=perFaixa(per,k);
  return `<div class="gCoLocNav">${selSetas('Período',PER_OPS,i,`data-g="perP" data-k="${k}" data-n`,`data-persel="${k}"`)}</div>${per===-1?`<div class="gPerDatas"><label>De<input type="date" data-perd="${k}De" value="${a}"></label><label>Até<input type="date" data-perd="${k}Ate" value="${b}"></label></div>`:''}`;}
/* páginas das movimentações: mostrar 20 / 50 / 100 / 200 por página */
const PG_OPS=[20,50,100,200];
function paginar(L,k){const n=PG_OPS.includes(GT[k+'N'])?GT[k+'N']:20,tp=Math.max(1,Math.ceil(L.length/n)),p=Math.min(Math.max(1,GT[k+'P']||1),tp);GT[k+'P']=p;
  const sel=`<div class="gPagSel"><span>Mostrar</span>${PG_OPS.map(x=>`<button type="button" class="mini${x===n?' sel':''}" data-g="pgN" data-k="${k}" data-v="${x}">${x}</button>`).join('')}</div>`;
  const nav=tp>1?`<div class="gPagNav"><button type="button" class="gSeta" data-g="pgP" data-k="${k}" data-n="-1"${p<=1?' disabled':''} aria-label="Página anterior">◀</button><span><em>Página <b>${p}</b> de ${tp}</em><small>${(p-1)*n+1}–${Math.min(p*n,L.length)} de ${L.length}</small></span><button type="button" class="gSeta" data-g="pgP" data-k="${k}" data-n="1"${p>=tp?' disabled':''} aria-label="Próxima página">▶</button></div>`:`<p class="note gPagTot">${L.length} movimentação(ões)</p>`;
  return {itens:L.slice((p-1)*n,p*n),sel,nav};}
/* relatório do Estoque: filtros de período, tipo (entrada/saída), produto e fornecedor */
const EST_TIPO=[['','Todas'],['ent','Entradas'],['sai','Saídas']];
/* filtros do relatório do estoque: tipo (caixa), produto e fornecedor (digita e escolhe na lista) */
function estFiltros(){const tipo=EST_TIPO.some(o=>o[0]===GT.tipoE)?GT.tipoE:'',fo=String(GT.fornE||'').trim(),pq=String(GT.prodE||'').trim(),ob=String(GT.obsE||'').trim();
  const todos=gTodos('insumo').sort(porNome),exato=pq&&todos.find(i=>fSem(i.nome)===fSem(pq));
  const I=exato?[exato]:todos.filter(i=>pq?fSem(i.nome).includes(fSem(pq)):!i.inativo);return {tipo,fo,pq,ob,I,ins:exato?exato.uid:''};}
/* movimentações: sempre duas datas (De · Até), começando no dia de hoje; para ver mais para trás, troca as datas */
function estMovs(){{const hj=hojeKey();if(GT.perEDia!==hj){GT.perEDia=hj;GT.perEDe=hj;GT.perEAte=hj;}}GT.perE=-1;const per=-1,[de,ate]=perFaixa(per,'perE'),novo=GT.ordE!=='antigo',{tipo,fo,pq,ob,I,ins}=estFiltros();
  const passa=m=>(!tipo||(tipo==='ent'&&m.mov==='ent')||(tipo==='sai'&&(m.mov==='bat'||m.mov==='sai')))
    &&(!fo||(m.mov==='ent'&&fSem(m.forn).includes(fSem(fo))))
    &&(!ob||fSem(m.obs||'').includes(fSem(ob)));   // observação: qualquer pedaço do que foi escrito
  const L=[],P=[];I.forEach(i=>{const e=estoqueIns(i);
    const ant=e.M.filter(m=>m.dia<de),fim=e.M.filter(m=>m.dia<=ate);P.push({i,ini:ant.length?ant[ant.length-1].saldo:0,fim:fim.length?fim[fim.length-1].saldo:null});
    e.M.forEach((m,k)=>{if(m.dia>=de&&m.dia<=ate&&passa(m))L.push(Object.assign({nome:i.nome,k},m));});});
  L.sort((a,b)=>a.dia.localeCompare(b.dia)||(a.ts||0)-(b.ts||0)||a.nome.localeCompare(b.nome)||a.k-b.k);if(novo)L.reverse();
  const kg=k=>L.filter(m=>k.includes(m.mov)).reduce((a,m)=>a+m.kg,0),vEnt=L.filter(m=>m.mov==='ent').reduce((a,m)=>a+(+m.rs||0),0),kgV=L.filter(m=>m.mov==='ent'&&m.rs>0).reduce((a,m)=>a+m.kg,0);
  const filtro=[perTexto(per,'perE'),tipo?EST_TIPO.find(o=>o[0]===tipo)[1].toLowerCase():'',pq?(ins?G.it[ins].nome:'produto "'+pq+'"'):'',fo?'fornecedor '+fo:'',ob?'observação "'+ob+'"':''].filter(Boolean).join(' · ');
  return {L,per,novo,tipo,ins,fo,pq,ob,de,ate,P,filtro,tot:{ent:kg(['ent']),bat:kg(['bat']),sai:kg(['sai']),vEnt,pm:kgV>0?vEnt/kgV:NaN,nInv:L.filter(m=>m.mov==='inv').length}};}
const movSinal=m=>(m.mov==='ent'?'+':m.mov==='inv'?'=':'−')+nf(m.kg);
const movDet=m=>[m.obs||'',m.mov==='inv'&&ok(m.dif)?`acerto ${m.dif>=0?'+':''}${nf(m.dif)} kg`:'',m.mov==='ent'&&m.rs?rs(m.rs)+(m.kg?` (${rs(m.rs/m.kg)}/kg)`:''):''].filter(Boolean).join(' · ');
function estMovHTML(){const D=estMovs(),{L,per,novo,tipo,ins,fo,pq,ob,tot}=D,PGE=paginar(L,'pgE'),[pa,pb]=perFaixa(per,'perE');
  const P1=ins?D.P[0]:null,mostraSai=tipo!=='ent'&&!fo,mostraEnt=!tipo||tipo==='ent';
  const ed=m=>m.manual?` <button class="mini" data-g="ir" data-t="estForm" data-id="${m.uid}" aria-label="Editar">✎</button> <button class="mini danger" data-g="estRm" data-id="${m.uid}" aria-label="Apagar">✕</button>`:'';
  const ab=gMinAb.has('estRel');
  return `<section class="panel gEstRel gMinz${ab?' aberto':''}" data-min-k="estRel"><div class="curhead gMinzCab"><h2>📋 Movimentações</h2><span class="note">${L.length}</span><em class="gGrpDica">${ab?'clique para fechar':'clique para abrir'}</em></div>
    <div class="gPerDatas gEstDatas"><div><small>Período · de</small><label class="gDataBox gDiaCampo"><span>${dB(pa)}</span><input type="date" data-perd="perEDe" value="${pa}"></label></div><div><small>até</small><label class="gDataBox gDiaCampo"><span>${dB(pb)}</span><input type="date" data-perd="perEAte" value="${pb}"></label></div></div>
    <div class="gForm gEstFil">${campo({k:'tipoF',l:'Tipo',t:'sel',op:EST_TIPO,v:tipo})}
      ${campo({k:'prodF',l:'Produto',v:pq,sug:'prodF',ph:'Todos · digite para procurar'})}${campo({k:'fornF',l:'Fornecedor',v:fo,sug:'fornF',ph:'Todos · digite para procurar'})}${campo({k:'obsF',l:'Observação',v:ob,ph:'Todas · digite para procurar'})}</div>
    ${tipo||pq||fo||ob?`<button type="button" class="mini gEstLimpa" data-g="estFilLimpa">✕ Limpar filtros</button>`:''}
    <div class="stat gStat3">${mostraEnt?st('Entradas',nf(tot.ent)+' kg'+(tot.vEnt?`<small>${rs(tot.vEnt)}${ok(tot.pm)?' · '+rs(tot.pm)+'/kg':''}</small>`:'')):''}${mostraSai?st('Carregamentos',nf(tot.bat)+' kg')+st('Saídas manuais',nf(tot.sai)+' kg'):''}${P1?st('Saldo no início',nf(P1.ini)+' kg')+st('Saldo no fim',P1.fim==null?'—':nf(P1.fim)+' kg'):''}</div>
    <div class="row compart fz3"><button class="verde" data-g="estPdf">📄 PDF</button><button class="verde" data-g="estImg">🖼 Foto</button><button class="verde" data-g="estXls">📊 Excel</button></div>
    <div class="linhas gFiltro"><button data-g="estOrd" data-o="novo" class="${novo?'sel':''}">↓ Mais novo primeiro</button><button data-g="estOrd" data-o="antigo" class="${novo?'':'sel'}">↑ Mais antigo primeiro</button></div>
    ${L.length?`${PGE.sel}<div class="tablebox"><table class="gTab gEstTab"><thead><tr><th>Dia</th><th>Produto · movimento</th><th>kg</th><th>Saldo</th></tr></thead><tbody>${PGE.itens.map(m=>`<tr><td class="hora">${dB(m.dia).slice(0,5)}</td><td class="c">${esc(m.nome)}<small>${MOV_NOME[m.mov]}${movDet(m)?' · '+esc(movDet(m)):''}${m.nf&&m.nf.id?` <button class="mini" data-g="nfVer" data-id="${esc(m.nf.id)}" data-mini="${esc(m.nf.idMini||'')}">📎 NF</button>`:''}${ed(m)}</small></td><td class="${m.mov==='ent'?'ok':m.mov==='inv'?'':'bad'}">${movSinal(m)}</td><td><b>${nf(m.saldo)}</b></td></tr>`).join('')}</tbody></table></div>${PGE.nav}`:'<p class="note">Nenhum movimento com esses filtros.</p>'}</section>`;}
function estExp(tipo){const D=estMovs(),{L}=D,I=gTodos('insumo').filter(i=>D.ins?i.uid===D.ins:!i.inativo).sort(porNome).map(i=>({i,e:estoqueIns(i)})),d=dB(hojeKey()),nome=`Estoque ${d.replace(/\//g,'-')}`,perTxt=D.filtro;if(!L.length&&!I.length)return toast('Nada nesse filtro');
  if(tipo==='xls')return gExcel(nome,[['Saldo',['Produto','Saldo (kg)','Consumo/dia 7 dias (kg)','Estoque para (dias)','Estoque mínimo (kg)'],I.map(({i,e})=>[xc(i.nome),xc(e.saldo,'int'),xc(e.cons>0?e.cons:NaN,'int'),xc(ok(e.dias)?e.dias:NaN,'dec'),xc(e.min||NaN,'int')]),[24,12,20,13,17]],
    ['Movimentações',['Data','Produto','Movimento','Quantidade (kg)','Valor total (R$)','Valor por kg (R$)','Fornecedor / observação','Acerto da contagem (kg)','Saldo (kg)'],L.map(m=>[xc(m.dia,'dia'),xc(m.nome),xc(MOV_NOME[m.mov]),xc((m.mov==='ent'||m.mov==='inv'?1:-1)*m.kg,'int'),xc(m.mov==='ent'&&m.rs?m.rs:NaN,'rs'),xc(m.mov==='ent'&&m.rs&&m.kg?m.rs/m.kg:NaN,'rs'),xc(m.obs||''),xc(m.mov==='inv'&&ok(m.dif)?m.dif:NaN,'int'),xc(m.saldo,'int')]),[11,22,14,14,15,15,34,16,11]]]);
  window.__expPdf=tipo==='pdf';
  return enviarImg(`FJK - Estoque - ${d}`,[{cab:`Saldo do estoque · ${d}`,cols:[['Produto',300,'l'],['Saldo',170,'r'],['Consumo/dia',170,'r'],['Estoque para',170,'r'],['Mínimo',160,'r']],
      linhas:I.map(({i,e})=>[i.nome,e.saldo==null?'—':nf(e.saldo)+' kg',e.cons>0?nf(e.cons)+' kg':'—',ok(e.dias)?nf(e.dias,1)+' dia(s)':'—',e.min?nf(e.min)+' kg':'—']),
      cores:I.map(({e})=>{const c=estCor(e);return [null,c==='r'?'#b3261e':c==='a'?'#b26a00':c==='v'?'#2e7d32':null,null,c==='r'?'#b3261e':c==='a'?'#b26a00':c==='v'?'#2e7d32':null];})},
    {cab:`Movimentações · ${perTxt}`,cols:[['Data',100,'l'],['Produto',210,'l'],['Movimento',150,'l'],['Quantidade',130,'r'],['Valor total',150,'r'],['R$/kg',110,'r'],['Fornecedor / obs.',260,'l'],['Saldo',120,'r']],
      linhas:L.map(m=>[dB(m.dia).slice(0,5),m.nome,MOV_NOME[m.mov]+(m.mov==='inv'&&ok(m.dif)?` (${m.dif>=0?'+':''}${nf(m.dif)})`:''),movSinal(m)+' kg',m.mov==='ent'&&m.rs?rs(m.rs):'—',m.mov==='ent'&&m.rs&&m.kg?rs(m.rs/m.kg):'—',m.obs||'—',nf(m.saldo)]),
      cores:L.map(m=>[null,null,null,m.mov==='ent'?'#2e7d32':m.mov==='inv'?null:'#b3261e'])}],nome);}
/* exportar as entradas e saídas de um produto (no período escolhido) */
function estInsExp(id,tipo){const i=G.it[id];if(!i)return;const e=estoqueIns(i),per=perNorm(GT.per==null?30:GT.per),[de,ate]=perFaixa(per,'per'),perTxt=perTexto(per,'per');
  const L=e.M.filter(m=>m.dia>=de&&m.dia<=ate).slice().reverse();if(!L.length)return toast('Nada nesse período');
  const tot=k=>L.filter(m=>m.mov===k).reduce((a,m)=>a+m.kg,0),rsE=L.filter(m=>m.mov==='ent').reduce((a,m)=>a+(+m.rs||0),0),d=dB(hojeKey()),nome=`Estoque ${i.nome} ${d.replace(/\//g,'-')}`;
  const det=m=>[m.mov==='bat'?movDet(m):'',m.obs||''].filter(Boolean)[0]||'';
  if(tipo==='xls')return gExcel(nome,[['Resumo',['Produto','Período','Saldo hoje (kg)','Consumo/dia 7 dias (kg)','Estoque para (dias)','Entradas (kg)','Valor das entradas (R$)','Carregamentos (kg)','Saídas manuais (kg)'],
      [[xc(i.nome),xc(perTxt),xc(e.saldo,'int'),xc(e.cons>0?e.cons:NaN,'int'),xc(ok(e.dias)?e.dias:NaN,'dec'),xc(tot('ent'),'int'),xc(rsE||NaN,'rs'),xc(tot('bat'),'int'),xc(tot('sai'),'int')]],[22,24,14,20,13,13,18,13,16]],
    ['Entradas e saídas',['Data','Movimento','Quantidade (kg)','Valor total (R$)','Valor por kg (R$)','Fornecedor / observação','Acerto da contagem (kg)','Saldo (kg)'],
      L.map(m=>[xc(m.dia,'dia'),xc(MOV_NOME[m.mov]),xc((m.mov==='ent'||m.mov==='inv'?1:-1)*m.kg,'int'),xc(m.mov==='ent'&&m.rs?m.rs:NaN,'rs'),xc(m.mov==='ent'&&m.rs&&m.kg?m.rs/m.kg:NaN,'rs'),xc(m.obs||(m.mov==='bat'?movDet(m):'')),xc(m.mov==='inv'&&ok(m.dif)?m.dif:NaN,'int'),xc(m.saldo,'int')]),[11,14,14,15,15,34,16,11]]]);
  window.__expPdf=tipo==='pdf';
  return enviarImg(`FJK - Estoque ${i.nome} - ${d}`,[{cab:`${i.nome} · ${perTxt}`,cols:[['Saldo hoje',230,'c'],['Consumo/dia',230,'c'],['Estoque para',200,'c'],['Entradas',230,'c'],['Carregamentos',230,'c'],['Saídas manuais',230,'c']],
      linhas:[[e.saldo==null?'—':nf(e.saldo)+' kg',e.cons>0?nf(e.cons)+' kg':'—',ok(e.dias)?nf(e.dias,1)+' dia(s)':'—',nf(tot('ent'))+' kg'+(rsE?' · '+rs(rsE):''),nf(tot('bat'))+' kg',nf(tot('sai'))+' kg']]},
    {cab:`Entradas e saídas · ${perTxt}`,cols:[['Data',100,'l'],['Movimento',160,'l'],['Quantidade',140,'r'],['Valor total',150,'r'],['R$/kg',110,'r'],['Fornecedor / obs.',380,'l'],['Saldo',130,'r']],
      linhas:L.map(m=>[dB(m.dia).slice(0,5),MOV_NOME[m.mov]+(m.mov==='inv'&&ok(m.dif)?` (${m.dif>=0?'+':''}${nf(m.dif)})`:''),movSinal(m)+' kg',m.mov==='ent'&&m.rs?rs(m.rs):'—',m.mov==='ent'&&m.rs&&m.kg?rs(m.rs/m.kg):'—',det(m)||'—',nf(m.saldo)]),
      cores:L.map(m=>[null,null,m.mov==='ent'?'#2e7d32':m.mov==='inv'?null:'#b3261e'])}],nome);}
function tEstIns(t){const i=G.it[t.id];if(!i)return voltar();const e=estoqueIns(i),per=perNorm(GT.per==null?30:GT.per),hj=hojeKey(),[de,ate]=perFaixa(per,'per');
  const M=e.M.filter(m=>m.dia>=de&&m.dia<=ate).reverse(),PGI=paginar(M,'pgI');
  const tot=k=>e.M.filter(m=>m.dia>=de&&m.dia<=ate&&m.mov===k).reduce((a,m)=>a+m.kg,0);
  const lin=m=>`<tr><td class="hora">${dB(m.dia).slice(0,5)}</td><td class="c">${MOV_NOME[m.mov]}${m.nf&&m.nf.id?` <button class="mini" data-g="nfVer" data-id="${esc(m.nf.id)}" data-mini="${esc(m.nf.idMini||'')}">📎 NF</button>`:''}<small>${esc(m.obs||'')}${m.mov==='inv'&&ok(m.dif)?` · acerto ${m.dif>=0?'+':''}${nf(m.dif)} kg`:''}${m.mov==='ent'&&m.rs?` · ${rs(m.rs)}`:''}</small></td>
    <td class="${m.mov==='ent'?'ok':m.mov==='inv'?'':'bad'}">${m.mov==='ent'?'+':m.mov==='inv'?'=':'−'}${nf(m.kg)}</td><td><b>${nf(m.saldo)}</b></td><td>${m.manual?`<button class="mini" data-g="ir" data-t="estForm" data-id="${m.uid}" aria-label="Editar">✎</button> <button class="mini danger" data-g="estRm" data-id="${m.uid}" aria-label="Apagar">✕</button>`:''}</td></tr>`;
  return `${voltar()}<section class="panel"><div class="curhead"><h2>${esc(i.nome)}</h2><span class="note">estoque</span></div>
    <div class="stat gStat3">${st('Saldo hoje',e.saldo==null?'—':nf(e.saldo)+' kg')}${st('Consumo/dia (7 d)',e.cons>0?nf(e.cons)+' kg':'—')}${st('Estoque para',ok(e.dias)?nf(e.dias,1)+' dia(s)':'—')}</div>
    ${(()=>{const p=precoIns(i,hojeKey()),au=precoMedioHist(i.uid).length>0;return `<div class="gEstMinLin"><div class="gEstPM"><small>Preço médio${au?'':' (manual)'}</small><b>${ok(p)?rs(p,2)+'/t':'—'}</b><button type="button" class="mini" data-g="ir" data-t="insForm" data-id="${i.uid}">ver cálculo</button></div>
      <div class="gEstMinEd"><label for="gEstMinIn">Estoque mínimo (kg)</label><div class="gEstMinIn"><input id="gEstMinIn" type="text" inputmode="decimal" value="${+i.estMin>0?vIn(+i.estMin):''}" placeholder="sem mínimo" autocomplete="off"><button type="button" class="lima" data-g="estMinSalva" data-id="${i.uid}">Salvar</button></div></div></div>`;})()}</section>
  <section class="panel"><button class="verde" data-g="estVerMov" data-id="${i.uid}">📋 Ver entradas e saídas de ${esc(i.nome)}</button><p class="note">Abre o relatório do Estoque já filtrado neste produto (período, tipo e fornecedor, com PDF, foto e Excel).</p></section>`;}
function tEstForm(t){const ed=t.id&&G.it[t.id]&&!G.it[t.id].del?G.it[t.id]:null,mov=ed?ed.mov:(t.mov||'ent'),I=gTodos('insumo').filter(i=>!i.inativo||(ed&&i.uid===ed.ins)).sort(porNome),tit=(ed?'Editar ':'')+{ent:'Entrada no estoque',sai:'Saída manual do estoque',inv:'Contagem do estoque'}[mov];
  const vKg=ed?+ed.kg:'',vRs=ed&&+ed.rs>0?+ed.rs:'',vPk=ed&&+ed.rs>0&&+ed.kg>0?Math.round(ed.rs/ed.kg*100)/100:'';
  return `${voltar()}<section class="panel"><h2>${tit}</h2><div class="gForm">${[
    {k:'emov',l:'Tipo',t:'sel',op:[['ent','＋ Entrada (compra/chegada)'],['sai','－ Saída manual (perda, outro uso)'],['inv','Contagem (acerto do saldo)']],v:mov},
    {k:'eins',l:'Produto',t:'sel',op:[['','Selecione']].concat(I.map(i=>[i.uid,i.nome])),v:ed?ed.ins:(t.ins||'')},
    {k:'edia',l:'Data',t:'dia',v:ed?ed.dia:hojeKey(),meia:1}].map(campo).join('')}
    ${mov==='ent'?`<div class="gTres">${[{k:'ekg',l:'Quantidade',suf:'kg',t:'num',v:vKg},{k:'ers',l:'Valor total da nota',t:'rs',v:vRs},{k:'erkg',l:'Valor por kg',t:'rs',v:vPk}].map(campo).join('')}</div>
      <p class="note gTresNota">Coloque a quantidade e o valor total (o valor por kg sai sozinho), ou a quantidade e o valor por kg.</p>`
      :campo({k:'ekg',l:mov==='inv'?'Quantidade contada':'Quantidade',suf:'kg',t:'num',v:vKg,meia:1})}
    ${mov==='ent'?[{k:'eobs',l:'Fornecedor (opcional)',v:ed?entForn(ed):'',sug:'forn'},{k:'enota',l:'Nº da NF (opcional)',v:ed?entNota(ed):'',ph:'Ex.: 84598',meia:1}].map(campo).join('')
      :campo({k:'eobs',l:'Observação (opcional)',v:ed?ed.obs||'':''})}</div>
    <button class="primary" data-g="salvaEst" data-id="${ed?ed.uid:''}">${ed?'Salvar alteração':'Salvar'}</button><button class="danger" data-g="estCancela">✕ Cancelar</button></section>`;}
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
function tEstNF(){const I=gTodos('insumo').filter(i=>!i.inativo).sort(porNome),op=[['','Selecione']].concat(I.map(i=>[i.uid,i.nome]));
  if(!NF)return `${voltar()}<section class="panel"><h2>Entrada pela nota fiscal</h2>
    <p class="note">Anexe a nota: o <b>XML</b> da NF-e (mais certo), o <b>PDF</b> da nota ou uma <b>foto</b> da DANFE. O app lê a data, o fornecedor, o número, os produtos, as quantidades e os valores. Você confere, escolhe o produto e lança.</p>
    <label class="gNfArq">📎 Anexar nota fiscal<input type="file" id="nfArq" accept=".xml,application/xml,text/xml,application/pdf,image/*" hidden></label></section>`;
  if(NF.lendo)return `${voltar()}<section class="panel"><h2>Entrada pela nota fiscal</h2><p class="note">Lendo a nota ${esc(NF.nome||'')}… (foto pode levar alguns segundos)</p></section>`;
  if(NF.erro)return `${voltar()}<section class="panel"><h2>Entrada pela nota fiscal</h2><p class="aviso warn">${esc(NF.erro)}</p><button data-g="nfOutra">Escolher outro arquivo</button></section>`;
  return `${voltar()}<section class="panel"><h2>Entrada pela nota fiscal</h2>
    ${NF_IMG?`<img class="gNfImg" src="${NF_IMG.mini}" alt="nota">`:''}<p class="note">Lido de ${esc(NF.nome||'')}${ok(NF.vNF)?` · valor total da nota ${rs(NF.vNF)}`:''}. Confira e corrija se precisar.</p>
    <div class="gForm">${[{k:'edia',l:'Data',t:'dia',v:NF.dia||hojeKey(),meia:1},{k:'eobs',l:'Fornecedor',v:(()=>{const n=String(NF.forn||'').trim(),a=fornecedores().find(x=>fSem(x)===fSem(n));return a||n;})(),sug:'forn'},{k:'enota',l:'Nº da NF',v:NF.num||'',meia:1}].map(campo).join('')}</div>
    ${NF.itens.map((x,i)=>`<div class="gNfItem"><p class="note"><b>Na nota:</b> ${esc(x.desc||'—')}${ok(x.qtd)?` · ${nf(x.qtd,3)} ${esc(x.un||'')}`:''}${ok(x.vTot)?` · ${rs(x.vTot)}`:''}${ok(x.qtd)&&!nfFator(x.un)?` <b>· unidade ${esc(x.un||'?')}: coloque os kg</b>`:''}</p>
      <div class="gForm">${campo({k:'nfp'+i,l:'Produto',t:'sel',op,v:x.ins})}</div>
      <div class="gTres">${[{k:'nfk'+i,l:'Quantidade',suf:'kg',t:'num',v:ok(x.kg)?x.kg:''},{k:'nfv'+i,l:'Valor total',t:'rs',v:ok(x.vTot)?x.vTot:''},{k:'nfu'+i,l:'Valor por kg',t:'rs',v:ok(x.kg)&&ok(x.vTot)&&x.kg>0?Math.round(x.vTot/x.kg*100)/100:''}].map(campo).join('')}</div></div>`).join('')}
    <p class="note">Item sem produto escolhido não é lançado.</p>
    <button class="primary" data-g="nfSalva">✓ Lançar entrada${NF.itens.length>1?'s':''}</button><button data-g="nfOutra">Escolher outro arquivo</button><button class="danger" data-g="estCancela">✕ Cancelar</button></section>`;}
document.addEventListener('change',e=>{if(e.target&&e.target.id==='nfArq'&&e.target.files&&e.target.files[0])nfLer(e.target.files[0]);});
document.addEventListener('input',e=>{const m=/^gf_nf([kvu])(\d+)$/.exec((e.target&&e.target.id)||'');if(!m)return;const i=m[2],kg=fn('nfk'+i),tot=fn('nfv'+i),pk=fn('nfu'+i),T=$('gf_nfv'+i),P=$('gf_nfu'+i);if(!T||!P)return;
  if(m[1]==='u'){if(kg>0&&pk>0)T.value=rsIn(Math.round(pk*kg*100)/100);}else if(kg>0&&tot>0)P.value=rsIn(Math.round(tot/kg*100)/100);});
async function nfSalvar(){if(!NF||!NF.itens)return;const dia=fv('edia'),obs=(fv('eobs')||'').trim(),nota=(fv('enota')||'').trim().replace(/^NF[\s:.ºo°#-]*/i,'');if(!dia)return toast('Coloque a data');
  const L=NF.itens.map((x,i)=>({ins:fv('nfp'+i),kg:fn('nfk'+i),rs:fn('nfv'+i)>0?fn('nfv'+i):fn('nfu'+i)>0?Math.round(fn('nfu'+i)*fn('nfk'+i)*100)/100:0})).filter(x=>x.ins);
  if(!L.length)return toast('Escolha o produto');if(L.some(x=>!(x.kg>0)))return toast('Coloque a quantidade em kg');
  let anexo=null;if(NF_IMG&&navigator.onLine){toast('Guardando a nota…');try{const r=await postApi({acao:'fotoSalvar',img:NF_IMG.big.split(',')[1],mini:NF_IMG.mini.split(',')[1],nome:`NF ${nota||NF.num||''} ${dB(dia).replace(/\//g,'-')} ${Date.now()}`});if(r&&r.id){anexo={id:r.id,idMini:r.idMini||r.id,num:nota||NF.num||''};FZ_FOTO[anexo.idMini]=NF_IMG.mini;FZ_FOTO[anexo.id]=NF_IMG.big;}}catch(e){}}
  L.forEach(x=>{const e={uid:novoId('est'),tipo:'estmov',dia,ins:x.ins,mov:'ent',kg:x.kg,rs:x.rs,obs,nf:anexo};if(nota)e.nota=nota;gPut(e);});
  toast(`${L.length} entrada(s) lançada(s)${NF_IMG&&!anexo?' · a imagem da nota não foi guardada (sem internet)':''}`);NF=null;NF_IMG=null;GT={t:'estoque'};gRender();window.scrollTo({top:0});}
async function nfVer(id,mini){const w=document.createElement('div');w.className='fzFotoTela';w.innerHTML=`<img src="${FZ_FOTO[id]||FZ_FOTO[mini]||''}" alt=""><span class="fzFotoCarr">${FZ_FOTO[id]?'':'carregando…'}</span><button aria-label="Fechar">✕</button>`;
  w.onclick=()=>w.remove();document.body.appendChild(w);if(!FZ_FOTO[id]){await fzFotoCarregar(id);const im=w.querySelector('img'),s_=w.querySelector('.fzFotoCarr');if(FZ_FOTO[id]){im.src=FZ_FOTO[id];s_.textContent='';}else s_.textContent='não consegui abrir a nota (sem internet?)';}}
/* entrada: quantidade × valor por kg = valor total (preenche um a partir dos outros) */
document.addEventListener('input',e=>{const id=e.target&&e.target.id;if(!['gf_ekg','gf_ers','gf_erkg'].includes(id))return;const kg=fn('ekg'),tot=fn('ers'),pk=fn('erkg'),T=$('gf_ers'),P=$('gf_erkg');if(!T||!P)return;
  if(id==='gf_erkg'){if(kg>0&&pk>0)T.value=rsIn(Math.round(pk*kg*100)/100);}
  else if(kg>0&&tot>0)P.value=rsIn(Math.round(tot/kg*100)/100);});
/* ---------- Fornecedores (Estoque › Fornecedores): cadastro simples, só o nome ---------- */
const fornEntradas=n=>{const k=fSem(n);return gTodos('estmov').filter(x=>x.mov==='ent'&&fSem(entForn(x))===k);};
const fornReg=n=>{const k=fSem(n);return gTodos('fornecedor').find(f=>fSem(f.nome)===k);};
function tFornec(){const L=fornecedores().map(n=>({n,f:fornReg(n),E:fornEntradas(n)}));
  const lin=({n,f,E})=>`<div class="gItem gFornIt"><div class="gItemTopo"><b>${esc(n)}</b><span class="note">${E.length?E.length+' entrada(s)':'sem entradas'}</span></div>
    <div class="gFornBts"><button type="button" class="mini" data-g="ir" data-t="fornForm" ${f?`data-id="${f.uid}"`:`data-nome="${esc(n)}"`}>✎ Editar</button>${!E.length&&f?`<button type="button" class="mini danger" data-g="fornExc" data-id="${f.uid}">✕ Excluir</button>`:''}</div></div>`;
  return `${voltar()}<section class="panel"><div class="curhead"><h2>🏢 Fornecedores</h2><span class="note">${L.length}</span></div>
    <button class="lima" data-g="ir" data-t="fornForm">＋ Novo fornecedor</button>
    ${L.map(lin).join('')||'<p class="note">Nenhum fornecedor ainda.</p>'}
    <p class="note">Só dá para excluir fornecedor sem entrada lançada. Mudar o nome muda também nas entradas dele.</p></section>`;}
function tFornForm(t){const f=t.id&&G.it[t.id]&&!G.it[t.id].del?G.it[t.id]:null,nome=f?f.nome:(t.nome||''),E=nome?fornEntradas(nome):[];
  return `${voltar()}<section class="panel"><h2>${nome?'Editar fornecedor':'Novo fornecedor'}</h2><div class="gForm">${campo({k:'fnome',l:'Nome do fornecedor',v:nome,ph:'Ex.: INTERGRAOS'})}</div>
    ${E.length?`<p class="note">${E.length} entrada(s) com este fornecedor: se mudar o nome, muda nelas também.</p>`:''}
    <button class="primary" data-g="fornSalva">${nome?'Salvar alteração':'Salvar'}</button></section>`;}
async function fornSalvar(){const t=GT,f=t.id&&G.it[t.id]&&!G.it[t.id].del?G.it[t.id]:null,velho=f?f.nome:(t.nome||'');let novo=(fv('fnome')||'').trim();
  if(!novo)return toast('Coloque o nome');
  const outro=fSem(novo)!==fSem(velho)&&fornecedores().find(n=>fSem(n)===fSem(novo));
  if(outro){if(!velho)return toast('Já existe um fornecedor com esse nome');
    /* nome igual a outro já cadastrado: junta os dois (as entradas passam para o outro) */
    if(!(window.perg?await perg(`Juntar com ${outro}?`,`Já existe o fornecedor ${outro}. As entradas de ${velho} passam para ele e ${velho} sai da lista.`,'Sim, juntar','Não',true):confirm('Juntar?')))return;
    novo=outro;const rv=f||fornReg(velho);if(rv&&fSem(rv.nome)!==fSem(novo))gDel(rv.uid);}
  const reg=outro?fornReg(novo):(f||(velho&&fornReg(velho)));gPut(Object.assign({},reg||{},{uid:reg?reg.uid:novoId('forn'),tipo:'fornecedor',nome:novo}));
  let n=0;if(velho&&novo!==velho)fornEntradas(velho).forEach(x=>{const y=JSON.parse(JSON.stringify(x)),nt=entNota(x);y.obs=novo;if(nt)y.nota=nt;gPut(y);n++;});
  toast(n?`Fornecedor salvo · ${n} entrada(s) atualizada(s)`:'Fornecedor salvo');gVoltar();}
/* ---------- Relatório de entradas: período, fornecedor e produto ---------- */
function entRelDados(){const per=perNorm(GT.perR==null?30:GT.perR),[de,ate]=perFaixa(per,'perR'),fo=GT.rForn||'',ins=GT.rIns||'';
  const L=gTodos('estmov').filter(x=>x.mov==='ent'&&x.dia>=de&&x.dia<=ate&&(!ins||x.ins===ins)&&(!fo||fSem(entForn(x))===fSem(fo)))
    .map(x=>({dia:x.dia,ins:x.ins,prod:(G.it[x.ins]&&G.it[x.ins].nome)||'—',forn:entForn(x),nota:entNota(x),kg:+x.kg||0,rs:+x.rs||0,nf:x.nf||null,ts:x.ts||0}))
    .sort((a,b)=>b.dia.localeCompare(a.dia)||b.ts-a.ts);
  const kg=L.reduce((a,x)=>a+x.kg,0),vr=L.reduce((a,x)=>a+x.rs,0),kgV=L.filter(x=>x.rs>0).reduce((a,x)=>a+x.kg,0);
  return {L,per,de,ate,fo,ins,kg,vr,pm:kgV>0?vr/kgV:NaN,perTxt:perTexto(per,'perR')};}
function tEntRel(){const D=entRelDados(),P=paginar(D.L,'pgR'),I=gTodos('insumo').sort(porNome);
  return `${voltar()}<section class="panel"><div class="curhead"><h2>📋 Relatório de entradas</h2><span class="note">${D.L.length}</span></div>
    ${perSelHTML(D.per,'perR')}
    <div class="gForm gEntFiltro">${campo({k:'rForn',l:'Fornecedor',t:'sel',op:[['','Todos os fornecedores']].concat(fornecedores().map(n=>[n,n])),v:D.fo})}${campo({k:'rIns',l:'Produto',t:'sel',op:[['','Todos os produtos']].concat(I.map(i=>[i.uid,i.nome])),v:D.ins})}</div>
    <div class="stat gStat3">${st('Quantidade',nf(D.kg)+' kg')}${st('Valor total',D.vr?rs(D.vr):'—')}${st('Preço médio',ok(D.pm)?rs(D.pm)+'/kg':'—')}</div>
    ${D.L.length?`<div class="row compart fz3"><button class="verde" data-g="entRelExp" data-o="pdf">📄 PDF</button><button class="verde" data-g="entRelExp" data-o="img">🖼 Foto</button><button class="verde" data-g="entRelExp" data-o="xls">📊 Excel</button></div>
    ${P.sel}<div class="tablebox"><table class="gTab gEstTab"><thead><tr><th>Dia</th><th>Produto · fornecedor</th><th>kg</th><th>Valor</th></tr></thead><tbody>${P.itens.map(x=>`<tr><td class="hora">${dB(x.dia).slice(0,5)}</td><td class="c">${esc(x.prod)}<small>${esc(x.forn||'sem fornecedor')}${x.nota?' · NF '+esc(x.nota):''}${x.nf&&x.nf.id?` <button class="mini" data-g="nfVer" data-id="${esc(x.nf.id)}" data-mini="${esc(x.nf.idMini||'')}">📎 NF</button>`:''}</small></td><td class="ok">${nf(x.kg)}</td><td>${x.rs?rs(x.rs):'—'}<small>${x.rs&&x.kg?rs(x.rs/x.kg)+'/kg':''}</small></td></tr>`).join('')}</tbody></table></div>${P.nav}`:'<p class="note">Nenhuma entrada com esses filtros.</p>'}</section>`;}
function entRelExp(tipo){const D=entRelDados();if(!D.L.length)return toast('Nada nesse filtro');const d=dB(hojeKey()),nome=`Entradas ${d.replace(/\//g,'-')}`,
  filt=[D.perTxt,D.fo||'todos os fornecedores',D.ins&&G.it[D.ins]?G.it[D.ins].nome:'todos os produtos'].join(' · ');
  if(tipo==='xls')return gExcel(nome,[['Entradas',['Data','Produto','Fornecedor','Nº NF','Quantidade (kg)','Valor total (R$)','Valor por kg (R$)'],
    D.L.map(x=>[xc(x.dia,'dia'),xc(x.prod),xc(x.forn||''),xc(x.nota||''),xc(x.kg,'int'),xc(x.rs||NaN,'rs'),xc(x.rs&&x.kg?x.rs/x.kg:NaN,'rs')]).concat([[xc('Total'),xc(''),xc(''),xc(''),xc(D.kg,'int'),xc(D.vr||NaN,'rs'),xc(D.pm,'rs')]]),[11,22,34,12,15,16,16]]]);
  window.__expPdf=tipo==='pdf';
  return enviarImg(`FJK - Entradas no estoque - ${d}`,[{cab:`Entradas · ${filt}`,cols:[['Quantidade',300,'c'],['Valor total',300,'c'],['Preço médio',300,'c'],['Lançamentos',250,'c']],
      linhas:[[nf(D.kg)+' kg',D.vr?rs(D.vr):'—',ok(D.pm)?rs(D.pm)+'/kg':'—',String(D.L.length)]]},
    {cab:'Lançamentos',cols:[['Data',100,'l'],['Produto',200,'l'],['Fornecedor',330,'l'],['NF',110,'l'],['Quantidade',140,'r'],['Valor total',150,'r'],['R$/kg',110,'r']],
      linhas:D.L.map(x=>[dB(x.dia).slice(0,5),x.prod,x.forn||'—',x.nota||'—',nf(x.kg)+' kg',x.rs?rs(x.rs):'—',x.rs&&x.kg?rs(x.rs/x.kg):'—']).concat([['Total','','','',nf(D.kg)+' kg',D.vr?rs(D.vr):'—',ok(D.pm)?rs(D.pm):'—']])}],nome);}
function salvaEst(id){const ed=id&&G.it[id]&&!G.it[id].del?G.it[id]:null;const mov=fv('emov'),ins=fv('eins'),dia=fv('edia'),kg=fn('ekg');
  if(!ins)return toast('Escolha o produto');if(!dia)return toast('Coloque a data');if(!(kg>=0)||(mov!=='inv'&&!(kg>0)))return toast('Coloque a quantidade em kg');
  const rsT=mov==='ent'?(fn('ers')>0?fn('ers'):fn('erkg')>0?Math.round(fn('erkg')*kg*100)/100:0):0;
  const x=Object.assign({},ed||{},{uid:ed?ed.uid:novoId('est'),tipo:'estmov',dia,ins,mov,kg,rs:rsT,obs:(fv('eobs')||'').trim()});
  if(mov==='ent'){const nt=(fv('enota')||'').trim().replace(/^NF[\s:.ºo°#-]*/i,'');if(nt)x.nota=nt;else delete x.nota;}else delete x.nota;
  gPut(x);
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
/* histórico: as últimas N leituras (dias com avaliação), não N dias corridos */
function fzIni(t,dia,cH){const ds=[...new Set(gTodos('fezes').filter(x=>x.dia<=dia&&(cH?nAt(x.curral)===cH:doLocal(t.loc,nAt(x.curral)))&&fzCalc(x.c).tot).map(x=>x.dia))].sort();
  const hN=[7,15,30].includes(+t.hN)?+t.hN:30;return ds.length?ds[Math.max(0,ds.length-hN)]:dia;}
function tFezes(t){const hj=hojeKey();t.dia=t.dia||hj;t.loc=t.loc||'T';const dia=t.dia,Cs=fzCurrais(dia,t.loc);
  if(t.cur&&!Cs.includes(t.cur))t.cur=null;
  const chips=Cs.map(c=>{const k=fzCalc((fzItem(dia,c)||{}).c),st=fzStatus(k);
    return `<button class="fzChip ${t.cur===c?'sel':''} ${k.tot?'feito '+st.cl:''}" data-g="fzCur" data-c="${esc(c)}"><b>${esc(c)}</b><small>${k.tot?'✓ média '+fz1(k.media):'avaliar'}</small></button>`;}).join('');
  let ficha='';
  if(t.cur){const c=t.cur,x0=fzItem(dia,c);if(!t.fzR)t.fzR={c:((x0&&x0.c)||[0,0,0,0,0]).map(v=>+v||0),obs:(x0&&x0.obs)||'',orig:JSON.stringify([((x0&&x0.c)||[0,0,0,0,0]).map(v=>+v||0),(x0&&x0.obs)||''])};
    const x=Object.assign({},x0||{},{c:t.fzR.c,obs:t.fzR.obs}),k=fzCalc(x.c),st=fzStatus(k);
    const L=gTodos('lote').filter(l=>curralEm(l,dia)===c&&cabPres(l,dia)>0);
    ficha=`<section class="panel fzFicha"><div class="curhead"><h2>${esc(c)}</h2><span class="note">${L.map(l=>esc(l.nome)+' · '+nf(cabPres(l,dia))+' cab').join(' · ')}</span></div>
      <div class="fzTot"><span>Total de fezes avaliadas</span><b>${k.tot}</b></div>
      ${[1,2,3,4,5].map(i=>`<div class="fzLinha e${i}"><div><b>Escore ${i}</b> · ${fzPc(k.pct[i-1])}<small>${FZ_DESC[i]}</small></div>
        <button class="fzBt" data-g="fzMenos" data-i="${i}" aria-label="Menos escore ${i}"${k.cs[i-1]?'':' disabled'}>−</button><b class="fzN">${k.cs[i-1]}</b>
        <button class="fzBt mais" data-g="fzMais" data-i="${i}" aria-label="Mais escore ${i}">+</button></div>`).join('')}
      <div class="fzMedia ${st.cl}"><span>Escore médio ponderado</span><b>${fz1(k.media)}</b><em>${st.txt}</em></div>
      ${fzFotosHTML(x)}
      <label for="fzObs">Observações</label><textarea id="fzObs" rows="2" placeholder="Ex.: fezes com grãos inteiros, muco, bolhas…">${esc((x&&x.obs)||'')}</textarea>
      <div class="fzSalvaLin"><button class="primary" data-g="fzSalvar">💾 Salvar score</button><button class="danger" data-g="fzCancelar">✕ Cancelar</button></div>
      ${x0&&fzCalc(x0.c).tot?`<button class="mini danger" data-g="fzApagar">Apagar avaliação deste curral</button>`:''}</section>`;}
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
  const hN=[7,15,30].includes(+t.hN)?+t.hN:30,cH=t.hCur||'',ini=fzIni(t,dia,cH);
  const HI=gTodos('fezes').filter(x=>x.dia>=ini&&x.dia<=dia&&(cH?nAt(x.curral)===cH:doLocal(t.loc,nAt(x.curral))));
  const porDia={};HI.forEach(x=>{const k=fzCalc(x.c);if(!k.tot)return;const d=porDia[x.dia]||(porDia[x.dia]=[0,0,0,0,0]);k.cs.forEach((n,i)=>d[i]+=n);});
  const dias=Object.keys(porDia).sort().reverse();
  const opC=[...new Set(gTodos('fezes').map(x=>x.curral))].sort(alfa);
  const hist=`<section class="panel"><div class="curhead"><h2>Histórico</h2><div class="fzHN">${[7,15,30].map(n=>`<button class="${n===hN?'sel':''}" data-g="fzHN" data-n="${n}">${n} leituras</button>`).join('')}</div></div>
    <select id="fzHCur"><option value="">${t.loc==='T'?'Todos os currais':t.loc==='C'?'Todo o confinamento':'Todo o pasto'}</option>${opC.map(c=>`<option${c===cH?' selected':''}>${esc(c)}</option>`).join('')}</select>
    ${dias.length?`<div class="fzBarras">${dias.slice().reverse().map(d=>{const k=fzCalc(porDia[d]);return `<div class="fzBar" title="${dB(d)} · média ${fz1(k.media)}">${k.pct.map((p,i)=>`<i class="e${i+1}" style="height:${p}%"></i>`).join('')}<small>${dB(d).slice(0,5)}</small></div>`;}).join('')}</div>
      <div class="fzLeg">${[1,2,3,4,5].map(i=>`<span><i class="e${i}"></i>${i} ${FZ_DESC[i]}</span>`).join('')}</div>
      <div class="tablebox"><table class="gTab fzTab"><thead><tr><th>Dia</th><th>N</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>Média</th></tr></thead><tbody>
      ${dias.map(d=>{const k=fzCalc(porDia[d]);return `<tr><td class="c">${dB(d).slice(0,5)}</td><td>${k.tot}</td>${k.pct.map((p,i)=>`<td class="${i===2?'fz3':''}">${p?p.toFixed(0)+'%':'·'}</td>`).join('')}<td class="${fzStatus(k).cl}"><b>${fz1(k.media)}</b></td></tr>`;}).join('')}</tbody></table></div>
      <div class="row compart fz3"><button class="verde" data-g="fzHPdf">📄 PDF</button><button class="verde" data-g="fzHImg">🖼 Foto</button><button class="verde" data-g="fzXlsHist">📊 Excel</button></div>`:'<p class="note">Sem avaliações nesse período.</p>'}</section>`;
  return `<section class="panel"><h2>Escore de fezes</h2>${navData('fzDia',dia,'')}${typeof selSetas==='function'&&window.LOC_OPS?`<div class="gCoLocNav">${selSetas('Local',LOC_OPS,Math.max(0,LOC_OPS.findIndex(o=>o[0]===t.loc)),'data-g="fzLocP" data-n','data-fzlsel')}</div>`:locBotoes('fzLoc',t.loc)}
    ${t.cur?`<p class="note fzEditando">✏️ Avaliando o <b>${esc(t.cur)}</b>. Salve o score ou cancele para escolher outro curral.</p>`:`<p class="note">Escolha o curral e toque em + para cada fezes avaliada.</p>
    <div class="fzChips">${chips||'<p class="note">Nenhum curral com lote neste local.</p>'}</div>`}</section>${ficha}${t.cur?'':rel+hist}`;}
function fzMudar(i,d){const t=GT,c=t.cur;if(!c||!t.fzR)return;t.fzR.c[i-1]=Math.max(0,t.fzR.c[i-1]+d);
  const o=$('fzObs');if(o)t.fzR.obs=o.value;const y=window.scrollY;gRender();window.scrollTo({top:y});}
function fzSalvar(){const t=GT,c=t.cur;if(!c||!t.fzR)return;const o=$('fzObs');if(o)t.fzR.obs=o.value;
  const x=fzItem(t.dia,c),n=x?JSON.parse(JSON.stringify(x)):{uid:fzId(t.dia,c),tipo:'fezes',dia:t.dia,curral:c};n.c=t.fzR.c.slice();n.obs=t.fzR.obs;n.hora=new Date().toTimeString().slice(0,5);
  gPut(n);toast(`${c}: score salvo`);t.cur=null;t.fzR=null;gRender();window.scrollTo({top:0,behavior:'smooth'});}
function fzImg(){const t=GT,R=gTodos('fezes').filter(x=>x.dia===t.dia&&doLocal(t.loc,x.curral)).map(x=>({c:x.curral,k:fzCalc(x.c),obs:x.obs})).filter(o=>o.k.tot).sort((a,b)=>alfa(a.c,b.c));
  const G5=[0,0,0,0,0];R.forEach(o=>o.k.cs.forEach((n,i)=>G5[i]+=n));const KG=fzCalc(G5);
  enviarImg(`Escore de fezes · ${dB(t.dia)}`,[{cab:'% de fezes em cada escore (1 líquida · 3 ideal · 5 seca)',cols:[['Curral',170,'l'],['N',60,'r'],['1',90,'r'],['2',90,'r'],['3',90,'r'],['4',90,'r'],['5',90,'r'],['Média',100,'r']],
    linhas:R.map(o=>[o.c,String(o.k.tot)].concat(o.k.pct.map(p=>p.toFixed(0)+'%'),[fz1(o.k.media)])),total:['GERAL',String(KG.tot)].concat(KG.pct.map(p=>p.toFixed(0)+'%'),[fz1(KG.media)])},
    ...(R.some(o=>o.obs)?[{cab:'Observações',cols:[['Curral',170,'l'],['Observação',700,'l']],linhas:R.filter(o=>o.obs).map(o=>[o.c,o.obs])}]:[])],`Escore de fezes ${dB(t.dia).replace(/\//g,'-')}`);}
function fzXls(hist){const t=GT;
  if(!hist){const R=gTodos('fezes').filter(x=>x.dia===t.dia&&doLocal(t.loc,x.curral)).map(x=>({c:x.curral,k:fzCalc(x.c),obs:x.obs})).filter(o=>o.k.tot).sort((a,b)=>alfa(a.c,b.c));
    return gExcel(`Escore de fezes ${dB(t.dia).replace(/\//g,'-')}`,[['Escore de fezes',['Dia','Curral','Total','Esc. 1','Esc. 2','Esc. 3','Esc. 4','Esc. 5','% 1','% 2','% 3','% 4','% 5','Média','Situação','Observação'],
      R.map(o=>[xc(t.dia,'dia'),xc(o.c),xc(o.k.tot,'int')].concat(o.k.cs.map(n=>xc(n,'int')),o.k.pct.map(p=>xc(p/100,'pct')),[xc(o.k.media,'dec'),xc(fzStatus(o.k).txt),xc(o.obs||'')])),[11,16,8,7,7,7,7,7,8,8,8,8,8,8,24,40]]]);}
  const hN=[7,15,30].includes(+t.hN)?+t.hN:30,cH=t.hCur||'',ini=fzIni(t,t.dia,cH);
  const HI=gTodos('fezes').filter(x=>x.dia>=ini&&x.dia<=t.dia&&(cH?nAt(x.curral)===cH:doLocal(t.loc,nAt(x.curral)))).map(x=>({d:x.dia,c:x.curral,k:fzCalc(x.c),obs:x.obs})).filter(o=>o.k.tot).sort((a,b)=>a.d.localeCompare(b.d)||alfa(a.c,b.c));
  gExcel(`Escore de fezes historico ${hN} leituras ${(cH||'todos').replace(/[\\/:*?"<>|]/g,'-')} ${dB(t.dia).replace(/\//g,'-')}`,[['Histórico',['Dia','Curral','Total','% 1','% 2','% 3','% 4','% 5','Média','Situação','Observação'],
    HI.map(o=>[xc(o.d,'dia'),xc(o.c),xc(o.k.tot,'int')].concat(o.k.pct.map(p=>xc(p/100,'pct')),[xc(o.k.media,'dec'),xc(fzStatus(o.k).txt),xc(o.obs||'')])),[11,16,8,8,8,8,8,8,8,24,40]]]);}
$('gBox').addEventListener('click',e=>{const b=e.target.closest('[data-g^="fz"]');if(!b||GT.t!=='fezes')return;const a=b.dataset.g;
  if(a==='fzSalvar'){if(typeof bloqueado==='function'&&bloqueado())return;return fzSalvar();}
  if(a==='fzCancelar'){const o=$('fzObs');if(o&&GT.fzR)GT.fzR.obs=o.value;const mud=GT.fzR&&JSON.stringify([GT.fzR.c,GT.fzR.obs])!==GT.fzR.orig;
    (mud&&window.perg?perg('Cancelar esta avaliação?','O que você marcou neste curral não vai ser salvo.','Sim, cancelar','Não, continuar',false):Promise.resolve(!mud||confirm('Cancelar esta avaliação?'))).then(v=>{if(!v)return;GT.cur=null;GT.fzR=null;gRender();window.scrollTo({top:0,behavior:'smooth'});});return;}
  if(a==='fzCur'){if(GT.cur&&GT.fzR&&b.dataset.c!==GT.cur)return;GT.fzR=null;GT.cur=GT.cur===b.dataset.c&&b.tagName==='BUTTON'?null:b.dataset.c;gRender();if(GT.cur)setTimeout(()=>{const f=document.querySelector('.fzFicha');if(f)f.scrollIntoView({behavior:'smooth',block:'start'});},50);return;}
  if(a==='fzLoc'){GT.loc=b.dataset.l;GT.cur=null;return gRender();}
  if(a==='fzLocP'){if(GT.fzR&&!confirm('Tem uma avaliação sem salvar. Descartar?'))return;const L=['T','C','P'];let i=Math.max(0,L.indexOf(GT.loc||'T'));GT.loc=L[Math.max(0,Math.min(2,i+(+b.dataset.n)))];GT.cur=null;GT.fzR=null;return gRender();}
  if(a==='fzPdf')return fzRelPdf();if(a==='fzImgG')return fzRelImg();
  if(a==='fzImg')return fzImg();if(a==='fzXls')return fzXls(false);if(a==='fzXlsHist')return fzXls(true);
  if(a==='fzHN'){GT.hN=+b.dataset.n;const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='fzHPdf'||a==='fzHImg')return fzHistExport(a==='fzHPdf');
  if(typeof bloqueado==='function'&&bloqueado())return;
  if(a==='fzMais'||a==='fzMenos')return fzMudar(+b.dataset.i,a==='fzMais'?1:-1);
  if(a==='fzFotoAdd'){const f=document.getElementById('fzFotoIn');if(f)f.click();return;}
  if(a==='fzPendRm')return fzPendRm(b.dataset.k);
  if(a==='fzFotoVer')return fzFotoVer(+b.dataset.n);
  if(a==='fzFotoRm')return fzFotoRm(+b.dataset.n);
  if(a==='fzApagar'){if(!confirm(`Apagar a avaliação de fezes do ${GT.cur} em ${dB(GT.dia)}?`))return;const x=fzItem(GT.dia,GT.cur);if(x)gDel(x.uid);GT.cur=null;GT.fzR=null;return gRender();}});
$('gBox').addEventListener('change',e=>{if(GT.t!=='fezes')return;
  if(e.target.id==='fzDia'){GT.dia=e.target.value||hojeKey();GT.cur=null;GT.fzR=null;return gRender();}
  if(e.target.matches&&e.target.matches('select[data-fzlsel]')){GT.loc=e.target.value;GT.cur=null;GT.fzR=null;return gRender();}
  if(e.target.id==='fzHCur'){GT.hCur=e.target.value;return gRender();}
  if(e.target.id==='fzFotoIn'){const fs=[...(e.target.files||[])];e.target.value='';return fzFotosAnexar(fs);}
  if(e.target.id==='fzObs'){if(GT.fzR)GT.fzR.obs=e.target.value;}});

/* ---------- Escore de fezes: fotos (até 4 por curral/dia), guardadas no Google Drive pela planilha ---------- */
const FZ_MAXF=6,FZ_FOTO={},FZ_ENV={};   // FZ_FOTO: cache id → dataURL; FZ_ENV: fotos subindo (por curral)
function fzFotosHTML(x){const fo=(x&&x.fotos)||[],pd=fzPendDe(GT.dia,GT.cur),env=pd.length,livre=FZ_MAXF-fo.length-env;
  const th=fo.map((f,n)=>{const src=FZ_FOTO[f.idMini];if(!src)fzFotoCarregar(f.idMini);
    return `<div class="fzFoto"><button class="fzFotoImg" data-g="fzFotoVer" data-n="${n}" aria-label="Ver foto ${n+1}">${src?`<img src="${src}" alt="">`:'<span>⏳</span>'}</button>${typeof modoVer!=='undefined'&&modoVer?'':`<button class="fzFotoX" data-g="fzFotoRm" data-n="${n}" aria-label="Apagar foto ${n+1}">✕</button>`}</div>`;}).join('')
    +pd.map(q=>`<div class="fzFoto"><img src="${q.mini}" alt="" style="width:100%;height:100%;object-fit:cover;opacity:.55"><span class="fzFotoUp" style="position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);color:#fff;font-size:.7rem;text-align:center;padding:2px">${navigator.onLine&&FZ_PEND_ENV?'⬆ enviando…':'⏳ aguardando sinal'}</span>${typeof modoVer!=='undefined'&&modoVer?'':`<button class="fzFotoX" data-g="fzPendRm" data-k="${q.k}" aria-label="Apagar foto">✕</button>`}</div>`).join('');
  return `<div class="fzFotos"><div class="fzFotosTopo"><span>📷 Fotos <small>(${fo.length+env} de ${FZ_MAXF})</small>${env?` <small>· ${env} no aparelho, sobe quando tiver internet</small>`:''}</span>
    ${livre>0&&!(typeof modoVer!=='undefined'&&modoVer)?`<button class="mini" data-g="fzFotoAdd">📎 Anexar imagens</button>`:''}</div>
    ${th?`<div class="fzFotoGrade">${th}</div>`:''}<input type="file" id="fzFotoIn" accept="image/*" multiple hidden></div>`;}
function fzRedim(file,max,q){return new Promise((ok_,erro)=>{const u=URL.createObjectURL(file),im=new Image();
  im.onload=()=>{const k=Math.min(1,max/Math.max(im.width,im.height)),cv=document.createElement('canvas');cv.width=Math.round(im.width*k);cv.height=Math.round(im.height*k);
    cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);URL.revokeObjectURL(u);ok_(cv.toDataURL('image/jpeg',q));};
  im.onerror=()=>{URL.revokeObjectURL(u);erro(new Error('imagem inválida'));};im.src=u;});}
async function fzFotosAnexar(files){if(typeof bloqueado==='function'&&bloqueado())return;const t=GT,c=t.cur,dia=t.dia;if(!c||!files.length)return;
  const ja=((fzItem(dia,c)||{}).fotos||[]).length,livre=FZ_MAXF-ja-fzPendDe(dia,c).length;
  if(livre<=0)return toast(`Máximo de ${FZ_MAXF} fotos por curral`);
  if(files.length>livre)toast(`Só cabem mais ${livre} foto(s): as outras ficaram de fora`);
  files=files.slice(0,livre);let okN=0;
  /* sem internet ou com: a foto é compactada e guardada no aparelho primeiro; depois sobe para o Drive (agora ou quando o sinal voltar) */
  for(const f of files){try{const big=await fzRedim(f,1024,.6),mini=await fzRedim(f,300,.6);  // compactadas: ~100 KB a grande, ~15 KB a miniatura
      const q={k:'fp-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),dia,c,big,mini,ts:Date.now()};
      await fzPendGrava(q);FZ_PEND.push(q);okN++;}
    catch(e){toast('Não consegui ler a foto: '+(e.message||e));}}
  if(GT.t==='fezes'){const y=window.scrollY;gRender();window.scrollTo({top:y});}
  if(okN)toast(navigator.onLine?`${okN} foto(s) anexada(s) · enviando…`:`${okN} foto(s) guardada(s) no aparelho · sobem sozinhas quando tiver internet`);
  fzPendEnviar();}
/* ---------- fotos guardadas no aparelho esperando internet (IndexedDB: não somem se fechar o app) ---------- */
let FZ_PEND=[],FZ_PEND_ENV=false;
const fzPendDe=(dia,c)=>FZ_PEND.filter(q=>q.dia===dia&&q.c===c);
function fzPendDb(){return new Promise((ok_,erro)=>{const r=indexedDB.open('fjk-fotos-pend',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('p'))r.result.createObjectStore('p',{keyPath:'k'});};r.onsuccess=()=>ok_(r.result);r.onerror=()=>erro(r.error);});}
async function fzPendOp(modo,fn){const db=await fzPendDb();return new Promise((ok_,erro)=>{const tx=db.transaction('p',modo),st=tx.objectStore('p'),rq=fn(st);tx.oncomplete=()=>{db.close();ok_(rq&&rq.result);};tx.onerror=()=>{db.close();erro(tx.error);};});}
const fzPendGrava=q=>fzPendOp('readwrite',st=>st.put(q));
const fzPendTira=k=>fzPendOp('readwrite',st=>st.delete(k));
async function fzPendCarrega(){try{FZ_PEND=(await fzPendOp('readonly',st=>st.getAll()))||[];FZ_PEND.sort((a,b)=>a.ts-b.ts);}catch(e){FZ_PEND=[];}
  if(FZ_PEND.length&&GT&&GT.t==='fezes'){const y=window.scrollY;gRender();window.scrollTo({top:y});}fzPendEnviar();}
async function fzPendEnviar(){if(FZ_PEND_ENV||!FZ_PEND.length||!navigator.onLine||(typeof modoVer!=='undefined'&&modoVer))return;FZ_PEND_ENV=true;let okN=0;
  const pinta=()=>{if(GT&&GT.t==='fezes'){const y=window.scrollY;gRender();window.scrollTo({top:y});}};pinta();
  try{for(const q of FZ_PEND.slice()){
      let r;try{r=await postApi({acao:'fotoSalvar',img:q.big.split(',')[1],mini:q.mini.split(',')[1],nome:`${dB(q.dia).replace(/\//g,'-')} ${q.c} ${q.ts}`});}catch(e){break;}   // caiu o sinal: tenta de novo depois
      if(!r||!r.id)break;
      FZ_FOTO[r.idMini||r.id]=q.mini;
      const x=fzItem(q.dia,q.c)||{uid:fzId(q.dia,q.c),tipo:'fezes',dia:q.dia,curral:q.c,c:[0,0,0,0,0],obs:''},n=JSON.parse(JSON.stringify(x));
      n.fotos=(n.fotos||[]).concat([{id:r.id,idMini:r.idMini||r.id}]).slice(0,FZ_MAXF);const o=$('fzObs');if(o&&GT.cur===q.c&&GT.dia===q.dia)n.obs=o.value;gPut(n);
      try{await fzPendTira(q.k);}catch(e){}FZ_PEND=FZ_PEND.filter(z=>z.k!==q.k);okN++;pinta();}}
  finally{FZ_PEND_ENV=false;pinta();}
  if(okN)toast(`📷 ${okN} foto(s) do escore de fezes enviada(s)`);}
async function fzPendRm(k){if(typeof bloqueado==='function'&&bloqueado())return;if(!confirm('Apagar esta foto (ainda não foi enviada)?'))return;
  try{await fzPendTira(k);}catch(e){}FZ_PEND=FZ_PEND.filter(z=>z.k!==k);const y=window.scrollY;gRender();window.scrollTo({top:y});}
window.addEventListener('online',()=>setTimeout(fzPendEnviar,1500));setInterval(fzPendEnviar,30000);setTimeout(fzPendCarrega,1500);
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

function diaCampoSync(){document.querySelectorAll('.gDiaCampo').forEach(b=>{const i=b.querySelector('input'),s=b.querySelector('span');if(!i||!s)return;const t=i.value?dB(i.value):'Escolher';if(s.textContent!==t){s.textContent=t;s.classList.toggle('vazio',!i.value);}});}
['input','change'].forEach(ev=>document.addEventListener(ev,e=>{if(e.target&&e.target.closest&&e.target.closest('.gDiaCampo'))diaCampoSync();},true));setInterval(diaCampoSync,800);
/* ---------- Medicamentos (Tratos): data, brinco, sintomas, ação realizada · filtro por data e pesquisa ---------- */
const medNz=t=>String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
function medLista(t){const q=medNz(t.q).trim(),de=t.de||'',ate=t.ate||'';
  return gTodos('med').filter(x=>(!de||x.dia>=de)&&(!ate||x.dia<=ate)&&(!q||medNz([x.brinco,x.sint,x.acao].join(' ')).includes(q)))
    .sort((a,b)=>a.dia!==b.dia?(a.dia<b.dia?1:-1):(+b.ts||0)-(+a.ts||0));}
function medItensHTML(t){const L=medLista(t),vis=typeof modoVer!=='undefined'&&modoVer;
  if(!L.length)return `<p class="note">${gTodos('med').length?'Nada encontrado com esse filtro.':'Nenhum registro ainda. Toque em + Novo registro.'}</p>`;
  return `<p class="note">${L.length} registro(s)</p>`+L.map(x=>`<div class="gItem" style="cursor:default;margin-bottom:8px;border-radius:12px">
    <div class="gItemTopo"><b>🏷 ${esc(x.brinco||'—')}</b><span class="pill">${dB(x.dia)}</span></div>
    ${x.sint?`<div style="margin-top:6px"><small style="color:var(--muted);font-weight:700">SINTOMAS</small><div style="white-space:pre-line">${esc(x.sint)}</div></div>`:''}
    ${x.acao?`<div style="margin-top:6px"><small style="color:var(--muted);font-weight:700">AÇÃO REALIZADA</small><div style="white-space:pre-line">${esc(x.acao)}</div></div>`:''}
    ${vis?'':`<div class="row" style="margin-top:8px"><button class="mini" data-g="medEd" data-id="${x.uid}">✏ Editar</button><button class="mini danger" data-g="medRm" data-id="${x.uid}">🗑 Excluir</button></div>`}</div>`).join('');}
function tMed(t){const vis=typeof modoVer!=='undefined'&&modoVer;
  if(t.de===undefined&&t.ate===undefined){t.ate=hojeKey();t.de=somaDias(t.ate,-89);}   // abre sempre nos últimos 90 dias
  if(t.form){const x=t.id?G.it[t.id]:null;
    return `<section class="panel"><h2>💉 ${x?'Editar registro':'Novo registro'}</h2><div class="gForm">${[{k:'mdDia',l:'Data',t:'dia',v:x?x.dia:hojeKey()}].map(campo).join('')}
      <div class="gCampo"><label for="gf_mdBrinco">Brinco do animal</label><input type="text" id="gf_mdBrinco" data-tecg="brinco" data-kg="brinco" inputmode="none" autocomplete="off" value="${esc(x?x.brinco||'':'')}" placeholder="Toque para digitar"></div>
      <div class="gCampo"><label for="gf_mdSint">Sintomas</label><textarea id="gf_mdSint" rows="2" placeholder="Ex.: tosse, febre, mancando" style="width:100%;box-sizing:border-box;resize:vertical;font:inherit;min-height:0;height:auto">${esc(x?x.sint||'':'')}</textarea></div>
      <div class="gCampo"><label for="gf_mdAcao">Ação realizada</label><textarea id="gf_mdAcao" rows="4" placeholder="Ex.: aplicado 10 ml de …" style="width:100%;box-sizing:border-box;resize:vertical;font:inherit;min-height:0;height:auto">${esc(x?x.acao||'':'')}</textarea></div></div>
      <button class="primary" data-g="medSalva" data-id="${x?x.uid:''}">💾 Salvar</button><button data-g="medVolta">Cancelar</button></section>`;}
  return `<section class="panel"><h2>💉 Medicamentos</h2>
    ${vis?'':'<button class="primary" data-g="medNovo">+ Novo registro</button>'}
    <style>#gBox .mdDatas .gCampo,#gBox .mdDatas .gDataBox,#gBox .mdDatas input{width:100%!important;min-width:0!important;max-width:none!important;flex:1 1 auto!important}</style><div class="gForm" style="margin-top:10px"><div class="mdDatas" style="display:flex;gap:10px;width:100%;grid-column:1/-1"><div style="flex:1 1 0;min-width:0">${campo({k:'mdDe',l:'Data de',t:'dia',v:t.de||''})}</div><div style="flex:1 1 0;min-width:0">${campo({k:'mdAte',l:'Até',t:'dia',v:t.ate||''})}</div></div>
      ${campo({k:'mdQ',l:'🔍 Pesquisar',v:t.q||'',ph:'Brinco, sintoma ou ação…'})}</div>
    ${t.de||t.ate?'<button class="mini" data-g="medLimpa">Ver todas as datas</button>':''}
    <div id="medLista" style="margin-top:10px">${medItensHTML(t)}</div></section>`;}
document.addEventListener('input',e=>{const t=e.target;if(!t||t.id!=='gf_obsF')return;GT.obsE=t.value;GT.pgEP=1;gMinAb.add('estRel');const c=t.selectionStart;gRender();
  const n=$('gf_obsF');if(n){n.focus();try{n.setSelectionRange(c,c);}catch(x){}}});   /* filtro de observação: vai filtrando a cada letra */
document.addEventListener('input',e=>{if(!e.target||GT.t!=='med')return;const id=e.target.id;
  if(id==='gf_mdQ'){GT.q=e.target.value;const w=$('medLista');if(w)w.innerHTML=medItensHTML(GT);}});
document.addEventListener('change',e=>{if(!e.target||GT.t!=='med')return;const id=e.target.id;
  if(id==='gf_mdDe'||id==='gf_mdAte'){GT[id==='gf_mdDe'?'de':'ate']=e.target.value||'';const y=window.scrollY;gRender();window.scrollTo({top:y});}});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-g="medNovo"],[data-g="medEd"],[data-g="medRm"],[data-g="medSalva"],[data-g="medVolta"],[data-g="medLimpa"]');if(!b)return;
  e.preventDefault();e.stopPropagation();if(typeof bloqueado==='function'&&bloqueado())return;const a=b.dataset.g,id=b.dataset.id;
  const filt={de:GT.de||'',ate:GT.ate||'',q:GT.q||''};
  if(a==='medNovo'){GT=Object.assign({t:'med',form:1},filt);gRender();window.scrollTo({top:0});return;}
  if(a==='medVolta'){GT=Object.assign({t:'med'},filt);gRender();return;}
  if(a==='medLimpa'){GT=Object.assign({t:'med'},filt,{de:'',ate:''});gRender();return;}
  if(a==='medEd'){if(window.pedirSenhaAcao&&!await pedirSenhaAcao('Senha para editar'))return;GT=Object.assign({t:'med',form:1,id},filt);gRender();window.scrollTo({top:0});return;}
  if(a==='medRm'){const x=G.it[id];if(!x)return;if(window.pedirSenhaAcao&&!await pedirSenhaAcao('Senha para excluir'))return;
    if(!await confirmaVermelho('Excluir este registro?',`Brinco ${x.brinco||'—'} · ${dB(x.dia)}`,'Sim, excluir','Não'))return;gDel(id);toast('Registro excluído');const y=window.scrollY;gRender();window.scrollTo({top:y});return;}
  if(a==='medSalva'){const dia=fv('mdDia'),brinco=(fv('mdBrinco')||'').trim(),sint=(($('gf_mdSint')||{}).value||'').trim(),acao=(($('gf_mdAcao')||{}).value||'').trim();
    if(!dia)return toast('Coloque a data');if(!brinco)return toast('Coloque o brinco do animal');if(!sint&&!acao)return toast('Coloque os sintomas ou a ação realizada');
    const x0=id&&G.it[id];gPut(Object.assign({},x0||{},{uid:x0?x0.uid:novoId('med'),tipo:'med',dia,brinco,sint,acao}));
    toast(x0?'Registro alterado':'Registro salvo');GT={t:'med',de:GT.de||'',ate:GT.ate||'',q:''};gRender();window.scrollTo({top:0});}},true);
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
function fzHistCanvas(){const t=GT,dia=t.dia,hN=[7,15,30].includes(+t.hN)?+t.hN:30,cH=t.hCur||'',ini=fzIni(t,dia,cH);
  const porDia={};gTodos('fezes').filter(x=>x.dia>=ini&&x.dia<=dia&&(cH?nAt(x.curral)===cH:doLocal(t.loc,nAt(x.curral)))).forEach(x=>{const k=fzCalc(x.c);if(!k.tot)return;const d=porDia[x.dia]||(porDia[x.dia]=[0,0,0,0,0]);k.cs.forEach((n,i)=>d[i]+=n);});
  const dias=Object.keys(porDia).sort();if(!dias.length)return null;
  const W=1240,top=130,gH=460,rowH=44,H=top+40+gH+70+60+(dias.length+1)*rowH+90,cv=document.createElement('canvas');cv.width=W;cv.height=H;const x=cv.getContext('2d');
  const quem=cH||(t.loc==='C'?'Todo o confinamento':t.loc==='P'?'Todo o pasto':'Todos os currais');
  x.fillStyle='#fff';x.fillRect(0,0,W,H);x.fillStyle='#24502a';x.fillRect(0,0,W,top);
  x.fillStyle='#fff';x.textAlign='left';x.font='bold 40px Arial';x.fillText('Escore de fezes · Histórico',40,62);
  x.font='24px Arial';x.fillStyle='#d8f06a';x.fillText(`${quem} · últimas ${hN} leituras (${dB(ini).slice(0,5)} a ${dB(dia).slice(0,5)}) · FJK Agropecuária`,40,102);
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
  const nome=`Escore de fezes historico ${hN} leituras ${(t.hCur||'todos').replace(/[\\/:*?"<>|]/g,'-')} ${dB(t.dia).replace(/\//g,'-')}`;
  try{if(pdf)await compartilharArquivo(fzPdf([cv]),nome+'.pdf','application/pdf');
    else cv.toBlob(b=>compartilharArquivo(b,nome+'.png','image/png'),'image/png');}catch(e){toast('Não consegui gerar o arquivo');}}
window.fzHistCanvas=fzHistCanvas;
/* ---------- Relatório zootécnico do dia (Tratos › Histórico): por lote/curral, com consumo MN, MS e % PV ---------- */
function zootDados(dia,loc){const X=gCtx(),L=gTodos('lote').filter(l=>l.ent&&cabPres(l,dia,X.sd.get(l.uid))>0);
  const media=(l,ini,fim,f)=>{let s=0,n=0;for(let d=ini,i=0;d<=fim&&i<4000;d=somaDias(d,1),i++){const x=diaLote(l,d,X);if(x&&x.mn>0){const v=f(x);if(ok(v)){s+=v;n++;}}}return n?s/n:NaN;};
  const rows=[];L.forEach(l=>{const x=diaLote(l,dia,X);if(!x||!doLocal(loc||'T',x.c))return;
    const d1=diaLote(l,somaDias(dia,-1),X),lt=G.it[idLeit(dia,x.c)],ini5=somaDias(dia,-4),ini0=l.ent.dia>ini5?l.ent.dia:ini5;
    rows.push({c:nAt(x.c),lote:l.nome,sexo:sexoNorm(l.sexo)||'',ent:l.ent.dia,cab:x.cab,dias:difDias(l.ent.dia,dia),rac:(()=>{let t=linhaDe(nAt(x.c));if(t==='O')t=linhaDe(x.c);if(t==='O')t=/pasto/i.test(x.rac||'')?'P':'C';return t==='P'?'Pasto':'Conf';})(),racNome:x.rac,nota:lt&&!lt.del&&lt.nota!=null?+lt.nota:null,msRac:x.cp?Math.round(x.cp.ms*10)/10:NaN,
      pE:pesoEntMed(l),pP:x.peso,gmd:+l.gmd||NaN,
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
  ['pvG','Geral','pv',2,75],['pvD','Dia','pv',2,75],['pv1','D-1','pv',2,75],['pv5','5 dias','pv',2,75],
  ['mnG','Geral','mn',2,85],['mnD','Dia','mn',2,85],
  ['msG','Geral','ms',2,80],['msD','Dia','ms',2,80],['ms1','D-1','ms',2,80],['ms5','5 dias','ms',2,80],
  ['fD','Diária','fin','rs',95],['fA','Acumulado','fin','rs',115]];
const ZGRP={id:'Identificação',id2:'Trato',nt:'Nota',fin:'R$/cab',pes:'Peso (kg)',mn:'MN kg/cab/dia',ms:'MS kg/cab/dia',pv:'% IMS do PV'};
const ZCOR={id:'#24502a',id2:'#5b8f3e',pes:'#24502a',nt:'#5b8f3e',pv:'#24502a',mn:'#5b8f3e',ms:'#24502a',fin:'#1f5fa8'};
const zVal=(r,k,d)=>{const v=r[k];if(d==='dia')return v?dB(v):'';if(d==='rs')return ok(+v)?nf(+v,2):'—';if(d==null)return v==null?'':String(v);return ok(+v)&&v!==null&&v!==''?nf(+v,d):'—';};
function zootCards(T){return [['Cabeças',nf(T.cab)],['Peso entrada',nf(T.pE,1)+' kg'],['Peso projetado',nf(T.pP,1)+' kg'],['GMD',nf(T.gmd,2)],['Dias (média)',nf(T.dias)],['MN dia',nf(T.mnD,2)+' kg/cab'],['MS dia',nf(T.msD,2)+' kg/cab'],['% PV dia',pc(T.pvD,2)]];}
/* estado único do relatório de índices: o mesmo em Tratos › Histórico › Relatório e em Gestão › Relatórios › Índices do dia */
window.ZST=window.ZST||{dia:null,loc:'T'};
function zootBoxHTML(aberto){const dia=ZST.dia||(ZST.dia=hojeKey()),loc=ZST.loc||'T',D=zootDados(dia,loc);
  const LZ=window.LOC_OPS||[['T','Todos'],['C','Confinamento'],['P','Pasto']],li=Math.max(0,LZ.findIndex(o=>o[0]===loc)),hj=hojeKey(),[y_,m_,d_]=dia.split('-').map(Number),tg=dia===hj?' <i>Hoje</i>':dia===somaDias(hj,-1)?' <i>Ontem</i>':'';
  const top=`<h2 class="zTit">Filtrar</h2>
    <div class="hNavUm hNavB"><span class="hNavLbl">Data</span><div class="gNavData zNavDia"><button type="button" class="gSeta" data-zd="-1" aria-label="Dia anterior">◀</button><label class="gDataBox"><span>${SEM[new Date(y_,m_-1,d_).getDay()]} ${dB(dia).slice(0,6)+dB(dia).slice(8)}${tg}</span><input type="date" id="zDia" value="${dia}" max="${hj}" aria-label="Dia do relatório"></label><button type="button" class="gSeta" data-zd="1" aria-label="Dia seguinte"${dia>=hj?' disabled':''}>▶</button></div></div>
    <div class="zLocNav">${typeof selSetas==='function'?selSetas('Local',LZ,li,'data-zlp','data-zlsel'):''}</div>
    ${D.rows.length?'<div class="row compart fz3"><button class="verde" data-z="pdf">📄 PDF</button><button class="verde" data-z="img">🖼 Foto</button><button class="verde" data-z="xls">📊 Excel</button></div>':''}
    <p class="note">${dB(dia)}: consumo de matéria natural, matéria seca, % do peso vivo e custo por cabeça.</p>`;
  if(!D.rows.length)return top+'<p class="note">Nenhum lote com animais neste dia.</p>';
  const tab=`<div class="tablebox"><table class="gTab zTab"><thead><tr><th>Curral</th><th>Qtd.</th><th>Dias</th><th>MN dia</th><th>MS dia</th><th>% PV</th></tr></thead><tbody>
    ${D.rows.map(r=>`<tr><td class="c">${esc(r.c)}<small>${r.rac}${r.sexo?' · '+r.sexo:''}${r.nota!=null?' · nota '+r.nota:''}</small><small class="zFin">${rs(r.fD)}/dia · acum. ${rs(r.fA)}</small></td><td>${nf(r.cab)}</td><td>${nf(r.dias)}</td><td>${nf(r.mnD,2)}</td><td><b>${nf(r.msD,2)}</b></td><td>${pc(r.pvD,2)}</td></tr>`).join('')}
    <tr class="grp"><td>Média<small class="zFin">${rs(D.T.fD)}/dia · acum. ${rs(D.T.fA)}</small></td><td>${nf(D.T.cab)}</td><td></td><td>${nf(D.T.mnD,2)}</td><td>${nf(D.T.msD,2)}</td><td>${pc(D.T.pvD,2)}</td></tr></tbody></table></div>
    <p class="note">MN e MS em kg por cabeça no dia. Em azul, o custo por cabeça (ração + operacional): do dia e acumulado desde a entrada. O PDF, a Foto e o Excel trazem o relatório completo.</p>`;
  if(aberto)return top+tab;const ab=!!(window.__hAb&&window.__hAb.R);
  return top+`<div class="zHist${ab?' aberto':''}"><button type="button" class="zHistCab" data-zhist><span>Índices por curral</span><small class="note">${D.rows.length} curral(is)</small><span class="hColSeta">▼</span></button><div class="zHistCorpo">${tab}</div></div>`;}
window.zootBoxHTML=zootBoxHTML;
function zootRepintar(){try{if(window.pintarZoot)pintarZoot();}catch(e){}if(GT&&GT.t==='indices')gRender();}
if(!window.__zootEv){window.__zootEv=1;
  document.addEventListener('click',e=>{const box=e.target.closest('.zootBox');if(!box)return;
    const zh=e.target.closest('[data-zhist]');if(zh){if(window.__hAb)window.__hAb.R=!window.__hAb.R;zh.parentNode.classList.toggle('aberto');return;}
    const l=e.target.closest('[data-zloc]');if(l){ZST.loc=l.dataset.zloc;zootRepintar();return;}
    const zd=e.target.closest('[data-zd]');if(zd&&!zd.disabled){const n=somaDias(ZST.dia||hojeKey(),+zd.dataset.zd);ZST.dia=n>hojeKey()?hojeKey():n;zootRepintar();return;}
    const zp=e.target.closest('[data-zlp]');if(zp&&!zp.disabled){const L=['T','C','P'];let i=Math.max(0,L.indexOf(ZST.loc||'T'));ZST.loc=L[Math.max(0,Math.min(2,i+(+zp.dataset.zlp)))];zootRepintar();return;}
    const zi=e.target.closest('.zNavDia .gDataBox input');if(zi&&zi.showPicker){try{zi.showPicker();}catch(_){}}
    const b=e.target.closest('[data-z]');if(b)zootExport(b.dataset.z,ZST.dia||hojeKey(),ZST.loc||'T');});
  document.addEventListener('change',e=>{if(e.target.id==='zDia'&&e.target.closest('.zootBox')&&e.target.value){ZST.dia=e.target.value;zootRepintar();return;}
    const zs=e.target.closest('.zootBox select[data-zlsel]');if(zs){ZST.loc=zs.value;zootRepintar();}});}
function tIndices(){return `${voltar('Relatórios')}<section class="panel zootBox">${zootBoxHTML(true)}</section>`;}
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
  const nome=`FJK - Índices do dia ${dB(dia).replace(/\//g,'-')}${D.loc==='C'?' - Confinamento':D.loc==='P'?' - Pasto':''}`;
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
function itensAjust(its){const o=CG.ordem,ja=sobraPorIns(),mn=CG.man||{};let L=its.map(i=>{const j=Math.max(0,+ja[i.ins]||0),m=Math.max(0,+mn[i.ins]||0);return Object.assign({},i,{prevOrig:i.prev,ja:j,man:m,prev:Math.max(0,i.prev-j-m)});});
  if(Array.isArray(o)&&o.length)L.sort((a,b)=>{const ia=o.indexOf(a.ins),ib=o.indexOf(b.ins);return (ia<0?999:ia)-(ib<0?999:ib);});return L;}
function cBotAjuste(){const nJa=Object.values(sobraPorIns()).filter(v=>v>0).length,mud=Array.isArray(CG.ordem)&&CG.ordem.length;
  /* aberto = verde cheio; fechado com ordem mudada = contorno verde com ✓ (a ordem continua valendo) */
  const nMan=Object.values(CG.man||{}).filter(v=>v>0).length;
  return `<button type="button" class="mini${CG.manAberto?' sel':''}" data-cmantog="1">✋ Manual${nMan?' ('+nMan+')':''}</button><button type="button" class="mini${CG.jaAberto?' sel':''}" data-cjatog="1">⚖ Sobra${nJa?' ('+nJa+')':''}</button><button type="button" class="mini${CG.ordAberto?' sel':mud?' mud':''}" data-cordtog="1">⇅ Ordem${mud&&!CG.ordAberto?' ✓':''}</button>`;}
function cTabelaCarga(its){const temJa=CG.jaAberto||its.some(i=>i.ja>0),tot=its.reduce((a,i)=>a+i.prev,0),totJa=its.reduce((a,i)=>a+i.ja,0);
  const temMan=CG.manAberto||its.some(i=>i.man>0),totMan=its.reduce((a,i)=>a+(i.man||0),0);
  const manNota=CG.manAberto?`<div class="cSobra"><b>✋ Carregamento manual</b><p class="note">Digite na coluna <b>Manual</b> quanto de cada produto foi colocado à mão (fora da balança). A balança carrega só o resto. O manual <b>sai do estoque</b> junto com o carregamento.</p>
    ${its.filter(i=>i.man>i.prevOrig-i.ja).length?`<p class="cAviso">⚠ Manual maior que o necessário: ${its.filter(i=>i.man>i.prevOrig-i.ja).map(i=>`${esc(i.nome)} (manual ${nf(i.man)} kg, precisa ${nf(Math.max(0,i.prevOrig-i.ja))} kg)`).join('; ')}.</p>`:''}</div>`:'';
  const ord=CG.ordAberto?`<div class="cOrdem"><p class="note">Toque nas setas para mudar a ordem de fabricação <b>só deste carregamento</b>.</p>
    ${its.map((i,k)=>`<div class="cOrdLin"><b>${k+1}.</b><span>${esc(i.nome)}</span><button type="button" data-cmov="-1" data-ins="${esc(i.ins)}"${k?'':' disabled'} aria-label="Subir">▲</button><button type="button" data-cmov="1" data-ins="${esc(i.ins)}"${k<its.length-1?'':' disabled'} aria-label="Descer">▼</button></div>`).join('')}
    ${Array.isArray(CG.ordem)?'<button type="button" class="mini" data-cordreset="1">↩ Voltar para a ordem da ração</button>':''}</div>`:'';
  let jaNota='';if(CG.jaAberto){const md=(CG.sobModo||'rac')==='rac'?'rac':'ins',sob=sobraPorIns(),noIts=new Set(its.map(i=>i.ins));
    const fora=Object.keys(sob).filter(k=>sob[k]>0&&!noIts.has(k)).map(k=>`${esc((G.it[k]||{}).nome||'?')} ${nf(sob[k])} kg`),
      demais=its.filter(i=>i.ja>i.prevOrig).map(i=>`${esc(i.nome)} (sobra ${nf(i.ja)} kg, a mistura usa ${nf(i.prevOrig)} kg)`);
    const rac=gTodos('racao').filter(r=>!r.inativa||r.uid===CG.sobRac).sort(porNome);
    jaNota=`<div class="cSobra"><div class="linhas"><b>Sobra no vagão:</b><button type="button" data-csmodo="rac" class="${md==='rac'?'sel':''}">Ração</button><button type="button" data-csmodo="ins" class="${md==='ins'?'sel':''}">Insumo</button></div>
      ${md==='rac'?`<div class="cSobLin"><select id="cSobRac"><option value="">Selecione</option>${rac.map(r=>`<option value="${r.uid}"${r.uid===CG.sobRac?' selected':''}>${esc(r.nome)}</option>`).join('')}</select>
        <input type="text" readonly inputmode="none" data-tecin="1" data-tecnome="Sobra no vagão (kg)" id="cSobKg" placeholder="kg" value="${CG.sobKg?String(CG.sobKg).replace('.',','):''}"></div>
        ${Object.keys(sob).length?`<p class="note">Nessa sobra tem: ${Object.keys(sob).map(k=>`<b>${esc((G.it[k]||{}).nome||'?')}</b> ${nf(sob[k])} kg`).join(' · ')}. Já foi descontado abaixo.</p>`:'<p class="note">Escolha a ração que sobrou e quantos kg. O app calcula quanto tem de cada produto e desconta do carregamento.</p>'}`
      :'<p class="note">Digite na coluna <b>Sobra</b> quanto de cada produto já está no vagão.</p>'}
      ${fora.length?`<p class="cAviso">⚠ Na sobra tem produto que esta ração não usa: ${fora.join(', ')}. Ele vai junto na mistura.</p>`:''}
      ${demais.length?`<p class="cAviso">⚠ Sobra maior que o necessário: ${demais.join('; ')}.</p>`:''}
      <p class="note">A fórmula da ração não muda; o estoque baixa só o que for carregado agora.</p></div>`;}
  /* vagão não está vazio (balança da Automação mostra peso) e a sobra não foi descontada: avisa */
  let vazNota='';try{const pv=window.AUTO&&AUTO.fonte&&AUTO.peso!=null&&$('viewAutoC')&&!$('viewAutoC').hidden?Math.round(AUTO.peso):null;
    if(pv!=null&&pv>100&&!Object.values(sobraPorIns()).some(v=>v>0))vazNota=`<p class="cAviso">⚠ A balança mostra <b>${nf(pv)} kg</b> no vagão antes de carregar. Se for ração que sobrou, toque em <b>⚖ Sobra</b> e informe, para não carregar a mais.</p>`;}catch(e){}
  return vazNota+ord+jaNota+manNota+`<div class="tablebox"><table class="gTab"><thead><tr><th>Produto</th><th>% MN</th>${temJa?'<th>Sobra</th>':''}${temMan?'<th>Manual</th>':''}<th>Carregar (kg)</th></tr></thead><tbody>${its.map(i=>`<tr><td class="c">${esc(i.nome)}${i.ja>0?`<small>mistura: ${nf(i.prevOrig)} kg</small>`:''}</td><td>${nf(i.pMN,1)}</td>${temJa?`<td>${CG.jaAberto&&(CG.sobModo||'rac')!=='rac'?`<input type="text" readonly inputmode="none" data-tecin="1" data-tecnome="Sobra · ${esc(i.nome)} (kg)" class="cJaIn" data-cja="${esc(i.ins)}" value="${i.ja?String(i.ja).replace('.',','):''}" placeholder="0">`:nf(i.ja)}</td>`:''}${temMan?`<td>${CG.manAberto?`<input type="text" readonly inputmode="none" data-tecin="1" data-tecnome="Manual · ${esc(i.nome)} (kg)" class="cJaIn" data-cman="${esc(i.ins)}" value="${i.man?String(i.man).replace('.',','):''}" placeholder="0">`:nf(i.man||0)}</td>`:''}<td><b>${nf(i.prev)}</b>${i.ja>0&&i.prev===0?'<small>já tem tudo</small>':i.man>0&&i.prev===0?'<small>tudo manual</small>':''}</td></tr>`).join('')}
      <tr class="grp"><td>Total</td><td>100,0</td>${temJa?`<td>${nf(totJa)}</td>`:''}${temMan?`<td>${nf(totMan)}</td>`:''}<td>${nf(tot)}</td></tr></tbody></table></div>
    ${totMan>0?`<p class="note">✋ Manual: <b>${nf(totMan)} kg</b> já colocado à mão · a balança carrega <b>${nf(tot)} kg</b>.</p>`:''}${totJa>0?(()=>{const sobT=Object.values(sobraPorIns()).reduce((a,v)=>a+(+v||0),0),fin=sobT+tot;return `<p class="note">Mistura final no vagão: <b>${nf(fin)} kg</b> = ${nf(sobT)} kg de sobra + ${nf(tot)} kg a carregar${Math.abs(fin-CG.total)>1?` (o previsto era ${nf(CG.total)} kg)`:''}.</p>`;})():''}`;}
/* Carregar: avisa (sem bloquear) quando todos os currais do trato escolhido já foram tratados hoje */
/* trato que ainda pode entrar junto na batida: tem curral pendente e ainda não foi carregado hoje (mesmo local e ração) */
function cTratoPendente(k){const hj=hojeKey();if(typeof fornPendentes==='function'&&!fornPendentes(CG.local,CG.rac,k).length)return false;
  return !gTodos('carga').some(c=>c.dia===hj&&(c.local||'')===(CG.local||'')&&(!CG.rac||c.racao===CG.rac)&&((c.tratos&&c.tratos.length?c.tratos:[c.trato]).map(Number).includes(+k)));}
/* Expandir tratos: mostra os currais que entram no total da batida; todos marcados; desmarcar tira a quantidade daquele curral */
function cCurrCarga(trs){const mp=new Map();trs.forEach(k=>{const m=(S.prev||{})[String(k)]||{};sugestaoCarga(k,CG.rac,CG.local).cs.forEach(c=>mp.set(c,(mp.get(c)||0)+(+m[c]||0)));});
  const ord=c=>{const i=(S.cadastro||[]).indexOf(c);return i<0?999:i;};return [...mp].map(([c,kg])=>({c,kg})).sort((a,b)=>ord(a.c)-ord(b.c));}
/* currais já carregados hoje (batidas finalizadas do mesmo local e ração, num destes tratos) → hora da batida */
function cJaCarr(trs){const m=new Map(),hj=hojeKey();try{gTodos('carga').filter(c=>c.dia===hj&&Array.isArray(c.cur)&&(c.local||'')===(CG.local||'')&&c.racao===CG.rac&&(c.tratos||[c.trato]).some(k=>trs.includes(+k)))
  .sort((a,b)=>(a.ts0||0)-(b.ts0||0)).forEach(c=>c.cur.forEach(n=>{if(!m.has(n))m.set(n,'carregado'+(c.hora?' '+c.hora:''));}));}catch(e){}
  /* curral que já foi tratado (fornecido) hoje num destes tratos também conta como já carregado (ex.: batidas de antes, que não guardavam os currais) */
  try{(typeof HIST!=='undefined'?HIST:[]).filter(r=>r.dia===hj&&trs.includes(+r.trato)&&+r.forn>0).sort((a,b)=>(a.ts||0)-(b.ts||0)).forEach(r=>{if(!m.has(r.curral))m.set(r.curral,'tratado'+(r.hora?' '+r.hora:''));});}catch(e){}
  return m;}
function cExpHTML(trs){const L=cCurrCarga(trs);if(!L.length)return '';const ds=CG.desm||[],nM=L.filter(x=>!ds.includes(x.c)).length,ja=cJaCarr(trs);
  return `<button type="button" class="mini cExpTog${CG.expAberto?' sel':''}" data-cexp="1">${CG.expAberto?'▲ Recolher tratos':'▼ Expandir tratos'}${ds.length?` · ${nM} de ${L.length} currais`:''}</button>`+
    (CG.expAberto?`<div class="cExpTodos">${nM<L.length?'<button type="button" class="mini" data-cexpall="1">✓ Marcar todos</button>':'<button type="button" class="mini" data-cexpall="0">✕ Desmarcar todos</button>'}</div><div class="cJuntoLista cExpLista">${L.map(x=>{const on=!ds.includes(x.c);const jh=ja.get(x.c);return `<button type="button" data-cexpc="${esc(x.c)}" class="${on?'sel':''}${jh!=null&&!on?' cJaCarr':''}"><span>${on?'✓ ':''}${esc(x.c)}</span><small><i class="kg">${nf(x.kg)} kg</i>${jh!=null?` · <em>já ${esc(jh)}</em>`:''}</small></button>`;}).join('')}</div><p class="note">Toque no curral para colocar ou tirar a quantidade dele no carregamento.</p>`:'');}
function cExpAplicar(){const trs=[+CG.trato].concat(CG.juntos||[]),L=cCurrCarga(trs),ds=CG.desm||[];CG.total=L.filter(x=>!ds.includes(x.c)).reduce((a,x)=>a+x.kg,0);}
function cJaTratadoHTML(trs){if(typeof fornCurrais!=='function'||typeof fornPendentes!=='function')return '';
  const feitos=trs.filter(k=>k>0&&fornCurrais(CG.local,CG.rac,k).length&&!fornPendentes(CG.local,CG.rac,k).length);if(!feitos.length)return '';
  const prox=tratosAtivos().map(Number).find(k=>!trs.includes(k)&&fornPendentes(CG.local,CG.rac,k).length);
  return `<div class="cJaFeito">⚠ ${feitos.length>1?'Tratos '+feitos.join(' e '):'Trato '+feitos[0]} / ${NOMELOC[CG.local]} já ${feitos.length>1?'realizados':'realizado'}<small>${prox?`O próximo é o Trato ${prox}, mas, se`:'Se'} precisar, pode carregar mesmo assim. Continue abaixo.</small></div>`;}
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
  if(n&&!$('viewGest').hidden&&!gEditando())gRenderManter();return n;}catch(e){return 0;}}
window.migrarRenomes=migrarRenomes;
setTimeout(migrarRenomes,7000);setInterval(migrarRenomes,60000);

/* =====================================================================================
   RELATÓRIOS DO DIA: botão da tela inicial → gera os PDFs marcados em Config. › Relatórios e abre o compartilhar (WhatsApp)
   ===================================================================================== */
const REL_DIA=[
  ['tratosJ','Tratos do dia','todos os tratos numa tabela só (hora, curral, previsto, realizado e diferença)'],
  ['tratosC','Tratos do dia por curral','soma do dia por curral, com % PV'],
  ['batidas','Carregamentos do vagão','carregamentos do dia com os insumos e o total'],
  ['grafNota','Gráfico de notas','notas da leitura de cocho de cada curral (últimos 7, 10 ou 15 dias, como escolhido no gráfico)'],
  ['grafIms','Gráfico de %IMS','% IMS realizado de cada curral (últimos 7, 10 ou 15 dias, como escolhido no gráfico)'],
  ['fezes','Escore de fezes','avaliações do dia'],
  ['resumo','Resumo do dia','o resumo da Gestão (cabeças, consumo, custo, alertas)'],
  ['indices','Índices do dia','MN, MS, % PV e custo por curral'],
  ['relDia','Relatório do dia por lote','consumo e custo de cada lote e insumos usados'],
  ['lotes','Lotes ativos','lista dos lotes com custo, venda e previsão de abate'],
  ['estoque','Estoque','os quadros coloridos de cada produto (saldo, finaliza em, consumo, mínimo)'],
  ['insumos','Insumos','preço e estoque de cada insumo']];
/* títulos dos grupos na lista de Relatórios (juntando os do mesmo assunto) */
const REL_GRP={tratosJ:'🐂 Tratos',tratosC:'🐂 Tratos',batidas:'🐂 Tratos',tratosPC:'🐂 Tratos',tratosPJ:'🐂 Tratos',batidasP:'🐂 Tratos',
  grafNota:'🔍 Leitura de cocho e fezes',grafIms:'🔍 Leitura de cocho e fezes',fezes:'🔍 Leitura de cocho e fezes',
  resumo:'📊 Consumo, índices e lotes',indices:'📊 Consumo, índices e lotes',relDia:'📊 Consumo, índices e lotes',lotes:'📊 Consumo, índices e lotes',perLote:'📊 Consumo, índices e lotes',comp:'📊 Consumo, índices e lotes',
  estoque:'📦 Estoque e insumos',insumos:'📦 Estoque e insumos',estMov:'📦 Estoque e insumos',vendas:'💰 Vendas'};
function relDiaFmt(){const f=gCfg().relDiaFmt;return f==='img'||f==='xls'?f:'pdf';}   /* formato do botão 📤 Relatórios do dia (Config. › Relatórios) */
window.relDiaFmt=relDiaFmt;
function relDiaSel(){const c=gCfg(),ks=new Set(REL_DIA.map(x=>x[0]));return (Array.isArray(c.relDia)?c.relDia:['tratosC','indices','estoque']).filter(k=>ks.has(k));}
window.relDiaSel=relDiaSel;
$('gBox').addEventListener('change',e=>{const t=e.target;if(!t.matches||!t.matches('input[data-reld]'))return;if(typeof bloqueado==='function'&&bloqueado()){t.checked=!t.checked;return;}
  const c=JSON.parse(JSON.stringify(gCfg())),v=new Set(relDiaSel());t.checked?v.add(t.dataset.reld):v.delete(t.dataset.reld);c.relDia=REL_DIA.map(x=>x[0]).filter(k=>v.has(k));gPut(c);toast(`${c.relDia.length} relatório(s) marcado(s)`);});
/* o que ainda falta tratar no dia (previsto sem registro) */
function diaFaltas(dia){const P=(typeof prevDoDia==='function'?prevDoDia(dia):null)||{},feito=new Set((typeof HIST!=='undefined'?HIST:[]).filter(r=>r.dia===dia).map(r=>r.trato+'|'+r.curral)),F=[];
  for(let k=1;k<=(typeof MAXT!=='undefined'?MAXT:8);k++){const m=P[String(k)]||P[k]||{};Object.keys(m).forEach(c=>{const v=+m[c];if(!(v>0))return;if(typeof curralAtivo==='function'&&!curralAtivo(c))return;if(!feito.has(k+'|'+c))F.push({t:k,c,kg:v});});}
  return F;}
window.diaFaltas=diaFaltas;
async function relDiaGerar(k,dia){const GT0=GT,gL=gLoc;
  try{switch(k){
    case 'tratosJ':return await window.histPdfDia(dia,'juntos');
    case 'tratosC':return await window.histPdfDia(dia,'curral');
    case 'batidas':{const L=batidasLista(dia,dia,'T',0);if(!L.length)return;window.__expPdf=true;return await imgBatidas(L,dB(dia),'juntas');}
    case 'resumo':{GT={t:'home',dia};tHome(GT);return await resPdf();}
    case 'relDia':window.__expPdf=true;return await imgDia(dia);
    case 'indices':return await zootExport('pdf',dia,'T');
    case 'confBal':GT={t:'cfg',cbDia:dia};return await confBatExp('pdf');
    case 'confRes':return await confResumoPer('pdf',dia,dia);
    case 'grafNota':GT={t:'cochoGraf',dia,o:'nota'};if(!dadosGraf(dia).linhas.length)return;return imagemGraf(true);
    case 'grafIms':GT={t:'cochoGraf',dia,o:'ims'};if(!dadosGrafIms(dia).linhas.length)return;return imagemGrafIms(true);
    case 'saltos':return await saltosPer('pdf',dia,dia);
    case 'fezes':GT={t:'fezes',dia,loc:'T'};if(!fzDadosDia().length)return;return await fzRelPdf();
    case 'estoque':return await estCardsPdf(dia);
    case 'lotes':gLoc='T';return await lotesExp('lotesPdf',false);
    case 'insumos':return await insExp('pdf');}}
  finally{GT=GT0;gLoc=gL;window.__expPdf=false;}}
/* Gestão › Relatórios: gera um relatório marcado no formato escolhido (pdf, img ou xls) e espera o arquivo sair */
async function relExpGerar(k,dia,fmt,ini,fim){const GT0=GT,gL=gLoc,cap=window.__capArq,n0=cap.length,pdf=fmt==='pdf',img=fmt==='img',xls=fmt==='xls';
  const espera=async()=>{for(let w=0;w<40&&cap.length===n0;w++)await new Promise(r=>setTimeout(r,150));};
  try{switch(k){
    case 'tratosPC':await window.histExpPer(ini,fim,'curral',fmt);break;
    case 'tratosPJ':await window.histExpPer(ini,fim,'juntos',fmt);break;
    case 'batidasP':{const L=batidasLista(ini,fim,'T',0);if(!L.length)break;const rot=ini===fim?diaBR(ini):diaBR(ini)+' a '+diaBR(fim);if(xls){await window.xlsBatidas(L,rot);break;}window.__expPdf=pdf;await window.imgBatidas(L,rot,'juntas');break;}
    case 'perLote':GT={t:'periodo',ini,fim};if(!periodoDados(ini,fim).lotes.length)break;if(xls){await xlsPer();break;}window.__expPdf=pdf;await imgPer();break;
    case 'estMov':GT={t:'estoque',perE:-1,perEDia:hojeKey(),perEDe:ini,perEAte:fim,tipoE:'',prodE:'',fornE:''};await estExp(fmt);break;
    case 'vendas':GT={t:'vendas',vF:{ini,fim,por:'cpr'}};if(!vendasFiltradas(GT.vF).length)break;if(xls){await xlsVendas();break;}window.__expPdf=pdf;await imgVendas();break;
    case 'comp':GT={t:'comp',compEnc:false};if(xls){await xlsComp();break;}window.__expPdf=pdf;await imgComp();break;
    case 'tratosJ':await window.histExpDia(dia,'juntos',fmt);break;
    case 'tratosC':await window.histExpDia(dia,'curral',fmt);break;
    case 'batidas':{const L=batidasLista(dia,dia,'T',0);if(!L.length)break;if(xls){await window.xlsBatidas(L,diaBR(dia));break;}window.__expPdf=pdf;await window.imgBatidas(L,diaBR(dia),'juntas');break;}
    case 'resumo':GT={t:'home',dia};tHome(GT);if(pdf)await resPdf();else if(img)await resImg();else await resXls();break;
    case 'relDia':if(xls){await xlsDia(dia);break;}window.__expPdf=pdf;await imgDia(dia);break;
    case 'indices':await zootExport(fmt,dia,'T');break;
    case 'confBal':GT={t:'cfg',cbDia:dia};await confBatExp(fmt);break;
    case 'confRes':await confResumoPer(fmt,dia,dia);break;
    case 'grafNota':GT={t:'cochoGraf',dia,o:'nota'};if(!dadosGraf(dia).linhas.length)break;if(xls)xlsGraf();else imagemGraf(pdf);break;
    case 'grafIms':GT={t:'cochoGraf',dia,o:'ims'};if(!dadosGrafIms(dia).linhas.length)break;if(xls)xlsGrafIms();else imagemGrafIms(pdf);break;
    case 'saltos':await saltosPer(fmt,dia,dia);break;
    case 'confResP':await confResumoPer(fmt,ini,fim);break;
    case 'saltosP':await saltosPer(fmt,ini,fim);break;
    case 'confBalP':await confBalPer(fmt,ini,fim);break;
    case 'fezes':GT={t:'fezes',dia,loc:'T'};if(!fzDadosDia().length)break;if(pdf)await fzRelPdf();else if(img)await fzRelImg();else await fzXls(false);break;
    case 'estoque':if(xls)break;await estCardsPdf(dia,fmt);break;
    case 'lotes':gLoc='T';await lotesExp(pdf?'lotesPdf':img?'lotesImg':'lotesXls',false);break;
    case 'insumos':await insExp(fmt);break;}
    await espera();}
  catch(e){console.error(e);}
  finally{GT=GT0;gLoc=gL;window.__expPdf=false;}
  return cap.length>n0;}
/* ver o relatório na tela: gera a imagem (igual à exportada) e mostra embaixo do nome */
var relVerSeq=0,relVerCache={k:"",h:""};
async function relVerCarregar(){const box=document.getElementById('gRelVer');if(!box||!GT||(GT.t!=='rels'&&!relBal())||!GT.relAb)return;
  const k=GT.relAb,dia=GT.dia||hojeKey(),per=relModo()==='per',[ini,fim]=relFaixa(),ck=per?ini+'|'+fim:dia,seq=++relVerSeq;
  while(window.__capArq)await new Promise(r=>setTimeout(r,200));
  const cap=[];window.__capArq=cap;const t0=window.toast;window.toast=()=>{};let F=[];
  try{await relExpGerar(k,dia,'img',ini,fim);F=cap.slice();}finally{window.__capArq=null;window.toast=t0;}
  const b2=document.getElementById('gRelVer');if(!b2||seq!==relVerSeq||GT.relAb!==k)return;
  const h=F.length?F.map(f=>`<img src="${URL.createObjectURL(f)}" alt="${esc(f.name)}">`).join(''):(per?'<p class="note">Sem dados nesse período.</p>':'<p class="note">Sem dados nessa data.</p>');
  relVerCache={k:k+'|'+ck,h};b2.innerHTML=h;}
window.relVerCarregar=relVerCarregar;
/* tocou na imagem do relatório: abre em tela cheia, só para ver (aproxima com dois dedos ou dois toques; ◀ Voltar fecha) */
function verImagens(srcs){if(!srcs.length)return;const f=document.createElement('div');f.className='zoomFundo';
  f.innerHTML=`<div class="zoomArea"><div class="zoomMeio"><div class="zoomCont"><div class="zoomBar"><button type="button" class="zoomVolta">◀ Voltar</button></div>${srcs.map(u=>`<img src="${u}" alt="">`).join('')}</div></div></div>`;
  document.body.appendChild(f);document.documentElement.classList.add('zoomAberto');
  const area=f.querySelector('.zoomArea'),cont=f.querySelector('.zoomCont');let z=1;
  const aplica=(n,cx,cy)=>{n=Math.max(1,Math.min(6,n));const r=area.getBoundingClientRect();if(cx==null){cx=r.width/2;cy=r.height/2;}
    const px=(area.scrollLeft+cx)/z,py=(area.scrollTop+cy)/z;z=n;cont.style.width=Math.round(area.clientWidth*.96*z)+'px';area.scrollLeft=px*z-cx;area.scrollTop=py*z-cy;};
  cont.style.width=Math.round(area.clientWidth*.96)+'px';
  let p0=null,ultToque=0;
  const dist=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
  area.addEventListener('touchstart',e=>{if(e.touches.length===2){const r=area.getBoundingClientRect();p0={d:dist(e.touches),z,cx:(e.touches[0].clientX+e.touches[1].clientX)/2-r.left,cy:(e.touches[0].clientY+e.touches[1].clientY)/2-r.top};e.preventDefault();}
},{passive:false});
  area.addEventListener('touchmove',e=>{if(p0&&e.touches.length===2){aplica(p0.z*dist(e.touches)/p0.d,p0.cx,p0.cy);e.preventDefault();}},{passive:false});
  area.addEventListener('touchend',e=>{if(e.touches.length<2)p0=null;});
  area.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();const r=area.getBoundingClientRect();aplica(z*(e.deltaY<0?1.15:1/1.15),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  const fecha=()=>{f.remove();document.documentElement.classList.remove('zoomAberto');};
  /* toque no relatório: aproxima (ou volta ao normal) · toque fora (na parte escura): fecha */
  area.addEventListener('click',e=>{if(!e.target.closest('img')){fecha();return;}const r=area.getBoundingClientRect();aplica(z>1.2?1:2.5,e.clientX-r.left,e.clientY-r.top);});}
window.verImagens=verImagens;
document.addEventListener('click',e=>{const im=e.target.closest('#gRelVer img');if(!im)return;verImagens([...document.querySelectorAll('#gRelVer img')].map(x=>x.src));});
let relExpRodando=false;
async function relExpEnviar(fmt){if(relExpRodando)return;const dia=GT.dia||hojeKey(),sel=relExpSel(),[ini,fim]=relFaixa(),LST=relLista();
  if(!sel.length)return toast('Marque pelo menos um relatório');
  relExpRodando=true;const toast0=window.toast;
  try{toast(`Gerando ${sel.length} relatório(s)…`);const cap=[];window.__capArq=cap;const sem=[];
    window.toast=()=>{};
    for(const k of sel){const ok_=await relExpGerar(k,dia,fmt,ini,fim);if(!ok_)sem.push((LST.find(x=>x[0]===k)||[,k])[1]);}
    window.toast=toast0;window.__capArq=null;
    const vistos=new Set(),F=cap.filter(f=>{if(vistos.has(f.name))return false;vistos.add(f.name);return true;});
    if(!F.length)return toast(relModo()==='per'?'Nenhum relatório com dados nesse período':'Nenhum relatório com dados nessa data');
    if(sem.length)toast(`Sem ${fmt==='xls'?'Excel ou sem dados':fmt==='img'?'dados':'dados'}: ${sem.join(', ')}`);
    await salvarOuEnviar(F,F.map(f=>f.name),fmt==='pdf'?'application/pdf':fmt==='img'?'image/png':XT);
  }finally{window.toast=toast0;window.__capArq=null;relExpRodando=false;}}
window.relExpEnviar=relExpEnviar;
$('gBox').addEventListener('change',e=>{const t=e.target;if(!t.matches||!t.matches('input[data-relx]'))return;
  const ck=relSelK(),c=JSON.parse(JSON.stringify(gCfg())),v=new Set(relExpSel());t.checked?v.add(t.dataset.relx):v.delete(t.dataset.relx);c[ck]=relLista().map(x=>x[0]).filter(k=>v.has(k));
  if(typeof modoVer!=='undefined'&&modoVer){window.__relExpVer=Object.assign(window.__relExpVer||{},{[ck]:c[ck]});}else gPut(c);const n=document.getElementById('gRelN');if(n)n.textContent=c[ck].length+' marcado(s)';});
let relDiaRodando=false;
async function relDiaEnviar(){if(relDiaRodando)return;let dia=hojeKey();const sel=relDiaSel();
  if(!sel.length)return toast('Nenhum relatório marcado (Gestão › Config. › Relatórios)');
  relDiaRodando=true;const bt=$('btnRelDia');if(bt)bt.classList.add('girando');
  try{
    /* atualiza da nuvem em paralelo: espera no máximo 2 s antes de conferir o dia (antes esperava tudo e demorava) */
    let sync=Promise.resolve();if(navigator.onLine){try{sync=Promise.allSettled([typeof gSync==='function'?gSync(true):0,typeof puxarRegistros==='function'?puxarRegistros(true):0,typeof puxarPrevisto==='function'?puxarPrevisto(true):0]);}catch(e){}}
    const ate=ms=>Promise.race([sync,new Promise(r=>setTimeout(r,ms))]);
    await ate(2000);
    const F=diaFaltas(dia);
    if(F.length){const tx=F.slice(0,8).map(x=>`Trato ${x.t} · ${x.c}`).join(', ')+(F.length>8?` e mais ${F.length-8}`:'');
      const ontem=somaDias(dia,-1),porT={};F.forEach(x=>(porT[x.t]=porT[x.t]||[]).push(x.c));
      const col=`<div class="cvFaltas">${Object.keys(porT).sort((a,b)=>a-b).map(t=>`<div><b>Trato ${t}</b>${porT[t].map(c=>`<span>${esc(c)}</span>`).join('')}</div>`).join('')}</div><p class="cvPerg">Deseja o relatório do dia anterior (${dB(ontem)}) completo?</p>`;
      const v=await (typeof confirmaVermelho==='function'?confirmaVermelho('Relatório do dia não finalizado','Hoje ainda faltam tratos:','Sim, enviar o dia anterior','Não',false,col,'📤 Enviar o relatório incompleto de hoje'):Promise.resolve(confirm('Relatório do dia não finalizado. Deseja o relatório do dia anterior?')));
      if(!v)return;if(v!=='x')dia=ontem;}
    toast(`Gerando ${sel.length} relatório(s)…`);await ate(6000);
    const fmt=relDiaFmt(),cap=[];window.__capArq=cap;const nomes=[];
    for(const k of sel){const n0=cap.length;try{if(fmt==='pdf')await relDiaGerar(k,dia);else await relExpGerar(k,dia,fmt,dia,dia);}catch(e){console.error(e);}
      for(let w=0;w<40&&cap.length===n0;w++)await new Promise(r=>setTimeout(r,150));
      if(cap.length===n0)nomes.push((REL_DIA.find(x=>x[0]===k)||[,k])[1]);}
    window.__capArq=null;
    const re=fmt==='pdf'?/pdf/i:fmt==='img'?/image|png|jpe?g/i:/sheet|excel|xlsx/i,ext=fmt==='pdf'?/\.pdf$/i:fmt==='img'?/\.(png|jpe?g)$/i:/\.xlsx$/i;
    const vistos=new Set(),arqs=cap.filter(f=>(re.test(f.type)||ext.test(f.name))&&!vistos.has(f.name)&&vistos.add(f.name));
    const qd=dia===hojeKey()?'hoje':'em '+dB(dia);
    if(!arqs.length)return toast('Nenhum relatório com dados '+qd);
    if(nomes.length)toast(`${fmt==='xls'?'Sem Excel ou sem dados':'Sem dados'} ${qd}: ${nomes.join(', ')}`);
    await salvarOuEnviar(arqs,arqs.map(f=>f.name),fmt==='pdf'?'application/pdf':fmt==='img'?'image/png':XT);
  }finally{window.__capArq=null;relDiaRodando=false;if(bt)bt.classList.remove('girando');}}
window.relDiaEnviar=relDiaEnviar;

/* Estoque em quadros (igual à tela): vermelho < 7 dias · amarelo 7–15 · verde 15+ → PDF */
async function estCardsPdf(dia,fmt){const I=gTodos('insumo').filter(i=>!i.inativo).sort(porNome).map(i=>({i,e:estoqueIns(i)})).filter(o=>o.e.saldo!=null);
  if(!I.length)return toast('Nenhum produto com estoque');
  const W=1080,M=40,PAD=32,FN='Helvetica,Arial,sans-serif',CORES={r:['#fde3e1','#c62828','#b3261e'],a:['#fff3cd','#e0a800','#8a6100'],v:['#e3f4e1','#2e7d32','#2e7d32'],'':['#f4f6f8','#cfd8dc','#11253d']};
  const cv=document.createElement('canvas'),x=cv.getContext('2d');
  /* monta as linhas de cada quadro (com quebra) para saber a altura */
  const linhas=o=>{const e=o.e,cor=estCor(e),baixo=cor==='r',abMin=e.min&&e.saldo<e.min;const P=[];
    if(e.saldo<0)P.push({t:'⛔ Estoque negativo'});else if(baixo)P.push({t:'⚠ Estoque baixo'});else if(abMin)P.push({t:'Abaixo do mínimo'});
    if(ok(e.dias))P.push({t:P.length?'finaliza em':'Finaliza em'},{t:`~${nf(e.dias,1)} dia${Math.round(e.dias*10)===10?'':'s'}`,badge:1});
    P.push({t:e.cons>0?`consumo ${nf(e.cons)} kg/dia (média 7 dias)`:'sem consumo nos últimos 7 dias'});if(e.min)P.push({t:`mínimo ${nf(e.min)} kg`});
    /* palavras com separador · */
    const tok=[];P.forEach((p,k)=>{if(k&&!(P[k-1].t.match(/finaliza em$/i)))tok.push({t:'·',sep:1});if(p.badge)tok.push({t:p.t,badge:1});else p.t.split(' ').forEach(w=>tok.push({t:w}));});
    x.font=`500 30px ${FN}`;const max=W-2*M-2*PAD,L=[[]];let lw=0;
    tok.forEach(tk=>{x.font=tk.badge?`800 32px ${FN}`:`500 30px ${FN}`;const w=x.measureText(tk.t).width+(tk.badge?28:0),sp=L[L.length-1].length?8:0;
      if(lw+sp+w>max&&L[L.length-1].length){L.push([]);lw=0;}L[L.length-1].push(Object.assign({w},tk));lw+=(L[L.length-1].length>1?8:0)+w;});return L;};
  const blocos=I.map(o=>({o,L:linhas(o)})),hB=b=>PAD+46+14+b.L.length*52+PAD-10,TOP=150,dd=dia||hojeKey();
  /* consumo do estoque no dia: saldo anterior, entradas, consumido e saldo atual */
  const C=I.map(({i,e})=>{let ant=0,atu=null,ent=0,con=0;e.M.forEach(m=>{if(m.dia<dd)ant=m.saldo;if(m.dia<=dd)atu=m.saldo;if(m.dia===dd){if(m.mov==='ent')ent+=m.kg;else if(m.mov==='bat'||m.mov==='sai')con+=m.kg;}});return {n:i.nome,ant,ent,con,atu:atu==null?ant:atu};});
  const temEnt=C.some(c=>c.ent>0),cols=temEnt?[['Produto',300,'l'],['Saldo anterior',175,'r'],['Entradas',150,'r'],['Consumido',165,'r'],['Saldo atual',170,'r']]:[['Produto',350,'l'],['Saldo anterior',210,'r'],['Consumido no dia',225,'r'],['Saldo atual',175,'r']];
  const hT=60+56+C.length*52+60;
  cv.width=W;cv.height=TOP+blocos.reduce((a,b)=>a+hB(b)+24,0)+30+hT+60;
  x.fillStyle='#f6f7f2';x.fillRect(0,0,W,cv.height);
  x.fillStyle='#2e6b31';x.fillRect(0,0,W,110);x.fillStyle='#fff';x.font=`800 40px ${FN}`;x.textBaseline='middle';x.fillText('FJK · Estoque',M,55);
  x.font=`500 30px ${FN}`;x.textAlign='right';x.fillText(dB(dia||hojeKey()),W-M,55);x.textAlign='left';
  const rr=(X,Y,w,h,r)=>{x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath();};
  let y=TOP;blocos.forEach(b=>{const e=b.o.e,neg=e.saldo<0,c=neg?['#c62828','#8e0000','#ffffff']:CORES[estCor(e)],h=hB(b);   /* negativo: quadro todo vermelho, letras brancas */
    rr(M,y,W-2*M,h,22);x.fillStyle=c[0];x.fill();x.lineWidth=5;x.strokeStyle=c[1];x.stroke();
    let yy=y+PAD+23;x.font=`800 42px ${FN}`;x.fillStyle=neg?'#fff':estCor(e)==='r'?c[2]:'#11253d';x.textAlign='left';x.fillText(b.o.i.nome,M+PAD,yy);
    x.textAlign='right';x.fillStyle=c[2];const sT=nf(e.saldo)+' kg';x.fillText(sT,W-M-PAD,yy);const sW=x.measureText(sT).width;x.font=`500 22px ${FN}`;x.fillStyle=neg?'#fff':'#78909c';x.fillText('saldo',W-M-PAD-sW-12,yy+6);x.textAlign='left';yy+=23+14+26;
    b.L.forEach(lin=>{let xx=M+PAD;lin.forEach((tk,k)=>{if(k)xx+=8;
      if(tk.badge){x.font=`800 32px ${FN}`;const bw=tk.w,bh=46;rr(xx,yy-bh/2,bw,bh,23);x.fillStyle=neg?'#fff':estCor(e)==='a'?'#f2b600':c[1];x.fill();x.fillStyle=neg?'#c62828':estCor(e)==='a'?'#3a2a00':'#fff';x.fillText(tk.t,xx+14,yy+1);}
      else{x.font=`500 30px ${FN}`;x.fillStyle=neg?'#fff':'#3d4a3d';x.fillText(tk.t,xx,yy);}xx+=tk.w;});yy+=52;});
    y+=h+24;});
  x.font=`400 22px ${FN}`;x.fillStyle='#78909c';x.fillText('Vermelho: menos de 7 dias · Amarelo: 7 a 15 dias · Verde: 15 dias ou mais',M,y+4);y+=44;
  /* tabela: consumo do estoque no dia */
  x.fillStyle='#2e6b31';rr(M,y,W-2*M,56,14);x.fill();x.fillStyle='#fff';x.font=`800 30px ${FN}`;x.fillText(`Consumo do estoque · ${dB(dd)}`,M+20,y+29);y+=66;
  const cx=[];let acc=M+16;cols.forEach(c=>{cx.push(acc);acc+=c[1];});
  const cel=(t,k,yy,bold)=>{const [,w,al]=cols[k];x.font=`${bold?800:500} 28px ${FN}`;x.textAlign=al==='l'?'left':'right';x.fillText(t,al==='l'?cx[k]:cx[k]+w-8,yy);x.textAlign='left';};
  x.fillStyle='#e8eee0';x.fillRect(M,y,W-2*M,50);x.fillStyle='#2e6b31';cols.forEach((c,k)=>{const [,w,al]=c;x.font=`800 24px ${FN}`;x.textAlign=al==='l'?'left':'right';x.fillText(c[0],al==='l'?cx[k]:cx[k]+w-8,y+26);x.textAlign='left';});y+=50;
  C.forEach((c,k)=>{if(k%2){x.fillStyle='#f7f9f4';x.fillRect(M,y,W-2*M,52);}x.fillStyle='#11253d';
    const v=temEnt?[c.n,nf(c.ant),c.ent?'+'+nf(c.ent):'—',c.con?nf(c.con):'—',nf(c.atu)]:[c.n,nf(c.ant),c.con?nf(c.con):'—',nf(c.atu)];
    v.forEach((t,j)=>{x.fillStyle=j===v.length-2&&c.con?'#b3261e':j===2&&temEnt&&c.ent?'#2e7d32':'#11253d';cel(t,j,y+27,j===v.length-1);});y+=52;});
  const T=k=>C.reduce((a,c)=>a+c[k],0);x.fillStyle='#2e6b31';x.fillRect(M,y,W-2*M,54);x.fillStyle='#fff';
  (temEnt?['TOTAL',nf(T('ant')),'+'+nf(T('ent')),nf(T('con')),nf(T('atu'))]:['TOTAL',nf(T('ant')),nf(T('con')),nf(T('atu'))]).forEach((t,j)=>cel(t,j,y+28,1));
  x.font=`400 20px ${FN}`;x.fillStyle='#78909c';x.fillText('kg de matéria natural · consumido = carregamentos + saídas manuais do dia',M,y+86);
  const b=await new Promise(r=>cv.toBlob(r,'image/png'));
  if(fmt==='img')return compartilharArquivo(b,nomeArq(`Estoque ${dB(dia||hojeKey()).replace(/\//g,'-')}`)+'.png','image/png');
  return compartilharArquivo(await pngsParaPdf([b]),nomeArq(`Estoque ${dB(dia||hojeKey()).replace(/\//g,'-')}`)+'.pdf','application/pdf');}
window.estCardsPdf=estCardsPdf;
/* números digitados (pesos, médias, %): até 2 casas depois da vírgula, sem limite de dígitos */
document.addEventListener('input',e=>{const t=e.target;if(!t||t.tagName!=='INPUT'||t.inputMode!=='decimal')return;const v=t.value;let n=v.replace(/[^\d.,-]/g,'');n=(n[0]==='-'?'-':'')+n.replace(/-/g,'');
  const i=n.search(/[.,]/),r=i<0?n:n.slice(0,i+1)+n.slice(i+1).replace(/[.,]/g,'').slice(0,2);if(r!==v){const ps=Math.min(t.selectionStart||r.length,r.length);t.value=r;try{t.setSelectionRange(ps,ps);}catch(x){}}},true);
/* data que não existe (ex.: 31/09): o campo fica vazio sem avisar; aqui avisa na hora e não deixa salvar */
const dataRuim=e=>e&&e.type==='date'&&e.validity&&e.validity.badInput;
['change','focusout'].forEach(ev=>document.addEventListener(ev,e=>{const t=e.target;if(!t||t.type!=='date')return;const r=dataRuim(t);t.classList.toggle('gBadData',!!r);if(r&&ev==='change')toast('Essa data não existe (ex.: 31/09 — setembro tem 30 dias). Confira o dia e o mês.');},true));
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-g^="salva"]');if(!b)return;const r=[...document.querySelectorAll('#gBox input[type=date]')].find(dataRuim);if(r){e.preventDefault();e.stopPropagation();r.classList.add('gBadData');r.focus();toast('Essa data não existe (ex.: 31/09 — setembro tem 30 dias). Confira o dia e o mês.');}},true);

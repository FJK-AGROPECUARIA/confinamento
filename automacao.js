'use strict';
/* =====================================================================
   AUTOMAÇÃO — trato com balança automática
   Usa os mesmos currais, previstos, ordem, trato (1 a 5) e registros da
   aba Tratar. Cada registro é gravado igualzinho ao manual, então
   Histórico, relatórios, gráficos e nuvem continuam iguais.
   A aba Tratar (manual) não é alterada.
   Fontes de peso: Bluetooth (Web Bluetooth), Wi-Fi da caixinha (WebSocket)
   ou Simulador (para treinar sem balança).
   ===================================================================== */
(function(){
const A={fonte:null,status:'Desconectado',peso:null,amostras:[],estavel:false,valEst:null,
  est:'aguardando',base:null,menor:null,avisou1:false,avisou2:false,bruto:[],buf:'',
  bt:null,btChars:[],ws:null,sim:null,wake:null,ultDado:0};
window.AUTO=A;
const CFG_PADRAO={tol:10,tempo:4,minDesc:30,amarelo:100,vermelho:50,continuo:20,antecipa:1,ws:'ws://10.10.100.254:6432',som:true};
/* Ajustes da balança: ficam na nuvem (item 'cfgBalanca' da Gestão), então mudar num aparelho muda em todos */
function cfgNuvem(){try{return (typeof G!=='undefined'&&G.it&&G.it.cfgBalanca)||null;}catch(e){return null;}}
function cfg(){if(!S.auto)S.auto={};
  const n=cfgNuvem();if(n&&!n.del&&n.v&&(n.ts||0)>(S.auto._ts||0)){Object.assign(S.auto,n.v);S.auto._ts=n.ts;}
  for(const k in CFG_PADRAO)if(S.auto[k]==null)S.auto[k]=CFG_PADRAO[k];return S.auto;}
function salvarCfg(){const c=cfg(),v={};for(const k in CFG_PADRAO)v[k]=c[k];
  try{if(typeof gPut==='function'){gPut({uid:'cfgBalanca',tipo:'cfgBalanca',v});c._ts=G.it.cfgBalanca.ts;}}catch(e){}
  save();}

/* não atualiza o app sozinho enquanto a balança está conectada ou descarregando */
window.autoOcupado=()=>!!A.fonte||A.est==='descarregando';

/* ---------------- Tela ---------------- */
const css=`
:is(#aBox,#acBox) .aConn{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
:is(#aBox,#acBox) .aConn button{padding:10px 4px;font-size:.9rem}
:is(#aBox,#acBox) .aConn button.on{background:var(--lima);border-color:var(--lima);color:var(--fg);font-weight:700}
:is(#aBox,#acBox) .aStatus{display:flex;align-items:center;gap:8px;font-size:.9rem;color:var(--muted)}
:is(#aBox,#acBox) .aStatus i{width:12px;height:12px;border-radius:50%;background:#b8c0c8;display:inline-block;flex:none}
:is(#aBox,#acBox) .aStatus.ok i{background:#4caf50}:is(#aBox,#acBox) .aStatus.err i{background:var(--bad)}:is(#aBox,#acBox) .aStatus.wait i{background:var(--warn)}
:is(#aBox,#acBox) .aPeso{background:var(--led-bg);border-radius:12px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px}
:is(#aBox,#acBox) .aFalta{border-radius:16px;padding:10px 14px 12px;text-align:center;color:#fff;background:#2e7d32;transition:background .2s}
:is(#aBox,#acBox) .aFalta small{display:block;font-size:.85rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;opacity:.9}
:is(#aBox,#acBox) .aFalta b{display:block;font-family:var(--display);font-stretch:condensed;font-weight:700;font-size:6.2rem;line-height:1;font-variant-numeric:tabular-nums}
:is(#aBox,#acBox) .aFalta em{display:block;font-style:normal;font-size:.9rem;font-weight:600;opacity:.95}
:is(#aBox,#acBox) .aFalta.amarelo{background:#f2b705;color:#11253d}
:is(#aBox,#acBox) .aFalta.vermelho{background:#c62828}
:is(#aBox,#acBox) .aFalta.continuo{background:#c62828;animation:aPisca .5s steps(2) infinite}
:is(#aBox,#acBox) .aFalta.cinza{background:#7c8794}
@keyframes aPisca{50%{background:#7f0000}}
:is(#aBox,#acBox) .aMini{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
:is(#aBox,#acBox) .aMini div{background:var(--chip);border-radius:10px;padding:6px 8px}
:is(#aBox,#acBox) .aMini small{display:block;font-size:.66rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
:is(#aBox,#acBox) .aMini b{font-family:var(--display);font-stretch:condensed;font-size:1.5rem;line-height:1.1}
:is(#aBox,#acBox) .aMini div.caiu{background:#e5f4e3}:is(#aBox,#acBox) .aMini div.caiu b{font-size:1.9rem;color:var(--ok)}
:is(#aBox,#acBox) .aPeso small{display:block;color:#c9d3df;font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;text-align:left}
:is(#aBox,#acBox) .aPeso b{font-family:var(--display);font-stretch:condensed;font-weight:700;color:var(--led);font-size:2.2rem;line-height:1;font-variant-numeric:tabular-nums}
:is(#aBox,#acBox) .aPeso em{font-style:normal;font-size:.85rem;color:#c9d3df}
:is(#aBox,#acBox) .aPeso em.est{color:#8be08f}
:is(#aBox,#acBox) .aBarra{height:18px;border-radius:99px;background:var(--chip);overflow:hidden;border:1px solid var(--line)}
:is(#aBox,#acBox) .aBarra div{height:100%;width:0;background:var(--lima);transition:width .3s}
:is(#aBox,#acBox) .aBarra div.passou{background:var(--bad)}
:is(#aBox,#acBox) .aEtapa{text-align:center;font-weight:700;padding:6px;border-radius:10px;background:var(--chip);font-size:.92rem}
:is(#aBox,#acBox) .aEtapa.desc{background:#fff4d6;color:var(--warn)}
:is(#aBox,#acBox) .aEtapa.pronto{background:#e5f4e3;color:var(--ok)}
:is(#aBox,#acBox) .aBruto{font-family:ui-monospace,Menlo,monospace;font-size:.75rem;background:#0f1d2e;color:#cfe;padding:8px;border-radius:8px;max-height:150px;overflow:auto;white-space:pre-wrap;word-break:break-all}
:is(#aBox,#acBox) .aCfg{display:grid;grid-template-columns:1fr 1fr;gap:8px}
:is(#aBox,#acBox) .aCfg label{font-size:.8rem;margin:0}
:is(#aBox,#acBox) .aCfg input{width:100%}
:is(#aBox,#acBox) .aSim{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
:is(#aBox,#acBox) .aSim button{padding:9px 4px;font-size:.88rem}
:is(#aBox,#acBox) details summary{cursor:pointer;font-weight:600;padding:4px 0}
:is(#aBox,#acBox) .aChk{display:flex;align-items:center;gap:8px;font-size:.95rem}
:is(#aBox,#acBox) .aChk input{width:22px;height:22px}
`;
function montar(){
  if($('aBox').dataset.ok)return;$('aBox').dataset.ok='1';
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
  $('aBox').innerHTML=`
  <section class="panel">
    <div class="curhead"><h2>Balança automática</h2><span class="note" id="aData"></span></div>
    <div class="aStatus" id="aStatus"><i></i><span id="aStatusTxt">Desconectado</span></div>
    <div class="aConn">
      <button id="aBtBt">🔵 Bluetooth</button>
      <button id="aBtWs">📶 Caixinha Wi-Fi</button>
      <button id="aBtSim">🧪 Simulador</button>
    </div>
    <button id="aDesc" hidden>Desconectar</button>
    <div class="aSim" id="aSimBox" hidden>
      <button class="lima" id="aSimCarga">+ Carregar 1.000</button>
      <button id="aSimDesc">▼ Fornecer</button>
      <button id="aSimPara">■ Parar</button>
    </div>
    <div class="aPeso"><div><small>Balança (kg)</small><em id="aEstTxt">sem leitura</em></div><b class="num" id="aPeso">—</b></div>
  </section>

  <section class="panel">
    <div class="linhaTrato">
      <label for="aTrato">Trato</label>
      <select class="trato" id="aTrato">
        <option value="1">Trato 1</option><option value="2">Trato 2</option><option value="3">Trato 3</option><option value="4">Trato 4</option><option value="5">Trato 5</option>
      </select>
    </div>
    <div class="curBox2">
      <div class="cbCur" id="aTrocar" role="button" aria-label="Trocar curral"><span>Curral atual <i class="seta">▼</i></span><b id="aCur">—</b></div>
      <div class="cbPrev"><span>Previsto</span><b class="num" id="aPrev">—</b></div>
    </div>
    <div class="escolha" id="aEscolha" hidden></div>
    <div class="aEtapa" id="aEtapa">Conecte a balança</div>
    <div class="aFalta" id="aFaltaBox"><small id="aFaltaTit">Fornecer</small><b class="num" id="aFalta">—</b><em id="aFaltaTxt">&nbsp;</em></div>
    <div class="aMini">
      <div class="caiu"><small>Fornecido</small><b class="num" id="aCaiu">—</b></div>
      <div><small>Peso inicial</small><b class="num" id="aIni">—</b></div>
      <div><small>Parar com</small><b class="num" id="aAlvo">—</b></div>
    </div>
    <button class="primary" id="aReg" disabled>Registrar trato</button>
    <button id="aTestarSom">🔊 Testar apito (amarelo, vermelho e direto)</button>
    <div class="row"><button id="aRecomecar">↺ Pegar peso inicial</button><button id="aPular">Pular curral ▶</button></div>
  </section>

  <section class="panel">
    <div class="curhead"><h2 id="aTit">Currais</h2><span class="note num" id="aTot"></span></div>
    <div class="tablebox"><table class="trat">
      <thead><tr><th class="hora">Hora</th><th>Curral</th><th>Previsto</th><th>Realiz.</th><th>Dif.</th></tr></thead>
      <tbody id="aTb"></tbody>
    </table></div>
    <button id="aDesfazer">Desfazer último</button>
    <p class="note">Os tratos registrados aqui aparecem também na aba Tratar, no Histórico, nos relatórios e na nuvem.</p>
  </section>

  <section class="panel">
    <p class="note">Ajustes da balança e dos apitos: Tratos › ⚙ Config.</p>
    <details>
      <summary>🔧 Dados recebidos (para teste)</summary>
      <p class="note" id="aBtInfo"></p>
      <div class="aBruto" id="aBruto">Nada recebido ainda.</div>
      <button id="aCopiarBruto" style="margin-top:8px">Copiar dados para enviar ao suporte</button>
    </details>
  </section>`;
  ligar();
}

function ligar(){
  const c=cfg();
  $('aBtBt').onclick=conectarBt;
  $('aBtWs').onclick=conectarWs;
  $('aBtSim').onclick=conectarSim;
  $('aDesc').onclick=()=>desconectar(true);
  $('aSimCarga').onclick=()=>{if(A.sim){A.sim.modo='parado';A.sim.peso+=1000;}};
  $('aSimDesc').onclick=()=>{if(A.sim)A.sim.modo='desc';};
  $('aSimPara').onclick=()=>{if(A.sim)A.sim.modo='parado';};
  $('aTrato').onchange=e=>{if(A.est==='descarregando'&&!confirm('Está fornecendo num curral. Trocar de trato mesmo assim?')){e.target.value=String(S.tratoSel);return;}
    $('tratoSel').value=e.target.value;$('tratoSel').dispatchEvent(new Event('change'));novoCurral(true);aRender();};
  $('aTrocar').onclick=()=>{const e=$('aEscolha');e.hidden=!e.hidden;if(!e.hidden)mostrarAEscolha();};
  $('aEscolha').addEventListener('click',ev=>{const b=ev.target.closest('button[data-i]');if(!b)return;
    if(A.est==='descarregando'&&!confirm('Está fornecendo. Trocar de curral mesmo assim?'))return;
    setAtual(+b.dataset.i);save();$('aEscolha').hidden=true;novoCurral(true);render();aRender();});
  $('aReg').onclick=()=>registrarAuto();
  $('aRecomecar').onclick=()=>{if(A.peso==null){toast('Sem leitura da balança');return;}novoCurral(true);aRender();toast('Peso inicial: '+fmt(A.base)+' kg');};
  $('aPular').onclick=()=>{const L=lista(),regs=regsAtuais();let nx=L.findIndex((x,i)=>i>S.atual&&!feito(x.nome,regs));if(nx<0)nx=Math.min(S.atual+1,L.length);
    setAtual(nx);save();novoCurral(true);render();aRender();};
  $('aDesfazer').onclick=()=>{$('btnDesfazer').click();setTimeout(aRender,300);};
  $('aTestarSom').onclick=testarSom;
  $('aCopiarBruto').onclick=()=>copiar(A.bruto.join('\n')+'\n\n'+($('aBtInfo').textContent||''),'Dados copiados');
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&A.fonte)pedirTelaLigada();});
}

/* ---------------- Conexões ---------------- */
function setStatus(t,tipo){A.status=t;A.statusTipo=tipo||'';const el=$('aStatus');if(el){$('aStatusTxt').textContent=t;el.className='aStatus '+(tipo||'');}acSyncTopo();}
function marcarFonte(){['aBtBt','aBtWs','aBtSim'].forEach(id=>$(id).classList.remove('on'));
  const m={bt:'aBtBt',ws:'aBtWs',sim:'aBtSim'}[A.fonte];if(m)$(m).classList.add('on');
  $('aDesc').hidden=!A.fonte;$('aSimBox').hidden=A.fonte!=='sim';acSyncTopo();}
function desconectar(manual){
  try{if(A.bt&&A.bt.gatt&&A.bt.gatt.connected){A.bt._manual=true;A.bt.gatt.disconnect();}}catch(e){}
  try{if(A.ws){A.ws._manual=true;A.ws.close();}}catch(e){}
  if(A.sim){clearInterval(A.sim.t);A.sim=null;}
  A.bt=null;A.ws=null;A.btChars=[];A.fonte=null;A.peso=null;A.amostras=[];A.estavel=false;A.valEst=null;
  soltarTela();if(manual)setStatus('Desconectado');marcarFonte();aRender();
}

/* Serviços de "serial por Bluetooth" mais comuns (o navegador só deixa ler os que estiverem nesta lista) */
const SERVICOS=['6e400001-b5a3-f393-e0a9-e50e24dcca9e','0000ffe0-0000-1000-8000-00805f9b34fb','0000fff0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455','0000ffb0-0000-1000-8000-00805f9b34fb','0000fee0-0000-1000-8000-00805f9b34fb',
  '0000181d-0000-1000-8000-00805f9b34fb','0000180a-0000-1000-8000-00805f9b34fb','0000180f-0000-1000-8000-00805f9b34fb',
  '0000ffd0-0000-1000-8000-00805f9b34fb','0000ff00-0000-1000-8000-00805f9b34fb','0000fe59-0000-1000-8000-00805f9b34fb'];
async function conectarBt(){
  if(!navigator.bluetooth){toast('Este celular/navegador não tem Bluetooth para apps. Use o Chrome no Android.');setStatus('Bluetooth indisponível neste navegador','err');return;}
  desconectar(false);
  try{
    setStatus('Escolha a balança na lista…','wait');
    const dev=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:SERVICOS});
    A.bt=dev;A.fonte='bt';marcarFonte();
    dev.addEventListener('gattserverdisconnected',()=>{if(dev._manual||A.bt!==dev)return;setStatus('Bluetooth caiu, reconectando…','wait');setTimeout(()=>{if(A.bt===dev)btAbrir(dev).catch(()=>setStatus('Bluetooth desconectado. Toque em Bluetooth de novo.','err'));},1500);});
    await btAbrir(dev);
  }catch(e){
    if(e&&e.name==='NotFoundError'){setStatus('Nenhum aparelho escolhido');A.fonte=null;marcarFonte();return;}
    setStatus('Bluetooth: '+(e.message||e),'err');A.fonte=null;marcarFonte();
  }
}
async function btAbrir(dev){
  setStatus('Conectando em '+(dev.name||'aparelho')+'…','wait');
  const srv=await dev.gatt.connect();
  let servs=[];try{servs=await srv.getPrimaryServices();}catch(e){}
  const info=['Aparelho: '+(dev.name||'(sem nome)')];let n=0;A.btChars=[];
  for(const s of servs){let cs=[];try{cs=await s.getCharacteristics();}catch(e){}
    info.push('Serviço '+s.uuid);
    for(const c of cs){const p=c.properties,tem=[p.notify&&'notify',p.indicate&&'indicate',p.read&&'read',p.write&&'write',p.writeWithoutResponse&&'writeNR'].filter(Boolean).join(',');
      info.push('  · '+c.uuid+' ['+tem+']');
      if(p.notify||p.indicate){try{await c.startNotifications();c.addEventListener('characteristicvaluechanged',ev=>receber(ev.target.value,'bt'));A.btChars.push(c);n++;}catch(e){}}
      else if(p.read){try{const v=await c.readValue();bruto('lido '+c.uuid.slice(4,8)+': '+txtDe(v));}catch(e){}}
    }}
  $('aBtInfo').textContent=info.join('\n');
  if(!servs.length){setStatus('Conectou, mas a balança não mostrou nenhum serviço conhecido. Veja "Dados recebidos".','err');return;}
  setStatus(n?`Bluetooth conectado (${dev.name||'aparelho'}) · aguardando peso…`:'Conectou, mas nenhum canal envia dados. Veja "Dados recebidos".',n?'ok':'err');
  pedirTelaLigada();
}

function conectarWs(){
  desconectar(false);
  const url=cfg().ws;
  if(location.protocol==='https:'&&url.startsWith('ws://'))bruto('Aviso: app em https conectando em ws:// — alguns navegadores bloqueiam.');
  setStatus('Conectando na caixinha '+url+'…','wait');A.fonte='ws';marcarFonte();
  let ws;
  try{ws=new WebSocket(url);}catch(e){setStatus('Navegador bloqueou a conexão com a caixinha ('+(e.message||e)+'). Vamos precisar do app Android.','err');A.fonte=null;marcarFonte();return;}
  ws.binaryType='arraybuffer';A.ws=ws;
  const t=setTimeout(()=>{if(ws.readyState!==1){try{ws.close();}catch(e){}}},8000);
  ws.onopen=()=>{clearTimeout(t);setStatus('Caixinha conectada · aguardando peso…','ok');pedirTelaLigada();};
  ws.onmessage=ev=>receber(ev.data,'ws');
  ws.onerror=()=>{};
  ws.onclose=()=>{clearTimeout(t);if(ws._manual||A.ws!==ws)return;
    setStatus('Sem conexão com a caixinha. Confira se o celular está no Wi-Fi dela e o endereço nos Ajustes. Tentando de novo…','err');
    setTimeout(()=>{if(A.ws===ws&&A.fonte==='ws')conectarWs();},5000);};
}

function conectarSim(){
  desconectar(false);A.fonte='sim';marcarFonte();
  A.sim={peso:6000,modo:'parado',t:null};
  A.sim.t=setInterval(()=>{const s=A.sim;if(!s)return;
    if(s.modo==='desc'){s.peso=Math.max(0,s.peso-(5+Math.random()*3));if(s.peso<=0)s.modo='parado';}
    if(s.modo==='sobe'){s.peso=Math.min(20000,s.peso+(5+Math.random()*3));}
    const ruido=s.modo!=='parado'?(Math.random()-.5)*6:(Math.random()-.5)*4;
    receber(`GR ${Math.round(s.peso+ruido)} kg\r\n`,'sim');},300);
  setStatus('Simulador ligado (peso de mentira, para treinar)','ok');
}

/* ---------------- Leitura do peso ---------------- */
function txtDe(v){try{if(typeof v==='string')return v;const u=v instanceof DataView?new Uint8Array(v.buffer,v.byteOffset,v.byteLength):new Uint8Array(v);
  return Array.from(u).map(b=>b>=32&&b<127?String.fromCharCode(b):b===13?'\r':b===10?'\n':b===2||b===3?'\n':'·').join('');}catch(e){return '';}}
function hexDe(v){try{if(typeof v==='string')return '';const u=v instanceof DataView?new Uint8Array(v.buffer,v.byteOffset,v.byteLength):new Uint8Array(v);
  return Array.from(u).map(b=>b.toString(16).padStart(2,'0')).join(' ');}catch(e){return '';}}
function bruto(l){A.bruto.push(new Date().toLocaleTimeString('pt-BR')+'  '+l);if(A.bruto.length>60)A.bruto.splice(0,A.bruto.length-60);
  const el=$('aBruto');if(el&&el.closest('details').open){el.textContent=A.bruto.join('\n');el.scrollTop=el.scrollHeight;}}
let ultBruto=0;
function receber(v,origem){
  A.ultDado=Date.now();
  const t=txtDe(v);
  if(origem!=='sim'&&Date.now()-ultBruto>400){ultBruto=Date.now();bruto(JSON.stringify(t)+(typeof v!=='string'?'   ['+hexDe(v)+']':''));}
  A.buf+=t;
  const partes=A.buf.split(/[\r\n]+/);A.buf=partes.pop();
  if(A.buf.length>80){partes.push(A.buf);A.buf='';}
  // quando a balança manda o número sem "enter" no fim (Bluetooth), usa o pedaço inteiro
  if(!partes.length&&origem==='bt'&&/\d/.test(t)){partes.push(t);A.buf='';}
  partes.forEach(p=>{const n=numeroDaLinha(p);if(n!=null)novoPeso(n);});
}
/* pega o último número da linha: "GR  12.345 kg", "+012345", "ST,GS,+0012345kg" */
function numeroDaLinha(l){
  const s=String(l).replace(/\s+/g,' ');
  const m=s.match(/[+-]?\s?\d[\d.,]*/g);if(!m)return null;
  let x=m[m.length-1].replace(/\s/g,'');const neg=x.startsWith('-');x=x.replace(/^[+-]/,'');
  if(/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(x))x=x.replace(/\./g,'').replace(',','.');      // 12.345 ou 12.345,5
  else if(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(x))x=x.replace(/,/g,'');                  // 12,345
  else x=x.replace(',','.');
  const n=parseFloat(x);if(isNaN(n)||n>100000)return null;
  return neg?-n:n;
}
function novoPeso(n){
  const c=cfg(),agora=Date.now();
  A.peso=n;A.amostras.push({t:agora,v:n});
  const ini=agora-c.tempo*1000;A.amostras=A.amostras.filter(a=>a.t>=ini-1500);
  const jan=A.amostras.filter(a=>a.t>=ini);
  const cobre=A.amostras.length&&A.amostras[0].t<=ini+300;
  if(cobre&&jan.length>=3){const vs=jan.map(a=>a.v),mx=Math.max(...vs),mn=Math.min(...vs);
    A.estavel=(mx-mn)<=c.tol;A.valEst=A.estavel?Math.round(vs.reduce((a,b)=>a+b,0)/vs.length):null;}
  else{A.estavel=false;A.valEst=null;}
  if(A.status.includes('aguardando peso'))setStatus(A.status.replace(' · aguardando peso…',' · recebendo peso'),'ok');
  maquina();maquinaCarga();
  aRenderLeve();
}

/* ---------------- Lógica do trato automático ----------------
   aguardando: balança parada → guarda o peso inicial
   começou a cair (mais que o mínimo) → descarregando
   parou de cair → registra (inicial − final) e passa para o próximo curral */
function curralAtual(){return lista()[S.atual]||null;}
/* troca de curral: o peso de agora vira o inicial */
function novoCurral(manterPeso){A.est='aguardando';A.ancV=null;A.ancT=0;A.fpMin=null;A.menor=null;A.base=manterPeso&&A.peso!=null?(A.estavel?A.valEst:A.peso):null;}
function maquina(){
  if(naCargaAuto()){A.est='aguardando';A.base=null;return;} // carregando o vagão: o trato espera
  const c=cfg(),cur=curralAtual();if(A.peso==null)return;
  if(A.est==='aguardando'){
    if(A.estavel&&(A.base==null||Math.abs(A.valEst-A.base)>c.tol))A.base=A.valEst;  // parado: atualiza inicial (recarga, ajuste)
    if(A.base!=null&&cur&&A.peso<A.base-c.minDesc){A.est='descarregando';A.menor=A.peso;A.avisou1=false;A.avisou2=false;A.ancV=A.peso;A.ancT=Date.now();A.fpMin=null;}
    return;
  }
  if(A.est==='descarregando'){
    A.menor=Math.min(A.menor,A.peso);
    const passo=Math.max(3,(+c.tol||0)/2);
    if(A.ancV==null||A.peso<A.ancV-passo){A.ancV=A.peso;A.ancT=Date.now();}
    if(A.estavel&&A.valEst>A.base+c.minDesc){ // subiu: recarregou o vagão sem registrar
      toast('Peso subiu: recarga? Peso inicial atualizado.');A.est='aguardando';A.base=A.valEst;}
  }
}

let registrando=false;
async function registrarAuto(){
  if(registrando)return;
  if(bloqueado())return;
  const L=lista(),cur=L[S.atual];
  if(!cur){toast(L.length?'Trato completo':'Sem previsto neste trato');return;}
  if(A.base==null){toast('Sem peso inicial ainda');return;}
  const fim=A.estavel?A.valEst:A.peso;if(fim==null){toast('Sem leitura da balança');return;}
  const ini=A.base;
  if(!(fim<ini)){toast('O peso não caiu desde o início');return;}
  const ja=regsAtuais().filter(x=>x.curral===cur.nome);
  if(ja.length&&!confirm(`${cur.nome} já tem trato no Trato ${S.tratoSel}. Lançar mais um (soma no realizado)?`))return;
  registrando=true;
  const now=new Date();
  const r={ts:now.getTime(),dia:diaAtivo(),trato:S.tratoSel,hora:now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),
    curral:cur.nome,prev:cur.prev,ini,fim,forn:ini-fim,uid:`${S.aparelho}-${now.getTime()}`,enviado:false,origem:'balanca'};
  try{r.id=await dbAdd(r);}catch(e){registrando=false;toast('Erro ao salvar no banco. Tente de novo.');return;}
  HIST.push(r);
  pararSom();
  toast(`${cur.nome}: ${fmt(r.forn)} kg salvo`);
  const regs=regsAtuais();
  let nx=L.findIndex((x,i)=>i>S.atual&&!feito(x.nome,regs));if(nx<0)nx=L.findIndex(x=>!feito(x.nome,regs));
  setAtual(nx<0?L.length:nx);
  novoCurral();A.base=fim; // o final deste curral é o início do próximo
  save();render();aRender();registrando=false;
  sincronizar();
}

/* ---------------- Apito e tela ligada (sem vibração) ----------------
   Funciona como sensor de ré: quanto menos falta, mais rápido apita, sem degraus.
   amarelo → apito espaçado que vai apertando · vermelho → rápido · direto → bem rápido (bip-bip-bip, não é tom contínuo).
   Antecipação: o app mede quantos kg/s estão caindo e adianta a cor e o apito em "antecipa" segundos,
   para compensar o atraso da balança e do som. O número grande continua sendo o que falta de verdade.
   Parou de cair (kg/s quase zero) → o apito para na hora, sem esperar o peso firmar. */
/* Som feito como arquivo WAV tocado por <audio>: é o jeito que o iPhone aceita melhor.
   O iPhone só libera o som depois de um toque na tela; no 1º toque cada som é "destravado". */
try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch(e){}
let ultBip=0,somLiberado=false;
function wav(freq,ms,vol){const sr=22050,n=Math.round(sr*ms/1000),buf=new ArrayBuffer(44+n*2),d=new DataView(buf);
  const w=(o,t)=>{for(let i=0;i<t.length;i++)d.setUint8(o+i,t.charCodeAt(i));};
  w(0,'RIFF');d.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);
  d.setUint32(24,sr,true);d.setUint32(28,sr*2,true);d.setUint16(32,2,true);d.setUint16(34,16,true);w(36,'data');d.setUint32(40,n*2,true);
  const ramp=Math.min(120,n/4);
  for(let i=0;i<n;i++){const env=Math.min(1,i/ramp,(n-i)/ramp);d.setInt16(44+i*2,Math.sin(2*Math.PI*freq*i/sr)*32767*vol*env,true);}
  return URL.createObjectURL(new Blob([buf],{type:'audio/wav'}));}
/* 3 cópias de cada som: com apito rápido, um começa antes do anterior terminar */
const SONS={};
function criarSons(){if(SONS.lento)return;
  const mk=u=>[0,1,2].map(()=>{const a=new Audio(u);a.preload='auto';a.setAttribute('playsinline','');return a;});
  SONS.lento=mk(wav(950,150,.9));SONS.rapido=mk(wav(1300,90,.9));SONS.direto=mk(wav(1650,55,.9));
  SONS.lento.i=SONS.rapido.i=SONS.direto.i=0;}
const todosSons=()=>[].concat(SONS.lento||[],SONS.rapido||[],SONS.direto||[]);
function liberarSom(){try{
  try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch(e){}
  criarSons();if(somLiberado)return;somLiberado=true;
  todosSons().forEach(a=>{a.muted=true;const p=a.play();const fim=()=>{a.pause();a.currentTime=0;a.muted=false;};
    if(p&&p.then)p.then(fim).catch(()=>{a.muted=false;somLiberado=false;});else fim();});
}catch(e){}}
['touchend','click','keydown'].forEach(ev=>document.addEventListener(ev,liberarSom,{passive:true,capture:true}));
function tocar(tipo){try{criarSons();const pool=SONS[tipo];const a=pool[pool.i=(pool.i+1)%pool.length];
  a.currentTime=0;const p=a.play();if(p&&p.catch)p.catch(()=>{});}catch(e){}}
function pararSom(){todosSons().forEach(a=>{try{if(!a.paused){a.pause();a.currentTime=0;}}catch(e){}});}
/* velocidade de queda (kg/s) pela reta das leituras do último 1,5 s */
function taxaQueda(sinal){sinal=sinal||1;const agora=Date.now();if(!A.amostras.length||agora-A.ultDado>1500)return 0;
  const p=A.amostras.filter(a=>a.t>=agora-1500);if(p.length<2)return 0;
  const t0=p[0].t,n=p.length;let sx=0,sy=0,sxx=0,sxy=0;
  p.forEach(a=>{const x=(a.t-t0)/1000;sx+=x;sy+=a.v;sxx+=x*x;sxy+=x*a.v;});
  const den=n*sxx-sx*sx;if(den<=0)return 0;
  return Math.max(0,-sinal*(n*sxy-sx*sy)/den);}
/* "está caindo": o peso fez um novo mínimo (pelo menos metade da variação aceita) há menos de 0,9 s.
   Parou o vagão → em menos de 1 s o apito para. */
function caindoAgora(){return A.est==='descarregando'&&A.ancT>0&&Date.now()-A.ancT<900&&Date.now()-A.ultDado<1500;}
function zona(){const cur=curralAtual();if(!cur||A.base==null||A.peso==null)return null;
  const c=cfg(),falta=cur.prev-Math.max(0,A.base-A.peso),caindo=caindoAgora();
  const taxa=caindo?taxaQueda():0;
  let fp=falta;
  if(caindo){fp=falta-taxa*(+c.antecipa||0); // onde vai estar daqui a "antecipa" segundos
    if(A.fpMin!=null&&A.fpMin<fp)fp=A.fpMin;A.fpMin=fp;} // não volta de cor no meio da descarga
  else A.fpMin=null;
  return {falta,fp,taxa,caindo,z:fp<=c.continuo?'continuo':fp<=c.vermelho?'vermelho':fp<=c.amarelo?'amarelo':'verde'};}
/* intervalo entre apitos (ms), apertando aos poucos dentro de cada faixa */
function intervalo(fp,c){const am=+c.amarelo,ve=+c.vermelho,co=+c.continuo;
  const lerp=(x,x0,x1,y0,y1)=>x1===x0?y1:y0+(y1-y0)*Math.min(1,Math.max(0,(x0-x)/(x0-x1)));
  if(fp<=co)return {ms:85,som:'direto'};
  if(fp<=ve)return {ms:lerp(fp,ve,co,330,160),som:'rapido'};
  if(fp<=am)return {ms:lerp(fp,am,ve,700,380),som:'lento'};
  return null;}
function testarSom(){liberarSom();
  if(!cfg().som){toast('O apito está desligado em Tratos › Config.');return;}
  const c=cfg(),seq=[];let t=300;
  // simula uma descarga de 25 kg/s indo do amarelo até passar o direto
  for(let fp=+c.amarelo;fp>-15;){const iv=intervalo(fp,c);if(!iv)break;seq.push([t,iv.som]);t+=iv.ms;fp-=25*iv.ms/1000;}
  seq.forEach(([tt,som])=>setTimeout(()=>tocar(som),tt));
  toast('Teste: lento → rápido → direto, como numa descarga. Sem som? Tire do silencioso e aumente o volume.');}
setInterval(()=>{
  const c=cfg(),naCarga=$('viewAutoC')&&!$('viewAutoC').hidden;
  const z=naCarga?zonaC():zona();
  const tocando=!!(c.som&&A.fonte&&z&&!modoVer&&(naCarga?z.caindo:(A.est==='descarregando'&&z.caindo)));
  if(!tocando)return;
  const iv=intervalo(z.fp,c);if(!iv)return;
  if(Date.now()-ultBip>=iv.ms){ultBip=Date.now();tocar(iv.som);}
},25);
async function pedirTelaLigada(){try{if('wakeLock' in navigator&&!A.wake){A.wake=await navigator.wakeLock.request('screen');A.wake.addEventListener('release',()=>{A.wake=null;});}}catch(e){}}
function soltarTela(){try{A.wake&&A.wake.release();}catch(e){}A.wake=null;}

/* aviso se a balança parou de mandar dados */
setInterval(()=>{if(A.fonte&&A.fonte!=='sim'&&A.ultDado&&Date.now()-A.ultDado>5000&&!A.status.startsWith('Sem dados')&&!A.status.includes('reconect')){setStatus('Sem dados da balança há mais de 5 s','err');A.estavel=false;aRenderLeve();}
  else if(A.fonte&&A.ultDado&&Date.now()-A.ultDado<2000&&A.status.startsWith('Sem dados')){setStatus('Recebendo peso','ok');}},2000);

/* ---------------- Desenho da tela ---------------- */
let leveT=null;
function aRenderLeve(){if(leveT)return;leveT=setTimeout(()=>{leveT=null;pintarPeso();pintarCarga();},120);}
function pintarPeso(){
  if(!$('aPeso')||$('viewAuto').hidden)return;
  const c=cfg(),cur=curralAtual();
  $('aPeso').textContent=A.peso==null?'—':fmt(A.peso);
  const e=$('aEstTxt');e.textContent=A.peso==null?'sem leitura':A.estavel?'● parado (estável)':'○ mexendo…';e.className=A.estavel?'est':'';
  $('aIni').textContent=A.base==null?'—':fmt(A.base);
  const alvo=(cur&&A.base!=null)?A.base-cur.prev:null;
  $('aAlvo').textContent=alvo==null?'—':fmt(alvo);
  const caiu=(A.base!=null&&A.peso!=null)?Math.max(0,A.base-A.peso):null;
  $('aCaiu').textContent=caiu==null?'—':fmt(caiu);
  const z=zona(),fb=$('aFaltaBox');
  $('aFaltaTit').textContent=(z&&z.falta<0)?'Passou':'Fornecer';
  if(z){$('aFalta').textContent=fmt(z.falta);fb.className='aFalta '+z.z;
    $('aFaltaTxt').textContent=z.falta<0?`passou ${fmt(-z.falta)} kg do previsto`:z.falta===0?'no ponto!':`de ${fmt(cur.prev)} kg previstos`;
    if(z.falta<0)$('aFalta').textContent='-'+fmt(-z.falta);}
  else{$('aFalta').textContent=cur?fmt(cur.prev):'—';fb.className='aFalta cinza';$('aFaltaTxt').textContent=A.fonte?'esperando peso inicial':'conecte a balança';}
  const et=$('aEtapa');let txt,cl='';
  if(!A.fonte)txt='Conecte a balança (ou use o Simulador)';
  else if(A.peso==null)txt='Esperando o peso chegar da balança…';
  else if(!cur)txt=lista().length?'✓ Trato completo':'Sem previsto neste trato (lance na aba Previsto)';
  else if(A.est==='descarregando'){const zz=zona()||{};txt=A.estavel?'Parou de cair · confira e toque em Registrar':zz.caindo?`▼ Fornecendo no ${cur.nome} · ${fmt(zz.taxa)} kg/s`:'■ Parou de cair · esperando o peso firmar';cl='desc';}
  else if(A.base==null)txt='Deixe o vagão parado para pegar o peso inicial';
  else{txt='Pronto: pode fornecer no '+cur.nome;cl='pronto';}
  et.textContent=txt;et.className='aEtapa '+cl;
  $('aReg').disabled=!(cur&&A.base!=null&&A.peso!=null&&A.peso<A.base)||modoVer;
}
function aRender(){
  if(!$('aBox')||!$('aBox').dataset.ok)return;
  cfg();
  const L=lista(),regs=regsAtuais(),cur=L[S.atual];
  $('aData').textContent=(S.dataManual?'⚠ ':'')+diaBR(diaAtivo());
  $('aTrato').value=String(S.tratoSel);
  $('aCur').textContent=cur?cur.nome:(L.length?'Completo':'—');
  $('aPrev').textContent=cur?fmt(cur.prev):'—';
  if(!$('aEscolha').hidden)mostrarAEscolha();
  let tp=0,tf=0;
  const linha=(nome,prev,i)=>{const rs=regs.filter(r=>r.curral===nome),fz=rs.length>0,f=rs.reduce((a,r)=>a+r.forn,0);
    if(prev!=null)tp+=prev;tf+=f;const d=f-(prev||0);
    const real=fz?`<b>${fmt(f)}</b>`:(i===S.atual?'<span class="pill">agora</span>':'—');
    return `<tr class="${i===S.atual?'cur':''}"><td class="hora">${fz?horaDe(rs[0]):''}</td><td class="c">${esc(nome)}</td><td>${prev!=null?fmt(prev):'—'}</td><td>${real}</td><td class="${fz&&prev?classeDesv(d,prev):''}">${fz&&prev!=null?sgn(d):''}</td></tr>`;};
  const extras=[...new Set(regs.map(r=>r.curral))].filter(n=>!L.some(x=>x.nome===n));
  $('aTb').innerHTML=(L.length||extras.length)?L.map((x,i)=>linha(x.nome,x.prev,i)).join('')+extras.map(n=>linha(n,(regs.find(r=>r.curral===n)||{}).prev,null)).join(''):
    `<tr><td colspan="5" class="note" style="text-align:left">Nenhum previsto no Trato ${S.tratoSel}. Lance na aba Previsto.</td></tr>`;
  caberTabela($('aTb'));
  $('aTit').textContent=`Currais — Trato ${S.tratoSel}`;
  $('aTot').textContent=`${fmt(tf)} de ${fmt(tp)} kg`;
  $('aDesfazer').disabled=!regs.length||modoVer;
  marcarFonte();pintarPeso();
}
window.aRender=aRender;
/* quadros com todos os currais que têm previsto (igual à aba Tratar) */
function mostrarAEscolha(){const L=lista(),regs=regsAtuais();
  $('aEscolha').innerHTML=L.length?L.map((x,i)=>`<button data-i="${i}" class="${i===S.atual?'atual':''} ${feito(x.nome,regs)?'feito':''}">${feito(x.nome,regs)?'✓ ':''}${esc(x.nome)}<small>${fmt(x.prev)} kg</small></button>`).join(''):'<p class="note">Sem previsto neste trato.</p>';}

/* abrir a aba */
window.aAoAbrir=()=>{montar();aRender();try{if(typeof gSync==='function')gSync(true).catch(()=>{});}catch(e){}};
/* quando a aba Tratar ou a nuvem mudam algo, a tela da Automação acompanha */
const renderOriginal=window.render;
if(typeof renderOriginal==='function'){window.render=function(){const r=renderOriginal.apply(this,arguments);try{if(!$('viewAuto').hidden)aRender();}catch(e){}return r;};}
$('tabAuto').addEventListener('click',()=>aba('auto'));

/* =====================================================================
   CARREGAR AUTOMÁTICO (batida do vagão pela balança) — o contrário do Tratar:
   a balança SOBE a cada produto. Usa a mesma batida do Carregar manual (mesmo registro, relatórios, Excel e imagem).
   Peso inicial é pego sozinho com o vagão parado; quando começa a subir, mostra quanto falta carregar,
   com as mesmas cores e apitos do Tratar; o registro é sempre pelo botão.
   ===================================================================== */
const AC={est:'aguardando',ancV:null,ancT:0,fpMin:null,idx:null};
const acB=()=>(typeof CG!=='undefined'&&CG.ativa)||null;
function acItem(){const B=acB();return B?B.itens[B.atual]:null;}
function acNovoProduto(){AC.est='aguardando';AC.ancV=null;AC.ancT=0;AC.fpMin=null;}
const naCargaAuto=()=>!!($('viewAutoC')&&!$('viewAutoC').hidden);
function maquinaCarga(){
  if(!naCargaAuto())return;const B=acB(),it=acItem(),c=cfg();if(!B||!it||A.peso==null||ok(it.real))return;
  if(AC.idx!==B.atual){AC.idx=B.atual;acNovoProduto();}
  if(AC.est==='aguardando'){
    if(A.estavel&&(!ok(it.ini)||Math.abs(A.valEst-it.ini)>c.tol)){it.ini=A.valEst;it.fim=null;cSave();}  // parado: pega o peso inicial
    if(ok(it.ini)&&A.peso>it.ini+c.minDesc){AC.est='carregando';AC.ancV=A.peso;AC.ancT=Date.now();AC.fpMin=null;}
  }else{
    const passo=Math.max(3,(+c.tol||0)/2);
    if(A.peso>AC.ancV+passo){AC.ancV=A.peso;AC.ancT=Date.now();}
    if(A.estavel&&A.valEst<it.ini-c.minDesc){AC.est='aguardando';it.ini=A.valEst;cSave();toast('Peso caiu abaixo do início: peso inicial atualizado.');}
  }
}
function subindoAgora(){return AC.est==='carregando'&&AC.ancT>0&&Date.now()-AC.ancT<900&&Date.now()-A.ultDado<1500;}
function zonaC(){const it=acItem();if(!naCargaAuto()||!it||!ok(it.ini)||A.peso==null||ok(it.real))return null;
  const c=cfg(),carregado=Math.max(0,A.peso-it.ini),falta=it.prev-carregado,sub=subindoAgora(),taxa=sub?taxaQueda(-1):0;
  let fp=falta;
  if(sub){fp=falta-taxa*(+c.antecipa||0);if(AC.fpMin!=null&&AC.fpMin<fp)fp=AC.fpMin;AC.fpMin=fp;}else AC.fpMin=null;
  return {falta,fp,taxa,carregado,caindo:sub,z:fp<=c.continuo?'continuo':fp<=c.vermelho?'vermelho':fp<=c.amarelo?'amarelo':'verde'};}
window.acTela=(nova,dia)=>{
  const topo=`<section class="panel">
    <div class="curhead"><h2>Carregar com a balança</h2><span class="note">⚡ Automação</span></div>
    <div class="aStatus" id="acStatus"><i></i><span id="acStatusTxt">Desconectado</span></div>
    <div class="aConn"><button data-ac="bt" id="acBtBt">🔵 Bluetooth</button><button data-ac="ws" id="acBtWs">📶 Caixinha Wi-Fi</button><button data-ac="sim" id="acBtSim">🧪 Simulador</button></div>
    <button data-ac="desc" id="acDesc" hidden>Desconectar</button>
    <div class="aSim" id="acSimBox" hidden><button class="lima" data-ac="simSobe">▲ Carregar</button><button data-ac="simPara">■ Parar</button><button data-ac="simZera">Esvaziar</button></div>
    <div class="aPeso"><div><small>Balança (kg)</small><em id="acEstTxt">sem leitura</em></div><b class="num" id="acPeso">—</b></div>
  </section>`;
  if(nova)return topo+nova+dia;
  const B=acB(),i=B.atual,it=B.itens[i];
  const h=cTelaBatida(),k=h.indexOf('<section',8),tabela=k>0?h.slice(k):'';
  return topo+`<section class="panel"><div class="curhead"><h2>Batida · Trato ${B.trato}</h2><span class="note">${esc(B.racNome)} · ${nf(B.total)} kg</span></div>
    <div class="curBox2"><div class="cbCur" data-c="escolher" role="button"><span>Produto ${i+1} de ${B.itens.length} <i class="seta">▼</i></span><b>${esc(it?it.nome:'—')}</b></div>
      <div class="cbPrev"><span>Carregar</span><b class="num">${it?nf(it.prev):'—'}</b></div></div>
    ${B.escolha?`<div class="escolha">${B.itens.map((x,j)=>`<button data-c="ir" data-i="${j}" class="${j===i?'sel':''}">${ok(x.real)?'✓ ':''}${esc(x.nome)} · ${nf(x.prev)} kg</button>`).join('')}</div>`:''}
    ${it&&ok(it.real)?`<p class="avisoJa">Este produto já foi carregado (${nf(it.real)} kg). Para refazer, toque em ↺ Pegar peso inicial.</p>`:''}
    <div class="aEtapa" id="acEtapa"></div>
    <div class="aFalta" id="acFaltaBox"><small id="acFaltaTit">Carregar</small><b class="num" id="acFalta">—</b><em id="acFaltaTxt">&nbsp;</em></div>
    <div class="aMini">
      <div class="caiu"><small>Carregado</small><b class="num" id="acCarr">—</b></div>
      <div><small>Peso inicial</small><b class="num" id="acIni">—</b></div>
      <div><small>Parar com</small><b class="num" id="acAlvo">—</b></div>
    </div>
    <button class="primary" data-c="registrar" id="acReg" disabled>Registrar produto</button>
    <div class="row"><button data-ac="pegar">↺ Pegar peso inicial</button><button class="lima" data-c="prox"${i<B.itens.length-1?'':' disabled'}>Próximo produto ▶</button></div>
    <button data-c="ant"${i>0?'':' disabled'}>◀ Produto anterior</button>
  </section>`+tabela+dia;};
window.acDepois=()=>{acSyncTopo();const B=acB();if(B&&AC.idx!==B.atual){AC.idx=B.atual;acNovoProduto();}pintarCarga();};
window.acIniciou=()=>{acNovoProduto();const B=acB();AC.idx=B?B.atual:null;const it=acItem();if(it&&A.estavel){it.ini=A.valEst;cSave();}pintarCarga();
  if(!A.fonte)toast('Conecte a balança para carregar pela Automação');};
window.acRegistrar=()=>{const B=acB(),it=acItem();if(!B||!it)return;
  if(!ok(it.ini)){toast('Sem peso inicial ainda');return;}
  const fim=A.estavel?A.valEst:A.peso;if(fim==null){toast('Sem leitura da balança');return;}
  if(!(fim>it.ini)){toast('O peso não subiu desde o início');return;}
  it.fim=fim;it.real=fim-it.ini;it.hora=new Date().toTimeString().slice(0,5);
  const k=B.itens.findIndex((x,j)=>j>B.atual&&!ok(x.real)),nx=k>=0?k:B.itens.findIndex(x=>!ok(x.real));
  if(nx>=0){B.atual=nx;const n=B.itens[nx];if(!ok(n.real)){n.ini=fim;n.fim=null;}}
  AC.idx=B.atual;acNovoProduto();pararSom();cSave();toast(`${it.nome}: ${nf(it.real)} kg`);cRender();
  if(nx<0)toast('Todos os produtos carregados. Toque em ✓ Concluir batida.');};
function acSyncTopo(){if(!$('acStatus'))return;
  $('acStatusTxt').textContent=A.status;$('acStatus').className='aStatus '+(A.statusTipo||'');
  ['bt','ws','sim'].forEach(f=>$({bt:'acBtBt',ws:'acBtWs',sim:'acBtSim'}[f]).classList.toggle('on',A.fonte===f));
  $('acDesc').hidden=!A.fonte;$('acSimBox').hidden=A.fonte!=='sim';}
function pintarCarga(){
  if(!naCargaAuto()||!$('acPeso'))return;
  $('acPeso').textContent=A.peso==null?'—':fmt(A.peso);
  const e=$('acEstTxt');e.textContent=A.peso==null?'sem leitura':A.estavel?'● parado (estável)':'○ mexendo…';e.className=A.estavel?'est':'';
  if(!$('acFaltaBox'))return;
  const it=acItem(),z=zonaC(),fb=$('acFaltaBox');
  $('acIni').textContent=it&&ok(it.ini)?fmt(it.ini):'—';
  $('acAlvo').textContent=it&&ok(it.ini)?fmt(it.ini+it.prev):'—';
  $('acCarr').textContent=it&&ok(it.real)?fmt(it.real):z?fmt(z.carregado):'—';
  $('acFaltaTit').textContent=(z&&z.falta<0)?'Passou':'Carregar';
  if(z){$('acFalta').textContent=z.falta<0?'-'+fmt(-z.falta):fmt(z.falta);fb.className='aFalta '+z.z;
    $('acFaltaTxt').textContent=z.falta<0?`passou ${fmt(-z.falta)} kg do previsto`:z.falta===0?'no ponto!':`de ${fmt(it.prev)} kg de ${it.nome}`;}
  else{$('acFalta').textContent=it?fmt(ok(it.real)?it.real:it.prev):'—';fb.className='aFalta cinza';
    $('acFaltaTxt').textContent=it&&ok(it.real)?'já carregado':A.fonte?'esperando peso inicial':'conecte a balança';}
  let txt,cl='';
  if(!A.fonte)txt='Conecte a balança (ou use o Simulador)';
  else if(A.peso==null)txt='Esperando o peso chegar da balança…';
  else if(!it)txt='—';
  else if(ok(it.real))txt='✓ Já carregado · vá para o próximo produto';
  else if(!ok(it.ini))txt='Deixe o vagão parado para pegar o peso inicial';
  else if(AC.est==='carregando'){txt=A.estavel?'Parou de subir · confira e toque em Registrar':z&&z.caindo?`▲ Carregando ${it.nome} · ${fmt(z.taxa)} kg/s`:'■ Parou de subir · esperando o peso firmar';cl='desc';}
  else{txt='Pronto: pode carregar '+it.nome;cl='pronto';}
  $('acEtapa').textContent=txt;$('acEtapa').className='aEtapa '+cl;
  $('acReg').disabled=!(it&&ok(it.ini)&&A.peso!=null&&A.peso>it.ini)||modoVer;
}
$('acBox').addEventListener('click',e=>{const b=e.target.closest('[data-ac]');if(!b)return;const a=b.dataset.ac;
  if(a==='bt')return conectarBt();if(a==='ws')return conectarWs();if(a==='sim'){conectarSim();return cRender();}
  if(a==='desc'){desconectar(true);return cRender();}
  if(a==='simSobe'){if(A.sim)A.sim.modo='sobe';return;}if(a==='simPara'){if(A.sim)A.sim.modo='parado';return;}
  if(a==='simZera'){if(A.sim){A.sim.modo='parado';A.sim.peso=0;}return;}
  if(a==='pegar'){if(bloqueado())return;const it=acItem();if(!it)return;if(A.peso==null){toast('Sem leitura da balança');return;}
    it.ini=A.estavel?A.valEst:A.peso;it.fim=null;it.real=null;acNovoProduto();cSave();cRender();toast('Peso inicial: '+fmt(it.ini)+' kg');}});
window.acAoAbrir=()=>{montar();cRender();window.scrollTo({top:0});try{if(typeof gSync==='function')gSync(true).catch(()=>{});}catch(e){}};
$('tabAutoC').addEventListener('click',()=>aba('autoc'));

/* ---------------- Tratos › Config. (ajustes da balança, iguais em todos os aparelhos) ---------------- */
const CAMPOS=[['amarelo','🟡 Apito lento','kg faltando · fica amarelo'],['vermelho','🔴 Apito rápido','kg faltando · fica vermelho'],['continuo','🚨 Apito direto (bem rápido)','kg faltando · pisca'],
  ['antecipa','⏩ Antecipar cor e apito','segundos · compensa o atraso da balança'],
  ['tol','Variação aceita parado','kg'],['tempo','Tempo parado para firmar','segundos'],['minDesc','Mínimo que conta como descarga','kg']];
function montarCfgT(){const box=$('cfgTBox');if(!box||box.dataset.ok)return;box.dataset.ok='1';
  const st=document.createElement('style');st.textContent=`
#cfgTBox .aCfg{display:grid;gap:6px}
#cfgTBox .aCfg>div{display:grid;grid-template-columns:minmax(0,1fr) 92px;gap:10px;align-items:center;border-bottom:1px solid var(--line);padding-bottom:6px}
#cfgTBox .aCfg label{font-size:.88rem;margin:0;text-transform:none;letter-spacing:0;font-weight:600;color:var(--fg)}
#cfgTBox .aCfg label small{display:block;font-weight:400;color:var(--muted);font-size:.78rem}
#cfgTBox .aCfg input{width:100%;text-align:center;font-weight:700;font-size:1.1rem}
#cfgTBox .aChk{display:flex;align-items:center;gap:8px;font-size:.95rem;text-transform:none;letter-spacing:0;font-weight:600;color:var(--fg)}
#cfgTBox .aChk input{width:22px;height:22px}`;document.head.appendChild(st);
  box.innerHTML=`
  <section class="panel">
    <div class="curhead"><h2>⚙ Ajustes da balança</h2><span class="note" id="cfgTSinc"></span></div>
    <p class="note">Valem para todos os celulares: mudou aqui, muda nos outros (pela nuvem).</p>
    <div class="aCfg">${CAMPOS.map(([k,t,u])=>`<div><label for="cfgT_${k}">${t}<small>${u}</small></label><input id="cfgT_${k}" data-k="${k}" type="number" inputmode="decimal" step="any" min="0"></div>`).join('')}</div>
    <label for="cfgT_ws" style="margin-top:8px">Endereço da caixinha Wi-Fi</label>
    <input id="cfgT_ws" type="text" autocapitalize="off" autocorrect="off" spellcheck="false">
  </section>
  <section class="panel">
    <div class="curhead"><h2>🔊 Apito</h2></div>
    <label class="aChk"><input type="checkbox" id="cfgT_som"> Apito ligado (sem vibração)</label>
    <p class="note">Funciona como sensor de ré: começa espaçado no amarelo e vai apertando até o direto, que é um bip bem rápido. Quando o peso para de cair, o apito para na hora.</p>
    <button id="cfgT_teste">🔊 Testar apito (lento → rápido → direto)</button>
    <button id="cfgT_padrao" style="margin-top:6px">Voltar ao padrão</button>
  </section>`;
  CAMPOS.forEach(([k])=>{$('cfgT_'+k).onchange=e=>{const c=cfg(),v=parseFloat(String(e.target.value).replace(',','.'));
    if(!isNaN(v)&&v>=0){c[k]=v;salvarCfg();avisoCfg();}else e.target.value=c[k];};});
  $('cfgT_ws').onchange=e=>{const c=cfg();c.ws=e.target.value.trim()||CFG_PADRAO.ws;e.target.value=c.ws;salvarCfg();avisoCfg();};
  $('cfgT_som').onchange=e=>{const c=cfg();c.som=e.target.checked;salvarCfg();avisoCfg();if(c.som){liberarSom();tocar('lento');}};
  $('cfgT_teste').onclick=testarSom;
  $('cfgT_padrao').onclick=()=>{if(!confirm('Voltar todos os ajustes da balança ao padrão (em todos os aparelhos)?'))return;
    const c=cfg();for(const k in CFG_PADRAO)c[k]=CFG_PADRAO[k];salvarCfg();preencherCfgT();avisoCfg();};
}
function avisoCfg(){const el=$('cfgTSinc');if(!el)return;const p=typeof G!=='undefined'&&G.pend&&G.pend.includes('cfgBalanca');
  el.textContent=p?'⏳ enviando…':'✓ salvo na nuvem';if(p)setTimeout(avisoCfg,1500);}
function preencherCfgT(){if(!$('cfgT_tol'))return;const c=cfg();
  CAMPOS.forEach(([k])=>{const el=$('cfgT_'+k);if(document.activeElement!==el)el.value=c[k];});
  if(document.activeElement!==$('cfgT_ws'))$('cfgT_ws').value=c.ws;$('cfgT_som').checked=!!c.som;}
window.cfgTAoAbrir=()=>{montarCfgT();preencherCfgT();avisoCfg();
  try{if(typeof gSync==='function')gSync(true).then(()=>{if(!cfgNuvem())salvarCfg();preencherCfgT();avisoCfg();}).catch(()=>{});}catch(e){}};
/* puxa da nuvem ao abrir a Automação também, para pegar ajustes feitos em outro aparelho */
setInterval(()=>{if($('viewCfgT')&&!$('viewCfgT').hidden)preencherCfgT();},3000);
$('tabCfgT').addEventListener('click',()=>aba('cfgt'));
})();

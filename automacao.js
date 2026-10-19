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
const CFG_PADRAO={tol:10,tempo:4,minDesc:30,amarelo:100,vermelho:50,continuo:20,ws:'ws://10.10.100.254:6432',som:true};
function cfg(){if(!S.auto)S.auto={};for(const k in CFG_PADRAO)if(S.auto[k]==null)S.auto[k]=CFG_PADRAO[k];return S.auto;}

/* não atualiza o app sozinho enquanto a balança está conectada ou descarregando */
window.autoOcupado=()=>!!A.fonte||A.est==='descarregando';

/* ---------------- Tela ---------------- */
const css=`
#aBox .aConn{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
#aBox .aConn button{padding:10px 4px;font-size:.9rem}
#aBox .aConn button.on{background:var(--lima);border-color:var(--lima);color:var(--fg);font-weight:700}
#aBox .aStatus{display:flex;align-items:center;gap:8px;font-size:.9rem;color:var(--muted)}
#aBox .aStatus i{width:12px;height:12px;border-radius:50%;background:#b8c0c8;display:inline-block;flex:none}
#aBox .aStatus.ok i{background:#4caf50}#aBox .aStatus.err i{background:var(--bad)}#aBox .aStatus.wait i{background:var(--warn)}
#aBox .aPeso{background:var(--led-bg);border-radius:12px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px}
#aBox .aFalta{border-radius:16px;padding:10px 14px 12px;text-align:center;color:#fff;background:#2e7d32;transition:background .2s}
#aBox .aFalta small{display:block;font-size:.85rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;opacity:.9}
#aBox .aFalta b{display:block;font-family:var(--display);font-stretch:condensed;font-weight:700;font-size:6.2rem;line-height:1;font-variant-numeric:tabular-nums}
#aBox .aFalta em{display:block;font-style:normal;font-size:.9rem;font-weight:600;opacity:.95}
#aBox .aFalta.amarelo{background:#f2b705;color:#11253d}
#aBox .aFalta.vermelho{background:#c62828}
#aBox .aFalta.continuo{background:#c62828;animation:aPisca .5s steps(2) infinite}
#aBox .aFalta.cinza{background:#7c8794}
@keyframes aPisca{50%{background:#7f0000}}
#aBox .aMini{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
#aBox .aMini div{background:var(--chip);border-radius:10px;padding:6px 8px}
#aBox .aMini small{display:block;font-size:.66rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
#aBox .aMini b{font-family:var(--display);font-stretch:condensed;font-size:1.5rem;line-height:1.1}
#aBox .aMini div.caiu{background:#e5f4e3}#aBox .aMini div.caiu b{font-size:1.9rem;color:var(--ok)}
#aBox .aPeso small{display:block;color:#c9d3df;font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;text-align:left}
#aBox .aPeso b{font-family:var(--display);font-stretch:condensed;font-weight:700;color:var(--led);font-size:2.2rem;line-height:1;font-variant-numeric:tabular-nums}
#aBox .aPeso em{font-style:normal;font-size:.85rem;color:#c9d3df}
#aBox .aPeso em.est{color:#8be08f}
#aBox .aBarra{height:18px;border-radius:99px;background:var(--chip);overflow:hidden;border:1px solid var(--line)}
#aBox .aBarra div{height:100%;width:0;background:var(--lima);transition:width .3s}
#aBox .aBarra div.passou{background:var(--bad)}
#aBox .aEtapa{text-align:center;font-weight:700;padding:6px;border-radius:10px;background:var(--chip);font-size:.92rem}
#aBox .aEtapa.desc{background:#fff4d6;color:var(--warn)}
#aBox .aEtapa.pronto{background:#e5f4e3;color:var(--ok)}
#aBox .aBruto{font-family:ui-monospace,Menlo,monospace;font-size:.75rem;background:#0f1d2e;color:#cfe;padding:8px;border-radius:8px;max-height:150px;overflow:auto;white-space:pre-wrap;word-break:break-all}
#aBox .aCfg{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#aBox .aCfg label{font-size:.8rem;margin:0}
#aBox .aCfg input{width:100%}
#aBox .aSim{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
#aBox .aSim button{padding:9px 4px;font-size:.88rem}
#aBox details summary{cursor:pointer;font-weight:600;padding:4px 0}
#aBox .aChk{display:flex;align-items:center;gap:8px;font-size:.95rem}
#aBox .aChk input{width:22px;height:22px}
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
      <button id="aSimDesc">▼ Descarregar</button>
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
    <div class="aFalta" id="aFaltaBox"><small id="aFaltaTit">Falta tratar</small><b class="num" id="aFalta">—</b><em id="aFaltaTxt">&nbsp;</em></div>
    <div class="aMini">
      <div class="caiu"><small>Já caiu</small><b class="num" id="aCaiu">—</b></div>
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
    <details>
      <summary>⚙ Ajustes da balança</summary>
      <div class="aCfg" style="margin-top:8px">
        <div><label for="aTol">Variação aceita parada (kg)</label><input id="aTol" type="number" inputmode="numeric"></div>
        <div><label for="aTempo">Tempo parado (seg)</label><input id="aTempo" type="number" inputmode="numeric"></div>
        <div><label for="aMin">Mínimo que conta como descarga (kg)</label><input id="aMin" type="number" inputmode="numeric"></div>
        <div><label for="aAmarelo">Amarelo e apito lento faltando (kg)</label><input id="aAmarelo" type="number" inputmode="numeric"></div>
        <div><label for="aVermelho">Vermelho e apito rápido faltando (kg)</label><input id="aVermelho" type="number" inputmode="numeric"></div>
        <div><label for="aContinuo">Apito direto faltando (kg)</label><input id="aContinuo" type="number" inputmode="numeric"></div>
      </div>
      <label for="aWs" style="margin-top:8px">Endereço da caixinha Wi-Fi</label>
      <input id="aWs" type="text" autocapitalize="off" autocorrect="off" spellcheck="false">
      <label class="aChk" style="margin-top:8px"><input type="checkbox" id="aSom"> Apito e vibração</label>
    </details>
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
  $('aTrato').onchange=e=>{if(A.est==='descarregando'&&!confirm('Está descarregando um curral. Trocar de trato mesmo assim?')){e.target.value=String(S.tratoSel);return;}
    $('tratoSel').value=e.target.value;$('tratoSel').dispatchEvent(new Event('change'));novoCurral(true);aRender();};
  $('aTrocar').onclick=()=>{const e=$('aEscolha');e.hidden=!e.hidden;if(!e.hidden)mostrarAEscolha();};
  $('aEscolha').addEventListener('click',ev=>{const b=ev.target.closest('button[data-i]');if(!b)return;
    if(A.est==='descarregando'&&!confirm('Está descarregando. Trocar de curral mesmo assim?'))return;
    setAtual(+b.dataset.i);save();$('aEscolha').hidden=true;novoCurral(true);render();aRender();});
  $('aSom').checked=!!c.som;$('aSom').onchange=e=>{c.som=e.target.checked;save();if(c.som)apito(1);};
  [['aTol','tol'],['aTempo','tempo'],['aMin','minDesc'],['aAmarelo','amarelo'],['aVermelho','vermelho'],['aContinuo','continuo']].forEach(([id,k])=>{
    $(id).value=c[k];$(id).onchange=e=>{const v=parseFloat(e.target.value);if(!isNaN(v)&&v>=0){c[k]=v;save();}else e.target.value=c[k];};});
  $('aWs').value=c.ws;$('aWs').onchange=e=>{c.ws=e.target.value.trim()||CFG_PADRAO.ws;e.target.value=c.ws;save();};
  $('aReg').onclick=()=>registrarAuto();
  $('aRecomecar').onclick=()=>{if(A.peso==null){toast('Sem leitura da balança');return;}novoCurral(true);aRender();toast('Peso inicial: '+fmt(A.base)+' kg');};
  $('aPular').onclick=()=>{const L=lista(),regs=regsAtuais();let nx=L.findIndex((x,i)=>i>S.atual&&!feito(x.nome,regs));if(nx<0)nx=Math.min(S.atual+1,L.length);
    setAtual(nx);save();novoCurral(true);render();aRender();};
  $('aDesfazer').onclick=()=>{$('btnDesfazer').click();setTimeout(aRender,300);};
  $('aTestarSom').onclick=()=>{liberarSom();
    if(!cfg().som){toast('O apito está desligado nos Ajustes da balança');return;}
    [400,1400,2400].forEach(t=>setTimeout(()=>bip(.18,950),t));
    [3000,3350,3700,4050,4400].forEach(t=>setTimeout(()=>bip(.12,1300),t));
    setTimeout(()=>{somContinuo(true);setTimeout(()=>somContinuo(false),1500);},5000);
    toast('Apito lento, rápido e direto. Sem som? Tire do silencioso e aumente o volume.');};
  $('aCopiarBruto').onclick=()=>copiar(A.bruto.join('\n')+'\n\n'+($('aBtInfo').textContent||''),'Dados copiados');
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&A.fonte)pedirTelaLigada();});
}

/* ---------------- Conexões ---------------- */
function setStatus(t,tipo){A.status=t;const el=$('aStatus');if(!el)return;$('aStatusTxt').textContent=t;el.className='aStatus '+(tipo||'');}
function marcarFonte(){['aBtBt','aBtWs','aBtSim'].forEach(id=>$(id).classList.remove('on'));
  const m={bt:'aBtBt',ws:'aBtWs',sim:'aBtSim'}[A.fonte];if(m)$(m).classList.add('on');
  $('aDesc').hidden=!A.fonte;$('aSimBox').hidden=A.fonte!=='sim';}
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
    const ruido=s.modo==='desc'?(Math.random()-.5)*6:(Math.random()-.5)*4;
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
  maquina();
  aRenderLeve();
}

/* ---------------- Lógica do trato automático ----------------
   aguardando: balança parada → guarda o peso inicial
   começou a cair (mais que o mínimo) → descarregando
   parou de cair → registra (inicial − final) e passa para o próximo curral */
function curralAtual(){return lista()[S.atual]||null;}
/* troca de curral: o peso de agora vira o inicial */
function novoCurral(manterPeso){A.est='aguardando';A.menor=null;A.base=manterPeso&&A.peso!=null?(A.estavel?A.valEst:A.peso):null;}
function maquina(){
  const c=cfg(),cur=curralAtual();if(A.peso==null)return;
  if(A.est==='aguardando'){
    if(A.estavel&&(A.base==null||Math.abs(A.valEst-A.base)>c.tol))A.base=A.valEst;  // parado: atualiza inicial (recarga, ajuste)
    if(A.base!=null&&cur&&A.peso<A.base-c.minDesc){A.est='descarregando';A.menor=A.peso;A.avisou1=false;A.avisou2=false;}
    return;
  }
  if(A.est==='descarregando'){
    A.menor=Math.min(A.menor,A.peso);
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

/* ---------------- Apito, vibração e tela ligada ----------------
   verde: sem apito · amarelo (≤100): apito espaçado · vermelho (≤50): apito rápido · ≤20: apito direto
   só apita enquanto o peso está caindo; parou o vagão, o apito para */
/* Som feito como arquivo WAV tocado por <audio>: é o jeito que o iPhone aceita melhor.
   O iPhone só libera o som depois de um toque na tela; no 1º toque cada som é "destravado". */
try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch(e){}
let ultBip=0,somLiberado=false;
function wav(freq,ms,vol){const sr=22050,n=Math.round(sr*ms/1000),buf=new ArrayBuffer(44+n*2),d=new DataView(buf);
  const w=(o,t)=>{for(let i=0;i<t.length;i++)d.setUint8(o+i,t.charCodeAt(i));};
  w(0,'RIFF');d.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);
  d.setUint32(24,sr,true);d.setUint32(28,sr*2,true);d.setUint16(32,2,true);d.setUint16(34,16,true);w(36,'data');d.setUint32(40,n*2,true);
  const ramp=Math.min(200,n/4);
  for(let i=0;i<n;i++){const env=Math.min(1,i/ramp,(n-i)/ramp);d.setInt16(44+i*2,Math.sin(2*Math.PI*freq*i/sr)*32767*vol*env,true);}
  return URL.createObjectURL(new Blob([buf],{type:'audio/wav'}));}
const SONS={};
function criarSons(){if(SONS.lento)return;
  const mk=(u,loop)=>{const a=new Audio(u);a.preload='auto';a.loop=!!loop;a.setAttribute('playsinline','');return a;};
  SONS.lento=mk(wav(950,180,.9));SONS.rapido=mk(wav(1300,120,.9));
  SONS.cont=mk(wav(1500,1000,.8),true);}  // 1 s em repetição = apito direto
function liberarSom(){try{
  try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch(e){}
  criarSons();if(somLiberado)return;somLiberado=true;
  Object.values(SONS).forEach(a=>{a.muted=true;const p=a.play();const fim=()=>{a.pause();a.currentTime=0;a.muted=false;};
    if(p&&p.then)p.then(fim).catch(()=>{a.muted=false;somLiberado=false;});else fim();});
}catch(e){}}
['touchend','click','keydown'].forEach(ev=>document.addEventListener(ev,liberarSom,{passive:true,capture:true}));
function tocar(a){try{criarSons();a.currentTime=0;const p=a.play();if(p&&p.catch)p.catch(()=>{});}catch(e){}}
function bip(dur,freq){criarSons();tocar(freq>=1200?SONS.rapido:SONS.lento);}
function somContinuo(liga){try{criarSons();const a=SONS.cont;
  if(liga&&a.paused){const p=a.play();if(p&&p.catch)p.catch(()=>{});}
  if(!liga&&!a.paused){a.pause();a.currentTime=0;}}catch(e){}}
function pararSom(){somContinuo(false);try{navigator.vibrate&&navigator.vibrate(0);}catch(e){}}
function zona(){const cur=curralAtual();if(!cur||A.base==null||A.peso==null)return null;
  const c=cfg(),falta=cur.prev-Math.max(0,A.base-A.peso);
  return {falta,z:falta<=c.continuo?'continuo':falta<=c.vermelho?'vermelho':falta<=c.amarelo?'amarelo':'verde'};}
function apito(vezes){for(let i=0;i<vezes;i++)setTimeout(()=>bip(.15,1000),i*250);}
setInterval(()=>{
  const z=zona(),c=cfg();
  const tocando=!!(c.som&&A.fonte&&z&&A.est==='descarregando'&&!A.estavel&&z.z!=='verde'&&!modoVer);
  if(!tocando){pararSom();return;}
  if(z.z==='continuo'){somContinuo(true);if(Date.now()-ultBip>900){ultBip=Date.now();try{navigator.vibrate&&navigator.vibrate(1000);}catch(e){}}return;}
  somContinuo(false);
  const intervalo=z.z==='vermelho'?350:1000;
  if(Date.now()-ultBip>=intervalo){ultBip=Date.now();bip(z.z==='vermelho'?.12:.18,z.z==='vermelho'?1300:950);try{navigator.vibrate&&navigator.vibrate(120);}catch(e){}}
},100);
async function pedirTelaLigada(){try{if('wakeLock' in navigator&&!A.wake){A.wake=await navigator.wakeLock.request('screen');A.wake.addEventListener('release',()=>{A.wake=null;});}}catch(e){}}
function soltarTela(){try{A.wake&&A.wake.release();}catch(e){}A.wake=null;}

/* aviso se a balança parou de mandar dados */
setInterval(()=>{if(A.fonte&&A.fonte!=='sim'&&A.ultDado&&Date.now()-A.ultDado>5000&&!A.status.startsWith('Sem dados')&&!A.status.includes('reconect')){setStatus('Sem dados da balança há mais de 5 s','err');A.estavel=false;aRenderLeve();}
  else if(A.fonte&&A.ultDado&&Date.now()-A.ultDado<2000&&A.status.startsWith('Sem dados')){setStatus('Recebendo peso','ok');}},2000);

/* ---------------- Desenho da tela ---------------- */
let leveT=null;
function aRenderLeve(){if(leveT)return;leveT=setTimeout(()=>{leveT=null;pintarPeso();},120);}
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
  $('aFaltaTit').textContent=(z&&z.falta<0)?'Passou':'Falta tratar';
  if(z){$('aFalta').textContent=fmt(z.falta);fb.className='aFalta '+z.z;
    $('aFaltaTxt').textContent=z.falta<0?`passou ${fmt(-z.falta)} kg do previsto`:z.falta===0?'no ponto!':`de ${fmt(cur.prev)} kg previstos`;
    if(z.falta<0)$('aFalta').textContent='-'+fmt(-z.falta);}
  else{$('aFalta').textContent=cur?fmt(cur.prev):'—';fb.className='aFalta cinza';$('aFaltaTxt').textContent=A.fonte?'esperando peso inicial':'conecte a balança';}
  const et=$('aEtapa');let txt,cl='';
  if(!A.fonte)txt='Conecte a balança (ou use o Simulador)';
  else if(A.peso==null)txt='Esperando o peso chegar da balança…';
  else if(!cur)txt=lista().length?'✓ Trato completo':'Sem previsto neste trato (lance na aba Previsto)';
  else if(A.est==='descarregando'){txt=A.estavel?'Parou de cair · confira e toque em Registrar':'▼ Descarregando no '+cur.nome;cl='desc';}
  else if(A.base==null)txt='Deixe o vagão parado para pegar o peso inicial';
  else{txt='Pronto: pode descarregar no '+cur.nome;cl='pronto';}
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
window.aAoAbrir=()=>{montar();aRender();};
/* quando a aba Tratar ou a nuvem mudam algo, a tela da Automação acompanha */
const renderOriginal=window.render;
if(typeof renderOriginal==='function'){window.render=function(){const r=renderOriginal.apply(this,arguments);try{if(!$('viewAuto').hidden)aRender();}catch(e){}return r;};}
$('tabAuto').addEventListener('click',()=>aba('auto'));
})();

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
const CFG_PADRAO={bleUuid:'',bleCmd:'',tol:10,tempo:4,minDesc:30,amarelo:100,vermelho:50,continuo:20,antecipa:1,ws:'ws://10.10.100.254:6432',som:true,filtro:3};
/* Ajustes da balança: ficam na nuvem (item 'cfgBalanca' da Gestão), então mudar num aparelho muda em todos */
function cfgNuvem(){try{return (typeof G!=='undefined'&&G.it&&G.it.cfgBalanca)||null;}catch(e){return null;}}
function cfg(){if(!S.auto)S.auto={};
  const n=cfgNuvem();if(n&&!n.del&&n.v&&(n.ts||0)>(S.auto._ts||0)){Object.assign(S.auto,n.v);S.auto._ts=n.ts;}
  for(const k in CFG_PADRAO)if(S.auto[k]==null)S.auto[k]=CFG_PADRAO[k];if(!(+S.auto.tempo>=2))S.auto.tempo=2;return S.auto;}
function salvarCfg(){const c=cfg(),v={};for(const k in CFG_PADRAO)v[k]=c[k];
  try{if(typeof gPut==='function'){gPut({uid:'cfgBalanca',tipo:'cfgBalanca',v});c._ts=G.it.cfgBalanca.ts;}}catch(e){}
  save();}

/* não atualiza o app sozinho enquanto a balança está conectada ou descarregando */
window.autoOcupado=()=>!!A.fonte||A.est==='descarregando';window.autoDescarregando=()=>A.est==='descarregando';

/* ---------------- Tela ---------------- */
const css=`
:is(#aBox,#acBox) .curhead .balTog{margin-left:8px;padding:4px 12px;font-size:1rem}
:is(#aBox,#acBox) .curhead .balMini{margin-left:auto;font-size:.82rem;font-weight:700}
:is(#aBox,#acBox) .curhead .balMini.ruim{color:#c62828}
:is(#aBox,#acBox) section.balRec :is(.aStatus,.aConn,.aSinal,.aTeclas,.aSim){display:none!important}
:is(#aBox,#acBox) .aConn{display:grid;grid-template-columns:3fr 2fr;gap:6px}
:is(#aBox,#acBox) .aConn .aDescBt{border-color:var(--bad);color:var(--bad)}
:is(#aBox,#acBox) .aConn .aDescBt:disabled{opacity:.35}
:is(#aBox,#acBox) .aSinal{margin-top:6px;border-radius:10px;padding:8px 10px;font-weight:700;font-size:.95rem;text-align:center;background:#e9ecef;color:#495057}
:is(#aBox,#acBox) .aSinal.ok{background:#e3f5e1;color:#1b5e20}
:is(#aBox,#acBox) .aSinal.ok i{display:inline-block;width:10px;height:10px;border-radius:50%;background:#2e7d32;margin-right:6px;animation:aPulsa 1.2s infinite}
:is(#aBox,#acBox) .aSinal.ruim{background:#c62828;color:#fff;animation:aPisca .8s steps(2) infinite}
@keyframes aPulsa{50%{opacity:.25}}
:is(#aBox,#acBox) .aConn button{padding:14px 6px;font-size:1rem}
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
#cfgTBox .aCores{margin:10px 0 4px;padding:10px;border:1px solid var(--line);border-radius:10px;display:grid;gap:6px;font-size:.88rem}
#cfgTBox .aCores i{display:inline-block;width:22px;height:16px;border-radius:4px;margin-right:8px;vertical-align:-3px}
#cfgTBox .aCores i.pisca{animation:aPisca .5s steps(2) infinite}#cfgTBox .aCores i.pisca2{animation:aPisca2 .4s steps(2) infinite}
:is(#aBox,#acBox) .aFalta.passou{background:#6a1b9a;animation:aPisca2 .4s steps(2) infinite}
@keyframes aPisca2{50%{background:#38006b}}
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
:is(#aBox,#acBox) .aPeso em.atraso{color:#ff8a80;font-weight:700}
:is(#aBox,#acBox) .aBarra{height:18px;border-radius:99px;background:var(--chip);overflow:hidden;border:1px solid var(--line)}
:is(#aBox,#acBox) .aBarra div{height:100%;width:0;background:var(--lima);transition:width .3s}
:is(#aBox,#acBox) .aBarra div.passou{background:var(--bad)}
:is(#aBox,#acBox) .aEtapa{text-align:center;font-weight:700;padding:6px;border-radius:10px;background:var(--chip);font-size:.92rem}
:is(#aBox,#acBox) .aEtapa.desc{background:#fff4d6;color:var(--warn)}
:is(#aBox,#acBox) .aEtapa.pronto{background:#e5f4e3;color:var(--ok)}
:is(#aBox,#acBox,#cfgTBox) .aBruto{font-family:ui-monospace,Menlo,monospace;font-size:.75rem;background:#0f1d2e;color:#cfe;padding:8px;border-radius:8px;max-height:150px;overflow:auto;white-space:pre-wrap;word-break:break-all}
:is(#aBox,#acBox) .aCfg{display:grid;grid-template-columns:1fr 1fr;gap:8px}
:is(#aBox,#acBox) .aCfg label{font-size:.8rem;margin:0}
:is(#aBox,#acBox) .aCfg input{width:100%}
:is(#aBox,#acBox) .aSim{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
:is(#aBox,#acBox) .aTeclas{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:6px}
:is(#aBox,#acBox) .aTeclas button{padding:9px 2px;font-size:.84rem;line-height:1.15}
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
    <div class="curhead"><h2>Balança automática</h2><span class="note" id="aData"></span><span class="balMini" id="aBalMini"></span><button type="button" class="mini balTog" data-baltog="1" aria-label="Mostrar ou esconder a conexão">▲</button></div>
    <div class="aStatus" id="aStatus"><i></i><span id="aStatusTxt">Desconectado</span></div>
    <div class="aConn">
      <button id="aBtSer" hidden>🔵 Bluetooth</button>
      <button id="aBtBt">🔷 Conectar balança (Bluetooth)</button>
      <button id="aBtWs" hidden>📶 Caixinha Wi-Fi</button>
      <button id="aBtSim" hidden>🧪 Simulador</button>
      <button id="aDesc" class="aDescBt" disabled>Desconectar</button>
    </div>
    <div class="aSinal" id="aSinal">⚪ Balança desconectada</div>
    <div class="aTeclas" id="aTeclas" hidden><button data-tecla="43">▸0◂<br>Zero</button><button data-tecla="40">▸T◂<br>Tara</button><button data-tecla="10">Líquido/<br>Bruto</button><button data-tecla="23">🖨<br>Imprimir</button></div>
    <div class="aSim" id="aSimBox" hidden>
      <button class="lima" id="aSimCarga">+ Carregar 1.000</button>
      <button id="aSimDesc">▼ Fornecer</button>
      <button id="aSimPara">■ Parar</button>
    </div>
    <div class="aPeso"><div><small>Balança (kg)</small><em id="aEstTxt">sem leitura</em></div><b class="num" id="aPeso">—</b></div>
  </section>

  <section class="panel fornSetup" id="fSetupA" hidden></section>
  <section class="panel">
    <div class="fBar" id="fBarA" hidden></div>
    <div class="linhaTrato">
      <label for="aTrato">Trato</label>
      <select class="trato" id="aTrato">
        <option value="1">Trato 1</option><option value="2">Trato 2</option><option value="3">Trato 3</option><option value="4">Trato 4</option><option value="5">Trato 5</option><option value="6">Trato 6</option>
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
    <button id="aRecomecar" hidden>↺ Pegar peso inicial</button><button id="aPular">Pular curral ▶</button>
    <button class="naoForn" id="aNaoForn" type="button">🚫 Não fornecer neste curral</button>
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
    <p class="note">Ajustes da balança e dos apitos: Gestão › Config. › Balança.</p>
    <details hidden>
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
  $('aBtBt').onclick=conectarBt;$('aBtSer').onclick=conectarSerial;
  $('aBtWs').onclick=()=>conectarWs();
  $('aBtSim').onclick=conectarSim;
  $('aDesc').onclick=()=>perguntarDesconectar();
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
  $('aNaoForn').onclick=()=>{if(A.est==='descarregando'){toast('Está fornecendo neste curral: registre o trato.');return;}if(window.naoFornecer)naoFornecer();};
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
function marcarFonte(){['aBtSer','aBtBt','aBtWs','aBtSim'].forEach(id=>$(id).classList.remove('on'));
  const m={ser:'aBtSer',bt:'aBtBt',ws:'aBtWs',sim:'aBtSim'}[A.fonte];if(m)$(m).classList.add('on');
  $('aDesc').disabled=!A.fonte;$('aSimBox').hidden=A.fonte!=='sim';$('aTeclas').hidden=!(A.fonte==='bt'&&A.digiStar);acSyncTopo();}
/* Desconectar pede confirmação (para não desligar a balança no meio do trato sem querer) */
async function perguntarDesconectar(){if(!A.fonte)return false;
  const ok=window.confirmaVermelho?await confirmaVermelho('Desconectar a balança?',`O app para de receber o peso.${A.est==='descarregando'?' Você está FORNECENDO agora: o curral não será acompanhado.':''} Para voltar, toque em Conectar balança.`,'Sim, desconectar','Não, manter conectada'):confirm('Desconectar a balança?');
  if(!ok)return false;desconectar(true);return true;}
/* sinal da balança ao lado dos botões: recebendo peso, conectada mas sem peso (perigo), ou desconectada */
function pintarSinal(){const segs=A.ultDado?(Date.now()-A.ultDado)/1000:null;let t,cl='';
  if(!A.fonte){t='⚪ Balança desconectada · toque em Conectar antes de tratar';}
  else if(A.btReconectando){t='🔄 Reconectando a balança… não forneça agora';cl='ruim';}
  else if(segs==null||segs>3){t=segs==null?'⏳ Conectada, esperando o primeiro peso…':`⚠ SEM PESO há ${Math.round(segs)} s · não forneça agora`;cl=segs==null&&Date.now()-(A.tCon||0)<6000?'':'ruim';}
  else{t=`<i></i>Recebendo peso · ao vivo`;cl='ok';}
  ['aSinal','acSinal'].forEach(id=>{const e=$(id);if(!e)return;if(e.innerHTML!==t)e.innerHTML=t;e.className='aSinal '+cl;});
  /* depois de conectar e o peso chegar, recolhe a parte da conexão (fica só a bolinha no título; a setinha abre de novo) */
  if(cl==='ok'&&!A.balAuto){A.balAuto=true;A.balRec=true;}if(!A.fonte){A.balAuto=false;A.balRec=false;}if(cl==='ruim'&&A.balRec){A.balRec=false;A.balAuto=false;} // parou o peso: abre de novo para ver o aviso
  const mini=!A.fonte?'⚪ desconectada':cl==='ok'?'🟢 conectada':'🔴 sem peso';
  ['aBalMini','acBalMini'].forEach(id=>{const e=$(id);if(!e)return;if(e.textContent!==mini)e.textContent=mini;e.className='balMini '+(cl==='ruim'?'ruim':'');});
  aplicarBalRec();}
function aplicarBalRec(){[['aBox',$('aBox')&&$('aBox').querySelector(':scope>section')],['acBox',$('acBox')&&$('acBox').querySelector(':scope>section')]].forEach(([_,sec])=>{if(!sec)return;
  sec.classList.toggle('balRec',!!A.balRec);const b=sec.querySelector('.balTog');if(b)b.textContent=A.balRec?'▼':'▲';});}
document.addEventListener('click',e=>{if(!e.target.closest('[data-baltog]'))return;A.balRec=!A.balRec;aplicarBalRec();});
setInterval(pintarSinal,700);
function desconectar(manual){
  try{if(A.bt&&A.bt.gatt&&A.bt.gatt.connected){A.bt._manual=true;A.bt.gatt.disconnect();}}catch(e){}
  try{if(A.ws){A.ws._manual=true;A.ws.close();}}catch(e){}
  if(A.sim){clearInterval(A.sim.t);A.sim=null;}
  clearInterval(A.btPoll);clearInterval(A.dsPoll);A.digiStar=false;A.dsEsc=null;A.btLer=[];A.btNotif=0;
  if(A.ser){const sr=A.ser;A.ser=null;(async()=>{try{if(sr.leitor)await sr.leitor.cancel();}catch(e){}try{await sr.port.close();}catch(e){}})();}
  A.bt=null;A.ws=null;A.btChars=[];A.fonte=null;A.peso=null;A.brutos=[];A.amostras=[];A.suaves=[];A.suave=NaN;A.ultDado=0;A.temFim=false;A.tCon=0;A.estavel=false;A.valEst=null;
  soltarTela();if(manual)setStatus('Desconectado');marcarFonte();aRender();
}

/* Serviços de "serial por Bluetooth" mais comuns (o navegador só deixa ler os que estiverem nesta lista) */
const SERVICOS=['6e400001-b5a3-f393-e0a9-e50e24dcca9e','0000ffe0-0000-1000-8000-00805f9b34fb','0000fff0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455','0000ffb0-0000-1000-8000-00805f9b34fb','0000fee0-0000-1000-8000-00805f9b34fb',
  '0000181d-0000-1000-8000-00805f9b34fb','0000180a-0000-1000-8000-00805f9b34fb','0000180f-0000-1000-8000-00805f9b34fb',
  '0000ffd0-0000-1000-8000-00805f9b34fb','0000ff00-0000-1000-8000-00805f9b34fb','0000fe59-0000-1000-8000-00805f9b34fb',
  /* módulos serial-BLE comuns em indicadores: Laird/Ezurio vSP, u-blox, Telit TIO, Cypress, Dialog, ISSC, TI, Microchip */
  '569a1101-b87f-490c-92cb-11ba5ea5167c','2456e1b9-26e2-8f83-e744-f34f01e9d701','0000fefb-0000-1000-8000-00805f9b34fb',
  '0003cdd0-0000-1000-8000-00805f9b0131','0783b03e-8535-b5a0-7140-a304d2495cb7','0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ffe5-0000-1000-8000-00805f9b34fb','0000ffc0-0000-1000-8000-00805f9b34fb',
  'f0165585-6058-4c5d-a4b7-412dc08e9d8b'];  // Digi-Star EZ ("NEW EZ", indicador 3405 Bluetooth)
/* comando para pedir o peso (texto; \r = enter, \n = nova linha, <05> = byte em hexa) */
function cmdBle(){const t=String(cfg().bleCmd||'');if(!t)return null;const out=[];t.replace(/\\r/g,'\r').replace(/\\n/g,'\n').replace(/<([0-9a-fA-F]{2})>|([\s\S])/g,(m,h,ch)=>{if(h)out.push(parseInt(h,16));else out.push(ch.charCodeAt(0)&255);return '';});return new Uint8Array(out);}
/* UUID do serviço digitado em Gestão › Config. › Balança (descoberto com o app nRF Connect) */
function servicosBle(){const l=SERVICOS.slice();String(cfg().bleUuid||'').split(/[\s,;]+/).map(x=>x.trim().toLowerCase()).filter(x=>/^[0-9a-f]{4}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x)).forEach(x=>{const u=x.length===4?`0000${x}-0000-1000-8000-00805f9b34fb`:x;if(!l.includes(u))l.push(u);});return l;}
async function conectarBt(){
  if(!navigator.bluetooth){toast('Este celular/navegador não tem Bluetooth BLE para apps. Use o Chrome no Android.');setStatus('Bluetooth indisponível neste navegador','err');return;}
  desconectar(false);
  try{
    setStatus('Escolha a balança na lista…','wait');
    const dev=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:servicosBle()});
    A.bt=dev;A.fonte='bt';marcarFonte();
    try{localStorage.setItem('btUltimo',dev.id||'');}catch(e){}
    ligarQueda(dev);
    await btAbrir(dev);
  }catch(e){
    if(e&&e.name==='NotFoundError'){setStatus('Nenhum aparelho escolhido');A.fonte=null;marcarFonte();return;}
    setStatus('Bluetooth: '+(e.message||e),'err');A.fonte=null;marcarFonte();
  }
}
/* Bluetooth caiu: tenta reconectar sozinho, de novo e de novo, até voltar (ou até tocar em Desconectar) */
function ligarQueda(dev){if(dev._queda)return;dev._queda=true;
  dev.addEventListener('gattserverdisconnected',()=>{if(dev._manual||A.bt!==dev||A.btReconectando)return;reconectarBt('Bluetooth caiu');});}
async function reconectarBt(motivo){const dev=A.bt;if(!dev||A.btReconectando)return;A.btReconectando=true;let n=0;
  try{while(A.bt===dev&&A.fonte==='bt'){n++;setStatus(`${motivo} · reconectando${n>1?' (tentativa '+n+')':''}…`,'wait');bruto(motivo+': reconectando (tentativa '+n+')');if(n===1)diagLog('reconectando',{motivo});
      try{dev._manual=true;if(dev.gatt.connected)dev.gatt.disconnect();}catch(e){}dev._manual=false;
      await new Promise(r=>setTimeout(r,n===1?700:3000));if(A.bt!==dev)break;
      try{await btAbrir(dev);A.ultDado=Date.now();A.btCutucou=0;toast('Balança reconectada');diagLog('reconectou',{tentativas:n});break;}catch(e){bruto('não reconectou: '+(e.message||e));}}}
  finally{A.btReconectando=false;}}
/* vigia: a balança Digi-Star manda o peso o tempo todo (umas 2 vezes por segundo). Se parar 2,5 s,
   chama de novo (05); se chegar a 5 s sem peso, reconecta sozinho — mesmo que pareça "conectado". */
setInterval(()=>{if(A.fonte!=='bt'||!A.bt||!A.digiStar||A.btReconectando)return;
  const parado=Date.now()-Math.max(A.ultDado||0,A.tCon||0);
  if(parado>2500&&!A.btCutucou&&A.dsEsc){A.btCutucou=Date.now();bruto('sem peso há 2,5 s: chamando a balança de novo');diagLog('sem_peso',{});A.dsEsc.writeValue(new Uint8Array([5])).catch(()=>{});}
  if(parado>5000)reconectarBt('Balança parou de mandar o peso');},1000);
/* ao abrir o app de novo (ou depois de atualizar), tenta voltar sozinho para a última balança, se o Chrome deixar */
window.btAutoVoltar=async()=>{try{if(A.fonte||!navigator.bluetooth||!navigator.bluetooth.getDevices)return;const id=localStorage.getItem('btUltimo');if(!id)return;
  const dev=(await navigator.bluetooth.getDevices()).find(d=>d.id===id);if(!dev)return;
  A.bt=dev;A.fonte='bt';marcarFonte();ligarQueda(dev);setStatus('Voltando a conectar na balança…','wait');
  try{await btAbrir(dev);}catch(e){reconectarBt('Conectando na balança');}}catch(e){}};
async function btAbrir(dev){
  setStatus('Conectando em '+(dev.name||'aparelho')+'…','wait');
  const srv=await dev.gatt.connect();
  let servs=[];try{servs=await srv.getPrimaryServices();}catch(e){}
  const info=['Aparelho: '+(dev.name||'(sem nome)')];let n=0;A.btChars=[];A.btLer=[];A.btEsc=[];
  const PADRAO=/^0000(180a|1800|1801|180f)-/;  // informações do aparelho (modelo, fabricante): não é peso
  for(const s of servs){let cs=[];try{cs=await s.getCharacteristics();}catch(e){}
    info.push('Serviço '+s.uuid);const soInfo=PADRAO.test(s.uuid);
    for(const c of cs){const p=c.properties,tem=[p.notify&&'notify',p.indicate&&'indicate',p.read&&'read',p.write&&'write',p.writeWithoutResponse&&'writeNR'].filter(Boolean).join(',');
      info.push('  · '+c.uuid+' ['+tem+']');
      if(soInfo){if(p.read){try{const v=await c.readValue();info.push('    = '+JSON.stringify(txtDe(v)));}catch(e){}}continue;}
      if(p.write||p.writeWithoutResponse)A.btEsc.push(c);
      if(p.notify||p.indicate){try{await c.startNotifications();c.addEventListener('characteristicvaluechanged',ev=>{A.btNotif=Date.now();receber(ev.target.value,'bt');});A.btChars.push(c);n++;}catch(e){info.push('    (não deixou assinar: '+(e.message||e)+')');}}
      if(p.read){A.btLer.push(c);try{const v=await c.readValue();bruto('lido '+c.uuid.slice(0,8)+': '+JSON.stringify(txtDe(v))+'   ['+hexDe(v)+']');}catch(e){}}
    }}
  $('aBtInfo').textContent=info.join('\n');A.btInfo=info.join('\n');
  /* Digi-Star EZ ("NEW EZ"): a balança só manda o peso enquanto o app manda o byte 05 (ENQ) de tempos em tempos,
     igual ao app TAP Feed (descoberto no registro HCI do tablet). Manda logo ao conectar e a cada 3 s. */
  clearInterval(A.dsPoll);A.digiStar=false;
  const dsEsc=A.btEsc.find(c=>c.service&&/^f0165585-/i.test(c.service.uuid));
  if(dsEsc){A.digiStar=true;A.dsEsc=dsEsc;A.dsSeq=0;const enq=new Uint8Array([5]);
    const manda=async()=>{if(A.bt!==dev)return clearInterval(A.dsPoll);try{await dsEsc.writeValue(enq);}catch(e){bruto('erro ao pedir peso: '+(e.message||e));}};
    await manda();A.dsPoll=setInterval(manda,3000);info.push('Digi-Star EZ: pedindo o peso (05) a cada 3 s');$('aBtInfo').textContent=info.join('\n');A.btInfo=info.join('\n');marcarFonte();}
  /* balança que não manda sozinha: lê os canais de leitura de tempos em tempos */
  /* balança que não manda sozinha: lê os canais de leitura e/ou manda o "comando para pedir o peso" (Config › Balança) */
  clearInterval(A.btPoll);if(!A.digiStar&&(A.btLer.length||A.btEsc.length)){n+=A.btLer.length;A.btPoll=setInterval(async()=>{if(A.bt!==dev||A.btLendo)return;if(A.btNotif&&Date.now()-A.btNotif<1500)return;A.btLendo=true;
    try{const cmd=cmdBle();if(cmd&&A.btEsc.length){const ch=A.btEsc[0];if(ch.properties.writeWithoutResponse&&ch.writeValueWithoutResponse)await ch.writeValueWithoutResponse(cmd);else await ch.writeValue(cmd);bruto('enviado: '+hexDe(cmd));}
      for(const c of A.btLer){const v=await c.readValue();if(v&&v.byteLength){bruto('lido '+c.uuid.slice(0,8)+': '+JSON.stringify(txtDe(v))+'   ['+hexDe(v)+']');receber(v,'bt');}}}catch(e){bruto('erro: '+(e.message||e));}A.btLendo=false;},1000);}
  if(!servs.length||!n){setStatus('Conectou, mas não achei o canal de peso desta balança. Descubra o UUID do serviço com o app nRF Connect e coloque em Gestão › Config. › Balança (UUID do Bluetooth). Ou tente o 🔵 Bluetooth.','err');return;}
  if(n)A.tCon=Date.now();setStatus(n?`Bluetooth conectado (${dev.name||'aparelho'}) · aguardando peso…`:'Conectou, mas nenhum canal envia dados. Veja "Dados recebidos".',n?'ok':'err');
  pedirTelaLigada();
}

/* Teclas da Digi-Star EZ, iguais às do app TAP Feed: SUB (1A) + código da tecla + nº de sequência 01..99.
   Zero "43", Tara "40", Líquido/Bruto "10", Imprimir "23" (descobertos no registro HCI do tablet). */
const TECLAS={'43':'Zero','40':'Tara','10':'Líquido/Bruto','23':'Imprimir'};
async function teclaBalanca(cod){
  if(!(A.fonte==='bt'&&A.digiStar&&A.dsEsc)){toast('Conecte a balança pelo 🔷 Conectar balança (Bluetooth)');return;}
  if((cod==='43'||cod==='40')&&!confirm(TECLAS[cod]+' na balança: o peso do visor vai para 0. Confirmar?'))return;
  A.dsSeq=(A.dsSeq%99)+1;const sq=String(A.dsSeq).padStart(2,'0'),txt=cod+sq;
  const b=new Uint8Array([0x1a,...Array.from(txt).map(c=>c.charCodeAt(0))]);
  try{await A.dsEsc.writeValue(b);bruto('tecla '+TECLAS[cod]+': '+hexDe(b));toast(TECLAS[cod]+' enviado à balança');}
  catch(e){toast('Não consegui mandar '+TECLAS[cod]+': '+(e.message||e));}
}
window.teclaBalanca=teclaBalanca;
document.addEventListener('click',e=>{const b=e.target.closest('.aTeclas [data-tecla]');if(b){e.preventDefault();e.stopPropagation();teclaBalanca(b.dataset.tecla);}},true);

/* Caixinha Wi-Fi (USR-W610) em modo WebSocket. Tenta o endereço dos Ajustes e, se não abrir,
   as portas de WebSocket mais comuns dessa caixinha (8000 e 6432). A que funcionar fica salva. */
const AVISO_INSEGURO='Se o Chrome bloquear: toque no cadeado ao lado do endereço › Configurações do site › Conteúdo não seguro › Permitir, e tente de novo.';
function candidatosWs(){const u=cfg().ws||CFG_PADRAO.ws,l=[u];let host='10.10.100.254';try{host=new URL(u).hostname||host;}catch(e){}
  ['8000','6432'].forEach(pt=>{const x=`ws://${host}:${pt}`;if(!l.includes(x))l.push(x);});return l;}
function conectarWs(lista,k){
  if(!lista){desconectar(false);lista=candidatosWs();k=0;A.wsFalhas=[];}
  const url=lista[k];
  setStatus(`Conectando na caixinha ${url}…${lista.length>1?` (tentativa ${k+1} de ${lista.length})`:''}`,'wait');A.fonte='ws';marcarFonte();
  let ws;
  try{ws=new WebSocket(url);}catch(e){bruto('Bloqueado: '+url+' · '+(e.message||e));A.wsFalhas.push(url);
    if(k+1<lista.length)return conectarWs(lista,k+1);
    setStatus('O navegador bloqueou a conexão com a caixinha. '+AVISO_INSEGURO,'err');A.fonte=null;marcarFonte();return;}
  ws.binaryType='arraybuffer';A.ws=ws;let abriu=false;
  const t=setTimeout(()=>{if(ws.readyState!==1){try{ws.close();}catch(e){}}},6000);
  ws.onopen=()=>{clearTimeout(t);abriu=true;A.tCon=Date.now();A.wsOk=url;setStatus('Caixinha conectada ('+url.replace('ws://','')+') · aguardando peso…','ok');pedirTelaLigada();
    bruto('Conectado em '+url);
    if(url!==cfg().ws){cfg().ws=url;salvarCfg();toast('Caixinha respondeu em '+url.replace('ws://','')+' (salvo nos Ajustes)');}};
  ws.onmessage=ev=>receber(ev.data,'ws');
  ws.onerror=()=>{};
  ws.onclose=()=>{clearTimeout(t);if(ws._manual||A.ws!==ws)return;
    if(!abriu&&k+1<lista.length){bruto('Não abriu: '+url);return conectarWs(lista,k+1);}
    setStatus(abriu?'A caixinha desconectou. Tentando de novo…':'Sem conexão com a caixinha. Confira se o celular está no Wi-Fi dela (USR-W610…) e se o WebSocket está ligado nela. '+AVISO_INSEGURO+' Tentando de novo…','err');
    setTimeout(()=>{if(A.ws===ws&&A.fonte==='ws'){A.ws=null;conectarWs(abriu?[url]:candidatosWs(),0);}},5000);};
}

/* Bluetooth "clássico" (porta serial SPP): é o tipo mais comum em indicador de balança.
   Funciona no Chrome do Android (versão 137 ou mais nova) e no computador. Parear a balança antes nas configurações do celular. */
const SPP='00001101-0000-1000-8000-00805f9b34fb';
async function conectarSerial(){
  if(!('serial' in navigator)){toast('Este navegador não tem Bluetooth serial. Use o Chrome atualizado no Android, ou tente o Bluetooth BLE.');setStatus('Bluetooth serial indisponível neste navegador (atualize o Chrome)','err');return;}
  desconectar(false);
  try{
    setStatus('Escolha a balança na lista (ela precisa estar pareada no Bluetooth do celular)…','wait');
    let port;
    try{port=await navigator.serial.requestPort({allowedBluetoothServiceClassIds:[SPP],filters:[{bluetoothServiceClassId:SPP}]});}
    catch(e){if(e&&e.name==='NotFoundError')throw e;port=await navigator.serial.requestPort({allowedBluetoothServiceClassIds:[SPP]});}
    A.fonte='ser';A.ser={port,leitor:null};marcarFonte();
    setStatus('Abrindo a porta da balança…','wait');
    await port.open({baudRate:9600});
    setStatus('Bluetooth conectado · aguardando peso…','ok');A.tCon=Date.now();pedirTelaLigada();
    try{const inf=port.getInfo();$('aBtInfo').textContent='Bluetooth serial · '+JSON.stringify(inf);}catch(e){}
    lerSerial(port);
  }catch(e){
    if(e&&e.name==='NotFoundError'){setStatus('Nenhuma balança escolhida. Pareie a balança no Bluetooth do celular e tente de novo.');}
    else setStatus('Bluetooth: '+(e.message||e),'err');
    A.fonte=null;A.ser=null;marcarFonte();
  }
}
async function lerSerial(port){
  while(A.ser&&A.ser.port===port&&port.readable){
    const r=port.readable.getReader();A.ser.leitor=r;
    try{for(;;){const {value,done}=await r.read();if(done)break;if(value&&value.length)receber(value,'ser');}}
    catch(e){if(A.ser&&A.ser.port===port){setStatus('Bluetooth caiu: '+(e.message||e)+' · tentando ler de novo…','err');bruto('Erro de leitura: '+(e.message||e));}}
    finally{try{r.releaseLock();}catch(e){}}
    if(!(A.ser&&A.ser.port===port))return;
    await new Promise(ok=>setTimeout(ok,1500));
  }
  if(A.ser&&A.ser.port===port)setStatus('Bluetooth desconectado. Toque em Bluetooth de novo.','err');
}

function conectarSim(){
  desconectar(false);A.fonte='sim';marcarFonte();
  A.sim={peso:6000,modo:'parado',t:null};
  A.sim.t=setInterval(()=>{const s=A.sim;if(!s)return;
    if(s.modo==='desc'){s.peso=Math.max(0,s.peso-(5+Math.random()*3));if(s.peso<=0)s.modo='parado';}
    if(s.modo==='sobe'){s.peso=Math.min(20000,s.peso+(5+Math.random()*3));}
    const ruido=s.modo!=='parado'?(Math.random()-.5)*6:(Math.random()-.5)*4;
    receber(`GR ${Math.round(s.peso+ruido)} kg\r\n`,'sim');},300);
  setStatus('Simulador ligado (peso de mentira, para treinar)','ok');pedirTelaLigada();
}

/* ---------------- Leitura do peso ---------------- */
function txtDe(v){try{if(typeof v==='string')return v;const u=v instanceof DataView?new Uint8Array(v.buffer,v.byteOffset,v.byteLength):new Uint8Array(v);
  return Array.from(u).map(b=>b>=32&&b<127?String.fromCharCode(b):b===13?'\r':b===10?'\n':b===2||b===3?'\n':'·').join('');}catch(e){return '';}}
function hexDe(v){try{if(typeof v==='string')return '';const u=v instanceof DataView?new Uint8Array(v.buffer,v.byteOffset,v.byteLength):new Uint8Array(v);
  return Array.from(u).map(b=>b.toString(16).padStart(2,'0')).join(' ');}catch(e){return '';}}
function bruto(l){A.bruto.push(new Date().toLocaleTimeString('pt-BR')+'  '+l);if(A.bruto.length>60)A.bruto.splice(0,A.bruto.length-60);
  const el=$('aBruto');if(el&&el.closest('details').open){el.textContent=A.bruto.join('\n');el.scrollTop=el.scrollHeight;}
  const e2=$('cfgBruto');if(e2&&e2.closest('details').open){e2.textContent=(A.btInfo?A.btInfo+'\n\n':'')+A.bruto.join('\n');e2.scrollTop=e2.scrollHeight;}}
let ultBruto=0;
window.autoReceber=(v,o)=>receber(v,o||"sim");window.autoPeso=()=>({peso:A.peso,visor:A.visor});
function receber(v,origem){
  A.ultDado=Date.now();A.btCutucou=0;
  const t=txtDe(v);
  if(origem!=='sim'&&(origem==='bt'||Date.now()-ultBruto>400)){ultBruto=Date.now();bruto(JSON.stringify(t)+(typeof v!=='string'?'   ['+hexDe(v)+']':''));}
  /* Digi-Star EZ: ESC 'O' 'm' '0' '2' STX "  2115" EOT ESC 'O' 'a' … EOT SUB EOT — o peso é o que está entre STX e EOT.
     Quando o visor mostra mensagem (ex.: "PRESS TARE") não é número e é ignorado. */
  if(typeof v!=='string'){const u=v instanceof DataView?new Uint8Array(v.buffer,v.byteOffset,v.byteLength):new Uint8Array(v);
    if(u.length>5&&u[0]===0x1b&&u[1]===0x4f){A.temFim=true;
      for(let i=0;i<u.length-2;i++){if(u[i]===0x1b&&u[i+1]===0x4f&&u[i+2]===0x6d){const a=u.indexOf(2,i+3),b=a>=0?u.indexOf(4,a+1):-1;
        if(a>=0&&b>a){const vis=String.fromCharCode(...u.slice(a+1,b)).trim();A.visor=vis;
          if(/^-?\s*\d+([.,]\d+)?$/.test(vis)){const n=parseFloat(vis.replace(/\s/g,'').replace(',','.'));if(!isNaN(n))novoPeso(n);}}}}
      return;}}
  A.buf+=t;
  const partes=A.buf.split(/[\r\n]+/);A.buf=partes.pop();if(partes.length)A.temFim=true; // a balança manda "enter" no fim da linha
  if(A.buf.length>80){partes.push(A.buf);A.buf='';}
  // quando a balança manda o número sem "enter" no fim (Bluetooth), usa o pedaço inteiro
  if(!partes.length&&origem==='bt'&&!A.temFim&&/\d/.test(t)){partes.push(t);A.buf='';}
  partes.forEach(p=>{const n=numeroDaLinha(p);if(n!=null)novoPeso(n);});
}
/* pega o último número da linha: "GR  12.345 kg", "+012345", "ST,GS,+0012345kg" */
function numeroDaLinha(l){
  const s=String(l).replace(/\s+/g,' ');
  const u=s.match(/([+-]?\s?\d[\d.,]*)\s*(kg|lb)/i); // número logo antes de "kg"/"lb" tem preferência
  const m=u?[u[1]]:s.match(/[+-]?\s?\d[\d.,]*/g);if(!m)return null;
  let x=m[m.length-1].replace(/\s/g,'');const neg=x.startsWith('-');x=x.replace(/^[+-]/,'');
  if(/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(x))x=x.replace(/\./g,'').replace(',','.');      // 12.345 ou 12.345,5
  else if(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(x))x=x.replace(/,/g,'');                  // 12,345
  else x=x.replace(',','.');
  const n=parseFloat(x);if(isNaN(n)||n>100000)return null;
  return neg?-n:n;
}
const med=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:NaN;
/* peso de referência quando a balança ainda não firmou: menor/maior dos últimos 3 s, ou a média se estiver sem subir nem descer */
function refProvisoria(sinal){const c=cfg(),agora=Date.now(),ss=(A.suaves||[]).filter(a=>a.t>=agora-3000);if(ss.length<4||A.amostras.length<4||agora-A.amostras[0].t<2500)return null;
  const vs=ss.map(a=>a.v),ext=sinal>0?Math.min(...vs):Math.max(...vs);
  if(sinal>0?A.suave>ext+c.minDesc:A.suave<ext-c.minDesc)return {v:Math.round(ext),mexendo:true};
  const k=Math.max(1,Math.floor(vs.length/3));if(Math.abs(med(vs.slice(-k))-med(vs.slice(0,k)))<=c.tol)return {v:Math.round(med(vs.slice(-k))),mexendo:false};
  return null;}
/* mostra se a leitura está chegando em dia: "ao vivo" ou "sem leitura há X s" (em vermelho) */
const atrasada=()=>!!(A.fonte&&A.ultDado&&Date.now()-A.ultDado>2000);
function idadeLeitura(){if(!A.fonte||!A.ultDado)return '';const s=(Date.now()-A.ultDado)/1000;return s<=2?' · ao vivo':` · ⚠ sem leitura há ${Math.round(s)} s`;}
setInterval(()=>{if(!atrasada())return;[['aEstTxt','aPeso'],['acEstTxt','acPeso']].forEach(([i,p])=>{const e=$(i);if(!e)return;
  e.textContent=(A.estavel?'● parado (estável)':'○ mexendo…')+idadeLeitura();e.className='atraso';const b=$(p);if(b)b.style.opacity='.45';});},1000);
function novoPeso(n){
  const c=cfg(),agora=Date.now();
  /* ajuste fino: mediana das últimas leituras (1 = sem filtro, 3 normal, 5 forte) — tira o "pula pra cima e pra baixo"
     de uma leitura isolada sem atrasar muito (a Digi-Star manda ~1,6 leitura por segundo) */
  A.brutos=(A.brutos||[]).concat(n).slice(-9);const kf=Math.max(1,Math.min(9,Math.round(+c.filtro||1)));
  if(kf>1&&A.brutos.length>1){const u=A.brutos.slice(-kf).slice().sort((x,y)=>x-y);n=u[Math.floor((u.length-1)/2)];}
  ['aPeso','acPeso'].forEach(i=>{const b=$(i);if(b&&b.style.opacity)b.style.opacity='';});
  if(A.tUlt){const dt=agora-A.tUlt;if(dt>0&&dt<3000)A.dtMed=A.dtMed?A.dtMed*0.8+dt*0.2:dt;}A.tUlt=agora;
  A.peso=n;A.amostras.push({t:agora,v:n});
  const ini=agora-c.tempo*1000;A.amostras=A.amostras.filter(a=>a.t>=agora-Math.max(c.tempo*1000,3000)-1500);
  const jan=A.amostras.filter(a=>a.t>=ini);
  const cobre=A.amostras.length&&A.amostras[0].t<=ini+300;
  /* peso suavizado (média das últimas leituras): tira o tremido do motor/vagão */
  let ult=A.amostras.filter(a=>a.t>=agora-700);if(ult.length<3)ult=A.amostras.slice(-3);A.suave=med(ult.map(a=>a.v));
  A.suaves=(A.suaves||[]).filter(a=>a.t>=agora-Math.max(c.tempo*1000,3000)-1500);A.suaves.push({t:agora,v:A.suave});
  if(cobre&&jan.length>=3){const vs=jan.map(a=>a.v),mx=Math.max(...vs),mn=Math.min(...vs);
    const ss=A.suaves.filter(a=>a.t>=ini).map(a=>a.v),k=Math.max(1,Math.floor(vs.length/3));
    const deriva=Math.abs(med(vs.slice(-k))-med(vs.slice(0,k)));
    // parado: ou varia menos que o aceito, ou (com balança tremendo) não sobe/desce e a média fica firme
    A.estavel=(mx-mn)<=c.tol||(deriva<=c.tol&&(Math.max(...ss)-Math.min(...ss))<=c.tol*2);
    A.valEst=A.estavel?Math.round(med(vs)):null;}
  else{A.estavel=false;A.valEst=null;}
  if(A.status.includes('aguardando peso'))setStatus(A.status.replace(' · aguardando peso…',' · recebendo peso'),'ok');
  maquina();maquinaCarga();
  aRenderLeve();
}

/* ---------------- Lógica do trato automático ----------------
   aguardando: balança parada → guarda o peso inicial
   começou a cair (mais que o mínimo) → descarregando
   parou de cair → registra (inicial − final) e passa para o próximo curral */
function curralAtual(){try{return (S&&lista()[S.atual])||null;}catch(e){return null;}}
/* troca de curral: o peso de agora vira o inicial */
function novoCurral(manterPeso){A.est='aguardando';A.ancV=null;A.ancT=0;A.fpMin=null;A.menor=null;A.base=manterPeso&&A.peso!=null?(A.estavel?A.valEst:A.peso):null;}
function maquina(){
  if(naCargaAuto())return; // na tela de carregar o trato fica parado (não perde o que já estava fornecendo)
  const c=cfg(),cur=curralAtual();if(A.peso==null)return;
  if(A.est==='aguardando'){
    const lim=cur?Math.min(c.minDesc,Math.max(c.tol,cur.prev/2)):c.minDesc; // curral pequeno: começa com menos
    if(A.base!=null&&cur&&A.suave<A.base-lim){A.est='descarregando';A.menor=A.peso;A.avisou1=false;A.avisou2=false;A.ancV=A.suave;A.ancT=Date.now();A.fpMin=null;return;}
    /* parado: o peso inicial é sempre o peso real da balança agora (não o final do curral anterior, que pode variar) */
    if(A.estavel&&(A.base==null||A.valEst!==A.base)){if(A.base!=null&&A.baseConf===false&&Math.abs(A.valEst-A.base)>=5)diagLog('ini_ajustado',{curral:cur?cur.nome:'',de:A.base,para:A.valEst});A.base=A.valEst;A.baseConf=true;}
    if(A.base==null){const r=refProvisoria(-1);if(r)A.base=r.v;}  // balança tremendo ou já começou a descer: não fica esperando
    return;
  }
  if(A.est==='descarregando'){
    A.menor=Math.min(A.menor,A.peso);
    const passo=Math.max(4,(+c.tol||0)/2);
    if(A.ancV==null||A.suave<A.ancV-passo){A.ancV=A.suave;A.ancT=Date.now();}
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
  diagLog('trato',Object.assign({curral:cur.nome,trato:S.tratoSel,prev:cur.prev,ini,fim,forn:ini-fim,iniConf:A.baseConf!==false},resumoBal()));
  novoCurral();A.base=fim;A.baseConf=false; // provisório: o final deste curral; troca pelo peso real da balança assim que firmar
  save();render();aRender();registrando=false;
  setTimeout(()=>{if(window.compensarCurral){compensarCurral(cur.nome);if(window.proximoTratoSeCompleto&&proximoTratoSeCompleto()){$('aTrato').value=String(S.tratoSel);novoCurral(true);}render();aRender();}},1200);
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
/* janelas que se ajustam à velocidade da balança (a Digi-Star manda 1 leitura a cada ~0,6 s) */
const jCaindo=()=>Math.max(800,2.6*(A.dtMed||300)),jTaxa=()=>Math.max(1500,4.5*(A.dtMed||300)),jVivo=()=>Math.max(1500,3.5*(A.dtMed||300));
function taxaQueda(sinal){sinal=sinal||1;const agora=Date.now();if(!A.amostras.length||agora-A.ultDado>jVivo())return 0;
  const p=A.amostras.filter(a=>a.t>=agora-jTaxa());if(p.length<2)return 0;
  const t0=p[0].t,n=p.length;let sx=0,sy=0,sxx=0,sxy=0;
  p.forEach(a=>{const x=(a.t-t0)/1000;sx+=x;sy+=a.v;sxx+=x*x;sxy+=x*a.v;});
  const den=n*sxx-sx*sx;if(den<=0)return 0;
  return Math.max(0,-sinal*(n*sxy-sx*sy)/den);}
/* "está caindo": o peso fez um novo mínimo (pelo menos metade da variação aceita) há menos de 0,9 s.
   Parou o vagão → em menos de 1 s o apito para. */
function caindoAgora(){return A.est==='descarregando'&&A.ancT>0&&Date.now()-A.ancT<jCaindo()&&Date.now()-A.ultDado<jVivo();}
function zona(){const cur=curralAtual();if(!cur||A.base==null||A.peso==null)return null;
  const c=cfg(),falta=cur.prev-Math.max(0,A.base-A.peso),caindo=caindoAgora();
  const taxa=caindo?taxaQueda():0;
  let fp=falta;
  if(caindo){fp=falta-taxa*(+c.antecipa||0); // onde vai estar daqui a "antecipa" segundos
    if(A.fpMin!=null&&A.fpMin<fp)fp=A.fpMin;A.fpMin=fp;} // não volta de cor no meio da descarga
  else A.fpMin=null;
  return {falta,fp,taxa,caindo,z:falta<0?'passou':fp<=c.continuo?'continuo':fp<=c.vermelho?'vermelho':fp<=c.amarelo?'amarelo':'verde'};}
/* intervalo entre apitos (ms), apertando aos poucos dentro de cada faixa */
function intervalo(fp,c){const am=+c.amarelo,ve=+c.vermelho,co=+c.continuo;
  const lerp=(x,x0,x1,y0,y1)=>x1===x0?y1:y0+(y1-y0)*Math.min(1,Math.max(0,(x0-x)/(x0-x1)));
  if(fp<0)return {ms:60,som:'direto'};
  if(fp<=co)return {ms:85,som:'direto'};
  if(fp<=ve)return {ms:lerp(fp,ve,co,330,160),som:'rapido'};
  if(fp<=am)return {ms:lerp(fp,am,ve,700,380),som:'lento'};
  return null;}
function testarSom(){liberarSom();
  if(!cfg().som){toast('O apito está desligado em Gestão › Config.');return;}
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
setInterval(()=>{if(A.fonte&&A.fonte!=='sim'&&!A.ultDado&&A.tCon&&Date.now()-A.tCon>8000&&!A.status.startsWith('Conectado, mas')){setStatus('Conectado, mas a balança não mandou nenhum peso ainda. No indicador, a saída de dados (porta serial/remota) precisa estar ligada em modo contínuo.','err');}
  else if(A.fonte&&A.fonte!=='sim'&&A.ultDado&&Date.now()-A.ultDado>5000&&!A.status.startsWith('Sem dados')&&!A.status.includes('reconect')){setStatus('Sem dados da balança há mais de 5 s','err');A.estavel=false;aRenderLeve();}
  else if(A.fonte&&A.ultDado&&Date.now()-A.ultDado<2000&&A.status.startsWith('Sem dados')){setStatus('Recebendo peso','ok');}},2000);

/* ---------------- Desenho da tela ---------------- */
let leveT=null;
function aRenderLeve(){if(leveT)return;leveT=setTimeout(()=>{leveT=null;pintarPeso();pintarCarga();if(typeof agendarAoVivo==='function')agendarAoVivo();},120);}
/* acompanhamento ao vivo do Tratar pela balança */
window.aEstadoAoVivo=()=>{const L=lista(),c=L[S.atual],regs=regsAtuais();
  return {modo:'trato',origem:'auto',dia:diaAtivo(),trato:S.tratoSel,curral:c?c.nome:'',prev:c?c.prev:null,ini:A.base!=null?Math.round(A.base):'',fim:A.peso!=null?Math.round(A.peso):'',
    feitos:L.filter(x=>feito(x.nome,regs)).length,total:L.length};};
function pintarPeso(){
  if(!$('aPeso')||$('viewAuto').hidden)return;
  const c=cfg(),cur=curralAtual();
  $('aPeso').textContent=A.peso==null?'—':fmt(A.peso);
  const e=$('aEstTxt');e.textContent=(A.peso==null?'sem leitura':A.estavel?'● parado (estável)':'○ mexendo…')+idadeLeitura();e.className=atrasada()?'atraso':A.estavel?'est':'';
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
/* continuar o trato que outro aparelho deixou no meio (bateria acabou, etc.): usa o peso inicial que ele tinha */
/* ---------- Diário da balança: guarda na nuvem o que aconteceu (registros, ajustes, reconexões, correções)
   em um item por dia e por aparelho, para analisar depois ---------- */
let diagT=null;
window.diagLog=function(tipo,d){try{if(typeof gPut!=='function'||typeof G==='undefined'||!S)return;
  const dia=typeof diaAtivo==='function'?diaAtivo():new Date().toISOString().slice(0,10),uid='diag-'+dia+'-'+S.aparelho;
  const it=G.it[uid]&&!G.it[uid].del?G.it[uid]:{uid,tipo:'diag',dia,aparelho:S.aparelho,ev:[]};
  const h=new Date();it.ev=(it.ev||[]).concat([Object.assign({t:h.toTimeString().slice(0,8),tipo},d||{})]).slice(-400);
  it.cfg=(()=>{const c=cfg(),o={};['tol','tempo','minDesc','amarelo','vermelho','continuo','antecipa','filtro'].forEach(k=>o[k]=c[k]);return o;})();
  G.it[uid]=it;clearTimeout(diagT);diagT=setTimeout(()=>{try{gPut(JSON.parse(JSON.stringify(G.it[uid])));}catch(e){}},4000);}catch(e){}};
const resumoBal=()=>{const vs=(A.amostras||[]).map(a=>a.v);return {estavel:!!A.estavel,varia:vs.length?Math.max(...vs)-Math.min(...vs):null,leit_s:A.dtMed?+(1000/A.dtMed).toFixed(2):null};};
window.pesoBalanca=()=>A.fonte&&A.peso!=null&&A.ultDado&&Date.now()-A.ultDado<3000?Math.round(A.peso):null;
window.aRenderFora=()=>{try{if($('viewAuto')&&!$('viewAuto').hidden){novoCurral(true);$('aTrato').value=String(S.tratoSel);aRender();}}catch(e){}};
window.aContinuar=v=>{diagLog('continuou_outro_aparelho',{ini:+v,peso:A.peso});A.est='aguardando';A.ancV=null;A.ancT=0;A.fpMin=null;A.menor=null;A.base=+v;
  if(A.peso!=null&&A.peso<A.base-cfg().minDesc){A.est='descarregando';A.menor=A.peso;A.ancV=A.suave;A.ancT=0;}aRender();};
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
    const lim=Math.min(c.minDesc,Math.max(c.tol,it.prev/2)); // produto pequeno (núcleo): começa com menos
    if(ok(it.ini)&&A.suave>it.ini+lim){AC.est='carregando';AC.ancV=A.suave;AC.ancT=Date.now();AC.fpMin=null;return;}
    if(A.estavel&&(!ok(it.ini)||A.valEst!==it.ini)){if(ok(it.ini)&&Math.abs(A.valEst-it.ini)>=5)diagLog('ini_ajustado_carga',{produto:it.nome,de:it.ini,para:A.valEst});it.ini=A.valEst;it.fim=null;cSave();}  // parado: o peso inicial é sempre o peso real da balança agora
    if(!ok(it.ini)){const r=refProvisoria(1);if(r){it.ini=r.v;it.fim=null;cSave();}}  // balança tremendo ou já começou a carregar: não fica esperando
  }else{
    const passo=Math.max(4,(+c.tol||0)/2);
    if(A.suave>AC.ancV+passo){AC.ancV=A.suave;AC.ancT=Date.now();}
    if(A.estavel&&A.valEst<it.ini-c.minDesc){AC.est='aguardando';it.ini=A.valEst;cSave();toast('Peso caiu abaixo do início: peso inicial atualizado.');}
  }
}
function subindoAgora(){return AC.est==='carregando'&&AC.ancT>0&&Date.now()-AC.ancT<jCaindo()&&Date.now()-A.ultDado<jVivo();}
function zonaC(){const it=acItem();if(!naCargaAuto()||!it||!ok(it.ini)||A.peso==null||ok(it.real))return null;
  const c=cfg(),carregado=Math.max(0,A.peso-it.ini),falta=it.prev-carregado,sub=subindoAgora(),taxa=sub?taxaQueda(-1):0;
  let fp=falta;
  if(sub){fp=falta-taxa*(+c.antecipa||0);if(AC.fpMin!=null&&AC.fpMin<fp)fp=AC.fpMin;AC.fpMin=fp;}else AC.fpMin=null;
  return {falta,fp,taxa,carregado,caindo:sub,z:falta<0?'passou':fp<=c.continuo?'continuo':fp<=c.vermelho?'vermelho':fp<=c.amarelo?'amarelo':'verde'};}
window.acTela=(nova,dia)=>{
  const topo=`<section class="panel">
    <div class="curhead"><h2>Carregar com a balança</h2><span class="balMini" id="acBalMini"></span><button type="button" class="mini balTog" data-baltog="1" aria-label="Mostrar ou esconder a conexão">▲</button></div>
    <div class="aStatus" id="acStatus"><i></i><span id="acStatusTxt">Desconectado</span></div>
    <div class="aConn"><button data-ac="ser" id="acBtSer" hidden>🔵 Bluetooth</button><button data-ac="bt" id="acBtBt">🔷 Conectar balança (Bluetooth)</button><button data-ac="ws" id="acBtWs" hidden>📶 Caixinha Wi-Fi</button><button data-ac="sim" id="acBtSim" hidden>🧪 Simulador</button><button data-ac="desc" id="acDesc" class="aDescBt" disabled>Desconectar</button></div>
    <div class="aSinal" id="acSinal">⚪ Balança desconectada</div>
    <div class="aTeclas" id="acTeclas" hidden><button data-tecla="43">▸0◂<br>Zero</button><button data-tecla="40">▸T◂<br>Tara</button><button data-tecla="10">Líquido/<br>Bruto</button><button data-tecla="23">🖨<br>Imprimir</button></div>
    <div class="aSim" id="acSimBox" hidden><button class="lima" data-ac="simSobe">▲ Carregar</button><button data-ac="simPara">■ Parar</button><button data-ac="simZera">Esvaziar</button></div>
    <div class="aPeso"><div><small>Balança (kg)</small><em id="acEstTxt">sem leitura</em></div><b class="num" id="acPeso">—</b></div>
  </section>`;
  if(nova)return topo+nova+dia;
  const B=acB(),i=B.atual,it=B.itens[i];
  const pend=B.itens.filter(x=>!ok(x.real)).length,todosC=!pend,ultimoC=pend===1&&it&&!ok(it.real);
  const h=cTelaBatida(),k=h.indexOf('<section',h.indexOf('<section')+8),tabela=k>0?h.slice(k):'';
  return topo+(window.barraBatida?barraBatida(B):'')+`<section class="panel"><div class="curhead"><h2>Batida · ${B.avulso?'Avulsa':'Trato '+B.trato}</h2><span class="note">${esc(B.racNome)} · ${nf(B.total)} kg</span></div>
    <div class="curBox2"><div class="cbCur" data-c="escolher" role="button"><span>Produto ${i+1} de ${B.itens.length} <i class="seta">▼</i></span><b>${esc(it?it.nome:'—')}</b></div>
      <div class="cbPrev"><span>Carregar</span><b class="num">${it?nf(it.prev):'—'}</b></div></div>
    ${B.escolha?`<div class="escolha">${B.itens.map((x,j)=>`<button data-c="ir" data-i="${j}" class="${j===i?'sel':''}">${ok(x.real)?'✓ ':''}${esc(x.nome)} · ${nf(x.prev)} kg</button>`).join('')}</div>`:''}
    ${it&&ok(it.real)?`<p class="avisoJa">Este produto já foi carregado (${nf(it.real)} kg). Para refazer, toque em Desfazer último, lá embaixo.</p>`:''}
    <div class="aEtapa" id="acEtapa"></div>
    <div class="aFalta" id="acFaltaBox"><small id="acFaltaTit">Carregar</small><b class="num" id="acFalta">—</b><em id="acFaltaTxt">&nbsp;</em></div>
    <div class="aMini">
      <div class="caiu"><small>Carregado</small><b class="num" id="acCarr">—</b></div>
      <div><small>Peso inicial</small><b class="num" id="acIni">—</b></div>
      <div><small>Parar com</small><b class="num" id="acAlvo">—</b></div>
    </div>
    ${todosC?`<p class="avisoJa">✓ Todos os produtos foram carregados.</p><button class="primary" data-c="concluir">✓ Finalizar batida</button>`
      :`<button class="primary" data-c="registrar" id="acReg" disabled>${ultimoC?'✓ Registrar último produto':'✓ Registrar e ir para o próximo ▶'}</button>`}
    <div class="row"><button data-c="ant"${i>0?'':' disabled'}>◀ Produto anterior</button><button class="lima" data-c="prox"${i<B.itens.length-1?'':' disabled'}>Próximo produto ▶</button></div>
  </section>`+tabela+dia;};
window.acDepois=()=>{acSyncTopo();const B=acB();if(B&&AC.idx!==B.atual){AC.idx=B.atual;acNovoProduto();}pintarCarga();};
window.acIniciou=()=>{acNovoProduto();const B=acB();AC.idx=B?B.atual:null;const it=acItem();if(it&&A.estavel){it.ini=A.valEst;cSave();}pintarCarga();
  if(!A.fonte)toast('Conecte a balança para carregar pela Automação');};
window.acRegistrar=()=>{const B=acB(),it=acItem();if(!B||!it)return;
  if(ok(it.real)){toast('Este produto já foi registrado. Para refazer, toque em Desfazer último.');return;}
  if(!ok(it.ini)){toast('Sem peso inicial ainda');return;}
  const fim=A.estavel?A.valEst:A.peso;if(fim==null){toast('Sem leitura da balança');return;}
  if(!(fim>it.ini)){toast('O peso não subiu desde o início');return;}
  it.fim=fim;it.real=fim-it.ini;it.hora=new Date().toTimeString().slice(0,5);it.tsReg=Date.now();
  diagLog('carga',Object.assign({produto:it.nome,trato:B.trato,prev:it.prev,ini:it.ini,fim,real:it.real},resumoBal()));
  const k=B.itens.findIndex((x,j)=>j>B.atual&&!ok(x.real)),nx=k>=0?k:B.itens.findIndex(x=>!ok(x.real));
  if(nx>=0){B.atual=nx;const n=B.itens[nx];if(!ok(n.real)){n.ini=fim;n.fim=null;}}
  AC.idx=B.atual;acNovoProduto();pararSom();cSave();toast(`${it.nome}: ${nf(it.real)} kg`);cRender();
  if(nx<0)toast('Todos os produtos carregados. Toque em ✓ Finalizar batida.');};
/* "Próximo produto": se já carregou este produto, registra (e vai para o próximo); senão só passa para o próximo */
window.acProximo=()=>{const B=acB(),it=acItem();if(!B||!it)return;const c=cfg();
  if(!ok(it.real)&&ok(it.ini)&&A.peso!=null&&(A.estavel?A.valEst:A.peso)>it.ini+Math.max(c.tol,5))return acRegistrar();
  if(B.atual>=B.itens.length-1)return;
  B.atual++;const n=B.itens[B.atual];
  if(!ok(n.real)){const pv=B.itens[B.atual-1];n.ini=ok(pv.fim)&&ok(pv.real)?pv.fim:(A.estavel?A.valEst:null);n.fim=null;}
  B.escolha=false;AC.idx=B.atual;acNovoProduto();pararSom();cSave();cRender();};
function acSyncTopo(){if(!$('acStatus'))return;
  $('acStatusTxt').textContent=A.status;$('acStatus').className='aStatus '+(A.statusTipo||'');
  ['ser','bt','ws','sim'].forEach(f=>$({ser:'acBtSer',bt:'acBtBt',ws:'acBtWs',sim:'acBtSim'}[f]).classList.toggle('on',A.fonte===f));
  $('acDesc').disabled=!A.fonte;$('acSimBox').hidden=A.fonte!=='sim';const tk=$('acTeclas');if(tk)tk.hidden=!(A.fonte==='bt'&&A.digiStar);}
function pintarCarga(){
  if(!naCargaAuto()||!$('acPeso'))return;
  $('acPeso').textContent=A.peso==null?'—':fmt(A.peso);
  const e=$('acEstTxt');e.textContent=(A.peso==null?'sem leitura':A.estavel?'● parado (estável)':'○ mexendo…')+idadeLeitura();e.className=atrasada()?'atraso':A.estavel?'est':'';
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
  if($('acReg'))$('acReg').disabled=!(it&&!ok(it.real)&&ok(it.ini)&&A.peso!=null&&A.peso>it.ini)||modoVer;
}
$('acBox').addEventListener('click',e=>{const b=e.target.closest('[data-ac]');if(!b)return;const a=b.dataset.ac;
  if(a==='ser')return conectarSerial();if(a==='bt')return conectarBt();if(a==='ws')return conectarWs();if(a==='sim'){conectarSim();return cRender();}
  if(a==='desc'){perguntarDesconectar().then(f=>{if(f)cRender();});return;}
  if(a==='simSobe'){if(A.sim)A.sim.modo='sobe';return;}if(a==='simPara'){if(A.sim)A.sim.modo='parado';return;}
  if(a==='copiar'){copiar((A.btInfo?A.btInfo+'\n\n':'')+A.bruto.join('\n'),'Dados copiados');return;}
  if(a==='simZera'){if(A.sim){A.sim.modo='parado';A.sim.peso=0;}return;}
  if(a==='pegar'){if(bloqueado())return;const it=acItem();if(!it)return;if(A.peso==null){toast('Sem leitura da balança');return;}
    it.ini=A.estavel?A.valEst:A.peso;it.fim=null;it.real=null;acNovoProduto();cSave();cRender();toast('Peso inicial: '+fmt(it.ini)+' kg');}});
window.acAoAbrir=()=>{montar();cRender();window.scrollTo({top:0});try{if(typeof gSync==='function')gSync(true).catch(()=>{});}catch(e){}};
$('tabAutoC').addEventListener('click',()=>aba('autoc'));

/* ---------------- Gestão › Config. (ajustes da balança, iguais em todos os aparelhos) ---------------- */
const CAMPOS=[['amarelo','🟡 Apito lento','kg faltando · fica amarelo'],['vermelho','🔴 Apito rápido','kg faltando · fica vermelho'],['continuo','🚨 Apito direto (bem rápido)','kg faltando · pisca'],
  ['antecipa','⏩ Antecipar cor e apito','segundos · compensa o atraso da balança'],
  ['filtro','🎚 Suavizar leituras','nº de leituras · 1 = sem filtro, 3 normal, 5 forte'],['tol','Variação aceita parado','kg'],['tempo','Tempo parado para firmar','segundos'],['minDesc','Mínimo que conta como descarga','kg']];
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
    <div class="aCores" id="cfgT_cores"></div>
    <label for="cfgT_ble" style="margin-top:8px">UUID do Bluetooth BLE (se a balança não for achada)</label>
    <input id="cfgT_ble" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="ex.: 0000ffe0-0000-1000-8000-00805f9b34fb">
    <label for="cfgT_cmd" style="margin-top:8px">Comando para pedir o peso (Bluetooth BLE)</label>
    <input id="cfgT_cmd" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="deixe vazio se a balança manda sozinha">
    <label for="cfgT_ws" style="margin-top:8px">Endereço da caixinha Wi-Fi</label>
    <input id="cfgT_ws" type="text" autocapitalize="off" autocorrect="off" spellcheck="false">
  </section>
  <section class="panel">
    <div class="curhead"><h2>🔊 Apito</h2></div>
    <label class="aChk"><input type="checkbox" id="cfgT_som"> Apito ligado (sem vibração)</label>
    <p class="note">Funciona como sensor de ré: começa espaçado no amarelo e vai apertando até o direto, que é um bip bem rápido. Quando o peso para de cair, o apito para na hora.</p>
    <button id="cfgT_teste">🔊 Testar apito (lento → rápido → direto)</button>
    <button id="cfgT_padrao" style="margin-top:6px">Voltar ao padrão</button>
  </section>
  <section class="panel">
    <div class="curhead"><h2>📖 Como conectar a balança</h2></div>
    <ol class="note" style="padding-left:18px;margin:6px 0">
      <li>Feche o app <b>TAP Feed</b> (a balança aceita um aparelho por vez).</li>
      <li>Use o <b>Chrome</b>. Na Automação, toque em <b>🔷 Conectar balança (Bluetooth)</b> e escolha <b>NEW EZ</b>.</li>
      <li>Se o peso parar de chegar, o app reconecta sozinho. Se não voltar, toque em Desconectar e conecte de novo.</li></ol>
    <p class="note" style="margin-top:8px"><b>Outras formas de conectar</b> (se um dia precisar):</p>
    <details><summary>🔵 Bluetooth (indicador com Bluetooth)</summary><ol class="note" style="padding-left:18px;margin:6px 0">
      <li>No celular: Configurações › Bluetooth › parear com a balança (senha costuma ser 1234 ou 0000).</li>
      <li>Use o <b>Chrome</b> atualizado. Na Automação, toque em <b>🔵 Bluetooth</b> e escolha a balança na lista.</li>
      <li>Se a balança não aparecer, tente <b>🔷 Bluetooth BLE</b>.</li>
      <li>Conectou e o peso não chega: no indicador, ligue a saída de dados (serial/remota) em modo contínuo.</li></ol></details>
    <details><summary>📶 Caixinha Wi-Fi (USR-W610)</summary><ol class="note" style="padding-left:18px;margin:6px 0">
      <li>No celular: Configurações › Wi-Fi › conectar na rede da caixinha (USR-W610…). Se perguntar "sem internet", escolha manter conectado.</li>
      <li>Na Automação, toque em <b>📶 Caixinha Wi-Fi</b>. O app tenta o endereço salvo e as portas 8000 e 6432; a que responder fica salva.</li>
      <li>Se o Chrome bloquear: toque no cadeado ao lado do endereço › Configurações do site › Conteúdo não seguro › <b>Permitir</b>.</li>
      <li>Na caixinha (página 10.10.100.254) o WebSocket precisa estar ligado e a velocidade da serial igual à do indicador.</li></ol></details>
  </section>
  <section class="panel">
    <details id="cfgDados"><summary>🔧 Dados recebidos da balança (para teste)</summary>
      <p class="note">O que chegou da balança neste aparelho (últimas leituras, reconexões). O histórico do dia também fica salvo na nuvem.</p>
      <pre class="aBruto" id="cfgBruto">Nada recebido ainda.</pre>
      <button id="cfgCopiar" style="margin-top:6px">Copiar dados</button></details>
  </section>`;
  CAMPOS.forEach(([k])=>{$('cfgT_'+k).onchange=e=>{const c=cfg(),v=parseFloat(String(e.target.value).replace(',','.'));
    if(!isNaN(v)&&v>=0){c[k]=v;salvarCfg();avisoCfg();pintarCores();}else e.target.value=c[k];};});
  $('cfgDados').addEventListener('toggle',()=>{if($('cfgDados').open){const e=$('cfgBruto');e.textContent=(A.btInfo?A.btInfo+'\n\n':'')+(A.bruto.join('\n')||'Nada recebido ainda.');e.scrollTop=e.scrollHeight;}});
  $('cfgCopiar').onclick=()=>copiar((A.btInfo?A.btInfo+'\n\n':'')+A.bruto.join('\n'),'Dados copiados');
  $('cfgT_cmd').onchange=e=>{const c=cfg();c.bleCmd=e.target.value;salvarCfg();avisoCfg();toast('Comando salvo. Conecte de novo pelo 🔷 Bluetooth BLE.');};
  $('cfgT_ble').onchange=e=>{const c=cfg();c.bleUuid=e.target.value.trim();salvarCfg();avisoCfg();toast('UUID salvo. Conecte de novo pelo 🔷 Bluetooth BLE.');};
  $('cfgT_ws').onchange=e=>{const c=cfg();c.ws=e.target.value.trim()||CFG_PADRAO.ws;e.target.value=c.ws;salvarCfg();avisoCfg();};
  $('cfgT_som').onchange=e=>{const c=cfg();c.som=e.target.checked;salvarCfg();avisoCfg();if(c.som){liberarSom();tocar('lento');}};
  $('cfgT_teste').onclick=testarSom;
  $('cfgT_padrao').onclick=()=>{if(!confirm('Voltar todos os ajustes da balança ao padrão (em todos os aparelhos)?'))return;
    const c=cfg();for(const k in CFG_PADRAO)c[k]=CFG_PADRAO[k];salvarCfg();preencherCfgT();avisoCfg();};
}
function avisoCfg(){const el=$('cfgTSinc');if(!el)return;const p=typeof G!=='undefined'&&G.pend&&G.pend.includes('cfgBalanca');
  el.textContent=p?'⏳ enviando…':'✓ salvo na nuvem';if(p)setTimeout(avisoCfg,1500);}
/* legenda das cores do quadro "Fornecer/Carregar", com os valores ajustados */
function pintarCores(){const el=$('cfgT_cores');if(!el)return;const c=cfg();
  el.innerHTML=`<b>Cores na tela</b>
  <div><i style="background:#2e7d32"></i>Verde · falta mais de ${fmt(+c.amarelo)} kg</div>
  <div><i style="background:#f2b705"></i>Amarelo · faltam ${fmt(+c.amarelo)} kg ou menos (apito lento)</div>
  <div><i style="background:#c62828"></i>Vermelho · faltam ${fmt(+c.vermelho)} kg ou menos (apito rápido)</div>
  <div><i class="pisca" style="background:#c62828"></i>Vermelho piscando · faltam ${fmt(+c.continuo)} kg ou menos (apito direto)</div>
  <div><i class="pisca2" style="background:#6a1b9a"></i>Roxo piscando · passou do previsto (negativo), apito bem rápido</div>`;}
function preencherCfgT(){if(!$('cfgT_tol'))return;const c=cfg();pintarCores();
  CAMPOS.forEach(([k])=>{const el=$('cfgT_'+k);if(document.activeElement!==el)el.value=c[k];});
  if(document.activeElement!==$('cfgT_ws'))$('cfgT_ws').value=c.ws;if(document.activeElement!==$('cfgT_ble'))$('cfgT_ble').value=c.bleUuid||'';if(document.activeElement!==$('cfgT_cmd'))$('cfgT_cmd').value=c.bleCmd||'';$('cfgT_som').checked=!!c.som;}
window.cfgTAoAbrir=()=>{montarCfgT();preencherCfgT();avisoCfg();
  try{if(typeof gSync==='function')gSync(true).then(()=>{if(!cfgNuvem())salvarCfg();preencherCfgT();avisoCfg();}).catch(()=>{});}catch(e){}};
/* puxa da nuvem ao abrir a Automação também, para pegar ajustes feitos em outro aparelho */
setInterval(()=>{const b=$('cfgTBox');if(b&&b.offsetParent)preencherCfgT();},3000);
})();

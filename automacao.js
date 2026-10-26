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
const CFG_PADRAO={bleUuid:'',bleCmd:'',tol:10,tempo:4,minDesc:30,amarelo:100,vermelho:50,continuo:20,antecipa:1,ws:'ws://10.10.100.254:6432',som:true,holdAuto:1,tagOn:1,filtro:3,enq:1,prever:1,fornInst:1,passo:5};
/* Ajustes da balança: ficam na nuvem (item 'cfgBalanca' da Gestão), então mudar num aparelho muda em todos */
function cfgNuvem(){try{return (typeof G!=='undefined'&&G.it&&G.it.cfgBalanca)||null;}catch(e){return null;}}
function cfg(){if(!S.auto)S.auto={};
  const n=cfgNuvem();if(n&&!n.del&&n.v&&(n.ts||0)>(S.auto._ts||0)){Object.assign(S.auto,n.v);S.auto._ts=n.ts;}
  for(const k in CFG_PADRAO)if(S.auto[k]==null)S.auto[k]=CFG_PADRAO[k];if(!(+S.auto.tempo>=2))S.auto.tempo=2;return S.auto;}
function salvarCfg(){const c=cfg(),v={};for(const k in CFG_PADRAO)v[k]=c[k];
  try{if(typeof gPut==='function'){gPut({uid:'cfgBalanca',tipo:'cfgBalanca',v});c._ts=G.it.cfgBalanca.ts;}}catch(e){}
  save();}

/* não atualiza o app sozinho enquanto a balança está conectada ou descarregando */
window.autoOcupado=()=>!!A.fonte||A.est==='descarregando';window.autoDescarregando=()=>A.est==='descarregando'&&!A.pausa;

/* ---------------- Tela ---------------- */
const css=`
:is(#aBox,#acBox,#aoVivo) .curhead.balHead{flex-wrap:nowrap;justify-content:flex-start;gap:8px}
:is(#aBox,#acBox,#aoVivo) .curhead.balHead h2{margin:0;min-width:0}
:is(#aBox,#acBox,#aoVivo) .curhead .balTog{flex:none;padding:4px 10px;font-size:.95rem}
:is(#aBox,#acBox,#aoVivo) .aStatus{display:none!important}
:is(#aBox,#acBox,#aoVivo) .aSinal.desc{display:none!important}
:is(#aBox,#acBox,#aoVivo) .curhead .balMini{margin-left:auto;font-size:.82rem;font-weight:700;white-space:nowrap}
:is(#aBox,#acBox,#aoVivo) .curhead .balMini.ruim{color:#c62828}
:is(#aBox,#acBox,#aoVivo) section.balRec :is(.aStatus,.aConn,.aSinal,.aTeclas,.aSim,.btAutoLin){display:none!important}
:is(#aBox,#acBox,#aoVivo) .aTeclas{display:none!important}
.fCols,.fColE,.fColD{display:contents}
/* tablet deitado: duas colunas (curral/trato à esquerda, o número grande e os botões à direita) e topo mais baixo */
/* computador (mouse): uma coluna só, centralizada, igual ao tablet em pé */
@media (hover:hover) and (pointer:fine) and (min-width:1000px){:is(#aBox,#acBox){max-width:880px;margin-left:auto;margin-right:auto}}
@media (orientation:landscape) and (min-width:760px) and (max-height:1000px) and (pointer:coarse){
  .topo{padding-top:4px!important;padding-bottom:4px!important}
  .topo img.topoLogo{height:30px!important}
  .wrap{max-width:1180px;padding-top:8px;gap:10px}
  :is(#aBox,#acBox) .fColD button{display:block;width:100%}
  #aBox .fColD #aReg{padding:12px}
  :is(#aBox,#acBox) section.balRec{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:0 16px;align-items:center;padding-top:8px;padding-bottom:8px}
  :is(#aBox,#acBox) section.balRec .balHead{margin:0}
  :is(#aBox,#acBox) section.balRec .aPeso{margin:0;padding-top:6px;padding-bottom:6px}
  :is(#aBox,#acBox) .fCols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:0 16px;align-items:start}
  :is(#aBox,#acBox) :is(.fColE,.fColD){display:block;min-width:0}
  :is(#aBox,#acBox) :is(.fColE,.fColD)>*+*{margin-top:8px}
  :is(#aBox,#acBox) .fColD .aFalta b{font-size:7.5rem}
  #aBox .fColD button.fFinal{margin-top:14px!important}
}
:is(#aBox,#acBox,#aoVivo) .aConn.comTag{grid-template-columns:3fr 2fr 1.3fr}
:is(#aBox,#acBox,#aoVivo) .aTagBt{font-weight:700}
#aBox .tagFim{display:flex;justify-content:center;margin:4px 0 12px}#aBox .tagFim .aTagBt{width:auto!important;min-height:0!important;padding:5px 22px!important;font-size:.9rem!important;border-radius:999px!important}
:is(#aBox,#acBox,#aoVivo) .aTagBt.tgOk{background:#2e7d32!important;border-color:#2e7d32!important;color:#fff!important}
:is(#aBox,#acBox,#aoVivo) .aTagBt.tgErr{background:#fff4d6!important;border-color:#f2b705!important;color:#7a5a00!important}
:is(#aBox,#acBox,#aoVivo) .aConn{display:grid;grid-template-columns:3fr 2fr;gap:6px}
:is(#aBox,#acBox,#aoVivo) .aConn .aDescBt{border-color:var(--bad);color:var(--bad)}
:is(#aBox,#acBox,#aoVivo) .aConn .aDescBt:disabled{opacity:.35}
:is(#aBox,#acBox) .aConn button.btVerm{background:#d32f2f!important;border-color:#d32f2f!important;color:#fff!important;font-weight:800;font-size:1.08rem}
:is(#aBox,#acBox) .aConn button.btVerde{background:#2e7d32!important;border-color:#2e7d32!important;color:#fff!important;font-weight:800}
:is(#aBox,#acBox) .aConn .aDescBt.btDescOn{background:#d32f2f!important;border-color:#d32f2f!important;color:#fff!important;font-weight:700}
:is(#aBox,#acBox,#aoVivo) .aSinal{margin-top:6px;border-radius:10px;padding:8px 10px;font-weight:700;font-size:.95rem;text-align:center;background:#e9ecef;color:#495057}
:is(#aBox,#acBox,#aoVivo) .aSinal.ok{background:#e3f5e1;color:#1b5e20}
:is(#aBox,#acBox,#aoVivo) .aSinal.ok i{display:inline-block;width:10px;height:10px;border-radius:50%;background:#2e7d32;margin-right:6px;animation:aPulsa 1.2s infinite}
:is(#aBox,#acBox,#aoVivo) .aSinal.ruim{background:#c62828;color:#fff;animation:aPisca .8s steps(2) infinite}
@keyframes aPulsa{50%{opacity:.25}}
:is(#aBox,#acBox,#aoVivo) .aConn button{padding:14px 6px;font-size:1rem}
:is(#aBox,#acBox,#aoVivo) .aConn button.on{background:var(--lima);border-color:var(--lima);color:var(--fg);font-weight:700}
:is(#aBox,#acBox,#aoVivo) .aStatus{display:flex;align-items:center;gap:8px;font-size:.9rem;color:var(--muted)}
:is(#aBox,#acBox,#aoVivo) .aStatus i{width:12px;height:12px;border-radius:50%;background:#b8c0c8;display:inline-block;flex:none}
:is(#aBox,#acBox,#aoVivo) .aStatus.ok i{background:#4caf50}:is(#aBox,#acBox,#aoVivo) .aStatus.err i{background:var(--bad)}:is(#aBox,#acBox,#aoVivo) .aStatus.wait i{background:var(--warn)}
:is(#aBox,#acBox,#aoVivo) .aPeso{background:var(--led-bg);border-radius:12px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px}
:is(#aBox,#acBox,#aoVivo) .aFalta{border-radius:16px;padding:10px 14px 12px;text-align:center;color:#fff;background:#2e7d32;transition:background .2s}
:is(#aBox,#acBox,#aoVivo) .aFalta small{display:block;font-size:.85rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;opacity:.9}
#aoVivo .aFalta b{font-size:4.6rem!important}
:is(#aBox,#acBox,#aoVivo) .aFalta b{display:block;font-family:var(--display);font-stretch:condensed;font-weight:700;font-size:6.2rem;line-height:1;font-variant-numeric:tabular-nums}
:is(#aBox,#acBox,#aoVivo) .aFalta em{display:block;font-style:normal;font-size:.9rem;font-weight:600;opacity:.95}
:is(#aBox,#acBox,#aoVivo) .aFalta.amarelo{background:#f2b705;color:#11253d}
:is(#aBox,#acBox,#aoVivo) .aFalta.vermelho{background:#c62828}
:is(#aBox,#acBox,#aoVivo) .aFalta.continuo{background:#c62828;animation:aPisca .5s steps(2) infinite}
:is(#aBox,#acBox,#aoVivo) .aFalta.cinza{background:#7c8794}
#aBox .aChkGeo{display:flex;align-items:center;gap:8px;font-weight:600;margin:4px 0 8px}#aBox .aChkGeo input{width:22px;height:22px}
#aBox #aFaltaBox,#acBox #acFaltaBox{position:relative}
#aBox .aPausaBt{position:absolute;top:8px;right:8px;padding:6px 10px;font-size:.9rem;width:auto!important;margin:0!important;display:block;background:#fff;color:#11253d;border:2px solid rgba(0,0,0,.15);border-radius:10px;font-weight:700;z-index:2}
#aBox .aPausaBt[hidden]{display:none}
#acBox .aPausaBt{position:absolute;top:8px;right:8px;padding:6px 10px;font-size:.9rem;width:auto!important;margin:0!important;display:block;background:#fff;color:#11253d;border:2px solid rgba(0,0,0,.15);border-radius:10px;font-weight:700;z-index:2}#acBox .aPausaBt[hidden]{display:none}
#acBox #acPausaBox span{white-space:normal;font-size:1.05rem;font-weight:600;opacity:.95}
#acBox .aPausaBox{box-sizing:border-box;width:100%;border-radius:18px;padding:30px 16px;text-align:center;background:#1565c0;color:#fff;display:grid;gap:8px;cursor:pointer;min-height:260px;align-content:center;border:4px solid #0d47a1}#acBox .aPausaBox[hidden]{display:none}#acBox .aPausaBox b{font-family:var(--display);font-stretch:condensed;font-size:clamp(2.4rem,11vw,4rem);line-height:1;letter-spacing:.04em}#acBox .aPausaBox .pzCur{font-family:var(--display);font-stretch:condensed;font-size:clamp(2.2rem,10vw,4.2rem);line-height:1.05;font-weight:800}#acBox .aPausaBox em{display:block;font-style:normal;font-weight:800;font-size:1.3rem;background:#fff;color:#0d47a1;border-radius:12px;padding:12px;margin-top:8px}
#aBox .aPausaBox{box-sizing:border-box;width:100%;max-width:100%;min-width:0;overflow:hidden;border-radius:18px;padding:34px 16px;text-align:center;background:#1565c0;color:#fff;display:grid;gap:8px;cursor:pointer;min-height:300px;align-content:center;border:4px solid #0d47a1}
#aBox .aPausaBox[hidden]{display:none}
/* o texto do quadro azul sempre cabe: tamanho pela largura do próprio quadro, sem quebrar e sem passar da borda */
#aBox .aPausaBox,#acBox .aPausaBox{container-type:inline-size;min-width:0;max-width:100%;overflow:hidden}
#aBox .aPausaBox>*,#acBox .aPausaBox>*{min-width:0;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:clip}
#aBox .aPausaBox span,#aBox .aPausaBox em,#acBox .aPausaBox em{white-space:normal}
#aBox .aPausaBox b{font-family:var(--display);font-stretch:condensed;font-size:clamp(2.6rem,13vw,4.4rem);line-height:1;letter-spacing:.04em}
#aBox .aPausaBox span{font-size:1.05rem;font-weight:600;opacity:.95}
#aBox .aPausaBox .pzCur{font-family:var(--display);font-stretch:condensed;font-size:clamp(3.4rem,18vw,6.2rem);line-height:1;font-weight:800}
#aBox .aPausaBox b,#acBox .aPausaBox b{font-size:clamp(1.6rem,11cqi,4.4rem)}#aBox .aPausaBox .pzCur,#acBox .aPausaBox .pzCur{font-size:clamp(1.6rem,15cqi,6.2rem)}
#aBox .aPausaBox em{display:block;font-style:normal;font-weight:800;font-size:1.3rem;background:#fff;color:#0d47a1;border-radius:12px;padding:12px;margin-top:8px}
:is(#aBox,#acBox,#aoVivo) .aEtapa.pausa{background:#e3f0ff;color:#0d47a1}
#cfgTBox .aCores{margin:10px 0 4px;padding:10px;border:1px solid var(--line);border-radius:10px;display:grid;gap:6px;font-size:.88rem}
#cfgTBox .aCores i{display:inline-block;width:22px;height:16px;border-radius:4px;margin-right:8px;vertical-align:-3px}
#cfgTBox .aCores i.pisca{animation:aPisca .5s steps(2) infinite}#cfgTBox .aCores i.pisca2{animation:aPisca2 .4s steps(2) infinite}
:is(#aBox,#acBox,#aoVivo) .aFalta.passou{background:#000;color:#fff;animation:aPisca2 .4s steps(2) infinite}
@keyframes aPisca2{50%{background:#3a3a3a}}
@keyframes aPisca{50%{background:#7f0000}}
:is(#aBox,#acBox,#aoVivo) .aMini{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
:is(#aBox,#acBox,#aoVivo) .aMini div{background:var(--chip);border-radius:10px;padding:6px 8px}
:is(#aBox,#acBox,#aoVivo) .aMini small{display:block;font-size:.66rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
:is(#aBox,#acBox,#aoVivo) .aMini b{font-family:var(--display);font-stretch:condensed;font-size:1.5rem;line-height:1.1}
:is(#aBox,#acBox,#aoVivo) .aMini div.caiu{background:#e5f4e3}:is(#aBox,#acBox,#aoVivo) .aMini div.caiu b{font-size:1.9rem;color:var(--ok)}
:is(#aBox,#acBox,#aoVivo) .aPeso small{display:block;color:#c9d3df;font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;text-align:left}
:is(#aBox,#acBox,#aoVivo) .aPeso b{font-family:var(--display);font-stretch:condensed;font-weight:700;color:var(--led);font-size:2.2rem;line-height:1;font-variant-numeric:tabular-nums}
:is(#aBox,#acBox,#aoVivo) .aPeso em{font-style:normal;font-size:.85rem;color:#c9d3df}
:is(#aBox,#acBox,#aoVivo) .aPeso em.est{color:#8be08f}
:is(#aBox,#acBox,#aoVivo) .aPeso em.atraso{color:#ff8a80;font-weight:700}
:is(#aBox,#acBox,#aoVivo) .aBarra{height:18px;border-radius:99px;background:var(--chip);overflow:hidden;border:1px solid var(--line)}
:is(#aBox,#acBox,#aoVivo) .aBarra div{height:100%;width:0;background:var(--lima);transition:width .3s}
:is(#aBox,#acBox,#aoVivo) .aBarra div.passou{background:var(--bad)}
:is(#aBox,#acBox,#aoVivo) .aConecte{margin-top:10px;text-align:center;font-weight:800;font-size:1.25rem;letter-spacing:.02em;padding:14px 10px;border-radius:12px;background:#d32f2f;color:#fff}.aConecte[hidden]{display:none!important}
.aEtapa{text-align:center;font-weight:700;padding:6px;border-radius:10px;background:var(--chip);font-size:.92rem}
:is(#aBox,#acBox,#aoVivo) .aEtapa.desc{background:#fff4d6;color:var(--warn)}
:is(#aBox,#acBox,#aoVivo) .aEtapa.pronto{background:#e5f4e3;color:var(--ok)}
:is(#aBox,#acBox,#cfgTBox) .aBruto{font-family:ui-monospace,Menlo,monospace;font-size:.75rem;background:#0f1d2e;color:#cfe;padding:8px;border-radius:8px;max-height:150px;overflow:auto;white-space:pre-wrap;word-break:break-all}
:is(#aBox,#acBox,#aoVivo) .aCfg{display:grid;grid-template-columns:1fr 1fr;gap:8px}
:is(#aBox,#acBox,#aoVivo) .aCfg label{font-size:.8rem;margin:0}
:is(#aBox,#acBox,#aoVivo) .aCfg input{width:100%}
:is(#aBox,#acBox,#aoVivo) .aSim{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
:is(#aBox,#acBox,#aoVivo) .aTeclas{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:6px}
:is(#aBox,#acBox,#aoVivo) .aTeclas button{padding:9px 2px;font-size:.84rem;line-height:1.15}
:is(#aBox,#acBox,#aoVivo) .aSim button{padding:9px 4px;font-size:.88rem}
:is(#aBox,#acBox,#aoVivo) details summary{cursor:pointer;font-weight:600;padding:4px 0}
:is(#aBox,#acBox,#aoVivo) .aChk{display:flex;align-items:center;gap:8px;font-size:.95rem}
:is(#aBox,#acBox,#aoVivo) .aChk input{width:22px;height:22px}
`;
/* o estilo entra já ao abrir (o Visualizar usa o mesmo visual no Ao vivo) */
{const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);}
function montar(){
  if($('aBox').dataset.ok)return;$('aBox').dataset.ok='1';
  $('aBox').innerHTML=`
  <div id="fRemA" hidden></div>
  <section class="panel">
    <div class="curhead balHead"><button type="button" class="mini balTog" data-baltog="1" aria-label="Mostrar ou esconder a conexão">▲</button><h2>Balança</h2><span class="note" id="aData" hidden></span><span class="balMini" id="aBalMini"></span></div>
    <div class="aStatus" id="aStatus"><i></i><span id="aStatusTxt">Desconectado</span></div>
    <div class="aConn">
      <button id="aBtSer" hidden>🔵 Bluetooth</button>
      <button id="aBtBt">Conectar a balança</button>
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
    <div class="fCols"><div class="fColE">
    <div class="tSeta tSetaFixa"><button type="button" data-tsd="-1" aria-label="Trato anterior">◀</button><select class="trato" id="aTrato">
        ${window.opcoesTrato?opcoesTrato(S.tratoSel):'<option value="1">Trato 1</option>'}
      </select><button type="button" data-tsd="1" aria-label="Próximo trato">▶</button></div>
    <div class="curBox2">
      <div class="cbCur" id="aTrocar" role="button" aria-label="Trocar curral"><span>Curral atual <i class="seta">▼</i></span><b id="aCur">—</b></div>
      <div class="cbPrev"><span>Previsto</span><b class="num" id="aPrev">—</b></div>
    </div>
    <div class="escolha" id="aEscolha" hidden></div>
    <div class="tagAviso" data-tagaviso hidden></div><div class="tagBar" data-tagbar hidden></div>
    <div class="aEtapa" id="aEtapa">Conecte a balança</div>
    <div class="aPausaBox" id="aPausaBox" hidden role="button" tabindex="0"><b>⏸ PAUSADO</b><span>No trajeto: a balança não está contando nada.</span><em>▶ Toque aqui para continuar</em></div>
    </div><div class="fColD">
    <div class="aFalta" id="aFaltaBox"><button type="button" class="aPausaBt" id="aPausar">⏸ Pausar (trajeto)</button><small id="aFaltaTit">Fornecer</small><b class="num" id="aFalta">—</b><em id="aFaltaTxt">&nbsp;</em></div>
    <div class="aMini">
      <div class="caiu"><small>Fornecido</small><b class="num" id="aCaiu">—</b></div>
      <div><small>Peso inicial</small><b class="num" id="aIni">—</b></div>
      <div><small>Parar com</small><b class="num" id="aAlvo">—</b></div>
    </div>
    <button class="primary" id="aReg" disabled>Registrar trato</button>
    </div></div>
    <button id="aTestarSom" hidden>🔊 Testar apito (amarelo, vermelho e direto)</button>
    <button id="aRecomecar" hidden>↺ Pegar peso inicial</button><button id="aPular">Pular curral ▶</button>
    <button class="naoForn" id="aNaoForn" type="button">🚫 Não fornecer neste curral</button>
    <button class="fFinal" data-ffinal="1" type="button">⚠ Finalizar fornecimento</button>
  </section>

  <section class="panel">
    <div class="curhead"><h2 id="aTit">Currais</h2><span class="note num" id="aTot"></span></div>
    <div class="tablebox"><table class="trat">
      <thead><tr><th class="hora">Hora</th><th>Curral</th><th>Previsto</th><th>Realiz.</th><th>Dif.</th></tr></thead>
      <tbody id="aTb"></tbody>
    </table></div>
    <button id="aDesfazer">Desfazer último</button>
    <div class="fCancFim" id="fCancA" hidden><button class="danger fCancForn" data-fcancforn="1" type="button">✕ Cancelar fornecimento</button></div>
  </section>
  <section class="panel abrirNovo" id="fNovoA" hidden></section>
  <div class="tagFim"><button type="button" class="aTagBt" data-tagbt hidden title="Leitor de tag">🏷 Tag</button></div>

  <section class="panel" hidden>
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
  /* peso final = balança EXATA no toque em "Registrar trato" (tomada de força desligada); o que variar depois, até confirmar, não conta */
  $('aReg').onclick=async()=>{const cur=curralAtual();const fimT=pesoVisor();A.fimToque=fimT!=null?{v:fimT,ts:Date.now(),cur:cur?cur.nome:null}:null;
    if(cur&&window.perg){const kg=A.base!=null&&fimT!=null?Math.max(0,A.base-fimT):null;
    if(!await perg(`Confirmar trato do ${cur.nome}?`,`${fimT!=null?'Balança: início '+fmt(A.base)+' → final '+fmt(fimT)+' kg · ':''}${kg!=null?'fornecido '+fmt(kg)+' kg · ':''}previsto ${fmt(cur.prev)} kg`,'✓ Confirmar trato','Voltar',true)){A.fimToque=null;return;}}registrarAuto();};
  $('aNaoForn').onclick=()=>{if(A.est==='descarregando'){toast('Está fornecendo neste curral: registre o trato.');return;}if(window.naoFornecer)naoFornecer();};
  $('aRecomecar').onclick=()=>{if(A.peso==null){toast('Sem leitura da balança');return;}novoCurral(true,true);A.pausa=null;aRender();toast('Peso inicial: '+fmt(A.base)+' kg');};
  $('aPular').onclick=async()=>{const L0=lista(),c0=L0[S.atual];if(c0&&window.perg&&!await perg(`Deseja realmente pular o ${c0.nome}?`,'Ele fica para depois (continua sem fornecer) e passa para o próximo curral.','Sim, pular','Não, voltar'))return;const L=lista(),regs=regsAtuais();let nx=L.findIndex((x,i)=>i>S.atual&&!feito(x.nome,regs));if(nx<0)nx=Math.min(S.atual+1,L.length);
    setAtual(nx);save();novoCurral(true);render();aRender();};
  $('aDesfazer').onclick=async()=>{try{await $('btnDesfazer').onclick();}catch(e){}aRender();};
  $('aTestarSom').onclick=testarSom;
  if(!window._acTravaL){window._acTravaL=1;document.addEventListener('click',e=>{if(!e.target.closest||bloqueado())return;if(e.target.closest('#acTravaBox'))acLiberar();else if(e.target.closest('#acPausar'))acPausar();else if(e.target.closest('#acPausaBox'))acContinuarPausa();});}
  $('aPausar').onclick=()=>{if(!bloqueado())aPausar();};$('aPausaBox').onclick=()=>{if(!bloqueado())aContinuarPausa();};
  $('aCopiarBruto').onclick=()=>copiar(A.bruto.join('\n')+'\n\n'+($('aBtInfo').textContent||''),'Dados copiados');
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&A.fonte)pedirTelaLigada();});
}

/* ---------------- Conexões ---------------- */
/* botão da balança: vermelho "Conectar a balança" enquanto desconectada; verde "✓ Balança conectada" quando conecta (e o Desconectar fica vermelho) */
function pintarBtBal(){try{pintarBtAuto();}catch(e){}[['aBtBt','aDesc'],['acBtBt','acDesc']].forEach(([b,d])=>{const bt=$(b),ds=$(d);if(!bt)return;const on=!!A.fonte;
  bt.classList.toggle('btVerm',!on);bt.classList.toggle('btVerde',on);bt.textContent=on?'✓ Balança conectada':'Conectar a balança';if(ds)ds.classList.toggle('btDescOn',on);});}
function setStatus(t,tipo){A.status=t;A.statusTipo=tipo||'';pintarBtBal();const el=$('aStatus');if(el){$('aStatusTxt').textContent=t;el.className='aStatus '+(tipo||'');}acSyncTopo();}
function marcarFonte(){['aBtSer','aBtBt','aBtWs','aBtSim'].forEach(id=>$(id).classList.remove('on'));
  const m={ser:'aBtSer',bt:'aBtBt',ws:'aBtWs',sim:'aBtSim'}[A.fonte];if(m)$(m).classList.add('on');
  pintarBtBal();$('aDesc').disabled=!A.fonte;$('aSimBox').hidden=A.fonte!=='sim';$('aTeclas').hidden=!(A.fonte==='bt'&&A.digiStar);acSyncTopo();}
/* Desconectar pede confirmação (para não desligar a balança no meio do trato sem querer) */
async function perguntarDesconectar(){if(!A.fonte)return false;
  const ok=window.confirmaVermelho?await confirmaVermelho('Desconectar a balança?',`O app para de receber o peso.${A.est==='descarregando'?' Você está FORNECENDO agora: o curral não será acompanhado.':''} Para voltar, toque em Conectar a balança.`,'Sim, desconectar','Não, manter conectada'):confirm('Desconectar a balança?');
  if(!ok)return false;desconectar(true);return true;}
/* sinal da balança ao lado dos botões: recebendo peso, conectada mas sem peso (perigo), ou desconectada */
function pintarSinal(){const segs=A.ultDado?(Date.now()-A.ultDado)/1000:null;let t,cl='';
  if(!A.fonte){t='⚪ Balança desconectada · toque em Conectar antes de tratar';cl='desc';}
  else if(A.btReconectando){t='🔄 Reconectando a balança… não forneça agora';cl='ruim';}
  else if(segs==null||segs>3){t=segs==null?'⏳ Conectada, esperando o primeiro peso…':`⚠ SEM PESO há ${Math.round(segs)} s · não forneça agora`;cl=segs==null&&Date.now()-(A.tCon||0)<6000?'':'ruim';}
  else{t=`<i></i>Recebendo peso`;cl='ok';}
  ['aSinal','acSinal'].forEach(id=>{const e=$(id);if(!e)return;if(e.innerHTML!==t)e.innerHTML=t;e.className='aSinal '+cl;});
  /* depois de conectar e o peso chegar, recolhe a parte da conexão (fica só a bolinha no título; a setinha abre de novo) */
  if(cl!==A.sinalAnt){if(cl==='ok')A.balRec=true;else if(cl==='ruim'||(cl==='desc'&&A.sinalAnt))A.balRec=false;A.sinalAnt=cl;} // conectou: recolhe; parou o peso ou caiu: abre; fora isso, vale a setinha
  const mini=!A.fonte?(A.statusTipo==='wait'?'🟡 conectando…':A.statusTipo==='err'?'🔴 erro ao conectar':'🔴 desconectada'):cl==='ok'?'🟢 conectada':cl==='ruim'?'🔴 sem peso':'🟡 esperando peso';
  ['aBalMini','acBalMini'].forEach(id=>{const e=$(id);if(!e)return;if(e.textContent!==mini)e.textContent=mini;e.className='balMini '+(cl==='ruim'?'ruim':'');});
  aplicarBalRec();}
window.recolherBal=()=>{A.balRec=true;aplicarBalRec();};
function aplicarBalRec(){[['aBox',$('aBox')&&$('aBox').querySelector(':scope>section')],['acBox',$('acBox')&&$('acBox').querySelector(':scope>section')]].forEach(([_,sec])=>{if(!sec)return;
  sec.classList.toggle('balRec',!!A.balRec);const b=sec.querySelector('.balTog');if(b)b.textContent=A.balRec?'▼':'▲';});}
document.addEventListener('click',e=>{if(!e.target.closest('[data-baltog]'))return;A.balRec=!A.balRec;aplicarBalRec();});
setInterval(pintarSinal,700);
function desconectar(manual){if(manual){A.btGen=(A.btGen||0)+1;A.btReconectando=false;}
  try{if(A.holdApp&&A.digiStar&&A.dsEsc){A.dsEsc.writeValue(new Uint8Array([0x1b,0x47,0x68,0x44,0x04])).catch(()=>{});holdGrava(false);}}catch(e){}   // vai desconectar: solta o HOLD antes
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
async function conectarBt(soBalanca){
  if(!navigator.bluetooth){toast('Este celular/navegador não tem Bluetooth BLE para apps. Use o Chrome no Android.');setStatus('Bluetooth indisponível neste navegador','err');return;}
  desconectar(false);A.btGen=(A.btGen||0)+1;A.btReconectando=false;   // conexão nova: tentativa antiga que ficou pendurada não mexe mais
  try{
    setStatus('Escolha a balança na lista…','wait');
    let dev;if(soBalanca){try{dev=await navigator.bluetooth.requestDevice({filters:[{namePrefix:'NEW EZ'},{namePrefix:'NEW'},{namePrefix:'EZ'},{namePrefix:'DIGI'}],optionalServices:servicosBle()});}catch(x){if(x&&x.name==='NotFoundError')throw x;dev=null;}}
    if(!dev)dev=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:servicosBle()});
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
async function reconectarBt(motivo){const dev=A.bt;if(!dev||A.btReconectando)return;A.btReconectando=true;let n=0;const gen=A.btGen||0;
  try{while(A.bt===dev&&A.fonte==='bt'&&(A.btGen||0)===gen){n++;setStatus(`${motivo} · reconectando${n>1?' (tentativa '+n+')':''}…`,'wait');bruto(motivo+': reconectando (tentativa '+n+')');if(n===1)diagLog('reconectando',{motivo});
      try{dev._manual=true;if(dev.gatt.connected)dev.gatt.disconnect();}catch(e){}dev._manual=false;
      await new Promise(r=>setTimeout(r,n===1?700:3000));if(A.bt!==dev||(A.btGen||0)!==gen)break;
      try{await btAbrir(dev);A.ultDado=Date.now();A.btCutucou=0;toast('Balança reconectada');diagLog('reconectou',{tentativas:n});break;}catch(e){bruto('não reconectou: '+(e.message||e));}}}
  finally{if((A.btGen||0)===gen)A.btReconectando=false;}}
/* vigia: a balança Digi-Star manda o peso o tempo todo (umas 2 vezes por segundo). Se parar 2,5 s,
   chama de novo (05); se chegar a 5 s sem peso, reconecta sozinho — mesmo que pareça "conectado". */
setInterval(()=>{if(A.fonte!=='bt'||!A.bt||!A.digiStar||A.btReconectando)return;
  const parado=Date.now()-Math.max(A.ultDado||0,A.tCon||0);
  if(parado>2500&&!A.btCutucou&&A.dsEsc){A.btCutucou=Date.now();bruto('sem peso há 2,5 s: chamando a balança de novo');diagLog('sem_peso',{});A.dsEsc.writeValue(new Uint8Array([5])).catch(()=>{});}
  if(parado>5000)reconectarBt('Balança parou de mandar o peso');},1000);
/* ao abrir o app de novo (ou depois de atualizar), tenta voltar sozinho para a última balança, se o Chrome deixar */
/* ao entrar na Automação (Carregar ou Fornecer): tenta conectar sozinho na balança já usada neste aparelho (NEW EZ),
   sem abrir a lista do Bluetooth. Se não der, fica como está: botão Conectar a balança. */
/* "Conectar a balança sozinho" (ligado de fábrica, por aparelho):
   1) se o Chrome deixa (getDevices), conecta sem perguntar;
   2) se não deixa, o primeiro toque em qualquer lugar da tela já abre a lista só com a balança (NEW EZ) — é só tocar nela;
   3) caiu: fica reconectando sozinho. */
/* desligado (22/10): no tablet não funcionava bem e ficava em "conectando…"; a pessoa conecta no botão. Se a conexão cair, continua tentando voltar sozinho (reconectarBt). */
const btAutoOn=()=>false;
function pintarBtAuto(){document.querySelectorAll('[data-btauto]').forEach(i=>{i.checked=btAutoOn();});}
function armarToque(){if(!btAutoOn()||A.fonte||A.toqueArmado||!navigator.bluetooth)return;A.toqueArmado=true;
  setStatus('Toque em qualquer lugar da tela para conectar a balança','wait');
  const h=ev=>{if(ev.target.closest&&ev.target.closest('#aBtBt,#acBtBt,[data-btauto],.btAutoLin,#aDesc,#acDesc,[data-tagbt]'))return;   // botão de conectar/desconectar: deixa ele mesmo resolver
    document.removeEventListener('click',h,true);A.toqueArmado=false;if(A.fonte||!btAutoOn())return;
    const tela=(!$('viewAuto').hidden)||naCargaAuto();if(tela)conectarBt(true);};
  document.addEventListener('click',h,true);}
document.addEventListener('change',e=>{const c=e.target.closest('[data-btauto]');if(!c)return;try{localStorage.setItem('btAuto',c.checked?'1':'0');}catch(x){}pintarBtAuto();
  if(c.checked){toast('Vai conectar a balança sozinho');if(!A.fonte)btAutoVoltar();}else toast('Conexão automática desligada');});
window.btAutoVoltar=async()=>{pintarBtAuto();if(A.fonte||A.autoTent||!navigator.bluetooth||!btAutoOn())return;
  if(!navigator.bluetooth.getDevices){armarToque();return;}A.autoTent=true;
  try{const id=localStorage.getItem('btUltimo'),devs=await navigator.bluetooth.getDevices();
    const dev=devs.find(d=>id&&d.id===id)||devs.find(d=>/NEW\s*EZ|DIGI|EZ\d/i.test(d.name||''));if(!dev){A.autoTent=false;armarToque();return;}if(A.fonte)return;
    A.bt=dev;A.fonte='bt';marcarFonte();ligarQueda(dev);setStatus('Voltando a conectar na balança…','wait');
    /* igual era antes: se não conectar de primeira, fica tentando sozinho até a balança aparecer (ou até tocar em Desconectar) */
    try{await btAbrir(dev);try{localStorage.setItem('btUltimo',dev.id||'');}catch(e){}}catch(e){reconectarBt('Conectando na balança');}}
  catch(e){}finally{A.autoTent=false;aRender();}};
async function btAbrir(dev){
  setStatus('Conectando em '+(dev.name||'aparelho')+'…','wait');
  const srv=await Promise.race([dev.gatt.connect(),new Promise((_,rej)=>setTimeout(()=>rej(new Error('a balança não respondeu')),12000))]);  // não fica preso para sempre
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
    const manda=async()=>{if(A.bt!==dev)return clearInterval(A.dsPoll);if(A.dsMandando)return;A.dsMandando=true;try{if(dsEsc.properties&&dsEsc.properties.writeWithoutResponse&&dsEsc.writeValueWithoutResponse)await dsEsc.writeValueWithoutResponse(enq);else await dsEsc.writeValue(enq);}catch(e){bruto('erro ao pedir peso: '+(e.message||e));}finally{A.dsMandando=false;}};
    await manda();const iv=Math.max(0.5,Math.min(5,+cfg().enq||1));A.dsPoll=setInterval(manda,iv*1000);info.push(`Digi-Star EZ: pedindo o peso (05) a cada ${String(iv).replace('.',',')} s`);$('aBtInfo').textContent=info.join('\n');A.btInfo=info.join('\n');marcarFonte();}
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
const TECLAS={'43':'Zero','40':'Tara','10':'Líquido/Bruto','23':'Imprimir','20':'Hold'};
async function teclaBalanca(cod){
  if(!(A.fonte==='bt'&&A.digiStar&&A.dsEsc)){toast('Conecte a balança pelo 🔷 Balança Bluetooth');return;}
  if((cod==='43'||cod==='40')&&!confirm(TECLAS[cod]+' na balança: o peso do visor vai para 0. Confirmar?'))return;
  A.dsSeq=(A.dsSeq%99)+1;const sq=String(A.dsSeq).padStart(2,'0'),txt=cod+sq;
  const b=new Uint8Array([0x1a,...Array.from(txt).map(c=>c.charCodeAt(0))]);
  try{await A.dsEsc.writeValue(b);bruto('tecla '+TECLAS[cod]+': '+hexDe(b));toast(TECLAS[cod]+' enviado à balança');}
  catch(e){toast('Não consegui mandar '+TECLAS[cod]+': '+(e.message||e));}
}
window.teclaBalanca=teclaBalanca;
/* HOLD automático (Digi-Star): com o fornecimento PAUSADO ou TRAVADO no tablet (trajeto até o próximo curral)
   a balança fica em HOLD; ao tocar em liberar/continuar, o HOLD sai. Assim o balanço dos buracos não muda o peso.
   holdAuto 1 = comando direto do manual EZII (ESC G h E = ligar, ESC G h D = soltar): não é liga/desliga, então VALE O TABLET.
     Enquanto estiver no Fornecer, o app repete o comando a cada 4 s: se alguém apertar HOLD na balança, o tablet corrige.
   holdAuto 2 = tecla HOLD ("20"), que liga e desliga com o mesmo toque (reserva, se a balança não aceitar o comando).
   holdAuto 0 = desligado. */
A.holdApp=(()=>{try{return localStorage.getItem('fjkHoldApp')==='1';}catch(e){return false;}})();
function holdGrava(v){A.holdApp=v;A.holdTs=Date.now();try{localStorage.setItem('fjkHoldApp',v?'1':'0');}catch(e){}}
let holdMandando=false;
async function holdSync(){if(holdMandando)return;
  if(!(A.fonte==='bt'&&A.digiStar&&A.dsEsc)){   // sem Bluetooth não dá para soltar: avisa o operador para soltar na mão
    if(A.holdApp&&!A.pausa&&Date.now()-(A.holdAvisoTs||0)>10000){A.holdAvisoTs=Date.now();toast('⚠ Balança sem Bluetooth e pode estar em HOLD: se o visor mostrar HOLD, aperte HOLD na balança para soltar');}
    return;}
  let modo=1,noForn=false,noCarr=false,carrAzul=false;try{modo=+cfg().holdAuto||0;noForn=!!(window.filtroForn&&filtroForn()&&!naCargaAuto());
    noCarr=!!(naCargaAuto()&&acB());const it=noCarr?acItem():null;carrAzul=noCarr&&!!(AC.pausa||(AC.trava&&it&&!ok(it.real)));}catch(e){}
  let fimPend=false;try{fimPend=noForn&&!curralAtual()&&lista().length>0;}catch(e){}   // registrou o último curral e ainda não finalizou o fornecimento: fica travada
  const quer=!!(modo&&((noForn&&(A.pausa||fimPend))||carrAzul));   // quadro azul na tela (Fornecer ou Carregar) = balança em HOLD
  const repetir=modo===1&&(noForn||noCarr)&&Date.now()-(A.holdTs||0)>4000;   // comando direto: reforça o estado do tablet
  if(quer===A.holdApp&&!repetir)return;
  if(!modo&&!A.holdApp)return;
  holdMandando=true;
  try{let b;if(modo===2||(!modo&&A.holdAppTecla)){A.dsSeq=(A.dsSeq%99)+1;const txt='20'+String(A.dsSeq).padStart(2,'0');b=new Uint8Array([0x1a,...Array.from(txt).map(c=>c.charCodeAt(0))]);}
    else b=new Uint8Array([0x1b,0x47,0x68,quer?0x45:0x44,0x04]);   // ESC G h E|D EOT
    await A.dsEsc.writeValue(b);const mudou=quer!==A.holdApp;A.holdAppTecla=modo===2;holdGrava(quer);
    if(mudou){bruto('HOLD '+(quer?'ligado':'solto')+' pelo tablet: '+hexDe(b));try{diagLog(quer?'hold_liga':'hold_solta',{modo,peso:A.peso,visor:A.visor,anunc:A.anunc});}catch(e){}}}
  catch(e){bruto('HOLD não foi: '+(e.message||e));}   // não mudou o estado: tenta de novo na próxima volta
  finally{holdMandando=false;}}
window.holdSync=holdSync;setInterval(holdSync,700);
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
      for(let i=0;i<u.length-2;i++){if(u[i]===0x1b&&u[i+1]===0x4f&&u[i+2]===0x61){const e=u.indexOf(4,i+3);if(e>i)A.anunc=hexDe(u.slice(i+3,e));}
        if(u[i]===0x1b&&u[i+1]===0x4f&&u[i+2]===0x6d){const a=u.indexOf(2,i+3),b=a>=0?u.indexOf(4,a+1):-1;
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
/* média sem os picos: tira 20% das leituras mais altas e 20% das mais baixas */
function mediaSemPicos(vs){const v=vs.slice().sort((x,y)=>x-y),k=Math.floor(v.length*0.2),m=v.slice(k,v.length-k);return rP(med(m.length?m:v));}
/* inclinação (kg/ms) à prova de pico: mediana das inclinações entre pares de leituras */
function tendencia(P){const sl=[];for(let i=0;i<P.length;i++)for(let k=i+1;k<P.length;k++){const dt=P[k].t-P[i].t;if(dt>300)sl.push((P[k].v-P[i].v)/dt);}
  sl.sort((x,y)=>x-y);return {b:sl.length?sl[Math.floor((sl.length-1)/2)]:0};}
/* peso para REGISTRAR: firme → o peso firme (média); ainda oscilando → média sem picos das leituras desde que parou de
   subir/descer (até 4 s). Se acabou de parar, espera ~1,5 s juntando leituras. Assim não depende do momento do toque. */
function pesoMedioDesde(desdeT){const ag=Date.now(),cr=(A.crus||[]).filter(q=>q.t>=Math.max(desdeT||0,ag-4000));return cr.length>=3?mediaSemPicos(cr.map(q=>q.v)):null;}
async function pesoParaRegistrar(desdeT){if(A.estavel&&A.valEst!=null)return A.valEst;
  if(Date.now()-(desdeT||0)<1500||pesoMedioDesde(desdeT)==null){toast('Tirando a média do peso…');await new Promise(r=>setTimeout(r,1600));if(A.estavel&&A.valEst!=null)return A.valEst;}
  const v=pesoMedioDesde(desdeT);return v!=null?v:A.peso;}
/* peso de referência quando a balança ainda não firmou: menor/maior dos últimos 3 s, ou a média se estiver sem subir nem descer */
function refProvisoria(sinal){const c=cfg(),agora=Date.now(),ss=(A.suaves||[]).filter(a=>a.t>=agora-3000);if(ss.length<4||A.amostras.length<4||agora-A.amostras[0].t<2500)return null;
  const vs=ss.map(a=>a.v),ext=sinal>0?Math.min(...vs):Math.max(...vs);
  if(sinal>0?A.suave>ext+c.minDesc:A.suave<ext-c.minDesc)return {v:rP(ext),mexendo:true};
  const k=Math.max(1,Math.floor(vs.length/3));if(Math.abs(med(vs.slice(-k))-med(vs.slice(0,k)))<=c.tol)return {v:rP(med(vs.slice(-k))),mexendo:false};
  return null;}
/* mostra se a leitura está chegando em dia: "ao vivo" ou "sem leitura há X s" (em vermelho) */
const atrasada=()=>!!(A.fonte&&A.ultDado&&Date.now()-A.ultDado>2000);
function idadeLeitura(){if(!A.fonte||!A.ultDado)return '';const s=(Date.now()-A.ultDado)/1000;return s<=2?'':` · ⚠ sem leitura há ${Math.round(s)} s`;}
setInterval(()=>{if(!atrasada())return;[['aEstTxt','aPeso'],['acEstTxt','acPeso']].forEach(([i,p])=>{const e=$(i);if(!e)return;
  e.textContent=(A.estavel?'● Estável':'○ Oscilando')+idadeLeitura();e.className='atraso';const b=$(p);if(b)b.style.opacity='.45';});},1000);
/* a balança do vagão anda de 5 em 5 kg: o app usa o mesmo passo em tudo (leitura, peso firme, médias e tela) */
function rP(v){if(v==null||isNaN(v))return v;const p=Math.max(1,+cfg().passo||5);return Math.round(v/p)*p;}
window.rP=rP;
function novoPeso(n){
  n=rP(n);const c=cfg(),agora=Date.now(),nCru=n;
  /* ajuste fino: mediana das últimas leituras (1 = sem filtro, 3 normal, 5 forte) — tira o "pula pra cima e pra baixo"
     de uma leitura isolada sem atrasar muito (a Digi-Star manda ~1,6 leitura por segundo) */
  A.brutos=(A.brutos||[]).concat(n).slice(-9);const kf=Math.max(1,Math.min(9,Math.round(+c.filtro||1)));
  /* mexendo (carregando ou fornecendo): usa a leitura crua, sem atraso; parado: mediana, que tira o pulo isolado */
  const mexendo=(typeof caindoAgora==='function'&&caindoAgora())||(typeof subindoAgora==='function'&&subindoAgora());
  if(kf>1&&A.brutos.length>1&&!mexendo){const u=A.brutos.slice(-kf).slice().sort((x,y)=>x-y);n=u[Math.floor((u.length-1)/2)];}
  ['aPeso','acPeso'].forEach(i=>{const b=$(i);if(b&&b.style.opacity)b.style.opacity='';});
  if(A.tUlt){const dt=agora-A.tUlt;if(dt>0&&dt<3000)A.dtMed=A.dtMed?A.dtMed*0.8+dt*0.2:dt;}A.tUlt=agora;
  A.peso=n;A.amostras.push({t:agora,v:n});A.crus=(A.crus||[]).filter(q=>q.t>=agora-12000);A.crus.push({t:agora,v:nCru});A.h45=(A.h45||[]).filter(q=>q.t>=agora-45000);A.h45.push({t:agora,v:nCru});
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
    A.estrito=A.estavel;   // parado de verdade (sem a regra da tomada de força): é o único que pode mexer no peso inicial
    A.valEst=A.estavel?rP(med(vs)):null;
    /* tomada de força girando: a balança nunca fica parada (oscila 50–150 kg), mas a MÉDIA não sobe nem desce.
       Firme pela tendência: reta das leituras cruas da janela quase sem inclinação (menos de ~10 kg na janela toda)
       → Estável, e o peso firme é a média sem os picos (tira 20% de cima e 20% de baixo). */
    if(!A.estavel){const j6=agora-Math.max(c.tempo*1000,5000),cr=A.crus.filter(q=>q.t>=j6);
      if(cr.length>=8&&cr[0].t<=j6+800&&Math.abs(tendencia(cr).b)*1000<=12){   // menos de 12 kg/s: não está carregando nem descarregando
        if(!A.firmeTdp)A.firmeT0=agora-3000;
        /* o peso mudou de patamar (ex.: colocou núcleo devagar): recomeça a média só com as leituras de agora */
        {const r2=A.crus.filter(q=>q.t>=agora-2000).map(q=>q.v).sort((x,y)=>x-y);if(A.firmeTdp&&A.vePrev!=null&&r2.length&&Math.abs(r2[Math.floor((r2.length-1)/2)]-A.vePrev)>Math.max(+c.tol||0,15))A.firmeT0=agora-2000;}
        A.estavel=true;A.firmeTdp=true;
        A.valEst=mediaSemPicos(A.crus.filter(q=>q.t>=Math.max(A.firmeT0,agora-10000)).map(q=>q.v));}   // quanto mais tempo firme, mais leituras na média (até 10 s)
      else A.firmeTdp=false;}
    else A.firmeTdp=false;
    A.vePrev=A.valEst;}
  else{A.estavel=false;A.valEst=null;A.firmeTdp=false;A.estrito=false;A.vePrev=null;}
  /* fornecendo: o "Fornecer" segue a RETA das leituras dos últimos 4 s (não cada leitura), então o balanço do vagão
     (pula 100 kg pra cima e pra baixo) não aparece e o número desce liso entre uma leitura e outra.
     Leitura muito fora da reta é descartada. Não trava: se a balança mostrar que caiu menos, o número volta (só ignora sobe de menos de 40 kg).
     Quando a balança firma, usa o peso firme de verdade (é ele que vai para o registro). */
  if(A.est==='descarregando'&&!naCargaAuto()){
    A.descPts=(A.descPts||[]).concat({t:agora,v:nCru}).filter(q=>q.t>=agora-4200);
    if(A.estavel&&A.valEst!=null){A.pesoDesc=A.valEst;A.descFit={v:A.valEst,b:0,t:agora};}
    else{const f=ajusteReta(A.descPts,agora);let v=f.v;
      if(A.descFit){const dt=Math.min(agora-A.descFit.t,3000),antes=A.descFit.v+A.descFit.b*Math.min(dt,(A.dtMed||500)*1.0);
        /* o vagão não descarrega mais rápido que ~2x a velocidade de agora (mín. 60 kg/s): queda maior que isso é balanço, não ração */
        const maxCai=Math.max(60,1.8*Math.abs(A.descFit.b)*1000)*dt/1000+10;
        if(v<antes-maxCai)v=antes-maxCai;else if(v>antes&&v-antes<40)v=antes;}
      A.pesoDesc=v;A.descFit={v,b:f.b,t:agora};}}
  else{A.pesoDesc=null;A.descFit=null;A.descPts=[];}
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
function novoCurral(manterPeso,semTravar){A.posPausa=false;A.baseFix=false;A.est='aguardando';A.ancV=null;A.ancT=0;A.fpMin=null;A.menor=null;A.base=manterPeso&&A.peso!=null?(A.estavel?A.valEst:A.peso):null;
  if(!semTravar)travarCurral();}
/* todo curral começa TRAVADO: quadro azul "▶ FORNECER C-x"; a balança só conta depois de tocar nele (no trajeto nada conta) */
/* peso da balança AGORA (mediana do último 1,5 s de leituras: tira um pico solto, sem o atraso da média do "Estável") */
/* leitura EXATA da balança agora: o último número que chegou do indicador (o mesmo do visor do vagão) */
function pesoVisor(){const c=A.crus||[];return rP(c.length?c[c.length-1].v:A.peso);}
function pesoAgora(){const t=Date.now(),v=(A.crus||[]).filter(q=>q.t>=t-1500).map(q=>q.v).sort((x,y)=>x-y);return rP(v.length?v[Math.floor((v.length-1)/2)]:A.peso);}
function travarCurral(){try{if(!window.filtroForn||!filtroForn()||naCargaAuto()){if(A.pausa&&A.pausa.trava)A.pausa=null;return;}const cur=curralAtual();if(!cur){A.pausa=null;return;}
  A.pausa={est:'aguardando',base:null,ts:Date.now(),falta:cur.prev,caiu:0,trava:true};}catch(e){}setTimeout(()=>window.holdSync&&holdSync(),0);}
window.travarCurral=travarCurral;
function maquina(){
  if(A.pausa)return; // pausado no trajeto: o peso que varia nos buracos não conta
  if(naCargaAuto())return; // na tela de carregar o trato fica parado (não perde o que já estava fornecendo)
  const c=cfg(),cur=curralAtual();if(A.peso==null)return;
  if(A.est==='aguardando'){
    const lim=cur&&cur.prev>0?Math.min(c.minDesc,Math.max(c.tol,cur.prev/2)):c.minDesc; // curral pequeno: começa com menos
    const limP=A.posPausa?Math.max(lim,120):lim;  // acabou de despausar e o vagão ainda não parou de verdade: o balanço do trajeto não pode virar fornecido
    if(A.base!=null&&cur&&A.suave<A.base-limP){A.posPausa=false;A.est='descarregando';  /* baseFix continua: o peso inicial do toque em liberar não muda mais neste curral */
      A.menor=A.peso;A.avisou1=false;A.avisou2=false;A.ancV=A.suave;A.ancT=Date.now();A.fpMin=null;return;}
    /* parado: o peso inicial é sempre o peso real da balança agora (não o final do curral anterior, que pode variar) */
    if(A.estavel&&(A.base==null||(A.valEst!==A.base&&!A.baseFix&&(A.valEst>A.base||A.posPausa||(A.estrito&&A.base-A.valEst<=Math.max(+c.tol||0,10)))))){if(A.base!=null&&A.baseConf===false&&Math.abs(A.valEst-A.base)>=5)diagLog('ini_ajustado',{curral:cur?cur.nome:'',de:A.base,para:A.valEst});A.base=A.valEst;A.baseConf=true;}
    if(A.posPausa&&A.estrito&&(A.base===A.valEst||A.baseFix))A.posPausa=false;  // parou de verdade: daqui pra frente vale a regra normal
    if(A.base==null){const r=refProvisoria(-1);if(r)A.base=r.v;}  // balança tremendo ou já começou a descer: não fica esperando
    return;
  }
  if(A.est==='descarregando'){
    A.menor=Math.min(A.menor,A.peso);
    const passo=Math.max(4,(+c.tol||0)/2);
    if(A.ancV==null||A.suave<A.ancV-passo){A.ancV=A.suave;A.ancT=Date.now();}
    if(A.estavel&&!A.baseFix&&A.valEst>A.base+c.minDesc){ // subiu: recarregou o vagão sem registrar (não vale quando o inicial foi pego no toque em liberar: balançar do vagão não muda o inicial)
      try{diagLog('recarga_ini',{de:A.base,para:A.valEst});}catch(e){}
      toast('Peso subiu: recarga? Peso inicial atualizado.');A.est='aguardando';A.base=A.valEst;}
  }
}

let registrando=false;
/* Finalizar fornecimento com o curral PAUSADO no meio: registra o que já foi fornecido nele. Travado (não liberado): não registra nada. */
window.aPausadoKg=()=>{const P=A.pausa,cur=curralAtual();return P&&!P.trava&&P.est==='descarregando'&&cur&&(+P.caiu||0)>0?{curral:cur.nome,kg:Math.round(+P.caiu)}:null;};
window.aRegistrarPausado=async()=>{const x=window.aPausadoKg(),P=A.pausa,cur=curralAtual();if(!x||!cur)return false;
  const now=new Date(),ini=+P.base,fim=ini-x.kg;
  const r={ts:now.getTime(),dia:diaAtivo(),trato:S.tratoSel,hora:now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),
    curral:cur.nome,prev:cur.prev,ini,fim,forn:x.kg,uid:`${S.aparelho}-${now.getTime()}`,enviado:false,origem:'balanca'};
  try{r.id=await dbAdd(r);}catch(e){toast('Erro ao salvar no banco.');return false;}
  HIST.push(r);A.pausa=null;diagLog('trato_pausado_finalizado',{curral:cur.nome,forn:x.kg});novoCurral(false,true);
  try{if(window.compensarCurral)compensarCurral(cur.nome);}catch(e){}save();sincronizar();toast(`${cur.nome}: ${fmt(x.kg)} kg salvo (estava pausado)`);return true;};
async function registrarAuto(){
  if(registrando)return;
  if(bloqueado())return;
  if(A.pausa){toast('Está pausado: toque em continuar primeiro');return;}
  const L=lista(),cur=L[S.atual];
  if(!cur){toast(L.length?'Trato completo':'Sem previsto neste trato');return;}
  if(A.base==null){toast('Sem peso inicial ainda');return;}
  if(A.peso==null){toast('Sem leitura da balança');return;}
  /* peso final = a balança EXATA no momento do toque (tomada de força desligada: igual ao visor do vagão) */
  const ft=A.fimToque;A.fimToque=null;
  let fim=ft&&ft.cur===cur.nome&&Date.now()-ft.ts<5*60000?ft.v:pesoVisor();if(fim==null){toast('Sem leitura da balança');return;}
  const ini=A.base;
  if(!(fim<ini)){toast('O peso não caiu desde o início');return;}
  const ja=regsAtuais().filter(x=>x.curral===cur.nome);
  if(ja.length&&A.tagRepetir!==cur.nome&&!confirm(`${cur.nome} já tem trato no Trato ${S.tratoSel}. Lançar mais um (soma no realizado)?`))return;
  if(A.tagRepetir===cur.nome)A.tagRepetir=null;
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
  diagLog('trato',Object.assign({curral:cur.nome,trato:S.tratoSel,prev:cur.prev,ini,fim,forn:ini-fim,iniConf:A.baseConf!==false},resumoBal()));diagCurva('trato',cur.nome,{prev:cur.prev,ini,fim});
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
  todosSons().forEach(a=>{a.muted=true;a.volume=0;const p=a.play();const fim=()=>{a.pause();a.currentTime=0;setTimeout(()=>{a.muted=false;a.volume=1;},150);};
    if(p&&p.then)p.then(fim).catch(()=>{a.muted=false;a.volume=1;somLiberado=false;});else fim();});
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
/* peso usado no "Fornecer": no meio da descarga, o que só desce (pesoDesc); parado e firme, o peso real */
/* "Fornecer instantâneo" (padrão): mostra a leitura da balança na hora, igual ao visor dela. Desligado: segue a reta (mais liso, pode atrasar um pouco) */
const fornInst=()=>+cfg().fornInst!==0;
function pesoDescRef(){if(fornInst()||naCargaAuto()||A.est!=='descarregando'||A.estavel||!A.descFit)return A.peso;
  const f=A.descFit;return f.v+f.b*Math.min(Date.now()-f.t,(A.dtMed||500)*1.0);}
/* reta pelos pontos, à prova de leitura doida (Theil-Sen: mediana das inclinações entre pares de leituras e mediana do nível).
   Uma ou duas leituras muito fora (buraco, balanço) não puxam a reta. Devolve o valor da reta agora e a inclinação (kg/ms, nunca subindo). */
function ajusteReta(pts,agora){const mdn=a=>{const v=a.slice().sort((x,y)=>x-y),n=v.length;return n?(n%2?v[(n-1)/2]:(v[n/2-1]+v[n/2])/2):NaN;};
  if(pts.length<3)return {v:mdn(pts.map(q=>q.v)),b:0};
  const ts=P=>{const sl=[];for(let i=0;i<P.length;i++)for(let k=i+1;k<P.length;k++){const dt=P[k].t-P[i].t;if(dt>200)sl.push((P[k].v-P[i].v)/dt);}
    const b=sl.length?mdn(sl):0;return {b,n:mdn(P.map(q=>q.v-b*(q.t-agora)))};};
  let f=ts(pts);const res=pts.map(q=>Math.abs(q.v-(f.n+f.b*(q.t-agora)))),lim=Math.max(80,3*mdn(res)),bons=pts.filter((q,i)=>res[i]<=lim);
  if(bons.length>=3&&bons.length<pts.length)f=ts(bons);
  const b=Math.min(0,f.b);return {v:b===f.b?f.n:mdn((bons.length>=3?bons:pts).map(q=>q.v)),b};}
function zona(){const cur=curralAtual();if(!cur||A.base==null||A.peso==null)return null;
  const pz=A._tela?A.peso:pesoDescRef();
  if(cur.semPrev){const caindo=caindoAgora();return {falta:null,fp:null,taxa:caindo?taxaQueda():0,caindo,z:'cinza',semPrev:true};}  // sem previsto (liberado pela tag): sem meta nem apito
  const c=cfg(),falta=cur.prev-Math.max(0,A.base-pz),caindo=caindoAgora();
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
  const tocando=!!(c.som&&A.fonte&&z&&!z.semPrev&&!modoVer&&!(A.pausa&&!naCarga)&&(naCarga?z.caindo:(A.est==='descarregando'&&z.caindo)));
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
/* o que está na tela do operador (para o Visualizar mostrar igual) */
window.telaAuto=p=>{const t=id=>{const e=$(p+id);return e?e.textContent.trim():'';},c=id=>{const e=$(p+id);return e?e.className:'';};
  return {peso:t('Peso'),pesoTxt:t('EstTxt'),etapa:t('Etapa'),etCl:c('Etapa'),fCl:c('FaltaBox'),fTit:t('FaltaTit'),fVal:t('Falta'),fTxt:t('FaltaTxt'),
    feito:t(p==='ac'?'Carr':'Caiu'),ini:t('Ini'),alvo:t('Alvo'),azul:telaAzul(p)};};
/* quadro azul que o operador está vendo (travado esperando liberar, ou pausado no trajeto): vai junto para o Visualizar */
function telaAzul(p){try{if(p==='ac'){const it=acItem();if(!it||ok(it.real))return null;
    if(AC.pausa)return {t:'pausa'};if(AC.trava)return {t:'trava',txt:'▶ CARREGAR',nome:it.nome,em:'Toque para carregar'};return null;}
  if(!A.pausa)return null;const cur=curralAtual();
  return A.pausa.trava?{t:'trava',txt:'▶ FORNECER',nome:cur?cur.nome:'',em:'Toque para fornecer'}:{t:'pausa'};}catch(e){return null;}}
window.aEstadoAoVivo=()=>{const L=lista(),c=L[S.atual],regs=regsAtuais();
  const ff=window.filtroForn?filtroForn():null;return {pausa:!!A.pausa,tela:$('viewAuto')&&!$('viewAuto').hidden&&ff?telaAuto('a'):null,modo:'trato',origem:'auto',local:ff?ff.local:'',rac:ff?ff.rac:'',fimForn:!ff,deAp:ff&&ff.deAp||'',contTs:ff&&ff.contTs||0,fts0:ff&&ff.ts0||0,dia:diaAtivo(),trato:S.tratoSel,curral:c?c.nome:'',prev:c?c.prev:null,ini:A.base!=null?Math.round(A.base):'',fim:A.peso!=null?Math.round(A.peso):'',
    ...contaLocalTrato(L,regs)};};
/* ---------- Pausar no trajeto ---------- */
/* diminui a letra até o texto caber na largura do quadro (nome de curral comprido, tela estreita) */
function caberTexto(bx){try{if(!bx||bx.hidden)return;bx.querySelectorAll('b,.pzCur').forEach(e=>{e.style.fontSize='';let f=parseFloat(getComputedStyle(e).fontSize)||40,n=0;
  while(e.scrollWidth>e.clientWidth+1&&f>14&&n++<40){f*=0.92;e.style.fontSize=f+'px';}});}catch(x){}}
window.caberTexto=caberTexto;window.addEventListener('resize',()=>{caberTexto($('aPausaBox'));caberTexto($('acTravaBox'));});
function pintarPausa(){const p=!!A.pausa;if(!$('aPausaBox'))return;$('aPausaBox').hidden=!p;$('aPausar').hidden=p||!curralAtual();
  /* travado depois de registrar: o quadro azul vira o botão "▶ FORNECER C-7" (o nome do próximo curral, grandão) */
  const cur=curralAtual(),h=p&&A.pausa.trava?`<b>▶ FORNECER</b><strong class="pzCur">${esc(cur?cur.nome:'')}</strong><em>Toque para fornecer</em>`   /* o quadro azul inteiro é o botão */
    :`<b>⏸ PAUSADO</b><span>No trajeto: a balança não está contando nada.</span><em>▶ Toque aqui para continuar</em>`;
  const bx=$('aPausaBox');if(bx.dataset.h!==h){bx.dataset.h=h;bx.innerHTML=h;}requestAnimationFrame(()=>caberTexto(bx));bx.classList.toggle('pzTrava',!!(p&&A.pausa.trava));
  ['aFaltaBox','aReg'].forEach(i=>{const e=$(i);if(e)e.style.display=p?'none':'';});const m=document.querySelector('#aBox .aMini');if(m)m.style.display=p?'none':'';}
function aPausar(){if(A.pausa)return;const z0=zona(),cur0=curralAtual();A.pausa={est:A.est,base:A.base,ts:Date.now(),
    falta:A.est==='descarregando'&&z0?Math.max(0,z0.falta):(cur0?cur0.prev:null),caiu:A.est==='descarregando'&&A.base!=null&&A.peso!=null?Math.max(0,A.base-A.peso):0};pararSom();diagLog('pausou',{est:A.est,base:A.base,peso:A.peso});
  toast('⏸ Pausado: a balança não conta até você continuar');pintarPeso();holdSync();if(typeof agendarAoVivo==='function')agendarAoVivo();}
function aContinuarPausa(){const P=A.pausa;if(!P)return;A.pausa=null;
  /* estava no meio do curral: o que já caiu fica guardado; a conta recomeça pela balança de AGORA (o que mudou no trajeto não conta) */
  if(P.est==='descarregando'){const atual=pesoVisor();A.est='descarregando';A.base=(atual!=null?atual:P.base)+(+P.caiu||0);A.baseConf=true;A.baseFix=true;A.baseCur=(curralAtual()||{}).nome||null;A.ancV=null;A.ancT=Date.now();A.fpMin=null;A.menor=A.peso;}
  else{novoCurral(true,true);const pa=pesoVisor();if(pa!=null){A.base=pa;A.baseConf=true;A.baseFix=true;A.baseCur=(curralAtual()||{}).nome||null;}else A.baseConf=false;A.posPausa=true;}  // liberou o curral: a balança EXATA do momento do toque vira o peso inicial (não troca depois pela média)  // liberou o curral: o peso de agora vira o inicial  // ainda não tinha começado: o peso de agora vira o inicial (e acerta quando a balança firmar)
  diagLog('despausou',{est:A.est,base:A.base,peso:A.peso,seg:Math.round((Date.now()-P.ts)/1000)});holdSync();
  const cN=curralAtual();toast(P.trava?`▶ Fornecendo no ${cN?cN.nome:''}`:P.est==='descarregando'?'▶ Continuando o mesmo curral':'▶ Continuando: deixe o vagão parado para pegar o peso inicial');pintarPeso();aRender();
  if(typeof agendarAoVivo==='function')agendarAoVivo();}
window.aPausar=aPausar;window.aContinuarPausa=aContinuarPausa;
/* peso na tela entre uma leitura e outra: enquanto está carregando/fornecendo, segue a velocidade (kg/s) por até "prever" segundos,
   para o número andar junto com o vagão em vez de pular. Só na tela: registro, apito e peso firme usam a leitura real. */
function pesoTela(){if(A.peso!=null&&naCargaAuto())return pesoVisor();   // carregar: sempre a balança de verdade (varia, sobe e desce)
  if(A.peso!=null&&!A.pausa&&A.estavel)return pesoVisor();  // parado: mostra o mesmo número do visor do vagão  // firme: o número para (média sem os picos)
  if(A.peso==null||A.pausa||naCargaAuto())return A.peso==null?null:pesoVisor();  // carregar: mostra a leitura da balança direto (a pazada aparece na hora; pico sobe e volta), sem prever
  if(fornInst()&&A.est==='descarregando')return pesoVisor();   // instantâneo: igual ao visor da balança, sem prever nem filtrar
  if(A.descFit&&!naCargaAuto()&&A.est==='descarregando'&&!A.estavel)return pesoDescRef();const p0=A.peso,lim=Math.max(0,Math.min(2,+cfg().prever||0))*1000;if(!lim||!A.tUlt)return p0;
  let dir=0,tx=0;if(caindoAgora()){dir=-1;tx=taxaQueda();}else if(typeof subindoAgora==='function'&&subindoAgora()){dir=1;tx=taxaQueda(-1);}
  if(!dir||!(tx>0))return p0;const dt=Math.min(Date.now()-A.tUlt,lim,(A.dtMed||700)*1.5);return p0+dir*tx*dt/1000;}
function comPesoTela(f){const r=A.peso;try{A._pesoReal=r;A.peso=rP(pesoTela());A._tela=true;f();}finally{A.peso=r;A._tela=false;}}
setInterval(()=>{if(document.visibilityState!=='visible'||A.peso==null)return;if(caindoAgora()||(A.est==='descarregando'&&A.descFit&&A.descFit.b<0&&!naCargaAuto()))comPesoTela(pintarPeso0);else if((typeof subindoAgora==='function'&&subindoAgora()))comPesoTela(pintarCarga0);},150);
function pintarPeso(){comPesoTela(pintarPeso0);}
function pintarPeso0(){
  if(!$('aPeso')||$('viewAuto').hidden)return;
  const c=cfg(),cur=curralAtual();
  const pr=A.peso==null?null:pesoVisor();$('aPeso').textContent=pr==null?'—':fmt(pr);  /* tablet = última leitura da balança (o mesmo número que é registrado no toque) */  // Balança: igual ao visor do indicador
  const e=$('aEstTxt');e.textContent=(A.peso==null?'sem leitura':A.estavel?'● Estável':'○ Oscilando')+idadeLeitura();e.className=atrasada()?'atraso':A.estavel?'est':'';
  $('aIni').textContent=A.base==null?'—':fmt(A.base);
  const alvo=(cur&&!cur.semPrev&&A.base!=null)?A.base-cur.prev:null;
  $('aAlvo').textContent=alvo==null?'—':fmt(alvo);
  const caiu=(A.base!=null&&A.peso!=null)?Math.max(0,A.base-A.peso):null;
  $('aCaiu').textContent=caiu==null?'—':fmt(caiu);
  const z=zona(),fb=$('aFaltaBox');
  $('aFaltaTit').textContent=(z&&z.falta<0)?'PASSOU':'Fornecer';
  if(z&&z.semPrev){$('aFaltaTit').textContent='Sem previsto';$('aFalta').textContent=caiu==null?'—':fmt(caiu);fb.className='aFalta cinza';$('aFaltaTxt').textContent='fornecido até agora';}
  else if(z){$('aFalta').textContent=fmt(z.falta);fb.className='aFalta '+z.z;
    $('aFaltaTxt').textContent=z.falta<0?'DO PREVISTO':z.falta===0?'NO PONTO!':'\u00a0';
    if(z.falta<0)$('aFalta').textContent='-'+fmt(-z.falta);}
  else{$('aFalta').textContent=cur?fmt(cur.prev):'—';fb.className='aFalta cinza';$('aFaltaTxt').textContent=A.fonte?'esperando peso inicial':'conecte a balança';}
  const et=$('aEtapa');let txt,cl='';
  pintarPausa();
  if(A.pausa){/* pausado: os números ficam parados no valor de quando pausou */$('aFalta').textContent=A.pausa.falta==null?'—':fmt(A.pausa.falta);$('aCaiu').textContent=fmt(A.pausa.caiu||0);
    et.textContent='⏸ Balança pausada - em trajeto';et.className='aEtapa pausa';$('aFaltaTit').textContent='Pausado';fb.className='aFalta cinza';$('aFaltaTxt').textContent='toque em continuar quando chegar';$('aReg').disabled=true;return;}
  if(!A.fonte)txt='';
  else if(A.peso==null)txt='Esperando o peso chegar da balança…';
  else if(!cur)txt=lista().length?'✓ Trato completo':'Sem previsto neste trato (lance na aba Previsto)';
  else if(A.est==='descarregando'){const zz=zona()||{};txt=A.estavel?'■ Parou de fornecer':zz.caindo?`▼ Fornecendo no ${cur.nome} · ${fmt(zz.taxa)} kg/s`:'■ Parou de fornecer';cl='desc';}
  else if(A.base==null)txt='Deixe o vagão parado para pegar o peso inicial';
  else{txt='Pronto pra fornecer no '+cur.nome;cl='pronto';}
  et.textContent=txt;et.className='aEtapa '+cl;et.hidden=!txt;
  $('aReg').disabled=!(cur&&A.base!=null&&A.peso!=null&&A.peso<A.base)||modoVer;
}
function aRender(){
  if(!$('aBox')||!$('aBox').dataset.ok)return;
  try{window.pintarCancForn&&pintarCancForn();}catch(e){}
  cfg();
  const L=lista(),regs=regsAtuais(),cur=L[S.atual];
  $('aData').textContent=(S.dataManual?'⚠ ':'')+diaBR(diaAtivo());
  $('aTrato').value=String(S.tratoSel);
  $('aCur').textContent=cur?cur.nome:(L.length?'Completo':'—');
  $('aPrev').textContent=cur&&!cur.semPrev?fmt(cur.prev):'—';
  if(!$('aEscolha').hidden)mostrarAEscolha();
  let tp=0,tf=0;
  const linha=(nome,prev,i)=>{const rs=regs.filter(r=>r.curral===nome),fz=rs.length>0,f=rs.reduce((a,r)=>a+r.forn,0);
    if(prev!=null)tp+=prev;tf+=f;const d=f-(prev||0);
    const real=fz?`<b>${fmt(f)}</b>`:(i===S.atual?'<span class="pill">agora</span>':'—');
    return `<tr class="${i===S.atual?'cur':''}"><td class="hora">${fz?horaDe(rs[0]):''}</td><td class="c">${esc(nome)}</td><td>${prev!=null?fmt(prev):'—'}</td><td>${real}</td><td class="${fz&&prev?classeDesv(d,prev):''}">${fz&&prev!=null?sgn(d):''}</td></tr>`;};
  const extras=[...new Set(regs.map(r=>r.curral))].filter(n=>!L.some(x=>x.nome===n));
  $('aTb').innerHTML=(L.length||extras.length)?ordemTabela(L,extras,regs).map(x=>linha(x.nome,x.prev,x.i)).join(''):
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
let diagT=null,diagCT=null;
/* curva do peso: as leituras cruas dos últimos 45 s antes de cada registro (para analisar picos e estabilização).
   Fica num item por dia e aparelho (diagc-…), no máximo 25 curvas, compactado: valor inicial + "décimos de segundo,variação;…" */
function diagCurva(tipo,nome,reg){try{if(typeof gPut!=='function'||!S)return;const P=(A.h45||[]).slice();if(P.length<2)return;
  const dia=typeof diaAtivo==='function'?diaAtivo():new Date().toISOString().slice(0,10),uid='diagc-'+dia+'-'+S.aparelho;
  let s='',pt=P[0].t,pv=P[0].v;for(let i=1;i<P.length;i++){s+=(i>1?';':'')+Math.round((P[i].t-pt)/100)+','+Math.round(P[i].v-pv);pt=P[i].t;pv=P[i].v;}
  const it=G.it[uid]&&!G.it[uid].del?JSON.parse(JSON.stringify(G.it[uid])):{uid,tipo:'diagc',dia,aparelho:S.aparelho,c:[]};
  it.c=(it.c||[]).concat([Object.assign({e:tipo,n:nome,t:new Date(P[P.length-1].t).toTimeString().slice(0,8),v0:Math.round(P[0].v),s,est:!!A.estavel,tdp:!!A.firmeTdp},reg||{})]).slice(-25);
  G.it[uid]=it;clearTimeout(diagCT);diagCT=setTimeout(()=>{try{gPut(JSON.parse(JSON.stringify(G.it[uid])));}catch(e){}},5000);}catch(e){}}
window.diagCurva=diagCurva;
window.diagLog=function(tipo,d){try{if(typeof gPut!=='function'||typeof G==='undefined'||!S)return;
  const dia=typeof diaAtivo==='function'?diaAtivo():new Date().toISOString().slice(0,10),uid='diag-'+dia+'-'+S.aparelho;
  const it=G.it[uid]&&!G.it[uid].del?G.it[uid]:{uid,tipo:'diag',dia,aparelho:S.aparelho,ev:[]};
  const h=new Date();it.ev=(it.ev||[]).concat([Object.assign({t:h.toTimeString().slice(0,8),tipo},d||{})]).slice(-400);
  it.cfg=(()=>{const c=cfg(),o={};['tol','tempo','minDesc','amarelo','vermelho','continuo','antecipa','filtro'].forEach(k=>o[k]=c[k]);return o;})();
  G.it[uid]=it;clearTimeout(diagT);diagT=setTimeout(()=>{try{gPut(JSON.parse(JSON.stringify(G.it[uid])));}catch(e){}},4000);}catch(e){}};
const resumoBal=()=>{const vs=(A.amostras||[]).map(a=>a.v);return {estavel:!!A.estavel,varia:vs.length?Math.max(...vs)-Math.min(...vs):null,leit_s:A.dtMed?+(1000/A.dtMed).toFixed(2):null};};
window.pesoBalanca=()=>A.fonte&&A.peso!=null&&A.ultDado&&Date.now()-A.ultDado<3000?Math.round(A.peso):null;
window.aRenderFora=()=>{try{if($('viewAuto')&&!$('viewAuto').hidden){const cu=curralAtual();if(A.baseFix&&cu&&cu.nome===A.baseCur&&!A.pausa){$('aTrato').value=String(S.tratoSel);aRender();return;}  /* mesmo curral já liberado: não troca o peso inicial do toque */
  novoCurral(true);$('aTrato').value=String(S.tratoSel);aRender();}}catch(e){}};
window.aContinuar=v=>{A.pausa=null;diagLog('continuou_outro_aparelho',{ini:+v,peso:A.peso});A.est='aguardando';A.ancV=null;A.ancT=0;A.fpMin=null;A.menor=null;A.base=+v;A.baseFix=true;A.baseCur=(curralAtual()||{}).nome||null;
  if(A.peso!=null&&A.peso<A.base-cfg().minDesc){A.est='descarregando';A.menor=A.peso;A.ancV=A.suave;A.ancT=0;}aRender();};
/* ---- segurança: o app saiu da tela no meio de um curral (Android fechou a aba / recarregou) ----
   guarda a cada segundo o curral em andamento (peso inicial); ao voltar, se for o mesmo curral e ainda não registrado,
   continua de onde estava em vez de começar do zero. */
const CUR_KEY='aCurSalvo';
setInterval(()=>{try{if(!A.restChk||A.pausa||naCargaAuto())return;const f=window.filtroForn&&filtroForn(),cur=curralAtual();
  if(!f||!cur||A.base==null){return;}
  if(A.est!=='descarregando'){const v=JSON.parse(localStorage.getItem(CUR_KEY)||'null');if(v&&v.curral===cur.nome&&v.est==='descarregando'&&+v.trato===+S.tratoSel)localStorage.removeItem(CUR_KEY);return;}
  localStorage.setItem(CUR_KEY,JSON.stringify({dia:diaAtivo(),trato:S.tratoSel,curral:cur.nome,base:A.base,est:A.est,ts:Date.now()}));}catch(e){}},1000);
/* curral atual já tratado (ex.: o app voltou sozinho no C-10, que já está ✓): vai para o próximo que falta */
function pularParaFalta(avisar){try{const f=window.filtroForn&&filtroForn(),cur=curralAtual();if(!f||!cur||A.est==='descarregando'||(A.pausa&&!A.pausa.trava))return false;
  const L=lista(),regs=regsAtuais();if(!feito(cur.nome,regs))return false;
  let j=L.findIndex((x,k)=>k>S.atual&&!feito(x.nome,regs));if(j<0)j=L.findIndex(x=>!feito(x.nome,regs));if(j<0)return false;
  setAtual(j);save();novoCurral(true);try{render();}catch(e){}aRender();if(avisar)toast(`${cur.nome} já foi tratado: indo para o ${L[j].nome}`);return true;}catch(e){return false;}}
window.pularParaFalta=pularParaFalta;
/* o app voltou sozinho (Android fechou/recarregou) com um fornecimento aberto: pergunta se continua; tocar em Continuar já abre a lista da balança */
window.aPerguntaVoltou=async()=>{try{const f=window.filtroForn&&filtroForn();if(!f||modoVer||A.perguntou)return;A.perguntou=true;
  const L=lista(),regs=regsAtuais(),n=L.filter(x=>feito(x.nome,regs)).length;let v=null;try{v=JSON.parse(localStorage.getItem(CUR_KEY)||'null');}catch(e){}
  const meio=v&&+v.trato===+S.tratoSel&&v.dia===diaAtivo()&&Date.now()-v.ts<3*3600e3&&!feito(v.curral,regs)&&L.some(x=>x.nome===v.curral);
  const cur=curralAtual();
  const sim=await confirmaVermelho('Continuar o fornecimento?',`${f.local==='C'?'Confinamento':'Pasto'} · Trato ${S.tratoSel} · ${n} de ${L.length} currais feitos.\n`+
    (meio?`Estava no meio do ${v.curral}: o peso inicial (${fmt(v.base)} kg) ficou guardado e continua de onde parou.`:`Próximo curral: ${cur?cur.nome:'—'}.`)+(A.fonte?'':'\nAo tocar em Continuar, escolha a balança na lista para conectar.'),
    'Sim, continuar o trato','Não, finalizar fornecimento',true);
  if(sim){if(!A.fonte)conectarBt(true).catch(()=>{});}
  else{const b=document.querySelector('#aBox [data-ffinal]');if(b)b.click();}}catch(e){}};
setInterval(()=>{try{if(A.restChk||A.peso==null)return;A.restChk=true;
  const v=JSON.parse(localStorage.getItem(CUR_KEY)||'null');localStorage.removeItem(CUR_KEY);
  const f=window.filtroForn&&filtroForn();if(!f)return;
  const L=lista(),k=v?L.findIndex(x=>x.nome===v.curral):-1;
  if(!v||k<0||+v.trato!==+S.tratoSel||v.dia!==diaAtivo()||Date.now()-v.ts>3*3600e3||feito(v.curral,regsAtuais())){pularParaFalta(true);return;}
  if(k!==S.atual){setAtual(k);save();try{render();}catch(e){}}
  if(A.peso>v.base+cfg().minDesc)return;   // peso maior que o inicial guardado: recarregou, não continua
  diagLog('curral_restaurado',{curral:v.curral,ini:v.base,peso:A.peso,seg:Math.round((Date.now()-v.ts)/1000)});
  window.aContinuar(v.base);toast(`↩ Voltou para o ${v.curral}: continuando com o peso inicial ${fmt(v.base)} kg (o que já caiu não se perdeu)`);}catch(e){}},500);
window.aAoAbrir=()=>{montar();try{if(!A.pausa&&A.est!=='descarregando')travarCurral();}catch(e){}aRender();try{pularParaFalta(true);}catch(e){}if(!modoVer&&window.btAutoVoltar)btAutoVoltar();try{pintarTag();}catch(e){}try{if(typeof gSync==='function')gSync(true).catch(()=>{});}catch(e){}};
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
/* todo produto novo começa TRAVADO (quadro azul "▶ CARREGAR SILAGEM"): a balança só conta depois de tocar; o peso de agora vira o inicial */
/* produto já liberado (tocou em CARREGAR) e ainda não registrado — ex.: o app fechou e voltou no meio da batida: não trava de novo e continua com o peso inicial guardado */
function acNovoProduto(semTravar){AC.est='aguardando';AC.ancV=null;AC.ancT=0;AC.fpMin=null;AC.pausa=null;const it=acItem();AC.trava=!semTravar&&!!(it&&!ok(it.real)&&!(it.lib&&ok(it.ini)));setTimeout(holdSync,0);}
window.acLiberar=()=>{const it=acItem();if(!it)return;AC.trava=false;const pa=pesoVisor();if(pa!=null){it.ini=pa;it.fim=null;it.iniFix=true;it.lib=true;}  /* início = balança EXATA no toque (não muda depois) */
  AC.est='aguardando';AC.ancV=null;AC.ancT=0;cSave();cRender();toast(`▶ Carregando ${it.nome}`);holdSync();};
/* ⏸ Pausar no carregamento (trajeto no meio de um produto): a balança não conta; o que já foi carregado fica guardado.
   Ao continuar, o peso inicial é recalculado pela balança de agora (o que mudou no trajeto não conta). */
window.acPausar=()=>{const it=acItem();if(AC.pausa||AC.trava||!it||ok(it.real))return;
  const pv=A.peso!=null?pesoVisor():null,carr=ok(it.ini)&&pv!=null?Math.max(0,pv-it.ini):0;
  AC.pausa={carr,ts:Date.now()};pararSom();diagLog('pausou_carga',{produto:it.nome,ini:it.ini,peso:pv,carr});
  toast('⏸ Pausado: a balança não conta até você continuar');pintarCarga();holdSync();};
window.acContinuarPausa=()=>{const P=AC.pausa,it=acItem();if(!P)return;AC.pausa=null;
  const pa=A.peso!=null?pesoVisor():null;
  if(it&&!ok(it.real)&&pa!=null&&(ok(it.ini)||P.carr>0)){it.ini=pa-(+P.carr||0);it.fim=null;it.iniFix=true;it.lib=true;cSave();}
  AC.est='aguardando';AC.ancV=null;AC.ancT=0;AC.fpMin=null;
  diagLog('despausou_carga',{produto:it?it.nome:'',ini:it?it.ini:null,peso:pa,carr:P.carr,seg:Math.round((Date.now()-P.ts)/1000)});
  toast(it?`▶ Continuando ${it.nome}`:'▶ Continuando');holdSync();cRender();};
const naCargaAuto=()=>!!($('viewAutoC')&&!$('viewAutoC').hidden);
function maquinaCarga(){
  if(!naCargaAuto())return;const B=acB(),it=acItem(),c=cfg();if(!B||!it||A.peso==null||ok(it.real))return;
  if(AC.idx!==B.atual){AC.idx=B.atual;acNovoProduto();}
  if(AC.trava||AC.pausa)return;   // travado ou pausado: no caminho a balança não conta
  if(AC.est==='aguardando'){
    const lim=Math.min(c.minDesc,Math.max(c.tol,it.prev/2)); // produto pequeno (núcleo): começa com menos
    if(ok(it.ini)&&A.suave>it.ini+lim){AC.est='carregando';AC.ancV=A.suave;AC.ancT=Date.now();AC.fpMin=null;return;}
    if(A.estavel&&(!ok(it.ini)||(!it.iniFix&&A.valEst!==it.ini&&(A.valEst<it.ini||(A.estrito&&A.valEst-it.ini<=Math.max(+c.tol||0,10)))))){if(ok(it.ini)&&Math.abs(A.valEst-it.ini)>=5)diagLog('ini_ajustado_carga',{produto:it.nome,de:it.ini,para:A.valEst});it.ini=A.valEst;it.fim=null;cSave();}  // parado: o peso inicial é sempre o peso real da balança agora
    if(!ok(it.ini)){const r=refProvisoria(1);if(r){it.ini=r.v;it.fim=null;cSave();}}  // balança tremendo ou já começou a carregar: não fica esperando
  }else{
    const passo=Math.max(4,(+c.tol||0)/2);
    if(A.suave>AC.ancV+passo){AC.ancV=A.suave;AC.ancT=Date.now();}
    if(A.estavel&&!it.iniFix&&A.valEst<it.ini-c.minDesc){AC.est='aguardando';it.ini=A.valEst;cSave();toast('Peso caiu abaixo do início: peso inicial atualizado.');}
  }
}
function subindoAgora(){return AC.est==='carregando'&&AC.ancT>0&&Date.now()-AC.ancT<jCaindo()&&Date.now()-A.ultDado<jVivo();}
function zonaC(){const it=acItem();if(AC.trava||AC.pausa||!naCargaAuto()||!it||!ok(it.ini)||A.peso==null||ok(it.real))return null;
  const c=cfg(),carregado=Math.max(0,A.peso-it.ini),falta=it.prev-carregado,sub=subindoAgora(),taxa=sub?taxaQueda(-1):0;
  let fp=falta;
  if(sub){fp=falta-taxa*(+c.antecipa||0);if(AC.fpMin!=null&&AC.fpMin<fp)fp=AC.fpMin;AC.fpMin=fp;}else AC.fpMin=null;
  return {falta,fp,taxa,carregado,caindo:sub,z:falta<0?'passou':fp<=c.continuo?'continuo':fp<=c.vermelho?'vermelho':fp<=c.amarelo?'amarelo':'verde'};}
window.acTela=(nova,dia)=>{
  const topo=`<section class="panel">
    <div class="curhead balHead"><button type="button" class="mini balTog" data-baltog="1" aria-label="Mostrar ou esconder a conexão">▲</button><h2>Balança</h2><span class="balMini" id="acBalMini"></span></div>
    <div class="aStatus" id="acStatus"><i></i><span id="acStatusTxt">Desconectado</span></div>
    <div class="aConn"><button data-ac="ser" id="acBtSer" hidden>🔵 Bluetooth</button><button data-ac="bt" id="acBtBt">Conectar a balança</button><button data-ac="ws" id="acBtWs" hidden>📶 Caixinha Wi-Fi</button><button data-ac="sim" id="acBtSim" hidden>🧪 Simulador</button><button data-ac="desc" id="acDesc" class="aDescBt" disabled>Desconectar</button></div>
    <div class="aSinal" id="acSinal">⚪ Balança desconectada</div>
    <div class="aTeclas" id="acTeclas" hidden><button data-tecla="43">▸0◂<br>Zero</button><button data-tecla="40">▸T◂<br>Tara</button><button data-tecla="10">Líquido/<br>Bruto</button><button data-tecla="23">🖨<br>Imprimir</button></div>
    <div class="aSim" id="acSimBox" hidden><button class="lima" data-ac="simSobe">▲ Carregar</button><button data-ac="simPara">■ Parar</button><button data-ac="simZera">Esvaziar</button></div>
    <div class="aPeso"><div><small>Balança (kg)</small><em id="acEstTxt">sem leitura</em></div><b class="num" id="acPeso">—</b></div>
  </section>`;
  if(nova)return topo+nova+dia;
  const B=acB(),i=B.atual,it=B.itens[i];
  const pend=B.itens.filter(x=>!ok(x.real)).length,todosC=!pend,ultimoC=pend===1&&it&&!ok(it.real);
  const h=cTelaBatida(),k=h.indexOf('<section',h.indexOf('<section')+8),tabela=k>0?h.slice(k):'';
  return topo+(window.barraBatida?barraBatida(B):'')+`<section class="panel"><div class="curhead"><h2>Carregamento · ${B.avulso?'Avulso':'Trato '+B.trato}</h2><span class="note">${esc(B.racNome)} · ${nf(B.total)} kg</span></div>
    <div class="fCols"><div class="fColE">
    <div class="curBox2"><div class="cbCur" data-c="escolher" role="button"><span>Produto ${i+1} de ${B.itens.length} <i class="seta">▼</i></span><b>${esc(it?it.nome:'—')}</b></div>
      <div class="cbPrev"><span>Carregar</span><b class="num">${it?nf(it.prev):'—'}</b></div></div>
    ${B.escolha?`<div class="escolha">${B.itens.map((x,j)=>`<button data-c="ir" data-i="${j}" class="${j===i?'sel':''}">${ok(x.real)?'✓ ':''}${esc(x.nome)} · ${nf(x.prev)} kg</button>`).join('')}</div>`:''}
    ${it&&ok(it.real)?`<p class="avisoJa">Este produto já foi carregado (${nf(it.real)} kg). Para refazer, toque em Desfazer último, lá embaixo.</p>`:''}
    ${window.fixoNota?fixoNota(it):''}<div class="aEtapa" id="acEtapa"></div>
    </div><div class="fColD">
    <div class="aPausaBox acTravaBox" id="acTravaBox" hidden role="button" tabindex="0"><b>▶ CARREGAR</b><strong class="pzCur" id="acTravaNome"></strong><em>Toque para carregar</em></div>
    <div class="aPausaBox" id="acPausaBox" hidden role="button" tabindex="0"><b>⏸ PAUSADO</b><span>No trajeto: a balança não está contando nada.</span><em>▶ Toque aqui para continuar</em></div>
    <div class="aFalta" id="acFaltaBox"><button type="button" class="aPausaBt" id="acPausar" hidden>⏸ Pausar (trajeto)</button><small id="acFaltaTit">Carregar</small><b class="num" id="acFalta">—</b><em id="acFaltaTxt">&nbsp;</em></div>
    <div class="aMini">
      <div class="caiu"><small>Carregado</small><b class="num" id="acCarr">—</b></div>
      <div><small>Peso inicial</small><b class="num" id="acIni">—</b></div>
      <div><small>Parar com</small><b class="num" id="acAlvo">—</b></div>
    </div>
    ${window.manNotaAtiva?manNotaAtiva(B):''}
    ${todosC?`<p class="avisoJa">✓ Todos os produtos foram carregados.</p><button class="primary" data-c="concluir">✓ Finalizar carregamento</button>`
      :`<button class="primary" data-c="registrar" id="acReg" disabled>${ultimoC?'✓ Registrar último produto':'✓ Registrar e ir para o próximo ▶'}</button>`}
    </div></div>
    <div class="row"><button data-c="ant"${i>0?'':' disabled'}>◀ Produto anterior</button><button class="lima" data-c="prox"${i<B.itens.length-1?'':' disabled'}>Próximo produto ▶</button></div>
  </section>`+tabela+dia;};
window.acDepois=()=>{acSyncTopo();try{pintarSinal();}catch(e){}  /* já desenha a balança recolhida/aberta junto (antes abria e fechava num piscar e a tela tremia) */
  const B=acB();if(B&&AC.idx!==B.atual){const volta=AC.idx==null;AC.idx=B.atual;acNovoProduto();
    const it=acItem();if(volta&&it&&it.lib&&ok(it.ini)&&!ok(it.real))toast(`↩ Carregamento continuando: ${it.nome} com peso inicial ${fmt(it.ini)} kg (o que já foi carregado não se perdeu)`);}pintarCarga();};
window.acIniciou=()=>{acNovoProduto();   // o primeiro produto também começa travado (azul)
  const B=acB();AC.idx=B?B.atual:null;const it=acItem();if(it&&A.estavel){it.ini=A.valEst;cSave();}pintarCarga();
  if(!A.fonte)toast('Conecte a balança para carregar pela Automação');};
window.acRegistrar=async()=>{const B=acB(),it=acItem();if(!B||!it)return;if(AC.registrando)return;
  if(ok(it.real)){toast('Este produto já foi registrado. Para refazer, toque em Desfazer último.');return;}
  const fixo=window.insFixo&&insFixo(it.ins);
  if(!fixo&&!ok(it.ini)){toast('Sem peso inicial ainda');return;}
  let fim=A.peso!=null?pesoVisor():null;   /* final = balança EXATA no toque em registrar (não espera firmar) */if(fim==null&&!fixo){toast('Sem leitura da balança');return;}
  if(acItem()!==it||ok(it.real))return;
  if(fixo){regFixo(B,it,fim);fim=it.fim;}   // núcleo etc.: registra o previsto; o próximo começa do peso real da balança
  else{if(!(fim>it.ini)){toast('O peso não subiu desde o início');return;}
    it.fim=fim;it.real=fim-it.ini;it.hora=new Date().toTimeString().slice(0,5);it.tsReg=Date.now();}
  diagLog('carga',Object.assign({produto:it.nome,trato:B.trato,prev:it.prev,ini:it.ini,fim,real:it.real},resumoBal()));diagCurva('carga',it.nome,{prev:it.prev,ini:it.ini,fim,real:it.real,fixo:!!fixo});
  const k=B.itens.findIndex((x,j)=>j>B.atual&&!ok(x.real)),nx=k>=0?k:B.itens.findIndex(x=>!ok(x.real));
  if(nx>=0){B.atual=nx;const n=B.itens[nx];if(!ok(n.real)){n.ini=fim;n.fim=null;}}
  AC.idx=B.atual;acNovoProduto();pararSom();cSave();toast(`${it.nome}: ${nf(it.real)} kg`);cRender();
  if(nx<0)toast('Todos os produtos carregados. Toque em ✓ Finalizar carregamento.');};
/* "Próximo produto": se já carregou este produto, registra (e vai para o próximo); senão só passa para o próximo */
window.acProximo=()=>{const B=acB(),it=acItem();if(!B||!it)return;const c=cfg();
  if(!ok(it.real)&&window.insFixo&&insFixo(it.ins))return acRegistrar();   // registra o previsto ao passar para o próximo
  if(!ok(it.real)&&ok(it.ini)&&A.peso!=null&&(A.estavel?A.valEst:A.peso)>it.ini+Math.max(c.tol,5))return acRegistrar();
  if(B.atual>=B.itens.length-1)return;
  B.atual++;const n=B.itens[B.atual];
  if(!ok(n.real)){const pv=B.itens[B.atual-1];n.ini=ok(pv.fim)&&ok(pv.real)?pv.fim:(A.estavel?A.valEst:null);n.fim=null;}
  B.escolha=false;AC.idx=B.atual;acNovoProduto();pararSom();cSave();cRender();};
function acSyncTopo(){if(!$('acStatus'))return;
  $('acStatusTxt').textContent=A.status;$('acStatus').className='aStatus '+(A.statusTipo||'');
  ['ser','bt','ws','sim'].forEach(f=>$({ser:'acBtSer',bt:'acBtBt',ws:'acBtWs',sim:'acBtSim'}[f]).classList.toggle('on',A.fonte===f));
  pintarBtBal();$('acDesc').disabled=!A.fonte;$('acSimBox').hidden=A.fonte!=='sim';const tk=$('acTeclas');if(tk)tk.hidden=!(A.fonte==='bt'&&A.digiStar);}
function pintarCarga(){comPesoTela(pintarCarga0);}
function pintarCarga0(){
  if(!naCargaAuto()||!$('acPeso'))return;
  const prC=A.peso==null?null:pesoVisor();$('acPeso').textContent=prC==null?'—':fmt(prC);  // Balança: igual ao visor do indicador
  const e=$('acEstTxt');e.textContent=(A.peso==null?'sem leitura':A.estavel?'● Estável':'○ Oscilando')+idadeLeitura();e.className=atrasada()?'atraso':A.estavel?'est':'';
  if(!$('acFaltaBox'))return;
  const it=acItem(),z=zonaC(),fb=$('acFaltaBox');
  {const pz=!!(AC.pausa&&it&&!ok(it.real)),pb=$('acPausaBox');if(pb)pb.hidden=!pz;
    if($('acPausar'))$('acPausar').hidden=pz||!!AC.trava||!it||ok(it.real)||!A.fonte;
    if(pz){if($('acTravaBox'))$('acTravaBox').hidden=true;fb.style.display='none';const mi=document.querySelector('#acBox .aMini');if(mi)mi.style.display='none';if($('acReg'))$('acReg').style.display='none';
      $('acEtapa').textContent='⏸ Pausado no trajeto · toque no azul para continuar';$('acEtapa').className='aEtapa pausa';$('acEtapa').hidden=false;return;}}
  {const tv=!!(AC.trava&&it&&!ok(it.real)),bx=$('acTravaBox');if(bx){bx.hidden=!tv;if(tv&&$('acTravaNome').textContent!==it.nome){$('acTravaNome').textContent=it.nome;requestAnimationFrame(()=>caberTexto(bx));}}
    fb.style.display=tv?'none':'';const mi=document.querySelector('#acBox .aMini');if(mi)mi.style.display=tv?'none':'';if($('acReg'))$('acReg').style.display=tv?'none':'';
    if(tv){$('acEtapa').textContent='⏸ Balança pausada · toque no azul quando chegar no produto';$('acEtapa').className='aEtapa pausa';$('acEtapa').hidden=false;return;}}
  $('acIni').textContent=it&&ok(it.ini)?fmt(it.ini):'—';
  $('acAlvo').textContent=it&&ok(it.ini)?fmt(it.ini+it.prev):'—';
  $('acCarr').textContent=it&&ok(it.real)?fmt(it.real):z?fmt(z.carregado):'—';
  $('acFaltaTit').textContent=(z&&z.falta<0)?'PASSOU':'Carregar';
  if(z){$('acFalta').textContent=z.falta<0?'-'+fmt(-z.falta):fmt(z.falta);fb.className='aFalta '+z.z;
    $('acFaltaTxt').textContent=z.falta<0?'DO PREVISTO':z.falta===0?'NO PONTO!':'\u00a0';}
  else{$('acFalta').textContent=it?fmt(ok(it.real)?it.real:it.prev):'—';fb.className='aFalta cinza';
    $('acFaltaTxt').textContent=it&&ok(it.real)?'já carregado':A.fonte?'esperando peso inicial':'conecte a balança';}
  let txt,cl='';
  if(!A.fonte)txt='';
  else if(A.peso==null)txt='Esperando o peso chegar da balança…';
  else if(!it)txt='—';
  else if(ok(it.real))txt='✓ Já carregado · vá para o próximo produto';
  else if(!ok(it.ini))txt='Deixe o vagão parado para pegar o peso inicial';
  else if(AC.est==='carregando'){txt=A.estavel?'■ Parou de carregar':z&&z.caindo?`▲ Carregando ${it.nome} · ${fmt(z.taxa)} kg/s`:'■ Parou de carregar';cl='desc';}
  else{txt='Pronto pra carregar '+it.nome;cl='pronto';}
  $('acEtapa').textContent=txt;$('acEtapa').className='aEtapa '+cl;$('acEtapa').hidden=!txt;
  if($('acReg'))$('acReg').disabled=!(it&&!ok(it.real)&&((window.insFixo&&insFixo(it.ins))||(ok(it.ini)&&A.peso!=null&&A.peso>it.ini)))||modoVer;
}
$('acBox').addEventListener('click',e=>{const b=e.target.closest('[data-ac]');if(!b)return;const a=b.dataset.ac;
  if(a==='ser')return conectarSerial();if(a==='bt')return conectarBt();if(a==='ws')return conectarWs();if(a==='sim'){conectarSim();return cRender();}
  if(a==='desc'){perguntarDesconectar().then(f=>{if(f)cRender();});return;}
  if(a==='simSobe'){if(A.sim)A.sim.modo='sobe';return;}if(a==='simPara'){if(A.sim)A.sim.modo='parado';return;}
  if(a==='copiar'){copiar((A.btInfo?A.btInfo+'\n\n':'')+A.bruto.join('\n'),'Dados copiados');return;}
  if(a==='simZera'){if(A.sim){A.sim.modo='parado';A.sim.peso=0;}return;}
  if(a==='pegar'){if(bloqueado())return;const it=acItem();if(!it)return;if(A.peso==null){toast('Sem leitura da balança');return;}
    it.ini=pesoVisor();it.iniFix=true;it.lib=false;it.fim=null;it.real=null;acNovoProduto();cSave();cRender();toast('Peso inicial: '+fmt(it.ini)+' kg');}});
window.acAoAbrir=()=>{montar();if(!modoVer&&window.btAutoVoltar)btAutoVoltar();if(window.cLimparSetup)cLimparSetup();cRender();window.scrollTo({top:0});if(window.cBuscarRemoto)cBuscarRemoto();try{if(typeof gSync==='function')gSync(true).catch(()=>{});}catch(e){}};
$('tabAutoC').addEventListener('click',()=>aba('autoc'));

/* ---------------- Gestão › Config. (ajustes da balança, iguais em todos os aparelhos) ---------------- */
const CAMPOS=[['amarelo','🟡 Apito lento','kg faltando · fica amarelo'],['vermelho','🔴 Apito rápido','kg faltando · fica vermelho'],['continuo','🚨 Apito direto (bem rápido)','kg faltando · pisca'],
  ['antecipa','⏩ Antecipar cor e apito','segundos · compensa o atraso da balança'],
  ['filtro','🎚 Suavizar leituras (parado)','nº de leituras · 1 = sem filtro, 3 normal, 5 forte'],['enq','📡 Pedir peso à balança a cada','segundos (Digi-Star) · menor = mais leituras'],['prever','〰 Peso contínuo na tela','segundos entre leituras · 0 = desliga'],['tol','Variação aceita parado','kg'],['tempo','Tempo parado para firmar','segundos'],['minDesc','Mínimo que conta como descarga','kg']];
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
    <h3 class="gSub" style="margin-top:16px">📖 Como conectar a balança</h3>
    <ol class="note" style="padding-left:18px;margin:6px 0">
      <li>Feche o app <b>TAP Feed</b> (a balança aceita um aparelho por vez).</li>
      <li>Use o <b>Chrome</b>. Na Automação, toque em <b>🔷 Balança Bluetooth</b> e escolha <b>NEW EZ</b>.</li>
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
    <div class="curhead"><h2>🏷 Leitor de tag</h2></div>
    <label class="aChk"><input type="checkbox" id="cfgT_tag"> Usar Tag</label>
    <label class="aChk"><input type="checkbox" id="cfgT_inst"> Fornecer instantâneo (igual ao visor da balança)</label>
    <p class="note">Cada curral tem a sua tag (Gestão › Currais). Ao ler a tag de outro curral, o app registra o curral que estava fornecendo e passa para o curral da tag. Curral sem previsto: pergunta se quer fornecer mesmo assim. Tag sem curral (fim de linha) só registra o curral que estava fornecendo. Só funciona no Fornecer da Automação. Leituras repetidas da mesma tag são ignoradas. Se o leitor cair, continue no manual (trocar curral e Registrar).</p>
    <p class="note">Leitor aceito: Bluetooth BLE (serial) ou leitor tipo teclado (HID), que digita o código e dá Enter.</p>
  </section>
  <section class="panel">
    <div class="curhead"><h2>⏸ Hold da balança</h2></div>
    <label>Hold automático no trajeto (Digi-Star)</label>
    <select id="cfgT_hold"><option value="1">Ligado: vale o tablet (recomendado)</option><option value="2">Ligado pela tecla HOLD (reserva)</option><option value="0">Desligado</option></select>
    <p class="note">No Fornecer, com o quadro azul na tela (pausado ou esperando liberar o próximo curral), a balança fica em <b>HOLD</b>. Ao tocar para liberar ou continuar, o HOLD sai. Assim o balanço do trajeto não muda o peso.<br>No Carregar é igual: com o quadro azul do próximo produto (ou pausado), a balança fica em HOLD.<br><b>Vale o tablet:</b> o app manda "ligar" ou "soltar" (não é liga/desliga) e repete a cada 4 segundos. Se alguém apertar HOLD na balança, o tablet volta ao certo.<br><b>Pela tecla HOLD:</b> use só se a balança não obedecer ao modo recomendado. Nesse modo não aperte HOLD na balança na mão.</p>
  </section>
  <section class="panel">
    <div class="curhead"><h2>🔊 Apito</h2></div>
    <label class="aChk"><input type="checkbox" id="cfgT_som"> Apito ligado (sem vibração)</label>
    <p class="note">Funciona como sensor de ré: começa espaçado no amarelo e vai apertando até o direto, que é um bip bem rápido. Quando o peso para de cair, o apito para na hora.</p>
    <button id="cfgT_teste">🔊 Testar apito (lento → rápido → direto)</button>
    <button id="cfgT_padrao" style="margin-top:6px">Voltar ao padrão</button>
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
  if($('cfgT_hold'))$('cfgT_hold').onchange=e=>{const c=cfg();c.holdAuto=+e.target.value||0;salvarCfg();avisoCfg();holdSync();};
  if($('cfgT_inst'))$('cfgT_inst').onchange=e=>{const c=cfg();c.fornInst=e.target.checked?1:0;salvarCfg();avisoCfg();};
  $('cfgT_tag').onchange=e=>{const c=cfg();c.tagOn=e.target.checked?1:0;salvarCfg();avisoCfg();pintarTag();};
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
  <div><i class="pisca2" style="background:#000"></i>Preto piscando · passou do previsto (mostra quanto passou com sinal de menos), apito bem rápido</div>`;}
function preencherCfgT(){if(!$('cfgT_tol'))return;const c=cfg();pintarCores();
  CAMPOS.forEach(([k])=>{const el=$('cfgT_'+k);if(document.activeElement!==el)el.value=c[k];});
  if(document.activeElement!==$('cfgT_ws'))$('cfgT_ws').value=c.ws;if(document.activeElement!==$('cfgT_ble'))$('cfgT_ble').value=c.bleUuid||'';if(document.activeElement!==$('cfgT_cmd'))$('cfgT_cmd').value=c.bleCmd||'';$('cfgT_som').checked=!!c.som;if($('cfgT_hold'))$('cfgT_hold').value=String(+c.holdAuto||0);if($('cfgT_tag'))$('cfgT_tag').checked=!!c.tagOn;if($('cfgT_inst'))$('cfgT_inst').checked=+c.fornInst!==0;}
window.cfgTAoAbrir=()=>{montarCfgT();preencherCfgT();avisoCfg();
  try{if(typeof gSync==='function')gSync(true).then(()=>{if(!cfgNuvem())salvarCfg();preencherCfgT();avisoCfg();}).catch(()=>{});}catch(e){}};
/* puxa da nuvem ao abrir a Automação também, para pegar ajustes feitos em outro aparelho */
setInterval(()=>{const b=$('cfgTBox');if(b&&b.offsetParent)preencherCfgT();},3000);

/* ================= LEITOR DE TAG (RFID) =================
   Cada curral tem uma tag (Gestão › Currais). No Fornecer da automação (no manual a tag não faz nada):
   · tag de outro curral → registra o curral que estava fornecendo (automação) e passa para o curral da tag
   · curral sem previsto → aviso vermelho perguntando se fornece mesmo assim (sim: libera, sem meta)
   · curral já tratado → aviso vermelho perguntando se trata de novo (soma no trato)
   · tag sem curral (fim de linha) → só registra o curral que estava fornecendo
   · a mesma tag lida várias vezes seguidas → ignora até ler outra
   Leitor: Bluetooth BLE (serial) ou tipo teclado (HID). Se cair, segue tudo no manual. */
const TG={dev:null,ok:false,recon:false,mesma:null,ult:null,ultCur:'',ultT:0,hidT:0,captura:null,capMsg:null,fila:Promise.resolve(),buf:'',sim:false};
window.TAG=TG;
const normTag=t=>String(t||'').toUpperCase().replace(/[^0-9A-F]/g,'');
function curralDaTag(epc){try{const v=(G.it.currais&&!G.it.currais.del&&G.it.currais.v)||{};
  for(const n of S.cadastro){const t=normTag((v[n]||{}).tag);if(t&&t===epc)return n;}
  for(const n of S.cadastro){const t=normTag((v[n]||{}).tag);if(t&&t.length>=8&&epc.length>=8&&(epc.endsWith(t)||t.endsWith(epc)))return n;}}catch(e){}return null;}
function tagAviso(txt){document.querySelectorAll('[data-tagaviso]').forEach(el=>{el.textContent='⚠️ '+txt;el.hidden=false;});
  clearTimeout(tagAviso.t);tagAviso.t=setTimeout(()=>document.querySelectorAll('[data-tagaviso]').forEach(el=>el.hidden=true),9000);
  try{if(typeof tocar==='function'&&cfg().som){liberarSom();tocar('rapido');setTimeout(()=>{try{pararSom();}catch(e){}},900);}}catch(e){}}
/* Gestão › Currais › Ler tag: a próxima tag lida vai para o campo */
window.tagCaptura=(id,msg)=>{TG.captura=id;TG.capMsg=msg||null;if(!id)return;
  const el=$(id);if(el){el.focus();el.select&&el.select();}
  if(msg)msg.textContent=TG.ok?'Passe o leitor na tag deste curral…':'Passe o leitor na tag (leitor tipo teclado) ou toque em Conectar leitor no Fornecer. Também pode digitar o código.';
  if(!TG.ok&&!TG.dev&&navigator.bluetooth&&confirm('Conectar o leitor de tag Bluetooth agora?'))conectarTag();};
function tagLida(raw,forcar){const epc=normTag(raw);if(epc.length<8&&!forcar)return;
  TG.ult=epc;TG.ultT=Date.now();
  if(TG.captura){const el=$(TG.captura);if(el&&el.isConnected){el.value=epc;el.dispatchEvent(new Event('input',{bubbles:true}));const ja=curralDaTag(epc);
      if(TG.capMsg)TG.capMsg.textContent=ja?`Tag lida: ${epc} (esta tag está no ${ja})`:'Tag lida: '+epc+'. Toque em Salvar curral.';toast('Tag lida');}
    TG.captura=null;TG.mesma=epc;pintarTag();return;}
  if(!cfg().tagOn)return;
  const chave=forcar?'F:'+forcar:epc;
  if(chave===TG.mesma)return;   // a mesma tag repetida: ignora até ler outra
  TG.mesma=chave;
  TG.fila=TG.fila.then(()=>tagProcessar(epc,forcar)).catch(e=>console.warn('tag',e));}
window.tagLida=tagLida;
async function tagProcessar(epc,forcar){
  if(typeof modoVer!=='undefined'&&modoVer)return;
  const c=forcar==='__nenhum'?null:(forcar||curralDaTag(epc));TG.ultCur=c||'sem curral';pintarTag();
  const ff=filtroForn();if(window.abaAtual!=='auto'||!ff)return;   // só no Fornecer da automação (no manual a tag não faz nada)
  const L=lista(),cur=L[S.atual];
  if(cur&&c===cur.nome)return;   // já está neste curral
  if(A.est==='descarregando'&&cur){await registrarAuto();}   // passou para outro curral: fecha o que estava fornecendo
  if(!c){pintarTag();return;}   // tag sem curral (fim de linha): só finaliza
  let i=lista().findIndex(x=>x.nome===c);
  if(i<0){tagAviso(`${c}: sem previsto no Trato ${S.tratoSel}`);
    const ok=window.confirmaVermelho?await confirmaVermelho(`${c} sem previsto`,`O ${c} não tem previsto no Trato ${S.tratoSel}. Fornecer mesmo assim? O que cair fica registrado neste curral.`,'Sim, fornecer','Não'):confirm(`${c} sem previsto. Fornecer mesmo assim?`);
    if(!ok)return;
    const f=filtroForn();if(!f)return;f.extra=f.extra||{};const k=String(S.tratoSel);f.extra[k]=Object.assign({},f.extra[k],{[c]:1});save();
    i=lista().findIndex(x=>x.nome===c);if(i<0){toast(`${c} está inativo`);return;}}
  else if(feito(c,regsAtuais())){
    const ok=window.confirmaVermelho?await confirmaVermelho(`${c} já foi tratado`,`O ${c} já tem trato no Trato ${S.tratoSel}. Tratar de novo? O que fornecer agora soma no trato deste curral.`,'Sim, tratar de novo','Não'):confirm(`${c} já foi tratado. Tratar de novo?`);
    if(!ok)return;A.tagRepetir=c;}
  const j=lista().findIndex(x=>x.nome===c);if(j<0)return;
  setAtual(j);$('aEscolha')&&($('aEscolha').hidden=true);novoCurral(true,true);{const pv=pesoVisor();if(pv!=null){A.base=pv;A.baseConf=true;A.baseFix=true;A.baseCur=(curralAtual()||{}).nome||null;}}A.pausa=null;save();   /* leu a tag do curral: chegou nele, já libera (peso inicial = balança exata desse momento) */
  render();aRender();
  toast(`🏷 ${c}`);}
/* ---- leitor tipo teclado (HID): digita o código bem rápido e dá Enter ---- */
{let kb='',kbT=0,kbIni=0,alvo=null;
  document.addEventListener('keydown',e=>{const t=Date.now();if(t-kbT>60){kb='';kbIni=t;alvo=e.target;}kbT=t;
    if(e.key==='Enter'){const cod=normTag(kb),rapido=kb.length>=8&&(t-kbIni)<kb.length*60;kb='';
      if(!rapido||cod.length<8)return;
      const ed=alvo&&(alvo.tagName==='INPUT'||alvo.tagName==='TEXTAREA')&&!alvo.readOnly;
      if(ed&&!(TG.captura&&alvo.id===TG.captura))return;   // digitando num campo: deixa
      if(TG.captura&&alvo&&alvo.id===TG.captura)e.preventDefault();
      TG.hidT=t;tagLida(cod);return;}
    if(e.key&&e.key.length===1)kb+=e.key;},true);}
/* ---- leitor Bluetooth BLE (serial) ---- */
function tagDados(v){const txt=txtDe(v);TG.ultDado=Date.now();
  TG.buf=(TG.buf+txt).slice(-600);let achou=false;
  const re=/EPC\s*[:=]?\s*([0-9A-F]{8,})/gi;let m,ultFim=0;while((m=re.exec(TG.buf))){if(/[;\r\n,\s]/.test(TG.buf[re.lastIndex]||'')||re.lastIndex<TG.buf.length){tagLida(m[1]);achou=true;ultFim=re.lastIndex;}}
  if(achou){TG.buf=TG.buf.slice(ultFim);return;}
  const partes=TG.buf.split(/[;\r\n]+/);TG.buf=partes.pop();
  for(const p of partes){const h=p.trim();if(/^[0-9A-F\s]{8,}$/i.test(h)&&normTag(h).length>=8){tagLida(h);achou=true;}}
  if(!achou&&/·/.test(txt)){const hx=normTag(hexDe(v)),m2=hx.match(/(E2[0-9A-F]{22}|30[0-9A-F]{22})/);if(m2)tagLida(m2[1]);}}  // leitor que manda bytes
async function conectarTag(){
  if(!navigator.bluetooth){toast('Este aparelho/navegador não tem Bluetooth BLE para apps. Use o Chrome no Android.');return;}
  try{const dev=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:servicosBle()});
    if(TG.dev&&TG.dev!==dev)tagDesconectar(true);TG.dev=dev;try{localStorage.setItem('tagUltimo',dev.id||'');}catch(e){}
    if(!dev._tagQueda){dev._tagQueda=true;dev.addEventListener('gattserverdisconnected',()=>{if(TG.dev!==dev||dev._tagManual)return;TG.ok=false;pintarTag();toast('⚠️ Leitor de tag desconectou: siga no manual');tagReconectar();});}
    await tagAbrir(dev);}
  catch(e){if(!(e&&e.name==='NotFoundError'))toast('Leitor de tag: '+(e.message||e));pintarTag();}}
window.conectarTag=conectarTag;
async function tagAbrir(dev){TG.estado='conectando';pintarTag();
  const srv=await dev.gatt.connect();let servs=[];try{servs=await srv.getPrimaryServices();}catch(e){}let n=0;
  for(const sv of servs){if(/^0000(180a|1800|1801|180f)-/.test(sv.uuid))continue;let cs=[];try{cs=await sv.getCharacteristics();}catch(e){}
    for(const c of cs){const p=c.properties;if(p.notify||p.indicate){try{await c.startNotifications();c.addEventListener('characteristicvaluechanged',ev=>tagDados(ev.target.value));n++;}catch(e){}}}}
  TG.ok=n>0;TG.estado=n?'ok':'semCanal';pintarTag();
  if(n)toast('Leitor de tag conectado');else toast('Conectou, mas o leitor não manda dados por este canal');}
async function tagReconectar(){const dev=TG.dev;if(!dev||TG.recon)return;TG.recon=true;let n=0;
  try{while(TG.dev===dev&&!TG.ok&&n<200){n++;TG.estado='reconectando';pintarTag();await new Promise(r=>setTimeout(r,n===1?800:4000));if(TG.dev!==dev)break;
      try{await tagAbrir(dev);}catch(e){}}}finally{TG.recon=false;pintarTag();}}
function tagDesconectar(quieto){const dev=TG.dev;TG.dev=null;TG.ok=false;TG.estado='';if(dev){dev._tagManual=true;try{dev.gatt.disconnect();}catch(e){}}
  try{localStorage.removeItem('tagUltimo');}catch(e){}if(!quieto)toast('Leitor de tag desconectado');pintarTag();}
window.tagAutoVoltar=async()=>{try{if(TG.dev||!cfg().tagOn||!navigator.bluetooth||!navigator.bluetooth.getDevices)return;const id=localStorage.getItem('tagUltimo');if(!id)return;
  const dev=(await navigator.bluetooth.getDevices()).find(d=>d.id===id);if(!dev)return;TG.dev=dev;
  if(!dev._tagQueda){dev._tagQueda=true;dev.addEventListener('gattserverdisconnected',()=>{if(TG.dev!==dev||dev._tagManual)return;TG.ok=false;pintarTag();tagReconectar();});}
  try{await tagAbrir(dev);}catch(e){tagReconectar();}}catch(e){}};
setTimeout(()=>{try{tagAutoVoltar();}catch(e){}},3000);
/* ---- barrinha do leitor no Fornecer da automação ---- */
function pintarTag(){if(typeof S==='undefined'||!S)return;const on=!!cfg().tagOn,hid=TG.hidT&&Date.now()-TG.hidT<15*60000;
  const st=TG.ok?'ok':TG.dev?'err':'';
  const t=TG.ok?`🏷 Leitor de tag conectado${TG.dev&&TG.dev.name?' ('+esc(TG.dev.name)+')':''}`:
    TG.dev?(TG.estado==='semCanal'?'🏷 Leitor conectou, mas não manda dados':'⚠️ Leitor de tag caiu · reconectando… siga no manual'):
    hid?'🏷 Leitor de tag (teclado) ativo':'🏷 Leitor de tag desconectado · trato manual';
  const ult=TG.ult?`<small>Última: ${esc(TG.ultCur||'')}${TG.ultCur?' · ':''}${esc(TG.ult.slice(-8))} às ${new Date(TG.ultT).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</small>`:'';
  const opts=()=>{let h='';try{const v=(G.it.currais&&G.it.currais.v)||{};h=S.cadastro.map(n=>`<option value="${esc(n)}">${esc(n)}${v[n]&&v[n].tag?' 🏷':''}</option>`).join('');}catch(e){}return h+'<option value="__nenhum">Tag sem curral (fim de linha)</option>';};
  const sig=[on,t,ult,!!TG.dev,TG.sim,(S.cadastro||[]).length].join('|');
  document.querySelectorAll('[data-tagbt]').forEach(b=>{const h=true||!on||(typeof modoVer!=='undefined'&&modoVer);b.hidden=h; /* botão de tag tirado por enquanto (volta trocando o true) */if(b.parentNode)b.parentNode.classList.toggle('comTag',!h);
    b.className='aTagBt'+(st==='ok'?' tgOk':st==='err'?' tgErr':'');b.textContent=TG.ok?'🏷 Tag ✓':TG.dev?'🏷 Tag …':'🏷 Tag';
    b.title=t.replace(/^\S+\s/,'');});
  /* a barrinha do leitor saiu da tela: agora é o botão 🏷 Tag dentro da setinha da balança */
  document.querySelectorAll('[data-tagbar]').forEach(el=>{el.hidden=true;if(el.hidden)return;if(el.dataset.sig===sig)return;el.dataset.sig=sig;
    el.className='tagBar'+(st==='ok'?' tgOk':st==='err'?' tgErr':'');
    const simAb=el.querySelector('.tgSim'),selV=simAb&&simAb.querySelector('select')?simAb.querySelector('select').value:null;
    el.innerHTML=`<span class="tgTxt">${t}${ult}</span>${TG.dev?'<button type="button" data-tagdesc>Desconectar</button>':'<button type="button" class="lima" data-tagcon>Conectar leitor</button>'}<button type="button" data-tagsimtog title="Simular leitura de tag">🧪</button>${TG.sim?`<div class="tgSim"><select>${opts()}</select><button type="button" data-tagsim>Ler tag</button></div>`:''}`;
    if(selV&&el.querySelector('.tgSim select'))el.querySelector('.tgSim select').value=selV;});}
window.pintarTag=pintarTag;
document.addEventListener('click',e=>{
  if(e.target.closest('[data-tagcon]'))return conectarTag();
  if(e.target.closest('[data-tagbt]')){if(TG.dev){if(confirm('Leitor de tag conectado. Desconectar? O trato segue no manual.'))tagDesconectar();}else conectarTag();return;}
  if(e.target.closest('[data-tagdesc]')){if(confirm('Desconectar o leitor de tag? O trato segue no manual.'))tagDesconectar();return;}
  if(e.target.closest('[data-tagsimtog]')){TG.sim=!TG.sim;pintarTag();return;}
  const b=e.target.closest('[data-tagsim]');if(b){const v=b.parentNode.querySelector('select').value;let epc='SIM'+Date.now();
    if(v!=='__nenhum'){try{const t=normTag(((G.it.currais&&G.it.currais.v)||{})[v]&&G.it.currais.v[v].tag);if(t)epc=t;}catch(e){}}
    tagLida(epc,v==='__nenhum'?'__nenhum':(curralDaTag(normTag(epc))?null:v));}});
setInterval(()=>{try{pintarTag();}catch(e){}},3000);
setTimeout(()=>{try{pintarTag();}catch(e){}},800);
})();

'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const store={
  get(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},
  set(k,v){localStorage.setItem(k,JSON.stringify(v))}
};
const state={
  ws:null,connected:false,canAdmin:true,relay:null,relayOnline:false,healthBusy:false,presenceBusy:false,
  onlineCodes:new Set(),presenceKnown:new Set(),incoming:new Map(),audioCtx:null,audioNext:{65:0,77:0},
  remoteW:0,remoteH:0,frameAt:0,fps:0,mbps:0,
  pointers:new Map(),gesture:null,longPressTimer:null,longPressFired:false,dragging:false,moved:false,
  cursor:{x:.5,y:.5},lastPointer:null,zoom:1,panX:0,panY:0,
  keyboardComposing:false,edgeGesture:null,menuOpen:false,quickPasswordTarget:null,panGesture:null,
  modifiers:new Set(),ctrlHoldTimer:null,ctrlLong:false,fullscreenFallback:false,sharpTimer:null,lastFocusProbeAt:0,
  currentCode:null,lastThumbAt:0,mouseDragArmTimer:null,mouseDragArmed:false,
  pendingFrame:null,frameDecoding:false,pendingMouseMove:null,mouseMoveRaf:0,
  lastTapAt:0,lastTapPos:null,doubleTapDrag:false,focusProbeTimer:null,keyboardProbeArmed:false,
  interactionBurstTimer:null,interactionBurst:false,postInputTimers:[],
  cursorShape:'arrow',cursorEditable:false,cursorNumeric:false,cursorProbeAt:0,
  remotePath:'',remoteParent:'',remoteEntries:[],remoteSelected:new Set(),receivedReady:[],
  remotePermissions:{audio:true,microphone:true,full_control:true},keyboardReframeTimers:[]
};
const settings=Object.assign({
  quality:'balanced',savePasswords:false,autoAudio:true,autoMic:true,pointerMode:'mouse'
},store.get('settings',{}));
// WEB32 changes the connection default to audio + remote microphone enabled.
// Migrate existing installs once; afterwards the user's manual choice is preserved.
if(!store.get('web32AudioDefaultsMigrated',false)){
  settings.autoAudio=true;settings.autoMic=true;store.set('settings',settings);store.set('web32AudioDefaultsMigrated',true);
}
let favorites=store.get('favorites',[]);
let history=store.get('history',[]);
let thumbnails=store.get('thumbnails',{});

function toast(msg){
  const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');
  clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.add('hidden'),2400);
}
function cleanId(v){return (v||'').replace(/\D/g,'').slice(0,6)}
function wsSend(o){if(state.ws&&state.ws.readyState===1)state.ws.send(JSON.stringify(o))}
function setStatus(msg){$('#connectStatus').textContent=msg;$('#sessionMeta').textContent=msg}
function showView(id){
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===id));
  $('#bottomNav').style.display=id==='sessionView'?'none':'flex';
  $$('#bottomNav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id));
  const active=id==='sessionView';
  document.documentElement.classList.toggle('session-active',active);
  document.body.classList.toggle('session-active',active);
}

function qProfile(){
  // O iPhone não precisa receber um JPEG 4K inteiro em 100% de zoom.
  // A resolução sobe dinamicamente apenas quando o usuário realmente amplia.
  return settings.quality==='quality'?[1920,1080,'contain']:
         settings.quality==='speed'?[1280,720,'contain']:[1600,900,'contain'];
}
function streamTuning(){
  // Keep the encoder below saturation. A saturated JPEG encoder feels slower than
  // a slightly lower FPS stream because pointer/input packets wait behind frames.
  return settings.quality==='quality'?{fps:24,jpeg_quality:82,subsampling:2}:
         settings.quality==='speed'?{fps:36,jpeg_quality:60,subsampling:2}:{fps:30,jpeg_quality:72,subsampling:2};
}
function adaptiveDimensions(){
  let [w,h]=qProfile();
  if(state.zoom>=1.45){w=Math.max(w,1920);h=Math.max(h,1080)}
  if(state.zoom>=2.15){w=Math.max(w,2560);h=Math.max(h,1440)}
  if(state.zoom>=3.25){w=Math.max(w,settings.quality==='quality'?3840:3200);h=Math.max(h,settings.quality==='quality'?2160:1800)}
  return [w,h];
}
function sendAdaptiveStreamProfile(reason='view'){
  if(!state.connected)return;
  const [w,h]=adaptiveDimensions(),t=streamTuning();
  wsSend({type:'screen_profile',width:w,height:h,fit:false,reason});
  wsSend({type:'stream_tuning',width:w,height:h,fps:t.fps,jpeg_quality:t.jpeg_quality,subsampling:t.subsampling,reason});
}
function noteInteraction(){
  if(!state.connected)return;
  clearTimeout(state.interactionBurstTimer);
  if(!state.interactionBurst){
    state.interactionBurst=true;
    // 720p is still readable on a phone, while 38 FPS leaves CPU/network headroom
    // for mouse packets. 45 FPS at 576p was able to saturate slower Windows hosts.
    wsSend({type:'screen_profile',width:1280,height:720,fit:false,reason:'interactive'});
    wsSend({type:'stream_tuning',width:1280,height:720,fps:38,jpeg_quality:58,subsampling:2,reason:'interactive'});
  }
  state.interactionBurstTimer=setTimeout(()=>{state.interactionBurst=false;sendAdaptiveStreamProfile('settled')},320);
}
function postInputRefresh(reason='input'){
  // request_frame is an event, not a frame queue. Coalescing avoids repeatedly
  // waking the encoder after one click/keystroke and keeps input ahead of video.
  for(const t of state.postInputTimers)clearTimeout(t);state.postInputTimers=[];
  for(const ms of [0,85,220])state.postInputTimers.push(setTimeout(()=>{
    if(state.connected)wsSend({type:'request_frame',reason});
  },ms));
  state.postInputTimers.push(setTimeout(()=>sendAdaptiveStreamProfile('post_'+reason),360));
}

function uniqueCodes(){
  const vals=[cleanId($('#remoteId').value),...history.map(x=>x.id),...favorites.map(x=>x.id)];
  return [...new Set(vals.filter(x=>x&&x.length===6))].slice(0,50);
}
function setRelayBadge(mode,text){
  const el=$('#relayBadge');el.classList.remove('online','offline','checking');el.classList.add(mode);
  $('#relayBadge span').textContent=text;
}
async function readRelayConfig(){
  const r=await fetch('relay.json?ts='+Date.now(),{cache:'no-store'});
  if(!r.ok)throw new Error('relay.json indisponível');
  const j=await r.json();
  if(!j||!/^wss:\/\//.test(j.url||''))throw new Error('relay inválido');
  return j.url;
}
function probeRelay(url,timeoutMs=5500){
  return new Promise(resolve=>{
    let done=false,ws,timer;
    const finish=ok=>{
      if(done)return;done=true;clearTimeout(timer);
      try{ws&&ws.close(1000)}catch{}
      resolve(ok);
    };
    try{
      ws=new WebSocket(url);
      timer=setTimeout(()=>finish(false),timeoutMs);
      ws.onopen=()=>ws.send(JSON.stringify({
        type:'hello',role:'probe',client:'chv-remote-pwa',version:25,nonce:String(Date.now())+Math.random()
      }));
      ws.onmessage=e=>{
        if(typeof e.data!=='string')return;
        try{
          const o=JSON.parse(e.data);
          finish(o.type==='health'&&o.status==='ok'&&o.service==='chv-relay');
        }catch{finish(false)}
      };
      ws.onerror=()=>finish(false);
      ws.onclose=()=>{if(!done)finish(false)};
    }catch{finish(false)}
  });
}
async function refreshRelayHealth(){
  if(state.healthBusy)return state.relayOnline;
  state.healthBusy=true;
  if(!state.relayOnline)setRelayBadge('checking','Verificando servidor…');
  try{
    const configured=await readRelayConfig();
    const ok=await probeRelay(configured);
    state.relay=configured;state.relayOnline=ok;
    if(ok){
      setRelayBadge('online','Servidor online');
      refreshPresence();
    }else{
      setRelayBadge('offline','Servidor offline');
      state.onlineCodes.clear();state.presenceKnown.clear();renderLists();renderCurrentPcStatus();
    }
    return ok;
  }catch{
    state.relayOnline=false;setRelayBadge('offline','Servidor offline');
    state.onlineCodes.clear();state.presenceKnown.clear();renderLists();renderCurrentPcStatus();return false;
  }finally{state.healthBusy=false}
}
function probePresence(url,codes,timeoutMs=5000){
  if(!url||!codes.length)return Promise.resolve(new Set());
  return new Promise((resolve,reject)=>{
    let done=false,ws,timer;
    const finish=(err,online)=>{
      if(done)return;done=true;clearTimeout(timer);try{ws&&ws.close(1000)}catch{}
      err?reject(err):resolve(online||new Set());
    };
    try{
      ws=new WebSocket(url);
      timer=setTimeout(()=>finish(new Error('timeout')),timeoutMs);
      ws.onopen=()=>ws.send(JSON.stringify({type:'hello',role:'presence',codes}));
      ws.onmessage=e=>{
        if(typeof e.data!=='string')return;
        try{
          const o=JSON.parse(e.data);
          if(o.type!=='presence')return finish(new Error('presence inválida'));
          finish(null,new Set((Array.isArray(o.online_codes)?o.online_codes:[]).map(String)));
        }catch(err){finish(err)}
      };
      ws.onerror=()=>finish(new Error('socket'));
      ws.onclose=()=>{if(!done)finish(new Error('closed'))};
    }catch(err){finish(err)}
  });
}
async function refreshPresence(){
  if(state.presenceBusy||!state.relayOnline||!state.relay)return;
  const codes=uniqueCodes();
  if(!codes.length){state.onlineCodes.clear();state.presenceKnown.clear();renderLists();renderCurrentPcStatus();return}
  state.presenceBusy=true;
  try{
    state.onlineCodes=await probePresence(state.relay,codes);
    state.presenceKnown=new Set(codes);
    renderLists();renderCurrentPcStatus();
  }catch{
    // Não transforma "desconhecido" em offline quando só a consulta de presença falhar.
  }finally{state.presenceBusy=false}
}
function renderCurrentPcStatus(){
  const id=cleanId($('#remoteId').value),box=$('#remoteStatus'),txt=$('#remoteStatusText');
  box.classList.remove('online','offline','unknown');
  if(id.length!==6){box.classList.add('unknown');txt.textContent='Digite o ID para verificar o computador';return}
  if(!state.relayOnline){box.classList.add('offline');txt.textContent='Servidor CHV Remote está offline';return}
  if(!state.presenceKnown.has(id)){box.classList.add('unknown');txt.textContent='Verificando computador…';return}
  if(state.onlineCodes.has(id)){box.classList.add('online');txt.textContent='Computador online';return}
  box.classList.add('offline');txt.textContent='Computador offline';
}
function updateConnectButton(){
  const id=cleanId($('#remoteId').value);$('#remoteId').value=id;
  $('#connectBtn').disabled=state.connected||!state.relayOnline||id.length!==6||$('#remotePassword').value.length<4;
}
function schedulePresence(){
  clearTimeout(schedulePresence._t);
  schedulePresence._t=setTimeout(()=>refreshPresence(),350);
}

async function connect(){
  const code=cleanId($('#remoteId').value),secret=$('#remotePassword').value;
  state.remotePermissions={audio:true,microphone:true,full_control:true};
  // connect() originates from a real tap, so resume WebAudio here while iOS still
  // considers it a user gesture. The host permission still decides what is sent.
  try{await ensureAudio()}catch{}
  if(code.length!==6||secret.length<4)return toast('Informe o ID de 6 dígitos e a senha.');
  if(!state.relayOnline){
    const ok=await refreshRelayHealth();
    if(!ok)return toast('Servidor CHV Remote está offline.');
  }
  $('#connectBtn').disabled=true;setStatus('Conectando ao computador…');
  showView('sessionView');$('#sessionTitle').textContent='ID '+code;resetViewTransform();
  try{
    const url=state.relay||await readRelayConfig();
    const ws=new WebSocket(url);state.ws=ws;ws.binaryType='arraybuffer';
    const timeout=setTimeout(()=>{if(!state.connected){try{ws.close()}catch{};failed('Tempo de conexão esgotado')}},18000);
    ws.onopen=()=>wsSend({type:'hello',role:'control',code,secret});
    ws.onmessage=e=>handleMessage(e,code,secret,timeout);
    ws.onerror=()=>{if(!state.connected)failed('Falha ao conectar ao servidor')};
    ws.onclose=()=>{
      if(state.connected){
        state.connected=false;state.onlineCodes.delete(code);toast('Computador desconectado');
        showView('homeView');renderLists();renderCurrentPcStatus();
      }
      updateConnectButton();
    };
  }catch(e){failed(e.message||'Falha na conexão')}
}
function failed(msg){
  setStatus(msg);toast(msg);showView('homeView');state.connected=false;
  updateConnectButton();refreshPresence();
}
function handleMessage(e,code,secret,timeout){
  if(typeof e.data==='string'){
    let o;try{o=JSON.parse(e.data)}catch{return}
    if(o.type==='pending_approval'){setStatus('Aguardando aprovação no computador…');return}
    if(o.type==='error'){
      clearTimeout(timeout);
      const m=o.code==='bad_password'?'Senha incorreta':o.code==='host_offline'?'Computador offline':o.message||'Conexão recusada';
      if(o.code==='host_offline')state.onlineCodes.delete(code);
      failed(m);try{state.ws.close()}catch{};return;
    }
    if(o.type==='ready'&&o.paired){
      clearTimeout(timeout);state.connected=true;
      state.canAdmin=((o.access_level||o.access||'admin')+'').toLowerCase()!=='basic';
      state.onlineCodes.add(code);setStatus('Conectado');state.currentCode=code;
      sendAdaptiveStreamProfile('connect');setTimeout(requestSharpFrame,160);
      saveConnection(code,secret);
      $('#actionAudioBtn')?.classList.toggle('active',!!settings.autoAudio);
      $('#actionMicBtn')?.classList.toggle('active',!!settings.autoMic);
      if(settings.autoAudio)ensureAudio().then(()=>setFeature('system_audio',true)).catch(()=>{});
      if(settings.autoMic)ensureAudio().then(()=>setFeature('microphone',true)).catch(()=>{});
      applyPointerMode(settings.pointerMode);applyCursorState({shape:'arrow',editable:false});setTimeout(()=>probeCursorState(true),120);renderLists();renderCurrentPcStatus();
      return;
    }
    if(o.type==='peer_status'&&(o.connected===false||o.online===false)){
      state.onlineCodes.delete(code);toast('Computador remoto desconectou');disconnect();return;
    }
    if(['text_focus','editable_focus','input_focus'].includes(o.type)){
      const editable=o.editable!==false&&o.focused!==false;
      applyCursorState({shape:o.shape||(editable?'ibeam':state.cursorShape),editable,numeric:!!o.numeric});
      resolveTextFocus(editable,!!o.numeric);
      return;
    }
    if(o.type==='cursor_state'){applyCursorState(o);return}
    if(o.type==='permission_state'){
      state.remotePermissions={
        audio:o.audio!==false,
        microphone:o.microphone!==false,
        full_control:o.full_control!==false&&o.elevated!==false
      };
      const ab=$('#actionAudioBtn'),mb=$('#actionMicBtn');
      if(ab){ab.disabled=!state.remotePermissions.audio;ab.classList.toggle('active',state.remotePermissions.audio&&!!settings.autoAudio)}
      if(mb){mb.disabled=!state.remotePermissions.microphone;mb.classList.toggle('active',state.remotePermissions.microphone&&!!settings.autoMic)}
      if(state.remotePermissions.audio&&settings.autoAudio)ensureAudio().then(()=>setFeature('system_audio',true)).catch(()=>{});
      else if(!state.remotePermissions.audio)setFeature('system_audio',false,true);
      if(state.remotePermissions.microphone&&settings.autoMic)ensureAudio().then(()=>setFeature('microphone',true)).catch(()=>{});
      else if(!state.remotePermissions.microphone)setFeature('microphone',false,true);
      return;
    }
    if(o.type==='secure_attention_result'){toast(o.ok?'Ctrl + Alt + Del executado':'Não foi possível executar Ctrl + Alt + Del neste computador');postInputRefresh('secure_attention_result');return}
    if(o.type==='reveal_received_folder_result'){toast(o.ok?'Pasta CHV Remote aberta no computador':'Não foi possível abrir a pasta no computador');return}
    if(o.type==='file_list'){renderRemoteFileList(o);return}
    if(o.type==='file_list_error'){toast('Não foi possível abrir essa pasta no computador');return}
    if(o.type==='file_offer'){acceptFile(o);return}
    if(o.type==='permission_denied')toast(o.message||'Ação bloqueada pelo computador remoto');
    return;
  }
  handleBinary(new Uint8Array(e.data));
}
function handleBinary(u){
  if(!u.length)return;
  const m=u[0];if(m===70)return frame(u);if(m===65||m===77)return audioPacket(u);if(m===68)return fileChunk(u);
}
function be32(u,o){return ((u[o]<<24)>>>0)+(u[o+1]<<16)+(u[o+2]<<8)+u[o+3]}
function be16(u,o){return (u[o]<<8)+u[o+1]}
function frame(u){
  if(u.length<10)return;
  // Nunca deixa decodificação antiga formar fila no Safari. Guarda somente o frame mais recente.
  if(state.frameDecoding){state.pendingFrame=u;return}
  renderFrame(u);
}
function renderFrame(u){
  if(u.length<10)return;
  state.frameDecoding=true;
  state.remoteW=be32(u,1);state.remoteH=be32(u,5);
  const now=performance.now(),dt=Math.max(1,now-state.frameAt);state.frameAt=now;
  const ifps=1000/dt,imbps=(u.length*8/1e6)/(dt/1000);
  state.fps=state.fps?state.fps*.82+ifps*.18:ifps;
  state.mbps=state.mbps?state.mbps*.82+imbps*.18:imbps;
  $('#fpsMetric').textContent=state.fps.toFixed(0)+' FPS';
  $('#mbpsMetric').textContent=state.mbps.toFixed(1)+' Mbps';
  const blob=new Blob([u.slice(9)],{type:'image/jpeg'}),url=URL.createObjectURL(blob),img=$('#remoteScreen'),old=img.dataset.url;
  const done=()=>{
    state.frameDecoding=false;
    const next=state.pendingFrame;state.pendingFrame=null;
    if(next)requestAnimationFrame(()=>renderFrame(next));
  };
  img.onload=()=>{
    if(old)URL.revokeObjectURL(old);
    $('#screenPlaceholder').style.display='none';
    updateCursorVisual();saveThumbnail(false);done();
  };
  img.onerror=()=>{URL.revokeObjectURL(url);done()};
  img.dataset.url=url;img.src=url;
}

function imageBox(){
  const img=$('#remoteScreen'),r=img.getBoundingClientRect();
  const iw=state.remoteW||Math.max(1,r.width),ih=state.remoteH||Math.max(1,r.height);
  const scale=Math.min(r.width/iw,r.height/ih),dw=iw*scale,dh=ih*scale;
  return {left:r.left+(r.width-dw)/2,top:r.top+(r.height-dh)/2,width:dw,height:dh};
}
function normalizedPoint(x,y){
  const b=imageBox();
  return {
    x:Math.max(0,Math.min(1,(x-b.left)/Math.max(1,b.width))),
    y:Math.max(0,Math.min(1,(y-b.top)/Math.max(1,b.height)))
  };
}
function flushMouseMove(){
  if(state.mouseMoveRaf){cancelAnimationFrame(state.mouseMoveRaf);state.mouseMoveRaf=0}
  const item=state.pendingMouseMove;state.pendingMouseMove=null;
  if(item&&state.connected)wsSend({type:'input',kind:'mouse',action:'move',x:item.p.x,y:item.p.y,...item.extra});
}
function queueMouseMove(p,extra={}){
  state.pendingMouseMove={p:{x:p.x,y:p.y},extra:{...extra}};
  if(!state.mouseMoveRaf)state.mouseMoveRaf=requestAnimationFrame(()=>{state.mouseMoveRaf=0;flushMouseMove()});
}
function sendMouse(action,p,extra={}){
  if(!state.connected)return;
  noteInteraction();
  if(action==='move'){queueMouseMove(p,extra);return}
  flushMouseMove();
  wsSend({type:'input',kind:'mouse',action,x:p.x,y:p.y,...extra});
}
function requestImmediateFrame(reason='input'){
  if(!state.connected)return;
  wsSend({type:'request_frame',reason});
}
function clickAt(p,button='left'){
  sendMouse('down',p,{button});sendMouse('up',p,{button});
  postInputRefresh(button==='right'?'right_click':'click');
}
function armKeyboardProbe(numeric=false){
  const input=$('#nativeKeyboardInput');
  clearTimeout(state.focusProbeTimer);state.keyboardProbeArmed=true;
  // Never use inputmode=none here. iOS remembers the suppressed keyboard for the
  // trusted tap and may refuse a later asynchronous refocus from text_focus.
  input.setAttribute('inputmode',numeric?'numeric':'text');input.value='';
  try{input.focus({preventScroll:true});input.setSelectionRange(0,0)}catch{}
  state.focusProbeTimer=setTimeout(()=>{
    if(!state.keyboardProbeArmed)return;
    state.keyboardProbeArmed=false;try{input.blur()}catch{}
  },850);
}
function syncKeyboardViewport(){
  const session=$('#sessionView'),vv=window.visualViewport;
  if(!session||!vv)return false;
  const covered=Math.max(0,window.innerHeight-(vv.height+vv.offsetTop));
  const open=covered>110||vv.height<window.innerHeight*.78;
  session.classList.toggle('keyboard-visible',open);
  if(open){
    session.style.setProperty('--keyboard-vh',Math.max(260,vv.height)+'px');
    session.style.setProperty('--keyboard-offset',Math.max(0,vv.offsetTop)+'px');
  }else{
    session.style.removeProperty('--keyboard-vh');session.style.removeProperty('--keyboard-offset');
  }
  return open;
}
function clearKeyboardReframeTimers(){for(const t of state.keyboardReframeTimers)clearTimeout(t);state.keyboardReframeTimers=[]}
function focusRemoteFieldView(){
  if(!state.connected)return;
  syncKeyboardViewport();
  const wr=$('#screenWrap').getBoundingClientRect();
  if(wr.height<100)return;
  const vv=window.visualViewport;
  const compact=vv&&vv.height<window.innerHeight*.72;
  const minZoom=compact?2.05:1.72;
  if(state.zoom<minZoom)state.zoom=minZoom;
  const f=fitImageBase(),scaledW=f.width*state.zoom,scaledH=f.height*state.zoom;
  // Work in screenWrap-local coordinates. Desired Y is deliberately high so the
  // caret/password field and the following line remain visible above the keyboard.
  const targetY=Math.max(54,Math.min(wr.height*.30,168));
  const cursorY=wr.height/2+state.panY+(state.cursor.y-.5)*scaledH;
  state.panY+=targetY-cursorY;
  const leftGuard=Math.max(48,wr.width*.16),rightGuard=wr.width-leftGuard;
  const cursorX=wr.width/2+state.panX+(state.cursor.x-.5)*scaledW;
  if(cursorX<leftGuard)state.panX+=leftGuard-cursorX;
  else if(cursorX>rightGuard)state.panX-=cursorX-rightGuard;
  clampPan();applyTransform();requestSharpFrame();
}
function scheduleKeyboardReframe(){
  clearKeyboardReframeTimers();
  for(const ms of [0,55,140,260,420])state.keyboardReframeTimers.push(setTimeout(()=>{
    if(state.connected&&document.activeElement===$('#nativeKeyboardInput'))focusRemoteFieldView();
  },ms));
}
function openKeyboardForCursor(numeric=false,force=false){
  if(!state.connected)return false;
  const likely=force||state.cursorEditable||state.cursorShape==='ibeam';
  if(!likely)return false;
  clearTimeout(state.focusProbeTimer);state.keyboardProbeArmed=true;
  const input=$('#nativeKeyboardInput');
  input.value='';input.setAttribute('inputmode',numeric?'numeric':'text');
  // Must run in pointerdown/up from the physical touch. This is what makes the
  // native iPhone/Android keyboard appear reliably instead of waiting on the host.
  try{input.focus({preventScroll:true});input.setSelectionRange(0,0)}catch{}
  focusRemoteFieldView();scheduleKeyboardReframe();
  state.focusProbeTimer=setTimeout(()=>{
    if(!state.keyboardProbeArmed)return;
    state.keyboardProbeArmed=false;try{input.blur()}catch{}
  },850);
  return document.activeElement===input;
}
function probeTextFocus(p,alreadyOpened=false){
  if(!state.connected)return;
  state.lastFocusProbeAt=Date.now();
  // If the cursor already says I-beam, keep the trusted-gesture focus alive. For
  // an unknown target, wait for the host instead of flashing a keyboard on buttons.
  if(!alreadyOpened&&(state.cursorEditable||state.cursorShape==='ibeam'))armKeyboardProbe(state.cursorNumeric);
  wsSend({type:'text_focus_probe',x:p.x,y:p.y});
}
function resolveTextFocus(editable,numeric=false){
  clearTimeout(state.focusProbeTimer);
  const input=$('#nativeKeyboardInput');
  if(!editable){state.keyboardProbeArmed=false;if(state.cursorShape==='ibeam')applyCursorState({shape:'arrow',editable:false});try{input.blur()}catch{};return}
  state.keyboardProbeArmed=false;state.cursorEditable=true;state.cursorNumeric=!!numeric;applyCursorState({shape:'ibeam',editable:true,numeric:!!numeric});
  focusRemoteFieldView();scheduleKeyboardReframe();
  input.setAttribute('inputmode',numeric?'numeric':'text');input.value='';
  try{input.blur();input.focus({preventScroll:true});input.setSelectionRange(0,0)}catch{}
}

function sendKey(key,down){if(state.connected){noteInteraction();wsSend({type:'input',kind:'key',key,down});if(!down)postInputRefresh('key')}}
function tapKey(k){sendKey(k,true);sendKey(k,false)}
function typeText(t){for(const ch of t)tapKey(ch)}
function sendCtrlAltDel(){
  if(!state.connected)return;
  wsSend({type:'secure_attention_request',sequence:'ctrl_alt_del'});
  postInputRefresh('secure_attention');
  toast('Solicitando Ctrl + Alt + Del ao computador remoto…');
}
function setFeature(feature,enabled,silent=false){
  if(!state.canAdmin){if(!silent)toast('Esse recurso foi bloqueado pelo computador remoto');return false}
  if(enabled&&feature==='system_audio'&&!state.remotePermissions.audio){if(!silent)toast('O áudio não foi liberado nas configurações do computador remoto');return false}
  if(enabled&&feature==='microphone'&&!state.remotePermissions.microphone){if(!silent)toast('O microfone não foi liberado nas configurações do computador remoto');return false}
  wsSend({type:'feature',feature,enabled});
  if(feature==='system_audio')wsSend({type:enabled?'audio_start':'audio_stop'});
  if(feature==='microphone'){
    wsSend({type:enabled?'microphone_start':'microphone_stop'});
    wsSend({type:enabled?'__disabled_microphone_start':'__disabled_microphone_stop'});
  }
  return true;
}
async function ensureAudio(){
  if(!state.audioCtx)state.audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  if(state.audioCtx.state==='suspended')await state.audioCtx.resume();
}
function audioPacket(u){
  if(!state.audioCtx||u.length<8)return;
  const marker=u[0],rate=be32(u,1),channels=be16(u,5);
  if(rate<8000||channels<1||channels>8)return;
  let offset=7,samples;
  if((u.length-offset)%(channels*4)===0){
    const n=(u.length-offset)/4;samples=new Float32Array(n);
    const dv=new DataView(u.buffer,u.byteOffset+offset,u.length-offset);
    for(let i=0;i<n;i++)samples[i]=dv.getFloat32(i*4,true);
  }else if(u.length>=9){
    const frames=be16(u,7);offset=9;if(u.length-offset!==frames*channels*2)return;
    samples=new Float32Array(frames*channels);
    const dv=new DataView(u.buffer,u.byteOffset+offset,u.length-offset);
    for(let i=0;i<samples.length;i++)samples[i]=dv.getInt16(i*2,true)/32768;
  }else return;
  const frames=samples.length/channels,buf=state.audioCtx.createBuffer(channels,frames,rate);
  for(let c=0;c<channels;c++){const d=buf.getChannelData(c);for(let f=0;f<frames;f++)d[f]=samples[f*channels+c]}
  const src=state.audioCtx.createBufferSource();src.buffer=buf;src.connect(state.audioCtx.destination);
  const t=Math.max(state.audioCtx.currentTime+.02,state.audioNext[marker]||0);src.start(t);state.audioNext[marker]=t+buf.duration;
}

function saveThumbnail(force=false){
  const code=state.currentCode,img=$('#remoteScreen');
  if(!code||!img?.src||!img.naturalWidth)return;
  const now=Date.now();
  if(!force&&now-state.lastThumbAt<6000)return;
  state.lastThumbAt=now;
  try{
    const cw=320,ch=180,canvas=document.createElement('canvas');canvas.width=cw;canvas.height=ch;
    const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#071019';ctx.fillRect(0,0,cw,ch);
    const scale=Math.min(cw/img.naturalWidth,ch/img.naturalHeight),w=img.naturalWidth*scale,h=img.naturalHeight*scale;
    ctx.drawImage(img,(cw-w)/2,(ch-h)/2,w,h);
    thumbnails[code]=canvas.toDataURL('image/jpeg',.62);
    store.set('thumbnails',thumbnails);renderLists();
  }catch{}
}
function saveConnection(id,password){
  const now=new Date().toISOString();
  const old=history.find(x=>x.id===id),fav=favorites.find(x=>x.id===id);
  history=[{id,name:old?.name||fav?.name||'',date:now,password:settings.savePasswords?password:''},...history.filter(x=>x.id!==id)].slice(0,30);
  store.set('history',history);
  const existing=favorites.find(x=>x.id===id);
  if(existing&&settings.savePasswords){existing.password=password;store.set('favorites',favorites)}
  renderLists();
}

function isFavorite(id){return favorites.some(x=>x.id===id)}
function toggleFavorite(id,password=''){
  const idx=favorites.findIndex(x=>x.id===id);
  if(idx>=0){
    favorites.splice(idx,1);toast('Removido dos favoritos');
  }else{
    const h=history.find(x=>x.id===id);
    favorites.unshift({id,name:h?.name||'',password:settings.savePasswords?(password||h?.password||''):''});
    toast('Adicionado aos favoritos');
  }
  store.set('favorites',favorites);renderLists();refreshPresence();
}
function renameConnection(id){
  const h=history.find(x=>x.id===id),f=favorites.find(x=>x.id===id),old=(h?.name||f?.name||'');
  const value=window.prompt('Nome desta conexão',old||'Meu computador');
  if(value===null)return;
  const name=value.trim().slice(0,40);
  history=history.map(x=>x.id===id?{...x,name}:x);
  favorites=favorites.map(x=>x.id===id?{...x,name}:x);
  store.set('history',history);store.set('favorites',favorites);renderLists();
}

function rowStatus(id){
  if(!state.relayOnline)return 'offline';
  if(!state.presenceKnown.has(id))return 'unknown';
  return state.onlineCodes.has(id)?'online':'offline';
}
function openPasswordSheet(id){
  state.quickPasswordTarget=id;
  $('#passwordSheetId').textContent='ID '+id;
  $('#quickPassword').value='';
  $('#passwordSheet').classList.remove('hidden');
  setTimeout(()=>$('#quickPassword').focus(),120);
}
function closePasswordSheet(){
  $('#passwordSheet').classList.add('hidden');state.quickPasswordTarget=null;$('#quickPassword').value='';
}
function prepareConnection(id,password=''){
  $('#remoteId').value=id;$('#remotePassword').value=password||'';
  renderCurrentPcStatus();updateConnectButton();
}
async function connectSavedItem(item){
  const id=cleanId(item.id),saved=(settings.savePasswords?(item.password||''):'');
  if(id.length!==6)return;
  if(state.presenceKnown.has(id)&&!state.onlineCodes.has(id))return toast('Computador offline');
  if(saved.length>=4){
    prepareConnection(id,saved);showView('sessionView');await connect();return;
  }
  prepareConnection(id,'');openPasswordSheet(id);
}
function quickPasswordConnect(){
  const id=state.quickPasswordTarget,secret=$('#quickPassword').value;
  if(!id||secret.length<4)return toast('Informe a senha do computador.');
  prepareConnection(id,secret);closePasswordSheet();connect();
}
function listItem(item,kind){
  const id=item.id,password=item.password||'',date=item.date||'',name=item.name||'',fav=isFavorite(id),online=rowStatus(id);
  const el=document.createElement('div');el.className='list-item';
  el.innerHTML='<div class="pc cover"><span>▣</span><i class="status-dot '+online+'"></i></div><div class="info"><strong></strong><small></small></div><div class="list-actions"><button class="rename" aria-label="Renomear">✎</button><button class="star '+(fav?'active':'')+'" aria-label="'+(fav?'Remover dos favoritos':'Adicionar aos favoritos')+'">'+(fav?'★':'☆')+'</button><button class="go">Conectar</button></div>';
  const cover=el.querySelector('.cover'),thumb=thumbnails[id];
  if(thumb){cover.classList.add('has-thumb');cover.style.backgroundImage='url("'+thumb+'")'}
  el.querySelector('strong').textContent=name||('ID '+id);
  el.querySelector('small').textContent=(name?'ID '+id+' • ':'')+(online==='online'?'Online':online==='offline'?'Offline':'Verificando…')+(date?' • '+new Date(date).toLocaleString('pt-BR'):'');
  el.querySelector('.rename').onclick=e=>{e.stopPropagation();renameConnection(id)};
  el.querySelector('.star').onclick=e=>{e.stopPropagation();toggleFavorite(id,password)};
  el.querySelector('.go').onclick=e=>{e.stopPropagation();connectSavedItem({id,password,date,name})};
  el.querySelector('.info').onclick=()=>connectSavedItem({id,password,date,name});
  if(kind==='favorite'&&!password)el.querySelector('.go').title='Informe a senha antes de conectar';
  return el;
}

function renderLists(){
  const quick=$('#quickAccess');quick.innerHTML='';
  if(!history.length){quick.className='list empty';quick.innerHTML='<span>Nenhuma conexão recente.</span>'}
  else{quick.className='list';for(const h of history)quick.appendChild(listItem(h,'history'))}
  const fav=$('#favorites');fav.innerHTML='';
  if(!favorites.length){fav.className='list empty';fav.innerHTML='<span>Nenhum favorito ainda.</span>'}
  else{fav.className='list';for(const f of favorites)fav.appendChild(listItem(f,'favorite'))}
}
function disconnect(){
  saveThumbnail(true);
  try{state.ws?.close(1000)}catch{}
  state.ws=null;state.connected=false;state.currentCode=null;
  $('#remoteScreen').removeAttribute('src');$('#screenPlaceholder').style.display='flex';
  closeEdgeMenu();closeAllSheets();releaseModifiers();
  showView('homeView');setStatus('Pronto para conectar');resetViewTransform();setImmersive(false);updateConnectButton();refreshPresence();
}

function applyPointerMode(mode){
  settings.pointerMode=mode==='touch'?'touch':'mouse';store.set('settings',settings);
  const mouse=settings.pointerMode==='mouse',wrap=$('#screenWrap'),btn=$('#menuModeBtn');
  wrap.classList.toggle('mouse-mode',mouse);
  $('#controlBadge').textContent=mouse?'Mouse':'Touch Screen';
  if(btn){btn.innerHTML=mouse?'➤<small>Mouse</small>':'☝<small>Touch</small>';btn.classList.toggle('active',!mouse)}
  $('#pointerMode').value=settings.pointerMode;
  $('#sessionMouseBtn')?.classList.toggle('active',mouse);$('#sessionTouchBtn')?.classList.toggle('active',!mouse);
  updateCursorVisual();
}
function cursorMarkup(shape){
  if(shape==='ibeam')return '<svg viewBox="0 0 32 42"><path d="M10 3h12M16 3v36M10 39h12" fill="none" stroke="white" stroke-width="3"/><path d="M9 2h14M16 2v38M9 40h14" fill="none" stroke="#111" stroke-width="6" opacity=".82"/></svg>';
  if(shape==='hand')return '<svg viewBox="0 0 42 48"><path d="M12 22V8c0-5 7-5 7 0v10-7c0-5 7-5 7 0v8-5c0-5 7-5 7 0v8-3c0-5 7-5 7 0v11c0 9-6 15-15 15h-5c-6 0-9-3-12-8L3 29c-2-4 4-8 7-4z" fill="white" stroke="#111" stroke-width="2.4" stroke-linejoin="round"/></svg>';
  if(shape==='wait'||shape==='appstarting')return '<svg viewBox="0 0 36 44"><path d="M9 3h18v5c0 5-3 9-7 12 4 3 7 7 7 12v8H9v-8c0-5 3-9 7-12-4-3-7-7-7-12z" fill="white" stroke="#111" stroke-width="2.5"/><path d="M12 8h12c0 4-3 7-6 9-3-2-6-5-6-9zm1 27h10c-1-4-3-7-5-9-2 2-4 5-5 9z" fill="#5aa9ff"/></svg>';
  if(shape==='cross')return '<svg viewBox="0 0 36 36"><path d="M18 2v32M2 18h32" stroke="white" stroke-width="2.5"/><path d="M18 2v32M2 18h32" stroke="#111" stroke-width="5" opacity=".75"/></svg>';
  if(shape==='size_we')return '<svg viewBox="0 0 44 32"><path d="M3 16h38M3 16l8-7M3 16l8 7M41 16l-8-7M41 16l-8 7" fill="none" stroke="white" stroke-width="3"/><path d="M3 16h38" stroke="#111" stroke-width="6" opacity=".75"/></svg>';
  if(shape==='size_ns')return '<svg viewBox="0 0 32 44"><path d="M16 3v38M16 3l-7 8M16 3l7 8M16 41l-7-8M16 41l7-8" fill="none" stroke="white" stroke-width="3"/><path d="M16 3v38" stroke="#111" stroke-width="6" opacity=".75"/></svg>';
  if(shape==='size_all')return '<svg viewBox="0 0 44 44"><path d="M22 3v38M3 22h38M22 3l-6 7M22 3l6 7M22 41l-6-7M22 41l6-7M3 22l7-6M3 22l7 6M41 22l-7-6M41 22l-7 6" fill="none" stroke="white" stroke-width="2.6"/></svg>';
  return '<svg viewBox="0 0 32 42"><path d="M3 2 L3 32 L11 24 L17 39 L23 36 L17 22 L29 22 Z" fill="white" stroke="#111" stroke-width="2.2" stroke-linejoin="round"/></svg>';
}
function normalizeCursorShape(value){
  const raw=String(value||'arrow').toLowerCase().replace(/[\s-]+/g,'_');
  const aliases={default:'arrow',normal:'arrow',pointer:'hand',link:'hand',hand2:'hand',text:'ibeam',i_beam:'ibeam',beam:'ibeam',busy:'wait',loading:'wait',progress:'appstarting',working:'appstarting',crosshair:'cross',sizewe:'size_we',ew_resize:'size_we',sizens:'size_ns',ns_resize:'size_ns',sizeall:'size_all',move:'size_all'};
  return aliases[raw]||raw;
}
function applyCursorState(o){
  const shape=normalizeCursorShape(o?.shape||'arrow');
  state.cursorShape=shape;state.cursorEditable=!!(o?.editable||shape==='ibeam');state.cursorNumeric=!!o?.numeric;
  const c=$('#mouseCursor');c.dataset.shape=shape;c.innerHTML=cursorMarkup(shape);updateCursorVisual();
}
function probeCursorState(force=false){
  if(!state.connected||settings.pointerMode!=='mouse')return;
  const now=performance.now();if(!force&&now-state.cursorProbeAt<45)return;state.cursorProbeAt=now;
  wsSend({type:'cursor_probe',x:state.cursor.x,y:state.cursor.y});
}
function updateCursorVisual(){
  if(settings.pointerMode!=='mouse')return;
  const b=imageBox(),c=$('#mouseCursor'),wr=$('#screenWrap').getBoundingClientRect();
  c.style.left=(b.left-wr.left+state.cursor.x*b.width)+'px';
  c.style.top=(b.top-wr.top+state.cursor.y*b.height)+'px';
}

function clearLongPress(){
  clearTimeout(state.longPressTimer);state.longPressTimer=null;
}
function clearMouseDragArm(){clearTimeout(state.mouseDragArmTimer);state.mouseDragArmTimer=null;state.mouseDragArmed=false}
function startLongPress(p){
  clearLongPress();state.longPressFired=false;
  state.longPressTimer=setTimeout(()=>{
    if(state.dragging||state.doubleTapDrag)return;
    state.longPressFired=true;clearMouseDragArm();
    const target=settings.pointerMode==='mouse'?state.cursor:p;
    clickAt(target,'right');try{navigator.vibrate?.(18)}catch{};toast('Clique direito');
  },620);
}
function resetGestureFlags(){
  state.moved=false;state.dragging=false;state.doubleTapDrag=false;state.longPressFired=false;state.lastPointer=null;state.panGesture=null;clearLongPress();clearMouseDragArm();
}
function fitImageBase(){
  const wr=$('#screenWrap').getBoundingClientRect();
  const iw=Math.max(1,state.remoteW||wr.width),ih=Math.max(1,state.remoteH||wr.height);
  const scale=Math.min(wr.width/iw,wr.height/ih);
  return {wrapW:wr.width,wrapH:wr.height,width:iw*scale,height:ih*scale};
}
function clampPan(){
  if(state.zoom<=1){state.panX=0;state.panY=0;return}
  const f=fitImageBase();
  const maxX=Math.max(0,(f.width*state.zoom-f.wrapW)/2);
  const maxY=Math.max(0,(f.height*state.zoom-f.wrapH)/2);
  state.panX=Math.max(-maxX,Math.min(maxX,state.panX));
  state.panY=Math.max(-maxY,Math.min(maxY,state.panY));
}
function followCursorPan(){
  if(state.zoom<=1)return;
  const f=fitImageBase(),sw=f.width*state.zoom,sh=f.height*state.zoom;
  const mx=Math.max(38,Math.min(82,f.wrapW*.15)),my=Math.max(38,Math.min(82,f.wrapH*.15));
  const sx=f.wrapW/2+state.panX+(state.cursor.x-.5)*sw;
  const sy=f.wrapH/2+state.panY+(state.cursor.y-.5)*sh;
  if(sx<mx)state.panX+=mx-sx;else if(sx>f.wrapW-mx)state.panX-=sx-(f.wrapW-mx);
  if(sy<my)state.panY+=my-sy;else if(sy>f.wrapH-my)state.panY-=sy-(f.wrapH-my);
  clampPan();applyTransform();
}
function pointerDown(e){
  if(!state.connected)return;
  if(e.target.closest?.('button,.edge-menu,.edge-submenu'))return;
  const wr=$('#screenWrap').getBoundingClientRect();
  if(e.clientX-wr.left<=24){e.preventDefault();state.edgeGesture={id:e.pointerId,startX:e.clientX,startY:e.clientY};return}
  e.preventDefault();$('#screenWrap').setPointerCapture?.(e.pointerId);
  const now=performance.now();
  state.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,time:now});
  if(state.pointers.size===2){clearLongPress();clearMouseDragArm();state.gesture=pinchSnapshot();return}
  if(state.pointers.size>2)return;
  state.lastPointer={x:e.clientX,y:e.clientY,time:now};
  if(settings.pointerMode==='mouse'){
    // Prime the phone keyboard on pointer-down while Safari still treats this as a
    // user gesture. It is harmless for non-editable targets because it only runs
    // when the host's live cursor is already an I-beam/editable cursor.
    if(state.cursorEditable||state.cursorShape==='ibeam')openKeyboardForCursor(state.cursorNumeric);
    const lp=state.lastTapPos;
    const doubleTap=!!lp&&now-state.lastTapAt<=420&&Math.hypot(e.clientX-lp.x,e.clientY-lp.y)<=38;
    if(doubleTap){
      state.doubleTapDrag=true;state.dragging=true;state.lastTapAt=0;state.lastTapPos=null;
      clearLongPress();clearMouseDragArm();flushMouseMove();sendMouse('down',state.cursor,{button:'left',buttons:1});
    }else{
      clearMouseDragArm();const pid=e.pointerId;
      state.mouseDragArmTimer=setTimeout(()=>{if(state.pointers.has(pid)&&!state.moved&&!state.longPressFired&&!state.doubleTapDrag)state.mouseDragArmed=true},190);
      startLongPress(state.cursor);
    }
  }else{
    armKeyboardProbe(false);
    startLongPress(normalizedPoint(e.clientX,e.clientY));
  }
}
function pointerMove(e){
  if(state.edgeGesture&&state.edgeGesture.id===e.pointerId){e.preventDefault();if(e.clientX-state.edgeGesture.startX>42){openEdgeMenu();state.edgeGesture=null}return}
  const ptr=state.pointers.get(e.pointerId);if(!ptr)return;
  e.preventDefault();const prev={x:ptr.x,y:ptr.y};ptr.x=e.clientX;ptr.y=e.clientY;
  if(state.pointers.size>=2){clearLongPress();clearMouseDragArm();handlePinch();return}
  const dx=e.clientX-prev.x,dy=e.clientY-prev.y;
  if(Math.hypot(e.clientX-ptr.startX,e.clientY-ptr.startY)>6){state.moved=true;clearLongPress()}
  if(settings.pointerMode==='mouse'){
    if(!state.moved)return;
    const before={x:state.cursor.x,y:state.cursor.y},wr=$('#screenWrap').getBoundingClientRect();
    if(state.mouseDragArmed&&!state.dragging){state.dragging=true;sendMouse('down',before,{button:'left'})}
    state.cursor.x=Math.max(0,Math.min(1,state.cursor.x+dx/Math.max(150,wr.width*.78)));
    state.cursor.y=Math.max(0,Math.min(1,state.cursor.y+dy/Math.max(150,wr.height*.78)));
    sendMouse('move',state.cursor,state.dragging?{button:'left',buttons:1}:{});probeCursorState();
    if(state.zoom>1)followCursorPan();else updateCursorVisual();
  }else if(state.moved){
    const point=normalizedPoint(e.clientX,e.clientY);
    if(!state.dragging){state.dragging=true;const start=normalizedPoint(ptr.startX,ptr.startY);sendMouse('down',start,{button:'left'})}
    sendMouse('move',point,{button:'left',buttons:1});
  }
}
function pointerUp(e){
  if(state.edgeGesture&&state.edgeGesture.id===e.pointerId){state.edgeGesture=null;return}
  const ptr=state.pointers.get(e.pointerId);if(!ptr)return;
  e.preventDefault();clearLongPress();clearTimeout(state.mouseDragArmTimer);
  const wasMulti=state.pointers.size>1;state.pointers.delete(e.pointerId);
  if(wasMulti){if(state.pointers.size<2)state.gesture=null;clearMouseDragArm();return}
  if(state.longPressFired){resetGestureFlags();return}
  if(settings.pointerMode==='mouse'){
    if(state.dragging){
      sendMouse('up',state.cursor,{button:'left'});postInputRefresh(state.doubleTapDrag?'double_drag':'drag');
      if(!state.moved&&state.doubleTapDrag)probeTextFocus(state.cursor);
      state.lastTapAt=0;state.lastTapPos=null;
    }else if(!state.moved){
      const keyboardOpened=(document.activeElement===$('#nativeKeyboardInput'))||openKeyboardForCursor(state.cursorNumeric);
      clickAt(state.cursor,'left');probeTextFocus(state.cursor,keyboardOpened);
      state.lastTapAt=performance.now();state.lastTapPos={x:e.clientX,y:e.clientY};
    }else{state.lastTapAt=0;state.lastTapPos=null}
  }else{
    const point=normalizedPoint(e.clientX,e.clientY);
    if(state.dragging){sendMouse('move',point,{button:'left',buttons:1});sendMouse('up',point,{button:'left'});postInputRefresh('touch_drag')}
    else if(!state.moved){const keyboardOpened=openKeyboardForCursor(false);clickAt(point,'left');probeTextFocus(point,keyboardOpened)}
  }
  resetGestureFlags();
}
function pointerCancel(e){
  if(state.edgeGesture&&state.edgeGesture.id===e.pointerId){state.edgeGesture=null;return}
  const ptr=state.pointers.get(e.pointerId);
  if(ptr&&state.dragging){const point=settings.pointerMode==='mouse'?state.cursor:normalizedPoint(ptr.x,ptr.y);sendMouse('up',point,{button:'left'})}
  state.pointers.delete(e.pointerId);flushMouseMove();resetGestureFlags();
}

function pinchSnapshot(){
  const pts=[...state.pointers.values()].slice(0,2);
  const d=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
  const cx=(pts[0].x+pts[1].x)/2,cy=(pts[0].y+pts[1].y)/2;
  return {distance:d,cx,cy,zoom:state.zoom,panX:state.panX,panY:state.panY};
}
function handlePinch(){
  const pts=[...state.pointers.values()].slice(0,2);if(pts.length<2||!state.gesture)return;
  const d=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
  const cx=(pts[0].x+pts[1].x)/2,cy=(pts[0].y+pts[1].y)/2;
  state.zoom=Math.max(1,Math.min(4,state.gesture.zoom*(d/Math.max(1,state.gesture.distance))));
  state.panX=state.gesture.panX+(cx-state.gesture.cx);
  state.panY=state.gesture.panY+(cy-state.gesture.cy);
  applyTransform();requestSharpFrame();
}
function applyTransform(){
  clampPan();
  const vp=$('#screenViewport');
  vp.style.transform=`translate(${state.panX}px,${state.panY}px) scale(${state.zoom})`;
  const zb=$('#zoomBadge');zb.textContent=Math.round(state.zoom*100)+'%';zb.classList.toggle('hidden',state.zoom===1);
  requestAnimationFrame(updateCursorVisual);
}
function resetViewTransform(){
  state.zoom=1;state.panX=0;state.panY=0;applyTransform();
  state.cursor={x:.5,y:.5};resetGestureFlags();
}
function wheel(e){
  if(!state.connected)return;e.preventDefault();
  const p=settings.pointerMode==='mouse'?state.cursor:normalizedPoint(e.clientX,e.clientY);
  sendMouse('scroll',p,{dx:Math.trunc(e.deltaX),dy:Math.trunc(e.deltaY)});
}

function requestSharpFrame(){
  clearTimeout(state.sharpTimer);
  state.sharpTimer=setTimeout(()=>sendAdaptiveStreamProfile(state.zoom>1?'zoom':'interaction'),120);
}

function openNativeKeyboard(mode='text',automatic=false){
  if(!state.connected)return;
  $('#keyboardSheet').classList.add('hidden');
  const input=$('#nativeKeyboardInput');
  input.blur();input.value='';input.setAttribute('inputmode',mode==='numeric'?'numeric':'text');
  // Quando vem de um toque/botão, foco síncrono faz o iOS abrir o teclado nativo.
  // Quando vem de text_focus do host, tentamos imediatamente; navegadores podem exigir gesto recente.
  input.focus({preventScroll:true});try{input.setSelectionRange(0,0)}catch{}
}
function nativeBeforeInput(e){
  if(state.keyboardComposing)return;
  if(e.inputType==='insertText'&&e.data){e.preventDefault();typeText(e.data)}
  else if(e.inputType==='deleteContentBackward'){e.preventDefault();tapKey('backspace')}
  else if(e.inputType==='deleteContentForward'){e.preventDefault();tapKey('delete')}
}
function nativeKeyDown(e){
  const map={Enter:'enter',Backspace:'backspace',Delete:'delete',Escape:'escape',Tab:'tab',ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'};
  if(map[e.key]){e.preventDefault();tapKey(map[e.key])}
}
function nativeCompositionEnd(e){state.keyboardComposing=false;if(e.data)typeText(e.data);e.target.value=''}
function setImmersive(on){
  state.fullscreenFallback=!!on;
  $('#sessionView').classList.toggle('immersive',!!on);document.body.classList.toggle('session-immersive',!!on);document.documentElement.classList.toggle('session-immersive',!!on);
  $('#menuFullscreenBtn')?.classList.toggle('active',!!on);$('#sessionFullscreenBtn').textContent=on?'⛶ Sair da tela cheia':'⛶ Tela cheia';
  setTimeout(()=>{resetViewTransform();requestSharpFrame()},80);
}
async function toggleFullscreen(){
  const on=!!(document.fullscreenElement||document.webkitFullscreenElement||state.fullscreenFallback);
  if(on){
    try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.webkitFullscreenElement)await document.webkitExitFullscreen?.()}catch{}
    setImmersive(false);return;
  }
  setImmersive(true);
  const target=document.documentElement,req=target.requestFullscreen||target.webkitRequestFullscreen;
  if(req){
    try{await req.call(target,{navigationUI:'hide'})}catch{}
  }
  try{await screen.orientation?.lock?.('landscape')}catch{}
}
function captureRemoteScreen(){
  const img=$('#remoteScreen');if(!img.src)return toast('Ainda não há imagem para capturar.');
  try{const a=document.createElement('a');a.href=img.src;a.download='CHV-Remote-'+Date.now()+'.jpg';document.body.appendChild(a);a.click();a.remove();toast('Captura de tela salva')}catch{toast('Não foi possível salvar a captura')}
}
function openEdgeMenu(){state.menuOpen=true;$('#edgeMenu').classList.remove('hidden');$('#edgeHandle').classList.add('hidden')}
function closeEdgeMenu(){state.menuOpen=false;$('#edgeMenu')?.classList.add('hidden');$('#quickActionsMenu')?.classList.add('hidden');$('#edgeHandle')?.classList.remove('hidden')}
function toggleEdgeMenu(){state.menuOpen?closeEdgeMenu():openEdgeMenu()}
function closeAllSheets(){$$('.sheet').forEach(x=>x.classList.add('hidden'))}
function openSheet(id){closeEdgeMenu();closeAllSheets();$('#'+id).classList.remove('hidden')}
function releaseModifiers(){
  for(const key of state.modifiers){if(key==='altgr'){sendKey('alt',false);sendKey('ctrl',false)}else sendKey(key,false)}state.modifiers.clear();
  $$('[data-modifier]').forEach(b=>b.classList.remove('active'));
}
function toggleModifier(key,button){
  if(key==='altgr'){
    if(state.modifiers.has(key)){sendKey('alt',false);sendKey('ctrl',false);state.modifiers.delete(key);button.classList.remove('active')}
    else{sendKey('ctrl',true);sendKey('alt',true);state.modifiers.add(key);button.classList.add('active')}
    return;
  }
  if(state.modifiers.has(key)){sendKey(key,false);state.modifiers.delete(key);button.classList.remove('active')}
  else{sendKey(key,true);state.modifiers.add(key);button.classList.add('active')}
}
function chord(key){
  const ctrlWas=state.modifiers.has('ctrl');if(!ctrlWas)sendKey('ctrl',true);tapKey(key);if(!ctrlWas)sendKey('ctrl',false);
}
function formatBytes(n){
  n=Number(n||0);if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';if(n<1073741824)return (n/1048576).toFixed(1)+' MB';return (n/1073741824).toFixed(1)+' GB';
}
function openRemoteFiles(){
  if(!state.connected)return toast('Conecte primeiro ao computador.');
  if(!state.canAdmin)return toast('Gerenciador de arquivos bloqueado pelo computador remoto');
  state.remoteSelected.clear();openSheet('fileBrowserSheet');requestRemotePath('');
}
function requestRemotePath(path=''){state.remoteSelected.clear();wsSend({type:'file_list_request',path:String(path||''),scope:path?'explicit':'default'});$('#remoteFileList').innerHTML='<div class="file-loading">Carregando…</div>'}
function renderRemoteFileList(o){
  state.remotePath=String(o.path||'');state.remoteParent=String(o.parent||'');state.remoteEntries=Array.isArray(o.entries)?o.entries:[];state.remoteSelected.clear();
  $('#remotePath').textContent=state.remotePath||'Este PC';$('#remoteUpBtn').disabled=!state.remotePath;
  const box=$('#remoteFileList');box.innerHTML='';
  if(!state.remoteEntries.length){box.innerHTML='<div class="file-loading">Pasta vazia.</div>';updateReceiveButton();return}
  for(const entry of state.remoteEntries){
    const row=document.createElement('div');row.className='remote-file-row '+(entry.is_dir?'dir':'file');
    const select=entry.is_dir?'':'<input class="remote-file-check" type="checkbox" aria-label="Selecionar arquivo">';
    row.innerHTML=select+'<button class="remote-file-open"><span class="remote-file-icon">'+(entry.is_dir?'📁':'📄')+'</span><span class="remote-file-name"></span><small></small></button>';
    row.querySelector('.remote-file-name').textContent=entry.name||entry.path||'Arquivo';
    row.querySelector('small').textContent=entry.is_dir?'Pasta':formatBytes(entry.size||0);
    row.querySelector('.remote-file-open').onclick=()=>{if(entry.is_dir)requestRemotePath(entry.path);else{const cb=row.querySelector('.remote-file-check');cb.checked=!cb.checked;toggleRemoteSelection(entry.path,cb.checked)}};
    const cb=row.querySelector('.remote-file-check');if(cb)cb.onchange=()=>toggleRemoteSelection(entry.path,cb.checked);
    box.appendChild(row);
  }
  updateReceiveButton();
}
function toggleRemoteSelection(path,on){if(on)state.remoteSelected.add(path);else state.remoteSelected.delete(path);updateReceiveButton()}
function updateReceiveButton(){const b=$('#receiveSelectedBtn');if(b){b.disabled=!state.remoteSelected.size;b.textContent=state.remoteSelected.size?'Receber ('+state.remoteSelected.size+')':'Receber selecionado'}}
function receiveSelectedFiles(){
  const paths=[...state.remoteSelected];if(!paths.length)return toast('Selecione um arquivo do computador.');
  wsSend({type:'file_download_request',paths});toast('Recebendo '+paths.length+' arquivo(s)…');
}
function showReceivedFiles(){
  const names=state.receivedReady.map(x=>x.name);$('#receivedFileName').textContent=names.length===1?names[0]:names.length+' arquivos recebidos';
  $('#receivedFileSheet').classList.remove('hidden');
}
async function saveReceivedFiles(){
  if(!state.receivedReady.length)return;
  const files=state.receivedReady.map(x=>new File([x.blob],x.name,{type:x.blob.type||'application/octet-stream'}));
  try{
    if(navigator.share&&navigator.canShare?.({files})){
      await navigator.share({files,title:'CHV Remote'});
      toast('No iPhone, escolha “Salvar em Arquivos” e a pasta desejada.');
      return;
    }
  }catch(err){if(err?.name==='AbortError')return}
  for(const item of state.receivedReady){const url=URL.createObjectURL(item.blob),a=document.createElement('a');a.href=url;a.download=item.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
  toast('Download iniciado.');
}

function acceptFile(o){
  if(!state.canAdmin||!o.id)return;
  state.incoming.set(o.id,{name:(o.name||'arquivo').split(/[\\/]/).pop(),chunks:[],clipboard:!!o.clipboard});
}
function fileChunk(u){
  if(u.length<5)return;const ml=be32(u,1);if(!ml||u.length<5+ml)return;
  let meta;try{meta=JSON.parse(new TextDecoder().decode(u.slice(5,5+ml)))}catch{return}
  const t=state.incoming.get(meta.id);if(!t)return;
  if(meta.final){
    const blob=new Blob(t.chunks,{type:'application/octet-stream'});
    state.incoming.delete(meta.id);state.receivedReady.push({name:t.name,blob});
    showReceivedFiles();toast('Arquivo recebido: '+t.name);
  }else t.chunks.push(u.slice(5+ml));
}

async function sendFiles(files){
  if(!state.canAdmin)return toast('Envio de arquivos bloqueado pelo computador remoto');
  files=[...files].filter(Boolean);if(!files.length)return;
  const names=[];
  for(let pos=0;pos<files.length;pos++){
    const file=files[pos],id=Date.now()+'-'+Math.random().toString(16).slice(2,10)+'-'+file.name;
    names.push(file.name);
    wsSend({type:'file_offer',id,name:file.name,size:file.size,clipboard:false,batch_id:crypto.randomUUID?.()||String(Date.now()),batch_final:pos===files.length-1});
    const ab=new Uint8Array(await file.arrayBuffer());let index=0;
    for(let o=0;o<ab.length;o+=262144)sendFilePacket(id,index++,false,ab.slice(o,o+262144));
    sendFilePacket(id,index,true,new Uint8Array());
  }
  // The file picker/browser must never strand the user away from the remote
  // desktop. Close it immediately and show one focused completion prompt.
  closeAllSheets();closeEdgeMenu();showView('sessionView');
  $('#sentFileName').textContent=names.length===1?names[0]:names.length+' arquivos';
  $('#sentFileSheet').classList.remove('hidden');
  toast('Arquivo enviado para Downloads / CHV Remote');
}
function sendFilePacket(id,index,final,chunk){
  const meta=new TextEncoder().encode(JSON.stringify({id,index,final})),out=new Uint8Array(5+meta.length+chunk.length);
  out[0]=68;const n=meta.length;out[1]=(n>>>24)&255;out[2]=(n>>>16)&255;out[3]=(n>>>8)&255;out[4]=n&255;
  out.set(meta,5);out.set(chunk,5+meta.length);state.ws?.send(out);
}

// UI
$('#remoteId').addEventListener('input',()=>{updateConnectButton();renderCurrentPcStatus();schedulePresence()});
$('#remotePassword').addEventListener('input',updateConnectButton);
$('#connectBtn').onclick=connect;
$('#showPassword').onclick=()=>{$('#remotePassword').type=$('#remotePassword').type==='password'?'text':'password'};
$$('#bottomNav button').forEach(b=>b.onclick=()=>showView(b.dataset.view));
$('#backSession').onclick=disconnect;$('#disconnectBtn').onclick=disconnect;
$('#hideInstall').onclick=()=>{$('#installCard').style.display='none';store.set('hideInstall',true)};
$('#clearQuick').onclick=()=>{history=[];store.set('history',history);renderLists();refreshPresence()};
$('#clearFavorites').onclick=()=>{favorites=[];store.set('favorites',favorites);renderLists();refreshPresence()};

$('#quality').value=settings.quality;$('#savePasswords').checked=settings.savePasswords;
$('#autoAudio').checked=settings.autoAudio;$('#autoMic').checked=settings.autoMic;$('#pointerMode').value=settings.pointerMode;
$('#sessionQuality').value=settings.quality;
['quality','autoAudio','autoMic'].forEach(id=>$('#'+id).onchange=e=>{
  settings[id]=e.target.type==='checkbox'?e.target.checked:e.target.value;store.set('settings',settings);
  if(id==='quality'){$('#sessionQuality').value=settings.quality;requestSharpFrame()}
  if(state.connected&&id==='autoAudio'){const on=!!settings.autoAudio&&state.remotePermissions.audio;$('#actionAudioBtn')?.classList.toggle('active',on);if(on)ensureAudio().then(()=>setFeature('system_audio',true));else setFeature('system_audio',false,true)}
  if(state.connected&&id==='autoMic'){const on=!!settings.autoMic&&state.remotePermissions.microphone;$('#actionMicBtn')?.classList.toggle('active',on);if(on)ensureAudio().then(()=>setFeature('microphone',true));else setFeature('microphone',false,true)}
});
$('#savePasswords').onchange=e=>{
  settings.savePasswords=e.target.checked;store.set('settings',settings);
  if(!settings.savePasswords){
    history=history.map(x=>({...x,password:''}));favorites=favorites.map(x=>({...x,password:''}));
    store.set('history',history);store.set('favorites',favorites);renderLists();
  }
};
$('#pointerMode').onchange=e=>applyPointerMode(e.target.value);
$('#sessionQuality').onchange=e=>{settings.quality=e.target.value;$('#quality').value=settings.quality;store.set('settings',settings);requestSharpFrame()};
$('#sessionMouseBtn').onclick=()=>applyPointerMode('mouse');$('#sessionTouchBtn').onclick=()=>applyPointerMode('touch');

// Acesso rápido: conecta direto com senha salva; sem senha, pede somente a senha.
$('#closePasswordSheet').onclick=closePasswordSheet;
$('#showQuickPassword').onclick=()=>{$('#quickPassword').type=$('#quickPassword').type==='password'?'text':'password'};
$('#quickConnectBtn').onclick=quickPasswordConnect;$('#quickPassword').addEventListener('keydown',e=>{if(e.key==='Enter')quickPasswordConnect()});

// Menu lateral estilo CHV: toque na alça ou arraste da borda esquerda para dentro.
$('#edgeHandle').onclick=e=>{e.stopPropagation();toggleEdgeMenu()};$('#menuCloseBtn').onclick=closeEdgeMenu;
$('#sessionSettingsBtn').onclick=()=>openSheet('sessionSettingsSheet');
$('#menuModeBtn').onclick=()=>applyPointerMode(settings.pointerMode==='mouse'?'touch':'mouse');
$('#menuKeyboardBtn').onclick=()=>openSheet('keyboardSheet');
$('#menuFilesBtn').onclick=openRemoteFiles;
$('#quickActionsBtn').onclick=e=>{e.stopPropagation();$('#quickActionsMenu').classList.toggle('hidden')};
$('#menuFullscreenBtn').onclick=()=>{closeEdgeMenu();toggleFullscreen()};
$('#menuDisconnectBtn').onclick=disconnect;
$('#actionCadBtn').onclick=sendCtrlAltDel;$('#actionScreenshotBtn').onclick=captureRemoteScreen;
$('#actionAudioBtn').onclick=async e=>{await ensureAudio();const on=!e.currentTarget.classList.contains('active');if(setFeature('system_audio',on))e.currentTarget.classList.toggle('active',on)};
$('#actionMicBtn').onclick=async e=>{await ensureAudio();const on=!e.currentTarget.classList.contains('active');if(setFeature('microphone',on))e.currentTarget.classList.toggle('active',on)};
$('#sessionFullscreenBtn').onclick=()=>{closeAllSheets();toggleFullscreen()};
$$('[data-close-sheet]').forEach(b=>b.onclick=()=>$('#'+b.dataset.closeSheet).classList.add('hidden'));
$$('.sheet').forEach(sh=>sh.addEventListener('pointerdown',e=>{if(e.target===sh)sh.classList.add('hidden')}));

// Teclado nativo + teclado especial completo.
$('#nativeKeyboardBtn').onclick=()=>openNativeKeyboard('text');$('#numericKeyboardBtn').onclick=()=>openNativeKeyboard('numeric');$('#keyboardCadBtn').onclick=sendCtrlAltDel;
$$('#specialKeyboard [data-key]').forEach(b=>b.onclick=()=>tapKey(b.dataset.key));
$$('#specialKeyboard [data-modifier]').forEach(b=>b.onclick=()=>{if(b===ctrlKeyBtn&&state.ctrlLong){state.ctrlLong=false;return}toggleModifier(b.dataset.modifier,b)});
const ctrlKeyBtn=$('#ctrlKeyBtn');
ctrlKeyBtn.addEventListener('pointerdown',()=>{state.ctrlLong=false;clearTimeout(state.ctrlHoldTimer);state.ctrlHoldTimer=setTimeout(()=>{state.ctrlLong=true;$('#ctrlShortcutMenu').classList.remove('hidden');try{navigator.vibrate?.(15)}catch{}},520)});
ctrlKeyBtn.addEventListener('pointerup',()=>clearTimeout(state.ctrlHoldTimer));ctrlKeyBtn.addEventListener('pointercancel',()=>clearTimeout(state.ctrlHoldTimer));
$$('[data-chord]').forEach(b=>b.onclick=()=>{chord(b.dataset.chord);$('#ctrlShortcutMenu').classList.add('hidden')});

$('#fileInput').onchange=e=>{sendFiles([...e.target.files]);e.target.value=''};
$('#sendFromPhoneBtn').onclick=()=>$('#fileInput').click();
$('#closeSentFileBtn').onclick=()=>{closeAllSheets();showView('sessionView');$('#screenWrap')?.focus?.();toast('Arquivo enviado para Downloads / CHV Remote')};
$('#receiveSelectedBtn').onclick=receiveSelectedFiles;
$('#remoteUpBtn').onclick=()=>requestRemotePath(state.remoteParent||'');
$('#refreshRemoteFilesBtn').onclick=()=>requestRemotePath(state.remotePath||'');
$('#saveReceivedBtn').onclick=saveReceivedFiles;
$('#clearReceivedBtn').onclick=()=>{state.receivedReady=[];$('#receivedFileSheet').classList.add('hidden')};
const sw=$('#screenWrap');
sw.addEventListener('pointerdown',pointerDown,{passive:false});sw.addEventListener('pointermove',pointerMove,{passive:false});sw.addEventListener('pointerup',pointerUp,{passive:false});sw.addEventListener('pointercancel',pointerCancel,{passive:false});sw.addEventListener('wheel',wheel,{passive:false});sw.addEventListener('contextmenu',e=>e.preventDefault());sw.addEventListener('selectstart',e=>e.preventDefault());sw.addEventListener('dragstart',e=>e.preventDefault());
const sessionActive=()=>$('#sessionView').classList.contains('active');
const blockIOSNativeGesture=e=>{if(!sessionActive())return;if(e.target.closest?.('button,input,textarea,select,.sheet-card'))return;if(e.cancelable)e.preventDefault()};
['touchstart','touchmove','touchend','touchcancel','gesturestart','gesturechange','gestureend'].forEach(t=>{
  sw.addEventListener(t,blockIOSNativeGesture,{passive:false});
  document.addEventListener(t,blockIOSNativeGesture,{passive:false,capture:true});
});
document.addEventListener('selectstart',e=>{if(sessionActive()&&!e.target.closest?.('input,textarea'))e.preventDefault()},{capture:true});
document.addEventListener('contextmenu',e=>{if(sessionActive()&&!e.target.closest?.('input,textarea'))e.preventDefault()},{capture:true});
document.addEventListener('dragstart',e=>{if(sessionActive())e.preventDefault()},{capture:true});
document.addEventListener('selectionchange',()=>{if(sessionActive()){const sel=window.getSelection?.();if(sel&&!$('#nativeKeyboardInput').matches(':focus'))try{sel.removeAllRanges()}catch{}}});
const nki=$('#nativeKeyboardInput');nki.addEventListener('beforeinput',nativeBeforeInput);nki.addEventListener('keydown',nativeKeyDown);nki.addEventListener('compositionstart',()=>state.keyboardComposing=true);nki.addEventListener('compositionend',nativeCompositionEnd);

function fullscreenChanged(){
  const native=!!(document.fullscreenElement||document.webkitFullscreenElement);
  if(!native&&state.fullscreenFallback&&document.visibilityState==='visible'){
    // iOS/PWA usa nosso modo imersivo mesmo sem Fullscreen API.
    setImmersive(true);
  }
}
document.addEventListener('fullscreenchange',fullscreenChanged);document.addEventListener('webkitfullscreenchange',fullscreenChanged);
window.addEventListener('resize',()=>requestAnimationFrame(()=>{clampPan();applyTransform();requestSharpFrame()}));
window.addEventListener('orientationchange',()=>setTimeout(()=>{resetViewTransform();requestSharpFrame()},160));
window.addEventListener('pagehide',()=>{releaseModifiers();flushMouseMove();try{state.ws?.close()}catch{}});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
if(store.get('hideInstall',false))$('#installCard').style.display='none';

renderLists();applyPointerMode(settings.pointerMode);renderCurrentPcStatus();updateConnectButton();
refreshRelayHealth().then(()=>{refreshPresence();updateConnectButton()});
setInterval(()=>refreshRelayHealth().then(updateConnectButton),10000);
setInterval(refreshPresence,8000);


// CHV Remote Web 3.0: resize the remote viewport to the real visible area
// above the iOS/Android software keyboard, then keep the active remote field in it.
if(window.visualViewport){
  let vvTimer=0;
  const updateVV=()=>{
    clearTimeout(vvTimer);vvTimer=setTimeout(()=>{
      syncKeyboardViewport();
      if(state.connected&&document.activeElement===$('#nativeKeyboardInput')&&(state.cursorEditable||state.cursorShape==='ibeam'))scheduleKeyboardReframe();
    },20);
  };
  window.visualViewport.addEventListener('resize',updateVV);
  window.visualViewport.addEventListener('scroll',updateVV);
  $('#nativeKeyboardInput').addEventListener('blur',()=>setTimeout(()=>{syncKeyboardViewport();clampPan();applyTransform()},80));
}

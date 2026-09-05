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
  keyboardComposing:false
};
const settings=Object.assign({
  quality:'balanced',savePasswords:false,autoAudio:false,autoMic:false,pointerMode:'mouse'
},store.get('settings',{}));
let favorites=store.get('favorites',[]);
let history=store.get('history',[]);

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
}
function qProfile(){
  return settings.quality==='quality'?[1920,1080,'contain']:
         settings.quality==='speed'?[1280,720,'contain']:[1600,900,'contain'];
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
      state.onlineCodes.add(code);setStatus('Conectado');
      const [w,h,fit]=qProfile();wsSend({type:'screen_profile',width:w,height:h,fit});
      saveConnection(code,secret);
      if(settings.autoAudio)setFeature('system_audio',true);
      if(settings.autoMic)setFeature('microphone',true);
      applyPointerMode(settings.pointerMode);renderLists();renderCurrentPcStatus();
      return;
    }
    if(o.type==='peer_status'&&(o.connected===false||o.online===false)){
      state.onlineCodes.delete(code);toast('Computador remoto desconectou');disconnect();return;
    }
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
  state.remoteW=be32(u,1);state.remoteH=be32(u,5);
  const now=performance.now(),dt=Math.max(1,now-state.frameAt);state.frameAt=now;
  const ifps=1000/dt,imbps=(u.length*8/1e6)/(dt/1000);
  state.fps=state.fps?state.fps*.82+ifps*.18:ifps;
  state.mbps=state.mbps?state.mbps*.82+imbps*.18:imbps;
  $('#fpsMetric').textContent=state.fps.toFixed(0)+' FPS';
  $('#mbpsMetric').textContent=state.mbps.toFixed(1)+' Mbps';
  const blob=new Blob([u.slice(9)],{type:'image/jpeg'}),url=URL.createObjectURL(blob),img=$('#remoteScreen'),old=img.dataset.url;
  img.onload=()=>{if(old)URL.revokeObjectURL(old);$('#screenPlaceholder').style.display='none';updateCursorVisual()};
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
function sendMouse(action,p,extra={}){
  if(!state.connected)return;
  wsSend({type:'input',kind:'mouse',action,x:p.x,y:p.y,...extra});
}
function clickAt(p,button='left'){
  sendMouse('down',p,{button});sendMouse('up',p,{button});
}
function sendKey(key,down){if(state.connected)wsSend({type:'input',kind:'key',key,down})}
function tapKey(k){sendKey(k,true);sendKey(k,false)}
function typeText(t){for(const ch of t)tapKey(ch)}
function sendCtrlAltDel(){
  if(!state.connected)return;
  sendKey('ctrl',true);sendKey('alt',true);sendKey('delete',true);
  setTimeout(()=>{sendKey('delete',false);sendKey('alt',false);sendKey('ctrl',false)},120);
  toast('Ctrl + Alt + Del enviado');
}
function setFeature(feature,enabled){
  if(!state.canAdmin){toast('Esse recurso foi bloqueado pelo computador remoto');return false}
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

function saveConnection(id,password){
  const now=new Date().toISOString();
  const old=history.find(x=>x.id===id);
  history=[{id,date:now,password:settings.savePasswords?password:(old?.password||'')},...history.filter(x=>x.id!==id)].slice(0,30);
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
    favorites.unshift({id,password:settings.savePasswords?(password||h?.password||''):''});
    toast('Adicionado aos favoritos');
  }
  store.set('favorites',favorites);renderLists();refreshPresence();
}
function rowStatus(id){
  if(!state.relayOnline)return 'offline';
  if(!state.presenceKnown.has(id))return 'unknown';
  return state.onlineCodes.has(id)?'online':'offline';
}
function fillAndGo(id,password){
  $('#remoteId').value=id;$('#remotePassword').value=password||'';
  showView('homeView');updateConnectButton();renderCurrentPcStatus();
  if(!password)$('#remotePassword').focus();
}
function listItem(item,kind){
  const id=item.id,password=item.password||'',date=item.date||'',fav=isFavorite(id),online=rowStatus(id);
  const el=document.createElement('div');el.className='list-item';
  el.innerHTML=`<div class="pc">▣<i class="status-dot ${online}"></i></div>
    <div class="info"><strong>ID ${id}</strong><small>${online==='online'?'Online':online==='offline'?'Offline':'Verificando…'}${date?' • '+new Date(date).toLocaleString('pt-BR'):''}</small></div>
    <div class="list-actions"><button class="star ${fav?'active':''}" aria-label="${fav?'Remover dos favoritos':'Adicionar aos favoritos'}">${fav?'★':'☆'}</button><button class="go">Conectar</button></div>`;
  el.querySelector('.star').onclick=e=>{e.stopPropagation();toggleFavorite(id,password)};
  el.querySelector('.go').onclick=e=>{e.stopPropagation();fillAndGo(id,password)};
  el.querySelector('.info').onclick=()=>fillAndGo(id,password);
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
  try{state.ws?.close(1000)}catch{}
  state.ws=null;state.connected=false;
  $('#remoteScreen').removeAttribute('src');$('#screenPlaceholder').style.display='flex';
  showView('homeView');setStatus('Pronto para conectar');resetViewTransform();updateConnectButton();refreshPresence();
}

function applyPointerMode(mode){
  settings.pointerMode=mode==='touch'?'touch':'mouse';store.set('settings',settings);
  const mouse=settings.pointerMode==='mouse',wrap=$('#screenWrap'),btn=$('#modeBtn');
  wrap.classList.toggle('mouse-mode',mouse);
  $('#controlBadge').textContent=mouse?'Mouse':'Touch Screen';
  btn.innerHTML=mouse?'➤<span>Mouse</span>':'☝<span>Touch</span>';
  btn.classList.toggle('active',!mouse);
  $('#pointerMode').value=settings.pointerMode;updateCursorVisual();
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
function startLongPress(p){
  clearLongPress();state.longPressFired=false;
  state.longPressTimer=setTimeout(()=>{
    state.longPressFired=true;
    const target=settings.pointerMode==='mouse'?state.cursor:p;
    clickAt(target,'right');toast('Clique direito');
  },620);
}
function resetGestureFlags(){
  state.moved=false;state.dragging=false;state.longPressFired=false;state.lastPointer=null;clearLongPress();
}
function pointerDown(e){
  if(!state.connected)return;
  e.preventDefault();$('#screenWrap').setPointerCapture?.(e.pointerId);
  state.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,time:performance.now()});
  if(state.pointers.size===2){
    clearLongPress();state.gesture=pinchSnapshot();return;
  }
  if(state.pointers.size>2)return;
  state.lastPointer={x:e.clientX,y:e.clientY,time:performance.now()};
  const p=settings.pointerMode==='mouse'?state.cursor:normalizedPoint(e.clientX,e.clientY);
  startLongPress(p);
}
function pointerMove(e){
  const ptr=state.pointers.get(e.pointerId);if(!ptr)return;
  e.preventDefault();
  const prev={x:ptr.x,y:ptr.y};ptr.x=e.clientX;ptr.y=e.clientY;
  if(state.pointers.size>=2){
    clearLongPress();handlePinch();return;
  }
  const dx=e.clientX-prev.x,dy=e.clientY-prev.y;
  if(Math.hypot(e.clientX-ptr.startX,e.clientY-ptr.startY)>8){state.moved=true;clearLongPress()}
  if(settings.pointerMode==='mouse'){
    if(!state.moved)return;
    const b=imageBox();
    state.cursor.x=Math.max(0,Math.min(1,state.cursor.x+dx/Math.max(80,b.width)));
    state.cursor.y=Math.max(0,Math.min(1,state.cursor.y+dy/Math.max(80,b.height)));
    sendMouse('move',state.cursor);updateCursorVisual();
  }else if(state.moved){
    const p=normalizedPoint(e.clientX,e.clientY);
    if(!state.dragging){
      state.dragging=true;
      const start=normalizedPoint(ptr.startX,ptr.startY);sendMouse('down',start,{button:'left'});
    }
    sendMouse('move',p);
  }
}
function pointerUp(e){
  const ptr=state.pointers.get(e.pointerId);if(!ptr)return;
  e.preventDefault();clearLongPress();
  const wasMulti=state.pointers.size>1;
  state.pointers.delete(e.pointerId);
  if(wasMulti){if(state.pointers.size<2)state.gesture=null;return}
  if(state.longPressFired){resetGestureFlags();return}
  if(settings.pointerMode==='mouse'){
    if(!state.moved)clickAt(state.cursor,'left');
  }else{
    const p=normalizedPoint(e.clientX,e.clientY);
    if(state.dragging)sendMouse('up',p,{button:'left'});else if(!state.moved)clickAt(p,'left');
  }
  resetGestureFlags();
}
function pointerCancel(e){
  const ptr=state.pointers.get(e.pointerId);
  if(ptr&&state.dragging&&settings.pointerMode==='touch'){
    sendMouse('up',normalizedPoint(ptr.x,ptr.y),{button:'left'});
  }
  state.pointers.delete(e.pointerId);resetGestureFlags();
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
  applyTransform();
}
function applyTransform(){
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

function openNativeKeyboard(){
  if(!state.connected)return;
  const input=$('#nativeKeyboardInput');
  input.value='';input.focus({preventScroll:true});
  try{input.setSelectionRange(0,0)}catch{}
  toast('Teclado do celular ativado');
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
async function toggleFullscreen(){
  const target=$('#sessionView');
  try{
    if(document.fullscreenElement||document.webkitFullscreenElement){
      (document.exitFullscreen||document.webkitExitFullscreen)?.call(document);
      target.classList.remove('compact');return;
    }
    const req=target.requestFullscreen||target.webkitRequestFullscreen;
    if(req){await req.call(target);return}
  }catch{}
  target.classList.toggle('compact');
  $('#fullscreenBtn').classList.toggle('active',target.classList.contains('compact'));
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
    const blob=new Blob(t.chunks),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=t.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    state.incoming.delete(meta.id);toast('Arquivo recebido: '+t.name);
  }else t.chunks.push(u.slice(5+ml));
}
async function sendFiles(files){
  if(!state.canAdmin)return toast('Envio de arquivos bloqueado pelo computador remoto');
  for(const file of files){
    const id=Date.now()+'-'+Math.random().toString(16).slice(2,10)+'-'+file.name;
    wsSend({type:'file_offer',id,name:file.name,size:file.size,clipboard:false,batch_id:crypto.randomUUID?.()||String(Date.now()),batch_final:true});
    const ab=new Uint8Array(await file.arrayBuffer());let index=0;
    for(let o=0;o<ab.length;o+=262144)sendFilePacket(id,index++,false,ab.slice(o,o+262144));
    sendFilePacket(id,index,true,new Uint8Array());toast('Arquivo enviado: '+file.name);
  }
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
['quality','savePasswords','autoAudio','autoMic'].forEach(id=>$('#'+id).onchange=e=>{
  settings[id]=e.target.type==='checkbox'?e.target.checked:e.target.value;store.set('settings',settings);
});
$('#pointerMode').onchange=e=>applyPointerMode(e.target.value);
$('#modeBtn').onclick=()=>applyPointerMode(settings.pointerMode==='mouse'?'touch':'mouse');
$('#keyboardBtn').onclick=openNativeKeyboard;
$('#cadBtn').onclick=sendCtrlAltDel;
$('#fileBtn').onclick=()=>$('#fileInput').click();$('#fileInput').onchange=e=>sendFiles([...e.target.files]);
$('#audioBtn').onclick=async e=>{await ensureAudio();const on=!e.currentTarget.classList.contains('active');if(setFeature('system_audio',on))e.currentTarget.classList.toggle('active',on)};
$('#micBtn').onclick=async e=>{await ensureAudio();const on=!e.currentTarget.classList.contains('active');if(setFeature('microphone',on))e.currentTarget.classList.toggle('active',on)};
$('#fullscreenBtn').onclick=toggleFullscreen;
const sw=$('#screenWrap');
sw.addEventListener('pointerdown',pointerDown,{passive:false});
sw.addEventListener('pointermove',pointerMove,{passive:false});
sw.addEventListener('pointerup',pointerUp,{passive:false});
sw.addEventListener('pointercancel',pointerCancel,{passive:false});
sw.addEventListener('wheel',wheel,{passive:false});
sw.addEventListener('contextmenu',e=>e.preventDefault());
const nki=$('#nativeKeyboardInput');
nki.addEventListener('beforeinput',nativeBeforeInput);
nki.addEventListener('keydown',nativeKeyDown);
nki.addEventListener('compositionstart',()=>state.keyboardComposing=true);
nki.addEventListener('compositionend',nativeCompositionEnd);
document.addEventListener('fullscreenchange',()=>$('#fullscreenBtn').classList.toggle('active',!!document.fullscreenElement));
window.addEventListener('resize',()=>requestAnimationFrame(updateCursorVisual));
window.addEventListener('pagehide',()=>{try{state.ws?.close()}catch{}});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
if(store.get('hideInstall',false))$('#installCard').style.display='none';

renderLists();applyPointerMode(settings.pointerMode);renderCurrentPcStatus();updateConnectButton();
refreshRelayHealth().then(()=>{refreshPresence();updateConnectButton()});
setInterval(()=>refreshRelayHealth().then(updateConnectButton),10000);
setInterval(refreshPresence,8000);

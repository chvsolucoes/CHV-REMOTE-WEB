from pathlib import Path

p=Path('pwa/app.js')
s=p.read_text()

def replace_once(old,new,label):
    global s
    if old not in s:
        raise SystemExit('missing '+label)
    s=s.replace(old,new,1)

def replace_between(start,end,new,label):
    global s
    a=s.find(start)
    if a<0: raise SystemExit('missing start '+label)
    b=s.find(end,a)
    if b<0: raise SystemExit('missing end '+label)
    s=s[:a]+new+s[b:]

replace_once(
"  currentCode:null,lastThumbAt:0,mouseDragArmTimer:null,mouseDragArmed:false\n};",
"  currentCode:null,lastThumbAt:0,mouseDragArmTimer:null,mouseDragArmed:false,\n  pendingFrame:null,frameDecoding:false,pendingMouseMove:null,mouseMoveRaf:0,\n  lastTapAt:0,lastTapPos:null,doubleTapDrag:false,focusProbeTimer:null,keyboardProbeArmed:false\n};",
'state v25')

replace_between('function qProfile(){','\nfunction uniqueCodes(){',r'''function qProfile(){
  // O iPhone não precisa receber um JPEG 4K inteiro em 100% de zoom.
  // A resolução sobe dinamicamente apenas quando o usuário realmente amplia.
  return settings.quality==='quality'?[1920,1080,'contain']:
         settings.quality==='speed'?[1280,720,'contain']:[1600,900,'contain'];
}
function streamTuning(){
  return settings.quality==='quality'?{fps:26,jpeg_quality:84,subsampling:2}:
         settings.quality==='speed'?{fps:30,jpeg_quality:68,subsampling:2}:{fps:30,jpeg_quality:76,subsampling:2};
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
  // Hosts 2.5+ aplicam FPS/qualidade de forma adaptativa; hosts antigos ignoram sem quebrar compatibilidade.
  wsSend({type:'stream_tuning',width:w,height:h,fps:t.fps,jpeg_quality:t.jpeg_quality,subsampling:t.subsampling,reason});
}
''','qProfile v25')

replace_once(
"      state.onlineCodes.add(code);setStatus('Conectado');state.currentCode=code;\n      const [w,h,fit]=qProfile();wsSend({type:'screen_profile',width:w,height:h,fit});setTimeout(requestSharpFrame,220);",
"      state.onlineCodes.add(code);setStatus('Conectado');state.currentCode=code;\n      sendAdaptiveStreamProfile('connect');setTimeout(requestSharpFrame,160);",
'ready stream')

replace_between('function frame(u){','\nfunction imageBox(){',r'''function frame(u){
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
''','frame latest-only')

replace_between('function sendMouse(action,p,extra={}){','\nfunction sendKey(key,down){',r'''function flushMouseMove(){
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
  requestImmediateFrame(button==='right'?'right_click':'click');
}
function armKeyboardProbe(){
  const input=$('#nativeKeyboardInput');
  clearTimeout(state.focusProbeTimer);state.keyboardProbeArmed=true;
  // Foco acontece dentro do gesto do usuário, porém com inputmode=none: não abre teclado em cliques comuns.
  input.setAttribute('inputmode','none');input.value='';
  try{input.focus({preventScroll:true})}catch{}
  state.focusProbeTimer=setTimeout(()=>{
    if(!state.keyboardProbeArmed)return;
    state.keyboardProbeArmed=false;try{input.blur()}catch{}
  },420);
}
function probeTextFocus(p){
  if(!state.connected)return;
  state.lastFocusProbeAt=Date.now();armKeyboardProbe();
  wsSend({type:'text_focus_probe',x:p.x,y:p.y});
}
function resolveTextFocus(editable,numeric=false){
  clearTimeout(state.focusProbeTimer);
  const input=$('#nativeKeyboardInput');
  if(!editable){state.keyboardProbeArmed=false;try{input.blur()}catch{};return}
  state.keyboardProbeArmed=false;
  input.setAttribute('inputmode',numeric?'numeric':'text');input.value='';
  // O input já foi focado durante o toque; trocar o inputmode e refocar preserva a ativação no iOS/PWA.
  try{input.blur();input.focus({preventScroll:true});input.setSelectionRange(0,0)}catch{}
}
''','mouse coalescing + keyboard probe')

replace_once(
"    if(['text_focus','editable_focus','input_focus'].includes(o.type)){\n      const editable=o.editable!==false&&o.focused!==false;\n      if(editable)openNativeKeyboard(o.numeric?'numeric':'text',true);\n      return;\n    }",
"    if(['text_focus','editable_focus','input_focus'].includes(o.type)){\n      const editable=o.editable!==false&&o.focused!==false;\n      resolveTextFocus(editable,!!o.numeric);\n      return;\n    }",
'focus response')

replace_between('function clearLongPress(){','\nfunction pinchSnapshot(){',r'''function clearLongPress(){
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
    const lp=state.lastTapPos;
    const doubleTap=!!lp&&now-state.lastTapAt<=360&&Math.hypot(e.clientX-lp.x,e.clientY-lp.y)<=30;
    if(doubleTap){
      state.doubleTapDrag=true;state.dragging=true;state.lastTapAt=0;state.lastTapPos=null;
      clearLongPress();clearMouseDragArm();sendMouse('down',state.cursor,{button:'left'});
    }else{
      clearMouseDragArm();const pid=e.pointerId;
      state.mouseDragArmTimer=setTimeout(()=>{if(state.pointers.has(pid)&&!state.moved&&!state.longPressFired&&!state.doubleTapDrag)state.mouseDragArmed=true},190);
      startLongPress(state.cursor);
    }
  }else startLongPress(normalizedPoint(e.clientX,e.clientY));
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
    sendMouse('move',state.cursor,state.dragging?{button:'left',buttons:1}:{});
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
      sendMouse('up',state.cursor,{button:'left'});requestImmediateFrame(state.doubleTapDrag?'double_drag':'drag');
      if(!state.moved&&state.doubleTapDrag)probeTextFocus(state.cursor);
      state.lastTapAt=0;state.lastTapPos=null;
    }else if(!state.moved){
      clickAt(state.cursor,'left');probeTextFocus(state.cursor);
      state.lastTapAt=performance.now();state.lastTapPos={x:e.clientX,y:e.clientY};
    }else{state.lastTapAt=0;state.lastTapPos=null}
  }else{
    const point=normalizedPoint(e.clientX,e.clientY);
    if(state.dragging){sendMouse('move',point,{button:'left',buttons:1});sendMouse('up',point,{button:'left'});requestImmediateFrame('touch_drag')}
    else if(!state.moved){clickAt(point,'left');probeTextFocus(point)}
  }
  resetGestureFlags();
}
function pointerCancel(e){
  if(state.edgeGesture&&state.edgeGesture.id===e.pointerId){state.edgeGesture=null;return}
  const ptr=state.pointers.get(e.pointerId);
  if(ptr&&state.dragging){const point=settings.pointerMode==='mouse'?state.cursor:normalizedPoint(ptr.x,ptr.y);sendMouse('up',point,{button:'left'})}
  state.pointers.delete(e.pointerId);flushMouseMove();resetGestureFlags();
}
''','pointer v25')

replace_between('function requestSharpFrame(){','\nfunction openNativeKeyboard(',r'''function requestSharpFrame(){
  clearTimeout(state.sharpTimer);
  state.sharpTimer=setTimeout(()=>sendAdaptiveStreamProfile(state.zoom>1?'zoom':'interaction'),120);
}
''','adaptive sharp frame')

# Keep explicit keyboard button behavior unchanged; it can still force native keyboard at any time.

replace_once("window.addEventListener('pagehide',()=>{releaseModifiers();try{state.ws?.close()}catch{}});",
"window.addEventListener('pagehide',()=>{releaseModifiers();flushMouseMove();try{state.ws?.close()}catch{}});",
'pagehide flush')

p.write_text(s)

# Version / PWA cache
idx=Path('pwa/index.html'); t=idx.read_text().replace('Versão PWA 2.4.0','Versão PWA 2.5.0'); idx.write_text(t)
sw=Path('pwa/sw.js'); t=sw.read_text().replace('chv-remote-pwa-v2.4.0','chv-remote-pwa-v2.5.0'); sw.write_text(t)

css=Path('pwa/app.css'); c=css.read_text(); c += r'''

/* CHV Remote Web 2.5 - low-latency pointer path */
body.session-active{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}
body.session-active #screenWrap{touch-action:none!important;cursor:default!important}
#nativeKeyboardInput{font-size:16px!important;transform:translateZ(0)}
'''; css.write_text(c)

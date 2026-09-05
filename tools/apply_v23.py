from pathlib import Path

def replace_once(s, old, new, label):
    if old not in s:
        raise SystemExit(f"missing pattern {label}")
    return s.replace(old, new, 1)

p = Path("pwa/app.js")
s = p.read_text(encoding="utf-8")

s = replace_once(s,
"""keyboardComposing:false,edgeGesture:null,menuOpen:false,quickPasswordTarget:null,
  modifiers:new Set()""",
"""keyboardComposing:false,edgeGesture:null,menuOpen:false,quickPasswordTarget:null,panGesture:null,
  modifiers:new Set()""","state")

s = replace_once(s,
"""function qProfile(){
  return settings.quality==='quality'?[1920,1080,'contain']:
         settings.quality==='speed'?[1280,720,'contain']:[1600,900,'contain'];
}""",
"""function qProfile(){
  return settings.quality==='quality'?[2560,1440,'contain']:
         settings.quality==='speed'?[1280,720,'contain']:[1920,1080,'contain'];
}""","qProfile")

s = replace_once(s,
"""const [w,h,fit]=qProfile();wsSend({type:'screen_profile',width:w,height:h,fit});""",
"""const [w,h,fit]=qProfile();wsSend({type:'screen_profile',width:w,height:h,fit});setTimeout(requestSharpFrame,220);""","ready profile")

s = replace_once(s,
"""function resetGestureFlags(){
  state.moved=false;state.dragging=false;state.longPressFired=false;state.lastPointer=null;clearLongPress();
}
function pointerDown(e){""",
"""function resetGestureFlags(){
  state.moved=false;state.dragging=false;state.longPressFired=false;state.lastPointer=null;state.panGesture=null;clearLongPress();
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
function pointerDown(e){""","gesture helpers")

s = replace_once(s,
"""state.lastPointer={x:e.clientX,y:e.clientY,time:performance.now()};
  const p=settings.pointerMode==='mouse'?state.cursor:normalizedPoint(e.clientX,e.clientY);""",
"""state.lastPointer={x:e.clientX,y:e.clientY,time:performance.now()};
  if(state.zoom>1)state.panGesture={id:e.pointerId,startX:e.clientX,startY:e.clientY,panX:state.panX,panY:state.panY};
  const p=settings.pointerMode==='mouse'?state.cursor:normalizedPoint(e.clientX,e.clientY);""","pan start")

s = replace_once(s,
"""const dx=e.clientX-prev.x,dy=e.clientY-prev.y;
  if(Math.hypot(e.clientX-ptr.startX,e.clientY-ptr.startY)>8){state.moved=true;clearLongPress()}
  if(settings.pointerMode==='mouse'){""",
"""const dx=e.clientX-prev.x,dy=e.clientY-prev.y;
  if(Math.hypot(e.clientX-ptr.startX,e.clientY-ptr.startY)>8){state.moved=true;clearLongPress()}
  if(state.zoom>1&&state.panGesture?.id===e.pointerId&&state.moved){
    state.panX=state.panGesture.panX+(e.clientX-state.panGesture.startX);
    state.panY=state.panGesture.panY+(e.clientY-state.panGesture.startY);
    clampPan();applyTransform();requestSharpFrame();return;
  }
  if(settings.pointerMode==='mouse'){""","zoom pan")

s = replace_once(s,
"""const start=normalizedPoint(ptr.startX,ptr.startY);sendMouse('down',start,{button:'left'});
    }
    sendMouse('move',p);""",
"""const start=normalizedPoint(ptr.startX,ptr.startY);sendMouse('down',start,{button:'left'});
    }
    sendMouse('move',p,{button:'left',buttons:1});""","touch drag move")

s = replace_once(s,
"""if(state.dragging)sendMouse('up',p,{button:'left'});else if(!state.moved){clickAt(p,'left');probeTextFocus(p)}""",
"""if(state.dragging){sendMouse('move',p,{button:'left',buttons:1});sendMouse('up',p,{button:'left'})}else if(!state.moved){clickAt(p,'left');probeTextFocus(p)}""","touch drag up")

s = replace_once(s,
"""function applyTransform(){
  const vp=$('#screenViewport');""",
"""function applyTransform(){
  clampPan();
  const vp=$('#screenViewport');""","clamp transform")

s = replace_once(s,
"""let w=1600,h=900;
    if(settings.quality==='speed'){w=1280;h=720}
    if(settings.quality==='quality'){w=2560;h=1440}""",
"""let w=1920,h=1080;
    if(settings.quality==='speed'){w=1280;h=720}
    if(settings.quality==='quality'){w=2560;h=1440}""","sharp base")

s = replace_once(s,
"""state.fullscreenFallback=!!on;
  $('#sessionView').classList.toggle('immersive',!!on);document.body.classList.toggle('session-immersive',!!on);""",
"""state.fullscreenFallback=!!on;
  $('#sessionView').classList.toggle('immersive',!!on);document.body.classList.toggle('session-immersive',!!on);document.documentElement.classList.toggle('session-immersive',!!on);""","immersive html")

s = replace_once(s,
"""sw.addEventListener('pointerdown',pointerDown,{passive:false});sw.addEventListener('pointermove',pointerMove,{passive:false});sw.addEventListener('pointerup',pointerUp,{passive:false});sw.addEventListener('pointercancel',pointerCancel,{passive:false});sw.addEventListener('wheel',wheel,{passive:false});sw.addEventListener('contextmenu',e=>e.preventDefault());""",
"""sw.addEventListener('pointerdown',pointerDown,{passive:false});sw.addEventListener('pointermove',pointerMove,{passive:false});sw.addEventListener('pointerup',pointerUp,{passive:false});sw.addEventListener('pointercancel',pointerCancel,{passive:false});sw.addEventListener('wheel',wheel,{passive:false});sw.addEventListener('contextmenu',e=>e.preventDefault());sw.addEventListener('selectstart',e=>e.preventDefault());sw.addEventListener('dragstart',e=>e.preventDefault());
const sessionActive=()=>$('#sessionView').classList.contains('active');
document.addEventListener('selectstart',e=>{if(sessionActive()&&!e.target.closest?.('input,textarea'))e.preventDefault()},{capture:true});
document.addEventListener('contextmenu',e=>{if(sessionActive()&&!e.target.closest?.('input,textarea'))e.preventDefault()},{capture:true});
document.addEventListener('dragstart',e=>{if(sessionActive())e.preventDefault()},{capture:true});
document.addEventListener('selectionchange',()=>{if(sessionActive()){const sel=window.getSelection?.();if(sel&&!$('#nativeKeyboardInput').matches(':focus'))try{sel.removeAllRanges()}catch{}}});""","native selection block")

s = replace_once(s,
"""window.addEventListener('resize',()=>requestAnimationFrame(updateCursorVisual));""",
"""window.addEventListener('resize',()=>requestAnimationFrame(()=>{clampPan();applyTransform();requestSharpFrame()}));""","resize")

p.write_text(s, encoding="utf-8")

p = Path("pwa/app.css")
css = p.read_text(encoding="utf-8")
if "CHV Remote Web 2.3 - touch isolation" not in css:
    css += r"""

/* CHV Remote Web 2.3 - touch isolation, zoom pan and fullscreen safe-area fixes */
.session-view,.session-view *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}
.session-view{-webkit-user-drag:none;touch-action:none}
.screen-wrap,.screen-wrap *{overscroll-behavior:none;-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important}
.screen-viewport,.screen-viewport img{touch-action:none!important;-webkit-user-drag:none!important;user-drag:none!important}
.metrics,.metrics span,.zoom-badge,.control-badge,.session-bar,.session-bar *{user-select:none!important;-webkit-user-select:none!important;-webkit-touch-callout:none!important}
.screen-viewport img{image-rendering:auto!important;filter:none;will-change:transform}
.edge-handle{left:max(0px,env(safe-area-inset-left));bottom:28%}
.edge-menu{left:calc(env(safe-area-inset-left) + 10px);top:50%;bottom:auto;transform:translateY(-50%);gap:clamp(5px,1.15vh,10px);max-height:calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 18px)}
.edge-submenu{left:calc(env(safe-area-inset-left) + 78px);top:50%;bottom:auto;transform:translateY(-50%);gap:8px}
.session-view.immersive .edge-handle{left:max(0px,env(safe-area-inset-left));bottom:26%}
.session-view.immersive .edge-menu{left:calc(env(safe-area-inset-left) + 10px);top:50%;bottom:auto;transform:translateY(-50%)}
.session-view.immersive .edge-submenu{left:calc(env(safe-area-inset-left) + 76px);top:50%;bottom:auto;transform:translateY(-50%)}
body.session-immersive .sheet,html.session-immersive .sheet{z-index:240!important;pointer-events:auto!important}
body.session-immersive .toast,html.session-immersive .toast{z-index:260!important}
body.session-immersive #app,html.session-immersive #app{height:100dvh!important;overflow:hidden!important;background:#000!important}
@media(orientation:landscape) and (max-height:520px){
  .edge-menu{top:50%!important;bottom:auto!important;gap:5px!important;transform:translateY(-50%)!important}
  .edge-submenu{top:50%!important;bottom:auto!important;transform:translateY(-50%)!important}
  .edge-bubble{width:44px!important;height:44px!important;font-size:19px!important;border-width:2px!important}
  .edge-bubble small{left:50px!important}
}
"""
p.write_text(css, encoding="utf-8")

p = Path("pwa/index.html")
h = p.read_text(encoding="utf-8").replace("Versão PWA 2.2.0", "Versão PWA 2.3.0")
p.write_text(h, encoding="utf-8")

p = Path("pwa/sw.js")
sw = p.read_text(encoding="utf-8").replace("chv-remote-pwa-v2.2.0", "chv-remote-pwa-v2.3.0")
p.write_text(sw, encoding="utf-8")
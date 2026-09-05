from pathlib import Path

app = Path('pwa/app.js')
css = Path('pwa/app.css')
sw = Path('pwa/sw.js')

s = app.read_text(encoding='utf-8')

old = """function streamTuning(){
  return settings.quality==='quality'?{fps:26,jpeg_quality:84,subsampling:2}:
         settings.quality==='speed'?{fps:30,jpeg_quality:68,subsampling:2}:{fps:30,jpeg_quality:76,subsampling:2};
}"""
new = """function streamTuning(){
  // Keep the encoder below saturation. A saturated JPEG encoder feels slower than
  // a slightly lower FPS stream because pointer/input packets wait behind frames.
  return settings.quality==='quality'?{fps:24,jpeg_quality:82,subsampling:2}:
         settings.quality==='speed'?{fps:36,jpeg_quality:60,subsampling:2}:{fps:30,jpeg_quality:72,subsampling:2};
}"""
if old not in s: raise SystemExit('streamTuning marker missing')
s = s.replace(old, new, 1)

old = """function noteInteraction(){
  if(!state.connected)return;
  clearTimeout(state.interactionBurstTimer);
  if(!state.interactionBurst){
    state.interactionBurst=true;
    // Perfil de baixa latência: reduz bytes enquanto move/arrasta e volta à qualidade normal logo depois.
    wsSend({type:'screen_profile',width:1024,height:576,fit:false,reason:'interactive'});
    wsSend({type:'stream_tuning',width:1024,height:576,fps:45,jpeg_quality:55,subsampling:2,reason:'interactive'});
  }
  state.interactionBurstTimer=setTimeout(()=>{state.interactionBurst=false;sendAdaptiveStreamProfile('settled')},220);
}
function postInputRefresh(reason='input'){
  for(const t of state.postInputTimers)clearTimeout(t);state.postInputTimers=[];
  for(const ms of [0,55,130,260,520,900])state.postInputTimers.push(setTimeout(()=>{
    if(state.connected)wsSend({type:'request_frame',reason});
  },ms));
  state.postInputTimers.push(setTimeout(()=>sendAdaptiveStreamProfile('post_'+reason),940));
}"""
new = """function noteInteraction(){
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
}"""
if old not in s: raise SystemExit('interaction marker missing')
s = s.replace(old, new, 1)

old = """function armKeyboardProbe(){
  const input=$('#nativeKeyboardInput');
  clearTimeout(state.focusProbeTimer);state.keyboardProbeArmed=true;
  input.setAttribute('inputmode','none');input.value='';
  try{input.focus({preventScroll:true})}catch{}
  state.focusProbeTimer=setTimeout(()=>{
    if(!state.keyboardProbeArmed)return;
    state.keyboardProbeArmed=false;try{input.blur()}catch{}
  },950);
}"""
new = """function armKeyboardProbe(numeric=false){
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
}"""
if old not in s: raise SystemExit('keyboard probe marker missing')
s = s.replace(old, new, 1)

old = """function openKeyboardForCursor(numeric=false){
  if(!state.connected)return false;
  const likely=state.cursorEditable||state.cursorShape==='ibeam';
  clearTimeout(state.focusProbeTimer);state.keyboardProbeArmed=true;
  const input=$('#nativeKeyboardInput');
  input.value='';input.setAttribute('inputmode',numeric?'numeric':'text');
  // O foco ocorre dentro do gesto físico: no iOS isso permite abrir o teclado antes da resposta assíncrona do host.
  try{input.focus({preventScroll:true});input.setSelectionRange(0,0)}catch{}
  if(likely)focusRemoteFieldView();
  state.focusProbeTimer=setTimeout(()=>{
    if(!state.keyboardProbeArmed)return;
    state.keyboardProbeArmed=false;try{input.blur()}catch{}
  },700);
  return true;
}"""
new = """function openKeyboardForCursor(numeric=false,force=false){
  if(!state.connected)return false;
  const likely=force||state.cursorEditable||state.cursorShape==='ibeam';
  if(!likely)return false;
  clearTimeout(state.focusProbeTimer);state.keyboardProbeArmed=true;
  const input=$('#nativeKeyboardInput');
  input.value='';input.setAttribute('inputmode',numeric?'numeric':'text');
  // Must run in pointerdown/up from the physical touch. This is what makes the
  // native iPhone/Android keyboard appear reliably instead of waiting on the host.
  try{input.focus({preventScroll:true});input.setSelectionRange(0,0)}catch{}
  focusRemoteFieldView();
  state.focusProbeTimer=setTimeout(()=>{
    if(!state.keyboardProbeArmed)return;
    state.keyboardProbeArmed=false;try{input.blur()}catch{}
  },850);
  return document.activeElement===input;
}"""
if old not in s: raise SystemExit('open keyboard marker missing')
s = s.replace(old, new, 1)

old = """function probeTextFocus(p,alreadyOpened=false){
  if(!state.connected)return;
  state.lastFocusProbeAt=Date.now();if(!alreadyOpened)armKeyboardProbe();
  wsSend({type:'text_focus_probe',x:p.x,y:p.y});
}"""
new = """function probeTextFocus(p,alreadyOpened=false){
  if(!state.connected)return;
  state.lastFocusProbeAt=Date.now();
  // If the cursor already says I-beam, keep the trusted-gesture focus alive. For
  // an unknown target, wait for the host instead of flashing a keyboard on buttons.
  if(!alreadyOpened&&(state.cursorEditable||state.cursorShape==='ibeam'))armKeyboardProbe(state.cursorNumeric);
  wsSend({type:'text_focus_probe',x:p.x,y:p.y});
}"""
if old not in s: raise SystemExit('probe focus marker missing')
s = s.replace(old, new, 1)

old = """  if(settings.pointerMode==='mouse'){
    const lp=state.lastTapPos;
    const doubleTap=!!lp&&now-state.lastTapAt<=420&&Math.hypot(e.clientX-lp.x,e.clientY-lp.y)<=38;"""
new = """  if(settings.pointerMode==='mouse'){
    // Prime the phone keyboard on pointer-down while Safari still treats this as a
    // user gesture. It is harmless for non-editable targets because it only runs
    // when the host's live cursor is already an I-beam/editable cursor.
    if(state.cursorEditable||state.cursorShape==='ibeam')openKeyboardForCursor(state.cursorNumeric);
    const lp=state.lastTapPos;
    const doubleTap=!!lp&&now-state.lastTapAt<=420&&Math.hypot(e.clientX-lp.x,e.clientY-lp.y)<=38;"""
if old not in s: raise SystemExit('pointer down marker missing')
s = s.replace(old, new, 1)

old = """    }else if(!state.moved){
      const keyboardOpened=openKeyboardForCursor(state.cursorNumeric);clickAt(state.cursor,'left');probeTextFocus(state.cursor,keyboardOpened);
      state.lastTapAt=performance.now();state.lastTapPos={x:e.clientX,y:e.clientY};"""
new = """    }else if(!state.moved){
      const keyboardOpened=(document.activeElement===$('#nativeKeyboardInput'))||openKeyboardForCursor(state.cursorNumeric);
      clickAt(state.cursor,'left');probeTextFocus(state.cursor,keyboardOpened);
      state.lastTapAt=performance.now();state.lastTapPos={x:e.clientX,y:e.clientY};"""
if old not in s: raise SystemExit('pointer up mouse marker missing')
s = s.replace(old, new, 1)

# Touch-screen mode has no hover cursor, so prime the input in the user gesture and
# let text_focus cancel it when the target is not editable.
old = """  }else startLongPress(normalizedPoint(e.clientX,e.clientY));
}"""
new = """  }else{
    armKeyboardProbe(false);
    startLongPress(normalizedPoint(e.clientX,e.clientY));
  }
}"""
if old not in s: raise SystemExit('pointer touch marker missing')
s = s.replace(old, new, 1)

# During a double-tap drag, keep the left button held from the second pointer-down
# through every move. The host receives buttons=1 on motion, matching desktop drag.
old = """    if(doubleTap){
      state.doubleTapDrag=true;state.dragging=true;state.lastTapAt=0;state.lastTapPos=null;
      clearLongPress();clearMouseDragArm();sendMouse('down',state.cursor,{button:'left'});
"""
new = """    if(doubleTap){
      state.doubleTapDrag=true;state.dragging=true;state.lastTapAt=0;state.lastTapPos=null;
      clearLongPress();clearMouseDragArm();flushMouseMove();sendMouse('down',state.cursor,{button:'left',buttons:1});
"""
if old not in s: raise SystemExit('double drag marker missing')
s = s.replace(old, new, 1)

# Reposition again after the visual viewport shrinks for the software keyboard.
append = """

// CHV Remote Web 2.9: keep the remote edit field visible when the iOS/Android
// software keyboard changes the visual viewport height.
if(window.visualViewport){
  let vvTimer=0;
  window.visualViewport.addEventListener('resize',()=>{
    clearTimeout(vvTimer);
    vvTimer=setTimeout(()=>{
      if(state.connected&&document.activeElement===$('#nativeKeyboardInput')&&(state.cursorEditable||state.cursorShape==='ibeam'))focusRemoteFieldView();
    },45);
  });
}
"""
if 'CHV Remote Web 2.9: keep the remote edit field visible' not in s:
    s += append
app.write_text(s, encoding='utf-8')

c = css.read_text(encoding='utf-8')
old = ".native-keyboard-input{position:fixed;left:0;bottom:0;width:2px!important;height:2px!important;opacity:0;z-index:999;border:0;padding:0;pointer-events:none}"
new = ".native-keyboard-input{position:fixed;left:1px;bottom:calc(1px + var(--safe-bottom));width:1px!important;height:1px!important;opacity:.01;z-index:999;border:0;padding:0;pointer-events:none;font-size:16px!important;caret-color:transparent;background:transparent;color:transparent}"
if old not in c: raise SystemExit('native input css marker missing')
c = c.replace(old,new,1)
# Make contextual cursor shapes visibly distinct and Windows-like on the phone.
if '/* CHV Remote Web 2.9 contextual cursor */' not in c:
    c += """
/* CHV Remote Web 2.9 contextual cursor */
.remote-cursor[data-shape="ibeam"]{width:22px;height:36px;transform:translate(-11px,-18px)}
.remote-cursor[data-shape="hand"]{width:32px;height:38px;transform:translate(-9px,-4px)}
.remote-cursor[data-shape="wait"],.remote-cursor[data-shape="appstarting"]{width:30px;height:36px;transform:translate(-15px,-18px)}
.remote-cursor[data-shape^="size_"]{width:34px;height:34px;transform:translate(-17px,-17px)}
.remote-cursor[data-shape="cross"]{width:32px;height:32px;transform:translate(-16px,-16px)}
.remote-cursor[data-shape="arrow"]{width:30px;height:40px;transform:translate(-3px,-3px)}
"""
css.write_text(c, encoding='utf-8')

w = sw.read_text(encoding='utf-8')
w = w.replace("const CACHE='chv-remote-pwa-v2.8.0';", "const CACHE='chv-remote-pwa-v2.9.0';")
if "v2.9.0" not in w: raise SystemExit('service worker cache marker missing')
sw.write_text(w, encoding='utf-8')

print('CHV_WEB_2_9_PATCH_OK')

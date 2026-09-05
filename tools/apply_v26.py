from pathlib import Path

p=Path('pwa/app.js')
s=p.read_text()

def once(old,new,label):
    global s
    if old not in s:
        raise SystemExit('missing '+label)
    s=s.replace(old,new,1)

once("  lastTapAt:0,lastTapPos:null,doubleTapDrag:false,focusProbeTimer:null,keyboardProbeArmed:false\n};",
     "  lastTapAt:0,lastTapPos:null,doubleTapDrag:false,focusProbeTimer:null,keyboardProbeArmed:false,\n  interactionBurstTimer:null,interactionBurst:false,postInputTimers:[]\n};",'state')

once("function sendAdaptiveStreamProfile(reason='view'){\n  if(!state.connected)return;\n  const [w,h]=adaptiveDimensions(),t=streamTuning();\n  wsSend({type:'screen_profile',width:w,height:h,fit:false,reason});\n  // Hosts 2.5+ aplicam FPS/qualidade de forma adaptativa; hosts antigos ignoram sem quebrar compatibilidade.\n  wsSend({type:'stream_tuning',width:w,height:h,fps:t.fps,jpeg_quality:t.jpeg_quality,subsampling:t.subsampling,reason});\n}",
"function sendAdaptiveStreamProfile(reason='view'){\n  if(!state.connected)return;\n  const [w,h]=adaptiveDimensions(),t=streamTuning();\n  wsSend({type:'screen_profile',width:w,height:h,fit:false,reason});\n  wsSend({type:'stream_tuning',width:w,height:h,fps:t.fps,jpeg_quality:t.jpeg_quality,subsampling:t.subsampling,reason});\n}\nfunction noteInteraction(){\n  if(!state.connected)return;\n  clearTimeout(state.interactionBurstTimer);\n  if(!state.interactionBurst){\n    state.interactionBurst=true;\n    // Durante mouse/arraste, privilegia latência em vez de mandar JPEG grande demais.\n    wsSend({type:'screen_profile',width:1280,height:720,fit:false,reason:'interactive'});\n    wsSend({type:'stream_tuning',width:1280,height:720,fps:35,jpeg_quality:62,subsampling:2,reason:'interactive'});\n  }\n  state.interactionBurstTimer=setTimeout(()=>{state.interactionBurst=false;sendAdaptiveStreamProfile('settled')},320);\n}\nfunction postInputRefresh(reason='input'){\n  for(const t of state.postInputTimers)clearTimeout(t);state.postInputTimers=[];\n  for(const ms of [0,55,130,260,520,900])state.postInputTimers.push(setTimeout(()=>{\n    if(state.connected)wsSend({type:'request_frame',reason});\n  },ms));\n  state.postInputTimers.push(setTimeout(()=>sendAdaptiveStreamProfile('post_'+reason),940));\n}", 'adaptive')

once("function sendMouse(action,p,extra={}){\n  if(!state.connected)return;\n  if(action==='move'){queueMouseMove(p,extra);return}\n  flushMouseMove();\n  wsSend({type:'input',kind:'mouse',action,x:p.x,y:p.y,...extra});\n}",
"function sendMouse(action,p,extra={}){\n  if(!state.connected)return;\n  noteInteraction();\n  if(action==='move'){queueMouseMove(p,extra);return}\n  flushMouseMove();\n  wsSend({type:'input',kind:'mouse',action,x:p.x,y:p.y,...extra});\n}", 'sendMouse')

once("function clickAt(p,button='left'){\n  sendMouse('down',p,{button});sendMouse('up',p,{button});\n  requestImmediateFrame(button==='right'?'right_click':'click');\n}",
"function clickAt(p,button='left'){\n  sendMouse('down',p,{button});sendMouse('up',p,{button});\n  postInputRefresh(button==='right'?'right_click':'click');\n}", 'clickAt')

once("function sendKey(key,down){if(state.connected)wsSend({type:'input',kind:'key',key,down})}",
"function sendKey(key,down){if(state.connected){noteInteraction();wsSend({type:'input',kind:'key',key,down});if(!down)postInputRefresh('key')}}", 'sendKey')

once("sendMouse('up',state.cursor,{button:'left'});requestImmediateFrame(state.doubleTapDrag?'double_drag':'drag');",
     "sendMouse('up',state.cursor,{button:'left'});postInputRefresh(state.doubleTapDrag?'double_drag':'drag');",'mouse drag refresh')
once("sendMouse('move',point,{button:'left',buttons:1});sendMouse('up',point,{button:'left'});requestImmediateFrame('touch_drag')",
     "sendMouse('move',point,{button:'left',buttons:1});sendMouse('up',point,{button:'left'});postInputRefresh('touch_drag')",'touch drag refresh')

# Double-click + drag: second press is already held down; make threshold more forgiving and faster.
once("const doubleTap=!!lp&&now-state.lastTapAt<=360&&Math.hypot(e.clientX-lp.x,e.clientY-lp.y)<=30;",
     "const doubleTap=!!lp&&now-state.lastTapAt<=420&&Math.hypot(e.clientX-lp.x,e.clientY-lp.y)<=38;",'double tap')

# Focus probe stays host-driven, but use a larger activation window for iOS asynchronous response.
once("  },420);","  },900);",'probe window')

# Stronger iOS capture: capture-phase prevention on the document during a remote session.
once("['touchstart','touchmove','touchend','touchcancel','gesturestart','gesturechange','gestureend'].forEach(t=>sw.addEventListener(t,blockIOSNativeGesture,{passive:false}));",
"['touchstart','touchmove','touchend','touchcancel','gesturestart','gesturechange','gestureend'].forEach(t=>{\n  sw.addEventListener(t,blockIOSNativeGesture,{passive:false});\n  document.addEventListener(t,blockIOSNativeGesture,{passive:false,capture:true});\n});",'ios block')

# Version marker
idx=Path('pwa/index.html');x=idx.read_text().replace('Versão PWA 2.5.0','Versão PWA 2.6.0');idx.write_text(x)
sw=Path('pwa/sw.js');x=sw.read_text().replace('chv-remote-pwa-v2.5.0','chv-remote-pwa-v2.6.0');sw.write_text(x)

p.write_text(s)

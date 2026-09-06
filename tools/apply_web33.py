from pathlib import Path

app = Path('pwa/app.js')
s = app.read_text(encoding='utf-8')

old = "remotePermissions:{audio:true,microphone:true,full_control:true},keyboardReframeTimers:[]"
new = "remotePermissions:{audio:true,microphone:true,full_control:true},keyboardReframeTimers:[],keyboardTarget:null"
if old not in s and new not in s:
    raise SystemExit('WEB33 state marker missing')
if old in s:
    s = s.replace(old, new, 1)

old = """  const f=fitImageBase(),scaledW=f.width*state.zoom,scaledH=f.height*state.zoom;\n  // Work in screenWrap-local coordinates. Desired Y is deliberately high so the\n  // caret/password field and the following line remain visible above the keyboard.\n  const targetY=Math.max(54,Math.min(wr.height*.30,168));\n  const cursorY=wr.height/2+state.panY+(state.cursor.y-.5)*scaledH;\n  state.panY+=targetY-cursorY;\n  const leftGuard=Math.max(48,wr.width*.16),rightGuard=wr.width-leftGuard;\n  const cursorX=wr.width/2+state.panX+(state.cursor.x-.5)*scaledW;\n"""
new = """  const f=fitImageBase(),scaledW=f.width*state.zoom,scaledH=f.height*state.zoom;\n  // Track the actual remote point that was tapped. Cursor probing can arrive one\n  // or two frames later on a busy host, which used to pan to the old cursor and\n  // leave the real password/text field hidden behind the phone keyboard.\n  const kp=state.keyboardTarget||state.cursor;\n  const targetY=Math.max(48,Math.min(wr.height*.25,142));\n  const cursorY=wr.height/2+state.panY+(kp.y-.5)*scaledH;\n  state.panY+=targetY-cursorY;\n  const leftGuard=Math.max(48,wr.width*.16),rightGuard=wr.width-leftGuard;\n  const cursorX=wr.width/2+state.panX+(kp.x-.5)*scaledW;\n"""
if old not in s and 'const kp=state.keyboardTarget||state.cursor;' not in s:
    raise SystemExit('WEB33 focus marker missing')
if old in s:
    s = s.replace(old, new, 1)

old = "for(const ms of [0,55,140,260,420])"
new = "for(const ms of [0,60,150,280,460,700])"
if old in s:
    s = s.replace(old, new, 1)
elif new not in s:
    raise SystemExit('WEB33 timer marker missing')

old = """function probeTextFocus(p,alreadyOpened=false){\n  if(!state.connected)return;\n  state.lastFocusProbeAt=Date.now();\n"""
new = """function probeTextFocus(p,alreadyOpened=false){\n  if(!state.connected)return;\n  state.keyboardTarget={x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))};\n  state.lastFocusProbeAt=Date.now();\n"""
if old in s:
    s = s.replace(old, new, 1)
elif 'state.keyboardTarget={x:Math.max(0,Math.min(1,p.x))' not in s:
    raise SystemExit('WEB33 probe marker missing')

old = "if(!editable){state.keyboardProbeArmed=false;if(state.cursorShape==='ibeam')applyCursorState({shape:'arrow',editable:false});try{input.blur()}catch{};return}"
new = "if(!editable){state.keyboardProbeArmed=false;state.keyboardTarget=null;if(state.cursorShape==='ibeam')applyCursorState({shape:'arrow',editable:false});try{input.blur()}catch{};return}"
if old in s:
    s = s.replace(old, new, 1)
elif 'state.keyboardTarget=null;if(state.cursorShape' not in s:
    raise SystemExit('WEB33 blur marker missing')

app.write_text(s, encoding='utf-8')

sw = Path('pwa/sw.js')
t = sw.read_text(encoding='utf-8')
if 'chv-remote-pwa-v3.2.0' in t:
    t = t.replace('chv-remote-pwa-v3.2.0', 'chv-remote-pwa-v3.3.0')
elif 'chv-remote-pwa-v3.3.0' not in t:
    raise SystemExit('WEB33 cache marker missing')
sw.write_text(t, encoding='utf-8')

idx = Path('pwa/index.html')
h = idx.read_text(encoding='utf-8')
if 'Versão PWA 3.2.0' in h:
    h = h.replace('Versão PWA 3.2.0', 'Versão PWA 3.3.0')
elif 'Versão PWA 3.3.0' not in h:
    raise SystemExit('WEB33 version marker missing')
idx.write_text(h, encoding='utf-8')

print('CHV_WEB33_KEYBOARD_TARGET_OK')

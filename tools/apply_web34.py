from pathlib import Path

app_path = Path('pwa/app.js')
app = app_path.read_text(encoding='utf-8')

old_state = '''  remotePermissions:{audio:true,microphone:true,full_control:true},keyboardReframeTimers:[],keyboardTarget:null\n};\n'''
new_state = '''  remotePermissions:{audio:true,microphone:true,full_control:true},keyboardReframeTimers:[],keyboardTarget:null,\n  secureDesktop:false,portableBlocked:false,secureProbeTimers:[]\n};\n'''
if old_state not in app:
    raise SystemExit('WEB34 state marker missing')
app = app.replace(old_state, new_state, 1)

old_apply = '''function applyCursorState(o){\n  const shape=normalizeCursorShape(o?.shape||'arrow');\n  state.cursorShape=shape;state.cursorEditable=!!(o?.editable||shape==='ibeam');state.cursorNumeric=!!o?.numeric;\n  const c=$('#mouseCursor');c.dataset.shape=shape;c.innerHTML=cursorMarkup(shape);updateCursorVisual();\n}\n'''
new_apply = '''function resetRemoteInputStateForDesktopTransition(){\n  if(state.mouseMoveRaf){cancelAnimationFrame(state.mouseMoveRaf);state.mouseMoveRaf=0}\n  state.pendingMouseMove=null;state.pointers.clear();state.gesture=null;state.edgeGesture=null;\n  state.dragging=false;state.doubleTapDrag=false;state.mouseDragArmed=false;state.moved=false;\n  clearLongPress();clearMouseDragArm();\n  state.keyboardProbeArmed=false;state.keyboardTarget=null;clearTimeout(state.focusProbeTimer);\n  const input=$('#nativeKeyboardInput');try{input?.blur()}catch{}\n  // Modifier state must not survive a switch from the user's desktop to Winlogon.\n  // The Windows host also performs a LocalSystem RESETINPUT, so both ends agree.\n  if(state.modifiers.size)releaseModifiers();\n}\nfunction clearSecureProbeTimers(){for(const t of state.secureProbeTimers)clearTimeout(t);state.secureProbeTimers=[]}\nfunction scheduleSecureCursorProbe(){\n  clearSecureProbeTimers();\n  for(const ms of [70,160,300,520,850,1250])state.secureProbeTimers.push(setTimeout(()=>{\n    if(state.connected){probeCursorState(true);wsSend({type:'request_frame',reason:'secure_desktop_transition'})}\n  },ms));\n}\nfunction applyCursorState(o){\n  const shape=normalizeCursorShape(o?.shape||'arrow');\n  const nextSecure=!!o?.secure_desktop,nextPortable=!!o?.portable_blocked;\n  const changed=nextSecure!==state.secureDesktop||nextPortable!==state.portableBlocked;\n  if(changed)resetRemoteInputStateForDesktopTransition();\n  state.secureDesktop=nextSecure;state.portableBlocked=nextPortable;\n  state.cursorShape=shape;state.cursorEditable=!nextPortable&&!!(o?.editable||shape==='ibeam');state.cursorNumeric=!!o?.numeric;\n  if(nextPortable){state.cursorShape='arrow';state.cursorEditable=false}\n  const c=$('#mouseCursor');c.dataset.shape=state.cursorShape;c.innerHTML=cursorMarkup(state.cursorShape);updateCursorVisual();\n  if(changed&&nextSecure)scheduleSecureCursorProbe();\n}\n'''
if old_apply not in app:
    raise SystemExit('WEB34 applyCursorState marker missing')
app = app.replace(old_apply, new_apply, 1)

old_open = '''function openKeyboardForCursor(numeric=false,force=false){\n  if(!state.connected)return false;\n  const likely=force||state.cursorEditable||state.cursorShape==='ibeam';\n'''
new_open = '''function openKeyboardForCursor(numeric=false,force=false){\n  if(!state.connected||state.portableBlocked)return false;\n  const likely=force||state.cursorEditable||state.cursorShape==='ibeam';\n'''
if old_open not in app:
    raise SystemExit('WEB34 open keyboard marker missing')
app = app.replace(old_open, new_open, 1)

old_probe = '''function probeTextFocus(p,alreadyOpened=false){\n  if(!state.connected)return;\n  state.keyboardTarget={x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))};\n'''
new_probe = '''function probeTextFocus(p,alreadyOpened=false){\n  if(!state.connected||state.portableBlocked)return;\n  state.keyboardTarget={x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))};\n'''
if old_probe not in app:
    raise SystemExit('WEB34 text focus marker missing')
app = app.replace(old_probe, new_probe, 1)

old_sas = '''    if(o.type==='secure_attention_result'){toast(o.ok?'Ctrl + Alt + Del executado':'Não foi possível executar Ctrl + Alt + Del neste computador');postInputRefresh('secure_attention_result');return}\n'''
new_sas = '''    if(o.type==='secure_attention_result'){\n      toast(o.ok?'Ctrl + Alt + Del executado':'Não foi possível executar Ctrl + Alt + Del neste computador');\n      if(o.ok){resetRemoteInputStateForDesktopTransition();scheduleSecureCursorProbe()}\n      postInputRefresh('secure_attention_result');return\n    }\n'''
if old_sas not in app:
    raise SystemExit('WEB34 SAS result marker missing')
app = app.replace(old_sas, new_sas, 1)

# Do not let a stale I-beam from the previous desktop prime Safari's keyboard.
old_pointer_down = '''  if(settings.pointerMode==='mouse'){\n    // Prime the phone keyboard on pointer-down while Safari still treats this as a\n    // user gesture. It is harmless for non-editable targets because it only runs\n    // when the host's live cursor is already an I-beam/editable cursor.\n    if(state.cursorEditable||state.cursorShape==='ibeam')openKeyboardForCursor(state.cursorNumeric);\n'''
new_pointer_down = '''  if(settings.pointerMode==='mouse'){\n    // Prime Safari only from the CURRENT desktop's live cursor state. Desktop\n    // transitions reset cursorEditable/keyboard state so Ctrl+Alt+Del cannot leave\n    // the controller stuck permanently in text-entry mode.\n    if(!state.portableBlocked&&(state.cursorEditable||state.cursorShape==='ibeam'))openKeyboardForCursor(state.cursorNumeric);\n'''
if old_pointer_down not in app:
    raise SystemExit('WEB34 pointer down marker missing')
app = app.replace(old_pointer_down, new_pointer_down, 1)

# Reset secure state on every new/disconnected session.
app = app.replace(
    '''  state.remotePermissions={audio:true,microphone:true,full_control:true};\n''',
    '''  state.remotePermissions={audio:true,microphone:true,full_control:true};state.secureDesktop=false;state.portableBlocked=false;clearSecureProbeTimers();\n''',
    1,
)
app = app.replace(
    '''  state.ws=null;state.connected=false;state.currentCode=null;\n''',
    '''  state.ws=null;state.connected=false;state.currentCode=null;state.secureDesktop=false;state.portableBlocked=false;clearSecureProbeTimers();\n''',
    1,
)
app_path.write_text(app, encoding='utf-8')

sw = Path('pwa/sw.js')
s = sw.read_text(encoding='utf-8')
s = s.replace("chv-remote-pwa-v3.3.0", "chv-remote-pwa-v3.4.0")
if "chv-remote-pwa-v3.4.0" not in s:
    raise SystemExit('WEB34 service worker marker missing')
sw.write_text(s, encoding='utf-8')

index = Path('pwa/index.html')
i = index.read_text(encoding='utf-8')
i2 = i.replace('Versão PWA 3.3.0', 'Versão PWA 3.4.0')
if i2 == i:
    # tolerate pages where the visible version text was omitted; cache version is authoritative
    i2 = i
index.write_text(i2, encoding='utf-8')

print('CHV_WEB34_SECURE_DESKTOP_INPUT_RESET_OK')

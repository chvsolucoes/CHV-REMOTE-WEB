from pathlib import Path

root = Path('pwa')
app = root / 'app.js'
css = root / 'app.css'
html = root / 'index.html'
sw = root / 'sw.js'

j = app.read_text(encoding='utf-8')

# Remote permission state and keyboard reframe timers.
old_state = "  remotePath:'',remoteParent:'',remoteEntries:[],remoteSelected:new Set(),receivedReady:[]\n};"
new_state = "  remotePath:'',remoteParent:'',remoteEntries:[],remoteSelected:new Set(),receivedReady:[],\n  remotePermissions:{audio:true,microphone:true,full_control:true},keyboardReframeTimers:[]\n};"
if old_state not in j:
    raise SystemExit('WEB32 state marker missing')
j = j.replace(old_state, new_state, 1)

old_settings = "const settings=Object.assign({\n  quality:'balanced',savePasswords:false,autoAudio:false,autoMic:false,pointerMode:'mouse'\n},store.get('settings',{}));"
new_settings = "const settings=Object.assign({\n  quality:'balanced',savePasswords:false,autoAudio:true,autoMic:true,pointerMode:'mouse'\n},store.get('settings',{}));\n// WEB32 changes the connection default to audio + remote microphone enabled.\n// Migrate existing installs once; afterwards the user's manual choice is preserved.\nif(!store.get('web32AudioDefaultsMigrated',false)){\n  settings.autoAudio=true;settings.autoMic=true;store.set('settings',settings);store.set('web32AudioDefaultsMigrated',true);\n}"
if old_settings not in j:
    raise SystemExit('WEB32 settings marker missing')
j = j.replace(old_settings, new_settings, 1)

# Unlock WebAudio from the connect tap and reset permission state per session.
old_connect = "async function connect(){\n  const code=cleanId($('#remoteId').value),secret=$('#remotePassword').value;"
new_connect = "async function connect(){\n  const code=cleanId($('#remoteId').value),secret=$('#remotePassword').value;\n  state.remotePermissions={audio:true,microphone:true,full_control:true};\n  // connect() originates from a real tap, so resume WebAudio here while iOS still\n  // considers it a user gesture. The host permission still decides what is sent.\n  try{await ensureAudio()}catch{}"
if old_connect not in j:
    raise SystemExit('WEB32 connect marker missing')
j = j.replace(old_connect, new_connect, 1)

old_ready_audio = "      if(settings.autoAudio)setFeature('system_audio',true);\n      if(settings.autoMic)setFeature('microphone',true);"
new_ready_audio = "      $('#actionAudioBtn')?.classList.toggle('active',!!settings.autoAudio);\n      $('#actionMicBtn')?.classList.toggle('active',!!settings.autoMic);\n      if(settings.autoAudio)ensureAudio().then(()=>setFeature('system_audio',true)).catch(()=>{});\n      if(settings.autoMic)ensureAudio().then(()=>setFeature('microphone',true)).catch(()=>{});"
if old_ready_audio not in j:
    raise SystemExit('WEB32 ready audio marker missing')
j = j.replace(old_ready_audio, new_ready_audio, 1)

# Consume host permission_state and make it authoritative.
perm_marker = "    if(o.type==='cursor_state'){applyCursorState(o);return}\n"
perm_block = "    if(o.type==='permission_state'){\n      state.remotePermissions={\n        audio:o.audio!==false,\n        microphone:o.microphone!==false,\n        full_control:o.full_control!==false&&o.elevated!==false\n      };\n      const ab=$('#actionAudioBtn'),mb=$('#actionMicBtn');\n      if(ab){ab.disabled=!state.remotePermissions.audio;ab.classList.toggle('active',state.remotePermissions.audio&&!!settings.autoAudio)}\n      if(mb){mb.disabled=!state.remotePermissions.microphone;mb.classList.toggle('active',state.remotePermissions.microphone&&!!settings.autoMic)}\n      if(state.remotePermissions.audio&&settings.autoAudio)ensureAudio().then(()=>setFeature('system_audio',true)).catch(()=>{});\n      else if(!state.remotePermissions.audio)setFeature('system_audio',false,true);\n      if(state.remotePermissions.microphone&&settings.autoMic)ensureAudio().then(()=>setFeature('microphone',true)).catch(()=>{});\n      else if(!state.remotePermissions.microphone)setFeature('microphone',false,true);\n      return;\n    }\n"
if perm_marker not in j:
    raise SystemExit('WEB32 permission event marker missing')
j = j.replace(perm_marker, perm_marker + perm_block, 1)

# Host-side permissions cannot be bypassed by the Web quick toggles.
old_feature_fn = "function setFeature(feature,enabled){\n  if(!state.canAdmin){toast('Esse recurso foi bloqueado pelo computador remoto');return false}\n  wsSend({type:'feature',feature,enabled});"
new_feature_fn = "function setFeature(feature,enabled,silent=false){\n  if(!state.canAdmin){if(!silent)toast('Esse recurso foi bloqueado pelo computador remoto');return false}\n  if(enabled&&feature==='system_audio'&&!state.remotePermissions.audio){if(!silent)toast('O áudio não foi liberado nas configurações do computador remoto');return false}\n  if(enabled&&feature==='microphone'&&!state.remotePermissions.microphone){if(!silent)toast('O microfone não foi liberado nas configurações do computador remoto');return false}\n  wsSend({type:'feature',feature,enabled});"
if old_feature_fn not in j:
    raise SystemExit('WEB32 setFeature marker missing')
j = j.replace(old_feature_fn, new_feature_fn, 1)

# Better keyboard viewport detection; viewport animation is handled by repeated reframing.
old_sync = "    session.style.setProperty('--keyboard-vh',Math.max(260,vv.height)+'px');\n    session.style.setProperty('--keyboard-top',Math.max(0,vv.offsetTop)+'px');\n  }else{\n    session.style.removeProperty('--keyboard-vh');session.style.removeProperty('--keyboard-top');"
new_sync = "    session.style.setProperty('--keyboard-vh',Math.max(260,vv.height)+'px');\n    session.style.setProperty('--keyboard-offset',Math.max(0,vv.offsetTop)+'px');\n  }else{\n    session.style.removeProperty('--keyboard-vh');session.style.removeProperty('--keyboard-offset');"
if old_sync not in j:
    raise SystemExit('WEB32 keyboard viewport marker missing')
j = j.replace(old_sync, new_sync, 1)

# Replace the old remote field centering with local screen coordinates. This remains
# stable while visualViewport animates and lets pan keep the actual clicked field visible.
start = j.index('function focusRemoteFieldView(){')
end = j.index('function openKeyboardForCursor', start)
new_focus = r'''function clearKeyboardReframeTimers(){for(const t of state.keyboardReframeTimers)clearTimeout(t);state.keyboardReframeTimers=[]}
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
'''
j = j[:start] + new_focus + j[end:]

old_open_call = "  focusRemoteFieldView();\n  state.focusProbeTimer=setTimeout(()=>{"
new_open_call = "  focusRemoteFieldView();scheduleKeyboardReframe();\n  state.focusProbeTimer=setTimeout(()=>{"
if old_open_call not in j:
    raise SystemExit('WEB32 open keyboard reframe marker missing')
j = j.replace(old_open_call, new_open_call, 1)

old_resolve_call = "  focusRemoteFieldView();\n  input.setAttribute('inputmode',numeric?'numeric':'text');input.value='';"
new_resolve_call = "  focusRemoteFieldView();scheduleKeyboardReframe();\n  input.setAttribute('inputmode',numeric?'numeric':'text');input.value='';"
if old_resolve_call not in j:
    raise SystemExit('WEB32 resolve focus marker missing')
j = j.replace(old_resolve_call, new_resolve_call, 1)

# File upload returns to the remote screen and shows one simple confirmation.
old_send_done = "  closeAllSheets();closeEdgeMenu();\n  $('#sentFileName').textContent=names.length===1?names[0]:names.length+' arquivos';\n  $('#sentFileSheet').classList.remove('hidden');\n  toast('Arquivo enviado para Downloads / CHV Remote');"
new_send_done = "  closeAllSheets();closeEdgeMenu();showView('sessionView');\n  $('#sentFileName').textContent=names.length===1?names[0]:names.length+' arquivos';\n  $('#sentFileSheet').classList.remove('hidden');\n  toast('Arquivo enviado para Downloads / CHV Remote');"
if old_send_done not in j:
    raise SystemExit('WEB32 file send flow marker missing')
j = j.replace(old_send_done, new_send_done, 1)

old_close_sent = "$('#closeSentFileBtn').onclick=()=>{$('#sentFileSheet').classList.add('hidden');toast('Arquivo enviado para o computador remoto')};\n$('#openSentFolderBtn').onclick=()=>{wsSend({type:'reveal_received_folder_request'});$('#sentFileSheet').classList.add('hidden');toast('Abrindo Downloads / CHV Remote no PC…')};"
new_close_sent = "$('#closeSentFileBtn').onclick=()=>{closeAllSheets();showView('sessionView');$('#screenWrap')?.focus?.();toast('Arquivo enviado para Downloads / CHV Remote')};"
if old_close_sent not in j:
    raise SystemExit('WEB32 sent confirmation marker missing')
j = j.replace(old_close_sent, new_close_sent, 1)

# Keep settings and quick buttons synchronized when changed during a live session.
old_settings_change = "['quality','autoAudio','autoMic'].forEach(id=>$('#'+id).onchange=e=>{\n  settings[id]=e.target.type==='checkbox'?e.target.checked:e.target.value;store.set('settings',settings);\n  if(id==='quality'){$('#sessionQuality').value=settings.quality;requestSharpFrame()}\n});"
new_settings_change = "['quality','autoAudio','autoMic'].forEach(id=>$('#'+id).onchange=e=>{\n  settings[id]=e.target.type==='checkbox'?e.target.checked:e.target.value;store.set('settings',settings);\n  if(id==='quality'){$('#sessionQuality').value=settings.quality;requestSharpFrame()}\n  if(state.connected&&id==='autoAudio'){const on=!!settings.autoAudio&&state.remotePermissions.audio;$('#actionAudioBtn')?.classList.toggle('active',on);if(on)ensureAudio().then(()=>setFeature('system_audio',true));else setFeature('system_audio',false,true)}\n  if(state.connected&&id==='autoMic'){const on=!!settings.autoMic&&state.remotePermissions.microphone;$('#actionMicBtn')?.classList.toggle('active',on);if(on)ensureAudio().then(()=>setFeature('microphone',true));else setFeature('microphone',false,true)}\n});"
if old_settings_change not in j:
    raise SystemExit('WEB32 setting live sync marker missing')
j = j.replace(old_settings_change, new_settings_change, 1)

# During visual viewport animation, run the robust repeated field reframe.
old_vv = "      syncKeyboardViewport();\n      if(state.connected&&document.activeElement===$('#nativeKeyboardInput')&&(state.cursorEditable||state.cursorShape==='ibeam'))requestAnimationFrame(focusRemoteFieldView);"
new_vv = "      syncKeyboardViewport();\n      if(state.connected&&document.activeElement===$('#nativeKeyboardInput')&&(state.cursorEditable||state.cursorShape==='ibeam'))scheduleKeyboardReframe();"
if old_vv not in j:
    raise SystemExit('WEB32 visual viewport marker missing')
j = j.replace(old_vv, new_vv, 1)

app.write_text(j, encoding='utf-8')

c = css.read_text(encoding='utf-8')
old_css = ".session-view.keyboard-visible{inset:var(--keyboard-top,0px) 0 auto;height:var(--keyboard-vh,100dvh)!important;min-height:var(--keyboard-vh,100dvh)!important}\n.session-view.keyboard-visible .screen-wrap{height:calc(var(--keyboard-vh,100dvh) - 58px)!important}"
new_css = ".session-view.keyboard-visible{top:var(--keyboard-offset,0px)!important;bottom:auto!important;height:var(--keyboard-vh,100dvh)!important;min-height:var(--keyboard-vh,100dvh)!important;overflow:hidden!important}\n.session-view.keyboard-visible .screen-wrap{height:calc(var(--keyboard-vh,100dvh) - 58px)!important;max-height:calc(var(--keyboard-vh,100dvh) - 58px)!important}"
if old_css not in c:
    raise SystemExit('WEB32 keyboard CSS marker missing')
c = c.replace(old_css, new_css, 1)
c += "\n/* CHV Remote Web 3.2 */\n.edge-bubble:disabled{opacity:.35;filter:grayscale(1)}\n.sent-file-actions.one-action{display:block}.sent-file-actions.one-action .primary{width:100%}\n"
css.write_text(c, encoding='utf-8')

h = html.read_text(encoding='utf-8')
h = h.replace('Versão PWA 3.0.0', 'Versão PWA 3.2.0', 1)
h = h.replace('<strong>Áudio do sistema</strong><small>Ativar automaticamente ao conectar</small>', '<strong>Áudio do sistema</strong><small>Ativo automaticamente quando o computador remoto permitir</small>', 1)
h = h.replace('<strong>Microfone remoto</strong><small>Ouvir o microfone do computador remoto</small>', '<strong>Microfone remoto</strong><small>Ativo automaticamente quando o computador remoto permitir</small>', 1)
old_sent = '''        <p>Transferência concluída. O arquivo foi enviado para <b>Downloads / CHV Remote</b> no computador remoto.</p>\n        <div class="sent-file-actions"><button id="closeSentFileBtn" class="secondary">OK</button><button id="openSentFolderBtn" class="primary">Abrir pasta no PC</button></div>'''
new_sent = '''        <p>Arquivo enviado com sucesso para a pasta <b>Downloads / CHV Remote</b> do computador remoto.</p>\n        <div class="sent-file-actions one-action"><button id="closeSentFileBtn" class="primary">OK</button></div>'''
if old_sent not in h:
    raise SystemExit('WEB32 sent sheet HTML marker missing')
h = h.replace(old_sent, new_sent, 1)
html.write_text(h, encoding='utf-8')

s = sw.read_text(encoding='utf-8')
if "chv-remote-pwa-v3.0.0" not in s:
    raise SystemExit('WEB32 service worker cache marker missing')
s = s.replace("chv-remote-pwa-v3.0.0", "chv-remote-pwa-v3.2.0", 1)
sw.write_text(s, encoding='utf-8')

print('CHV_WEB32_APPLY_OK')

from pathlib import Path

p = Path('pwa/app.js')
s = p.read_text(encoding='utf-8')

replacements = [
("""function noteInteraction(){
  if(!state.connected)return;
  clearTimeout(state.interactionBurstTimer);
  if(!state.interactionBurst){
    state.interactionBurst=true;
    // Durante mouse/arraste, privilegia latência em vez de mandar JPEG grande demais.
    wsSend({type:'screen_profile',width:1280,height:720,fit:false,reason:'interactive'});
    wsSend({type:'stream_tuning',width:1280,height:720,fps:35,jpeg_quality:62,subsampling:2,reason:'interactive'});
  }
  state.interactionBurstTimer=setTimeout(()=>{state.interactionBurst=false;sendAdaptiveStreamProfile('settled')},320);
}
""",
"""function noteInteraction(){
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
"""),
("""function openKeyboardForCursor(numeric=false){
  if(!state.connected)return false;
  const likely=state.cursorEditable||state.cursorShape==='ibeam';
  if(!likely)return false;
  clearTimeout(state.focusProbeTimer);state.keyboardProbeArmed=false;
  focusRemoteFieldView();
  const input=$('#nativeKeyboardInput');
  input.value='';input.setAttribute('inputmode',numeric?'numeric':'text');
  try{input.focus({preventScroll:true});input.setSelectionRange(0,0)}catch{}
  return true;
}
""",
"""function openKeyboardForCursor(numeric=false){
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
}
"""),
("""function sendCtrlAltDel(){
  if(!state.connected)return;
  sendKey('ctrl',true);sendKey('alt',true);sendKey('delete',true);
  setTimeout(()=>{sendKey('delete',false);sendKey('alt',false);sendKey('ctrl',false)},120);
  toast('Ctrl + Alt + Del enviado');
}
""",
"""function sendCtrlAltDel(){
  if(!state.connected)return;
  wsSend({type:'secure_attention_request',sequence:'ctrl_alt_del'});
  postInputRefresh('secure_attention');
  toast('Solicitando Ctrl + Alt + Del ao computador remoto…');
}
"""),
("""function applyCursorState(o){
  const shape=String(o?.shape||'arrow').toLowerCase();
  state.cursorShape=shape;state.cursorEditable=!!(o?.editable||shape==='ibeam');state.cursorNumeric=!!o?.numeric;
  const c=$('#mouseCursor');c.dataset.shape=shape;c.innerHTML=cursorMarkup(shape);updateCursorVisual();
}
""",
"""function normalizeCursorShape(value){
  const raw=String(value||'arrow').toLowerCase().replace(/[\\s-]+/g,'_');
  const aliases={default:'arrow',normal:'arrow',pointer:'hand',link:'hand',hand2:'hand',text:'ibeam',i_beam:'ibeam',beam:'ibeam',busy:'wait',loading:'wait',progress:'appstarting',working:'appstarting',crosshair:'cross',sizewe:'size_we',ew_resize:'size_we',sizens:'size_ns',ns_resize:'size_ns',sizeall:'size_all',move:'size_all'};
  return aliases[raw]||raw;
}
function applyCursorState(o){
  const shape=normalizeCursorShape(o?.shape||'arrow');
  state.cursorShape=shape;state.cursorEditable=!!(o?.editable||shape==='ibeam');state.cursorNumeric=!!o?.numeric;
  const c=$('#mouseCursor');c.dataset.shape=shape;c.innerHTML=cursorMarkup(shape);updateCursorVisual();
}
"""),
("""    else if(!state.moved){clickAt(point,'left');probeTextFocus(point,false)}
""",
"""    else if(!state.moved){const keyboardOpened=openKeyboardForCursor(false);clickAt(point,'left');probeTextFocus(point,keyboardOpened)}
"""),
("""function requestRemotePath(path=''){state.remoteSelected.clear();wsSend({type:'file_list_request',path:String(path||'')});$('#remoteFileList').innerHTML='<div class=\"file-loading\">Carregando…</div>'}
""",
"""function requestRemotePath(path=''){state.remoteSelected.clear();wsSend({type:'file_list_request',path:String(path||''),scope:path?'explicit':'default'});$('#remoteFileList').innerHTML='<div class=\"file-loading\">Carregando…</div>'}
"""),
]

for old, new in replacements:
    if old not in s:
        if new not in s:
            raise SystemExit('patch marker missing: '+old.splitlines()[0])
    else:
        s = s.replace(old, new, 1)

s = s.replace("if(!force&&now-state.cursorProbeAt<90)return;", "if(!force&&now-state.cursorProbeAt<45)return;", 1)

marker = "    if(o.type==='cursor_state'){applyCursorState(o);return}\n"
addition = marker + "    if(o.type==='secure_attention_result'){toast(o.ok?'Ctrl + Alt + Del executado':'Não foi possível executar Ctrl + Alt + Del neste computador');postInputRefresh('secure_attention_result');return}\n"
if 'secure_attention_result' not in s:
    if marker not in s:
        raise SystemExit('cursor result marker missing')
    s = s.replace(marker, addition, 1)

p.write_text(s, encoding='utf-8')

sw = Path('pwa/sw.js')
t = sw.read_text(encoding='utf-8').replace("const CACHE='chv-remote-pwa-v2.7.0';", "const CACHE='chv-remote-pwa-v2.8.0';")
sw.write_text(t, encoding='utf-8')

required = ['secure_attention_request','secure_attention_result','normalizeCursorShape','fps:45',"scope:path?'explicit':'default'",'cursorProbeAt<45']
missing = [x for x in required if x not in s]
if missing:
    raise SystemExit('WEB28 markers missing: '+repr(missing))
print('CHV_WEB28_PATCH_OK')

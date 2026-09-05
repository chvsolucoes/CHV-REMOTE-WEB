from pathlib import Path

p=Path('pwa/app.js'); s=p.read_text()

def one(old,new,label):
    global s
    if old not in s: raise SystemExit('missing '+label)
    s=s.replace(old,new,1)

def between(start,end,new,label):
    global s
    a=s.find(start)
    if a<0: raise SystemExit('missing start '+label)
    b=s.find(end,a)
    if b<0: raise SystemExit('missing end '+label)
    s=s[:a]+new+s[b:]

one(
"  interactionBurstTimer:null,interactionBurst:false,postInputTimers:[]\n};",
"  interactionBurstTimer:null,interactionBurst:false,postInputTimers:[],\n  cursorShape:'arrow',cursorEditable:false,cursorNumeric:false,cursorProbeAt:0,\n  remotePath:'',remoteParent:'',remoteEntries:[],remoteSelected:new Set(),receivedReady:[]\n};",
'state 27')

old="""    if(['text_focus','editable_focus','input_focus'].includes(o.type)){\n      const editable=o.editable!==false&&o.focused!==false;\n      resolveTextFocus(editable,!!o.numeric);\n      return;\n    }\n    if(o.type==='file_offer'){acceptFile(o);return}\n"""
new="""    if(['text_focus','editable_focus','input_focus'].includes(o.type)){\n      const editable=o.editable!==false&&o.focused!==false;\n      applyCursorState({shape:o.shape||(editable?'ibeam':state.cursorShape),editable,numeric:!!o.numeric});\n      resolveTextFocus(editable,!!o.numeric);\n      return;\n    }\n    if(o.type==='cursor_state'){applyCursorState(o);return}\n    if(o.type==='file_list'){renderRemoteFileList(o);return}\n    if(o.type==='file_list_error'){toast('Não foi possível abrir essa pasta no computador');return}\n    if(o.type==='file_offer'){acceptFile(o);return}\n"""
one(old,new,'message semantics')

between('function armKeyboardProbe(){','\nfunction sendKey(key,down){',r'''function armKeyboardProbe(){
  const input=$('#nativeKeyboardInput');
  clearTimeout(state.focusProbeTimer);state.keyboardProbeArmed=true;
  input.setAttribute('inputmode','none');input.value='';
  try{input.focus({preventScroll:true})}catch{}
  state.focusProbeTimer=setTimeout(()=>{
    if(!state.keyboardProbeArmed)return;
    state.keyboardProbeArmed=false;try{input.blur()}catch{}
  },950);
}
function focusRemoteFieldView(){
  if(!state.connected)return;
  if(state.zoom<1.45)state.zoom=1.45;
  const f=fitImageBase(),sw=f.width*state.zoom,sh=f.height*state.zoom;
  const desiredY=Math.max(64,Math.min(f.wrapH*.26,210));
  const currentY=f.wrapH/2+state.panY+(state.cursor.y-.5)*sh;
  state.panY+=desiredY-currentY;
  const desiredX=f.wrapW*.5,currentX=f.wrapW/2+state.panX+(state.cursor.x-.5)*sw;
  if(currentX<f.wrapW*.15||currentX>f.wrapW*.85)state.panX+=desiredX-currentX;
  clampPan();applyTransform();requestSharpFrame();
}
function openKeyboardForCursor(numeric=false){
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
function probeTextFocus(p,alreadyOpened=false){
  if(!state.connected)return;
  state.lastFocusProbeAt=Date.now();if(!alreadyOpened)armKeyboardProbe();
  wsSend({type:'text_focus_probe',x:p.x,y:p.y});
}
function resolveTextFocus(editable,numeric=false){
  clearTimeout(state.focusProbeTimer);
  const input=$('#nativeKeyboardInput');
  if(!editable){state.keyboardProbeArmed=false;if(state.cursorShape==='ibeam')applyCursorState({shape:'arrow',editable:false});try{input.blur()}catch{};return}
  state.keyboardProbeArmed=false;state.cursorEditable=true;state.cursorNumeric=!!numeric;applyCursorState({shape:'ibeam',editable:true,numeric:!!numeric});
  focusRemoteFieldView();
  input.setAttribute('inputmode',numeric?'numeric':'text');input.value='';
  try{input.blur();input.focus({preventScroll:true});input.setSelectionRange(0,0)}catch{}
}
''','keyboard focus')

between('function updateCursorVisual(){','\nfunction clearLongPress(){',r'''function cursorMarkup(shape){
  if(shape==='ibeam')return '<svg viewBox="0 0 32 42"><path d="M10 3h12M16 3v36M10 39h12" fill="none" stroke="white" stroke-width="3"/><path d="M9 2h14M16 2v38M9 40h14" fill="none" stroke="#111" stroke-width="6" opacity=".82"/></svg>';
  if(shape==='hand')return '<svg viewBox="0 0 42 48"><path d="M12 22V8c0-5 7-5 7 0v10-7c0-5 7-5 7 0v8-5c0-5 7-5 7 0v8-3c0-5 7-5 7 0v11c0 9-6 15-15 15h-5c-6 0-9-3-12-8L3 29c-2-4 4-8 7-4z" fill="white" stroke="#111" stroke-width="2.4" stroke-linejoin="round"/></svg>';
  if(shape==='wait'||shape==='appstarting')return '<svg viewBox="0 0 36 44"><path d="M9 3h18v5c0 5-3 9-7 12 4 3 7 7 7 12v8H9v-8c0-5 3-9 7-12-4-3-7-7-7-12z" fill="white" stroke="#111" stroke-width="2.5"/><path d="M12 8h12c0 4-3 7-6 9-3-2-6-5-6-9zm1 27h10c-1-4-3-7-5-9-2 2-4 5-5 9z" fill="#5aa9ff"/></svg>';
  if(shape==='cross')return '<svg viewBox="0 0 36 36"><path d="M18 2v32M2 18h32" stroke="white" stroke-width="2.5"/><path d="M18 2v32M2 18h32" stroke="#111" stroke-width="5" opacity=".75"/></svg>';
  if(shape==='size_we')return '<svg viewBox="0 0 44 32"><path d="M3 16h38M3 16l8-7M3 16l8 7M41 16l-8-7M41 16l-8 7" fill="none" stroke="white" stroke-width="3"/><path d="M3 16h38" stroke="#111" stroke-width="6" opacity=".75"/></svg>';
  if(shape==='size_ns')return '<svg viewBox="0 0 32 44"><path d="M16 3v38M16 3l-7 8M16 3l7 8M16 41l-7-8M16 41l7-8" fill="none" stroke="white" stroke-width="3"/><path d="M16 3v38" stroke="#111" stroke-width="6" opacity=".75"/></svg>';
  if(shape==='size_all')return '<svg viewBox="0 0 44 44"><path d="M22 3v38M3 22h38M22 3l-6 7M22 3l6 7M22 41l-6-7M22 41l6-7M3 22l7-6M3 22l7 6M41 22l-7-6M41 22l-7 6" fill="none" stroke="white" stroke-width="2.6"/></svg>';
  return '<svg viewBox="0 0 32 42"><path d="M3 2 L3 32 L11 24 L17 39 L23 36 L17 22 L29 22 Z" fill="white" stroke="#111" stroke-width="2.2" stroke-linejoin="round"/></svg>';
}
function applyCursorState(o){
  const shape=String(o?.shape||'arrow').toLowerCase();
  state.cursorShape=shape;state.cursorEditable=!!(o?.editable||shape==='ibeam');state.cursorNumeric=!!o?.numeric;
  const c=$('#mouseCursor');c.dataset.shape=shape;c.innerHTML=cursorMarkup(shape);updateCursorVisual();
}
function probeCursorState(force=false){
  if(!state.connected||settings.pointerMode!=='mouse')return;
  const now=performance.now();if(!force&&now-state.cursorProbeAt<90)return;state.cursorProbeAt=now;
  wsSend({type:'cursor_probe',x:state.cursor.x,y:state.cursor.y});
}
function updateCursorVisual(){
  if(settings.pointerMode!=='mouse')return;
  const b=imageBox(),c=$('#mouseCursor'),wr=$('#screenWrap').getBoundingClientRect();
  c.style.left=(b.left-wr.left+state.cursor.x*b.width)+'px';
  c.style.top=(b.top-wr.top+state.cursor.y*b.height)+'px';
}
''','cursor semantics')

one("    sendMouse('move',state.cursor,state.dragging?{button:'left',buttons:1}:{});\n    if(state.zoom>1)followCursorPan();else updateCursorVisual();",
    "    sendMouse('move',state.cursor,state.dragging?{button:'left',buttons:1}:{});probeCursorState();\n    if(state.zoom>1)followCursorPan();else updateCursorVisual();",'cursor probe move')
one("      clickAt(state.cursor,'left');probeTextFocus(state.cursor);\n      state.lastTapAt=performance.now();state.lastTapPos={x:e.clientX,y:e.clientY};",
    "      const keyboardOpened=openKeyboardForCursor(state.cursorNumeric);clickAt(state.cursor,'left');probeTextFocus(state.cursor,keyboardOpened);\n      state.lastTapAt=performance.now();state.lastTapPos={x:e.clientX,y:e.clientY};",'mouse keyboard')
one("    else if(!state.moved){clickAt(point,'left');probeTextFocus(point)}",
    "    else if(!state.moved){clickAt(point,'left');probeTextFocus(point,false)}",'touch focus')

insert=r'''function formatBytes(n){
  n=Number(n||0);if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';if(n<1073741824)return (n/1048576).toFixed(1)+' MB';return (n/1073741824).toFixed(1)+' GB';
}
function openRemoteFiles(){
  if(!state.connected)return toast('Conecte primeiro ao computador.');
  if(!state.canAdmin)return toast('Gerenciador de arquivos bloqueado pelo computador remoto');
  state.remoteSelected.clear();openSheet('fileBrowserSheet');requestRemotePath('');
}
function requestRemotePath(path=''){state.remoteSelected.clear();wsSend({type:'file_list_request',path:String(path||'')});$('#remoteFileList').innerHTML='<div class="file-loading">Carregando…</div>'}
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
'''
one('function acceptFile(o){',insert+'\nfunction acceptFile(o){','remote files functions')

between('function fileChunk(u){','\nasync function sendFiles(files){',r'''function fileChunk(u){
  if(u.length<5)return;const ml=be32(u,1);if(!ml||u.length<5+ml)return;
  let meta;try{meta=JSON.parse(new TextDecoder().decode(u.slice(5,5+ml)))}catch{return}
  const t=state.incoming.get(meta.id);if(!t)return;
  if(meta.final){
    const blob=new Blob(t.chunks,{type:'application/octet-stream'});
    state.incoming.delete(meta.id);state.receivedReady.push({name:t.name,blob});
    showReceivedFiles();toast('Arquivo recebido: '+t.name);
  }else t.chunks.push(u.slice(5+ml));
}
''','receive completion')

one("$('#menuFilesBtn').onclick=()=>{$('#fileInput').click();closeEdgeMenu()};","$('#menuFilesBtn').onclick=openRemoteFiles;",'files menu')
one("$('#fileInput').onchange=e=>{sendFiles([...e.target.files]);e.target.value=''};",
"$('#fileInput').onchange=e=>{sendFiles([...e.target.files]);e.target.value=''};\n$('#sendFromPhoneBtn').onclick=()=>$('#fileInput').click();\n$('#receiveSelectedBtn').onclick=receiveSelectedFiles;\n$('#remoteUpBtn').onclick=()=>requestRemotePath(state.remoteParent||'');\n$('#refreshRemoteFilesBtn').onclick=()=>requestRemotePath(state.remotePath||'');\n$('#saveReceivedBtn').onclick=saveReceivedFiles;\n$('#clearReceivedBtn').onclick=()=>{state.receivedReady=[];$('#receivedFileSheet').classList.add('hidden')};",
'file UI hooks')
one("      applyPointerMode(settings.pointerMode);renderLists();renderCurrentPcStatus();",
    "      applyPointerMode(settings.pointerMode);applyCursorState({shape:'arrow',editable:false});setTimeout(()=>probeCursorState(true),120);renderLists();renderCurrentPcStatus();",'cursor connect')

p.write_text(s)

ip=Path('pwa/index.html'); h=ip.read_text();
if 'Versão PWA 2.6.0' not in h: raise SystemExit('wrong index version')
h=h.replace('Versão PWA 2.6.0','Versão PWA 2.7.0',1)
marker='    <div id="toast" class="toast hidden"></div>'
if marker not in h: raise SystemExit('toast marker')
file_html=r'''    <div id="fileBrowserSheet" class="sheet hidden">
      <div class="sheet-card file-browser-card">
        <div class="sheet-head"><div><strong>Gerenciador de arquivos</strong><small>Computador remoto</small></div><button data-close-sheet="fileBrowserSheet">Fechar</button></div>
        <div class="file-browser-toolbar"><button id="remoteUpBtn" class="secondary">↑ Voltar</button><div id="remotePath" class="remote-path">Este PC</div><button id="refreshRemoteFilesBtn" class="secondary">↻</button></div>
        <div id="remoteFileList" class="remote-file-list"><div class="file-loading">Carregando…</div></div>
        <div class="file-browser-actions"><button id="sendFromPhoneBtn" class="sheet-action">↥ Enviar do celular</button><button id="receiveSelectedBtn" class="sheet-action" disabled>↧ Receber selecionado</button></div>
      </div>
    </div>

    <div id="receivedFileSheet" class="sheet hidden">
      <div class="sheet-card received-file-card">
        <div class="sheet-head"><div><strong>Arquivo recebido</strong><small id="receivedFileName">CHV Remote</small></div><button id="clearReceivedBtn">Fechar</button></div>
        <p>No iPhone/iPad, toque em <b>Salvar em Arquivos</b> e escolha ou crie a pasta <b>CHV Remote</b>. Por segurança, o iOS não permite que um site crie ou abra uma pasta do app Arquivos sem sua confirmação.</p>
        <button id="saveReceivedBtn" class="primary">Salvar em Arquivos</button>
      </div>
    </div>

'''
h=h.replace(marker,file_html+marker,1);ip.write_text(h)

cp=Path('pwa/app.css'); c=cp.read_text();
css=r'''
/* CHV Remote Web 2.7 - Windows cursor semantics, remote files and keyboard focus */
.remote-cursor[data-shape="ibeam"]{width:24px;height:42px;transform:translate(-12px,-21px)}
.remote-cursor[data-shape="hand"]{width:34px;height:44px;transform:translate(-8px,-5px)}
.remote-cursor[data-shape="wait"],.remote-cursor[data-shape="appstarting"]{width:34px;height:42px;transform:translate(-17px,-21px)}
.remote-cursor[data-shape^="size_"]{width:38px;height:38px;transform:translate(-19px,-19px)}
.remote-cursor[data-shape="cross"]{width:34px;height:34px;transform:translate(-17px,-17px)}
.file-browser-card{max-height:92dvh;display:flex;flex-direction:column;overflow:hidden}
.file-browser-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:10px}.remote-path{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#e9eef3;border-radius:10px;padding:10px;font-size:11px;color:#405365}
.remote-file-list{min-height:230px;max-height:58dvh;overflow:auto;border:1px solid #dce4eb;border-radius:14px;background:#fff;-webkit-overflow-scrolling:touch}.file-loading{padding:28px;text-align:center;color:#6d7b8a}
.remote-file-row{display:flex;align-items:center;border-bottom:1px solid #edf1f4;min-height:54px;padding:3px 8px}.remote-file-row:last-child{border-bottom:0}.remote-file-check{width:22px;height:22px;margin:0 8px 0 3px}.remote-file-open{flex:1;min-width:0;border:0;background:transparent;display:grid;grid-template-columns:34px 1fr;grid-template-rows:auto auto;text-align:left;align-items:center;padding:7px 4px;color:#0b1f33}.remote-file-icon{grid-row:1/3;font-size:24px}.remote-file-name{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.remote-file-open small{color:#6d7b8a;font-size:10px}.file-browser-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.file-browser-actions .sheet-action{margin:0}.file-browser-actions button:disabled{opacity:.38}
.received-file-card p{font-size:13px;line-height:1.45;color:#596b7b}.received-file-card .primary{margin-top:4px}
@media(max-width:430px){.file-browser-actions{grid-template-columns:1fr}.remote-file-list{max-height:52dvh}}
'''
if 'CHV Remote Web 2.7' not in c:c+=css
cp.write_text(c)

sp=Path('pwa/sw.js'); sw=sp.read_text();
if 'chv-remote-pwa-v2.6.0' not in sw: raise SystemExit('wrong sw version')
sp.write_text(sw.replace('chv-remote-pwa-v2.6.0','chv-remote-pwa-v2.7.0',1))

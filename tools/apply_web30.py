from pathlib import Path

app = Path('pwa/app.js')
html = Path('pwa/index.html')
css = Path('pwa/app.css')
sw = Path('pwa/sw.js')

s = app.read_text(encoding='utf-8')

old_focus = """function focusRemoteFieldView(){
  if(!state.connected)return;
  if(state.zoom<1.45)state.zoom=1.45;
  const f=fitImageBase(),sw=f.width*state.zoom,sh=f.height*state.zoom;
  const desiredY=Math.max(64,Math.min(f.wrapH*.26,210));
  const currentY=f.wrapH/2+state.panY+(state.cursor.y-.5)*sh;
  state.panY+=desiredY-currentY;
  const desiredX=f.wrapW*.5,currentX=f.wrapW/2+state.panX+(state.cursor.x-.5)*sw;
  if(currentX<f.wrapW*.15||currentX>f.wrapW*.85)state.panX+=desiredX-currentX;
  clampPan();applyTransform();requestSharpFrame();
}"""
new_focus = """function syncKeyboardViewport(){
  const session=$('#sessionView'),vv=window.visualViewport;
  if(!session||!vv)return false;
  const covered=Math.max(0,window.innerHeight-(vv.height+vv.offsetTop));
  const open=covered>110||vv.height<window.innerHeight*.78;
  session.classList.toggle('keyboard-visible',open);
  if(open){
    session.style.setProperty('--keyboard-vh',Math.max(260,vv.height)+'px');
    session.style.setProperty('--keyboard-top',Math.max(0,vv.offsetTop)+'px');
  }else{
    session.style.removeProperty('--keyboard-vh');session.style.removeProperty('--keyboard-top');
  }
  return open;
}
function focusRemoteFieldView(){
  if(!state.connected)return;
  syncKeyboardViewport();
  if(state.zoom<1.55)state.zoom=1.55;
  const f=fitImageBase(),scaledW=f.width*state.zoom,scaledH=f.height*state.zoom;
  const wr=$('#screenWrap').getBoundingClientRect(),vv=window.visualViewport;
  const visibleTop=vv?Math.max(wr.top,vv.offsetTop):wr.top;
  const visibleBottom=vv?Math.min(wr.bottom,vv.offsetTop+vv.height):wr.bottom;
  const visibleH=Math.max(120,visibleBottom-visibleTop);
  // Keep the remote insertion point around the upper-middle of the area that is
  // actually visible above the phone keyboard, not the hidden 100dvh layout.
  const desiredClientY=visibleTop+Math.max(54,Math.min(visibleH*.38,220));
  const currentClientY=wr.top+wr.height/2+state.panY+(state.cursor.y-.5)*scaledH;
  state.panY+=desiredClientY-currentClientY;
  const desiredClientX=wr.left+wr.width*.5;
  const currentClientX=wr.left+wr.width/2+state.panX+(state.cursor.x-.5)*scaledW;
  if(currentClientX<wr.left+wr.width*.14||currentClientX>wr.right-wr.width*.14)state.panX+=desiredClientX-currentClientX;
  clampPan();applyTransform();requestSharpFrame();
}"""
if old_focus not in s: raise SystemExit('WEB30 focus marker missing')
s=s.replace(old_focus,new_focus,1)

old_send = """async function sendFiles(files){
  if(!state.canAdmin)return toast('Envio de arquivos bloqueado pelo computador remoto');
  for(const file of files){
    const id=Date.now()+'-'+Math.random().toString(16).slice(2,10)+'-'+file.name;
    wsSend({type:'file_offer',id,name:file.name,size:file.size,clipboard:false,batch_id:crypto.randomUUID?.()||String(Date.now()),batch_final:true});
    const ab=new Uint8Array(await file.arrayBuffer());let index=0;
    for(let o=0;o<ab.length;o+=262144)sendFilePacket(id,index++,false,ab.slice(o,o+262144));
    sendFilePacket(id,index,true,new Uint8Array());toast('Arquivo enviado: '+file.name);
  }
}"""
new_send = """async function sendFiles(files){
  if(!state.canAdmin)return toast('Envio de arquivos bloqueado pelo computador remoto');
  files=[...files].filter(Boolean);if(!files.length)return;
  const names=[];
  for(let pos=0;pos<files.length;pos++){
    const file=files[pos],id=Date.now()+'-'+Math.random().toString(16).slice(2,10)+'-'+file.name;
    names.push(file.name);
    wsSend({type:'file_offer',id,name:file.name,size:file.size,clipboard:false,batch_id:crypto.randomUUID?.()||String(Date.now()),batch_final:pos===files.length-1});
    const ab=new Uint8Array(await file.arrayBuffer());let index=0;
    for(let o=0;o<ab.length;o+=262144)sendFilePacket(id,index++,false,ab.slice(o,o+262144));
    sendFilePacket(id,index,true,new Uint8Array());
  }
  // The file picker/browser must never strand the user away from the remote
  // desktop. Close it immediately and show one focused completion prompt.
  closeAllSheets();closeEdgeMenu();
  $('#sentFileName').textContent=names.length===1?names[0]:names.length+' arquivos';
  $('#sentFileSheet').classList.remove('hidden');
  toast('Arquivo enviado para Downloads / CHV Remote');
}"""
if old_send not in s: raise SystemExit('WEB30 sendFiles marker missing')
s=s.replace(old_send,new_send,1)

old_ui = """$('#fileInput').onchange=e=>{sendFiles([...e.target.files]);e.target.value=''};
$('#sendFromPhoneBtn').onclick=()=>$('#fileInput').click();
$('#receiveSelectedBtn').onclick=receiveSelectedFiles;"""
new_ui = """$('#fileInput').onchange=e=>{sendFiles([...e.target.files]);e.target.value=''};
$('#sendFromPhoneBtn').onclick=()=>$('#fileInput').click();
$('#closeSentFileBtn').onclick=()=>{$('#sentFileSheet').classList.add('hidden');toast('Arquivo enviado para o computador remoto')};
$('#openSentFolderBtn').onclick=()=>{wsSend({type:'reveal_received_folder_request'});$('#sentFileSheet').classList.add('hidden');toast('Abrindo Downloads / CHV Remote no PC…')};
$('#receiveSelectedBtn').onclick=receiveSelectedFiles;"""
if old_ui not in s: raise SystemExit('WEB30 file UI marker missing')
s=s.replace(old_ui,new_ui,1)

old_result = """    if(o.type==='secure_attention_result'){toast(o.ok?'Ctrl + Alt + Del executado':'Não foi possível executar Ctrl + Alt + Del neste computador');postInputRefresh('secure_attention_result');return}
    if(o.type==='file_list'){renderRemoteFileList(o);return}"""
new_result = """    if(o.type==='secure_attention_result'){toast(o.ok?'Ctrl + Alt + Del executado':'Não foi possível executar Ctrl + Alt + Del neste computador');postInputRefresh('secure_attention_result');return}
    if(o.type==='reveal_received_folder_result'){toast(o.ok?'Pasta CHV Remote aberta no computador':'Não foi possível abrir a pasta no computador');return}
    if(o.type==='file_list'){renderRemoteFileList(o);return}"""
if old_result not in s: raise SystemExit('WEB30 result marker missing')
s=s.replace(old_result,new_result,1)

# Replace the old viewport listener with a layout-aware resize/scroll handler.
old_vv = """// CHV Remote Web 2.9: keep the remote edit field visible when the iOS/Android
// software keyboard changes the visual viewport height.
if(window.visualViewport){
  let vvTimer=0;
  window.visualViewport.addEventListener('resize',()=>{
    clearTimeout(vvTimer);
    vvTimer=setTimeout(()=>{
      if(state.connected&&document.activeElement===$('#nativeKeyboardInput')&&(state.cursorEditable||state.cursorShape==='ibeam'))focusRemoteFieldView();
    },45);
  });
}"""
new_vv = """// CHV Remote Web 3.0: resize the remote viewport to the real visible area
// above the iOS/Android software keyboard, then keep the active remote field in it.
if(window.visualViewport){
  let vvTimer=0;
  const updateVV=()=>{
    clearTimeout(vvTimer);vvTimer=setTimeout(()=>{
      syncKeyboardViewport();
      if(state.connected&&document.activeElement===$('#nativeKeyboardInput')&&(state.cursorEditable||state.cursorShape==='ibeam'))requestAnimationFrame(focusRemoteFieldView);
    },20);
  };
  window.visualViewport.addEventListener('resize',updateVV);
  window.visualViewport.addEventListener('scroll',updateVV);
  $('#nativeKeyboardInput').addEventListener('blur',()=>setTimeout(()=>{syncKeyboardViewport();clampPan();applyTransform()},80));
}"""
if old_vv not in s: raise SystemExit('WEB30 visual viewport marker missing')
s=s.replace(old_vv,new_vv,1)
app.write_text(s,encoding='utf-8')

h=html.read_text(encoding='utf-8')
insert_before='''    <div id="receivedFileSheet" class="sheet hidden">'''
sent_sheet='''    <div id="sentFileSheet" class="sheet hidden">\n      <div class="sheet-card sent-file-card">\n        <div class="sheet-head"><div><strong>Arquivo enviado</strong><small id="sentFileName">CHV Remote</small></div></div>\n        <p>Transferência concluída. O arquivo foi enviado para <b>Downloads / CHV Remote</b> no computador remoto.</p>\n        <div class="sent-file-actions"><button id="closeSentFileBtn" class="secondary">OK</button><button id="openSentFolderBtn" class="primary">Abrir pasta no PC</button></div>\n      </div>\n    </div>\n\n'''
if insert_before not in h: raise SystemExit('WEB30 sent sheet marker missing')
h=h.replace(insert_before,sent_sheet+insert_before,1)
h=h.replace('Versão PWA 2.7.0 • conexão via CHV Relay • controle móvel otimizado.','Versão PWA 3.0.0 • conexão via CHV Relay • teclado e transferências móveis otimizados.')
html.write_text(h,encoding='utf-8')

c=css.read_text(encoding='utf-8')
if '/* CHV Remote Web 3.0 keyboard viewport */' not in c:
    c += """
/* CHV Remote Web 3.0 keyboard viewport */
.session-view.keyboard-visible{inset:var(--keyboard-top,0px) 0 auto;height:var(--keyboard-vh,100dvh)!important;min-height:var(--keyboard-vh,100dvh)!important}
.session-view.keyboard-visible .screen-wrap{height:calc(var(--keyboard-vh,100dvh) - 58px)!important}
.sent-file-card p{font-size:14px;line-height:1.5;color:var(--muted);margin:4px 0 14px}
.sent-file-actions{display:flex;gap:10px}.sent-file-actions .secondary,.sent-file-actions .primary{flex:1;margin-top:0}
"""
css.write_text(c,encoding='utf-8')

w=sw.read_text(encoding='utf-8').replace("chv-remote-pwa-v2.9.0","chv-remote-pwa-v3.0.0")
if 'v3.0.0' not in w: raise SystemExit('WEB30 service worker marker missing')
sw.write_text(w,encoding='utf-8')
print('CHV_WEB_3_0_PATCH_OK')

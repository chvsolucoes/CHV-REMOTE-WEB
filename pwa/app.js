'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const store={get(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set(k,v){localStorage.setItem(k,JSON.stringify(v))}};
const state={ws:null,connected:false,access:'basic',pressed:false,lastMove:0,frameAt:0,fps:0,mbps:0,remoteW:0,remoteH:0,audioCtx:null,audioNext:{65:0,77:0},incoming:new Map(),relay:null};
const settings=Object.assign({quality:'balanced',savePasswords:false,autoAudio:false,autoMic:false},store.get('settings',{}));
let favorites=store.get('favorites',[]), history=store.get('history',[]);

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.add('hidden'),2400)}
function cleanId(v){return (v||'').replace(/\D/g,'').slice(0,6)}
function wsSend(o){if(state.ws&&state.ws.readyState===1) state.ws.send(JSON.stringify(o))}
function setStatus(msg){$('#connectStatus').textContent=msg;$('#sessionMeta').textContent=msg}
function showView(id){$$('.view').forEach(v=>v.classList.toggle('active',v.id===id));$('#bottomNav').style.display=id==='sessionView'?'none':'flex';$$('#bottomNav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id))}
function qProfile(){return settings.quality==='quality'?[1920,1080,'contain']:settings.quality==='speed'?[1280,720,'contain']:[1600,900,'contain']}

async function discoverRelay(){
  try{const r=await fetch('relay.json?ts='+Date.now(),{cache:'no-store'});const j=await r.json();if(!/^wss:\/\//.test(j.url))throw 0;state.relay=j.url;$('#relayBadge').classList.add('online');$('#relayBadge span').textContent='Servidor online';return j.url}
  catch(e){$('#relayBadge').classList.remove('online');$('#relayBadge span').textContent='Servidor indisponível';throw new Error('Servidor CHV Remote indisponível')}
}
async function connect(){
  const code=cleanId($('#remoteId').value), secret=$('#remotePassword').value;
  if(code.length!==6||secret.length<4)return toast('Informe o ID de 6 dígitos e a senha.');
  $('#connectBtn').disabled=true;setStatus('Localizando servidor CHV Remote…');showView('sessionView');$('#sessionTitle').textContent='ID '+code;
  try{
    const url=await discoverRelay();setStatus('Conectando…');
    const ws=new WebSocket(url);state.ws=ws;ws.binaryType='arraybuffer';
    const timeout=setTimeout(()=>{if(!state.connected){try{ws.close()}catch{};failed('Tempo de conexão esgotado')}},18000);
    ws.onopen=()=>wsSend({type:'hello',role:'control',code,secret});
    ws.onmessage=e=>handleMessage(e,code,secret,timeout);
    ws.onerror=()=>{if(!state.connected)failed('Falha ao conectar ao servidor')};
    ws.onclose=()=>{if(state.connected){state.connected=false;toast('Computador desconectado');showView('homeView')} updateConnectButton()};
  }catch(e){failed(e.message||'Falha na conexão')}
}
function failed(msg){setStatus(msg);toast(msg);showView('homeView');state.connected=false;updateConnectButton()}
function handleMessage(e,code,secret,timeout){
  if(typeof e.data==='string'){
    let o;try{o=JSON.parse(e.data)}catch{return}
    if(o.type==='pending_approval'){setStatus('Aguardando aprovação no computador…');return}
    if(o.type==='error'){clearTimeout(timeout);const m=o.code==='bad_password'?'Senha incorreta':o.code==='host_offline'?'Computador offline':o.message||'Conexão recusada';failed(m);try{state.ws.close()}catch{};return}
    if(o.type==='ready'&&o.paired){clearTimeout(timeout);state.connected=true;state.access=((o.access_level||o.access||'admin')+'').toLowerCase()==='basic'?'basic':'admin';setStatus('Conectado • '+(state.access==='admin'?'Administrador':'Básico'));const [w,h,fit]=qProfile();wsSend({type:'screen_profile',width:w,height:h,fit});saveConnection(code,secret);if(state.access==='admin'){if(settings.autoAudio)setFeature('system_audio',true);if(settings.autoMic)setFeature('microphone',true)};return}
    if(o.type==='peer_status'&&(o.connected===false||o.online===false)){toast('Computador remoto desconectou');disconnect();return}
    if(o.type==='clipboard_text'&&state.access==='admin'){navigator.clipboard?.writeText(o.text||'').then(()=>toast('Copiado do computador remoto')).catch(()=>toast(o.text||'Texto recebido'));return}
    if(o.type==='file_offer'){acceptFile(o);return}
    if(o.type==='permission_denied')toast(o.message||'Ação bloqueada pelo computador remoto');
    return;
  }
  handleBinary(new Uint8Array(e.data));
}
function handleBinary(u){if(!u.length)return;const m=u[0];if(m===70)return frame(u);if(m===65||m===77)return audioPacket(u);if(m===68)return fileChunk(u)}
function be32(u,o){return ((u[o]<<24)>>>0)+(u[o+1]<<16)+(u[o+2]<<8)+u[o+3]}
function be16(u,o){return (u[o]<<8)+u[o+1]}
function frame(u){if(u.length<10)return;state.remoteW=be32(u,1);state.remoteH=be32(u,5);const now=performance.now(),dt=Math.max(1,now-state.frameAt);state.frameAt=now;const ifps=1000/dt,imbps=(u.length*8/1e6)/(dt/1000);state.fps=state.fps?state.fps*.82+ifps*.18:ifps;state.mbps=state.mbps?state.mbps*.82+imbps*.18:imbps;$('#fpsMetric').textContent=state.fps.toFixed(0)+' FPS';$('#mbpsMetric').textContent=state.mbps.toFixed(1)+' Mbps';const blob=new Blob([u.slice(9)],{type:'image/jpeg'}),url=URL.createObjectURL(blob),img=$('#remoteScreen'),old=img.dataset.url;img.onload=()=>{if(old)URL.revokeObjectURL(old);$('#screenPlaceholder').style.display='none'};img.dataset.url=url;img.src=url}
function normalized(ev){const img=$('#remoteScreen'),r=img.getBoundingClientRect();const iw=state.remoteW||r.width,ih=state.remoteH||r.height,scale=Math.min(r.width/iw,r.height/ih),dw=iw*scale,dh=ih*scale,ox=r.left+(r.width-dw)/2,oy=r.top+(r.height-dh)/2;return{x:Math.max(0,Math.min(1,(ev.clientX-ox)/dw)),y:Math.max(0,Math.min(1,(ev.clientY-oy)/dh))}}
function inputMouse(action,ev,extra={}){if(!state.connected)return;const p=normalized(ev);wsSend({type:'input',kind:'mouse',action,x:p.x,y:p.y,...extra})}
function sendKey(key,down){wsSend({type:'input',kind:'key',key,down})}function tapKey(k){sendKey(k,true);sendKey(k,false)}function typeText(t){for(const ch of t)tapKey(ch)}
function setFeature(feature,enabled){if(state.access!=='admin'){toast('Disponível apenas no modo Administrador');return false}wsSend({type:'feature',feature,enabled});if(feature==='system_audio')wsSend({type:enabled?'audio_start':'audio_stop'});if(feature==='microphone'){wsSend({type:enabled?'microphone_start':'microphone_stop'});wsSend({type:enabled?'__disabled_microphone_start':'__disabled_microphone_stop'})}return true}
async function ensureAudio(){if(!state.audioCtx)state.audioCtx=new (window.AudioContext||window.webkitAudioContext)();if(state.audioCtx.state==='suspended')await state.audioCtx.resume()}
function audioPacket(u){if(!state.audioCtx||u.length<8)return;const marker=u[0],rate=be32(u,1),channels=be16(u,5);if(rate<8000||channels<1||channels>8)return;let offset=7,samples;if((u.length-offset)%(channels*4)===0){const n=(u.length-offset)/4;samples=new Float32Array(n);const dv=new DataView(u.buffer,u.byteOffset+offset,u.length-offset);for(let i=0;i<n;i++)samples[i]=dv.getFloat32(i*4,true)}else if(u.length>=9){const frames=be16(u,7);offset=9;if(u.length-offset!==frames*channels*2)return;samples=new Float32Array(frames*channels);const dv=new DataView(u.buffer,u.byteOffset+offset,u.length-offset);for(let i=0;i<samples.length;i++)samples[i]=dv.getInt16(i*2,true)/32768}else return;const frames=samples.length/channels,buf=state.audioCtx.createBuffer(channels,frames,rate);for(let c=0;c<channels;c++){const d=buf.getChannelData(c);for(let f=0;f<frames;f++)d[f]=samples[f*channels+c]}const src=state.audioCtx.createBufferSource();src.buffer=buf;src.connect(state.audioCtx.destination);const t=Math.max(state.audioCtx.currentTime+.02,state.audioNext[marker]||0);src.start(t);state.audioNext[marker]=t+buf.duration}
function saveConnection(id,password){const now=new Date().toISOString();history=[{id,date:now},...history.filter(x=>x.id!==id)].slice(0,30);store.set('history',history);const existing=favorites.find(x=>x.id===id);if(existing&&settings.savePasswords){existing.password=password;store.set('favorites',favorites)}renderLists()}
function addFavorite(id,password=''){if(!favorites.some(x=>x.id===id))favorites.unshift({id,password:settings.savePasswords?password:''});store.set('favorites',favorites);renderLists()}
function renderLists(){const fav=$('#favorites');fav.innerHTML='';if(!favorites.length){fav.className='list empty';fav.innerHTML='<span>Nenhum favorito ainda.</span>'}else{fav.className='list';for(const f of favorites)fav.appendChild(listItem(f.id,f.password,true))}const hist=$('#history');hist.innerHTML='';if(!history.length){hist.className='list empty';hist.innerHTML='<span>Nenhuma conexão ainda.</span>'}else{hist.className='list';for(const h of history)hist.appendChild(listItem(h.id,'',false,h.date))}}
function listItem(id,password,isFav,date){const el=document.createElement('div');el.className='list-item';el.innerHTML=`<div class="pc">▣</div><div class="info"><strong>ID ${id}</strong><small>${date?new Date(date).toLocaleString('pt-BR'):'Computador salvo'}</small></div><button>${isFav?'Conectar':'☆'}</button>`;el.querySelector('button').onclick=()=>{if(isFav){$('#remoteId').value=id;$('#remotePassword').value=password||'';showView('homeView');updateConnectButton();if(!password)$('#remotePassword').focus()}else addFavorite(id)};return el}
function disconnect(){try{state.ws?.close(1000)}catch{}state.ws=null;state.connected=false;$('#remoteScreen').removeAttribute('src');$('#screenPlaceholder').style.display='flex';showView('homeView');setStatus('Pronto para conectar');updateConnectButton()}
function updateConnectButton(){const id=cleanId($('#remoteId').value);$('#remoteId').value=id;$('#connectBtn').disabled=state.connected||id.length!==6||$('#remotePassword').value.length<4}
function acceptFile(o){if(state.access!=='admin'||!o.id)return;state.incoming.set(o.id,{name:(o.name||'arquivo').split(/[\\/]/).pop(),chunks:[],clipboard:!!o.clipboard})}
function fileChunk(u){if(u.length<5)return;const ml=be32(u,1);if(!ml||u.length<5+ml)return;let meta;try{meta=JSON.parse(new TextDecoder().decode(u.slice(5,5+ml)))}catch{return}const t=state.incoming.get(meta.id);if(!t)return;if(meta.final){const blob=new Blob(t.chunks),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=t.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);state.incoming.delete(meta.id);toast('Arquivo recebido: '+t.name)}else t.chunks.push(u.slice(5+ml))}
async function sendFiles(files){if(state.access!=='admin')return toast('Arquivos disponíveis apenas no modo Administrador');for(const file of files){const id=Date.now()+'-'+Math.random().toString(16).slice(2,10)+'-'+file.name;wsSend({type:'file_offer',id,name:file.name,size:file.size,clipboard:false,batch_id:crypto.randomUUID?.()||String(Date.now()),batch_final:true});const ab=new Uint8Array(await file.arrayBuffer());let index=0;for(let o=0;o<ab.length;o+=262144){sendFilePacket(id,index++,false,ab.slice(o,o+262144))}sendFilePacket(id,index,true,new Uint8Array());toast('Arquivo enviado: '+file.name)}}
function sendFilePacket(id,index,final,chunk){const meta=new TextEncoder().encode(JSON.stringify({id,index,final})),out=new Uint8Array(5+meta.length+chunk.length);out[0]=68;const n=meta.length;out[1]=(n>>>24)&255;out[2]=(n>>>16)&255;out[3]=(n>>>8)&255;out[4]=n&255;out.set(meta,5);out.set(chunk,5+meta.length);state.ws?.send(out)}

$('#remoteId').oninput=updateConnectButton;$('#remotePassword').oninput=updateConnectButton;$('#connectBtn').onclick=connect;$('#showPassword').onclick=()=>{$('#remotePassword').type=$('#remotePassword').type==='password'?'text':'password'};
$$('.seg').forEach(b=>b.onclick=()=>{$$('.seg').forEach(x=>x.classList.remove('active'));b.classList.add('active')});
$$('#bottomNav button').forEach(b=>b.onclick=()=>showView(b.dataset.view));
$('#backSession').onclick=disconnect;$('#disconnectBtn').onclick=disconnect;
$('#hideInstall').onclick=()=>{$('#installCard').style.display='none';store.set('hideInstall',true)};
$('#clearFavorites').onclick=()=>{favorites=[];store.set('favorites',favorites);renderLists()};$('#clearHistory').onclick=()=>{history=[];store.set('history',history);renderLists()};
$('#quality').value=settings.quality;$('#savePasswords').checked=settings.savePasswords;$('#autoAudio').checked=settings.autoAudio;$('#autoMic').checked=settings.autoMic;
['quality','savePasswords','autoAudio','autoMic'].forEach(id=>$('#'+id).onchange=e=>{settings[id]=e.target.type==='checkbox'?e.target.checked:e.target.value;store.set('settings',settings)});
const sw=$('#screenWrap');sw.onpointerdown=e=>{state.pressed=true;sw.setPointerCapture?.(e.pointerId);inputMouse('down',e,{button:e.button===2?'right':'left'})};sw.onpointermove=e=>{const n=performance.now();if(n-state.lastMove>16){state.lastMove=n;inputMouse('move',e)}};sw.onpointerup=e=>{if(state.pressed)inputMouse('up',e,{button:e.button===2?'right':'left'});state.pressed=false};sw.onpointercancel=()=>state.pressed=false;sw.ondblclick=e=>{inputMouse('down',e,{button:'left'});inputMouse('up',e,{button:'left'});inputMouse('down',e,{button:'left'});inputMouse('up',e,{button:'left'})};sw.oncontextmenu=e=>{e.preventDefault();inputMouse('down',e,{button:'right'});inputMouse('up',e,{button:'right'})};sw.onwheel=e=>{e.preventDefault();inputMouse('scroll',e,{dx:Math.trunc(e.deltaX),dy:Math.trunc(e.deltaY)})};
$('#keyboardBtn').onclick=()=>{$('#keyboardSheet').classList.remove('hidden');setTimeout(()=>$('#keyboardText').focus(),120)};$('#closeKeyboard').onclick=()=>$('#keyboardSheet').classList.add('hidden');$('#sendText').onclick=()=>{typeText($('#keyboardText').value);$('#keyboardText').value='';toast('Texto enviado')};$$('[data-key]').forEach(b=>b.onclick=()=>tapKey(b.dataset.key));
$('#copyBtn').onclick=()=>{if(state.access!=='admin')return toast('Disponível apenas no modo Administrador');wsSend({type:'clipboard_copy_request'});setTimeout(()=>wsSend({type:'clipboard_pull'}),700);toast('Solicitando área de transferência…')};
$('#pasteBtn').onclick=async()=>{if(state.access!=='admin')return toast('Disponível apenas no modo Administrador');try{const text=await navigator.clipboard.readText();if(!text)return toast('Área de transferência vazia');wsSend({type:'clipboard_text_push',text});toast('Enviado para o computador remoto')}catch{toast('Permita acesso à área de transferência no Safari')}};
$('#fileBtn').onclick=()=>$('#fileInput').click();$('#fileInput').onchange=e=>sendFiles([...e.target.files]);
$('#audioBtn').onclick=async e=>{await ensureAudio();const on=!e.currentTarget.classList.contains('active');if(setFeature('system_audio',on))e.currentTarget.classList.toggle('active',on)};$('#micBtn').onclick=async e=>{await ensureAudio();const on=!e.currentTarget.classList.contains('active');if(setFeature('microphone',on))e.currentTarget.classList.toggle('active',on)};
window.addEventListener('pagehide',()=>{try{state.ws?.close()}catch{}});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
if(store.get('hideInstall',false))$('#installCard').style.display='none';renderLists();discoverRelay().catch(()=>{});updateConnectButton();

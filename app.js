const $ = id => document.getElementById(id);
const video=$('video'), canvas=$('canvas'), startCameraBtn=$('startCameraBtn'), captureBtn=$('captureBtn');
const statusEl=$('status'), hint=$('hint'), grandTotalEl=$('grandTotal'), summaryEl=$('summary'), cartListEl=$('cartList');
const undoBtn=$('undoBtn'), resetBtn=$('resetBtn'), toast=$('toast');
const barcodeModeBtn=$('barcodeModeBtn'), priceModeBtn=$('priceModeBtn'), barcodeGuide=$('barcodeGuide'), priceGuide=$('priceGuide');
const stepBarcode=$('stepBarcode'), stepPrice=$('stepPrice'), barcodeState=$('barcodeState'), priceState=$('priceState');
const pairPanel=$('pairPanel'), detectedBarcodeEl=$('detectedBarcode'), detectedPriceEl=$('detectedPrice');
const selectedMinusBtn=$('selectedMinusBtn'), selectedPlusBtn=$('selectedPlusBtn'), selectedQtyEl=$('selectedQty');
const cancelSelectionBtn=$('cancelSelectionBtn'), addSelectedBtn=$('addSelectedBtn');
const manualBarcode=$('manualBarcode'), manualPrice=$('manualPrice'), manualAddBtn=$('manualAddBtn');

let stream=null, busy=false, mode='barcode', currentBarcode='', currentPrice=null, selectedQty=1;
let cart=JSON.parse(localStorage.getItem('costco_cart_v3')||'{}');
let history=JSON.parse(localStorage.getItem('costco_history_v3')||'[]');

function won(n){return new Intl.NumberFormat('ko-KR').format(n)+'원'}
function save(){localStorage.setItem('costco_cart_v3',JSON.stringify(cart));localStorage.setItem('costco_history_v3',JSON.stringify(history.slice(-80)))}
function showToast(msg){toast.textContent=msg;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1400)}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function totals(){const a=Object.values(cart);return{total:a.reduce((s,x)=>s+x.price*x.qty,0),qty:a.reduce((s,x)=>s+x.qty,0),kinds:a.length}}

function render(){
 const t=totals(); grandTotalEl.textContent=won(t.total); summaryEl.textContent=`${t.kinds}종 · ${t.qty}개`; undoBtn.disabled=!history.length;
 const items=Object.values(cart).sort((a,b)=>b.updatedAt-a.updatedAt);
 if(!items.length){cartListEl.innerHTML='<div class="empty">아직 추가된 상품이 없습니다.</div>';return}
 cartListEl.innerHTML=items.map(x=>`<div class="cart-item">
  <div class="cart-top"><div><div class="item-code">${escapeHtml(x.barcode||'직접 입력')}</div>
  <div class="item-price">${won(x.price)} × ${x.qty}</div></div><div class="item-subtotal">${won(x.price*x.qty)}</div></div>
  <div class="qty-row"><span>수량</span><div class="qty-controls">
   <button class="qty-btn" data-act="minus" data-key="${escapeHtml(x.key)}">−</button><strong>${x.qty}</strong>
   <button class="qty-btn" data-act="plus" data-key="${escapeHtml(x.key)}">＋</button></div></div>
  <div style="margin-top:10px;text-align:right">
   <button class="delete-item" data-key="${escapeHtml(x.key)}">상품 삭제</button>
  </div></div>`).join('');
 cartListEl.querySelectorAll('.qty-btn').forEach(b=>b.onclick=()=>{const k=b.dataset.key;if(!cart[k])return;
  cart[k].qty += b.dataset.act==='plus'?1:-1; if(cart[k].qty<=0)delete cart[k]; else cart[k].updatedAt=Date.now();save();render()});
 cartListEl.querySelectorAll('.delete-item').forEach(b=>b.onclick=()=>{
  const k=b.dataset.key;if(!cart[k])return;
  if(confirm('이 상품을 장바구니에서 삭제할까요?')){
    delete cart[k]; save(); render(); showToast('상품을 삭제했습니다.');
  }
 });
}

function updateFlow(){
 const haveBarcode=!!currentBarcode, havePrice=Number.isFinite(currentPrice);
 barcodeState.textContent=haveBarcode?currentBarcode:'아직 안 읽음';
 priceState.textContent=havePrice?won(currentPrice):(haveBarcode?'이제 가격을 읽으세요':'대기 중');
 stepBarcode.className='step '+(haveBarcode?'done':'active');
 stepPrice.className='step '+(havePrice?'done':(haveBarcode?'active':''));
 barcodeModeBtn.classList.toggle('active',mode==='barcode'); priceModeBtn.classList.toggle('active',mode==='price');
 barcodeGuide.classList.toggle('hidden',mode!=='barcode'); priceGuide.classList.toggle('hidden',mode!=='price');
 priceModeBtn.disabled=!haveBarcode;
 pairPanel.classList.toggle('hidden',!(haveBarcode&&havePrice));
 if(haveBarcode&&havePrice){
  detectedBarcodeEl.textContent=currentBarcode;
  detectedPriceEl.textContent=won(currentPrice);
  selectedQtyEl.textContent=selectedQty;
 }
}

function setMode(m){
 if(m==='price'&&!currentBarcode)return;
 mode=m; updateFlow();
 if(m==='barcode'){statusEl.textContent='상품 포장지의 바코드를 네모 안에 맞추고 촬영하세요.';hint.textContent='1단계: 상품 자체의 바코드를 읽습니다.'}
 else{statusEl.textContent='진열대 가격 숫자를 네모 안에 맞추고 촬영하세요.';hint.textContent='2단계: 판매가격 숫자를 크게 맞추면 인식이 더 잘 됩니다.'}
}

async function startCamera(){
 try{
  if(stream)stream.getTracks().forEach(t=>t.stop());
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
  video.srcObject=stream; await video.play(); captureBtn.disabled=false; startCameraBtn.textContent='카메라 다시 켜기'; setMode(mode);
 }catch(e){console.error(e);statusEl.textContent='카메라를 열 수 없습니다. Safari에서 카메라 권한을 허용해주세요.'}
}
function snap(){
 const w=video.videoWidth||1280,h=video.videoHeight||720;canvas.width=w;canvas.height=h;
 canvas.getContext('2d').drawImage(video,0,0,w,h);return canvas
}
function cropCenter(source, widthRatio=.88, heightRatio=.34){
 const sw=source.width, sh=source.height, cw=Math.floor(sw*widthRatio), ch=Math.floor(sh*heightRatio);
 const sx=Math.floor((sw-cw)/2), sy=Math.floor((sh-ch)/2);
 const out=document.createElement('canvas');out.width=cw;out.height=ch;out.getContext('2d').drawImage(source,sx,sy,cw,ch,0,0,cw,ch);return out
}

async function scanBarcode(frame){
 const target=cropCenter(frame,.94,.42);
 // 1) Native API if available
 if('BarcodeDetector' in window){
  try{
   const formats=['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf'];
   const det=new BarcodeDetector({formats}); const rs=await det.detect(target);
   if(rs?.length&&rs[0].rawValue)return rs[0].rawValue.trim()
  }catch(e){console.warn(e)}
 }
 // 2) ZXing fallback
 if(window.ZXing){
  try{
   const reader=new ZXing.BrowserMultiFormatReader();
   const img=target.toDataURL('image/jpeg',.92);
   const res=await reader.decodeFromImageUrl(img);
   const txt=res?.getText?.()||res?.text||'';
   if(txt)return String(txt).trim()
  }catch(e){console.warn('ZXing:',e)}
 }
 return ''
}

function extractPrice(text){
 if(!text)return null;
 const n=text.replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/[₩￦]/g,' ').replace(/\s+/g,' ');
 const hits=[]; const re=/(?:^|[^\d])(\d{1,3}(?:[,\.\s]\d{3})+|\d{3,7})(?:\s*원)?(?:[^\d]|$)/g; let m;
 while((m=re.exec(n))){const v=parseInt(m[1].replace(/[,\.\s]/g,''),10);if(v>=100&&v<=2000000)hits.push(v)}
 if(!hits.length)return null;
 const scored=hits.map(v=>{let s=0,st=String(v);if(st.endsWith('990'))s+=6;if(st.endsWith('900'))s+=4;if(st.endsWith('90'))s+=3;
  if(v>=1000&&v<=500000)s+=3;if(v>=1000000)s-=3;return{v,s}});
 scored.sort((a,b)=>b.s-a.s||b.v-a.v);return scored[0].v
}

async function scanPrice(frame){
 if(!window.Tesseract)throw new Error('OCR library missing');
 const target=cropCenter(frame,.94,.40);
 const r=await Tesseract.recognize(target,'eng',{logger:m=>{if(m.status==='recognizing text')statusEl.textContent=`가격 읽는 중… ${Math.round((m.progress||0)*100)}%`}});
 const text=r?.data?.text||''; return {price:extractPrice(text),text}
}

async function capture(){
 if(busy)return; busy=true; captureBtn.disabled=true;
 try{
  const frame=snap();
  if(mode==='barcode'){
   statusEl.textContent='바코드 읽는 중…';
   const code=await scanBarcode(frame);
   if(!code){statusEl.textContent='바코드를 읽지 못했습니다. 더 가까이 맞춰 다시 촬영해주세요.';showToast('바코드 인식 실패');return}
   currentBarcode=code; currentPrice=null; selectedQty=1; showToast('바코드 확인'); setMode('price');
  }else{
   statusEl.textContent='가격 읽는 중…';
   const r=await scanPrice(frame);
   if(!r.price){statusEl.textContent='가격을 찾지 못했습니다. 가격 숫자만 크게 맞춰 다시 촬영해주세요.';showToast('가격 인식 실패');return}
   currentPrice=r.price; updateFlow();statusEl.textContent='바코드와 가격을 확인하고 수량을 추가하세요.';showToast(won(currentPrice)+' 인식');
  }
 }catch(e){console.error(e);statusEl.textContent='인식 중 오류가 발생했습니다.';showToast('인식 오류')}
 finally{busy=false;captureBtn.disabled=false}
}

function addItem(barcode,price,qty=1){
 if(!barcode||!Number.isFinite(price))return;
 const key='b:'+barcode; const prev=cart[key]?{...cart[key]}:null; history.push({key,prev,ts:Date.now()});
 if(cart[key]){cart[key].qty+=qty;cart[key].price=price;cart[key].updatedAt=Date.now()}
 else cart[key]={key,barcode,price,qty,updatedAt:Date.now()};
 save();render();showToast(`+ ${qty}개 · ${won(price*qty)}`);if(navigator.vibrate)navigator.vibrate(50);
 resetPair()
}
function resetPair(){currentBarcode='';currentPrice=null;selectedQty=1;setMode('barcode');updateFlow()}

startCameraBtn.onclick=startCamera; captureBtn.onclick=capture; barcodeModeBtn.onclick=()=>setMode('barcode'); priceModeBtn.onclick=()=>setMode('price');

selectedMinusBtn.onclick=()=>{
  selectedQty=Math.max(1,selectedQty-1);
  selectedQtyEl.textContent=selectedQty;
};
selectedPlusBtn.onclick=()=>{
  selectedQty+=1;
  selectedQtyEl.textContent=selectedQty;
};
cancelSelectionBtn.onclick=()=>{
  resetPair();
  showToast('선택한 상품을 취소했습니다.');
};
addSelectedBtn.onclick=()=>addItem(currentBarcode,currentPrice,selectedQty);

manualAddBtn.onclick=()=>{const b=manualBarcode.value.trim();const p=parseInt(manualPrice.value.replace(/[^\d]/g,''),10);
 if(!b){showToast('바코드 또는 상품번호를 입력해주세요.');return}if(!Number.isFinite(p)||p<=0){showToast('가격을 확인해주세요.');return}
 addItem(b,p,1);manualBarcode.value='';manualPrice.value=''
};
undoBtn.onclick=()=>{const last=history.pop();if(!last)return;if(last.prev)cart[last.key]=last.prev;else delete cart[last.key];save();render();showToast('방금 추가를 취소했습니다.')};
resetBtn.onclick=()=>{if(!confirm('장바구니를 모두 비울까요?'))return;cart={};history=[];save();render();resetPair();showToast('초기화했습니다.')};

if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
render();updateFlow();

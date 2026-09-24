const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const startCameraBtn = document.getElementById('startCameraBtn');
const captureBtn = document.getElementById('captureBtn');
const statusEl = document.getElementById('status');
const grandTotalEl = document.getElementById('grandTotal');
const summaryEl = document.getElementById('summary');
const cartListEl = document.getElementById('cartList');
const undoBtn = document.getElementById('undoBtn');
const resetBtn = document.getElementById('resetBtn');
const toast = document.getElementById('toast');

const detectedPanel = document.getElementById('detectedPanel');
const detectedBarcodeEl = document.getElementById('detectedBarcode');
const detectedPriceEl = document.getElementById('detectedPrice');
const retryBtn = document.getElementById('retryBtn');
const addDetectedBtn = document.getElementById('addDetectedBtn');

const manualBarcode = document.getElementById('manualBarcode');
const manualPrice = document.getElementById('manualPrice');
const manualAddBtn = document.getElementById('manualAddBtn');

let stream = null;
let cart = JSON.parse(localStorage.getItem('costco_cart_v1') || '{}');
let history = JSON.parse(localStorage.getItem('costco_history_v1') || '[]');
let pending = null;
let busy = false;

function won(n) {
  return new Intl.NumberFormat('ko-KR').format(n) + '원';
}

function save() {
  localStorage.setItem('costco_cart_v1', JSON.stringify(cart));
  localStorage.setItem('costco_history_v1', JSON.stringify(history.slice(-50)));
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1300);
}

function cartTotals() {
  const items = Object.values(cart);
  return {
    total: items.reduce((s, x) => s + x.price * x.qty, 0),
    qty: items.reduce((s, x) => s + x.qty, 0),
    kinds: items.length
  };
}

function render() {
  const t = cartTotals();
  grandTotalEl.textContent = won(t.total);
  summaryEl.textContent = `${t.kinds}종 · ${t.qty}개`;
  undoBtn.disabled = history.length === 0;

  const items = Object.values(cart);
  if (!items.length) {
    cartListEl.innerHTML = '<div class="empty">아직 추가된 상품이 없습니다.</div>';
    return;
  }

  items.sort((a,b) => b.updatedAt - a.updatedAt);
  cartListEl.innerHTML = items.map(item => `
    <div class="cart-item">
      <div class="cart-top">
        <div>
          <div class="item-code">${escapeHtml(item.barcode || '바코드 미인식')}</div>
          <div class="item-price">${won(item.price)} × ${item.qty}</div>
        </div>
        <div class="item-subtotal">${won(item.price * item.qty)}</div>
      </div>
      <div class="qty-row">
        <span>수량</span>
        <div class="qty-controls">
          <button class="qty-btn" data-act="minus" data-key="${escapeHtml(item.key)}">−</button>
          <strong>${item.qty}</strong>
          <button class="qty-btn" data-act="plus" data-key="${escapeHtml(item.key)}">＋</button>
        </div>
      </div>
    </div>
  `).join('');

  cartListEl.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (!cart[key]) return;
      if (btn.dataset.act === 'plus') cart[key].qty += 1;
      else cart[key].qty -= 1;
      if (cart[key].qty <= 0) delete cart[key];
      save(); render();
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function startCamera() {
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    captureBtn.disabled = false;
    startCameraBtn.textContent = '카메라 다시 켜기';
    statusEl.textContent = '상품 바코드와 진열대 가격이 한 화면에 보이게 맞춰주세요.';
  } catch (err) {
    statusEl.textContent = '카메라를 열 수 없습니다. Safari에서 카메라 권한을 허용해주세요.';
    console.error(err);
  }
}

function snapFrame() {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  return canvas;
}

function cropCanvas(sourceCanvas, xRatio, yRatio, wRatio, hRatio) {
  const out = document.createElement('canvas');
  const sx = Math.round(sourceCanvas.width * xRatio);
  const sy = Math.round(sourceCanvas.height * yRatio);
  const sw = Math.round(sourceCanvas.width * wRatio);
  const sh = Math.round(sourceCanvas.height * hRatio);
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext('2d');
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

function barcodeRegion(sourceCanvas) {
  // 상단의 상품 바코드 안내 영역을 우선 분석합니다.
  return cropCanvas(sourceCanvas, 0.04, 0.05, 0.92, 0.46);
}

function priceRegion(sourceCanvas) {
  // 하단의 진열대 가격 안내 영역만 OCR하여 상품번호를 가격으로 오인식하는 일을 줄입니다.
  return cropCanvas(sourceCanvas, 0.04, 0.60, 0.92, 0.34);
}

async function detectBarcode(sourceCanvas) {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const formats = ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf'];
    const detector = new BarcodeDetector({ formats });
    const found = await detector.detect(sourceCanvas);
    if (!found.length) return null;
    const best = found[0];
    return (best.rawValue || '').trim() || null;
  } catch (e) {
    console.warn('Barcode detect failed', e);
    return null;
  }
}

function extractPriceFromText(text) {
  if (!text) return null;
  const normalized = text
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[₩￦]/g, '')
    .replace(/\s+/g, ' ');

  const hits = [];
  const re = /(?:^|[^\d])(\d{1,3}(?:[,\.\s]\d{3})+|\d{4,7})(?:\s*원)?(?:[^\d]|$)/g;
  let m;
  while ((m = re.exec(normalized)) !== null) {
    const n = parseInt(m[1].replace(/[,\.\s]/g, ''), 10);
    if (!Number.isFinite(n)) continue;
    if (n < 500 || n > 2000000) continue;
    hits.push(n);
  }

  if (!hits.length) return null;

  // Costco-style prices often end in 90/900/990; score likely retail prices.
  const scored = hits.map(n => {
    let score = 0;
    const s = String(n);
    if (s.endsWith('990')) score += 4;
    if (s.endsWith('900')) score += 3;
    if (s.endsWith('90')) score += 2;
    if (n >= 1000 && n <= 500000) score += 2;
    if (n >= 1000000) score -= 2; // likely item number
    return { n, score };
  });
  scored.sort((a,b) => b.score - a.score || b.n - a.n);
  return scored[0].n;
}

async function detectPrice(sourceCanvas) {
  if (!window.Tesseract) throw new Error('OCR 라이브러리를 불러오지 못했습니다.');
  const result = await Tesseract.recognize(sourceCanvas, 'eng', {
    logger: m => {
      if (m.status === 'recognizing text') {
        statusEl.textContent = `가격 읽는 중… ${Math.round((m.progress || 0) * 100)}%`;
      }
    }
  });
  const text = result?.data?.text || '';
  return { price: extractPriceFromText(text), text };
}

async function scanCurrentFrame() {
  if (busy) return;
  busy = true;
  captureBtn.disabled = true;
  detectedPanel.classList.add('hidden');
  pending = null;

  try {
    statusEl.textContent = '상품 바코드와 진열대 가격을 동시에 읽는 중…';
    const frame = snapFrame();
    const bRegion = barcodeRegion(frame);
    const pRegion = priceRegion(frame);

    // 바코드는 상품 쪽 안내영역에서 먼저 찾고, 실패하면 전체 화면을 한 번 더 확인합니다.
    let barcode = await detectBarcode(bRegion);
    if (!barcode) barcode = await detectBarcode(frame);

    // 가격은 진열대 가격 안내영역만 OCR합니다.
    const priceResult = await detectPrice(pRegion);
    const price = priceResult.price;

    if (!price) {
      statusEl.textContent = '진열대 가격을 찾지 못했습니다. 초록색 가격 영역에 숫자를 더 크게 맞춰주세요.';
      showToast('가격 인식 실패');
      return;
    }

    pending = {
      barcode: barcode || '',
      price,
      ocrText: priceResult.text
    };

    detectedBarcodeEl.textContent = barcode || '미인식';
    detectedPriceEl.textContent = won(price);
    detectedPanel.classList.remove('hidden');
    statusEl.textContent = barcode ? '상품 바코드와 가격을 확인한 뒤 추가하세요.' : '가격은 읽었습니다. 바코드가 안 잡혔으면 다시 촬영하거나 가격만 추가할 수 있습니다.';
  } catch (err) {
    console.error(err);
    statusEl.textContent = '인식 중 오류가 발생했습니다. 직접 입력을 이용해주세요.';
    showToast('인식 오류');
  } finally {
    busy = false;
    captureBtn.disabled = false;
  }
}

function makeKey(barcode, price) {
  if (barcode) return `b:${barcode}`;
  // 바코드가 없으면 동일 가격의 다른 상품과 합쳐지지 않도록 매 촬영을 별도 항목으로 둡니다.
  return `manual:${price}:${Date.now()}:${Math.random().toString(36).slice(2,7)}`;
}

function addItem(barcode, price) {
  const key = makeKey(barcode, price);
  const prev = cart[key] ? { ...cart[key] } : null;

  history.push({ key, prev, ts: Date.now() });
  if (history.length > 50) history = history.slice(-50);

  if (cart[key]) {
    cart[key].qty += 1;
    cart[key].price = price;
    cart[key].updatedAt = Date.now();
  } else {
    cart[key] = {
      key,
      barcode: barcode || '',
      price,
      qty: 1,
      updatedAt: Date.now()
    };
  }
  save(); render();
  showToast(`+ ${won(price)}`);
  if (navigator.vibrate) navigator.vibrate(50);
}

startCameraBtn.addEventListener('click', startCamera);
captureBtn.addEventListener('click', scanCurrentFrame);

retryBtn.addEventListener('click', () => {
  pending = null;
  detectedPanel.classList.add('hidden');
  statusEl.textContent = '위쪽에는 상품 바코드, 아래쪽에는 진열대 가격을 다시 맞춰주세요.';
});

addDetectedBtn.addEventListener('click', () => {
  if (!pending) return;
  addItem(pending.barcode, pending.price);
  detectedPanel.classList.add('hidden');
  pending = null;
  statusEl.textContent = '추가 완료. 다음 상품의 바코드와 가격을 한 화면에 맞춰주세요.';
});

manualAddBtn.addEventListener('click', () => {
  const barcode = manualBarcode.value.trim();
  const price = parseInt(manualPrice.value.replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(price) || price <= 0) {
    showToast('가격을 확인해주세요.');
    return;
  }
  addItem(barcode, price);
  manualBarcode.value = '';
  manualPrice.value = '';
});

undoBtn.addEventListener('click', () => {
  const last = history.pop();
  if (!last) return;
  if (last.prev) cart[last.key] = last.prev;
  else delete cart[last.key];
  save(); render();
  showToast('방금 추가를 취소했습니다.');
});

resetBtn.addEventListener('click', () => {
  if (!confirm('장바구니를 모두 비울까요?')) return;
  cart = {};
  history = [];
  save(); render();
  showToast('초기화했습니다.');
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

render();

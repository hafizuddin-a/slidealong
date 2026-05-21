const firebaseConfig = {
  apiKey: "AIzaSyAvEaYbtuEu-U5K3-YkUfSavIsCM_vdoLE",
  authDomain: "slidealong-dd8be.firebaseapp.com",
  databaseURL: "https://slidealong-dd8be-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "slidealong-dd8be",
  storageBucket: "slidealong-dd8be.firebasestorage.app",
  messagingSenderId: "667682771056",
  appId: "1:667682771056:web:047125fb436d8f4b75a4b5",
  measurementId: "G-727JX1CSBZ"
};

let db = null, firebaseInitError = null;
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
} catch(e) { firebaseInitError = e; console.error('Firebase:', e); }

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let myRole = null, sessionCode = null, viewerCount = 0;
let slideIndex = 1, totalSlides = 0, pdfDoc = null;
let viewerRef = null, viewerSessionRef = null;

// ── Screens ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, () => c[Math.floor(Math.random()*c.length)]).join('');
}

// ── PDF rendering ──
async function renderPage(canvas, pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const container = canvas.parentElement;
  const vp = page.getViewport({ scale: 1 });
  const scale = Math.min(container.clientWidth / vp.width, container.clientHeight / vp.height);
  const scaled = page.getViewport({ scale });
  canvas.width = scaled.width;
  canvas.height = scaled.height;
  canvas.classList.add('ready');
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;
}

function updateSlideCounter() {
  document.getElementById('slide-counter').textContent = slideIndex + ' / ' + totalSlides;
  document.getElementById('prev-btn').disabled = slideIndex <= 1;
  document.getElementById('next-btn').disabled = slideIndex >= totalSlides;
}

// ══════════════════════════════════════════════════════
//  PRESENTER
// ══════════════════════════════════════════════════════
async function startSession() {
  const errEl = document.getElementById('setup-error');
  const progressEl = document.getElementById('upload-progress');
  const startBtn = document.getElementById('start-btn');
  errEl.classList.remove('visible');

  if (!db) {
    errEl.textContent = firebaseInitError
      ? 'Firebase error: ' + firebaseInitError.message
      : 'Firebase failed to load. Check your internet connection and try again.';
    errEl.classList.add('visible');
    return;
  }

  const fileInput = document.getElementById('pdf-file');
  const file = fileInput.files[0];
  if (!file) {
    errEl.textContent = 'Please select a PDF file.';
    errEl.classList.add('visible');
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    errEl.textContent = 'PDF is too large (max 50 MB). Try compressing it first.';
    errEl.classList.add('visible');
    return;
  }

  sessionCode = genCode();
  myRole = 'presenter';
  startBtn.disabled = true;
  progressEl.style.display = 'block';
  progressEl.textContent = 'Reading file…';

  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

    const pdfData = dataUrl.split(',')[1];

    progressEl.textContent = 'Loading slides…';
    pdfDoc = await pdfjsLib.getDocument(dataUrl).promise;
    totalSlides = pdfDoc.numPages;
    slideIndex = 1;

    progressEl.textContent = 'Sharing slides…';

    const sessRef = db.ref('sessions/' + sessionCode);
    await sessRef.set({ active: true, created: Date.now(), pdfData, totalSlides, slideIndex: 1 });
    sessRef.child('active').onDisconnect().set(false);

    sessRef.child('viewers').on('child_added', () => { viewerCount++; updateViewerCount(); });
    sessRef.child('viewers').on('child_removed', () => { viewerCount = Math.max(0, viewerCount - 1); updateViewerCount(); });

    document.getElementById('pres-code').textContent = sessionCode;
    updateInviteModal();
    showScreen('presenter');
    updateSlideCounter();
    await renderPage(document.getElementById('pres-canvas'), pdfDoc, 1);
  } catch(e) {
    errEl.textContent = 'Error: ' + e.message;
    errEl.classList.add('visible');
    startBtn.disabled = false;
    progressEl.style.display = 'none';
    myRole = null;
    sessionCode = null;
  }
}

async function nextSlide() {
  if (slideIndex >= totalSlides) return;
  slideIndex++;
  updateSlideCounter();
  db.ref('sessions/' + sessionCode + '/slideIndex').set(slideIndex);
  await renderPage(document.getElementById('pres-canvas'), pdfDoc, slideIndex);
}

async function prevSlide() {
  if (slideIndex <= 1) return;
  slideIndex--;
  updateSlideCounter();
  db.ref('sessions/' + sessionCode + '/slideIndex').set(slideIndex);
  await renderPage(document.getElementById('pres-canvas'), pdfDoc, slideIndex);
}

// ══════════════════════════════════════════════════════
//  VIEWER
// ══════════════════════════════════════════════════════
function joinSession() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  const errEl = document.getElementById('join-error');
  const submitBtn = document.getElementById('join-submit-btn');
  errEl.classList.remove('visible');

  if (code.length !== 6) {
    errEl.textContent = 'Please enter a 6-character code.';
    errEl.classList.add('visible');
    return;
  }
  if (!db) {
    errEl.textContent = firebaseInitError
      ? 'Firebase error: ' + firebaseInitError.message
      : 'Firebase failed to load. Check your internet connection and try again.';
    errEl.classList.add('visible');
    return;
  }

  submitBtn.disabled = true;

  db.ref('sessions/' + code).once('value', snap => {
    const data = snap.val();
    if (!data || !data.active) {
      errEl.textContent = 'Session not found or has ended. Check the code.';
      errEl.classList.add('visible');
      submitBtn.disabled = false;
      return;
    }
    sessionCode = code;
    myRole = 'viewer';
    connectViewer(code, data.pdfData, data.totalSlides);
  }, err => {
    errEl.textContent = 'Firebase read failed: ' + err.message + ' — check your Realtime Database security rules.';
    errEl.classList.add('visible');
    submitBtn.disabled = false;
  });
}

async function connectViewer(code, pdfData, numSlides) {
  showScreen('viewer');
  setViewerStatus('orange', 'Loading slides…');

  viewerRef = db.ref('sessions/' + code + '/viewers').push();
  viewerRef.set({ joined: Date.now() });
  viewerRef.onDisconnect().remove();

  viewerSessionRef = db.ref('sessions/' + code);

  let viewerPdf = null;
  try {
    viewerPdf = await pdfjsLib.getDocument('data:application/pdf;base64,' + pdfData).promise;
  } catch(e) {
    setViewerStatus('red', 'Failed to load slides');
    return;
  }

  const viewCanvas = document.getElementById('view-canvas');
  document.getElementById('view-placeholder').classList.add('hidden');
  setViewerStatus('green', 'Live');

  let toastTimer = null;

  viewerSessionRef.child('slideIndex').on('value', async snap => {
    const n = snap.val();
    if (n === null) return;

    const toast = document.getElementById('view-toast');
    toast.textContent = '→ Slide ' + n;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);

    await renderPage(viewCanvas, viewerPdf, n);
  });

  viewerSessionRef.child('active').on('value', snap => {
    if (snap.val() === false) {
      leaveSession();
    }
  });
}

function setViewerStatus(color, text) {
  document.getElementById('view-dot').className = 'dot ' + color;
  document.getElementById('view-status').textContent = text;
}

// ══════════════════════════════════════════════════════
//  CLEANUP
// ══════════════════════════════════════════════════════
function endSession() {
  if (myRole === 'presenter') {
    db.ref('sessions/' + sessionCode + '/active').set(false);
    db.ref('sessions/' + sessionCode).off();
  }
  cleanup();
  showScreen('home');
}

function leaveSession() { cleanup(); showScreen('home'); }

function cleanup() {
  if (viewerRef) { viewerRef.remove(); viewerRef = null; }
  if (viewerSessionRef) { viewerSessionRef.off(); viewerSessionRef = null; }

  const presCanvas = document.getElementById('pres-canvas');
  const viewCanvas = document.getElementById('view-canvas');
  [presCanvas, viewCanvas].forEach(c => {
    c.classList.remove('ready');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
  });

  const ph = document.getElementById('view-placeholder');
  ph.classList.remove('hidden');
  ph.querySelector('.title').textContent = 'Waiting for presenter';
  ph.querySelector('.sub').textContent = 'Connected.\nSlides will appear here.';
  ph.querySelector('.icon').textContent = '📡';

  const toast = document.getElementById('view-toast');
  if (toast) { toast.classList.remove('show'); toast.textContent = ''; }

  const startBtn = document.getElementById('start-btn');
  startBtn.disabled = false;
  document.getElementById('upload-progress').style.display = 'none';
  document.getElementById('pdf-file').value = '';
  document.getElementById('join-submit-btn').disabled = false;

  slideIndex = 1; totalSlides = 0; pdfDoc = null;
  sessionCode = null; myRole = null; viewerCount = 0;
  document.getElementById('prev-btn').disabled = true;
  document.getElementById('next-btn').disabled = true;
  document.getElementById('slide-counter').textContent = '— / —';
  updateViewerCount();
}

// ══════════════════════════════════════════════════════
//  UI
// ══════════════════════════════════════════════════════
function updateViewerCount() {
  const el = document.getElementById('viewer-count');
  if (el) el.textContent = viewerCount + ' viewer' + (viewerCount !== 1 ? 's' : '');
}

function updateInviteModal() {
  const base = location.href.split('?')[0];
  document.getElementById('modal-code-text').textContent = sessionCode;
  document.getElementById('invite-link').value = base + '?join=' + sessionCode;
}

function showInviteModal() { updateInviteModal(); document.getElementById('invite-modal').classList.add('open'); }
function closeModal() { document.getElementById('invite-modal').classList.remove('open'); }

function copyInviteLink() {
  const input = document.getElementById('invite-link');
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.getElementById('copy-link-btn');
    btn.textContent = 'Copied ✓';
    setTimeout(() => btn.textContent = 'Copy Link', 2000);
  }).catch(() => document.execCommand('copy'));
}

// ══════════════════════════════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════════════════════════════
function initEventListeners() {
  // HOME
  document.getElementById('start-presenting-btn').addEventListener('click', () => showScreen('setup'));
  document.getElementById('join-btn').addEventListener('click', () => showScreen('join'));

  // SETUP
  document.getElementById('start-btn').addEventListener('click', startSession);
  document.getElementById('setup-back-btn').addEventListener('click', () => showScreen('home'));

  // JOIN
  document.getElementById('join-code').addEventListener('input', function() {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  document.getElementById('join-submit-btn').addEventListener('click', joinSession);
  document.getElementById('join-back-btn').addEventListener('click', () => showScreen('home'));

  // PRESENTER
  document.getElementById('prev-btn').addEventListener('click', prevSlide);
  document.getElementById('next-btn').addEventListener('click', nextSlide);
  document.getElementById('invite-btn').addEventListener('click', showInviteModal);
  document.getElementById('end-btn').addEventListener('click', endSession);

  // VIEWER
  document.getElementById('leave-btn').addEventListener('click', leaveSession);

  // KEYBOARD
  document.addEventListener('keydown', e => {
    if (myRole !== 'presenter') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextSlide();
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   prevSlide();
  });

  // MODAL
  document.getElementById('invite-link').addEventListener('click', function() { this.select(); });
  document.getElementById('copy-link-btn').addEventListener('click', copyInviteLink);
  document.getElementById('close-modal-btn').addEventListener('click', closeModal);
}

document.addEventListener('DOMContentLoaded', function() {
  initEventListeners();
  const code = new URLSearchParams(location.search).get('join');
  if (code) {
    showScreen('join');
    document.getElementById('join-code').value =
      code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }
});

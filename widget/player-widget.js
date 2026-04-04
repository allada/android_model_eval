// player-widget.js — self-contained replay player widget for Ghost.io articles (or any page)
//
// Ghost Code Injection (Site Header or Footer):
//   <script src="https://your-host/player-widget.js"></script>
//
// In article HTML cards — option A (declarative):
//   <div class="player-widget" data-src="https://your-host/data/uuid.json"></div>
//
// In article HTML cards — option B (imperative, inserts at script location):
//   <script>PlayerWidget.here('https://your-host/data/uuid.json')</script>
//
// In article HTML cards — option C (explicit container):
//   <div id="my-player"></div>
//   <script>PlayerWidget.create('#my-player', 'https://your-host/data/uuid.json')</script>

(function () {
  'use strict';

  // ===========================================================================
  // 1. Inject CSS once into document.head
  // ===========================================================================
  function injectStyles() {
    if (document.getElementById('player-widget-styles')) return;
    var style = document.createElement('style');
    style.id = 'player-widget-styles';
    style.textContent = [
      '.player-widget *, .player-widget *::before, .player-widget *::after { margin: 0; padding: 0; box-sizing: border-box; }',
      '',
      '.player-widget {',
      '  /* CSS custom properties (moved from :root to avoid polluting article vars) */',
      '  --bg:            #1a1a2e;',
      '  --bg-panel:      #0f0f23;',
      '  --bg-canvas:     #000;',
      '  --border:        #333;',
      '  --text:          #eee;',
      '  --text-dim:      #ccc;',
      '  --panel-medium:  300px;',
      '  --panel-wide:    360px;',
      '',
      '  /* Layout */',
      '  width: 100%;',
      '  height: min(100vh, 2400px);',
      '  overflow: hidden;',
      '  background: var(--bg);',
      '  color: var(--text);',
      '  font-family: system-ui, -apple-system, sans-serif;',
      '  -webkit-text-size-adjust: 100%;',
      '  user-select: none;',
      '  -webkit-user-select: none;',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      '',
      '.player-widget .main-area {',
      '  flex: 1;',
      '  min-height: 0;',
      '  display: flex;',
      '  flex-direction: column;',
      '  position: relative;',
      '}',
      '',
      '.player-widget .canvas-area {',
      '  flex: 1;',
      '  min-height: 0;',
      '  min-width: 0;',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      '',
      '.player-widget .canvas-container {',
      '  flex: 1;',
      '  min-height: 0;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  position: relative;',
      '  background: var(--bg-canvas);',
      '  overflow: hidden;',
      '}',
      '',
      '.player-widget canvas { display: block; }',
      '',
      '.player-widget .view-toggles {',
      '  position: absolute;',
      '  top: 8px;',
      '  right: 8px;',
      '  display: flex;',
      '  gap: 4px;',
      '}',
      '',
      '.player-widget .view-toggle {',
      '  background: rgba(0,0,0,0.5);',
      '  color: #aaa;',
      '  border: 1px solid #555;',
      '  border-radius: 12px;',
      '  padding: 6px 12px;',
      '  font-size: 0.7em;',
      '  cursor: pointer;',
      '  -webkit-tap-highlight-color: transparent;',
      '  touch-action: manipulation;',
      '  backdrop-filter: blur(4px);',
      '}',
      '.player-widget .view-toggle.active { color: #fff; border-color: #888; background: rgba(0,0,0,0.65); }',
      '',
      '.player-widget .video-overlay {',
      '  position: absolute;',
      '  bottom: 0;',
      '  left: 0;',
      '  right: 0;',
      '  padding: 24px 12px 8px;',
      '  padding-bottom: max(8px, env(safe-area-inset-bottom));',
      '  background: linear-gradient(transparent, rgba(0,0,0,0.8));',
      '  display: flex;',
      '  flex-direction: column;',
      '  gap: 2px;',
      '  pointer-events: none;',
      '  z-index: 10;',
      '}',
      '',
      '.player-widget .overlay-info, .player-widget .scrubber-row {',
      '  pointer-events: auto;',
      '}',
      '',
      '.player-widget .overlay-info {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '}',
      '',
      '.player-widget .overlay-tokens {',
      '  flex: 1;',
      '  display: flex;',
      '  gap: 6px;',
      '  font-size: 0.65em;',
      '  font-variant-numeric: tabular-nums;',
      '}',
      '.player-widget .ot-label { color: rgba(255,255,255,0.5); }',
      '.player-widget .ot-val   { color: #fff; font-weight: 600; margin-right: 2px; }',
      '',
      '.player-widget .overlay-time {',
      '  font-size: 0.7em;',
      '  color: rgba(255,255,255,0.8);',
      '  font-variant-numeric: tabular-nums;',
      '  white-space: nowrap;',
      '}',
      '',
      '.player-widget .speed {',
      '  background: rgba(255,255,255,0.1);',
      '  border: 1px solid rgba(255,255,255,0.25);',
      '  color: #fff;',
      '  border-radius: 6px;',
      '  padding: 6px 10px;',
      '  font-size: 0.75em;',
      '  cursor: pointer;',
      '  -webkit-tap-highlight-color: transparent;',
      '  touch-action: manipulation;',
      '  white-space: nowrap;',
      '}',
      '',
      '.player-widget .scrubber-row {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '}',
      '',
      '.player-widget .play-btn {',
      '  background: none;',
      '  border: none;',
      '  color: #fff;',
      '  font-size: 18px;',
      '  width: 44px;',
      '  height: 44px;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  cursor: pointer;',
      '  flex-shrink: 0;',
      '  -webkit-tap-highlight-color: transparent;',
      '  touch-action: manipulation;',
      '  padding: 0;',
      '}',
      '',
      '.player-widget .scrubber {',
      '  flex: 1;',
      '  min-width: 0;',
      '  height: 4px;',
      '  padding: 10px 0;',
      '  -webkit-appearance: none;',
      '  appearance: none;',
      '  background: transparent;',
      '  cursor: pointer;',
      '  outline: none;',
      '  font-size: 16px;',
      '}',
      '.player-widget .scrubber::-webkit-slider-runnable-track {',
      '  height: 3px;',
      '  background: rgba(255,255,255,0.3);',
      '  border-radius: 2px;',
      '}',
      '.player-widget .scrubber::-webkit-slider-thumb {',
      '  -webkit-appearance: none;',
      '  width: 16px; height: 16px;',
      '  background: #fff;',
      '  border-radius: 50%;',
      '  cursor: pointer;',
      '  margin-top: -6px;',
      '}',
      '.player-widget .scrubber::-moz-range-track {',
      '  height: 3px;',
      '  background: rgba(255,255,255,0.3);',
      '  border-radius: 2px;',
      '  border: none;',
      '}',
      '.player-widget .scrubber::-moz-range-thumb {',
      '  width: 16px; height: 16px;',
      '  background: #fff;',
      '  border-radius: 50%;',
      '  cursor: pointer;',
      '  border: none;',
      '}',
      '',
      '.player-widget .agent-area {',
      '  display: none;',
      '  flex-direction: column;',
      '  background: var(--bg-canvas);',
      '  border-left: 1px solid var(--border);',
      '  overflow: hidden;',
      '}',
      '',
      '.player-widget .side-panel {',
      '  display: none;',
      '  flex-direction: column;',
      '  width: var(--panel-medium);',
      '  flex-shrink: 0;',
      '  background: var(--bg-panel);',
      '  border-left: 1px solid var(--border);',
      '  overflow: hidden;',
      '  padding-bottom: 100px;',
      '}',
      '',
      '.player-widget .panel-label {',
      '  font-size: 0.65em;',
      '  color: #555;',
      '  text-transform: uppercase;',
      '  letter-spacing: 0.07em;',
      '  padding: 6px 12px 4px;',
      '  flex-shrink: 0;',
      '  background: var(--bg-panel);',
      '  border-bottom: 1px solid #1e1e35;',
      '}',
      '',
      '.player-widget .canvas-label { display: none; }',
      '.player-widget.layout-medium .canvas-label { display: block; }',
      '',
      '.player-widget .message-content {',
      '  flex: 1;',
      '  min-height: 0;',
      '  overflow-y: auto;',
      '  -webkit-overflow-scrolling: touch;',
      '  overscroll-behavior: contain;',
      '  touch-action: pan-y;',
      '  padding: 8px 12px 8px;',
      '  font-size: 0.8em;',
      '  line-height: 1.5;',
      '  display: flex;',
      '  flex-direction: column;',
      '}',
      '',
      '.player-widget .drawer {',
      '  flex-shrink: 0;',
      '  background: var(--bg-panel);',
      '  border-top: 1px solid var(--border);',
      '  display: flex;',
      '  flex-direction: column;',
      '  padding-bottom: env(safe-area-inset-bottom);',
      '}',
      '',
      '.player-widget .drawer-handle {',
      '  height: 28px;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  cursor: ns-resize;',
      '  touch-action: none;',
      '  -webkit-tap-highlight-color: transparent;',
      '  flex-shrink: 0;',
      '}',
      '.player-widget .drawer-handle::after {',
      '  content: \'\';',
      '  width: 40px; height: 4px;',
      '  background: #555;',
      '  border-radius: 2px;',
      '}',
      '',
      '.player-widget .drawer-content {',
      '  flex: 1;',
      '  min-height: 0;',
      '  display: flex;',
      '  flex-direction: column;',
      '  overflow: hidden;',
      '}',
      '',
      '.player-widget .drawer.collapsed .drawer-content { display: none; }',
      '',
      '.player-widget .msg-thinking {',
      '  color: #a78bfa;',
      '  margin-bottom: 8px;',
      '  padding: 6px 8px;',
      '  background: rgba(167,139,250,0.08);',
      '  border-left: 2px solid #a78bfa;',
      '  border-radius: 0 4px 4px 0;',
      '  font-style: italic;',
      '}',
      '',
      '.player-widget .msg-text {',
      '  color: #e2e8f0;',
      '  margin-bottom: 8px;',
      '  padding: 6px 8px;',
      '  background: rgba(255,255,255,0.04);',
      '  border-left: 2px solid #64748b;',
      '  border-radius: 0 4px 4px 0;',
      '}',
      '',
      '.player-widget .msg-tool {',
      '  margin-bottom: 8px;',
      '  padding: 6px 8px;',
      '  background: rgba(52,211,153,0.06);',
      '  border-left: 2px solid #34d399;',
      '  border-radius: 0 4px 4px 0;',
      '  font-family: monospace;',
      '  font-size: 0.85em;',
      '  -webkit-tap-highlight-color: transparent;',
      '  cursor: pointer;',
      '}',
      '.player-widget .msg-tool.selected { background: rgba(255,255,100,0.1); border-left-color: #fbbf24; }',
      '.player-widget .msg-tool-name  { color: #34d399; font-weight: 600; margin-bottom: 4px; }',
      '.player-widget .msg-tool-req,',
      '.player-widget .msg-tool-res   { color: #9ca3af; white-space: pre-wrap; word-break: break-all; font-size: 0.9em; }',
      '.player-widget .msg-tool-label { color: #6b7280; font-size: 0.85em; }',
      '.player-widget .msg-tool-img   { max-width: 100%; margin-top: 4px; border-radius: 3px; image-rendering: pixelated; }',
      '',
      '/* Layout class-based breakpoints (replaces viewport media queries) */',
      '',
      '/* Medium: two columns (canvas | messages) */',
      '.player-widget.layout-medium .main-area { flex-direction: row; }',
      '.player-widget.layout-medium .canvas-area { flex: 1; }',
      '.player-widget.layout-medium .side-panel { display: flex; }',
      '.player-widget.layout-medium .drawer { display: none; }',
      '',
      '/* Wide: three columns — activated by JS adding .layout-wide */',
      '.player-widget.layout-wide .main-area    { flex-direction: row; }',
      '.player-widget.layout-wide .agent-area   { display: flex; flex: 1; }',
      '.player-widget.layout-wide .side-panel   { display: flex; flex: 1; width: auto; }',
      '.player-widget.layout-wide .drawer       { display: none; }',
      '.player-widget.layout-wide .view-toggles { display: none; }',
      '.player-widget.layout-wide .canvas-label { display: block; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ===========================================================================
  // 2. Inner HTML template for a .player-widget div
  // ===========================================================================
  var WIDGET_INNER_HTML = [
    '  <div class="main-area">',
    '    <div class="canvas-area">',
    '      <div class="panel-label canvas-label">Live View</div>',
    '      <div class="canvas-container">',
    '        <canvas class="main-canvas"></canvas>',
    '        <div class="view-toggles">',
    '          <button class="view-toggle active toggle-live">Live</button>',
    '          <button class="view-toggle active toggle-agent">Agent</button>',
    '        </div>',
    '      </div>',
    '    </div>',
    '    <div class="agent-area">',
    '      <div class="panel-label">Agent\'s View</div>',
    '      <div class="canvas-container">',
    '        <canvas class="agent-display"></canvas>',
    '      </div>',
    '    </div>',
    '    <div class="side-panel">',
    '      <div class="panel-label">Messages</div>',
    '    </div>',
    '    <div class="video-overlay">',
    '      <div class="overlay-info">',
    '        <div class="overlay-tokens">',
    '          <span class="ot-label">In:</span><span class="ot-val stat-input">0</span>',
    '          <span class="ot-label">Out:</span><span class="ot-val stat-output">0</span>',
    '          <span class="ot-label">Total:</span><span class="ot-val stat-total">0</span>',
    '        </div>',
    '        <div class="overlay-time">0:00 / 0:00</div>',
    '        <button class="speed">8x</button>',
    '      </div>',
    '      <div class="scrubber-row">',
    '        <button class="play-btn">&#9654;</button>',
    '        <input type="range" class="scrubber" min="0" max="1000" value="0">',
    '      </div>',
    '    </div>',
    '  </div>',
    '  <div class="drawer">',
    '    <div class="drawer-handle"></div>',
    '    <div class="drawer-content"></div>',
    '  </div>',
    '  <div class="message-content"></div>',
    '  <video class="player-video" style="display:none" muted playsinline></video>',
  ].join('\n');

  // ===========================================================================
  // 3. initWidget(root) — the exact init function body from article.html,
  //    extracted verbatim from the .player-widget forEach callback
  // ===========================================================================
  function initWidget(root) {

// =====================================================================
// Constants
// =====================================================================
const SPEEDS              = [1, 2, 4, 8, 16];
const DEFAULT_SPEED_IDX   = 3;          // 8x
const AGENT_OVERLAY_ALPHA = 0.85;       // opacity when compositing agent onto video canvas
const BREAKPOINT_MEDIUM   = 760;        // px — matches CSS class-based layout threshold
// Wide mode: three equal panels (each 1/3 of body width)
const DRAWER_DEFAULT_RATIO = 0.4;       // fraction of viewport height
const DRAWER_SNAP_THRESHOLD = 40;       // px — collapse if dragged below this

// =====================================================================
// DOM References
// =====================================================================
const canvas        = root.querySelector('.main-canvas');
const ctx           = canvas.getContext('2d');
const agentDisplay  = root.querySelector('.agent-display');
const agentDispCtx  = agentDisplay.getContext('2d');
const video         = root.querySelector('.player-video');
const scrubber      = root.querySelector('.scrubber');
const timeDisplay   = root.querySelector('.overlay-time');
const speedBtn      = root.querySelector('.speed');
const playBtn       = root.querySelector('.play-btn');
const statInput     = root.querySelector('.stat-input');
const statOutput    = root.querySelector('.stat-output');
const statTotal     = root.querySelector('.stat-total');
const messageContent = root.querySelector('.message-content');
const drawer        = root.querySelector('.drawer');
const drawerHandle  = root.querySelector('.drawer-handle');
const drawerContent = root.querySelector('.drawer-content');
const sidePanel     = root.querySelector('.side-panel');
const agentArea     = root.querySelector('.agent-area');
const canvasArea    = canvas.closest('.canvas-area');
const toggleLiveBtn  = root.querySelector('.toggle-live');
const toggleAgentBtn = root.querySelector('.toggle-agent');

// Offscreen agent canvas — used in narrow/medium to composite agent onto video
const agentCanvas   = document.createElement('canvas');
const agentCtx      = agentCanvas.getContext('2d');

// =====================================================================
// Playback & Timeline State
// =====================================================================
let data           = null;
let events         = [];
let messageEvents  = [];
let messagesShown  = 0;
let lastMessageMs  = -1;
let playing        = false;
let lastFrameTime  = 0;
let virtualTimeMs  = 0;
let timelineEndMs  = 0;
let scrubbing      = false;
let wasPlayingBeforeScrub = false;
let speedIdx       = DEFAULT_SPEED_IDX;
let selectedToolEvent = null;

// =====================================================================
// Canvas Scaling State
// =====================================================================
let canvasScale     = 1;   // video canvas: logical screen px → canvas px
let agentDispScale  = 1;   // agent display canvas (wide mode)

// =====================================================================
// View Toggles (narrow / medium only; wide hides them via CSS)
// =====================================================================
let showLive  = true;
let showAgent = true;

// =====================================================================
// Layout State
// =====================================================================
let currentLayout  = null;  // 'narrow' | 'medium' | 'wide'
let drawerOpen     = true;
let drawerHeight   = 0;

// =====================================================================
// Layout Management
// =====================================================================
function getLayoutMode() {
  const vw = root.clientWidth;
  if (vw < BREAKPOINT_MEDIUM) return 'narrow';

  // Wide requires knowing the video aspect ratio to compute minimum fit width.
  // Without it, stay at medium until video loads and applyLayout() is called again.
  if (video.videoWidth && video.videoHeight) {
    const availH = root.clientHeight - 30 - 90; // ~30px labels, ~90px overlay
    const aspect = video.videoWidth / video.videoHeight;
    const singleCanvasW = Math.ceil(availH * aspect);
    const minWideW = singleCanvasW * 3;
    if (vw >= minWideW) return 'wide';
  }

  return 'medium';
}

function applyLayout() {
  const mode = getLayoutMode();
  const changed = mode !== currentLayout;
  currentLayout = mode;

  // Re-parent #message-content
  if (mode === 'narrow') {
    if (!drawerContent.contains(messageContent)) {
      drawerContent.appendChild(messageContent);
    }
    // Restore drawer to its saved height
    if (drawerOpen && drawerHeight > 0) {
      drawer.classList.remove('collapsed');
      drawer.style.height = drawerHeight + 'px';
    } else if (!drawerOpen) {
      drawer.classList.add('collapsed');
      drawer.style.height = '';
    }
  } else {
    if (!sidePanel.contains(messageContent)) {
      sidePanel.appendChild(messageContent);
    }
    // Drawer is hidden by CSS; reset its height so it doesn't affect layout on return to narrow
    drawer.style.height = '';
  }

  root.classList.toggle('layout-medium', currentLayout === 'medium');
  root.classList.toggle('layout-wide', currentLayout === 'wide');
  sizeAll(); // always re-size; body width may need updating
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyLayout, 80);
});

// =====================================================================
// Canvas Sizing
// =====================================================================
function sizeAll() {
  // Reset panel flex/width overrides so containers measure naturally
  canvasArea.style.flex  = '';
  canvasArea.style.width = '';
  agentArea.style.flex   = '';
  agentArea.style.width  = '';

  if (currentLayout === 'wide' && video.videoWidth && video.videoHeight) {
    // Wide mode: compute body width from available HEIGHT first to break the
    // chicken-and-egg where resetting root.style.width snaps it to 760px
    // (the medium CSS breakpoint), causing canvases to size for 760px instead
    // of the correct wide width.
    const availH = root.clientHeight - 30 - 90;
    const aspect = video.videoWidth / video.videoHeight;
    const targetCanvasW = Math.floor(availH * aspect);
    root.style.width = targetCanvasW * 3 + 'px';
    sizeVideoCanvas();
    sizeAgentCanvas();
    // Panels are all flex:1 — equal thirds, no manual width overrides needed
  } else {
    root.style.width = '';
    sizeVideoCanvas();
  }

  drawFrame();
}

function sizeVideoCanvas() {
  if (!video.videoWidth) return;
  const container = canvas.closest('.canvas-container');
  const availW = container.clientWidth;
  const availH = container.clientHeight;
  const aspect = video.videoWidth / video.videoHeight;

  let w = availW, h = availW / aspect;
  if (h > availH) { h = availH; w = h * aspect; }

  const dpr = window.devicePixelRatio || 1;
  canvas.style.width  = Math.round(w) + 'px';
  canvas.style.height = Math.round(h) + 'px';
  canvas.width  = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  // Offscreen agent canvas always matches video canvas dimensions
  agentCanvas.width  = canvas.width;
  agentCanvas.height = canvas.height;

  canvasScale = (w * dpr) / (data?.screenWidth || video.videoWidth);
}

function sizeAgentCanvas() {
  if (!video.videoWidth) return;
  const container = agentDisplay.closest('.canvas-container');
  const availW = container.clientWidth;
  const availH = container.clientHeight;
  const aspect = video.videoWidth / video.videoHeight;

  let w = availW, h = availW / aspect;
  if (h > availH) { h = availH; w = h * aspect; }

  const dpr = window.devicePixelRatio || 1;
  agentDisplay.style.width  = Math.round(w) + 'px';
  agentDisplay.style.height = Math.round(h) + 'px';
  agentDisplay.width  = Math.round(w * dpr);
  agentDisplay.height = Math.round(h * dpr);

  agentDispScale = (w * dpr) / (data?.screenWidth || video.videoWidth);
}

// =====================================================================
// Drawer (narrow mode)
// =====================================================================
function setDrawerHeight(h) {
  const maxH = window.innerHeight * 0.85;
  h = Math.max(0, Math.min(maxH, h));
  if (h < DRAWER_SNAP_THRESHOLD) {
    drawer.classList.add('collapsed');
    drawer.style.height = '';
    drawerOpen   = false;
    drawerHeight = 0;
  } else {
    drawer.classList.remove('collapsed');
    drawer.style.height = Math.round(h) + 'px';
    drawerOpen   = true;
    drawerHeight = Math.round(h);
  }
  requestAnimationFrame(sizeAll);
}

let drawerDragging  = false;
let drawerDragMoved = false;
let drawerDragStartY = 0;
let drawerDragStartH = 0;

drawerHandle.addEventListener('pointerdown', (e) => {
  if (currentLayout !== 'narrow') return;
  drawerDragging   = true;
  drawerDragMoved  = false;
  drawerDragStartY = e.clientY;
  drawerDragStartH = drawerOpen ? drawer.offsetHeight : 0;
  drawerHandle.setPointerCapture(e.pointerId);
  e.preventDefault();
});

drawerHandle.addEventListener('pointermove', (e) => {
  if (!drawerDragging) return;
  const dy = drawerDragStartY - e.clientY;
  if (Math.abs(dy) > 5) drawerDragMoved = true;
  setDrawerHeight(drawerDragStartH + dy);
});

drawerHandle.addEventListener('pointerup', () => {
  if (!drawerDragging) return;
  drawerDragging = false;
  if (!drawerDragMoved) {
    // Tap: toggle open/closed
    setDrawerHeight(drawerOpen ? 0 : Math.round(window.innerHeight * DRAWER_DEFAULT_RATIO));
  }
});

drawerHandle.addEventListener('pointercancel', () => { drawerDragging = false; });

// =====================================================================
// Data Loading
// =====================================================================
function loadDataFile(url) {
  fetch(url)
    .then(r => r.json())
    .then(d => {
      data   = d;
      events = d.events.slice().sort((a, b) => a.videoOffsetMs - b.videoOffsetMs);

      // Preload screenshot images
      for (const ev of events) {
        if (ev.type === 'screenshot' && ev.imageFile) {
          const img = new Image();
          img.src = ev.imageFile;
          ev._img = img;
        }
      }

      // Build message event list (no DOM yet — drawn incrementally in drawFrame)
      messageContent.innerHTML = '';
      messageEvents = events
        .filter(e => e.type === 'message' || e.type === 'tool_call')
        .map(e => ({
          videoOffsetMs:        e.videoOffsetMs,
          text:                 e.text,
          thinking:             e.thinking,
          toolName:             e.toolName,
          toolRequest:          e.toolRequest,
          toolResponse:         e.toolResponse,
          toolResponseImageFile: e.toolResponseImageFile,
        }));
      messagesShown    = 0;
      lastMessageMs    = -1;
      selectedToolEvent = null;

      video.src = 'videos/' + d.videoFile;
      video.load();
    })
    .catch(() => {});
}

video.addEventListener('loadedmetadata', () => {
  video.playbackRate = SPEEDS[speedIdx];
  speedBtn.textContent = SPEEDS[speedIdx] + 'x';

  const maxEventMs = events.length > 0 ? Math.max(...events.map(e => e.videoOffsetMs)) : 0;
  timelineEndMs = Math.max(video.duration * 1000, maxEventMs + 500);
  scrubber.max  = Math.floor(timelineEndMs);

  // Re-evaluate layout now that video dimensions are known (wide threshold may change)
  applyLayout();

  // Seek to 0 so the browser decodes & renders the first frame
  video.currentTime = 0;
  video.addEventListener('seeked', () => { if (!playing) drawFrame(); }, { once: true });
});

// =====================================================================
// Playback Controls
// =====================================================================
function setPlaying(value) {
  playing = value;
  playBtn.innerHTML = value ? '&#9646;&#9646;' : '&#9654;';
}

function togglePlayPause() {
  if (!video.src) return;

  if (playing) {
    video.pause();
    setPlaying(false);
    return;
  }

  // Restart from the beginning if at end
  if (virtualTimeMs >= timelineEndMs) {
    virtualTimeMs = 0;
    scrubber.value = 0;
    messageContent.innerHTML = '';
    messagesShown  = 0;
    lastMessageMs  = -1;
    video.currentTime = 0;
  }

  setPlaying(true);
  lastFrameTime = performance.now();

  if (virtualTimeMs < video.duration * 1000) {
    if (video.seeking) {
      video.addEventListener('seeked', () => video.play(), { once: true });
    } else {
      video.play();
    }
  }
  requestFrame();
}

playBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlayPause();
});

// Tap canvas to play/pause
canvas.addEventListener('click', togglePlayPause);

// Scrubber
scrubber.addEventListener('input', () => {
  if (!scrubbing) {
    wasPlayingBeforeScrub = playing;
    if (playing) { video.pause(); setPlaying(false); }
  }
  scrubbing = true;
  virtualTimeMs = Number(scrubber.value);
  video.currentTime = Math.min(virtualTimeMs / 1000, video.duration || 0);
  drawFrame();
});

scrubber.addEventListener('change', () => {
  scrubbing = false;
  virtualTimeMs = Number(scrubber.value);
  video.currentTime = Math.min(virtualTimeMs / 1000, video.duration || 0);

  if (wasPlayingBeforeScrub) {
    setPlaying(true);
    lastFrameTime = performance.now();
    if (video.seeking) {
      video.addEventListener('seeked', () => video.play(), { once: true });
    } else {
      video.play();
    }
    requestFrame();
  } else {
    drawFrame();
  }
});

// Speed cycling
speedBtn.addEventListener('click', () => {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  video.playbackRate = SPEEDS[speedIdx];
  speedBtn.textContent = SPEEDS[speedIdx] + 'x';
});

// View toggles
toggleLiveBtn.addEventListener('click', () => {
  showLive = !showLive;
  toggleLiveBtn.classList.toggle('active', showLive);
  if (!playing) drawFrame();
});
toggleAgentBtn.addEventListener('click', () => {
  showAgent = !showAgent;
  toggleAgentBtn.classList.toggle('active', showAgent);
  if (!playing) drawFrame();
});

// =====================================================================
// Animation Loop
// =====================================================================
function requestFrame() {
  if (!playing) return;
  const now = performance.now();
  requestAnimationFrame(() => {
    const delta = now - lastFrameTime;
    lastFrameTime = now;

    if (!scrubbing && !video.seeking) {
      if (video.ended || (video.paused && virtualTimeMs >= video.duration * 1000)) {
        virtualTimeMs += delta * SPEEDS[speedIdx];
        if (virtualTimeMs >= timelineEndMs) {
          virtualTimeMs = timelineEndMs;
          setPlaying(false);
        }
      } else {
        virtualTimeMs = video.currentTime * 1000;
      }
    }

    drawFrame();
    scrubber.value = Math.floor(virtualTimeMs);
    requestFrame();
  });
}

// =====================================================================
// Drawing — Agent Screenshots Helper
// =====================================================================
function drawAgentScreenshots(targetCanvas, targetCtx, scale, currentMs, fillBackground) {
  if (fillBackground) {
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.fillStyle = '#111';
    targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  } else {
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  }

  let hasContent = false;
  for (const ev of events) {
    if (ev.type !== 'screenshot') continue;
    if (ev.videoOffsetMs > currentMs) break;
    if (!ev._img || !ev._img.complete) continue;

    const dx = (ev.x  ?? 0)               * scale;
    const dy = (ev.y  ?? 0)               * scale;
    const dw = (ev.width  ?? data.screenWidth)  * scale;
    const dh = (ev.height ?? data.screenHeight) * scale;

    targetCtx.drawImage(ev._img, dx, dy, dw, dh);
    targetCtx.strokeStyle = 'rgba(52, 211, 153, 0.9)';
    targetCtx.lineWidth   = 2;
    targetCtx.strokeRect(dx, dy, dw, dh);
    hasContent = true;
  }
  return hasContent;
}

// =====================================================================
// Drawing — Main Frame
// =====================================================================
function drawFrame() {
  if (!data || !canvas.width) return;

  const currentMs = virtualTimeMs;
  const s = canvasScale;

  // --- Video canvas ---
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (showLive) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // --- Agent view ---
  if (currentLayout === 'wide') {
    // Wide: draw agent screenshots directly to the visible agent-display canvas
    if (agentDisplay.width > 0) {
      drawAgentScreenshots(agentDisplay, agentDispCtx, agentDispScale, currentMs, true);
    }
  } else if (showAgent) {
    // Narrow / Medium: composite agent onto video canvas via offscreen canvas
    const hasContent = drawAgentScreenshots(agentCanvas, agentCtx, s, currentMs, false);
    if (hasContent) {
      ctx.globalAlpha = AGENT_OVERLAY_ALPHA;
      ctx.drawImage(agentCanvas, 0, 0);
      ctx.globalAlpha = 1.0;
    }
  }

  // --- Action overlays (tap ripples, swipe trails, etc.) on video canvas ---
  for (const event of events) {
    drawEventOverlay(ctx, event, currentMs, s);
  }

  // --- Selected tool highlight ---
  if (selectedToolEvent) {
    drawHoverHighlight(ctx, selectedToolEvent, s);
  }

  // --- Token stats ---
  let latestUsage = null;
  for (const event of events) {
    if (event.type === 'usage' && event.videoOffsetMs <= currentMs) latestUsage = event;
  }
  const inp = latestUsage?.inputTokens  || 0;
  const out = latestUsage?.outputTokens || 0;
  statInput.textContent  = inp.toLocaleString();
  statOutput.textContent = out.toLocaleString();
  statTotal.textContent  = (inp + out).toLocaleString();

  timeDisplay.textContent = formatTime(currentMs) + ' / ' + formatTime(timelineEndMs);

  // --- Messages: append new entries as timeline advances ---
  if (currentMs < lastMessageMs) {
    messageContent.innerHTML = '';
    messagesShown = 0;
  }
  lastMessageMs = currentMs;

  const atBottom = messageContent.scrollHeight - messageContent.scrollTop - messageContent.clientHeight < 30;

  while (messagesShown < messageEvents.length && messageEvents[messagesShown].videoOffsetMs <= currentMs) {
    messageContent.appendChild(buildMessageEl(messageEvents[messagesShown]));
    messagesShown++;
  }

  if (atBottom) messageContent.scrollTop = messageContent.scrollHeight;
}

// =====================================================================
// Drawing — Build Message DOM Element
// =====================================================================
function buildMessageEl(msg) {
  const el = document.createElement('div');
  el.className = 'msg-entry';

  if (msg.thinking) {
    const t = document.createElement('div');
    t.className = 'msg-thinking';
    t.textContent = msg.thinking;
    el.appendChild(t);
  }

  if (msg.text) {
    const t = document.createElement('div');
    t.className = 'msg-text';
    t.textContent = msg.text;
    el.appendChild(t);
  }

  if (msg.toolName) {
    const t = document.createElement('div');
    t.className = 'msg-tool';

    const name = document.createElement('div');
    name.className = 'msg-tool-name';
    name.textContent = msg.toolName + '()';
    t.appendChild(name);

    const reqLabel = document.createElement('div');
    reqLabel.className = 'msg-tool-label';
    reqLabel.textContent = 'Request:';
    t.appendChild(reqLabel);

    const req = document.createElement('div');
    req.className = 'msg-tool-req';
    req.textContent = msg.toolRequest;
    t.appendChild(req);

    const resLabel = document.createElement('div');
    resLabel.className = 'msg-tool-label';
    resLabel.textContent = 'Response:';
    resLabel.style.marginTop = '4px';
    t.appendChild(resLabel);

    if (msg.toolResponseImageFile) {
      const img = document.createElement('img');
      img.className = 'msg-tool-img';
      img.src = msg.toolResponseImageFile;
      t.appendChild(img);
    }

    const res = document.createElement('div');
    res.className = 'msg-tool-res';
    res.textContent = msg.toolResponse;
    t.appendChild(res);

    // Tap to highlight corresponding event on canvas
    const matchingEvent = events.find(e =>
      e.videoOffsetMs === msg.videoOffsetMs &&
      e.type !== 'tool_call' && e.type !== 'message' && e.type !== 'usage'
    );
    if (matchingEvent) {
      t.addEventListener('click', () => {
        const prev = messageContent.querySelector('.msg-tool.selected');
        if (prev && prev !== t) prev.classList.remove('selected');

        if (selectedToolEvent === matchingEvent) {
          selectedToolEvent = null;
          t.classList.remove('selected');
        } else {
          selectedToolEvent = matchingEvent;
          t.classList.add('selected');
        }
        if (!playing) drawFrame();
      });
    }

    el.appendChild(t);
  }

  return el;
}

// =====================================================================
// Drawing — Action Overlays (tap ripple, swipe trail, etc.)
// =====================================================================
function drawEventOverlay(targetCtx, event, currentMs, s) {
  const elapsed = currentMs - event.videoOffsetMs;

  switch (event.type) {
    case 'tap': {
      if (elapsed < 0 || elapsed > 2000) return;
      const t = elapsed / 2000;
      const alpha = t < 0.1 ? 1 : 1 - ((t - 0.1) / 0.9);

      targetCtx.beginPath();
      targetCtx.arc(event.x * s, event.y * s, 15 + t * 40, 0, Math.PI * 2);
      targetCtx.strokeStyle = `rgba(233,69,96,${alpha * 0.6})`;
      targetCtx.lineWidth = 3;
      targetCtx.stroke();

      if (t > 0.15) {
        targetCtx.beginPath();
        targetCtx.arc(event.x * s, event.y * s, 15 + (t - 0.15) / 0.85 * 30, 0, Math.PI * 2);
        targetCtx.strokeStyle = `rgba(233,69,96,${alpha * 0.3})`;
        targetCtx.lineWidth = 2;
        targetCtx.stroke();
      }

      const dotAlpha = t < 0.3 ? 1 : Math.max(0, 1 - ((t - 0.3) / 0.7));
      targetCtx.beginPath();
      targetCtx.arc(event.x * s, event.y * s, 8, 0, Math.PI * 2);
      targetCtx.fillStyle = `rgba(233,69,96,${dotAlpha})`;
      targetCtx.fill();

      if (t < 0.1) {
        targetCtx.beginPath();
        targetCtx.arc(event.x * s, event.y * s, 20, 0, Math.PI * 2);
        targetCtx.fillStyle = `rgba(255,150,170,${0.5 * (1 - t / 0.1)})`;
        targetCtx.fill();
      }
      break;
    }

    case 'swipe': {
      const duration  = event.durationMs || 300;
      const totalShow = duration + 300;
      if (elapsed < 0 || elapsed > totalShow) return;

      const progress  = Math.min(elapsed / duration, 1);
      const fadeAlpha = elapsed > duration ? 1 - (elapsed - duration) / 300 : 1;
      const x1 = event.x1 * s, y1 = event.y1 * s;
      const x2 = event.x2 * s, y2 = event.y2 * s;
      const cx = x1 + (x2 - x1) * progress;
      const cy = y1 + (y2 - y1) * progress;

      targetCtx.beginPath();
      targetCtx.moveTo(x1, y1);
      targetCtx.lineTo(cx, cy);
      targetCtx.strokeStyle = `rgba(99,102,241,${fadeAlpha * 0.7})`;
      targetCtx.lineWidth = 4;
      targetCtx.lineCap = 'round';
      targetCtx.stroke();

      if (progress < 1) {
        targetCtx.beginPath();
        targetCtx.arc(cx, cy, 10, 0, Math.PI * 2);
        targetCtx.fillStyle = `rgba(99,102,241,${fadeAlpha})`;
        targetCtx.fill();
      }

      targetCtx.beginPath();
      targetCtx.arc(x1, y1, 5, 0, Math.PI * 2);
      targetCtx.fillStyle = `rgba(99,102,241,${fadeAlpha * 0.5})`;
      targetCtx.fill();
      break;
    }

    case 'long-press': {
      const duration  = event.durationMs || 1000;
      const totalShow = duration + 300;
      if (elapsed < 0 || elapsed > totalShow) return;

      const fadeAlpha = elapsed > duration ? 1 - (elapsed - duration) / 300 : 1;
      const pulse = 1 + 0.3 * Math.sin((elapsed / 200) * Math.PI);

      targetCtx.beginPath();
      targetCtx.arc(event.x * s, event.y * s, 14 * pulse, 0, Math.PI * 2);
      targetCtx.fillStyle = `rgba(251,191,36,${fadeAlpha * 0.6})`;
      targetCtx.fill();

      targetCtx.beginPath();
      targetCtx.arc(event.x * s, event.y * s, 7, 0, Math.PI * 2);
      targetCtx.fillStyle = `rgba(251,191,36,${fadeAlpha})`;
      targetCtx.fill();
      break;
    }

    case 'screenshot': {
      if (elapsed < 0 || elapsed > 600) return;
      const alpha = elapsed < 100 ? elapsed / 100 : (elapsed > 400 ? 1 - (elapsed - 400) / 200 : 1);
      const x = (event.x  ?? 0)               * s;
      const y = (event.y  ?? 0)               * s;
      const w = (event.width  ?? data.screenWidth)  * s;
      const h = (event.height ?? data.screenHeight) * s;

      targetCtx.strokeStyle = `rgba(52,211,153,${alpha * 0.9})`;
      targetCtx.lineWidth = 2;
      targetCtx.setLineDash([6, 4]);
      targetCtx.strokeRect(x, y, w, h);
      targetCtx.setLineDash([]);
      targetCtx.fillStyle = `rgba(52,211,153,${alpha * 0.08})`;
      targetCtx.fillRect(x, y, w, h);
      targetCtx.font = '11px system-ui';
      targetCtx.fillStyle = `rgba(52,211,153,${alpha})`;
      targetCtx.fillText('screenshot', x + 4, y + 14);
      break;
    }

    case 'key-event': {
      if (elapsed < 0 || elapsed > 800) return;
      const alpha = 1 - elapsed / 800;
      targetCtx.font = 'bold 14px system-ui';
      targetCtx.fillStyle = `rgba(168,85,247,${alpha})`;
      targetCtx.fillText('KEY: ' + (event.key || ''), 10, canvas.height - 20);
      break;
    }
  }
}

// =====================================================================
// Drawing — Selected Tool Highlight
// =====================================================================
function drawHoverHighlight(targetCtx, event, s) {
  targetCtx.save();

  switch (event.type) {
    case 'tap': {
      const x = event.x * s, y = event.y * s;
      targetCtx.strokeStyle = 'rgba(255,255,100,0.9)';
      targetCtx.lineWidth = 2;
      targetCtx.beginPath();
      targetCtx.moveTo(x - 25, y); targetCtx.lineTo(x + 25, y);
      targetCtx.moveTo(x, y - 25); targetCtx.lineTo(x, y + 25);
      targetCtx.stroke();
      targetCtx.beginPath();
      targetCtx.arc(x, y, 18, 0, Math.PI * 2);
      targetCtx.stroke();
      targetCtx.beginPath();
      targetCtx.arc(x, y, 6, 0, Math.PI * 2);
      targetCtx.fillStyle = 'rgba(255,255,100,0.8)';
      targetCtx.fill();
      targetCtx.font = 'bold 11px system-ui';
      targetCtx.fillStyle = 'rgba(255,255,100,0.9)';
      targetCtx.fillText(`tap (${event.x}, ${event.y})`, x + 22, y - 8);
      break;
    }

    case 'swipe': {
      const x1 = event.x1 * s, y1 = event.y1 * s;
      const x2 = event.x2 * s, y2 = event.y2 * s;
      targetCtx.strokeStyle = 'rgba(255,255,100,0.8)';
      targetCtx.lineWidth = 3;
      targetCtx.setLineDash([8, 4]);
      targetCtx.beginPath();
      targetCtx.moveTo(x1, y1); targetCtx.lineTo(x2, y2);
      targetCtx.stroke();
      targetCtx.setLineDash([]);
      targetCtx.beginPath();
      targetCtx.arc(x1, y1, 8, 0, Math.PI * 2);
      targetCtx.fillStyle = 'rgba(255,255,100,0.8)';
      targetCtx.fill();
      targetCtx.beginPath();
      targetCtx.arc(x2, y2, 8, 0, Math.PI * 2);
      targetCtx.fillStyle = 'rgba(255,200,50,0.9)';
      targetCtx.fill();
      targetCtx.font = 'bold 11px system-ui';
      targetCtx.fillStyle = 'rgba(255,255,100,0.9)';
      targetCtx.fillText(`start (${event.x1}, ${event.y1})`, x1 + 12, y1 - 8);
      targetCtx.fillText(`end (${event.x2}, ${event.y2})`,   x2 + 12, y2 - 8);
      break;
    }

    case 'long-press': {
      const x = event.x * s, y = event.y * s;
      targetCtx.strokeStyle = 'rgba(255,255,100,0.9)';
      targetCtx.lineWidth = 2;
      targetCtx.beginPath();
      targetCtx.arc(x, y, 22, 0, Math.PI * 2);
      targetCtx.stroke();
      targetCtx.beginPath();
      targetCtx.arc(x, y, 8, 0, Math.PI * 2);
      targetCtx.fillStyle = 'rgba(255,255,100,0.8)';
      targetCtx.fill();
      targetCtx.font = 'bold 11px system-ui';
      targetCtx.fillStyle = 'rgba(255,255,100,0.9)';
      targetCtx.fillText(`hold (${event.x}, ${event.y})`, x + 25, y - 8);
      break;
    }

    case 'screenshot': {
      const x = (event.x  ?? 0)               * s;
      const y = (event.y  ?? 0)               * s;
      const w = (event.width  ?? data.screenWidth)  * s;
      const h = (event.height ?? data.screenHeight) * s;
      targetCtx.strokeStyle = 'rgba(255,255,100,0.9)';
      targetCtx.lineWidth = 3;
      targetCtx.setLineDash([8, 4]);
      targetCtx.strokeRect(x, y, w, h);
      targetCtx.setLineDash([]);
      targetCtx.fillStyle = 'rgba(255,255,100,0.1)';
      targetCtx.fillRect(x, y, w, h);
      targetCtx.font = 'bold 11px system-ui';
      targetCtx.fillStyle = 'rgba(255,255,100,0.9)';
      targetCtx.fillText(`screenshot ${event.width}x${event.height}`, x + 4, y + 14);
      break;
    }
  }

  targetCtx.restore();
}

// =====================================================================
// Utilities
// =====================================================================
function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// =====================================================================
// Initialisation
// =====================================================================
const directDataUrl = root.dataset.src;

// Set initial drawer height before first applyLayout so narrow mode opens correctly
drawerHeight = 115;

applyLayout();   // sets currentLayout, re-parents message-content, applies drawer height

if (directDataUrl) {
  loadDataFile(directDataUrl);
}

  } // end initWidget

  // ===========================================================================
  // 4. Expose window.PlayerWidget
  // ===========================================================================
  window.PlayerWidget = {

    /**
     * Create a widget inside the given container element (or CSS selector),
     * loading data from dataSrc.
     */
    create: function (container, dataSrc) {
      injectStyles();

      var el = typeof container === 'string'
        ? document.querySelector(container)
        : container;

      if (!el) {
        console.warn('PlayerWidget.create: container not found:', container);
        return null;
      }

      var root = document.createElement('div');
      root.className = 'player-widget';
      root.dataset.src = dataSrc;
      root.innerHTML = WIDGET_INNER_HTML;
      el.appendChild(root);
      initWidget(root);
      return root;
    },

    /**
     * Insert a widget immediately before the calling <script> tag.
     * document.currentScript must be captured synchronously at the top
     * of this call since it becomes null after any async operation.
     */
    here: function (dataSrc) {
      // Capture currentScript synchronously — it is null after async work
      var scriptEl = document.currentScript;

      injectStyles();

      var root = document.createElement('div');
      root.className = 'player-widget';
      root.dataset.src = dataSrc;
      root.innerHTML = WIDGET_INNER_HTML;

      if (scriptEl && scriptEl.parentNode) {
        scriptEl.parentNode.insertBefore(root, scriptEl);
      } else {
        // Fallback: append to body if currentScript is unavailable
        document.body.appendChild(root);
      }

      initWidget(root);
      return root;
    },
  };

  // ===========================================================================
  // 5. Auto-initialize declarative .player-widget[data-src] elements
  // ===========================================================================
  function autoInit() {
    injectStyles();
    document.querySelectorAll('.player-widget[data-src]').forEach(function (root) {
      // Skip any that have already been initialized (marked by initWidget presence)
      if (root.dataset.playerWidgetInit) return;
      root.dataset.playerWidgetInit = '1';
      root.innerHTML = WIDGET_INNER_HTML;
      initWidget(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    // DOM already ready (e.g. script loaded async/defer or placed at bottom)
    autoInit();
  }

}());

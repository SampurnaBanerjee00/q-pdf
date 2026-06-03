const APP_NAME = 'Q PDF';
const SECURITY_KEY = '2009012';

const PAGE_SIZES = {
  A4:        { width: 595.28, height: 841.89 },
  A3:        { width: 841.89, height: 1190.55 },
  A5:        { width: 419.53, height: 595.28 },
  Letter:    { width: 612,    height: 792 },
  Legal:     { width: 612,    height: 1008 },
  Tabloid:   { width: 792,    height: 1224 },
  Executive: { width: 522,    height: 756 },
  B4:        { width: 708.66, height: 1000.63 },
  B5:        { width: 498.90, height: 708.66 },
};

const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;

const state = {
  merge: { files: [], pdfBytes: null },
  image: { files: [], pdfBytes: null },
  split: { file: null, pageCount: 0, selectedPages: [], splitMode: 'extract', pdfBytes: null, displayName: null },
  rotate: { file: null, pageCount: 0, degrees: 90, pdfBytes: null, displayName: null },
  resize: { file: null, pageCount: 0, pdfBytes: null, displayName: null },
  reorder: { file: null, pageCount: 0, pageOrder: [], thumbnails: [], pdfBytes: null, displayName: null },
};

let _logoBytesCache = null;

async function getLogoBytes() {
  if (_logoBytesCache) return _logoBytesCache;
  try {
    const resp = await fetch('logo.png');
    if (resp.ok) {
      _logoBytesCache = new Uint8Array(await resp.arrayBuffer());
      return _logoBytesCache;
    }
  } catch {}
  return null;
}

function generateId() {
  return Math.random().toString(36).substring(2, 11);
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function getPageCount(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    return pdf.getPageCount();
  } catch {
    return 0;
  }
}

function getImageDimensions(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = URL.createObjectURL(file);
  });
}

function calculateImagePlacement(imgWidth, imgHeight, pageWidth, pageHeight, fit, position, margin) {
  const availW = pageWidth - margin * 2;
  const availH = pageHeight - margin * 2;
  let drawWidth, drawHeight;

  if (fit === 'stretch') {
    drawWidth = availW;
    drawHeight = availH;
  } else {
    const ratio = imgWidth / imgHeight;
    if (fit === 'contain') {
      if (ratio > availW / availH) { drawWidth = availW; drawHeight = availW / ratio; }
      else { drawHeight = availH; drawWidth = availH * ratio; }
    } else {
      if (ratio > availW / availH) { drawHeight = availH; drawWidth = availH * ratio; }
      else { drawWidth = availW; drawHeight = availW / ratio; }
    }
  }

  let x, y;
  switch (position) {
    case 'top':    x = (pageWidth - drawWidth) / 2; y = pageHeight - margin - drawHeight; break;
    case 'bottom': x = (pageWidth - drawWidth) / 2; y = margin; break;
    case 'left':   x = margin; y = (pageHeight - drawHeight) / 2; break;
    case 'right':  x = pageWidth - margin - drawWidth; y = (pageHeight - drawHeight) / 2; break;
    default:       x = (pageWidth - drawWidth) / 2; y = (pageHeight - drawHeight) / 2;
  }
  return { x, y, drawWidth, drawHeight };
}

function triggerDownload(pdfBytes, filename) {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

async function applyWatermark(pdfDoc) {
  const pages = pdfDoc.getPages();
  const logoBytes = await getLogoBytes();
  let embeddedLogo = null;
  if (logoBytes) {
    try {
      embeddedLogo = await pdfDoc.embedPng(logoBytes);
    } catch {
      try { embeddedLogo = await pdfDoc.embedJpg(logoBytes); } catch { embeddedLogo = null; }
    }
  }
  const font = embeddedLogo ? null : await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const page of pages) {
    const { width, height } = page.getSize();
    const wmY = 10;

    if (embeddedLogo) {
      const logoDrawHeight = 24;
      const logoAspect = embeddedLogo.width / embeddedLogo.height;
      const logoDrawWidth = logoDrawHeight * logoAspect;
      page.drawImage(embeddedLogo, {
        x: 16,
        y: wmY,
        width: logoDrawWidth,
        height: logoDrawHeight,
        opacity: 0.65,
      });
    } else {
      page.drawText(`Made by ${APP_NAME}`, {
        x: 16,
        y: wmY + 4,
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.5),
        opacity: 0.7,
      });
    }
  }
}

function showToast(title, desc, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<div><div class="toast-title">${title}</div><div class="toast-desc">${desc}</div></div>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function openFullscreenPreview(type, src, fileName) {
  const overlay = document.getElementById('fullscreen-preview');
  const content = document.getElementById('fullscreen-content');

  if (type === 'pdf') {
    const previewUrl = src + '#toolbar=0&navpanes=0&scrollbar=1';
    content.innerHTML = `
      <div class="fullscreen-title">${fileName || 'PDF Preview'}</div>
      <div style="position:relative;width:100%;height:100%;">
        <iframe src="${previewUrl}" title="PDF Preview"></iframe>
        <div class="pdf-preview-shield" oncontextmenu="return false;"></div>
      </div>
    `;
  } else if (type === 'image') {
    content.innerHTML = `
      <div class="fullscreen-title">${fileName || 'Image Preview'}</div>
      <img src="${src}" alt="Preview">
    `;
  }

  overlay.style.display = 'flex';
}

function closeFullscreenPreview() {
  const overlay = document.getElementById('fullscreen-preview');
  const content = document.getElementById('fullscreen-content');
  overlay.style.display = 'none';
  content.innerHTML = '';
}

function previewPDFFile(file) {
  const url = URL.createObjectURL(file);
  openFullscreenPreview('pdf', url, file.name);
}

function previewImageFile(previewUrl, fileName) {
  openFullscreenPreview('image', previewUrl, fileName);
}

function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
      const homeView = document.getElementById('home-view');
      const mainContent = document.querySelector('.main-content');
      const homeBtn = document.getElementById('home-btn');
      if (homeView && homeView.style.display !== 'none') {
        homeView.style.display = 'none';
        mainContent.style.display = 'block';
        if (homeBtn) homeBtn.classList.add('active');
      }
    });
  });
}

function initDropZones() {
  document.querySelectorAll('.drop-zone').forEach(zone => {
    const input = zone.querySelector('input[type="file"]');
    const accept = zone.dataset.accept;
    const multiple = zone.dataset.multiple === 'true';
    const target = zone.dataset.target;

    zone.addEventListener('click', () => input.click());

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files).filter(f => {
        const acceptTypes = accept.split(',').map(t => t.trim());
        return acceptTypes.some(t => {
          if (t.startsWith('.')) return f.name.toLowerCase().endsWith(t.toLowerCase());
          if (t.endsWith('/*')) return f.type.startsWith(t.replace('/*', '/'));
          return f.type === t;
        });
      });
      if (files.length > 0) handleFiles(target, multiple ? files : [files[0]]);
    });

    input.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) handleFiles(target, multiple ? files : [files[0]]);
      e.target.value = '';
    });
  });
}

function handleFiles(target, files) {
  switch (target) {
    case 'merge-files':  addMergeFiles(files); break;
    case 'image-files':  addImageFiles(files); break;
    case 'split-file':   setSingleFile('split', files[0]); break;
    case 'rotate-file':  setSingleFile('rotate', files[0]); break;
    case 'resize-file':  setSingleFile('resize', files[0]); break;
    case 'reorder-file': setReorderFile(files[0]); break;
  }
}

let draggedItem = null;
let draggedGroup = null;

function initSortable(container) {
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedItem || draggedGroup !== container.dataset.group) return;
    const afterElement = getDragAfterElement(container, e.clientX, e.clientY);
    if (afterElement == null) container.appendChild(draggedItem);
    else container.insertBefore(draggedItem, afterElement);
  });
}

function getDragAfterElement(container, x, y) {
  const draggableElements = [...container.querySelectorAll('.sortable-item:not(.dragging)')];
  const isGrid = getComputedStyle(container).display === 'grid';

  if (isGrid) {
    let best = null;
    let bestDist = Infinity;
    draggableElements.forEach(child => {
      const box = child.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < bestDist) { bestDist = dist; best = child; }
    });
    if (!best) return null;
    const box = best.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    return (y < cy || (Math.abs(y - cy) < 10 && x < cx)) ? best : best.nextSibling;
  }

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function makeItemDraggable(el) {
  const handle = el.querySelector('.drag-handle');
  if (!handle) return;

  handle.addEventListener('mousedown', () => el.setAttribute('draggable', 'true'));
  handle.addEventListener('mouseup', () => el.setAttribute('draggable', 'false'));

  el.addEventListener('dragstart', (e) => {
    draggedItem = el;
    draggedGroup = el.closest('[data-group]')?.dataset.group;
    setTimeout(() => el.classList.add('dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
  });

  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    el.setAttribute('draggable', 'false');
    draggedItem = null;
    draggedGroup = null;
    updateOrderFromDOM(el.closest('[data-group]'));
  });
}

function updateOrderFromDOM(container) {
  const group = container?.dataset.group;
  if (!group) return;

  if (group === 'merge') {
    const items = container.querySelectorAll('.sortable-item');
    const newOrder = Array.from(items).map(el => el.dataset.id);
    state.merge.files = newOrder.map(id => state.merge.files.find(f => f.id === id)).filter(Boolean);
  } else if (group === 'image') {
    const items = container.querySelectorAll('.sortable-item');
    const newOrder = Array.from(items).map(el => el.dataset.id);
    state.image.files = newOrder.map(id => state.image.files.find(f => f.id === id)).filter(Boolean);
  } else if (group === 'reorder') {
    const items = container.querySelectorAll('.sortable-item');
    state.reorder.pageOrder = Array.from(items).map(el => parseInt(el.dataset.pageIndex));
  }
}

const icons = {
  grip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
};

async function addMergeFiles(files) {
  for (const file of files) {
    const pageCount = await getPageCount(file);
    state.merge.files.push({ id: generateId(), file, name: file.name, pageCount, size: file.size });
  }
  state.merge.pdfBytes = null;
  renderMergeList();
}

function removeMergeFile(id) {
  state.merge.files = state.merge.files.filter(f => f.id !== id);
  state.merge.pdfBytes = null;
  renderMergeList();
}

function renderMergeList() {
  const container = document.querySelector('[data-group="merge"]');
  const fileList = document.getElementById('merge-file-list');
  const countEl = fileList.querySelector('.file-count');
  const mergeBtn = document.getElementById('merge-btn');
  const downloadBtn = document.getElementById('merge-download-btn');

  countEl.textContent = state.merge.files.length;
  mergeBtn.disabled = state.merge.files.length < 2;
  fileList.style.display = state.merge.files.length > 0 ? 'block' : 'none';

  if (!state.merge.pdfBytes) {
    downloadBtn.style.display = 'none';
    document.getElementById('merge-preview').style.display = 'none';
  }

  container.innerHTML = state.merge.files.map(item => `
    <div class="sortable-item" data-id="${item.id}">
      <div class="drag-handle">${icons.grip}</div>
      <div class="item-icon">${icons.file}</div>
      <div class="item-info">
        <div class="item-name editable-name" data-merge-id="${item.id}" title="Click to rename">${item.displayName || item.name}</div>
        <div class="item-meta">${item.pageCount} pages · ${formatFileSize(item.size)}</div>
      </div>
      <button class="preview-btn" data-preview-pdf="${item.id}" title="Preview">${icons.eye}</button>
      <button class="remove-btn" data-id="${item.id}" title="Remove">${icons.trash}</button>
    </div>
  `).join('');

  container.querySelectorAll('.editable-name[data-merge-id]').forEach(el => {
    el.addEventListener('click', function() {
      const id = this.dataset.mergeId;
      const fileItem = state.merge.files.find(f => f.id === id);
      if (!fileItem) return;
      const current = fileItem.displayName || fileItem.name;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = current;
      input.className = 'text-input editable-name-input';
      input.style.cssText = 'font-size:0.85rem;padding:2px 6px;height:28px;';
      this.replaceWith(input);
      input.focus();
      input.select();
      const save = () => {
        fileItem.displayName = input.value.trim() || current;
        renderMergeList();
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.blur(); }
      });
    });
  });

  container.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); removeMergeFile(btn.dataset.id); });
  });

  container.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const file = state.merge.files.find(f => f.id === btn.dataset.previewPdf);
      if (file) previewPDFFile(file.file);
    });
  });

  container.querySelectorAll('.sortable-item').forEach(makeItemDraggable);
}

async function mergePDFs() {
  if (state.merge.files.length < 2) { showToast('Need at least 2 PDFs', 'Add more PDF files to merge', 'error'); return; }

  const progressEl = document.getElementById('merge-progress');
  const progressFill = progressEl.querySelector('.progress-fill');
  const progressPercent = progressEl.querySelector('.progress-percent');
  progressEl.style.display = 'block';

  try {
    const mergedPdf = await PDFDocument.create();
    for (let i = 0; i < state.merge.files.length; i++) {
      const arrayBuffer = await state.merge.files[i].file.arrayBuffer();
      const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach(page => mergedPdf.addPage(page));
      const pct = Math.round(((i + 1) / state.merge.files.length) * 100);
      progressFill.style.width = pct + '%';
      progressPercent.textContent = pct + '%';
    }
    state.merge.pdfBytes = await mergedPdf.save();
    showPreview('merge-preview', state.merge.pdfBytes);
    document.getElementById('merge-download-btn').style.display = 'inline-flex';
    showToast('PDFs Merged!', 'Preview ready. Click Download to save.');
  } catch (err) { showToast('Merge Failed', 'Could not merge the PDF files.', 'error'); console.error(err); }
  finally { progressEl.style.display = 'none'; progressFill.style.width = '0%'; }
}

async function addImageFiles(files) {
  for (const file of files) {
    const dims = await getImageDimensions(file);
    state.image.files.push({
      id: generateId(), file, name: file.name, size: file.size,
      preview: URL.createObjectURL(file), width: dims.width, height: dims.height,
    });
  }
  state.image.pdfBytes = null;
  renderImageList();
}

function removeImageFile(id) {
  const item = state.image.files.find(f => f.id === id);
  if (item) URL.revokeObjectURL(item.preview);
  state.image.files = state.image.files.filter(f => f.id !== id);
  state.image.pdfBytes = null;
  renderImageList();
}

function renderImageList() {
  const container = document.querySelector('[data-group="image"]');
  const fileList = document.getElementById('image-file-list');
  const countEl = fileList.querySelector('.file-count');
  const imageBtn = document.getElementById('image-btn');
  const downloadBtn = document.getElementById('image-download-btn');

  countEl.textContent = state.image.files.length;
  imageBtn.disabled = state.image.files.length === 0;
  fileList.style.display = state.image.files.length > 0 ? 'block' : 'none';

  if (!state.image.pdfBytes) {
    downloadBtn.style.display = 'none';
    document.getElementById('image-preview').style.display = 'none';
  }

  container.innerHTML = state.image.files.map(item => `
    <div class="sortable-item" data-id="${item.id}">
      <div class="drag-handle">${icons.grip}</div>
      <div class="item-icon"><img src="${item.preview}" alt="${item.name}"></div>
      <div class="item-info">
        <div class="item-name editable-name" data-image-id="${item.id}" title="Click to rename">${item.displayName || item.name}</div>
        <div class="item-meta">${item.width}x${item.height} · ${formatFileSize(item.size)}</div>
      </div>
      <button class="preview-btn" data-preview-img="${item.id}" title="Preview">${icons.eye}</button>
      <button class="remove-btn" data-id="${item.id}" title="Remove">${icons.trash}</button>
    </div>
  `).join('');

  container.querySelectorAll('.editable-name[data-image-id]').forEach(el => {
    el.addEventListener('click', function() {
      const id = this.dataset.imageId;
      const fileItem = state.image.files.find(f => f.id === id);
      if (!fileItem) return;
      const current = fileItem.displayName || fileItem.name;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = current;
      input.className = 'text-input editable-name-input';
      input.style.cssText = 'font-size:0.85rem;padding:2px 6px;height:28px;';
      this.replaceWith(input);
      input.focus();
      input.select();
      const save = () => {
        fileItem.displayName = input.value.trim() || current;
        renderImageList();
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.blur(); }
      });
    });
  });

  container.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); removeImageFile(btn.dataset.id); });
  });

  container.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const file = state.image.files.find(f => f.id === btn.dataset.previewImg);
      if (file) previewImageFile(file.preview, file.name);
    });
  });

  container.querySelectorAll('.sortable-item').forEach(makeItemDraggable);
}

async function convertImagesToPDF() {
  if (state.image.files.length === 0) { showToast('No images added', 'Add at least one image to convert', 'error'); return; }
  const progressEl = document.getElementById('image-progress');
  const progressFill = progressEl.querySelector('.progress-fill');
  const progressPercent = progressEl.querySelector('.progress-percent');
  progressEl.style.display = 'block';

  try {
    const pdfDoc = await PDFDocument.create();
    const pageSizeName = document.getElementById('img-page-size').value;
    const pageDef = PAGE_SIZES[pageSizeName] || PAGE_SIZES.A4;
    const orientation = document.getElementById('img-orientation').value;
    const fitMode = document.getElementById('img-fit').value;
    const position = document.getElementById('img-position').value;
    const margin = parseInt(document.getElementById('img-margin').value);
    const bgColor = document.getElementById('img-bg-color').value;
    const layoutMode = document.querySelector('[data-layout].active')?.dataset.layout || 'single';

    const pw = orientation === 'portrait' ? pageDef.width : pageDef.height;
    const ph = orientation === 'portrait' ? pageDef.height : pageDef.width;

    const hex = bgColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    const embeddedImgs = [];
    for (let i = 0; i < state.image.files.length; i++) {
      const imgItem = state.image.files[i];
      const imgBytes = await imgItem.file.arrayBuffer();
      let embeddedImg;
      try { embeddedImg = imgItem.file.type === 'image/png' ? await pdfDoc.embedPng(imgBytes) : await pdfDoc.embedJpg(imgBytes); }
      catch { try { embeddedImg = await pdfDoc.embedJpg(imgBytes); } catch { try { embeddedImg = await pdfDoc.embedPng(imgBytes); } catch { continue; } } }
      embeddedImgs.push(embeddedImg);
      progressFill.style.width = Math.round(((i + 1) / state.image.files.length) * 50) + '%';
      progressPercent.textContent = Math.round(((i + 1) / state.image.files.length) * 50) + '%';
    }

    if (layoutMode === 'grid') {
      const cols = Math.max(1, parseInt(document.getElementById('img-grid-cols').value) || 2);
      const rows = Math.max(1, parseInt(document.getElementById('img-grid-rows').value) || 2);
      const gap  = parseInt(document.getElementById('img-grid-gap').value) || 0;
      const perPage = cols * rows;
      const cellW = (pw - margin * 2 - gap * (cols - 1)) / cols;
      const cellH = (ph - margin * 2 - gap * (rows - 1)) / rows;

      const totalPages = embeddedImgs.length === 1 ? 1 : embeddedImgs.length;

      for (let p = 0; p < totalPages; p++) {
        const page = pdfDoc.addPage([pw, ph]);
        page.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: rgb(r, g, b) });
        const img = embeddedImgs.length === 1 ? embeddedImgs[0] : embeddedImgs[p];

        for (let slot = 0; slot < perPage; slot++) {
          const col = slot % cols;
          const row = Math.floor(slot / cols);
          const cellX = margin + col * (cellW + gap);
          const cellY = ph - margin - (row + 1) * cellH - row * gap;

          const imgAspect = img.width / img.height;
          const cellAspect = cellW / cellH;
          let drawW, drawH;
          if (imgAspect > cellAspect) { drawW = cellW; drawH = cellW / imgAspect; }
          else { drawH = cellH; drawW = cellH * imgAspect; }

          page.drawImage(img, {
            x: cellX + (cellW - drawW) / 2,
            y: cellY + (cellH - drawH) / 2,
            width: drawW,
            height: drawH,
          });
        }
        progressFill.style.width = (50 + Math.round(((p + 1) / totalPages) * 50)) + '%';
        progressPercent.textContent = (50 + Math.round(((p + 1) / totalPages) * 50)) + '%';
      }

    } else {
      for (let i = 0; i < embeddedImgs.length; i++) {
        const embeddedImg = embeddedImgs[i];
        const page = pdfDoc.addPage([pw, ph]);
        page.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: rgb(r, g, b) });
        const placement = calculateImagePlacement(embeddedImg.width, embeddedImg.height, pw, ph, fitMode, position, margin);
        page.drawImage(embeddedImg, { x: placement.x, y: placement.y, width: placement.drawWidth, height: placement.drawHeight });
        progressFill.style.width = (50 + Math.round(((i + 1) / embeddedImgs.length) * 50)) + '%';
        progressPercent.textContent = (50 + Math.round(((i + 1) / embeddedImgs.length) * 50)) + '%';
      }
    }

    state.image.pdfBytes = await pdfDoc.save();
    showPreview('image-preview', state.image.pdfBytes);
    document.getElementById('image-download-btn').style.display = 'inline-flex';
    showToast('PDF Created!', 'Preview ready. Click Download to save.');
  } catch (err) { showToast('Conversion Failed', 'Could not convert images to PDF.', 'error'); console.error(err); }
  finally { progressEl.style.display = 'none'; progressFill.style.width = '0%'; }
}

async function setSingleFile(tool, file) {
  if (!file) return;
  const pageCount = await getPageCount(file);
  state[tool].file = file;
  state[tool].pageCount = pageCount;
  state[tool].pdfBytes = null;
  state[tool].displayName = null;
  renderSingleFileInfo(tool);
}

function renderSingleFileInfo(tool) {
  const infoEl = document.getElementById(`${tool}-file-info`);
  const settingsEl = document.getElementById(`${tool}-settings`);
  const btn = document.getElementById(`${tool}-btn`);
  const downloadBtn = document.getElementById(`${tool}-download-btn`);

  infoEl.style.display = 'flex';
  settingsEl.style.display = 'block';
  btn.disabled = false;
  downloadBtn.style.display = 'none';

  const displayName = state[tool].displayName || state[tool].file.name;

  infoEl.innerHTML = `
    <div class="item-icon">${icons.file}</div>
    <div class="item-info">
      <div class="item-name editable-name" data-tool="${tool}" title="Click to rename">${displayName}</div>
      <div class="item-meta">${state[tool].pageCount} pages · ${formatFileSize(state[tool].file.size)}</div>
    </div>
    <button class="preview-btn" id="preview-${tool}-file" title="Preview">${icons.eye}</button>
    <button class="remove-btn" id="remove-${tool}-file">${icons.x}</button>
  `;

  infoEl.querySelector('.editable-name').addEventListener('click', function() {
    const current = state[tool].displayName || state[tool].file.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    input.className = 'text-input editable-name-input';
    input.style.cssText = 'font-size:0.85rem;padding:2px 6px;height:28px;';
    this.replaceWith(input);
    input.focus();
    input.select();
    const save = () => {
      const val = input.value.trim() || current;
      state[tool].displayName = val;
      renderSingleFileInfo(tool);
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { state[tool].displayName = state[tool].displayName; input.blur(); }
    });
  });

  document.getElementById(`remove-${tool}-file`).addEventListener('click', () => {
    state[tool].file = null;
    state[tool].pageCount = 0;
    state[tool].pdfBytes = null;
    state[tool].displayName = null;
    infoEl.style.display = 'none';
    settingsEl.style.display = 'none';
    btn.disabled = true;
    downloadBtn.style.display = 'none';
    document.getElementById(`${tool}-preview`).style.display = 'none';
  });

  document.getElementById(`preview-${tool}-file`).addEventListener('click', () => {
    previewPDFFile(state[tool].file);
  });

  if (tool === 'split') renderSplitSettings();
}

function renderSplitSettings() {
  const pc = state.split.pageCount;
  document.getElementById('split-range-to').value = pc;
  document.getElementById('split-range-to').max = pc;
  document.getElementById('split-range-from').max = pc;
  renderPageGrid();
}

function renderPageGrid() {
  const grid = document.getElementById('split-page-grid');
  const pc = state.split.pageCount;
  grid.innerHTML = '';
  for (let i = 1; i <= pc; i++) {
    const chip = document.createElement('div');
    chip.className = 'page-chip' + (state.split.selectedPages.includes(i) ? ' selected' : '');
    chip.textContent = i;
    chip.addEventListener('click', () => {
      if (state.split.selectedPages.includes(i)) {
        state.split.selectedPages = state.split.selectedPages.filter(p => p !== i);
        chip.classList.remove('selected');
      } else {
        state.split.selectedPages.push(i);
        state.split.selectedPages.sort((a, b) => a - b);
        chip.classList.add('selected');
      }
    });
    grid.appendChild(chip);
  }
}

async function splitPDF() {
  if (!state.split.file) return;
  const progressEl = document.getElementById('split-progress');
  const progressFill = progressEl.querySelector('.progress-fill');
  const progressPercent = progressEl.querySelector('.progress-percent');
  progressEl.style.display = 'block';
  progressFill.style.width = '50%';
  progressPercent.textContent = '50%';

  try {
    const arrayBuffer = await state.split.file.arrayBuffer();
    const sourcePdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const mode = state.split.splitMode;

    if (mode === 'range') {
      const from = Math.max(1, parseInt(document.getElementById('split-range-from').value)) - 1;
      const to = Math.min(state.split.pageCount, parseInt(document.getElementById('split-range-to').value));
      const newPdf = await PDFDocument.create();
      const indices = Array.from({ length: to - from }, (_, i) => from + i);
      const copiedPages = await newPdf.copyPages(sourcePdf, indices);
      copiedPages.forEach(p => newPdf.addPage(p));
      state.split.pdfBytes = await newPdf.save();
    } else if (mode === 'every') {
      const n = Math.max(1, parseInt(document.getElementById('split-every-n').value));
      const total = sourcePdf.getPageCount();
      const newPdf = await PDFDocument.create();
      const end = Math.min(n, total);
      const indices = Array.from({ length: end }, (_, i) => i);
      const copiedPages = await newPdf.copyPages(sourcePdf, indices);
      copiedPages.forEach(p => newPdf.addPage(p));
      state.split.pdfBytes = await newPdf.save();
      showToast('PDF Split!', `First part preview ready. All ${Math.ceil(total / n)} parts will download.`);
    } else {
      if (state.split.selectedPages.length === 0) {
        showToast('No pages selected', 'Select at least one page', 'error');
        progressEl.style.display = 'none'; return;
      }
      const newPdf = await PDFDocument.create();
      const indices = state.split.selectedPages.map(p => p - 1);
      const copiedPages = await newPdf.copyPages(sourcePdf, indices);
      copiedPages.forEach(p => newPdf.addPage(p));
      state.split.pdfBytes = await newPdf.save();
    }

    progressFill.style.width = '100%';
    progressPercent.textContent = '100%';
    if (mode !== 'every') showPreview('split-preview', state.split.pdfBytes);
    document.getElementById('split-download-btn').style.display = 'inline-flex';
    if (mode !== 'every') showToast('PDF Split!', 'Preview ready. Click Download to save.');
  } catch (err) { showToast('Split Failed', 'Could not split the PDF file.', 'error'); console.error(err); }
  finally { progressEl.style.display = 'none'; progressFill.style.width = '0%'; }
}

async function rotatePDF() {
  if (!state.rotate.file) return;
  const progressEl = document.getElementById('rotate-progress');
  const progressFill = progressEl.querySelector('.progress-fill');
  const progressPercent = progressEl.querySelector('.progress-percent');
  progressEl.style.display = 'block';

  try {
    const arrayBuffer = await state.rotate.file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    const scope = document.getElementById('rotate-scope').value;

    for (let i = 0; i < pages.length; i++) {
      const shouldRotate = scope === 'all' || (scope === 'odd' && (i + 1) % 2 === 1) || (scope === 'even' && (i + 1) % 2 === 0);
      if (shouldRotate) {
        const currentRotation = pages[i].getRotation().angle;
        pages[i].setRotation(degrees(currentRotation + state.rotate.degrees));
      }
      const pct = Math.round(((i + 1) / pages.length) * 100);
      progressFill.style.width = pct + '%';
      progressPercent.textContent = pct + '%';
    }

    state.rotate.pdfBytes = await pdfDoc.save();
    showPreview('rotate-preview', state.rotate.pdfBytes);
    document.getElementById('rotate-download-btn').style.display = 'inline-flex';
    showToast('PDF Rotated!', 'Preview ready. Click Download to save.');
  } catch (err) { showToast('Rotation Failed', 'Could not rotate the PDF file.', 'error'); console.error(err); }
  finally { progressEl.style.display = 'none'; progressFill.style.width = '0%'; }
}

async function resizePDF() {
  if (!state.resize.file) return;
  const progressEl = document.getElementById('resize-progress');
  const progressFill = progressEl.querySelector('.progress-fill');
  const progressPercent = progressEl.querySelector('.progress-percent');
  progressEl.style.display = 'block';

  try {
    const arrayBuffer = await state.resize.file.arrayBuffer();
    const sourcePdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const pageSizeName = document.getElementById('resize-page-size').value;
    const pageDef = PAGE_SIZES[pageSizeName] || PAGE_SIZES.A4;
    const orientation = document.getElementById('resize-orientation').value;
    const scale = parseInt(document.getElementById('resize-scale').value) / 100;
    const newW = orientation === 'portrait' ? pageDef.width : pageDef.height;
    const newH = orientation === 'portrait' ? pageDef.height : pageDef.width;

    const newPdf = await PDFDocument.create();
    const pageCount = sourcePdf.getPageCount();

    for (let i = 0; i < pageCount; i++) {
      const [embeddedPage] = await newPdf.embedPdf(sourcePdf, [i]);
      const page = newPdf.addPage([newW, newH]);
      const scaledW = embeddedPage.width * scale;
      const scaledH = embeddedPage.height * scale;
      page.drawPage(embeddedPage, { x: (newW - scaledW) / 2, y: (newH - scaledH) / 2, width: scaledW, height: scaledH });
      const pct = Math.round(((i + 1) / pageCount) * 100);
      progressFill.style.width = pct + '%';
      progressPercent.textContent = pct + '%';
    }

    state.resize.pdfBytes = await newPdf.save();
    showPreview('resize-preview', state.resize.pdfBytes);
    document.getElementById('resize-download-btn').style.display = 'inline-flex';
    showToast('PDF Resized!', 'Preview ready. Click Download to save.');
  } catch (err) { showToast('Resize Failed', 'Could not resize the PDF file.', 'error'); console.error(err); }
  finally { progressEl.style.display = 'none'; progressFill.style.width = '0%'; }
}

async function setReorderFile(file) {
  if (!file) return;
  const pageCount = await getPageCount(file);
  state.reorder.file = file;
  state.reorder.pageCount = pageCount;
  state.reorder.pageOrder = Array.from({ length: pageCount }, (_, i) => i);
  state.reorder.thumbnails = [];
  state.reorder.pdfBytes = null;
  renderReorderInfo();
  generateReorderThumbnails(file, pageCount);
}

function renderReorderInfo() {
  const infoEl = document.getElementById('reorder-file-info');
  const settingsEl = document.getElementById('reorder-settings');
  const btn = document.getElementById('reorder-btn');
  const downloadBtn = document.getElementById('reorder-download-btn');

  infoEl.style.display = 'flex';
  settingsEl.style.display = 'block';
  btn.disabled = false;
  downloadBtn.style.display = 'none';

  infoEl.innerHTML = `
    <div class="item-icon">${icons.file}</div>
    <div class="item-info">
      <div class="item-name">${state.reorder.file.name}</div>
      <div class="item-meta">${state.reorder.pageCount} pages · ${formatFileSize(state.reorder.file.size)}</div>
    </div>
    <button class="preview-btn" id="preview-reorder-file" title="Preview">${icons.eye}</button>
    <button class="remove-btn" id="remove-reorder-file">${icons.x}</button>
  `;

  document.getElementById('remove-reorder-file').addEventListener('click', () => {
    state.reorder.file = null;
    state.reorder.pageCount = 0;
    state.reorder.pageOrder = [];
    state.reorder.thumbnails = [];
    state.reorder.pdfBytes = null;
    infoEl.style.display = 'none';
    settingsEl.style.display = 'none';
    btn.disabled = true;
    downloadBtn.style.display = 'none';
    document.getElementById('reorder-preview').style.display = 'none';
  });

  document.getElementById('preview-reorder-file').addEventListener('click', () => {
    previewPDFFile(state.reorder.file);
  });

  renderReorderList();
}

async function generateReorderThumbnails(file, pageCount) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    state.reorder.thumbnails = [];

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 0.3 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      state.reorder.thumbnails[i - 1] = canvas.toDataURL('image/jpeg', 0.7);

      const thumbEl = document.querySelector(`#reorder-page-list .reorder-thumb-card[data-page-index="${i - 1}"] .thumb-img`);
      if (thumbEl) {
        thumbEl.src = state.reorder.thumbnails[i - 1];
        thumbEl.style.display = 'block';
        thumbEl.previousElementSibling?.remove();
      }
    }
  } catch (err) {
    console.warn('[Q PDF] Thumbnail generation failed:', err);
  }
}

function renderReorderList() {
  const container = document.getElementById('reorder-page-list');
  container.innerHTML = state.reorder.pageOrder.map((pageIndex) => {
    const thumb = state.reorder.thumbnails?.[pageIndex];
    return `
      <div class="reorder-thumb-card sortable-item" data-page-index="${pageIndex}">
        <div class="drag-handle reorder-drag">${icons.grip}</div>
        <div class="thumb-wrap">
          ${thumb
            ? `<img class="thumb-img" src="${thumb}" alt="Page ${pageIndex + 1}">`
            : `<div class="thumb-spinner"></div><img class="thumb-img" src="" alt="Page ${pageIndex + 1}" style="display:none">`
          }
        </div>
        <div class="thumb-label">Page ${pageIndex + 1}</div>
      </div>
    `;
  }).join('');
  initSortable(container);
  container.querySelectorAll('.sortable-item').forEach(makeItemDraggable);
}

async function reorderPDF() {
  if (!state.reorder.file) return;
  const progressEl = document.getElementById('reorder-progress');
  const progressFill = progressEl.querySelector('.progress-fill');
  const progressPercent = progressEl.querySelector('.progress-percent');
  progressEl.style.display = 'block';

  try {
    const arrayBuffer = await state.reorder.file.arrayBuffer();
    const sourcePdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const newPdf = await PDFDocument.create();

    for (let i = 0; i < state.reorder.pageOrder.length; i++) {
      const [copiedPage] = await newPdf.copyPages(sourcePdf, [state.reorder.pageOrder[i]]);
      newPdf.addPage(copiedPage);
      const pct = Math.round(((i + 1) / state.reorder.pageOrder.length) * 100);
      progressFill.style.width = pct + '%';
      progressPercent.textContent = pct + '%';
    }

    state.reorder.pdfBytes = await newPdf.save();
    showPreview('reorder-preview', state.reorder.pdfBytes);
    document.getElementById('reorder-download-btn').style.display = 'inline-flex';
    showToast('Pages Reordered!', 'Preview ready. Click Download to save.');
  } catch (err) { showToast('Reorder Failed', 'Could not reorder the PDF pages.', 'error'); console.error(err); }
  finally { progressEl.style.display = 'none'; progressFill.style.width = '0%'; }
}

function showPreview(containerId, pdfBytes) {
  const container = document.getElementById(containerId);
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const previewUrl = url + '#toolbar=0&navpanes=0&scrollbar=1';
  container.style.display = 'block';
  container.innerHTML = `
    <div class="preview-header">
      ${icons.eye}
      <span>Preview</span>
      <button class="preview-btn" style="margin-left:auto;width:auto;padding:4px 10px;font-size:0.75rem;color:var(--accent);background:var(--accent-light);border:1px solid var(--accent);border-radius:var(--radius-sm);cursor:pointer;display:flex;align-items:center;gap:4px;" id="fullscreen-${containerId}">
        ${icons.eye} Fullscreen
      </button>
    </div>
    <div class="preview-frame" style="position:relative;">
      <iframe src="${previewUrl}" title="PDF Preview"></iframe>
      <div class="pdf-preview-shield" oncontextmenu="return false;"></div>
    </div>
  `;
  document.getElementById(`fullscreen-${containerId}`).addEventListener('click', () => {
    openFullscreenPreview('pdf', url, 'PDF Preview');
  });
}

let currentDownloadContext = null;

function openDownloadDialog(pdfBytes, defaultFilename, pageCount) {
  currentDownloadContext = { pdfBytes, defaultFilename, pageCount };
  const filenameInput = document.getElementById('dl-filename');
  filenameInput.value = defaultFilename;
  document.getElementById('dl-page-count').textContent = pageCount;
  document.getElementById('dl-security-key').value = '';
  document.getElementById('dl-key-error').style.display = 'none';
  document.getElementById('download-dialog').style.display = 'flex';
}

function closeDownloadDialog() {
  document.getElementById('download-dialog').style.display = 'none';
  currentDownloadContext = null;
}

async function downloadWithWatermark() {
  if (!currentDownloadContext) return;
  const { pdfBytes, defaultFilename } = currentDownloadContext;
  const filename = document.getElementById('dl-filename').value.replace(/\.pdf$/i, '') || defaultFilename;

  try {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    await applyWatermark(pdfDoc);
    const finalBytes = await pdfDoc.save();
    triggerDownload(finalBytes, `${filename}.pdf`);
    showToast('Downloaded!', `File saved with ${APP_NAME} watermark`);
  } catch (err) { showToast('Download Failed', 'Could not process the PDF', 'error'); console.error(err); }
  closeDownloadDialog();
}

async function downloadWithKey() {
  if (!currentDownloadContext) return;
  const keyInput = document.getElementById('dl-security-key').value;
  const keyError = document.getElementById('dl-key-error');
  if (keyInput !== SECURITY_KEY) { keyError.style.display = 'block'; return; }

  keyError.style.display = 'none';
  const { pdfBytes, defaultFilename } = currentDownloadContext;
  const filename = document.getElementById('dl-filename').value.replace(/\.pdf$/i, '') || defaultFilename;

  try {
    triggerDownload(pdfBytes, `${filename}.pdf`);
    showToast('Downloaded!', 'File saved without watermark');
  } catch (err) { showToast('Download Failed', 'Could not process the PDF', 'error'); console.error(err); }
  closeDownloadDialog();
}

function init() {
  initTabs();
  initDropZones();
  document.querySelectorAll('.sortable-list').forEach(initSortable);

  const homeView = document.getElementById('home-view');
  const mainContent = document.querySelector('.main-content');
  const homeBtn = document.getElementById('home-btn');

  function showHome() {
    homeView.style.display = 'flex';
    mainContent.style.display = 'none';
    homeBtn.classList.remove('active');
  }

  function showTool(tab) {
    homeView.style.display = 'none';
    mainContent.style.display = 'block';
    homeBtn.classList.add('active');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    const tabPanel = document.getElementById(`tab-${tab}`);
    if (tabBtn) tabBtn.classList.add('active');
    if (tabPanel) tabPanel.classList.add('active');
  }

  homeBtn.addEventListener('click', showHome);

  document.querySelectorAll('.tool-card').forEach(card => {
    card.addEventListener('click', () => {
      showTool(card.dataset.tool);
    });
  });

  showHome();

  document.querySelectorAll('.clear-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'clear-merge') {
        state.merge.files = [];
        state.merge.pdfBytes = null;
        renderMergeList();
      }
      else if (action === 'clear-image') {
        state.image.files.forEach(f => URL.revokeObjectURL(f.preview));
        state.image.files = [];
        state.image.pdfBytes = null;
        renderImageList();
      }
    });
  });

  document.getElementById('merge-btn').addEventListener('click', mergePDFs);
  document.getElementById('merge-download-btn').addEventListener('click', () => {
    const totalPages = state.merge.files.reduce((a, f) => a + f.pageCount, 0);
    const firstName = state.merge.files.length > 0
      ? (state.merge.files[0].displayName || state.merge.files[0].name).replace(/\.pdf$/i, '')
      : 'merged';
    openDownloadDialog(state.merge.pdfBytes, firstName + '-merged', totalPages);
  });

  document.getElementById('image-btn').addEventListener('click', convertImagesToPDF);
  document.getElementById('image-download-btn').addEventListener('click', () => {
    const firstName = state.image.files.length > 0
      ? (state.image.files[0].displayName || state.image.files[0].name).replace(/\.[^.]+$/, '')
      : 'images-to-pdf';
    openDownloadDialog(state.image.pdfBytes, firstName + '-to-pdf', state.image.files.length);
  });

  document.querySelectorAll('#tab-split .split-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tab-split .split-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.split.splitMode = btn.dataset.mode;
      document.getElementById('split-extract-mode').style.display = btn.dataset.mode === 'extract' ? 'block' : 'none';
      document.getElementById('split-range-mode').style.display = btn.dataset.mode === 'range' ? 'block' : 'none';
      document.getElementById('split-every-mode').style.display = btn.dataset.mode === 'every' ? 'block' : 'none';
    });
  });
  document.getElementById('split-btn').addEventListener('click', splitPDF);
  document.getElementById('split-download-btn').addEventListener('click', async () => {
    if (state.split.splitMode === 'every') {
      const arrayBuffer = await state.split.file.arrayBuffer();
      const sourcePdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      const n = Math.max(1, parseInt(document.getElementById('split-every-n').value));
      const total = sourcePdf.getPageCount();
      for (let start = 0; start < total; start += n) {
        const newPdf = await PDFDocument.create();
        const end = Math.min(start + n, total);
        const indices = Array.from({ length: end - start }, (_, i) => start + i);
        const copiedPages = await newPdf.copyPages(sourcePdf, indices);
        copiedPages.forEach(p => newPdf.addPage(p));
        triggerDownload(await newPdf.save(), `split-part-${start + 1}-${end}.pdf`);
        await new Promise(r => setTimeout(r, 300));
      }
      showToast('All parts downloaded!', `${Math.ceil(total / n)} PDF files saved`);
    } else {
      const baseName = (state.split.displayName || state.split.file.name).replace(/\.pdf$/i, '');
      openDownloadDialog(state.split.pdfBytes, baseName + '-split', state.split.selectedPages.length || state.split.pageCount);
    }
  });

  document.querySelectorAll('.rotate-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rotate-option-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.rotate.degrees = parseInt(btn.dataset.degrees);
    });
  });
  document.getElementById('rotate-btn').addEventListener('click', rotatePDF);
  document.getElementById('rotate-download-btn').addEventListener('click', () => {
    const baseName = (state.rotate.displayName || state.rotate.file.name).replace(/\.pdf$/i, '');
    openDownloadDialog(state.rotate.pdfBytes, baseName + '-rotated', state.rotate.pageCount);
  });

  document.getElementById('resize-btn').addEventListener('click', resizePDF);
  document.getElementById('resize-download-btn').addEventListener('click', () => {
    const baseName = (state.resize.displayName || state.resize.file.name).replace(/\.pdf$/i, '');
    openDownloadDialog(state.resize.pdfBytes, baseName + '-resized', state.resize.pageCount);
  });

  document.getElementById('reorder-btn').addEventListener('click', reorderPDF);
  document.getElementById('reorder-download-btn').addEventListener('click', () => {
    const baseName = (state.reorder.displayName || state.reorder.file.name).replace(/\.pdf$/i, '');
    openDownloadDialog(state.reorder.pdfBytes, baseName + '-reordered', state.reorder.pageCount);
  });

  document.getElementById('dl-close-btn').addEventListener('click', closeDownloadDialog);
  document.getElementById('dl-watermark-btn').addEventListener('click', downloadWithWatermark);
  document.getElementById('dl-key-btn').addEventListener('click', downloadWithKey);
  document.getElementById('download-dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDownloadDialog(); });
  document.getElementById('dl-security-key').addEventListener('input', () => { document.getElementById('dl-key-error').style.display = 'none'; });

  document.getElementById('fullscreen-close').addEventListener('click', closeFullscreenPreview);
  document.getElementById('fullscreen-preview').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeFullscreenPreview(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFullscreenPreview(); });

  function gridFromCount(n) {
    const map = {1:[1,1],2:[1,2],3:[1,3],4:[2,2],5:[2,3],6:[2,3],7:[3,3],8:[2,4],9:[3,3],10:[2,5],11:[3,4],12:[3,4],13:[4,4],14:[2,7],15:[3,5],16:[4,4],17:[4,5],18:[3,6],19:[4,5],20:[4,5],21:[3,7],22:[4,6],23:[4,6],24:[4,6],25:[5,5],26:[4,7],27:[3,9],28:[4,7],29:[5,6],30:[5,6],31:[5,7],32:[4,8],33:[3,11],34:[4,9],35:[5,7],36:[6,6]};
    if (map[n]) return { cols: map[n][0], rows: map[n][1] };
    const c = Math.round(Math.sqrt(n)); return { cols: c, rows: Math.ceil(n / c) };
  }

  function applyPhotoCount(count) {
    const { cols, rows } = gridFromCount(count);
    document.getElementById('img-grid-cols').value = cols;
    document.getElementById('img-grid-rows').value = rows;
    document.getElementById('img-photo-count').value = count;
    document.getElementById('img-photo-count-val').textContent = count;
    document.getElementById('img-grid-info').textContent = 'Grid: ' + cols + ' \u00d7 ' + rows;
  }

  document.getElementById('img-photo-count').addEventListener('input', (e) => {
    applyPhotoCount(parseInt(e.target.value));
    document.querySelectorAll('.grid-preset-btn').forEach(b => b.classList.remove('active'));
    const match = document.querySelector('.grid-preset-btn[data-count="' + e.target.value + '"]');
    if (match) match.classList.add('active');
  });

  document.querySelectorAll('#tab-image [data-layout]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tab-image [data-layout]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const isGrid = btn.dataset.layout === 'grid';
      document.getElementById('img-grid-options').style.display = isGrid ? 'block' : 'none';
      document.getElementById('img-fit-group').style.display = isGrid ? 'none' : '';
      document.getElementById('img-position-group').style.display = isGrid ? 'none' : '';
    });
  });

  document.getElementById('img-grid-gap').addEventListener('input', (e) => {
    document.getElementById('img-grid-gap-val').textContent = e.target.value;
  });

  document.querySelectorAll('.grid-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.grid-preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const count = parseInt(btn.dataset.count);
      applyPhotoCount(count);
      if (btn.dataset.size) document.getElementById('img-page-size').value = btn.dataset.size;
    });
  });

  applyPhotoCount(4);
  document.getElementById('img-margin').addEventListener('input', (e) => { document.getElementById('img-margin-val').textContent = e.target.value; });
  document.getElementById('img-bg-color').addEventListener('input', (e) => { document.getElementById('img-bg-color-val').textContent = e.target.value; });
  document.getElementById('resize-scale').addEventListener('input', (e) => { document.getElementById('resize-scale-val').textContent = e.target.value; });
}

document.addEventListener('DOMContentLoaded', init);

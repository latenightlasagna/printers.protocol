document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('dropzone');
    const uploadBtn = document.getElementById('upload-btn');
    const fileInput = document.getElementById('file-input');
    const previewContainer = document.getElementById('preview-container');
    const widthInput = document.getElementById('print-width');
    const heightInput = document.getElementById('print-height');
    const analyzeBtn = document.getElementById('analyze-btn');
    const resultsPanel = document.getElementById('results-panel');
    const loadingState = document.getElementById('loading-state');
    
    const printMedium = document.getElementById('print-medium');
    const customStrokeInput = document.getElementById('custom-stroke');
    const customStrokeGroup = document.getElementById('custom-stroke-group');
    
    const toggleMeasureBtn = document.getElementById('toggle-measure');
    const resetMeasureBtn = document.getElementById('reset-measure');
    const measureColor = document.getElementById('measure-color');
    const btnActualSize = document.getElementById('btn-actual-size');
    const actualSizeModal = document.getElementById('actual-size-modal');
    
    const canvas = document.getElementById('pdf-preview');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const overlayCanvas = document.getElementById('error-overlay');
    
    const actualSizeContainer = document.getElementById('actual-size-container');
    const actualSizeCanvas = document.getElementById('actual-size-canvas');
    const interactCanvas = document.getElementById('interaction-layer');
    const interactCtx = interactCanvas.getContext('2d');
    const modalRulerTop = document.getElementById('modal-ruler-top');
    const modalRulerLeft = document.getElementById('modal-ruler-left');
    
    const magnifier = document.getElementById('magnifier');
    const magCanvas = document.getElementById('mag-canvas');
    const magCtx = magCanvas.getContext('2d');
    
    let pdfDocument = null, pdfPage = null;
    
    // Physics constants
    const TARGET_DPI = 300; 
    const CM_TO_INCHES = 0.393701;
    const PX_PER_CM = 37.795275; // Standard CSS physical ratio
    const DPR = window.devicePixelRatio || 1; // Captures true retina density
    
    let isMeasuringMode = false, isDrawingLine = false;
    let p1 = null, p2 = null;

    function updateStrokeInfo() {
        const opt = printMedium.options[printMedium.selectedIndex];
        let min = opt.value === 'custom' ? parseFloat(customStrokeInput.value) : parseFloat(opt.getAttribute('data-min-stroke'));
        opt.value === 'custom' ? customStrokeGroup.classList.remove('hidden') : customStrokeGroup.classList.add('hidden');
        document.getElementById('stroke-info').innerText = `(Min: ${min || 0} mm)`;
    }
    printMedium.addEventListener('change', updateStrokeInfo);
    customStrokeInput.addEventListener('input', updateStrokeInfo);
    updateStrokeInfo();

    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => { if(e.target.files.length) handleFile(e.target.files[0]); });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--text-color)'; });
    dropzone.addEventListener('dragleave', () => dropzone.style.borderColor = 'var(--border-color)' );
    dropzone.addEventListener('drop', (e) => { e.preventDefault(); if(e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });

    async function handleFile(file) {
        if(file.type !== 'application/pdf') return alert('PDF required.');
        dropzone.classList.add('hidden');
        previewContainer.classList.remove('hidden');
        pdfDocument = await pdfjsLib.getDocument(new Uint8Array(await file.arrayBuffer())).promise;
        pdfPage = await pdfDocument.getPage(1); 
        
        const unscaled = pdfPage.getViewport({ scale: 1.0 });
        const safeScale = Math.min(1500 / unscaled.width, 2.0); 
        const viewport = pdfPage.getViewport({ scale: safeScale });

        canvas.width = overlayCanvas.width = viewport.width;
        canvas.height = overlayCanvas.height = viewport.height;
        await pdfPage.render({ canvasContext: ctx, viewport: viewport }).promise;
        validateForm();
    }

    [widthInput, heightInput].forEach(el => el.addEventListener('input', validateForm));
    function validateForm() {
        analyzeBtn.disabled = !(pdfDocument && parseFloat(widthInput.value) > 0 && parseFloat(heightInput.value) > 0);
    }

    // --- PRO ACTUAL SIZE WORKSPACE ---
    btnActualSize.addEventListener('click', async () => {
        const wCm = parseFloat(widthInput.value), hCm = parseFloat(heightInput.value);
        if(!wCm || !hCm) return;
        
        const cssWidth = wCm * PX_PER_CM;
        const cssHeight = hCm * PX_PER_CM;
        
        // Render 1:1 physically accurate canvas mapped directly to DPR for retina crispness
        actualSizeCanvas.width = interactCanvas.width = cssWidth * DPR;
        actualSizeCanvas.height = interactCanvas.height = cssHeight * DPR;
        
        actualSizeCanvas.style.width = interactCanvas.style.width = actualSizeContainer.style.width = `${cssWidth}px`;
        actualSizeCanvas.style.height = interactCanvas.style.height = actualSizeContainer.style.height = `${cssHeight}px`; 
        
        // Render crisp PDF dynamically to exact physical size
        const reqScale = (cssWidth * DPR) / pdfPage.getViewport({scale: 1}).width;
        const viewport = pdfPage.getViewport({scale: reqScale});
        await pdfPage.render({ canvasContext: actualSizeCanvas.getContext('2d'), viewport: viewport }).promise;
        
        // Build Exact Rulers 
        modalRulerTop.width = cssWidth * DPR; modalRulerTop.height = 30 * DPR;
        modalRulerTop.style.width = `${cssWidth}px`; modalRulerTop.style.height = `30px`;
        const ctxTop = modalRulerTop.getContext('2d');
        ctxTop.scale(DPR, DPR); // Draw using logical CSS pixels
        ctxTop.fillStyle = "var(--text-color)"; ctxTop.font = "10px 'IBM Plex Sans'";
        
        modalRulerLeft.width = 30 * DPR; modalRulerLeft.height = cssHeight * DPR;
        modalRulerLeft.style.width = `30px`; modalRulerLeft.style.height = `${cssHeight}px`;
        const ctxLeft = modalRulerLeft.getContext('2d');
        ctxLeft.scale(DPR, DPR);
        ctxLeft.fillStyle = "var(--text-color)"; ctxLeft.font = "10px 'IBM Plex Sans'";

        // Loops strict to artwork dimensions
        for(let i = 0; i <= wCm; i++) {
            const x = i * PX_PER_CM;
            ctxTop.fillRect(x, 15, 1, 15);
            if(i < wCm) ctxTop.fillRect(x + PX_PER_CM/2, 22, 1, 8); 
            if(i > 0) ctxTop.fillText(i, x + 3, 12);
        }
        for(let i = 0; i <= hCm; i++) {
            const y = i * PX_PER_CM;
            ctxLeft.fillRect(15, y, 15, 1);
            if(i < hCm) ctxLeft.fillRect(22, y + PX_PER_CM/2, 8, 1);
            if(i > 0) ctxLeft.fillText(i, 3, y + 12);
        }
        actualSizeModal.classList.remove('hidden');
    });

    document.getElementById('close-modal').addEventListener('click', () => {
        actualSizeModal.classList.add('hidden');
        isMeasuringMode = isDrawingLine = false;
        interactCtx.clearRect(0,0, interactCanvas.width, interactCanvas.height);
        actualSizeContainer.classList.remove('measuring');
        magnifier.classList.add('hidden');
    });

    // --- INTERACTIVE TOOL ---
    toggleMeasureBtn.addEventListener('click', () => {
        isMeasuringMode = !isMeasuringMode;
        actualSizeContainer.classList.toggle('measuring', isMeasuringMode);
        document.getElementById('measure-hint').classList.toggle('hidden', !isMeasuringMode);
        toggleMeasureBtn.innerText = `Measurement: ${isMeasuringMode ? 'ON' : 'OFF'}`;
        toggleMeasureBtn.style.color = isMeasuringMode ? measureColor.value : "var(--text-color)";
        if(!isMeasuringMode) magnifier.classList.add('hidden');
        isDrawingLine = false;
    });

    resetMeasureBtn.addEventListener('click', () => {
        p1 = null; p2 = null; isDrawingLine = false;
        interactCtx.clearRect(0,0, interactCanvas.width, interactCanvas.height);
    });

    // Dynamic color override mapping
    measureColor.addEventListener('input', (e) => {
        if(isMeasuringMode) toggleMeasureBtn.style.color = e.target.value;
        if(p1 && p2 && !isDrawingLine) renderLine(p1, p2);
    });

    interactCanvas.addEventListener('mouseenter', () => { if(isMeasuringMode) magnifier.classList.remove('hidden'); });
    interactCanvas.addEventListener('mouseleave', () => { magnifier.classList.add('hidden'); });

    interactCanvas.addEventListener('mousedown', (e) => {
        if(!isMeasuringMode) return;
        const coords = getMousePos(e);
        if (!isDrawingLine) { p1 = coords; isDrawingLine = true; } 
        else { p2 = applyShiftConstraint(coords, e.shiftKey); isDrawingLine = false; renderLine(p1, p2); }
        updateMagnifier(e.offsetX, e.offsetY);
    });

    interactCanvas.addEventListener('mousemove', (e) => {
        if(!isMeasuringMode) return;
        if(isDrawingLine) renderLine(p1, applyShiftConstraint(getMousePos(e), e.shiftKey));
        updateMagnifier(e.offsetX, e.offsetY);
    });

    // Because canvas width is DPR locked to CSS width, offsetX/Y is physically flawless
    function getMousePos(e) {
        return { x: e.offsetX * DPR, y: e.offsetY * DPR };
    }

    function applyShiftConstraint(current, shiftPressed) {
        if (!shiftPressed || !p1) return current;
        const dx = current.x - p1.x, dy = current.y - p1.y;
        const snapped = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const dist = Math.hypot(dx, dy);
        return { x: p1.x + Math.cos(snapped) * dist, y: p1.y + Math.sin(snapped) * dist };
    }

    function renderLine(start, end) {
        interactCtx.clearRect(0,0, interactCanvas.width, interactCanvas.height);
        const color = measureColor.value; // Fetch exact state value
        
        interactCtx.strokeStyle = interactCtx.fillStyle = color;
        interactCtx.lineWidth = 2 * DPR;
        
        interactCtx.beginPath(); interactCtx.moveTo(start.x, start.y); interactCtx.lineTo(end.x, end.y); interactCtx.stroke();
        
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const pAngle = angle + Math.PI/2;
        const tickL = 6 * DPR;
        
        interactCtx.beginPath();
        interactCtx.moveTo(start.x - Math.cos(pAngle)*tickL, start.y - Math.sin(pAngle)*tickL);
        interactCtx.lineTo(start.x + Math.cos(pAngle)*tickL, start.y + Math.sin(pAngle)*tickL);
        interactCtx.moveTo(end.x - Math.cos(pAngle)*tickL, end.y - Math.sin(pAngle)*tickL);
        interactCtx.lineTo(end.x + Math.cos(pAngle)*tickL, end.y + Math.sin(pAngle)*tickL);
        interactCtx.stroke();

        const wCm = parseFloat(widthInput.value);
        const distanceMm = Math.hypot(end.x - start.x, end.y - start.y) * ((wCm * 10) / interactCanvas.width);

        const text = distanceMm.toFixed(2) + " mm";
        interactCtx.font = `${600 * DPR} 16px 'IBM Plex Sans'`;
        
        // Tooltip logic
        const tx = end.x + (15 * DPR), ty = end.y + (15 * DPR);
        const pad = 8 * DPR, h = 26 * DPR;
        const txtW = interactCtx.measureText(text).width;
        
        interactCtx.fillStyle = "rgba(0, 0, 0, 0.85)";
        interactCtx.fillRect(tx, ty, txtW + (pad*2), h);
        interactCtx.fillStyle = "#FFFFFF";
        interactCtx.fillText(text, tx + pad, ty + (18 * DPR));
    }

    function updateMagnifier(cssX, cssY) {
        magnifier.style.left = `${cssX}px`;
        magnifier.style.top = `${cssY}px`;
        
        const magSize = 120, zoom = 4.0; 
        magCanvas.width = magSize * DPR; magCanvas.height = magSize * DPR;
        magCanvas.style.width = `${magSize}px`; magCanvas.style.height = `${magSize}px`;
        
        // Source capture relies strictly on DPR internal mapping
        const srcW = (magSize / zoom) * DPR, srcH = (magSize / zoom) * DPR;
        const srcX = (cssX * DPR) - (srcW / 2), srcY = (cssY * DPR) - (srcH / 2);
        
        magCtx.clearRect(0, 0, magCanvas.width, magCanvas.height);
        magCtx.fillStyle = "#ffffff";
        magCtx.fillRect(0, 0, magCanvas.width, magCanvas.height);
        
        // Render artwork and interaction layer into the zoom lens
        magCtx.drawImage(actualSizeCanvas, srcX, srcY, srcW, srcH, 0, 0, magCanvas.width, magCanvas.height);
        magCtx.drawImage(interactCanvas, srcX, srcY, srcW, srcH, 0, 0, magCanvas.width, magCanvas.height);
        
        // Draw crosshair
        magCtx.strokeStyle = measureColor.value;
        magCtx.lineWidth = 1 * DPR;
        magCtx.beginPath();
        magCtx.moveTo(magCanvas.width/2, 0); magCtx.lineTo(magCanvas.width/2, magCanvas.height);
        magCtx.moveTo(0, magCanvas.height/2); magCtx.lineTo(magCanvas.width, magCanvas.height/2);
        magCtx.stroke();
    }

    // --- BACKGROUND ENGINE (Unchanged) ---
    const analyzerWorker = new Worker('worker.js');
    analyzeBtn.addEventListener('click', async () => {
        analyzeBtn.classList.add('hidden');
        resultsPanel.classList.add('hidden');
        loadingState.classList.remove('hidden');
        document.getElementById('progress-fill').style.width = '5%';

        const wCm = parseFloat(widthInput.value);
        const reqScale = ((wCm * CM_TO_INCHES) * TARGET_DPI) / pdfPage.getViewport({scale:1}).width;
        
        const opt = printMedium.options[printMedium.selectedIndex];
        let minStrokeMm = opt.value === 'custom' ? parseFloat(customStrokeInput.value) : parseFloat(opt.getAttribute('data-min-stroke'));
        const minStrokePixels = minStrokeMm * (TARGET_DPI / 25.4);

        const highResCanvas = document.createElement('canvas');
        const viewport = pdfPage.getViewport({ scale: reqScale });
        highResCanvas.width = viewport.width; highResCanvas.height = viewport.height;
        
        await pdfPage.render({ canvasContext: highResCanvas.getContext('2d'), viewport: viewport }).promise;
        const imageData = highResCanvas.getContext('2d').getImageData(0, 0, viewport.width, viewport.height);
        analyzerWorker.postMessage({ imageData, minStrokePixels, targetWidth: viewport.width, targetHeight: viewport.height });
    });

    analyzerWorker.onmessage = function(e) {
        if (e.data.type === 'progress') document.getElementById('progress-fill').style.width = `${e.data.percent}%`;
        if (e.data.type === 'complete') {
            document.getElementById('progress-fill').style.width = '100%';
            setTimeout(() => applyResults(e.data.results), 400); 
        }
    };

    function applyResults(results) {
        loadingState.classList.add('hidden');
        resultsPanel.classList.remove('hidden');
        analyzeBtn.classList.remove('hidden');
        analyzeBtn.innerText = "Re-Analyze Printfile";

        document.getElementById('res-gray').innerText = results.hasGrayscale ? "Failed (Grayscale found)" : "Pass (Pure Black/White)";
        document.getElementById('res-gray').style.color = results.hasGrayscale ? "var(--neon-pink)" : "var(--text-color)";
        document.getElementById('res-stroke').innerText = results.hasThinStrokes ? "Failed (Areas too thin)" : "Pass (Stroke width OK)";
        document.getElementById('res-stroke').style.color = results.hasThinStrokes ? "var(--neon-pink)" : "var(--text-color)";
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = results.width; tempCanvas.height = results.height;
        tempCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(results.overlayBuffer), results.width, results.height), 0, 0);
        
        const overlayCtx = overlayCanvas.getContext('2d');
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        overlayCtx.drawImage(tempCanvas, 0, 0, overlayCanvas.width, overlayCanvas.height);
    }

    document.getElementById('zebra-meter').addEventListener('change', (e) => {
        e.target.checked ? overlayCanvas.classList.remove('hidden') : overlayCanvas.classList.add('hidden');
    });
});

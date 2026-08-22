document.addEventListener('DOMContentLoaded', () => {
    
    // UI Elements
    const dropzone = document.getElementById('dropzone');
    const uploadBtn = document.getElementById('upload-btn');
    const fileInput = document.getElementById('file-input');
    const previewContainer = document.getElementById('preview-container');
    const widthInput = document.getElementById('print-width');
    const heightInput = document.getElementById('print-height');
    const analyzeBtn = document.getElementById('analyze-btn');
    const resetMainBtn = document.getElementById('reset-main-btn');
    const resultsPanel = document.getElementById('results-panel');
    const loadingState = document.getElementById('loading-state');
    
    // Tools
    const printMedium = document.getElementById('print-medium');
    const customStrokeInput = document.getElementById('custom-stroke');
    const customStrokeGroup = document.getElementById('custom-stroke-group');
    
    const toggleMeasureBtn = document.getElementById('toggle-measure');
    const resetMeasureBtn = document.getElementById('reset-measure');
    const measureColor = document.getElementById('measure-color');
    const measureThickness = document.getElementById('measure-thickness');
    const measurementReadout = document.getElementById('measurement-readout');
    
    const btnActualSize = document.getElementById('btn-actual-size');
    const actualSizeModal = document.getElementById('actual-size-modal');
    const btnFitScreen = document.getElementById('btn-fit-screen');
    const toggleMockupBtn = document.getElementById('toggle-mockup');
    const mockupToolbar = document.getElementById('mockup-toolbar');
    
    const mockupScale = document.getElementById('mockup-scale');
    const scaleReadout = document.getElementById('scale-readout');
    const mockupX = document.getElementById('mockup-x');
    const mockupY = document.getElementById('mockup-y');
    
    // Canvases
    const canvas = document.getElementById('pdf-preview');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const overlayCanvas = document.getElementById('error-overlay');
    
    const actualSizeContainer = document.getElementById('actual-size-container');
    const actualSizeCanvas = document.getElementById('actual-size-canvas');
    const actualCtx = actualSizeCanvas.getContext('2d', { willReadFrequently: true });
    
    const interactCanvas = document.getElementById('interaction-layer');
    const interactCtx = interactCanvas.getContext('2d');
    const modalRulerTop = document.getElementById('modal-ruler-top');
    const modalRulerLeft = document.getElementById('modal-ruler-left');
    
    const magnifier = document.getElementById('magnifier');
    const magCanvas = document.getElementById('mag-canvas');
    const magCtx = magCanvas.getContext('2d');
    
    // State Memory
    let pdfDocument = null, pdfPage = null;
    let cachedArtworkCanvas = document.createElement('canvas'); 
    const mockupImg = new Image(); mockupImg.src = 'tshirt_sewingpattern.png';
    
    const TARGET_DPI = 300, CM_TO_INCHES = 0.393701, PX_PER_CM = 37.795275; 
    const DPR = window.devicePixelRatio || 1; 
    const MOCKUP_W = 60, MOCKUP_H = 80; 
    
    let isMeasuringMode = false, isDrawingLine = false, isMockupMode = false, isFitScreen = false;
    let p1 = null, p2 = null;
    let lastClientX = 0, lastClientY = 0;
    let artWidthCm = 0, artHeightCm = 0;

    // --- 0. UI SETTINGS ---
    function updateStrokeInfo() {
        const opt = printMedium.options[printMedium.selectedIndex];
        let min = opt.value === 'custom' ? parseFloat(customStrokeInput.value) : parseFloat(opt.getAttribute('data-min-stroke'));
        opt.value === 'custom' ? customStrokeGroup.classList.remove('hidden') : customStrokeGroup.classList.add('hidden');
        document.getElementById('stroke-info').innerText = `(Min: ${min || 0} mm)`;
    }
    printMedium.addEventListener('change', updateStrokeInfo);
    customStrokeInput.addEventListener('input', updateStrokeInfo);
    updateStrokeInfo();

    // Reset Defaults on Double Click
    document.getElementById('label-thickness').addEventListener('dblclick', () => {
        measureThickness.value = 2; document.getElementById('thickness-readout').innerText = "2.0 pt";
        if(p1 && p2 && !isDrawingLine) renderLine(p1, p2);
    });
    document.getElementById('label-mockup-scale').addEventListener('dblclick', () => {
        mockupScale.value = 100; scaleReadout.innerText = "100%"; renderWorkspace();
    });
    document.getElementById('label-mockup-x').addEventListener('dblclick', () => {
        mockupX.value = Math.max(0, (MOCKUP_W - artWidthCm) / 2).toFixed(1); renderWorkspace();
    });
    document.getElementById('label-mockup-y').addEventListener('dblclick', () => {
        mockupY.value = 10; renderWorkspace();
    });

    // --- 1. UPLOAD LOGIC ---
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => { if(e.target.files.length) handleFile(e.target.files[0]); });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--text-color)'; });
    dropzone.addEventListener('dragleave', () => dropzone.style.borderColor = 'var(--border-color)' );
    dropzone.addEventListener('drop', (e) => { e.preventDefault(); if(e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });

    async function handleFile(file) {
        if(file.type !== 'application/pdf') return alert('PDF required.');
        dropzone.classList.add('hidden');
        previewContainer.classList.remove('hidden');
        resetMainBtn.classList.remove('hidden');
        
        pdfDocument = await pdfjsLib.getDocument(new Uint8Array(await file.arrayBuffer())).promise;
        pdfPage = await pdfDocument.getPage(1); 
        const unscaled = pdfPage.getViewport({ scale: 1.0 });
        
        artWidthCm = (unscaled.width / 72) * 2.54;
        artHeightCm = (unscaled.height / 72) * 2.54;
        widthInput.value = artWidthCm.toFixed(2); heightInput.value = artHeightCm.toFixed(2);
        
        const safeScale = Math.min(1500 / unscaled.width, 2.0); 
        const viewport = pdfPage.getViewport({ scale: safeScale });

        canvas.width = overlayCanvas.width = viewport.width; canvas.height = overlayCanvas.height = viewport.height;
        await pdfPage.render({ canvasContext: ctx, viewport: viewport }).promise;
        
        mockupX.value = Math.max(0, (MOCKUP_W - artWidthCm) / 2).toFixed(1);
        mockupY.value = 10;
        validateForm();
    }

    resetMainBtn.addEventListener('click', () => location.reload());

    [widthInput, heightInput].forEach(el => el.addEventListener('input', () => {
        artWidthCm = parseFloat(widthInput.value) || 0; artHeightCm = parseFloat(heightInput.value) || 0;
        validateForm();
    }));
    function validateForm() { analyzeBtn.disabled = !(pdfDocument && artWidthCm > 0 && artHeightCm > 0); }

    // --- 2. RENDER ENGINE & ZOOM ---
    btnActualSize.addEventListener('click', async () => {
        if(!artWidthCm || !artHeightCm) return;
        const freshPage = await pdfDocument.getPage(1);
        const cssWidth = artWidthCm * PX_PER_CM, cssHeight = artHeightCm * PX_PER_CM;
        
        cachedArtworkCanvas.width = cssWidth * DPR; cachedArtworkCanvas.height = cssHeight * DPR;
        const reqScale = (cssWidth * DPR) / freshPage.getViewport({scale: 1}).width;
        await freshPage.render({ canvasContext: cachedArtworkCanvas.getContext('2d'), viewport: freshPage.getViewport({scale: reqScale}) }).promise;
        
        renderWorkspace();
        actualSizeModal.classList.remove('hidden');
    });

    btnFitScreen.addEventListener('click', () => {
        isFitScreen = !isFitScreen;
        btnFitScreen.innerText = isFitScreen ? "100% Zoom" : "Fit to Screen";
        renderWorkspace();
    });

    window.addEventListener('resize', () => { if(isFitScreen) renderWorkspace(); });

    function renderWorkspace() {
        const targetW_Cm = isMockupMode ? MOCKUP_W : artWidthCm;
        const targetH_Cm = isMockupMode ? MOCKUP_H : artHeightCm;
        
        let viewScale = 1.0;
        if(isFitScreen) {
            const scrollArea = document.querySelector('.modal-scroll-area');
            const availW = scrollArea.clientWidth - 80, availH = scrollArea.clientHeight - 80;
            const fullW = (targetW_Cm * PX_PER_CM) + 30, fullH = (targetH_Cm * PX_PER_CM) + 30;
            viewScale = Math.min(availW / fullW, availH / fullH, 1);
        }
        
        const baseCssW = targetW_Cm * PX_PER_CM, baseCssH = targetH_Cm * PX_PER_CM;
        const scaledCssW = baseCssW * viewScale, scaledCssH = baseCssH * viewScale;
        
        actualSizeCanvas.width = interactCanvas.width = baseCssW * DPR;
        actualSizeCanvas.height = interactCanvas.height = baseCssH * DPR;
        actualSizeContainer.style.width = interactCanvas.style.width = actualSizeCanvas.style.width = `${scaledCssW}px`;
        actualSizeContainer.style.height = interactCanvas.style.height = actualSizeCanvas.style.height = `${scaledCssH}px`; 
        
        actualCtx.clearRect(0, 0, actualSizeCanvas.width, actualSizeCanvas.height);
        
        if (isMockupMode) {
            actualCtx.fillStyle = 'var(--bg-color)';
            actualCtx.fillRect(0, 0, actualSizeCanvas.width, actualSizeCanvas.height);
            if (mockupImg.complete) actualCtx.drawImage(mockupImg, 0, 0, actualSizeCanvas.width, actualSizeCanvas.height);
            
            const scaleFactor = parseFloat(mockupScale.value) / 100;
            const destW = cachedArtworkCanvas.width * scaleFactor;
            const destH = cachedArtworkCanvas.height * scaleFactor;
            
            // X and Y pivot strictly from the center of the artwork map
            const inputX = parseFloat(mockupX.value) * PX_PER_CM * DPR;
            const inputY = parseFloat(mockupY.value) * PX_PER_CM * DPR;
            const destX = inputX - (destW / 2);
            const destY = inputY - (destH / 2);
            
            actualCtx.drawImage(cachedArtworkCanvas, destX, destY, destW, destH);
            actualSizeContainer.style.background = "var(--bg-color)";
        } else {
            actualCtx.drawImage(cachedArtworkCanvas, 0, 0);
            actualSizeContainer.style.background = "var(--white)";
        }

        renderRulers(targetW_Cm, targetH_Cm, baseCssW, baseCssH, scaledCssW, scaledCssH);
        if(p1 && p2 && !isDrawingLine) renderLine(p1, p2);
    }

    function renderRulers(wCm, hCm, baseW, baseH, scaledW, scaledH) {
        modalRulerTop.width = baseW * DPR; modalRulerTop.height = 30 * DPR;
        modalRulerTop.style.width = `${scaledW}px`; modalRulerTop.style.height = `30px`;
        const ctxTop = modalRulerTop.getContext('2d'); ctxTop.scale(DPR, DPR); 
        ctxTop.fillStyle = "var(--text-color)"; ctxTop.font = "10px 'IBM Plex Sans'";
        
        modalRulerLeft.width = 30 * DPR; modalRulerLeft.height = baseH * DPR;
        modalRulerLeft.style.width = `30px`; modalRulerLeft.style.height = `${scaledH}px`;
        const ctxLeft = modalRulerLeft.getContext('2d'); ctxLeft.scale(DPR, DPR);
        ctxLeft.fillStyle = "var(--text-color)"; ctxLeft.font = "10px 'IBM Plex Sans'";

        for(let i=0; i <= Math.ceil(wCm); i++) {
            const x = i * PX_PER_CM;
            ctxTop.fillRect(x, 15, 1, 15);
            if(i < wCm) ctxTop.fillRect(x + PX_PER_CM/2, 22, 1, 8); 
            if(i > 0) ctxTop.fillText(i, x + 3, 12);
        }
        for(let i=0; i <= Math.ceil(hCm); i++) {
            const y = i * PX_PER_CM;
            ctxLeft.fillRect(15, y, 15, 1);
            if(i < hCm) ctxLeft.fillRect(22, y + PX_PER_CM/2, 8, 1);
            if(i > 0) ctxLeft.fillText(i, 3, y + 12);
        }
    }

    // --- 3. MOCKUP INTERACTION ---
    toggleMockupBtn.addEventListener('click', () => {
        isMockupMode = !isMockupMode;
        mockupToolbar.classList.toggle('hidden', !isMockupMode);
        toggleMockupBtn.innerText = `Mockup Mode: ${isMockupMode ? 'ON' : 'OFF'}`;
        toggleMockupBtn.style.color = isMockupMode ? measureColor.value : "var(--text-color)";
        p1 = p2 = null; isDrawingLine = false; measurementReadout.innerText = "0.00 mm";
        interactCtx.clearRect(0,0, interactCanvas.width, interactCanvas.height);
        renderWorkspace();
    });

    [mockupScale, mockupX, mockupY].forEach(el => el.addEventListener('input', () => {
        scaleReadout.innerText = mockupScale.value + "%"; renderWorkspace();
    }));

    // --- 4. MEASUREMENT LOGIC ---
    toggleMeasureBtn.addEventListener('click', () => {
        isMeasuringMode = !isMeasuringMode;
        actualSizeContainer.classList.toggle('measuring', isMeasuringMode);
        document.getElementById('measure-hint').classList.toggle('hidden', !isMeasuringMode);
        toggleMeasureBtn.innerText = `Measure: ${isMeasuringMode ? 'ON' : 'OFF'}`;
        toggleMeasureBtn.style.color = isMeasuringMode ? measureColor.value : "var(--text-color)";
        if(!isMeasuringMode) magnifier.classList.add('hidden');
        isDrawingLine = false;
    });

    resetMeasureBtn.addEventListener('click', () => {
        p1 = p2 = null; isDrawingLine = false;
        interactCtx.clearRect(0,0, interactCanvas.width, interactCanvas.height);
        measurementReadout.innerText = "0.00 mm";
    });

    measureColor.addEventListener('input', (e) => {
        if(isMeasuringMode) toggleMeasureBtn.style.color = e.target.value;
        if(isMockupMode) toggleMockupBtn.style.color = e.target.value;
        measurementReadout.style.color = e.target.value; 
        if(p1 && p2 && !isDrawingLine) renderLine(p1, p2);
    });

    measureThickness.addEventListener('input', () => {
        document.getElementById('thickness-readout').innerText = parseFloat(measureThickness.value).toFixed(1) + " pt";
        if(p1 && p2 && !isDrawingLine) renderLine(p1, p2);
    });

    interactCanvas.addEventListener('mouseenter', () => { if(isMeasuringMode) magnifier.classList.remove('hidden'); });
    interactCanvas.addEventListener('mouseleave', () => { magnifier.classList.add('hidden'); });

    // Mathematical resolution decoupling (Supports Fit-to-screen transforms flawlessly)
    function getMousePos(clientX, clientY) {
        const rect = interactCanvas.getBoundingClientRect();
        const scaleX = interactCanvas.width / rect.width, scaleY = interactCanvas.height / rect.height;
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }

    interactCanvas.addEventListener('mousedown', (e) => {
        if(!isMeasuringMode) return;
        const coords = getMousePos(e.clientX, e.clientY);
        if (!isDrawingLine) { p1 = coords; isDrawingLine = true; } 
        else { p2 = applyShiftConstraint(coords, e.shiftKey); isDrawingLine = false; renderLine(p1, p2); }
        updateMagnifier(e.clientX, e.clientY);
    });

    interactCanvas.addEventListener('mousemove', (e) => {
        if(!isMeasuringMode) return;
        lastClientX = e.clientX; lastClientY = e.clientY;
        if(isDrawingLine) renderLine(p1, applyShiftConstraint(getMousePos(e.clientX, e.clientY), e.shiftKey));
        updateMagnifier(e.clientX, e.clientY);
    });

    function applyShiftConstraint(current, shiftPressed) {
        if (!shiftPressed || !p1) return current;
        const dx = current.x - p1.x, dy = current.y - p1.y;
        const snapped = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const dist = Math.hypot(dx, dy);
        return { x: p1.x + Math.cos(snapped) * dist, y: p1.y + Math.sin(snapped) * dist };
    }

    function renderLine(start, end) {
        interactCtx.clearRect(0,0, interactCanvas.width, interactCanvas.height);
        interactCtx.strokeStyle = interactCtx.fillStyle = measureColor.value;
        interactCtx.lineWidth = parseFloat(measureThickness.value) * DPR;
        
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

        const cssDist = Math.hypot(end.x - start.x, end.y - start.y) / DPR;
        measurementReadout.innerText = ((cssDist / PX_PER_CM) * 10).toFixed(2) + " mm";
    }

    function updateMagnifier(clientX, clientY) {
        const rect = interactCanvas.getBoundingClientRect();
        const cssX = clientX - rect.left, cssY = clientY - rect.top;
        magnifier.style.left = `${cssX}px`; magnifier.style.top = `${cssY}px`;
        
        const magSize = 120, zoom = 4.0; 
        magCanvas.width = magCanvas.height = magSize * DPR;
        magCanvas.style.width = magCanvas.style.height = `${magSize}px`;
        
        const scaleX = interactCanvas.width / rect.width, scaleY = interactCanvas.height / rect.height;
        const intX = cssX * scaleX, intY = cssY * scaleY;
        const srcW = (magSize / zoom) * DPR, srcH = (magSize / zoom) * DPR;
        
        magCtx.fillStyle = "#ffffff"; magCtx.fillRect(0, 0, magCanvas.width, magCanvas.height);
        magCtx.drawImage(actualSizeCanvas, intX - (srcW/2), intY - (srcH/2), srcW, srcH, 0, 0, magCanvas.width, magCanvas.height);
        magCtx.drawImage(interactCanvas, intX - (srcW/2), intY - (srcH/2), srcW, srcH, 0, 0, magCanvas.width, magCanvas.height);
        
        magCtx.strokeStyle = measureColor.value; magCtx.lineWidth = 1 * DPR;
        magCtx.beginPath();
        magCtx.moveTo(magCanvas.width/2, 0); magCtx.lineTo(magCanvas.width/2, magCanvas.height);
        magCtx.moveTo(0, magCanvas.height/2); magCtx.lineTo(magCanvas.width, magCanvas.height/2);
        magCtx.stroke();
    }
    
    document.getElementById('close-modal').addEventListener('click', () => {
        actualSizeModal.classList.add('hidden');
        isMeasuringMode = isDrawingLine = false; p1 = p2 = null; measurementReadout.innerText = "0.00 mm";
        interactCtx.clearRect(0,0, interactCanvas.width, interactCanvas.height);
        actualSizeContainer.classList.remove('measuring'); magnifier.classList.add('hidden');
        toggleMeasureBtn.innerText = "Measure: OFF"; toggleMeasureBtn.style.color = "var(--text-color)";
    });

    // --- 5. WORKER ENGINE LOGIC ---
    const analyzerWorker = new Worker('worker.js');
    analyzeBtn.addEventListener('click', async () => {
        analyzeBtn.classList.add('hidden'); resultsPanel.classList.add('hidden'); loadingState.classList.remove('hidden');
        document.getElementById('progress-fill').style.width = '5%';

        const freshPage = await pdfDocument.getPage(1);
        const reqScale = ((artWidthCm * CM_TO_INCHES) * TARGET_DPI) / freshPage.getViewport({scale:1}).width;
        
        const opt = printMedium.options[printMedium.selectedIndex];
        let minStrokeMm = opt.value === 'custom' ? parseFloat(customStrokeInput.value) : parseFloat(opt.getAttribute('data-min-stroke'));
        
        const highResCanvas = document.createElement('canvas'); const viewport = freshPage.getViewport({ scale: reqScale });
        highResCanvas.width = viewport.width; highResCanvas.height = viewport.height;
        await freshPage.render({ canvasContext: highResCanvas.getContext('2d'), viewport: viewport }).promise;
        
        analyzerWorker.postMessage({ imageData: highResCanvas.getContext('2d').getImageData(0, 0, viewport.width, viewport.height), minStrokePixels: minStrokeMm * (TARGET_DPI / 25.4), targetWidth: viewport.width, targetHeight: viewport.height });
    });

    analyzerWorker.onmessage = function(e) {
        if (e.data.type === 'progress') document.getElementById('progress-fill').style.width = `${e.data.percent}%`;
        if (e.data.type === 'complete') { document.getElementById('progress-fill').style.width = '100%'; setTimeout(() => applyResults(e.data.results), 400); }
    };

    function applyResults(results) {
        loadingState.classList.add('hidden'); resultsPanel.classList.remove('hidden');
        analyzeBtn.classList.remove('hidden'); analyzeBtn.innerText = "Re-Analyze Printfile";

        document.getElementById('res-gray').innerText = results.hasGrayscale ? "Failed (Grayscale found)" : "Pass (Pure Black/White)";
        document.getElementById('res-gray').style.color = results.hasGrayscale ? "var(--neon-pink)" : "var(--text-color)";
        document.getElementById('res-stroke').innerText = results.hasThinStrokes ? "Failed (Areas too thin)" : "Pass (Stroke width OK)";
        document.getElementById('res-stroke').style.color = results.hasThinStrokes ? "var(--neon-pink)" : "var(--text-color)";
        
        const tempCanvas = document.createElement('canvas'); tempCanvas.width = results.width; tempCanvas.height = results.height;
        tempCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(results.overlayBuffer), results.width, results.height), 0, 0);
        overlayCanvas.getContext('2d').clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        overlayCanvas.getContext('2d').drawImage(tempCanvas, 0, 0, overlayCanvas.width, overlayCanvas.height);
    }

    document.getElementById('zebra-meter').addEventListener('change', (e) => { e.target.checked ? overlayCanvas.classList.remove('hidden') : overlayCanvas.classList.add('hidden'); });
});

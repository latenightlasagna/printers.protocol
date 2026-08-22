document.addEventListener('DOMContentLoaded', () => {
    
    // Core Elements
    const dropzone = document.getElementById('dropzone');
    const uploadBtn = document.getElementById('upload-btn');
    const fileInput = document.getElementById('file-input');
    const previewContainer = document.getElementById('preview-container');
    const widthInput = document.getElementById('print-width');
    const heightInput = document.getElementById('print-height');
    const analyzeBtn = document.getElementById('analyze-btn');
    const loadingState = document.getElementById('loading-state');
    const progressFill = document.getElementById('progress-fill');
    const resultsPanel = document.getElementById('results-panel');
    const printMedium = document.getElementById('print-medium');
    
    // Tools UI
    const rulerCanvas = document.getElementById('ruler-canvas');
    const rulerCtx = rulerCanvas.getContext('2d');
    const toggleRulerBtn = document.getElementById('toggle-ruler');
    const toggleMeasureBtn = document.getElementById('toggle-measure');
    const measureHint = document.getElementById('measure-hint');
    const btnActualSize = document.getElementById('btn-actual-size');
    const actualSizeModal = document.getElementById('actual-size-modal');
    
    // Canvases
    const canvasWrapper = document.getElementById('canvas-wrapper');
    const canvas = document.getElementById('pdf-preview');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const overlayCanvas = document.getElementById('error-overlay');
    const interactCanvas = document.getElementById('interaction-layer');
    const interactCtx = interactCanvas.getContext('2d');
    const actualSizeCanvas = document.getElementById('actual-size-canvas');
    
    let pdfDocument = null; let pdfPage = null;
    const TARGET_DPI = 300; const CM_TO_INCHES = 0.393701;
    
    // Adobe-Style Measurement State
    let isMeasuringMode = false;
    let isDrawingLine = false;
    let p1 = null; 
    let p2 = null;

    // --- 1. UPLOAD ---
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => { if(e.target.files.length) handleFile(e.target.files[0]); });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--text-color)'; });
    dropzone.addEventListener('dragleave', () => dropzone.style.borderColor = 'var(--border-color)' );
    dropzone.addEventListener('drop', (e) => { e.preventDefault(); if(e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });

    function handleFile(file) {
        if(file.type !== 'application/pdf') { alert('PDF required.'); return; }
        dropzone.classList.add('hidden');
        previewContainer.classList.remove('hidden');
        loadPDF(file);
    }

    async function loadPDF(file) {
        const arrayBuffer = await file.arrayBuffer();
        pdfDocument = await pdfjsLib.getDocument(new Uint8Array(arrayBuffer)).promise;
        pdfPage = await pdfDocument.getPage(1); 
        
        const unscaled = pdfPage.getViewport({ scale: 1.0 });
        const safeScale = Math.min(1500 / unscaled.width, 2.0); 
        const viewport = pdfPage.getViewport({ scale: safeScale });

        canvas.width = overlayCanvas.width = interactCanvas.width = viewport.width;
        canvas.height = overlayCanvas.height = interactCanvas.height = viewport.height;

        await pdfPage.render({ canvasContext: ctx, viewport: viewport }).promise;
        drawRuler();
        validateForm();
    }

    // --- 2. RULER RENDERING ---
    function drawRuler() {
        const hCm = parseFloat(heightInput.value);
        if(!hCm || hCm <= 0) return;
        
        const rect = canvas.getBoundingClientRect();
        rulerCanvas.height = rect.height;
        rulerCanvas.width = 40;
        rulerCtx.clearRect(0,0, rulerCanvas.width, rulerCanvas.height);
        
        const pixelsPerCm = rect.height / hCm;
        rulerCtx.fillStyle = "var(--text-color)";
        rulerCtx.font = "10px 'IBM Plex Sans'";
        rulerCtx.textAlign = "right";

        for(let i = 0; i <= hCm; i++) {
            const y = i * pixelsPerCm;
            // Draw main CM line
            rulerCtx.fillRect(20, y, 20, 1);
            if(i > 0) rulerCtx.fillText(i, 16, y + 4); // Draw Number
            
            // Draw half CM line
            if (i < hCm) rulerCtx.fillRect(30, y + (pixelsPerCm/2), 10, 1);
        }
    }
    window.addEventListener('resize', drawRuler);
    widthInput.addEventListener('input', () => { validateForm(); drawRuler(); });
    heightInput.addEventListener('input', () => { validateForm(); drawRuler(); });
    
    toggleRulerBtn.addEventListener('click', () => {
        rulerCanvas.classList.toggle('hidden');
        drawRuler();
    });

    // --- 3. ADOBE-STYLE MEASUREMENT TOOL ---
    toggleMeasureBtn.addEventListener('click', () => {
        isMeasuringMode = !isMeasuringMode;
        if(isMeasuringMode) {
            toggleMeasureBtn.innerText = "Measurement Tool: ON";
            toggleMeasureBtn.style.color = "var(--blue)";
            canvasWrapper.classList.add('measuring');
            measureHint.classList.remove('hidden');
        } else {
            toggleMeasureBtn.innerText = "Measurement Tool: OFF";
            toggleMeasureBtn.style.color = "var(--text-color)";
            canvasWrapper.classList.remove('measuring');
            measureHint.classList.add('hidden');
            isDrawingLine = false;
            interactCtx.clearRect(0,0, interactCanvas.width, interactCanvas.height);
        }
    });

    interactCanvas.addEventListener('mousedown', (e) => {
        if(!isMeasuringMode) return;
        const coords = getMousePos(e);
        
        if (!isDrawingLine) {
            // First Click: Start drawing
            p1 = coords;
            isDrawingLine = true;
        } else {
            // Second Click: Finish drawing
            p2 = applyShiftConstraint(coords, e.shiftKey);
            isDrawingLine = false;
            renderMeasurementLine(p1, p2, true); // True = draw final anchor
        }
    });

    interactCanvas.addEventListener('mousemove', (e) => {
        if(!isMeasuringMode || !isDrawingLine) return;
        const currentPos = applyShiftConstraint(getMousePos(e), e.shiftKey);
        renderMeasurementLine(p1, currentPos, false);
    });

    function getMousePos(e) {
        const rect = interactCanvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (interactCanvas.width / rect.width),
            y: (e.clientY - rect.top) * (interactCanvas.height / rect.height)
        };
    }

    function applyShiftConstraint(current, shiftPressed) {
        if (!shiftPressed || !p1) return current;
        const dx = current.x - p1.x;
        const dy = current.y - p1.y;
        const angle = Math.atan2(dy, dx);
        const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        const dist = Math.hypot(dx, dy);
        return {
            x: p1.x + Math.cos(snappedAngle) * dist,
            y: p1.y + Math.sin(snappedAngle) * dist
        };
    }

    function renderMeasurementLine(start, end, isFinal) {
        interactCtx.clearRect(0,0, interactCanvas.width, interactCanvas.height);
        
        // Draw Line
        interactCtx.strokeStyle = "var(--blue)";
        interactCtx.lineWidth = 2;
        interactCtx.beginPath();
        interactCtx.moveTo(start.x, start.y);
        interactCtx.lineTo(end.x, end.y);
        interactCtx.stroke();
        
        // Draw Anchors
        interactCtx.fillStyle = "var(--blue)";
        interactCtx.beginPath(); interactCtx.arc(start.x, start.y, 4, 0, Math.PI*2); interactCtx.fill();
        if (isFinal) {
            interactCtx.beginPath(); interactCtx.arc(end.x, end.y, 4, 0, Math.PI*2); interactCtx.fill();
        }

        // Calculate physical distance
        const wCm = parseFloat(widthInput.value);
        const pixelsDistance = Math.hypot(end.x - start.x, end.y - start.y);
        const mmPerPixel = (wCm * 10) / interactCanvas.width;
        const distanceMm = pixelsDistance * mmPerPixel;

        // Adobe Style Tooltip (Dark Box, White Text)
        const text = distanceMm.toFixed(2) + " mm";
        interactCtx.font = "600 14px 'IBM Plex Sans'";
        const textWidth = interactCtx.measureText(text).width;
        
        // Offset tooltip from cursor
        const tooltipX = end.x + 15;
        const tooltipY = end.y + 15;

        interactCtx.fillStyle = "rgba(0, 0, 0, 0.85)";
        interactCtx.fillRect(tooltipX, tooltipY, textWidth + 16, 26);
        
        interactCtx.fillStyle = "#FFFFFF";
        interactCtx.fillText(text, tooltipX + 8, tooltipY + 18);
    }

    // --- 4. ACTUAL SIZE MODAL ---
    btnActualSize.addEventListener('click', () => {
        const wCm = parseFloat(widthInput.value);
        if(!wCm) return;
        // Map 1cm to physical screen pixels (Assuming 96dpi display average = ~37.8px per cm)
        const cssWidth = wCm * 37.795; 
        
        actualSizeCanvas.width = canvas.width;
        actualSizeCanvas.height = canvas.height;
        actualSizeCanvas.getContext('2d').drawImage(canvas, 0, 0);
        
        actualSizeCanvas.style.width = `${cssWidth}px`;
        actualSizeCanvas.style.height = 'auto'; 
        actualSizeModal.classList.remove('hidden');
    });

    document.getElementById('close-modal').addEventListener('click', () => actualSizeModal.classList.add('hidden'));

    // --- 5. WORKER ENGINE EXECUTION ---
    function validateForm() {
        analyzeBtn.disabled = !(pdfDocument && parseFloat(widthInput.value) > 0 && parseFloat(heightInput.value) > 0);
    }

    const analyzerWorker = new Worker('worker.js');

    analyzeBtn.addEventListener('click', async () => {
        analyzeBtn.classList.add('hidden');
        resultsPanel.classList.add('hidden');
        loadingState.classList.remove('hidden');
        progressFill.style.width = '5%';
        document.getElementById('loading-text').innerText = "Morphological Opening Pipeline...";

        const wCm = parseFloat(widthInput.value);
        const hCm = parseFloat(heightInput.value);
        const reqScale = ((wCm * CM_TO_INCHES) * TARGET_DPI) / pdfPage.getViewport({scale:1}).width;
        
        let minStrokeMm = printMedium.value === 'poster' ? 0.25 : 0.4;
        if (printMedium.value === 'custom') minStrokeMm = parseFloat(document.getElementById('custom-stroke').value);
        const minStrokePixels = minStrokeMm * (TARGET_DPI / 25.4);

        const highResCanvas = document.createElement('canvas');
        const viewport = pdfPage.getViewport({ scale: reqScale });
        highResCanvas.width = viewport.width; highResCanvas.height = viewport.height;
        
        await pdfPage.render({ canvasContext: highResCanvas.getContext('2d'), viewport: viewport }).promise;
        const imageData = highResCanvas.getContext('2d').getImageData(0, 0, viewport.width, viewport.height);
        
        analyzerWorker.postMessage({ imageData, minStrokePixels, targetWidth: viewport.width, targetHeight: viewport.height });
    });

    analyzerWorker.onmessage = function(e) {
        if (e.data.type === 'progress') progressFill.style.width = `${e.data.percent}%`;
        if (e.data.type === 'complete') {
            progressFill.style.width = '100%';
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
        if(e.target.checked) overlayCanvas.classList.remove('hidden');
        else overlayCanvas.classList.add('hidden');
    });
});

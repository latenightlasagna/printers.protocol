document.addEventListener('DOMContentLoaded', () => {
    
    // Core UI Elements
    const dropzone = document.getElementById('dropzone');
    const uploadBtn = document.getElementById('upload-btn');
    const fileInput = document.getElementById('file-input');
    const previewContainer = document.getElementById('preview-container');
    const printMedium = document.getElementById('print-medium');
    const customStrokeGroup = document.getElementById('custom-stroke-group');
    const widthInput = document.getElementById('print-width');
    const heightInput = document.getElementById('print-height');
    const analyzeBtn = document.getElementById('analyze-btn');
    const loadingState = document.getElementById('loading-state');
    const progressFill = document.getElementById('progress-fill');
    const resultsPanel = document.getElementById('results-panel');
    const zebraMeter = document.getElementById('zebra-meter');
    
    // Tools UI
    const rulerLeft = document.getElementById('ruler-left');
    const toggleRulerBtn = document.getElementById('toggle-ruler');
    const toggleMeasureBtn = document.getElementById('toggle-measure');
    const btnActualSize = document.getElementById('btn-actual-size');
    const actualSizeModal = document.getElementById('actual-size-modal');
    const closeModal = document.getElementById('close-modal');
    
    // Canvases
    const canvasWrapper = document.getElementById('canvas-wrapper');
    const canvas = document.getElementById('pdf-preview');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const overlayCanvas = document.getElementById('error-overlay');
    const overlayCtx = overlayCanvas.getContext('2d');
    const interactCanvas = document.getElementById('interaction-layer');
    const interactCtx = interactCanvas.getContext('2d');
    const actualSizeCanvas = document.getElementById('actual-size-canvas');
    
    // State
    let pdfDocument = null;
    let pdfPage = null;
    const TARGET_DPI = 300; 
    const CM_TO_INCHES = 0.393701;
    
    // Interaction State
    let isMeasuring = false;
    let measurePoints = [];

    // --- 1. UPLOAD & INGESTION ---
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => { if(e.target.files.length > 0) handleFile(e.target.files[0]); });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--text-color)'; });
    dropzone.addEventListener('dragleave', () => dropzone.style.borderColor = 'var(--border-color)' );
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        if(e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });

    function handleFile(file) {
        if(file.type !== 'application/pdf') { alert('PDF required.'); return; }
        dropzone.classList.add('hidden');
        previewContainer.classList.remove('hidden');
        loadPDF(file);
    }

    async function loadPDF(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            pdfDocument = await pdfjsLib.getDocument(new Uint8Array(arrayBuffer)).promise;
            pdfPage = await pdfDocument.getPage(1); 
            renderVisualPreview();
        } catch (error) {
            console.error(error); alert("Failed to read PDF file.");
        }
    }

    function renderVisualPreview() {
        const unscaledViewport = pdfPage.getViewport({ scale: 1.0 });
        const safeScale = Math.min(1500 / unscaledViewport.width, 2.0); 
        const viewport = pdfPage.getViewport({ scale: safeScale });

        canvas.width = viewport.width; canvas.height = viewport.height;
        overlayCanvas.width = canvas.width; overlayCanvas.height = canvas.height;
        interactCanvas.width = canvas.width; interactCanvas.height = canvas.height;
        
        zebraMeter.checked = false;
        overlayCanvas.classList.add('hidden');
        measurePoints = [];
        interactCtx.clearRect(0,0, interactCanvas.width, interactCanvas.height);

        pdfPage.render({ canvasContext: ctx, viewport: viewport }).promise.then(() => {
            updateTools();
            validateForm();
        });
    }

    // --- 2. FORMS & TOOLS SETUP ---

    printMedium.addEventListener('change', (e) => {
        if(e.target.value === 'custom') customStrokeGroup.classList.remove('hidden');
        else customStrokeGroup.classList.add('hidden');
        validateForm();
    });

    widthInput.addEventListener('input', () => { validateForm(); updateTools(); });
    heightInput.addEventListener('input', () => { validateForm(); updateTools(); });

    function validateForm() {
        analyzeBtn.disabled = !(pdfDocument && parseFloat(widthInput.value) > 0 && parseFloat(heightInput.value) > 0);
    }

    function updateTools() {
        const hCm = parseFloat(heightInput.value);
        if(!hCm || hCm <= 0) return;

        // Set Ruler scaling
        const rect = canvas.getBoundingClientRect();
        // Since canvas CSS height adjusts automatically, we set ruler height to match it
        rulerLeft.style.height = `${rect.height}px`;
        const pixelsPerCm = rect.height / hCm;
        
        // Use CSS repeating gradient to draw perfect CM ticks
        rulerLeft.style.backgroundImage = `repeating-linear-gradient(to bottom, transparent, transparent calc(${pixelsPerCm}px - 1px), var(--text-color) calc(${pixelsPerCm}px - 1px), var(--text-color) ${pixelsPerCm}px)`;
    }
    
    // Update ruler on window resize
    window.addEventListener('resize', updateTools);

    // --- 3. PHYSICS & MATH ---

    function calculatePrintPhysics() {
        const physicalWidthCm = parseFloat(widthInput.value);
        const physicalHeightCm = parseFloat(heightInput.value);
        
        const targetPixelsWidth = (physicalWidthCm * CM_TO_INCHES) * TARGET_DPI;
        const unscaledViewport = pdfPage.getViewport({ scale: 1.0 });
        const requiredPdfScale = targetPixelsWidth / unscaledViewport.width;

        let minStrokeMm = 0.4; 
        if (printMedium.value === 'poster') minStrokeMm = 0.25;
        if (printMedium.value === 'custom') minStrokeMm = parseFloat(document.getElementById('custom-stroke').value);

        const pixelsPerMm = TARGET_DPI / 25.4;
        const minimumStrokePixels = minStrokeMm * pixelsPerMm;

        let maxDimensions = {w: 30, h: 42};
        if(printMedium.value === 'textile-oversize') maxDimensions = {w: 35, h: 45};
        if(printMedium.value === 'tote-bag') maxDimensions = {w: 27, h: 30};
        if(printMedium.value === 'poster') maxDimensions = {w: 70, h: 100};
        
        const sizeValid = (physicalWidthCm <= maxDimensions.w && physicalHeightCm <= maxDimensions.h) || 
                          (physicalWidthCm <= maxDimensions.h && physicalHeightCm <= maxDimensions.w) ||
                          printMedium.value === 'custom';

        return { requiredPdfScale, minimumStrokePixels, sizeValid, physicalWidthCm };
    }

    // --- 4. ENGINE ROOM (WEB WORKER) ---
    
    const analyzerWorker = new Worker('worker.js');

    analyzeBtn.addEventListener('click', async () => {
        analyzeBtn.classList.add('hidden');
        resultsPanel.classList.add('hidden');
        loadingState.classList.remove('hidden');
        progressFill.style.width = '5%';
        document.getElementById('loading-text').innerText = "Generating 300 DPI pre-flight canvas...";

        const physics = calculatePrintPhysics();
        
        const highResCanvas = document.createElement('canvas');
        const highResCtx = highResCanvas.getContext('2d');
        const viewport = pdfPage.getViewport({ scale: physics.requiredPdfScale });
        highResCanvas.width = viewport.width; highResCanvas.height = viewport.height;
        
        await pdfPage.render({ canvasContext: highResCtx, viewport: viewport }).promise;
        
        document.getElementById('loading-text').innerText = "Distance transform (Morphological Opening)...";
        progressFill.style.width = '20%';

        const imageData = highResCtx.getImageData(0, 0, highResCanvas.width, highResCanvas.height);
        
        analyzerWorker.postMessage({
            imageData: imageData,
            minStrokePixels: physics.minimumStrokePixels,
            targetWidth: highResCanvas.width,
            targetHeight: highResCanvas.height,
            sizeValid: physics.sizeValid
        });
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

        document.getElementById('res-size').innerText = results.sizeValid ? "Pass" : "Failed (Exceeds medium limits)";
        document.getElementById('res-size').style.color = results.sizeValid ? "var(--text-color)" : "var(--neon-pink)";

        document.getElementById('res-gray').innerText = results.hasGrayscale ? "Failed (Grayscale cores found)" : "Pass (Pure Black/White)";
        document.getElementById('res-gray').style.color = results.hasGrayscale ? "var(--neon-pink)" : "var(--text-color)";

        document.getElementById('res-stroke').innerText = results.hasThinStrokes ? "Failed (Areas too thin)" : "Pass (Stroke width OK)";
        document.getElementById('res-stroke').style.color = results.hasThinStrokes ? "var(--neon-pink)" : "var(--text-color)";
        
        const imgData = new ImageData(new Uint8ClampedArray(results.overlayBuffer), results.width, results.height);
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = results.width; tempCanvas.height = results.height;
        tempCanvas.getContext('2d').putImageData(imgData, 0, 0);
        
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        overlayCtx.drawImage(tempCanvas, 0, 0, overlayCanvas.width, overlayCanvas.height);
    }

    zebraMeter.addEventListener('change', (e) => {
        if(e.target.checked) overlayCanvas.classList.remove('hidden');
        else overlayCanvas.classList.add('hidden');
    });

    // --- 5. INTERACTIVE MEASUREMENT TOOL ---
    
    toggleMeasureBtn.addEventListener('click', () => {
        isMeasuring = !isMeasuring;
        if(isMeasuring) {
            toggleMeasureBtn.innerText = "Measurement Tool: ON";
            canvasWrapper.classList.add('measuring');
            toggleMeasureBtn.style.color = "var(--blue)";
        } else {
            toggleMeasureBtn.innerText = "Measurement Tool: OFF";
            canvasWrapper.classList.remove('measuring');
            toggleMeasureBtn.style.color = "var(--text-color)";
            measurePoints = [];
            interactCtx.clearRect(0, 0, interactCanvas.width, interactCanvas.height);
        }
    });

    interactCanvas.addEventListener('mousedown', (e) => {
        if(!isMeasuring) return;
        const rect = interactCanvas.getBoundingClientRect();
        
        // Map mouse click to internal canvas resolution
        const scaleX = interactCanvas.width / rect.width;
        const scaleY = interactCanvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        if (measurePoints.length === 2) {
            measurePoints = []; // reset on 3rd click
            interactCtx.clearRect(0, 0, interactCanvas.width, interactCanvas.height);
        }
        
        measurePoints.push({x, y});
        drawMeasurement();
    });

    interactCanvas.addEventListener('mousemove', (e) => {
        if(!isMeasuring || measurePoints.length !== 1) return;
        const rect = interactCanvas.getBoundingClientRect();
        const scaleX = interactCanvas.width / rect.width;
        const scaleY = interactCanvas.height / rect.height;
        const currentX = (e.clientX - rect.left) * scaleX;
        const currentY = (e.clientY - rect.top) * scaleY;
        
        drawMeasurement(currentX, currentY);
    });

    function drawMeasurement(curX = null, curY = null) {
        interactCtx.clearRect(0, 0, interactCanvas.width, interactCanvas.height);
        if (measurePoints.length === 0) return;

        interactCtx.strokeStyle = "#0000FF";
        interactCtx.fillStyle = "#0000FF";
        interactCtx.lineWidth = 2;
        interactCtx.font = "600 16px 'IBM Plex Sans'";

        const p1 = measurePoints[0];
        const p2 = measurePoints.length === 2 ? measurePoints[1] : {x: curX, y: curY};

        // Draw Line
        interactCtx.beginPath();
        interactCtx.moveTo(p1.x, p1.y);
        interactCtx.lineTo(p2.x, p2.y);
        interactCtx.stroke();
        
        // Draw Points
        interactCtx.beginPath(); interactCtx.arc(p1.x, p1.y, 4, 0, Math.PI*2); interactCtx.fill();
        interactCtx.beginPath(); interactCtx.arc(p2.x, p2.y, 4, 0, Math.PI*2); interactCtx.fill();

        // Calculate and Draw Distance
        const wCm = parseFloat(widthInput.value);
        if(!wCm) return;
        
        const pixelsDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const mmPerPixel = (wCm * 10) / interactCanvas.width;
        const distanceMm = pixelsDistance * mmPerPixel;

        const textX = (p1.x + p2.x) / 2 + 10;
        const textY = (p1.y + p2.y) / 2 - 10;
        
        // Text background for readability
        const text = distanceMm.toFixed(2) + " mm";
        const tW = interactCtx.measureText(text).width;
        interactCtx.fillStyle = "rgba(255,255,255,0.8)";
        interactCtx.fillRect(textX - 2, textY - 16, tW + 4, 20);
        
        interactCtx.fillStyle = "#0000FF";
        interactCtx.fillText(text, textX, textY);
    }

    // --- 6. RULER & ACTUAL SIZE MODAL ---
    
    toggleRulerBtn.addEventListener('click', () => {
        rulerLeft.classList.toggle('hidden');
        updateTools();
    });

    btnActualSize.addEventListener('click', () => {
        const wCm = parseFloat(widthInput.value);
        if(!wCm) return;
        
        // 1cm ≈ 37.795 CSS pixels (assuming standard 96dpi display scaling)
        const cssWidth = wCm * 37.795;
        
        actualSizeCanvas.width = canvas.width;
        actualSizeCanvas.height = canvas.height;
        actualSizeCanvas.getContext('2d').drawImage(canvas, 0, 0);
        
        actualSizeCanvas.style.width = `${cssWidth}px`;
        actualSizeCanvas.style.height = 'auto'; // Maintain aspect ratio
        
        actualSizeModal.classList.remove('hidden');
    });

    closeModal.addEventListener('click', () => actualSizeModal.classList.add('hidden'));
});

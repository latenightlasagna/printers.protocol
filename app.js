document.addEventListener('DOMContentLoaded', () => {
    
    // UI Elements
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
    
    // Canvas Elements
    const canvas = document.getElementById('pdf-preview');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const overlayCanvas = document.getElementById('error-overlay');
    const overlayCtx = overlayCanvas.getContext('2d');
    
    // Application State
    let pdfDocument = null;
    let pdfPage = null;
    const TARGET_DPI = 300; 
    const CM_TO_INCHES = 0.393701;

    // --- 1. FILE UPLOAD & INGESTION ---
    
    uploadBtn.addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', (e) => {
        if(e.target.files.length > 0) handleFile(e.target.files[0]);
    });

    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = 'var(--text-color)'; });
    dropzone.addEventListener('dragleave', () => dropzone.style.borderColor = 'var(--border-color)' );
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.style.borderColor = 'var(--border-color)';
        if(e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });

    function handleFile(file) {
        if(file.type !== 'application/pdf') {
            alert('Format rejected. Please upload a PDF file.');
            return;
        }
        dropzone.classList.add('hidden');
        previewContainer.classList.remove('hidden');
        loadPDF(file);
    }

    // --- 2. PDF.js RENDERING ---

    async function loadPDF(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            pdfDocument = await pdfjsLib.getDocument(new Uint8Array(arrayBuffer)).promise;
            pdfPage = await pdfDocument.getPage(1); 
            renderVisualPreview();
        } catch (error) {
            console.error(error);
            alert("Failed to read PDF file.");
        }
    }

    function renderVisualPreview() {
        const unscaledViewport = pdfPage.getViewport({ scale: 1.0 });
        const safeScale = Math.min(1500 / unscaledViewport.width, 2.0); 
        const viewport = pdfPage.getViewport({ scale: safeScale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        // Reset overlay state when new file is loaded
        zebraMeter.checked = false;
        overlayCanvas.classList.add('hidden');

        pdfPage.render({ canvasContext: ctx, viewport: viewport }).promise.then(() => validateForm());
    }

    // --- 3. SCALING MATH ---

    printMedium.addEventListener('change', (e) => {
        if(e.target.value === 'custom') customStrokeGroup.classList.remove('hidden');
        else customStrokeGroup.classList.add('hidden');
        validateForm();
    });

    widthInput.addEventListener('input', validateForm);
    heightInput.addEventListener('input', validateForm);

    function validateForm() {
        if(pdfDocument && widthInput.value > 0 && heightInput.value > 0) analyzeBtn.disabled = false;
        else analyzeBtn.disabled = true;
    }

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

        // Size check against selected medium limit
        let maxDimensions = {w: 30, h: 42};
        if(printMedium.value === 'textile-oversize') maxDimensions = {w: 35, h: 45};
        if(printMedium.value === 'tote-bag') maxDimensions = {w: 27, h: 30};
        if(printMedium.value === 'poster') maxDimensions = {w: 70, h: 100};
        
        const sizeValid = (physicalWidthCm <= maxDimensions.w && physicalHeightCm <= maxDimensions.h) || 
                          (physicalWidthCm <= maxDimensions.h && physicalHeightCm <= maxDimensions.w) ||
                          printMedium.value === 'custom';

        return { requiredPdfScale, minimumStrokePixels, sizeValid };
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
        
        // Render High Res off-screen
        const highResCanvas = document.createElement('canvas');
        const highResCtx = highResCanvas.getContext('2d');
        const viewport = pdfPage.getViewport({ scale: physics.requiredPdfScale });
        highResCanvas.width = viewport.width;
        highResCanvas.height = viewport.height;
        
        await pdfPage.render({ canvasContext: highResCtx, viewport: viewport }).promise;
        
        document.getElementById('loading-text').innerText = "Distance transform (Checking strokes)...";
        progressFill.style.width = '20%';

        const imageData = highResCtx.getImageData(0, 0, highResCanvas.width, highResCanvas.height);
        
        // Pass data to worker
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

        // Update UI Text
        document.getElementById('res-size').innerText = results.sizeValid ? "Pass" : "Failed (Exceeds medium limits)";
        document.getElementById('res-size').style.color = results.sizeValid ? "var(--text-color)" : "var(--neon-pink)";

        document.getElementById('res-gray').innerText = results.hasGrayscale ? "Failed (Grayscale found)" : "Pass (Pure Black/White)";
        document.getElementById('res-gray').style.color = results.hasGrayscale ? "var(--neon-pink)" : "var(--text-color)";

        document.getElementById('res-stroke').innerText = results.hasThinStrokes ? "Failed (Areas too thin)" : "Pass (Stroke width OK)";
        document.getElementById('res-stroke').style.color = results.hasThinStrokes ? "var(--neon-pink)" : "var(--text-color)";
        
        // Scale and Draw Neon Overlay onto the display canvas layer
        overlayCanvas.width = canvas.width;
        overlayCanvas.height = canvas.height;
        
        const imgData = new ImageData(new Uint8ClampedArray(results.overlayBuffer), results.width, results.height);
        
        // Draw the 300dpi buffer to a temporary canvas so we can use drawImage to perfectly scale it to the preview container
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = results.width;
        tempCanvas.height = results.height;
        tempCanvas.getContext('2d').putImageData(imgData, 0, 0);
        
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        overlayCtx.drawImage(tempCanvas, 0, 0, overlayCanvas.width, overlayCanvas.height);
    }

    // Toggle Overlay Visibility
    zebraMeter.addEventListener('change', (e) => {
        if(e.target.checked) overlayCanvas.classList.remove('hidden');
        else overlayCanvas.classList.add('hidden');
    });
});

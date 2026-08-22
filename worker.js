// worker.js - True Morphological Opening Engine

self.onmessage = function(e) {
    const { imageData, minStrokePixels, targetWidth, targetHeight } = e.data;
    const data = imageData.data;
    const w = targetWidth;
    const h = targetHeight;
    
    let hasGrayscale = false;
    let hasThinStrokes = false;
    
    const overlayData = new Uint8ClampedArray(data.length);
    const grid = new Float32Array(w * h); 
    
    // STEP 1: Thresholding
    for (let i = 0; i < data.length; i += 4) {
        if (data[i+3] < 128) continue; 
        const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
        if (brightness < 200) grid[(i / 4)] = 1; 
    }
    
    // Safety Padding
    for(let x=0; x<w; x++) { grid[x] = 0; grid[(h-1)*w + x] = 0; }
    for(let y=0; y<h; y++) { grid[y*w] = 0; grid[y*w + w - 1] = 0; }
    
    self.postMessage({ type: 'progress', percent: 15 });

    // STEP 2: Pass 1 Distance Transform (Erosion)
    const DT1 = new Float32Array(w * h);
    for (let i = 0; i < grid.length; i++) {
        DT1[i] = grid[i] === 1 ? Infinity : 0;
    }
    
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let i = y * w + x;
            if (grid[i] === 1) DT1[i] = Math.min(DT1[i], DT1[i-1]+1, DT1[i-w-1]+1, DT1[i-w]+1, DT1[i-w+1]+1);
        }
    }
    for (let y = h - 2; y >= 0; y--) {
        for (let x = w - 2; x >= 0; x--) {
            let i = y * w + x;
            if (grid[i] === 1) DT1[i] = Math.min(DT1[i], DT1[i+1]+1, DT1[i+w+1]+1, DT1[i+w]+1, DT1[i+w-1]+1);
        }
    }
    self.postMessage({ type: 'progress', percent: 40 });

    // STEP 3: Smart Grayscale Check (Bypass Anti-Aliasing)
    for (let i = 0; i < grid.length; i++) {
        if (grid[i] === 1 && DT1[i] > 2) {
            const brightness = (data[i*4] + data[i*4+1] + data[i*4+2]) / 3;
            if (brightness > 20 && brightness < 235) {
                hasGrayscale = true; break; 
            }
        }
    }
    self.postMessage({ type: 'progress', percent: 50 });

    // STEP 4: Define True Cores
    const radiusThreshold = minStrokePixels / 2;
    const DT2 = new Float32Array(w * h);
    
    for (let i = 0; i < DT1.length; i++) {
        DT2[i] = (DT1[i] >= radiusThreshold) ? 0 : Infinity;
    }

    // STEP 5: Pass 2 Distance Transform (Dilation)
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let i = y * w + x;
            if (DT2[i] !== 0) DT2[i] = Math.min(DT2[i], DT2[i-1]+1, DT2[i-w-1]+1, DT2[i-w]+1, DT2[i-w+1]+1);
        }
    }
    for (let y = h - 2; y >= 0; y--) {
        for (let x = w - 2; x >= 0; x--) {
            let i = y * w + x;
            if (DT2[i] !== 0) DT2[i] = Math.min(DT2[i], DT2[i+1]+1, DT2[i+w+1]+1, DT2[i+w]+1, DT2[i+w-1]+1);

            if (grid[i] === 1 && DT2[i] > radiusThreshold) {
                hasThinStrokes = true;
                overlayData[i*4] = 255; overlayData[i*4+1] = 16; overlayData[i*4+2] = 122; overlayData[i*4+3] = 255;
            }
        }
    }
    
    self.postMessage({ type: 'progress', percent: 95 });
    self.postMessage({ type: 'complete', results: { hasGrayscale, hasThinStrokes, overlayBuffer: overlayData.buffer, width: w, height: h } }, [overlayData.buffer]); 
};

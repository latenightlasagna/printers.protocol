// worker.js - 600 DPI 3-4 Chamfer Distance Transform Engine

self.onmessage = function(e) {
    const { imageData, minStrokePixels, targetWidth, targetHeight } = e.data;
    const data = imageData.data;
    const w = targetWidth;
    const h = targetHeight;
    
    let hasGrayscale = false;
    let hasThinStrokes = false;
    
    const overlayData = new Uint8ClampedArray(data.length);
    const grid = new Uint8Array(w * h); 
    
    // STEP 1: Strict 1-Bit Prepress Thresholding (128 = 50% Gray)
    for (let i = 0; i < data.length; i += 4) {
        if (data[i+3] < 128) continue; // Ignore transparent pixels
        const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
        if (brightness < 128) grid[(i / 4)] = 1; // Mark pure ink
    }
    
    // Safety Padding
    for(let x=0; x<w; x++) { grid[x] = 0; grid[(h-1)*w + x] = 0; }
    for(let y=0; y<h; y++) { grid[y*w] = 0; grid[y*w + w - 1] = 0; }
    
    self.postMessage({ type: 'progress', percent: 10 });

    // STEP 2: Pass 1 Distance Transform (3-4 Chamfer Erosion)
    const DT1 = new Uint32Array(w * h);
    for (let i = 0; i < grid.length; i++) DT1[i] = grid[i] === 1 ? 999999 : 0;
    
    // Forward Pass
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let i = y * w + x;
            if (grid[i] === 1) {
                DT1[i] = Math.min(
                    DT1[i],
                    DT1[i - 1] + 3,
                    DT1[i - w] + 3,
                    DT1[i - w - 1] + 4,
                    DT1[i - w + 1] + 4
                );
            }
        }
    }
    
    // Backward Pass
    for (let y = h - 2; y >= 0; y--) {
        for (let x = w - 2; x >= 0; x--) {
            let i = y * w + x;
            if (grid[i] === 1) {
                DT1[i] = Math.min(
                    DT1[i],
                    DT1[i + 1] + 3,
                    DT1[i + w] + 3,
                    DT1[i + w + 1] + 4,
                    DT1[i + w - 1] + 4
                );
            }
        }
    }
    self.postMessage({ type: 'progress', percent: 45 });

    // STEP 3: Smart Grayscale Check (Deep Core Sampling)
    // Only checks for grayscale deeply inside thick shapes to ignore edge anti-aliasing
    for (let i = 0; i < grid.length; i++) {
        if (grid[i] === 1 && DT1[i] > 6) { // Must be roughly 2 pixels deep
            const brightness = (data[i*4] + data[i*4+1] + data[i*4+2]) / 3;
            // Catch 5% to 95% grays
            if (brightness > 12 && brightness < 240) {
                hasGrayscale = true; break; 
            }
        }
    }
    self.postMessage({ type: 'progress', percent: 55 });

    // STEP 4: Define Safe Cores
    // Because a 3-4 Chamfer multiplies orthogonal distance by 3, our threshold is radius * 3
    const radiusThreshold = (minStrokePixels / 2) * 3;
    const DT2 = new Uint32Array(w * h);
    
    // A core is safe if its depth exceeds our requirement
    for (let i = 0; i < DT1.length; i++) {
        DT2[i] = (DT1[i] >= radiusThreshold) ? 0 : 999999;
    }

    // STEP 5: Pass 2 Distance Transform (3-4 Chamfer Dilation)
    // Forward Pass
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let i = y * w + x;
            if (DT2[i] !== 0) {
                DT2[i] = Math.min(
                    DT2[i],
                    DT2[i - 1] + 3,
                    DT2[i - w] + 3,
                    DT2[i - w - 1] + 4,
                    DT2[i - w + 1] + 4
                );
            }
        }
    }
    
    // Backward Pass & Flagging
    for (let y = h - 2; y >= 0; y--) {
        for (let x = w - 2; x >= 0; x--) {
            let i = y * w + x;
            if (DT2[i] !== 0) {
                DT2[i] = Math.min(
                    DT2[i],
                    DT2[i + 1] + 3,
                    DT2[i + w] + 3,
                    DT2[i + w + 1] + 4,
                    DT2[i + w - 1] + 4
                );
            }

            // The Check: If it's an ink pixel, but it is too far from a safe Core, it fails.
            if (grid[i] === 1 && DT2[i] >= radiusThreshold) {
                hasThinStrokes = true;
                // Paint Neon Pink directly to buffer
                overlayData[i*4] = 255; 
                overlayData[i*4+1] = 16; 
                overlayData[i*4+2] = 122; 
                overlayData[i*4+3] = 255;
            }
        }
    }
    
    self.postMessage({ type: 'progress', percent: 95 });
    self.postMessage({ 
        type: 'complete', 
        results: { hasGrayscale, hasThinStrokes, overlayBuffer: overlayData.buffer, width: w, height: h } 
    }, [overlayData.buffer]); 
};

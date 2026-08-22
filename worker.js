// worker.js - Two-Pass Distance Transform Engine

self.onmessage = function(e) {
    const { imageData, minStrokePixels, targetWidth, targetHeight, sizeValid } = e.data;
    const data = imageData.data;
    
    let hasGrayscale = false;
    let hasThinStrokes = false;
    
    const overlayData = new Uint8ClampedArray(data.length);
    const grid = new Float32Array(targetWidth * targetHeight);
    
    // STEP 1: Scan for ink and grayscale
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
        if (a === 0) continue; 
        
        const brightness = (r + g + b) / 3;
        
        // Strict Grayscale check for Black Meadow specs
        if (brightness > 10 && brightness < 245) hasGrayscale = true;
        
        // Mark anything darker than pure white as ink so we can analyze its thickness 
        // (Even if it fails grayscale, we still want to test the stroke size accurately)
        if (brightness < 245) grid[(i / 4)] = 1; 
    }
    self.postMessage({ type: 'progress', percent: 20 });

    // STEP 2: First Distance Pass (Measure from White Background inward to Ink)
    const distanceMap = new Float32Array(targetWidth * targetHeight);
    const radiusThreshold = minStrokePixels / 2;
    
    for (let i = 0; i < grid.length; i++) {
        distanceMap[i] = grid[i] === 1 ? Infinity : 0;
    }
    
    // Forward Pass 1
    for (let y = 1; y < targetHeight - 1; y++) {
        for (let x = 1; x < targetWidth - 1; x++) {
            const idx = y * targetWidth + x;
            if (grid[idx] === 1) {
                distanceMap[idx] = Math.min(
                    distanceMap[idx],
                    distanceMap[idx - 1] + 1,
                    distanceMap[idx - targetWidth] + 1
                );
            }
        }
    }
    
    // Backward Pass 1
    for (let y = targetHeight - 2; y >= 0; y--) {
        for (let x = targetWidth - 2; x >= 0; x--) {
            const idx = y * targetWidth + x;
            if (grid[idx] === 1) {
                distanceMap[idx] = Math.min(
                    distanceMap[idx],
                    distanceMap[idx + 1] + 1, 
                    distanceMap[idx + targetWidth] + 1 
                );
            }
        }
    }
    self.postMessage({ type: 'progress', percent: 50 });

    // STEP 3: Identify "Core" pixels (The deep centers of thick shapes)
    const coreDistanceMap = new Float32Array(targetWidth * targetHeight);
    for (let i = 0; i < distanceMap.length; i++) {
        // If a pixel is deeper than our threshold, it is a safe core (distance 0). Otherwise, Infinity.
        coreDistanceMap[i] = (distanceMap[i] >= radiusThreshold) ? 0 : Infinity;
    }

    // STEP 4: Second Distance Pass (Measure from safe Cores outward to edges)
    // Forward Pass 2
    for (let y = 1; y < targetHeight - 1; y++) {
        for (let x = 1; x < targetWidth - 1; x++) {
            const idx = y * targetWidth + x;
            if (coreDistanceMap[idx] !== 0) {
                coreDistanceMap[idx] = Math.min(
                    coreDistanceMap[idx],
                    coreDistanceMap[idx - 1] + 1,
                    coreDistanceMap[idx - targetWidth] + 1
                );
            }
        }
    }

    // Backward Pass 2 & Flagging
    for (let y = targetHeight - 2; y >= 0; y--) {
        for (let x = targetWidth - 2; x >= 0; x--) {
            const idx = y * targetWidth + x;
            if (coreDistanceMap[idx] !== 0) {
                coreDistanceMap[idx] = Math.min(
                    coreDistanceMap[idx],
                    coreDistanceMap[idx + 1] + 1,
                    coreDistanceMap[idx + targetWidth] + 1
                );
            }

            // THE FINAL CHECK: 
            // If the pixel is original ink, BUT its distance to the nearest safe core 
            // is greater than our radius threshold, it is a thin stroke.
            if (grid[idx] === 1 && coreDistanceMap[idx] >= radiusThreshold) {
                hasThinStrokes = true;
                
                // Paint Neon Pink overlay
                overlayData[idx * 4] = 255;     // R
                overlayData[idx * 4 + 1] = 16;  // G
                overlayData[idx * 4 + 2] = 122; // B
                overlayData[idx * 4 + 3] = 255; // Alpha
            }
        }
    }
    self.postMessage({ type: 'progress', percent: 90 });

    // Transfer everything back to main thread
    self.postMessage({
        type: 'complete',
        results: {
            hasGrayscale,
            hasThinStrokes,
            sizeValid,
            overlayBuffer: overlayData.buffer,
            width: targetWidth,
            height: targetHeight
        }
    }, [overlayData.buffer]); 
};

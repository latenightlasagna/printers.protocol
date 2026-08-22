// worker.js - Distance Transform Engine

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
        
        if (brightness > 10 && brightness < 245) hasGrayscale = true;
        if (brightness < 128) grid[(i / 4)] = 1; 
    }
    self.postMessage({ type: 'progress', percent: 45 });

    // STEP 2: Distance Transform initialization
    const distanceMap = new Float32Array(targetWidth * targetHeight);
    const radiusThreshold = minStrokePixels / 2;
    
    for (let i = 0; i < grid.length; i++) {
        distanceMap[i] = grid[i] === 1 ? Infinity : 0;
    }
    
    // Forward Pass
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
    self.postMessage({ type: 'progress', percent: 70 });

    // Backward Pass & Flagging
    for (let y = targetHeight - 2; y >= 0; y--) {
        for (let x = targetWidth - 2; x >= 0; x--) {
            const idx = y * targetWidth + x;
            if (grid[idx] === 1) {
                distanceMap[idx] = Math.min(
                    distanceMap[idx],
                    distanceMap[idx + 1] + 1, 
                    distanceMap[idx + targetWidth] + 1 
                );
                
                // If the pixel is ink, but its distance to the edge is less than required
                if (distanceMap[idx] < radiusThreshold) {
                    hasThinStrokes = true;
                    // Paint Neon Pink
                    overlayData[idx * 4] = 255;     // R
                    overlayData[idx * 4 + 1] = 16;  // G
                    overlayData[idx * 4 + 2] = 122; // B
                    overlayData[idx * 4 + 3] = 255; // Alpha
                }
            }
        }
    }
    self.postMessage({ type: 'progress', percent: 95 });

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

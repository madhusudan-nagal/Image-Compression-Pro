
// ===== 1. Grab the elements =====
const fileInput      = document.getElementById("fileInput");
const dropZone       = document.getElementById("dropZone");
const beforeImg      = document.getElementById("beforeImg");
const afterImg       = document.getElementById("afterImg");
const emptyText      = document.getElementById("emptyText");
const compareUi      = document.getElementById("compareUi");
const loader         = document.getElementById("loader");        
const loaderText     = document.getElementById("loaderText");    
const statusText     = document.getElementById("statusText");
const originalSize   = document.getElementById("originalSize");
const compressedSize = document.getElementById("compressedSize");
const reduction      = document.getElementById("reduction");
const qualitySlider  = document.getElementById("quality");
const qualityValue   = document.getElementById("qualityValue");
const optimizeBtn    = document.getElementById("optimizeBtn");
const deleteBtn      = document.getElementById("deleteBtn");
const downloadBtn    = document.getElementById("downloadBtn");


// ===== 2. Settings =====
const MAX_PIXELS    = 16000000;            // biggest canvas we work on (~16 million pixels, Safari-safe)
const PROBE_PIXELS  = 1000000;             // NEW: small "test copy" used to guess the quality fast
const MAX_FILE_SIZE = 50 * 1024 * 1024;    // 50 MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const CLOSE_ENOUGH  = 0.97;                // within 3% of the target = good enough


// ===== 3. Shared state (the "boxes") =====
let originalBytes  = 0;
let originalName   = "";
let originalFile   = null;
let sourceBitmap   = null;   // NEW: the decoded image we compress (replaces drawing from <img>)
let baseScale      = 1;      // 1 = full size, less than 1 = image was too big and gets shrunk
let compressedBlob = null;
let beforeUrl      = null;
let afterUrl       = null;
let busy           = false;  // NEW: true while loading or compressing
let loadToken      = 0;      // NEW: ignores an old load if a newer file was picked meanwhile
let maxJpegBytes   = 0;      // NEW: biggest JPEG this image can make (quality 1.0) — measured once per image


// ===== 4. UI helpers =====

// Bytes → readable size
function formatSize(bytes) {
  const kb = bytes / 1024;
  const mb = bytes / (1024 * 1024);

  if (bytes < 1024) {
    return bytes + " B";
  } else if (bytes < 1024 * 1024) {
    return kb.toFixed(1) + " KB";
  } else {
    return mb.toFixed(2) + " MB";
  }
}

// Show or hide an element using Tailwind's "hidden" class
function setVisible(element, visible) {
  if (!element) {
    return;
  }
  if (visible) {
    element.classList.remove("hidden");
  } else {
    element.classList.add("hidden");
  }
}

// Message under the Optimize button
function setStatus(message) {
  if (statusText) {
    statusText.textContent = message;
  }
}

// NEW: turn the loader on/off and lock the controls while working
function setBusy(isBusy, message) {
  busy = isBusy;

  if (loaderText && message) {
    loaderText.textContent = message;
  }
  setVisible(loader, isBusy);

  const controls = [optimizeBtn, downloadBtn, deleteBtn, qualitySlider];
  for (const control of controls) {
    if (control) {
      control.disabled = isBusy;
    }
  }

  if (isBusy) {
    optimizeBtn.classList.add("opacity-50");
  } else {
    optimizeBtn.classList.remove("opacity-50");
  }
}

// NEW: wait one frame so the browser can draw the loader BEFORE heavy work starts
function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

// Clear the compressed result
function resetResult() {
  if (afterUrl) {
    URL.revokeObjectURL(afterUrl);
    afterUrl = null;
  }
  afterImg.removeAttribute("src");
  setVisible(afterImg, false);
  setVisible(compareUi, false);
  compressedBlob = null;
  compressedSize.textContent = "—";
  reduction.textContent = "—";
  setStatus("");
}

// Show a compressed result on the page
function showResult(blob) {
  compressedBlob = blob;
  afterUrl = URL.createObjectURL(blob);
  afterImg.src = afterUrl;
  setVisible(afterImg, true);
  setVisible(compareUi, true);
  compressedSize.textContent = formatSize(blob.size);

  const saved = ((originalBytes - blob.size) / originalBytes) * 100;
  reduction.textContent = saved.toFixed(0) + "%";
}


// =====================================================================
// ===== 5. IMAGE LOGIC (all canvas + compression code lives here) =====
// =====================================================================

// Draw the source image into a canvas at a given scale (reuses the same canvas = less memory)
function drawInto(canvas, scale) {
  canvas.width  = Math.max(1, Math.round(sourceBitmap.width  * scale));
  canvas.height = Math.max(1, Math.round(sourceBitmap.height * scale));

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";                                         // JPEG has no transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sourceBitmap, 0, 0, canvas.width, canvas.height);  // draw (and resize)
}

// Encode a canvas as JPEG (toBlob wrapped in a promise so we can "await" it)
function encode(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
}

// Binary search between low and high: the HIGHEST quality whose size is still under the target
async function findBestQuality(canvas, targetBytes, low, high, steps) {
  let bestBlob = null;
  let bestQuality = 0;

  for (let i = 0; i < steps; i++) {
    const mid = (low + high) / 2;
    const blob = await encode(canvas, mid);

    if (!blob) {
      break;                                   // browser couldn't encode → stop safely
    }

    if (blob.size <= targetBytes) {
      bestBlob = blob;                         // fits → keep it, try higher quality
      bestQuality = mid;
      low = mid;
      if (blob.size >= targetBytes * CLOSE_ENOUGH) {
        break;                                 // close enough → stop early
      }
    } else {
      high = mid;                              // too big → try lower quality
    }
  }

  return { blob: bestBlob, quality: bestQuality };
}

// Of two results, keep the one closest to the target (the bigger one, since both are under it)
function closerResult(a, b) {
  if (!a.blob) return b;
  if (!b.blob) return a;
  return b.blob.size > a.blob.size ? b : a;
}

// NEW: measure the biggest JPEG this image can produce (quality 1.0). Done once, then remembered.
async function getMaxJpegBytes() {
  if (maxJpegBytes > 0) {
    return maxJpegBytes;
  }
  const canvas = document.createElement("canvas");
  drawInto(canvas, baseScale);
  const blob = await encode(canvas, 1);
  canvas.width = 0;
  canvas.height = 0;
  maxJpegBytes = blob ? blob.size : originalBytes;
  console.log("max JPEG size:", formatSize(maxJpegBytes));
  return maxJpegBytes;
}

// MAIN: compress the image as close as possible to targetBytes (never above it)
async function compressToTarget(targetBytes) {
  const work = document.createElement("canvas");   // the full-size canvas (reused)
  drawInto(work, baseScale);
  const fullPixels = work.width * work.height;

  // --- Step A: GUESS the quality on a small copy (fast, no big encodes) ---
  const probe = document.createElement("canvas");
  drawInto(probe, baseScale * Math.sqrt(Math.min(1, PROBE_PIXELS / fullPixels)));
  const pixelRatio = (probe.width * probe.height) / fullPixels;
  const guess = await findBestQuality(probe, targetBytes * pixelRatio, 0.01, 1, 8);
  const guessedQuality = guess.blob ? guess.quality : 0.05;
  probe.width = 0;                                 // free the small canvas
  probe.height = 0;
  console.log("guessed quality:", guessedQuality.toFixed(3));

  // --- Step B: search at FULL size, but only in a narrow window around the guess ---
  let low  = Math.max(0.01, guessedQuality - 0.15);
  let high = Math.min(1, guessedQuality + 0.15);
  let result = await findBestQuality(work, targetBytes, low, high, 5);

  if (!result.blob) {
    // guess was too high → look below the window
    result = await findBestQuality(work, targetBytes, 0.01, low, 6);
  } else if (result.blob.size < targetBytes * CLOSE_ENOUGH && high < 1) {
    // maybe an even higher quality still fits → look above
    result = closerResult(result, await findBestQuality(work, targetBytes, result.quality, 1, 5));
  }

  // --- Step C: nothing fits even at the lowest quality → shrink the image ---
  let scale = baseScale;
  while (!result.blob && scale > baseScale * 0.1) {
    scale = scale * 0.75;
    drawInto(work, scale);
    result = await findBestQuality(work, targetBytes, 0.01, 1, 8);
  }

  // --- Step D: still more than 3% under → fine-tune with a slightly smaller size ---
  if (result.blob && result.blob.size < targetBytes * CLOSE_ENOUGH && result.quality < 1) {
    const higherQuality = Math.min(1, result.quality + 0.05);
    let lowScale = scale * 0.5;
    let highScale = scale;

    for (let i = 0; i < 8; i++) {
      const midScale = (lowScale + highScale) / 2;
      drawInto(work, midScale);
      const blob = await encode(work, higherQuality);

      if (!blob) {
        break;
      }

      if (blob.size <= targetBytes) {
        if (blob.size > result.blob.size) {
          result = { blob: blob, quality: higherQuality };
        }
        lowScale = midScale;
        if (blob.size >= targetBytes * CLOSE_ENOUGH) {
          break;
        }
      } else {
        highScale = midScale;
      }
    }
  }

  // --- Step E: last fallback → smallest possible version ---
  if (!result.blob) {
    result = { blob: await encode(work, 0.01), quality: 0.01 };
  }

  work.width = 0;                                  // free the big canvas
  work.height = 0;
  return result.blob;
}


// ===== 6. Loading a file =====

// Decode the file into a bitmap (the "source" for all compression). Shows the loader meanwhile.
async function prepareImage(file) {
  const myToken = ++loadToken;
  setBusy(true, "Loading image…");
  await nextFrame();

  try {
    const bitmap = await createImageBitmap(file);   // decodes the image (faster than <img> for big files)

    if (myToken !== loadToken) {
      bitmap.close();                              // a newer file was picked meanwhile → drop this one
      return;
    }

    if (sourceBitmap) {
      sourceBitmap.close();                        // free the previous image
    }
    sourceBitmap = bitmap;

    const pixels = bitmap.width * bitmap.height;
    baseScale = Math.min(1, Math.sqrt(MAX_PIXELS / pixels));
    console.log("image:", bitmap.width, "x", bitmap.height, "| scale:", baseScale.toFixed(3));

  } catch (error) {
    console.error(error);
    alert("Sorry, this image could not be read");
  } finally {
    if (myToken === loadToken) {
      setBusy(false);
    }
  }
}

// Handle a file (used by click AND drag & drop)
function handleFile(file) {
  if (!file) {
    return;
  }
  if (busy) {
    alert("Please wait until the current image is finished");
    return;
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    alert("Only PNG, JPG or WEBP images are allowed");
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    alert("Image must be under 50MB");
    return;
  }

  originalBytes = file.size;
  originalFile  = file;
  originalName  = file.name;
  maxJpegBytes  = 0;                               // NEW: new image → measure again

  resetResult();

  // Preview thumbnail (only touches #beforeImg inside the compare box — never the header logo)
  if (beforeUrl) {
    URL.revokeObjectURL(beforeUrl);
  }
  beforeUrl = URL.createObjectURL(file);
  beforeImg.src = beforeUrl;
  setVisible(beforeImg, true);
  setVisible(emptyText, false);
  originalSize.textContent = formatSize(file.size);
  setVisible(deleteBtn, true);

  prepareImage(file);                              // decode for compression (with loader)
}


// ===== 7. Events =====

// Click to upload
fileInput.addEventListener("change", () => {
  handleFile(fileInput.files[0]);
});

// Drag & drop
if (dropZone) {
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("border-emerald-400");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("border-emerald-400");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-emerald-400");
    handleFile(e.dataTransfer.files[0]);
  });
}

// Slider
qualitySlider.addEventListener("input", () => {
  qualityValue.textContent = qualitySlider.value + "%";
  resetResult();
});

// Optimize
optimizeBtn.addEventListener("click", async () => {
  if (busy) {
    return;
  }
  if (!sourceBitmap) {
    alert("Please upload an image first");
    return;
  }

  const percent = Number(qualitySlider.value);

  if (percent === 100) {
    showResult(originalFile);                      // 100% → the original, untouched
    return;
  }

  setBusy(true, "Compressing…");
  setStatus("");
  await nextFrame();                               // let the loader appear first
  console.time("optimize");

  try {
    // NEW: the slider is a % of the biggest size this image can REALLY reach.
    // Normally that's the original size; for padded / uncompressed files it's the max JPEG size.
    const maxBytes = await getMaxJpegBytes();
    const baseBytes = Math.min(originalBytes, maxBytes);
    const targetBytes = (baseBytes * percent) / 100;

    const blob = await compressToTarget(targetBytes);

    if (!blob) {
      alert("This image is too large for the browser to process");
      return;
    }

    console.log("Result:", formatSize(blob.size), "| target:", formatSize(targetBytes));
    showResult(blob);

    if (baseBytes < originalBytes) {
      setStatus("Slider is based on this image's max JPEG size (" + formatSize(baseBytes) + "), not the file size.");
    }

  } catch (error) {
    console.error(error);
    alert("Something went wrong while compressing");
  } finally {
    console.timeEnd("optimize");
    setBusy(false);
  }
});

// Delete
deleteBtn.addEventListener("click", () => {
  if (busy) {
    return;
  }

  loadToken++;                                     // cancel any load still in progress
  if (sourceBitmap) {
    sourceBitmap.close();
    sourceBitmap = null;
  }
  if (beforeUrl) {
    URL.revokeObjectURL(beforeUrl);
    beforeUrl = null;
  }

  beforeImg.removeAttribute("src");
  setVisible(beforeImg, false);
  resetResult();

  originalBytes = 0;
  originalName = "";
  originalFile = null;
  maxJpegBytes = 0;
  originalSize.textContent = "—";

  fileInput.value = "";
  setVisible(deleteBtn, false);
  setVisible(emptyText, true);
});

// Download
downloadBtn.addEventListener("click", () => {
  if (!compressedBlob) {
    alert("Please optimize an image first before download.");
    return;
  }

  let ext = compressedBlob.type.split("/")[1];
  if (ext === "jpeg") {
    ext = "jpg";
  }

  const newName = originalName.split(".")[0] + "-compressed." + ext;
  const compressedFile = new File([compressedBlob], newName, {
    type: compressedBlob.type,
  });

  const url = URL.createObjectURL(compressedFile);
  const link = document.createElement("a");
  link.href = url;
  link.download = newName;
  link.click();

  URL.revokeObjectURL(url);
});
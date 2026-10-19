const fileInput = document.getElementById("fileInput");
const beforeImg = document.getElementById("beforeImg");
const afterImg = document.getElementById("afterImg");
const originalSize = document.getElementById("originalSize");
const compressedSize = document.getElementById("compressedSize");
const reduction = document.getElementById("reduction");
const qualitySlider = document.getElementById("quality");
const qualityValue = document.getElementById("qualityValue");
const optimizeBtn = document.getElementById("optimizeBtn");
const downloadBtn = document.getElementById("downloadBtn");

let originalBytes = 0;
let canvas = null;
let compressedBlob = null;
let originalName = "";

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

//  picking file from the user
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) {
    return;
  }

  originalBytes = file.size;
  originalName = file.name;
  afterImg.removeAttribute("src"); 
  compressedBlob = null; 
  compressedSize.textContent = "—"; 
  reduction.textContent = "—";
  beforeImg.src = URL.createObjectURL(file); 
  originalSize.textContent = formatSize(file.size); 


  console.log(originalBytes, originalName, afterImg, compressedSize, reduction,);
});

// beforeImage drawing on canvas
beforeImg.addEventListener("load", () => {
  canvas = document.createElement("canvas"); 
  canvas.width = beforeImg.naturalWidth; 
  canvas.height = beforeImg.naturalHeight;
  const ctx = canvas.getContext("2d"); //
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // painting the image
  ctx.drawImage(beforeImg, 0, 0);
console.log();

});

qualitySlider.addEventListener("input", () => {
  qualityValue.textContent = qualitySlider.value + "%";
});

optimizeBtn.addEventListener("click", () => {
  if (!canvas) {
    alert("Please upload an image first");
    return;
  }

  const quality = qualitySlider.value / 100;

  canvas.toBlob(
    (blob) => {
      compressedBlob = blob;
      afterImg.src = URL.createObjectURL(blob);
      compressedSize.textContent = formatSize(blob.size);

      const saved = ((originalBytes - blob.size) / originalBytes) * 100;
      reduction.textContent = saved.toFixed(0) + "%";

      console.log("Blob:", blob);
    },
    "image/jpeg",
    quality,
  );
});

downloadBtn.addEventListener("click", () => {
  if (!compressedBlob) {
    alert("please optimize an image first before download.");
    return;
  }

  const newName = originalName.split(".")[0] + "compressed.jpg";
  const compressedFile = new File([compressedBlob], newName, {
    type: "image.jpeg ",
  });
  const url = URL.createObjectURL(compressedFile);
  const link = document.createElement("a");
  link.href = url;
  link.download = newName;
  link.click();

  URL.revokeObjectURL(url);
});

const fileInput = document.getElementById("fileInput");
const beforeImg = document.getElementById("beforeImg");
const afterImg = document.getElementById("afterImg");
const originalSize = document.getElementById("originalSize");
const compressedSize = document.getElementById("compressedSize");
const reduction = document.getElementById("reduction");
const qualitySlider = document.getElementById("quality");
const qualityValue = document.getElementById("qualityValue");
const optimizeBtn = document.getElementById("optimizeBtn");
const deleteBtn = document.getElementById("deleteBtn");
const downloadBtn = document.getElementById("downloadBtn");

let originalBytes = 0;
let canvas = null;
let compressedBlob = null;
let originalName = "";

//converting size to mb and kb
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

function canvasToBlob(quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
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
  deleteBtn.classList.remove("hidden");
});

deleteBtn.addEventListener("click", () => {
  beforeImg.removeAttribute("src");
  afterImg.removeAttribute("src");
  canvas = null;
  compressedBlob = null;
  originalBytes = 0;
  originalName = "";
  originalSize.textContent = "—";
  compressedSize.textContent = "—";
  reduction.textContent = "—";
  fileInput.value = "";
  deleteBtn.classList.add("hidden");
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


});

qualitySlider.addEventListener("input", () => {
  qualityValue.textContent = qualitySlider.value + "%";

  console.log(qualityValue.textContent , qualitySlider.value); 
});

optimizeBtn.addEventListener("click", async () => {
  if (!canvas) {
    alert("Please upload an image first");
    return;
  }

  const targetBytes = originalBytes * (100 - qualitySlider.value) / 100;

  let low = 0.01;
  let high = 1;
  let bestBlob = null;

  for (let i = 0; i < 8; i++) {
    const mid = (low + high) / 2;
    const blob = await canvasToBlob(mid);

    if (blob.size <= targetBytes) {
      bestBlob = blob;   
      low = mid;
    } else {
      high = mid;    
    }
  }

  if (!bestBlob) {
    bestBlob = await canvasToBlob(0.01);
  }

  compressedBlob = bestBlob;
  afterImg.src = URL.createObjectURL(bestBlob);
  compressedSize.textContent = formatSize(bestBlob.size);

  const saved = ((originalBytes - bestBlob.size) / originalBytes) * 100;
  reduction.textContent = saved.toFixed(0) + "%";
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

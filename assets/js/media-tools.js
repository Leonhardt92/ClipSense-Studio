const els = {
  imagesInput: document.getElementById('images-input'),
  imgDuration: document.getElementById('img-duration'),
  fps: document.getElementById('fps'),
  width: document.getElementById('video-width'),
  height: document.getElementById('video-height'),
  makeVideoBtn: document.getElementById('make-video-btn'),
  downloadVideoLink: document.getElementById('download-video-link'),
  imageStatus: document.getElementById('image-status'),
  previewCanvas: document.getElementById('preview-canvas'),
  generatedVideo: document.getElementById('generated-video'),

  audioInput: document.getElementById('audio-input'),
  audioFps: document.getElementById('audio-fps'),
  audioWidth: document.getElementById('audio-width'),
  audioHeight: document.getElementById('audio-height'),
  makeAudioVideoBtn: document.getElementById('make-audio-video-btn'),
  downloadAudioVideoLink: document.getElementById('download-audio-video-link'),
  audioStatus: document.getElementById('audio-status'),
  audioCanvas: document.getElementById('audio-canvas'),
  audioGeneratedVideo: document.getElementById('audio-generated-video'),

  videoInput: document.getElementById('video-input'),
  extractInterval: document.getElementById('extract-interval'),
  imageFormat: document.getElementById('image-format'),
  extractBtn: document.getElementById('extract-btn'),
  downloadAllBtn: document.getElementById('download-all-btn'),
  videoStatus: document.getElementById('video-status'),
  frames: document.getElementById('frames'),
  hiddenVideo: document.getElementById('hidden-video'),
  hiddenAudio: document.getElementById('hidden-audio'),
  lightbox: document.getElementById('lightbox'),
  lightboxImage: document.getElementById('lightbox-image'),
  lightboxClose: document.getElementById('lightbox-close'),
};

let frameExports = [];
let videoBlobUrl = null;
let audioVideoBlobUrl = null;

function setStatus(el, text) {
  el.textContent = text;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function chooseMimeType() {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function drawImageContain(ctx, image, width, height) {
  const iw = image.width;
  const ih = image.height;
  const scale = Math.min(width / iw, height / ih);
  const w = iw * scale;
  const h = ih * scale;
  const x = (width - w) / 2;
  const y = (height - h) / 2;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, x, y, w, h);
}

function makeParticles(count, width, height) {
  const arr = [];
  for (let i = 0; i < count; i += 1) {
    arr.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 1.5,
      vy: (Math.random() - 0.5) * 1.5,
      r: 8 + Math.random() * 28,
      hue: Math.floor(Math.random() * 360),
    });
  }
  return arr;
}

function drawAudioFrame(ctx, width, height, freqData, timeData, particles, sec) {
  const sum = freqData.reduce((s, v) => s + v, 0);
  const energy = sum / (freqData.length * 255);
  const bgHue = Math.floor((sec * 35) % 360);

  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, `hsl(${bgHue}, 60%, ${16 + energy * 15}%)`);
  g.addColorStop(1, `hsl(${(bgHue + 60) % 360}, 60%, ${10 + energy * 12}%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  const bars = 96;
  const step = Math.floor(freqData.length / bars) || 1;
  const barW = width / bars;
  for (let i = 0; i < bars; i += 1) {
    const v = freqData[i * step] / 255;
    const barH = v * height * 0.5;
    const x = i * barW;
    const y = height - barH;
    const hue = (bgHue + i * 2) % 360;
    ctx.fillStyle = `hsla(${hue}, 85%, 62%, 0.75)`;
    ctx.fillRect(x, y, Math.max(1, barW - 1), barH);
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    p.x += p.vx * (1 + energy * 2.5);
    p.y += p.vy * (1 + energy * 2.5);
    if (p.x < -40) p.x = width + 40;
    if (p.x > width + 40) p.x = -40;
    if (p.y < -40) p.y = height + 40;
    if (p.y > height + 40) p.y = -40;
    const radius = p.r * (0.65 + energy * 1.6);
    ctx.beginPath();
    ctx.fillStyle = `hsla(${(p.hue + bgHue) % 360}, 90%, 70%, 0.18)`;
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 中央波形环
  const cx = width * 0.5;
  const cy = height * 0.45;
  const baseR = Math.min(width, height) * 0.13;
  ctx.beginPath();
  for (let i = 0; i < timeData.length; i += 1) {
    const amp = (timeData[i] - 128) / 128;
    const a = (i / timeData.length) * Math.PI * 2;
    const r = baseR + amp * 32 * (0.7 + energy);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = `hsla(${(bgHue + 140) % 360}, 100%, 80%, 0.9)`;
  ctx.lineWidth = 3;
  ctx.stroke();
}

async function fileToImageBitmap(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function makeVideoFromImages() {
  const files = [...els.imagesInput.files];
  if (!files.length) {
    setStatus(els.imageStatus, '请先选择图片');
    return;
  }

  const width = Math.max(320, Number(els.width.value) || 1920);
  const height = Math.max(180, Number(els.height.value) || 1080);
  const fps = Math.max(8, Number(els.fps.value) || 24);
  const perImageSec = Math.max(0.2, Number(els.imgDuration.value) || 3);
  const framesPerImage = Math.max(1, Math.round(perImageSec * fps));

  els.previewCanvas.width = width;
  els.previewCanvas.height = height;
  const ctx = els.previewCanvas.getContext('2d');
  els.previewCanvas.classList.remove('hidden');
  els.generatedVideo.classList.add('hidden');

  setStatus(els.imageStatus, '正在加载图片...');
  const images = [];
  for (let i = 0; i < files.length; i += 1) {
    images.push(await fileToImageBitmap(files[i]));
    setStatus(els.imageStatus, `图片加载 ${i + 1}/${files.length}`);
  }

  const mimeType = chooseMimeType();
  if (!mimeType) {
    setStatus(els.imageStatus, '当前浏览器不支持 MediaRecorder 编码 webm');
    return;
  }

  const stream = els.previewCanvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise((resolve) => {
    recorder.onstop = resolve;
  });

  recorder.start();

  const totalFrames = framesPerImage * images.length;
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const idx = Math.min(images.length - 1, Math.floor(frame / framesPerImage));
    drawImageContain(ctx, images[idx], width, height);
    if (frame % Math.max(1, Math.floor(fps / 2)) === 0) {
      setStatus(els.imageStatus, `正在合成视频 ${frame + 1}/${totalFrames} 帧`);
    }
    await sleep(1000 / fps);
  }

  recorder.stop();
  await done;

  if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl);
  const blob = new Blob(chunks, { type: mimeType });
  videoBlobUrl = URL.createObjectURL(blob);

  els.downloadVideoLink.href = videoBlobUrl;
  els.downloadVideoLink.classList.remove('hidden');
  els.generatedVideo.src = videoBlobUrl;
  els.generatedVideo.classList.remove('hidden');
  els.previewCanvas.classList.add('hidden');
  await els.generatedVideo.play().catch(() => {});
  setStatus(els.imageStatus, `生成完成：${(blob.size / 1024 / 1024).toFixed(2)} MB`);
}

async function makeVideoFromAudio() {
  const file = els.audioInput.files?.[0];
  if (!file) {
    setStatus(els.audioStatus, '请先选择音频文件');
    return;
  }

  const width = Math.max(320, Number(els.audioWidth.value) || 1920);
  const height = Math.max(180, Number(els.audioHeight.value) || 1080);
  const fps = Math.max(8, Number(els.audioFps.value) || 30);
  const mimeType = chooseMimeType();
  if (!mimeType) {
    setStatus(els.audioStatus, '当前浏览器不支持 MediaRecorder 编码 webm');
    return;
  }

  els.audioCanvas.width = width;
  els.audioCanvas.height = height;
  els.audioCanvas.classList.remove('hidden');
  els.audioGeneratedVideo.classList.add('hidden');
  const ctx = els.audioCanvas.getContext('2d');

  const audioUrl = URL.createObjectURL(file);
  const audioEl = els.hiddenAudio;
  audioEl.src = audioUrl;
  audioEl.preload = 'auto';
  await waitEvent(audioEl, 'loadedmetadata');

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src = audioCtx.createMediaElementSource(audioEl);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.84;
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  const timeData = new Uint8Array(analyser.fftSize);

  const dest = audioCtx.createMediaStreamDestination();
  src.connect(analyser);
  analyser.connect(dest);
  src.connect(audioCtx.destination);

  const canvasStream = els.audioCanvas.captureStream(fps);
  const mixed = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const recorder = new MediaRecorder(mixed, { mimeType });
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const done = new Promise((resolve) => {
    recorder.onstop = resolve;
  });

  const particles = makeParticles(18, width, height);
  let rafId = 0;
  let ended = false;
  audioEl.onended = () => {
    ended = true;
  };

  const render = () => {
    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);
    drawAudioFrame(ctx, width, height, freqData, timeData, particles, audioEl.currentTime || 0);
    setStatus(
      els.audioStatus,
      `生成中 ${Math.min(audioEl.currentTime || 0, audioEl.duration || 0).toFixed(1)}s / ${(audioEl.duration || 0).toFixed(1)}s`
    );
    if (!ended) rafId = requestAnimationFrame(render);
  };

  recorder.start();
  await audioCtx.resume();
  await audioEl.play();
  render();

  await waitEvent(audioEl, 'ended');
  ended = true;
  if (rafId) cancelAnimationFrame(rafId);
  recorder.stop();
  await done;

  if (audioVideoBlobUrl) URL.revokeObjectURL(audioVideoBlobUrl);
  const blob = new Blob(chunks, { type: mimeType });
  audioVideoBlobUrl = URL.createObjectURL(blob);

  els.downloadAudioVideoLink.href = audioVideoBlobUrl;
  const baseName = String(file.name || 'audio');
  const dotIndex = baseName.lastIndexOf('.');
  const fileStem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
  els.downloadAudioVideoLink.download = `${fileStem || 'audio'}.webm`;
  els.downloadAudioVideoLink.classList.remove('hidden');
  els.audioGeneratedVideo.src = audioVideoBlobUrl;
  els.audioGeneratedVideo.classList.remove('hidden');
  els.audioCanvas.classList.add('hidden');
  await els.audioGeneratedVideo.play().catch(() => {});
  setStatus(els.audioStatus, `生成完成：${(blob.size / 1024 / 1024).toFixed(2)} MB`);

  URL.revokeObjectURL(audioUrl);
  audioEl.src = '';
  audioEl.onended = null;
  src.disconnect();
  analyser.disconnect();
  dest.disconnect();
  audioCtx.close().catch(() => {});
}

function waitEvent(target, event) {
  return new Promise((resolve) => {
    const on = () => {
      target.removeEventListener(event, on);
      resolve();
    };
    target.addEventListener(event, on, { once: true });
  });
}

function toExt(mime) {
  return mime === 'image/jpeg' ? 'jpg' : 'png';
}

function openLightbox(url) {
  els.lightboxImage.src = url;
  els.lightbox.classList.remove('hidden');
}

function closeLightbox() {
  els.lightbox.classList.add('hidden');
  els.lightboxImage.src = '';
}

async function extractFrames() {
  const file = els.videoInput.files?.[0];
  if (!file) {
    setStatus(els.videoStatus, '请先选择视频文件');
    return;
  }

  const interval = Math.max(0.1, Number(els.extractInterval.value) || 3);
  const mime = els.imageFormat.value || 'image/png';

  frameExports = [];
  els.frames.innerHTML = '';

  const videoUrl = URL.createObjectURL(file);
  const video = els.hiddenVideo;
  video.src = videoUrl;

  await waitEvent(video, 'loadedmetadata');

  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const duration = video.duration || 0;
  if (!Number.isFinite(duration) || duration <= 0) {
    URL.revokeObjectURL(videoUrl);
    setStatus(els.videoStatus, '视频时长读取失败');
    return;
  }

  const points = [];
  for (let t = 0; t < duration; t += interval) {
    points.push(Number(t.toFixed(3)));
  }
  if (points.length === 0 || points[points.length - 1] !== duration) {
    points.push(duration);
  }

  for (let i = 0; i < points.length; i += 1) {
    const t = points[i];
    video.currentTime = Math.min(duration, t);
    await waitEvent(video, 'seeked');

    ctx.drawImage(video, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.92));
    const url = URL.createObjectURL(blob);

    const name = `frame_${String(i + 1).padStart(4, '0')}_${t.toFixed(2)}s.${toExt(mime)}`;
    frameExports.push({ name, blob, url, second: t });

    const card = document.createElement('div');
    card.className = 'frame-card';
    card.innerHTML = `
      <img src="${url}" alt="${name}" />
      <div class="frame-meta">
        <span>${t.toFixed(2)}s</span>
        <a href="${url}" download="${name}">下载</a>
      </div>
    `;
    els.frames.appendChild(card);

    setStatus(els.videoStatus, `拆图中 ${i + 1}/${points.length}`);
    await sleep(10);
  }

  URL.revokeObjectURL(videoUrl);
  setStatus(els.videoStatus, `完成，共导出 ${frameExports.length} 张`);
}

async function downloadAllFrames() {
  if (!frameExports.length) {
    setStatus(els.videoStatus, '暂无可下载图片，请先拆图');
    return;
  }

  for (let i = 0; i < frameExports.length; i += 1) {
    const f = frameExports[i];
    const a = document.createElement('a');
    a.href = f.url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus(els.videoStatus, `批量下载 ${i + 1}/${frameExports.length}`);
    await sleep(160);
  }

  setStatus(els.videoStatus, `下载触发完成，共 ${frameExports.length} 张`);
}

els.makeVideoBtn.addEventListener('click', () => {
  makeVideoFromImages().catch((e) => {
    console.error(e);
    setStatus(els.imageStatus, `生成失败：${e.message}`);
  });
});

els.extractBtn.addEventListener('click', () => {
  extractFrames().catch((e) => {
    console.error(e);
    setStatus(els.videoStatus, `拆图失败：${e.message}`);
  });
});

els.downloadAllBtn.addEventListener('click', () => {
  downloadAllFrames().catch((e) => {
    console.error(e);
    setStatus(els.videoStatus, `批量下载失败：${e.message}`);
  });
});

els.makeAudioVideoBtn.addEventListener('click', () => {
  makeVideoFromAudio().catch((e) => {
    console.error(e);
    setStatus(els.audioStatus, `生成失败：${e.message}`);
  });
});

els.frames.addEventListener('click', (event) => {
  const img = event.target.closest('.frame-card img');
  if (!img) return;
  openLightbox(img.src);
});

els.lightboxClose.addEventListener('click', closeLightbox);
els.lightbox.addEventListener('click', (event) => {
  if (event.target === els.lightbox) closeLightbox();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.lightbox.classList.contains('hidden')) {
    closeLightbox();
  }
});

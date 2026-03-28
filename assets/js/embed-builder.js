import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

const MODEL_ID = 'Xenova/bge-small-zh-v1.5';
const QUERY_INSTRUCTION = '为这个句子生成表示以用于检索相关片段：';

const els = {
  parseRowInput: document.getElementById('parse-row-input'),
  parseRowBtn: document.getElementById('parse-row-btn'),
  original: document.getElementById('original'),
  meaning: document.getElementById('meaning'),
  synonyms: document.getElementById('synonyms'),
  sceneTags: document.getElementById('scene_tags'),
  emotionTags: document.getElementById('emotion_tags'),
  youtube: document.getElementById('youtube'),
  videoDownload: document.getElementById('video_download'),
  generateBtn: document.getElementById('generate-btn'),
  copyEmbeddingBtn: document.getElementById('copy-embedding-btn'),
  copyRowBtn: document.getElementById('copy-row-btn'),
  status: document.getElementById('status'),
  csvRowOutput: document.getElementById('csv-row-output'),
  embeddingOutput: document.getElementById('embedding-output'),
  searchTextOutput: document.getElementById('search-text-output'),
};

let extractor = null;
let loadingPromise = null;

function setStatus(text) {
  els.status.textContent = text;
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function parsePipeList(value) {
  return String(value || '')
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);
}

function normalizeEmbedding(vector) {
  return vector.map((v) => Number(Number(v).toFixed(8)));
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((v) => String(v || '').trim());
}

function toCsvValue(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildSearchText(fields) {
  const synonyms = parsePipeList(fields.synonyms).join('，');
  const sceneTags = parsePipeList(fields.sceneTags).join('，');
  const emotionTags = parsePipeList(fields.emotionTags).join('，');

  return [
    `原句：${fields.original}`,
    `意思：${fields.meaning}`,
    `近义：${synonyms}`,
    `场景：${sceneTags}`,
    `情绪：${emotionTags}`,
  ].join('\n');
}

async function getExtractor() {
  if (extractor) return extractor;
  if (loadingPromise) return loadingPromise;

  setStatus('正在加载模型...');
  loadingPromise = pipeline('feature-extraction', MODEL_ID)
    .then((instance) => {
      extractor = instance;
      return instance;
    })
    .finally(() => {
      loadingPromise = null;
    });

  return loadingPromise;
}

async function generateEmbedding(text) {
  const model = await getExtractor();
  const output = await model(`${QUERY_INSTRUCTION}${text}`, {
    pooling: 'cls',
    normalize: true,
  });

  const rows = typeof output.tolist === 'function' ? output.tolist() : output;
  return Array.isArray(rows[0]) ? rows[0] : rows;
}

function collectFields() {
  return {
    original: normalizeText(els.original.value),
    meaning: normalizeText(els.meaning.value),
    synonyms: normalizeText(els.synonyms.value),
    sceneTags: normalizeText(els.sceneTags.value),
    emotionTags: normalizeText(els.emotionTags.value),
    youtube: normalizeText(els.youtube.value),
    videoDownload: normalizeText(els.videoDownload.value),
  };
}

function buildCsvRow(fields, embedding) {
  const columns = [
    fields.original,
    fields.meaning,
    fields.synonyms,
    fields.sceneTags,
    fields.emotionTags,
    fields.youtube,
    fields.videoDownload,
    JSON.stringify(embedding),
  ];

  return columns.map((v) => toCsvValue(v)).join(',');
}

function fillFieldsFromCsvColumns(columns) {
  els.original.value = columns[0] || '';
  els.meaning.value = columns[1] || '';
  els.synonyms.value = columns[2] || '';
  els.sceneTags.value = columns[3] || '';
  els.emotionTags.value = columns[4] || '';
  els.youtube.value = columns[5] || '';
  els.videoDownload.value = columns[6] || '';

  const embeddingRaw = String(columns[7] || '').trim();
  if (embeddingRaw) {
    try {
      const parsed = JSON.parse(embeddingRaw);
      els.embeddingOutput.value = JSON.stringify(parsed);
    } catch {
      els.embeddingOutput.value = embeddingRaw;
    }
  } else {
    els.embeddingOutput.value = '';
  }

  const fields = collectFields();
  els.searchTextOutput.value = buildSearchText(fields);
  els.csvRowOutput.value = '';
}

async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus('复制成功');
  } catch {
    setStatus('复制失败，请手动复制');
  }
}

els.generateBtn.addEventListener('click', async () => {
  const fields = collectFields();
  if (!fields.original) {
    setStatus('请至少填写 original（原句）');
    return;
  }

  els.generateBtn.disabled = true;
  setStatus('正在生成 embedding...');

  try {
    const searchText = buildSearchText(fields);
    const embeddingRaw = await generateEmbedding(searchText);
    const embedding = normalizeEmbedding(embeddingRaw);
    const csvRow = buildCsvRow(fields, embedding);

    els.searchTextOutput.value = searchText;
    els.embeddingOutput.value = JSON.stringify(embedding);
    els.csvRowOutput.value = csvRow;

    setStatus(`生成完成（维度 ${embedding.length}）`);
  } catch (error) {
    console.error(error);
    setStatus(`生成失败：${error.message}`);
  } finally {
    els.generateBtn.disabled = false;
  }
});

els.copyEmbeddingBtn.addEventListener('click', async () => {
  await copyText(els.embeddingOutput.value);
});

els.copyRowBtn.addEventListener('click', async () => {
  await copyText(els.csvRowOutput.value);
});

els.parseRowBtn.addEventListener('click', () => {
  const raw = String(els.parseRowInput.value || '').trim();
  if (!raw) {
    setStatus('请先粘贴一行 CSV 字符串');
    return;
  }

  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const targetLine = lines[lines.length - 1] || '';
  const columns = parseCsvLine(targetLine);

  if (columns.length < 7) {
    setStatus(`解析失败：字段数不足（当前 ${columns.length}，至少 7 列）`);
    return;
  }

  fillFieldsFromCsvColumns(columns);
  setStatus(`解析完成：已填充 ${Math.min(columns.length, 8)} 列`);
});

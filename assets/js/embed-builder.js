import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

const MODEL_ID = 'Xenova/bge-small-zh-v1.5';
const QUERY_INSTRUCTION = '为这个句子生成表示以用于检索相关片段：';

const els = {
  parseRowInput: document.getElementById('parse-row-input'),
  parseRowBtn: document.getElementById('parse-row-btn'),
  recordId: document.getElementById('record_id'),
  original: document.getElementById('original'),
  meaning: document.getElementById('meaning'),
  synonyms: document.getElementById('synonyms'),
  sceneTags: document.getElementById('scene_tags'),
  emotionTags: document.getElementById('emotion_tags'),
  youtube: document.getElementById('youtube'),
  videoDownload: document.getElementById('video_download'),
  materialDownloads: document.getElementById('material_downloads'),
  relation: document.getElementById('relation'),
  location: document.getElementById('location'),
  peopleCount: document.getElementById('people_count'),
  generateBtn: document.getElementById('generate-btn'),
  copyEmbeddingBtn: document.getElementById('copy-embedding-btn'),
  copyRecordRowBtn: document.getElementById('copy-record-row-btn'),
  copyEmbeddingRowBtn: document.getElementById('copy-embedding-row-btn'),
  status: document.getElementById('status'),
  recordRowOutput: document.getElementById('record-row-output'),
  embeddingRowOutput: document.getElementById('embedding-row-output'),
};

let extractor = null;
let loadingPromise = null;
let nextNumericIdPromise = null;

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
  const relations = parsePipeList(fields.relation).join('，');
  const locations = parsePipeList(fields.location).join('，');

  return [
    `原句：${fields.original}`,
    `意思：${fields.meaning}`,
    `近义：${synonyms}`,
    `场景：${sceneTags}`,
    `情绪：${emotionTags}`,
    `关系：${relations}`,
    `地点：${locations}`,
    `人数：${fields.peopleCount}`,
  ].join('\n');
}

async function fetchNextNumericId() {
  if (nextNumericIdPromise) return nextNumericIdPromise;

  nextNumericIdPromise = fetch('./data/search_records.csv', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return '1';
      const text = await response.text();
      const lines = text
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(1);

      let maxId = 0;
      lines.forEach((line) => {
        const columns = parseCsvLine(line);
        const id = Number.parseInt(String(columns[0] || '').trim(), 10);
        if (Number.isFinite(id)) {
          maxId = Math.max(maxId, id);
        }
      });

      return String(maxId + 1 || 1);
    })
    .catch(() => '1')
    .finally(() => {
      nextNumericIdPromise = null;
    });

  return nextNumericIdPromise;
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
    id: normalizeText(els.recordId.value),
    original: normalizeText(els.original.value),
    meaning: normalizeText(els.meaning.value),
    synonyms: normalizeText(els.synonyms.value),
    sceneTags: normalizeText(els.sceneTags.value),
    emotionTags: normalizeText(els.emotionTags.value),
    youtube: normalizeText(els.youtube.value),
    videoDownload: normalizeText(els.videoDownload.value),
    materialDownloads: normalizeText(els.materialDownloads.value),
    relation: normalizeText(els.relation.value),
    location: normalizeText(els.location.value),
    peopleCount: normalizeText(els.peopleCount.value),
  };
}

function buildRecordCsvRow(fields) {
  const columns = [
    fields.id,
    fields.original,
    fields.meaning,
    fields.synonyms,
    fields.sceneTags,
    fields.emotionTags,
    fields.relation,
    fields.location,
    fields.peopleCount,
    fields.youtube,
    fields.videoDownload,
    fields.materialDownloads,
  ];

  return columns.map((v) => toCsvValue(v)).join(',');
}

function buildEmbeddingCsvRow(recordId, embedding) {
  return [recordId, JSON.stringify(embedding)].map((v) => toCsvValue(v)).join(',');
}

function fillForm(fields, embedding = []) {
  els.recordId.value = fields.id || '';
  els.original.value = fields.original || '';
  els.meaning.value = fields.meaning || '';
  els.synonyms.value = fields.synonyms || '';
  els.sceneTags.value = fields.sceneTags || '';
  els.emotionTags.value = fields.emotionTags || '';
  els.youtube.value = fields.youtube || '';
  els.videoDownload.value = fields.videoDownload || '';
  els.materialDownloads.value = fields.materialDownloads || '';
  els.relation.value = fields.relation || '';
  els.location.value = fields.location || '';
  els.peopleCount.value = fields.peopleCount || '';
  els.recordRowOutput.value = '';
  els.embeddingRowOutput.value = '';
}

function fillFromLegacyColumns(columns) {
  const embeddingRaw = String(columns[11] || '').trim();
  let parsedEmbedding = [];
  if (embeddingRaw) {
    try {
      parsedEmbedding = JSON.parse(embeddingRaw);
    } catch {
      parsedEmbedding = [];
    }
  }

  fillForm({
    id: '',
    original: columns[0] || '',
    meaning: columns[1] || '',
    synonyms: columns[2] || '',
    sceneTags: columns[3] || '',
    emotionTags: columns[4] || '',
    youtube: columns[5] || '',
    videoDownload: columns[6] || '',
    materialDownloads: columns[7] || '',
    relation: columns[8] || '',
    location: columns[9] || '',
    peopleCount: columns[10] || '',
  }, Array.isArray(parsedEmbedding) ? parsedEmbedding : []);
}

function fillFromRecordColumns(columns) {
  fillForm({
    id: columns[0] || '',
    original: columns[1] || '',
    meaning: columns[2] || '',
    synonyms: columns[3] || '',
    sceneTags: columns[4] || '',
    emotionTags: columns[5] || '',
    relation: columns[6] || '',
    location: columns[7] || '',
    peopleCount: columns[8] || '',
    youtube: columns[9] || '',
    videoDownload: columns[10] || '',
    materialDownloads: columns[11] || '',
  });
}

function isLegacyRecordColumns(columns) {
  const tail = String(columns[11] || '').trim();
  return columns.length >= 12 && (tail.startsWith('[') || tail.startsWith('"['));
}

function fillEmbeddingRow(columns) {
  const embeddingRaw = String(columns[1] || '').trim();
  if (!embeddingRaw) return;
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

  if (!fields.id) {
    fields.id = await fetchNextNumericId();
    els.recordId.value = fields.id;
  }

  els.generateBtn.disabled = true;
  setStatus('正在生成 embedding...');

  try {
    const searchText = buildSearchText(fields);
    const embeddingRaw = await generateEmbedding(searchText);
    const embedding = normalizeEmbedding(embeddingRaw);

    els.recordRowOutput.value = buildRecordCsvRow(fields);
    els.embeddingRowOutput.value = buildEmbeddingCsvRow(fields.id, embedding);

    setStatus(`生成完成（id: ${fields.id}，维度 ${embedding.length}）`);
  } catch (error) {
    console.error(error);
    setStatus(`生成失败：${error.message}`);
  } finally {
    els.generateBtn.disabled = false;
  }
});

els.copyEmbeddingBtn.addEventListener('click', async () => {
  const raw = String(els.embeddingRowOutput.value || '').trim();
  if (!raw) return;
  const columns = parseCsvLine(raw);
  await copyText(columns[1] || '');
});

els.copyRecordRowBtn.addEventListener('click', async () => {
  await copyText(els.recordRowOutput.value);
});

els.copyEmbeddingRowBtn.addEventListener('click', async () => {
  await copyText(els.embeddingRowOutput.value);
});

els.parseRowBtn.addEventListener('click', () => {
  const raw = String(els.parseRowInput.value || '').trim();
  if (!raw) {
    setStatus('请先粘贴 CSV 行');
    return;
  }

  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsedLines = lines.map((line) => parseCsvLine(line));
  const recordLine = parsedLines.find((columns) => columns.length >= 12);
  const embeddingLine = parsedLines.find((columns) => columns.length === 2);

  if (!recordLine) {
    setStatus(`解析失败：未识别到记录行（当前 ${parsedLines.length} 行）`);
    return;
  }

  if (isLegacyRecordColumns(recordLine)) {
    fillFromLegacyColumns(recordLine);
  } else if (recordLine.length >= 12) {
    fillFromRecordColumns(recordLine);
  }

  if (embeddingLine) {
    const currentId = normalizeText(els.recordId.value);
    const embeddingId = normalizeText(embeddingLine[0]);
    if (!currentId && embeddingId) {
      els.recordId.value = embeddingId;
    }
    if (!currentId || !embeddingId || currentId === embeddingId) {
      fillEmbeddingRow(embeddingLine);
    }
  }

  const finalFields = collectFields();
  setStatus(`解析完成：识别 ${parsedLines.length} 行，当前 id ${finalFields.id || '待生成'}`);
});

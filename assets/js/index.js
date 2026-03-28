import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

const DATA_CSV_PATH = '../../data/search_records.csv';
const MODEL_ID = 'Xenova/bge-small-zh-v1.5';
const QUERY_INSTRUCTION = '为这个句子生成表示以用于检索相关片段：';

const queryInput = document.getElementById('query');
const searchBtn = document.getElementById('searchBtn');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const examplesEl = document.getElementById('examples');
const modeKeywordBtn = document.getElementById('mode-keyword');
const modeSemanticBtn = document.getElementById('mode-semantic');

let searchMode = 'keyword';
let records = [];
let extractor = null;
let extractorLoadingPromise = null;
let searchSeq = 0;

const exampleQueries = [
  '压力大但是还想坚持',
  '先做完再优化',
  '我有点害怕，不敢开始',
  '被误解很委屈',
];

function getYoutubeEmbed(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';

  let videoId = '';
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./, '');
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    if (host === 'youtu.be') {
      videoId = pathParts[0] || '';
    } else if (host.endsWith('youtube.com')) {
      if (parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v') || '';
      } else if (pathParts[0] === 'shorts' || pathParts[0] === 'embed' || pathParts[0] === 'live') {
        videoId = pathParts[1] || '';
      }
    }
  } catch {
    const match = raw.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    videoId = match ? match[1] : '';
  }

  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return '';
  return `https://www.youtube.com/embed/${videoId}?rel=0`;
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '').trim();
}

function splitKeywords(query) {
  const normalized = String(query || '').trim();
  if (!normalized) return [];
  const bySeparators = normalized
    .split(/[,\s，。；;、|]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  return bySeparators.length ? bySeparators : [normalized];
}

function parsePipeList(value) {
  return String(value || '')
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseEmbedding(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) return [];
    return data.map((n) => Number(n));
  } catch {
    return [];
  }
}

function normalizeDownloadUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function parseCsv(text) {
  const rows = [];
  let current = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

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
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(current);
      current = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      continue;
    }

    current += char;
  }

  if (current.length || row.length) {
    row.push(current);
    if (row.some((cell) => cell !== '')) rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const item = {};
    headers.forEach((key, index) => {
      item[key] = (cells[index] || '').trim();
    });
    return item;
  });
}

function mapCsvRowsToRecords(rows) {
  return rows.map((item) => ({
    original: item.original || '',
    meaning: item.meaning || '',
    synonyms: parsePipeList(item.synonyms),
    sceneTags: parsePipeList(item.scene_tags),
    emotionTags: parsePipeList(item.emotion_tags),
    youtube: item.youtube || '',
    videoDownload: normalizeDownloadUrl(item.video_download),
    embedding: parseEmbedding(item.embedding),
  }));
}

function dot(a, b) {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
}

function scoreRecordKeyword(record, keywords) {
  if (!keywords.length) return 1;
  const original = normalize(record.original);
  const meaning = normalize(record.meaning);
  const synonymText = normalize(record.synonyms.join(' '));
  const sceneText = normalize(record.sceneTags.join(' '));
  const moodText = normalize(record.emotionTags.join(' '));

  let score = 0;
  keywords.forEach((keywordRaw) => {
    const keyword = normalize(keywordRaw);
    if (!keyword) return;
    if (original.includes(keyword)) score += 6;
    if (meaning.includes(keyword)) score += 4;
    if (synonymText.includes(keyword)) score += 5;
    if (sceneText.includes(keyword)) score += 3;
    if (moodText.includes(keyword)) score += 3;
  });
  return score;
}

function renderTags(list, kind) {
  return list.map((t) => `<span class="tag ${kind}">${t}</span>`).join('');
}

function formatScore(score, scoreType) {
  if (typeof score !== 'number' || Number.isNaN(score)) return '';
  if (scoreType === 'semantic') {
    const percent = ((Math.max(-1, Math.min(1, score)) + 1) / 2) * 100;
    return `相关度 ${percent.toFixed(2)}%`;
  }
  return `相关度 ${Math.round(score)} 分`;
}

function render(recordsToShow, options = {}) {
  const { showScore = false, scoreType = 'semantic' } = options;
  const rows = recordsToShow.map((item) => (item && item.record ? item : { record: item, score: null }));

  countEl.textContent = `当前结果 ${rows.length} 条`;

  if (!rows.length) {
    resultsEl.innerHTML = '<div class="empty">没有匹配结果，换个说法试试。</div>';
    return;
  }

  resultsEl.innerHTML = rows
    .map((item, index) => {
      const r = item.record;
      const embed = getYoutubeEmbed(r.youtube);
      const scoreText = showScore ? formatScore(item.score, scoreType) : '';
      return `
        ${index === 0 ? `
          <div class="row head">
            <div class="col">原句</div>
            <div class="col">这句话表达的意思</div>
            <div class="col">适合搜索的近义说法</div>
            <div class="col">场景标签</div>
            <div class="col">情绪标签</div>
            <div class="col">视频片段（YouTube）</div>
          </div>
        ` : ''}
        <article class="row">
          <div class="col text">
            ${scoreText ? `<div class="score-pill">${scoreText}</div>` : ''}
            <div>${r.original}</div>
          </div>
          <div class="col text">${r.meaning}</div>
          <div class="col"><div class="tag-list">${renderTags(r.synonyms, 'synonym')}</div></div>
          <div class="col"><div class="tag-list">${renderTags(r.sceneTags, 'scene')}</div></div>
          <div class="col"><div class="tag-list">${renderTags(r.emotionTags, 'mood')}</div></div>
          <div class="col">
            <div class="video-wrap">
              <iframe src="${embed}" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
            </div>
            ${r.videoDownload ? `<div class="video-download-wrap"><a class="video-download-link" href="${r.videoDownload}" data-download-url="${r.videoDownload}">下载视频</a></div>` : ''}
          </div>
        </article>
      `;
    })
    .join('');
}

async function getExtractor() {
  if (extractor) return extractor;
  if (extractorLoadingPromise) return extractorLoadingPromise;

  statusEl.textContent = '语义模型加载中...';
  extractorLoadingPromise = pipeline('feature-extraction', MODEL_ID)
    .then((instance) => {
      extractor = instance;
      return instance;
    })
    .finally(() => {
      extractorLoadingPromise = null;
    });

  return extractorLoadingPromise;
}

async function embedQuery(query) {
  const model = await getExtractor();
  const output = await model(`${QUERY_INSTRUCTION}${query}`, {
    pooling: 'cls',
    normalize: true,
  });

  const list = typeof output.tolist === 'function' ? output.tolist() : output;
  return Array.isArray(list[0]) ? list[0] : list;
}

async function semanticSearch(query) {
  const queryVector = await embedQuery(query);

  return records
    .filter((record) => Array.isArray(record.embedding) && record.embedding.length > 0)
    .map((record) => ({
      record,
      score: dot(queryVector, record.embedding),
    }))
    .sort((a, b) => b.score - a.score);
}

async function search() {
  const seq = ++searchSeq;
  const rawQuery = queryInput.value;
  const qText = normalize(rawQuery);

  if (!qText) {
    render(records);
    statusEl.textContent = `已加载 ${records.length} 条语料（CSV + embedding）`;
    return;
  }

  searchBtn.disabled = true;

  try {
    let matched;
    if (searchMode === 'keyword') {
      const keywords = splitKeywords(rawQuery);
      matched = records
        .map((record) => ({
          record,
          score: scoreRecordKeyword(record, keywords),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
      if (seq !== searchSeq) return;
      render(matched, { showScore: true, scoreType: 'keyword' });
      statusEl.textContent = `关键词搜索：${rawQuery}`;
      return;
    }

    statusEl.textContent = `语义搜索中：${rawQuery}`;
    matched = await semanticSearch(rawQuery);
    if (seq !== searchSeq) return;
    render(matched, { showScore: true, scoreType: 'semantic' });
    statusEl.textContent = `语义搜索（embedding）：${rawQuery}`;
  } catch (error) {
    console.error(error);
    if (seq !== searchSeq) return;
    statusEl.textContent = `搜索失败：${error.message}`;
  } finally {
    if (seq === searchSeq) {
      searchBtn.disabled = false;
    }
  }
}

function setMode(mode) {
  searchMode = mode;
  modeKeywordBtn.classList.toggle('active', mode === 'keyword');
  modeSemanticBtn.classList.toggle('active', mode === 'semantic');
  search();
}

function renderExamples() {
  examplesEl.innerHTML = exampleQueries
    .map((q) => `<button class="chip" type="button" data-q="${q}">${q}</button>`)
    .join('');

  examplesEl.addEventListener('click', (event) => {
    const target = event.target.closest('button[data-q]');
    if (!target) return;
    queryInput.value = target.dataset.q || '';
    search();
  });
}

async function init() {
  try {
    statusEl.textContent = '正在加载 CSV 数据...';
    const response = await fetch(DATA_CSV_PATH);
    if (!response.ok) {
      throw new Error(`读取 CSV 失败: HTTP ${response.status}`);
    }

    const csvText = await response.text();
    const rows = parseCsv(csvText);
    records = mapCsvRowsToRecords(rows).filter((r) => r.original || r.meaning);

    renderExamples();
    render(records);

    const validEmbeddingCount = records.filter((r) => r.embedding.length > 0).length;
    statusEl.textContent = `已加载 ${records.length} 条语料（CSV + embedding ${validEmbeddingCount}/${records.length}）`;
    countEl.textContent = `当前结果 ${records.length} 条`;
  } catch (error) {
    console.error(error);
    statusEl.textContent = 'CSV 加载失败，请检查 data/search_records.csv';
    resultsEl.innerHTML = `<div class="empty">CSV 加载失败：${error.message}</div>`;
    countEl.textContent = '当前结果 0 条';
  }
}

searchBtn.addEventListener('click', search);
queryInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') search();
});
modeKeywordBtn.addEventListener('click', () => setMode('keyword'));
modeSemanticBtn.addEventListener('click', () => setMode('semantic'));
resultsEl.addEventListener('click', (event) => {
  const link = event.target.closest('.video-download-link');
  if (!link) return;
  event.preventDefault();

  const url = link.dataset.downloadUrl || link.getAttribute('href') || '';
  if (!url) return;

  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noreferrer';
  const last = url.split('/').pop() || 'video';
  a.download = decodeURIComponent(last.split('?')[0]) || 'video';
  document.body.appendChild(a);
  a.click();
  a.remove();
  statusEl.textContent = '下载链接已触发';
});

init();

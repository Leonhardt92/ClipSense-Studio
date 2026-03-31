import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

function getBasePath() {
  const path = window.location.pathname || '/';
  if (path.endsWith('/')) return path;

  const last = path.split('/').pop() || '';
  if (last.includes('.')) {
    return path.slice(0, path.lastIndexOf('/') + 1) || '/';
  }
  return `${path}/`;
}

const DATA_CSV_CANDIDATES = [
  `${window.location.origin}${getBasePath()}data/search_records.csv`,
  `${window.location.origin}/data/search_records.csv`,
  './data/search_records.csv',
  'data/search_records.csv',
];
const MODEL_ID = 'Xenova/bge-small-zh-v1.5';
const QUERY_INSTRUCTION = '为这个句子生成表示以用于检索相关片段：';

const queryInput = document.getElementById('query');
const searchBtn = document.getElementById('searchBtn');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const examplesEl = document.getElementById('examples');
const columnPickerEl = document.getElementById('column-picker');
const modeKeywordBtn = document.getElementById('mode-keyword');
const modeSemanticBtn = document.getElementById('mode-semantic');

let searchMode = 'keyword';
let records = [];
let extractor = null;
let extractorLoadingPromise = null;
let searchSeq = 0;

const COLUMN_STORAGE_KEY = 'clipsense-visible-columns';
const COLUMN_DEFS = [
  { key: 'original', label: '原句', width: '1.2fr', render: (r, scoreText) => `
      <div class="col text">
        ${scoreText ? `<div class="score-pill">${scoreText}</div>` : ''}
        <div>${r.original}</div>
      </div>
    ` },
  { key: 'meaning', label: '这句话表达的意思', width: '1.5fr', render: (r) => `<div class="col text">${r.meaning}</div>` },
  { key: 'synonyms', label: '适合搜索的近义说法', width: '1.4fr', render: (r) => `<div class="col"><div class="tag-list">${renderTags(r.synonyms, 'synonym')}</div></div>` },
  { key: 'sceneTags', label: '场景标签', width: '0.9fr', render: (r) => `<div class="col"><div class="tag-list">${renderTags(r.sceneTags, 'scene')}</div></div>` },
  { key: 'emotionTags', label: '情绪标签', width: '0.9fr', render: (r) => `<div class="col"><div class="tag-list">${renderTags(r.emotionTags, 'mood')}</div></div>` },
  { key: 'locations', label: '地点', width: '0.8fr', render: (r) => `<div class="col"><div class="tag-list">${renderTags(r.locations, 'meta')}</div></div>` },
  { key: 'relations', label: '关系', width: '0.8fr', render: (r) => `<div class="col"><div class="tag-list">${renderTags(r.relations, 'meta')}</div></div>` },
  { key: 'peopleCounts', label: '人数', width: '0.7fr', render: (r) => `<div class="col"><div class="tag-list">${renderTags(r.peopleCounts, 'meta')}</div></div>` },
  { key: 'video', label: '视频片段（YouTube）', width: '280px', render: (r) => {
      const embed = getYoutubeEmbed(r.youtube);
      return `
        <div class="col">
          ${embed ? `
            <div class="video-wrap">
              <iframe src="${embed}" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
            </div>
          ` : '<div class="empty">暂无可播放视频</div>'}
          ${renderDownloadLinks(r.videoDownloads, '下载视频')}
          ${renderDownloadLinks(r.materialDownloads, '下载素材')}
        </div>
      `;
    } },
];
let visibleColumnKeys = loadVisibleColumns();

const exampleQueries = [
  '压力大但是还想坚持',
  '先做完再优化',
  '我有点害怕，不敢开始',
  '被误解很委屈',
];

function loadVisibleColumns() {
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!raw) return COLUMN_DEFS.map((item) => item.key);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return COLUMN_DEFS.map((item) => item.key);
    const valid = parsed.filter((key) => COLUMN_DEFS.some((item) => item.key === key));
    return valid.length ? valid : COLUMN_DEFS.map((item) => item.key);
  } catch {
    return COLUMN_DEFS.map((item) => item.key);
  }
}

function saveVisibleColumns() {
  try {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(visibleColumnKeys));
  } catch {
    // ignore storage failure
  }
}

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

function isYoutubeUrl(url) {
  return Boolean(getYoutubeEmbed(url));
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

function parseDownloadUrls(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  const matches = raw.match(/https?:\/\/[^\s|，,]+/g) || [];
  const normalized = matches
    .map((item) => normalizeDownloadUrl(item))
    .filter(Boolean);

  return [...new Set(normalized)];
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
  const youtubeIndex = headers.indexOf('youtube');
  const videoDownloadIndex = headers.indexOf('video_download');
  const materialIndex = headers.indexOf('material_downloads');
  const embeddingIndex = headers.indexOf('embedding');
  return rows.slice(1).map((cells) => {
    let normalizedCells = [...cells];
    if (
      materialIndex >= 0 &&
      embeddingIndex === headers.length - 1 &&
      cells.length === headers.length - 1
    ) {
      normalizedCells = [...cells.slice(0, materialIndex), '', cells[materialIndex]];
    }

    // Backward compatibility for older exported rows:
    // youtube is empty, the YouTube URL was written into video_download,
    // the real video download URL was written into material_downloads,
    // and an extra empty column was inserted before embedding.
    if (
      youtubeIndex >= 0 &&
      videoDownloadIndex >= 0 &&
      materialIndex >= 0 &&
      embeddingIndex >= 0 &&
      cells.length === headers.length + 1 &&
      !String(cells[youtubeIndex] || '').trim() &&
      isYoutubeUrl(cells[videoDownloadIndex]) &&
      !String(cells[embeddingIndex] || '').trim()
    ) {
      normalizedCells = headers.map((_, index) => {
        if (index < youtubeIndex) return cells[index] || '';
        if (index === youtubeIndex) return cells[videoDownloadIndex] || '';
        if (index === videoDownloadIndex) return cells[materialIndex] || '';
        if (index === materialIndex) return '';
        if (index >= embeddingIndex) return cells[index + 1] || '';
        return cells[index] || '';
      });
    }

    const item = {};
    headers.forEach((key, index) => {
      item[key] = (normalizedCells[index] || '').trim();
    });
    return item;
  });
}

function mapCsvRowsToRecords(rows) {
  return rows.map((item) => {
    let youtube = item.youtube || '';
    let videoDownloadRaw = item.video_download || '';
    let materialDownloadRaw = item.material_downloads || item.material_download || item.asset_downloads || '';

    if (!youtube && isYoutubeUrl(videoDownloadRaw)) {
      youtube = videoDownloadRaw;
      videoDownloadRaw = materialDownloadRaw;
      materialDownloadRaw = '';
    }

    if (!videoDownloadRaw && /youtube\.com\/download_my_video/i.test(materialDownloadRaw)) {
      videoDownloadRaw = materialDownloadRaw;
      materialDownloadRaw = '';
    }

    return {
      original: item.original || '',
      meaning: item.meaning || '',
      synonyms: parsePipeList(item.synonyms),
      sceneTags: parsePipeList(item.scene_tags),
      emotionTags: parsePipeList(item.emotion_tags),
      locations: parsePipeList(item.location || item.locations || item.place || item.地点),
      relations: parsePipeList(item.relation || item.relationship || item.关系),
      peopleCounts: parsePipeList(item.people_count || item.people_counts || item.count || item.人数),
      youtube,
      videoDownloads: parseDownloadUrls(videoDownloadRaw),
      materialDownloads: parseDownloadUrls(materialDownloadRaw),
      embedding: parseEmbedding(item.embedding),
    };
  });
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
  const locationText = normalize(record.locations.join(' '));
  const relationText = normalize(record.relations.join(' '));
  const peopleCountText = normalize(record.peopleCounts.join(' '));

  let score = 0;
  keywords.forEach((keywordRaw) => {
    const keyword = normalize(keywordRaw);
    if (!keyword) return;
    if (original.includes(keyword)) score += 6;
    if (meaning.includes(keyword)) score += 4;
    if (synonymText.includes(keyword)) score += 5;
    if (sceneText.includes(keyword)) score += 3;
    if (moodText.includes(keyword)) score += 3;
    if (locationText.includes(keyword)) score += 3;
    if (relationText.includes(keyword)) score += 3;
    if (peopleCountText.includes(keyword)) score += 2;
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

function renderDownloadLinks(urls, label) {
  if (!Array.isArray(urls) || !urls.length) return '';

  return `
    <div class="video-download-wrap">
      ${urls
        .map((url, index) => `
          <a class="video-download-link" href="${url}" data-download-url="${url}">
            ${urls.length > 1 ? `${label} ${index + 1}` : label}
          </a>
        `)
        .join('')}
    </div>
  `;
}

function getVisibleColumns() {
  return COLUMN_DEFS.filter((item) => visibleColumnKeys.includes(item.key));
}

function escapeAttr(value) {
  return String(value || '').replace(/"/g, '&quot;');
}

function renderColumnPicker() {
  if (!columnPickerEl) return;
  columnPickerEl.innerHTML = COLUMN_DEFS
    .map((item) => `
      <label class="column-toggle">
        <input
          type="checkbox"
          data-column-key="${escapeAttr(item.key)}"
          ${visibleColumnKeys.includes(item.key) ? 'checked' : ''}
        />
        <span>${item.label}</span>
      </label>
    `)
    .join('');
}

function render(recordsToShow, options = {}) {
  const { showScore = false, scoreType = 'semantic' } = options;
  const rows = recordsToShow.map((item) => (item && item.record ? item : { record: item, score: null }));
  const visibleColumns = getVisibleColumns();
  const gridColumns = visibleColumns.map((item) => item.width).join(' ');
  const minWidth = visibleColumns.reduce((sum, item) => {
    if (item.width.endsWith('px')) return sum + Number.parseInt(item.width, 10);
    return sum + 180;
  }, 0);

  countEl.textContent = `当前结果 ${rows.length} 条`;

  if (!rows.length) {
    resultsEl.innerHTML = '<div class="empty">没有匹配结果，换个说法试试。</div>';
    resultsEl.style.setProperty('--grid-columns', gridColumns);
    resultsEl.style.setProperty('--results-min-width', `${Math.max(minWidth, 720)}px`);
    return;
  }

  resultsEl.style.setProperty('--grid-columns', gridColumns);
  resultsEl.style.setProperty('--results-min-width', `${Math.max(minWidth, 720)}px`);

  resultsEl.innerHTML = rows
    .map((item, index) => {
      const r = item.record;
      const scoreText = showScore ? formatScore(item.score, scoreType) : '';
      return `
        ${index === 0 ? `
          <div class="row head">
            ${visibleColumns.map((column) => `<div class="col">${column.label}</div>`).join('')}
          </div>
        ` : ''}
        <article class="row">
          ${visibleColumns.map((column) => column.render(r, scoreText)).join('')}
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

function handleColumnPickerChange(event) {
  const target = event.target.closest('input[data-column-key]');
  if (!target) return;

  const key = target.dataset.columnKey || '';
  if (!key) return;

  if (target.checked) {
    if (!visibleColumnKeys.includes(key)) {
      visibleColumnKeys = [...visibleColumnKeys, key];
    }
  } else {
    const next = visibleColumnKeys.filter((item) => item !== key);
    if (!next.length) {
      target.checked = true;
      statusEl.textContent = '至少保留一列显示';
      return;
    }
    visibleColumnKeys = next;
  }

  saveVisibleColumns();
  search();
}

async function init() {
  try {
    statusEl.textContent = '正在加载 CSV 数据...';
    let response = null;
    let resolvedCsvPath = '';

    for (const path of DATA_CSV_CANDIDATES) {
      try {
        const res = await fetch(path, { cache: 'no-store' });
        if (res.ok) {
          response = res;
          resolvedCsvPath = path;
          break;
        }
      } catch {
        // try next candidate
      }
    }

    if (!response) {
      throw new Error('读取 CSV 失败：所有候选路径都不可用');
    }

    const csvText = await response.text();
    const rows = parseCsv(csvText);
    records = mapCsvRowsToRecords(rows).filter((r) => r.original || r.meaning);

    renderExamples();
    renderColumnPicker();
    render(records);

    const validEmbeddingCount = records.filter((r) => r.embedding.length > 0).length;
    statusEl.textContent = `已加载 ${records.length} 条语料（CSV + embedding ${validEmbeddingCount}/${records.length}）`;
    console.info('[CSV] loaded from:', resolvedCsvPath);
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
columnPickerEl.addEventListener('change', handleColumnPickerChange);
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

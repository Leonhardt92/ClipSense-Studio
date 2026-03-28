# 句影检索台 (ClipSense Studio)

句影检索台是一个纯前端小工具集合，包含：

- 句子检索（关键词 + embedding 语义搜索）
- CSV 记录回填与 embedding 生成
- 媒体工具（多图转视频、视频拆图、音频转视频）

## 页面入口

- `index.html`：检索页面
- `embed-builder.html`：CSV 字段编辑 + embedding 生成
- `media-tools.html`：媒体转换工具

三个页面顶部都有横向导航，可互相跳转。

## 数据文件

主数据文件：

- `data/search_records.csv`

CSV 表头顺序：

```csv
original,meaning,synonyms,scene_tags,emotion_tags,youtube,video_download,embedding
```

字段说明：

- `original`：原句
- `meaning`：这句话表达的意思
- `synonyms`：近义搜索词，使用 `|` 分隔
- `scene_tags`：场景标签，使用 `|` 分隔
- `emotion_tags`：情绪标签，使用 `|` 分隔
- `youtube`：YouTube 链接（支持 watch / shorts / youtu.be）
- `video_download`：可下载链接（为空则 index 不显示“下载视频”）
- `embedding`：向量 JSON 数组

## 本地运行

建议用静态服务器打开（不要直接双击 html）：

```bash
python3 -m http.server 8080
```

访问：

```text
http://localhost:8080/
```

## 典型工作流（更新某条记录 embedding）

1. 打开 `embed-builder.html`
2. 把现有 CSV 单行粘贴到“从现有 CSV 单行解析并回填”
3. 点击“解析并填充表单”
4. 修改你要改的字段
5. 点击“生成 embedding”
6. 复制“完整 CSV 行”覆盖回 `data/search_records.csv`

## AI 归类模板

你可以先让 AI 根据视频/图片产出 CSV 前几列，再转 embedding：

- `templates/csv_ai_mask_prompt.md`

## 备注

- 首次语义搜索或生成 embedding 时，会在浏览器下载模型，速度取决于网络环境。
- 本项目当前不依赖 Node.js，可直接以静态文件方式运行。

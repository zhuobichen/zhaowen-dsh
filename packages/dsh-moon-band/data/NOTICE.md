# poems.txt 的来源

`poems.txt` 是从 [chinese-poetry/chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)（**MIT** 许可）抽出来的：

- `全唐诗/poet.tang.*.json` → 取每首诗的第一段（通常就是一联），取前 30000 条
- `宋词/ci.song.*.json` → 同上，全部 16167 条
- 去重（同一句只留一条）、只保留纯中文与中文标点、长度 8–32 字的句子
- **全唐诗原文是繁体，用 OpenCC（t2s）转成了简体**，因为宋词那半是简体，混着会在屏幕上繁简交替
- 格式：每行 `<诗句>\t<作者《篇名》>`

现在 46167 条，3.18 MiB。

两条要注意的：

1. **4 MiB 是硬上限**：mod 用 `$.fs.read` 读它，超过 4 MiB 会被拒。加语料前先看文件大小。
2. **转简可能有个别字不准**（OpenCC 是为普通文本做的，诗句没有上下文）。要按原文核对某一首，去上游仓库看繁体原文。

重新生成：`tools/build_poems.py`（脚本头部的路径指向下载下来的语料目录）。

# rea-video（DSH 插件）

把 [rea-video](https://github.com/JuneYaooo/rea-video) 接进 DSH：**逐镜头拆解任意视频是拍的、AI 生成的还是代码做的，并给出复刻方案**。

上游是纯 Python CLI，不做 MCP，所以这里包一层：给 agent 一个稳定入口，并把 ffmpeg 塞进 PATH（本机 ffmpeg 不在 PATH）。

## 安装了什么

| 东西 | 位置 |
|---|---|
| `rea-video` CLI | `%APPDATA%\Python\Python311\Scripts\rea-video.exe`（`pip install -e <repo>` 装的） |
| rea-video 仓库 | `D:\github_project\ZhaoWen_GitHub维护\rea-video` |
| ffmpeg 7.1 | `D:\github_project\ZhaoWen_GitHub维护\_tools\ffmpeg\bin\ffmpeg.exe`（来自 `imageio-ffmpeg`，不污染全局 PATH） |
| skill | `dsh\home\skills\rea-video`（判定标准、报告模板、review 流程都在里面） |

## 工具

`rea_video_cli` —— 参数 `args` 是完整命令行数组：

```json
{"args": ["decompose", "D:\\videos\\a.mp4", "--lang", "zh"]}
```

常用子命令：

| 子命令 | 作用 |
|---|---|
| `decompose <video>` | 逐镜拆解（主力）：抽帧、OCR、判定实拍/AI/3D/2D/录屏，产出 `report.html` + `breakdown.json` |
| `summary <dir>` | 打印已有拆解结论 |
| `tiles <dir>` | 抽帧拼图，给能看图的 agent 复核 |
| `probe <video>` | 只看元数据/来源 |
| `prefs` / `memory` | 查看偏好与记忆 |

子命令白名单：`decompose stems probe capsule remake-plan remake-run capsule-draft assemble tiles summary review apply-review correct prefs memory eval`。

## 关键选项

- `--lang zh|en`：报告语言（默认 zh）
- `--no-vlm`：不调视觉模型（默认没有配 VLM key，建议关）
- `--no-packaging`：跳过包装层分析，每镜省 30–50 秒
- `--out <dir>`：指定输出目录
- `--workers <n>`：并发

## 注意

- **时间**：一条 1 分钟的视频，抽帧 + OCR + 判定大概几分钟到十几分钟；工具超时上限 15 分钟。
- **VLM**：想让"实拍 vs AI"判得更准、并且给每个镜头反推 prompt，需要配视频模型（Gemini 或豆包）。不配也能跑：不确定的镜头会标"待确认"，agent 可以自己看 `tiles` 复核。
- **报告**：默认写在视频同级的 `rea-video` 工作目录里，`report.html` 可以直接打开。
- 处理的是你自己的视频；不要拿别人的素材做越界的事。

"""给全局 dsh 的 headless runner 打补丁，让它：
1. 把工具调用（tool/call）实时输出到 stderr（⚙ 行）
2. 把 assistant 流式文本（text-delta）实时输出到 stdout（打字机）
3. 不再在任务结束时重复输出最终文本

幂等：可重复运行。修改前会备份为 index.js.bak（若尚未备份）。
"""
import io
import os

# 全局 npm 模块路径：按当前用户的 APPDATA 动态解析，不写死用户名（换机/换用户也能跑）
_PKG_REL = r"npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-headless\lib\index.js"
P = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~/AppData/Roaming")), _PKG_REL)

if not os.path.exists(P):
    print(f"NOT_FOUND: {P}")
    print("请先全局安装 DeepSeek Harness：npm install -g @deepseek-ai/dsh")
    raise SystemExit(1)

with io.open(P, "r", encoding="utf-8") as f:
    c = f.read()

# 已 patch 过则跳过
if "text-delta" in c and "⚙" in c:
    print("ALREADY_PATCHED")
    raise SystemExit(0)

# 备份原始（仅当备份不存在时）
bak = P + ".bak"
if not os.path.exists(bak):
    with io.open(bak, "w", encoding="utf-8") as f:
        f.write(c)
    print("BACKED_UP")

# 若之前打过工具调用补丁，先恢复原始，再做完整补丁
if "⚙" in c and "text-delta" not in c:
    with io.open(bak, "r", encoding="utf-8") as f:
        c = f.read()

# 1. 注入监听器（工具调用 + 流式文本）
anchor = 'agent.followup(createUserMessage({\n\t\tcontent: [{\n\t\t\ttype: "text",\n\t\t\ttext: task\n\t\t}],\n\t\tsource: { kind: "user" }\n\t}));\n\tawait agent.whenIdle();'

injection = 'agent.followup(createUserMessage({\n\t\tcontent: [{\n\t\t\ttype: "text",\n\t\t\ttext: task\n\t\t}],\n\t\tsource: { kind: "user" }\n\t}));\n\tctx.on("session/event", (session, event) => {\n\t\tif (event.seq <= firstSeq) return;\n\t\tif (event.type === "tool/call") {\n\t\t\tconst { name: toolName, arguments: rawArgs } = event.data;\n\t\t\tlet preview = "";\n\t\t\ttry {\n\t\t\t\tconst parsed = JSON.parse(rawArgs);\n\t\t\t\tpreview = parsed.command ?? parsed.path ?? parsed.file_path ?? parsed.description ?? "";\n\t\t\t\tif (typeof preview !== "string") preview = JSON.stringify(preview);\n\t\t\t} catch {}\n\t\t\tio.stderr.write("\\n⚙  " + toolName + (preview ? ": " + String(preview).slice(0, 200) : "") + "\\n");\n\t\t}\n\t\tif (event.type === "assistant/chunk") {\n\t\t\tconst { chunk } = event.data;\n\t\t\tif (chunk.type === "text-delta" && typeof chunk.text === "string") {\n\t\t\t\tio.stdout.write(chunk.text);\n\t\t\t}\n\t\t}\n\t}, { global: true });\n\tawait agent.whenIdle();'

if anchor not in c:
    print("ANCHOR_NOT_FOUND")
    raise SystemExit(1)
c = c.replace(anchor, injection, 1)

# 2. 任务结束不再重复输出最终文本，只输出一个换行作为结束标记
old_write = 'io.stdout.write(outcome.text + "\\n");'
new_write = 'io.stdout.write("\\n");'
if old_write in c:
    c = c.replace(old_write, new_write, 1)

with io.open(P, "w", encoding="utf-8") as f:
    f.write(c)

print("PATCHED")

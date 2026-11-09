/**
 * 豆包桌面版生图后端（走 CDP 驱动它自己的对话界面）。
 *
 * 为什么要有这条：one-hub 上的 `gpt-image-2.5` 实测 2–4 分钟/张、而且中转**不回报模型名**，
 * 「到底跑的哪个模型」既证实不了也证伪不了。豆包桌面版实测 **约 15 秒/张、2048×2048**，
 * 且产物自带 AIGC 元数据（`ContentProducer: doubao`）—— 这是**可当场留下的证据**。
 *
 * 前提（缺一样都会失败，报错会明说）：
 *   1. 豆包桌面版正在运行，且**带 `--remote-debugging-port=<port>`** 启动
 *      （用同目录的 `start-doubao-debug.cmd`，它用独立 user-data-dir，不碰日常那个豆包）
 *   2. 那个实例**已登录**（首次要人工扫码一次）
 *
 * ⚠️ 产物有两个水印，调用方必须知道：
 *   - **可见水印**「豆包 AI 生成」烙在右下角像素里（不是叠加层，无法靠 CSS 去掉）
 *   - **AIGC 元数据**写进 PNG 的 XMP（国标 TC260 那套）
 *   本模块**不做裁剪**：裁不裁是使用方的决定，擅自裁会让人以为图是"干净"的。
 */
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";

// ---- 配置：由 createDoubaoDriver() 注入，不再在 import 时读环境变量 ----
export type DoubaoFormat = "png" | "jpg";

export interface DoubaoConfig {
  cdpUrl: string;
  minPx: number;
  timeoutMs: number;
  /** 是否每次点「新对话」。见下方 DEFAULT_DOUBAO_CONFIG 的说明。 */
  newChat: boolean;
  /** 视频生成的等待上限（生成 + 下载）。豆包自己说「预计 5 分钟」，留足余量。 */
  videoTimeoutMs: number;
}

/**
 * 默认配置。
 *
 * `newChat: false` = 接着当前那个会话发。我们只是要一张图，不值当每次都开新会话
 * （开一次要等页面切过去，豆包那边也会攒一堆只发过一句话的会话）。
 *
 * ⚠️ 复用会话有个**必须配套**的前提：那个会话里已经有上一轮的 `receive_message` 和成品图，
 * 所以发送前**必须**拍一张"现在页面上已有哪些图"的快照并排除掉，
 * 否则 `waitForImage` 会在发送后的第一次轮询里就把**上一轮的旧图**当成新结果返回
 * （跟之前"把自己送进去的底图当成结果"是同一类错）。这条已经在两条路径里都接上了。
 */
export const DEFAULT_DOUBAO_CONFIG: DoubaoConfig = {
  cdpUrl: "http://127.0.0.1:9333",
  minPx: 512,
  timeoutMs: 240000,
  newChat: false,
  videoTimeoutMs: 900000,
};

let cfg: DoubaoConfig = { ...DEFAULT_DOUBAO_CONFIG };

export interface DoubaoGenerateOptions {
  /** 绝对路径，**不带扩展名**；实际扩展名由返回的字节决定。 */
  outputBase: string;
  /** 合并进 sidecar 的额外字段（插件名、版本等）。 */
  extraMeta?: Record<string, unknown>;
  /** DSH 的取消信号（exec.signal）。接上它，用户点停止才真的停。 */
  signal?: AbortSignal;
}

export interface DoubaoEditOptions extends DoubaoGenerateOptions {
  images: string[];
}

export interface DoubaoResult {
  path: string;
  metaPath: string;
  format: DoubaoFormat;
  width: number;
  height: number;
  bytes: number;
  model: null;
  requestedModel: string;
  aigcMarker: Record<string, string> | null;
  durationMs: number;
}

export interface DoubaoDriver {
  generate(prompt: string, opts: DoubaoGenerateOptions): Promise<DoubaoResult>;
  edit(prompt: string, opts: DoubaoEditOptions): Promise<DoubaoResult>;
  generateVideo(prompt: string, opts: DoubaoVideoOptions): Promise<DoubaoVideoResult>;
  status(): Promise<DoubaoStatus>;
}

/**
 * 视频生成选项。
 *
 * `referenceImages` 是**身份锚点**，不是可选装饰：只给文字提示词时，模型会画出
 * 一个「泛化的蓝发女仆」；给了参考图，豆包会明说「以你上传的角色图作为唯一身份锚点」，
 * 脸型/发型/服装配色才会守住。想复刻某个已有角色，务必传图。
 */
export interface DoubaoVideoOptions {
  /** 绝对路径，**不带扩展名**；产物固定为 `.mp4`。 */
  outputBase: string;
  /** 参考图（1–4 张本地绝对路径）。传了就按图生视频。 */
  referenceImages?: string[];
  extraMeta?: Record<string, unknown>;
  /** DSH 的取消信号（exec.signal）。 */
  signal?: AbortSignal;
}

export interface DoubaoVideoResult {
  path: string;
  metaPath: string;
  format: "mp4";
  width: number;
  height: number;
  bytes: number;
  /** 秒 */
  durationSec: number;
  model: string | null;
  requestedModel: string;
  durationMs: number;
}

/**
 * 造一个豆包驱动。配置在闭包里定死，调用时不再读环境变量。
 * 所有公开入口都会先把当前配置装回模块级 `cfg`，再由内部函数使用。
 */
export function createDoubaoDriver(config: Partial<DoubaoConfig> = {}): DoubaoDriver {
  const resolved: DoubaoConfig = { ...DEFAULT_DOUBAO_CONFIG, ...config };
  const use = <T>(fn: () => Promise<T>): Promise<T> => {
    cfg = resolved;
    return fn();
  };

  return {
    generate: (prompt, opts) => use(() => generateImageViaDoubao(prompt, opts)),
    edit: (prompt, opts) => use(() => editImageViaDoubao(prompt, opts)),
    generateVideo: (prompt, opts) => use(() => generateVideoViaDoubao(prompt, opts)),
    status: () => use(() => doubaoStatus()),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 取消支持：DSH 每次工具调用都会给一个 `exec.signal`（caller-owned cancellation）。
 * 不接它的后果就是「用户点了停止，工具毫无反应」—— 在 host_exec 上刚吃过这个亏。
 * 这里把它存成模块级变量，每个公共入口进来时设置，长时间等待用 `pause()` 包一层。
 */
let abortSignal: AbortSignal | undefined;

function throwIfAborted(): void {
  if (abortSignal?.aborted) {
    throw new Error("操作已被用户取消（abort signal）—— 已中止，不再继续等待豆包。");
  }
}

/** 可取消的等待。所有轮询循环里的 sleep 都应该用它。 */
async function pause(ms: number): Promise<void> {
  throwIfAborted();
  await sleep(ms);
  throwIfAborted();
}

export interface DoubaoStatus {
  reachable: boolean;
  chatTargetUrl: string | null;
  /** 页面里能看到输入框 = 界面起来了（不等于已登录，登录要不要靠出图试出来） */
  composerVisible: boolean;
  error?: string;
}

interface Cdp {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  evalJs: (expr: string) => Promise<any>;
  close: () => void;
  /** 图片响应的 requestId，按 URL 索引（取原始字节用） */
  byUrl: Map<string, string>;
  /** 还在飞的附件上传请求 requestId */
  pendingUploads: Set<string>;
  /** 见过的附件上传请求总数（用来判断"豆包到底收下文件没有"） */
  uploadsSeen: number;
}

/** 连上豆包 chat 页的 CDP。连不上/没有 chat 页就抛带排查提示的错。 */
async function connect(): Promise<Cdp> {
  let list: any[];
  try {
    list = await (await fetch(cfg.cdpUrl + "/json/list")).json();
  } catch (e: any) {
    throw new Error(
      `连不上豆包的调试端口 ${cfg.cdpUrl}（${e?.message || e}）。` +
        `八成是豆包没带调试端口启动 —— 用 start-doubao-debug.cmd 起它，或用 DOUBAO_CDP_URL 指到对的端口。`
    );
  }
  const page = list.find((t) => t.type === "page" && String(t.url || "").includes("doubao-chat"));
  if (!page) {
    throw new Error(
      `调试端口通了，但没找到聊天页（doubao-chat）。当前 target: ` +
        list.map((t) => `${t.type}:${t.url}`).join(" | ")
    );
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map<number, (v: any) => void>();
  const byUrl = new Map<string, string>();
  const pendingUploads = new Set<string>();
  const cdp: Cdp = {
    send: () => Promise.resolve(null),
    evalJs: () => Promise.resolve(null),
    close: () => ws.close(),
    byUrl,
    pendingUploads,
    uploadsSeen: 0,
  };
  ws.addEventListener("message", (ev: any) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); return; }
    if (m.method === "Network.responseReceived") {
      const r = m.params.response;
      if (String(r.mimeType || "").startsWith("image/")) byUrl.set(r.url, m.params.requestId);
    }
    // 附件上传链路：prepare_upload → TOS → CommitImageUpload。
    // 「豆包收下文件没有」比 DOM 上任何东西都可靠，所以盯这条。
    if (m.method === "Network.requestWillBeSent" && /prepare_upload|CommitImageUpload|upload\/v1\/tos/.test(String(m.params.request.url))) {
      pendingUploads.add(m.params.requestId);
      cdp.uploadsSeen++;
    }
    if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") {
      pendingUploads.delete(m.params.requestId);
    }
  });
  await new Promise<void>((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", (e: any) => rej(new Error("CDP websocket 失败: " + (e?.message || "?"))));
  });
  // ⚠️ 每条 CDP 命令都必须有超时。
  //
  // 没有超时的时候，只要某一条 `Runtime.evaluate` 因为页面忙/求值太重而迟迟不回，
  // 这个 Promise 就**永远不会 settle** —— 工具调用挂死，UI 上的停止键也按不动
  // （同一个教训在 host_exec 上刚踩过一遍）。这里统一兜住：
  // 到点 resolve 一个带 error 的对象，上层把它当成"这一步失败"而不是干等。
  const SEND_TIMEOUT_MS = 30000;
  cdp.send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((res) => {
      const id = ++seq;
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        pending.delete(id);
        res({ error: { message: `CDP ${method} 超时（${SEND_TIMEOUT_MS}ms 无响应）` } });
      }, SEND_TIMEOUT_MS);
      pending.set(id, (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        res(v);
      });
      try {
        ws.send(JSON.stringify({ id, method, params }));
      } catch (e: any) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          pending.delete(id);
          res({ error: { message: `CDP 发送失败: ${e?.message || e}` } });
        }
      }
    });
  // websocket 断了也要把还在等的请求放掉，否则又是一处永久挂起。
  ws.addEventListener("close", () => {
    for (const [, resolve] of pending) resolve({ error: { message: "CDP websocket 已断开" } });
    pending.clear();
  });
  cdp.evalJs = async (expr: string) => {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r?.result?.result?.value;
  };
  await cdp.send("Network.enable");
  await cdp.send("Runtime.enable");
  // 图生图要往 file input 塞文件，必须开 DOM 域（`DOM.setFileInputFiles`）。
  await cdp.send("DOM.enable");
  return cdp;
}

export async function doubaoStatus(): Promise<DoubaoStatus> {
  try {
    const list = await (await fetch(cfg.cdpUrl + "/json/list")).json();
    const page = list.find((t: any) => t.type === "page" && String(t.url || "").includes("doubao-chat"));
    if (!page) return { reachable: true, chatTargetUrl: null, composerVisible: false };
    const cdp = await connect();
    const vis = await cdp.evalJs(
      `!!document.querySelector('div.tiptap.ProseMirror, [contenteditable="true"]')`
    );
    cdp.close();
    return { reachable: true, chatTargetUrl: page.url, composerVisible: !!vis };
  } catch (e: any) {
    return { reachable: false, chatTargetUrl: null, composerVisible: false, error: String(e?.message || e) };
  }
}

/**
 * 从 PNG 的 XMP 里捞 AIGC 标记（国标 TC260），捞出什么就报什么，捞不到不编。
 *
 * ⚠️ 这里踩过一次：XMP 里那截 JSON 是 **HTML 实体转义的**
 * （文件里写的是 `ContentProducer&quot;:&quot;doubao&quot;`，不是真引号）。
 * 不先解实体，`"key":"value"` 的提取正则一个都匹配不到，函数会返回 null ——
 * **看着像"这张图没有标记"，其实是解析器没读懂**。这正是"负结论要先排除假阴性"。
 */
export function readAigcMarker(buf: Buffer): Record<string, string> | null {
  const head = buf
    .subarray(0, Math.min(buf.length, 8192))
    .toString("latin1")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  // 锚点必须落在 JSON 的**左花括号**上。锚在 `ContentProducer` 上会把第一对键值
  // 切掉一半 —— 实测读出来的对象里就没有 `ContentProducer` 了（恰恰是最关键的那个字段）。
  const m = head.match(/\{[^{}]{0,60}ContentProducer[^{}]{0,240}\}/);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const kv of m[0].matchAll(/"([A-Za-z0-9_]+)"\s*:\s*"([^"]*)"/g)) out[kv[1]] = kv[2];
  return Object.keys(out).length ? out : null;
}

function dimsOf(buf: Buffer): { w: number; h: number; fmt: string } {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), fmt: "png" };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const mk = buf[i + 1];
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), fmt: "jpg" };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { w: 0, h: 0, fmt: "jpg" };
  }
  return { w: 0, h: 0, fmt: "bin" };
}

// ==================== 与豆包界面交互的公共步骤 ====================

/** 点侧栏的「新对话」（**无条件点**，不看 NEW_CHAT —— 自愈时要用）。 */
async function clickNewChat(cdp: Cdp): Promise<void> {
  await cdp.evalJs(`(() => { const vis=e=>!!e&&e.offsetParent!==null;
    const el=[...document.querySelectorAll('button,[role=button],div,span,a')]
      .find(e=>vis(e)&&/^新对话$/.test((e.innerText||'').trim()));
    if(el){el.click();return 'clicked';} return 'none'; })()`);
  await sleep(3000);
}

/** 点侧栏的「新对话」。NEW_CHAT=false 时整个跳过。 */
async function startNewChat(cdp: Cdp): Promise<void> {
  if (!cfg.newChat) return;
  await clickNewChat(cdp);
}

/** 输入框元素的选择器（可见的 ProseMirror 里最宽的那个） */
const COMPOSER_SEL = `[...document.querySelectorAll('div.tiptap.ProseMirror,[contenteditable="true"]')]
  .filter(e=>e.offsetParent!==null)
  .sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0]`;

/** 把焦点放到输入框并**全选**（输入前用来替换掉残留内容）。返回是否找到。 */
async function focusComposer(cdp: Cdp): Promise<boolean> {
  return !!(await cdp.evalJs(`(() => {
    const c=${COMPOSER_SEL};
    if(!c) return false;
    window.__dv=c; c.focus();
    const r=document.createRange(); r.selectNodeContents(c);
    const s=getSelection(); s.removeAllRanges(); s.addRange(r);
    return true; })()`));
}

/** 输入框（含附件区）里还有没有挂在待发送区的图 */
async function hasPendingAttachment(cdp: Cdp): Promise<boolean> {
  return !!(await cdp.evalJs(`(() => {
    const c=${COMPOSER_SEL};
    if(!c) return false;
    let b=c; for(let i=0;i<10&&b.parentElement;i++) b=b.parentElement;
    return [...b.querySelectorAll('img')].some(e=>(e.currentSrc||e.src||'').startsWith('blob:'));
  })()`));
}

/**
 * 清掉输入框里**上一轮残留**的附件。
 *
 * 为什么需要：附件不是文档节点，`selectAll`/`delete` 清不掉（见 `attachImages`），
 * **只有"成功发送"才会把它们带走**。所以任何一轮只要在发送前失败（等附件超时、
 * 回车没发出去……），那张图就留在输入框里了。而我们现在默认**复用会话**，
 * 于是下一轮会出现两种坏情况：
 *   - 改图：新老两张一起发出去，模型看到的是**两张**图（旧那张可能跟这次毫无关系）
 *   - 从零生图：本该只发文字，却带着一张残留图 → 悄悄变成一次"改图"
 * 两种都不报错，只是结果不对。所以这里在开始之前先查一次，有残留就**刷新页面**清干净。
 * （代价是丢掉当前会话 —— 但那本来就是"上一轮失败"留下的现场，清掉是对的。）
 */
async function clearStaleAttachments(cdp: Cdp): Promise<void> {
  if (!(await hasPendingAttachment(cdp))) return;
  await cdp.send("Page.reload");
  await sleep(9000);
}

/**
 * 只把焦点放回输入框，**完全不碰选区**。发送前用这个。
 *
 * ⚠️ 这里的关键是"别动 selection"，而不是"怎么动 selection"。
 * 内容编辑器（这里是 tiptap / ProseMirror）**不走浏览器的选区**，它自己维护一份。
 * 用 DOM 的 Range API 去摆光标，只会让两者不同步：DOM 上看着是个折叠光标，
 * ProseMirror 内部可能还认为是整段选中 —— 于是 Enter 被它当成
 * 「用换行替换选区」而不是「提交」，消息就发不出去。
 *
 * 实测对得上：`insertText` 之后**只 `focus()`** 两次都能发出去；
 * 换成先 `selectNodeContents` 再 `collapse` 就出现了发不出去的情况，
 * 而且输入框里会莫名其妙剩一个孤零零的换行。
 * 所以这里一个 Range 都不建。
 */
async function focusComposerOnly(cdp: Cdp): Promise<boolean> {
  return !!(await cdp.evalJs(`(() => {
    const c=${COMPOSER_SEL};
    if(!c) return false;
    window.__dv=c; c.focus();
    return true; })()`));
}


/**
 * 把本地图片塞进豆包的附件区（图生图的入口）。
 *
 * ⚠️ **走原生 `DOM.setFileInputFiles`，不要用合成 paste 事件。** 实测：
 *   - `setFileInputFiles` → 精确 **+1** 张
 *   - 页面内 dispatch 一个 `ClipboardEvent('paste')`（带 DataTransfer）→ **+2** 张
 *     （豆包对同一个 paste 事件处理了**两遍**；且与 `bubbles` 无关，
 *       `bubbles:false` 一样是两张 —— 所以不是冒泡到祖先监听器）
 * 另外附件**不是文档节点**：`execCommand('selectAll'/'delete')` 清不掉它
 * （实测 4→6→8 只增不减，而输入框 innerText 一直是空的），要清场只能刷新页面。
 *
 * 另外**必须有重试**：这个调用会返回成功但页面毫无反应（见函数内注释），
 * 判据要落在"上传链路有没有动"上，不能落在"调用返回没返回错"上。
 *
 * 图片 input 是**动态挂载**的（刚刷新完那几秒可能一个都查不到），所以这里轮询等它出现。
 * 页面上有两个 `input[type=file]`：accept 含 `.png/.jpg/.webp` 的那个是图片入口，
 * 另一个含一堆代码后缀（`dockerfile` 等）是「添加文件」。
 */
async function attachImages(cdp: Cdp, paths: string[]): Promise<void> {
  // ⚠️ 塞文件**必须带重试**，而且判据是"上传链路有没有动"，不是"setFileInputFiles 返回没返回错"。
  // 实测：这个调用会**返回成功但页面毫无反应** —— 一度以为只是刚开新对话时的偶发，
  // 直到复用会话连跑两次时第二次稳定复现（`ok` 但一个上传请求都没有，然后就干等到超时）。
  // 重试时**重新 getDocument 拿一遍 nodeId**：这个 node 会随页面重渲染被换掉，
  // 拿着旧 id 写进去就是写进一个已经脱离文档的节点，静默无效。
  //
  // ⚠️⚠️ 2.32.4 上**页面上有两个 `input[type=file]`，行为完全不同**（实测）：
  //
  //   | 输入框                                    | accept 含 dockerfile | 塞进去之后        |
  //   |-------------------------------------------|----------------------|-------------------|
  //   | 无 data-testid                            | 否                   | 0 上传、0 缩略图  |
  //   | `[data-testid="upload-file-input"]`       | 是                   | 2 上传、1 缩略图  |
  //
  // 老版本恰好相反（含 dockerfile 的是"添加文件"、不含的才收图），所以旧启发式
  // 「accept 含 .webp 且**不含** dockerfile」在这里**正好挑中坏的那个**，表现就是
  // 「返回成功、一个请求都不发」。优先认 testid，再退回 accept，并且逐个试。
  const candidates = await listFileInputCandidates(cdp);
  const seenBeforeAll = cdp.uploadsSeen;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const list = await listFileInputCandidates(cdp);
    const ordered = list.length ? list : candidates;
    for (const cand of ordered) {
      const seenBefore = cdp.uploadsSeen;
      const r = await cdp.send("DOM.setFileInputFiles", { files: paths, nodeId: cand.nodeId });
      if (r?.error) continue;
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        await sleep(1000);
        if (cdp.uploadsSeen > seenBefore) return; // 上传链路动了 = 真的收下了
      }
    }
  }
  throw new Error(
    `往豆包塞图试了 3 轮（每轮 ${candidates.length} 个候选输入框），每次都返回成功但` +
      `**一个上传请求都没发出**（prepare_upload 没出现，uploadsSeen 仍是 ${seenBeforeAll}）。` +
      `人工看一眼那个豆包窗口的输入框里有没有缩略图；豆包可能又改版了。`
  );
}

/** 页面上的文件输入框，按「最可能收图」排序。等它挂载。 */
async function listFileInputCandidates(
  cdp: Cdp
): Promise<Array<{ nodeId: number; accept: string; testid: string }>> {
  for (let i = 0; i < 40; i++) {
    const doc = await cdp.send("DOM.getDocument", { depth: -1 });
    const q = await cdp.send("DOM.querySelectorAll", {
      nodeId: doc?.result?.root?.nodeId,
      selector: "input[type=file]",
    });
    const out: Array<{ nodeId: number; accept: string; testid: string }> = [];
    for (const nid of q?.result?.nodeIds || []) {
      const d = await cdp.send("DOM.describeNode", { nodeId: nid });
      const a: string[] = d?.result?.node?.attributes || [];
      const mp: Record<string, string> = {};
      for (let j = 0; j < a.length; j += 2) mp[a[j]] = a[j + 1];
      out.push({ nodeId: nid, accept: String(mp.accept || ""), testid: String(mp["data-testid"] || "") });
    }
    const usable = out.filter((x) => /\.(webp|png|jpe?g)/i.test(x.accept));
    if (usable.length) {
      // 排序：先 data-testid=upload-file-input，再其它有 testid 的，最后才是没 testid 的
      usable.sort((x, y) => scoreInput(x) - scoreInput(y));
      return usable;
    }
    await sleep(1000);
  }
  throw new Error("豆包页面里没找到图片上传入口（input[type=file] 带 .png/.jpg/.webp 的那个）。界面可能没起来。");
}

/** 越小越优先：`upload-file-input` 是 2.32.4 实测唯一真正收图的那个。 */
function scoreInput(x: { testid: string; accept: string }): number {
  if (x.testid === "upload-file-input") return 0;
  if (x.testid) return 1;
  return 2;
}

/**
 * 等附件**真的可以发了**。
 *
 * 判据用**上传链路**（`prepare_upload` → TOS → `CommitImageUpload` 都结束），
 * 不用 DOM 上的任何东西：
 *   - **缩略图 `naturalWidth` 不可信**：实测同样两步操作，一次缩略图 900×383 正常、
 *     一次 `naturalWidth=0`（输入框里是个灰方块）。拿它当判据会把"已经挂上了"
 *     误判成"没挂上"——典型的假阴性。而那次灰方块的情况下上传链路是完整的。
 *   - 「解释图片」按钮出现得太早（实测 1.5s 就有），早于上传结束，单用它也不够。
 */
async function waitAttachmentsReady(cdp: Cdp): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    if (cdp.uploadsSeen > 0 && cdp.pendingUploads.size === 0) { await sleep(1200); return; }
    await sleep(1000);
  }
  // 走到这里说明 attachImages 已经确认过"上传链路动过"，所以只剩"没跑完"这一种可能
  if (cdp.pendingUploads.size > 0) {
    throw new Error("附件传了 60s 还没传完（还有上传请求没结束）。网络太慢或图太大，重试一次。");
  }
}

/**
 * 发送：**光标折叠在末尾** → 回车 → 校验「这条消息真的进了对话」→ 没成就再来。
 *
 * ⚠️ 这里踩了两个坑，判据也是被它们逼出来的（都是实测）：
 *
 * 1) **发送前不许碰选区。** tiptap 里 Enter 的含义取决于 ProseMirror **内部**的选区：
 *    - 内部选区折叠（只是个光标）→ Enter = **提交**
 *    - 内部选区是一段（比如整段选中）→ Enter = **用换行替换选区**，消息根本不发
 *    最早的写法在 `insertText` 之后又 `selectNodeContents` 全选了一次，三次都发不出去；
 *    去掉那步、只 `focus()`，立刻就发了。
 *    **教训不是"要折叠光标"，而是"别用 DOM 的 Range 去插手"** ——
 *    PM 不走浏览器选区，你用 Range 摆出来的"折叠光标"和它内部认的可能不是一回事，
 *    于是时灵时不灵（我就在"有时能发有时不能"上反复了好几轮）。见 `focusComposerOnly`。
 *
 * 2) **「怎么算发出去了」被两个假判据骗过两轮，最后定在"看提示词还在不在输入框里"：**
 *    - ❌ 输入框变空 —— 全选 + Enter 会把文字替换成一个换行，`innerText` 同样是 `"\n"`，
 *         跟"发送成功后清空"一模一样；
 *    - ❌ 页面文字变长 —— 实测**失败**那次 body 文字也长了 64 个字符（多了个提示条），
 *         照样骗过；
 *    - ✅ **提示词出现在页面里、但已经不在输入框里** —— 成功那次成立，失败两次都不成立。
 *    所以判据是这一条，用去空白后的前 20 个字做 needle。
 */
async function sendComposer(cdp: Cdp, prompt: string): Promise<void> {
  // 用来认"这条消息进没进对话"：去空白取前 20 字（豆包在对话里是原样显示这条消息的）
  const needle = prompt.replace(/\s+/g, "").slice(0, 20);
  const sent = async () =>
    JSON.parse(
      (await cdp.evalJs(`(() => {
        const c = ${COMPOSER_SEL};
        const all = document.body.innerText.replace(/\\s+/g,'');
        const inComposer = c ? c.innerText.replace(/\\s+/g,'').includes(${JSON.stringify(needle)}) : false;
        return JSON.stringify({ has: all.includes(${JSON.stringify(needle)}), inComposer });
      })()`)) || "{}"
    ) as { has?: boolean; inComposer?: boolean };

  for (let attempt = 1; attempt <= 3; attempt++) {
    await focusComposerOnly(cdp);
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r",
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      key: "Enter", code: "Enter",
    });
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      await sleep(700);
      const s = await sent();
      if (s.has && !s.inComposer) return;   // 提示词已出现在页面上、且不在输入框里 = 发出去了
    }
    // 回车没发出去时补一次「点发送键」。2.32.4 实测：回车在某些页面状态下
    // 完全无效，而 [data-testid="chat_input_send_button"] 的 .click() 有效
    // （前提是 Input.insertText 已经把字塞进 ProseMirror，否则按钮是 disabled）。
    const clicked = await cdp.evalJs(`(() => {
      const b=document.querySelector('[data-testid="chat_input_send_button"]');
      if(!b) return 'missing';
      if(b.disabled) return 'disabled';
      b.click(); return 'clicked';
    })()`);
    const t1 = Date.now();
    while (Date.now() - t1 < 8000) {
      await sleep(700);
      const s = await sent();
      if (s.has && !s.inComposer) return;   // 同上：点发送键把它送进了对话
    }
    if (clicked === "disabled") {
      console.warn("[doubao] 发送键是 disabled：多半是输入没走 Input.insertText，React 没收到。");
    }
  }
  throw new Error(
    `回车按了 3 次，这条消息始终没进对话（判据：提示词出现在页面里且不再位于输入框）。` +
      `人工看一眼那个豆包窗口：可能有合规提示挡住了，或界面改版了。`
  );
}

/**
 * 轮询等**助手回复里**的成图。
 *
 * ⚠️ 判据换过一次，原来那版是错的，代价是"静默返回一张错图"：
 * 最早写的是「页面上自然尺寸 ≥ MIN_PX 的图，取最后一张」。实测送一张 **2048×2048** 的猫图
 * 让它重构，**13 秒**就"成功"了 —— 产物与输入 **MD5 一字不差**，它抓的是**我自己送进去的底图**。
 * 前面几次没撞上纯属侥幸：900×383 的底图**高度**低于阈值；多图那次两张挤在一起被渲染成小缩略图。
 * 根子上就站不住：**底图多大是我控制的**，拿固定尺寸去区分"我发的图"和"它画的图"，
 * 迟早会被一张大底图撞穿。
 *
 * 现在按**应用自己的语义**找：豆包把用户消息标成 `[data-testid="send_message"]`、
 * 助手回复标成 `[data-testid="receive_message"]`，只在后者里面找图
 * （那里面还带 `data-finished="true"` 表示已画完）。
 * 另外保留 `before` 排除（挡住"这轮之前就已经在页面上的图"）。
 *
 * 页面上**一个 `receive_message` 都没有**时直接报错，**不退回去按尺寸猜** ——
 * 判据瞎了的时候，静默返回一张错图比报错危险得多。
 */
async function waitForImage(
  cdp: Cdp,
  before: Set<string> = new Set()
): Promise<{ src: string; w: number; h: number }> {
  // 把"发送前就已经在页面上的图"整张排除掉。**这一步不是可选的**：
  // 复用会话时上一轮的成品图就在 `receive_message` 里，不排掉会在第一次轮询就返回它。
  const excl = JSON.stringify([...before]);
  const t0 = Date.now();
  while (Date.now() - t0 < cfg.timeoutMs) {
    await pause(5000);
    const r = await cdp.evalJs(`(() => {
      const excl=new Set(${excl});
      const out=[]; const seen=new Set();
      // ⚠️ 2.32.4 实测：成品图挂在自定义元素的 **shadow root** 里，
      // 普通 document.querySelectorAll('img') 一张都取不到（只能看到 320px 缩略图）。
      // 所以这里必须递归 shadowRoot。
      function walk(root,depth){
        if(depth>8||!root) return;
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) walk(el.shadowRoot, depth+1);
          if (el.tagName!=='IMG') continue;
          const src=el.currentSrc||el.src||'';
          if(!src||seen.has(src)) continue;
          seen.add(src);
          out.push({src, w:el.naturalWidth, h:el.naturalHeight});
        }
      }
      walk(document,0);
      const cand=out.filter(o=>o.w>=${cfg.minPx}&&o.h>=${cfg.minPx}
                 &&!/^(blob:|data:|chrome:)/.test(o.src)
                 &&!/avatar|emoji|icon/i.test(o.src)
                 &&!excl.has(o.src));
      if(!cand.length) return null;
      // 成图优先：豆包生成的图 URL 里带 rc_gen_image，缩略图/推荐图不带
      const gen=cand.filter(o=>o.src.includes('rc_gen_image'));
      const pick=(gen.length?gen:cand);
      return JSON.stringify(pick[pick.length-1]); })()`);
    if (r) return JSON.parse(r);
  }
  // 失败时才去分辨：是"结构没了"，还是"结构在但没出图"？
  const hasStructure = await cdp.evalJs(`!!document.querySelector('[data-testid="receive_message"]')`);
  const sawThumbs = await cdp.evalJs(`(() => {
    const out=[]; const seen=new Set();
    function walk(root,d){ if(d>8||!root) return;
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) walk(el.shadowRoot,d+1);
        if (el.tagName==='IMG') { const s=el.currentSrc||el.src||'';
          if(s&&!seen.has(s)){seen.add(s);out.push({s,w:el.naturalWidth,h:el.naturalHeight});} }
      }
    }
    walk(document,0);
    return JSON.stringify(out.filter(o=>o.w>=200).slice(-6));
  })()`);
  throw new Error(
    `等了 ${Math.round(cfg.timeoutMs / 1000)}s 没等到助手回复里的成图` +
      (hasStructure
        ? "（receive_message 结构还在，是图没出来）"
        : "（页面里**一个 receive_message 都没有** —— 豆包界面八成改版了，判据得跟着改）") +
      `。常见原因：那个豆包实例**没登录**、或者提示词被拦（合规审查）。` +
      `看到的大图（可能被 MIN_PX 卡掉）：${sawThumbs}`
  );
}

/**
 * 走完「聚焦 →（塞图）→ 打字 → 发送」，返回**发送前**页面上已有的图片 URL 集合。
 *
 * 失败时**整段重来**，而且是两级自愈（都实测有效）：
 *   1. 再来一次前先点「新对话」—— 它会**重建输入框**。实测这是治"发送失同步"的关键：
 *      同一个输入框被反复驱动之后会进入一个坏状态，表现为**发送键是亮的（`disabled:false`）、
 *      字也确实在框里（`innerText` 有内容）、但回车和真点发送键都毫无反应**；
 *      点一次「新对话」把输入框换掉，立刻就发了。
 *   2. 还不行就 `Page.reload` —— 更彻底，连塞图那步的坏状态（`setFileInputFiles`
 *      返回成功却一个上传请求都不发）一起治。
 *
 * ⚠️ 为什么必须**整段**重来而不是只重试某一步：上面两种自愈都会把输入框和焦点一起重置，
 * 单重试"塞图"的话，紧接着的 `insertText` 会打进一个已经没有上下文的新输入框里。
 *
 * 复盘一下这条路的代价：**"复用会话"本身是脆的**。要不要复用不是纯偏好问题 ——
 * 复用省下的是"豆包侧少几个会话"，付出的是"跑几轮之后可能静默发不出去"，
 * 所以才需要这套自愈兜着。`DOUBAO_NEW_CHAT=true` 每次开新对话反而最稳（每次输入框都是新的）。
 */
async function composeAndSend(
  cdp: Cdp,
  prompt: string,
  images?: string[]
): Promise<Set<string>> {
  for (let round = 1; round <= 3; round++) {
    try {
      if (!(await focusComposer(cdp))) {
        throw new Error("没找到豆包的输入框（界面可能没起来，或需要重新登录）");
      }
      if (images?.length) {
        await attachImages(cdp, images);
        await waitAttachmentsReady(cdp);
      }
      await cdp.send("Input.insertText", { text: prompt });
      await sleep(400);
      // ⚠️ 必须在**这一刻**拍：复用会话时上一轮的成品图就在页面上，
      // 不排掉的话 waitForImage 会在发送后第一次轮询就把旧图当成新结果
      const before = await snapshotImageSrcs(cdp);
      await sendComposer(cdp, prompt);
      return before;
    } catch (e) {
      if (round === 3) throw e;
      if (round === 1) {
        await clickNewChat(cdp);          // 重建输入框，治"发送不动"
      } else {
        await cdp.send("Page.reload");    // 更彻底，治"塞图不生效"
        await sleep(10000);
      }
    }
  }
  throw new Error("不可达");
}

/** 页面里当前所有 img 的 src（发送前拍一张，用来排除"我自己送进去的底图"） */
async function snapshotImageSrcs(cdp: Cdp): Promise<Set<string>> {
  const raw = await cdp.evalJs(
    `JSON.stringify([...document.querySelectorAll('img')].map(e=>e.currentSrc||e.src||''))`
  );
  try { return new Set<string>(JSON.parse(raw || "[]")); } catch { return new Set<string>(); }
}

/** 按 URL 取原始字节：先走 Network（拿的是响应原文），不行再退回页面内 fetch。 */
async function fetchImageBytes(cdp: Cdp, src: string): Promise<Buffer> {
  const rid = cdp.byUrl.get(src);
  if (rid) {
    const b = await cdp.send("Network.getResponseBody", { requestId: rid });
    if (b?.result?.body) return Buffer.from(b.result.body, "base64");
  }
  const durl = await cdp.evalJs(
    `fetch(${JSON.stringify(src)},{credentials:'include'}).then(r=>r.blob())` +
      `.then(b=>new Promise(res=>{const f=new FileReader();f.onload=()=>res(f.result);f.readAsDataURL(b);}))`
  );
  if (typeof durl === "string" && durl.includes(",")) return Buffer.from(durl.split(",")[1], "base64");
  throw new Error("拿到图了但取不到字节（Network 与页面内 fetch 两条路都失败）");
}

/** 落盘 + 写 sidecar。返回路径。 */
async function saveImage(
  buf: Buffer,
  outputPath: string,
  meta: Record<string, unknown>
): Promise<{ path: string; metaPath: string }> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buf);
  const metaPath = outputPath + ".meta.json";
  await writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
  return { path: outputPath, metaPath };
}

// ==================== 从零生图 ====================

/**
 * 让豆包出一张图。
 *
 * 流程（每一步都实测过）：新对话 → 往 tiptap 输入框 `Input.insertText` → 回车（校验已发出）→
 * 轮询 DOM 找 **自然尺寸 ≥ MIN_PX** 的图 → 按 URL 走 Network 取原始字节。
 */
export async function generateImageViaDoubao(
  prompt: string,
  opts: DoubaoGenerateOptions
): Promise<DoubaoResult> {
  const started = Date.now();
  const cdp = await connect();
  try {
    await startNewChat(cdp);
    await clearStaleAttachments(cdp);
    const before = await composeAndSend(cdp, prompt);

    const found = await waitForImage(cdp, before);
    const buf = await fetchImageBytes(cdp, found.src);
    const d = dimsOf(buf);
    if (d.fmt !== "png" && d.fmt !== "jpg") {
      throw new Error("豆包返回的字节既不是 PNG 也不是 JPEG；无法确定扩展名。");
    }
    const format = d.fmt as DoubaoFormat;
    const outPath = `${opts.outputBase}.${format}`;
    const aigc = readAigcMarker(buf);
    const durationMs = Date.now() - started;
    const { path, metaPath } = await saveImage(buf, outPath, {
      at: new Date().toISOString(),
      kind: "generate",
      provider: "doubao-desktop",
      endpoint: cfg.cdpUrl + " (CDP → 豆包桌面版对话界面)",
      requestedModel: "doubao (桌面版会话，无法指定具体型号)",
      reportedModel: null,
      usage: null,
      prompt,
      size: `${d.w}x${d.h}`,
      outputPath: outPath,
      bytes: buf.length,
      format,
      durationMs,
      // 当场留证据：豆包不回报模型名，但产物自带 AIGC 元数据
      aigcMarker: aigc,
      watermarks: [
        "可见水印「豆包 AI 生成」烙在右下角像素里（未裁剪）",
        aigc ? `AIGC 元数据: ${JSON.stringify(aigc)}` : "未检出 AIGC 元数据段",
      ],
      ...(opts.extraMeta || {}),
    });

    return {
      path,
      metaPath,
      format,
      width: d.w,
      height: d.h,
      bytes: buf.length,
      model: null,                 // 豆包不回报模型名 —— 不拿请求值冒充
      requestedModel: "doubao (桌面版)",
      aigcMarker: aigc,
      durationMs,
    };
  } finally {
    cdp.close();
  }
}

// ==================== 图生图（参考图 + 提示词） ====================

/**
 * 把本地图片送进豆包对话当参考图，再让它按提示词改。
 *
 * 流程：新对话 → 把底图塞进附件区（`setFileInputFiles`）→ 等上传链路走完 →
 * 打提示词 → 回车 → 等成图。
 *
 * 与 generate 的唯一区别就是**多了一步塞图**，而那一步是本文件里坑最多的部分，
 * 细节都写在 `attachImages` / `waitAttachmentsReady` / `sendComposer` 的注释里。
 *
 * ⚠️ 实测过的能力边界（2026-10-14）：
 *   - **单张底图 + 文字指令**可用，且**版式/文字保留得很好**：拿一张 900×383 的宣传图
 *     要它「背景换纯白、主标题改深红」，产出的 2272×960 里所有小字
 *     （`127.0.0.1 only` / `github.com/...` 等）与图形位置都原样保留，只改了被点名的两处。
 *     底图长宽比 2.35 → 产物 2.367，比例也守住了。
 *   - `size` 参数**无效**（豆包客户端里选不了输出尺寸），照实记进 meta 的是**实际**尺寸。
 *   - 产出同样带「豆包 AI 生成」可见水印 + AIGC 元数据，本模块不裁剪。
 */
export async function editImageViaDoubao(
  prompt: string,
  opts: DoubaoEditOptions
): Promise<DoubaoResult> {
  const images = (opts.images || []).filter(Boolean);
  if (!images.length) throw new Error("图生图至少要传一张输入图片(images)");

  const started = Date.now();
  abortSignal = opts.signal;
  const cdp = await connect();
  try {
    await startNewChat(cdp);
    await clearStaleAttachments(cdp);
    const before = await composeAndSend(cdp, prompt, images);

    const found = await waitForImage(cdp, before);
    const buf = await fetchImageBytes(cdp, found.src);
    const d = dimsOf(buf);
    if (d.fmt !== "png" && d.fmt !== "jpg") {
      throw new Error("豆包返回的字节既不是 PNG 也不是 JPEG；无法确定扩展名。");
    }
    const format = d.fmt as DoubaoFormat;
    const outPath = `${opts.outputBase}.${format}`;
    const aigc = readAigcMarker(buf);
    const durationMs = Date.now() - started;
    const { path, metaPath } = await saveImage(buf, outPath, {
      at: new Date().toISOString(),
      kind: "edit",
      provider: "doubao-desktop",
      endpoint: cfg.cdpUrl + " (CDP → 豆包桌面版对话界面)",
      requestedModel: "doubao (桌面版会话，无法指定具体型号)",
      reportedModel: null,
      usage: null,
      prompt,
      inputs: images,
      size: `${d.w}x${d.h}`,
      outputPath: outPath,
      bytes: buf.length,
      format,
      durationMs,
      aigcMarker: aigc,
      watermarks: [
        "可见水印「豆包 AI 生成」烙在右下角像素里（未裁剪）",
        aigc ? `AIGC 元数据: ${JSON.stringify(aigc)}` : "未检出 AIGC 元数据段",
      ],
      ...(opts.extraMeta || {}),
    });

    return {
      path,
      metaPath,
      format,
      width: d.w,
      height: d.h,
      bytes: buf.length,
      model: null,
      requestedModel: "doubao (桌面版)",
      aigcMarker: aigc,
      durationMs,
    };
  } finally {
    cdp.close();
  }
}

// ==================== 生视频 ====================
/**
 * 让豆包出一段视频。
 *
 * 流程（每一步都在 2.32.4 上实测过）：
 *   1. （可选）把**参考图**塞进附件区 —— 这一步决定「像不像那个角色」。
 *      只给文字时它画的是泛化的蓝发女仆；给了图它会明说
 *      「以你上传的角色图作为唯一身份锚点」。
 *   2. `composeAndSend` 打字发送（走 `Input.insertText` + 发送键）。
 *   3. 豆包**不会立刻生成**，它先回一张参数单（模型/时长/声音/画面文字）并问
 *      「确认后我再开始生成视频」。要再发一句「确认，开始生成」才会动。
 *   4. 等回复里出现 `[class*="block-video"]`（视频块，懒渲染，里面没有 `<video>`）。
 *   5. 真视频取不到直链：块里那两个 `aka.doubaocdn.com/s/xxxx` 一个是封面
 *      （HEIC 单帧），不是视频；`<video>` 要等播放器挂载才有，而页面是隐藏页，
 *      永远等不到。**可靠办法是用豆包自己的下载按钮**：
 *      `Browser.setDownloadBehavior` 把下载目录指到目标目录，悬停视频块后点
 *      `[data-testid="edit_image_download_button"]`，mp4 直接落盘。
 *   6. 等那个新 `.mp4` 出现，改名成 `outputBase.mp4`，写 sidecar。
 */
export async function generateVideoViaDoubao(
  prompt: string,
  opts: DoubaoVideoOptions
): Promise<DoubaoVideoResult> {
  const started = Date.now();
  abortSignal = opts.signal;
  const cdp = await connect();
  const outDir = dirname(opts.outputBase);
  await mkdir(outDir, { recursive: true });
  try {
    await startNewChat(cdp);
    await clearStaleAttachments(cdp);

    // ⚠️ 复用会话时，**上一轮的视频块还在页面上**。不先记数量的话，
    // 「等到 block-video」会立刻命中旧块，接着点的是旧块的下载键 —— 实测就是
    // 这样点了 3 分钟一个文件都没下来。所以只认「数量变多之后的最新那个」。
    const blocksBefore = Number(
      (await cdp.evalJs(`document.querySelectorAll('[class*="block-video"]').length`)) || 0
    );

    const refs = (opts.referenceImages || []).filter(Boolean);
    if (refs.length) await attachImages(cdp, refs);

    await composeAndSend(cdp, prompt);

    // 豆包先出参数单、问一句才开工
    const askedConfirm = await waitForText(cdp, /确认后我再开始生成视频|确认后开始生成|参数确认/, 90000);
    if (askedConfirm) {
      await sleep(1000);
      await composeAndSend(cdp, "确认，开始生成");
    }

    const deadline = Date.now() + cfg.videoTimeoutMs;
    let blockSeen = false;
    while (Date.now() < deadline) {
      await pause(5000);
      const n = Number((await cdp.evalJs(`document.querySelectorAll('[class*="block-video"]').length`)) || 0);
      if (n > blocksBefore) {
        blockSeen = true;
        break;
      }
    }
    if (!blockSeen) {
      throw new Error(
        `等了 ${Math.round(cfg.videoTimeoutMs / 1000)}s 没等到新的视频块（原有 ${blocksBefore} 个）。` +
          `常见原因：那个豆包实例没登录、每日免费额度用完、或提示词被拦。` +
          `人工看一眼那个豆包窗口。`
      );
    }
    await pause(6000);

    const outPath = `${opts.outputBase}.mp4`;

    // ── 优先：从 React fiber 里读视频直链，页面内 fetch 下来 ──────────────
    //
    // 为什么不用界面上那个「下载」按钮：它藏在 hover 组里，**合成鼠标事件下只
    // 闪现一下就没了**（实测轮询能命中、但紧接着取 rect 就为 null），靠它极不稳。
    // 而视频块的 React props 里直接躺着 `removeAiWatermarkVideoUrl`
    // （带 `lr=unwatermarked`，实测 720×1280 / h264+aac / 5s / 797KB），
    // 用它在页面内 fetch 是确定性的。
    const videoUrl = String(
      (await cdp.evalJs(`(() => {
      const bs=[...document.querySelectorAll('[class*="block-video"]')];
      const el=bs[bs.length-1]; if(!el) return 'none';
      const seen=new Set(); let best=null;
      const visit=(o,depth)=>{
        if(!o||depth>9||typeof o!=='object') return;
        if(seen.has(o)) return; seen.add(o);
        let keys=[]; try{keys=Object.keys(o)}catch(e){return}
        for(const k of keys){
          if(/^__/.test(k)) continue;
          let v; try{v=o[k]}catch(e){continue}
          if(typeof v==='string'){
            if(/mime_type=video_mp4|\\.mp4/i.test(v) && /^https?:/.test(v)){
              if(!best && /removeAiWatermarkVideoUrl|videoUrl|playUrl|downloadUrl/i.test(k)) best=v;
              else if(!best) best=v;
            }
          } else if(v&&typeof v==='object') visit(v,depth+1);
        }
      };
      for(const k of Object.keys(el)) if(k.startsWith('__react')) visit(el[k],0);
      return best || 'none';
    })()`)) || "none"
    );

    let bytes: Buffer | null = null;
    if (videoUrl.startsWith("http")) {
      const r = await cdp.evalJs(`(async () => {
        try {
          const res = await fetch(${JSON.stringify(videoUrl)}, { credentials: 'include' });
          if (!res.ok) return 'HTTP ' + res.status;
          const u8 = new Uint8Array(await (await res.blob()).arrayBuffer());
          let bin=''; const chunk=0x8000;
          for (let i=0;i<u8.length;i+=chunk) bin += String.fromCharCode.apply(null, u8.subarray(i,i+chunk));
          return 'OK:' + btoa(bin) + ':' + u8.length;
        } catch(e){ return 'ERR ' + e.message; }
      })()`);
      const val = typeof r === "string" ? r : "";
      if (val.startsWith("OK:")) {
        const parts = val.split(":");
        parts.pop(); // 丢掉长度，base64 自身可能含冒号
        bytes = Buffer.from(parts.slice(1).join(":"), "base64");
      }
    }

    // ── 兜底：走界面上的下载按钮（直链取不到时才用）─────────────────────
    if (!bytes) {
      const before = new Set(await listDir(outDir));
      await cdp.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: outDir,
        eventsEnabled: true,
      });
      await cdp
        .send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: outDir })
        .catch(() => {});

      // 滚动到视口 + 反复 hover，等下载键出现（合成事件下它只闪一下，必须轮询）
      let btn = false;
      for (let i = 0; i < 40 && !btn; i++) {
        await cdp.evalJs(`(() => {
          const bs=[...document.querySelectorAll('[class*="block-video"]')];
          const el=bs[bs.length-1]; if(!el) return 'none';
          try { el.scrollIntoView({block:'center'}); } catch(e){}
          const t = el.querySelector('[class*="video-hover-button-group"]') || el;
          for (const ev of ['pointerover','mouseover','pointerenter','mouseenter','pointermove','mousemove'])
            t.dispatchEvent(new MouseEvent(ev,{bubbles:true,cancelable:true,view:window}));
          return 'ok';
        })()`);
        await pause(1000);
        btn = !!(await cdp.evalJs(`!!document.querySelector('[data-testid="edit_image_download_button"]')`));
      }
      if (!btn) {
        throw new Error(
          "视频块出来了，但既没从 React props 里读到直链，也没等到下载按钮" +
            "（edit_image_download_button）—— 豆包界面可能改版了。"
        );
      }
      // hover 与点击必须紧挨着（中间隔久了按钮又消失）
      await cdp.evalJs(`(() => {
        const b=document.querySelector('[data-testid="edit_image_download_button"]');
        if(b) b.click(); return b ? 'clicked' : 'missing';
      })()`);

      let mp4: string | null = null;
      let mp4Dir = outDir;
      const dlDeadline = Date.now() + 240000;
      while (Date.now() < dlDeadline && !mp4) {
        await pause(2000);
        for (const dir of [outDir, downloadsDir()]) {
          const now = await listDir(dir);
          const fresh = now.filter((f) => !before.has(f) && /\.mp4$/i.test(f));
          if (fresh.length) {
            let last = -1;
            for (let i = 0; i < 30; i++) {
              const st = await statSize(dir, fresh[0]);
              if (st === last && st > 0) break;
              last = st;
              await pause(1000);
            }
            mp4 = fresh[0];
            mp4Dir = dir;
            break;
          }
        }
      }
      if (!mp4) {
        throw new Error("点了下载但没等到新的 .mp4 文件落到目标目录（也没落到系统下载目录）。");
      }
      bytes = await readFileBytes(`${mp4Dir}/${mp4}`);
      try {
        await removeFile(`${mp4Dir}/${mp4}`);
      } catch {
        /* 留着也无妨 */
      }
    }

    await writeFile(outPath, bytes);
    const meta = await probeMp4(bytes);
    const { path: savedPath, metaPath } = await saveImage(bytes, outPath, {
      at: new Date().toISOString(),
      kind: "video",
      provider: "doubao-desktop",
      endpoint: cfg.cdpUrl + " (CDP → 豆包桌面版对话界面)",
      requestedModel: "doubao (桌面版会话，无法指定具体型号)",
      reportedModel: null,
      usage: null,
      prompt,
      referenceImages: refs,
      size: `${meta.width}x${meta.height}`,
      durationSec: meta.durationSec,
      outputPath: outPath,
      bytes: bytes.length,
      format: "mp4",
      durationMs: Date.now() - started,
      watermarks: ["豆包视频产物带画面内水印（未裁剪）"],
      ...(opts.extraMeta || {}),
    });

    abortSignal = undefined;
    return {
      path: savedPath,
      metaPath,
      format: "mp4",
      width: meta.width,
      height: meta.height,
      bytes: bytes.length,
      durationSec: meta.durationSec,
      model: null,
      requestedModel: "doubao (桌面版)",
      durationMs: Date.now() - started,
    };
  } finally {
    cdp.close();
  }
}

/** 轮询等页面上出现匹配某段正则的文字。 */
async function waitForText(cdp: Cdp, re: RegExp, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await pause(2000);
    const hit = await cdp.evalJs(
      `((s)=>{try{return new RegExp(s).test(document.body.innerText)}catch(e){return false}})(${JSON.stringify(
        re.source
      )})`
    );
    if (hit) return true;
  }
  return false;
}

async function listDir(dir: string): Promise<string[]> {
  const { readdir } = await import("fs/promises");
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function statSize(dir: string, name: string): Promise<number> {
  const { stat } = await import("fs/promises");
  try {
    return (await stat(`${dir}/${name}`)).size;
  } catch {
    return 0;
  }
}

async function readFileBytes(p: string): Promise<Buffer> {
  const { readFile } = await import("fs/promises");
  return await readFile(p);
}

async function removeFile(p: string): Promise<void> {
  const { unlink } = await import("fs/promises");
  await unlink(p);
}

/** 系统下载目录：`setDownloadBehavior` 偶尔不生效时，豆包会把文件丢在这儿。 */
function downloadsDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  return `${home}\\Downloads`.replace(/\\/g, "/");
}

/**
 * 从 mp4 字节里读尺寸与时长（不依赖 ffprobe）。
 *
 * 只要 mvhd 的 timescale/duration 和 tkhd 的宽高就够写 sidecar；
 * 解析失败返回 0 —— **不因为读不出元数据就让整次生成失败**。
 */
async function probeMp4(buf: Buffer): Promise<{ width: number; height: number; durationSec: number }> {
  const out = { width: 0, height: 0, durationSec: 0 };
  try {
    const size = buf.length;
    const i = buf.indexOf(Buffer.from("mvhd"));
    if (i > 0) {
      const version = buf[i + 4];
      if (version === 0) {
        const timescale = buf.readUInt32BE(i + 16);
        const duration = buf.readUInt32BE(i + 20);
        if (timescale) out.durationSec = Math.round((duration / timescale) * 100) / 100;
      } else if (version === 1) {
        const timescale = buf.readUInt32BE(i + 24);
        const duration = Number(buf.readBigUInt64BE(i + 28));
        if (timescale) out.durationSec = Math.round((duration / timescale) * 100) / 100;
      }
    }
    const t = buf.indexOf(Buffer.from("tkhd"));
    if (t > 0) {
      const off = t + 4 + (buf[t + 4] === 1 ? 88 : 76);
      if (off + 8 <= size) {
        out.width = Math.round(buf.readUInt32BE(off) / 65536);
        out.height = Math.round(buf.readUInt32BE(off + 4) / 65536);
      }
    }
  } catch {
    /* 读不出就算了 */
  }
  return out;
}

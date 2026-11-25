/**
 * dsh-craft-anything · 浏览器半边（重做）
 *
 * 参考 IG5 逆向工作台的呈现范式：分节清晰、状态徽标、证据链式的信息层级。
 * 数据全部来自 host 的 GET /craft-anything/status，本文件只读、不改 host。
 *
 * 结构：
 *   ① Hero：CLI 版本 / 模式 / 工具总数 / 可用数（一眼看规模）
 *   ② 工具集卡片：可用率进度条 + 「已开/未开」徽标，点开展开该类工具说明
 *   ③ 引擎矩阵：已装 / 未装分组，每个引擎标「它管什么」
 *   ④ 工作流：Study → Build → Check → Ready 四步，每步给一条可复制的指令
 *   ⑤ 快捷索引：从工作台到 AI 的通道（复制一句指令粘给 AI）
 */
window.__ModuleLoader__.load({
  id: '@zhuobichen/dsh-craft-anything',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const TITLE = 'Craft Anything 工作台'
    const ENDPOINT = '/craft-anything/status'
    const PANEL_ID = 'craft-anything'

    // 文案集中
    const COPY = {
      kicker: 'STUDY // BUILD // CHECK // READY',
      title: ' Craft Anything',
      line: '看懂任何软件，再让 AI 造一个自己的 · 默认 Clean room',
      toolsetsHint: '默认只开 core。点工具集看它管什么，让 AI 用 enable_toolset 打开。',
      enginesHint: '缺的都是可选项；需要时装上，doctor 会自动识别。',
      workflowHint: '一条指令一个阶段；复制粘给 AI 即可。',
    }

    // 工作流四步（每步一条可复制指令）
    const FLOW = [
      { id: 'study', n: '01', name: 'Study', desc: '只读外部可见：截图、可见文本、实测布局、颜色、字距', cmd: 'list_toolsets' },
      { id: 'build', n: '02', name: 'Build', desc: '按证据复刻：结构、样式、交互，逐宽度对照', cmd: 'enable_toolset {"toolset":"browser"}' },
      { id: 'check', n: '03', name: 'Check', desc: '对照原作验收：布局差异、像素误差、交互一致性', cmd: 'core_evidence_show' },
      { id: 'ready', n: '04', name: 'Ready', desc: '交付：可复现的工程 + 一份诚实的自评', cmd: 'core_report_write' },
    ]

    // 工具集一句话说明（面板里点开看）
    const TOOLSET_DESC = {
      core: '证据账本、调查记忆、计划、报告、目标',
      native: '原生程序：反汇编、伪 C、调用图、字节搜索',
      browser: '网站：打开、实测、逐宽度对照',
      formats: '固件、抓包、游戏包、SQLite、WASM、EVM',
      android: 'APK 解析：清单、资源、权限',
      adb: '真机操作：截图、点击、日志、包管理',
      javascript: 'Electron / JS / ASAR / fuse',
      runtime: 'GDB / Rizin 会话，运行中的程序',
      frida: 'Frida 插桩：函数 hook、抓参数',
      apple: 'Apple 应用：Mach-O、plist、签名',
      managed: '.NET 程序：IL、元数据',
      java: 'JAR / Class 反编译',
      database: '数据库：schema、查询、导出',
      projects: '复刻项目：进度、文件、构建',
      setup: '引擎与设置：doctor、capabilities',
      application: '比较与重建：差异、补丁',
      build: '构建与打包',
    }

    function apply(ctx) {
      const el = h
      const useState = React.useState
      const useEffect = React.useEffect
      const useMemo = React.useMemo

      let styleDone = false
      function useStyleOnce() {
        if (styleDone) return
        styleDone = true
        try {
          if (document.querySelector('style[data-ca-scope]')) return
          const tag = document.createElement('style')
          tag.setAttribute('data-ca-scope', '1')
          const css = `
            .ca-scope{--ca-ink:#1f2937;--ca-sub:#5b6b82;--ca-line:rgba(37,55,80,.16);--ca-brand:#2563eb;--ca-ok:#15803d;--ca-warn:#b45309;--ca-soft:#f6f8fc;}
            .ca-wrap{display:flex;flex-direction:column;gap:14px;padding:16px 18px 40px;height:100%;overflow:auto;overflow-x:hidden;box-sizing:border-box;font-size:13px;color:var(--ca-ink);}
            .ca-hero{position:relative;display:flex;gap:18px;align-items:center;padding:14px 16px;border-radius:12px;background:linear-gradient(120deg,#eef4ff,#f6f2ff 55%,#eef9f7);border:1px solid var(--ca-line);}
            .ca-hero svg{flex:0 0 96px;height:76px;}
            .ca-kicker{font-family:ui-monospace,Consolas,monospace;font-size:10px;letter-spacing:.2em;color:#2563eb;}
            .ca-title{font-size:25px;font-weight:800;letter-spacing:-.02em;margin:3px 0 4px;}
            .ca-line{font-size:12px;color:var(--ca-sub);}
            .ca-metrics{display:flex;gap:14px;flex-wrap:wrap;margin-top:9px;}
            .ca-metric{font-size:11px;color:var(--ca-sub);}.ca-metric b{font-family:ui-monospace,Consolas,monospace;font-size:15px;color:var(--ca-ink);margin-right:3px;}
            .ca-badge{font-size:10.5px;padding:1px 8px;border-radius:999px;border:1px solid var(--ca-line);color:var(--ca-sub);white-space:nowrap;}
            .ca-badge-on{color:var(--ca-ok);border-color:rgba(21,128,61,.3);background:rgba(21,128,61,.08);}
            .ca-sec{display:flex;flex-direction:column;gap:9px;}
            .ca-sec-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}
            .ca-sec-t{font-size:13px;font-weight:700;}
            .ca-muted{font-size:11.5px;color:var(--ca-sub);}
            .ca-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;}
            .ca-card{border:1px solid var(--ca-line);border-radius:9px;padding:9px 11px;background:#fff;display:flex;flex-direction:column;gap:6px;cursor:pointer;text-align:left;font:inherit;color:inherit;}
            .ca-card:hover{border-color:var(--ca-brand);}
            .ca-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px;}
            .ca-card-id{font-family:ui-monospace,Consolas,monospace;font-size:12px;font-weight:700;}
            .ca-card-n{font-size:10.5px;color:var(--ca-sub);}
            .ca-bar{height:4px;border-radius:999px;background:#e8edf6;overflow:hidden;}
            .ca-bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#60a5fa,#a78bfa);}
            .ca-card-desc{font-size:11px;color:var(--ca-sub);line-height:1.5;display:none;}
            .ca-card-open .ca-card-desc{display:block;}
            .ca-flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;}
            .ca-step{border:1px solid var(--ca-line);border-radius:9px;padding:10px 11px;background:#fff;display:flex;flex-direction:column;gap:5px;}
            .ca-step-n{font-family:ui-monospace,Consolas,monospace;font-size:10px;color:var(--ca-brand);letter-spacing:.1em;}
            .ca-step-name{font-size:13px;font-weight:700;}
            .ca-step-desc{font-size:11px;color:var(--ca-sub);line-height:1.5;}
            .ca-step-cmd{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;background:var(--ca-soft);border:1px solid var(--ca-line);border-radius:5px;padding:4px 6px;cursor:pointer;}
            .ca-engines{display:flex;gap:7px;flex-wrap:wrap;}
            .ca-engine{font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--ca-line);}
            .ca-engine-on{color:var(--ca-ok);border-color:rgba(21,128,61,.3);background:rgba(21,128,61,.07);}
            .ca-engine-off{color:var(--ca-sub);opacity:.7;}
            .ca-foot{font-size:10.5px;color:var(--ca-sub);line-height:1.7;word-break:break-all;}
            .ca-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:9600;background:#15803d;color:#fff;font-size:12px;padding:6px 14px;border-radius:999px;}
            .ca-empty{border:1px dashed var(--ca-line);border-radius:9px;padding:14px;color:var(--ca-sub);font-size:12px;}
          `
          tag.textContent = css
          document.head.appendChild(tag)
        } catch (e) { /* 样式失败不影响功能 */ }
      }

      function copyText(text) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false)
        } catch (e) { /* fall through */ }
        return Promise.resolve(false)
      }

      function Workbench() {
        useStyleOnce()
        const [state, setState] = useState({ loading: true, data: null, error: null })
        const [openSet, setOpenSet] = useState('')
        const [toast, setToast] = useState('')

        useEffect(() => {
          let alive = true
          const load = (force) => {
            fetch(ENDPOINT + (force ? '?t=' + Date.now() : ''), { headers: { accept: 'application/json' } })
              .then((r) => r.json())
              .then((d) => { if (alive) setState({ loading: false, data: d, error: null }) })
              .catch((e) => { if (alive) setState({ loading: false, data: null, error: String((e && e.message) || e) }) })
          }
          load(false)
          const timer = setInterval(() => load(true), 60000)
          return () => { alive = false; clearInterval(timer) }
        }, [])

        const copy = (text, what) => {
          copyText(text).then((ok) => {
            setToast(ok ? what + ' 已复制' : '复制被拦了：手动选中上面那段')
            setTimeout(() => setToast(''), 2400)
          })
        }

        const data = state.data || {}
        const toolsets = data.toolsets || []
        const engines = data.engines || []
        const installed = engines.filter((e) => e.found)
        const missing = engines.filter((e) => !e.found)
        const total = data.toolCount || 0
        const avail = data.availableCount || 0

        return el('div', { className: 'ca-scope', style: { display: 'contents' } },
          el('div', { className: 'ca-wrap' },
            // ── Hero ──
            el('div', { className: 'ca-hero' },
              el('svg', { viewBox: '0 0 120 90', 'aria-hidden': 'true' },
                el('rect', { x: 8, y: 10, width: 104, height: 70, rx: 8, fill: '#1e293b' }),
                el('circle', { cx: 22, cy: 22, r: 3, fill: '#f87171' }),
                el('circle', { cx: 33, cy: 22, r: 3, fill: '#fbbf24' }),
                el('circle', { cx: 44, cy: 22, r: 3, fill: '#34d399' }),
                el('rect', { x: 18, y: 38, width: 46, height: 5, rx: 2, fill: '#60a5fa' }),
                el('rect', { x: 18, y: 50, width: 72, height: 5, rx: 2, fill: '#a78bfa' }),
                el('rect', { x: 18, y: 62, width: 58, height: 5, rx: 2, fill: '#475569' }),
              ),
              el('div', null,
                el('div', { className: 'ca-kicker' }, COPY.kicker),
                el('div', { className: 'ca-title' }, COPY.title),
                el('div', { className: 'ca-line' }, COPY.line),
                el('div', { className: 'ca-metrics' },
                  el('span', { className: 'ca-metric' }, el('b', null, String(data.version || '—')), 'CLI'),
                  el('span', { className: 'ca-metric' }, el('b', null, String(total)), '工具'),
                  el('span', { className: 'ca-metric' }, el('b', null, String(avail)), '可用'),
                  el('span', { className: 'ca-badge' + (data.ok ? ' ca-badge-on' : '') }, data.ok ? '● 就绪' : '○ 未就绪'),
                  el('span', { className: 'ca-badge' }, data.analysisMode || 'clean-room'),
                ),
              ),
            ),

            state.error ? el('div', { className: 'ca-empty' }, '接口报错：' + state.error) : null,
            state.loading ? el('div', { className: 'ca-muted' }, '读取中…') : null,

            // ── 工具集 ──
            el('div', { className: 'ca-sec' },
              el('div', { className: 'ca-sec-head' },
                el('div', { className: 'ca-sec-t' }, '工具集 ', el('span', { className: 'ca-muted' }, String(toolsets.length))),
                el('span', { className: 'ca-muted' }, COPY.toolsetsHint),
              ),
              toolsets.length === 0
                ? el('div', { className: 'ca-empty' }, '没有读到工具集。')
                : el('div', { className: 'ca-grid' },
                    toolsets.map((t) => {
                      const pct = t.total ? Math.round((t.available / t.total) * 100) : 0
                      const open = openSet === t.id
                      return el('button', {
                        key: t.id,
                        type: 'button',
                        className: 'ca-card' + (open ? ' ca-card-open' : ''),
                        onClick: () => setOpenSet(open ? '' : t.id),
                      },
                        el('div', { className: 'ca-card-top' },
                          el('span', { className: 'ca-card-id' }, t.id),
                          el('span', { className: 'ca-card-n' }, t.available + '/' + t.total),
                        ),
                        el('div', { className: 'ca-bar' },
                          el('div', { className: 'ca-bar-fill', style: { width: Math.max(pct, 4) + '%' } }),
                        ),
                        el('div', { className: 'ca-card-n' }, t.title || ''),
                        el('div', { className: 'ca-card-desc' }, TOOLSET_DESC[t.id] || '点开看这一类工具，或让 AI 用 enable_toolset 打开。'),
                      )
                    }),
                  ),
            ),

            // ── 引擎 ──
            el('div', { className: 'ca-sec' },
              el('div', { className: 'ca-sec-head' },
                el('div', { className: 'ca-sec-t' }, '本机引擎 ', el('span', { className: 'ca-muted' }, installed.length + '/' + engines.length)),
                el('span', { className: 'ca-muted' }, COPY.enginesHint),
              ),
              el('div', { className: 'ca-engines' },
                installed.map((e) => el('span', { key: e.id, className: 'ca-engine ca-engine-on', title: e.neededFor || '' }, '● ' + e.name)),
                missing.map((e) => el('span', { key: e.id, className: 'ca-engine ca-engine-off', title: e.neededFor || '' }, '○ ' + e.name)),
              ),
            ),

            // ── 工作流 ──
            el('div', { className: 'ca-sec' },
              el('div', { className: 'ca-sec-head' },
                el('div', { className: 'ca-sec-t' }, '工作流'),
                el('span', { className: 'ca-muted' }, COPY.workflowHint),
              ),
              el('div', { className: 'ca-flow' },
                FLOW.map((f) => el('div', { className: 'ca-step', key: f.id },
                  el('div', { className: 'ca-step-n' }, f.n),
                  el('div', { className: 'ca-step-name' }, f.name),
                  el('div', { className: 'ca-step-desc' }, f.desc),
                  el('button', { className: 'ca-step-cmd', onClick: () => copy(f.cmd, f.name + ' 指令') }, f.cmd),
                )),
              ),
            ),

            data.cli ? el('div', { className: 'ca-foot' }, 'CLI：' + data.cli) : null,
            toast ? el('div', { className: 'ca-toast' }, toast) : null,
          ),
        )
      }

      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: PANEL_ID,
        order: 26,
        label: () => TITLE,
      }, Workbench))
    }

    return {
      inject: ['slots'],
      apply,
    }
  },
})

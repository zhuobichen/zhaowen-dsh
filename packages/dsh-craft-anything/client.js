window.__ModuleLoader__.load({
  id: '@zhuobichen/dsh-craft-anything',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const TITLE = 'Craft Anything 工作台';
    const ENDPOINT = '/craft-anything/status';

    const card = {
      border: '1px solid var(--dsw-alias-border-subtle, rgba(20,36,63,0.12))',
      borderRadius: 12,
      background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.72))',
      padding: '14px 16px',
    };
    const muted = { color: 'var(--dsw-alias-text-secondary, #5b6c86)', fontSize: 13, lineHeight: 1.6 };
    const heading = { fontSize: 14, fontWeight: 600, marginBottom: 8 };
    const badge = (ok) => ({
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '2px 9px',
      borderRadius: 999,
      fontSize: 12,
      border: '1px solid ' + (ok ? 'rgba(43,95,168,0.35)' : 'rgba(150,120,40,0.35)'),
      color: ok ? 'var(--dsw-alias-text-accent, #2b5fa8)' : '#8a6d1f',
      background: ok ? 'rgba(43,95,168,0.08)' : 'rgba(190,150,40,0.10)',
    });

    function useStatus() {
      const [state, setState] = React.useState({ loading: true, data: null, error: null });
      React.useEffect(() => {
        let alive = true;
        const load = async (force) => {
          try {
            const res = await fetch(ENDPOINT + (force ? '?t=' + Date.now() : ''), { headers: { accept: 'application/json' } });
            const data = await res.json();
            if (alive) setState({ loading: false, data, error: null });
          } catch (error) {
            if (alive) setState({ loading: false, data: null, error: String(error && error.message || error) });
          }
        };
        load(false);
        const timer = setInterval(() => load(true), 60_000);
        return () => { alive = false; clearInterval(timer); };
      }, []);
      return state;
    }

    function Workbench() {
      const { loading, data, error } = useStatus();
      const toolsets = (data && data.toolsets) || [];
      const engines = (data && data.engines) || [];

      return h('div', { style: { padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 980 } },
        h('div', { style: { ...card } },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } },
            h('div', { style: heading }, 'Craft Anything · 净室逆向引擎'),
            h('span', { style: badge(Boolean(data && data.ok)) },
              loading ? '读取中…' : (data && data.ok ? 'CLI 就绪' : '未就绪')),
          ),
          h('div', { style: muted },
            data && data.ok
              ? `craft-anything-cli ${data.version} · ${data.toolCount} 个工具（当前模式可用 ${data.availableCount}）· ${toolsets.length} 个工具集 · ${data.analysisMode || 'clean-room'}`
              : (error ? '工作台接口失败：' + error : (data && data.message) || '正在探测本机 CLI…'),
          ),
        ),

        h('div', { style: { ...card } },
          h('div', { style: heading }, '工具集'),
          h('div', { style: muted, marginBottom: 10 },
            '默认只开 core。用 agent 的工具 enable_toolset {"toolset":"browser"} 打开其它工具集（或 "all"）。'),
          toolsets.length === 0
            ? h('div', { style: muted }, '没有读到工具集。')
            : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 } },
                toolsets.map((item) => h('div', {
                  key: item.id,
                  title: item.title,
                  style: {
                    border: '1px solid var(--dsw-alias-border-subtle, rgba(20,36,63,0.10))',
                    borderRadius: 10,
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    background: item.id === 'core' ? 'rgba(43,95,168,0.07)' : 'transparent',
                  },
                },
                  h('span', { style: { fontSize: 13 } }, item.id),
                  h('span', { style: { ...muted, fontSize: 12 } }, item.available + '/' + item.total),
                )),
              ),
        ),

        h('div', { style: { ...card } },
          h('div', { style: heading }, '本机引擎'),
          engines.length === 0
            ? h('div', { style: muted }, 'doctor 没有返回引擎信息。')
            : h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
                engines.map((engine) => h('span', { key: engine.id, style: badge(engine.found), title: engine.neededFor },
                  (engine.found ? '● ' : '○ ') + engine.name + (engine.found ? ' 可用' : ' 未装'))),
              ),
          h('div', { style: { ...muted, marginTop: 10 } },
            '缺的都是可选项（Ghidra / JADX / Frida / GDB…）；需要时装上，doctor 会自动识别。'),
        ),

        h('div', { style: { ...card } },
          h('div', { style: heading }, '怎么用'),
          h('div', { style: { ...muted, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, whiteSpace: 'pre-wrap' } },
            'enable_toolset {toolset:"browser"}\n' +
            'core_brief_write {question:"这个网站的列表页怎么渲染？", purpose:"复刻"}\n' +
            'rebuild_start {request:"Recreate this website"}\n\n' +
            'Clean room 默认：不读原件代码/文件/页面源码；要读内部需在 Craft Anything 里开 Deep。\n' +
            '会执行代码或改设备的工具会先要你批准。'),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          ctx.slots.inject('conversation.view', () => ctx.slots.register({
            name: 'conversation.view',
            id: 'craft-anything',
            order: 26,
            label: () => TITLE,
          }, Workbench));
        } catch (error) { /* slot already taken by a stale instance */ }
      },
    };
  },
});

window.__ModuleLoader__.load({
  id: '@local/dsh-rea-video',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const TITLE = 'rea-video 工作台';
    const ENDPOINT = '/rea-video/status';

    const card = {
      border: '1px solid var(--dsw-alias-border-subtle, rgba(20,36,63,0.12))',
      borderRadius: 12,
      background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.72))',
      padding: '14px 16px',
    };
    const muted = { color: 'var(--dsw-alias-text-secondary, #5b6c86)', fontSize: 13, lineHeight: 1.6 };
    const heading = { fontSize: 14, fontWeight: 600, marginBottom: 8 };
    const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 };

    function chip(text, tone) {
      const ok = tone !== 'warn';
      return h('span', {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 9px',
          borderRadius: 999,
          fontSize: 12,
          border: '1px solid ' + (ok ? 'rgba(43,95,168,0.35)' : 'rgba(150,120,40,0.35)'),
          color: ok ? 'var(--dsw-alias-text-accent, #2b5fa8)' : '#8a6d1f',
          background: ok ? 'rgba(43,95,168,0.08)' : 'rgba(190,150,40,0.10)',
        },
      }, text);
    }

    function useStatus() {
      const [state, setState] = React.useState({ loading: true, data: null, error: null });
      React.useEffect(() => {
        let alive = true;
        const load = async () => {
          try {
            const res = await fetch(ENDPOINT + '?t=' + Date.now(), { headers: { accept: 'application/json' } });
            const data = await res.json();
            if (alive) setState({ loading: false, data, error: null });
          } catch (error) {
            if (alive) setState({ loading: false, data: null, error: String((error && error.message) || error) });
          }
        };
        load();
        const timer = setInterval(load, 60_000);
        return () => { alive = false; clearInterval(timer); };
      }, []);
      return state;
    }

    function Workbench() {
      const { loading, data, error } = useStatus();
      const ok = Boolean(data && data.ok);
      const mix = (data && data.mix) || [];
      const packaging = (data && data.packaging) || [];
      const aspects = (data && data.aspects) || [];

      return h('div', { style: { padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 980 } },
        h('div', { style: card },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } },
            h('div', { style: heading }, 'rea-video · 视频逆向拆解'),
            chip(loading ? '读取中…' : ok ? '有记录' : '暂无记录', ok ? 'ok' : 'warn'),
          ),
          h('div', { style: muted },
            error
              ? '工作台接口失败：' + error
              : ok
                ? `${data.video || '（未知视频）'} · ${Number(data.duration || 0).toFixed(1)}s · ${data.shots || 0} 个镜头 · 置信度 ${data.confidence ?? '—'} · ${data.updatedAt ? new Date(data.updatedAt).toLocaleString() : ''}`
                : '还没有拆解记录：让 agent 调 rea_video_cli {"args":["decompose","<视频绝对路径>"]}，跑完这里就会出现结论。',
          ),
        ),

        ok && h('div', { style: card },
          h('div', { style: heading }, '结论'),
          h('div', { style: { ...muted, fontSize: 13.5, lineHeight: 1.7 } }, data.verdict || '（无）'),
          mix.length > 0 && h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 } },
            mix.map((m) => chip(`${m.label_zh || m.label} ${Math.round((m.ratio || 0) * 100)}%`)),
          ),
        ),

        ok && h('div', { style: card },
          h('div', { style: heading }, '画面与包装'),
          aspects.length > 0 && h('ul', { style: { ...muted, margin: '0 0 8px 18px', padding: 0 } }, aspects.map((a, i) => h('li', { key: i, style: { marginBottom: 4 } }, a))),
          packaging.length > 0 && h('ul', { style: { ...muted, margin: '0 0 0 18px', padding: 0 } }, packaging.map((p, i) => h('li', { key: i, style: { marginBottom: 4 } }, p))),
        ),

        ok && data.vlm && h('div', { style: card },
          h('div', { style: heading }, '可信度提示'),
          h('div', { style: muted }, data.vlm),
        ),

        ok && h('div', { style: card },
          h('div', { style: heading }, '产物'),
          h('div', { style: { ...muted, ...mono } }, data.report || ''),
          h('div', { style: { ...muted, marginTop: 6 } }, '完整报告里有逐镜关键帧、证据、音轨图与复刻方案。'),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          ctx.slots.inject('conversation.view', () => ctx.slots.register({
            name: 'conversation.view',
            id: 'rea-video',
            order: 27,
            label: () => TITLE,
          }, Workbench));
        } catch (error) { /* slot already taken by a stale instance */ }
      },
    };
  },
});

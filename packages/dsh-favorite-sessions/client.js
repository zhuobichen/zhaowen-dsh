/**
 * dsh-favorite-sessions · 浏览器半身
 *
 * 三个扩展点（都用 DSH 官方 slot，不改宿主源码）：
 *   1. sidebar.workspaces.session.menu.item —— 省略号菜单里加「标记常用 / 取消常用」
 *   2. sidebar.session.row.leading          —— 常用会话行首显示 ⭐，并给行容器打 data-fav-session
 *   3. sidebar.panellist.actions            —— 侧栏 More 菜单里加「只显示常用」开关
 *
 * 备注：DSH 的「筛选会话」菜单是宿主硬编码的，插件加不进菜单项；
 * 「只显示常用」改做成 More 菜单里的开关：开启后注入 CSS 隐藏没有被标记为常用的会话行
 * （行容器是 [data-row-key^="session:"]，由 workspace 提供）。
 *
 * 数据：常用集合 + 开关存 localStorage（createSnapshotStore persist），刷新/重启都在，
 * 属个人 UI 偏好，不进会话日志、不进版本库。
 */
window.__ModuleLoader__.load({
  id: '@zhuobichen/dsh-favorite-sessions',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const jsx = require('react/jsx-runtime')
    const react = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const store = require('@deepseek-ai/dsh-client-store')

    const NS = 'favorite-sessions'
    const zh = {
      'menu.mark': '标记为常用',
      'menu.unmark': '取消常用标记',
      'menu.only': '只显示常用会话',
      'menu.onlyOn': '只显示常用会话（已开启）',
      'row.star': '常用会话',
    }
    const en = {
      'menu.mark': 'Mark as favorite',
      'menu.unmark': 'Remove favorite',
      'menu.only': 'Show favorites only',
      'menu.onlyOn': 'Show favorites only (on)',
      'row.star': 'Favorite session',
    }

    // 持久化偏好：favorites = sessionId 数组；only = 布尔开关。
    const prefs = (0, store.createSnapshotStore)(
      { favorites: [], only: false },
      { persist: { name: 'dsh.favorite-sessions.v1' } }
    )
    const read = () => prefs.getSnapshot() || { favorites: [], only: false }
    const isFav = (id) => (read().favorites || []).includes(id)
    const toggleFav = (id) => {
      const s = read()
      const set = new Set(s.favorites || [])
      if (set.has(id)) set.delete(id)
      else set.add(id)
      prefs.set({ ...s, favorites: [...set] })
    }
    const toggleOnly = () => {
      const s = read()
      prefs.set({ ...s, only: !s.only })
      applyOnlyClass()
    }

    // 偏好变化时，把开关状态同步到 <html data-fav-only>，CSS 据此隐藏非常用行。
    function applyOnlyClass() {
      if (typeof document === 'undefined') return
      const on = !!read().only
      document.documentElement.setAttribute('data-fav-only', on ? '1' : '0')
    }

    // 订阅偏好变化的 React hook（不依赖 useSyncExternalStore 的 subscribe 稳定性）。
    function usePrefs() {
      const [snap, setSnap] = (0, react.useState)(read())
      ;(0, react.useEffect)(() => {
        setSnap(read())
        return prefs.subscribe ? prefs.subscribe(() => setSnap(read())) : undefined
      }, [])
      return snap
    }

    // 注入 CSS：only 开启时隐藏所有未被标记为常用的会话行；星标始终可见。
    const CSS = [
      'html[data-fav-only="1"] [data-row-key^="session:"]:not([data-fav-session]){display:none!important}',
      '[data-fav-star]{font-size:12px;line-height:1;margin-right:3px;user-select:none;color:var(--dsw-alias-accent,#e5a100)}',
    ].join('\n')
    const cssId = '@zhuobichen/dsh-favorite-sessions/style'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(cssId) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = '@zhuobichen/dsh-favorite-sessions'
      tag.dataset.pluginCss = cssId
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // locale 可能被某些 slot 省略，提供兜底翻译，避免 t 未注入时崩溃。
    const tr = (t, key, fallback) => (typeof t === 'function' ? t(key) : fallback)

    /** 省略号菜单项：标记 / 取消常用 */
    function FavoriteMenuItem({ sessionId, useMenuOpenState, t }) {
      const snap = usePrefs()
      const fav = (snap.favorites || []).includes(sessionId)
      const pair = useMenuOpenState ? useMenuOpenState() : null
      const setMenuOpen = pair && pair[1]
      return jsx.jsx(primitives.MenuItemButton, {
        icon: jsx.jsx('span', { 'aria-hidden': 'true', children: fav ? '⭐' : '☆' }),
        onSelect: () => {
          if (setMenuOpen) setMenuOpen(false)
          toggleFav(sessionId)
        },
        children: tr(t, fav ? 'menu.unmark' : 'menu.mark', fav ? '取消常用标记' : '标记为常用'),
      })
    }

    /** 行首星标：常用则显示 ⭐，并给会话行容器打 data-fav-session。 */
    function FavoriteMark({ sessionId, t }) {
      const snap = usePrefs()
      const fav = (snap.favorites || []).includes(sessionId)
      const ref = (0, react.useRef)(null)
      ;(0, react.useEffect)(() => {
        if (typeof document === 'undefined' || !ref.current) return
        const row = ref.current.closest ? ref.current.closest('[data-row-key^="session:"]') : null
        if (row) {
          if (fav) row.setAttribute('data-fav-session', '1')
          else row.removeAttribute('data-fav-session')
        }
        return () => { if (row) row.removeAttribute('data-fav-session') }
      }, [sessionId, fav])
      if (!fav) return null
      return jsx.jsx('span', { ref, 'data-fav-star': '', title: tr(t, 'row.star', '常用会话'), children: '⭐' })
    }

    /** More 菜单开关：只显示常用会话 */
    function OnlyFavoritesAction({ t }) {
      const snap = usePrefs()
      const on = !!snap.only
      return jsx.jsx(primitives.MenuItemButton, {
        icon: jsx.jsx('span', { 'aria-hidden': 'true', children: on ? '✅' : '⭐' }),
        onSelect: toggleOnly,
        children: tr(t, on ? 'menu.onlyOn' : 'menu.only', on ? '只显示常用会话（已开启）' : '只显示常用会话'),
      })
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'favorite-sessions: dictionaries')
      applyOnlyClass()
      if (prefs.subscribe) ctx.effect(() => prefs.subscribe(() => applyOnlyClass()), 'favorite-sessions: only-class')

      ctx.slots.inject('sidebar.workspaces.session.menu.item', function* () {
        yield ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'favorite',
          order: 60,
          locale: NS,
        }, FavoriteMenuItem)
      })

      ctx.slots.inject('sidebar.session.row.leading', function* () {
        yield ctx.slots.register({
          name: 'sidebar.session.row.leading',
          id: 'favorite-mark',
          order: 5,
          locale: NS,
        }, FavoriteMark)
      })

      ctx.slots.inject('sidebar.panellist.actions', function* () {
        yield ctx.slots.register({
          name: 'sidebar.panellist.actions',
          id: 'favorite-only',
          locale: NS,
        }, OnlyFavoritesAction)
      })
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})

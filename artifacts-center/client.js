/**
 * 产物中心（Artifacts Center）Client half。
 *
 * 在左侧栏注册一个「产物中心」图标（`sidebar.panellist`），并为它对应的主面板
 * （`main` 的 `artifacts` 键）渲染产物清单：顶部按类型分类，下面按工作室/项目
 * 折叠。数据来自 Host half 注册的文档相对路由 `api/artifacts.index`，请求携带
 * 浏览器会话 Cookie，越权与跨站请求由 Connection 的 Host/Origin 校验统一拒绝。
 *
 * 点击一行把源文件送进右侧栏预览（`ctx.sidebarRight.openResource`）。右侧栏按
 * Session 保有一个表面，且只在会话占据中间列时存在——所以点击时先把中间列交还
 * 会话，再在随后的帧里打开资源；`Ctrl`/`⌘` 点击仍然在新标签页打开。
 *
 * 只使用 `--dsw-alias-*` 主题令牌，浅色/深色主题自动跟随；文案走 Client locale。
 */
window.__ModuleLoader__.load({
  id: '@local/artifacts-center',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 运行时文案与面板标签的命名空间。 */
    const NS = 'ui-artifacts-center'

    /** Host half 注册的索引路由（文档相对，兼容挂载在子路径的部署）。 */
    const INDEX_URL = 'api/artifacts.index'

    /** Session 媒体路由：新标签页打开源文件时的降级通道。 */
    const FILE_URL = 'api/file?path='

    const zh = {
      panel: '产物中心',
      title: '产物中心',
      subtitle: '按项目汇总 Agent 生成的产物',
      counts: '{projects} 个项目 · {artifacts} 个产物',
      refresh: '刷新',
      refreshing: '刷新中…',
      loading: '正在读取会话日志…',
      retry: '重试',
      errorTitle: '读取产物失败',
      unavailableTitle: '产物索引不可用',
      emptyTitle: '还没有产物',
      emptyBody: '当 Agent 用 present 声明交付文件，或用 write / edit 写入文件后，产物会按项目出现在这里。',
      emptyFiltered: '这个分类下还没有产物。',
      delivered: '交付',
      produced: '写入',
      unknownDir: '未关联目录',
      openHint: '在右侧栏预览（Ctrl/⌘ 点击在新标签页打开）',
      expandAll: '全部展开',
      collapseAll: '全部折叠',
      justNow: '刚刚',
      minutesAgo: '{n} 分钟前',
      hoursAgo: '{n} 小时前',
      daysAgo: '{n} 天前',
      scanNote: '已扫描 {scanned}/{considered} 个会话',
      partialNote: ' · 已达时间预算，结果可能不完整',
      errorNote: '部分会话读取失败：{message}',
      catAll: '全部',
      catDoc: '文档',
      catSheet: '表格',
      catSlide: '演示',
      catImage: '图片',
      catCode: '代码',
      catOther: '其他',
    }

    const en = {
      panel: 'Artifacts',
      title: 'Artifacts Center',
      subtitle: 'Artifacts each project produced, grouped by project',
      counts: '{projects} projects · {artifacts} artifacts',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      loading: 'Reading session logs…',
      retry: 'Retry',
      errorTitle: 'Could not read artifacts',
      unavailableTitle: 'Artifact index unavailable',
      emptyTitle: 'No artifacts yet',
      emptyBody:
        'Artifacts appear here once an agent declares files with present, or writes files with write / edit.',
      emptyFiltered: 'Nothing in this category yet.',
      delivered: 'Delivered',
      produced: 'Written',
      unknownDir: 'Unattached directory',
      openHint: 'Preview in the right sidebar (Ctrl/⌘ click opens a new tab)',
      expandAll: 'Expand all',
      collapseAll: 'Collapse all',
      justNow: 'just now',
      minutesAgo: '{n} min ago',
      hoursAgo: '{n} h ago',
      daysAgo: '{n} d ago',
      scanNote: 'Scanned {scanned}/{considered} sessions',
      partialNote: ' · time budget reached, results may be partial',
      errorNote: 'Some sessions could not be read: {message}',
      catAll: 'All',
      catDoc: 'Docs',
      catSheet: 'Sheets',
      catSlide: 'Slides',
      catImage: 'Images',
      catCode: 'Code',
      catOther: 'Other',
    }

    /** 分类顺序：`all` 永远在最前，其余只显示有产物的分类。 */
    const CATEGORY_ORDER = ['all', 'doc', 'sheet', 'slide', 'image', 'code', 'other']

    /** 分类标签的文案键。 */
    const CATEGORY_LABELS = {
      all: 'catAll',
      doc: 'catDoc',
      sheet: 'catSheet',
      slide: 'catSlide',
      image: 'catImage',
      code: 'catCode',
      other: 'catOther',
    }

    /** 后缀到分类的映射；未列出的后缀归入 `other`。 */
    const CATEGORY_EXTENSIONS = {
      doc: ['pdf', 'doc', 'docx', 'md', 'markdown', 'txt', 'rtf', 'odt', 'pages', 'epub', 'log'],
      sheet: ['xlsx', 'xls', 'csv', 'tsv', 'ods', 'numbers'],
      slide: ['pptx', 'ppt', 'key', 'odp'],
      image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif', 'heic', 'tif', 'tiff'],
      code: [
        'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'json', 'jsonc', 'py', 'java', 'kt', 'kts', 'go',
        'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'sh', 'ps1', 'bat', 'sql', 'css', 'scss',
        'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'vue', 'svelte', 'swift',
        'dart', 'lua', 'r', 'pl', 'tex', 'gradle', 'properties', 'patch', 'diff',
      ],
    }

    /** 只使用主题令牌的样式表；组件卸载时 React 一并移除。 */
    const STYLE_TEXT = [
      '.ui-artifacts-center-root{display:flex;flex-direction:column;height:100%;min-height:0;',
      'background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);}',
      '.ui-artifacts-center-head{display:flex;align-items:flex-start;gap:16px;padding:20px 24px 12px;}',
      '.ui-artifacts-center-head h2{margin:0;font-size:16px;font-weight:600;line-height:1.4;}',
      '.ui-artifacts-center-sub{margin:4px 0 0;font-size:12px;line-height:1.5;',
      'color:var(--dsw-alias-label-secondary);}',
      '.ui-artifacts-center-spacer{flex:1 1 auto;}',
      '.ui-artifacts-center-button{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;',
      'height:28px;padding:0 10px;border-radius:8px;cursor:pointer;font-size:12px;',
      'color:var(--dsw-alias-label-secondary);background:transparent;',
      'border:1px solid var(--dsw-alias-border-l1);}',
      '.ui-artifacts-center-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);',
      'color:var(--dsw-alias-label-primary);}',
      '.ui-artifacts-center-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);',
      'outline-offset:2px;}',
      '.ui-artifacts-center-button:disabled{cursor:default;opacity:.6;}',
      '.ui-artifacts-filters{display:flex;flex-wrap:wrap;align-items:center;gap:6px;',
      'padding:0 24px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);}',
      '.ui-artifacts-chip{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;',
      'border-radius:13px;cursor:pointer;font-size:12px;background:transparent;',
      'color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);}',
      '.ui-artifacts-chip:hover{background:var(--dsw-alias-bg-layer-2);',
      'color:var(--dsw-alias-label-primary);}',
      '.ui-artifacts-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);',
      'outline-offset:2px;}',
      '.ui-artifacts-chip[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);',
      'border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:600;}',
      '.ui-artifacts-chip-count{font-size:11px;font-variant-numeric:tabular-nums;opacity:.75;}',
      '.ui-artifacts-filters-spacer{flex:1 1 auto;}',
      '.ui-artifacts-center-body{flex:1 1 auto;min-height:0;overflow:auto;padding:8px 24px 32px;}',
      '.ui-artifacts-center-note{margin:8px 0 0;font-size:12px;line-height:1.6;',
      'color:var(--dsw-alias-label-secondary);}',
      '.ui-artifacts-center-state{display:flex;flex-direction:column;align-items:flex-start;gap:8px;',
      'max-width:560px;margin:48px auto 0;font-size:13px;line-height:1.7;',
      'color:var(--dsw-alias-label-secondary);}',
      '.ui-artifacts-center-state strong{font-size:14px;color:var(--dsw-alias-label-primary);}',
      '.ui-artifacts-project{margin-top:16px;}',
      '.ui-artifacts-project-head{display:flex;align-items:center;gap:8px;width:100%;',
      'padding:6px 8px;margin:0 -8px;border:0;border-radius:8px;cursor:pointer;text-align:left;',
      'background:transparent;color:inherit;font:inherit;}',
      '.ui-artifacts-project-head:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.ui-artifacts-project-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);',
      'outline-offset:-2px;}',
      '.ui-artifacts-chevron{flex:0 0 auto;width:12px;font-size:10px;line-height:1;',
      'color:var(--dsw-alias-label-secondary);}',
      '.ui-artifacts-project-name{font-size:13px;font-weight:600;}',
      '.ui-artifacts-project-count{font-size:11px;line-height:18px;padding:0 6px;border-radius:9px;',
      'color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);}',
      '.ui-artifacts-project-path{margin-left:auto;font-size:11px;overflow:hidden;',
      'white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary);}',
      '.ui-artifacts-rows{padding-top:2px;}',
      '.ui-artifacts-row{display:flex;align-items:center;gap:10px;width:100%;padding:8px;',
      'margin:0 -8px;border:0;border-radius:8px;cursor:pointer;text-align:left;',
      'background:transparent;color:inherit;font:inherit;}',
      '.ui-artifacts-row:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.ui-artifacts-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);',
      'outline-offset:-2px;}',
      '.ui-artifacts-dot{flex:0 0 auto;width:6px;height:6px;border-radius:50%;',
      'background:var(--dsw-alias-brand-primary);}',
      '.ui-artifacts-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;}',
      '.ui-artifacts-name{font-size:13px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}',
      '.ui-artifacts-desc{font-size:11px;line-height:1.5;overflow:hidden;',
      'white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary);}',
      '.ui-artifacts-tag{flex:0 0 auto;font-size:11px;line-height:18px;padding:0 6px;border-radius:9px;',
      'color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);}',
      '.ui-artifacts-tag-delivered{color:var(--dsw-alias-state-success-primary);',
      'border-color:var(--dsw-alias-state-success-primary);}',
      '.ui-artifacts-time{flex:0 0 auto;font-size:11px;font-variant-numeric:tabular-nums;',
      'color:var(--dsw-alias-label-secondary);}',
    ].join('')

    /**
     * 把 `{name}` 占位符替换成实际值。
     * @param {string} text - 文案模板。
     * @param {Record<string, string|number>} values - 占位符取值。
     * @returns {string} 填充后的文案。
     */
    function interpolate(text, values) {
      let out = String(text)
      for (const key of Object.keys(values)) {
        out = out.split('{' + key + '}').join(String(values[key]))
      }
      return out
    }

    /**
     * 相对时间文案。
     * @param {number} at - 毫秒时间戳。
     * @param {(key: string, values?: Record<string, string|number>) => string} t - 当前语言。
     * @returns {string} 相对时间；无时间戳时为空串。
     */
    function relativeTime(at, t) {
      if (!at) return ''
      const diff = Math.max(0, Date.now() - at)
      const minutes = Math.floor(diff / 60000)
      if (minutes < 1) return t('justNow')
      if (minutes < 60) return t('minutesAgo', { n: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return t('hoursAgo', { n: hours })
      return t('daysAgo', { n: Math.floor(hours / 24) })
    }

    /**
     * 按文件名后缀归类。
     * @param {string} name - 文件名。
     * @returns {string} 分类键，未知后缀为 `other`。
     */
    function categoryOf(name) {
      const dot = typeof name === 'string' ? name.lastIndexOf('.') : -1
      if (dot < 0 || dot === name.length - 1) return 'other'
      const extension = name.slice(dot + 1).toLowerCase()
      for (const key of Object.keys(CATEGORY_EXTENSIONS)) {
        if (CATEGORY_EXTENSIONS[key].indexOf(extension) >= 0) return key
      }
      return 'other'
    }

    /**
     * 地址段编码：组件编码，但保留 `:` 字面量（与 `dsh-resource://file` 语法一致）。
     * @param {string} value - 待编码的一段。
     * @returns {string} 编码后的段。
     */
    function encodeSegment(value) {
      return encodeURIComponent(String(value)).replace(/%3A/gi, ':')
    }

    /**
     * 构造右侧栏可路由的 Session 文件地址：`dsh-resource://file/session/<id>/<path>`。
     * 位于会话工作目录内的路径转为相对路径，其余保留绝对路径。
     * @param {string} sessionId - 授权该次 Host 读取的会话。
     * @param {string} cwd - 该项目的工作目录。
     * @param {string} absolutePath - 产物的绝对路径。
     * @returns {string} 资源地址。
     */
    function fileAddress(sessionId, cwd, absolutePath) {
      const normalized = String(absolutePath).replace(/\\/g, '/')
      const root = cwd ? String(cwd).replace(/\\/g, '/').replace(/\/+$/, '') : ''
      let path = normalized
      if (root !== '' && normalized.length > root.length) {
        const head = normalized.slice(0, root.length)
        if (head.toLowerCase() === root.toLowerCase() && normalized.charAt(root.length) === '/') {
          path = normalized.slice(root.length + 1)
        }
      }
      const segments = path.split('/').map(encodeSegment)
      return 'dsh-resource://file/session/' + encodeSegment(sessionId) + '/' + segments.join('/')
    }

    /**
     * 侧边栏图标。宿主通过 `size` / `active` 传入几何与选中态，图形使用
     * `currentColor` 跟随外壳着色。
     * @param {{size?: number, active?: boolean}} props - 宿主传入的图标属性。
     * @returns {import('react').ReactElement} 图标。
     */
    function ArtifactsIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 20
      const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 }
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { ...common, d: 'M3.2 9.2h17.6' }),
        h('path', { ...common, d: 'M5 9.2V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.2' }),
        h('path', { ...common, d: 'M9.4 9.2V6.4a1.8 1.8 0 0 1 1.8-1.8h1.6a1.8 1.8 0 0 1 1.8 1.8v2.8' }),
        h('path', { ...common, d: 'M5 14.2h4.1l1.1 1.7h3.6l1.1-1.7H19' }),
      )
    }

    /**
     * 一条产物行。主点击进入右侧栏预览，`Ctrl`/`⌘` 点击在新标签页打开。
     * @param {{artifact: object, t: Function, onOpen: () => void, fileUrl: string}} props - 行属性。
     * @returns {import('react').ReactElement} 行。
     */
    function ArtifactRow(props) {
      const artifact = props.artifact
      const t = props.t
      const delivered = artifact.source === 'delivered'
      const secondary = artifact.description || artifact.sessionTitle || ''
      const tooltip =
        artifact.path +
        (artifact.sessionTitle ? '\n' + artifact.sessionTitle : '') +
        '\n' +
        t('openHint')
      return h(
        'button',
        {
          type: 'button',
          className: 'ui-artifacts-row',
          title: tooltip,
          onClick: (event) => {
            if (event.metaKey || event.ctrlKey) {
              window.open(props.fileUrl, '_blank', 'noopener')
              return
            }
            props.onOpen()
          },
        },
        h('span', { className: 'ui-artifacts-dot', 'aria-hidden': 'true' }),
        h(
          'span',
          { className: 'ui-artifacts-main' },
          h('span', { className: 'ui-artifacts-name' }, artifact.name || artifact.path),
          secondary ? h('span', { className: 'ui-artifacts-desc' }, secondary) : null,
        ),
        h(
          'span',
          {
            className: delivered
              ? 'ui-artifacts-tag ui-artifacts-tag-delivered'
              : 'ui-artifacts-tag',
          },
          t(delivered ? 'delivered' : 'produced'),
        ),
        h('span', { className: 'ui-artifacts-time' }, relativeTime(artifact.at, t)),
      )
    }

    /**
     * 一个项目分组：标题行可折叠，折叠状态由面板持有。
     * @param {{project: object, t: Function, collapsed: boolean, onToggle: Function, onOpen: Function}} props - 分组属性。
     * @returns {import('react').ReactElement} 分组。
     */
    function ProjectSection(props) {
      const project = props.project
      const t = props.t
      const artifacts = Array.isArray(project.artifacts) ? project.artifacts : []
      const collapsed = props.collapsed === true
      const children = [
        h('span', { className: 'ui-artifacts-chevron', 'aria-hidden': 'true' }, collapsed ? '▶' : '▼'),
        h('span', { className: 'ui-artifacts-project-name' }, project.title || t('unknownDir')),
        h('span', { className: 'ui-artifacts-project-count' }, String(artifacts.length)),
        h(
          'span',
          { className: 'ui-artifacts-project-path', title: project.path || '' },
          project.path || '',
        ),
      ]
      const rows = collapsed
        ? null
        : h(
            'div',
            { className: 'ui-artifacts-rows' },
            artifacts.map((artifact) =>
              h(ArtifactRow, {
                key: artifact.path,
                artifact,
                t,
                fileUrl: FILE_URL + encodeURIComponent(artifact.path),
                onOpen: () => props.onOpen(artifact, project),
              }),
            ),
          )
      return h(
        'section',
        { className: 'ui-artifacts-project' },
        h(
          'button',
          {
            type: 'button',
            className: 'ui-artifacts-project-head',
            'aria-expanded': collapsed ? 'false' : 'true',
            onClick: () => props.onToggle(project.key || project.title),
          },
          children,
        ),
        rows,
      )
    }

    /**
     * 面板主体。
     * @param {{t: Function, load: () => Promise<object>, open: Function}} props - 注入的语言、索引读取与右侧栏打开函数。
     * @returns {import('react').ReactElement} 面板。
     */
    function ArtifactsPage(props) {
      const t = props.t
      const [snapshot, setSnapshot] = React.useState({ status: 'loading', data: null, error: '' })
      const [nonce, setNonce] = React.useState(0)
      const [category, setCategory] = React.useState('all')
      const [collapsed, setCollapsed] = React.useState({})

      React.useEffect(() => {
        let cancelled = false
        setSnapshot((current) => ({ status: 'loading', data: current.data, error: '' }))
        Promise.resolve()
          .then(() => props.load())
          .then((data) => {
            if (cancelled) return
            setSnapshot({ status: 'ready', data, error: '' })
          })
          .catch((error) => {
            if (cancelled) return
            setSnapshot({
              status: 'error',
              data: null,
              error: String((error && error.message) || error),
            })
          })
        return () => {
          cancelled = true
        }
      }, [nonce])

      const data = snapshot.data
      const projects = data && Array.isArray(data.projects) ? data.projects : []
      const diagnostics = (data && data.diagnostics) || {}
      const busy = snapshot.status === 'loading'

      /** 全部产物的分类计数。 */
      const countsByCategory = {}
      for (const key of CATEGORY_ORDER) countsByCategory[key] = 0
      for (const project of projects) {
        const artifacts = Array.isArray(project.artifacts) ? project.artifacts : []
        for (const artifact of artifacts) {
          countsByCategory.all += 1
          countsByCategory[categoryOf(artifact.name || artifact.path)] += 1
        }
      }

      /** 当前分类下的项目分组；没有匹配产物的项目整体隐藏。 */
      const visibleProjects = []
      let visibleArtifacts = 0
      for (const project of projects) {
        const artifacts = Array.isArray(project.artifacts) ? project.artifacts : []
        const matching =
          category === 'all'
            ? artifacts
            : artifacts.filter((artifact) => categoryOf(artifact.name || artifact.path) === category)
        if (matching.length === 0) continue
        visibleArtifacts += matching.length
        visibleProjects.push({ project, artifacts: matching })
      }

      const toggleProject = (key) => {
        setCollapsed((current) => {
          const next = { ...current }
          if (next[key] === true) delete next[key]
          else next[key] = true
          return next
        })
      }

      const setAllCollapsed = (value) => {
        if (!value) {
          setCollapsed({})
          return
        }
        const next = {}
        for (const entry of visibleProjects) next[entry.project.key || entry.project.title] = true
        setCollapsed(next)
      }

      const head = h(
        'div',
        { className: 'ui-artifacts-center-head' },
        h(
          'div',
          null,
          h('h2', null, t('title')),
          h('p', { className: 'ui-artifacts-center-sub' }, t('subtitle')),
        ),
        h('div', { className: 'ui-artifacts-center-spacer' }),
        h(
          'button',
          {
            type: 'button',
            className: 'ui-artifacts-center-button',
            disabled: busy,
            onClick: () => setNonce((value) => value + 1),
          },
          busy ? t('refreshing') : t('refresh'),
        ),
      )

      const chips = CATEGORY_ORDER.filter(
        (key) => key === 'all' || countsByCategory[key] > 0 || key === category,
      ).map((key) =>
        h(
          'button',
          {
            key,
            type: 'button',
            className: 'ui-artifacts-chip',
            'aria-pressed': key === category ? 'true' : 'false',
            onClick: () => setCategory(key),
          },
          t(CATEGORY_LABELS[key]),
          h('span', { className: 'ui-artifacts-chip-count' }, String(countsByCategory[key])),
        ),
      )

      const filters =
        data === null
          ? null
          : h(
              'div',
              { className: 'ui-artifacts-filters' },
              chips,
              h('div', { className: 'ui-artifacts-filters-spacer' }),
              visibleProjects.length > 0
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'ui-artifacts-center-button',
                      onClick: () => setAllCollapsed(Object.keys(collapsed).length === 0),
                    },
                    Object.keys(collapsed).length === 0 ? t('collapseAll') : t('expandAll'),
                  )
                : null,
            )

      let body
      if (data === null && snapshot.status === 'error') {
        body = h(
          'div',
          { className: 'ui-artifacts-center-state' },
          h('strong', null, t('errorTitle')),
          h('span', null, snapshot.error),
          h(
            'button',
            {
              type: 'button',
              className: 'ui-artifacts-center-button',
              onClick: () => setNonce((value) => value + 1),
            },
            t('retry'),
          ),
        )
      } else if (data === null) {
        body = h('div', { className: 'ui-artifacts-center-state' }, t('loading'))
      } else if (data.available === false) {
        body = h(
          'div',
          { className: 'ui-artifacts-center-state' },
          h('strong', null, t('unavailableTitle')),
          h('span', null, String(data.reason || '')),
        )
      } else if (projects.length === 0) {
        body = h(
          'div',
          { className: 'ui-artifacts-center-state' },
          h('strong', null, t('emptyTitle')),
          h('span', null, t('emptyBody')),
        )
      } else if (visibleProjects.length === 0) {
        body = h('div', { className: 'ui-artifacts-center-state' }, t('emptyFiltered'))
      } else {
        const notes = []
        if (typeof diagnostics.considered === 'number' && diagnostics.considered > 0) {
          notes.push(
            t('scanNote', {
              scanned: String(diagnostics.scanned || 0),
              considered: String(diagnostics.considered),
            }),
          )
        }
        if (diagnostics.stoppedEarly === true) notes.push(t('partialNote'))
        if (Array.isArray(diagnostics.errors) && diagnostics.errors.length > 0) {
          notes.push(t('errorNote', { message: String(diagnostics.errors[0]) }))
        }
        body = h(
          React.Fragment,
          null,
          h(
            'p',
            { className: 'ui-artifacts-center-note' },
            t('counts', {
              projects: String(visibleProjects.length),
              artifacts: String(visibleArtifacts),
            }),
            notes.length > 0 ? ' · ' + notes.join('') : '',
          ),
          visibleProjects.map((entry) =>
            h(ProjectSection, {
              key: entry.project.key || entry.project.title,
              project: { ...entry.project, artifacts: entry.artifacts },
              t,
              collapsed: collapsed[entry.project.key || entry.project.title] === true,
              onToggle: toggleProject,
              onOpen: props.open,
            }),
          ),
        )
      }

      return h(
        'div',
        { className: 'ui-artifacts-center-root' },
        h('style', null, STYLE_TEXT),
        head,
        filters,
        h('div', { className: 'ui-artifacts-center-body' }, body),
      )
    }

    /**
     * 读取 Host 侧的产物索引。
     * @returns {Promise<object>} 索引载荷。
     */
    function loadIndex() {
      const url = new URL(INDEX_URL, document.baseURI).toString()
      return fetch(url, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
        .then((response) => {
          if (!response.ok) throw new Error('HTTP ' + String(response.status))
          return response.json()
        })
        .then((payload) => {
          if (payload && typeof payload.error === 'string' && payload.error !== '') {
            throw new Error(payload.error)
          }
          return payload
        })
    }

    /**
     * 注册字典、侧边栏图标与主面板。
     * @param {object} ctx - 浏览器 Cordis 上下文。
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-artifacts: dictionaries')
      const translate = ctx.locale.bind(NS)

      /** 供组件使用的翻译函数：支持 `{name}` 占位符。 */
      const t = (key, values) => interpolate(translate(key), values || {})

      /**
       * 把产物送进右侧栏预览。
       *
       * 右侧栏按 Session 保有一个表面，且只在会话占据中间列时才存在：主面板会把
       * 中间列换成自己，`sidebarRight.require()` 此时没有可写的表面。所以先把中间
       * 列交还会话，再在随后的动画帧里打开资源，直到表面挂载完成。
       *
       * @param {object} artifact - 产物记录。
       * @param {object} project - 该产物所属项目（提供工作目录）。
       */
      const openArtifact = (artifact, project) => {
        const controller = ctx.sidebarRight
        if (!controller || typeof controller.openResource !== 'function') return
        const address = fileAddress(artifact.sessionId, project.path, artifact.path)
        let attempts = 24
        const step = () => {
          try {
            controller.openResource(address)
          } catch (error) {
            attempts -= 1
            if (attempts > 0) {
              window.requestAnimationFrame(step)
              return
            }
            console.error('ui-artifacts: cannot preview in the right sidebar:', error)
            window.open(FILE_URL + encodeURIComponent(artifact.path), '_blank', 'noopener')
          }
        }
        ctx.layout.selectPanel(null)
        window.requestAnimationFrame(step)
      }

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: 'artifacts',
            locale: NS,
            inject: () => ({ t, load: loadIndex, open: openArtifact }),
          },
          ArtifactsPage,
        ),
      )

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'artifacts',
            order: 20,
            locale: NS,
            label: () => t('panel'),
          },
          ArtifactsIcon,
        ),
      )
    }

    return { inject: ['slots', 'locale', 'layout', 'sidebarRight'], apply }
  },
})
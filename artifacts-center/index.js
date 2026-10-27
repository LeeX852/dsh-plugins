/**
 * 产物中心（Artifacts Center）Host half。
 *
 * 把「会话日志里能被证实的产物」按项目（会话工作目录）聚合起来，供浏览器端的
 * 左侧栏面板展示：
 *
 * - `present` 工具声明的交付文件（`present` 调用的参数与
 *   `deliverables/presented` 事件），标记为 `delivered`；
 * - `write` / `edit` / `str_replace_editor` 等文件工具落盘的目标，标记为
 *   `produced`。
 *
 * 数据全部来自持久化的会话日志（`ctx.sessionQuery`），因此 Host 重启后依然可读，
 * 不依赖任何 Host 内存态；相对路径按该会话的工作目录解析。扫描有会话数与时间
 * 预算，并在 15 秒内复用结果，避免面板刷新反复重读日志。
 *
 * 浏览器通过文档相对的 `api/artifacts.index` 读取；路由注册在 Connection 的
 * exact Fetch 路由表上，Host/Origin 与浏览器会话校验由 Connection 统一负责。
 *
 * @module @local/artifacts-center
 */

import { tmpdir } from 'node:os'

/** 浏览器请求的绝对注册路径。 */
const ROUTE_PATH = '/api/artifacts.index'

/** 一次索引最多扫描的会话数（`listSessions` 是 newest-first 顺序）。 */
const MAX_SESSIONS = 60

/** 一次索引的构建时间预算，超过后返回已扫描到的部分结果。 */
const SCAN_BUDGET_MS = 7000

/** 每个项目最多携带的产物条数。 */
const MAX_ARTIFACTS_PER_PROJECT = 200

/** 索引缓存时长：面板刷新与重连不会反复重读会话日志。 */
const CACHE_TTL_MS = 15000

/** 会话日志中「显式交付」事件的类型。 */
const DELIVERY_EVENT = 'deliverables/presented'

/** 会把文件写到磁盘的文件工具。 */
const FILE_WRITES = new Set([
  'write',
  'edit',
  'str_replace_editor',
  'str_replace_based_edit_tool',
  'apply_patch',
])

/** Host 侧必需服务；其余服务在请求时按需读取，缺省时降级而不是让插件失活。 */
export const inject = ['connection']

/** 模块级缓存：`{ at, value }`。插件热重载后重新计算。 */
let cache = { at: 0, value: undefined }

/**
 * 注册产物索引路由。
 * @param ctx - Host 上下文，需要 `connection` 服务。
 */
export function apply(ctx) {
  const connection = Reflect.get(ctx, 'connection')
  if (!connection || !connection.fetch || typeof connection.fetch.register !== 'function') return
  const dispose = connection.fetch.register({
    path: ROUTE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => respond(ctx, request),
  })
  if (typeof dispose === 'function') ctx.effect(() => dispose, 'ui-artifacts: index route')
}

/**
 * 应答一次索引请求。
 * @param ctx - Host 上下文。
 * @param request - 浏览器发来的 Request。
 * @returns JSON 响应；失败以 4xx/5xx 加 `error` 字段返回，而不是抛出。
 */
async function respond(ctx, request) {
  try {
    return jsonResponse(await buildIndex(ctx), 200)
  } catch (error) {
    return jsonResponse({ error: describeError(error), projects: [], totals: emptyTotals() }, 500)
  }
}

/**
 * 构建（或复用缓存的）产物索引。
 * @param ctx - Host 上下文。
 * @returns 按项目分组的产物索引。
 */
async function buildIndex(ctx) {
  const now = Date.now()
  if (cache.value !== undefined && now - cache.at < CACHE_TTL_MS) return cache.value

  const query = ctx.get ? ctx.get('sessionQuery') : undefined
  if (!query || typeof query.listSessions !== 'function' || typeof query.readSession !== 'function') {
    const unavailable = {
      generatedAt: now,
      available: false,
      reason: '缺少 sessionQuery 服务，无法读取会话日志',
      projects: [],
      totals: emptyTotals(),
    }
    cache = { at: now, value: unavailable }
    return unavailable
  }

  const errors = []
  let records = []
  try {
    records = asArray(await query.listSessions())
  } catch (error) {
    errors.push('列出会话失败：' + describeError(error))
  }

  const candidates = []
  for (const record of records.slice(0, MAX_SESSIONS)) {
    const header = isObject(record) && isObject(record.header) ? record.header : record
    const id =
      asString(header && header.id) || asString(record && record.sessionId) || asString(record && record.id)
    if (id === '') continue
    candidates.push({ id, cwd: normalizeCwd(asString(header && header.cwd)) })
  }

  const workspaceTitles = await readWorkspaceTitles(ctx)
  const started = Date.now()
  let scanned = 0
  let stoppedEarly = false

  /** @type {Map<string, object>} 项目聚合体，键为小写路径。 */
  const projects = new Map()
  /** @type {Set<string>} 产出过产物的会话 id，只给它们读标题。 */
  const touched = new Set()

  for (const candidate of candidates) {
    if (Date.now() - started > SCAN_BUDGET_MS) {
      stoppedEarly = true
      break
    }
    let loaded
    try {
      loaded = await query.readSession(candidate.id)
    } catch (error) {
      errors.push('读取会话 ' + candidate.id + ' 失败：' + describeError(error))
      continue
    }
    scanned += 1
    const header = isObject(loaded) && isObject(loaded.session) ? loaded.session : undefined
    const cwd = normalizeCwd(asString(header && header.cwd)) || candidate.cwd
    const found = artifactsOfSession(asArray(loaded && loaded.events), cwd)
    if (found.length === 0) continue
    const project = projectOf(projects, cwd, workspaceTitles)
    for (const artifact of found) {
      artifact.sessionId = candidate.id
      artifact.sessionTitle = ''
      project.artifacts.set(artifact.path.toLowerCase(), artifact)
      if (artifact.at > project.latestAt) project.latestAt = artifact.at
    }
    project.sessions.set(candidate.id, { id: candidate.id, title: '' })
    touched.add(candidate.id)
  }

  const titles = await readTitles(query, Array.from(touched), errors)
  if (titles.size > 0) {
    for (const project of projects.values()) {
      for (const session of project.sessions.values()) {
        const title = titles.get(session.id)
        if (title !== undefined) session.title = title
      }
      for (const artifact of project.artifacts.values()) {
        const title = titles.get(artifact.sessionId)
        if (title !== undefined) artifact.sessionTitle = title
      }
    }
  }

  const built = {
    generatedAt: Date.now(),
    available: true,
    projects: finalizeProjects(projects),
    totals: emptyTotals(),
    diagnostics: {
      records: records.length,
      considered: candidates.length,
      scanned,
      stoppedEarly,
      errors: errors.slice(0, 5),
    },
  }
  for (const project of built.projects) {
    built.totals.projects += 1
    built.totals.sessions += project.sessions.length
    built.totals.artifacts += project.artifacts.length
    for (const artifact of project.artifacts) {
      if (artifact.source === 'delivered') built.totals.delivered += 1
      else built.totals.produced += 1
    }
  }

  cache = { at: built.generatedAt, value: built }
  return built
}

/**
 * 取（或创建）一个项目分组。
 * @param projects - 项目映射，键为小写路径。
 * @param cwd - 会话工作目录；空串表示未知。
 * @param workspaceTitles - 工作区路径（小写）到显示名的映射。
 * @returns 该项目的可变聚合体。
 */
function projectOf(projects, cwd, workspaceTitles) {
  const key = cwd.toLowerCase()
  const existing = projects.get(key)
  if (existing !== undefined) return existing
  const project = {
    key: cwd,
    title: workspaceTitles.get(key) || basenameOf(cwd) || '',
    path: cwd,
    latestAt: 0,
    sessions: new Map(),
    artifacts: new Map(),
  }
  projects.set(key, project)
  return project
}

/**
 * 把可变聚合体整理成响应里的项目数组：按最近产物倒序、限制条数。
 * @param projects - 项目映射。
 * @returns 有序的项目数组。
 */
function finalizeProjects(projects) {
  const list = []
  for (const project of projects.values()) {
    const artifacts = Array.from(project.artifacts.values())
    artifacts.sort((left, right) => right.at - left.at)
    list.push({
      key: project.key,
      title: project.title,
      path: project.path,
      latestAt: project.latestAt,
      sessions: Array.from(project.sessions.values()),
      artifacts: artifacts.slice(0, MAX_ARTIFACTS_PER_PROJECT),
      total: artifacts.length,
    })
  }
  list.sort((left, right) => right.latestAt - left.latestAt)
  return list
}

/**
 * 从一个会话的事件日志里提取产物。
 * @param events - 会话事件（`readSession().events`）。
 * @param cwd - 该会话的工作目录，用于解析相对路径。
 * @returns 按路径去重后的产物列表。
 */
function artifactsOfSession(events, cwd) {
  const byPath = new Map()
  for (const event of events) {
    if (!isObject(event)) continue
    const type = asString(event.type)
    const at = asNumber(event.time, 0)
    if (type === 'tool/call') {
      collectToolCall(event, at, cwd, byPath)
      continue
    }
    if (type === DELIVERY_EVENT || (type !== '' && type.indexOf('deliverables') === 0)) {
      const payload = event.data === undefined ? event : event.data
      for (const files of findFilesArrays(payload)) {
        for (const file of files) {
          const path = artifactPathOf(file, cwd)
          if (path !== '') setArtifact(byPath, path, asString(file && file.description), 'delivered', at)
        }
      }
    }
  }
  return Array.from(byPath.values())
}

/**
 * 从一条 `tool/call` 事件里提取产物。
 * @param event - `tool/call` 事件。
 * @param at - 事件时间（毫秒）。
 * @param cwd - 会话工作目录。
 * @param byPath - 当前会话的产物映射（原地修改）。
 */
function collectToolCall(event, at, cwd, byPath) {
  const data = isObject(event.data) ? event.data : event
  const name = asString(data.name) || asString(data.tool)
  const args = parseArguments(data.arguments !== undefined ? data.arguments : data.input)
  if (name === 'present') {
    const files = args !== undefined && Array.isArray(args.files) ? args.files : []
    for (const file of files) {
      const path = artifactPathOf(file, cwd)
      if (path !== '') setArtifact(byPath, path, asString(file && file.description), 'delivered', at)
    }
    return
  }
  if (!FILE_WRITES.has(name) || args === undefined) return
  const path = artifactPathOf(args, cwd)
  if (path !== '') setArtifact(byPath, path, '', 'produced', at)
}

/**
 * 记录一条产物；同一路径上显式交付优先于工具落盘，其次取更新的一条。
 * @param byPath - 产物映射。
 * @param path - 绝对路径。
 * @param description - `present` 给出的说明，可为空。
 * @param source - `delivered` 或 `produced`。
 * @param at - 事件时间（毫秒）。
 */
function setArtifact(byPath, path, description, source, at) {
  const key = path.toLowerCase()
  const existing = byPath.get(key)
  if (existing === undefined) {
    byPath.set(key, { path, name: basenameOf(path), description, source, at })
    return
  }
  const prefers = source === 'delivered' && existing.source !== 'delivered'
  const fresher = source === existing.source && at > existing.at
  if (prefers || fresher) {
    byPath.set(key, {
      path,
      name: basenameOf(path),
      description: description !== '' ? description : existing.description,
      source,
      at: Math.max(at, existing.at),
    })
    return
  }
  if (existing.description === '' && description !== '') existing.description = description
}

/**
 * 在任意 JSON 结构中找出所有 `files` 数组（用于未知载荷形状的交付事件）。
 * @param root - 事件载荷。
 * @returns 形如 `[{ path, description }]` 的数组集合。
 */
function findFilesArrays(root) {
  const found = []
  const seen = new Set()
  const stack = [root]
  let visited = 0
  while (stack.length > 0 && visited < 400) {
    visited += 1
    const node = stack.pop()
    if (node === null || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item !== null && typeof item === 'object') stack.push(item)
      }
      continue
    }
    if (Array.isArray(node.files)) found.push(node.files)
    for (const key of Object.keys(node)) {
      const value = node[key]
      if (value !== null && typeof value === 'object') stack.push(value)
    }
  }
  return found
}

/**
 * 读取一批会话标题；失败时返回空映射，不影响产物索引。
 * @param query - `sessionQuery` 服务。
 * @param ids - 会话 id 列表。
 * @param errors - 诊断信息收集数组。
 * @returns 会话 id 到标题的映射。
 */
async function readTitles(query, ids, errors) {
  const titles = new Map()
  if (ids.length === 0 || typeof query.readTitleSnapshots !== 'function') return titles
  let results
  try {
    results = await query.readTitleSnapshots(ids)
  } catch (error) {
    errors.push('读取会话标题失败：' + describeError(error))
    return titles
  }
  const list = asArray(results)
  for (let index = 0; index < list.length && index < ids.length; index += 1) {
    const result = list[index]
    if (!isObject(result) || result.status === 'rejected') continue
    const value = isObject(result.value) ? result.value : result
    const title = asString(value.title)
    if (title !== '') titles.set(ids[index], title)
  }
  return titles
}

/**
 * 读取工作区显示名，让项目标题与左侧栏一致。
 * @param ctx - Host 上下文。
 * @returns 小写路径到显示名的映射。
 */
async function readWorkspaceTitles(ctx) {
  const titles = new Map()
  const registry = ctx.get ? ctx.get('workspaceRegistry') : undefined
  if (!registry || typeof registry.list !== 'function') return titles
  try {
    for (const workspace of asArray(await registry.list())) {
      if (!isObject(workspace)) continue
      const path = normalizeCwd(
        asString(workspace.path) || asString(workspace.directory) || asString(workspace.cwd),
      )
      const title = asString(workspace.title) || asString(workspace.name)
      if (path !== '' && title !== '') titles.set(path.toLowerCase(), title)
    }
  } catch {
    /* 显示名只是增强项；读取失败时退回目录名。 */
  }
  return titles
}

/**
 * 解析工具参数：会话日志把 `arguments` 存成 JSON 字符串。
 * @param raw - 原始参数值。
 * @returns 对象参数，无法解析时返回 undefined。
 */
function parseArguments(raw) {
  if (isObject(raw)) return raw
  if (typeof raw !== 'string' || raw === '') return undefined
  try {
    const parsed = JSON.parse(raw)
    return isObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * 从文件条目或工具参数里取产物路径，相对路径按会话工作目录解析。
 * @param value - 文件条目或工具参数。
 * @param cwd - 会话工作目录。
 * @returns 规范化后的绝对路径；无法确定或位于临时目录时返回空串。
 */
function artifactPathOf(value, cwd) {
  if (!isObject(value)) return ''
  const raw =
    asString(value.path) ||
    asString(value.file_path) ||
    asString(value.filePath) ||
    asString(value.absolutePath)
  if (raw === '' || raw.length > 1024) return ''
  const resolved = resolvePath(raw, cwd)
  if (resolved === '' || isUnderTemp(resolved)) return ''
  return resolved
}

/**
 * 解析路径：绝对路径直接规范化，相对路径以会话工作目录为基准。
 * @param raw - 原始路径。
 * @param cwd - 会话工作目录。
 * @returns 规范化后的绝对路径；无法解析时为空串。
 */
function resolvePath(raw, cwd) {
  let value = raw
  while (value.indexOf('./') === 0) value = value.slice(2)
  if (isAbsolutePath(value)) return normalizePath(value)
  if (cwd === '' || value.charAt(0) === '~' || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return ''
  const separator = cwd.indexOf('\\') >= 0 ? '\\' : '/'
  return normalizePath(cwd + separator + value)
}

/**
 * 判断是否为绝对路径（Windows 盘符、UNC 或 POSIX 根）。
 * @param path - 待判定路径。
 * @returns 是否为绝对路径。
 */
function isAbsolutePath(path) {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.charAt(0) === '/' || path.indexOf('\\\\') === 0
}

/**
 * 折叠 `.` 与 `..` 段，统一分隔符风格。
 * @param path - 绝对路径。
 * @returns 规范化路径。
 */
function normalizePath(path) {
  const windows = /^[a-zA-Z]:[\\/]/.test(path)
  const unc = path.indexOf('\\\\') === 0
  const separator = path.indexOf('\\') >= 0 ? '\\' : '/'
  const out = []
  for (const part of path.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length > 0) out.pop()
      continue
    }
    out.push(part)
  }
  if (windows) {
    const drive = out.length > 0 ? out.shift() : ''
    return out.length === 0 ? drive + '\\' : drive + '\\' + out.join(separator)
  }
  if (unc) return '\\\\' + out.join(separator)
  return '/' + out.join(separator)
}

/**
 * 判断路径是否位于系统临时目录（壳层临时产物不是用户要的产物）。
 * @param path - 绝对路径。
 * @returns 是否位于临时目录下。
 */
function isUnderTemp(path) {
  const lower = path.toLowerCase()
  const roots = [tmpdir(), '/tmp', '/var/tmp']
  for (const root of roots) {
    if (root === '') continue
    const normalized = root.toLowerCase().replace(/[\\/]+$/, '')
    if (normalized === '') continue
    if (lower === normalized || lower.indexOf(normalized + '\\') === 0 || lower.indexOf(normalized + '/') === 0) {
      return true
    }
  }
  return false
}

/**
 * 规范化工作目录：去掉尾部路径分隔符，保留原生形式。
 * @param value - 原始路径。
 * @returns 规范化后的路径，未知时为空串。
 */
function normalizeCwd(value) {
  let path = value
  while (path.length > 1 && (path.charAt(path.length - 1) === '\\' || path.charAt(path.length - 1) === '/')) {
    path = path.slice(0, -1)
  }
  return path
}

/**
 * 取路径最后一段作为显示名（Host 与浏览器平台无关）。
 * @param path - 任意路径。
 * @returns 最后一段；空路径返回空串。
 */
function basenameOf(path) {
  if (path === '') return ''
  const parts = path.split(/[\\/]+/).filter((part) => part !== '')
  return parts.length === 0 ? path : parts[parts.length - 1]
}

/**
 * 构造空统计对象。
 * @returns 归零的统计。
 */
function emptyTotals() {
  return { projects: 0, sessions: 0, artifacts: 0, delivered: 0, produced: 0 }
}

/**
 * 构造 JSON 响应。
 * @param value - 任意可序列化值。
 * @param status - HTTP 状态码。
 * @returns WHATWG Response。
 */
function jsonResponse(value, status) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * 把未知错误转成一行文本。
 * @param error - 任意抛出物。
 * @returns 可展示的错误文本。
 */
function describeError(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * 判断是否为普通对象。
 * @param value - 任意值。
 * @returns 是否为非数组对象。
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 取字符串值。
 * @param value - 任意值。
 * @returns 字符串，非字符串时为空串。
 */
function asString(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * 取有限数字值。
 * @param value - 任意值。
 * @param fallback - 缺省值。
 * @returns 有限数字或 fallback。
 */
function asNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * 取数组值。
 * @param value - 任意值。
 * @returns 数组，非数组时为空数组。
 */
function asArray(value) {
  return Array.isArray(value) ? value : []
}
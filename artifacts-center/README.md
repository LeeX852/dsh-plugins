# 产物中心 · Artifacts Center

在 DeepSeek Harness Web 的**左侧边栏**加一个「产物中心」面板，按**项目**（会话工作目录）
汇总 Agent 生成的产物文件。

## 它显示什么

| 标记 | 来源 | 说明 |
|---|---|---|
| 交付 | `present` 工具 | Agent 显式声明的交付物，带 Agent 给出的说明 |
| 写入 | `write` / `edit` / `str_replace_editor` | 文件工具落盘的目标文件 |

**顶部按类型分类**：全部 / 文档 / 表格 / 演示 / 图片 / 代码 / 其他（只显示有产物的分类，
每个分类带数量）。**下面按项目分组**，每组标题可点击折叠，也可以一键全部展开/折叠。
切换分类时，没有匹配产物的项目会整体隐藏。

**点击一行**把源文件送进右侧栏预览（`ctx.sidebarRight.openResource`，地址为
`dsh-resource://file/session/<会话>/<路径>`）；`Ctrl`/`⌘` 点击仍然在新标签页打开。

> 右侧栏按 Session 保有一个表面，且只在**会话占据中间列**时才存在。所以点击产物时
> 会先把中间列交还会话，再打开预览——也就是说点开一个产物会离开本面板，用左侧栏图标
> 可以随时回来。

数据全部从**持久化的会话日志**（`ctx.sessionQuery`）折叠出来，所以 Host 重启后依然可读，
不依赖任何内存态。同一路径只保留一行：显式交付优先于工具落盘，其次取更晚的一次。

- 一次最多扫描最近 60 个会话，7 秒时间预算，15 秒结果缓存。
- 相对路径按该会话的工作目录解析；系统临时目录下的文件不计入。

## 结构

| 文件 | 作用 |
|---|---|
| `index.js` | Host half：在 Connection 的 exact Fetch 路由表注册 `GET /api/artifacts.index`，聚合会话日志里的产物 |
| `client.js` | Client half：向 `sidebar.panellist` 注册托盘图标，向 `main` 注册 `artifacts` 面板 |
| `cordis.patch.yml` | 把插件行插入当前 profile |
| `locale/{zh,en}.json` | Plugin Manager / 设置页展示用的标题与描述 |
| `icon.svg` | 插件图标 |

接口契约（`GET api/artifacts.index`）：

```json
{
  "available": true,
  "generatedAt": 1793110136508,
  "totals": { "projects": 1, "sessions": 3, "artifacts": 12, "delivered": 2, "produced": 10 },
  "diagnostics": { "records": 20, "considered": 20, "scanned": 12, "stoppedEarly": false, "errors": [] },
  "projects": [
    {
      "key": "D:\\Sources\\ds-plugins",
      "title": "ds-plugins",
      "path": "D:\\Sources\\ds-plugins",
      "latestAt": 1793110136508,
      "total": 12,
      "sessions": [{ "id": "session-…", "title": "项目产物中心侧边栏" }],
      "artifacts": [
        {
          "path": "D:\\Sources\\ds-plugins\\artifacts-center\\index.js",
          "name": "index.js",
          "description": "",
          "source": "produced",
          "at": 1793110136508,
          "sessionId": "session-…",
          "sessionTitle": "项目产物中心侧边栏"
        }
      ]
    }
  ]
}
```

## 安装

用 `plugin_manager` 的 `install_bundle`：

- 本机目录：`target` 指向本目录的绝对路径（link 安装，目录不要删）。
- 从仓库：`target: "git+https://github.com/LeeX852/dsh-plugins.git#078eab31bfcfb5cb420ce7774f093d4267c68268&path:/artifacts-center"`（commit 可换成任意包含本目录的提交）。

## 卸载

`plugin_manager` 的 `remove_bundle`，`target` 为 `@local/artifacts-center`。
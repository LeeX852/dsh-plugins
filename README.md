# dsh-plugins

DeepSeek Harness（DSH）插件合集。每个子目录是一个可独立安装的 bundle。

| 插件 | 说明 |
|---|---|
| [`artifacts-center`](./artifacts-center/README.md) | 产物中心：在左侧栏按项目汇总 Agent 生成的产物，支持类型分类、按项目折叠、点击在右侧栏预览。 |

## 安装插件

插件以 **bundle** 形式安装进当前 profile，通过 `plugin_manager` 的 `install_bundle`：

### 方式一：从本仓库的 Git 地址安装（推荐）

需要带上 **commit** 和 `path:`。下面是首个版本的 commit，可以直接作为稳定安装点：

```
plugin_manager(
  action: "install_bundle",
  target: "git+https://github.com/LeeX852/dsh-plugins.git#078eab31bfcfb5cb420ce7774f093d4267c68268&path:/artifacts-center"
)
```

想装更新的版本时，把 `078eab3…` 换成那次提交的 `git rev-parse HEAD` 输出即可。

### 方式二：先克隆，再按目录安装

```bash
git clone https://github.com/LeeX852/dsh-plugins.git
```

```
plugin_manager(
  action: "install_bundle",
  target: "<克隆目录的绝对路径>/artifacts-center"
)
```

目录安装是 **link 安装**：插件指向该目录，**不要删除或移动它**，否则插件失效。

### 卸载

```
plugin_manager( action: "remove_bundle", target: "@local/artifacts-center" )
```

## 要求

- DSH Web（桌面版或 `dsh web`）。插件依赖 Web 客户端的 Slot 契约（`sidebar.panellist`、`main`、`sidebar.right.pane.tab`）与 Connection 的 exact Fetch 路由（`connection.fetch.register`）。跨 DSH 大版本可能不兼容，升级 DSH 后请回归一次。
- 无第三方运行时依赖、无构建步骤：`index.js` / `client.js` 就是产物。

## 目录约定

```
<插件名>/
  package.json          # dsh.bundle.patch + dsh.client
  cordis.patch.yml      # 插进 profile 的 Loader 行
  index.js              # Host half（ESM）
  client.js             # Client half（window.__ModuleLoader__ 工厂）
  locale/{zh,en}.json   # Plugin Manager 展示用标题/描述
  icon.svg              # 插件图标
  README.md             # 该插件自己的说明与接口契约
```

## 许可

尚未指定许可证。若需公开复用，请补充 `LICENSE`。
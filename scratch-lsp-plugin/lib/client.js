window.__ModuleLoader__.load({
	id: "dsh-lsp-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
    "use strict";
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name in all)
        __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

    // src/client/index.tsx
    var index_exports = {};
    __export(index_exports, {
      apply: () => apply,
      inject: () => inject
    });
    module.exports = __toCommonJS(index_exports);
    var import_react = require("react");
    var import_client = require("@deepseek-ai/dsh-client-runtime/client");
    var import_client2 = require("@deepseek-ai/dsh-client-locale/client");
    var import_client3 = require("@deepseek-ai/dsh-client-ui-settings/client");
    var import_client4 = require("@deepseek-ai/dsh-api-remotes/client");
    var import_jsx_runtime = require("react/jsx-runtime");
    var zh = {
      nav: "LSP \u8BED\u8A00",
      summary: "\u52FE\u9009\u542F\u7528\u7684\u8BED\u8A00\uFF1B\u672A\u5B89\u88C5\u7684\u670D\u52A1\u5668\u4FDD\u6301\u5173\u95ED\uFF0C\u907F\u514D\u6A21\u578B\u8BEF\u8C03\u3002",
      idleLabel: "\u7A7A\u95F2\u56DE\u6536\u8D85\u65F6\uFF08ms\uFF09",
      enabled: "\u542F\u7528",
      heavy: "\u91CD",
      experimental: "\u5B9E\u9A8C\u6027",
      statusOn: "\u5DF2\u542F\u7528",
      statusOff: "\u672A\u542F\u7528",
      statusAvailable: "\u53EF\u7528",
      statusMissing: "\u7F3A\u5931",
      statusUnknown: "\u2026",
      statusFailed: "\u72B6\u6001\u52A0\u8F7D\u5931\u8D25"
    };
    var en = {
      nav: "LSP Languages",
      summary: "Enable languages; servers that are not installed stay off to avoid wasted calls.",
      idleLabel: "Idle timeout (ms)",
      enabled: "Enabled",
      heavy: "heavy",
      experimental: "experimental",
      statusOn: "on",
      statusOff: "off",
      statusAvailable: "available",
      statusMissing: "missing",
      statusUnknown: "\u2026",
      statusFailed: "status load failed"
    };
    var dictionaries = { zh, en };
    var NS = "lsp";
    var FALLBACK_LANGUAGES = [
      { id: "typescript", displayName: "TypeScript/JavaScript", group: "\u524D\u7AEF", priority: "P0" },
      { id: "vue", displayName: "Vue", group: "\u524D\u7AEF", priority: "P1" },
      { id: "html", displayName: "HTML", group: "\u524D\u7AEF", priority: "P2" },
      { id: "css", displayName: "CSS/SCSS", group: "\u524D\u7AEF", priority: "P2" },
      { id: "python", displayName: "Python", group: "\u540E\u7AEF", priority: "P0" },
      { id: "go", displayName: "Go", group: "\u540E\u7AEF", priority: "P1" },
      { id: "rust", displayName: "Rust", group: "\u540E\u7AEF", priority: "P1", heavy: true },
      { id: "java", displayName: "Java", group: "\u540E\u7AEF", priority: "P2", heavy: true },
      { id: "csharp", displayName: "C#", group: "\u540E\u7AEF", priority: "P2", heavy: true },
      { id: "php", displayName: "PHP", group: "\u540E\u7AEF", priority: "P2" },
      { id: "ruby", displayName: "Ruby", group: "\u540E\u7AEF", priority: "P2" },
      { id: "cpp", displayName: "C/C++", group: "\u540E\u7AEF", priority: "P2" },
      { id: "kotlin", displayName: "Kotlin", group: "Android", priority: "P2" },
      { id: "swift", displayName: "Swift", group: "iOS", priority: "P1", heavy: true },
      { id: "sql", displayName: "SQL", group: "\u6570\u636E", priority: "P3", experimental: true },
      { id: "r", displayName: "R", group: "\u6570\u636E", priority: "P3", experimental: true }
    ];
    function LspSettingsSection({ t, useScope, setEnabled, setIdle, loadStatus, installLang }) {
      const [status, setStatus] = (0, import_react.useState)(void 0);
      const [loadFailed, setLoadFailed] = (0, import_react.useState)(false);
      const [installingId, setInstallingId] = (0, import_react.useState)(void 0);
      const [installError, setInstallError] = (0, import_react.useState)(void 0);
      const refresh = () => {
        loadStatus().then((s) => {
          setStatus(s);
          setLoadFailed(false);
        }).catch(() => setLoadFailed(true));
      };
      (0, import_react.useEffect)(() => {
        let alive = true;
        loadStatus().then((s) => {
          if (alive) {
            setStatus(s);
            setLoadFailed(false);
          }
        }).catch(() => {
          if (alive) setLoadFailed(true);
        });
        return () => {
          alive = false;
        };
      }, [loadStatus]);
      const onInstall = async (id) => {
        setInstallingId(id);
        setInstallError(void 0);
        try {
          const res = await installLang(id);
          if (!res.ok) setInstallError(`${id}: ${res.message ?? "install failed"}`);
          refresh();
        } catch (e) {
          setInstallError(`${id}: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setInstallingId(void 0);
        }
      };
      const scopeSnap = useScope((s) => s);
      const value = scopeSnap.value ?? {};
      const enabled = value.enabled ?? {};
      const idleMs = value.idleTimeoutMs ?? 3e5;
      const languages = status?.languages?.length ? status.languages : FALLBACK_LANGUAGES;
      const statuses = status?.statuses ?? {};
      const groups = [...new Set(languages.map((l) => l.group))];
      const toggle = (id, next) => {
        setEnabled({ ...enabled, [id]: next });
      };
      const changeIdle = (ms) => {
        setIdle(ms);
      };
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { margin: 0, color: "var(--dsw-alias-label-secondary)", fontSize: 13 }, children: t("summary") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("idleLabel") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              type: "number",
              value: idleMs,
              min: 0,
              step: 3e4,
              onChange: (e) => changeIdle(Number(e.target.value) || 0),
              style: { width: 120, padding: "4px 8px" }
            }
          )
        ] }),
        loadFailed && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { margin: 0, fontSize: 12, color: "var(--dsw-alias-label-error, #dc2626)" }, children: t("statusFailed") }),
        languages.length === 0 && !loadFailed && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { margin: 0, fontSize: 12, color: "var(--dsw-alias-label-tertiary)" }, children: t("statusUnknown") }),
        groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: { margin: "8px 0 0", fontSize: 14, fontWeight: 600 }, children: group }),
          languages.filter((l) => l.group === group).map((lang) => {
            const isOn = !!enabled[lang.id];
            const st = statuses[lang.id];
            const badge = st ? st.found ? { text: st.version ? `\u2713 ${st.version}` : t("statusAvailable"), color: "var(--dsw-alias-bg-success, #16a34a)" } : { text: `${t("statusMissing")} \u26A0`, color: "var(--dsw-alias-bg-warning, #d97706)" } : { text: t("statusUnknown"), color: "var(--dsw-alias-label-tertiary)" };
            return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "label",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  padding: "6px 0",
                  borderBottom: "1px solid var(--dsw-alias-border-l2, #eee)"
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "input",
                    {
                      type: "checkbox",
                      checked: isOn,
                      onChange: (e) => toggle(lang.id, e.target.checked)
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: 1 }, children: lang.displayName }),
                  lang.heavy && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary)" }, children: t("heavy") }),
                  lang.experimental && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-tertiary)" }, children: t("experimental") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 11, color: badge.color, minWidth: 56, textAlign: "right" }, children: badge.text }),
                  st && !st.found && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      disabled: installingId !== void 0,
                      onClick: (e) => {
                        e.preventDefault();
                        void onInstall(lang.id);
                      },
                      style: {
                        fontSize: 11,
                        padding: "2px 8px",
                        cursor: installingId === lang.id ? "wait" : "pointer",
                        background: "var(--dsw-alias-bg-module-platform, #f0f0f0)",
                        border: "1px solid var(--dsw-alias-border-l2, #ddd)",
                        borderRadius: 4
                      },
                      children: installingId === lang.id ? "\u2026" : "\u5B89\u88C5"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "span",
                    {
                      style: {
                        fontSize: 11,
                        color: isOn ? "var(--dsw-alias-bg-success, #16a34a)" : "var(--dsw-alias-label-tertiary)",
                        minWidth: 44,
                        textAlign: "right"
                      },
                      children: isOn ? t("statusOn") : t("statusOff")
                    }
                  )
                ]
              },
              lang.id
            );
          })
        ] }, group)),
        installError && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { margin: 0, fontSize: 12, color: "var(--dsw-alias-label-error, #dc2626)" }, children: installError })
      ] });
    }
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, dictionaries), "dsh-lsp-plugin: section dictionaries");
      const scope = ctx.settingsScope.bind({ namespace: NS });
      void ctx.remote.$mount({
        package: "dsh-lsp-plugin",
        descriptors: [{
          id: "lspStatus.describe",
          service: "lspStatus",
          namespace: "lspStatus",
          method: "describe",
          invocation: { kind: "direct" },
          parameters: [],
          result: { mode: "src-json" }
        }, {
          id: "lspStatus.install",
          service: "lspStatus",
          namespace: "lspStatus",
          method: "install",
          invocation: { kind: "direct" },
          parameters: [{ name: "languageId", wire: "languageId", source: "json", codec: { mode: "src-json" } }],
          result: { mode: "src-json" }
        }]
      }).catch(() => {
      });
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "lsp",
        order: 20,
        label: () => t("nav"),
        locale: NS,
        inject: () => ({
          hooks: {
            scope
          },
          setEnabled: (next) => void scope.set("enabled", next),
          setIdle: (ms) => void scope.set("idleTimeoutMs", ms),
          // 防御：$mount 异步完成前 remote.lspStatus 可能未挂载——避免同步 TypeError（会让组件崩溃白屏）
          loadStatus: () => {
            const svc = ctx.remote.lspStatus;
            return svc ? svc.describe() : Promise.reject(new Error("LSP status remote not ready yet"));
          },
          installLang: (id) => {
            const svc = ctx.remote.lspStatus;
            return svc ? svc.install(id) : Promise.reject(new Error("LSP status remote not ready yet"));
          }
        })
      }, LspSettingsSection));
    }
    var inject = ["slots", "locale", "connection", "remote", "settingsScope"];

		return module.exports;
	}
});

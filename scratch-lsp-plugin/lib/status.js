var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __decoratorStart = (base) => [, , , __create(base?.[__knownSymbol("metadata")] ?? null)];
var __decoratorStrings = ["class", "method", "getter", "setter", "accessor", "field", "value", "get", "set"];
var __expectFn = (fn) => fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn;
var __decoratorContext = (kind, name, done, metadata, fns) => ({ kind: __decoratorStrings[kind], name, metadata, addInitializer: (fn) => done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null)) });
var __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
var __runInitializers = (array, flags, self, value) => {
  for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++) flags & 1 ? fns[i].call(self) : value = fns[i].call(self, value);
  return value;
};
var __decorateElement = (array, flags, name, decorators, target, extra) => {
  var fn, it, done, ctx, access, k = flags & 7, s = !!(flags & 8), p = !!(flags & 16);
  var j = k > 3 ? array.length + 1 : k ? s ? 1 : 2 : 0, key = __decoratorStrings[k + 5];
  var initializers = k > 3 && (array[j - 1] = []), extraInitializers = array[j] || (array[j] = []);
  var desc = k && (!p && !s && (target = target.prototype), k < 5 && (k > 3 || !p) && __getOwnPropDesc(k < 4 ? target : { get [name]() {
    return __privateGet(this, extra);
  }, set [name](x) {
    return __privateSet(this, extra, x);
  } }, name));
  k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name) : __name(target, name);
  for (var i = decorators.length - 1; i >= 0; i--) {
    ctx = __decoratorContext(k, name, done = {}, array[3], extraInitializers);
    if (k) {
      ctx.static = s, ctx.private = p, access = ctx.access = { has: p ? (x) => __privateIn(target, x) : (x) => name in x };
      if (k ^ 3) access.get = p ? (x) => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get) : (x) => x[name];
      if (k > 2) access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => x[name] = y;
    }
    it = (0, decorators[i])(k ? k < 4 ? p ? extra : desc[key] : k > 4 ? void 0 : { get: desc.get, set: desc.set } : target, ctx), done._ = 1;
    if (k ^ 4 || it === void 0) __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? p ? extra = it : desc[key] = it : target = it);
    else if (typeof it !== "object" || it === null) __typeError("Object expected");
    else __expectFn(fn = it.get) && (desc.get = fn), __expectFn(fn = it.set) && (desc.set = fn), __expectFn(fn = it.init) && initializers.unshift(fn);
  }
  return k || __decoratorMetadata(array, target), desc && __defProp(target, name, desc), p ? k ^ 4 ? extra : desc : target;
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var _installLanguage_dec, _describe_dec, _a, _init;
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { CATALOG } from "../src/catalog.ts";
import { detectServer } from "../src/detect.ts";
class LspStatusGateway extends (_a = TypertRemoteService, _describe_dec = [Remote("describe")], _installLanguage_dec = [Remote("installLanguage")], _a) {
  constructor(ctx, getConfig) {
    super(ctx, "lspStatus");
    __runInitializers(_init, 5, this);
    __publicField(this, "getConfig");
    this.getConfig = getConfig;
  }
  describe() {
    const cwd = process.cwd();
    const statuses = {};
    for (const entry of CATALOG) {
      statuses[entry.id] = detectServer(entry.server, cwd);
    }
    const config = this.getConfig();
    return {
      languages: CATALOG.map(({ id, displayName, group, priority, heavy, experimental }) => ({
        id,
        displayName,
        group,
        priority,
        heavy,
        experimental
      })),
      statuses,
      enabled: config.enabled,
      idleTimeoutMs: config.idleTimeoutMs
    };
  }
  async installLanguage(languageId) {
    const entry = CATALOG.find((e) => e.id === languageId);
    if (!entry) return { ok: false, message: `Unknown language ${languageId}` };
    const inst = entry.install;
    if (!inst?.command) {
      return { ok: false, message: inst?.note ?? `No automated install for ${entry.displayName}` };
    }
    const argv = [inst.command, ...inst.args ?? []];
    const cwd = process.cwd();
    try {
      const subprocess = this.ctx.subprocess;
      if (!subprocess) return { ok: false, message: "subprocess seam unavailable" };
      const handle = subprocess.spawn({
        argv,
        cwd,
        stdio: { stdin: "ignore", stdout: { maxBytes: 128 * 1024 }, stderr: { maxBytes: 128 * 1024 } },
        graceMs: 5e3
      });
      const outcome = await handle.done;
      if (outcome.exitCode !== 0) {
        return { ok: false, message: `Install failed (exit ${outcome.exitCode})`, command: argv.join(" ") };
      }
      const status = detectServer(entry.server, cwd);
      return {
        ok: status.found,
        status,
        message: status.found ? void 0 : "Install ran but server still not detected; check PATH",
        command: argv.join(" ")
      };
    } catch (error) {
      return { ok: false, message: `Install error: ${error instanceof Error ? error.message : String(error)}`, command: argv.join(" ") };
    }
  }
}
_init = __decoratorStart(_a);
__decorateElement(_init, 1, "describe", _describe_dec, LspStatusGateway);
__decorateElement(_init, 1, "installLanguage", _installLanguage_dec, LspStatusGateway);
__decoratorMetadata(_init, LspStatusGateway);
export {
  LspStatusGateway
};

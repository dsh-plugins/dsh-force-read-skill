/**
 * tsdown 配置：只产出浏览器客户端包 `lib/client.js`。
 *
 * 宿主端 `lib/index.js` 仍由 tsc 生成。客户端产物必须是
 * `window.__ModuleLoader__.load({ id, factory })` 的 CJS 闭包工厂，
 * 由 DSH 客户端模块表在 `/plugins/...` 路径下提供。
 */
import { defineConfig } from 'tsdown';

/** Web 外壳共享进冻结模块表的模块。 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  // dsh-loader 的 UI 套件产物同样是被 `__ModuleLoader__.load` 包裹的 CJS 闭包，
  // 静态分析看不到 export，必须 external，运行时由模块表剥掉 `/client` 后缀解析。
  '@dsh-plugin/dsh-loader/client',
];

export default defineConfig({
  name: '@dsh-plugin/dsh-force-read-skill/client',
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...PLATFORM_MODULES],
  noExternal: (id) => (PLATFORM_MODULES.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@dsh-plugin/dsh-force-read-skill", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
});

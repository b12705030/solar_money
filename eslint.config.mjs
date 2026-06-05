import nextConfig from 'eslint-config-next';

export default [
  ...nextConfig,
  {
    rules: {
      // 現有程式碼廣泛使用 setMounted/setLoading 等同步 setState 模式，暫降為 warn
      // 後續可逐步重構為 useSyncExternalStore 或初始化值直接計算
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];

// PM2 进程配置 —— 一键启动：pnpm pm2:start
// 说明：api/crawler 以编译产物运行（需先 build），各自读取本目录下的 .env；
//      web 用 vite preview 跑构建产物（preview 会继承 server.proxy 的 /api 代理）。
//      better-sqlite3 是原生模块，必须保持 fork 单实例，不要用 cluster。
module.exports = {
  apps: [
    {
      name: 'fin-api',
      cwd: __dirname + '/apps/api',
      script: 'dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      env: { NODE_ENV: 'production', PORT: '3001' },
      max_memory_restart: '600M',
      out_file: __dirname + '/logs/api.out.log',
      error_file: __dirname + '/logs/api.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'fin-crawler',
      cwd: __dirname + '/apps/crawler',
      script: 'dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      env: { NODE_ENV: 'production' },
      max_memory_restart: '600M',
      out_file: __dirname + '/logs/crawler.out.log',
      error_file: __dirname + '/logs/crawler.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'fin-web',
      cwd: __dirname + '/apps/web',
      script: 'node_modules/vite/bin/vite.js',
      args: 'preview --host --port 5173 --strictPort',
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      out_file: __dirname + '/logs/web.out.log',
      error_file: __dirname + '/logs/web.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};

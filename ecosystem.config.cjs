module.exports = {
  apps: [{
    name: 'football-api',
    cwd: '/www/wwwroot/football/backend',
    script: 'node_modules/.bin/tsx',
    args: 'src/index.ts',
    instances: 1,
    autorestart: true,
    max_memory_restart: '800M',
    env: { NODE_ENV: 'production', PORT: 3000 },
    error_file: '/www/wwwroot/football/logs/api-error.log',
    out_file: '/www/wwwroot/football/logs/api-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};

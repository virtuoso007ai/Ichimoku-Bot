/**
 * PM2 ecosystem config for 7/24 autonomous trading.
 *
 * Usage:
 *   npx pm2 start ecosystem.config.cjs
 *   npx pm2 status
 *   npx pm2 logs ichimoku
 *   npx pm2 stop ichimoku
 *   npx pm2 restart ichimoku
 */
module.exports = {
  apps: [
    {
      name: "ichimoku",
      script: "node_modules/.bin/tsx",
      args: "scripts/degen/telegram-bot.ts",
      cwd: __dirname,
      watch: false,
      max_restarts: 10,
      min_uptime: "60s",
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};

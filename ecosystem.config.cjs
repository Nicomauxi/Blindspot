"use strict";

/**
 * pm2 ecosystem config for Blindspot production deployment.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup  # follow the printed command to enable on boot
 */

module.exports = {
  apps: [
    {
      name: "blindspot-core",
      script: "node",
      args: "--env-file=.env --import tsx/esm src/start.ts",
      cwd: "/home/nicolasfalcioni/Documentos/blindspot",
      interpreter: "none",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      error_file: "/home/nicolasfalcioni/logs/blindspot-core-error.log",
      out_file: "/home/nicolasfalcioni/logs/blindspot-core-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
    {
      name: "blindspot-api",
      script: "node",
      args: "--env-file=../.env --import tsx/esm src/server.ts",
      cwd: "/home/nicolasfalcioni/Documentos/blindspot/api",
      interpreter: "none",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
      },
      error_file: "/home/nicolasfalcioni/logs/blindspot-api-error.log",
      out_file: "/home/nicolasfalcioni/logs/blindspot-api-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};

module.exports = {
  apps: [{
    name: "api",
    script: "./dist/index.js",
    exec_mode: "cluster",
    instances: "max",      // or a fixed number like 2, 4, etc.
    listen_timeout: 10000, // how long PM2 waits for app to become ready
    kill_timeout: 5000,    // how long PM2 waits before force-killing old worker
    wait_ready: true,      // use if your app signals readiness explicitly
    env: {
      NODE_ENV: "production"
    }
  }]
}
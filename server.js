const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const { createAccountService } = require("./src/server/accountService");
const { loadEnvFiles, readBoolEnv } = require("./src/server/env");
const { createMatchRecorder } = require("./src/server/matchRecorder");
const { createRealtimeController } = require("./src/server/realtimeController");

loadEnvFiles([path.join(__dirname, ".env"), path.join(__dirname, "env")]);

const runtimeFlags = {
  debugMode: readBoolEnv("DEBUG_MODE", true),
};

const app = express();
app.use(express.json({ limit: "32kb" }));

let realtimeController = null;
const accountService = createAccountService({
  rootDir: __dirname,
  runtimeFlags,
  isUserOnline(userId) {
    return !!realtimeController?.isUserOnline(userId);
  },
  setUserOffline(userId) {
    realtimeController?.setUserOffline(userId);
  },
  onUserUpdated(user) {
    realtimeController?.updateActivePlayerNamesInRooms(user);
  },
});
const { completeCampaignLevelForUser, hydrateUser, initDatabaseStore, ruleName, saveUsers, userById } = accountService;

accountService.registerRoutes(app);

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    lastModified: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store");
    },
  })
);

const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 25_000,
  pingTimeout: 60_000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60_000,
    skipMiddlewares: true,
  },
});

const matchRecorder = createMatchRecorder({
  completeCampaignLevelForUser,
  getUserStore: () => accountService.userStore,
  hydrateUser,
  ruleName,
  saveUsers,
  userById,
});
realtimeController = createRealtimeController({
  io,
  runtimeFlags,
  accountService,
  recordMatchIfNeeded: matchRecorder.recordMatchIfNeeded,
});

process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("uncaughtException", err);
});

process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("unhandledRejection", reason);
});

const PORT = process.env.PORT || 3000;
async function start() {
  await initDatabaseStore();
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
      `Chess Variant server running on http://localhost:${PORT} using ${accountService.useDatabase ? "Postgres" : "JSON"} account store`
    );
  });
}

start().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});

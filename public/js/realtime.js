(function () {
  function createSocket(ioFactory) {
    return ioFactory({
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
  }

  window.ChaosChessRealtime = { createSocket };
})();

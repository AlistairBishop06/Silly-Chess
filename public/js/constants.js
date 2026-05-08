(function () {
  window.ChaosChessConstants = {
    cardPopup: {
      holdMs: 2000,
      exitMs: 560,
      get enterMs() {
        return Math.max(240, this.holdMs - this.exitMs);
      },
    },
    campaign: {
      config: {
        totalLevels: 100,
        levelsPerWorld: 10,
        chestEvery: 3,
        basicRuleIds: [
          "inst_oops_explosion",
          "inst_pawn_herding",
          "inst_rps_duel",
          "inst_swap_queens",
          "inst_coinflip_wager",
        ],
        excludedFromCampaignPool: [],
      },
      mapMinZoom: 0.65,
      mapMaxZoom: 1.9,
      mapZoomStep: 0.0015,
      biomes: [
        "grass",
        "forest",
        "cliff",
        "swamp",
        "desert",
        "ice",
        "volcano",
        "ruins",
        "sky",
        "citadel",
      ],
    },
    pieceGlyphMono: {
      p: "\u2659",
      n: "\u2658",
      b: "\u2657",
      r: "\u2656",
      q: "\u2655",
      k: "\u2654",
    },
  };
})();

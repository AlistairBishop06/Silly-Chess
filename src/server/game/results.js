const { other } = require("./ChessEngine");

const resultMethods = {
  randomPieceSquare(color, filterFn) {
    const squares = [];
    for (let i = 0; i < 64; i++) {
      const p = this.state.board[i];
      if (!p || p.color !== color) continue;
      if (filterFn && !filterFn(p)) continue;
      squares.push(i);
    }
    if (!squares.length) return null;
    return squares[Math.floor(Math.random() * squares.length)];
  },

  findKingSquare(color) {
    for (let i = 0; i < this.state.board.length; i++) {
      const p = this.state.board[i];
      if (p && p.color === color && p.type === "k") return i;
    }
    return null;
  },

  setResult({ winner, loser, reason, detail }) {
    this.resultInfo = { winner, loser, reason, detail };
    const winnerName = winner === "w" ? "White" : "Black";
    const loserName = loser === "w" ? "White" : "Black";
    this.result = `${winnerName} wins (${loserName} ${reason === "checkmate" ? "checkmated" : "lost"}).`;
    this.effects.push({ type: "log", id: this.nextEffectId(), text: detail || this.result });
  },

  evaluateGameEnd() {
    if (this.resultInfo || this.result) return true;
    if (!this.started || this.phase === "lobby") return false;

    const wKing = this.findKingSquare("w");
    const bKing = this.findKingSquare("b");
    const wVital = this.findBackupVitalSquare("w");
    const bVital = this.findBackupVitalSquare("b");
    if ((this.backupPlanActive.w && wVital == null) || (this.backupPlanActive.b && bVital == null)) {
      const loser = this.backupPlanActive.w && wVital == null ? "w" : "b";
      const winner = loser === "w" ? "b" : "w";
      const loserName = loser === "w" ? "White" : "Black";
      this.setResult({
        winner,
        loser,
        reason: "backup_lost",
        detail: `${loserName}'s backup-plan piece was destroyed.`,
      });
      return true;
    }

    if ((wKing == null && !this.backupPlanActive.w) || (bKing == null && !this.backupPlanActive.b)) {
      const loser = wKing == null && !this.backupPlanActive.w ? "w" : "b";
      const winner = loser === "w" ? "b" : "w";
      const loserName = loser === "w" ? "White" : "Black";
      this.setResult({
        winner,
        loser,
        reason: "king_deleted",
        detail: `${loserName}'s king was destroyed or deleted by a rule.`,
      });
      return true;
    }

    const color = this.state.turn;
    const mods = this.currentModifiers();
    const legal = this.legalMovesForColor(color, mods);
    if (legal.length === 0) {
      const inCheck = require("./ChessEngine").isInCheck(this.state, color, mods);
      if (inCheck && this.backupPlanActive?.[color] && this.findBackupVitalSquare(color) != null) return false;
      const loser = color;
      const winner = other(color);
      const loserName = loser === "w" ? "White" : "Black";
      const winnerName = winner === "w" ? "White" : "Black";
      this.setResult({
        winner,
        loser,
        reason: inCheck ? "checkmate" : "no_moves",
        detail: inCheck
          ? `${winnerName} wins by checkmate: ${loserName} has no legal moves while in check.`
          : `${winnerName} wins: ${loserName} has no legal moves (blocked by rules/position).`,
      });
      return true;
    }

    return false;
  }
};

module.exports = { resultMethods };

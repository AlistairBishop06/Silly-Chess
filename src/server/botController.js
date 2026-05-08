const {
  applyMoveNoValidation,
  generateLegalMoves,
  idxToFile,
  idxToRank,
  isInCheck,
  other,
  pieceValue,
} = require("./game/ChessEngine");

function createBotController({ rooms, pushEffectsAndState }) {
  function randItem(items) {
    if (!items?.length) return null;
    return items[Math.floor(Math.random() * items.length)];
  }
  
  function shuffled(items) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  }

  function botPlayer(room) {
    return room.players.find((p) => p.bot) || null;
  }
  
  function botLegalMoves(game, playerId) {
    const color = game.playerColor(playerId);
    if (color !== "w" && color !== "b") return [];
    const moves = [];
    for (let from = 0; from < game.state.board.length; from++) {
      const piece = game.state.board[from];
      if (!piece || piece.color !== color) continue;
      const toSquares = game.getLegalDestinations(playerId, from);
      for (const to of toSquares) moves.push({ from, to, promotion: "q" });
    }
    return moves;
  }
  
  function cloneBotState(state) {
    return {
      ...state,
      board: state.board.map((p) => (p ? { ...p, tags: p.tags ? [...p.tags] : undefined } : null)),
      castling: { w: { ...state.castling.w }, b: { ...state.castling.b } },
      lastMove: state.lastMove ? { ...state.lastMove } : null,
    };
  }
  
  function botMaterialScore(board, color) {
    let score = 0;
    for (let sq = 0; sq < board.length; sq++) {
      const p = board[sq];
      if (!p || p.color === "x") continue;
      const sign = p.color === color ? 1 : -1;
      let value = pieceValue(p.type) * 100;
      if (p.tags?.includes("titan")) value += 220;
      if (p.tags?.includes("suicideBomber")) value += p.color === color ? 25 : -25;
      if (p._backupVital === p.color) value += 60;
      score += sign * value;
    }
    return score;
  }
  
  function botPositionalScore(board, color) {
    let score = 0;
    const forward = color === "w" ? 1 : -1;
    const size = Math.max(8, Math.round(Math.sqrt(board.length || 64)));
    const center = (size - 1) / 2;
    for (let sq = 0; sq < board.length; sq++) {
      const p = board[sq];
      if (!p || p.color === "x") continue;
      const sign = p.color === color ? 1 : -1;
      const file = sq % size;
      const rank = Math.floor(sq / size);
      const centerDist = Math.abs(file - center) + Math.abs(rank - center);
      score += sign * (18 - centerDist * 4);
      if (p.type === "p") {
        const progress = p.color === "w" ? rank : size - 1 - rank;
        score += sign * progress * 8;
      }
      if ((p.type === "n" || p.type === "b") && ((p.color === "w" && rank > 0) || (p.color === "b" && rank < 7))) {
        score += sign * 12;
      }
      if (p.type === "k") {
        const homeRank = p.color === "w" ? Math.floor((size - 8) / 2) : Math.floor((size - 8) / 2) + 7;
        const earlyShelter = rank === homeRank && (file === 6 || file === 2) ? 18 : 0;
        score += sign * earlyShelter;
      }
      if (p.color === color && p.type === "p") score += (rank - center) * forward;
    }
    return score;
  }
  
  function botEvaluateState(state, color, mods) {
    const opponent = other(color);
    let score = botMaterialScore(state.board, color) + botPositionalScore(state.board, color);
    if (isInCheck(state, opponent, mods)) score += 90;
    if (isInCheck(state, color, mods)) score -= 140;
  
    const mine = generateLegalMoves(state, color, mods).length;
    const theirs = generateLegalMoves(state, opponent, mods).length;
    score += Math.min(mine, 30) * 4 - Math.min(theirs, 30) * 5;
  
    if (theirs === 0) score += isInCheck(state, opponent, mods) ? 100000 : 1500;
    if (mine === 0) score -= isInCheck(state, color, mods) ? 100000 : 1500;
    return score;
  }
  
  function botApplyMoveForSearch(state, move, mods) {
    return applyMoveNoValidation(cloneBotState(state), move, mods);
  }
  
  function botMoveScore(game, color, move, legalMoves) {
    const mods = game.currentModifiers();
    const before = game.state;
    const piece = before.board[move.from];
    const target = before.board[move.to];
    const next = botApplyMoveForSearch(before, move, mods);
    const opponent = other(color);
  
    let score = botEvaluateState(next, color, mods);
    if (target && target.color !== color) score += pieceValue(target.type) * 160 - pieceValue(piece?.type) * 12;
    const size = Math.max(8, Number(before.boardSize || Math.round(Math.sqrt(before.board.length || 64))));
    const toRank = Math.floor(move.to / size);
    if (piece?.type === "p" && (toRank === 0 || toRank === size - 1)) score += 750;
    if (isInCheck(next, opponent, mods)) score += 160;
  
    const replies = generateLegalMoves(next, opponent, mods);
    let bestReply = -Infinity;
    for (const reply of replies.slice(0, 40)) {
      const replyTarget = next.board[reply.to];
      const replyPiece = next.board[reply.from];
      const replyNext = botApplyMoveForSearch(next, reply, mods);
      let replyScore = botEvaluateState(replyNext, opponent, mods);
      if (replyTarget && replyTarget.color === color) replyScore += pieceValue(replyTarget.type) * 180 - pieceValue(replyPiece?.type) * 10;
      if (isInCheck(replyNext, color, mods)) replyScore += 140;
      if (replyScore > bestReply) bestReply = replyScore;
    }
    if (Number.isFinite(bestReply)) score -= bestReply * 0.72;
  
    const fromFile = move.from % size;
    const fromRank = Math.floor(move.from / size);
    const toFile = move.to % size;
    const centerRank = Math.floor(move.to / size);
    const center = (size - 1) / 2;
    const centerGain = Math.abs(fromFile - center) + Math.abs(fromRank - center) - (Math.abs(toFile - center) + Math.abs(centerRank - center));
    score += centerGain * 18;
  
    // Prefer varied choices among similarly strong moves.
    score += Math.random() * 16;
    if (!legalMoves.length) score = -Infinity;
    return score;
  }
  
  function chooseBotMove(game, playerId) {
    const color = game.playerColor(playerId);
    if (color !== "w" && color !== "b") return null;
    const moves = botLegalMoves(game, playerId);
    if (!moves.length) return null;
  
    let best = null;
    let bestScore = -Infinity;
    for (const move of moves) {
      const score = botMoveScore(game, color, move, moves);
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    return best || randItem(moves);
  }
  
  function botWagerSquares(game, color) {
    const candidates = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = game.state.board[sq];
      if (!p || p.color !== color || p.color === "x" || p.type === "k") continue;
      candidates.push(sq);
    }
    const limit = Math.min(candidates.length, Math.floor(Math.random() * 4));
    return shuffled(candidates).slice(0, limit);
  }
  
  function botSupermarketItems(budget = 10) {
    const costs = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    const items = { p: 0, n: 0, b: 0, r: 0, q: 0 };
    let remaining = Math.max(0, Number(budget) || 0);
    while (remaining > 0) {
      const affordable = ["q", "r", "b", "n", "p"].filter((type) => costs[type] <= remaining);
      if (!affordable.length || Math.random() < 0.25) break;
      const type = randItem(affordable);
      items[type] += 1;
      remaining -= costs[type];
    }
    return items;
  }
  
  function botTargetSquares(game, pending) {
    const color = pending?.color;
    if (pending?.ruleId === "inst_lawnmower") {
      const rows = [];
      for (let rank = 0; rank < 8; rank++) {
        let hasKing = false;
        for (let file = 0; file < 8; file++) {
          const p = game.state.board[rank * 8 + file];
          if (p?.type === "k") hasKing = true;
        }
        if (!hasKing) rows.push(rank * 8);
      }
      return shuffled(rows);
    }
  
    const squares = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = game.state.board[sq];
      if (!p || p.color !== color || p.color === "x") continue;
      if (pending?.ruleId === "inst_pawn_soldier" && p.type !== "p") continue;
      if (pending?.ruleId === "inst_backup_plan" && p.type === "k") continue;
      squares.push(sq);
    }
    return shuffled(squares);
  }
  
  function botPawnSoldierTarget(game, pending) {
    const color = pending?.color;
    const from = pending?.from;
    if (color !== "w" && color !== "b") return Math.floor(Math.random() * 64);
  
    const enemies = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = game.state.board[sq];
      if (!p || p.color !== other(color) || p.type === "k") continue;
      enemies.push(sq);
    }
    if (!enemies.length) return Math.floor(Math.random() * 64);
    if (from == null) return randItem(enemies);
    enemies.sort((a, b) => {
      const da = Math.abs(idxToFile(a) - idxToFile(from)) + Math.abs(idxToRank(a) - idxToRank(from));
      const db = Math.abs(idxToFile(b) - idxToFile(from)) + Math.abs(idxToRank(b) - idxToRank(from));
      return da - db;
    });
    return enemies[0];
  }
  
  function runBotAction(roomCode) {
    const entry = rooms.get(roomCode);
    if (!entry) return;
    entry.botTimer = null;
  
    const room = entry.room;
    const game = room.game;
    const bot = botPlayer(room);
    if (!game || !bot) return;
  
    let changed = false;
    const beforePhase = game.phase;
    const beforeEffectSeq = game.effectSeq;
    game.enforceRuleChoiceTimeoutIfNeeded();
    game.enforceBonusRuleChoiceTimeoutIfNeeded();
    game.enforceMiniGameTimeoutIfNeeded();
    game.enforceWagerTimeoutIfNeeded();
    changed = beforePhase !== game.phase || beforeEffectSeq !== game.effectSeq;
  
    if (game.resultInfo) {
      const humanReady = room.players.some((p) => !p.bot && game.readyByPlayerId?.[p.id]);
      if (humanReady && !game.readyByPlayerId?.[bot.id]) changed = !!game.toggleReady(bot.id)?.ok;
    } else if (game.phase === "ruleChoice") {
      const choices = game.ruleChoicesByPlayerId?.[bot.id] || [];
      if (!game.ruleChosenByPlayerId?.[bot.id] && choices.length) {
        const pick = randItem(choices);
        changed = !!game.chooseRule(bot.id, pick.id)?.ok;
      }
    } else if (game.phase === "bonusRuleChoice") {
      const choices = game.ruleChoicesByPlayerId?.[bot.id] || [];
      if (game.bonusRuleChoice?.playerId === bot.id && choices.length) {
        const pick = randItem(choices);
        changed = !!game.chooseRule(bot.id, pick.id)?.ok;
      }
    } else if (game.phase === "targetRule") {
      const pending = game.currentPendingTarget?.();
      if (pending?.playerId === bot.id) {
        for (const square of botTargetSquares(game, pending)) {
          const res = game.submitRuleTarget(bot.id, square);
          if (res.ok) {
            changed = true;
            break;
          }
        }
      }
    } else if (game.phase === "mutantFusion") {
      if (game.mutantFusion?.playerId === bot.id) {
        const color = game.playerColor(bot.id);
        const pieces = [];
        for (let sq = 0; sq < 64; sq++) {
          const p = game.state.board[sq];
          if (p && p.color === color && p.color !== "x" && p.type !== "k") pieces.push(sq);
        }
        if (!pieces.length) {
          for (let sq = 0; sq < 64; sq++) {
            const p = game.state.board[sq];
            if (p && p.color === color && p.color !== "x") pieces.push(sq);
          }
        }
        const chosen = pieces.length ? [randItem(pieces)] : [];
        const selectedOk = game.setMutantSelection(bot.id, chosen);
        const confirmedOk = selectedOk.ok ? game.confirmMutantFusion(bot.id) : selectedOk;
        changed = !!confirmedOk.ok;
      }
    } else if (game.phase === "pawnSoldierShot") {
      const pending = game.pendingPawnSoldierShot;
      if (pending?.playerId === bot.id) {
        changed = !!game.submitPawnSoldierShot(bot.id, botPawnSoldierTarget(game, pending))?.ok;
      }
    } else if (game.phase === "supermarket") {
      if (game.supermarket?.playerId === bot.id) {
        changed = !!game.submitSupermarketPurchase(bot.id, botSupermarketItems(game.supermarket.budget))?.ok;
      }
    } else if (game.phase === "fruitMachine") {
      if (game.fruitMachine?.playerId === bot.id) {
        changed = game.fruitMachine.complete
          ? !!game.collectFruitMachinePrizes(bot.id)?.ok
          : !!game.submitFruitMachineSpin(bot.id)?.ok;
      }
    } else if (game.phase === "rps" && game.rps) {
      const color = game.playerColor(bot.id);
      if (color && !game.rps.byColor?.[color]) {
        changed = !!game.submitRpsChoice(bot.id, randItem(["rock", "paper", "scissors"]))?.ok;
      }
    } else if (game.phase === "wager" && game.wager?.stage === "select") {
      const color = game.playerColor(bot.id);
      if (color && !game.wager.confirmedByColor?.[color]) {
        const selected = botWagerSquares(game, color);
        const selectedOk = game.setWagerSelection(bot.id, selected);
        const confirmedOk = selectedOk.ok ? game.confirmWager(bot.id) : selectedOk;
        changed = !!confirmedOk.ok;
      }
    } else if (game.phase === "play" && game.state.turn === game.playerColor(bot.id)) {
      const move = chooseBotMove(game, bot.id);
      if (move) changed = !!game.tryMove(bot.id, move)?.ok;
    }
  
    if (changed) pushEffectsAndState(roomCode);
    else if (["wager", "rps", "ruleChoice", "bonusRuleChoice", "targetRule", "mutantFusion", "pawnSoldierShot", "supermarket", "fruitMachine"].includes(game.phase)) scheduleBotTurn(roomCode);
  }
  
  function scheduleBotTurn(roomCode) {
    const entry = rooms.get(roomCode);
    if (!entry || entry.botTimer) return;
    if (!botPlayer(entry.room)) return;
    entry.botTimer = setTimeout(() => runBotAction(roomCode), 550);
  }

  return {
    runBotAction,
    scheduleBotTurn,
  };
}

module.exports = { createBotController };

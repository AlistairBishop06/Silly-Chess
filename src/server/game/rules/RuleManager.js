const { allRules, getRuleById } = require("./ruleset");

function ruleTypeLabel(rule) {
  if (rule.kind === "instant") return "Instant";
  if (rule.kind === "delayed") return `In ${rule.delayTurns} Turns`;
  if (rule.kind === "duration") return `For ${rule.durationTurns} Turns`;
  return "Rule";
}

function kindClass(rule) {
  if (rule.kind === "instant") return "instant";
  if (rule.kind === "delayed") return "delayed";
  if (rule.kind === "duration") return "duration";
  return "duration";
}

class RuleManager {
  constructor(game) {
    this.game = game;
    this.active = []; // instances: { instanceId, ruleId, kind, remaining, triggerIn }
    this.instanceSeq = 1;
  }

  getActiveClientCards() {
    return this.active
      .map((inst) => {
        const r = getRuleById(inst.ruleId);
        if (!r) return null;
        const targetSq = inst.data?.targetSq;
        const kind = inst.kind === "permanent" ? "permanent" : kindClass(r);
        return {
          instanceId: inst.instanceId,
          id: r.id,
          name: r.name,
          description: r.description,
          kind,
          typeLabel: kind === "permanent" ? "Permanent" : ruleTypeLabel(r),
          remaining: inst.kind === "duration" ? inst.remaining : inst.kind === "delayed" ? inst.triggerIn : null,
          targetSq: typeof targetSq === "number" ? targetSq : null,
        };
      })
      .filter(Boolean);
  }

  computeModifiers() {
    const mods = {};
    // Permanent flags live on game.permanent
    Object.assign(mods, this.game.permanent);
    // Active duration rules contribute modifiers.
    for (const inst of this.active) {
      const r = getRuleById(inst.ruleId);
      if (!r) continue;
      if ((inst.kind === "duration" || inst.kind === "permanent") && typeof r.modifiers === "function") {
        Object.assign(mods, r.modifiers(this.game));
      }
    }
    return mods;
  }

  randomChoices(n) {
    const rules = allRules();
    const pickable = rules; // allow repeats over time
    const out = [];
    const used = new Set();
    while (out.length < n && used.size < pickable.length) {
      const r = pickable[Math.floor(Math.random() * pickable.length)];
      if (used.has(r.id)) continue;
      used.add(r.id);
      out.push({
        id: r.id,
        name: r.name,
        description: r.description,
        kind: kindClass(r),
        typeLabel: ruleTypeLabel(r),
        remaining: r.kind === "duration" ? r.durationTurns : r.kind === "delayed" ? r.delayTurns : null,
      });
    }
    return out;
  }

  allChoices() {
    const rules = allRules();
    return rules.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      kind: kindClass(r),
      typeLabel: ruleTypeLabel(r),
      remaining: r.kind === "duration" ? r.durationTurns : r.kind === "delayed" ? r.delayTurns : null,
    }));
  }

  addRule(ruleId, ctx = {}) {
    const r = getRuleById(ruleId);
    if (!r) return { ok: false, error: "Unknown rule" };
    const inst = { instanceId: `R${this.instanceSeq++}`, ruleId: r.id, kind: r.kind, remaining: null, triggerIn: null, data: {} };

    if (r.kind === "instant") {
      this.game.effects.push({ type: "rule", id: this.game.nextEffectId(), text: r.name });
      r.apply?.(this.game, { flags: {}, ...ctx });
      if (r.permanentCard) {
        this.active.push({ instanceId: `P${this.instanceSeq++}`, ruleId: r.id, kind: "permanent", remaining: null, triggerIn: null, data: {} });
      }
      return { ok: true, applied: "instant" };
    }

    if (r.kind === "delayed") {
      inst.triggerIn = r.delayTurns;
      r.onSchedule?.(this.game, inst);
      this.active.push(inst);
      this.game.effects.push({ type: "rule", id: this.game.nextEffectId(), text: `${r.name} (scheduled)` });
      return { ok: true, applied: "delayed" };
    }

    if (r.kind === "duration") {
      inst.remaining = r.durationTurns;
      this.active.push(inst);
      this.game.effects.push({ type: "rule", id: this.game.nextEffectId(), text: `${r.name} (active)` });
      r.apply?.(this.game, { flags: {} });
      return { ok: true, applied: "duration" };
    }

    return { ok: false, error: "Invalid rule kind" };
  }

  tickAfterPly() {
    // Decrement counters, execute delayed rules when they hit 0.
    const still = [];
    for (const inst of this.active) {
      const r = getRuleById(inst.ruleId);
      if (!r) continue;
      if (inst.kind === "permanent") {
        still.push(inst);
        continue;
      }
      if (inst.kind === "delayed") {
        r.onTick?.(this.game, inst);
        inst.triggerIn -= 1;
        if (inst.triggerIn <= 0) {
          this.game.effects.push({ type: "rule", id: this.game.nextEffectId(), text: `${r.name} triggers!` });
          r.apply?.(this.game, { flags: {}, inst });
          if (r.becomesPermanent) {
            inst.kind = "permanent";
            inst.remaining = null;
            inst.triggerIn = null;
            still.push(inst);
          }
          continue;
        }
        still.push(inst);
        continue;
      }
      if (inst.kind === "duration") {
        inst.remaining -= 1;
        if (inst.remaining <= 0) {
          this.game.effects.push({ type: "rule", id: this.game.nextEffectId(), text: `${r.name} ends.` });
          this.game.onRuleEnded?.(inst.ruleId);
          continue;
        }
        still.push(inst);
        continue;
      }
      still.push(inst);
    }
    this.active = still;
  }
}

module.exports = { RuleManager };

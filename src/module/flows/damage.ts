import { AppliedDamage } from "../actor/damage-calc";
import { LancerActor, LancerNPC } from "../actor/lancer-actor";
import { LancerItem } from "../item/lancer-item";
import { Damage } from "../models/bits/damage";
import { UUIDRef } from "../source-template";
import { LancerToken } from "../token";
import { renderTemplateStep } from "./_render";
import { Flow, FlowState, Step } from "./flow";
import { LancerFlowState } from "./interfaces";

type DamageFlag = {
  damageResults: LancerFlowState.DamageResult[];
  critDamageResults: LancerFlowState.DamageResult[];
  // TODO: AP and paracausal flags
  ap: boolean;
  paracausal: boolean;
  targetsApplied: Record<string, boolean>;
};

export function registerDamageSteps(flowSteps: Map<string, Step<any, any> | Flow<any>>) {
  flowSteps.set("initDamageData", initDamageData);
  flowSteps.set("setDamageTags", setDamageTags);
  flowSteps.set("setDamageTargets", setDamageTargets);
  flowSteps.set("showDamageHUD", showDamageHUD);
  flowSteps.set("rollDamage", rollDamage); // TODO: combine/replace with rollDamages
  flowSteps.set("rollDamages", rollDamages);
  flowSteps.set("applyOverkillHeat", applyOverkillHeat);
  flowSteps.set("printDamageCard", printDamageCard);
}

/**
 * Flow for rolling and applying damage to a token, typically from a weapon attack
 */
export class DamageRollFlow extends Flow<LancerFlowState.DamageRollData> {
  static steps = [
    "initDamageData",
    "setDamageTags", // Move some tags from setAttackTags to here
    "setDamageTargets", // Can we reuse setAttackTargets?
    "showDamageHUD",
    "rollDamages",
    "applyOverkillHeat",
    "printDamageCard",
  ];
  constructor(uuid: UUIDRef | LancerItem | LancerActor, data?: LancerFlowState.DamageRollData) {
    const initialData: LancerFlowState.DamageRollData = {
      type: "damage",
      title: data?.title || "Damage Roll",
      configurable: data?.configurable !== undefined ? data.configurable : true,
      ap: data?.ap || false,
      overkill: data?.overkill || false,
      overkill_heat: data?.overkill_heat,
      reliable: data?.reliable || false,
      hit_results: data?.hit_results || [],
      has_normal_hit: false,
      has_crit_hit: false,
      damage: data?.damage || [],
      bonus_damage: data?.bonus_damage || [],
      damage_results: [],
      crit_damage_results: [],
      damage_total: 0,
      crit_total: 0,
      targets: [],
    };
    super(uuid, initialData);
  }
}

async function initDamageData(state: FlowState<LancerFlowState.DamageRollData>): Promise<boolean> {
  if (!state.data) throw new TypeError(`Damage flow state missing!`);

  if (state.item?.is_mech_weapon()) {
    const profile = state.item.system.active_profile;
    state.data.damage = state.data.damage.length ? state.data.damage : profile.damage;
    state.data.bonus_damage = state.data.bonus_damage?.length ? state.data.bonus_damage : profile.bonus_damage;
  } else if (state.item?.is_npc_feature() && state.item.system.type === "Weapon") {
    state.data.damage = state.data.damage.length
      ? state.data.damage
      : state.item.system.damage[state.item.system.tier_override || (state.actor as LancerNPC).system.tier - 1];
  } else if (state.item?.is_pilot_weapon()) {
    state.data.damage = state.data.damage.length ? state.data.damage : state.item.system.damage;
  } else if (state.data.damage.length === 0) {
    ui.notifications!.warn(
      state.item ? `Item ${state.item.id} is not a weapon!` : `Damage flow is missing damage to roll!`
    );
    return false;
  }

  // Check whether we have any normal or crit hits
  state.data.has_normal_hit =
    state.data.hit_results.length === 0 || state.data.hit_results.some(hit => hit.hit && !hit.crit);
  state.data.has_crit_hit = state.data.hit_results.length > 0 && state.data.hit_results.some(hit => hit.crit);

  return true;
}

async function setDamageTags(state: FlowState<LancerFlowState.DamageRollData>): Promise<boolean> {
  if (!state.data) throw new TypeError(`Damage flow state missing!`);
  // If the damage roll has no item, it has no tags.
  if (!state.item) return true;
  if (!state.item.is_mech_weapon() || !state.item.is_npc_feature() || !state.item.is_pilot_weapon())
    throw new TypeError(`Item ${state.item.id} is not a weapon!`);
  state.data.ap = state.item.isAP();
  state.data.overkill = state.item.isOverkill();
  state.data.reliable = state.item.isReliable();
  const reliableTag = state.item.system.tags.find(t => t.is_reliable);
  const reliableVal = parseInt(reliableTag?.val || "0");
  if (reliableTag && !Number.isNaN(reliableVal)) {
    state.data.reliable_val = reliableVal;
  }
  // TODO: build state.data.damage_hud_data
  return true;
}

async function setDamageTargets(state: FlowState<LancerFlowState.DamageRollData>): Promise<boolean> {
  if (!state.data) throw new TypeError(`Damage flow state missing!`);
  // TODO: DamageHudData does not facilitate setting targets after instantiation?
  return true;
}

async function showDamageHUD(state: FlowState<LancerFlowState.DamageRollData>): Promise<boolean> {
  // TODO: Placeholder for now
  return true;
}

async function rollDamage(state: FlowState<LancerFlowState.DamageRollData>): Promise<boolean> {
  if (!state.data) throw new TypeError(`Damage flow state missing!`);
  // Roll each damage type
  for (const damage of state.data.damage) {
    const roll = await new Roll(damage.val).evaluate({ async: true });
    const tt = await roll.getTooltip();
    state.data.damage_results.push({ roll, tt, d_type: damage.type });
    state.data.damage_total += roll.total || 0;
  }
  // TODO: crit damage
  return true;
}

export async function rollDamages(state: FlowState<LancerFlowState.DamageRollData>): Promise<boolean> {
  if (!state.data) throw new TypeError(`Attack flow state missing!`);

  // Evaluate normal damage. Even if every hit was a crit, we'll use this in
  // the next step for crits
  if (state.data.has_normal_hit || state.data.has_crit_hit) {
    for (const x of state.data.damage ?? []) {
      if (!x.val || x.val == "0") continue; // Skip undefined and zero damage
      let damageRoll: Roll | undefined = new Roll(x.val);
      // Add overkill if enabled.
      if (state.data.overkill) {
        damageRoll.terms.forEach(term => {
          if (term instanceof Die) term.modifiers = ["x1", `kh${term.number}`].concat(term.modifiers);
        });
      }

      await damageRoll.evaluate({ async: true });
      // @ts-expect-error DSN options aren't typed
      damageRoll.dice.forEach(d => (d.options.rollOrder = 2));
      const tooltip = await damageRoll.getTooltip();

      state.data.damage_results.push({
        roll: damageRoll,
        tt: tooltip,
        d_type: x.type,
      });
    }
  }

  // TODO: should crit damage rolling be a separate step?
  // If there is at least one crit hit, evaluate crit damage
  if (state.data.has_crit_hit) {
    // NPCs do not follow the normal crit rules. They only get bonus damage from Deadly etc...
    if (!state.actor.is_npc()) {
      await Promise.all(
        state.data.damage_results.map(async result => {
          const c_roll = await getCritRoll(result.roll);
          // @ts-expect-error DSN options aren't typed
          c_roll.dice.forEach(d => (d.options.rollOrder = 2));
          const tt = await c_roll.getTooltip();
          state.data!.crit_damage_results.push({
            roll: c_roll,
            tt,
            d_type: result.d_type,
          });
        })
      );
    } else {
      state.data!.crit_damage_results = state.data!.damage_results;
      // TODO: automation for Deadly
      // Find any Deadly features and add a d6 for each
    }
  }
  // If there were only crit hits and no normal hits, don't show normal damage in the results
  state.data.damage_results = state.data.has_normal_hit ? state.data.damage_results : [];

  // TODO: should overkill calculation be moved to applyOverkillHeat? Or a separate step between this and that?
  // Calculate overkill heat
  if (state.data.overkill) {
    state.data.overkill_heat = 0;
    (state.data.has_crit_hit ? state.data.crit_damage_results : state.data.damage_results).forEach(result => {
      result.roll.terms.forEach(p => {
        if (p instanceof DiceTerm) {
          p.results.forEach(r => {
            if (r.exploded) state.data!.overkill_heat! += 1;
          });
        }
      });
    });
  }
  return true;
}

async function applyOverkillHeat(state: FlowState<LancerFlowState.DamageRollData>): Promise<boolean> {
  return true;
}

async function printDamageCard(
  state: FlowState<LancerFlowState.DamageRollData>,
  options?: { template?: string }
): Promise<boolean> {
  if (!state.data) throw new TypeError(`Damage flow state missing!`);
  const template = options?.template || `systems/${game.system.id}/templates/chat/damage-card.hbs`;
  const damageData: DamageFlag = {
    damageResults: state.data.damage_results,
    critDamageResults: state.data.crit_damage_results,
    // TODO: AP and paracausal flags
    ap: false,
    paracausal: false,
    targetsApplied: state.data.targets.reduce((acc: Record<string, boolean>, t) => {
      const uuid = t.actor?.uuid || t.token?.actor?.uuid || null;
      if (!uuid) return acc;
      // We need to replace the dots in the UUID, otherwise Foundry will expand it into a nested object
      acc[uuid.replaceAll(".", "_")] = false;
      return acc;
    }, {}),
  };
  const flags = {
    damageData,
  };
  await renderTemplateStep(state.actor, template, state.data, flags);
  return true;
}

/**
 * Given an evaluated roll, create a new roll that doubles the dice and reuses
 * the dice from the original roll.
 * @param normal The orignal Roll
 * @returns An evaluated Roll
 */
export async function getCritRoll(normal: Roll) {
  const t_roll = new Roll(normal.formula);
  await t_roll.evaluate({ async: true });

  const dice_rolls = Array<DiceTerm.Result[]>(normal.terms.length);
  const keep_dice: number[] = Array(normal.terms.length).fill(0);
  normal.terms.forEach((term, i) => {
    if (term instanceof Die) {
      dice_rolls[i] = term.results.map(r => {
        return { ...r };
      });
      const kh = parseInt(term.modifiers.find(m => m.startsWith("kh"))?.substr(2) ?? "0");
      keep_dice[i] = kh || term.number;
    }
  });
  t_roll.terms.forEach((term, i) => {
    if (term instanceof Die) {
      dice_rolls[i].push(...term.results);
    }
  });

  // Just hold the active results in a sorted array, then mutate them
  const actives: DiceTerm.Result[][] = Array(normal.terms.length).fill([]);
  dice_rolls.forEach((dice, i) => {
    actives[i] = dice.filter(d => d.active).sort((a, b) => a.result - b.result);
  });
  actives.forEach((dice, i) =>
    dice.forEach((d, j) => {
      d.active = j >= keep_dice[i];
      d.discarded = j < keep_dice[i];
    })
  );

  // We can rebuild him. We have the technology. We can make him better than he
  // was. Better, stronger, faster
  const terms = normal.terms.map((t, i) => {
    if (t instanceof Die) {
      return new Die({
        ...t,
        modifiers: (t.modifiers.filter(m => m.startsWith("kh")).length
          ? t.modifiers
          : [...t.modifiers, `kh${t.number}`]) as (keyof Die.Modifiers)[],
        results: dice_rolls[i],
        number: t.number * 2,
      });
    } else {
      return t;
    }
  });

  return Roll.fromTerms(terms);
}

// ======== Chat button handler ==========
export async function applyDamage(event: JQuery.ClickEvent) {
  const chatMessageElement = event.currentTarget.closest(".chat-message.message");
  if (!chatMessageElement) {
    ui.notifications?.error("Damage application button not in chat message");
    return;
  }
  const chatMessage = game.messages?.get(chatMessageElement.dataset.messageId);
  // @ts-expect-error v10 types
  const damageData = chatMessage?.flags.lancer?.damageData as DamageFlag;
  if (!chatMessage || !damageData) {
    ui.notifications?.error("Damage application button has no damage data available");
    return;
  }
  const data = event.currentTarget.dataset;
  if (!data.target) {
    ui.notifications?.error("No target for damage application");
    return;
  }
  let multiple: number;
  try {
    multiple = parseFloat(data.multiple || 1);
  } catch (err) {
    ui.notifications?.error("Data multiplaction factor is not a number!");
    return;
  }
  // Replace underscores with dots to turn it back into a valid UUID
  const targetFlagKey = data.target.replaceAll(".", "_");
  if (damageData.targetsApplied[targetFlagKey]) {
    ui.notifications?.warn("Damage has already been applied to this target");
    return;
  }
  const target = await fromUuid(data.target);
  let actor: LancerActor | null = null;
  if (target instanceof LancerActor) actor = target;
  else if (target instanceof LancerToken) actor = target.actor;
  if (!actor) {
    ui.notifications?.error("Invalid target for damage application");
    return;
  }

  // Apply the damage
  await actor.damageCalc(
    new AppliedDamage(
      damageData.damageResults.map(dr => new Damage({ type: dr.d_type, val: (dr.roll.total || 0).toString() }))
    ),
    { multiple, addBurn: false }
  );

  // Update the flags on the chat message to indicate the damage has been applied
  damageData.targetsApplied[targetFlagKey] = true;
  await chatMessage.setFlag("lancer", "damageData", damageData);
}

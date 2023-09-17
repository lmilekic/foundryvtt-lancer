import { ActiveEffectDataConstructorData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/activeEffectData";
import { EffectChangeData } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/common/data/data.mjs/effectChangeData";
import { LancerActor } from "../actor/lancer-actor";
import { LANCER } from "../config";
import { DeployableType, EntryType } from "../enums";
import { statusConfigEffect } from "./converter";
import { StatusIconConfigOptions } from "../settings";
import {
  defaultStatuses,
  cancerConditionsStatus,
  cancerNPCTemplates,
  hayleyConditionsStatus,
  hayleyPC,
  hayleyNPC,
  hayleyUtility,
  tommyConditionsStatus,
} from "../status-icons";
import { LancerSTATUS } from "../item/lancer-item";

// Chassis = mech or standard npc
export type LancerEffectTarget =
  | EntryType.PILOT
  | EntryType.MECH
  | EntryType.NPC
  | EntryType.DEPLOYABLE
  | "only_drone"
  | "only_deployable"
  | "mech_and_npc";

export interface LancerActiveEffectFlags {
  lancer: {
    // If true, then this is the effect innately generated by certain categories of items, such as frames, npc classes, etc
    // or an effect generated by the bonuses on such an item
    // These are aggressively regenerated. Do not become attached to them.
    ephemeral?: boolean;

    // If specified, disable unless this
    target_type?: LancerEffectTarget;

    // When we propagate an effect, the origin becomes the parent actor.
    // This field maintains the true original
    deep_origin?: string | null;

    // If this is a status, effect, or condition - whichever of those it is
    status_type?: "status" | "effect" | "condition";
  };
}

export interface LancerActiveEffectConstructorData extends ActiveEffectDataConstructorData {
  name: string; // TODO - this is native in v11
  flags: Record<string, unknown> & LancerActiveEffectFlags;
}

export class LancerActiveEffect extends ActiveEffect {
  /**
   * Determine whether this Active Effect is suppressed or not.
   */
  get isSuppressed(): boolean {
    // Check it's not just passing through
    return !this.affectsUs();
  }

  /**
   * Determine whether this Active Effect is present only to be passed to descendants
   */
  affectsUs(): boolean {
    // Check right actor type
    // @ts-expect-error
    let tf = this.flags[game.system.id];
    if (this.parent instanceof LancerActor && tf?.target_type) {
      switch (tf.target_type) {
        case EntryType.PILOT:
          return this.parent.is_pilot();
        case EntryType.MECH:
          return this.parent.is_mech();
        case EntryType.DEPLOYABLE:
          return this.parent.is_deployable();
        case EntryType.NPC:
          return this.parent.is_npc();
        case "mech_and_npc":
          return this.parent.is_mech() || this.parent.is_npc();
        case "only_deployable":
          return this.parent.is_deployable() && this.parent.system.type == DeployableType.Deployable;
        case "only_drone":
          return this.parent.is_deployable() && this.parent.system.type == DeployableType.Drone;
        default:
          return false;
      }
    }
    return true;
  }

  /* --------------------------------------------- */

  /**
   * Prepare the data structure for Active Effects which are currently applied to an Actor or Item.
   */
  static prepareActiveEffectCategories(
    actor: LancerActor
  ): Array<{ type: string; label: string; effects: [number, LancerActiveEffect][] }> {
    // Define effect header categories
    let passives = {
      type: "passive",
      label: game.i18n.localize("lancer.effect.categories.passive"),
      effects: [] as [number, LancerActiveEffect][],
    };
    let inherited = {
      type: "inherited",
      label: game.i18n.localize("lancer.effect.categories.inherited"),
      effects: [] as [number, LancerActiveEffect][],
    };
    let disabled = {
      type: "disabled",
      label: game.i18n.localize("lancer.effect.categories.disabled"),
      effects: [] as [number, LancerActiveEffect][],
    };
    let passthrough = {
      type: "passthrough",
      label: game.i18n.localize("lancer.effect.categories.passthrough"),
      effects: [] as [number, LancerActiveEffect][],
    };

    // Iterate over active effects, classifying them into categories
    let index = 0;
    for (let e of actor.allApplicableEffects()) {
      // e._getSourceName(); // Trigger a lookup for the source name
      if (!e.affectsUs()) passthrough.effects.push([index, e]);
      else if (e.disabled) disabled.effects.push([index, e]);
      else if (e.flags[game.system.id]?.deep_origin) inherited.effects.push([index, e]);
      else passives.effects.push([index, e]);
      index++;
    }

    // categories.suppressed.hidden = !categories.suppressed.effects.length;
    return [passives, inherited, disabled, passthrough];
  }

  // Populate config with our static/compendium statuses instead of the builtin ones
  static async populateConfig(from_compendium: boolean) {
    const statusIconConfig = game.settings.get(game.system.id, LANCER.setting_status_icons) as StatusIconConfigOptions;
    // If no sets are selected, enable the default set
    if (
      game.ready &&
      !statusIconConfig.defaultConditionsStatus &&
      !statusIconConfig.cancerConditionsStatus &&
      !statusIconConfig.cancerNPCTemplates &&
      !statusIconConfig.hayleyConditionsStatus &&
      !statusIconConfig.hayleyPC &&
      !statusIconConfig.hayleyNPC &&
      !statusIconConfig.hayleyUtility &&
      !statusIconConfig.tommyConditionsStatus
    ) {
      statusIconConfig.defaultConditionsStatus = true;
      await game.settings.set(game.system.id, LANCER.setting_status_icons, statusIconConfig);
    }
    // @ts-expect-error TODO: Remove this expect when have v9 types
    let configStatuses: StatusEffect[] = [];
    // Pull the default statuses from the compendium if it exists
    if (statusIconConfig.defaultConditionsStatus) {
      let pack = game.packs.get(`world.${EntryType.STATUS}`);
      let pack_statuses: LancerSTATUS[] = [];
      if (from_compendium) {
        pack_statuses = ((await pack?.getDocuments()) || []) as unknown as LancerSTATUS[];
      }
      if (pack_statuses.length) {
        configStatuses = configStatuses.concat(pack_statuses.map(statusConfigEffect));
      }
      // Add any of the default status set which aren't in the compendium
      configStatuses = configStatuses.concat(
        defaultStatuses.filter(s => !configStatuses.find(stat => stat.id === s.id))
      );
    }
    if (statusIconConfig.cancerConditionsStatus) {
      configStatuses = configStatuses.concat(cancerConditionsStatus);
    }
    if (statusIconConfig.hayleyConditionsStatus) {
      configStatuses = configStatuses.concat(hayleyConditionsStatus);
    }
    if (statusIconConfig.tommyConditionsStatus) {
      configStatuses = configStatuses.concat(tommyConditionsStatus);
    }
    if (statusIconConfig.defaultConditionsStatus) {
      configStatuses = configStatuses.concat(defaultStatuses);
    }
    if (statusIconConfig.cancerConditionsStatus) {
      configStatuses = configStatuses.concat(cancerConditionsStatus);
    }
    if (statusIconConfig.hayleyConditionsStatus) {
      configStatuses = configStatuses.concat(hayleyConditionsStatus);
    }
    if (statusIconConfig.tommyConditionsStatus) {
      configStatuses = configStatuses.concat(tommyConditionsStatus);
    }
    // Icons for other things which aren't mechanical condition/status
    if (statusIconConfig.cancerNPCTemplates) {
      configStatuses = configStatuses.concat(cancerNPCTemplates);
    }
    if (statusIconConfig.hayleyPC) {
      configStatuses = configStatuses.concat(hayleyPC);
    }
    if (statusIconConfig.hayleyNPC) {
      configStatuses = configStatuses.concat(hayleyNPC);
    }
    if (statusIconConfig.hayleyUtility) {
      configStatuses = configStatuses.concat(hayleyUtility);
    }
    console.log(`Lancer | ${configStatuses.length} status icons configured`);
    CONFIG.statusEffects = configStatuses;
  }
}

// To support more effects, we add several effect types.
export const AE_MODE_SET_JSON = 11 as any;
export const AE_MODE_APPEND_JSON = 12 as any;
const _json_cache = {} as Record<string, any>;
Hooks.on(
  "applyActiveEffect",
  function (actor: LancerActor, change: EffectChangeData, current: any, _delta: any, _changes: any) {
    if (change.mode == AE_MODE_SET_JSON || change.mode == AE_MODE_APPEND_JSON) {
      try {
        let parsed_delta = _json_cache[change.value] ?? JSON.parse(change.value);
        _json_cache[change.value] = parsed_delta;
        // Ok, now set it to wherever it was labeled
        if (change.mode == AE_MODE_SET_JSON) {
          foundry.utils.setProperty(actor, change.key, parsed_delta);
        } else if (change.mode == AE_MODE_APPEND_JSON) {
          foundry.utils.getProperty(actor, change.key).push(parsed_delta);
        }
      } catch (e) {
        // Nothing to do really, except log it
        console.warn(`JSON effect parse failed, ${change.value}`);
      }
    }
  }
);

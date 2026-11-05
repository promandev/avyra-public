import type { MinerCampaign } from './twitch-miner';

/**
 * Reglas de elegibilidad de drops, compartidas entre servidor y cliente.
 *
 * Replican `DropsCampaign.eligible` del minero: una campaña se puede minar si la
 * cuenta está vinculada con el juego, o si alguna recompensa es una insignia o
 * un emoticono, que Twitch entrega sin vincular nada. Sin esto la lista
 * ofrecería «Minar» en campañas donde el minero no llegaría a buscar canales.
 */

const TWITCH_SIDE_BENEFITS = new Set(['BADGE', 'EMOTE']);

export function hasPendingDrops(campaign: MinerCampaign): boolean {
  return campaign.drops.some((d) => !d.is_claimed);
}

/** Alguna recompensa la entrega Twitch, así que no hace falta vincular. */
export function isTwitchSideReward(campaign: MinerCampaign): boolean {
  return campaign.drops.some((d) => d.benefits.some((b) => TWITCH_SIDE_BENEFITS.has(b.type)));
}

/**
 * La cuenta puede ganar esta campaña, tenga o no drops por reclamar. Es lo que
 * decide qué progreso se enseña: una campaña ya completada hoy sigue contando.
 */
export function isCampaignEligible(campaign: MinerCampaign): boolean {
  return campaign.active && (campaign.linked || isTwitchSideReward(campaign));
}

export function isCampaignMinable(campaign: MinerCampaign): boolean {
  return isCampaignEligible(campaign) && hasPendingDrops(campaign);
}

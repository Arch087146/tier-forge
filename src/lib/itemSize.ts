import type { BoardStyle } from "../types";

/** Card width at 100% board scale. The slider zooms the whole board from here. */
export const BASE_ITEM_SIZE = 96;

/**
 * The board-size slider scales the entire board. Each board style derives the
 * matching card height from the card width, so the readout can show both
 * dimensions without a second slider.
 */
export function itemHeightFor(size: number, style: BoardStyle): number {
  const ratio = style === "classic" ? 1 : style === "basic" ? 1.12 : 1.2;
  return Math.round(size * ratio);
}

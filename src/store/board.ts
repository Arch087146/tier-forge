import { create } from "zustand";
import { persist } from "zustand/middleware";
import { BASE_ITEM_SIZE } from "../lib/itemSize";
import type { BoardSnapshot, BoardStyle, Theme, Tier, TierItem } from "../types";

const TIER_COLORS = [
  "#ff7f7f",
  "#ffbf7f",
  "#ffdf7f",
  "#bfff7f",
  "#7fbfff",
  "#c79bff",
  "#ff9bd2"
];

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export function makeTier(name: string, color: string): Tier {
  return { id: uid(), name, color, items: [] };
}

function defaultTiers(): Tier[] {
  return ["S", "A", "B", "C", "D", "F"].map((name, index) =>
    makeTier(name, TIER_COLORS[index])
  );
}

export interface BoardStore extends BoardSnapshot {
  addItems: (items: TierItem[]) => void;
  removeItem: (itemId: string) => void;
  moveItem: (itemId: string, toContainer: string, toIndex: number) => void;
  renameTier: (tierId: string, name: string) => void;
  setTierColor: (tierId: string, color: string) => void;
  addTier: () => void;
  removeTier: (tierId: string) => void;
  setTitle: (title: string) => void;
  setItemSize: (size: number) => void;
  setBoardStyle: (style: BoardStyle) => void;
  setTheme: (theme: Theme) => void;
  clearPool: () => void;
  resetBoard: () => void;
  loadBoard: (snapshot: BoardSnapshot) => void;
}

export function locateItem(
  state: Pick<BoardSnapshot, "tiers" | "pool">,
  itemId: string
): { container: string; index: number } | null {
  const poolIndex = state.pool.findIndex((item) => item.id === itemId);
  if (poolIndex >= 0) return { container: "pool", index: poolIndex };

  for (const tier of state.tiers) {
    const index = tier.items.findIndex((item) => item.id === itemId);
    if (index >= 0) return { container: tier.id, index };
  }
  return null;
}

export function containerItems(
  state: Pick<BoardSnapshot, "tiers" | "pool">,
  container: string
): TierItem[] {
  if (container === "pool") return state.pool;
  return state.tiers.find((tier) => tier.id === container)?.items ?? [];
}

export function resolveContainer(
  state: Pick<BoardSnapshot, "tiers" | "pool">,
  id: string
): string | null {
  if (id === "pool" || id === "pool-return") return "pool";
  if (state.tiers.some((tier) => tier.id === id)) return id;
  return locateItem(state, id)?.container ?? null;
}

export const useBoard = create<BoardStore>()(
  persist(
    (set, get) => ({
      title: "Untitled tier list",
      tiers: defaultTiers(),
      pool: [],
      itemSize: BASE_ITEM_SIZE,
      boardStyle: "forge",
      theme: "dark",

      addItems: (items) =>
        set((state) => ({ pool: [...state.pool, ...items] })),

      removeItem: (itemId) =>
        set((state) => ({
          pool: state.pool.filter((item) => item.id !== itemId),
          tiers: state.tiers.map((tier) => ({
            ...tier,
            items: tier.items.filter((item) => item.id !== itemId)
          }))
        })),

      moveItem: (itemId, toContainer, toIndex) =>
        set((state) => {
          const from = locateItem(state, itemId);
          if (!from) return state;

          const source = containerItems(state, from.container);
          const item = source[from.index];
          if (!item) return state;

          // `toIndex` is the index of the item under the pointer in the
          // current array (or the array length for an empty drop zone). That
          // is exactly what `arrayMove` expects: remove the source item, then
          // insert at the original target index. Do not pre-adjust it.
          const index = Math.max(0, toIndex);

          const tiers = state.tiers.map((tier) => {
            if (tier.id === from.container) {
              return { ...tier, items: tier.items.filter((_, i) => i !== from.index) };
            }
            return tier;
          });

          let pool =
            from.container === "pool"
              ? state.pool.filter((_, i) => i !== from.index)
              : state.pool;

          if (toContainer === "pool") {
            pool = [...pool];
            pool.splice(Math.min(index, pool.length), 0, item);
          } else {
            const target = tiers.find((tier) => tier.id === toContainer);
            if (!target) return state;
            const next = [...target.items];
            next.splice(Math.min(index, next.length), 0, item);
            const withItem = tiers.map((tier) =>
              tier.id === toContainer ? { ...tier, items: next } : tier
            );
            return { ...state, tiers: withItem, pool };
          }

          return { ...state, tiers, pool };
        }),

      renameTier: (tierId, name) =>
        set((state) => ({
          tiers: state.tiers.map((tier) =>
            tier.id === tierId ? { ...tier, name } : tier
          )
        })),

      setTierColor: (tierId, color) =>
        set((state) => ({
          tiers: state.tiers.map((tier) =>
            tier.id === tierId ? { ...tier, color } : tier
          )
        })),

      addTier: () =>
        set((state) => ({
          tiers: [
            ...state.tiers,
            makeTier(
              String.fromCharCode(65 + (state.tiers.length % 26)),
              TIER_COLORS[state.tiers.length % TIER_COLORS.length]
            )
          ]
        })),

      removeTier: (tierId) =>
        set((state) => {
          if (state.tiers.length <= 1) return state;
          const tier = state.tiers.find((item) => item.id === tierId);
          if (!tier) return state;
          return {
            tiers: state.tiers.filter((item) => item.id !== tierId),
            pool: [...tier.items, ...state.pool]
          };
        }),

      setTitle: (title) => set({ title }),

      setItemSize: (itemSize) =>
        set({ itemSize: Math.min(160, Math.max(40, itemSize)) }),

      setBoardStyle: (boardStyle) => set({ boardStyle }),

      setTheme: (theme) => set({ theme }),

      clearPool: () => set({ pool: [] }),

      resetBoard: () =>
        set({
          title: "Untitled tier list",
          tiers: defaultTiers(),
          pool: [],
          itemSize: BASE_ITEM_SIZE,
          boardStyle: "forge",
          theme: "dark"
        }),

      loadBoard: (snapshot) =>
        set({
          title: snapshot.title,
          tiers: snapshot.tiers,
          pool: snapshot.pool,
          itemSize: snapshot.itemSize,
          boardStyle: snapshot.boardStyle,
          theme: snapshot.theme ?? "dark"
        })
    }),
    {
      name: "tierforge.board.v1",
      version: 1,
      partialize: (state) => ({
        title: state.title,
        tiers: state.tiers,
        pool: state.pool,
        itemSize: state.itemSize,
        boardStyle: state.boardStyle,
        theme: state.theme
      })
    }
  )
);

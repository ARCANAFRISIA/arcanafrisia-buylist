// src/lib/store/cart.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = {
  id: string; // scryfallId
  name: string;
  set: string;
  imageSmall?: string | null;
  cardmarketId?: number | null;
  qty: number;
  payout: number; // unit payout locked at add-time
  foil: boolean; // default false
  condition: "NM" | "EX" | "GD" | "PL" | "PO"; // default NM
};

type CartState = {
  items: CartItem[];
  add: (item: Omit<CartItem, "qty"> & { qty?: number }) => void;
  remove: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  clear: () => void;
  count: () => number;
  total: () => number;
};

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (item) =>
        set((s) => {
          const ex = s.items.find((i) => i.id === item.id && i.foil === item.foil && i.condition === item.condition);
          if (ex) {
            ex.qty += item.qty ?? 1;
            return { items: [...s.items] };
          }
          return { items: [...s.items, { ...item, qty: item.qty ?? 1 }] };
        }),
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      setQty: (id, qty) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, qty: Math.max(0, qty) } : i)) })),
      clear: () => set({ items: [] }),
      count: () => get().items.reduce((n, i) => n + i.qty, 0),
      total: () => get().items.reduce((n, i) => n + i.qty * i.payout, 0),
    }),
    { name: "af-buylist-cart" }
  )
);
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ShoppingBag, Trash2 } from "lucide-react";

import { useCart } from "@/lib/store/cart";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";

const GOLD = "#C9A24E";
const fmt = (n: number) => `€ ${n.toFixed(2)}`;

export default function CartModal() {
  const cart = useCart();
  const [open, setOpen] = useState(false);

  // Hydration guard
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const count = mounted ? cart.count() : 0;
  const total = mounted ? cart.total() : 0;
  const items = mounted ? cart.items : [];
  const euro = (n: number) =>
  `€ ${new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)}`;

  const isEmpty = items.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="relative h-10 rounded-full px-4 z-50"
          style={{ backgroundColor: GOLD, color: "#0A0F1A" }}
        >
          <ShoppingBag className="mr-2 h-4 w-4" />
<span suppressHydrationWarning>
  {count > 0 ? `Cart • € ${total.toFixed(2)}` : "Cart"}
</span>
         
        </Button>
      </DialogTrigger>

      {/* Centered modal met Mystic-Void palette */}
      
      <DialogContent className="sm:max-w-2xl w-[calc(100vw-2rem)] af-panel border border-[var(--border)] text-slate-200">
        <DialogHeader>
          <DialogTitle className="af-text">Your Offer</DialogTitle>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-auto space-y-3 pr-1">
          {isEmpty && (
            <div className="af-muted">Nog geen kaarten toegevoegd.</div>
          )}

          {items.map((i) => {
            const line = i.payout * i.qty;
            return (
              <div
                key={i.id}
                className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--bg2)] p-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Thumb */}
                  <div className="grid h-14 w-10 place-items-center overflow-hidden rounded border border-[var(--border)] bg-black/30 shrink-0">
                    {i.imageSmall && (
                      <Image
                        src={i.imageSmall}
                        alt={i.name}
                        width={40}
                        height={56}
                        className="object-contain"
                      />
                    )}
                  </div>

                  {/* Titel + meta */}
                  <div className="min-w-0">
                    <div className="truncate font-medium af-text">{i.name}</div>
                    <div className="text-xs af-muted">
                      {i.set?.toUpperCase()} • {i.condition} •{" "}
                      {i.foil ? "Foil" : "Non-foil"}
                    </div>
                    <div className="mt-1 text-xs af-muted">
                      {fmt(i.payout)} × {i.qty} ={" "}
                      <span className="tabular-nums font-semibold" style={{ color: GOLD }}>
                        {fmt(line)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Qty controls + remove */}
                <div className="ml-3 flex items-center gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Verlaag aantal"
                    disabled={i.qty <= 1}
                    onClick={() => cart.setQty(i.id, Math.max(1, i.qty - 1))}
                  >
                    −
                  </Button>
                  <div className="w-6 text-center tabular-nums">{i.qty}</div>
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Verhoog aantal"
                    onClick={() => cart.setQty(i.id, i.qty + 1)}
                  >
                    +
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Verwijder regel"
                    onClick={() => cart.remove(i.id)}
                    title="Verwijderen"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-3 sm:justify-between">
  {/* links: totaal */}
  
  <div className="mr-auto text-lg font-semibold text-[#E8EEF7]">
   Totaal: € {total.toFixed(2)}
   
  </div>

  {/* rechts: acties */}
  <div className="flex items-center gap-2">
    <Button
      variant="secondary"
      className="w-auto whitespace-nowrap"
      onClick={() => cart.clear()}
      disabled={cart.items.length === 0}
    >
      Kar Leegmaken
    </Button>

    <Link href="/submit" onClick={() => setOpen(false)}>
      <Button className="font-semibold" style={{ backgroundColor: GOLD, color: "#0A0F1A" }}>
        Verder naar indienen
      </Button>
    </Link>
  </div>
</DialogFooter>

      </DialogContent>
    </Dialog>
  );
}

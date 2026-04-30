export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  type PokemonApiCard,
  normalizePokemonCard,
  POKEMON_MAX_QTY_PER_CARD,
} from "@/lib/pokemonBuylist";

type InItem = {
  pokemonId: string;
  qty: number;
};

type InMeta = {
  clientTotal?: number;
  shippingMethod?: string;
};

type InBody = {
  email: string;
  fullName?: string;
  addressLine1?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  payoutMethod?: string;
  iban?: string;
  paypalEmail?: string;
  items: InItem[];
  meta?: InMeta;
};

async function fetchPokemonCardById(id: string): Promise<PokemonApiCard | null> {
  const apiKey = process.env.POKEMON_TCG_API_KEY;
  const url = `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(id)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      ...(apiKey ? { "X-Api-Key": apiKey } : {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    return null;
  }

  const json = (await res.json()) as { data?: PokemonApiCard };
  return json.data ?? null;
}

function jsonSafe<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? Number(v) : v))
  );
}

export async function POST(req: NextRequest) {
  try {
    const body: InBody = await req.json();
    const {
      email,
      fullName,
      addressLine1,
      postalCode,
      city,
      country,
      payoutMethod,
      iban,
      paypalEmail,
      items,
      meta,
    } = body;

    if (!fullName || !fullName.trim()) {
      return NextResponse.json(
        { ok: false, error: "Naam is vereist" },
        { status: 400 }
      );
    }

    if (!addressLine1 || !postalCode || !city || !country) {
      return NextResponse.json(
        { ok: false, error: "Volledig adres is vereist" },
        { status: 400 }
      );
    }

    if (!payoutMethod) {
      return NextResponse.json(
        { ok: false, error: "Betaalmethode is vereist" },
        { status: 400 }
      );
    }

    if (payoutMethod === "BANK" && (!iban || !iban.trim())) {
      return NextResponse.json(
        { ok: false, error: "IBAN is vereist voor bankoverschrijving" },
        { status: 400 }
      );
    }

    if (
      payoutMethod === "PAYPAL" &&
      (!paypalEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(paypalEmail))
    ) {
      return NextResponse.json(
        { ok: false, error: "Geldig PayPal e-mailadres is vereist" },
        { status: 400 }
      );
    }

    if (
      !email ||
      typeof email !== "string" ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    ) {
      return NextResponse.json(
        { ok: false, error: "E-mailadres vereist of ongeldig" },
        { status: 400 }
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Leeg mandje" },
        { status: 400 }
      );
    }

    const uniqueIds = Array.from(
      new Set(
        items
          .map((x) => String(x.pokemonId ?? "").trim())
          .filter(Boolean)
      )
    );

    if (uniqueIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Geen geldige Pokémon ids ontvangen" },
        { status: 400 }
      );
    }

    const fetched = await Promise.all(
      uniqueIds.map(async (id) => {
        const card = await fetchPokemonCardById(id);
        return { id, card };
      })
    );

    const byId = new Map<string, PokemonApiCard | null>();
    for (const row of fetched) {
      byId.set(row.id, row.card);
    }

    const computed = items.map((raw) => {
      const pokemonId = String(raw.pokemonId ?? "").trim();
      const requestedQty = Math.max(1, Number(raw.qty) || 1);

      const apiCard = byId.get(pokemonId);
      if (!apiCard) {
        return {
          pokemonId,
          qty: 0,
          requestedQty,
          allowed: false,
          reason: "Card not found in Pokémon API",
        };
      }

      const card = normalizePokemonCard(apiCard);
      if (!card) {
        return {
          pokemonId,
          qty: 0,
          requestedQty,
          allowed: false,
          reason: "Card is outside allowed Pokémon series",
        };
      }

      if (!card.isBuyable || card.payout == null) {
        return {
          pokemonId,
          qty: 0,
          requestedQty,
          allowed: false,
          reason: card.buyableReason,
          card,
        };
      }

      const acceptedQty = Math.min(requestedQty, POKEMON_MAX_QTY_PER_CARD);
      const line = Math.round(card.payout * acceptedQty * 100);

      return {
        pokemonId,
        qty: acceptedQty,
        requestedQty,
        allowed: true,
        reason: "OK",
        lineCents: line,
        unitCents: Math.round(card.payout * 100),
        pct: 75,
        card,
      };
    });

    const filtered = computed.filter((x) => x.allowed && x.card);

    if (!filtered.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "Geen Pokémon kaarten buyable na server checks",
          details: computed,
        },
        { status: 400 }
      );
    }

    const shippingMethodRaw = meta?.shippingMethod;
    const shippingMethod: "SELF" | "LABEL" =
      shippingMethodRaw === "LABEL" ? "LABEL" : "SELF";

    const serverTotalCents = filtered.reduce((sum, row) => sum + (row.lineCents ?? 0), 0);
    const clientTotalCents = Math.round(Number(meta?.clientTotal ?? 0) * 100);
    const labelFree = shippingMethod === "LABEL" && serverTotalCents >= 15000;

    const submission = await prisma.submission.create({
      data: {
        email,
        fullName: fullName || null,
        addressLine1: addressLine1 || null,
        postalCode: postalCode || null,
        city: city || null,
        country: country || null,
        payoutMethod: payoutMethod || null,
        iban: iban || null,
        paypalEmail: paypalEmail || null,
        shippingMethod,
        labelFree,
        payoutPct: 75,
        serverTotalCents,
        subtotalCents: serverTotalCents,
        clientTotalCents,
        currency: "EUR",
        pricingSource: "PokemonTCG-Cardmarket",
        metaText: JSON.stringify({
          receivedAt: new Date().toISOString(),
          itemsLength: items.length,
          caps: filtered.map((row) => ({
            pokemonId: row.pokemonId,
            requestedQty: row.requestedQty,
            acceptedQty: row.qty,
            maxQty: POKEMON_MAX_QTY_PER_CARD,
          })),
        }),
        items: {
          create: filtered.map((row) => ({
            productId: BigInt(0), // temporary sentinel; pokemonId is the real key for Pokémon
            pokemonId: row.pokemonId,
            collectorNumber: row.card?.number ?? null,
            cardName: row.card?.name ?? null,
            setCode: row.card?.setCode ?? null,
            condition: "NM",
            isFoil: false,
            qty: row.qty,
            trendCents:
              row.card?.marketPrice != null ? Math.round(row.card.marketPrice * 100) : null,
            trendFoilCents: null,
            unitCents: row.unitCents ?? 0,
            lineCents: row.lineCents ?? 0,
            pct: row.pct ?? 75,
          })),
        },
      },
      include: { items: true },
    });

    return NextResponse.json(
      jsonSafe({
        ok: true,
        submissionId: submission.id,
        serverTotalCents,
        serverTotalEur: serverTotalCents / 100,
        acceptedItems: filtered.map((row) => ({
          pokemonId: row.pokemonId,
          name: row.card?.name ?? null,
          setName: row.card?.setName ?? null,
          qty: row.qty,
          unitEur: (row.unitCents ?? 0) / 100,
          lineEur: (row.lineCents ?? 0) / 100,
        })),
        rejectedItems: computed
          .filter((x) => !x.allowed)
          .map((x) => ({
            pokemonId: x.pokemonId,
            requestedQty: x.requestedQty,
            reason: x.reason,
          })),
        submission,
      })
    );
  } catch (e: any) {
    console.error("[pokemon submit] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 }
    );
  }
}
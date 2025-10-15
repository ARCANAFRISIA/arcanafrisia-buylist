export type ScryfallCard = {
  name: string;
  set: string;
  image_uris?: { normal?: string; large?: string };
};

export async function fetchScryfallByCardmarketId(idProduct: number): Promise<ScryfallCard | null> {
  try {
    const res = await fetch(`https://api.scryfall.com/cards/cardmarket/${idProduct}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const img = data?.image_uris ?? data?.card_faces?.[0]?.image_uris ?? null;
    return {
      name: data?.name ?? "",
      set: data?.set?.toUpperCase?.() ?? "",
      image_uris: img ?? undefined,
    };
  } catch {
    return null;
  }
}

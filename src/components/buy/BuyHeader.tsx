"use client";

import Link from "next/link";
import CartModal from "@/components/cart/CartModal";

export default function BuyHeader() {
  return (
    <div>
      {/* Banner bovenaan */}
      <div style={{ width: "100%", backgroundColor: "black" }}>
        <div style={{ maxWidth: "1920px", margin: "0 auto" }}>
          <img
            src="https://cdn.shopify.com/s/files/1/0527/7414/2104/files/goatbweb_200px.png?v=1744900135"
            alt="Arcana Frisia Header"
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </div>

      {/* Desktop-nav */}
      <header
        style={{
          width: "100%",
          backgroundColor: "#050910", // var(--bg2)-achtig
          borderBottom: "1px solid #111827", // var(--border)
          boxShadow: "0 1px 0 rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "0 2.5rem",
            height: "56px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {/* Links: brand + menu */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <Link
              href="/buy"
              style={{
                color: "#f9fafb",
                fontWeight: 600,
                fontSize: "1.05rem",
                textDecoration: "none",
                marginRight: "2.5rem",
              }}
            >
              Arcana Frisia Buylist
            </Link>

            <nav
              style={{
                display: "flex",
                alignItems: "center",
                columnGap: "1.75rem",
                fontSize: "0.9rem",
                fontWeight: 600,
              }}
            >
              <Link
                href="/buy/sets"
                style={{
                  color: "#e5e7eb",
                  textDecoration: "none",
                  padding: "2px 0",
                }}
                className="hover:text-[var(--gold)]"
              >
                Sets
              </Link>
              <Link
                href="/buy/list"
                style={{
                  color: "#e5e7eb",
                  textDecoration: "none",
                  padding: "2px 0",
                }}
                className="hover:text-[var(--gold)]"
              >
                List upload
              </Link>
              <Link
                href="/buy/info"
                style={{
                  color: "#e5e7eb",
                  textDecoration: "none",
                  padding: "2px 0",
                }}
                className="hover:text-[var(--gold)]"
              >
                Info
              </Link>
              <Link
                href="/buy/account"
                style={{
                  color: "#e5e7eb",
                  textDecoration: "none",
                  padding: "2px 0",
                }}
                className="hover:text-[var(--gold)]"
              >
                Account
              </Link>
            </nav>
          </div>

          {/* Rechts: Cart */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <CartModal />
          </div>
        </div>
      </header>
    </div>
  );
}

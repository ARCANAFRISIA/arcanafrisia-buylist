"use client";

import Link from "next/link";
import { useState } from "react";
import CartModal from "@/components/cart/CartModal";

export default function BuyHeader() {
  const [open, setOpen] = useState(false);

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

      {/* Header / nav */}
      <header className="af-header">
        <div className="af-inner">
          {/* Links: brand + desktop-menu */}
          <div className="af-left">
            <Link
              href="/"
              className="af-brand"
              style={{
                color: "#f9fafb",
                textDecoration: "none",
              }}
            >
              Arcana Frisia Buylist
            </Link>

            {/* Desktop menu */}
            <nav className="af-nav-desktop">
              <Link
                href="/buy/sets"
                className="af-nav-link"
                style={{ color: "#e5e7eb", textDecoration: "none" }}
              >
                Sets
              </Link>
              <Link
                href="/buy/list"
                className="af-nav-link"
                style={{ color: "#e5e7eb", textDecoration: "none" }}
              >
                List upload
              </Link>
              <Link
                href="/buy/info"
                className="af-nav-link"
                style={{ color: "#e5e7eb", textDecoration: "none" }}
              >
                Info
              </Link>
              <Link
                href="/buy/account"
                className="af-nav-link"
                style={{ color: "#e5e7eb", textDecoration: "none" }}
              >
                Account
              </Link>
            </nav>
          </div>

          {/* Rechts: Menu button (mobiel) + Cart */}
          <div className="af-right">
            <button
              type="button"
              className="af-menu-btn"
              onClick={() => setOpen((v) => !v)}
            >
              ☰ Menu
            </button>

            <CartModal />
          </div>
        </div>

        {/* Mobiel dropdown-menu */}
        {open && (
          <div className="af-nav-mobile">
            <nav>
              <Link
                href="/buy/sets"
                className="af-nav-link-mobile"
                style={{ color: "#e5e7eb", textDecoration: "none" }}
                onClick={() => setOpen(false)}
              >
                Sets
              </Link>
              <Link
                href="/buy/list"
                className="af-nav-link-mobile"
                style={{ color: "#e5e7eb", textDecoration: "none" }}
                onClick={() => setOpen(false)}
              >
                List upload
              </Link>
              <Link
                href="/buy/info"
                className="af-nav-link-mobile"
                style={{ color: "#e5e7eb", textDecoration: "none" }}
                onClick={() => setOpen(false)}
              >
                Info
              </Link>
              <Link
                href="/buy/account"
                className="af-nav-link-mobile"
                style={{ color: "#e5e7eb", textDecoration: "none" }}
                onClick={() => setOpen(false)}
              >
                Account
              </Link>
            </nav>
          </div>
        )}

        <style jsx>{`
          .af-header {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 40; /* boven content, onder modals */
    width: 100%;
    background-color: #050910;
    border-bottom: 1px solid #111827;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
  }

  .af-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 1.75rem;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

          .af-left {
            display: flex;
            align-items: center;
            gap: 2rem;
            min-width: 0;
          }

          .af-brand {
            font-weight: 600;
            font-size: 1.05rem;
            white-space: nowrap;
          }

          .af-nav-desktop {
            display: flex;
            align-items: center;
            gap: 1.75rem;
            font-size: 1rem;
            font-weight: 600;
          }

          .af-nav-link:hover {
            color: var(--gold) !important;
          }

          .af-right {
            display: flex;
            align-items: center;
            gap: 0.75rem;
          }

          .af-menu-btn {
            display: none; /* alleen mobiel */
            border-radius: 999px;
            border: 1px solid #374151;
            background: #050910;
            padding: 4px 10px;
            font-size: 0.78rem;
            color: #f9fafb;
            cursor: pointer;
          }

          .af-menu-btn:hover {
            border-color: var(--gold);
          }

          .af-nav-mobile {
            display: none;
          }

          /* Tablet: iets compacter */
          @media (max-width: 900px) {
            .af-inner {
              padding: 0 1.25rem;
            }
          }

          /* Mobiel: brand + menu + cart op 1 rij, desktop-menu weg, dropdown aan */
          @media (max-width: 640px) {
            .af-inner {
              padding: 0 0.9rem;
              height: 56px;
            }

            .af-nav-desktop {
              display: none;
            }

            .af-menu-btn {
              display: inline-flex;
              align-items: center;
              justify-content: center;
            }

            .af-brand {
              font-size: 0.9rem;
            }

            .af-left {
              gap: 0.75rem;
            }

            .af-right {
              margin-left: 0.75rem;
            }

            .af-nav-mobile {
              display: block;
              border-top: 1px solid #111827;
              background-color: #050910;
            }

            .af-nav-mobile nav {
              max-width: 1200px;
              margin: 0 auto;
              padding: 0.4rem 0.9rem 0.6rem;
              display: flex;
              flex-direction: column;
              gap: 0.25rem;
              font-size: 0.86rem;
              font-weight: 600;
            }

            .af-nav-link-mobile:hover {
              color: var(--gold) !important;
            }
          }

          @media (max-width: 380px) {
            .af-brand {
              font-size: 0.82rem;
            }
            .af-inner {
              padding: 0 0.6rem;
            }
          }
        `}</style>
      </header>
    </div>
  );
}

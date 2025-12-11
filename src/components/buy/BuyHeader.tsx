"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

import CartModal from "@/components/cart/CartModal";

export default function BuyHeader() {
  const [open, setOpen] = useState(false); // mobile menu
  const [infoOpenDesktop, setInfoOpenDesktop] = useState(false); // desktop Info
  const [infoOpenMobile, setInfoOpenMobile] = useState(false); // mobile Info

    // WebwinkelKeur sidebar alleen op desktop laden
  useEffect(() => {
    if (typeof window === "undefined") return;

    // alleen desktop (tailwind sm ~ 640, ik pak 768 om safe te zitten)
    if (window.innerWidth < 768) return;

    // niet dubbel laden
    if ((window as any).__wwkSidebarLoaded) return;
    (window as any).__wwkSidebarLoaded = true;

    const base = "https://dashboard.webwinkelkeur.nl";
    const id = 1211185;

    function c(s: number, i: number) {
      const o = Date.now();
      const a = s * 60000;
      const _ = (Math.sin(i) || 0) * a;
      return Math.floor((o + _) / a);
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = `${base}/sidebar.js?id=${id}&c=${c(10, id)}`;

    const firstScript = document.getElementsByTagName("script")[0];
    if (firstScript && firstScript.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      document.body.appendChild(script);
    }
  }, []);


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
            <Link href="/" className="af-brand">
              Arcana Frisia Buylist
            </Link>

            {/* Desktop menu */}
            <nav className="af-nav-desktop">
              <Link href="/buy/sets" className="af-nav-link">
                Sets
              </Link>
              <Link href="/buy/list" className="af-nav-link">
                List upload
              </Link>

              {/* Info dropdown (desktop) */}
              <div className="af-nav-info-wrapper">
                <button
                  type="button"
                  className="af-nav-link af-nav-info-trigger"
                  onClick={() => setInfoOpenDesktop((v) => !v)}
                >
                  <span>Info</span>
                  <span className="af-nav-info-caret">▾</span>
                </button>

                {infoOpenDesktop && (
                  <div className="af-nav-info-dropdown">
                    <Link
                      href="/buy/info#over-ons"
                      className="af-nav-info-link"
                      onClick={() => setInfoOpenDesktop(false)}
                    >
                      Over ons
                    </Link>
                    <Link
                      href="/buy/info#hoe-werkt-het"
                      className="af-nav-info-link"
                      onClick={() => setInfoOpenDesktop(false)}
                    >
                      Hoe werkt verkopen?
                    </Link>
                    <Link
                      href="/buy/info#grading"
                      className="af-nav-info-link"
                      onClick={() => setInfoOpenDesktop(false)}
                    >
                      Grading &amp; conditie
                    </Link>
                    <Link
                      href="/buy/info#betaling-verzenden"
                      className="af-nav-info-link"
                      onClick={() => setInfoOpenDesktop(false)}
                    >
                      Betaling &amp; verzenden
                    </Link>
                    <Link
                      href="/buy/info#reviews"
                      className="af-nav-info-link"
                      onClick={() => setInfoOpenDesktop(false)}
                    >
                      Reviews &amp; vertrouwen
                    </Link>
                    <Link
                      href="/buy/info#faq"
                      className="af-nav-info-link"
                      onClick={() => setInfoOpenDesktop(false)}
                    >
                      FAQ
                    </Link>
                    <Link
                      href="/buy/info#bedrijfsgegevens"
                      className="af-nav-info-link"
                      onClick={() => setInfoOpenDesktop(false)}
                    >
                      Bedrijfsgegevens
                    </Link>
                  </div>
                )}
              </div>

              <Link href="/buy/account" className="af-nav-link">
                Account
              </Link>
            </nav>
          </div>

          {/* Rechts: Menu button (mobiel) + Cart */}
          <div className="af-right">
            <button
              type="button"
              className="af-menu-btn"
              onClick={() => {
                setOpen((v) => !v);
                if (!open) {
                  setInfoOpenMobile(false);
                }
              }}
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
                onClick={() => setOpen(false)}
              >
                Sets
              </Link>
              <Link
                href="/buy/list"
                className="af-nav-link-mobile"
                onClick={() => setOpen(false)}
              >
                List upload
              </Link>

              {/* Info met uitklapbare sublinks (mobiel) */}
              <button
                type="button"
                className="af-nav-link-mobile af-nav-info-mobile-trigger"
                onClick={() => setInfoOpenMobile((v) => !v)}
              >
                <span>Info</span>
                <span className="af-nav-info-caret">
                  {infoOpenMobile ? "▴" : "▾"}
                </span>
              </button>

              {infoOpenMobile && (
                <div className="af-nav-info-mobile-list">
                  <Link
                    href="/buy/info#over-ons"
                    className="af-nav-link-mobile-sub"
                    onClick={() => {
                      setOpen(false);
                      setInfoOpenMobile(false);
                    }}
                  >
                    Over ons
                  </Link>
                  <Link
                    href="/buy/info#hoe-werkt-het"
                    className="af-nav-link-mobile-sub"
                    onClick={() => {
                      setOpen(false);
                      setInfoOpenMobile(false);
                    }}
                  >
                    Hoe werkt verkopen?
                  </Link>
                  <Link
                    href="/buy/info#grading"
                    className="af-nav-link-mobile-sub"
                    onClick={() => {
                      setOpen(false);
                      setInfoOpenMobile(false);
                    }}
                  >
                    Grading &amp; conditie
                  </Link>
                  <Link
                    href="/buy/info#betaling-verzenden"
                    className="af-nav-link-mobile-sub"
                    onClick={() => {
                      setOpen(false);
                      setInfoOpenMobile(false);
                    }}
                  >
                    Betaling &amp; verzenden
                  </Link>
                  <Link
                    href="/buy/info#reviews"
                    className="af-nav-link-mobile-sub"
                    onClick={() => {
                      setOpen(false);
                      setInfoOpenMobile(false);
                    }}
                  >
                    Reviews &amp; vertrouwen
                  </Link>
                  <Link
                    href="/buy/info#faq"
                    className="af-nav-link-mobile-sub"
                    onClick={() => {
                      setOpen(false);
                      setInfoOpenMobile(false);
                    }}
                  >
                    FAQ
                  </Link>
                  <Link
                    href="/buy/info#bedrijfsgegevens"
                    className="af-nav-link-mobile-sub"
                    onClick={() => {
                      setOpen(false);
                      setInfoOpenMobile(false);
                    }}
                  >
                    Bedrijfsgegevens
                  </Link>
                </div>
              )}

              <Link
                href="/buy/account"
                className="af-nav-link-mobile"
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
            z-index: 40;
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

          /* ✅ Forceer link-styling binnen header (desktop + mobiel) */
          :global(.af-header a) {
            color: #e5e7eb !important;
            text-decoration: none !important;
          }

          :global(.af-header a:visited) {
            color: #e5e7eb !important;
          }

          :global(.af-header a:hover) {
            color: var(--gold) !important;
            text-decoration: none !important;
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

          .af-nav-link {
            cursor: pointer;
          }

          .af-nav-info-wrapper {
            position: relative;
          }

          .af-nav-info-trigger {
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            background: none;
            border: none;
            padding: 0;
            cursor: pointer;
            font-size: 1rem;
            font-weight: 600;
            color: #e5e7eb;
          }

          .af-nav-info-caret {
            font-size: 0.7rem;
            opacity: 0.8;
          }

          .af-nav-info-dropdown {
            position: absolute;
            top: 140%;
            left: 0;
            min-width: 220px;
            padding: 0.35rem 0.4rem;
            border-radius: 0.75rem;
            border: 1px solid #111827;
            background-color: #050910;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
            z-index: 50;
            display: flex;
            flex-direction: column;
            align-items: stretch;
          }

          .af-nav-info-link {
            display: block;
            padding: 0.35rem 0.6rem;
            border-radius: 0.5rem;
            font-size: 0.85rem;
          }

          .af-nav-info-link:hover {
            background-color: rgba(255, 255, 255, 0.04);
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

            .af-nav-info-mobile-trigger {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 0.25rem;
              background: none;
              border: none;
              padding: 0;
              text-align: left;
              cursor: pointer;
              font-size: 0.9rem;
              font-weight: 600;
              color: #e5e7eb !important;
            }

            .af-nav-info-mobile-list {
              padding-left: 0.75rem;
              padding-top: 0.15rem;
              padding-bottom: 0.2rem;
              display: flex;
              flex-direction: column;
              gap: 0.15rem;
            }

            .af-nav-link-mobile-sub {
              font-size: 0.78rem;
              font-weight: 500;
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

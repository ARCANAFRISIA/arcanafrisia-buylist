"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefreshOnFocus() {
  const router = useRouter();

  useEffect(() => {
    const onFocus = () => router.refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router]);

  return null;
}

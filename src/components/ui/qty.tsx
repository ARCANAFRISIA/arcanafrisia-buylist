// src/components/ui/qty.tsx
"use client";

type Props = {
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
  className?: string;
};

export default function Qty({ value, onChange, min = 1, max = 99, className }: Props) {
  const dec = () => onChange(Math.max(min, (value || 0) - 1));
  const inc = () => onChange(Math.min(max, (value || 0) + 1));

  return (
    <div className={`inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--bg2)] ${className ?? ""}`}>
      <button
        type="button"
        onClick={dec}
        className="px-2 py-1 text-xs af-muted hover:af-text"
        aria-label="Decrease quantity"
      >
        −
      </button>
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          onChange(Number.isFinite(n) ? Math.min(Math.max(n, min), max) : min);
        }}
        className="w-10 bg-transparent text-center text-sm outline-none"
        aria-label="Quantity"
      />
      <button
        type="button"
        onClick={inc}
        className="px-2 py-1 text-xs af-muted hover:af-text"
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}

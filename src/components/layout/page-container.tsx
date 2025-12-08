// src/components/layout/page-container.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

type PageContainerProps = {
  children: React.ReactNode;
  className?: string;
};

export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[1200px] px-6 lg:px-12",
        className
      )}
    >
      {children}
    </div>
  );
}

// src/app/admin/page.tsx
import { redirect } from "next/navigation";

export default function AdminIndex() {
  redirect("/admin/submissions");
}

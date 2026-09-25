"use client";

import { useFormStatus } from "react-dom";
import { CATEGORIES } from "@/lib/categories";
import { setCategoryAction } from "./actions";

export function SubmitButton({
  children,
  pendingText,
  className,
}: {
  children: React.ReactNode;
  pendingText: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

export function CategorySelect({ id, value }: { id: string; value: string | null }) {
  return (
    <form action={setCategoryAction}>
      <input type="hidden" name="id" value={id} />
      <select
        name="category"
        defaultValue={value ?? "Otros"}
        aria-label="Categoría"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </form>
  );
}

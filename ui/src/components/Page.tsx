import type { ReactNode } from "react";

// ── PageHeader ────────────────────────────────────────────────
interface PageHeaderProps {
  title: string;
  level?: 1 | 2 | 3;
}

export function PageHeader({ title, level = 2 }: PageHeaderProps) {
  const Tag = `h${level}` as "h1" | "h2" | "h3";
  return (
    <Tag className="text-2xl font-black text-amber-300 tracking-tight uppercase mb-2">
      {title}
    </Tag>
  );
}

// ── Section ───────────────────────────────────────────────────
interface SectionProps {
  heading: string;
  children: ReactNode;
}

export function Section({ heading, children }: SectionProps) {
  return (
    <section>
      <h2 className="text-xl font-bold mb-4 text-amber-300 tracking-wide uppercase">
        {heading}
      </h2>
      {children}
    </section>
  );
}

// ── EmptyState ────────────────────────────────────────────────
interface EmptyStateProps {
  message: string;
  icon?: ReactNode;
}

export function EmptyState({ message, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-neutral-500 text-sm">
      {icon && <span className="text-2xl">{icon}</span>}
      <p>{message}</p>
    </div>
  );
}

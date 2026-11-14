import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

export function ActionMenu({
  label,
  icon = "tree",
  className = "",
  children,
}: {
  label: string;
  icon?: string;
  className?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root?.open && !root.contains(event.target as Node)) root.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (event.key === "Escape" && root?.open) {
        root.open = false;
        root.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <details className={`action-menu ${className}`} ref={rootRef}>
      <summary title={label}>
        <Icon name={icon} size={17} />
        <span>{label}</span>
      </summary>
      <div
        className="action-menu-content"
        onClick={(event) => {
          if ((event.target as Element).closest("button") && rootRef.current)
            rootRef.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}

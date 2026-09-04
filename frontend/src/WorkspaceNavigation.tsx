import type { ReactNode } from "react";

export interface WorkspaceNavigationItem<Id extends string> {
  id: Id;
  label: string;
  shortLabel: string;
}

interface NavigationProps<Id extends string> {
  items: Array<WorkspaceNavigationItem<Id>>;
  activeItem: Id;
  onSelect: (item: Id) => void;
}

export function WorkspaceSidebar<Id extends string>({
  ariaLabel,
  navigationLabel,
  summary,
  boundary,
  className = "",
  items,
  activeItem,
  onSelect,
}: NavigationProps<Id> & {
  ariaLabel: string;
  navigationLabel: string;
  summary: ReactNode;
  boundary: ReactNode;
  className?: string;
}) {
  return (
    <aside className={`sidebar ${className}`.trim()} aria-label={ariaLabel}>
      <div className="shift-summary">{summary}</div>
      <nav aria-label={navigationLabel}>
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            className={activeItem === item.id ? "nav-item nav-item--active" : "nav-item"}
            onClick={() => onSelect(item.id)}
            aria-current={activeItem === item.id ? "page" : undefined}
          >
            <span className="nav-item__dot" aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </nav>
      <p className="sidebar__boundary">{boundary}</p>
    </aside>
  );
}

export function WorkspaceBottomNavigation<Id extends string>({
  ariaLabel,
  items,
  activeItem,
  onSelect,
}: NavigationProps<Id> & { ariaLabel: string }) {
  return (
    <nav className="bottom-nav" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          className={
            activeItem === item.id
              ? "bottom-nav__item bottom-nav__item--active"
              : "bottom-nav__item"
          }
          onClick={() => onSelect(item.id)}
          aria-current={activeItem === item.id ? "page" : undefined}
        >
          {item.shortLabel}
        </button>
      ))}
    </nav>
  );
}

import type { CSSProperties, ReactNode } from "react";

import type { AppIconName } from "./AppIcon";
import { AppIcon } from "./AppIcon";

export interface WorkspaceNavigationItem<Id extends string> {
  id: Id;
  label: string;
  shortLabel: string;
  icon?: AppIconName;
}

interface NavigationProps<Id extends string> {
  items: Array<WorkspaceNavigationItem<Id>>;
  activeItem: Id;
  onSelect: (item: Id) => void;
  contentId?: string;
}

export function WorkspaceSidebar<Id extends string>({
  id,
  ariaLabel,
  navigationLabel,
  summary,
  boundary,
  className = "",
  items,
  activeItem,
  onSelect,
  contentId,
}: NavigationProps<Id> & {
  id?: string;
  ariaLabel: string;
  navigationLabel: string;
  summary?: ReactNode;
  boundary?: ReactNode;
  className?: string;
}) {
  return (
    <aside id={id} className={`sidebar ${className}`.trim()} aria-label={ariaLabel}>
      {summary ? <div className="shift-summary">{summary}</div> : null}
      <nav aria-label={navigationLabel}>
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            className={activeItem === item.id ? "nav-item nav-item--active" : "nav-item"}
            onClick={() => onSelect(item.id)}
            aria-current={activeItem === item.id ? "page" : undefined}
            aria-controls={contentId}
            title={item.label}
          >
            {item.icon ? (
              <span className="nav-item__icon"><AppIcon name={item.icon} size={22} /></span>
            ) : (
              <span className="nav-item__dot" aria-hidden="true" />
            )}
            <span className="nav-item__label">{item.label}</span>
          </button>
        ))}
      </nav>
      {boundary ? <div className="sidebar__boundary">{boundary}</div> : null}
    </aside>
  );
}

export function WorkspaceBottomNavigation<Id extends string>({
  ariaLabel,
  items,
  activeItem,
  onSelect,
  contentId,
}: NavigationProps<Id> & { ariaLabel: string }) {
  return (
    <nav
      className="bottom-nav"
      aria-label={ariaLabel}
      style={{ "--workspace-nav-count": items.length } as CSSProperties}
    >
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
          aria-controls={contentId}
        >
          {item.icon ? <AppIcon name={item.icon} size={19} /> : null}
          {item.shortLabel}
        </button>
      ))}
    </nav>
  );
}

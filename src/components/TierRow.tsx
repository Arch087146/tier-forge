import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent
} from "react";
import { createPortal } from "react-dom";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import type { Tier } from "../types";
import { ItemCard } from "./ItemCard";

interface TierRowProps {
  tier: Tier;
  canRemove: boolean;
  onRename: (tierId: string, name: string) => void;
  onColor: (tierId: string, color: string) => void;
  onRemoveTier: (tierId: string) => void;
  onRemoveItem: (itemId: string) => void;
}

export function TierRow({
  tier,
  canRemove,
  onRename,
  onColor,
  onRemoveTier,
  onRemoveItem
}: TierRowProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: tier.id,
    data: { containerId: tier.id, type: "container" }
  });

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menu) return;

    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    function closeMenu() {
      setMenu(null);
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menu]);

  function openColorMenu(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest(".item-card") || target.closest(".tier-remove")) return;

    event.preventDefault();
    event.stopPropagation();

    const width = 190;
    const height = 54;
    setMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height))
    });
  }

  function chooseColor() {
    setMenu(null);
    colorInputRef.current?.click();
  }

  return (
    <>
      <div
        ref={setNodeRef}
        className={`tier-row${isOver ? " is-over" : ""}`}
        style={{ "--tier-color": tier.color } as CSSProperties}
        title="Right-click to change this tier's color"
        onContextMenu={openColorMenu}
      >
        <div className="tier-label">
          <input
            className="tier-name-input"
            value={tier.name}
            aria-label="Tier name"
            spellCheck={false}
            onChange={(event) => onRename(tier.id, event.target.value)}
          />
          <input
            ref={colorInputRef}
            type="color"
            className="tier-color-input-hidden"
            value={tier.color}
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              onColor(tier.id, event.target.value);
              setMenu(null);
            }}
          />
        </div>

        <div className="tier-drop">
          <SortableContext
            items={tier.items.map((item) => item.id)}
            strategy={rectSortingStrategy}
          >
            {tier.items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                containerId={tier.id}
                onRemove={onRemoveItem}
              />
            ))}
          </SortableContext>
          {tier.items.length === 0 ? (
            <div className="tier-empty">Drop items here</div>
          ) : null}
        </div>

        <button
          type="button"
          className="tier-remove"
          disabled={!canRemove}
          title={
            canRemove
              ? "Delete tier (items return to pool)"
              : "Keep at least one tier"
          }
          onClick={() => onRemoveTier(tier.id)}
        >
          ×
        </button>
      </div>

      {menu
        ? createPortal(
            <div
              ref={menuRef}
              className="tier-context-menu"
              style={{ left: menu.x, top: menu.y }}
              role="menu"
            >
              <button
                type="button"
                className="tier-context-item"
                role="menuitem"
                onClick={chooseColor}
              >
                <span
                  className="tier-context-swatch"
                  style={{ background: tier.color }}
                  aria-hidden="true"
                />
                Change color
              </button>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

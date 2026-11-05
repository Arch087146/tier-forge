import { useDroppable } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import type { TierItem } from "../types";
import { ItemCard } from "./ItemCard";

interface PoolProps {
  items: TierItem[];
  onRemoveItem: (itemId: string) => void;
  onAddImage: () => void;
  onClear: () => void;
}

export function Pool({ items, onRemoveItem, onAddImage, onClear }: PoolProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: "pool",
    data: { containerId: "pool", type: "container" }
  });

  return (
    <section
      ref={setNodeRef}
      className={`pool${isOver ? " is-over" : ""}${items.length === 0 ? " is-empty" : ""}`}
    >
      <header className="pool-header">
        <div>
          <h2>Item pool</h2>
          <span>{items.length} unranked</span>
        </div>
        <div className="pool-actions">
          <button type="button" className="ghost-button" onClick={onAddImage}>
            Add image
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={onClear}
            disabled={items.length === 0}
          >
            Clear
          </button>
        </div>
      </header>
      <div className="pool-grid">
        <SortableContext
          items={items.map((item) => item.id)}
          strategy={rectSortingStrategy}
        >
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              containerId="pool"
              onRemove={onRemoveItem}
            />
          ))}
        </SortableContext>
        {items.length === 0 ? (
          <div className="pool-empty">
            Generate a themed list with AI, or add an image, then drag items into tiers.
          </div>
        ) : null}
      </div>
    </section>
  );
}

import { useState, type CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TierItem } from "../types";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

interface ItemCardProps {
  item: TierItem;
  containerId: string;
  onRemove: (id: string) => void;
}

export function ItemCard({ item, containerId, onRemove }: ItemCardProps) {
  const [broken, setBroken] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: item.id,
      data: { containerId, type: "item" }
    });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.2 : 1,
    zIndex: isDragging ? 4 : undefined
  };

  const showImage = Boolean(item.imageUrl) && !broken;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="item-card"
      title={[item.description, item.sourceUrl].filter(Boolean).join("\n")}
      {...attributes}
      {...listeners}
    >
      {showImage ? (
        <img
          src={item.imageUrl}
          alt=""
          draggable={false}
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="item-placeholder" aria-hidden="true">
          {initials(item.name) || "?"}
        </div>
      )}
      <span className="item-name">{item.name}</span>
      {item.license ? <span className="item-license">{item.license}</span> : null}
      <button
        type="button"
        className="item-delete"
        aria-label={`Remove ${item.name}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onRemove(item.id);
        }}
      >
        ×
      </button>
    </div>
  );
}

export function ItemCardPreview({ item }: { item: TierItem }) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(item.imageUrl) && !broken;

  return (
    <div className="item-card dragging-overlay">
      {showImage ? (
        <img src={item.imageUrl} alt="" draggable={false} onError={() => setBroken(true)} />
      ) : (
        <div className="item-placeholder">{initials(item.name) || "?"}</div>
      )}
      <span className="item-name">{item.name}</span>
    </div>
  );
}

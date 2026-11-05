import { useState, type CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type Collision,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { BASE_ITEM_SIZE } from "../lib/itemSize";
import { useBoard, containerItems, locateItem, resolveContainer } from "../store/board";
import type { TierItem } from "../types";
import { ItemCardPreview } from "./ItemCard";
import { Pool } from "./Pool";
import { TierRow } from "./TierRow";

interface BoardProps {
  onAddImage: () => void;
}

/**
 * Tier rows and the pool are droppable containers, and every card inside them
 * is also droppable. When the pointer is over a card we want that card to win
 * so the item lands at the exact index under the cursor; otherwise the row or
 * pool wins and the item is appended.
 */
function preferItemCollisions(collisions: Collision[]): Collision[] {
  const itemCollisions = collisions.filter(
    (collision) =>
      collision.data?.droppableContainer?.data?.current?.type === "item"
  );
  return itemCollisions.length > 0 ? itemCollisions : collisions;
}

function preferPoolReturn(collisions: Collision[]): Collision[] {
  const poolReturn = collisions.find((collision) => collision.id === "pool-return");
  if (poolReturn) return [poolReturn];
  return preferItemCollisions(collisions);
}

const boardCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return preferPoolReturn(pointerCollisions);

  const rectCollisions = rectIntersection(args);
  if (rectCollisions.length > 0) return preferPoolReturn(rectCollisions);

  return preferPoolReturn(closestCorners(args));
};

/**
 * A fixed drop target that is reachable without scrolling. It lives inside
 * DndContext so dnd-kit can register and measure it, and it only becomes
 * visible while an item from a tier is being dragged.
 */
function PoolReturnDrop({ visible }: { visible: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: "pool-return",
    data: { containerId: "pool", type: "container" }
  });

  return (
    <div
      ref={setNodeRef}
      className={`pool-return${visible ? " is-visible" : ""}${isOver ? " is-over" : ""}`}
      aria-hidden={!visible}
      aria-label="Return dragged item to the item pool"
    >
      <span className="pool-return-arrow">↓</span>
      Drop here to return to the item pool
    </div>
  );
}

export function Board({ onAddImage }: BoardProps) {
  const title = useBoard((state) => state.title);
  const tiers = useBoard((state) => state.tiers);
  const pool = useBoard((state) => state.pool);
  const itemSize = useBoard((state) => state.itemSize);
  const boardStyle = useBoard((state) => state.boardStyle);
  const setTitle = useBoard((state) => state.setTitle);
  const moveItem = useBoard((state) => state.moveItem);
  const removeItem = useBoard((state) => state.removeItem);
  const renameTier = useBoard((state) => state.renameTier);
  const setTierColor = useBoard((state) => state.setTierColor);
  const addTier = useBoard((state) => state.addTier);
  const removeTier = useBoard((state) => state.removeTier);
  const clearPool = useBoard((state) => state.clearPool);

  const [activeItem, setActiveItem] = useState<TierItem | null>(null);
  const [activeContainer, setActiveContainer] = useState<string | null>(null);

  // The board is laid out at a fixed base size, then zoomed as one unit. This
  // keeps its width and height growing together instead of only getting taller.
  const boardScale = itemSize / BASE_ITEM_SIZE;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragStart(event: DragStartEvent) {
    const found = locateItem(useBoard.getState(), String(event.active.id));
    if (!found) return;
    setActiveItem(containerItems(useBoard.getState(), found.container)[found.index] ?? null);
    setActiveContainer(found.container);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveItem(null);
    setActiveContainer(null);
    if (!over) return;

    const state = useBoard.getState();
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const from = locateItem(state, activeId);
    if (!from) return;

    const to = resolveContainer(state, overId);
    if (!to) return;

    const overIndex =
      over.data.current?.sortable?.index ?? containerItems(state, to).length;
    state.moveItem(activeId, to, overIndex);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveItem(null);
        setActiveContainer(null);
      }}
    >
      <div
        className={`board style-${boardStyle}`}
        style={
          {
            "--item-size": `${BASE_ITEM_SIZE}px`,
            "--board-scale": boardScale
          } as CSSProperties
        }
        data-capture-surface="true"
      >
        <div className="board-heading">
          <input
            className="board-title-input"
            value={title}
            aria-label="Tier list title"
            spellCheck={false}
            onChange={(event) => setTitle(event.target.value)}
          />
          <span className="board-meta">
            {tiers.length} tiers · {tiers.reduce((sum, tier) => sum + tier.items.length, 0)} ranked
          </span>
        </div>

        <div className="tiers">
          {tiers.map((tier) => (
            <TierRow
              key={tier.id}
              tier={tier}
              canRemove={tiers.length > 1}
              onRename={renameTier}
              onColor={setTierColor}
              onRemoveTier={removeTier}
              onRemoveItem={removeItem}
            />
          ))}
        </div>

        <div className="board-footer">
          <button type="button" className="ghost-button" onClick={addTier}>
            + Add tier
          </button>
        </div>

        <Pool
          items={pool}
          onRemoveItem={removeItem}
          onAddImage={onAddImage}
          onClear={clearPool}
        />
      </div>

      <PoolReturnDrop
        visible={Boolean(activeItem && activeContainer !== "pool")}
      />

      <DragOverlay dropAnimation={null}>
        {activeItem ? (
          // The overlay lives outside the zoomed board, so give it the
          // already-scaled card size to match what the user is dragging.
          <div style={{ "--item-size": `${itemSize}px` } as CSSProperties}>
            <ItemCardPreview item={activeItem} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

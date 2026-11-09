import type { KitchenLine } from "@/lib/kitchen-ticket";
import { modifierEntries } from "@/lib/modifiers";

interface Props { item: KitchenLine }

/** Keep each choice beside its plate; parent extras only repeat the combo's price. */
export default function OrderLineAdditions({ item }: Props) {
  if (item.components?.length) return <>
    {item.components.map((part, index) => (
      <div key={index} className="tt-subline" style={{ fontSize: 12 }}>
        {part.qty}× {part.emoji} {part.name}
        {modifierEntries(part.mods).map(([group, choice]) => (
          <div key={group} className="tt-muted tt-subline">{group}: {choice}</div>
        ))}
        <OrderLineAdditions item={part} />
      </div>
    ))}
  </>;
  return item.extras?.length ? (
    <div className="tt-muted tt-subline" style={{ fontSize: 12 }}>
      + {item.extras.map(extra => extra.name).join(", ")}
    </div>
  ) : null;
}

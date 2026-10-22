import { isValidElement, type ReactNode } from "react";

interface TestProps {
  children?: ReactNode;
  disabled?: boolean;
  onChange?: (event: { target: { value: string | boolean; checked: string | boolean } }) => void;
  onSubmit?: (event: { preventDefault(): void }) => void;
  onClick?: () => void | Promise<void>;
  [key: string]: unknown;
}

interface Node {
  type: string;
  props: TestProps;
  children: Node[];
  text: string;
  disabled: boolean;
}

/** Runs real form handlers with hook state, without a browser or database. */
export function pendingHarness() {
  const slots = new Map<string, unknown[]>();
  let scope = "", index = 0, changed = false;
  let root: () => ReactNode;
  let tree: Node[] = [];
  const used = new Set<string>();
  function slot(initial: () => unknown): [unknown[], number] {
    const values = slots.get(scope) ?? [];
    slots.set(scope, values);
    const at = index++;
    if (!(at in values)) values[at] = initial();
    return [values, at];
  }
  function expand(value: ReactNode, path: string, disabled = false): Node[] {
    if (value == null || typeof value === "boolean") return [];
    if (Array.isArray(value)) return value.flatMap((v, i) => expand(v, `${path}.${i}`, disabled));
    if (!isValidElement<TestProps>(value)) return [{ type: "text", props: {}, children: [], text: String(value), disabled }];
    if (typeof value.type === "function") {
      scope = `${path}:${value.type.name}`; index = 0; used.add(scope);
      return expand((value.type as (p: object) => ReactNode)(value.props), `${path}.r`, disabled);
    }
    const off = disabled || Boolean(value.props.disabled);
    const children = expand(value.props.children, `${path}.c`, off);
    return [{ type: String(value.type), props: value.props, children, text: children.map(n => n.text).join(""), disabled: off }];
  }
  const api = {
    useState(initial: unknown) {
      const [values, at] = slot(() => typeof initial === "function" ? initial() : initial);
      return [values[at], (next: unknown) => {
        const v = typeof next === "function" ? next(values[at]) : next;
        if (!Object.is(v, values[at])) { values[at] = v; changed = true; }
      }];
    },
    useRef(initial: unknown) { const [values, at] = slot(() => ({ current: initial })); return values[at]; },
    render(next?: () => ReactNode) {
      if (next) root = next;
      let passes = 0;
      do {
        changed = false; used.clear(); scope = "root"; index = 0; used.add(scope);
        tree = expand(root(), "ui");
        if (++passes > 20) throw new Error("Render loop");
      } while (changed);
      for (const key of slots.keys()) if (!used.has(key)) slots.delete(key);
      return api;
    },
    all(type: string): Node[] {
      const walk = (nodes: Node[]): Node[] => nodes.flatMap(n => [n, ...walk(n.children)]);
      return walk(tree).filter(n => n.type === type);
    },
    text() { return tree.map(n => n.text).join(""); },
    change(node: Node, value: string | boolean) {
      if (!node.disabled) node.props.onChange!({ target: { value, checked: value } });
      api.render();
    },
    async submit() {
      api.all("form")[0].props.onSubmit!({ preventDefault() {} });
      await new Promise(resolve => setImmediate(resolve));
      api.render();
    },
  };
  return api;
}

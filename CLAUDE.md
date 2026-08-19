# TableTap — Coding Guide

Welcome! This is how we write code in TableTap. The goal is simple: **keep it
easy to read, easy to change, and safe to ship.** When two approaches work, pick
the simpler one.

## Golden rules

- **Simple beats clever.** Write the most straightforward code that solves the problem.
- **Small files.** Keep each file focused on one thing — aim for under ~200 lines. If it grows past that, split it.
- **Clear names.** Name things so the next person gets it without needing a comment.
- **Feature first, speed later.** Get it working, then optimize _only if it actually needs it_.
- **Check as you go.** Test after every meaningful change — don't pile up untested edits.
- **Let the types help.** Lean on TypeScript and the linter to catch mistakes before they run.
- **Think in components.** Build small, reusable pieces and compose them.

## File & folder naming

- **React component:** `<name>.tsx`
- **Test:** `<name>.spec.tsx`, inside a `__tests__/` folder
- **Storybook story:** inside a `__stories__/` folder

## Writing components

- Use **function components** with a typed props **interface**.
- One component, one job. If it's doing several things, split it.
- Pull shared or complex logic into **custom hooks**.
- Give props sensible **defaults** where it helps.
- Compose small components instead of building one giant one.

## Effects & lifecycle

- **Always clean up.** If an effect subscribes, opens, or starts something, return a cleanup function:

  ```tsx
  useEffect(() => {
    const sub = subscribe();
    return () => sub.unsubscribe(); // runs on unmount / before the next run
  }, [deps]);
  ```

- List **every value the effect uses** in its dependency array.
- **Don't nest** effects, and keep each side effect small and predictable.

## Performance — reach for these only when you see a real problem

- **Memoize the right things:**
  - `React.memo(Component)` — for a pure component that re-renders too often.
  - `useCallback(fn, [deps])` — for callbacks you pass down as props.
  - `useMemo(() => compute(), [deps])` — for genuinely expensive calculations.
- **Keep props and state stable** so children don't re-render for nothing; move fast-changing bits into their own small component.
- **Avoid defining functions inline in JSX** when it causes extra re-renders.
- **Lists:** use a **stable, unique key** — never the array index if items can reorder.
- **Big lists:** virtualize them (e.g. `react-window`).
- **Heavy work:** defer non-urgent updates with `useTransition` / `useDeferredValue`, and consider a **Web Worker** for CPU-heavy tasks.
- **Ship less JavaScript:** code-split with dynamic imports and `React.lazy` + `Suspense`, use the Next.js `<Image>` for images, import only what you use (helps tree-shaking), and check bundle size when it grows (e.g. a bundle analyzer).

## State

- **Local first:** `useState` for a component's own state.
- **Tangled logic:** `useReducer` when state transitions get complex.
- **Share carefully:** lift state up when siblings need it; use **Context** for cross-cutting state instead of drilling props through many layers.
- Batch related updates together and keep them synchronous where you can.

## Data fetching

- Use **SWR** or **React Query** for fetching and caching — don't hand-roll it.
- Use **optimistic updates** so the UI feels instant, then reconcile when the request returns.
- Cache and reuse results instead of recomputing.

## TypeScript

- **Strict mode is on** — rely on the settings in `tsconfig.json`, and use the module resolution Next.js expects.
- Define clear **interfaces** for props, state, and data. Prefer `interface` over `type` for objects (especially when extending).
- Handle `null` / `undefined` safely with **type guards**.
- Use **generics** for reusable, flexible code, and **utility types** (`Partial`, `Pick`, `Omit`) — plus **mapped types** for variations — instead of repeating yourself.
- In React, type your **props**, **event handlers**, **hooks** (`useState`, `useReducer`), and **context** properly. Give functions explicit return types. Use `as` assertions only as a last resort.

## Before shipping something large

Read `docs/regressions.md`. It is the list of bugs that have actually shipped
here, what now catches each one automatically, and the handful that still need
a person to look. Every one of them was two places that had to agree with
nothing checking that they did.

## When something breaks

- **Think before you fix:** list a few possible causes; don't grab the first one.
- **Explain it in plain English**, not jargon.
- **Change as few lines as possible** to fix it.
- For weird, unfamiliar errors, it's fine to **search the web** for up-to-date info.

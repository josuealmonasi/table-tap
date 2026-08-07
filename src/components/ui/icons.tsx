/**
 * Every icon the interface uses, in one place.
 *
 * Imported from `/dist/ssr` rather than the package root: those variants carry
 * no context provider and render on the server, which is what the App Router
 * needs. Importing from the root would pull the whole 1,200-icon barrel into
 * the client bundle.
 *
 * Re-exported through this file so the set is swappable in one edit rather
 * than forty, and so call sites read as TableTap's own vocabulary — `Icon.Bill`
 * says what it's for, `Receipt` only says what it looks like.
 *
 * The rule for what belongs here: **controls are icons, illustrations are
 * emoji.** Anything you press, toggle or that reports state gets a glyph that
 * inherits colour and weight. Dish emoji, restaurant logos and the big empty
 * -state pictures stay emoji — those are content the restaurant chooses, and a
 * line-art plate would be a downgrade.
 */
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { ArrowsLeftRight } from "@phosphor-icons/react/dist/ssr/ArrowsLeftRight";
import { Bell } from "@phosphor-icons/react/dist/ssr/Bell";
import { CaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CaretUp } from "@phosphor-icons/react/dist/ssr/CaretUp";
import { Chair } from "@phosphor-icons/react/dist/ssr/Chair";
import { Copy } from "@phosphor-icons/react/dist/ssr/Copy";
import { House } from "@phosphor-icons/react/dist/ssr/House";
import { LockSimple } from "@phosphor-icons/react/dist/ssr/LockSimple";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { PauseCircle } from "@phosphor-icons/react/dist/ssr/PauseCircle";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Receipt } from "@phosphor-icons/react/dist/ssr/Receipt";
import { SignOut } from "@phosphor-icons/react/dist/ssr/SignOut";
import { SlidersHorizontal } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
import { Star } from "@phosphor-icons/react/dist/ssr/Star";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { User } from "@phosphor-icons/react/dist/ssr/User";
import { X } from "@phosphor-icons/react/dist/ssr/X";

/**
 * Named for the job, not the picture. Swapping which glyph plays a role is
 * then a one-line change here and nothing moves at the call sites.
 */
export const Icon = {
  Search: MagnifyingGlass,
  Close: X,
  Filters: SlidersHorizontal,
  Back: ArrowLeft,
  Edit: PencilSimple,
  Delete: Trash,
  Duplicate: Copy,
  /** Move a product to a different menu or section. */
  MoveTo: ArrowsLeftRight,
  MoveUp: CaretUp,
  MoveDown: CaretDown,
  Expand: CaretDown,
  Dashboard: House,
  SignOut: SignOut,
  Account: User,
  CallWaiter: Bell,
  Bill: Receipt,
  Table: Chair,
  Secure: LockSimple,
  Paused: PauseCircle,
  Rating: Star,
} as const;

/**
 * Icon weight paired to the text it sits beside. Archivo carries hierarchy
 * through weight, and Phosphor ships the same idea, so an icon next to a bold
 * label shouldn't be drawn at body weight.
 */
export const ICON_WEIGHT = {
  /** Alongside 400–500 text: labels, descriptions, muted meta. */
  regular: "regular",
  /** Alongside 600–700 text: buttons, dish names, active states. */
  bold: "bold",
  /** Solid — for a selected star or an active state that must read as "on". */
  fill: "fill",
} as const;

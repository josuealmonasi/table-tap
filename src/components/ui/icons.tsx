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
import { CashRegister } from "@phosphor-icons/react/dist/ssr/CashRegister";
import { CreditCard } from "@phosphor-icons/react/dist/ssr/CreditCard";
import { ChartBar } from "@phosphor-icons/react/dist/ssr/ChartBar";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { CheckSquare } from "@phosphor-icons/react/dist/ssr/CheckSquare";
import { ChefHat } from "@phosphor-icons/react/dist/ssr/ChefHat";
import { ClipboardText } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { CookingPot } from "@phosphor-icons/react/dist/ssr/CookingPot";
import { Crown } from "@phosphor-icons/react/dist/ssr/Crown";
import { DownloadSimple } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { ForkKnife } from "@phosphor-icons/react/dist/ssr/ForkKnife";
import { Gear } from "@phosphor-icons/react/dist/ssr/Gear";
import { Gift } from "@phosphor-icons/react/dist/ssr/Gift";
import { Lightbulb } from "@phosphor-icons/react/dist/ssr/Lightbulb";
import { NotePencil } from "@phosphor-icons/react/dist/ssr/NotePencil";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr/PaperPlaneTilt";
import { Minus } from "@phosphor-icons/react/dist/ssr/Minus";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { Printer } from "@phosphor-icons/react/dist/ssr/Printer";
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr/ShieldCheck";
import { Ticket } from "@phosphor-icons/react/dist/ssr/Ticket";
import { Tray } from "@phosphor-icons/react/dist/ssr/Tray";
import { UserGear } from "@phosphor-icons/react/dist/ssr/UserGear";
import { Users } from "@phosphor-icons/react/dist/ssr/Users";
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
import { Warning } from "@phosphor-icons/react/dist/ssr/Warning";
import { Clock } from "@phosphor-icons/react/dist/ssr/Clock";

/**
 * Named for the job, not the picture — swapping which glyph plays a role is a
 * one-line change here and nothing moves at the call sites.
 *
 * Exported one const at a time rather than as a single `Icon` object: an
 * object is one binding, so importing it pulls every glyph in this file into
 * the route whether or not it's used. That cost 27 kB on the customer bundle
 * for eight icons.
 */
export const SearchIcon = MagnifyingGlass;
export const CloseIcon = X;
export const FiltersIcon = SlidersHorizontal;
export const BackIcon = ArrowLeft;
export const EditIcon = PencilSimple;
export const DeleteIcon = Trash;
export const ScheduleIcon = Clock;
export const WarningIcon = Warning;
export const DuplicateIcon = Copy;
export const MoveToIcon = ArrowsLeftRight;
export const MoveUpIcon = CaretUp;
export const MoveDownIcon = CaretDown;
export const ExpandIcon = CaretDown;
export const DashboardIcon = House;
export const SignOutIcon = SignOut;
export const AccountIcon = User;
export const CallWaiterIcon = Bell;
/** The nav's bell. Same shape as the diner's, because it means the same thing. */
export const NotificationsIcon = Bell;
export const BillIcon = Receipt;
export const TableIcon = Chair;
export const SecureIcon = LockSimple;
export const PausedIcon = PauseCircle;
export const RatingIcon = Star;
export const OrdersIcon = ClipboardText;
export const AnalyticsIcon = ChartBar;
export const PromotionsIcon = Gift;
export const StaffIcon = Users;
export const SettingsIcon = Gear;
export const PlanIcon = CreditCard;
export const PlatformAdminIcon = ShieldCheck;
export const RoleOwnerIcon = Crown;
export const RoleManagerIcon = UserGear;
export const RoleWaiterIcon = ForkKnife;
/** The till: whoever collects, which is not whoever carries the plate. */
export const RoleCashierIcon = CashRegister;
/** The menus screen — the list of what the kitchen serves. */
export const MenuIcon = ForkKnife;
export const RoleKitchenIcon = ChefHat;
export const StatusReceivedIcon = ClipboardText;
export const StatusPreparingIcon = CookingPot;
export const StatusReadyIcon = ForkKnife;
export const HintIcon = Lightbulb;
export const CouponIcon = Ticket;
export const CheckIcon = Check;
export const SelectIcon = CheckSquare;
export const NoteIcon = NotePencil;
export const AddIcon = Plus;
export const RemoveIcon = Minus;
export const DownloadIcon = DownloadSimple;
export const PrintIcon = Printer;
export const InviteIcon = PaperPlaneTilt;
export const EmptyIcon = Tray;

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

/**
 * The dashboard nav resolves its glyph from a key held in plain data
 * (src/lib/nav.ts), so it needs a lookup rather than a direct import. Kept to
 * the seven nav glyphs so importing it doesn't drag the whole set in — only
 * dashboard routes touch this.
 */
export const NAV_ICONS = {
  Menu: MenuIcon,
  Orders: OrdersIcon,
  Analytics: AnalyticsIcon,
  Promotions: PromotionsIcon,
  Table: TableIcon,
  Bills: BillIcon,
  Staff: StaffIcon,
  Settings: SettingsIcon,
  Plan: PlanIcon,
  PlatformAdmin: PlatformAdminIcon,
} as const;

// ============================================================================
// One case per endpoint: the request that SHOULD work.
//
// `pnpm rls` tests who gets refused and `invariants` that a guard exists.
// Neither tests that a legitimate request does its job, and that is the gap the
// bugs the user found before we did came through.
//
// `expect` is the state considered healthy. Several endpoints depend on Stripe,
// and with no connected account their correct answer is a specific refusal
// (409, 400) — that is working. What is never right is a 500.
// ============================================================================
import { adminOpeningCases, adminOwnerCases } from "./api-cases/admin.mjs";
import { menuCopyCases, productCases, couponValidationCases, menuSettingsCases, promotionCleanupCases } from "./api-cases/menu.mjs";
import { membershipCases } from "./api-cases/membership.mjs";
import { posRefusalCases, posRoleCases, posSaleCases } from "./api-cases/pos.mjs";
import { refundListCases, refundDueCases, orderRefundCases } from "./api-cases/refunds.mjs";
import { dinerCases } from "./api-cases/diner.mjs";
import { loyaltyCases } from "./api-cases/loyalty.mjs";
import { splitsCases } from "./api-cases/splits.mjs";
import { checkoutCardCases, checkoutCounterCases, checkoutPlanCases, billPayCases } from "./api-cases/checkout.mjs";
import { cashCases } from "./api-cases/cash.mjs";
import { ingredientsCases } from "./api-cases/ingredients.mjs";
import { inventoryCases } from "./api-cases/inventory.mjs";
import { notificationsCases } from "./api-cases/notifications.mjs";
import { orderBoardCases, tableOrderCases } from "./api-cases/orders.mjs";
import { paymentCounterCases, billCollectionCases } from "./api-cases/payments.mjs";
import { accountsCases } from "./api-cases/accounts.mjs";
import { printerDeliveryCases, orderPrintCases } from "./api-cases/printing.mjs";
import { staffCases } from "./api-cases/staff.mjs";
import { webhooksCases } from "./api-cases/webhooks.mjs";
import { signupCases } from "./api-cases/signup.mjs";
import { retriesCases } from "./api-cases/retries.mjs";

export function cases(fx) {
  return [
    ...adminOpeningCases(fx),
    ...menuCopyCases(fx),
    ...membershipCases(fx),
    ...productCases(fx),
    ...posRefusalCases(fx),
    ...refundListCases(fx),
    ...dinerCases(fx),
    ...couponValidationCases(fx),
    ...loyaltyCases(fx),
    ...splitsCases(fx),
    ...checkoutCardCases(fx),
    ...cashCases(fx),
    ...ingredientsCases(fx),
    ...inventoryCases(fx),
    ...refundDueCases(fx),
    ...checkoutCounterCases(fx),
    ...notificationsCases(fx),
    ...orderBoardCases(fx),
    ...paymentCounterCases(fx),
    ...posRoleCases(fx),
    ...accountsCases(fx),
    ...checkoutPlanCases(fx),
    ...posSaleCases(fx),
    ...printerDeliveryCases(fx),
    ...tableOrderCases(fx),
    ...orderPrintCases(fx),
    ...menuSettingsCases(fx),
    ...billCollectionCases(fx),
    ...orderRefundCases(fx),
    ...billPayCases(fx),
    ...promotionCleanupCases(fx),
    ...staffCases(fx),
    ...webhooksCases(fx),
    ...adminOwnerCases(fx),
    ...signupCases(fx),
    ...retriesCases(fx),
  ];
}

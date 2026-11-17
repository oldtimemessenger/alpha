import test from "node:test";
import assert from "node:assert/strict";
import { unreadNotificationCount, notificationBadgeMarkup } from "./notification-badge.js";

test("notification counts exclude read activity and other accounts", () => {
  assert.equal(unreadNotificationCount(
    [{user:"me",read:false},{user:"me",read:true},{user:"other",read:false}],
    [{to:"me"},{to:"other"}], [{to:"me"}], "me",
  ), 3);
  assert.equal(unreadNotificationCount([], [], [], undefined), 0);
});
test("badge is absent at zero and caps only the visible count", () => {
  assert.equal(notificationBadgeMarkup(0), "");
  assert.match(notificationBadgeMarkup(9), />9<\/span>/);
  assert.match(notificationBadgeMarkup(99), />99<\/span>/);
  assert.match(notificationBadgeMarkup(105), /105 unread notifications/);
  assert.match(notificationBadgeMarkup(105), />99\+<\/span>/);
});

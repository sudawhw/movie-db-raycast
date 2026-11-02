import { test } from "node:test";
import assert from "node:assert/strict";
import { translate } from "../src/i18n.ts";
test("English and Chinese UI labels are selectable", () => {
  assert.equal(translate("搜索网盘资源", "en"), "Search cloud shares");
  assert.equal(translate("搜索网盘资源", "zh"), "搜索网盘资源");
  assert.equal(translate("仅片名匹配", "en"), "Title Matches");
});

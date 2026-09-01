import assert from "node:assert/strict";
import test from "node:test";

import { installLocationView } from "../src/components/installLocation.ts";

const gigabyte = 1024 ** 3;

function location(overrides = {}) {
  return {
    target: "runtime",
    directory: "C:\\Users\\me\\AppData\\Roaming\\Finoka\\finesub",
    default: "C:\\Users\\me\\AppData\\Roaming\\Finoka\\finesub",
    custom: false,
    missing: false,
    bytes: 0,
    files: 0,
    freeBytes: 120 * gigabyte,
    volume: "C:",
    estimated: 16 * gigabyte,
    empty: true,
    enoughSpace: true,
    ...overrides,
  };
}

test("a fresh install on a roomy system drive still gets the size warning", () => {
  const view = installLocationView(location(), false);
  assert.equal(view.prompt, true, "the first big download must stop to offer a location");
  assert.equal(view.visible, true);
  assert.equal(view.tight, false);
  assert.equal(view.settled, false);
});

test("a drive that cannot hold the runtime turns the card into a warning", () => {
  const view = installLocationView(location({ freeBytes: 4 * gigabyte, enoughSpace: false }), false);
  assert.equal(view.tight, true);
  assert.equal(view.prompt, true);
  assert.equal(view.settled, false);
});

test("an installed runtime never interrupts an install", () => {
  // 装完之后改位置要跨盘搬十几 GB，那是设置页的事，不该在这里顺手提议。
  const view = installLocationView(location({ empty: false, bytes: 15 * gigabyte, files: 40000 }), false);
  assert.equal(view.prompt, false);
  assert.equal(view.visible, false);
});

test("a location the user already picked is left alone", () => {
  const view = installLocationView(location({ custom: true, directory: "D:\\Finoka\\finesub" }), false);
  assert.equal(view.prompt, false, "asking again after the user already chose is nagging");
  assert.equal(view.visible, false);
});

test("a chosen location on a drive that is now too small asks again", () => {
  const view = installLocationView(location({ custom: true, enoughSpace: false }), false);
  assert.equal(view.prompt, true);
  assert.equal(view.tight, true);
});

test("the card survives the moment choosing a location satisfies the prompt", () => {
  // 这是回归点：用户点了安装 → 卡片弹出 → 选了 D 盘 → custom 变真、prompt 变假。
  // 如果卡片跟着消失，刚才那次点击对应的「开始安装」就凭空没了。
  const before = installLocationView(location(), true);
  assert.equal(before.visible, true);
  assert.equal(before.settled, false);

  const after = installLocationView(location({ custom: true, directory: "D:\\Finoka\\finesub" }), true);
  assert.equal(after.prompt, false, "the prompt condition is expected to lapse here");
  assert.equal(after.visible, true, "the pending install still needs its start button");
  assert.equal(after.settled, true, "and the card should now read as ready rather than as a warning");
});

test("dismissing the pending install closes the card once the location is settled", () => {
  const view = installLocationView(location({ custom: true }), false);
  assert.equal(view.visible, false);
});

test("no storage status yet means no card and no interception", () => {
  for (const value of [null, undefined]) {
    const view = installLocationView(value, true);
    assert.equal(view.visible, false);
    assert.equal(view.prompt, false);
  }
});

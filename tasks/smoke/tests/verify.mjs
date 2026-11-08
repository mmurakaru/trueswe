import assert from "node:assert/strict";
import { add } from "/app/add.mjs";

assert.equal(add(2, 3), 5);
assert.equal(add(-7, 2), -5);
assert.equal(add(0, 0), 0);
assert.equal(add(0.5, 1.25), 1.75);

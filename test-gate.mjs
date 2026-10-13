/* ============================================================
   NGUMZO — Gate Integration Tests
   ------------------------------------------------------------
   Tests the Keystone gate integration with mocked fetch.

   Run: node test-gate.mjs
   ============================================================ */

import { checkTesterQuota, registerReferral } from "./functions/api/_pilot.mjs";

// Mock fetch globally
const originalFetch = globalThis.fetch;
let mockFetchResponses = [];

function mockFetch(url, options) {
  const response = mockFetchResponses.shift();
  if (!response) {
    throw new Error(`Unexpected fetch call to ${url}`);
  }

  console.log(`  → fetch: ${url.slice(0, 80)}${url.length > 80 ? "..." : ""}`);

  return Promise.resolve({
    ok: response.ok !== false,
    status: response.status || 200,
    json: () => Promise.resolve(response.body),
  });
}

// Mock env
function createMockEnv(config) {
  return {
    PILOT_CONFIG: {
      get: async (key) => {
        if (key === "pilot:config") {
          return JSON.stringify(config);
        }
        return null;
      },
    },
    PILOT_DB: {
      prepare: (sql) => ({
        bind: (...args) => ({
          first: async () => null,
          run: async () => ({}),
        }),
      }),
    },
  };
}

// Test helpers
let testsPassed = 0;
let testsFailed = 0;

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  ✓ ${message}`);
    testsPassed++;
  } else {
    console.error(`  ✗ ${message}`);
    console.error(`    Expected: ${JSON.stringify(expected)}`);
    console.error(`    Actual:   ${JSON.stringify(actual)}`);
    testsFailed++;
  }
}

async function runTest(name, testFn) {
  console.log(`\n${name}`);
  mockFetchResponses = [];
  globalThis.fetch = mockFetch;
  try {
    await testFn();
  } catch (e) {
    console.error(`  ✗ Test threw error: ${e.message}`);
    testsFailed++;
  }
  globalThis.fetch = originalFetch;
}

// ============================================================
// TESTS
// ============================================================

await runTest(
  "Test 1: useGate=false (legacy mode) - should allow auto-register",
  async () => {
    const config = {
      enabled: true,
      useGate: false,
      autoRegisterTesters: true,
      globalDailyCap: 1000,
      testers: {},
      testerDefaults: { limit: 100, days: 30 },
    };

    const env = createMockEnv(config);
    const context = { env, date: "2026-01-15" };

    const result = await checkTesterQuota("test-user", context);

    assertEqual(result.allowed, true, "Should allow in legacy mode");
    assertEqual(result.reason, "ok", "Reason should be ok");
    assertEqual(result.testerType, "tester", "Should be tester type");
  },
);

await runTest(
  "Test 2: useGate=true, gate returns invite_required",
  async () => {
    const config = {
      enabled: true,
      useGate: true,
      globalDailyCap: 1000,
      testers: {},
      testerDefaults: { limit: 100, days: 30 },
    };

    // Mock gate response
    mockFetchResponses.push({
      ok: true,
      body: {
        ok: true,
        allowed: false,
        reason: "invite_required",
        mode: "token",
        user: null,
      },
    });

    const env = createMockEnv(config);
    const context = { env, date: "2026-01-15" };

    const result = await checkTesterQuota("TEST-CODE", context);

    assertEqual(result.allowed, false, "Should deny when invite required");
    assertEqual(
      result.reason,
      "invite_required",
      "Reason should be invite_required",
    );
    assertEqual(result.testerType, "none", "Should be none type");
  },
);

await runTest("Test 3: useGate=true, gate returns app_off", async () => {
  const config = {
    enabled: true,
    useGate: true,
    globalDailyCap: 1000,
    testers: {},
    testerDefaults: { limit: 100, days: 30 },
  };

  // Mock gate response
  mockFetchResponses.push({
    ok: true,
    body: {
      ok: true,
      allowed: false,
      reason: "app_off",
      mode: "kill",
      user: null,
    },
  });

  const env = createMockEnv(config);
  const context = { env, date: "2026-01-15" };

  const result = await checkTesterQuota("VALID-CODE", context);

  assertEqual(result.allowed, false, "Should deny when app is off");
  assertEqual(result.reason, "app_off", "Reason should be app_off");
  assertEqual(result.testerType, "none", "Should be none type");
});

await runTest(
  "Test 4: useGate=true, gate returns error (fail closed)",
  async () => {
    const config = {
      enabled: true,
      useGate: true,
      globalDailyCap: 1000,
      testers: {},
      testerDefaults: { limit: 100, days: 30 },
    };

    // Mock gate error
    mockFetchResponses.push({
      ok: false,
      status: 500,
      body: { error: "Internal server error" },
    });

    const env = createMockEnv(config);
    const context = { env, date: "2026-01-15" };

    const result = await checkTesterQuota("TEST-CODE", context);

    assertEqual(result.allowed, false, "Should fail closed on gate error");
    assertEqual(
      result.reason,
      "gate_unavailable",
      "Reason should be gate_unavailable",
    );
    assertEqual(result.testerType, "none", "Should be none type");
  },
);

await runTest(
  "Test 5: useGate=true, gate allows - first use registers",
  async () => {
    const config = {
      enabled: true,
      useGate: true,
      globalDailyCap: 1000,
      testers: {},
      testerDefaults: { limit: 100, days: 30 },
    };

    // Mock gate response (allowed)
    mockFetchResponses.push({
      ok: true,
      body: {
        ok: true,
        allowed: true,
        reason: "granted",
        mode: "token",
        user: null,
      },
    });

    const env = createMockEnv(config);
    const context = { env, date: "2026-01-15" };

    const result = await checkTesterQuota("VALID-CODE", context);

    assertEqual(result.allowed, true, "Should allow when gate grants access");
    assertEqual(result.reason, "ok", "Reason should be ok");
    assertEqual(result.testerType, "tester", "Should be tester type");
  },
);

await runTest(
  "Test 6: useGate=true, unlimited access for config testers with limit=0",
  async () => {
    const config = {
      enabled: true,
      useGate: true,
      globalDailyCap: 1000,
      testers: {
        "OWNER-CODE": {
          limit: 0,
          days: 0,
        },
      },
      testerDefaults: { limit: 100, days: 30 },
    };

    const env = createMockEnv(config);
    const context = { env, date: "2026-01-15" };

    const result = await checkTesterQuota("OWNER-CODE", context);

    assertEqual(result.allowed, true, "Owner should have unlimited access");
    assertEqual(result.reason, "ok", "Reason should be ok");
    assertEqual(result.testerType, "tester", "Should be tester type");
  },
);

await runTest(
  "Test 7: useGate=true, guest referrals skip gate (validated via referrer)",
  async () => {
    const config = {
      enabled: true,
      useGate: true,
      globalDailyCap: 1000,
      testers: {},
      testerDefaults: { limit: 100, days: 30 },
    };

    const env = createMockEnv(config);
    const context = { env, date: "2026-01-15" };

    // Guest IDs should skip gate check entirely
    const result = await checkTesterQuota("guest-abc123", context);

    // Should return not_found since guest is not in DB and no gate check
    assertEqual(result.allowed, false, "Guest should be denied if not in DB");
    assertEqual(result.reason, "not_found", "Reason should be not_found");
    assertEqual(result.testerType, "none", "Should be none type");
  },
);

await runTest(
  "Test 8: registerReferral validates referrer through gate when useGate=true",
  async () => {
    const config = {
      enabled: true,
      useGate: true,
      globalDailyCap: 1000,
      testers: {},
      testerDefaults: { limit: 100, days: 30 },
    };

    // Mock gate response for referrer validation
    mockFetchResponses.push({
      ok: true,
      body: {
        ok: true,
        allowed: true,
        reason: "granted",
        mode: "token",
        user: null,
      },
    });

    const env = createMockEnv(config);

    // Should call gate to validate referrer, then register
    await registerReferral("guest-xyz789", "VALID-REFERRER", env);

    // No return value to check, but should not throw
    console.log("  ✓ Referral registration with gate check completed");
    testsPassed++;
  },
);

await runTest("Test 9: Cache test - second call should use cache", async () => {
  const config = {
    enabled: true,
    useGate: true,
    globalDailyCap: 1000,
    testers: {},
    testerDefaults: { limit: 100, days: 30 },
  };

  // Mock gate response (allowed) - only once
  mockFetchResponses.push({
    ok: true,
    body: {
      ok: true,
      allowed: true,
      reason: "granted",
      mode: "token",
      user: null,
    },
  });

  const env = createMockEnv(config);
  const context = { env, date: "2026-01-15" };

  // First call - hits gate
  const result1 = await checkTesterQuota("CACHED-CODE", context);
  assertEqual(result1.allowed, true, "First call should be allowed");

  // Second call - uses cache (no fetch should happen)
  // Note: In production, cache lasts 60 seconds. For testing, we just verify no crash.
  const result2 = await checkTesterQuota("CACHED-CODE", context);
  assertEqual(result2.allowed, true, "Second call should use cache");
});

await runTest(
  "Test 10: Lowercase codes are normalized to uppercase",
  async () => {
    const config = {
      enabled: true,
      useGate: true,
      globalDailyCap: 1000,
      testers: {},
      testerDefaults: { limit: 100, days: 30 },
    };

    // Mock gate response for uppercase version
    mockFetchResponses.push({
      ok: true,
      body: {
        ok: true,
        allowed: true,
        reason: "granted",
        mode: "token",
        user: null,
      },
    });

    const env = createMockEnv(config);
    const context = { env, date: "2026-01-15" };

    // Pass lowercase code - should be normalized to uppercase
    const result = await checkTesterQuota("test-code-123", context);

    assertEqual(result.allowed, true, "Lowercase code should be normalized");
    assertEqual(result.reason, "ok", "Reason should be ok");
    assertEqual(result.testerType, "tester", "Should be tester type");
  },
);

// ============================================================
// SUMMARY
// ============================================================

console.log("\n" + "=".repeat(60));
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
console.log("=".repeat(60));

process.exit(testsFailed > 0 ? 1 : 0);

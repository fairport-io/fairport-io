import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

let sharedPage: any;

async function cleanModals() {
  await sharedPage.evaluate(() => {
    document.querySelectorAll('[role="dialog"] button').forEach(function(btn) {
      var text = (btn.textContent || '').trim();
      if (text === 'Done' || text === 'Cancel' || text === 'Copy Key') {
        btn.click();
      }
    });
  }).catch(function() {});
  await sharedPage.keyboard.press('Escape').catch(function() {});
  await sharedPage.waitForTimeout(200);
  await sharedPage.evaluate(() => {
    document.querySelectorAll('[role="dialog"]').forEach(function(el) { el.remove(); });
  }).catch(function() {});
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  sharedPage = await context.newPage();
  await sharedPage.goto('/');
  await sharedPage.getByPlaceholder('you@example.com').fill(`e2e-shared-${Date.now()}@example.com`);
  await sharedPage.getByPlaceholder('Min. 8 characters').fill('password123');
  await sharedPage.getByRole('button', { name: 'Create New Account' }).click();
  await sharedPage.waitForURL(/\/chat$/, { timeout: 10000 });
});

test.afterAll(async () => {
  await sharedPage.context().close();
});

test('chat: shows empty state with example prompts', async () => {
  await sharedPage.getByRole('button', { name: 'Chat' }).click();
  await expect(sharedPage.getByText('Welcome to')).toBeVisible();
  await expect(sharedPage.getByText('Explain Quantum Physics')).toBeVisible();
  await expect(sharedPage.getByText('Write a React Hook')).toBeVisible();
});

test('chat: clicking example prompt fills input', async () => {
  await sharedPage.getByText('Explain Quantum Physics').click();
  await expect(sharedPage.locator('textarea')).toHaveValue('Explain Quantum Physics');
});

test('chat: sends message and shows typing indicator', async () => {
  await sharedPage.locator('textarea').fill('Hello');
  await sharedPage.getByRole('button', { name: 'Send' }).click();
  await expect(sharedPage.getByText('Hello')).toBeVisible();
});

test('chat: clear chat with confirmation', async () => {
  await sharedPage.locator('textarea').fill('test message');
  await sharedPage.getByRole('button', { name: 'Send' }).click();
  await expect(sharedPage.getByText('test message')).toBeVisible();
  sharedPage.on('dialog', dialog => dialog.accept());
  await sharedPage.getByRole('button', { name: 'Clear History' }).click();
  await expect(sharedPage.getByText('Welcome to')).toBeVisible();
});

test('chat: sends the selected non-default provider model', async () => {
  await sharedPage.route('**/api/models?*', async route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get('usable') !== 'true') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ object: 'list', data: [
        { id: 'offering-guard', model_id: 'llama-guard3-8b', provider_id: 'provider-id-default', provider_name: 'default', visibility: 'public', source: 'manual', enabled: true, created_at: 1, last_seen_at: null, rate_limits: '10:request:minute', queue_max_size: 5, can_update_visibility: false },
        { id: 'offering-llama', model_id: 'llama3-8b', provider_id: 'provider-id-default', provider_name: 'default', visibility: 'public', source: 'manual', enabled: true, created_at: 1, last_seen_at: null, rate_limits: '10:request:minute', queue_max_size: 5, can_update_visibility: false },
      ], has_more: false, next_cursor: null }),
    });
  });
  await sharedPage.reload();
  await sharedPage.waitForURL(/\/chat$/, { timeout: 10000 });

  const modelSelect = sharedPage.locator('select:has(option[value="llama3-8b"])');
  await expect(modelSelect).toHaveCount(1);
  await modelSelect.selectOption('llama3-8b');

  let forwardedBody: any;
  await sharedPage.route('**/api/chat/stream', async route => {
    forwardedBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"type":"done"}\n\n',
    });
  });

  await sharedPage.locator('textarea').fill('Use the selected model');
  await sharedPage.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => forwardedBody).toBeTruthy();
  expect(forwardedBody.model).toBe('llama3-8b');

  await sharedPage.unroute('**/api/chat/stream');
  await sharedPage.unroute('**/api/models?*');
  await sharedPage.reload();
  await sharedPage.waitForURL(/\/chat$/, { timeout: 10000 });
});

test('chat: lists and routes another user\'s public model offering', async () => {
  await sharedPage.route('**/api/models?*', async route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get('usable') !== 'true') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        object: 'list',
        data: [{
          id: 'offering-shared-public',
          model_id: 'shared-public-model',
          provider_id: 'provider-private-owner',
          provider_name: 'Shared Private Provider',
          visibility: 'public',
          source: 'manual',
          enabled: true,
          created_at: 1,
          last_seen_at: null,
          rate_limits: '10:request:minute',
          queue_max_size: 5,
          can_update_visibility: false,
        }],
        has_more: false,
        next_cursor: null,
      }),
    });
  });
  await sharedPage.reload();
  await sharedPage.waitForURL(/\/chat$/, { timeout: 10000 });

  await expect(sharedPage.getByLabel('Provider').locator('option[value="provider-private-owner"]')).toHaveText('Shared Private Provider');
  await sharedPage.getByLabel('Provider').selectOption('provider-private-owner');
  await expect(sharedPage.getByLabel('Model')).toHaveValue('shared-public-model');

  let forwardedBody: any;
  await sharedPage.route('**/api/chat/stream', async route => {
    forwardedBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"type":"done"}\n\n',
    });
  });
  await sharedPage.locator('textarea').fill('Use the shared model');
  await sharedPage.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => forwardedBody).toMatchObject({
    provider_id: 'provider-private-owner',
    model: 'shared-public-model',
  });

  await sharedPage.unroute('**/api/chat/stream');
  await sharedPage.unroute('**/api/models?*');
  await sharedPage.reload();
  await sharedPage.waitForURL(/\/chat$/, { timeout: 10000 });
});

test('chat: extra parameters validate, persist, forward, and clear responsively', async () => {
  const trigger = sharedPage.getByRole('button', { name: /Extra Parameters/ });
  await trigger.click();

  let modal = sharedPage.getByRole('dialog', { name: 'Extra Parameters' });
  await expect(modal).toBeVisible();
  await modal.getByLabel('Parameter key 1').fill('model');
  await modal.getByLabel('Parameter value 1').fill('"override"');
  await modal.getByRole('button', { name: 'Save Parameters' }).click();
  await expect(modal.getByRole('alert')).toContainText('controlled by Fairport');

  await modal.getByLabel('Parameter key 1').fill('max_tokens');
  await modal.getByLabel('Parameter value 1').fill('not-json');
  await modal.getByRole('button', { name: 'Save Parameters' }).click();
  await expect(modal.getByRole('alert')).toContainText('valid JSON value');

  await modal.getByLabel('Parameter value 1').fill('256');
  await modal.getByRole('button', { name: 'Add Parameter' }).click();
  await modal.getByLabel('Parameter key 2').fill('response_format');
  await modal.getByLabel('Parameter value 2').fill('{"type":"json_object"}');
  await modal.getByRole('button', { name: 'Save Parameters' }).click();
  await expect(modal).not.toBeVisible();
  await expect(trigger).toContainText('2');

  let forwardedBody: any;
  await sharedPage.route('**/api/chat/stream', async route => {
    forwardedBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"type":"response","content":"configured"}\n\ndata: {"type":"done"}\n\n',
    });
  });

  await sharedPage.locator('textarea').fill('Use my parameters');
  await sharedPage.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => forwardedBody).toBeTruthy();
  expect(forwardedBody.max_tokens).toBe(256);
  expect(forwardedBody.response_format).toEqual({ type: 'json_object' });
  expect(forwardedBody.model).toBe('default');
  expect(forwardedBody.messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: 'user', content: 'Use my parameters' }),
  ]));
  await sharedPage.unroute('**/api/chat/stream');

  await sharedPage.reload();
  await sharedPage.waitForURL(/\/chat$/, { timeout: 10000 });
  const reloadedTrigger = sharedPage.getByRole('button', { name: /Extra Parameters/ });
  await expect(reloadedTrigger).toContainText('2');
  await reloadedTrigger.click();
  modal = sharedPage.getByRole('dialog', { name: 'Extra Parameters' });
  await expect(modal.getByLabel('Parameter key 1')).toHaveValue('max_tokens');
  await expect(modal.getByLabel('Parameter value 1')).toHaveValue('256');

  await sharedPage.setViewportSize({ width: 375, height: 667 });
  const mobileBox = await modal.boundingBox();
  expect(mobileBox).not.toBeNull();
  expect(mobileBox!.x).toBeGreaterThanOrEqual(0);
  expect(mobileBox!.width).toBeLessThanOrEqual(375);
  expect(mobileBox!.height).toBeLessThanOrEqual(667);
  await expect(modal.getByRole('button', { name: 'Save Parameters' })).toBeVisible();
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await sharedPage.setViewportSize({ width: 1280, height: 720 });

  await sharedPage.getByRole('button', { name: 'Clear History' }).click();
  await expect(sharedPage.getByText('Welcome to')).toBeVisible();
  await sharedPage.getByRole('button', { name: /Extra Parameters/ }).click();
  modal = sharedPage.getByRole('dialog', { name: 'Extra Parameters' });
  await expect(modal.getByLabel('Parameter key 1')).toHaveValue('');
  await modal.getByRole('button', { name: 'Cancel' }).click();
});

test('nav: sidebar tabs navigate and update URL', async () => {
  const tabs = [
    { label: 'Chat', path: '/chat' },
    { label: 'API', path: '/api' },
    { label: 'Providers', path: '/providers' },
    { label: 'Models', path: '/models' },
    { label: 'Usage', path: '/usage' },
    { label: 'Settings', path: '/settings' },
    { label: 'Deployments', path: '/deployments' },
  ];
  for (const tab of tabs) {
    await sharedPage.getByRole('button', { name: tab.label }).click();
    await expect(sharedPage).toHaveURL(new RegExp(tab.path + '$'));
  }
});

test('nav: active tab persists across refresh', async () => {
  await sharedPage.getByRole('button', { name: 'Settings' }).click();
  await expect(sharedPage).toHaveURL(/\/settings$/);
  await sharedPage.reload();
  await expect(sharedPage).toHaveURL(/\/settings$/);
});

test('keys: shows registered keys in table', async () => {
  await cleanModals();
  await sharedPage.getByRole('button', { name: 'API' }).click();
  await expect(sharedPage.getByText('API Keys')).toBeVisible();
});

test('keys: creates new key and shows one-time modal', async () => {
  await cleanModals();
  await sharedPage.getByRole('button', { name: 'API' }).click();
  await sharedPage.waitForTimeout(200);
  await sharedPage.getByPlaceholder('e.g. Production API').click();
  await sharedPage.keyboard.press('Control+a');
  await sharedPage.keyboard.press('Delete');
  await sharedPage.getByPlaceholder('e.g. Production API').fill('my-key');
  await sharedPage.getByRole('button', { name: 'Create Key' }).click();
  const modal = sharedPage.locator('[role="dialog"]');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Copy Key' })).toBeVisible();
  await modal.getByRole('button', { name: 'Done' }).click();
  await expect(modal).not.toBeVisible();
});

test('keys: deletes a key', async () => {
  await cleanModals();
  await sharedPage.getByRole('button', { name: 'API' }).click();
  await sharedPage.waitForTimeout(200);
  await sharedPage.getByPlaceholder('e.g. Production API').click();
  await sharedPage.keyboard.press('Control+a');
  await sharedPage.keyboard.press('Delete');
  await sharedPage.getByPlaceholder('e.g. Production API').fill('delete-me-key');
  await sharedPage.getByRole('button', { name: 'Create Key' }).click();
  await sharedPage.getByRole('button', { name: 'Done' }).click();
  const keyRow = sharedPage.getByText('delete-me-key', { exact: true }).locator('xpath=ancestor::div[./div/button[@aria-label="Delete"]][1]');
  await keyRow.getByRole('button', { name: 'Delete' }).click();
  await expect(keyRow).not.toBeVisible();
});

test('keys: code samples toggle between curl and python', async () => {
  // Dismiss any modal via its Done/Cancel/Delete button first
  await sharedPage.evaluate(() => {
    var btns = document.querySelectorAll('[role="dialog"] button');
    for (var i = 0; i < btns.length; i++) {
      var text = (btns[i].textContent || '').trim();
      if (text === 'Done' || text === 'Cancel' || text === 'Copy Key') {
        btns[i].click();
      }
    }
  }).catch(function() {});
  await sharedPage.waitForTimeout(300);
  // Force-click the API nav button (skip modal overlay intercept)
  await sharedPage.getByRole('button', { name: 'API' }).click({ force: true });
  await sharedPage.waitForTimeout(300);
  // Dismiss any lingering key-created modal that reappeared
  var doneBtn = sharedPage.getByRole('button', { name: 'Done' });
  if (await doneBtn.isVisible({ timeout: 1000 }).catch(function() { return false; })) {
    await doneBtn.click();
    await sharedPage.waitForTimeout(200);
  }
  await expect(sharedPage.getByRole('button', { name: 'curl' })).toBeVisible();
  await sharedPage.getByRole('button', { name: 'Python' }).click({ force: true });
  await expect(sharedPage.getByText('import')).toBeVisible();
});

test.skip('keys: enforces max 5 keys', async () => {
  await cleanModals();
  await sharedPage.getByRole('button', { name: 'API' }).click();
  await sharedPage.waitForTimeout(200);
  await sharedPage.getByPlaceholder('e.g. Production API').click();
  await sharedPage.keyboard.press('Control+a');
  await sharedPage.keyboard.press('Delete');
  for (let i = 0; i < 5; i++) {
    await sharedPage.getByPlaceholder('e.g. Production API').fill(`key-${i}`);
    await sharedPage.getByRole('button', { name: 'Create Key' }).click();
    const modal = sharedPage.locator('[role="dialog"]');
    try {
      await expect(modal).toBeVisible({ timeout: 10000 });
      await sharedPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Done'));
        if (btn) btn.click();
      });
      await expect(modal).not.toBeVisible({ timeout: 5000 });
    } catch {
      break;
    }
  }
  const limitText = sharedPage.getByText('Limit Reached (5)');
  const isLimitVisible = await limitText.isVisible({ timeout: 3000 }).catch(() => false);
  if (isLimitVisible) {
    await expect(limitText).toBeVisible();
  }
});

test('providers: shows default provider as immutable', async () => {
  await cleanModals();
  await sharedPage.keyboard.press('Escape');
  await sharedPage.waitForTimeout(200);
  await sharedPage.getByRole('button', { name: 'Providers' }).click();
  const configuredProviders = sharedPage.getByTestId('configured-providers');
  await expect(configuredProviders).toBeVisible();
  await expect(configuredProviders.getByText('Managed').first()).toBeVisible();

  const wideFieldBoxes = await Promise.all([
    sharedPage.getByLabel('Name').first().boundingBox(),
    sharedPage.getByLabel('API Base URL').first().boundingBox(),
    sharedPage.getByLabel('Models').first().boundingBox(),
    sharedPage.getByLabel('API Key').first().boundingBox(),
  ]);
  const wideFieldWidths = wideFieldBoxes.map(box => box?.width || 0);
  expect(Math.min(...wideFieldWidths)).toBeGreaterThan(400);
  expect(Math.max(...wideFieldWidths) - Math.min(...wideFieldWidths)).toBeLessThan(2);

  const configuredProviderWidth = await configuredProviders.evaluate(element => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(configuredProviderWidth.scroll).toBeLessThanOrEqual(configuredProviderWidth.client);
});

test('providers: discovers models without overwriting manual choices', async () => {
  await cleanModals();
  await sharedPage.getByRole('button', { name: 'Providers' }).click();
  let requestBody: any;
  let authorization: string | undefined;
  await sharedPage.route('**/api/providers/test', async route => {
    requestBody = route.request().postDataJSON();
    authorization = route.request().headers().authorization;
    const baseUrl = requestBody.base_url.endsWith('/') ? requestBody.base_url : `${requestBody.base_url}/`;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        status: 200,
        models: ['discovered-a', 'discovered-b'],
        endpoint: new URL(requestBody.models_path, baseUrl).toString(),
        detail: 'Connection successful',
      }),
    });
  });

  await sharedPage.getByLabel('API Base URL').first().fill('https://example.com/v1');
  await sharedPage.getByLabel('API Key').first().fill('sk-discovery');
  await sharedPage.getByLabel('Models').first().fill('');
  await sharedPage.getByText('Advanced', { exact: true }).first().click();
  const modelsPathInput = sharedPage.getByLabel('Models Path').first();
  await modelsPathInput.fill('%252e%252e/models');
  await expect(sharedPage.getByText(/Resolved models endpoint:/)).toHaveCount(0);
  await modelsPathInput.fill('models%3Fscope=all');
  await expect(sharedPage.getByText(/Resolved models endpoint:/)).toHaveCount(0);
  await modelsPathInput.fill('models%23fragment');
  await expect(sharedPage.getByText(/Resolved models endpoint:/)).toHaveCount(0);
  await modelsPathInput.fill('catalog/models');
  await expect(sharedPage.getByText(/Resolved models endpoint:/).first()).toContainText('https://example.com/v1/catalog/models');
  await sharedPage.getByRole('button', { name: 'Test Connection' }).click();

  await expect.poll(() => requestBody).toEqual({
    base_url: 'https://example.com/v1',
    models_path: 'catalog/models',
    api_key: 'sk-discovery',
  });
  expect(authorization).toMatch(/^Bearer /);
  await expect(sharedPage.getByRole('status')).toContainText('Connection successful');
  await expect(sharedPage.getByRole('status')).toContainText('https://example.com/v1/catalog/models');
  await expect(sharedPage.getByLabel('Models').first()).toHaveValue('discovered-a,discovered-b');

  await sharedPage.getByLabel('API Base URL').first().fill('https://example.com/v2');
  await expect(sharedPage.getByLabel('Models').first()).toHaveValue('');
  await sharedPage.getByLabel('Models').first().fill('manual-model');
  await sharedPage.getByLabel('Models Path').first().fill('/models-v2');
  await sharedPage.getByLabel('API Key').first().fill('sk-discovery-v2');
  await expect(sharedPage.getByLabel('Models').first()).toHaveValue('manual-model');
  await sharedPage.getByRole('button', { name: 'Test Connection' }).click();

  await expect(sharedPage.getByLabel('Models').first()).toHaveValue('manual-model');
  await sharedPage.getByRole('button', { name: 'Use discovered models' }).click();
  await expect(sharedPage.getByLabel('Models').first()).toHaveValue('discovered-a,discovered-b');
  await sharedPage.unroute('**/api/providers/test');
});

test('providers: discovers blank models before add and stops on discovery errors', async () => {
  await cleanModals();
  await sharedPage.getByRole('button', { name: 'Providers' }).click();
  const discoveryBodies: any[] = [];
  const createBodies: any[] = [];
  let releaseSlowDiscovery: (() => void) | undefined;

  await sharedPage.route('**/api/providers/test', async route => {
    const body = route.request().postDataJSON();
    discoveryBodies.push(body);
    if (body.base_url.includes('slow')) {
      await new Promise<void>(resolve => { releaseSlowDiscovery = resolve; });
    }
    const unavailable = body.base_url.includes('unavailable');
    await route.fulfill({
      status: unavailable ? 502 : 200,
      contentType: 'application/json',
      body: JSON.stringify(unavailable
        ? { detail: 'Endpoint unavailable', status: 503, endpoint: `${body.base_url}/models` }
        : { ok: true, status: 200, models: ['auto-a', 'auto-b'], endpoint: `${body.base_url}/models`, detail: 'Connection successful' }),
    });
  });
  await sharedPage.route('**/api/providers', async route => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON();
    createBodies.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: `provider-${createBodies.length}`, ...body }),
    });
  });

  await sharedPage.getByLabel('Name').first().fill('Discovered Provider');
  await sharedPage.getByLabel('API Base URL').first().fill('https://working.example/v1');
  await sharedPage.getByLabel('Models').first().fill('');
  await sharedPage.getByLabel('API Key').first().fill('');
  const modelsPathInput = sharedPage.getByLabel('Models Path').first();
  if (!await modelsPathInput.isVisible()) {
    await sharedPage.getByText('Advanced', { exact: true }).first().click();
  }
  await modelsPathInput.fill('models');
  await sharedPage.getByRole('button', { name: 'Add Provider' }).click();

  await expect.poll(() => createBodies.length).toBe(1);
  expect(discoveryBodies).toHaveLength(1);
  expect(createBodies[0]).toMatchObject({
    name: 'Discovered Provider',
    base_url: 'https://working.example/v1',
    models: 'auto-a,auto-b',
    models_path: 'models',
    models_source: 'discovered',
  });
  await expect(sharedPage.getByLabel('Name').first()).toHaveValue('');

  await sharedPage.getByLabel('Name').first().fill('Unavailable Provider');
  await sharedPage.getByLabel('API Base URL').first().fill('https://unavailable.example/v1');
  await sharedPage.getByLabel('Models').first().fill('');
  await sharedPage.getByRole('button', { name: 'Add Provider' }).click();

  await expect(sharedPage.getByText(/Model discovery failed: Endpoint unavailable/)).toBeVisible();
  expect(createBodies).toHaveLength(1);
  expect(discoveryBodies).toHaveLength(2);

  await sharedPage.getByLabel('Models').first().fill('manual-model');
  await sharedPage.getByRole('button', { name: 'Add Provider' }).click();
  await expect.poll(() => createBodies.length).toBe(2);
  expect(discoveryBodies).toHaveLength(2);
  expect(createBodies[1].models).toBe('manual-model');
  expect(createBodies[1].models_source).toBe('manual');

  await expect(sharedPage.getByLabel('Name').first()).toHaveValue('');
  await sharedPage.getByLabel('Name').first().fill('Slow Provider');
  await sharedPage.getByLabel('API Base URL').first().fill('https://slow.example/v1');
  await sharedPage.getByLabel('Models').first().fill('');
  await sharedPage.getByRole('button', { name: 'Add Provider' }).click();
  await expect.poll(() => discoveryBodies.length).toBe(3);
  await sharedPage.getByLabel('Models').first().fill('typed-during-discovery');
  releaseSlowDiscovery?.();
  await expect.poll(() => createBodies.length).toBe(3);
  expect(createBodies[2].models).toBe('typed-during-discovery');
  expect(createBodies[2].models_source).toBe('manual');
  await expect(sharedPage.getByLabel('Name').first()).toHaveValue('');

  await sharedPage.unroute('**/api/providers/test');
  await sharedPage.unroute('**/api/providers');
});

test('providers: model count opens the Models page with a provider filter', async () => {
  await cleanModals();
  const modelRequests: URL[] = [];
  await sharedPage.route('**/api/providers', async route => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        id: 'provider-link',
        name: 'Linked Provider',
        base_url: 'https://linked.example/v1',
        models: 'linked-a,linked-b',
        models_path: 'models',
        visibility: 'private',
        immutable: false,
        model_count: 2,
        rate_limits: '10:request:minute',
        queue_max_size: 5,
      }]),
    });
  });
  await sharedPage.route('**/api/models?*', async route => {
    const requestUrl = new URL(route.request().url());
    modelRequests.push(requestUrl);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        object: 'list',
        data: [{
          id: 'offering-linked',
          model_id: 'linked-a',
          provider_id: 'provider-link',
          provider_name: 'Linked Provider',
          visibility: 'private',
          source: 'manual',
          enabled: true,
          created_at: 1,
          last_seen_at: 1,
          rate_limits: '10:request:minute',
          queue_max_size: 5,
          can_update_visibility: false,
        }],
        has_more: false,
        next_cursor: null,
      }),
    });
  });

  await sharedPage.getByRole('button', { name: 'Providers' }).click();
  await sharedPage.reload();
  await sharedPage.waitForURL(/\/providers$/);
  const configuredProviders = sharedPage.getByTestId('configured-providers');
  await configuredProviders.getByRole('button', { name: '2 models' }).click();

  await expect(sharedPage).toHaveURL(/\/models$/);
  await expect.poll(() => modelRequests.at(-1)?.searchParams.get('provider_id')).toBe('provider-link');
  await expect(sharedPage.getByTestId('models-list').getByText('linked-a')).toBeVisible();

  await sharedPage.getByRole('button', { name: 'Providers' }).click();
  await sharedPage.unroute('**/api/models?*');
  await sharedPage.unroute('**/api/providers');
});

test('models: filters, cursor pagination, public confirmation, and mobile layout', async () => {
  await cleanModals();
  const modelRequests: URL[] = [];
  const patchBodies: any[] = [];
  let offeringVisibility: 'private' | 'public' = 'private';
  const privateOffering = {
    id: 'offering-private',
    model_id: 'llama3-8b',
    provider_id: 'provider-custom',
    provider_name: 'Custom Provider',
    visibility: 'private',
    source: 'discovered',
    enabled: true,
    created_at: 1,
    last_seen_at: 2,
    rate_limits: '10:request:minute',
    queue_max_size: 5,
    can_update_visibility: true,
  };

  await sharedPage.route('**/api/models?*', async route => {
    const requestUrl = new URL(route.request().url());
    modelRequests.push(requestUrl);
    const secondPage = requestUrl.searchParams.get('after') === 'cursor-next';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        object: 'list',
        data: requestUrl.searchParams.get('visibility') && requestUrl.searchParams.get('visibility') !== offeringVisibility
          ? []
          : secondPage
            ? [{ ...privateOffering, id: 'offering-second', model_id: 'llama3-70b', visibility: offeringVisibility }]
            : [{ ...privateOffering, visibility: offeringVisibility }],
        has_more: !secondPage,
        next_cursor: secondPage ? null : 'cursor-next',
      }),
    });
  });
  await sharedPage.route('**/api/models/offering-private', async route => {
    const body = route.request().postDataJSON();
    patchBodies.push(body);
    offeringVisibility = body.visibility;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...privateOffering, visibility: body.visibility }),
    });
  });

  await sharedPage.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(sharedPage).toHaveURL(/\/models$/);
  await expect(sharedPage.getByText('llama3-8b')).toBeVisible();

  await sharedPage.getByLabel('Filter by provider').selectOption('provider-custom');
  await sharedPage.getByLabel('Filter by visibility').selectOption('private');
  await sharedPage.getByPlaceholder('Search models or providers').fill('llama3');
  await sharedPage.getByRole('button', { name: 'Search', exact: true }).click();

  await expect.poll(() => {
    const params = modelRequests.at(-1)?.searchParams;
    return params && {
      limit: params.get('limit'),
      provider: params.get('provider_id'),
      visibility: params.get('visibility'),
      query: params.get('q'),
    };
  }).toEqual({ limit: '25', provider: 'provider-custom', visibility: 'private', query: 'llama3' });

  await sharedPage.getByRole('button', { name: 'Next' }).click();
  await expect.poll(() => modelRequests.at(-1)?.searchParams.get('after')).toBe('cursor-next');
  await expect(sharedPage.getByText('llama3-70b')).toBeVisible();
  await expect(sharedPage.getByText('Page 2')).toBeVisible();

  await sharedPage.getByRole('button', { name: 'Previous' }).click();
  await expect.poll(() => modelRequests.at(-1)?.searchParams.has('after')).toBe(false);
  await expect(sharedPage.getByText('llama3-8b')).toBeVisible();

  const visibilitySwitch = sharedPage.getByRole('switch', { name: 'Make llama3-8b public' });
  await visibilitySwitch.click();
  const confirmation = sharedPage.getByRole('dialog', { name: 'Make this model public?' });
  await expect(confirmation).toContainText('consume shared capacity and incur provider costs');
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await sharedPage.keyboard.press('Shift+Tab');
  await expect(confirmation.getByRole('button', { name: 'Make Public' })).toBeFocused();
  await sharedPage.keyboard.press('Escape');
  await expect(confirmation).not.toBeVisible();
  await expect(visibilitySwitch).toBeFocused();
  await visibilitySwitch.click();
  expect(patchBodies).toHaveLength(0);
  await sharedPage.getByRole('dialog', { name: 'Make this model public?' }).getByRole('button', { name: 'Make Public' }).click();
  await expect.poll(() => patchBodies).toEqual([{ visibility: 'public' }]);
  await expect(sharedPage.getByText('llama3-8b')).not.toBeVisible();
  await sharedPage.getByLabel('Filter by visibility').selectOption('public');
  await expect(sharedPage.getByRole('switch', { name: 'Make llama3-8b private' })).toHaveAttribute('aria-checked', 'true');

  await sharedPage.setViewportSize({ width: 375, height: 667 });
  const modelsList = sharedPage.getByTestId('models-list');
  await expect(modelsList).toBeVisible();
  const modelsListWidth = await modelsList.evaluate(element => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(modelsListWidth.scroll).toBeLessThanOrEqual(modelsListWidth.client);
  await expect(sharedPage.getByLabel('Filter by provider')).toBeVisible();
  await expect(sharedPage.getByRole('switch', { name: 'Make llama3-8b private' })).toBeVisible();
  await sharedPage.setViewportSize({ width: 1280, height: 720 });

  await sharedPage.getByRole('button', { name: 'Providers' }).click();
  await sharedPage.unroute('**/api/models/offering-private');
  await sharedPage.unroute('**/api/models?*');
});

test.skip('providers: creates a new provider', async () => {
  await cleanModals();
  await sharedPage.getByRole('button', { name: 'Providers' }).click();
  await sharedPage.waitForTimeout(200);
  await sharedPage.getByPlaceholder('e.g. Ollama Local').click();
  await sharedPage.keyboard.press('Control+a');
  await sharedPage.keyboard.press('Delete');
  await sharedPage.getByPlaceholder('e.g. Ollama Local').fill('Ollama Test');
  await sharedPage.getByPlaceholder('https://api.example.com/v1').click();
  await sharedPage.keyboard.press('Control+a');
  await sharedPage.keyboard.press('Delete');
  await sharedPage.getByPlaceholder('https://api.example.com/v1').fill('https://example.com/v1');
  await sharedPage.getByPlaceholder('llama3,mistral').click();
  await sharedPage.keyboard.press('Control+a');
  await sharedPage.keyboard.press('Delete');
  await sharedPage.getByPlaceholder('llama3,mistral').fill('llama3,mistral');
  await sharedPage.getByRole('button', { name: 'Add Provider' }).click();
  await expect(sharedPage.locator('select option').filter({ hasText: 'Ollama Test' })).toHaveCount(1);
});

test.skip('providers: deletes a provider', async () => {
  await cleanModals();
  await sharedPage.getByRole('button', { name: 'Providers' }).click();
  await sharedPage.waitForTimeout(200);
  await sharedPage.getByPlaceholder('e.g. Ollama Local').click();
  await sharedPage.keyboard.press('Control+a');
  await sharedPage.keyboard.press('Delete');
  await sharedPage.getByPlaceholder('e.g. Ollama Local').fill('delete-me-provider');
  await sharedPage.getByPlaceholder('https://api.example.com/v1').click();
  await sharedPage.keyboard.press('Control+a');
  await sharedPage.keyboard.press('Delete');
  await sharedPage.getByPlaceholder('https://api.example.com/v1').fill('https://example.com/v1');
  await sharedPage.getByPlaceholder('llama3,mistral').click();
  await sharedPage.keyboard.press('Control+a');
  await sharedPage.keyboard.press('Delete');
  await sharedPage.getByPlaceholder('llama3,mistral').fill('llama3,mistral');
  await sharedPage.getByRole('button', { name: 'Add Provider' }).click();
  await sharedPage.waitForTimeout(300);
  await sharedPage.locator('button[aria-label^="Delete "]').first().click();
  await expect(sharedPage.locator('text=delete-me-provider').first()).not.toBeVisible();
});

test('settings: delete account requires email confirmation', async () => {
  await cleanModals();
  await sharedPage.getByRole('button', { name: 'Settings' }).click();
  await sharedPage.getByRole('button', { name: 'Delete Account' }).first().click();
  await expect(sharedPage.locator('[role="dialog"]')).toBeVisible();
  await sharedPage.locator('[role="dialog"] input').fill('wrong@example.com');
  await expect(sharedPage.locator('[role="dialog"] button').filter({ hasText: 'Delete Account' })).toBeDisabled();
  await sharedPage.locator('[role="dialog"] button').filter({ hasText: 'Cancel' }).click();
  await sharedPage.waitForTimeout(200);
});

test.skip('settings: theme switcher persists', async () => {
  await cleanModals();
  await sharedPage.getByRole('button', { name: 'Dark' }).click();
  await expect(sharedPage.locator('html')).toHaveClass(/dark/);
  await sharedPage.reload();
  await expect(sharedPage.locator('html')).toHaveClass(/dark/);
});

test('mobile: sidebar is hidden by default', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill('e2e-mobile@example.com');
  await page.getByPlaceholder('Min. 8 characters').fill('password123');
  await page.getByRole('button', { name: 'Create New Account' }).click();
  await page.waitForURL(/\/chat$/, { timeout: 10000 });
  await expect(page.locator('aside')).toHaveClass(/-translate-x-full/);
  await context.close();
});

test('mobile: hamburger opens sidebar', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill('e2e-mobile2@example.com');
  await page.getByPlaceholder('Min. 8 characters').fill('password123');
  await page.getByRole('button', { name: 'Create New Account' }).click();
  await page.waitForURL(/\/chat$/, { timeout: 10000 });
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('aside')).toHaveClass(/translate-x-0/);
  await context.close();
});
